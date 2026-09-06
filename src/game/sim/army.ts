// Казармы и войско. Боец — не житель с профессией «воин», а единица в счётчике:
// нанятый уходит из рабочих совсем, не добывает и не даёт труд.
//
// Цена одного бойца: ресурсы + снаряжение + один свободный житель + время учений.
// Очередь одна и идёт последовательно; отмена возвращает и добро, и людей.
import type { EquipmentId, GameState, RecruitOrder, ResourceId, TroopId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { TROOPS, TROOP_BY_ID, TROOP_IDS, type TroopDef } from '../data/troops';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { canAfford, idleCount, recruitRate, recruitsQueued, storageCap } from '../derived';
import { addPop, losePop } from './population';
import { log } from './log';
import { recordSpent } from '@/profile/stats';

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
  eta: number | null;
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

  let blocked: string | null = null;
  if (free < n) blocked = free === 0 ? 'Нет свободных жителей.' : `Свободных жителей только ${free}.`;
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
    eta: rate > 0 ? Math.ceil(work / rate) : null,
    blocked,
  };
}

/** Ставит партию бойцов в очередь казарм. Плата снимается сразу — как за стройку. */
export function startRecruit(s: GameState, troop: TroopId, count = 1): string | null {
  const check = recruitCheck(s, troop, count);
  if (check.blocked) return check.blocked;
  const n = check.count;

  for (const r of RESOURCE_IDS) s.resources[r] -= check.cost[r] ?? 0;
  recordSpent(s, check.cost);
  for (const [id, need] of Object.entries(check.gear)) {
    s.equipment[id as EquipmentId] -= need ?? 0;
  }
  // Люди уходят на учения сразу: они больше не добывают и не строят.
  const people = losePop(s, n);

  const order: RecruitOrder = { id: s.nextId++, troop, count: people, done: 0, work: 0, people };
  s.recruits.push(order);
  log(s, `Казармы: набор — ${check.def.name.toLowerCase()}, ${people}.`);
  return null;
}

/** Отменяет заказ. Возвращает добро и тех же людей, что ушли на учения. */
export function cancelRecruit(s: GameState, orderId: number): string | null {
  const idx = s.recruits.findIndex((o) => o.id === orderId);
  if (idx < 0) return 'Такого набора нет.';
  const order = s.recruits[idx];
  const left = Math.max(0, order.count - order.done);
  const def = TROOP_BY_ID[order.troop];

  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = def.cost[r];
    if (n) s.resources[r] = Math.min(cap, s.resources[r] + n * left);
  }
  for (const [id, n] of Object.entries(def.gear)) {
    if (n) s.equipment[id as EquipmentId] = (s.equipment[id as EquipmentId] ?? 0) + n * left;
  }
  // Недоучившиеся возвращаются к костру свободными руками.
  addPop(s, Math.min(order.people, left));
  s.recruits.splice(idx, 1);
  log(s, `Казармы: набор отменён — ${def.name.toLowerCase()}.`);
  return null;
}

/**
 * Шаг казарм: обучается только первый заказ в очереди. Остаток работы после
 * последнего бойца переходит следующему заказу — очередь не теряет время.
 */
export function recruitTick(s: GameState, dt: number): void {
  const order = s.recruits[0];
  if (!order) return;
  const rate = recruitRate(s, order.troop);
  if (rate <= 0) return;
  const def = TROOP_BY_ID[order.troop];
  order.work += rate * dt;
  while (order.work >= def.work && order.done < order.count) {
    order.work -= def.work;
    order.done++;
    order.people = Math.max(0, order.people - 1);
    s.army[order.troop] = (s.army[order.troop] ?? 0) + 1;
    // По строке на бойца: заказ на полсотни — полсотни одинаковых строк.
    log(s, `Казармы: обучен ${def.one}.`, 'good', `recruit:${order.troop}`);
  }
  if (order.done >= order.count) {
    const rest = order.work;
    s.recruits.shift();
    if (s.recruits[0]) s.recruits[0].work += rest;
  }
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
