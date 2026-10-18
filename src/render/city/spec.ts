// Что вид «город» берёт с уровня качества (docs/city.md, раздел 10). Чистый модуль: его читают
// сборка (`index.ts`), стенд и тест бюджета (`budget.test.ts`).
import type { Quality } from '../quality';
import type { Detail } from './kit';

/** Что город берёт с уровня качества. */
export interface CitySpec {
  /** Сторона слоя текстуры. */
  tex: number;
  /** Сторона карты покрытий. */
  map: number;
  /** Ячеек сетки земли по стороне и шаг в середине. */
  groundCells: number;
  groundCell: number;
  detail: Detail;
  anisotropy: number;
  shadowMap: number;
  /** Деревья: радиус ближних (моделями с тенью), шаг ближних и дальних, дальность леса. */
  treeNear: number;
  nearStep: number;
  farStep: number;
  treeReach: number;
  land: number;
}

export const CITY_SPEC: Record<Quality, CitySpec> = {
  high: { tex: 512, map: 1024, groundCells: 220, groundCell: 2.2, detail: 2, anisotropy: 4, shadowMap: 2048, treeNear: 290, nearStep: 8.5, farStep: 15, treeReach: 900, land: 256 },
  medium: { tex: 512, map: 1024, groundCells: 180, groundCell: 2.6, detail: 1, anisotropy: 2, shadowMap: 1536, treeNear: 250, nearStep: 8, farStep: 17, treeReach: 800, land: 256 },
  low: { tex: 256, map: 512, groundCells: 120, groundCell: 3.6, detail: 0, anisotropy: 1, shadowMap: 1024, treeNear: 220, nearStep: 10, farStep: 22, treeReach: 650, land: 128 },
};


/**
 * Сколько фигур жизни уровень показывает самое большее (`life.ts`, docs/city.md, 11.4 и 13). Новое живого города
 * (`alive.ts`: телеги с волами, утки, лодки, голуби, стяги; фонари ночных прохожих) на низком выключено: низкий — для слабых
 * телефонов, ему хватает прежнего.
 */
export const LIFE_CAP: Record<Quality, { people: number; guards: number; birds: number; animals: number; smoke: number; lanterns: number; carts: number; ducks: number; boats: number; pigeons: number; banners: number }> = {
  low: { people: 70, guards: 10, birds: 12, animals: 8, smoke: 40, lanterns: 0, carts: 0, ducks: 0, boats: 0, pigeons: 0, banners: 0 },
  medium: { people: 160, guards: 18, birds: 28, animals: 14, smoke: 90, lanterns: 24, carts: 4, ducks: 12, boats: 2, pigeons: 16, banners: 1 },
  high: { people: 260, guards: 26, birds: 44, animals: 18, smoke: 160, lanterns: 40, carts: 8, ducks: 20, boats: 3, pigeons: 28, banners: 1 },
};

/**
 * Треугольников у фигуры жизни — счёту бюджета (`budget.cityCounts`); сами фигуры строят `life.ts` и `alive.ts`, а что
 * числа с ними сходятся, держит тест (`life.test.ts`). Люди — точёные (docs/city.md, 16.2): мужчина в капюшоне
 * (`person`), в шапке (`personCap`), женщина (`personWoman`); копейщик у ворот (`guard`), лучник на стене (`archer`).
 * На низком — прежние коробки (`*Low`).
 */
export const LIFE_TRIS = {
  person: 144,
  personCap: 128,
  personWoman: 146,
  guard: 164,
  archer: 156,
  personMid: 116,
  personCapMid: 103,
  personWomanMid: 122,
  guardMid: 139,
  archerMid: 131,
  beast: 48,
  bird: 2,
  flag: 44,
  cart: 300,
  duck: 36,
  boat: 108,
  pigeon: 3,
  banner: 64,
  personLow: 36,
  guardLow: 72,
  beastLow: 36,
} as const;

/**
 * Цена горожан по виду в порядке `life.TOWNSFOLK` (капюшон, женщина, шапка) на уровне: прохожий `k` — вида `k % 3`;
 * на «Среднем» — те же фигуры грубее по кругу (`life.figureLod`), на «Низком» — прежняя у всех.
 */
export const townsfolkTris = (q: Quality): readonly number[] =>
  q === 'low'
    ? [LIFE_TRIS.personLow]
    : q === 'medium'
      ? [LIFE_TRIS.personMid, LIFE_TRIS.personWomanMid, LIFE_TRIS.personCapMid]
      : [LIFE_TRIS.person, LIFE_TRIS.personWoman, LIFE_TRIS.personCap];

/** Цена фигур стражи и скота на уровне (`person` — горожанин в капюшоне, строитель): на низком — прежние, без шага. */
export const figureTris = (q: Quality): { person: number; guard: number; archer: number; beast: number } =>
  q === 'low'
    ? { person: LIFE_TRIS.personLow, guard: LIFE_TRIS.guardLow, archer: LIFE_TRIS.guardLow, beast: LIFE_TRIS.beastLow }
    : q === 'medium'
      ? { person: LIFE_TRIS.personMid, guard: LIFE_TRIS.guardMid, archer: LIFE_TRIS.archerMid, beast: LIFE_TRIS.beast }
      : { person: LIFE_TRIS.person, guard: LIFE_TRIS.guard, archer: LIFE_TRIS.archer, beast: LIFE_TRIS.beast };

/** Треугольники `n` горожан на уровне: виды по очереди (`townsfolkTris`). */
export const peopleTris = (q: Quality, n: number): number => {
  const k = townsfolkTris(q);
  let t = 0;
  for (let i = 0; i < n; i++) t += k[i % k.length];
  return t;
};

/** Копейщиков у каждых ворот: по двое с каждой стороны проезда (`life.GATE_POSTS`). */
export const GATE_GUARDS = 4;

/**
 * Вода и берег по уровню (docs/city.md, 12.3). `cols` — колонны ленты реки поперёк, метры от середины: за плоским
 * дном (9 м) они ложатся по кромке строки (`banks.ribbon`), лента доходит до неё, и глубина в вершинах красит
 * мелководье и глубь — чем колонн больше, тем точнее кромка. `step` — шаг мест камыша и камней вдоль реки, метры
 * (гуще — больше куртин); `reeds` и `stones` — камыш у кромки и камни на берегу, самое большее; `reedBlades` — листьев
 * в куртине; `rocks` — камни на склонах мыса (`banks.slopeRocks`, Г-3). Шейдер воды берёт `CITY_SPEC.detail`: 0 — одна рябь, без отблесков огней; 1 — две ряби и отблески огней
 * у воды; 2 — три ряби и искры солнца. На низком всё проще, а река та же.
 */
export const SHORE_CAP: Record<Quality, { cols: readonly number[]; step: number; reeds: number; stones: number; reedBlades: number; rocks: number }> = {
  low: { cols: [-16, -12, -9, 0, 9, 12, 16], step: 1.6, reeds: 240, stones: 70, reedBlades: 5, rocks: 40 },
  medium: { cols: [-16, -13.5, -11.5, -10, -8, -4, 0, 4, 8, 10, 11.5, 13.5, 16], step: 0.8, reeds: 900, stones: 220, reedBlades: 9, rocks: 90 },
  high: { cols: [-16, -13.5, -11.5, -10, -8, -4, 0, 4, 8, 10, 11.5, 13.5, 16], step: 0.55, reeds: 1500, stones: 360, reedBlades: 9, rocks: 200 },
};

/**
 * Треугольников у куртины камыша (листья — по треугольнику, метёлок две, по два треугольника) и у камня
 * (икосаэдр) — счёту бюджета; что числа сходятся с моделями (`shore.ts`), держит тест (`water.test.ts`).
 */
export const shoreTris = (reedBlades: number): { reed: number; stone: number } => ({ reed: reedBlades + 4, stone: 20 });
