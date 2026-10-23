// Рынок: за что и почём. Всё, что рынок меняет в балансе, лежит здесь —
// логика (derived.ts, sim/market.ts) только читает эту таблицу.
//
// Главное правило: покупать заметно дороже, чем производить самому. Рынок —
// способ быстро закрыть дыру, а не замена лесопилке и кузнице. Держится оно на
// трёх ограничителях сразу, и каждый из них проверяется тестом:
//
//   1. Цена. Основа — самая дешёвая цена любого привоза — всегда выше того, во что
//      единица обходится своим трудом (`MIN_MARKUP`, см. derived.selfCost). Ни уровень
//      рынка, ни привоз, ни чужие продажи её ниже этой черты не опускают.
//   2. Запас привоза. Привоз приходит четыре раза в сутки по настоящим часам и несёт
//      запас дня за все игровые дни привоза (`marketrules.depthOf`): за сутки — столько
//      же, сколько давал прежний дневной прилавок.
//   3. Нажим. Каждая следующая купленная штука дороже предыдущей: к концу запаса привоза
//      цена вдвое выше основы (`marketrules.buyUnit`); нажим отходит сам за часы.
//
// Цены и запасы — здесь, правила торга (привоз, нажим, продажа) — в `marketrules.ts`.
//
// Еда — самый дорогой товар и с самым жёстким запасом: зима должна оставаться
// угрозой, а не строкой расходов.
import type { EquipmentId, GoodId, ResourceId } from '../types';
import { RESOURCE_META } from '../constants';
import { realSec } from '../pace';
import { seeded } from '../sim/random';
import { EQUIPMENT, EQUIPMENT_BY_ID } from './equipment';

/** Ключ товара-снаряжения: со своим префиксом, чтобы не путался с ресурсом. */
export const eqGood = (id: EquipmentId): GoodId => `eq:${id}`;

export interface GoodDef {
  id: GoodId;
  kind: 'resource' | 'equipment' | 'bonded';
  /** Ресурс или предмет, который приедет на склад. */
  resource?: ResourceId;
  equipment?: EquipmentId;
  name: string;
  /** Основа: цена в золоте за единицу в самый дешёвый привоз без нажима (`marketrules.buyUnit`). */
  price: number;
  /** Запас на игровой день на первом уровне рынка и прибавка за каждый следующий. */
  stock: number;
  stockPerLevel: number;
  /** Всегда в ассортименте: без еды рынок перестал бы быть спасением от голода. */
  always?: boolean;
}

/**
 * Цены в золоте. Ориентир — дневной налог города на потолке уровней при высоком
 * налоге (`TAX_PER_POP`, `data/policy.ts`; население — `npm run pop:report`):
 * дневной прилавок еды стоит ему нескольких дней казны, а доспех — заметной доли
 * дня. Дёшево здесь не бывает ничего.
 *
 * Запас растёт вместе с посёлком: он тоже поднят на порядок, иначе рынок при
 * сотнях едоков стал бы декорацией. Но еда так и не закрывает зимний
 * расход ни при каком уровне — это правило, и его держит тест.
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
  { id: 'food', price: 10, stock: 60, stockPerLevel: 13, always: true },
  { id: 'wood', price: 3, stock: 200, stockPerLevel: 80 },
  { id: 'stone', price: 3, stock: 160, stockPerLevel: 64 },
  { id: 'charcoal', price: 4, stock: 64, stockPerLevel: 24 },
  { id: 'hides', price: 6, stock: 64, stockPerLevel: 24 },
  { id: 'copper', price: 9, stock: 40, stockPerLevel: 16 },
  { id: 'iron', price: 14, stock: 32, stockPerLevel: 16 },
];

/**
 * Готовое снаряжение. Стоит заметно дороже своих материалов: за клинок платят
 * не только железом, но и чужой работой — иначе кузница была бы не нужна.
 */
const EQUIPMENT_GOODS: Record<EquipmentId, { price: number; stock: number; stockPerLevel: number }> = {
  spear: { price: 40, stock: 10, stockPerLevel: 5 },
  bow: { price: 55, stock: 10, stockPerLevel: 5 },
  axe: { price: 70, stock: 6, stockPerLevel: 5 },
  shield: { price: 80, stock: 10, stockPerLevel: 5 },
  sword: { price: 220, stock: 5, stockPerLevel: 4 },
  armor: { price: 300, stock: 4, stockPerLevel: 3 },
};

export const GOODS: GoodDef[] = [
  ...RESOURCE_GOODS.map(
    (g): GoodDef => ({
      id: g.id,
      kind: 'resource',
      resource: g.id,
      name: RESOURCE_META[g.id].name,
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
      price: g.price,
      stock: g.stock,
      stockPerLevel: g.stockPerLevel,
    };
  }),
];

/**
 * Невольники. Ряд на рынке стоит всегда и места в круговороте товаров не
 * занимает (`derived.marketOffer`): продать их — рычаг против мятежа, а рычаг,
 * который есть через день, рычагом не является. В общем списке `GOODS` его нет
 * нарочно — там прилавок, который тасуется по дням.
 *
 * Цена за человека. Заказ идёт тем же караваном, что и любой товар: золото
 * списано сразу, людей в посёлке нет, пока торговцы не дойдут. Тем же запасом
 * привоза и тем же нажимом — второй лавки под невольников нет (РН-1).
 *
 * Числа меряные (`npm run order:report`, раздел «цена»): по мерке самой игры —
 * налогу с человека — невольник окупается не быстрее, чем за `BONDED_PAYBACK_DAYS`.
 */
export const BONDED_GOOD: GoodDef = {
  id: 'bonded',
  kind: 'bonded',
  name: 'Невольники',
  price: 30,
  stock: 6,
  stockPerLevel: 2,
};

/**
 * Быстрее скольких игровых дней невольник не окупается своей работой ни на каком
 * месте — даже в самом выгодном положении: десятый уровень, мораль сто, строгий
 * указ и лучший сезон. Мерка — та, которой рынок меряет всё остальное: добро по
 * цене своего труда (`derived.selfCost`), минус порция еды. Игровой день —
 * реальная минута. Держит это тест; в обычном положении срок заметно длиннее
 * (`npm run order:report`, раздел «цена»).
 */
export const BONDED_PAYBACK_DAYS = 15;

export const GOOD_BY_ID: Record<string, GoodDef> = Object.fromEntries(
  [...GOODS, BONDED_GOOD].map((g) => [g.id, g]),
);

/** Наценка рынка над собственным трудом: ниже неё цена не опускается никогда. */
export const MIN_MARKUP = 1.5;

/** Товаров на прилавке: сколько на первом уровне и сколько добавляет каждый следующий. */
export const OFFER_BASE = 3;
export const OFFER_PER_LEVEL = 1;

/**
 * Дорога каравана в секундах игрового времени: базовая и выигрыш за уровень рынка.
 * Даже на десятом уровне телега идёт заметные секунды (`derived.caravanSeconds`) —
 * мгновенных покупок
 * в игре нет, и в этот срок дыру ещё нужно продержать.
 */
export const CARAVAN_BASE = realSec(42);
export const CARAVAN_PER_LEVEL = realSec(2.5);
/** Быстрее этого телега не ходит ни при каком рынке, настоящих секунд. */
export const CARAVAN_FLOOR = realSec(12);

/** Запас товара на игровой день при этом уровне рынка — мера привоза (`marketrules.depthOf`). Штуки целые. */
export const goodStock = (def: GoodDef, level: number): number =>
  Math.floor(def.stock + def.stockPerLevel * Math.max(0, level - 1));

/** Материалы, из которых предмет куют сами: по ним считается наценка на готовое. */
export const goodMaterials = (def: GoodDef): Partial<Record<ResourceId, number>> =>
  def.equipment ? EQUIPMENT_BY_ID[def.equipment].cost : {};

/** Сколько товаров привозят при этом уровне рынка (без невольничьего ряда). */
export const offerSlots = (level: number): number => (level <= 0 ? 0 : Math.min(GOODS.length, OFFER_BASE + OFFER_PER_LEVEL * (level - 1)));

/**
 * Что привезли. Ассортимент нигде не хранится: он выводится из номера привоза (`marketrules.shiftOf`), поэтому
 * перезагрузка не тасует товары заново, а сервер получает тот же список из того же числа. Обязательные товары (еда) стоят
 * всегда, остальные тянутся из перемешанного по номеру списка, пока не кончатся места.
 */
export function offerFor(day: number, level: number, available: GoodDef[]): GoodDef[] {
  if (level <= 0 || available.length === 0) return [];
  const slots = Math.min(available.length, offerSlots(level));
  const picked = new Set<GoodId>();
  for (const g of available) {
    if (g.always && picked.size < slots) picked.add(g.id);
  }
  const rest = available.filter((g) => !picked.has(g.id));
  // Перемешивание Фишера — Йетса с генератором от номера привоза: одно и то же число
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
