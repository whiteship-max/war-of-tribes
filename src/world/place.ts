// Что за место эта клетка — глазами ролика о бое.
//
// География мира знает реки, броды, хребты и тракты битами `FEATURE`; ролику
// нужно другое: что под ногами, что рядом и есть ли через поле переправа.
// Перевод живёт здесь, а результат уезжает в запись боя (`BattleRecord.place`),
// потому что показ не имеет права дочитывать мир (см. `game/battle/ground.ts`).
//
// Смотрим не только саму клетку: поселения ставятся только на `buildable`
// земле, то есть ни в русле, ни на хребте. Если бы место боя читалось из одной
// клетки, брода и гребня в ролике не было бы никогда — а стоит поселение как
// раз у брода и под гребнем.
import type { GroundPenalty } from '@/battle';
import type { BattleLand, BattlePlace } from '@/game/battle/ground';
import { FEATURE, featuresAt, terrainAt } from './geography';
import type { Coord, Terrain } from './types';

/**
 * Докуда смотреть вокруг клетки. Одна клетка — это поле боя целиком, соседняя —
 * то, что видно с него до горизонта. Дальше уже другая местность.
 */
export const PLACE_REACH = 1;

/** Клетки поля боя: сама и её соседи. */
function around(x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = -PLACE_REACH; dy <= PLACE_REACH; dy++) {
    for (let dx = -PLACE_REACH; dx <= PLACE_REACH; dx++) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

/**
 * Место боя на клетке. Чистая функция от сида и координат: тот же мир — то же
 * поле, и сервер повторит его тем же вызовом.
 *
 * `time` — игровое время племени: из него ролик выведет и час, и время года.
 * Мира это не касается, он его только переносит.
 */
export function placeAt(seed: number, x: number, y: number, time?: number): BattlePlace {
  const cells = around(x, y);
  let bits = 0;
  let forest = 0;
  let hills = 0;
  let water = 0;
  for (const c of cells) {
    bits |= featuresAt(seed, c.x, c.y);
    const t = terrainAt(seed, c.x, c.y);
    if (t === 'forest') forest++;
    else if (t === 'hills' || t === 'mountains') hills++;
    else if (t === 'water') water++;
  }
  const own = terrainAt(seed, x, y);
  // Берег важнее холмов: вода у края поля видна с любого плана, а бугор — нет.
  const land: BattleLand = water > 0 ? 'shore' : own === 'hills' || own === 'mountains' || hills >= 3 ? 'hills' : 'plain';
  const place: BattlePlace = { land };
  if (bits & FEATURE.river) place.river = true;
  // Мост — это тоже переправа: в ролике она читается отмелью, потому что мостов
  // сцена не строит. Строить их сюда не надо — это следующее решение, не побочное.
  if (bits & (FEATURE.ford | FEATURE.bridge)) place.ford = true;
  if (bits & FEATURE.ridge) place.ridge = true;
  if (bits & FEATURE.road) place.road = true;
  // Лес по краю — когда его вокруг заметно, а не когда попалось одно дерево.
  if (own === 'forest' || forest >= 3) place.woods = true;
  if (time !== undefined) place.time = time;
  return place;
}

// ---------- Штраф кости нападающему ----------
//
// Таблица EU4 буквально (docs/battle_eu4.md, 14.14; ответ владельца 5): пересечённая земля −1, горы −2,
// переправа −1, штрафы складываются. Числа — граней кости, и все они из таблицы, а не подобраны. Земля
// штрафует по клетке боя; переправа — если нападающий вышел на клетку боя через русло (реку, брод или
// мост) или бьётся на клетке воды (14.19.2). Смотрим ровно то поле, которое пишется в запись боя
// (`placeAt`, `PLACE_REACH`): клетку боя и соседнюю, с которой на неё вышли, — поэтому переправа в штрафе
// бывает только там, где ролик показывает реку.

/** Земля клетки боя: граней кости нападающему. Лес и холмы (нагорье) — пересечённая, горы — горы. */
export const GROUND_LAND: Record<Terrain, number> = { plain: 0, steppe: 0, desert: 0, forest: 1, hills: 1, mountains: 2, water: 0 };
/** Хребет и перевал — сердцевина гор: земля под ними — горы (14.14). */
export const GROUND_RIDGE = GROUND_LAND.mountains;
/** Переправа — река, брод, мост; клетка воды — тоже переправа (14.19.2). */
export const GROUND_CROSSING = 1;

/** Соседняя клетка поля боя, с которой на него вышел идущий из `from`. Пришёл с той же клетки — нет такой. */
export function stepFrom(cell: Coord, from: Coord): Coord | null {
  const dx = from.x - cell.x;
  const dy = from.y - cell.y;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m === 0) return null;
  return { x: cell.x + Math.round(dx / m), y: cell.y + Math.round(dy / m) };
}

/**
 * Штраф кости нападающему на клетке `cell`, если он пришёл из `from` (нет — с той же клетки: вылазка). Чистая
 * функция от сида и координат, как и место боя; кладёт его мир только нападающему (`world/battle.resolveField`).
 */
export function groundAt(seed: number, cell: Coord, from?: Coord): GroundPenalty {
  const terrain = terrainAt(seed, cell.x, cell.y);
  const bits = featuresAt(seed, cell.x, cell.y);
  let land = GROUND_LAND[terrain];
  if (bits & (FEATURE.ridge | FEATURE.pass)) land = Math.max(land, GROUND_RIDGE);
  const step = from ? stepFrom(cell, from) : null;
  const river = (bits & FEATURE.river) !== 0 || (step !== null && (featuresAt(seed, step.x, step.y) & FEATURE.river) !== 0);
  const crossing = terrain === 'water' || river ? GROUND_CROSSING : 0;
  const out: GroundPenalty = {};
  if (land > 0) out.land = land;
  if (crossing > 0) out.crossing = crossing;
  return out;
}
