// Прогон партии автопилотом: за сколько посёлок доходит до потолка населения и
// до потолка уровней, и что при этом делает зима.
//
// Нужен он ровно затем, зачем `battle:report` нужен бою: масштаб населения и цены
// улучшений связаны нелинейно, и на глаз их не подобрать. Меняешь числа в
// `data/buildings.ts`, `constants.ts` или `data/jobs.ts` — смотри отчёт.
//
//   npm run pop:report            — обычный прогон
//   HOURS=12 STEP=2 npm run pop:report
import type { BuildingTypeId, GameState, JobId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { catchUp } from '@/game/sim/tick';
import { startUpgrade } from '@/game/sim/actions';
import { assignWorker, changeFreeJob, unassignWorker } from '@/game/sim/workers';
import { seeded, setRandom } from '@/game/sim/random';
import {
  buildingOfType,
  buildingSlots,
  foodConsumptionPerDay,
  heatingWoodPerDay,
  housingCapacity,
  idleCount,
  isSite,
  jobCounts,
  netPerDay,
  productionPerDay,
  seasonOf,
  storageCap,
  workerCount,
  yearOf,
} from '@/game/derived';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';

const HOURS = Number(process.env.HOURS ?? 10);
/** Как часто автопилот принимает решения, игровых секунд. */
const STEP = Number(process.env.STEP ?? 15);

/** Доли населения по работам: хозяйство большого посёлка. */
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

/** Держит на каждой работе примерно свою долю племени. */
function staff(s: GameState): void {
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
function build(s: GameState): void {
  if (s.buildings.some(isSite)) return;
  const cap = housingCapacity(s);
  // Жильё — узкое место: пока селить некуда, племя стоит.
  if (s.pop >= cap - 20) {
    for (const t of ['houses', 'chief_house'] as BuildingTypeId[]) {
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

const maxed = (s: GameState): boolean =>
  s.buildings.every((b) => b.level >= (BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL));

const hm = (sec: number): string => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`;
};

function main(): void {
  setRandom(seeded(1));
  const s = createInitialState();
  s.tutorialDone = true;
  const total = HOURS * 3600;

  const marks = [100, 200, 300, 400, 500, 600, 700, 800];
  const hit = new Map<number, number>();
  let allMaxed: number | null = null;
  let popCap: number | null = null;
  // Зимние отметки: сколько народу перед зимой и сколько после.
  const winters: { year: number; before: number; after: number; food: number; wood: number }[] = [];
  let winter: { year: number; before: number } | null = null;

  console.log(`Прогон ${HOURS} ч игрового времени, шаг автопилота ${STEP} с.\n`);
  console.log('  время | день | сезон  |  люди | жильё | места | ур.ср | еда/д | склад');
  console.log('  ------|------|--------|-------|-------|-------|-------|-------|-------');

  let nextReport = 0;
  for (let t = 0; t < total; t += STEP) {
    staff(s);
    build(s);
    catchUp(s, STEP, 1);

    for (const m of marks) if (!hit.has(m) && s.pop >= m) hit.set(m, s.time);
    if (allMaxed === null && maxed(s)) allMaxed = s.time;
    if (popCap === null && s.pop >= housingCapacity(s) - 5 && maxed(s)) popCap = s.time;

    const season = seasonOf(s.time);
    if (season === 'winter' && !winter) winter = { year: yearOf(s.time), before: s.pop };
    if (season !== 'winter' && winter) {
      winters.push({
        year: winter.year,
        before: winter.before,
        after: s.pop,
        food: Math.round(s.resources.food),
        wood: Math.round(s.resources.wood),
      });
      winter = null;
    }

    if (s.time >= nextReport) {
      nextReport += 20 * DAY_LENGTH;
      const slots = s.buildings.reduce((n, b) => n + buildingSlots(b), 0);
      const avg = (s.buildings.reduce((n, b) => n + b.level, 0) / s.buildings.length).toFixed(1);
      const row = [
        hm(s.time).padStart(7),
        String(Math.floor(s.time / DAY_LENGTH) + 1).padStart(4),
        season.padEnd(6),
        String(s.pop).padStart(5),
        String(housingCapacity(s)).padStart(5),
        String(slots).padStart(5),
        avg.padStart(5),
        netPerDay(s).food.toFixed(0).padStart(5),
        String(Math.round(RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0))).padStart(6),
      ];
      console.log(`  ${row.join(' | ')}`);
    }
  }

  console.log('\nОтметки населения:');
  for (const m of marks) {
    const at = hit.get(m);
    console.log(`  ${String(m).padStart(4)} чел. — ${at !== undefined ? hm(at) : 'не дошли'}`);
  }
  console.log(`\nВсе здания на потолке: ${allMaxed !== null ? hm(allMaxed) : 'не дошли'}`);
  console.log(`Потолок населения при полном посёлке: ${popCap !== null ? hm(popCap) : 'не дошли'}`);
  console.log(`Итог: ${s.pop} чел. при жилье на ${housingCapacity(s)}, средний уровень ${(s.buildings.reduce((n, b) => n + b.level, 0) / s.buildings.length).toFixed(1)}`);
  console.log(`Смертей за партию: ${s.stats.died}, прибавилось: ${s.stats.born}`);

  console.log('\nЗимы (население до и после, остаток еды и дров):');
  for (const w of winters) {
    const sign = w.after >= w.before ? '+' : '';
    console.log(
      `  год ${w.year}: ${w.before} → ${w.after} (${sign}${w.after - w.before}), еда ${w.food}, дрова ${w.wood}`,
    );
  }

  // Зима на разных этапах: сколько посёлок съедает и добывает в самый тяжёлый
  // сезон при дружине в треть населения. Отвечает на вопрос «зима осталась
  // задачей или стала строкой расходов».
  console.log('\nЗима при дружине в треть населения (год 2, без смягчения):');
  console.log('  уровни | люди | дружина | еда добыча | еда расход | баланс | дрова | лес добыча | дрова, % леса');
  for (const level of [2, 4, 6, 8, MAX_BUILDING_LEVEL]) {
    const w = createInitialState();
    w.tutorialDone = true;
    for (const def of BUILDINGS) {
      const b = w.buildings.find((x) => x.type === def.id)!;
      b.level = Math.min(level, def.maxLevel ?? MAX_BUILDING_LEVEL);
    }
    w.pop = housingCapacity(w);
    const soldiers = Math.round(w.pop / 3);
    w.army.spearman = soldiers;
    w.morale = 75;
    staff(w);
    // Год 2, зима: смягчения первой зимы нет.
    w.time = (3 + 4) * 5 * DAY_LENGTH;
    const day = productionPerDay(w);
    const prod = day.food;
    const eat = foodConsumptionPerDay(w);
    const heat = heatingWoodPerDay(w);
    // Доля дров от зимней добычи леса — по ней видно, осталось ли отопление задачей.
    const share = day.wood > 0 ? (heat / day.wood) * 100 : 100;
    console.log(
      `  ${String(level).padStart(6)} | ${String(w.pop).padStart(4)} | ${String(soldiers).padStart(7)} | ` +
        `${prod.toFixed(0).padStart(10)} | ${eat.toFixed(0).padStart(10)} | ${(prod - eat).toFixed(0).padStart(6)} | ` +
        `${heat.toFixed(0).padStart(5)} | ${day.wood.toFixed(0).padStart(10)} | ${share.toFixed(0).padStart(13)}`,
    );
  }

  // То же для племени, которое поставило на земледелие: зимой поле мертво.
  console.log('\nТо же, но ставка на поля (все свободные руки на ферму):');
  for (const level of [4, 6, MAX_BUILDING_LEVEL]) {
    const w = createInitialState();
    w.tutorialDone = true;
    for (const def of BUILDINGS) {
      const b = w.buildings.find((x) => x.type === def.id)!;
      b.level = Math.min(level, def.maxLevel ?? MAX_BUILDING_LEVEL);
    }
    w.pop = housingCapacity(w);
    w.army.spearman = Math.round(w.pop / 3);
    w.morale = 75;
    w.workers = {};
    w.freeJobs = {};
    const farm = buildingOfType(w, 'farm')!;
    const mill = buildingOfType(w, 'sawmill')!;
    assignWorker(w, mill.id, Math.round(w.pop * 0.2));
    assignWorker(w, farm.id, w.pop);
    w.time = (3 + 4) * 5 * DAY_LENGTH;
    const prod = productionPerDay(w).food;
    const eat = foodConsumptionPerDay(w);
    console.log(
      `  уровни ${level}: еда ${prod.toFixed(0)}/д против расхода ${eat.toFixed(0)}/д — ` +
        `на зиму нужно ${(Math.max(0, eat - prod) * 5).toFixed(0)} запаса, ` +
        `склад держит ${storageCap(w)}`,
    );
  }
}

main();
