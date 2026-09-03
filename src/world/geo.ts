// Геометрия мира: координаты, ландшафт по клетке, расстояния и время пути.
// Всё здесь — чистые функции от сида и координат: одинаковый сид даёт одинаковый мир
// и одинаковую дорогу, поэтому расчёт можно будет один в один повторить на сервере.
import type { Coord, MarchView, Terrain, UnitStack } from './types';
import { TERRAIN_ORDER, terrainCost } from './data/terrain';
import { stackSpeed } from './data/units';
import { MARCH_MIN_SECONDS, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';

export const coordKey = (x: number, y: number): string => `${x}|${y}`;

export const formatCoord = (c: Coord): string => `${c.x}|${c.y}`;

/** Разбирает «541|822», «541 822» и «541,822». null — не координаты. */
export function parseCoord(text: string): Coord | null {
  const m = text.trim().match(/^(-?\d{1,5})\s*[|,;: ]\s*(-?\d{1,5})$/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export const inWorld = (x: number, y: number): boolean =>
  x >= WORLD_ORIGIN.x &&
  y >= WORLD_ORIGIN.y &&
  x < WORLD_ORIGIN.x + WORLD_SIZE &&
  y < WORLD_ORIGIN.y + WORLD_SIZE;

export const clampToWorld = (c: Coord): Coord => ({
  x: Math.min(WORLD_ORIGIN.x + WORLD_SIZE - 1, Math.max(WORLD_ORIGIN.x, Math.round(c.x))),
  y: Math.min(WORLD_ORIGIN.y + WORLD_SIZE - 1, Math.max(WORLD_ORIGIN.y, Math.round(c.y))),
});

export const distance = (a: Coord, b: Coord): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- Ландшафт ----------

/** Хеш клетки в 0..1. Детерминирован по сиду. */
function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Гладкий шум: решётка хешей, между узлами — сглаженная интерполяция. */
function noise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Ландшафт клетки. Крупная волна задаёт материк и озёра, мелкая рвёт границы,
 * чтобы лес не лежал ровными пятнами.
 */
export function terrainAt(seed: number, x: number, y: number): Terrain {
  const n = noise(seed, x, y, 17) * 0.62 + noise(seed + 8191, x, y, 5.5) * 0.38;
  if (n < 0.34) return 'water';
  if (n < 0.54) return 'plain';
  if (n < 0.68) return 'forest';
  return 'hills';
}

export const terrainIndex = (t: Terrain): number => TERRAIN_ORDER.indexOf(t);

/**
 * Средняя проходимость по прямой между клетками.
 *
 * Точки замера берутся в серединах равных отрезков, а концы предварительно
 * приводятся к одному порядку — поэтому путь туда и обратно считается по тем же
 * клеткам и время пути симметрично при любой арифметике с плавающей точкой.
 */
export function terrainFactor(seed: number, from: Coord, to: Coord): number {
  const flip = to.x < from.x || (to.x === from.x && to.y < from.y);
  const a = flip ? to : from;
  const b = flip ? from : to;
  const dist = distance(a, b);
  const samples = Math.max(3, Math.min(24, Math.round(dist)));
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    sum += terrainCost(terrainAt(seed, x, y));
  }
  return sum / samples;
}

// ---------- Время пути ----------

/**
 * Сколько секунд идти. Расстояние делится на скорость самого медленного юнита
 * и правится ландшафтом. Обратный путь считается той же формулой — значит, ровно столько же.
 */
export function marchSeconds(dist: number, factor: number, units: UnitStack): number {
  const speed = stackSpeed(units);
  return Math.max(MARCH_MIN_SECONDS, Math.round(((dist / speed) * 60 * factor * 100)) / 100);
}

/** Полное время пути между двумя точками мира. */
export const travelSeconds = (seed: number, from: Coord, to: Coord, units: UnitStack): number =>
  marchSeconds(distance(from, to), terrainFactor(seed, from, to), units);

/** Где отряд сейчас: доля пройденного пути между началом и целью. */
export function marchPosition(m: Pick<MarchView, 'from' | 'to' | 'departAt' | 'arriveAt'>, now: number): Coord {
  const total = Math.max(1, m.arriveAt - m.departAt);
  const t = Math.min(1, Math.max(0, (now - m.departAt) / total));
  return { x: m.from.x + (m.to.x - m.from.x) * t, y: m.from.y + (m.to.y - m.from.y) * t };
}

/** Секунд до прибытия, не меньше нуля. */
export const secondsLeft = (arriveAt: number, now: number): number => Math.max(0, (arriveAt - now) / 1000);

/** «4:07» — время в интерфейсе всегда в таком виде. */
export function formatLeft(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
