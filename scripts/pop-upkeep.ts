// Содержание войска — раздел `pop:report`.
//
// Числа механики (`data/upkeep.ts`, `derived.upkeepInfo`, `sim/upkeep.ts`) выбраны
// этим разделом, и держит он их тем же кодом, которым играет игра: жалованье —
// `wageOf`, доход — `taxIncomePerDay` на копии посёлка с нужной армией (боец платит
// налог как житель, и это видно само), еда — `productionPerDay`, `townFoodPerDay`,
// `soldierFoodPerDay`, уход — настоящий шаг при игроке (`tick`), отсрочка старой
// партии — настоящее чтение сохранения (`deserialize`). Посёлок на каждом этапе —
// прогон общего автопилота (`scripts/autopilot.ts`) в тихом мире: живая игра при игроке,
// ответы на события, вера, которую мир называет деревне. Сроки ухода — стенд правила (`stand`):
// время идёт на подготовленном посёлке, никто ничего не решает. Своей арифметики здесь ровно два места, и оба подписаны:
// отвергнутые способы делить жалованье и постоянная доля закята — то, чего в игре нет
// и что таблицей показано, почему нет.
//
// Все величины механики — доли и игровые дни, а не минуты: доход, еда и жалованье
// считаются за игровой день, и замедление дня двигает их вместе (docs/upkeep.md).
import type { FaithId, GameState, Season, TroopId } from '@/game/types';
import type { TaxId } from '@/game/data/policy';
import { createInitialState } from '@/game/state';
import { deserialize, serialize } from '@/game/save';
import { seeded, setRandom } from '@/game/sim/random';
import {
  armySize,
  payGraceDays,
  productionPerDay,
  recruitsQueued,
  seasonModsFor,
  soldierFoodPerDay,
  taxIncomePerDay,
  templeLevel,
  townFoodPerDay,
  upkeepInfo,
  wageOf,
  wageShare,
  wagesDue,
} from '@/game/derived';
import { DAY_LENGTH, RESOURCE_IDS, SOLDIER_FOOD } from '@/game/constants';
import { TAX_PER_POP } from '@/game/data/policy';
import { SEASONS, SEASON_SECONDS } from '@/game/data/seasons';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { FAITH_BY_ID } from '@/game/data/faiths';
import { QUESTS } from '@/game/data/quests';
import { DESERT_SHARE, WAGE_AMNESTY_DAYS, WAGE_GEAR, WAGE_HEAD, WAGE_MAN } from '@/game/data/upkeep';
import { weightOf } from '@/game/battle/kinds';
import { lairGold, lairLoot, lairPower } from '@/world/lairs';
import {
  LAIR_ANCHOR_FAR,
  LAIR_ANCHOR_HOME,
  LAIR_ANCHOR_MID,
  LAIR_CAP,
  LAIR_GOLD_PER_POWER,
  LAIR_LOOT_PER_POWER,
  LAIR_RIPE,
} from '@/world/data/tuning';
import { pilot, player, stand } from './autopilot';
import { dayRealSeconds } from '@/game/pace';

/**
 * Казна и добро логова до роста от жителей (коммит 528a768): мощь — опора × дозревание,
 * 2 золота и 4 добра на единицу. Это не правило игры, а мерка, от которой выводятся нынешние
 * доли: логово растёт с городом, а обещание новичку в днях налога остаётся прежним.
 */
const WAS_GOLD_PER_POWER = 2;
const WAS_LOOT_PER_POWER = 4;

const STAGES: [string, number][] = [
  ['новичок', 20 * 60],
  ['начало', 60 * 60],
  ['середина', 2 * 3600],
  ['потолок', 5 * 3600],
];
const STEP = 15;
/** Шаг живой игры в прогонах ухода. */
const DT = 1;

type Army = Partial<Record<TroopId, number>>;

const clone = (s: GameState): GameState => structuredClone(s);

const withArmy = (s: GameState, army: Army): GameState => {
  const w = clone(s);
  for (const id of TROOP_IDS) w.army[id] = army[id] ?? 0;
  return w;
};

const withPolicy = (s: GameState, tax: TaxId, faith: FaithId | null): GameState => {
  const w = clone(s);
  w.tax = tax;
  w.faith.id = faith;
  return w;
};

const last = <T>(xs: T[]): T => xs[xs.length - 1];
const n = (x: number): string => (Number.isFinite(x) ? String(Math.round(x)) : '∞');
const pad = (x: string | number, w: number): string => String(x).padStart(w);
const share = (x: number, of: number): string => (Number.isFinite(x) ? (x / of).toFixed(2) : '∞');

interface Run {
  gold: number[];
  stages: GameState[];
}

/** Мир партий раздела — тихий (набегов нет): он называет деревне веру, и больше ничего. */
const WORLD = 7;

/**
 * Партия общим автопилотом с налогом, без армии: казна по часам и посёлок на этапах. `faith` — вера,
 * поставленная до прогона (мир её не сменит); `null` — вера, которую называет мир.
 */
async function play(tax: TaxId, faith: FaithId | null, hours: number): Promise<Run> {
  setRandom(seeded(1));
  // Сид партии закреплён: вести приходят по сетке от `s.seed` (`sim/mail.awayArrival`), а без сида партия
  // берёт его у устройства (`freshSeed`) — и два прогона одного кода расходились (docs/time.md, раздел 16.10).
  const s = createInitialState(7);
  s.tutorialDone = true;
  s.faith.id = faith;
  const gold: number[] = [];
  const stages: GameState[] = [];
  await pilot({
    g: s,
    seconds: hours * 3600,
    player: player(null, { tax }),
    world: { seed: WORLD, pulse: STEP, raids: false },
    economy: 'live',
    tick: 1,
    decide: STEP,
    watch: {
      after: ({ g, now }) => {
        const t = Math.round(now / 1000);
        if (t % 3600 === 0) gold.push(Math.round(g.gold));
        for (const [, at] of STAGES) if (t === at) stages.push(clone(g));
      },
    },
  });
  return { gold, stages };
}

/**
 * Потолок по золоту: сколько бойцов одного вида казна держит без убыли — там, где
 * жалованье сходится с доходом. Доход линеен по армии, поэтому хватает двух замеров
 * игры: без армии и с одним бойцом. `wage` — жалованье бойца; по умолчанию игры.
 */
function goldCeiling(s: GameState, troop: TroopId, wage = wageOf(s, troop)): number {
  const i0 = taxIncomePerDay(withArmy(s, {}));
  const di = taxIncomePerDay(withArmy(s, { [troop]: 1 })) - i0;
  if (i0 <= 0) return 0;
  const net = wage - di;
  return net <= 0 ? Infinity : i0 / net;
}

/**
 * Потолок по еде: излишек посёлка без бойцов, делённый на пай бойца. «Год» — четыре
 * сезона вместе: столько армия ест, если летний излишек лёг в запас на зиму. Год
 * второй: смягчения первой зимы нет.
 */
function foodCeiling(s: GameState, season: Season | 'year'): number {
  let spare = 0;
  let per = 0;
  for (const one of season === 'year' ? SEASONS : [season]) {
    const mods = seasonModsFor(one, 2);
    spare += productionPerDay(s, mods).food - townFoodPerDay(s, mods);
    per += soldierFoodPerDay(s, mods);
  }
  return Math.max(0, spare / per);
}

/**
 * Посёлок этапа, готовый к живой игре: событий нет, задания закрыты (награда едой
 * наполнила бы пустой амбар первым же шагом), склад полон.
 */
function live(s0: GameState, over: (s: GameState) => void): GameState {
  const s = clone(s0);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  for (const r of RESOURCE_IDS) s.resources[r] = Math.max(s.resources[r], 5000);
  over(s);
  return s;
}

/**
 * Живая игра по дням: `at` — в какие дни снять отметку. Амбар держим полным, если
 * не сказано иначе: иначе в прогон платы вмешался бы голод.
 */
function days(s: GameState, marks: number[], opts: { feed?: boolean; on?: (s: GameState, day: number) => void } = {}): GameState[] {
  const out: GameState[] = [];
  const end = Math.max(...marks);
  stand(s, {
    dt: DT,
    // Последний шаг — первый, на котором день уже перешёл за последнюю отметку.
    steps: Math.floor(((end + 1e-9) * DAY_LENGTH) / DT) + 2,
    before: (x, step) => {
      const day = (step * DT) / DAY_LENGTH;
      if (step % Math.round(DAY_LENGTH / DT) === 0) opts.on?.(x, Math.round(day));
      if (marks.some((m) => Math.abs(m - day) < DT / DAY_LENGTH / 2)) out.push(clone(x));
    },
    after: (x) => {
      if (opts.feed !== false) x.resources.food = Math.max(x.resources.food, 5000);
    },
  });
  return out;
}

export async function upkeepSection(): Promise<void> {
  const s0 = createInitialState();
  console.log('\n══════ Содержание войска ══════');
  console.log(
    `Жалованье в день: ${WAGE_HEAD} полного сбора с человека (${TAX_PER_POP} зол.) с головы и ${WAGE_MAN} — с бойца строя. ` +
      'Выходит: ' +
      TROOP_IDS.map((id) => `${TROOP_BY_ID[id].one} ${wageOf(s0, id).toFixed(2)}`).join(', ') +
      `. Еда бойца ${SOLDIER_FOOD} в день. Терпение — Статуя: ${payGraceDays(s0)} дн. на первом уровне. ` +
      `Уходит ${DESERT_SHARE} неоплаченной или некормленной части в день. Новая партия начинает с налогом «${s0.tax}».`,
  );

  // --- Казна как есть ---
  const runs: [string, TaxId, FaithId | null][] = [
    ['без налога, вера мира', 'none', null],
    ['умеренный, вера мира', 'moderate', null],
    ['высокий, вера мира', 'high', null],
    ['без налога, католики', 'none', 'catholic'],
    ['умеренный, католики', 'moderate', 'catholic'],
    ['умеренный, язычники', 'moderate', 'pagan'],
  ];
  console.log(`\nКазна без войска (общий автопилот 6 ч в тихом мире ${WORLD}, стартовые 320, уклад прихода обычный; «вера мира» — та, что называет мир):`);
  console.log('  налог и вера           |    1 ч |    2 ч |    3 ч |    4 ч |    5 ч |    6 ч');
  let base: Run | null = null;
  let untouched: Run | null = null;
  for (const [name, tax, faith] of runs) {
    const r = await play(tax, faith, 6);
    if (tax === 'moderate' && !faith) base = r;
    if (tax === 'moderate' && faith && FAITH_BY_ID[faith].tilt.goldPerPop === 0) untouched = r;
    console.log(`  ${name.padEnd(22)} | ${r.gold.map((g) => pad(g, 6)).join(' | ')}`);
  }
  const stages = base!.stages;
  console.log(`  (вера мира ${WORLD} — ${stages[0].faith.id ?? 'нет'})`);

  // --- Этапы ---
  console.log('\nЭтапы партии (посёлок из прогона с умеренным налогом и верой мира), доход казны за игровой день без армии; «без веры» у дохода — та же копия с верой, снятой вручную:');
  console.log('  этап     | люди | храм | без нал. | умер. | выс. | умер.+католики | умер.+ислам');
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const inc = (tax: TaxId, faith: FaithId | null): string => taxIncomePerDay(withPolicy(s, tax, faith)).toFixed(0);
    console.log(
      `  ${STAGES[i][0].padEnd(8)} | ${pad(s.pop, 4)} | ${pad(templeLevel(s), 4)} | ${pad(inc('none', null), 8)} | ` +
        `${pad(inc('moderate', null), 5)} | ${pad(inc('high', null), 4)} | ${pad(inc('moderate', 'catholic'), 14)} | ` +
        `${pad(inc('moderate', 'islam'), 11)}`,
    );
  }

  // --- Как делить жалованье ---
  const kinds: TroopId[] = ['clubman', 'spearman', 'legionary'];
  const cap = last(stages);
  // Отвергнутые способы — своей арифметикой: в игре их нет, и показать их иначе нечем. Третья
  // строка — формула игры без части за снаряжение (`WAGE_GEAR`), четвёртая — сама игра
  // (`derived.wageOf`, со снаряжением): прежде третья называлась ценой игры, а считала без него.
  const schemes: [string, ((s: GameState, k: TroopId) => number) | null][] = [
    ['по силе 1.1', (_s, k) => TAX_PER_POP * 1.1 * weightOf(k)],
    ['по головам 2.2', () => TAX_PER_POP * 2.2],
    [`голова ${WAGE_HEAD} + сила ${WAGE_MAN}, без снаряжения`, (_s, k) => TAX_PER_POP * (WAGE_HEAD + WAGE_MAN * weightOf(k))],
    [`← игра: и снаряжение ${WAGE_GEAR} (wageOf)`, null],
  ];
  console.log('\nКак делить жалованье: какую долю от жителей казна держит бойцами одного вида (этап «потолок»):');
  console.log('  способ                                   | налог     | ' + kinds.map((k) => TROOP_BY_ID[k].name.padStart(9)).join(' | '));
  for (const [name, wage] of schemes) {
    for (const tax of ['moderate', 'high'] as TaxId[]) {
      const s = withPolicy(cap, tax, null);
      const cells = kinds.map((k) => share(wage ? goldCeiling(s, k, wage(s, k)) : goldCeiling(s, k), s.pop).padStart(9));
      console.log(`  ${name.padEnd(40)} | ${(tax === 'high' ? 'высокий' : 'умеренный').padEnd(9)} | ${cells.join(' | ')}`);
    }
  }
  console.log('  По силе дубинщик при высоком налоге почти бесплатен; по головам латник стоит как дубинщик.');

  // --- Потолок по золоту ---
  const taxes: [string, TaxId, FaithId | null][] = [
    ['без налога', 'none', null],
    ['умеренный', 'moderate', null],
    ['высокий', 'high', null],
    ['умер.+католики', 'moderate', 'catholic'],
    ['умер.+ислам', 'moderate', 'islam'],
    ['выс.+ислам', 'high', 'islam'],
  ];
  console.log('\nПотолок по золоту: сколько бойцов одного вида казна держит без убыли (в скобках — доля от жителей):');
  console.log('  этап     | налог и вера     | ' + kinds.map((k) => TROOP_BY_ID[k].name.padStart(13)).join(' | '));
  for (let i = 0; i < stages.length; i++) {
    for (const [name, tax, faith] of taxes) {
      const s = withPolicy(stages[i], tax, faith);
      const cells = kinds.map((k) => {
        const c = goldCeiling(s, k);
        return `${n(c)}${Number.isFinite(c) ? ` (${share(c, s.pop)})` : ''}`.padStart(13);
      });
      console.log(`  ${STAGES[i][0].padEnd(8)} | ${name.padEnd(16)} | ${cells.join(' | ')}`);
    }
  }

  // --- Закят ---
  console.log('\nЗакят: копейщиков, которых держит казна мусульманской деревни, против соседей без закята.');
  console.log('  Постоянная доля жалованья подобрана под одну точку и расходится в других; доля игры —');
  console.log('  ровно то, что закят оставляет от сбора с человека (`wageShare`).');
  console.log('  этап     | налог     | соседи | доля 0.09 (умер., храм 10) | доля 0.5 (выс., храм 10) | игра: доля, копейщиков');
  for (const i of [1, 2, 3]) {
    for (const tax of ['moderate', 'high'] as TaxId[]) {
      const other = withPolicy(stages[i], tax, null);
      const m = withPolicy(stages[i], tax, 'islam');
      const full = wageOf(m, 'spearman') / wageShare(m);
      console.log(
        `  ${STAGES[i][0].padEnd(8)} | ${(tax === 'high' ? 'высокий' : 'умеренный').padEnd(9)} | ${pad(n(goldCeiling(other, 'spearman')), 6)} | ` +
          `${pad(n(goldCeiling(m, 'spearman', full * 0.09)), 26)} | ${pad(n(goldCeiling(m, 'spearman', full * 0.5)), 24)} | ` +
          `${wageShare(m).toFixed(2)}, ${n(goldCeiling(m, 'spearman'))}`,
      );
    }
  }

  // --- Потолок по еде ---
  console.log('\nПотолок по еде: сколько бойцов прокормит излишек посёлка при расстановке автопилота (в скобках — доля от жителей):');
  console.log('  этап     |       лето |       зима |        год');
  for (let i = 0; i < stages.length; i++) {
    const cells = (['summer', 'winter', 'year'] as const).map((season) => {
      const c = foodCeiling(stages[i], season);
      return `${n(c)} (${(c / stages[i].pop).toFixed(1)})`.padStart(10);
    });
    console.log(`  ${STAGES[i][0].padEnd(8)} | ${cells.join(' | ')}`);
  }

  // --- Что держит ---
  const binds: [TroopId, Season | 'year'][] = [
    ['spearman', 'winter'],
    ['spearman', 'year'],
    ['clubman', 'winter'],
    ['clubman', 'year'],
    ['legionary', 'winter'],
  ];
  console.log('\nЧто держит армию: меньший из двух потолков (Е — еда, З — золото):');
  console.log(
    '  этап     | налог и вера     |' + binds.map(([k, season]) => ` ${TROOP_BY_ID[k].one} ${season === 'year' ? 'год' : 'зима'}`.padEnd(17)).join('|'),
  );
  for (let i = 0; i < stages.length; i++) {
    for (const [name, tax, faith] of taxes.slice(0, 4)) {
      const s = withPolicy(stages[i], tax, faith);
      const cells = binds.map(([k, season]) => {
        const g = goldCeiling(s, k);
        const e = foodCeiling(s, season);
        return (e < g ? `Е ${n(e)}` : `З ${n(g)}`).padStart(16);
      });
      console.log(`  ${STAGES[i][0].padEnd(8)} | ${name.padEnd(16)} |${cells.join(' |')}`);
    }
  }

  // --- Уход при неуплате ---
  const mid = stages[2];
  const ceil = goldCeiling(mid, 'spearman');
  const over = Math.round(ceil * 2);
  const marks = [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40];
  const unpaid = days(live(mid, (s) => ((s.gold = 0), (s.army.spearman = over))), marks);
  const paid = days(live(mid, (s) => ((s.gold = 0), (s.army.spearman = over))), marks, {
    on: (s, day) => {
      if (day === 4) s.gold += Math.round(wagesDue(s) * 20);
    },
  });
  console.log(
    `\nУход при неуплате — шагом игры (этап «середина», ${mid.pop} жителей, умеренный налог, потолок ${n(ceil)} копейщиков, ` +
      `стоит ${over}, казна пуста, Статуя ${payGraceDays(mid)} дн.):`,
  );
  console.log('  день | без доплаты: войско, долг | доплата 20 дней жалованья на 4-й день: войско, долг, казна');
  for (let k = 0; k < marks.length; k++) {
    const a = unpaid[k];
    const b = paid[k];
    console.log(
      `  ${pad(marks[k], 4)} | ${pad(armySize(a), 11)} ${pad(Math.round(a.pay.debt), 12)} | ` +
        `${pad(armySize(b), 11)} ${pad(Math.round(b.pay.debt), 6)} ${pad(Math.round(b.gold), 7)}`,
    );
  }

  // --- Равная доля ---
  const mixed: Army = { clubman: 120, spearman: 120, archer: 60, shieldman: 30, legionary: 30 };
  const shares = days(live(mid, (s) => {
    s.gold = 0;
    for (const id of TROOP_IDS) s.army[id] = mixed[id] ?? 0;
  }), [0, 10, 30, 60]);
  console.log('\nУходит равная доля каждого вида (этап «середина», умеренный налог, казна пуста):');
  console.log('  день | ' + TROOP_IDS.filter((id) => mixed[id]).map((id) => TROOP_BY_ID[id].one.padStart(9)).join(' | ') + ' |  всего');
  shares.forEach((s, k) => {
    console.log(
      `  ${pad([0, 10, 30, 60][k], 4)} | ` +
        TROOP_IDS.filter((id) => mixed[id]).map((id) => pad(s.army[id], 9)).join(' | ') +
        ` | ${pad(armySize(s), 6)}`,
    );
  });

  // --- Голод ---
  const young = stages[0];
  const winterStart = 3 * SEASON_SECONDS + 4 * 5 * DAY_LENGTH; // зима второго года
  const hungry = live(young, (s) => {
    s.time = winterStart;
    s.gold = 100_000;
    s.resources.food = 0;
  });
  const hungryCeil = foodCeiling(hungry, 'winter');
  hungry.army.spearman = Math.round(hungryCeil * 3);
  // Копия до стенда: `days` ведёт посёлок на месте, а стенду новобранцев нужен тот же первый день голода.
  const hungryAt0 = clone(hungry);
  const died0 = hungry.stats.died;
  console.log(
    `\nГолод — та же дверь (этап «новичок», ${young.pop} жителей, зима — пять дней, амбар пуст, казна полна; зимой амбар кормит ` +
      `${n(hungryCeil)} копейщиков, стоит ${hungry.army.spearman}, Статуя ${payGraceDays(hungry)} дн.):`,
  );
  const starve = days(hungry, [0, 2, 3, 4, 5], { feed: false });
  console.log('  день | войско | жителей | умерло жителей');
  starve.forEach((s, k) => {
    console.log(`  ${pad([0, 2, 3, 4, 5][k], 4)} | ${pad(armySize(s), 6)} | ${pad(s.pop, 7)} | ${pad(s.stats.died - died0, 14)}`);
  });

  // --- Голод и новобранцы ---
  // Новобранцы на учениях едят солдатский паёк (`foodConsumptionPerDay`). Та же голодная деревня, что
  // строкой выше, но войска вдвое больше, чем амбар кормит зимой (втрое — и нехватка перекрывает паёк
  // войска целиком, доля упирается в потолок), плюс заказ в казармах: копейщики, чьи учения на эту зиму
  // стоят (работа заказа обнуляется перед каждым шагом — так учатся те, кому учиться дольше голода).
  // Меряется, кто уходит за их хлеб и сколько.
  const lean = clone(hungryAt0);
  lean.army.spearman = Math.round(hungryCeil * 2);
  console.log(
    `\nГолод и новобранцы — та же деревня, войско ${lean.army.spearman} (вдвое больше, чем амбар кормит зимой), в казармах ещё копейщики на учениях, учения на эту зиму стоят:`,
  );
  console.log('  новобранцев | день | войско | новобранцев | ушло из войска | умерло жителей | доля ухода в день');
  for (const drafted of [0, Math.round(lean.army.spearman / 4), Math.round(lean.army.spearman / 2)]) {
    const s = clone(lean);
    s.recruits = drafted > 0 ? [{ id: 1, troop: 'spearman', count: drafted, done: 0, work: 0, people: drafted }] : [];
    const army0 = armySize(s);
    const dead0 = s.stats.died;
    const row = (x: GameState, day: string): string =>
      `  ${pad(drafted, 11)} | ${pad(day, 4)} | ${pad(armySize(x), 6)} | ${pad(recruitsQueued(x), 11)} | ${pad(army0 - armySize(x), 14)} | ${pad(x.stats.died - dead0, 14)} | ${pad(`${Math.round(upkeepInfo(x).unfed * DESERT_SHARE * 100)}%`, 17)}`;
    const out: string[] = [];
    // Зима кончается на пятом дне: последняя отметка — последний её шаг.
    const steps = Math.floor((5 * DAY_LENGTH) / DT) - 1;
    stand(s, {
      dt: DT,
      steps,
      before: (x, i) => {
        for (const o of x.recruits) o.work = 0;
        if (i === 0 || i === Math.round((3 * DAY_LENGTH) / DT)) out.push(row(x, String(Math.round((i * DT) / DAY_LENGTH))));
      },
    });
    out.push(row(s, '5'));
    for (const line of out) console.log(line);
  }

  // --- Начатые партии ---
  console.log(
    `\nНачатые партии — настоящим чтением сохранения 13-й версии: отсрочка ${WAGE_AMNESTY_DAYS} дн. с минуты входа. ` +
      '«первый» — через сколько игровых дней ушёл первый боец; «час» — войско через час игры (60 дн.).',
  );
  console.log('  этап     | налог      | армия | казна | потолок | без отсрочки: первый, час | с отсрочкой: первый, час | отсрочка и умер. налог в 1-й день: час');
  const hour = Array.from({ length: 61 }, (_, i) => i);
  const firstLeave = (pts: GameState[], from: number): string => {
    const k = pts.findIndex((p) => armySize(p) < from);
    return k < 0 ? 'нет' : `${k} дн.`;
  };
  for (const i of [1, 3]) {
    for (const tax of ['none', 'moderate'] as TaxId[]) {
      for (const part of [1 / 3, 1]) {
        for (const gold of [320, 20000]) {
          const s = live(stages[i], (st) => {
            st.tax = tax;
            st.gold = gold;
            st.army.spearman = Math.round(st.pop * part);
          });
          const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
          raw.version = 13;
          delete raw.pay;
          // Запись «из будущего»: догона офлайна нет, и отчёт повторяется до буквы.
          raw.lastSaved = Number.MAX_SAFE_INTEGER;
          const load = (): GameState => {
            const old = deserialize(JSON.stringify(raw))!;
            old.nextEventAt = Infinity;
            return old;
          };
          const now = load();
          now.pay.from = now.time;
          const a = days(now, hour);
          const b = days(load(), hour);
          const c = days(load(), hour, { on: (st, day) => day === 1 && (st.tax = 'moderate') });
          const armyNow = s.army.spearman;
          console.log(
            `  ${STAGES[i][0].padEnd(8)} | ${(tax === 'none' ? 'без налога' : 'умеренный').padEnd(10)} | ${pad(armyNow, 5)} | ${pad(gold, 5)} | ` +
              `${pad(n(goldCeiling(s, 'spearman')), 7)} | ${pad(firstLeave(a, armyNow), 18)} ${pad(armySize(last(a)), 5)} | ` +
              `${pad(firstLeave(b, armyNow), 17)} ${pad(armySize(last(b)), 5)} | ${pad(armySize(last(c)), 5)}`,
          );
        }
      }
    }
  }

  // --- Золото логов ---
  // Логово растёт от жителей города, поэтому его казна считается на каждом этапе заново — от
  // жителей этого этапа. Мерка — сколько дней умеренного налога стоит казна.
  //
  // Этапы — деревня без закята, а не вера мира замера (решение владельца, docs/upkeep.md, раздел 5):
  // доля, выведенная из дней налога, не должна зависеть от того, какую веру мир назвал дому замера.
  // Какая это вера, решает таблица вер (`goldPerPop` ноль — ни десятины, ни закята), а не имя.
  const plain = untouched!.stages;
  // Вывод долей. Обещание, которое держалось до роста логов: дозревшее логово у дома стоит
  // новичку столько дней налога, сколько стоило при опоре × 2. Доля золота на мощь выводится
  // так, чтобы у новичка это число осталось тем же; добро — в прежнем отношении к золоту.
  const wasGold = LAIR_ANCHOR_HOME * LAIR_CAP * WAS_GOLD_PER_POWER;
  const powerOf = (pop: number): number => lairPower(LAIR_ANCHOR_HOME, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, pop);
  console.log('\nЗолото логов: казна логова до тайника и обоза — во сколько дней умеренного налога она стоит на каждом этапе.');
  console.log('  Логово растёт от жителей города (lairs.lairPower), поэтому и мощь, и казна — на жителях этапа. Сколько поднимет отряд, меряет `npm run lair:report`.');
  console.log(
    `  Этапы — деревня без закята: прогон с умеренным налогом и верой, которая казну не трогает (${plain[0].faith.id}). ` +
      `Вера мира ${WORLD} (${stages[0].faith.id}) дала бы новичку ${stages[0].pop} жителей вместо ${plain[0].pop} и вывод ${(wasGold / powerOf(stages[0].pop)).toFixed(3)} золота на мощь.`,
  );
  const tithe = plain.map((s) => taxIncomePerDay(withPolicy(s, 'moderate', null)));
  console.log('  жителей на этапе: ' + plain.map((s, i) => `${STAGES[i][0]} ${s.pop}`).join(', '));
  console.log('  логово               | ' + STAGES.map(([name]) => `${name.padStart(8)}: мощь золото дн.`).join(' | '));
  const lairs: [string, number, number][] = [
    ['у дома, свежее', LAIR_ANCHOR_HOME, 0],
    ['у дома, у потолка', LAIR_ANCHOR_HOME, 1],
    ['дальнее, у потолка', LAIR_ANCHOR_FAR, 1],
  ];
  for (const [name, anchor, ripe] of lairs) {
    const cells = plain.map((st, i) => {
      const power = lairPower(anchor, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE * ripe, st.pop);
      const gold = lairGold(power);
      return `${pad(Math.round(power), 14)} ${pad(gold, 6)} ${(gold / tithe[i]).toFixed(1).padStart(4)}`;
    });
    console.log(`  ${name.padEnd(20)} | ${cells.join(' | ')}`);
  }
  const nowPower = powerOf(plain[0].pop);
  const goldShare = wasGold / nowPower;
  const lootShare = goldShare * (WAS_LOOT_PER_POWER / WAS_GOLD_PER_POWER);
  console.log(
    `  Вывод: до роста дозревшее логово у дома стоило новичку ${wasGold} золота — ${(wasGold / tithe[0]).toFixed(1)} дн. налога. ` +
      `Та же казна при нынешней мощи ${Math.round(nowPower)} — это ${goldShare.toFixed(3)} золота и ${lootShare.toFixed(3)} добра на мощь ` +
      `(добро к золоту — как было, ${WAS_LOOT_PER_POWER}:${WAS_GOLD_PER_POWER}).`,
  );
  console.log(
    `  В игре: LAIR_GOLD_PER_POWER ${LAIR_GOLD_PER_POWER}, LAIR_LOOT_PER_POWER ${LAIR_LOOT_PER_POWER}; ` +
      `дозревшее логово медианной опоры (${LAIR_ANCHOR_MID}) на этапах — ` +
      plain
        .map((st, i) => {
          const power = lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, st.pop);
          return `${STAGES[i][0]} добро ${lairLoot(power)}, золото ${lairGold(power)} (${(lairGold(power) / tithe[i]).toFixed(1)} дн.)`;
        })
        .join('; ') +
      '.',
  );
  console.log(`\n(игровой день — ${dayRealSeconds()} с настоящего времени)`);
}
