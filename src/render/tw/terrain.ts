// Земля поля боя в стиле Total War — чистые функции (docs/battle_tw.md, раздел 6). Без three: высоту читают и
// план (на ней стоит каждая фигура), и плита земли (`field.ts`), и это одна функция, а не две — иначе ноги
// разошлись бы с землёй ровно там, где рельеф интересен.
//
// Земля выводится из места боя (`Cast.ground`, мост `game/battle/ground.ts`) и из того, что сказал журнал
// (`ground`: штраф переправы нападающему). Показ мира не читает.

/** Детерминированный шум от сида: [0, 1). Целочисленная мешалка, без `Math.random`. */
export function hash(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);
export const smoothstep = (a: number, b: number, x: number): number => fade(Math.min(1, Math.max(0, (x - a) / (b - a))));

/** Сглаженный шум по сетке шага 1: [0, 1). */
export function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Река на поле. Течёт поперёк — вдоль X, как фронт: её переходят, а не обходят. */
export interface TwRiver {
  /** Середина русла по Z. */
  z: number;
  /** Полуширина воды. */
  half: number;
  /** Брод — отмель поперёк русла: по ней переходят. */
  ford: boolean;
  fordX: number;
  fordHalf: number;
  /** Река между линиями — переправа, за которую ядро штрафует нападающего. */
  between: boolean;
}

/** Поле боя: где оно кончается и что на нём. Его строит план (`plan.ts`), рисует `field.ts`. */
export interface TwField {
  /** Поле играбельное: строи, бегущие и камера — внутри. */
  halfX: number;
  minZ: number;
  maxZ: number;
  /** Сид земли: тот же бой — та же трава до кустика. */
  seed: number;
  land: 'plain' | 'hills' | 'shore';
  /** Холм обороны: высота гребня и с какой стороны по Z он стоит (+1 — у +Z). */
  hill: { h: number; side: 1 | -1; from: number; to: number } | null;
  river: TwRiver | null;
  woods: boolean;
  road: boolean;
  /** Обрыв за строем стороны `side` по Z. */
  ridge: { side: 1 | -1; at: number } | null;
  winter: boolean;
  /**
   * Ровное место: город за стеной и сама стена стоят на ровном — волны земли гаснут за `z` в сторону `dir`
   * (docs/battle_tw.md, раздел 13). null — поле.
   */
  calm: { z: number; dir: 1 | -1 } | null;
}

/** Вода реки стоит здесь: ниже кромки берега, выше дна. */
export const WATER_Y = -0.18;
/** Глубина русла под кромкой и у брода. */
const RIVER_DEEP = 0.75;
const FORD_DEEP = 0.34;
/** Ширина откоса берега. */
const BANK = 1.6;

/**
 * Высота земли в точке. Рельеф поля пологий — волны в десятки сантиметров, чтобы строй стоял, а не тонул; холм,
 * русло и обрыв — по месту боя.
 */
export function heightAt(f: TwField, x: number, z: number): number {
  // Пологие волны: две октавы, крупная и мелкая. Под городом и стеной — гаснут.
  const calm = f.calm ? 1 - 0.92 * smoothstep(-6, 0, (z - f.calm.z) * f.calm.dir) : 1;
  let y = ((vnoise(x / 23, z / 23, f.seed) - 0.5) * 0.9 + (vnoise(x / 7, z / 7, f.seed + 7) - 0.5) * 0.18) * calm;
  if (f.hill) {
    const u = smoothstep(f.hill.from, f.hill.to, z * f.hill.side);
    // Гребень не линейка: по краям поля он сходит на нет, середина выше.
    const across = 1 - 0.35 * smoothstep(f.halfX * 0.4, f.halfX * 1.1, Math.abs(x));
    y += f.hill.h * u * across;
  }
  if (f.land === 'hills') y += (vnoise(x / 40 + 3, z / 40, f.seed + 13) - 0.5) * 3.2 * smoothstep(20, 60, Math.abs(x)) * calm;
  if (f.ridge) {
    const past = (z - f.ridge.at) * f.ridge.side;
    y -= 7 * smoothstep(0, 9, past);
  }
  if (f.river) {
    const r = f.river;
    const d = Math.abs(z - r.z + Math.sin(x / 17 + f.seed) * 0.6);
    const fordK = r.ford ? 1 - smoothstep(r.fordHalf, r.fordHalf + 3, Math.abs(x - r.fordX)) : 0;
    const deep = RIVER_DEEP + (FORD_DEEP - RIVER_DEEP) * fordK;
    const bed = WATER_Y - deep;
    // Берег опускает землю к воде плавно: откос шириной `BANK`.
    const k = smoothstep(r.half + BANK, r.half - 0.3, d);
    y = y * (1 - k) + bed * k;
  }
  return y;
}

/** Точка в воде: ноги там глубже, строй медленнее и рыхлее (переправа, docs/battle_tw.md, раздел 4). */
export function inWater(f: TwField, x: number, z: number): boolean {
  const r = f.river;
  if (!r) return false;
  return Math.abs(z - r.z + Math.sin(x / 17 + f.seed) * 0.6) < r.half;
}
