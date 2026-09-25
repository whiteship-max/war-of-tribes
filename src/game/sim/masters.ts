// Наёмные мастера: руки на стройку за золото, не снимая жителя (docs/admin_branch.md, раздел 4.1).
//
// **Ценность механики — не прибавка к стройке, а спор за золото.** Одна казна платит либо
// копейщику, либо почти пятерым мастерам (`derived.masterWage` — та же формула, что у бойца, без
// строя и снаряжения). Отсюда всё устройство, и ничего сверх него:
// - мастер стоит **на месте Мастерской**, третьим числом рядом с её людьми (`derived.handsCount`),
//   и работает по ставке ремесленника (`derived.crafterBuildRate`) — своей ставки у него нет;
// - жалованье идёт **из той же ведомости**, что у войска (`derived.wagesPerDay`), и «по средствам»
//   решает по ней же;
// - голод и неуплата у мастеров — **та же дверь**, что у войска (`sim/upkeep`); ушедший мастер
//   уходит из посёлка — жителем он не был;
// - сколько мест открыто под наёмных, решает административная ветвь (`sim/tech.mastersCap`),
//   сколько свободно — места самой Мастерской (`derived.mastersRoom`).
//
// Пишет `GameState.masters` только этот модуль — держит это тест по исходникам.
import type { GameState } from '../types';
import { BUILDING_BY_ID, MASTERS_AT } from '../data/buildings';
import { UPKEEP_TEXT } from '../data/upkeep';
import {
  buildingOfType,
  buildingSlots,
  crafterHeadShare,
  handsCount,
  masterWage,
  mastersBuildShare,
  mastersCount,
  mastersRoom,
  wageOf,
} from '../derived';
import { mastersBlock, mastersCap } from './tech';
import { log } from './log';

export interface MastersInfo {
  /** Сколько мастеров стоит сейчас. */
  have: number;
  /** Сколько мест под наёмных открыла ветвь. */
  cap: number;
  /** Сколько ещё можно взять прямо сейчас: и ветвь пускает, и места Мастерской свободны. */
  room: number;
  /** Жалованье одного мастера за игровой день. */
  wage: number;
  /** Сколько стройки в секунду дают стоящие мастера — под сезоном и ратушей, как вся стройка. */
  gain: number;
  /** Сколько даёт один мастер — ровно столько же, сколько один ремесленник. */
  each: number;
  /**
   * Сколько мастеров стоит жалованье одного копейщика. Это и есть спор, ради которого механика
   * заведена: одна казна платит либо ему, либо им. Считается здесь, а не в разметке.
   */
  perSpearman: number;
  /** Почему нельзя взять ещё одного; `null` — можно. */
  blocked: string | null;
}

/** Всё о наёмных мастерах в эту минуту — одна функция на ряд в Мастерской и на действие. */
export function mastersInfo(s: GameState): MastersInfo {
  const have = mastersCount(s);
  const cap = mastersCap(s);
  const free = mastersRoom(s);
  const room = Math.max(0, Math.min(cap - have, free));
  let blocked: string | null = null;
  if (room <= 0) {
    blocked =
      mastersBlock(s, have + 1) ??
      (free <= 0 ? `Свободных мест в здании «${BUILDING_BY_ID[MASTERS_AT].name}» нет: подними его уровень или сними ремесленника.` : null);
  }
  const wage = masterWage(s);
  return {
    have,
    cap,
    room,
    wage,
    gain: mastersBuildShare(s),
    each: crafterHeadShare(s),
    perSpearman: wage > 0 ? wageOf(s, 'spearman') / wage : 0,
    blocked,
  };
}

/** Нанять мастеров. Возвращает `null` или причину отказа словами. */
export function hireMasters(s: GameState, count: number): string | null {
  const n = Math.floor(count);
  if (n < 1) return 'Сколько нанять?';
  const info = mastersInfo(s);
  if (info.blocked) return info.blocked;
  if (n > info.room) return mastersBlock(s, info.have + n) ?? `Свободных мест в Мастерской — ${info.room}.`;
  s.masters = info.have + n;
  log(s, `Нанято наёмных мастеров: ${n}. Жалованье — ${(info.wage * n).toFixed(2)} золота в игровой день.`, 'info', 'masters:hire');
  return null;
}

/** Отпустить мастеров. Выход без потерь: жалованье перестаёт идти в ту же минуту. */
export function releaseMasters(s: GameState, count: number): string | null {
  const have = mastersCount(s);
  const n = Math.floor(count);
  if (have === 0) return 'Наёмных мастеров нет.';
  if (n < 1) return 'Сколько отпустить?';
  if (n > have) return `Мастеров только ${have}.`;
  s.masters = have - n;
  log(s, `Отпущено наёмных мастеров: ${n}.`, 'info', 'masters:release');
  return null;
}

/**
 * Держит мастеров в пределах мест и ветви. Мест в Мастерской стало меньше (упал уровень при падении
 * города) — **первыми уходят наёмные**: своего ради наёмного с места не сгоняют, тем же правилом,
 * что у невольников. Зовёт его `normalizeAssignments` до того, как подрезает людей по местам.
 */
export function fitMasters(s: GameState): void {
  const have = mastersCount(s);
  if (s.masters !== have) s.masters = have;
  if (have === 0) return;
  const hall = buildingOfType(s, MASTERS_AT);
  const over = hall ? Math.max(0, handsCount(s, hall.id) - buildingSlots(hall)) : have;
  const keep = Math.max(0, Math.min(have - over, mastersCap(s)));
  if (keep < have) {
    s.masters = keep;
    log(s, `Мастерская стала теснее: ушло наёмных мастеров — ${have - keep}.`, 'bad', 'masters:fit');
  }
}

/**
 * Уход той же дверью, что у войска: голодом (`unfed`) и неуплатой (`unpaid`). Зовёт его только
 * `sim/upkeep` — там решается, сколько и почему. Жителем ушедший мастер не остаётся.
 */
export function loseMasters(s: GameState, unfed: number, unpaid: number): void {
  const have = mastersCount(s);
  const hungry = Math.min(have, Math.max(0, Math.floor(unfed)));
  const owed = Math.min(have - hungry, Math.max(0, Math.floor(unpaid)));
  if (hungry + owed <= 0) return;
  s.masters = have - hungry - owed;
  for (let i = 0; i < hungry; i++) log(s, UPKEEP_TEXT.masterLeft(UPKEEP_TEXT.why.food), 'bad', 'masters:left:food');
  for (let i = 0; i < owed; i++) log(s, UPKEEP_TEXT.masterLeft(UPKEEP_TEXT.why.pay), 'bad', 'masters:left:pay');
}
