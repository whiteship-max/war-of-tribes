// Предпросмотр склада для окна «Склад заполнен» (решение владельца, docs/audit/OWNER-DECISIONS.md, п. 1): перед действием
// игрока, которое приносит добро, интерфейс спрашивает, что из обещанного не влезет, и окно встаёт, только если список не
// пуст. Числа — двери склада (`sim/stock.addStock`): окно не считает своей арифметикой. Живёт отдельно от двери: читает его
// только окно, и в первую загрузку он не едет.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { storageCap } from '../derived';
import { fitStock } from '../stockrules';
import { PROBE, type Gains, type Probe } from './stock';

/** Чего не вместит склад: обещано `wanted`, ляжет `fits` (целыми, как их видит игрок). */
export interface Overflow {
  resource: ResourceId;
  wanted: number;
  fits: number;
}

/** Что из `gains` не вместит склад сейчас. Пусто — влезает всё, и спрашивать игрока не о чем. */
export function overflowOf(s: GameState, gains: Gains, cap: number = storageCap(s)): Overflow[] {
  const out: Overflow[] = [];
  for (const r of RESOURCE_IDS) {
    const wanted = Math.floor(gains[r] ?? 0);
    if (!(wanted > 0)) continue;
    const have = fitStock(s.resources[r] ?? 0, 0, cap);
    const fits = Math.floor(fitStock(have, wanted, cap)) - Math.floor(have);
    if (fits < wanted) out.push({ resource: r, wanted, fits: Math.max(0, fits) });
  }
  return out;
}

/**
 * Что не вместит склад, если сделать `act`: действие идёт сухим прогоном на копии партии, и каждая его прибавка через
 * `addStock` записывается — та же дверь и те же числа, что лягут на деле (вести, возврат отменённого заказа). Партия не
 * меняется. Действие с побочным делом вне партии (поход промысла, приказ серверу) сюда не годится — ему `overflowOf`.
 */
export function overflowOfAct(s: GameState, act: (s: GameState) => unknown): Overflow[] {
  const copy = structuredClone(s);
  const outer = PROBE.on;
  const seen: Probe = (PROBE.on = {});
  try {
    act(copy);
  } finally {
    PROBE.on = outer;
  }
  const out: Overflow[] = [];
  for (const r of RESOURCE_IDS) {
    const p = seen[r];
    if (!p) continue;
    const wanted = Math.floor(p.wanted);
    if (p.fits < wanted) out.push({ resource: r, wanted, fits: Math.max(0, p.fits) });
  }
  return out;
}

/** Вид после числа: «из 500 единиц древесины». */
const OF: Record<ResourceId, string> = {
  wood: 'древесины',
  stone: 'камня',
  food: 'еды',
  hides: 'шкур',
  charcoal: 'угля',
  copper: 'меди',
  iron: 'железа',
};

/** «единицы» после «из 21», «единиц» после «из 5». */
const units = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'единицы' : 'единиц');

/** Строка окна: «из 500 единиц древесины поместится только 120». */
export const overflowLine = (o: Overflow): string => `из ${o.wanted} ${units(o.wanted)} ${OF[o.resource]} поместится только ${o.fits}`;

/**
 * Слова окна после «Склад заполнен: » — «из 500 единиц древесины поместится только 120, остальное пропадёт. Продолжить?»
 * (решение владельца, OWNER-DECISIONS, п. 1); видов несколько — через запятую.
 */
export const roomText = (over: readonly Overflow[]): string => `${over.map(overflowLine).join(', ')}, остальное пропадёт. Продолжить?`;
