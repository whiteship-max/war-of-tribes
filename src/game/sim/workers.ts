// Кто где работает. Люди одинаковы, поэтому назначение — это число: сколько
// человек стоит на деле здания (`s.workers`, ключ — профессия дела, ЗД-1) и сколько
// занято вольным сбором (`s.freeJobs`). Остальные свободны и видны у костра.
//
// Дело — место работы в здании: у Фермы их два, поле и загон, у Кузницы одно. Места,
// рабочие и выработка у каждого дела свои, уровень — у здания общий.
//
// Невольники встают на те же места и теми же числами (`s.bondedWork`): места у
// дела общие, и сколько рук на них стоит, спрашивают у `deedHands`. Второй
// системы занятости здесь нет — это второе число на тех же местах.
import type { Building, GameState, JobId } from '../types';
import { jobsOf } from '../data/buildings';
import { FREE_JOBS, JOB_BY_ID } from '../data/jobs';
import {
  PLACED_JOBS,
  bondedTotal,
  bondedIdle,
  buildingById,
  deedBonded,
  deedBuilding,
  deedHands,
  deedSlots,
  deedTakesBonded,
  deedWorkers,
  freeJobCount,
  idleCount,
} from '../derived';
import { fitMasters } from './masters';

/**
 * Дело здания, на которое идёт назначение: названное — если оно у здания есть; не названо — первое дело, где есть
 * место (для зданий с одним делом это оно и есть). Нет дел — null.
 */
function deedOf(s: GameState, b: Building, job: JobId | undefined, room: (job: JobId) => number): JobId | null {
  const jobs = jobsOf(b.type);
  if (job !== undefined) return jobs.includes(job) ? job : null;
  return jobs.find((j) => room(j) > 0) ?? jobs[0] ?? null;
}

/** Свободных мест на деле: места минус все руки на нём. */
const roomOf = (s: GameState, b: Building, job: JobId): number => deedSlots(b) - deedHands(s, job);

/**
 * Ставит `n` человек на свободные места дела `job` здания (не названо — первое дело с местом). Берёт сколько влезет,
 * но не меньше одного.
 */
export function assignWorker(s: GameState, buildingId: number, n = 1, job?: JobId): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  if (jobsOf(b.type).length === 0) return 'В этом здании не работают.';
  const deed = deedOf(s, b, job, (j) => roomOf(s, b, j));
  if (!deed) return 'У этого здания нет такого дела.';
  // Места общие: занятое невольником не отдаётся вольному поверх него.
  const room = roomOf(s, b, deed);
  if (room <= 0) return 'Все места заняты. Улучши здание.';
  const free = idleCount(s);
  if (free <= 0) return 'Нет свободных жителей.';
  const take = Math.min(Math.max(1, Math.floor(n)), room, free);
  s.workers[deed] = deedWorkers(s, deed) + take;
  return null;
}

/** Снимает `n` рабочих с дела `job` здания (не названо — первое дело с людьми) — они возвращаются к костру. */
export function unassignWorker(s: GameState, buildingId: number, n = 1, job?: JobId): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const deed = deedOf(s, b, job, (j) => deedWorkers(s, j));
  if (!deed) return 'У этого здания нет такого дела.';
  const have = deedWorkers(s, deed);
  if (have <= 0) return 'Здесь никто не работает.';
  s.workers[deed] = have - Math.min(Math.max(1, Math.floor(n)), have);
  return null;
}

/**
 * Ставит `n` невольников на места дела — тем же рядом шага, что и вольных.
 * Только туда, где работу дают невольникам (`JobDef.bonded`), и только на
 * свободные места: занятое вольным не отнимается.
 */
export function assignBonded(s: GameState, buildingId: number, n = 1, job?: JobId): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const deed = deedOf(s, b, job, (j) => (deedTakesBonded(j) ? roomOf(s, b, j) : 0));
  if (!deed || !deedTakesBonded(deed)) return 'На эту работу невольников не ставят.';
  const room = roomOf(s, b, deed);
  if (room <= 0) return 'Все места заняты. Улучши здание.';
  const free = bondedIdle(s);
  if (free <= 0) return 'Свободных невольников нет.';
  const take = Math.min(Math.max(1, Math.floor(n)), room, free);
  s.bondedWork[deed] = deedBonded(s, deed) + take;
  return null;
}

/** Снимает `n` невольников с дела — они уходят на стройку. */
export function unassignBonded(s: GameState, buildingId: number, n = 1, job?: JobId): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const deed = deedOf(s, b, job, (j) => deedBonded(s, j));
  if (!deed) return 'У этого здания нет такого дела.';
  const have = deedBonded(s, deed);
  if (have <= 0) return 'Невольников здесь нет.';
  s.bondedWork[deed] = have - Math.min(Math.max(1, Math.floor(n)), have);
  return null;
}

/**
 * Дела по многолюдности — порядок, в котором снимают людей при убыли и переборе: самое многолюдное первым, при равенстве
 * — порядком построек и дел. Считает `count` — вольных или невольников.
 */
export function staffedDeeds(s: GameState, count: (job: JobId) => number): JobId[] {
  const out: JobId[] = [];
  for (const b of s.buildings) for (const job of jobsOf(b.type)) if (count(job) > 0) out.push(job);
  return out.sort((a, b) => count(b) - count(a));
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
  if (!s.workers) s.workers = {};
  if (!s.bondedWork) s.bondedWork = {};

  // Наёмные мастера — первыми: мест в Мастерской стало меньше — уходят они, а не её люди.
  fitMasters(s);

  // Висячих записей быть не должно: назначение — только на дело стоящего здания.
  const placed = new Set<string>(PLACED_JOBS.filter((job) => deedBuilding(s, job)));
  for (const key of Object.keys(s.workers)) if (!placed.has(key)) delete s.workers[key as JobId];
  for (const key of Object.keys(s.bondedWork)) if (!placed.has(key)) delete s.bondedWork[key as JobId];
  for (const b of s.buildings) {
    const slots = deedSlots(b);
    for (const job of jobsOf(b.type)) {
      // Невольник на работе, которую невольникам не дают, не стоит нигде.
      if (!deedTakesBonded(job) && deedBonded(s, job) > 0) delete s.bondedWork[job];
      // Мест стало меньше (упал уровень) — первыми уходят невольники: вольного
      // ради невольника с места не сгоняют. Мастера уже вписаны `fitMasters`.
      const bonded = deedBonded(s, job);
      const over = deedHands(s, job) - slots;
      if (over > 0 && bonded > 0) s.bondedWork[job] = bonded - Math.min(bonded, over);
      if (deedBonded(s, job) <= 0) delete s.bondedWork[job];
      const have = deedWorkers(s, job);
      const room = slots - deedHands(s, job) + have;
      if (have > room) s.workers[job] = Math.max(0, room);
      if (deedWorkers(s, job) <= 0) delete s.workers[job];
    }
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
    const job = staffedDeeds(s, (j) => deedWorkers(s, j))[0];
    if (!job) break;
    const take = Math.min(deedWorkers(s, job), over);
    s.workers[job] = deedWorkers(s, job) - take;
    over -= take;
  }

  // И невольников может оказаться меньше, чем стоит по местам: тем же порядком,
  // с самого многолюдного дела.
  let bondedOver = -bondedIdleRaw(s);
  while (bondedOver > 0) {
    const job = staffedDeeds(s, (j) => deedBonded(s, j))[0];
    if (!job) break;
    const take = Math.min(deedBonded(s, job), bondedOver);
    s.bondedWork[job] = deedBonded(s, job) - take;
    if ((s.bondedWork[job] ?? 0) <= 0) delete s.bondedWork[job];
    bondedOver -= take;
  }
}

/** Свободные руки без нижней отсечки: отрицательное значение — перебор назначений. */
function idleCountRaw(s: GameState): number {
  let busy = 0;
  for (const job of PLACED_JOBS) busy += deedWorkers(s, job);
  for (const job of FREE_JOBS) busy += freeJobCount(s, job);
  return s.pop - busy;
}

/** Невольники без места, без нижней отсечки: отрицательное — перебор назначений. */
function bondedIdleRaw(s: GameState): number {
  let busy = 0;
  for (const job of PLACED_JOBS) busy += deedBonded(s, job);
  return bondedTotal(s) - busy;
}

/** Рассаживает свободные руки по пустым местам дел, по кругу и понемногу. */
export function autoAssign(s: GameState): void {
  for (const b of s.buildings) {
    for (const job of jobsOf(b.type)) {
      const room = deedSlots(b) - deedHands(s, job);
      if (room <= 0) continue;
      const free = idleCount(s);
      if (free <= 0) return;
      s.workers[job] = deedWorkers(s, job) + Math.min(room, free);
    }
  }
}
