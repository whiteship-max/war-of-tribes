// Летопись: сколько записей копится за партию и во что это обходится сохранению.
//
// Нужен затем же, зачем `pop:report` нужен населению: обрезка летописи — это
// компромисс между «игрок видит историю» и «сохранение влезает в CloudStorage»,
// и на глаз его не подобрать. Меняешь LOG_MAX_DAYS или LOG_MAX в sim/log.ts —
// смотри отчёт.
//
//   npm run log:report
//   HOURS=4 npm run log:report
import type { GameState, JobId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { catchUp } from '@/game/sim/tick';
import { startUpgrade } from '@/game/sim/actions';
import { assignWorker, changeFreeJob, unassignWorker } from '@/game/sim/workers';
import { seeded, setRandom } from '@/game/sim/random';
import { serialize } from '@/game/save';
import {
  buildingOfType,
  dayOf,
  housingCapacity,
  idleCount,
  isSite,
  jobCounts,
  storageCap,
  workerCount,
} from '@/game/derived';
import { DAY_LENGTH, MAX_OFFLINE_SECONDS, RESOURCE_IDS } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';

const HOURS = Number(process.env.HOURS ?? 3);
const STEP = Number(process.env.STEP ?? 15);

/** Лимит одного значения Telegram CloudStorage — см. CHUNK в telegram/webapp.ts. */
const CLOUD_CHUNK = 4000;

const SHARE: [JobId, number][] = [
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

function staff(s: GameState): void {
  const counts = jobCounts(s);
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

function build(s: GameState): void {
  if (s.buildings.some(isSite)) return;
  if (s.pop >= housingCapacity(s) - 20) {
    for (const t of ['houses', 'town_hall'] as const) {
      if (startUpgrade(s, buildingOfType(s, t)!.id) === null) return;
    }
  }
  const room = storageCap(s);
  if (RESOURCE_IDS.some((r) => s.resources[r] >= room - 1)) {
    if (startUpgrade(s, buildingOfType(s, 'storage')!.id) === null) return;
  }
  for (const b of [...s.buildings].sort((a, b) => a.level - b.level)) {
    if (startUpgrade(s, b.id) === null) return;
  }
}

/**
 * Размер строки в байтах UTF-8 (столько уедет по сети и столько займёт файл) и
 * в кодовых единицах UTF-16 (столько считает localStorage и CloudStorage).
 * Для кириллицы это вдвое разные числа, и путать их нельзя.
 */
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const kb = (n: number): string => `${(n / 1024).toFixed(1)} КБ`;

function report(title: string, s: GameState): void {
  const whole = serialize(s);
  const logJson = JSON.stringify(s.log);
  const day = dayOf(s.time);
  const oldest = s.log.length ? Math.min(...s.log.map((e) => dayOf(e.at))) : day;
  const perEntry = s.log.length ? bytes(logJson) / s.log.length : 0;

  console.log(`\n${title}`);
  console.log(`  день партии            ${day}`);
  console.log(`  записей в летописи     ${s.log.length}`);
  console.log(`  самая старая запись    день ${oldest} (возраст ${day - oldest} дн.)`);
  console.log(`  одна запись            ${perEntry.toFixed(0)} байт utf-8`);
  console.log(`  летопись               ${kb(bytes(logJson))} utf-8 · ${logJson.length} символов`);
  console.log(`  всё сохранение         ${kb(bytes(whole))} utf-8 · ${whole.length} символов`);
  console.log(`  доля летописи          ${((logJson.length / whole.length) * 100).toFixed(0)}%`);
  console.log(`  чанков CloudStorage    ${Math.ceil(whole.length / CLOUD_CHUNK)} по ${CLOUD_CHUNK} символов`);
}

function play(hours: number): GameState {
  setRandom(seeded(7));
  const s = createInitialState();
  s.tutorialDone = true;
  for (let t = 0; t < hours * 3600; t += STEP) {
    staff(s);
    build(s);
    catchUp(s, STEP, 1);
  }
  return s;
}

function main(): void {
  console.log(`Летопись: прогон ${HOURS} ч игрового времени (${Math.round((HOURS * 3600) / DAY_LENGTH)} игровых дней).`);
  console.log(`Один игровой день = ${DAY_LENGTH} с реального времени.`);

  const s = play(HOURS);
  report(`Активная игра, ${HOURS} ч подряд:`, s);

  // Возвращение из офлайна: догон съедает MAX_OFFLINE_SECONDS одним куском и
  // пишет в летопись за все пропущенные дни разом. Это худший случай для обрезки
  // по возрасту — проверять надо именно его.
  const offlineDays = Math.round(MAX_OFFLINE_SECONDS / DAY_LENGTH);
  const o = play(HOURS);
  catchUp(o, MAX_OFFLINE_SECONDS, 2);
  report(`После офлайн-догона на ${MAX_OFFLINE_SECONDS / 3600} ч (${offlineDays} игровых дней):`, o);

  // Партия подлиннее: докуда доходит счётчик, если играть не отрываясь.
  const long = play(HOURS * 3);
  report(`Активная игра, ${HOURS * 3} ч подряд:`, long);
}

main();
