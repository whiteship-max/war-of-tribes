// Кэш кусков карты. Карта спрашивает мир кусками фиксированного размера и держит
// их у себя: на сервере это будут те же запросы, только по сети, поэтому кэш живёт
// на стороне клиента, а не внутри реализации мира.
import type { Rect, RegionChunk, SettlementView, Terrain } from './types';
import { CHUNK, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import { TERRAIN_ORDER } from './data/terrain';

export interface CachedChunk extends RegionChunk {
  key: string;
  fetchedAt: number;
}

/** Через сколько кусок перезапрашивают: у соседей меняются стадия и отношение. */
export const CHUNK_TTL = 45_000;

const chunks = new Map<string, CachedChunk>();
const pending = new Set<string>();

export const chunkKey = (cx: number, cy: number): string => `${cx}:${cy}`;

const indexOf = (v: number, origin: number): number => Math.floor((v - origin) / CHUNK);

export function chunkRect(cx: number, cy: number): Rect {
  return { x: WORLD_ORIGIN.x + cx * CHUNK, y: WORLD_ORIGIN.y + cy * CHUNK, w: CHUNK, h: CHUNK };
}

/** Куски, попадающие в область экрана. */
export function chunkKeysIn(rect: Rect): { key: string; cx: number; cy: number }[] {
  const last = Math.ceil(WORLD_SIZE / CHUNK) - 1;
  const cx0 = Math.max(0, indexOf(rect.x, WORLD_ORIGIN.x));
  const cy0 = Math.max(0, indexOf(rect.y, WORLD_ORIGIN.y));
  const cx1 = Math.min(last, indexOf(rect.x + rect.w, WORLD_ORIGIN.x));
  const cy1 = Math.min(last, indexOf(rect.y + rect.h, WORLD_ORIGIN.y));
  const out: { key: string; cx: number; cy: number }[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) out.push({ key: chunkKey(cx, cy), cx, cy });
  }
  return out;
}

export const cachedChunk = (key: string): CachedChunk | null => chunks.get(key) ?? null;

export const isStale = (c: CachedChunk, now: number): boolean => now - c.fetchedAt > CHUNK_TTL;

export const isPending = (key: string): boolean => pending.has(key);
export const markPending = (key: string): void => void pending.add(key);
export const clearPending = (key: string): void => void pending.delete(key);

export function putChunk(key: string, chunk: RegionChunk, now: number): void {
  chunks.set(key, { ...chunk, key, fetchedAt: now });
}

/**
 * Все куски считать устаревшими, **не выбрасывая**: карта рисует прежнее, пока не
 * приедет новое, и перезапрашивает их первым же кадром. Зовётся, когда пульс принёс
 * событие, меняющее вид поселений, — город осадили, лагерь снят, город взят. Иначе
 * рогатки и знак участи появлялись бы на карте со сроком куска (`CHUNK_TTL`), то есть
 * до трёх четвертей минуты после отчёта.
 *
 * Земли это не касается: тайлы испечены по клеткам, а не по кускам, и перепекать их
 * нечего (`ui/map/ground.ts`).
 */
export function ageChunks(): void {
  for (const c of chunks.values()) c.fetchedAt = -Infinity;
}

export function chunkAt(x: number, y: number): CachedChunk | null {
  return chunks.get(chunkKey(indexOf(x, WORLD_ORIGIN.x), indexOf(y, WORLD_ORIGIN.y))) ?? null;
}

/** Индекс клетки внутри куска. -1 — клетка не из него. */
function cellIndex(c: CachedChunk, x: number, y: number): number {
  const ix = x - c.rect.x;
  const iy = y - c.rect.y;
  if (ix < 0 || iy < 0 || ix >= c.rect.w || iy >= c.rect.h) return -1;
  return iy * c.rect.w + ix;
}

/** Ландшафт клетки из кэша. null — кусок ещё не приехал. */
export function terrainAt(x: number, y: number): Terrain | null {
  const c = chunkAt(x, y);
  if (!c) return null;
  const i = cellIndex(c, x, y);
  return i < 0 ? null : (TERRAIN_ORDER[c.terrain[i]] ?? null);
}

/**
 * Клетка разведана? Пока кусок не приехал, считаем закрытой: лучше показать
 * дымку, которая через мгновение разойдётся, чем мигнуть открытой землёй.
 */
export function exploredAt(x: number, y: number): boolean {
  const c = chunkAt(x, y);
  if (!c) return false;
  const i = cellIndex(c, x, y);
  return i >= 0 && c.explored[i] === 1;
}

/**
 * Признаки местности клетки: биты `FEATURE`. Ноль — и когда в клетке ничего нет,
 * и когда кусок ещё не приехал: рисовать реку раньше земли всё равно некуда.
 */
export function featuresAt(x: number, y: number): number {
  const c = chunkAt(x, y);
  if (!c) return 0;
  const i = cellIndex(c, x, y);
  return i < 0 ? 0 : (c.features[i] ?? 0);
}

/** Чья земля: 0 — ничья или неразведанная. Мир в туман цвет племени не кладёт. */
export function influenceAt(x: number, y: number): number {
  const c = chunkAt(x, y);
  if (!c) return 0;
  const i = cellIndex(c, x, y);
  return i < 0 ? 0 : (c.influence[i] ?? 0);
}

export function settlementAt(x: number, y: number): SettlementView | null {
  const c = chunkAt(x, y);
  if (!c) return null;
  return c.settlements.find((s) => s.x === x && s.y === y) ?? null;
}

/** Все загруженные куски, попадающие в область. */
export function loadedIn(rect: Rect): CachedChunk[] {
  const out: CachedChunk[] = [];
  for (const { key } of chunkKeysIn(rect)) {
    const c = chunks.get(key);
    if (c) out.push(c);
  }
  return out;
}

export function clearCache(): void {
  chunks.clear();
  pending.clear();
}
