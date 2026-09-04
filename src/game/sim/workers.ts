// Кто где работает. Единственный источник правды — сам житель: job + workplace.
// Список рабочих здания собирается перебором жителей, дублирующего массива нет.
import type { GameState, JobId, Villager } from '../types';
import { BUILDING_BY_ID } from '../data/buildings';
import { JOB_BY_ID } from '../data/jobs';
import { buildingById, buildingSlots, isBuilt, workerCount } from '../derived';

/** Свободный житель под работу: сначала тот, у кого к ней талант. */
function takeFree(s: GameState, job: JobId, villagerId?: number): Villager | null {
  const free = s.villagers.filter((v) => v.job === 'idle');
  if (free.length === 0) return null;
  if (villagerId !== undefined) return free.find((v) => v.id === villagerId) ?? null;
  return free.find((v) => v.talent === job) ?? free[0];
}

/** Кого снять с работы первым: того, кому она не по таланту. */
function takeWorker(pool: Villager[], job: JobId): Villager | null {
  if (pool.length === 0) return null;
  return pool.find((v) => v.talent !== job) ?? pool[pool.length - 1];
}

/** Ставит жителя на свободный слот здания. Без villagerId берёт самого подходящего. */
export function assignWorker(s: GameState, buildingId: number, villagerId?: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const def = BUILDING_BY_ID[b.type];
  if (!def.job) return 'В этом здании не работают.';
  if (!isBuilt(b)) return 'Здание ещё строится.';
  if (workerCount(s, b.id) >= buildingSlots(b)) return 'Все места заняты — нужен уровень выше.';
  const v = takeFree(s, def.job, villagerId);
  if (!v) return villagerId === undefined ? 'Нет свободных жителей.' : 'Житель занят.';
  v.job = def.job;
  v.workplace = b.id;
  return null;
}

/** Снимает рабочего со здания. Без villagerId — того, кому работа не по таланту. */
export function unassignWorker(s: GameState, buildingId: number, villagerId?: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const pool = s.villagers.filter((v) => v.workplace === buildingId);
  const v =
    villagerId !== undefined
      ? pool.find((x) => x.id === villagerId) ?? null
      : takeWorker(pool, BUILDING_BY_ID[b.type].job ?? 'idle');
  if (!v) return 'Здесь никто не работает.';
  v.job = 'idle';
  v.workplace = null;
  return null;
}

/**
 * «Вольный сбор» у костра: профессия без профильного здания. Работает вполсилы,
 * но доступна всегда — иначе игрок без здания остаётся без дохода.
 */
export function changeFreeJob(s: GameState, job: JobId, delta: 1 | -1): string | null {
  const def = JOB_BY_ID[job];
  if (!def.freeRange) return 'Эту работу дают только в здании.';
  if (delta > 0) {
    const v = takeFree(s, job);
    if (!v) return 'Нет свободных жителей.';
    v.job = job;
    v.workplace = null;
    return null;
  }
  const pool = s.villagers.filter((v) => v.job === job && v.workplace === null);
  const v = takeWorker(pool, job);
  if (!v) return 'Никто не занят этой работой.';
  v.job = 'idle';
  return null;
}

/**
 * Приводит назначения в порядок после любых изменений мира: сгоревшее здание,
 * лишние рабочие в слотах. Вызывается каждый тик — дёшево.
 */
export function normalizeAssignments(s: GameState): void {
  const used = new Map<number, number>();
  for (const v of s.villagers) {
    if (v.job === 'idle') {
      v.workplace = null;
      continue;
    }
    const def = JOB_BY_ID[v.job];
    if (v.workplace !== null) {
      const b = buildingById(s, v.workplace);
      const slots = b ? buildingSlots(b) : 0;
      const n = used.get(v.workplace) ?? 0;
      if (!b || !isBuilt(b) || BUILDING_BY_ID[b.type].job !== v.job || n >= slots) {
        v.workplace = null;
      } else {
        used.set(v.workplace, n + 1);
      }
    }
    // Без места работы остаётся только вольный сбор; остальные возвращаются к костру.
    if (v.workplace === null && !def.freeRange) v.job = 'idle';
  }
}

/** Рассаживает свободных жителей по пустым слотам — нужно после миграции сохранения. */
export function autoAssign(s: GameState): void {
  for (const b of s.buildings) {
    const def = BUILDING_BY_ID[b.type];
    if (!def.job || !isBuilt(b)) continue;
    while (workerCount(s, b.id) < buildingSlots(b)) {
      // Сначала пробуем перевести того, кто уже работает по этой профессии вольно.
      const free = s.villagers.find((v) => v.job === def.job && v.workplace === null);
      if (free) {
        free.workplace = b.id;
        continue;
      }
      if (assignWorker(s, b.id) !== null) break;
    }
  }
}
