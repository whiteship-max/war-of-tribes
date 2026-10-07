// Дверь вида карты в игру (docs/map_tw.md): `twslot.ts` подгружает этот кусок на запуске, и он кладёт в ячейку
// свой кадр, свой выбор цели пальцем и рамку камеры («в регионе ли клетка» спрашивают у мира — `twslot.reachable`). Земля
// региона печётся заранее и вне кадра (`prebake.ts`, раздел 13.4); здесь — только сверка вида с игрой.
import { sightDiscs, useWorld, worldNow } from '@/world/store';
import { useGame } from '@/game/store';
import { seasonOf } from '@/game/derived';
import { subscribeGfx } from '@/render/gfx';
import { pixelRatio } from '@/render/loop';
import { onReturn } from '@/viewport';
import { setTwSlot } from '../twslot';
import { viewRect } from '../grid';
import { settlementsIn } from '../detail';
import { setTwLook } from './bake';
import { twQuality } from './quality';
import { drawTwFrame, dropFrame } from './frame';
import { dropMinis } from './mini';
import { dropMarks } from './marks';
import { dropGlyphs } from './glyph';
import { dropLabels } from './labels';
import { dropTwFog } from './fog';
import { dropNear, playerTheatre, prebakeLook, prebakeWake } from './prebake';
import { figureItems, hostItems, placeItems, placesRect } from './scene';
import { aimAt, aimsOf } from './tap';
import { holdInTheatre } from './theatre/camera';

setTwSlot({
  frame(ctx, cam, vp, dpr, frame) {
    // Сезон и уровень сверяются в каждом кадре: сменились — испечённое устарело (новое печётся вне кадра, старое
    // рисуется, пока его нет).
    if (syncLook()) prebakeLook();
    drawTwFrame(ctx, cam, vp, dpr, frame);
  },
  tap(cam, vp, x, y, hand) {
    const state = useWorld.getState();
    const now = worldNow();
    const dpr = pixelRatio();
    // Цели — из той же сцены, что рисует кадр, на той же камере: палец ищет нарисованное.
    const places = placeItems(cam, vp, settlementsIn(placesRect(viewRect(cam, vp))), dpr);
    const hosts = hostItems(cam, vp, state.marches, sightDiscs(now), now, dpr);
    const figures = figureItems(cam, vp, state.figures, now, dpr);
    return aimAt(aimsOf(places, hosts, figures), x, y, hand);
  },
  hold(cam, vp) {
    const t = playerTheatre();
    return t ? holdInTheatre(cam, vp, t.box) : cam;
  },
  drop() {
    dropMinis();
    dropMarks();
    dropGlyphs();
    dropLabels();
    dropFrame();
    dropTwFog();
    dropNear();
  },
});

// Вернулись из фона: работы потока и отказы фона — заново (`prebakeWake`). Подписка живёт с куском, то есть до конца
// страницы: кусок, однажды приехавший, из памяти не уходит.
onReturn(() => prebakeWake());

/** Сезон выпечки: зима белит горы и север, весна и осень — чуть. Меняется раз в сезон, не в кадр. */
const SEASON_SNOW = { spring: 0.15, summer: 0, autumn: 0.25, winter: 1 } as const;

let gfxDirty = true;
subscribeGfx(() => {
  gfxDirty = true;
});

/** Сверка вида с игрой: уровень из настроек и сезон партии. Вернёт true, если вид сменился. */
export function syncLook(): boolean {
  const s = useGame.getState().s;
  const season = s ? SEASON_SNOW[seasonOf(s.time)] : 0;
  const quality = gfxDirty ? twQuality() : undefined;
  gfxDirty = false;
  return setTwLook(quality ? { quality, season } : { season });
}
