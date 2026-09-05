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
import { catchUp, tick } from '@/game/sim/tick';
import { resolveEvent, startUpgrade } from '@/game/sim/actions';
import { setForging } from '@/game/sim/smithy';
import { startRecruit } from '@/game/sim/army';
import { assignWorker, changeFreeJob, unassignWorker } from '@/game/sim/workers';
import { seeded, setRandom } from '@/game/sim/random';
import { serialize } from '@/game/save';
import { LOG_MAX, LOG_MAX_DAYS } from '@/game/sim/log';
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
  const oldest = s.log.reduce((m, e) => Math.min(m, dayOf(e.at)), day);
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
  // Во что обойдётся запасной предел, если в него упрутся. Считается от
  // измеренного размера записи этой же партии, а не от числа на глаз.
  if (perEntry > 0) {
    const worst = perEntry * LOG_MAX;
    const worstChars = (logJson.length / s.log.length) * LOG_MAX;
    console.log(
      `  предел ${LOG_MAX} записей     ${kb(worst)} utf-8 · ${Math.round(worstChars)} символов · ` +
        `${Math.ceil((whole.length - logJson.length + worstChars) / CLOUD_CHUNK)} чанков`,
    );
  }
  console.log(`  записей в игровой день ${perDay(s).toFixed(1)}, в самый плотный день ${peakDay(s)}`);
  // Предел по количеству обязан не срабатывать: сработал — значит ступень
  // «за месяц» показала меньше месяца, и обещание нарушено молча.
  if (s.log.length >= LOG_MAX) {
    console.log('  ВНИМАНИЕ: упёрлись в запасной предел — «за месяц» покажет меньше месяца.');
  }
}

/**
 * Партия, которая не только строит, но и живёт: кузница всё время под нарядом,
 * казармы набирают, события поднимаются и разрешаются. Без этого отчёт мерил
 * тишину — а летопись раздувают именно ковка и наём, по строке на предмет и на
 * бойца, и именно они решают, каким должен быть предел.
 */
function play(hours: number, offline: boolean): GameState {
  setRandom(seeded(7));
  const s = createInitialState();
  s.tutorialDone = true;
  let nextHire = 0;
  for (let t = 0; t < hours * 3600; t += STEP) {
    staff(s);
    build(s);
    // Кузнец без наряда молчит, а с нарядом пишет строку на каждый предмет.
    if (!s.forging) setForging(s, 'spear');
    if (s.recruits.length === 0 && s.time >= nextHire) {
      startRecruit(s, 'spearman', 5);
      nextHire = s.time + 10 * DAY_LENGTH;
    }
    if (offline) {
      catchUp(s, STEP, 1);
    } else {
      // Живая игра: события поднимаются (offline их придерживает) и игрок их
      // разбирает — иначе одно повисшее событие затыкает все следующие.
      tick(s, STEP);
      if (s.activeEvent) resolveEvent(s, 0);
    }
  }
  return s;
}

/** Записей в игровой день внутри окна хранения — темп, а не остаток. */
function perDay(s: GameState): number {
  const day = dayOf(s.time);
  const oldest = s.log.reduce((m, e) => Math.min(m, dayOf(e.at)), day);
  return s.log.length / Math.max(1, day - oldest + 1);
}

/** Кто наполняет летопись: без этого не понять, что резать. */
function sources(s: GameState): [string, number][] {
  const by = new Map<string, number>();
  for (const e of s.log) {
    const k = e.text.replace(/\d+([.,]\d+)?/g, 'N').slice(0, 44);
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

/** Самый плотный игровой день окна — пик, который обязан выдержать предел. */
function peakDay(s: GameState): number {
  const n = new Map<number, number>();
  for (const e of s.log) n.set(dayOf(e.at), (n.get(dayOf(e.at)) ?? 0) + 1);
  return [...n.values()].reduce((m, x) => Math.max(m, x), 0);
}

function main(): void {
  console.log(`Летопись: прогон ${HOURS} ч игрового времени (${Math.round((HOURS * 3600) / DAY_LENGTH)} игровых дней).`);
  console.log(`Один игровой день = ${DAY_LENGTH} с реального времени.`);
  console.log(`Правило обрезки: старше ${LOG_MAX_DAYS} игровых дней выбрасывается, запасной предел ${LOG_MAX} записей.`);

  const s = play(HOURS, false);
  report(`Активная игра, ${HOURS} ч подряд:`, s);
  console.log('\n  Кто наполняет летопись:');
  for (const [text, n] of sources(s)) console.log(`  ${String(n).padStart(4)} × ${text}`);

  // Возвращение из офлайна: догон съедает MAX_OFFLINE_SECONDS одним куском и
  // пишет в летопись за все пропущенные дни разом. Это худший случай для обрезки
  // по возрасту — проверять надо именно его.
  const offlineDays = Math.round(MAX_OFFLINE_SECONDS / DAY_LENGTH);
  const o = play(HOURS, false);
  catchUp(o, MAX_OFFLINE_SECONDS, 2);
  report(`После офлайн-догона на ${MAX_OFFLINE_SECONDS / 3600} ч (${offlineDays} игровых дней):`, o);

  // Партия подлиннее: докуда доходит счётчик, если играть не отрываясь.
  const long = play(HOURS * 3, false);
  report(`Активная игра, ${HOURS * 3} ч подряд:`, long);
  console.log('\n  Кто наполняет летопись:');
  for (const [text, n] of sources(long)) console.log(`  ${String(n).padStart(4)} × ${text}`);
}

main();
