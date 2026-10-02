// Дверь нового вида в игру (docs/map_tw.md): `ground.ts` подгружает этот кусок по флагу `?map=tw`
// (`look.ts`) и дальше зовёт отсюда выпечку тайла, кусок обзора и сверку вида. Сетка тайлов, кэш и
// правило «стоя не печётся» — прежние; здесь только то, что печётся.
import type { CachedChunk } from '@/world/cache';
import { useWorld } from '@/world/store';
import { useGame } from '@/game/store';
import { seasonOf } from '@/game/derived';
import { subscribeGfx } from '@/render/gfx';
import { bakeChunk, chunkNeed, chunkReady, setTwLook } from './bake';
import { twQuality } from './spec';
import { baked, mayBake } from './gate';
import { pixelRatio } from '@/render/loop';
import { sightDiscs, worldNow } from '@/world/store';
import { setTwSlot } from '../twslot';
import { viewRect } from '../grid';
import { settlementsIn } from '../detail';
import { drawTwFrame, dropFrame, setMidLayer } from './frame';
import { drawMid, dropMid } from './mid';
import { dropMinis } from './mini';
import { dropLabels } from './labels';
import { dropTwFog } from './fog';
import { figureItems, hostItems, placeItems } from './scene';
import { aimAt, aimsOf } from './tap';

export { bakeTile } from './bake';

// Кадр и палец нового вида — в ячейку прежнего кадра (`twslot.ts`): кусок приехал, и карта рисуется им.
setMidLayer(drawMid);
setTwSlot({
  frame: drawTwFrame,
  tap(cam, vp, x, y, hand) {
    const state = useWorld.getState();
    const now = worldNow();
    const dpr = pixelRatio();
    // Цели — из той же сцены, что рисует кадр, на той же камере: палец ищет нарисованное.
    const places = placeItems(cam, vp, settlementsIn(viewRect(cam, vp)), dpr);
    const hosts = hostItems(cam, vp, state.marches, sightDiscs(now), now, dpr);
    const figures = figureItems(cam, vp, state.figures, now, dpr);
    return aimAt(aimsOf(places, hosts, figures), x, y, hand);
  },
  drop() {
    dropMinis();
    dropLabels();
    dropFrame();
    dropTwFog();
    dropChunks();
  },
});

/** Сезон выпечки: зима белит горы и север, весна и осень — чуть. Меняется раз в сезон, не в кадр. */
const SEASON_SNOW = { spring: 0.15, summer: 0, autumn: 0.25, winter: 1 } as const;

let gfxDirty = true;
subscribeGfx(() => {
  gfxDirty = true;
});

/** Кусков обзора нового вида в памяти: экран дальнего масштаба с запасом, по 69 КБ на кусок. */
const CHUNKS_MAX = 120;
const chunks = new Map<string, HTMLCanvasElement>();
/** Когда кусок последний раз заказывал свою округу. */
const askedAt = new Map<string, number>();

/**
 * Сверка вида с игрой: уровень из настроек и сезон партии. Сменился — испечённое устарело: вернёт
 * true, и `ground.ts` сбросит тайлы; куски обзора сбрасываются здесь же.
 */
export function syncLook(): boolean {
  const s = useGame.getState().s;
  const season = s ? SEASON_SNOW[seasonOf(s.time)] : 0;
  const quality = gfxDirty ? twQuality() : undefined;
  gfxDirty = false;
  const changed = setTwLook(quality ? { quality, season } : { season });
  if (changed) dropChunks();
  return changed;
}

/** Под какой сид испечены куски обзора. */
let chunksSeed = 0;

/** Испечённое обзором и средним слоем — под прежний вид: сменился сезон, уровень или мир. */
function dropChunks(): void {
  for (const c of chunks.values()) c.width = 0;
  chunks.clear();
  dropMid();
}

/** Кусок обзора нового вида или null — тогда кадр рисует прежний растр, пока этот не испечётся. */
export function overviewChunk(chunk: CachedChunk): HTMLCanvasElement | null {
  // Новый мир — новые складки и купы: испечённое под прежний сид не годится.
  const seedNow = useWorld.getState().info?.seed ?? 0;
  if (seedNow !== chunksSeed) {
    dropChunks();
    chunksSeed = seedNow;
  }
  const have = chunks.get(chunk.key);
  if (have) {
    // Свежий в конец: вытесняется давно не нужный.
    chunks.delete(chunk.key);
    chunks.set(chunk.key, have);
    return have;
  }
  const now = performance.now();
  // Не больше одной выпечки нового вида за кадр — общей очередью с листами и средним слоем (`gate.ts`).
  if (!mayBake(now)) return null;
  const world = useWorld.getState();
  const seed = seedNow;
  if (!seed) return null;
  // Куску нужна округа: свет, тень и сплайн смотрят на клетки соседей. Кадр карты заказывает куски только
  // под экраном и запасом, и край обзора без этого вечно стоял бы прежним растром. Заказ — раз в секунду
  // на кусок: мир сам знает, что уже едет (`ensureRegion`).
  if (!chunkReady(chunk)) {
    const asked = askedAt.get(chunk.key) ?? -Infinity;
    if (now - asked > 1000) {
      askedAt.set(chunk.key, now);
      world.ensureRegion(chunkNeed(chunk));
    }
    return null;
  }
  const picture = bakeChunk(seed, chunk);
  if (!picture) return null;
  baked(now);
  chunks.set(chunk.key, picture);
  while (chunks.size > CHUNKS_MAX) {
    const first = chunks.keys().next().value as string;
    const gone = chunks.get(first);
    if (gone) gone.width = 0;
    chunks.delete(first);
  }
  return picture;
}
