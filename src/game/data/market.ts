// Рынок: за что и почём. Всё, что рынок меняет в балансе, лежит здесь —
// логика (derived.ts, sim/market.ts) только читает эту таблицу.
//
// Главное правило: покупать заметно дороже, чем производить самому. Рынок —
// способ быстро закрыть дыру, а не замена лесопилке и кузнице. Держится оно на
// трёх ограничителях сразу, и каждый из них проверяется тестом:
//
//   1. Цена. Она всегда выше того, во что единица обходится своим трудом
//      (`MIN_MARKUP`, см. derived.selfCost). Ни уровень рынка, ни день недели
//      цену ниже этой черты не опускают: уровень добавляет запас, а не скидку.
//   2. Дневной запас. За игровой день с прилавка уходит не больше `stock`
//      единиц — дробить покупку бессмысленно, счётчик один на день.
//   3. Рост цены. Каждая следующая единица того же товара за день дороже
//      предыдущей: к концу дневного запаса цена удваивается (`PRICE_RAMP`).
//
// Еда — самый дорогой товар и с самым жёстким запасом: зима должна оставаться
// угрозой, а не строкой расходов.
import type { EquipmentId, GoodId, ResourceId, TechId } from '../types';
import { RESOURCE_META } from '../constants';
import { seeded } from '../sim/random';
import { EQUIPMENT, EQUIPMENT_BY_ID } from './equipment';

/** Ключ товара-снаряжения: со своим префиксом, чтобы не путался с ресурсом. */
export const eqGood = (id: EquipmentId): GoodId => `eq:${id}`;

export interface GoodDef {
  id: GoodId;
  kind: 'resource' | 'equipment';
  /** Ресурс или предмет, который приедет на склад. */
  resource?: ResourceId;
  equipment?: EquipmentId;
  name: string;
  icon: string;
  /** Цена в золоте за единицу, пока сегодня ничего не куплено. */
  price: number;
  /** Дневной запас на первом уровне рынка и прибавка за каждый следующий. */
  stock: number;
  stockPerLevel: number;
  /** Без этой технологии товара на прилавке не бывает. */
  requiresTech?: TechId;
  /** Всегда в ассортименте: без еды рынок перестал бы быть спасением от голода. */
  always?: boolean;
}

/**
 * Цены в золоте. Ориентир: город при высоком налоге собирает около 35 золота
 * в день, то есть дневной прилавок еды стоит ему нескольких дней казны, а меч —
 * четырёх. Дёшево здесь не бывает ничего.
 */
const RESOURCE_GOODS: {
  id: ResourceId;
  price: number;
  stock: number;
  stockPerLevel: number;
  always?: boolean;
}[] = [
  // Еда — самый дорогой товар и с самым жёстким запасом: даже рынок десятого
  // уровня не закрывает зимний расход, и зима остаётся угрозой (это проверяет тест).
  { id: 'food', price: 10, stock: 8, stockPerLevel: 1.6, always: true },
  { id: 'wood', price: 3, stock: 25, stockPerLevel: 10 },
  { id: 'stone', price: 3, stock: 20, stockPerLevel: 8 },
  { id: 'bones', price: 4, stock: 8, stockPerLevel: 3 },
  { id: 'hides', price: 6, stock: 8, stockPerLevel: 3 },
  { id: 'copper', price: 9, stock: 5, stockPerLevel: 2 },
  { id: 'iron', price: 14, stock: 4, stockPerLevel: 2 },
];

/**
 * Готовое снаряжение. Стоит заметно дороже своих материалов: за клинок платят
 * не только железом, но и чужой работой — иначе кузница была бы не нужна.
 */
const EQUIPMENT_GOODS: Record<EquipmentId, { price: number; stock: number; stockPerLevel: number }> = {
  spear: { price: 40, stock: 2, stockPerLevel: 1 },
  bow: { price: 55, stock: 2, stockPerLevel: 1 },
  axe: { price: 70, stock: 1, stockPerLevel: 1 },
  shield: { price: 80, stock: 2, stockPerLevel: 1 },
  sword: { price: 220, stock: 1, stockPerLevel: 1 },
  armor: { price: 300, stock: 1, stockPerLevel: 1 },
};

export const GOODS: GoodDef[] = [
  ...RESOURCE_GOODS.map(
    (g): GoodDef => ({
      id: g.id,
      kind: 'resource',
      resource: g.id,
      name: RESOURCE_META[g.id].name,
      icon: RESOURCE_META[g.id].icon,
      price: g.price,
      stock: g.stock,
      stockPerLevel: g.stockPerLevel,
      always: g.always,
    }),
  ),
  ...EQUIPMENT.map((e): GoodDef => {
    const g = EQUIPMENT_GOODS[e.id];
    return {
      id: eqGood(e.id),
      kind: 'equipment',
      equipment: e.id,
      name: e.name,
      icon: e.icon,
      price: g.price,
      stock: g.stock,
      stockPerLevel: g.stockPerLevel,
      requiresTech: e.requiresTech,
    };
  }),
];

export const GOOD_BY_ID: Record<string, GoodDef> = Object.fromEntries(GOODS.map((g) => [g.id, g]));

/** Наценка рынка над собственным трудом: ниже неё цена не опускается никогда. */
export const MIN_MARKUP = 1.5;

/**
 * Насколько дорожает товар к моменту, когда выбран весь дневной запас.
 * 1 — цена ровно удваивается. Считается по каждой единице отдельно, поэтому
 * десять покупок по одной стоят ровно столько же, сколько одна на десять.
 */
export const PRICE_RAMP = 1;

/** Товаров на прилавке: сколько на первом уровне и сколько добавляет каждый следующий. */
export const OFFER_BASE = 3;
export const OFFER_PER_LEVEL = 1;

/**
 * Дорога каравана в секундах игрового времени: базовая и выигрыш за уровень рынка.
 * Даже на десятом уровне телега идёт полтора десятка секунд — мгновенных покупок
 * в игре нет, и в этот срок дыру ещё нужно продержать.
 */
export const CARAVAN_BASE = 42;
export const CARAVAN_PER_LEVEL = 2.5;

/** Дневной запас товара при этом уровне рынка. Штуки целые: половину копья не купишь. */
export const goodStock = (def: GoodDef, level: number): number =>
  Math.floor(def.stock + def.stockPerLevel * Math.max(0, level - 1));

/**
 * Цена следующей единицы, когда за сегодня уже куплено `bought`.
 * Округление вверх: цена никогда не падает ниже базовой.
 */
export function goodPrice(def: GoodDef, level: number, bought: number): number {
  const limit = Math.max(1, goodStock(def, level));
  const ramp = 1 + PRICE_RAMP * Math.min(1, Math.max(0, bought) / limit);
  return Math.ceil(def.price * ramp);
}

/**
 * Сколько золота стоит взять ещё `count` единиц. Считается поштучно, поэтому
 * дробление покупки не даёт ни копейки выгоды — как и обход дневного лимита.
 */
export function batchCost(def: GoodDef, level: number, bought: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += goodPrice(def, level, bought + i);
  return sum;
}

/** Материалы, из которых предмет куют сами: по ним считается наценка на готовое. */
export const goodMaterials = (def: GoodDef): Partial<Record<ResourceId, number>> =>
  def.equipment ? EQUIPMENT_BY_ID[def.equipment].cost : {};

/**
 * Прилавок этого дня. Ассортимент нигде не хранится: он выводится из номера дня,
 * поэтому перезагрузка не тасует товары заново, а сервер потом получит тот же
 * список из того же числа. Обязательные товары (еда) стоят всегда, остальные
 * тянутся из перемешанного по дню списка, пока не кончатся места.
 */
export function offerFor(day: number, level: number, available: GoodDef[]): GoodDef[] {
  if (level <= 0 || available.length === 0) return [];
  const slots = Math.min(available.length, OFFER_BASE + OFFER_PER_LEVEL * (level - 1));
  const picked = new Set<GoodId>();
  for (const g of available) {
    if (g.always && picked.size < slots) picked.add(g.id);
  }
  const rest = available.filter((g) => !picked.has(g.id));
  // Перемешивание Фишера — Йетса с генератором от номера дня: одно и то же число
  // всегда даёт один и тот же прилавок.
  const rng = seeded(day * 2654435761 + 12345);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  for (const g of rest) {
    if (picked.size >= slots) break;
    picked.add(g.id);
  }
  // Показываем в порядке таблицы: прилавок не должен прыгать строками.
  return available.filter((g) => picked.has(g.id));
}
