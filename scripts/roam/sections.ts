// Разделы прибора `roam:report` (ПН-0ч; ГДД 6.5 и 7.1, ПН-0). Порядок — сначала то, что считается нынешними дверями
// (содержание, курс припаса, повышение, путь, плата), потом автопилот пути на заглушках (сила НПС, престиж, замок, паритет),
// потом карта (пул) и видимость. Входы разделы берут только `ctx.use` (см. `run.ts`); отсюда — одни типы входов.
import type { Season, TroopId } from '../../src/game/types';
import type { Terrain } from '../../src/world/types';
import { troopTotal, type TroopStack } from '../../src/game/battle/kinds';
import { FREE_TIERS, FREE_TIER_NAMES, freeGold, freeId, freePoolSize, freePop, freePower, freePrestige, freeTroopPower, freeTroops } from '../../src/world/freecastle';
import { baseWage, powerOf, troopPower } from '../../src/game/battle/price';
import { soldierFoodPerDay } from '../../src/game/build';
import { DAY_LENGTH, RESOURCE_IDS, TEST_ARMY_FOOD } from '../../src/game/constants';
import { GOOD_BY_ID } from '../../src/game/data/market';
import { TROOP_BY_ID, TROOP_IDS } from '../../src/game/data/troops';
import { SALE_SHARE, buyUnit, depthOf, shiftOf } from '../../src/game/marketrules';
import { promoteUnit } from '../../src/game/promoterules';
import { hireBase, villageFoodPrice, villageStock } from '../../src/game/townrules';
import { askCap, askMult, askRange, captivesOf, drillMs } from '../../src/game/askrules';
import { awayArrival } from '../../src/game/mailgrid';
import { boardDue } from '../../src/game/townrules';
import { earnGold, earnHaul } from '../../src/game/sim/bandearn';
import { healFullSeconds, healPriceOfLeft } from '../../src/game/gemrules';
import { MINIGAMES } from '../../src/game/data/minigames';
import { captivesCapNow } from '../../netlify/lib/roambook';
import { dayRealSeconds, gameSeconds } from '../../src/game/pace';
import { bandPatienceDays, bandRationPerDay, bandWage, bandWagesPerDay, campSpirit, fieldForage, forageShare } from '../../src/game/roamrules';
import { cargoCap } from '../../src/game/sim/roam';
import { seasonModsFor, seasonOf } from '../../src/game/derived';
import { SEASONS, SEASON_META, SEASON_SECONDS } from '../../src/game/data/seasons';
import { GAIT_META, GAITS } from '../../src/world/data/gait';
import { UNIT_BY_ID } from '../../src/world/data/units';
import { selfCost } from '../../src/game/selfcost';
import { createInitialState } from '../../src/game/state';
import { BURN_IMMUNE, LAIR_GOLD_PER_POWER, TEST_TRAVEL_SPEED } from '../../src/world/data/tuning';
import type { Gait } from '../../src/world/data/gait';
import { standWay } from '../../src/world/roammove';
import { campWorks, roamWalkMs } from '../../src/world/roam';
import { nearestRuin } from '../../src/world/ruins';
import { SICILY } from '../../src/world/spawn';
import { pilot, player } from '../autopilot';
import type { InputId } from './inputs';
import { CAMPS, CAMP_NAME, type Origin } from './kinds';
import type { Ctx, Section } from './run';
import { evenPower, rowMove } from './foes';
import { RUN_STYLES, STYLES, roadHours, runPath, scaleOf, type PathKnobs, type PathRun, type Style } from './path';
import { SHIFTS_PER_DAY, bestLoop } from './trade';
import { TOWN_SPEC_META, townSpecOf } from '../../src/world/townspec';
import { placeAll } from './pool';
import { SIGHT_GOALS, STANCES, deriveSight, detectShare, goalCheck, writtenSight, type SightNumbers } from './sight';
import { RUIN_BLOCK, RUIN_CAP } from '../../src/world/data/sight';
import { cityValue, type Value, type ValuePrices } from './value';
import { pointsIn, type PointKind } from '../../src/world/roampoints';
import { FOE_KINDS, FOE_WORDS, foePower } from '../../src/world/roamfoes';
import { ambushChance } from '../../src/world/encounter';
import { menOfPower as foeMenOf } from '../../src/world/garrison';
import { roamCellBlock } from '../../src/world/roam';
import { WILD_MEAN } from '../../src/world/data/campsite';
import { campFaces, campGround, campRest, fireShare, placeForage, rationWeather, weatherForage, weatherMorale, wildFood, wildMeanOf } from '../../src/world/campsite';
import { SIGHT } from '../../src/world/data/sight';
import { fogMult } from '../../src/world/sight';
import { SPELL_DAYS, fogMorning, weatherAt } from '../../src/world/weather';
import { campSample, deriveWildMean } from './camp';
import { DEAL_DEFS, DEAL_K, DEAL_KINDS, DEAL_R, ETALONS } from '../../src/game/data/contracts';
import { advanceShare, etalonUpkeep, roadCapDays, termWords, tierWord } from '../../src/game/contractrules';
import { termsOf } from '../../src/game/sim/contracts';
import { FIGHTS_PER, KEEP_MARGIN, SHIFTS, dealSample, deriveDealKR } from './deals';

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

/** Окно пути (ГДД 2.0, 2.4 и 4.8): 42 суток — «замок — недели»; доли без разорения и дошедших — ещё к 7 и 14 сут. */
const LIMIT_DAYS = 42;

/** Входы автопилота пути: все, что читают `knobsOf` и происхождения, — раздел, берущий его партии, объявляет их все. */
export const PILOT: readonly InputId[] = [
  'sessions',
  'npcRule',
  'origins',
  'stages',
  'prestigeS',
  // Сила НПС, встречи и поражение (ПН-5) — двери игры `world/roamfoes`, `world/encounter` на заглушках игры тем же числом.
  'foeTable',
  'foeShare',
  'foeRipe',
  'ambushBase',
  'ambushCap',
  // Договоры (ПН-7) — доска `world/dealboard` и условия `contractrules` на заглушках игры: доска, дальность, сроки, груз; точки мира.
  'boardSize',
  'dealReach',
  'dealRoads',
  'dealDays',
  'dealStand',
  'dealCargo',
  'townBlock',
  'townTier',
  'villageBlock',
  'vatagaBlock',
  // Просящиеся (ПН-6) — дверь игры `askrules` на заглушках игры тем же числом; сетка прихода — почта (`mailgrid`).
  'askBase',
  'askCamp',
  'askWinter',
  'askSpirit',
  'askFeed',
  // Мораль отряда для просящихся — дверь духа отряда (`sim/bandspirit`): строка лагеря и «холодный лагерь» — заглушки игры ПН-3.
  'campMorale',
  'coldCamp',
  'foodMix',
  'defeatPurse',
  'defeatPrestige',
  // Вольные замки (ПН-10) — двери `world/freecastle` и сервер войны в памяти (`castle.castleTry`): их заглушки.
  'castleLevel',
  'castlePrestige',
  'castlePop',
  'castleWall',
  'castleTower',
  'castleHall',
  'castleShare',
  'castlePool',
  // Мир дороги (`placeAll`): пул замков, место выхода дверью ПН-3 и его заглушка (зазор; руины — вывод ПН-4у); фураж лагеря стиля — дверью.
  'pool',
  'spawnGap',
  'forageHidden',
  'forageRuin',
  // Масштабы пути по мощи (4.4) — счёт дохода и содержания по масштабу у каждой партии.
  'scales',
];

/** Мир дороги автопилота: вольные замки пула и места выхода бродяг — дверями (`placeAll`), один на все партии. */
function roadWorld(ctx: Pick<Ctx, 'use'>): Pick<PathKnobs, 'spawns' | 'castleRoads'> {
  const rule = ctx.use('pool');
  const size = freePoolSize(rule.world.bands);
  const w = placeAll(1, rule.world.lords, size, rule.world.bands);
  const roads = (g: Gait): number[] => w.toFree.map((t) => t.hours[g]);
  return { spawns: w.bands, castleRoads: { light: roads('light'), normal: roads('normal'), train: roads('train') } };
}

export function knobsOf(ctx: Pick<Ctx, 'use'>): PathKnobs {
  const stages = ctx.use('stages');
  for (const id of ['castleLevel', 'castlePrestige', 'castlePop', 'castleWall', 'castleTower', 'castleHall'] as const) ctx.use(id);
  // Договоры (ПН-7) — двери игры: доска (`world/dealboard`) и условия (`contractrules`); их заглушки автопилот объявляет (`PILOT`), а
  // читает дверью — сторож чтений держит, что объявлено всё прочитанное.
  for (const id of ['boardSize', 'dealReach', 'dealRoads', 'dealDays', 'dealStand', 'dealCargo', 'townBlock', 'townTier', 'villageBlock', 'vatagaBlock'] as const) ctx.use(id);
  return {
    sessions: ctx.use('sessions'),
    stages,
    S: ctx.use('prestigeS'),
    foeShare: ctx.use('foeShare'),
    foeRipe: ctx.use('foeRipe'),
    ...roadWorld(ctx),
    foodMix: ctx.use('foodMix'),
    // Хлеб села и рынок города — двери игры (ПН-6): цена села `townrules.villageFoodPrice`, рынок города 1-го уровня — `marketrules`.
    foodPrice: {
      village: villageFoodPrice(),
      town: townPrice('food', 1),
    },
    defeatPurse: ctx.use('defeatPurse'),
    defeatPrestige: ctx.use('defeatPrestige'),
    // Вольный замок I — дверью `world/freecastle`: порог престижа и гарнизон бойцами (тот, что встанет на стену у сервера войны).
    castle: { prestige: freePrestige(1), power: freeTroopPower(freeId(0, 0), 1) },
    // Повышение и найм — двери игры (ПН-6): разность полных цен по основе рынка (`promoterules`), найм по основе (`townrules.hireBase`).
    upgrade: promoteUnit,
    hire: hireBase,
    limitDays: LIMIT_DAYS,
    scales: ctx.use('scales'),
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
  RUN_STYLES.flatMap((st) => origins.flatMap((o) => Array.from({ length: seeds }, (_, i) => runPath(i + 1, st, o, row, even, k))));

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
  doors: ['roamrules.bandWagesPerDay', 'roamrules.bandRationPerDay', 'price.powerOf', 'build.soldierFoodPerDay', 'pace.dayRealSeconds', 'data/contracts.ETALONS'],
  uses: [],
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
    ETALONS.forEach((t, i) => {
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
    ctx.line(`обоз на голову строя (ноша бойца мира ${UNIT_BY_ID.warrior.carry}): ${GAITS.map((g) => `${GAIT_META[g].short} ${fix(cargoCap({ band: { spearman: 1 }, way: standWay(g) }), 1)}`).join(', ')}`);
    ctx.line('');
    ctx.line('фураж — доля пайка с земли (поле сезона против лучшего, вольный сбор вполсилы), в лагере и обычным маршем:');
    ctx.line(`${padEnd('сезон', 8)} ${pad('год 1', 7)} ${pad('год 2+', 7)} ${pad('паёк ×', 7)}`);
    let year = 0;
    for (const s of SEASONS) {
      const later = seasonModsFor(s, 2);
      year += fieldForage(later) / SEASONS.length;
      ctx.line(`${padEnd(SEASON_META[s].name, 8)} ${pad(pct(fieldForage(seasonModsFor(s, 1))), 7)} ${pad(pct(fieldForage(later)), 7)} ${pad(fix(later.food), 7)}`);
    }
    ctx.line(`в среднем за год (год 2+) — ${pct(year)}; налегке и с обозом в пути — ${pct(forageShare(seasonModsFor('autumn', 2), { camp: null, way: standWay('light') }))}`);
    ctx.line('ориентир ГДД 3.3.4 (в код не пошёл): весна 30 %, лето 50 %, осень 60 %, зима 0 % — в среднем 35.0 %');
    ctx.line('');
    // Пример 3.3.2 на дверях: за настоящие сутки, без фуража и со средним фуражом года.
    const wage = wagesOf(EXAMPLE) * dayGame();
    const food = rationOf(EXAMPLE) * dayGame();
    ctx.line(`пример 3.3.2 — ${stackWords(EXAMPLE)}: жалованье ${Math.round(wage)} золота в настоящие сутки, паёк ${Math.round(food)} еды без фуража, ${Math.round(food * (1 - year))} с фуражом года`);
    ctx.line(`обоз примера обычным маршем — ${Math.round(cargoCap({ band: EXAMPLE, way: standWay('normal') }))}: паёк на ${fix(cargoCap({ band: EXAMPLE, way: standWay('normal') }) / rationOf(EXAMPLE) / dayGame(), 1)} настоящих сут без фуража`);
  },
};

const camp: Section = {
  id: 'camp',
  title: 'Лагерь и руины',
  gdd: '3.5.1, 3.5.3, 3.3.3',
  doors: [
    'roamrules.forageShare',
    'roamrules.campSpirit',
    'world/roam.campWorks',
    'world/roam.roamWalkMs',
    'ruins.nearestRuin',
    'world/spawn.SICILY',
    'derived.seasonModsFor',
  ],
  uses: ['forageHidden', 'forageRuin', 'campMorale', 'coldCamp', 'healOpen'],
  run(ctx) {
    // Двери отряда — те же, что исполняет шаг бродяги: фураж по виду лагеря, строка духа «Лагерь», раненые; числа видов — заглушки.
    ctx.line('фураж (доля пайка с земли) и дух лагеря по сезонам года 2+, двери отряда:');
    ctx.line(`${padEnd('лагерь', 12)} ${SEASONS.map((x) => pad(SEASON_META[x].name, 16)).join('')}`);
    for (const c of CAMPS) {
      const rec = { kind: c, since: 0, builders: 0 };
      const cells = SEASONS.map((x) => {
        const mods = seasonModsFor(x, 2);
        const morale = campSpirit(rec, mods);
        return pad(`${pct(forageShare(mods, { camp: rec, way: standWay('normal') }))} ${morale >= 0 ? '+' : ''}${fix(morale, 1)}`, 16);
      });
      ctx.line(`${padEnd(CAMP_NAME[c], 12)} ${cells.join('')}`);
    }
    ctx.line(`раненые в открытом лагере встают в ${ctx.use('healOpen')} раза быстрее; в скрытом и в руинах — как в поле`);
    // Рогатки — та же лестница, что у осадного лагеря с тыла (`works.sideWorks`), с древесиной лагеря игрока.
    const at = [1, 3, 6, 12, 24];
    ctx.line(`рогатки стоящего лагеря: ${at.map((h) => `${h} ч — ${pct(campWorks({ kind: 'open', since: 0, builders: 0 }, h * 3_600_000))}`).join(', ')}`);
    ctx.line('');
    // Густота и вместимость руин — вывод видимости (ПН-4у, раздел «Доля обнаружений по видам лагеря»).
    const block = RUIN_BLOCK;
    ctx.line(`руины — одни на квадрат ${block} × ${block} клеток, где мог стоять двор; встают в них до ${RUIN_CAP} человек`);
    const near = SICILY.map((at) => {
      const r = nearestRuin(at, 3 * block);
      return r ? { cells: Math.hypot(r.x - at.x, r.y - at.y), hours: roamWalkMs(at, r, 'normal') / 3_600_000 } : null;
    });
    const got = near.filter((x): x is { cells: number; hours: number } => x !== null);
    ctx.line(
      `от ${SICILY.length} мест Сицилии до ближайших руин (не дальше ${3 * block} клеток): нашлись у ${got.length}; клеток — медиана ${fix(median(got.map((x) => x.cells)), 1)}, худшее ${fix(Math.max(...got.map((x) => x.cells)), 1)}; путь отряда обычным — медиана ${hrs(median(got.map((x) => x.hours)))}`,
    );
  },
};

const rate: Section = {
  id: 'rate',
  title: 'Курс припаса',
  gdd: '3.3.4, 4.3',
  doors: [
    'selfcost.selfCost',
    'data/market (основа цен)',
    'marketrules.buyUnit',
    'townrules.villageFoodPrice',
    'townrules.villageStock',
    'price.baseWage',
    'build.soldierFoodPerDay',
    'data/contracts.ETALONS',
  ],
  uses: [],
  run(ctx) {
    ctx.line('золота за единицу: своим трудом (цена мощи вида и склада), основа рынка, рынок города 1-го и 5-го уровня (привоз 12:00 UTC)');
    ctx.line(`${padEnd('припас', 10)} ${pad('свой труд', 10)} ${pad('основа', 7)} ${pad('город 1', 8)} ${pad('город 5', 8)}`);
    for (const r of RESOURCE_IDS) {
      const g = GOOD_BY_ID[r];
      ctx.line(`${padEnd(g.name, 10)} ${pad(fix(selfCost(g), 4), 10)} ${pad(g.price, 7)} ${pad(townPrice(r, 1), 8)} ${pad(townPrice(r, 5), 8)}`);
    }
    ctx.line('');
    const food = GOOD_BY_ID.food;
    // Хлеб села (ПН-6, находка ПН-0ч: 0.054 — почти даром): цель — «дешевле города, но не почти даром»; вывод — цена, за которую купцы
    // города берут хлеб (`SALE_SHARE` × основа): крестьянин не продаст дешевле, чем отдал бы купцу. Запас — двор 1-го уровня в день.
    const village = villageFoodPrice();
    ctx.line(`хлеб села (ГДД 3.3.4, ПН-6): ${fix(village, 4)} золота — доля продажи рынка ${SALE_SHARE} × основа ${food.price}; запас ${villageStock()} в игр. день, отходит за игр. день`);
    ctx.line(`  цель «дешевле города»: ${fix(village, 2)} < ${townPrice('food', 1)} (город 1) — ${village < townPrice('food', 1) ? 'держится' : 'НЕ ДЕРЖИТСЯ'}`);
    ctx.line(`  цель «не почти даром»: ${fix(village, 2)} ≥ своего труда × 10 (${fix(selfCost(food) * 10, 4)}) — ${village >= selfCost(food) * 10 ? 'держится' : 'НЕ ДЕРЖИТСЯ'}`);
    ctx.line('');
    const rates: [string, number][] = [
      ['свой труд', selfCost(food)],
      ['село', village],
      ['основа рынка', food.price],
      ['город 1', townPrice('food', 1)],
    ];
    ctx.line('еда против ориентира содержания эталона:');
    for (const [name, x] of rates) ctx.line(`  ${padEnd(name, 13)} ${pad(fix(x, 4), 8)} — ${ctx.target('foodGold', x, (v) => fix(v, 2))}`);
    ctx.line('');
    ctx.line('содержание эталона тира за игровой день, золотом: жалованье + еда по курсу; доля еды в содержании');
    ctx.line(`${padEnd('тир', 4)} ${pad('жалованье', 10)} ${rates.map(([n]) => pad(n, 16)).join('')}`);
    ETALONS.forEach((t, i) => {
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
  doors: ['promoterules.promoteUnit (дерево из снаряжения, разность полных цен)', 'townrules.hireBase', 'askrules.drillMs', 'price.baseWage'],
  uses: [],
  run(ctx) {
    const up = promoteUnit;
    const hire = hireBase;
    ctx.line(`${padEnd('вид', 16)} ${pad('из дубинщика', 13)} ${pad('найм в городе', 14)} ${pad('учения', 9)} ${pad('жалованье было → стало', 24)}`);
    for (const id of TROOP_IDS) {
      if (id === 'clubman') continue;
      ctx.line(
        `${padEnd(TROOP_BY_ID[id].name, 16)} ${pad(up('clubman', id), 13)} ${pad(hire(id), 14)} ${pad(hrs(drillMs(id, 1) / 3_600_000), 9)} ${pad(`${fix(baseWage('clubman'))} → ${fix(baseWage(id))}`, 24)}`,
      );
    }
    // ГДД 3.4.2: «по шагам стоит столько же, сколько сразу» — с ПН-6 цена шага — разность полных цен (`promoterules`), и разности
    // складываются; прежняя формула шага (`max(0, …)` по припасу) давала 816 против 631.
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
  doors: ['contractrules.contractTerms', 'contractrules.etalonUpkeep', 'data/contracts (K, R — вывод раздела «Договоры: K и R видов»)', 'world/dealboard.boardsAt', 'world/roam.roamWalkMs'],
  uses: ['dealRoads', 'dealDays', 'dealStand', 'dealReach', 'dealCargo', 'boardSize', 'stages', 'foeTable', 'foeShare', 'foeRipe', 'townBlock', 'townTier', 'villageBlock', 'vatagaBlock'],
  run(ctx) {
    ctx.line(`содержание эталона тира за игр. день (хлеб по цене села ${fix(villageFoodPrice(), 2)}): ${([1, 2, 3] as const).map((t) => `${tierWord(t)} ${fix(etalonUpkeep(t), 1)}`).join(' · ')}`);
    ctx.line(`потолок дороги в плате — ${fix(roadCapDays(), 1)} игр. дн. (два радиуса доски, ${ctx.use('dealReach').target} клеток); аванс при Дипломатии 1 — ${pct(advanceShare(1))}, неустойка — аванс × 1.5, отказ — половина`);
    ctx.line('');
    ctx.line('выборка досок у мест Сицилии (раздел «Договоры: K и R видов»): медианы по виду и тиру — срок, плата, аванс, неустойка, престиж');
    ctx.line(`${padEnd('вид', 20)} ${padEnd('тир', 4)} ${pad('n', 5)} ${pad('срок', 14)} ${pad('плата', 7)} ${pad('аванс', 6)} ${pad('неуст.', 7)} ${pad('престиж', 8)}`);
    const sample = dealSample();
    for (const kind of DEAL_KINDS) {
      for (const t of [1, 2, 3] as const) {
        const list = sample.offers.filter((o) => o.kind === kind && o.tier === t).map((o) => termsOf(o));
        if (list.length === 0) continue;
        const m = (f: (x: (typeof list)[number]) => number): number => median(list.map(f));
        ctx.line(
          `${padEnd(DEAL_DEFS[kind].name, 20)} ${padEnd(tierWord(t), 4)} ${pad(list.length, 5)} ${pad(`${fix(m((x) => x.days), 1)} (${termWords(m((x) => x.days))})`, 14)} ${pad(Math.round(m((x) => x.pay)), 7)} ${pad(Math.round(m((x) => x.advance)), 6)} ${pad(Math.round(m((x) => x.penalty)), 7)} ${pad(Math.round(m((x) => x.fame)), 8)}`,
        );
      }
    }
    ctx.line('');
    ctx.line('против таблицы ГДД 4.3 (плата за 10 игр. дн. при K = 1.6, без риска, «еда по 3»: I ≈ 950, II ≈ 2 670) — тем же содержанием эталона:');
    for (const t of [1, 2, 3] as const) ctx.line(`  тир ${padEnd(tierWord(t), 3)}: 10 игр. дн. содержания — ${Math.round(etalonUpkeep(t) * 10)}, × K «Сжечь логово» ${DEAL_K.lair} — ${Math.round(etalonUpkeep(t) * 10 * DEAL_K.lair)}`);
  },
};

const deals: Section = {
  id: 'deals',
  title: 'Договоры: K и R видов',
  gdd: '3.8.3, 3.8.2',
  doors: ['world/dealboard.boardsAt', 'contractrules.dealDays', 'world/encounter.strikeFight, ambushFight, ambushChance', 'townrules.hireBase', 'world/gen (логова)', 'world/spawn.SICILY'],
  uses: ['sessions', 'dealRoads', 'dealDays', 'dealStand', 'dealReach', 'dealCargo', 'boardSize', 'stages', 'foeTable', 'foeShare', 'foeRipe', 'ambushBase', 'ambushCap', 'townBlock', 'townTier', 'villageBlock', 'vatagaBlock'],
  run(ctx) {
    const sessions = ctx.use('sessions');
    ctx.line(`цели (ГДД 20.2): Д1 — эталон тира, живущий договорами вида по одному, покрывает содержание с запасом ${pct(KEEP_MARGIN)} за цикл (дорога, стоянка, ожидание захода: ${sessions.per[0]}–${sessions.per[1]} заходов в часы ${sessions.wake[0]}–${sessions.wake[1]}); K = ${1 + KEEP_MARGIN} × Σцикл / Σсрок`);
    ctx.line(`  Д2 — доля риска возмещает людей эталона, павших в боях договора (бой с целью; засады на дорогах — шансом двери встреч), по цене найма по основе; R = Σпотерь / Σ(мощь × ${LAIR_GOLD_PER_POWER})`);
    const sample = dealSample();
    ctx.line(`выборка: ${SICILY.length} мест Сицилии × ${SHIFTS} привозов × тиры I–III — предложений ${sample.offers.length}; боёв на вид и тир — до ${FIGHTS_PER}`);
    const out = deriveDealKR(sample, sessions);
    ctx.line(`${padEnd('вид', 20)} ${pad('n', 5)} ${pad('срок', 7)} ${pad('занят', 7)} ${pad('цикл', 7)} ${pad('K', 6)} ${pad('боёв', 5)} ${pad('потери', 8)} ${pad('R', 7)}   записано K, R`);
    let same = true;
    for (const r of out.rows) {
      const ok = DEAL_K[r.kind] === r.K && DEAL_R[r.kind] === r.R;
      same &&= ok;
      ctx.line(
        `${padEnd(DEAL_DEFS[r.kind].name, 20)} ${pad(r.n, 5)} ${pad(fix(r.term, 1), 7)} ${pad(fix(r.busy, 1), 7)} ${pad(fix(r.cycle, 1), 7)} ${pad(fix(r.K), 6)} ${pad(r.fights, 5)} ${pad(Math.round(r.loss), 8)} ${pad(fix(r.R), 7)}   ${fix(DEAL_K[r.kind])}, ${fix(DEAL_R[r.kind])}${ok ? '' : ' — РАЗОШЛОСЬ'}`,
      );
    }
    ctx.line(`таблица игры (game/data/contracts.DEAL_K, DEAL_R): ${same ? 'совпадает с выведенной' : 'РАЗОШЛАСЬ с выведенной — перенести выведенное'}`);
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
      `автопилот: ${RUN_STYLES.map((s) => s.name).join(', ')} × ${origins.map((o) => o.name).join(', ')} × ${sz.seeds} сидов; ровный бой — ${sz.even} боёв на точку; окно ${LIMIT_DAYS} сут`,
    );
    ctx.line(
      `стили пути (ГДД 3.7.0): ${STYLES.map((s) => `${s.name} — ${s.missing ? `НЕ ГОНЯЕТСЯ: дел пути нет в коде (${s.missing})` : `${s.lives}; до ${s.edge} ровного боя, лагерь ${CAMP_NAME[s.camp]}, марш ${s.gait}, запас — до захода и ещё ${s.margin} ч, рост и просящиеся — пока содержание × ${s.keep} ≤ доход 48 ч, растит «${TROOP_BY_ID[s.grow].name.toLowerCase()}»${s.castle ? ', на замок — когда окно замка выполнено (freeNeeds), осадой' : ''}`}`).join('; ')}`,
    );
    ctx.line(`вольный замок I: гарнизон ${fix(k.castle.power, 1)} мощи бойцами (${troopTotal(freeTroops(freeId(0, 0), 1))} бойцов строя), с престижа ${k.castle.prestige}`);
    // Начало — с записанной в игре (ПН-5, заглушка `foeTable`: её читают засады, логова и ватаги мира бродяги): неподвижная точка
    // проверяет, что записанное и есть вывод. Ровный бой к мощи эталона на первом шаге — ровный бой отряда происхождения медианной
    // мощи (оценка автопилота «по силам ли дело»), дальше — эталонов ступеней.
    const written = [...ctx.use('foeTable')];
    const first = [...origins].sort((a, b) => troopPower(a.band) - troopPower(b.band))[Math.floor((origins.length - 1) / 2)];
    const e0 = evenPower(first.band, sz.even, 'start');
    let even = k.stages.map(() => e0 / troopPower(first.band));
    let row = k.stages.map((_, i) => written[Math.min(i, written.length - 1)]);
    ctx.line(`начало: записано в игре (game/roamstubs.foeTable) — ${row.join(', ')}; ровный бой отряда «${first.name}» (${stackWords(first.band)}) / ${npc.edge} — ${Math.round(e0 / npc.edge)}`);
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
        // Села: выведенное в пределах допуска от записанного — записанное и есть неподвижная точка (как строка таблицы у ворот).
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
    const same = row.length === written.length && row.every((x, i) => x === written[i]);
    ctx.line(
      `таблица игры (game/roamstubs.foeTable): ${same ? 'совпадает с выведенной' : `РАЗОШЛАСЬ с выведенной — в игре ${written.join(', ')}; перенести выведенное: ${row.join(', ')}`}`,
    );
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
    ctx.line(`пороги ступеней: ${p.knobs.stages.join(', ')}; партий на стиль ${p.runs.length / RUN_STYLES.length}`);
    ctx.line(
      `${padEnd('стиль', 11)} ${p.knobs.stages
        .slice(1)
        .map((v, i) => pad(`ступень ${i + 1} (${v})`, 22))
        .join('')} ${pad('престиж к сроку', 16)}`,
    );
    for (const st of RUN_STYLES) {
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
  doors: ['партии автопилота раздела «Сила НПС»', 'freecastle.freeNeeds — окно замка'],
  uses: PILOT,
  run(ctx) {
    const p = ctx.take<Pilot>('pilot');
    ctx.line(
      `${padEnd('стиль', 11)} ${padEnd('происхождение', 14)} ${pad('дошли', 7)} ${pad('медиана', 12)} ${pad('быстрее всех', 13)} ${pad('дел', 5)} ${pad('побед', 6)} ${pad('сорвано', 8)} ${pad('договоры', 9)} ${pad('осад', 5)} ${pad('ушло', 5)} ${pad('распущено', 10)} ${pad('пришло', 7)}`,
    );
    for (const st of RUN_STYLES) {
      for (const o of p.origins) {
        const rs = p.runs.filter((r) => r.style === st.id && r.origin === o.id);
        const at = rs.map((r) => r.castleAt ?? Infinity);
        const n = at.filter(Number.isFinite).length;
        ctx.line(
          `${padEnd(st.name, 11)} ${padEnd(o.name, 14)} ${pad(`${n}/${rs.length}`, 7)} ${pad(days(median(at)), 12)} ${pad(days(Math.min(...at)), 13)} ${pad(Math.round(median(rs.map((r) => r.deeds))), 5)} ${pad(Math.round(median(rs.map((r) => r.wins))), 6)} ${pad(Math.round(median(rs.map((r) => r.failed))), 8)} ${pad(Math.round(median(rs.map((r) => r.earned))), 9)} ${pad(rs.reduce((n, r) => n + r.storms, 0), 5)} ${pad(Math.round(median(rs.map((r) => r.deserted))), 5)} ${pad(Math.round(median(rs.map((r) => r.dismissed))), 10)} ${pad(Math.round(median(rs.map((r) => r.recruited))), 7)}`,
        );
      }
    }
    ctx.line('');
    for (const st of RUN_STYLES) {
      const power = p.runs.filter((r) => r.style === st.id).map((r) => troopPower(r.band));
      const rs = p.runs.filter((r) => r.style === st.id);
      ctx.line(
        `${st.name}: мощь отряда к концу — медиана ${fix(median(power), 1)}, лучшая ${fix(Math.max(...power), 1)}; гарнизон вольного замка I — ${p.knobs.castle.power}; кошель к концу — медиана ${Math.round(median(rs.map((r) => r.purse)))}, престиж — ${Math.round(median(rs.map((r) => r.prestige)))}`,
      );
    }
    // Цели 2.4 (2.0) — у стиля «к замку»: путь к замку — выбор, а не обязанность (Р-1).
    const rs = p.runs.filter((r) => STYLES.find((x) => x.id === r.style)?.castle);
    const at = rs.map((r) => (r.castleAt ?? Infinity) / 24);
    const by = (d: number): number => at.filter((x) => x <= d).length / Math.max(1, at.length);
    ctx.line(`к замку: медиана ${days(median(at) * 24)} — ${ctx.target('castleMedian', median(at), (v) => fix(v, 0))}`);
    ctx.line(`  дошли за 14 сут ${pct(by(14))} — ${ctx.target('castleShare14', by(14), pct)}`);
    ctx.line(`  дошли за ${LIMIT_DAYS} сут ${pct(by(LIMIT_DAYS))} — ${ctx.target('castleShare42', by(LIMIT_DAYS), pct)}`);
    const ready = rs.filter((r) => r.storms > 0).length;
    ctx.line(`  окно замка выполнено хоть раз (пошли на осаду): ${ready} из ${rs.length}; осад — ${rs.reduce((n, r) => n + r.storms, 0)}, пиков на одну осаду — ${rs.reduce((n, r) => n + r.peaks, 0)}, павших под стенами — ${rs.reduce((n, r) => n + r.castleLost, 0)}`);
  },
};

/** Масштабы словами (ГДД 4.4) — по номеру `scaleOf`. */
const SCALE_NAMES = ['тать', 'ватага', 'отряд', 'войско'] as const;

/** Свои масштабы пути (ГДД 4.4, «Окупается»): мирный — ватага и отряд; вор — тать; разбойник — отряд и войско; к замку — отряд и войско. */
const OWN_SCALES: Record<Style['id'], readonly number[]> = { peace: [1, 2], thief: [0], robber: [2, 3], castle: [2, 3] };

const paths: Section = {
  id: 'paths',
  title: 'Окупаемость путей',
  gdd: '2.4, 4.4, 4.8',
  doors: ['партии автопилота раздела «Сила НПС»', 'sim/bandkeep.bandUpkeep', 'roamrules.bandWagesPerDay, forageShare'],
  uses: [...PILOT, 'theftDeeds', 'raidDeeds'],
  run(ctx) {
    ctx.use('theftDeeds');
    ctx.use('raidDeeds');
    const p = ctx.take<Pilot>('pilot');
    const edges = ctx.use('scales');
    ctx.line(`масштабы по мощи отряда (4.4): ${SCALE_NAMES.map((n, i) => `${n} ${i === 0 ? `≤ ${edges[0]}` : i < edges.length ? `${edges[i - 1]}…${edges[i]}` : `> ${edges[edges.length - 1]}`}`).join(', ')}`);
    ctx.line('доход — аванс, плата и добыча дел; содержание — жалованье и хлеб, которого не дала земля; за настоящие сутки на том масштабе, где отряд был');
    ctx.line(`${padEnd('путь', 11)} ${padEnd('масштаб', 8)} ${pad('доля часов', 11)} ${pad('доход/сут', 10)} ${pad('содерж./сут', 12)} ${pad('доход/содерж.', 14)}  цель (свой масштаб)`);
    for (const st of STYLES) {
      if (st.missing) {
        ctx.line(`${padEnd(st.name, 11)} не измерено: дел пути нет в коде (${st.missing}) — ${st.lives}`);
        continue;
      }
      const rs = p.runs.filter((r) => r.style === st.id);
      const all = rs.reduce((n, r) => n + r.byScale.reduce((m, b) => m + b.hours, 0), 0);
      for (let sc = 0; sc < SCALE_NAMES.length; sc++) {
        const hours = rs.reduce((n, r) => n + (r.byScale[sc]?.hours ?? 0), 0);
        if (!(hours > 0)) continue;
        const income = rs.reduce((n, r) => n + (r.byScale[sc]?.income ?? 0), 0);
        const upkeep = rs.reduce((n, r) => n + (r.byScale[sc]?.upkeep ?? 0), 0);
        const ratio = upkeep > 0 ? income / upkeep : NaN;
        const own = OWN_SCALES[st.id].includes(sc);
        ctx.line(
          `${padEnd(st.name, 11)} ${padEnd(SCALE_NAMES[sc], 8)} ${pad(pct(hours / all), 11)} ${pad(Math.round((income / hours) * 24), 10)} ${pad(Math.round((upkeep / hours) * 24), 12)} ${pad(fix(ratio), 14)}  ${own ? ctx.target('pathPay', ratio) : '— не свой масштаб'}`,
        );
      }
    }
    ctx.line('');
    ctx.line('без разорения (неуплата не увела отряд целиком):');
    for (const st of STYLES) {
      if (st.missing) {
        ctx.line(`  ${padEnd(st.name, 11)} не измерено (${st.missing})`);
        continue;
      }
      const rs = p.runs.filter((r) => r.style === st.id);
      const alive = (d: number): number => rs.filter((r) => r.ruinedAt === null || r.ruinedAt > d * 24).length / Math.max(1, rs.length);
      ctx.line(`  ${padEnd(st.name, 11)} к 7 сут ${pct(alive(7))} — ${ctx.target('pathAlive', alive(7), pct)}; к 14 сут ${pct(alive(14))} — ${ctx.target('pathAlive', alive(14), pct)}; к ${LIMIT_DAYS} сут ${pct(alive(LIMIT_DAYS))}`);
    }
    ctx.line('');
    // Почему тает отряд (ГДД 7.1, ПН-Э1: разбором прибора; правка — числами путей, а не `wageOf`): куда ушли люди — суммой по партиям.
    ctx.line('куда уходят люди (сумма по партиям стиля): неуплата — уход дверью содержания; распущено — политикой автопилота до неуплаты;');
    ctx.line('  пало — в боях договоров по тиру дела, в засадах в пути, под стенами замка; пришло — просящиеся');
    ctx.line(`${padEnd('путь', 11)} ${pad('неуплата', 9)} ${pad('распущено', 10)} ${pad('бои I', 6)} ${pad('бои II', 7)} ${pad('бои III', 8)} ${pad('засады', 7)} ${pad('замок', 6)} ${pad('пришло', 7)}`);
    for (const st of RUN_STYLES) {
      const rs = p.runs.filter((r) => r.style === st.id);
      const sum = (f: (r: PathRun) => number): number => Math.round(rs.reduce((n, r) => n + f(r), 0));
      ctx.line(
        `${padEnd(st.name, 11)} ${pad(sum((r) => r.deserted), 9)} ${pad(sum((r) => r.dismissed), 10)} ${pad(sum((r) => r.fallen[0]), 6)} ${pad(sum((r) => r.fallen[1]), 7)} ${pad(sum((r) => r.fallen[2]), 8)} ${pad(sum((r) => r.ambushLost), 7)} ${pad(sum((r) => r.castleLost), 6)} ${pad(sum((r) => r.recruited), 7)}`,
      );
    }
    ctx.share('scaleIncome', { edges, peace: p.runs.filter((r) => r.style === 'peace') });
  },
};

/** Настоящая минута рейсов торговца — та же сетка, что у автопилота (01.10.2026, 00:00 UTC). */
const T0_TRADE = Date.UTC(2026, 9, 1);

/** Отряды-представители масштабов для рейса торговца: отряд происхождения медианной мощи, эталоны тира I–III (`data/contracts.ETALONS`). */
const tradeBands = (origins: readonly Origin[]): TroopStack[] => [
  [...origins].sort((a, b) => troopPower(a.band) - troopPower(b.band))[Math.floor((origins.length - 1) / 2)].band,
  ...ETALONS,
];

const trade: Section = {
  id: 'trade',
  title: 'Торговля между городами',
  gdd: '3.7.1, 4.8',
  doors: [
    'world/townspec.townSpecOf, specMult',
    'marketrules.specGood, buyUnit, sellUnit, supplyOf, shiftOffer, purseOf',
    'townrules.townMarketLevel',
    'cargocap.cargoCap',
    'world/roam.roamWalkMs',
    'партии стиля «мирный» раздела «Окупаемость путей»',
  ],
  uses: [...PILOT, 'theftDeeds', 'raidDeeds', 'townSpec', 'townMarket'],
  run(ctx) {
    ctx.use('theftDeeds');
    ctx.use('raidDeeds');
    ctx.use('townMarket');
    const written = ctx.use('townSpec');
    const got = ctx.take<{ edges: readonly number[]; peace: PathRun[] }>('scaleIncome');
    const p = ctx.take<Pilot>('pilot');
    // Доход договоров на масштабе — у мирного пути (аванс, плата и добыча в час на масштабе).
    const dealRate = (sc: number): number => {
      const h = got.peace.reduce((n, r) => n + (r.byScale[sc]?.hours ?? 0), 0);
      return h > 0 ? got.peace.reduce((n, r) => n + (r.byScale[sc]?.income ?? 0), 0) / h : NaN;
    };
    // Города рейса — у мест выхода мира дороги: ближайший вольный город (доска договоров, как `path.nearestTown`); соседи — до 40 клеток.
    const homes = [
      ...new Map(
        p.knobs.spawns
          .map((sp) => pointsIn(0, sp.x - 40, sp.y - 40, sp.x + 41, sp.y + 41).filter((q) => q.kind === 'town' && q.tier > 0).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0])
          .filter((t) => t !== undefined)
          .map((t) => [t.id, t] as const),
      ).values(),
    ];
    const specs = new Map<string, number>();
    for (const h of homes) {
      const n = TOWN_SPEC_META[townSpecOf(h.x, h.y)].name;
      specs.set(n, (specs.get(n) ?? 0) + 1);
    }
    ctx.line(`города рейса: ${homes.length} (ближайшие к местам выхода), специализации — ${[...specs].map(([n, c]) => `${n} ${c}`).join(', ')}; рейс — туда и обратно, лучший товар каждой ноги, все ${SHIFTS_PER_DAY} привозов суток; засад и ожидания привоза нет — верхняя граница`);
    // Доход торговца в час (без содержания — оно то же, что у договоров того же отряда): медиана по городам и привозам.
    const rateOf = (band: TroopStack, swing: number): { rate: number; caps: Record<string, number> } => {
      const rates: number[] = [];
      const caps: Record<string, number> = {};
      for (const h of homes) {
        for (let i = 0; i < SHIFTS_PER_DAY; i++) {
          const loop = bestLoop(h, band, swing, T0_TRADE + (i * 86_400_000) / SHIFTS_PER_DAY, 40);
          rates.push(loop ? loop.profit / loop.hours : 0);
          for (const l of loop?.legs ?? []) if (l) caps[l.cap] = (caps[l.cap] ?? 0) + 1;
        }
      }
      return { rate: median(rates), caps };
    };
    const swings = [written, 0.4, 0.6, 0.8];
    ctx.line(`${padEnd('отряд', 40)} ${padEnd('масштаб', 8)} ${pad('договоры/ч', 11)} ${swings.map((w) => pad(`торг/ч при ${fix(w)}`, 17)).join('')}`);
    for (const b of tradeBands(p.origins)) {
      const sc = scaleOf(troopPower(b), got.edges);
      ctx.line(`${padEnd(`${stackWords(b)} (${Math.round(troopPower(b))})`, 40)} ${padEnd(SCALE_NAMES[sc], 8)} ${pad(fix(dealRate(sc), 1), 11)} ${swings.map((w) => pad(fix(rateOf(b, w).rate, 1), 17)).join('')}`);
    }
    // Вывод размаха: доход торговца-ватаги (первый представитель масштаба «ватага») к доходу договоров ватаги = 1 (середина цели 0.8…1.25), делением пополам.
    const band = tradeBands(p.origins).find((b) => scaleOf(troopPower(b), got.edges) === 1) ?? ETALONS[1];
    const sc = scaleOf(troopPower(band), got.edges);
    const deal = dealRate(sc);
    const ratio = (w: number): number => rateOf(band, w).rate / deal;
    ctx.line('');
    ctx.line(`вывод размаха (цель — доход торговца-${SCALE_NAMES[sc]} ≈ доходу её договоров, ${fix(deal, 1)} в час):`);
    const top = 0.9;
    const atTop = ratio(top);
    const atWritten = ratio(written);
    ctx.line(`  записано ${fix(written)}: ${fix(atWritten)} × — ${ctx.target('tradeMatch', atWritten)}`);
    if (!(atTop >= 1)) {
      const caps = rateOf(band, top).caps;
      const all = Object.values(caps).reduce((n, v) => n + v, 0);
      const words: Record<string, string> = { cargo: 'обоз', supply: 'запас привоза', purse: 'кошель купцов', press: 'нажим' };
      ctx.line(`  НЕ СХОДИТСЯ: даже при размахе ${fix(top)} торговец даёт ${fix(atTop)} × договоров — размахом цель не достаётся`);
      ctx.line(`  что держит ногу рейса при ${fix(top)} (доля ног): ${Object.entries(caps).map(([k, v]) => `${words[k]} ${pct(v / Math.max(1, all))}`).join(', ')}`);
      ctx.line(`  размах остаётся заглушкой ${fix(written)} (game/roamstubs.townSpec); правка — числами пути (обоз, телеги, кошель купцов гостям) пачкой ПН-Э2, не правилом рынка лорда`);
      return;
    }
    let lo = 0;
    let hi = top;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (ratio(mid) < 1) lo = mid;
      else hi = mid;
    }
    const out = Math.round(hi * 100) / 100;
    ctx.line(`  сошлось: размах ${fix(out)} — ${fix(ratio(out))} × (${ctx.target('tradeMatch', ratio(out))}); записано ${fix(written)} — ${Math.abs(out - written) < 0.005 ? 'совпадает' : 'РАЗОШЛОСЬ: записать в game/roamstubs.townSpec'}`);
  },
};

/** Раздел пути, дел которого в коде нет: печатает «не измерено», что меряет и цель (правило 12). */
const missing = (id: string, title: string, gdd: string, input: InputId, what: string, target: string): Section => ({
  id,
  title,
  gdd,
  doors: [],
  uses: [input],
  run(ctx) {
    ctx.use(input);
    ctx.line(`не измерено: ${what}`);
    ctx.line(`цель (ГДД 2.4, 4.8): ${target}`);
  },
});

const theft = missing('theft', 'Воровство', '3.7.8, 4.8', 'theftDeeds', 'доля удач и поимок по делу × тень × дозор, доход вора за сутки против содержания тати — кода кражи нет (ПН-В)', 'окупается при ≤ 10 людях, не окупается при ≥ 40');
const raid = missing('raid', 'Разбой: окупаемость по мощи', '3.7.2, 3.7.3, 3.7.9, 4.8', 'raidDeeds', 'набег на село, караван, земли лорда (город мерки уровня): добыча − потери по мощи отряда — кода разбоя нет (ПН-8в, ПН-Н)', 'порог окупаемости — масштаб «отряд» для сёл, «войско» для лорда');
const fort = missing('fort', 'Форт против банды', '3.16.4, 4.8', 'fortDeeds', 'чистый доход за 14 / 28 сут по путям; потери, если форт найден и осаждён — кода форта нет (ПН-Ф)', 'ни один не лучше всегда (3.16.4)');
const merc = missing('merc', 'Наёмники', '3.17, 4.8', 'mercDeeds', 'медиана до замка с наёмниками 0 / N / 2N алмазов в неделю — кода наёмников нет (ПН-М); предел — 0,6 гарнизона ступени доступа (ВР3)', '1–2 недели; быстрейший ≥ 5 сут');
const race = missing('race', 'Гонка нападения и защиты', '4.6, 4.8', 'mercDeeds', 'доля взятых городов игроков при равной трате на наёмников и стражу — кода наёмников и стражи нет (ПН-М), захвата города игрока нет (ПН-11б)', '≤ 25 %');

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
      g.gold = freeGold(1) + r.purse;
      for (const id of TROOP_IDS) g.army[id] = Math.max(0, Math.round(r.band[id] ?? 0));
      return cityValue(g, prices);
    };
    if (took.length === 0) {
      ctx.line('замка не взяла ни одна партия — паритет нечем мерить');
      return;
    }
    for (const st of RUN_STYLES) {
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
    'world/roam.placeBand',
    'world/roam.roamWalkMs',
    'data/events.GATE_POWER',
    'garrison.menOfPower',
    'tuning.CASTLE_GOLD_PER_POWER',
    'tuning.BURN_IMMUNE',
  ],
  uses: PILOT,
  run(ctx) {
    const rule = ctx.use('pool');
    const pool = ctx.use('castlePool');
    const levels = ctx.use('castleLevel');
    const gap = ctx.use('spawnGap');
    ctx.line(`${padEnd('ступень', 20)} ${pad('ур.', 5)} ${pad('мощь', 6)} ${pad('бойцов', 7)} ${pad('казна', 6)} ${pad('население', 10)} ${pad('доступ', 7)}`);
    for (const t of FREE_TIERS) {
      const power = freePower(t);
      ctx.line(
        `${padEnd(FREE_TIER_NAMES[t], 20)} ${pad(fix(levels[t - 1], 2), 5)} ${pad(power, 6)} ${pad(troopTotal(freeTroops(freeId(0, 0), t)), 7)} ${pad(freeGold(t), 6)} ${pad(freePop(t), 10)} ${pad(freePrestige(t), 7)}`,
      );
    }
    ctx.line(`сожжённый — восстановление ${fix(BURN_IMMUNE / 3_600_000 / 24, 1)} сут (BURN_IMMUNE)`);
    const p = ctx.take<Pilot>('pilot');
    const share = p.runs.filter((r) => r.castleAt !== null).length / p.runs.length;
    ctx.line('');
    ctx.line(
      `пул = max(${pool.base}, ceil(бродяг × ${pool.share})) — дверь реестра fillFree (freecastle.freePoolSize); выход — дверью placeBand: у руин или опушки, не ближе ${gap} клеток к замкам игроков и к новичкам; ${ctx.size.pool} расселений на строку`,
    );
    ctx.line(`мир дороги автопилота: ${rule.world.bands} бродяг, ${rule.world.lords} лордов; путь до ближайшего вольного — обычным маршем`);
    ctx.line(`дошли до замка за ${LIMIT_DAYS} сут у автопилота: ${pct(share)} — столько замков нужно на бродягу к сроку`);
    ctx.line(`${pad('бродяг', 7)} ${pad('лордов', 7)} ${pad('пул', 5)} ${pad('нужно к сроку', 14)} ${pad('до ближ. вольного', 18)} ${pad('худший', 8)}`);
    for (const bands of [2, 5, 20, 50]) {
      const size = freePoolSize(bands);
      for (const lords of [0, bands]) {
        const to = Array.from({ length: ctx.size.pool }, (_, run) => placeAll(run + 1, lords, size, bands).toFree).flat();
        const hours = to.map((x) => x.hours.normal);
        ctx.line(
          `${pad(bands, 7)} ${pad(lords, 7)} ${pad(size, 5)} ${pad(fix(bands * share, 1), 14)} ${pad(hrs(median(hours)), 18)} ${pad(hrs(Math.max(...hours)), 8)}`,
        );
      }
    }
  },
};

/** Числа видимости строками «имя — значение», в том порядке, в каком их печатает вывод. */
function sightRows(n: SightNumbers): [string, number][] {
  const t = n.table;
  return [
    ['местность: лес', t.ground.forest],
    ['местность: холмы', t.ground.hills],
    ['местность: горы', t.ground.mountains],
    ['местность: степь', t.ground.steppe],
    ['местность: пустыня', t.ground.desert],
    ['лагерь открытый', t.camp.open],
    ['лагерь скрытый', t.camp.hidden],
    ['лагерь в руинах', t.camp.ruin],
    ['в пути', t.march],
    ['марш налегке', t.gait.light],
    ['марш с обозом', t.gait.train],
    ['размер: степень', t.size.pow],
    ['размер: пол', t.size.floor],
    ['ночь', t.night],
    ['обзор отряда, кл.', t.band],
    ['зима (сезон)', n.winter],
    ['вместимость руин, чел.', n.cap],
    ['густота руин, кл.', n.block],
  ];
}

const sight: Section = {
  id: 'sight',
  title: 'Доля обнаружений по видам лагеря',
  gdd: '3.5.3, 3.5.4, 3.14, 0.2',
  doors: ['world/sight.conspicuity', 'world/sight.detectRange', 'settle.placeCastle', 'ruins.nearestRuin', 'geography.terrainAt', 'world/spawn.SICILY'],
  uses: [],
  run(ctx) {
    // Мир выборки: столько лордов, сколько мест у теста с игроками (`spawn.SICILY`), расселением игры (`settle.placeCastle`).
    const world = { lords: SICILY.length };
    const runs = ctx.size.sight;
    ctx.line(`цели обнаружения — ГДД 3.5.4 (решение ПН-4у): наблюдатель — круг замка (HOME_SIGHT), отряд — 20 человек днём летом, если не сказано иное`);
    ctx.line(`мир выборки: ${world.lords} замков расселением игры (столько мест у теста с игроками), миров — ${runs}; земля — клетки земли двора в рамке замков`);
    const d = deriveSight(SIGHT_GOALS, writtenSight(), runs, world);
    const was = sightRows(writtenSight());
    const got = sightRows(d.numbers);
    const same = was.every(([, v], i) => v === got[i][1]);
    ctx.line(`вывод неподвижной точкой от записанного: ${d.converged ? `сошёлся за ${d.passes} прох.` : 'НЕ СОШЁЛСЯ'}; ${same ? 'записано = выведено' : 'ЗАПИСАНО ≠ ВЫВЕДЕНО — перенеси выведенное в world/data/sight.ts и SEASON_MODIFIERS.camouflage'}`);
    for (const w of d.why) ctx.line(`  причина: ${w}`);
    ctx.line(`${padEnd('число', 24)} ${pad('записано', 9)} ${pad('выведено', 9)}`);
    for (const [i, [name, v]] of was.entries()) ctx.line(`${padEnd(name, 24)} ${pad(v, 9)} ${pad(got[i][1], 9)}${v === got[i][1] ? '' : '  ←'}`);
    ctx.line('');
    ctx.line('цели на записанных числах — дверью игры (клеток; последняя — доля):');
    for (const g of goalCheck(SIGHT_GOALS, writtenSight(), runs, world)) {
      const share = g.id === 'ruinsNear';
      const ok = share ? g.got >= g.goal : g.id === 'ruinsFull' ? g.got <= g.goal : Math.abs(g.got - g.goal) <= 0.5;
      ctx.line(`${padEnd(g.what, 58)} цель ${pad(share ? pct(g.goal) : g.goal, 7)}  вышло ${pad(share ? pct(g.got) : fix(g.got, 1), 7)}  ${ok ? 'в цели' : 'МИМО'}`);
    }
    ctx.line('');
    ctx.line('доля клеток суши живого круга, где отряд 20 человек виден (вокруг замков мира выборки; руины — только клетки руин):');
    const cols: [string, boolean, 'summer' | 'winter', 'castle' | 'band'][] = [
      ['замок день', false, 'summer', 'castle'],
      ['замок ночь', true, 'summer', 'castle'],
      ['замок зимой', false, 'winter', 'castle'],
      ['отряд день', false, 'summer', 'band'],
    ];
    ctx.line(`${padEnd('где отряд', 18)} ${cols.map(([c]) => pad(c, 12)).join('')}`);
    for (const [name, st] of STANCES) {
      ctx.line(`${padEnd(name, 18)} ${cols.map(([, night, season, kind]) => pad(pct(detectShare(st, 20, night, season, kind, runs, world)), 12)).join('')}`);
    }
    ctx.line('');
    ctx.line('размер: скрытый лагерь под кругом замка днём летом');
    ctx.line(
      [1, 10, 20, 50, 100].map((m) => `${m} чел. — ${pct(detectShare({ camp: 'hidden' }, m, false, 'summer', 'castle', runs, world))}`).join(', '),
    );
  },
};

/** Мир выборки «свои» точки (сёла, ватаги) — сид мира: у каждого игрока свои, прибор берёт один мир. */
const MEET_SEED = 20261029;

const meet: Section = {
  id: 'meet',
  title: 'Точки мира и встречи с НПС',
  gdd: '3.5.1, 3.6.2, 3.6.3',
  doors: ['world/roampoints.pointsIn', 'world/roamfoes.foePower', 'world/encounter.ambushChance', 'world/sight.conspicuity', 'world/spawn.SICILY'],
  uses: ['townBlock', 'townTier', 'villageBlock', 'vatagaBlock', 'stages', 'foeTable', 'foeShare', 'foeRipe', 'ambushBase', 'ambushCap'],
  run(ctx) {
    // Точки — двери мира бродяги: вольные города общие (постоянная соль), сёла и ватаги — свои (сид мира). Густота — заглушки игры.
    const R = 40;
    const kinds: PointKind[] = ['town', 'village', 'vataga'];
    const NAME: Record<PointKind, string> = { town: 'вольный город', village: 'село', vataga: 'ватага' };
    ctx.line(
      `густота: вольный город — один на ${ctx.use('townBlock')}×${ctx.use('townBlock')} клеток (ступени I/II/III — ${ctx.use('townTier').map((x) => pct(x)).join(' / ')}), село — на ${ctx.use('villageBlock')}×${ctx.use('villageBlock')}, ватага — на ${ctx.use('vatagaBlock')}×${ctx.use('vatagaBlock')}`,
    );
    const near: Record<PointKind, number[]> = { town: [], village: [], vataga: [] };
    const tiers = [0, 0, 0];
    for (const at of SICILY) {
      const all = pointsIn(MEET_SEED, at.x - R, at.y - R, at.x + R + 1, at.y + R + 1);
      for (const k of kinds) {
        const d = all.filter((p) => p.kind === k).map((p) => Math.hypot(p.x - at.x, p.y - at.y));
        near[k].push(d.length ? Math.min(...d) : Infinity);
      }
      for (const p of all) if (p.kind === 'town' && Math.hypot(p.x - at.x, p.y - at.y) <= R) tiers[p.tier - 1]++;
    }
    for (const k of kinds) {
      const got = near[k].filter(Number.isFinite);
      ctx.line(`от ${SICILY.length} мест Сицилии до ближайшего: ${NAME[k]} — нашлось у ${got.length}, клеток — медиана ${fix(median(near[k]), 1)}`);
    }
    ctx.line(`вольных городов в ${R} клетках от мест Сицилии по ступеням I/II/III (с повторами): ${tiers.join(' / ')}`);
    ctx.line('');
    // Сила НПС — от ступени престижа, не от отряда (3.6.2): спелость от и до, по видам цели.
    const [lo, hi] = ctx.use('foeRipe');
    const steps = ctx.use('stages');
    ctx.line(`сила НПС по ступеням престижа (${steps.join(', ')}), мощь при спелости ${lo}…${hi} (бойцов строя):`);
    for (const k of FOE_KINDS) {
      const cells = steps.map((p) => `${foePower(p, k, lo)}…${foePower(p, k, hi)} (${foeMenOf(foePower(p, k, lo))}…${foeMenOf(foePower(p, k, hi))})`);
      ctx.line(`  ${padEnd(FOE_WORDS[k], 15)} ${cells.join(' · ')}`);
    }
    ctx.line('');
    // Засада — шанс видимостью колонны (дверь `world/sight`) по дороге 20 клеток от мест Сицилии на восток, сколько найдётся суши.
    const L = 20;
    // Граница: часы выборки — правда лето (зима прячет хуже: её множитель — своя строка видимости). День и ночь на дороге не
    // разделить: игровые сутки — полчаса, и дорога в 20 клеток идёт через несколько ночей — шанс меряет их вместе.
    if (seasonOf(SUMMER) !== 'summer') throw new Error('часы засады — не лето');
    const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);
    const roads = SICILY.flatMap((at) => {
      for (const a of DIRS) {
        const to = { x: Math.round(at.x + Math.cos(a) * L), y: Math.round(at.y + Math.sin(a) * L) };
        if (roamCellBlock(to) === null) return [{ from: at, to }];
      }
      return [];
    });
    ctx.line(`засада на дороге ${L} клеток (${roads.length} дорог от мест Сицилии — первая суша по восьми сторонам; лето), медиана шанса:`);
    for (const men of [10, 20, 50]) {
      const cells = GAITS.map((g) => {
        const p = median(roads.map((r) => ambushChance({ from: r.from, to: r.to, at: 0, until: roamWalkMs(r.from, r.to, g), ...(g === 'normal' ? {} : { gait: g }) }, men, SUMMER, 0)));
        return pad(`${GAIT_META[g].short} ${pct(p)}`, 26);
      });
      ctx.line(`  ${pad(men, 3)} чел.: ${cells.join('')}`);
    }
  },
};

/** Часы партии второго лета (игровые секунды) на доле `frac` второго дня сезона — для засады. */
const summerAt = (frac: number): number => SEASON_SECONDS * (SEASONS.length + SEASONS.indexOf('summer')) + DAY_LENGTH * (1 + frac);
const SUMMER = summerAt(0.25);

const people: Section = {
  id: 'people',
  title: 'Люди и город',
  gdd: '3.3.1, 3.4.1, 3.4.3, 3.4.5, 3.7.7, 4.2',
  doors: [
    'askrules.askCount, askCap, askFeedable, captivesOf, drillMs',
    'mailgrid.awayArrival',
    'townrules.boardDue, townMarketLevel, townYardLevel',
    'sim/bandearn.earnHaul, earnGold',
    'gemrules.healPriceOfLeft, healFullSeconds',
    'roambook.captivesCapNow',
  ],
  uses: ['askBase', 'askCamp', 'askWinter', 'askSpirit', 'askFeed', 'captiveShare', 'boardFee', 'townMarket', 'townYard', 'foeTable', 'foeShare', 'foeRipe'],
  run(ctx) {
    // Просящиеся (3.4.1): по ступени престижа — края базы при доле 0 и 1 (у прихода доля — хешем сида), лагерь, зима, дух.
    ctx.line('«Просятся в отряд» — дубинщиков в приход (края базы × лагерь), лето, мораль 60:');
    ctx.line(`${padEnd('ступень', 8)} ${(['open', 'hidden', 'ruin', 'none'] as const).map((c) => pad(c === 'none' ? 'без лагеря' : CAMP_NAME[c], 14)).join('')}`);
    for (let st = 0; st <= 4; st++) {
      const cell = (camp: 'open' | 'hidden' | 'ruin' | 'none'): string => {
        const lo = askCountAt(st, camp, 0);
        const hi = askCountAt(st, camp, 1);
        return pad(`${lo}…${hi}`, 14);
      };
      ctx.line(`${padEnd(st, 8)} ${cell('open')}${cell('hidden')}${cell('ruin')}${cell('none')}`);
    }
    ctx.line(`  зимой ×${ctx.use('askWinter')}, мораль ниже ${ctx.use('askSpirit').below} — ×${ctx.use('askSpirit').mult}; «Взять, сколько прокормим» — хлеба на ${ctx.use('askFeed')} игр. дн. всем`);
    const gaps = Array.from({ length: 30 }, (_, k) => (awayArrival(7, k + 101) - awayArrival(7, k + 100)) / 3_600_000);
    ctx.line(`  приход — на сетке почты: между приходами ${fix(Math.min(...gaps), 1)}…${fix(Math.max(...gaps), 1)} ч (30 приходов сида 7)`);
    ctx.line(`  книга отряда: потолок прихода у сервера (высшая ступень, открытый лагерь) — ${askCap(7, 100)}…${askCap(7, 101)} на приходы сида 7; пленных за бой — не больше ${captivesCapNow()}`);
    ctx.line('');
    ctx.line(`пленные (3.4.5): доля уцелевших врагов ${ctx.use('captiveShare')} — из 20 уцелевших ${captivesOf(20)}, из 60 — ${captivesOf(60)}`);
    ctx.line('');
    const fee = ctx.use('boardFee');
    ctx.line(`постой (4.2): ${fee} золота за голову и игр. день; эталоны тира I…III за игр. день: ${ETALONS.map((t) => fix(boardDue(total(t), DAY_LENGTH), 1)).join(' · ')}`);
    ctx.line(`вольный город I…III: уровень рынка ${ctx.use('townMarket').join(' · ')}, уровень дворов ${ctx.use('townYard').join(' · ')}`);
    ctx.line('');
    ctx.line('заработки (3.7.7): золота за игру при полном счёте, по ступени города (энергия — четыре игры в сутки):');
    for (const g of MINIGAMES) ctx.line(`  ${padEnd(g.name, 10)} ${([1, 2, 3] as const).map((t) => pad(earnGold(earnHaul(t, g.id, 1)), 6)).join('')}`);
    ctx.line('');
    ctx.line(`лечение за алмазы (3.3.1): полный срок раненых ${fix(healFullSeconds() / 60, 0)} мин; цена — ${[15, 30, 45, 60].map((m) => `${m} мин — ${healPriceOfLeft(m * 60)}`).join(', ')} алм.`);
    ctx.line(`учения найма (казармы 1-го уровня): 20 копейщиков — ${hrs(drillMs('spearman', 20) / 3_600_000)}, 20 всадников — ${hrs(drillMs('rider', 20) / 3_600_000)}`);
  },
};

/** Сколько просится в приход при ступени `st`, лагере и доле `share` между краями базы — дверью `askrules` (лето, мораль 60). */
function askCountAt(st: number, camp: 'open' | 'hidden' | 'ruin' | 'none', share: 0 | 1): number {
  const [lo, hi] = askRange(st);
  return Math.max(1, Math.round((share === 0 ? lo : hi) * askMult({ camp, winter: false, morale: 60 })));
}

/** Земля в разделе места — по строке на вид. */
const PLACE_ROWS: readonly [string, Terrain][] = [
  ['лес', 'forest'],
  ['голое поле', 'plain'],
  ['степь', 'steppe'],
  ['холмы', 'hills'],
  ['горы', 'mountains'],
  ['пустыня', 'desert'],
];

/** Регионы погоды раздела: Сицилия (мир автопилота) и по одному на прочие пояса. */
const SKY_REGIONS: readonly [string, string][] = [
  ['Сицилия (italy)', 'italy'],
  ['суша (germany)', 'germany'],
  ['север (novgorod)', 'novgorod'],
  ['сушь (egypt)', 'egypt'],
];

/** Полос погоды на сезон в выборке раздела: полдня игры каждая. */
const SKY_SPELLS = 400;

/** Погода региона в сезоне по полосам: средний дождь и снег днём, доля утр с туманом гуще трети, средний туман утром. */
function skyStats(region: string, season: Season): { rain: number; snow: number; fogDays: number; fog: number } {
  const spell = SPELL_DAYS * DAY_LENGTH * 1000 / gameSeconds(1);
  let rain = 0;
  let snow = 0;
  let fogDays = 0;
  let fog = 0;
  for (let i = 0; i < SKY_SPELLS; i++) {
    const ms = (i + 0.5) * spell;
    const day = weatherAt(region, ms, season, 0.25);
    const dawn = weatherAt(region, ms, season, 0.02);
    rain += day.rain;
    snow += day.snow;
    fog += dawn.fog;
    if (dawn.fog > 0.3) fogDays++;
  }
  return { rain: rain / SKY_SPELLS, snow: snow / SKY_SPELLS, fogDays: fogDays / SKY_SPELLS, fog: fog / SKY_SPELLS };
}

const place: Section = {
  id: 'place',
  title: 'Лагерь по месту и погоде',
  gdd: '3.3.4, 3.5.1, 3.5.3, 3.14',
  doors: [
    'campsite.wildFood, placeForage, weatherForage, rationWeather, campGround',
    'roamrules.forageShare',
    'world/weather.weatherAt',
    'world/sight.fogMult',
    'world/spawn.SICILY',
  ],
  uses: [],
  run(ctx) {
    // Л1–Л3 (ГДД, «Решения ПН-12л»): в среднем по земле — прежний фураж; лес и берег больше, голое поле меньше; пустыня не кормит.
    const sample = campSample();
    const got = deriveWildMean(sample);
    const kinds = new Map<string, number>();
    for (const x of sample) kinds.set(x.terrain + (x.shore ? ' у воды' : ''), (kinds.get(x.terrain + (x.shore ? ' у воды' : '')) ?? 0) + 1);
    ctx.line(`выборка — клетки, где отряд может встать, в 12 клетках от ${SICILY.length} мест острова: ${sample.length}; ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
    ctx.line(`вольный корм места — промыслы земли (охота — лес и горы, сбор — вся суша, кроме пустыни; рыбалка у воды — ещё один сбор), еды на работника в игр. день: ${PLACE_ROWS.map(([n, t]) => `${n} ${fix(wildFood(t, false), 0)}`).join(', ')}; у воды +${fix(wildFood('plain', true) - wildFood('plain', false), 0)}`);
    ctx.line(`делитель фуража места (средний корм выборки): записано ${WILD_MEAN}, выведено ${got} — ${got === WILD_MEAN ? 'записано = выведено' : 'ЗАПИСАНО ≠ ВЫВЕДЕНО — перенеси выведенное в world/data/campsite.ts'}`);
    const mean = sample.reduce((n, x) => n + placeForage(x), 0) / Math.max(1, sample.length);
    ctx.line(`Л1 «в среднем — как прежде»: средний множитель места на выборке ${fix(mean, 3)} (цель 1 ± 0.01) — ${Math.abs(mean - 1) <= 0.01 ? 'в цели' : 'МИМО'}`);
    const forest = placeForage({ terrain: 'forest', shore: false });
    const shore = placeForage({ terrain: 'plain', shore: true });
    const plain = placeForage({ terrain: 'plain', shore: false });
    ctx.line(`Л2 «лес и берег больше, голое поле меньше»: лес ×${fix(forest)}, поле у воды ×${fix(shore)}, голое поле ×${fix(plain)} — ${forest > 1 && shore > 1 && plain < 1 ? 'в цели' : 'МИМО'}`);
    const desert = placeForage({ terrain: 'desert', shore: false });
    ctx.line(`Л3 «пустыня не кормит»: пустыня ×${fix(desert)} — ${desert === 0 ? 'в цели' : 'МИМО'}`);
    ctx.line(`  (проверка вывода: средний корм выборки без округления ${fix(wildMeanOf(sample), 3)})`);
    ctx.line('');
    ctx.line('фураж открытого лагеря (доля пайка с земли) по месту и сезону, год 2+, сухо:');
    ctx.line(`${padEnd('место', 18)} ${SEASONS.map((x) => pad(SEASON_META[x].name, 9)).join('')}`);
    const rows: [string, Terrain, boolean][] = [
      ['лес у воды', 'forest', true],
      ['лес', 'forest', false],
      ['поле у воды', 'plain', true],
      ['голое поле', 'plain', false],
      ['горы', 'mountains', false],
      ['пустыня', 'desert', false],
    ];
    const rec = { kind: 'open' as const, since: 0, builders: 0 };
    for (const [name, t, sh] of rows) {
      const cells = SEASONS.map((x) => pad(pct(forageShare(seasonModsFor(x, 2), { camp: rec, way: standWay('normal') }, { site: { terrain: t, shore: sh }, sky: { rain: 0 } })), 9));
      ctx.line(`${padEnd(name, 18)} ${cells.join('')}`);
    }
    ctx.line(`дождь силы r — сбор стоит долей r: фураж ×(1 − r); снегопад силы s — паёк ×(1 + ${fix(rationWeather({ snow: 1 }) - 1)}·s) (самый дорогой паёк таблицы сезонов)`);
    ctx.line(`туман густоты f прячет, как ночь (×${SIGHT.night}), долей f: заметность ×${fix(fogMult(1))} при f = 1, ×${fix(fogMult(0.5))} при 0.5`);
    // Оборона — дверью места боя на клетках выборки: открытый лагерь на земле клетки и лагерь в руинах.
    const faces = (pick: (x: (typeof sample)[number]) => boolean, kind: 'open' | 'ruin'): string => {
      const at = sample.find(pick)?.at;
      return at ? String(campFaces(campGround(at, kind))) : '—';
    };
    ctx.line(
      `оборона у лагеря — граней кости нападающему (земля клетки — place.groundAt): голое поле ${faces((x) => x.terrain === 'plain' && !x.ruin, 'open')} · лес ${faces((x) => x.terrain === 'forest' && !x.ruin, 'open')} · горы ${faces((x) => x.terrain === 'mountains', 'open')} · руины на поле: открытый ${faces((x) => x.terrain === 'plain' && x.ruin, 'open')}, в руинах ${faces((x) => x.terrain === 'plain' && x.ruin, 'ruin')}`,
    );
    ctx.line('');
    ctx.line(`погода по поясам, ${SKY_SPELLS} полос на сезон (днём — средний дождь и снег; утром — доля туманных и средний туман):`);
    ctx.line(`${padEnd('регион', 18)} ${padEnd('сезон', 8)} ${pad('дождь', 7)} ${pad('снег', 7)} ${pad('туман', 7)} ${pad('утр', 7)} ${pad('фураж', 7)} ${pad('паёк', 7)}`);
    for (const [name, region] of SKY_REGIONS) {
      for (const x of SEASONS) {
        const st = skyStats(region, x);
        ctx.line(
          `${padEnd(name, 18)} ${padEnd(SEASON_META[x].name, 8)} ${pad(fix(st.rain), 7)} ${pad(fix(st.snow), 7)} ${pad(fix(st.fog), 7)} ${pad(pct(st.fogDays), 7)} ${pad(`×${fix(weatherForage({ rain: st.rain }))}`, 7)} ${pad(`×${fix(rationWeather({ snow: st.snow }))}`, 7)}`,
        );
      }
    }
    ctx.line(`  утренний туман — по фазе солнца партии (${fix(fogMorning(0.02))} у рассвета, ${fix(fogMorning(0.25))} днём); фураж и паёк — средние за сезон`);
  },
};

const placeSpirit: Section = {
  id: 'placeSpirit',
  title: 'Лагерь по месту и погоде: дух и отдых',
  gdd: '3.3.3, 3.5.3',
  doors: ['roamrules.campSpirit', 'campsite.weatherMorale, campRest, fireShare'],
  uses: ['campMorale', 'coldCamp', 'healOpen'],
  run(ctx) {
    // Дух и отдых стоят на числах лагеря ПН-3 (заглушки): огонь, холод без огня, отдых у костра; погода берёт их долями, своего числа нет.
    const summer = seasonModsFor('summer', 2);
    const rec = { kind: 'open' as const, since: 0, builders: 0 };
    ctx.line(`костры открытого лагеря (+${ctx.use('campMorale')}) под дождём силы r — ×(1 − r); непогода (дождь или зной) — до −${ctx.use('coldCamp')}, как холод без огня:`);
    ctx.line(`${padEnd('дождь', 8)} ${pad('огонь', 7)} ${pad('Лагерь', 8)} ${pad('Непогода', 9)}`);
    for (const r of [0, 0.25, 0.5, 0.8, 1]) {
      ctx.line(`${padEnd(fix(r), 8)} ${pad(pct(fireShare({ rain: r })), 7)} ${pad(fix(campSpirit(rec, summer, { rain: r }), 1), 8)} ${pad(fix(weatherMorale({ rain: r, heat: 0 }), 1), 9)}`);
    }
    ctx.line(`зной пустыни под ясным небом летом: непогода ${fix(weatherMorale({ rain: 0, heat: 1 }), 1)}; зимой зноя нет (тепло сезона — таблица дров)`);
    ctx.line('');
    ctx.line(`отдых раненых: каждое удобство — огонь, вода рядом, укрытие (лес или стены руин) — весит, как костёр (×${ctx.use('healOpen')}):`);
    const dry = { rain: 0 };
    const cases: [string, 'open' | 'hidden' | 'ruin', { terrain: Terrain; shore: boolean; ruin: boolean }, { rain: number }][] = [
      ['открытый, голое поле', 'open', { terrain: 'plain', shore: false, ruin: false }, dry],
      ['открытый, поле под ливнем', 'open', { terrain: 'plain', shore: false, ruin: false }, { rain: 1 }],
      ['открытый, лес у воды', 'open', { terrain: 'forest', shore: true, ruin: false }, dry],
      ['скрытый, голое поле', 'hidden', { terrain: 'plain', shore: false, ruin: false }, dry],
      ['скрытый, лес', 'hidden', { terrain: 'forest', shore: false, ruin: false }, dry],
      ['в руинах у воды', 'ruin', { terrain: 'plain', shore: true, ruin: true }, dry],
    ];
    for (const [name, kind, site, sky] of cases) ctx.line(`  ${padEnd(name, 28)} ×${fix(campRest(kind, site, sky))}`);
  },
};

export const SECTIONS: readonly Section[] = [pay, band, camp, place, placeSpirit, rate, upgrade, road, contract, deals, foes, prestige, paths, trade, theft, raid, fort, castle, merc, race, parity, pool, meet, sight, people];
