// Проекция мира: клетка ↔ долгота/широта.
//
// Игре она не нужна — та живёт в клетках, — но нужна нам: без неё «сколько идёт
// разведчик от Парижа до Лондона» не посчитать, а это и есть единственная
// проверка масштаба. Отчёт `npm run world:report` считает по ней всё, что
// написано в километрах.
//
// Коническая равноугольная Ламберта: она держит форму берега и не растягивает
// север. Числа проекции приезжают из атласа (`data.ts`), а не пишутся здесь
// второй раз, — иначе картинка и расчёт разошлись бы при первой же пересборке.
import { ATLAS_FRAME, ATLAS_PROJ, ATLAS_SIZE } from './data';

/** Радиус Земли, км. Тот же, каким считал скрипт запекания. */
const R = 6371.0088;
const rad = (d: number): number => (d * Math.PI) / 180;
const tan45 = (f: number): number => Math.tan(Math.PI / 4 + f / 2);

const F1 = rad(ATLAS_PROJ.sp1);
const F2 = rad(ATLAS_PROJ.sp2);
const N = Math.log(Math.cos(F1) / Math.cos(F2)) / Math.log(tan45(F2) / tan45(F1));
const BIG_F = (Math.cos(F1) * Math.pow(tan45(F1), N)) / N;
const rho = (latDeg: number): number => (R * BIG_F) / Math.pow(tan45(rad(latDeg)), N);
const RHO0 = rho(ATLAS_PROJ.lat0);

/** Километров в клетке по номиналу рамки. */
export const KM_PER_CELL = (ATLAS_FRAME.x1 - ATLAS_FRAME.x0) / ATLAS_SIZE;

/** Долгота и широта → клетка атласа (дробная, начало в левом верхнем углу). */
export function cellOf(lon: number, lat: number): { col: number; row: number } {
  const r = rho(lat);
  const th = N * rad(lon - ATLAS_PROJ.lon0);
  const x = r * Math.sin(th);
  const y = RHO0 - r * Math.cos(th);
  return { col: (x - ATLAS_FRAME.x0) / KM_PER_CELL, row: (ATLAS_FRAME.y1 - y) / KM_PER_CELL };
}

/** Клетка атласа → долгота и широта её середины. */
export function lonLatOf(col: number, row: number): { lon: number; lat: number } {
  const x = ATLAS_FRAME.x0 + (col + 0.5) * KM_PER_CELL;
  const y = ATLAS_FRAME.y1 - (row + 0.5) * KM_PER_CELL;
  const yy = RHO0 - y;
  const r = Math.sign(N) * Math.hypot(x, yy);
  const th = Math.atan2(x, yy);
  const lat = 2 * Math.atan(Math.pow((R * BIG_F) / r, 1 / N)) - Math.PI / 2;
  return { lon: ATLAS_PROJ.lon0 + ((th / N) * 180) / Math.PI, lat: (lat * 180) / Math.PI };
}

/**
 * Масштаб длин в широте: 1 — без искажения. Отсюда честная цена клетки в
 * километрах: `KM_PER_CELL / scaleAt(lat)`.
 */
export const scaleAt = (lat: number): number => (N * rho(lat)) / (R * Math.cos(rad(lat)));

/** Сколько километров в клетке в этой широте на самом деле. */
export const kmAt = (lat: number): number => KM_PER_CELL / scaleAt(lat);
