// Прогон партии автопилотом: за сколько посёлок доходит до потолка населения и
// до потолка уровней, и что при этом делает зима.
//
// Нужен он ровно затем, зачем `battle:report` нужен бою: масштаб населения и цены
// улучшений связаны нелинейно, и на глаз их не подобрать. Меняешь числа в
// `data/buildings.ts`, `constants.ts` или `data/jobs.ts` — смотри отчёт.
//
//   npm run pop:report            — обычный прогон
//   HOURS=12 STEP=2 npm run pop:report
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { assignWorker } from '@/game/sim/workers';
import { seeded, setRandom } from '@/game/sim/random';
import {
  buildingOfType,
  buildingSlots,
  foodConsumptionPerDay,
  heatingWoodPerDay,
  housingCapacity,
  netPerDay,
  productionPerDay,
  seasonOf,
  storageCap,
  yearOf,
} from '@/game/derived';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';
import { pilot, player, staff } from './autopilot';
import { upkeepSection } from './pop-upkeep';

const HOURS = Number(process.env.HOURS ?? 10);
/** Как часто автопилот принимает решения, игровых секунд; тем же тактом пульсует мир. */
const STEP = Number(process.env.STEP ?? 15);
/**
 * Мир партии — тихий: логова набегов на дом не шлют. Отчёт меряет темп хозяйства при идеальной игре, и
 * набег без войска у автопилота был бы не темпом, а грабежом. Веру деревне мир называет, как в игре.
 */
const WORLD = 7;

const maxed = (s: GameState): boolean =>
  s.buildings.every((b) => b.level >= (BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL));

const hm = (sec: number): string => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`;
};

async function main(): Promise<void> {
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

  console.log(`Прогон ${HOURS} ч игрового времени, шаг автопилота ${STEP} с. Общий автопилот: живая игра при игроке, ответы на события,`);
  console.log(`вера мира ${WORLD} (мир тихий: набегов на дом нет), налог партии как есть.\n`);
  console.log('  время | день | сезон  |  люди | жильё | места | ур.ср | еда/д | склад');
  console.log('  ------|------|--------|-------|-------|-------|-------|-------|-------');

  let nextReport = 0;
  const each = (s: GameState): void => {
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
  };
  const flown = await pilot({
    g: s,
    seconds: total,
    player: player(null),
    world: { seed: WORLD, pulse: STEP, raids: false },
    economy: 'live',
    tick: 1,
    decide: STEP,
    watch: { after: ({ g }) => each(g) },
  });
  console.log(`\nВера деревни: ${s.faith.id ?? 'нет'}; событий разобрано ответом игрока: ${flown.ledger.answered}.`);

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

  await upkeepSection();
}

await main();
