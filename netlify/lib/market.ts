/**
 * Книга рынка (РН-1, docs/city_v3.md, «Решения РН-1»; правило «market»): сервер выводит цену каждой новой сделки той же
 * формулой, что игра (`src/game/marketrules.ts`), и сверяет её с описью. Цепочка — от прежней описи: нажим каждого товара
 * отходит к сделке (`pressAt`), сделка двигает его на свои штуки; счёт привоза сбрасывается на новом привозе.
 *
 *  · Покупка — не дешевле правила, не больше привоза (запас и проданное торговцам), только привезённое; продажа — не дороже
 *    правила при прибавке подтверждённых Казначея и купечества, не больше кошеля купцов (невольники — не больше привоза).
 *  · Продано не больше, чем могло быть у игрока: запас прежней описи, выработка за промежуток и купленное.
 *  · Номер сделки не убывает, одна сделка под одним номером: два устройства с одной партией дали бы две разные сделки под
 *    одним номером — это флаг (двойная сделка), а встреча копий (`net/sync.decide`) вторую запись не примет.
 *
 * Уровень рынка — закреплённый на привоз (`WatchMarket.lv`, РН-1б), не выше рынка описей; без закрепления — щедрейший из двух
 * описей, чтобы стройка между записями не делала честного подделкой. Стабильность — описи (её сверяет правило «stab»).
 * Чистая: без хранилища и без часов.
 */
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { STOCK_KEYS, type Counts, type WatchCard, type WatchDeal } from './contract.js';
import { gameDaysOfMs } from '../../src/game/pace.js';
import { BONDED_GOOD } from '../../src/game/data/market.js';
import { depthOf, fromPurse, goodOf, lotOf, pressAt, purseOf, shiftOf, shiftOffer, supplyOf } from '../../src/game/marketrules.js';

export interface MarketCtx {
  /** Наибольшая прибавка к выручке: подтверждённый Казначей и купечество в силе (`watch.marketBoost`). */
  boost: number;
  /** Выработка в игровой день сверху — для «продано не больше, чем было» (`watch.prodOf`). */
  prod: Counts;
  /** Во сколько раз выработка может обогнать потолок (`watch.GROWTH_SLACK`). */
  slack: number;
}

const levelOf = (c: WatchCard): number => Math.max(0, Math.floor(c.buildings.market ?? 0));
const near = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
const big = (n: number): string => Math.round(n).toLocaleString('ru-RU');
const sameDeal = (x: WatchDeal, y: WatchDeal): boolean => x.at === y.at && x.good === y.good && x.n === y.n && x.gold === y.gold && near(x.q, y.q);

/** Нарушения книги рынка между двумя описями: строки флага «market». Первая опись с рынком — основа, без проверки. */
export function marketFaults(a: WatchCard, aAt: number, b: WatchCard, bAt: number, ctx: MarketCtx): string[] {
  const A = a.market;
  const B = b.market;
  if (!A || !B) return [];
  const out: string[] = [];
  if (B.seq < A.seq) out.push(`Счёт сделок убыл: №${big(A.seq)} → №${big(B.seq)} (другое устройство, восстановленная копия или правка).`);
  // Одна сделка под одним номером: та же сделка в обеих описях должна совпасть.
  const old = new Map(A.deals.map((d) => [d.seq, d]));
  for (const d of B.deals) {
    const x = old.get(d.seq);
    if (x && !sameDeal(x, d)) out.push(`Сделка №${big(d.seq)} записана дважды по-разному — двойная сделка с двух устройств или правка.`);
  }
  const fresh = B.deals.filter((d) => d.seq > A.seq).sort((x, y) => x.seq - y.seq);
  // Новая сделка под номером, который в той же описи уже занят другой, — двойная сделка с двух устройств (AC-5): прежде
  // её не видел никто — прежняя опись этого номера ещё не знала.
  const bySeq = new Map<number, (typeof fresh)[number]>();
  for (const d of fresh) {
    const x = bySeq.get(d.seq);
    if (x && !sameDeal(x, d)) out.push(`Сделка №${big(d.seq)} записана дважды по-разному — двойная сделка с двух устройств или правка.`);
    if (!x) bySeq.set(d.seq, d);
  }
  const want = Math.max(0, B.seq - A.seq);
  if (fresh.length < want) out.push(`Сделок между описями ${big(want)}, в описи — ${big(fresh.length)}: часть не дошла до сверки.`);
  // Цепочка номеров сверяется и при лишних сделках (AC-5), а не только когда их ровно столько, сколько номеров.
  fresh.forEach((d, i) => {
    if (fresh.length >= want && d.seq !== A.seq + i + 1) out.push(`Номера сделок идут с разрывом: №${big(d.seq)} на месте №${big(A.seq + i + 1)}.`);
  });

  const levels = [...new Set([levelOf(a), levelOf(b)])].filter((l) => l > 0);
  // Уровень, закреплённый на привоз (РН-1б): не выше рынка описей и прежнего закрепления того же привоза.
  const pinCeil = Math.max(levelOf(a), levelOf(b), A.w === B.w ? A.lv ?? 0 : 0);
  if ((B.lv ?? 0) > pinCeil) out.push(`Уровень привоза ${B.lv} выше рынка описей (${pinCeil}).`);
  const pinned = (w: number): number[] => {
    const lv = B.w === w ? B.lv : A.w === w ? A.lv : undefined;
    return lv && lv > 0 && lv <= pinCeil ? [lv] : levels;
  };
  const stabs = [...new Set([a.stab?.level ?? 0, b.stab?.level ?? 0])];
  const latest = bAt + Math.max(0, b.lead) + CLOCK_SKEW_SECONDS * 1000;
  const press: Record<string, [number, number]> = { ...A.press };
  let w = A.w;
  let bought: Counts = { ...A.bought };
  let sold: Counts = { ...A.sold };
  let got = A.got;
  let lastAt = A.deals.length ? A.deals[A.deals.length - 1].at : 0;
  const soldSum: Counts = {};
  const boughtSum: Counts = {};

  for (const d of fresh) {
    const def = goodOf(d.good);
    const tag = `сделка №${big(d.seq)}`;
    if (!def) {
      out.push(`${tag}: товара «${d.good}» нет.`);
      continue;
    }
    if (levels.length === 0) {
      out.push(`${tag}: рынка в описях нет.`);
      continue;
    }
    if (d.at > latest) out.push(`${tag}: минута сделки впереди часов сервера.`);
    if (d.at < lastAt) out.push(`${tag}: минута сделки раньше прежней.`);
    lastAt = Math.max(lastAt, d.at);
    const dw = shiftOf(d.at);
    if (dw !== w) {
      w = dw;
      bought = {};
      sold = {};
      got = 0;
    }
    const p = press[d.good];
    const q0 = p ? pressAt(p[0], p[1], d.at) : 0;
    if (!near(q0, d.q)) out.push(`${tag}: нажим ${d.q.toFixed(2)}, а по правилу — ${q0.toFixed(2)}.`);
    const at = pinned(dw);
    const lots = at.map((l) => lotOf(def, dw, depthOf(def, l), q0, d.n, ctx.boost).gold);
    const supply = Math.max(...at.flatMap((l) => stabs.map((st) => (shiftOffer(dw, l).includes(def.id) ? supplyOf(def, l, dw, st) : 0))));
    const n = Math.abs(d.n);
    if (d.n > 0) {
      const rule = Math.min(...lots);
      if (d.gold < rule) out.push(`${tag}: ${def.name.toLowerCase()} ${big(n)} куплено за ${big(d.gold)} — по правилу привоза не меньше ${big(rule)}.`);
      bought[d.good] = (bought[d.good] ?? 0) + n;
      boughtSum[d.good] = (boughtSum[d.good] ?? 0) + n;
      if (bought[d.good] > supply + (sold[d.good] ?? 0)) {
        out.push(`${tag}: куплено ${big(bought[d.good])} ${def.name.toLowerCase()} за привоз — привезли не больше ${big(supply)}, продано торговцам ${big(sold[d.good] ?? 0)}.`);
      }
    } else if (d.n < 0) {
      const rule = Math.max(...lots);
      if (d.gold > rule) out.push(`${tag}: ${def.name.toLowerCase()} ${big(n)} продано за ${big(d.gold)} — по правилу привоза не больше ${big(rule)}.`);
      sold[d.good] = (sold[d.good] ?? 0) + n;
      soldSum[d.good] = (soldSum[d.good] ?? 0) + n;
      if (fromPurse(d.good)) {
        got += d.gold;
        const purse = Math.max(...at.map((l) => purseOf(l)));
        if (got > purse) out.push(`${tag}: купцы отдали за привоз ${big(got)} — кошель привоза ${big(purse)}.`);
      } else if (sold[d.good] > supply) out.push(`${tag}: продано невольников ${big(sold[d.good])} за привоз — торговцы уводят не больше ${big(supply)}.`);
    }
    press[d.good] = [q0 + d.n, d.at];
  }

  // Счёт и нажим описи — те, что вывела цепочка.
  if (fresh.length === want && want > 0) {
    for (const [g, p] of Object.entries(B.press)) {
      const c = press[g];
      if (!c || !near(c[0], p[0]) || c[1] !== p[1]) out.push(`Нажим «${g}» в описи ${p[0].toFixed(2)} — по сделкам ${c ? c[0].toFixed(2) : '0'}.`);
    }
    if (B.w === w) {
      for (const g of new Set([...Object.keys(B.bought), ...Object.keys(bought)])) {
        if ((B.bought[g] ?? 0) !== (bought[g] ?? 0)) out.push(`Счёт купленного «${g}» за привоз ${big(B.bought[g] ?? 0)} — по сделкам ${big(bought[g] ?? 0)}.`);
      }
      for (const g of new Set([...Object.keys(B.sold), ...Object.keys(sold)])) {
        if ((B.sold[g] ?? 0) !== (sold[g] ?? 0)) out.push(`Счёт проданного «${g}» за привоз ${big(B.sold[g] ?? 0)} — по сделкам ${big(sold[g] ?? 0)}.`);
      }
      if (B.got !== got) out.push(`Серебро купцов за привоз ${big(B.got)} — по сделкам ${big(got)}.`);
    }
  }

  // Продано не больше, чем могло быть: запас прежней описи, выработка за промежуток и купленное (телега могла прийти).
  const days = gameDaysOfMs(Math.max(0, bAt - aAt) + Math.max(0, b.lead - a.lead) + CLOCK_SKEW_SECONDS * 1000);
  const stock = new Set<string>(STOCK_KEYS);
  for (const [g, n] of Object.entries(soldSum)) {
    const def = goodOf(g);
    if (!def) continue;
    const had = def.id === BONDED_GOOD.id ? a.bonded ?? 0 : def.resource && stock.has(def.resource) ? a.stock[def.resource] ?? 0 : null;
    if (had === null) continue;
    const grow = def.resource ? (ctx.prod[def.resource] ?? 0) * days * ctx.slack : 0;
    const could = had + grow + (boughtSum[g] ?? 0) + 1;
    if (n > could) out.push(`Продано ${def.name.toLowerCase()} ${big(n)} — было не больше ${big(could)} (запас ${big(had)}, выработка и купленное).`);
  }
  return out;
}
