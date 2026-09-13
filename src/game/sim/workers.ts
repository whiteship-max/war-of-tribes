// Кто где работает. Люди одинаковы, поэтому назначение — это число: сколько
// человек стоит в здании (`s.workers`) и сколько занято вольным сбором
// (`s.freeJobs`). Остальные свободны и видны у костра.
//
// Невольники встают на те же места и теми же числами (`s.bondedWork`): места у
// здания общие, и сколько рук на них стоит, спрашивают у `handsCount`. Второй
// системы занятости здесь нет — это второе число на тех же местах.
import type { GameState, JobId } from '../types';
import { BUILDING_BY_ID } from '../data/buildings';
import { FREE_JOBS, JOB_BY_ID } from '../data/jobs';
import {
  bondedCount,
  bondedIdle,
  bondedTotal,
  buildingById,
  buildingSlots,
  freeJobCount,
  handsCount,
  idleCount,
  takesBonded,
  workerCount,
} from '../derived';

/** Ставит `n` человек на свободные места здания. Берёт сколько влезет, но не меньше одного. */
export function assignWorker(s: GameState, buildingId: number, n = 1): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return 'В этом здании не работают.';
  // Места общие: занятое невольником не отдаётся вольному поверх него.
  const room = buildingSlots(b) - handsCount(s, b.id);
  if (room <= 0) return 'Все места заняты — нужен уровень выше.';
  const free = idleCount(s);
  if (free <= 0) return 'Нет свободных жителей.';
  const take = Math.min(Math.max(1, Math.floor(n)), room, free);
  s.workers[b.id] = workerCount(s, b.id) + take;
  return null;
}

/** Снимает `n` рабочих со здания — они возвращаются к костру. */
export function unassignWorker(s: GameState, buildingId: number, n = 1): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const have = workerCount(s, b.id);
  if (have <= 0) return 'Здесь никто не работает.';
  s.workers[b.id] = have - Math.min(Math.max(1, Math.floor(n)), have);
  return null;
}

/**
 * Ставит `n` невольников на места здания — тем же рядом шага, что и вольных.
 * Только туда, где работу дают невольникам (`JobDef.bonded`), и только на
 * свободные места: занятое вольным не отнимается.
 */
export function assignBonded(s: GameState, buildingId: number, n = 1): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  if (!takesBonded(b)) return 'На эту работу невольников не ставят.';
  const room = buildingSlots(b) - handsCount(s, b.id);
  if (room <= 0) return 'Все места заняты — нужен уровень выше.';
  const free = bondedIdle(s);
  if (free <= 0) return 'Свободных невольников нет.';
  const take = Math.min(Math.max(1, Math.floor(n)), room, free);
  s.bondedWork[b.id] = bondedCount(s, b.id) + take;
  return null;
}

/** Снимает `n` невольников со здания — они уходят на стройку. */
export function unassignBonded(s: GameState, buildingId: number, n = 1): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const have = bondedCount(s, b.id);
  if (have <= 0) return 'Невольников здесь нет.';
  s.bondedWork[b.id] = have - Math.min(Math.max(1, Math.floor(n)), have);
  return null;
}

/**
 * «Вольный сбор» у костра: профессия без профильного здания. Работает вполсилы,
 * но доступна всегда — иначе игрок без свободного места остаётся без дохода.
 */
export function changeFreeJob(s: GameState, job: JobId, delta: number): string | null {
  const def = JOB_BY_ID[job];
  if (!def.freeRange) return 'Эту работу дают только в здании.';
  const have = freeJobCount(s, job);
  const step = Math.floor(Math.abs(delta)) || 1;
  if (delta > 0) {
    const free = idleCount(s);
    if (free <= 0) return 'Нет свободных жителей.';
    s.freeJobs[job] = have + Math.min(step, free);
    return null;
  }
  if (have <= 0) return 'Никто не занят этой работой.';
  s.freeJobs[job] = have - Math.min(step, have);
  return null;
}

/**
 * Приводит назначения в порядок после любых изменений мира: сгоревшее здание,
 * упавший уровень, убыль населения. Вызывается каждый тик — дёшево.
 *
 * Порядок сокращения тот же, что при убыли: сначала вольный сбор, потом самые
 * многолюдные здания. Так посёлок не остаётся без единственного кузнеца, когда
 * зима забрала треть народу.
 */
export function normalizeAssignments(s: GameState): void {
  s.pop = Math.max(0, Math.floor(s.pop));
  s.bonded = Math.max(0, Math.floor(s.bonded ?? 0));
  if (!s.bondedWork) s.bondedWork = {};

  // Висячих записей быть не должно: снесённое здание не держит рабочих.
  const alive = new Set(s.buildings.map((b) => b.id));
  for (const key of Object.keys(s.workers)) {
    const id = Number(key);
    if (!alive.has(id)) delete s.workers[id];
  }
  for (const key of Object.keys(s.bondedWork)) {
    const id = Number(key);
    if (!alive.has(id)) delete s.bondedWork[id];
  }
  for (const b of s.buildings) {
    const slots = buildingSlots(b);
    // Невольник на работе, которую невольникам не дают, не стоит нигде.
    if (!takesBonded(b) && bondedCount(s, b.id) > 0) delete s.bondedWork[b.id];
    // Мест стало меньше (упал уровень) — первыми уходят невольники: вольного
    // ради невольника с места не сгоняют.
    const bonded = bondedCount(s, b.id);
    const over = workerCount(s, b.id) + bonded - slots;
    if (over > 0 && bonded > 0) s.bondedWork[b.id] = bonded - Math.min(bonded, over);
    if (bondedCount(s, b.id) <= 0) delete s.bondedWork[b.id];
    const have = workerCount(s, b.id);
    const room = slots - bondedCount(s, b.id);
    if (have > room) s.workers[b.id] = room;
    else if (have <= 0) delete s.workers[b.id];
  }
  for (const job of FREE_JOBS) {
    const n = freeJobCount(s, job);
    if (n <= 0) delete s.freeJobs[job];
    else s.freeJobs[job] = n;
  }

  // Народу может оказаться меньше, чем расставлено: лишние места пустеют.
  let over = -idleCountRaw(s);
  for (const job of FREE_JOBS) {
    if (over <= 0) break;
    const have = freeJobCount(s, job);
    const take = Math.min(have, over);
    if (take > 0) {
      s.freeJobs[job] = have - take;
      over -= take;
    }
  }
  while (over > 0) {
    const staffed = s.buildings
      .filter((b) => workerCount(s, b.id) > 0)
      .sort((a, b) => workerCount(s, b.id) - workerCount(s, a.id));
    if (staffed.length === 0) break;
    const b = staffed[0];
    const take = Math.min(workerCount(s, b.id), over);
    s.workers[b.id] = workerCount(s, b.id) - take;
    over -= take;
  }

  // И невольников может оказаться меньше, чем стоит по местам: тем же порядком,
  // с самого многолюдного здания.
  let bondedOver = -bondedIdleRaw(s);
  while (bondedOver > 0) {
    const staffed = s.buildings
      .filter((b) => bondedCount(s, b.id) > 0)
      .sort((a, b) => bondedCount(s, b.id) - bondedCount(s, a.id));
    if (staffed.length === 0) break;
    const b = staffed[0];
    const take = Math.min(bondedCount(s, b.id), bondedOver);
    s.bondedWork[b.id] = bondedCount(s, b.id) - take;
    if (s.bondedWork[b.id] <= 0) delete s.bondedWork[b.id];
    bondedOver -= take;
  }
}

/** Свободные руки без нижней отсечки: отрицательное значение — перебор назначений. */
function idleCountRaw(s: GameState): number {
  let busy = 0;
  for (const b of s.buildings) busy += workerCount(s, b.id);
  for (const job of FREE_JOBS) busy += freeJobCount(s, job);
  return s.pop - busy;
}

/** Невольники без места, без нижней отсечки: отрицательное — перебор назначений. */
function bondedIdleRaw(s: GameState): number {
  let busy = 0;
  for (const b of s.buildings) busy += bondedCount(s, b.id);
  return bondedTotal(s) - busy;
}

/** Рассаживает свободные руки по пустым слотам, по кругу и понемногу. */
export function autoAssign(s: GameState): void {
  for (const b of s.buildings) {
    if (!BUILDING_BY_ID[b.type].job) continue;
    const room = buildingSlots(b) - handsCount(s, b.id);
    if (room <= 0) continue;
    const free = idleCount(s);
    if (free <= 0) return;
    s.workers[b.id] = workerCount(s, b.id) + Math.min(room, free);
  }
}
