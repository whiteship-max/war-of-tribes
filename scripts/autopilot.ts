// Автопилот партии — идеальный игрок, общий для отчётов.
//
// Живёт отдельным модулем, потому что им меряют двое: `pop:report` (за сколько
// посёлок доходит до потолка) и `sack:report` (во что обходится взятый город —
// отставание от партии, которую не трогали). Две копии автопилота дали бы два
// разных «идеальных игрока», и числа двух отчётов перестали бы сравниваться.
import type { BuildingTypeId, GameState, JobId } from '@/game/types';
import { startUpgrade } from '@/game/sim/actions';
import { assignWorker, changeFreeJob, unassignWorker } from '@/game/sim/workers';
import {
  buildingOfType,
  buildingSlots,
  housingCapacity,
  idleCount,
  isSite,
  jobCounts,
  storageCap,
  workerCount,
} from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';

/** Доли населения по работам: хозяйство большого посёлка. */
export const SHARE: [JobId, number][] = [
  ['woodcutter', 0.22],
  ['gatherer', 0.14],
  ['farmer', 0.14],
  ['hunter', 0.12],
  ['stonecutter', 0.12],
  ['miner', 0.08],
  ['herder', 0.05],
  ['crafter', 0.05],
  ['smith', 0.02],
  ['priest', 0.01],
];

const jobBuilding = (s: GameState, job: JobId) =>
  s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job) ?? null;

/** Держит на каждой работе примерно свою долю племени. */
export function staff(s: GameState): void {
  const counts = jobCounts(s);
  // Пятую часть держим свободной: стройка идёт их руками.
  const spare = Math.max(2, Math.round(s.pop * 0.2));
  for (const [job, share] of SHARE) {
    const want = Math.max(0, Math.round((s.pop - spare) * share));
    const have = counts[job];
    const b = jobBuilding(s, job);
    if (have > want) {
      const over = have - want;
      if (b && workerCount(s, b.id) > 0) unassignWorker(s, b.id, over);
      else changeFreeJob(s, job, -over);
    } else if (have < want) {
      const need = Math.min(want - have, idleCount(s) - spare);
      if (need > 0 && b) assignWorker(s, b.id, need);
    }
  }
}

/** Что улучшать дальше: жильё, склад, потом самое отстающее. */
export function build(s: GameState): void {
  if (s.buildings.some(isSite)) return;
  const cap = housingCapacity(s);
  // Жильё — узкое место: пока селить некуда, племя стоит.
  if (s.pop >= cap - 20) {
    for (const t of ['houses', 'town_hall'] as BuildingTypeId[]) {
      const b = buildingOfType(s, t)!;
      if (startUpgrade(s, b.id) === null) return;
    }
  }
  // Что-то упёрлось в склад — поднимаем вместимость.
  const room = storageCap(s);
  if (RESOURCE_IDS.some((r) => s.resources[r] >= room - 1)) {
    if (startUpgrade(s, buildingOfType(s, 'storage')!.id) === null) return;
  }
  // Мест работы должно хватать на людей.
  const slots = s.buildings.reduce((n, b) => n + buildingSlots(b), 0);
  if (slots < s.pop) {
    const byJob = [...s.buildings]
      .filter((b) => BUILDING_BY_ID[b.type].job)
      .sort((a, b) => a.level - b.level);
    for (const b of byJob) if (startUpgrade(s, b.id) === null) return;
  }
  for (const b of [...s.buildings].sort((a, b) => a.level - b.level)) {
    if (startUpgrade(s, b.id) === null) return;
  }
}
