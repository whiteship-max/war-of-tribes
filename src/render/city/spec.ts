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

