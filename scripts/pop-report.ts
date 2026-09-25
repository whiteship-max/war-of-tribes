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
import {
  ADMIN_LEVELS,
  MAX_RULER_SKILL,
  MEAN_RULER_SKILL,
  MIN_RULER_SKILL,
  WAR_CAPTIVES_LEVEL,
  WAR_GEAR_ORDER,
  WAR_LEVELS,
  adminCeiling,
  levelPrice,
  pointsPerDay,
  startingPoints,
  warLevelOfGear,
  warLevelOfTroop,
} from '@/game/data/realm';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { shieldVillagers } from '@/world/lairs';
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

const pad = (x: string | number, w: number): string => String(x).padStart(w);

const hm = (sec: number): string => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`;
};

/**
 * Административный потолок против того, когда посёлок его просит. Прибор шага 4
 * (docs/dynasty.md, пачка 0): административная ветвь режет уровень построек, и вопрос у неё
 * один — успевает ли потолок к тому дню, когда посёлок дорос до него сам.
 *
 * Сравнивается с НАИБОЛЬШИМ уровнем построек, а не со средним: режет потолок именно его.
 * Своих чисел у раздела нет — расписание считает `game/data/realm.ts`, дугу посёлка даёт этот
 * же прогон. Гейта в игре пока нет, поэтому прогон идёт без него, и это сказано в выводе:
 * раздел отвечает «успел бы», а не «что случилось».
 *
 * Накопление считается от начального котла (`startingPoints`), как у военной лестницы ниже:
 * партия начинается с очками ровно на первый покупаемый уровень. Без этого каждая ступень
 * приходила бы на `startingPoints / навык` игровых дней позже, чем в игре (docs/weights.md, место 9).
 */
function adminSection(asked: Map<number, number>, allMaxed: number | null): void {
  const skills = [MIN_RULER_SKILL, MEAN_RULER_SKILL, MAX_RULER_SKILL];
  console.log('\nАдминистративный потолок против того, когда посёлок его просит (docs/dynasty.md, раздел 4.3).');
  console.log('Прогон идёт БЕЗ гейта — он ещё не заведён; раздел отвечает «успел бы потолок», а не «что случилось».');
  console.log('«просит» — день, на который НАИБОЛЬШИЙ уровень построек дорос до этого потолка: режет потолок его, а не средний.');
  console.log(`  ур | потолок | очков | ${skills.map((k) => `навык ${k}`).join(' | ')} | просит | запас при навыке ${MEAN_RULER_SKILL}`);
  const late = new Map<number, { count: number; worst: number; at: number }>();
  for (const k of skills) late.set(k, { count: 0, worst: 0, at: 0 });
  let cum = 0;
  let last = 0;
  for (let l = 1; l <= ADMIN_LEVELS; l++) {
    cum += levelPrice('admin', l);
    const need = Math.max(0, cum - startingPoints('admin'));
    const ceil = adminCeiling(l);
    const want = asked.get(ceil);
    const wantDay = want !== undefined ? want / DAY_LENGTH : null;
    for (const k of skills) {
      const gap = wantDay === null ? 0 : wantDay - need / pointsPerDay(k);
      if (gap < 0) {
        const row = late.get(k)!;
        row.count++;
        if (-gap > row.worst) {
          row.worst = -gap;
          row.at = ceil;
        }
      }
    }
    const cells = skills.map((k) => pad((need / pointsPerDay(k)).toFixed(0), 7));
    const mine = need / pointsPerDay(MEAN_RULER_SKILL);
    last = mine;
    const gap = wantDay === null ? null : wantDay - mine;
    console.log(
      `  ${String(l).padStart(2)} | ${String(ceil).padStart(7)} | ${String(cum).padStart(5)} | ${cells.join(' | ')} | ` +
        `${(wantDay === null ? 'не дошли' : wantDay.toFixed(0)).padStart(6)} | ` +
        `${gap === null ? '—' : `${gap >= 0 ? '+' : ''}${gap.toFixed(0)} игр. дн.`}`,
    );
  }
  for (const k of skills) {
    const row = late.get(k)!;
    console.log(
      `  Навык ${k}: потолок опоздал бы на ${row.count} ступенях из ${ADMIN_LEVELS}` +
        (row.count > 0 ? `; хуже всех потолок ${row.at} — на ${row.worst.toFixed(0)} игровых дней` : ''),
    );
  }
  // Главное число раздела: растягивает ли гейт всю дугу. Последний потолок против того дня, на
  // который посёлок без гейта довёл ДО потолка все двадцать четыре постройки, а не одну ведущую.
  const whole = allMaxed !== null ? allMaxed / DAY_LENGTH : null;
  console.log(
    `  Последний потолок при навыке ${MEAN_RULER_SKILL} — день ${last.toFixed(0)}; все постройки на потолке без гейта — ` +
      `${whole === null ? 'не дошли за прогон' : `день ${whole.toFixed(0)}`}.`,
  );
  if (whole !== null) {
    console.log(
      `  Последняя ступень приходит за ${(whole - last).toFixed(0)} игровых дней до конца дуги: ` +
        `${last <= whole ? 'по этому числу всю дугу гейт не удлиняет — он меняет порядок роста, а не его срок' : 'ДУГУ ОН УДЛИНЯЕТ'}.`,
    );
  }
  console.log(
    '  Все числа очков — `game/data/realm.ts`; «просит» и дуга — этот прогон. Единица — игровой день; ' +
      'накопление считается от начального котла `startingPoints`.',
  );
  console.log('  Что здесь НЕ измерено: как пойдёт дуга, когда гейт вправду встанет в игру, — это приёмка пачки 4.');
}

/**
 * Военная лестница против защиты новичка. Прибор пачки 3 (docs/dynasty.md, раздел 4.2):
 * военная ветвь открывает вещи кузницы в порядке их работы, а вид бойца — когда открыто
 * всё, что он носит. Вопрос у раздела один и он про новичка: **чем он воюет к той минуте,
 * когда защита новичка кончается и логова бьют полной силой.**
 *
 * Защита считается от жителей (`world/lairs.shieldVillagers`), а лестница — от игровых
 * дней, поэтому двух мерок тут не сводят на глаз: день, на который дуга этого прогона
 * пересекла порог, берётся из самого прогона.
 *
 * Своих чисел у раздела нет: цены и уровни — `game/data/realm.ts`, пороги защиты —
 * `world/data/tuning.ts`, дуга — этот прогон. Накопление считается от начального котла
 * (`startingPoints`): партия начинается с очками ровно на первый покупаемый уровень.
 */
function warSection(shield: (number | null)[]): void {
  const skills = [MIN_RULER_SKILL, MEAN_RULER_SKILL, MAX_RULER_SKILL];
  const [from, full] = shield;
  const fromDay = from === null ? null : from / DAY_LENGTH;
  const fullDay = full === null ? null : full / DAY_LENGTH;
  console.log('');
  console.log('Военная лестница против защиты новичка (docs/dynasty.md, раздел 4.2).');
  console.log('Гейт в игре есть, но этого прогона он не касается: его игрок не кует и не нанимает, и дуга посёлка от ветви не зависит.');
  console.log('Раздел отвечает «что успел бы открыть игрок с таким правителем», а не «что случилось»; что случается — `raid-hiring:report`, раздел Б.');
  console.log(
    `Защита новичка: логово бьёт вполсилы до ${shieldVillagers(0)} жителей и полной силой с ${shieldVillagers(1)}; ` +
      `дуга этого прогона доходит до них на днях ${fromDay === null ? 'не дошли' : fromDay.toFixed(0)} и ${fullDay === null ? 'не дошли' : fullDay.toFixed(0)}.`,
  );
  console.log(`  ур | вещь      | виды                        | цена | всего | ${skills.map((k) => `навык ${k}`).join(' | ')}`);
  let cum = 0;
  const open = new Map<number, number>();
  for (let l = 1; l <= WAR_LEVELS; l++) {
    cum += levelPrice('war', l);
    const need = Math.max(0, cum - startingPoints('war'));
    for (const k of skills) if (!open.has(k * 1000 + l)) open.set(k * 1000 + l, need / pointsPerDay(k));
    const item = WAR_GEAR_ORDER.find((g) => warLevelOfGear(g) === l);
    const troops = TROOP_IDS.filter((t) => warLevelOfTroop(t) === l).map((t) => TROOP_BY_ID[t].name.toLowerCase());
    const what = l === WAR_CAPTIVES_LEVEL ? ['участь «увести людей»'] : troops;
    console.log(
      `  ${String(l).padStart(2)} | ${(item ? EQUIPMENT_BY_ID[item].one : '—').padEnd(9)} | ${(what.join(', ') || '—').padEnd(27)} | ` +
        `${String(levelPrice('war', l)).padStart(4)} | ${String(cum).padStart(5)} | ` +
        skills.map((k) => (need / pointsPerDay(k)).toFixed(0).padStart(7)).join(' | '),
    );
  }
  // Главный ответ раздела: какой уровень ветви открыт в ту минуту, когда защита кончилась.
  if (fullDay !== null) {
    for (const k of skills) {
      let level = 1;
      for (let l = 2; l <= WAR_LEVELS; l++) if ((open.get(k * 1000 + l) ?? Infinity) <= fullDay) level = l;
      const have = TROOP_IDS.filter((t) => warLevelOfTroop(t) <= level);
      console.log(
        `  Навык ${k}: к концу защиты (день ${fullDay.toFixed(0)}) открыт ${level} уровень из ${WAR_LEVELS} — ` +
          `${have.length} видов из ${TROOP_IDS.length}: ${have.map((t) => TROOP_BY_ID[t].name.toLowerCase()).join(', ')}.`,
      );
    }
  }
  console.log('  Единица — игровой день; накопление считается от начального котла `startingPoints`.');
  // Что случается с новичком под гейтом — прорывы, падения, — меряет только `raid-hiring:report`,
  // раздел Б. Здесь этого не вывести: мир прогона тихий, набегов на дом нет, партия не нанимает.
  // Число об этом, вписанное сюда строкой, уже однажды разошлось с разделом Б (docs/weights.md, место 10).
}

async function main(): Promise<void> {
  setRandom(seeded(1));
  // Сид партии закреплён: вести приходят по сетке от `s.seed` (`sim/mail.awayArrival`), а без сида партия
  // берёт его у устройства (`freshSeed`) — и два прогона одного кода расходились (docs/time.md, раздел 16.10).
  const s = createInitialState(7);
  s.tutorialDone = true;
  const total = HOURS * 3600;

  const marks = [100, 200, 300, 400, 500, 600, 700, 800];
  const hit = new Map<number, number>();
  /** Когда дуга пересекла пороги защиты новичка: с этих жителей набег растёт и дорастает до полного. */
  const shieldMarks = [shieldVillagers(0), shieldVillagers(1)];
  const shieldAt = new Map<number, number>();
  /**
   * Когда посёлок впервые просит каждый уровень построек: день, на который его НАИБОЛЬШИЙ
   * уровень дорос до этого числа. Наибольший, а не средний: административная ветвь шага 4
   * режет потолок, и сверять её расписание со средним уровнем значило бы сверять не с тем
   * (docs/dynasty.md, раздел 4.3 — долг этой пачки).
   */
  const asked = new Map<number, number>();
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
    for (const m of shieldMarks) if (!shieldAt.has(m) && s.pop >= m) shieldAt.set(m, s.time);
    const top = s.buildings.reduce((n, b) => Math.max(n, b.level), 0);
    for (let l = 2; l <= top; l++) if (!asked.has(l)) asked.set(l, s.time);
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

  adminSection(asked, allMaxed);
  warSection(shieldMarks.map((m) => shieldAt.get(m) ?? null));

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
