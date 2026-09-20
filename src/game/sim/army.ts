// Казармы, конюшня и войско. Боец — не житель с профессией «воин», а единица в счётчике:
// нанятый уходит из рабочих совсем, не добывает и не даёт труд.
//
// Цена одного бойца: ресурсы + снаряжение + один свободный житель + время учений.
//
// **Очередей две, и делит их здание, в котором учат.** Конницу нанимают только в конюшне
// (docs/stable.md), пеших — в казармах; порядок внутри очереди прежний, заказы одной не ждут
// другую. Второго поля в сохранении для этого нет: где учат вид, выводится из него самого
// (`TroopDef.mounted`), и заказ, записанный до конюшни, сам оказывается в своей очереди.
import type { EquipmentId, GameState, RecruitOrder, ResourceId, TroopId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { TROOPS, TROOP_BY_ID, TROOP_IDS, type TroopDef } from '../data/troops';
import { KIND_OF } from '../battle/kinds';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { buildingOfType, canAfford, heavyFrom, heavyOpen, idleCount, recruitRate, recruitsQueued, stalls, stallsTaken } from '../derived';
import { addPop, losePop } from './population';
import { log } from './log';
import { pay, refund } from './pay';
import { asGame, type GameSec } from '../pace';

/** Сколько всего стоит партия бойцов в ресурсах. */
export function recruitCost(troop: TroopId, count: number): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  const def = TROOP_BY_ID[troop];
  for (const r of RESOURCE_IDS) if (def.cost[r]) out[r] = (def.cost[r] as number) * count;
  return out;
}

/** Сколько всего снаряжения уйдёт на партию бойцов. */
export function recruitGear(troop: TroopId, count: number): Partial<Record<EquipmentId, number>> {
  const out: Partial<Record<EquipmentId, number>> = {};
  for (const [id, n] of Object.entries(TROOP_BY_ID[troop].gear)) {
    if (n) out[id as EquipmentId] = n * count;
  }
  return out;
}

export interface MissingGear {
  id: EquipmentId;
  have: number;
  need: number;
}

/** Где учат этот вид: конницу — в конюшне, пеших — в казармах. */
export const hiredAt = (troop: TroopId): 'stable' | 'barracks' => (TROOP_BY_ID[troop].mounted ? 'stable' : 'barracks');

/** Заказы очереди того здания, где учат этот вид, в порядке очереди. */
export const queueOf = (s: GameState, troop: TroopId): RecruitOrder[] =>
  (s.recruits ?? []).filter((o) => hiredAt(o.troop) === hiredAt(troop));

export interface RecruitCheck {
  def: TroopDef;
  count: number;
  cost: Partial<Record<ResourceId, number>>;
  gear: Partial<Record<EquipmentId, number>>;
  /** Сколько свободных жителей останется, если нанять. */
  freeAfter: number;
  /** Чего именно не хватает из снаряжения — отсюда кнопка перехода в кузницу. */
  missing: MissingGear[];
  /** Работа казарм на всю партию. */
  work: number;
  /** Секунд на всю партию; null — казармы стоят. */
  eta: GameSec | null;
  /** Почему нельзя; null — можно. */
  blocked: string | null;
}

/**
 * Всё, что нужно знать перед наймом: цена, сколько людей останется и чего не хватает.
 * Тупика без объяснения быть не должно, поэтому нехватка снаряжения называется поимённо.
 */
export function recruitCheck(s: GameState, troop: TroopId, count: number): RecruitCheck {
  const def = TROOP_BY_ID[troop];
  const n = Math.max(1, Math.floor(count));
  const cost = recruitCost(troop, n);
  const gear = recruitGear(troop, n);
  const free = idleCount(s);
  const missing: MissingGear[] = [];
  for (const [id, need] of Object.entries(gear)) {
    const have = s.equipment?.[id as EquipmentId] ?? 0;
    if (have < (need ?? 0)) missing.push({ id: id as EquipmentId, have, need: need ?? 0 });
  }
  const rate = recruitRate(s, troop);
  const work = def.work * n;
  // Стойла: общий потолок обоих конных родов. Заняты строем, учениями и ранеными — конь
  // с всадником не расседлан (`derived.stallsTaken`).
  const stall = def.mounted ? Math.max(0, stalls(s) - stallsTaken(s)) : Infinity;

  let blocked: string | null = null;
  if (def.mounted && !buildingOfType(s, 'stable')) blocked = 'Конницу нанимают в конюшне.';
  else if (def.mounted && KIND_OF[troop] === 'heavy' && !heavyOpen(s)) blocked = `Латных всадников куют с ${heavyFrom()} уровня конюшни.`;
  else if (stall < n) blocked = stall === 0 ? 'Все стойла заняты — нужен уровень конюшни.' : `Свободных стойл только ${stall}.`;
  else if (free < n) blocked = free === 0 ? 'Нет свободных жителей.' : `Свободных жителей только ${free}.`;
  else if (missing.length > 0) {
    blocked = `Не хватает: ${missing
      .map((m) => `${EQUIPMENT_BY_ID[m.id].name.toLowerCase()} ${m.need - m.have}`)
      .join(', ')}.`;
  } else if (!canAfford(s, cost)) blocked = 'Не хватает ресурсов.';

  return {
    def,
    count: n,
    cost,
    gear,
    freeAfter: Math.max(0, free - n),
    missing,
    work,
    eta: rate > 0 ? asGame(Math.ceil(work / rate)) : null,
    blocked,
  };
}

/** Ставит партию бойцов в очередь казарм. Плата снимается сразу — как за стройку. */
export function startRecruit(s: GameState, troop: TroopId, count = 1): string | null {
  const check = recruitCheck(s, troop, count);
  if (check.blocked) return check.blocked;
  const n = check.count;

  pay(s, check.cost);
  for (const [id, need] of Object.entries(check.gear)) {
    s.equipment[id as EquipmentId] -= need ?? 0;
  }
  // Люди уходят на учения сразу: они больше не добывают и не строят.
  const people = losePop(s, n);

  const order: RecruitOrder = { id: s.nextId++, troop, count: people, done: 0, work: 0, people };
  s.recruits.push(order);
  log(s, `${hiredAt(troop) === 'stable' ? 'Конюшня' : 'Казармы'}: набор — ${check.def.name.toLowerCase()}, ${people}.`);
  return null;
}

/** Отменяет заказ. Возвращает добро и тех же людей, что ушли на учения. */
export function cancelRecruit(s: GameState, orderId: number): string | null {
  const idx = s.recruits.findIndex((o) => o.id === orderId);
  if (idx < 0) return 'Такого набора нет.';
  const order = s.recruits[idx];
  const left = Math.max(0, order.count - order.done);
  const def = TROOP_BY_ID[order.troop];

  refund(s, def.cost, left);
  for (const [id, n] of Object.entries(def.gear)) {
    if (n) s.equipment[id as EquipmentId] = (s.equipment[id as EquipmentId] ?? 0) + n * left;
  }
  // Недоучившиеся возвращаются к костру свободными руками.
  addPop(s, Math.min(order.people, left));
  s.recruits.splice(idx, 1);
  log(s, `${hiredAt(order.troop) === 'stable' ? 'Конюшня' : 'Казармы'}: набор отменён — ${def.name.toLowerCase()}.`);
  return null;
}

/**
 * Секунд до конца заказа, пока он первый в очереди. Скорость та же, какой идёт
 * сама очередь (`recruitTick`): со своим видом бойца — у всадника, значит, и с
 * конюшней. Своего подсчёта срока у панели казарм нет: он расходился с очередью
 * ровно на множитель конюшни. null — казармы стоят.
 */
export function orderEta(s: GameState, order: RecruitOrder): GameSec | null {
  const rate = recruitRate(s, order.troop);
  if (rate <= 0) return null;
  const left = TROOP_BY_ID[order.troop].work * (order.count - order.done) - order.work;
  return asGame(Math.ceil(Math.max(0, left) / rate));
}

/** Первый в очереди своего здания — тот, кого учат прямо сейчас. */
export const isTraining = (s: GameState, order: RecruitOrder): boolean => queueOf(s, order.troop)[0]?.id === order.id;

/**
 * Шаг казарм: обучается только первый заказ в очереди. Остаток работы после
 * последнего бойца переходит следующему заказу — очередь не теряет время.
 */
export function recruitTick(s: GameState, dt: number): void {
  // Два здания — два первых заказа: конюшня учит конницу, казармы пеших, и ждать друг друга
  // им незачем. Внутри очереди по-прежнему учится только первый.
  for (const where of ['barracks', 'stable'] as const) {
    const order = (s.recruits ?? []).find((o) => hiredAt(o.troop) === where);
    if (!order) continue;
    const rate = recruitRate(s, order.troop);
    if (rate <= 0) continue;
    const def = TROOP_BY_ID[order.troop];
    order.work += rate * dt;
    while (order.work >= def.work && order.done < order.count) {
      order.work -= def.work;
      order.done++;
      order.people = Math.max(0, order.people - 1);
      s.army[order.troop] = (s.army[order.troop] ?? 0) + 1;
      // По строке на бойца: заказ на полсотни — полсотни одинаковых строк.
      log(s, `${where === 'stable' ? 'Конюшня' : 'Казармы'}: обучен ${def.one}.`, 'good', `recruit:${order.troop}`);
    }
    if (order.done >= order.count) {
      const rest = order.work;
      s.recruits.splice(s.recruits.indexOf(order), 1);
      const next = (s.recruits ?? []).find((o) => hiredAt(o.troop) === where);
      if (next) next.work += rest;
    }
  }
}

/**
 * Снять `n` новобранцев вида `troop` с учений — голодом, совсем (`sim/upkeep`): люди уходят, заплаченное
 * за набор не возвращается. Первыми уходят последние заказы: первый в очереди ближе всего к строю.
 * Возвращает, сколько снято.
 */
export function loseRecruits(s: GameState, troop: TroopId, n: number): number {
  let left = Math.max(0, Math.floor(n));
  let gone = 0;
  for (let i = s.recruits.length - 1; i >= 0 && left > 0; i--) {
    const o = s.recruits[i];
    if (o.troop !== troop) continue;
    const take = Math.min(left, Math.max(0, o.count - o.done));
    if (take <= 0) continue;
    o.count -= take;
    o.people = Math.max(0, o.people - take);
    left -= take;
    gone += take;
    if (o.count <= o.done) {
      const rest = o.work;
      const head = queueOf(s, o.troop)[0]?.id === o.id;
      s.recruits.splice(i, 1);
      const next = queueOf(s, o.troop)[0];
      if (head && next) next.work += rest;
    }
  }
  return gone;
}

/**
 * Снимает n бойцов с довольствия — слабые гибнут первыми. Возвращает,
 * сколько удалось снять. Так мир применяет потери похода.
 */
export function removeSoldiers(s: GameState, n: number): number {
  let left = Math.max(0, Math.round(n));
  let gone = 0;
  for (const id of TROOP_IDS) {
    if (left <= 0) break;
    const have = Math.max(0, s.army[id] ?? 0);
    const take = Math.min(have, left);
    s.army[id] = have - take;
    left -= take;
    gone += take;
  }
  return gone;
}

/** Свести армию к списку «сколько кого» — для панелей и отчётов. */
export const armyRoster = (s: GameState): { def: TroopDef; n: number }[] =>
  TROOPS.map((def) => ({ def, n: Math.max(0, s.army?.[def.id] ?? 0) })).filter((x) => x.n > 0);

/** Сколько людей сейчас на учениях: они уже не в племени, но ещё не бойцы. */
export const trainees = (s: GameState): number => recruitsQueued(s);
