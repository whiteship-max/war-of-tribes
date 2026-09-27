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
import type { BattleLand, BattlePlace } from '@/game/battle/ground';
import { FEATURE, featuresAt, terrainAt } from './geography';

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
