// Разделы прибора `roam:report` (ПН-0ч; ГДД 6.5 и 7.1, ПН-0). Порядок — сначала то, что считается нынешними дверями
// (содержание, курс припаса, повышение, путь, плата), потом автопилот пути на заглушках (сила НПС, престиж, замок, паритет),
// потом карта (пул) и видимость. Входы разделы берут только `ctx.use` (см. `run.ts`); отсюда — одни типы входов.
import type { TroopId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import { baseWage, powerOf, troopPower } from '../../src/game/battle/price';
import { soldierFoodPerDay } from '../../src/game/build';
import { RESOURCE_IDS, TEST_ARMY_FOOD } from '../../src/game/constants';
import { GATE_POWER } from '../../src/game/data/events';
import { GOOD_BY_ID } from '../../src/game/data/market';
import { TROOP_BY_ID, TROOP_IDS } from '../../src/game/data/troops';
import { buyUnit, depthOf, shiftOf } from '../../src/game/marketrules';
import { dayRealSeconds, gameSeconds } from '../../src/game/pace';
import { bandPatienceDays, bandRationPerDay, bandWage, bandWagesPerDay, fieldForage, forageShare } from '../../src/game/roamrules';
import { cargoCap } from '../../src/game/sim/roam';
import { seasonModsFor } from '../../src/game/derived';
import { SEASONS, SEASON_META } from '../../src/game/data/seasons';
import { GAIT_META, GAITS } from '../../src/world/data/gait';
import { UNIT_BY_ID } from '../../src/world/data/units';
import { selfCost } from '../../src/game/selfcost';
import { createInitialState } from '../../src/game/state';
import { menOfPower } from '../../src/world/garrison';
import { BURN_IMMUNE, CASTLE_GOLD_PER_POWER, LAIR_GOLD_PER_POWER, TEST_TRAVEL_SPEED } from '../../src/world/data/tuning';
import type { Gait } from '../../src/world/data/gait';
import { pilot, player } from '../autopilot';
import type { InputId } from './inputs';
import { CAMPS, CAMP_NAME, type Origin } from './kinds';
import type { Ctx, Section } from './run';
import { evenPower, rowMove } from './foes';
import { STYLES, roadHours, runPath, stageOf, type PathKnobs, type PathRun } from './path';
import { placeAll } from './pool';
import { detectShare, landAround, type SightKnobs, type Stand } from './sight';
import { cityValue, type Value, type ValuePrices } from './value';

const pad = (v: string | number, n: number): string => String(v).padStart(n);
const padEnd = (v: string | number, n: number): string => String(v).padEnd(n);
const fix = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)} %` : '—');
const hrs = (h: number): string => (Number.isFinite(h) ? `${h.toFixed(1)} ч` : '—');
const days = (h: number): string => (Number.isFinite(h) ? `${(h / 24).toFixed(2)} сут` : '> срока');

const total = (t: TroopStack): number => Object.values(t).reduce((n: number, v) => n + Math.max(0, v ?? 0), 0);
// Содержание отряда — двери отряда ПН-1 (`roamrules`): жалованье — формула 3.3.2, паёк — паёк бойца на рты, вне сезона.
const wagesOf = (t: TroopStack): number => bandWagesPerDay(t);
const rationOf = (t: TroopStack): number => bandRationPerDay({ band: t, wounded: [] }, 1);
const stackWords = (t: TroopStack): string =>
  (Object.entries(t) as [TroopId, number][])
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${TROOP_BY_ID[id].name.toLowerCase()} ${n}`)
    .join(', ');

/** Медиана (нижняя у чётного числа); бесконечность — «не дошёл», и она честно тянет медиану вверх. */
const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Игровых дней в настоящих сутках — дверь времени. */
const dayGame = (): number => 86400 / dayRealSeconds();

/** Привоз рынка, по которому считается цена города: 12:00 UTC 01.10.2026 — тот же, что у `market:report`. */
const SHIFT = shiftOf(Date.UTC(2026, 9, 1)) + 4;
const townPrice = (r: string, level: number): number => buyUnit(GOOD_BY_ID[r], SHIFT, depthOf(GOOD_BY_ID[r], level), 0);

/** Множитель теста пути числом: пока он литерал 3, сравнение с 1 компилятор считал бы ошибкой. */
const TRAVEL: number = TEST_TRAVEL_SPEED;

/** Окно пути — срок доли дошедших (ГДД 2.4): 14 суток. */
const LIMIT_DAYS = 14;

/** Входы автопилота пути: все, что читают `knobsOf` и происхождения, — раздел, берущий его партии, объявляет их все. */
export const PILOT: readonly InputId[] = [
  'sessions',
  'etalons',
  'upgrade',
  'hire',
  'village',
  'contractRule',
  'npcRule',
  'origins',
  'stages',
  'stageTier',
  'prestigeS',
  'contractK',
  'contractR',
  'contractTerm',
  'foodGold',
  'marks',
  'reach',
  'recruits',
  'forage',
  'foodMix',
  'defeat',
  'castleTiers',
  'board',
  'contracts',
];

export function knobsOf(ctx: Pick<Ctx, 'use'>): PathKnobs {
  ctx.use('contractRule');
  const tiers = ctx.use('castleTiers');
  const stages = ctx.use('stages');
  const food = ctx.use('foodGold');
  return {
    sessions: ctx.use('sessions'),
    stages,
    stageTier: ctx.use('stageTier'),
    S: ctx.use('prestigeS'),
    K: ctx.use('contractK'),
    R: ctx.use('contractR'),
    term: ctx.use('contractTerm'),
    etalonUpkeep: ctx.use('etalons').tiers.map((t) => wagesOf(t) + rationOf(t) * food),
    marks: ctx.use('marks'),
    reach: ctx.use('reach'),
    recruits: ctx.use('recruits'),
    forage: ctx.use('forage'),
    foodMix: ctx.use('foodMix'),
    foodPrice: {
      village: ctx.use('village')('food'),
      town: townPrice('food', 1),
    },
    defeat: ctx.use('defeat'),
    castle: {
      stage: stageOf(stages, tiers[0].prestige),
      power: GATE_POWER.raiders[tiers[0].level - 1],
    },
    upgrade: ctx.use('upgrade'),
    hire: ctx.use('hire'),
    board: ctx.use('board'),
    contracts: ctx.use('contracts'),
    limitDays: LIMIT_DAYS,
  };
}

interface Pilot {
  runs: PathRun[];
  row: number[];
  even: number[];
  knobs: PathKnobs;
  origins: readonly Origin[];
}

const allRuns = (k: PathKnobs, origins: readonly Origin[], row: readonly number[], even: readonly number[], seeds: number): PathRun[] =>
  STYLES.flatMap((st) => origins.flatMap((o) => Array.from({ length: seeds }, (_, i) => runPath(i + 1, st, o, row, even, k))));

/** Эталон ступени — отряд медианной мощи в минуту входа в ступень среди партий, что в неё вошли. */
const refsOf = (runs: readonly PathRun[], stages: number): (TroopStack | null)[] =>
  Array.from({ length: stages }, (_, s) => {
    const bands = runs.map((r) => r.bandAt[s]).filter((b): b is TroopStack => b !== null && total(b) > 0);
    if (bands.length === 0) return null;
    const sorted = [...bands].sort((a, b) => troopPower(a) - troopPower(b));
    return sorted[Math.floor((sorted.length - 1) / 2)];
  });

// ---------- разделы ----------

const pay: Section = {
  id: 'pay',
  title: 'Содержание эталонов тира',
  gdd: '4.3, 3.3.2',
  doors: ['roamrules.bandWagesPerDay', 'roamrules.bandRationPerDay', 'price.powerOf', 'build.soldierFoodPerDay', 'pace.dayRealSeconds'],
  uses: ['etalons'],
  run(ctx) {
    ctx.line(`игровых дней в настоящих сутках — ${dayGame()}; паёк бойца — ${soldierFoodPerDay(1, 1)} еды за игр. день (TEST_ARMY_FOOD = ${TEST_ARMY_FOOD})`);
    ctx.line(`${padEnd('вид', 16)} ${pad('жалованье', 10)} ${pad('паёк', 6)} ${pad('мощь', 6)}   (за игровой день, на голову)`);
    for (const id of TROOP_IDS) {
      ctx.line(`${padEnd(TROOP_BY_ID[id].name, 16)} ${pad(fix(baseWage(id)), 10)} ${pad(fix(rationOf({ [id]: 1 }), 1), 6)} ${pad(fix(powerOf(id), 1), 6)}`);
    }
    ctx.line('');
    ctx.line(
      `${padEnd('тир', 4)} ${pad('людей', 6)} ${pad('мощь', 7)} ${pad('жалованье/игр.дн', 17)} ${pad('еда/игр.дн', 11)} ${pad('жалованье/сут', 14)} ${pad('еда/сут', 9)}`,
    );
    ctx.use('etalons').tiers.forEach((t, i) => {
      const w = wagesOf(t);
      const f = rationOf(t);
      ctx.line(
        `${padEnd(['I', 'II', 'III'][i], 4)} ${pad(total(t), 6)} ${pad(fix(troopPower(t), 1), 7)} ${pad(fix(w), 17)} ${pad(fix(f, 1), 11)} ${pad(Math.round(w * dayGame()), 14)} ${pad(Math.round(f * dayGame()), 9)}`,
      );
    });
  },
};

/** Двадцать копейщиков — пример ГДД 3.3.2 («≈ 1 520 золота и 1 150 еды в настоящие сутки» без фуража). */
const EXAMPLE: TroopStack = { spearman: 20 };

const band: Section = {
  id: 'band',
  title: 'Отряд бродяги: содержание, терпение, обоз, фураж',
  gdd: '3.3.2, 3.3.4, 3.3.5',
  doors: [
    'roamrules.bandWage',
    'roamrules.bandRationPerDay',
    'roamrules.bandPatienceDays',
    'sim/roam.cargoCap',
    'roamrules.fieldForage',
    'roamrules.forageShare',
    'derived.seasonModsFor',
  ],
  uses: [],
  run(ctx) {
    ctx.line('содержание за игровой день на голову — двери отряда (ГДД 3.3.2; доли веры и рыцарства у бродяги нет):');
    ctx.line(`${padEnd('вид', 16)} ${pad('жалованье', 10)} ${pad('минимальное', 12)} ${pad('паёк', 6)}`);
    for (const id of TROOP_IDS) {
      ctx.line(
        `${padEnd(TROOP_BY_ID[id].name, 16)} ${pad(fix(bandWage(id)), 10)} ${pad(fix(bandWage(id, 'min')), 12)} ${pad(fix(bandRationPerDay({ band: { [id]: 1 }, wounded: [] }, 1), 1), 6)}`,
      );
    }
    ctx.line('');
    ctx.line(`терпение отряда без жалованья и еды, игр. дн. (лестница Статуи по кружкам Военного дела героя): ${[1, 2, 3, 4, 5].map((w) => `${w} — ${fix(bandPatienceDays(w), 1)}`).join(', ')}`);
    ctx.line(`обоз на голову строя (ноша бойца мира ${UNIT_BY_ID.warrior.carry}): ${GAITS.map((g) => `${GAIT_META[g].short} ${fix(cargoCap({ band: { spearman: 1 }, gait: g }), 1)}`).join(', ')}`);
    ctx.line('');
    ctx.line('фураж — доля пайка с земли (поле сезона против лучшего, вольный сбор вполсилы), в лагере и обычным маршем:');
    ctx.line(`${padEnd('сезон', 8)} ${pad('год 1', 7)} ${pad('год 2+', 7)} ${pad('паёк ×', 7)}`);
    let year = 0;
    for (const s of SEASONS) {
      const later = seasonModsFor(s, 2);
      year += fieldForage(later) / SEASONS.length;
      ctx.line(`${padEnd(SEASON_META[s].name, 8)} ${pad(pct(fieldForage(seasonModsFor(s, 1))), 7)} ${pad(pct(fieldForage(later)), 7)} ${pad(fix(later.food), 7)}`);
    }
    ctx.line(`в среднем за год (год 2+) — ${pct(year)}; налегке и с обозом в пути — ${pct(forageShare(seasonModsFor('autumn', 2), { camp: null, gait: 'light' }))}`);
    ctx.line('ориентир ГДД 3.3.4 (в код не пошёл): весна 30 %, лето 50 %, осень 60 %, зима 0 % — в среднем 35.0 %');
    ctx.line('');
    // Пример 3.3.2 на дверях: за настоящие сутки, без фуража и со средним фуражом года.
    const wage = wagesOf(EXAMPLE) * dayGame();
    const food = rationOf(EXAMPLE) * dayGame();
    ctx.line(`пример 3.3.2 — ${stackWords(EXAMPLE)}: жалованье ${Math.round(wage)} золота в настоящие сутки, паёк ${Math.round(food)} еды без фуража, ${Math.round(food * (1 - year))} с фуражом года`);
    ctx.line(`обоз примера обычным маршем — ${Math.round(cargoCap({ band: EXAMPLE, gait: 'normal' }))}: паёк на ${fix(cargoCap({ band: EXAMPLE, gait: 'normal' }) / rationOf(EXAMPLE) / dayGame(), 1)} настоящих сут без фуража`);
  },
};

const rate: Section = {
  id: 'rate',
  title: 'Курс припаса',
  gdd: '3.3.4, 4.3',
  doors: ['selfcost.selfCost', 'data/market (основа цен)', 'marketrules.buyUnit', 'price.baseWage', 'build.soldierFoodPerDay'],
  uses: ['village', 'etalons'],
  run(ctx) {
    const village = ctx.use('village');
    ctx.line(
      'золота за единицу: своим трудом (цена мощи вида и склада), село (selfCost × MIN_MARKUP), основа рынка, рынок города 1-го и 5-го уровня (привоз 12:00 UTC)',
    );
    ctx.line(`${padEnd('припас', 10)} ${pad('свой труд', 10)} ${pad('село', 8)} ${pad('основа', 7)} ${pad('город 1', 8)} ${pad('город 5', 8)}`);
    for (const r of RESOURCE_IDS) {
      const g = GOOD_BY_ID[r];
      ctx.line(
        `${padEnd(g.name, 10)} ${pad(fix(selfCost(g), 4), 10)} ${pad(fix(village(r), 4), 8)} ${pad(g.price, 7)} ${pad(townPrice(r, 1), 8)} ${pad(townPrice(r, 5), 8)}`,
      );
    }
    ctx.line('');
    const food = GOOD_BY_ID.food;
    const rates: [string, number][] = [
      ['свой труд', selfCost(food)],
      ['село', village('food')],
      ['основа рынка', food.price],
      ['город 1', townPrice('food', 1)],
    ];
    ctx.line('еда против ориентира содержания эталона:');
    for (const [name, x] of rates) ctx.line(`  ${padEnd(name, 13)} ${pad(fix(x, 4), 8)} — ${ctx.target('foodGold', x, (v) => fix(v, 2))}`);
    ctx.line('');
    ctx.line('содержание эталона тира за игровой день, золотом: жалованье + еда по курсу; доля еды в содержании');
    ctx.line(`${padEnd('тир', 4)} ${pad('жалованье', 10)} ${rates.map(([n]) => pad(n, 16)).join('')}`);
    ctx.use('etalons').tiers.forEach((t, i) => {
      const w = wagesOf(t);
      const f = rationOf(t);
      ctx.line(
        `${padEnd(['I', 'II', 'III'][i], 4)} ${pad(fix(w), 10)} ${rates.map(([, x]) => pad(`${fix(w + f * x, 1)} (${pct((f * x) / (w + f * x))})`, 16)).join('')}`,
      );
    });
  },
};

const upgrade: Section = {
  id: 'upgrade',
  title: 'Цены повышения и найма',
  gdd: '3.4.2, 3.4.3, 4.2',
  doors: ['data/troops (снаряжение и припас найма)', 'data/market (основа цен)', 'price.baseWage'],
  uses: ['upgrade', 'hire'],
  run(ctx) {
    const up = ctx.use('upgrade');
    const hire = ctx.use('hire');
    ctx.line(`${padEnd('вид', 16)} ${pad('из дубинщика', 13)} ${pad('найм в городе', 14)} ${pad('жалованье было → стало', 24)}`);
    for (const id of TROOP_IDS) {
      if (id === 'clubman') continue;
      ctx.line(
        `${padEnd(TROOP_BY_ID[id].name, 16)} ${pad(up('clubman', id), 13)} ${pad(hire(id), 14)} ${pad(`${fix(baseWage('clubman'))} → ${fix(baseWage(id))}`, 24)}`,
      );
    }
    // ГДД 3.4.2: «по шагам стоит столько же, сколько сразу». Держится, пока припас найма вдоль цепочки не убывает: max(0, …)
    // не складывается по шагам, где следующий вид просит меньше припаса, чем предыдущий.
    const chains: TroopId[][] = [
      ['clubman', 'spearman', 'rider', 'knight'],
      ['clubman', 'swordsman', 'shieldman', 'legionary'],
    ];
    for (const c of chains) {
      const steps = c.slice(1).reduce((n, id, i) => n + up(c[i], id), 0);
      const once = up(c[0], c[c.length - 1]);
      ctx.line(
        `по шагам ${c.map((id) => TROOP_BY_ID[id].name.toLowerCase()).join(' → ')}: ${steps}; сразу: ${once} — ${steps === once ? 'поровну' : 'РАСХОДЯТСЯ (обещание 3.4.2 не держится)'}`,
      );
    }
  },
};

const road: Section = {
  id: 'road',
  title: 'Сроки пути',
  gdd: '2.3, 3.5.2, 3.8.2',
  doors: ['geo.travelTime', 'pvp.generalSpeed', 'pace.realMs', 'tuning.TEST_TRAVEL_SPEED'],
  uses: [],
  run(ctx) {
    ctx.line(
      `множитель теста пути TEST_TRAVEL_SPEED = ${TRAVEL}${TRAVEL === 1 ? '' : ' — СРОКИ НЕДЕЙСТВИТЕЛЬНЫ до ПН-01 (ГДД 0.4, С1)'}`,
    );
    ctx.line('настоящих часов по равнине (множитель местности 1), полководец с отрядом:');
    const gaits: [Gait, string][] = [
      ['light', 'налегке'],
      ['normal', 'обычный'],
      ['train', 'с обозом'],
    ];
    ctx.line(`${padEnd('клеток', 7)} ${gaits.map(([, n]) => pad(n, 10)).join('')}`);
    for (const d of [5, 10, 25, 50]) ctx.line(`${padEnd(d, 7)} ${gaits.map(([g]) => pad(hrs(roadHours(d, g)), 10)).join('')}`);
  },
};

const contract: Section = {
  id: 'contract',
  title: 'Плата договоров по эталону',
  gdd: '3.8.3, 4.3, 3.8.2',
  doors: ['price.baseWage', 'build.soldierFoodPerDay', 'tuning.LAIR_GOLD_PER_POWER', 'price.troopPower', 'geo.travelTime'],
  uses: ['etalons', 'contractRule', 'contractK', 'contractR', 'contractTerm', 'foodGold', 'village'],
  run(ctx) {
    ctx.use('contractRule');
    const K = ctx.use('contractK');
    const R = ctx.use('contractR');
    const term = ctx.use('contractTerm');
    const food3 = ctx.use('foodGold');
    const village = ctx.use('village')('food');
    ctx.line(`K = ${K}, R = ${R}, LAIR_GOLD_PER_POWER = ${LAIR_GOLD_PER_POWER}; срок «сжечь логово» — путь × ${term.roads} + ${term.days} игр. дн.`);
    ctx.line(
      `${padEnd('тир', 4)} ${pad('содерж. (еда 3)', 16)} ${pad('плата 10 дн.', 13)} ${pad('содерж. (село)', 15)} ${pad('плата 10 дн.', 13)}   без риска`,
    );
    const tiers = ctx.use('etalons').tiers;
    tiers.forEach((t, i) => {
      const a = wagesOf(t) + rationOf(t) * food3;
      const b = wagesOf(t) + rationOf(t) * village;
      ctx.line(
        `${padEnd(['I', 'II', 'III'][i], 4)} ${pad(fix(a, 1), 16)} ${pad(Math.round(a * 10 * K), 13)} ${pad(fix(b, 1), 15)} ${pad(Math.round(b * 10 * K), 13)}`,
      );
    });
    ctx.line('');
    ctx.line('«сжечь логово» эталоном тира, противник — мощью эталона (обычный марш): срок, настоящих часов, и плата с риском');
    for (const d of [10, 25]) {
      const termDays = term.roads * roadHours(d, 'normal') * (dayGame() / 24) + term.days;
      tiers.forEach((t, i) => {
        const up = wagesOf(t) + rationOf(t) * food3;
        const gold = up * termDays * K + troopPower(t) * LAIR_GOLD_PER_POWER * R;
        ctx.line(
          `  ${pad(d, 2)} клеток, тир ${padEnd(['I', 'II', 'III'][i], 3)}: срок ${fix(termDays, 1)} игр. дн. (${hrs((termDays * 24) / dayGame())}), плата ${Math.round(gold)}`,
        );
      });
    }
  },
};

const foes: Section = {
  id: 'foes',
  title: 'Сила НПС — неподвижная точка',
  gdd: '3.6.2',
  doors: [
    'world/battle.resolveField',
    'garrison.raidingParty',
    'price.troopPower',
    'fights.wallFight',
    'console/fixpoint.GATE_SETTLE',
    'data/events.GATE_POWER',
  ],
  uses: PILOT,
  async run(ctx) {
    const k = knobsOf(ctx);
    const origins = ctx.use('origins');
    const npc = ctx.use('npcRule');
    const sz = ctx.size;
    ctx.line(
      `автопилот: ${STYLES.map((s) => s.name).join(', ')} × ${origins.map((o) => o.name).join(', ')} × ${sz.seeds} сидов; ровный бой — ${sz.even} боёв на точку; окно ${LIMIT_DAYS} сут`,
    );
    ctx.line(
      `стили (договоры у всех — разбоя в Срезе 1 нет): ${STYLES.map((s) => `${s.name} — до ${s.edge} ровного боя, штурм от ${pct(s.storm)} разведки, лагерь ${CAMP_NAME[s.camp]}, марш ${s.gait}, запас — до захода и ещё ${s.margin} ч, ${s.takeAll ? 'берёт всех просящихся' : 'берёт, сколько прокормит'}, растит «${TROOP_BY_ID[s.grow].name.toLowerCase()}»`).join('; ')}`,
    );
    ctx.line(`вольный замок I: гарнизон ${k.castle.power} мощи (${menOfPower(k.castle.power)} бойцов строя), с ${k.castle.stage}-й ступени престижа`);
    // Начало — снизу: на всех ступенях ровный бой отряда происхождения медианной мощи. Сверху (эталонами 4.3) вывод запирал
    // ступени: противник выше сил — до ступени не доходит никто, и строка не выводится.
    const first = [...origins].sort((a, b) => troopPower(a.band) - troopPower(b.band))[Math.floor((origins.length - 1) / 2)];
    const e0 = evenPower(first.band, sz.even, 'start');
    let even = k.stages.map(() => e0 / troopPower(first.band));
    let row = k.stages.map(() => Math.round(e0 / npc.edge));
    ctx.line(`начало: на всех ступенях — ровный бой отряда «${first.name}» (${stackWords(first.band)}) / ${npc.edge}: ${row.join(', ')}`);
    const seen: number[][] = [row];
    let verdict = `не села за ${sz.steps} шагов`;
    for (let step = 1; step <= sz.steps; step++) {
      const runs = allRuns(k, origins, row, even, sz.seeds);
      const refs = refsOf(runs, k.stages.length);
      const ev = refs.map((b, i) => (b ? evenPower(b, sz.even, `st${i}`) : NaN));
      const derived = ev.map((x) => (Number.isNaN(x) ? NaN : Math.round(x / npc.edge)));
      const reached = k.stages.map((_, s) => runs.filter((r) => r.stageAt[s] !== null).length);
      ctx.line(
        `шаг ${step}: записано ${row.join(', ')}; выведено ${derived.map((x) => (Number.isNaN(x) ? '—' : x)).join(', ')}; дошли до ступени ${reached.map((n) => `${n}/${runs.length}`).join(', ')}`,
      );
      refs.forEach((b, s) => b && ctx.line(`  эталон ступени ${s}: ${total(b)} чел., мощь ${fix(troopPower(b), 1)} (${stackWords(b)})`));
      const nextEven = ev.map((x, i) => (Number.isNaN(x) ? even[i] : x / troopPower(refs[i] as TroopStack)));
      const move = rowMove(seen, derived, step === sz.steps);
      if (move.kind === 'settled') {
        row = derived.map((x, i) => (Number.isNaN(x) ? row[i] : x));
        even = nextEven;
        verdict = `села на шаге ${step} (в ${pct(0.01)} от записанной)`;
        break;
      }
      if (move.kind === 'swing') {
        row = move.row;
        even = nextEven;
        verdict = `качание на шаге ${step}: ступени ${move.swung.join(', ')} — полусуммой (правило 16)`;
        break;
      }
      if (move.kind === 'stuck') {
        verdict = `НЕ СЕЛА за ${sz.steps} шагов: ступени ${move.moving.join(', ')} идут в одну сторону — берётся последняя записанная`;
        break;
      }
      row = move.row;
      even = nextEven;
      seen.push(row);
    }
    ctx.line(`вывод: ${verdict}`);
    ctx.line(`сила НПС по ступеням престижа: ${row.join(', ')} мощи; ровный бой к мощи эталона: ${even.map((x) => fix(x)).join(', ')}`);
    const runs = allRuns(k, origins, row, even, sz.seeds);
    ctx.share('pilot', { runs, row, even, knobs: k, origins } satisfies Pilot);
  },
};

const prestige: Section = {
  id: 'prestige',
  title: 'Темп престижа',
  gdd: '3.9.1',
  doors: ['партии автопилота раздела «Сила НПС»'],
  uses: PILOT,
  run(ctx) {
    const p = ctx.take<Pilot>('pilot');
    ctx.line(`пороги ступеней: ${p.knobs.stages.join(', ')}; партий на стиль ${p.runs.length / STYLES.length}`);
    ctx.line(
      `${padEnd('стиль', 11)} ${p.knobs.stages
        .slice(1)
        .map((v, i) => pad(`ступень ${i + 1} (${v})`, 22))
        .join('')} ${pad('престиж к сроку', 16)}`,
    );
    for (const st of STYLES) {
      const rs = p.runs.filter((r) => r.style === st.id);
      const cells = p.knobs.stages.slice(1).map((_, i) => {
        const at = rs.map((r) => r.stageAt[i + 1] ?? Infinity);
        const n = at.filter(Number.isFinite).length;
        return pad(`${n}/${rs.length}, ${days(median(at))}`, 22);
      });
      ctx.line(`${padEnd(st.name, 11)} ${cells.join('')} ${pad(Math.round(median(rs.map((r) => r.prestige))), 16)}`);
    }
    const perDay = p.runs.map((r) => r.prestige / ((r.castleAt ?? LIMIT_DAYS * 24) / 24));
    ctx.line(`престижа в сутки (медиана по всем партиям, до замка или до срока): ${fix(median(perDay), 1)}`);
  },
};

const castle: Section = {
  id: 'castle',
  title: 'Медиана до первого замка',
  gdd: '2.4, 3.11.2',
  doors: ['партии автопилота раздела «Сила НПС»'],
  uses: PILOT,
  run(ctx) {
    const p = ctx.take<Pilot>('pilot');
    ctx.line(
      `${padEnd('стиль', 11)} ${padEnd('происхождение', 14)} ${pad('дошли', 7)} ${pad('медиана', 12)} ${pad('быстрее всех', 13)} ${pad('дел', 5)} ${pad('побед', 6)} ${pad('ушло', 5)} ${pad('пришло', 7)}`,
    );
    for (const st of STYLES) {
      for (const o of p.origins) {
        const rs = p.runs.filter((r) => r.style === st.id && r.origin === o.id);
        const at = rs.map((r) => r.castleAt ?? Infinity);
        const n = at.filter(Number.isFinite).length;
        ctx.line(
          `${padEnd(st.name, 11)} ${padEnd(o.name, 14)} ${pad(`${n}/${rs.length}`, 7)} ${pad(days(median(at)), 12)} ${pad(days(Math.min(...at)), 13)} ${pad(Math.round(median(rs.map((r) => r.deeds))), 5)} ${pad(Math.round(median(rs.map((r) => r.wins))), 6)} ${pad(Math.round(median(rs.map((r) => r.deserted))), 5)} ${pad(Math.round(median(rs.map((r) => r.recruited))), 7)}`,
        );
      }
    }
    ctx.line('');
    for (const st of STYLES) {
      const power = p.runs.filter((r) => r.style === st.id).map((r) => troopPower(r.band));
      ctx.line(`${st.name}: мощь отряда к концу — медиана ${fix(median(power), 1)}, лучшая ${fix(Math.max(...power), 1)}; гарнизон вольного замка I — ${p.knobs.castle.power}`);
    }
    for (const st of STYLES) {
      const at = p.runs.filter((r) => r.style === st.id).map((r) => (r.castleAt ?? Infinity) / 24);
      const share = at.filter(Number.isFinite).length / at.length;
      ctx.line(`${st.name}: медиана ${days(median(at) * 24)} — ${ctx.target('castleMedian', median(at), (v) => fix(v, 0))}`);
      const fastest = Math.min(...at);
      ctx.line(
        `  быстрейший ${days(fastest * 24)} — ${Number.isFinite(fastest) ? ctx.target('castleFastest', fastest, (v) => fix(v, 0)) : 'не дошла ни одна партия'}`,
      );
      ctx.line(`  дошли за ${LIMIT_DAYS} сут ${pct(share)} — ${ctx.target('castleShare', share, pct)}`);
    }
  },
};

const parity: Section = {
  id: 'parity',
  title: 'Ценность города и паритет',
  gdd: '4.5, 3.11.1, 3.12',
  doors: [
    'autopilot.pilot (НФТ-старт живёт игрой)',
    'labour.upgradeCost',
    'labour.upgradeWork',
    'selfcost.selfCost',
    'price.troopPower',
    'sim/points.pointsOf',
    'tuning.CASTLE_GOLD_PER_POWER',
  ],
  uses: [...PILOT, 'valueRule', 'valuePrices', 'seat'],
  async run(ctx) {
    ctx.use('valueRule');
    const p = ctx.take<Pilot>('pilot');
    const prices: ValuePrices = ctx.use('valuePrices');
    const seat = ctx.use('seat');
    const took = p.runs.filter((r) => r.castleAt !== null);
    const lastDay = Math.min(LIMIT_DAYS, Math.max(1, Math.ceil(Math.max(0, ...took.map((r) => r.castleAt as number)) / 24)));
    ctx.line(
      `цены: работа ${prices.work}, мощь ${prices.power}, очко ${prices.point} золота; НФТ-старт — ${ctx.size.nft} партий автопилота посёлка, ${lastDay} сут`,
    );
    // НФТ-старт: «Готовый замок» — стартовый посёлок, живущий игрой автопилота посёлка; ценность — каждые 6 часов.
    const STEP = 6;
    const series: number[][] = [];
    const ends: Value[] = [];
    for (let i = 0; i < ctx.size.nft; i++) {
      const g = createInitialState(101 + i);
      const vals: number[] = [cityValue(g, prices).total];
      await pilot({
        g,
        seconds: gameSeconds(lastDay * 86400),
        player: player('means'),
        world: { seed: 201 + i, pulse: 60, raids: true },
        economy: 'live',
        tick: 1,
        decide: 15,
        watch: {
          after: ({ g: now, now: ms }) => {
            while (ms >= vals.length * STEP * 3_600_000) vals.push(cityValue(now, prices).total);
          },
        },
      });
      series.push(vals);
      ends.push(cityValue(g, prices));
    }
    const nftAt = (h: number): number => {
      const at = (v: number[]): number => {
        const x = Math.min(v.length - 1, h / STEP);
        const lo = Math.floor(x);
        const hi = Math.min(v.length - 1, lo + 1);
        return v[lo] + (v[hi] - v[lo]) * (x - lo);
      };
      return series.reduce((n, v) => n + at(v), 0) / series.length;
    };
    ctx.line(`ценность НФТ-старта по суткам: ${Array.from({ length: lastDay + 1 }, (_, d) => Math.round(nftAt(d * 24))).join(', ')}`);
    const parts = (name: string, v: Value): void =>
      ctx.line(
        `  ${name}: постройки ${Math.round(v.buildings)}, склад ${Math.round(v.stock)}, казна ${Math.round(v.gold)}, войско ${Math.round(v.army)}, очки ${Math.round(v.points)}`,
      );
    parts('на старте', cityValue(createInitialState(101), prices));
    parts(`к ${lastDay} сут (первая партия)`, ends[0]);
    const seatCity = (r: PathRun) => {
      const g = createInitialState(101);
      for (const b of g.buildings) {
        const l = (seat.levels as Record<string, number>)[b.type];
        if (l) b.level = l;
      }
      g.gold = CASTLE_GOLD_PER_POWER * p.knobs.castle.power + r.purse;
      for (const id of TROOP_IDS) g.army[id] = Math.max(0, Math.round(r.band[id] ?? 0));
      return cityValue(g, prices);
    };
    if (took.length === 0) {
      ctx.line('замка не взяла ни одна партия — паритет нечем мерить');
      return;
    }
    for (const st of STYLES) {
      const rs = took.filter((r) => r.style === st.id);
      if (rs.length === 0) {
        ctx.line(`${st.name}: замка не взяла ни одна партия`);
        continue;
      }
      const par = rs.map((r) => seatCity(r).total / nftAt(r.castleAt as number) - 1);
      const inside = par.filter((x) => Math.abs(x) <= 0.15).length;
      const v = seatCity(rs[Math.floor((rs.length - 1) / 2)]);
      ctx.line(
        `${st.name}: ${rs.length} замков; паритет — медиана ${pct(median(par))} — ${ctx.target('parity', median(par), pct)}; в ±15 % — ${inside} из ${rs.length}`,
      );
      ctx.line(
        `  город пути (партия из середины списка): постройки ${Math.round(v.buildings)}, склад ${Math.round(v.stock)}, казна ${Math.round(v.gold)}, войско ${Math.round(v.army)}`,
      );
    }
  },
};

const pool: Section = {
  id: 'pool',
  title: 'Пул вольных замков',
  gdd: '6.4, 3.11.1, 3.5.6',
  doors: [
    'settle.placeCastle',
    'geo.travelTime',
    'geo.terrainFactor',
    'pvp.generalSpeed',
    'data/events.GATE_POWER',
    'garrison.menOfPower',
    'tuning.CASTLE_GOLD_PER_POWER',
    'tuning.BURN_IMMUNE',
  ],
  uses: [...PILOT, 'pool', 'spawnGap'],
  run(ctx) {
    const tiers = ctx.use('castleTiers');
    const rule = ctx.use('pool');
    const gap = ctx.use('spawnGap');
    ctx.line(`${padEnd('ступень', 20)} ${pad('ур.', 4)} ${pad('мощь', 6)} ${pad('бойцов', 7)} ${pad('казна', 6)} ${pad('население', 10)} ${pad('доступ', 7)}`);
    for (const t of tiers) {
      const power = GATE_POWER.raiders[t.level - 1];
      ctx.line(
        `${padEnd(t.name, 20)} ${pad(t.level, 4)} ${pad(power, 6)} ${pad(menOfPower(power), 7)} ${pad(Math.round(CASTLE_GOLD_PER_POWER * power), 6)} ${pad(t.pop, 10)} ${pad(t.prestige, 7)}`,
      );
    }
    ctx.line(`сожжённый — восстановление ${fix(BURN_IMMUNE / 3_600_000 / 24, 1)} сут (BURN_IMMUNE)`);
    const p = ctx.take<Pilot>('pilot');
    const share = p.runs.filter((r) => r.castleAt !== null).length / p.runs.length;
    ctx.line('');
    ctx.line(`пул = max(${rule.base}, ceil(бродяг × ${rule.share})); выход — не ближе ${gap} клеток к замкам игроков; ${ctx.size.pool} расселений на строку`);
    ctx.line(`дошли до замка за ${LIMIT_DAYS} сут у автопилота: ${pct(share)} — столько замков нужно на бродягу к сроку`);
    ctx.line(`${pad('бродяг', 7)} ${pad('лордов', 7)} ${pad('пул', 5)} ${pad('нужно к сроку', 14)} ${pad('до ближ. вольного', 18)} ${pad('худший', 8)}`);
    for (const bands of [2, 5, 20, 50]) {
      const size = Math.max(rule.base, Math.ceil(bands * rule.share));
      for (const lords of [0, bands]) {
        const to = Array.from({ length: ctx.size.pool }, (_, run) => placeAll(run + 1, lords, size, bands, gap).toFree).flat();
        const hours = to.map((x) => x.hours);
        ctx.line(
          `${pad(bands, 7)} ${pad(lords, 7)} ${pad(size, 5)} ${pad(fix(bands * share, 1), 14)} ${pad(hrs(median(hours)), 18)} ${pad(hrs(Math.max(...hours)), 8)}`,
        );
      }
    }
  },
};

const sight: Section = {
  id: 'sight',
  title: 'Доля обнаружений по видам лагеря',
  gdd: '3.5.3, 3.5.4, 0.2',
  doors: ['world/spawn.SICILY', 'geography.terrainAt', 'sim/random.seeded'],
  uses: ['camps', 'sight', 'passing'],
  run(ctx) {
    const s = ctx.use('sight');
    const k: SightKnobs = {
      ...s,
      camps: ctx.use('camps'),
      passing: ctx.use('passing'),
    };
    const land = landAround(10);
    const counts = new Map<string, number>();
    for (const t of land) counts.set(t, (counts.get(t) ?? 0) + 1);
    ctx.line(`местность — ${land.length} клеток суши в 10 вокруг мест Сицилии: ${[...counts].map(([t, n]) => `${t} ${pct(n / land.length)}`).join(', ')}`);
    ctx.line(`чужой отряд проходит в ${k.passing[0]}…${k.passing[1]} клетках; половина проб — ночью; ${ctx.size.sight} проб на клетку таблицы`);
    const stands: [string, Stand][] = [
      ...CAMPS.map((c): [string, Stand] => [`лагерь ${CAMP_NAME[c]}`, { camp: c }]),
      ['в пути налегке', { march: 'light' }],
      ['в пути обычным', { march: 'normal' }],
      ['в пути с обозом', { march: 'train' }],
    ];
    const watchers: [string, number][] = [
      ['отряд', k.band],
      ['следопыт', k.band * k.tracker],
    ];
    const men = [10, 30, 70];
    ctx.line(`${padEnd('где', 18)} ${watchers.flatMap(([w]) => men.map((m) => pad(`${w} ${m}`, 13))).join('')}`);
    for (const [name, at] of stands) {
      ctx.line(`${padEnd(name, 18)} ${watchers.flatMap(([, r]) => men.map((m) => pad(pct(detectShare(k, land, at, m, r, ctx.size.sight, 1)), 13))).join('')}`);
    }
  },
};

export const SECTIONS: readonly Section[] = [pay, band, rate, upgrade, road, contract, foes, prestige, castle, parity, pool, sight];
