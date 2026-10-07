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
 * (`alive.ts`: телеги с волами, утки, лодки, стяги; фонари ночных прохожих) на низком выключено: низкий — для слабых
 * телефонов, ему хватает прежнего.
 */
export const LIFE_CAP: Record<Quality, { people: number; guards: number; birds: number; animals: number; smoke: number; lanterns: number; carts: number; ducks: number; boats: number; banners: number }> = {
  low: { people: 70, guards: 10, birds: 12, animals: 8, smoke: 40, lanterns: 0, carts: 0, ducks: 0, boats: 0, banners: 0 },
  medium: { people: 160, guards: 18, birds: 28, animals: 14, smoke: 90, lanterns: 24, carts: 4, ducks: 12, boats: 2, banners: 1 },
  high: { people: 260, guards: 26, birds: 44, animals: 18, smoke: 160, lanterns: 40, carts: 8, ducks: 20, boats: 3, banners: 1 },
};

/**
 * Треугольников у фигуры жизни — счёту бюджета (`budget.cityCounts`); сами фигуры строят `life.ts` и `alive.ts`, а что
 * числа с ними сходятся, держит тест (`life.test.ts`). Ноги — две коробки: шаг качает их в шейдере.
 */
export const LIFE_TRIS = { person: 48, guard: 84, beast: 48, bird: 2, flag: 44, cart: 300, duck: 36, boat: 108, banner: 64 } as const;

/**
 * Вода и берег по уровню (docs/city.md, 12.3). `cols` — колонны ленты реки поперёк, метры от середины: за плоским
 * дном (9 м) они ложатся по кромке строки (`banks.ribbon`), лента доходит до неё, и глубина в вершинах красит
 * мелководье и глубь — чем колонн больше, тем точнее кромка. `step` — шаг мест камыша и камней вдоль реки, метры
 * (гуще — больше куртин); `reeds` и `stones` — камыш у кромки и камни на берегу, самое большее; `reedBlades` — листьев
 * в куртине. Шейдер воды берёт `CITY_SPEC.detail`: 0 — одна рябь, без отблесков огней; 1 — две ряби и отблески огней
 * у воды; 2 — три ряби и искры солнца. На низком всё проще, а река та же.
 */
export const SHORE_CAP: Record<Quality, { cols: readonly number[]; step: number; reeds: number; stones: number; reedBlades: number }> = {
  low: { cols: [-16, -12, -9, 0, 9, 12, 16], step: 1.6, reeds: 240, stones: 70, reedBlades: 5 },
  medium: { cols: [-16, -13.5, -11.5, -10, -8, -4, 0, 4, 8, 10, 11.5, 13.5, 16], step: 0.8, reeds: 900, stones: 220, reedBlades: 9 },
  high: { cols: [-16, -13.5, -11.5, -10, -8, -4, 0, 4, 8, 10, 11.5, 13.5, 16], step: 0.55, reeds: 1500, stones: 360, reedBlades: 9 },
};

/**
 * Треугольников у куртины камыша (листья — по треугольнику, метёлок две, по два треугольника) и у камня
 * (икосаэдр) — счёту бюджета; что числа сходятся с моделями (`shore.ts`), держит тест (`water.test.ts`).
 */
export const shoreTris = (reedBlades: number): { reed: number; stone: number } => ({ reed: reedBlades + 4, stone: 20 });
