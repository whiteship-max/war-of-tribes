// Повышение и разжалование бойцов отряда бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.4.2; «Решения ПН-6») — числа и формулы без
// состояния партии, одни на игру (`sim/bandranks`), на книгу отряда сервера (`netlify/lib/roambook.ts`) и на прибор пути
// (`npm run roam:report`, раздел «Цены повышения и найма»).
//
// Своих чисел здесь нет ни одного:
//  · **дерево** — из снаряжения видов (`data/troops`): повысить А в Б можно, если снаряжение А целиком входит в снаряжение Б. Из
//    этого правила выходит ровно дерево ГДД (дубинщик → любой; копейщик → всадник → латный всадник; мечник → щитоносец → латник;
//    лучник и топорник — листья), и новая строка вида встанет в него сама;
//  · **цена** — основа рынка (`data/market`, без нажима): полная цена вида — снаряжение и припас найма сверх дубинщика, цена
//    повышения А → Б — разность полных цен (решение владельца ПН-6, находка ПН-0ч). Поэтому **по шагам — столько же, сколько
//    сразу**: разности складываются, и путь не наказывается и не награждается (тест — любой путь равен прямому). Прежняя формула
//    ГДД — `Σ max(0, припас_Б − припас_А)` по шагу — этим не обладала: латный всадник просит меньше припаса, чем всадник, и по
//    шагам выходило 816 против 631 сразу;
//  · **снаряжение из обоза** засчитывается даром — по той же основе за штуку, которую шаг добавляет; ниже нуля повышение не
//    дешевеет (золото за повышение не возвращают — иначе «разжаловать и повысить» стал бы станком золота).
// Без `@/`: модуль собирает сервер.
import type { EquipmentId, ResourceId, TroopId } from './types';
import { TROOP_BY_ID, TROOP_IDS } from './data/troops';
import { GOOD_BY_ID, eqGood } from './data/market';

/** Вид, от которого считается полная цена: первый вид войск, его приводит весть «Просятся в отряд» (3.4.1). */
export const PROMOTE_ROOT: TroopId = 'clubman';

type Kit = Partial<Record<EquipmentId, number>>;

const gearOf = (id: TroopId): Kit => TROOP_BY_ID[id].gear;

/** Снаряжение `a` целиком входит в `b` (штука за штукой). */
const within = (a: Kit, b: Kit): boolean => (Object.entries(a) as [EquipmentId, number][]).every(([e, n]) => (b[e] ?? 0) >= n);

/** Можно ли повысить `from` в `to`: другой вид, снаряжение `from` входит в снаряжение `to`. Разжаловать — обратное. */
export const canPromote = (from: TroopId, to: TroopId): boolean => from !== to && within(gearOf(from), gearOf(to));

/** Куда можно повысить вид — порядком видов игры. */
export const promoteTargets = (from: TroopId): TroopId[] => TROOP_IDS.filter((to) => canPromote(from, to));

/** Куда можно разжаловать вид — порядком видов игры. */
export const demoteTargets = (from: TroopId): TroopId[] => TROOP_IDS.filter((to) => canPromote(to, from));

/**
 * Полная цена вида по основе рынка: всё его снаряжение и припас найма сверх дубинщика (`PROMOTE_ROOT`). У дубинщика — ноль. Одна
 * функция — на цену повышения, на прибор и на книгу сервера.
 */
export function promoteWorth(id: TroopId): number {
  const t = TROOP_BY_ID[id];
  const root = TROOP_BY_ID[PROMOTE_ROOT];
  let gold = 0;
  for (const [e, n] of Object.entries(t.gear) as [EquipmentId, number][]) gold += n * GOOD_BY_ID[eqGood(e)].price;
  for (const [r, n] of Object.entries(t.cost) as [ResourceId, number][]) gold += Math.max(0, n - (root.cost[r] ?? 0)) * GOOD_BY_ID[r].price;
  return gold;
}

/** Цена повышения одного бойца `from` → `to` без обоза: разность полных цен (не ниже нуля). */
export const promoteUnit = (from: TroopId, to: TroopId): number => Math.max(0, promoteWorth(to) - promoteWorth(from));

/** Снаряжение, которое шаг `from` → `to` надевает на одного бойца (у повышения — штуки, которых у `from` нет). */
export function promoteKit(from: TroopId, to: TroopId): Kit {
  const out: Kit = {};
  const a = gearOf(from);
  for (const [e, n] of Object.entries(gearOf(to)) as [EquipmentId, number][]) {
    const more = n - (a[e] ?? 0);
    if (more > 0) out[e] = more;
  }
  return out;
}

/** Что повышение `n` бойцов стоит: золото, снаряжение из обоза (засчитано даром) и цена без обоза. */
export interface PromoteBill {
  gold: number;
  /** Штуки снаряжения, которые уйдут из обоза. */
  fromCargo: Kit;
  /** Сколько стоило бы без обоза. */
  full: number;
}

/**
 * Цена повышения `n` бойцов `from` → `to` при снаряжении в обозе `cargo`: разность полных цен, минус основа штук, которые шаг
 * надевает и которые лежат в обозе. Не ниже нуля. Нельзя повысить — `null`.
 */
export function promoteBill(from: TroopId, to: TroopId, n: number, cargo: Kit = {}): PromoteBill | null {
  if (!canPromote(from, to) || !(n > 0) || !Number.isInteger(n)) return null;
  const full = n * promoteUnit(from, to);
  const fromCargo: Kit = {};
  let credit = 0;
  for (const [e, k] of Object.entries(promoteKit(from, to)) as [EquipmentId, number][]) {
    const take = Math.min(Math.max(0, Math.floor(cargo[e] ?? 0)), k * n);
    if (take <= 0) continue;
    fromCargo[e] = take;
    credit += take * GOOD_BY_ID[eqGood(e)].price;
  }
  return { gold: Math.max(0, full - credit), fromCargo, full };
}

/** Что разжалование `n` бойцов `from` → `to` кладёт в обоз: снаряжение, которого у `to` нет. Нельзя — `null`. */
export function demoteKit(from: TroopId, to: TroopId, n: number): Kit | null {
  if (!canPromote(to, from) || !(n > 0) || !Number.isInteger(n)) return null;
  const out: Kit = {};
  for (const [e, k] of Object.entries(promoteKit(to, from)) as [EquipmentId, number][]) out[e] = k * n;
  return out;
}
