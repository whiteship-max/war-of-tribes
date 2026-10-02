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

export { bakeTile } from './bake';

/** Сезон выпечки: зима белит горы и север, весна и осень — чуть. Меняется раз в сезон, не в кадр. */
const SEASON_SNOW = { spring: 0.15, summer: 0, autumn: 0.25, winter: 1 } as const;

let gfxDirty = true;
subscribeGfx(() => {
  gfxDirty = true;
});

/** Кусков обзора нового вида в памяти: экран дальнего масштаба с запасом, по 69 КБ на кусок. */
const CHUNKS_MAX = 120;
const chunks = new Map<string, HTMLCanvasElement>();
/** Не больше одной выпечки куска за кадр: кадр карты — 60 в секунду, отсчёт — по часам кадра. */
let lastBake = -Infinity;
const BAKE_GAP_MS = 14;
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

function dropChunks(): void {
  for (const c of chunks.values()) c.width = 0;
  chunks.clear();
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
  if (now - lastBake < BAKE_GAP_MS) return null;
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
  const baked = bakeChunk(seed, chunk);
  if (!baked) return null;
  lastBake = now;
  chunks.set(chunk.key, baked);
  while (chunks.size > CHUNKS_MAX) {
    const first = chunks.keys().next().value as string;
    const gone = chunks.get(first);
    if (gone) gone.width = 0;
    chunks.delete(first);
  }
  return baked;
}
