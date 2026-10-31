// Путь бродяги — автопилот четырёх стилей пути на заглушках (ГДД 2.0: 2.4, 3.6.2, 3.7.0, 4.4, 4.8; ПН-0ч, ПН-Э1).
//
// **Это заглушка, а не игра.** Режима в коде почти нет (ГДД 7.1): ни дел, встреч и договоров
// (ПН-5, ПН-7), ни вольных замков (ПН-10). Поэтому путь здесь — схема ГДД, где каждое число, которого нет в коде, приходит
// входом (`PathKnobs` — только из `Ctx.use` раздела, см. `run.ts`), а всё, что в коде уже есть, — дверью. С ПН-1 отряд между
// делами живёт дверями партии бродяги: паёк и фураж сезона (`roamrules.bandRationPerDay`, `forageShare`), жалованье, терпение
// героя и уход равной долей (`sim/upkeep.bandUpkeep` на партии-оболочке), вместимость обоза (`sim/roam.cargoCap`); мощь и перевод в бой
// (`price.troopPower`, `kindsOf`), бой в поле и у стены ядром мира (`world/battle.resolveField`, `fights.wallFight`), отряд и
// гарнизон НПС (`garrison.raidingParty`, `garrisonOf`), потери долей родов (`price.shareLosses`), престиж и его ступень по
// порогам-заглушкам (`sim/prestige.prestigeAfter`, `prestigeStage`, ПН-2), место выхода и путь отряда — дверями хода ПН-3
// (`world/roam.placeBand`, `roamWalkMs`; до вольного замка — по миру дороги, `pool.ts`), лагерь — видом в записи хода (фураж —
// `forageShare`) и случайность (`sim/random.seeded`). Каждая пачка заменяет свою часть
// дверью, и тогда этот модуль худеет до вызова настоящего шага.
//
// Устройство. Время — настоящие часы от выхода. Игрок заходит 3–5 раз в сутки в часы бодрствования (правило 2.4); на заходе
// он либо идёт на вольный замок, если окно замка выполнено целиком (`freecastle.freeNeeds` — те же строки «Что нужно, чтобы взять»,
// что видит игрок, ПН-Э1), либо берёт договоры с доски, либо растит отряд. Стилей четыре — пути ГДД 3.7.0 (мирный, вор, разбойник,
// к замку); вор и разбойник живут делами, которых в коде ещё нет (ПН-В, ПН-8в, ПН-Н), и не гоняются — их разделы печатают
// «не измерено». Между заходами отряд живёт сам: ест, платит, принимает просящихся, уходит неуплатой.
//
// Политика (ПН-Э1, «разумная»): рост и просящиеся — только пока содержание отряда с запасом стиля `keep` укладывается в устойчивый
// доход (золото дел за последние 48 ч), а не в кошель; не хватает кошеля до следующего захода — отряд распускает лишних (дубинщиков
// первыми), а не ждёт ухода неуплатой. Мощь отряда и гарнизона — одних единиц (`troopPower`).
import type { RoamState, TroopId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import { troopPower } from '../../src/game/battle/price';
import { DAY_LENGTH, dayRealSeconds, gameDaysPerHour, realMs } from '../../src/game/pace';
import { createInitialState } from '../../src/game/state';
import { seasonMods, seasonOf, seasonProgress } from '../../src/game/derived';
import { SEASON_DAYS, SEASON_MODIFIERS } from '../../src/game/data/seasons';
import { askCount, askFeedable } from '../../src/game/askrules';
import { awayArrival, firstArrival } from '../../src/game/mailgrid';
import { bandSpiritIn } from '../../src/game/sim/bandspirit';
import { spiritNumbers, spiritOfIn } from '../../src/game/spiritrules';
import { bandRationPerDay, bandWage, bandWagesPerDay, forageShare } from '../../src/game/roamrules';
import { bandUpkeep } from '../../src/game/sim/bandkeep';
import { cargoCap } from '../../src/game/sim/roam';
import { prestigeAfter, prestigeStage } from '../../src/game/sim/prestige';
import { mixSeed, seeded } from '../../src/game/sim/random';
import { castleTry } from './castle';
import { freeNeeds } from '../../src/world/freecastle';
import { travelTime } from '../../src/world/geo';
import { roamWalkMs } from '../../src/world/roam';
import type { Spot } from '../../src/world/settle';
import { generalSpeed } from '../../src/world/pvp';
import { LAIR_RUIN } from '../../src/world/data/tuning';
import { lairGold } from '../../src/world/lairs';
import { CONTRACTS_MAX, DEAL_DEFS } from '../../src/game/data/contracts';
import { termsOf } from '../../src/game/sim/contracts';
import { boardsAt, type DealPlace } from '../../src/world/dealboard';
import { pointsIn } from '../../src/world/roampoints';
import { generateWorld, isLair } from '../../src/world/gen';
import type { Gait } from '../../src/world/data/gait';
import { standWay } from '../../src/world/roammove';
import { type Camp, type Mark, type Origin } from './kinds';
import { foePower } from '../../src/world/roamfoes';
import { ambushChance, ambushFight, strikeFight } from '../../src/world/encounter';

/** Стиль игры автопилота — путь ГДД 3.7.0 (параметр прибора, как `Player` у автопилота посёлка; не вход ГДД и не заглушка пачки). */
export interface Style {
  id: 'peace' | 'thief' | 'robber' | 'castle';
  name: string;
  /** Чем путь живёт, словами (3.7.0). */
  lives: string;
  /** Дел пути нет в коде — пачки, которые их дадут (стиль не гоняется, его строки — «не измерено»); есть — `null`. */
  missing: string | null;
  /** До какой доли ровного боя своей ступени отряд берёт дело. */
  edge: number;
  /** Идёт ли на вольный замок, когда окно замка выполнено целиком (осадой: голод → последняя вылазка, ПН-10). */
  castle: boolean;
  camp: Camp;
  gait: Gait;
  /** Сверх срока до следующего захода — сколько настоящих часов содержания отряд держит в кошеле, прежде чем тратить на рост. */
  margin: number;
  /** Запас дохода к содержанию: растёт, только пока содержание × `keep` ≤ устойчивый доход (цель 2.4 — ≥ 1.2). */
  keep: number;
  /** В кого растит дубинщиков и кого нанимает. */
  grow: TroopId;
  /**
   * Запас на зиму (ВП3, ПН-6): какую долю зимнего пайка отряда стиль везёт в обозе — осенью на всю зиму, зимой на остаток; хлеб — по
   * цене села, только сверх запаса кошеля. Ноль — живёт покупкой по дню.
   */
  winter: number;
}

export const STYLES: readonly Style[] = [
  {
    id: 'peace',
    name: 'мирный',
    lives: 'договоры НПС (груз, разведка, служба, удар по силам); торговля между городами и промыслы — разделами',
    missing: null,
    edge: 0.75,
    castle: false,
    camp: 'ruin',
    gait: 'normal',
    margin: 6,
    keep: 1.2,
    grow: 'spearman',
    winter: 1,
  },
  {
    id: 'thief',
    name: 'вор',
    lives: 'кражи: стадо, двор, дом, кошель — группой из отряда, через скупщика (3.7.8)',
    missing: 'ПН-В',
    edge: 0.5,
    castle: false,
    camp: 'hidden',
    gait: 'light',
    margin: 6,
    keep: 1.2,
    grow: 'archer',
    winter: 1,
  },
  {
    id: 'robber',
    name: 'разбойник',
    lives: 'набеги на сёла, караваны и земли лорда (3.7.2, 3.7.3, 3.7.9)',
    missing: 'ПН-8в, ПН-Н',
    edge: 1,
    castle: false,
    camp: 'hidden',
    gait: 'light',
    margin: 3,
    keep: 1.2,
    grow: 'axeman',
    winter: 0.5,
  },
  {
    id: 'castle',
    name: 'к замку',
    lives: 'договоры и рост до окна вольного замка, затем осада (3.11)',
    missing: null,
    edge: 0.9,
    castle: true,
    camp: 'open',
    gait: 'normal',
    margin: 3,
    keep: 1.2,
    grow: 'spearman',
    winter: 0.75,
  },
];

/** Стили, дела которых есть в коде, — их партии автопилот гоняет. */
export const RUN_STYLES: readonly Style[] = STYLES.filter((st) => st.missing === null);

/** Масштаб отряда по мощи (ГДД 4.4): номер полосы — 0 тать, 1 ватага, 2 отряд, 3 войско; пороги — вход прибора. */
export const scaleOf = (power: number, edges: readonly number[]): number => {
  let i = 0;
  while (i < edges.length && power > edges[i]) i++;
  return i;
};

/** Всё, чего у пути нет в коде, — из входов раздела. */
export interface PathKnobs {
  sessions: { per: readonly [number, number]; wake: readonly [number, number] };
  stages: readonly number[];
  S: number;
  /** Доля вида цели и спелость — заглушки игры (`foeShare`, `foeRipe`), сила — дверью `world/roamfoes.foePower`. */
  foeShare: Record<Mark, number>;
  foeRipe: readonly number[];
  /** Места выхода бродяг на мире дороги (`world/roam.placeBand`, `pool.ts`): партия выходит из своего. */
  spawns: readonly Spot[];
  /** Настоящих часов от места выхода до ближайшего вольного замка пула — путь отряда (`roamWalkMs`) по режиму, по месту выхода. */
  castleRoads: Record<Gait, readonly number[]>;
  /** Доля еды из села; остальное — рынок города. */
  foodMix: number;
  /** Золота за единицу еды: село и рынок города. */
  foodPrice: { village: number; town: number };
  /** Поражение (3.6.4): доля кошеля перебитого победителю, доля престижа минус — заглушки игры, двери `sim/roamfight`. */
  defeatPurse: number;
  defeatPrestige: number;
  /** Вольный замок I (дверь `world/freecastle`): доступ — престиж не ниже, мощь гарнизона бойцами (`troopPower`). */
  castle: { prestige: number; power: number };
  upgrade: (from: TroopId, to: TroopId) => number;
  hire: (id: TroopId) => number;
  limitDays: number;
  /** Пороги масштабов по мощи (ГДД 4.4, [ориентир]): тать ≤ …, ватага ≤ …, отряд ≤ …, войско выше. */
  scales: readonly number[];
}

/** Счёт пути на одном масштабе (ГДД 4.4): часы, доход дел и содержание (жалованье и хлеб, что не дала земля) — золото. */
export interface ScaleBook {
  hours: number;
  income: number;
  upkeep: number;
}

export interface PathRun {
  style: Style['id'];
  origin: Origin['id'];
  seed: number;
  /** Час взятия замка; `null` — не взял за срок. */
  castleAt: number | null;
  /** Час входа в ступень престижа; `null` — не вошёл. */
  stageAt: (number | null)[];
  /** Отряд в минуту входа в ступень — эталон ступени для силы НПС. */
  bandAt: (TroopStack | null)[];
  deeds: number;
  wins: number;
  /** Договоров сорвано (срок или проигранный бой) и золота договоров получено — аванс и плата (ПН-7). */
  failed: number;
  earned: number;
  /** Засад на дорогах к делам (ГДД 3.6.3). */
  ambushes: number;
  storms: number;
  deserted: number;
  recruited: number;
  /** Час, когда неуплата увела последнего (разорение, цель 2.4); `null` — не разорился. */
  ruinedAt: number | null;
  /** Распущено политикой: кошеля не хватило бы до следующего захода (ПН-Э1). */
  dismissed: number;
  /** Пало в боях договоров по тиру дела (I, II, III), в засадах и под замком — людей. */
  fallen: [number, number, number];
  ambushLost: number;
  castleLost: number;
  /** Часы, доход и содержание по масштабам (ГДД 4.4) — индекс `scaleOf`. */
  byScale: ScaleBook[];
  prestige: number;
  purse: number;
  band: TroopStack;
}

const total = (t: TroopStack): number => Object.values(t).reduce((n: number, v) => n + Math.max(0, v ?? 0), 0);
const add = (t: TroopStack, id: TroopId, n: number): void => {
  t[id] = (t[id] ?? 0) + n;
};
const minus = (t: TroopStack, lost: TroopStack): void => {
  for (const [id, n] of Object.entries(lost) as [TroopId, number][]) t[id] = Math.max(0, (t[id] ?? 0) - n);
};

/** Ступень престижа по порогам — дверью ступеней (`sim/prestige.prestigeStage`, ПН-2); пороги — заглушка прибора. */
export const stageOf = (stages: readonly number[], prestige: number): number => prestigeStage(prestige, stages);

/** Настоящих часов пути на `dist` клеток по равнине в режиме марша — двери пути и времени. */
export const roadHours = (dist: number, gait: Gait): number => realMs(travelTime(dist, 1, generalSpeed(gait))) / 3_600_000;

/** Игровых дней в настоящем часе — дверь времени. */
const dayPerHour = (): number => 3600 / dayRealSeconds();

/** Настоящая минута начала сетки: 01.10.2026, 00:00 UTC — часы первого захода прибавляются к ней (сетка привоза доски — UTC). */
export const T0 = Date.UTC(2026, 9, 1);

/** Ближайший вольный город к месту выхода не дальше 40 клеток — общая точка мира; нет — `null`. */
export function nearestTown(seed: number, at: Spot): DealPlace | null {
  const r = 40;
  const list = pointsIn(seed, at.x - r, at.y - r, at.x + r + 1, at.y + r + 1).filter((p) => p.kind === 'town');
  list.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y) || (a.id < b.id ? -1 : 1));
  return list[0] ? { id: list[0].id, x: list[0].x, y: list[0].y, name: list[0].name } : null;
}

/** Логова мира места выхода (`world/gen` с клеткой выхода — как мир бродяги), по сиду и месту — один раз. */
const lairCache = new Map<string, DealPlace[]>();
export function lairsOf(seed: number, at: Spot): DealPlace[] {
  const key = `${seed}:${at.x}:${at.y}`;
  let got = lairCache.get(key);
  if (!got) {
    got = generateWorld(seed, at)
      .settlements.filter(isLair)
      .map((st) => ({ id: st.id, x: st.x, y: st.y, name: st.name }));
    lairCache.set(key, got);
  }
  return got;
}

/** Шаг дверей отряда в модели — четверть игрового дня (см. `live`). */
const PIECE = DAY_LENGTH / 4;

const styleSalt = (style: Style, origin: Origin): number => {
  let h = 0x811c9dc5;
  for (const c of `${style.id}/${origin.id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
};

/**
 * Одна партия пути. `table` — сила НПС по ступеням (мощь), `even` — ровный бой ступени к мощи её эталона (оценка автопилота
 * «по силам ли дело»). Сиды боёв — из `seed` и номера дела: та же партия — тот же путь бит в бит.
 */
export function runPath(seed: number, style: Style, origin: Origin, table: readonly number[], even: readonly number[], k: PathKnobs): PathRun {
  const root = mixSeed(seed, styleSalt(style, origin));
  const rng = seeded(root);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rng();
  const whole = (lo: number, hi: number): number => Math.floor(between(lo, hi + 1));
  // Место выхода партии и её дорога до ближайшего вольного замка — дверями хода на мире дороги (`knobsOf`).
  const spot = (seed - 1) % k.spawns.length;
  const home = k.spawns[spot];
  // Заказчик (ПН-7) — ближайший к месту выхода вольный город: отряд живёт у его доски (и у кастеляна, если город II–III), туда он
  // и выходит с места выхода. Логова — мира места (`world/gen`), ватаги и города — точки мира (`world/roampoints`).
  const town = nearestTown(seed, home);
  const lairs = lairsOf(seed, home);
  const beatenUntil = new Map<string, number>();
  const near = { lairs, beaten: (id: string): boolean => (beatenUntil.get(id) ?? -Infinity) > t };
  const debts = new Map<string, number>();
  const took = new Set<string>();
  const band: TroopStack = { ...origin.band };
  // Партия-оболочка с отрядом бродяги: двери ПН-1 шагают её так же, как партию игрока. Отряд — тот же объект, что у модели.
  const party = createInitialState(root);
  party.phase = 'roam';
  const roam: RoamState = {
    origin: origin.id,
    hero: { name: '', war: origin.war },
    band,
    wounded: [],
    purse: origin.gold,
    cargo: {},
    gear: {},
    // Ход — стоянка в режиме стиля (ПН-3: режим марша живёт в ходе); лагерь своего вида — дверь ПН-3 считает его фураж.
    way: standWay(style.gait),
    camp: { kind: style.camp, since: 0, builders: 0 },
  };
  party.roam = roam;
  // Паёк и жалованье для расчётов вперёд (запас, найм) — среднего сезона; сам шаг ест сезонным пайком.
  const ration = (): number => bandRationPerDay({ band, wounded: [] }, 1);
  const wages = (): number => bandWagesPerDay(band);
  const foodGold = k.foodMix * k.foodPrice.village + (1 - k.foodMix) * k.foodPrice.town * origin.food;
  const run: PathRun = {
    style: style.id,
    origin: origin.id,
    seed,
    castleAt: null,
    stageAt: k.stages.map((_, i) => (i === 0 ? 0 : null)),
    bandAt: k.stages.map((_, i) => (i === 0 ? { ...band } : null)),
    deeds: 0,
    wins: 0,
    failed: 0,
    earned: 0,
    ambushes: 0,
    storms: 0,
    deserted: 0,
    recruited: 0,
    ruinedAt: null,
    dismissed: 0,
    fallen: [0, 0, 0],
    ambushLost: 0,
    castleLost: 0,
    byScale: Array.from({ length: k.scales.length + 1 }, () => ({ hours: 0, income: 0, upkeep: 0 })),
    prestige: 0,
    purse: origin.gold,
    band,
  };
  const scaleNow = (): ScaleBook => run.byScale[scaleOf(troopPower(band), k.scales)];
  // Устойчивый доход (ПН-Э1): золото дел — аванс, плата, добыча — за последние 48 настоящих часов, в час. Первые 12 ч — делим на 12.
  const incomes: { at: number; gold: number }[] = [];
  const credit = (gold: number): void => {
    if (!(gold > 0)) return;
    incomes.push({ at: t, gold });
    scaleNow().income += gold;
  };
  const incomeH = (): number => {
    while (incomes.length > 0 && incomes[0].at <= t - 48) incomes.shift();
    return incomes.reduce((n, x) => n + x.gold, 0) / Math.min(48, Math.max(12, t));
  };
  let food = Math.min(origin.foodDays * ration(), cargoCap(roam));
  let t = 0;
  let busyUntil = 0;
  // Просящиеся (ПН-6) — на сетке почты от сида партии (`mailgrid.awayArrival`), часы — от первого прихода после выхода.
  const askSeed = seed >>> 0;
  let askK = firstArrival(0) + 1;
  const askT0 = awayArrival(askSeed, askK);
  const askAtHour = (n: number): number => (awayArrival(askSeed, n) - askT0) / 3_600_000;
  let nextRecruit = askAtHour(askK);
  // Бои взятых договоров — по порядку, в минуту прихода к цели.
  const queue: { at: number; apply: () => void }[] = [];
  const limit = k.limitDays * 24;
  const stage = (): number => stageOf(k.stages, run.prestige);
  const gain = (p: number): void => {
    const before = stage();
    run.prestige = prestigeAfter(run.prestige, p);
    for (let s = before + 1; s <= stage(); s++) {
      if (run.stageAt[s] !== null) continue;
      run.stageAt[s] = t;
      run.bandAt[s] = { ...band };
    }
  };

  // Отряд живёт сам от `t` до `to`: ест (фураж, запас, покупка), платит, ждёт неуплаты и уходит, принимает просящихся. Шаг дверей —
  // четверть игрового дня: правило ухода — доля в день, и мельче шага игры (`CATCHUP_STEP`) итог не меняется дальше доли человека,
  // а шагов в семь с половиной раз меньше.
  const live = (to: number): void => {
    while (t < to) {
      while (queue.length > 0 && queue[0].at <= t) (queue.shift() as { apply: () => void }).apply();
      const dt = Math.min(1, to - t, queue.length > 0 ? Math.max(1e-6, queue[0].at - t) : 1);
      // В пути — пока идёт дело; дошёл — снова лагерем своего стиля.
      const camp: Camp | 'road' = t < busyUntil ? 'road' : style.camp;
      roam.camp = camp === 'road' ? null : { kind: camp, since: 0, builders: 0 };
      roam.purse = run.purse;
      const before = total(band);
      for (let left = dt * dayPerHour() * DAY_LENGTH; left > 1e-9; left -= PIECE) {
        const piece = Math.min(PIECE, left);
        party.time += piece;
        const mods = seasonMods(party);
        const need = (bandRationPerDay(roam, mods.food) * piece) / DAY_LENGTH;
        // Фураж: сезон и вид лагеря — дверь (`forageShare`; доли скрытого и руин — заглушки игры ПН-3, `game/roamstubs`).
        const land = forageShare(mods, roam);
        // Содержание на масштабе (4.4): жалованье по дню и хлеб, которого не дала земля, — по цене стиля (запас обоза тоже куплен).
        scaleNow().upkeep += (wages() * piece) / DAY_LENGTH + need * (1 - land) * foodGold;
        let rest = need * (1 - land);
        const eat = Math.min(food, rest);
        food -= eat;
        rest -= eat;
        const buy = foodGold > 0 ? Math.min(rest, roam.purse / foodGold) : rest;
        roam.purse -= buy * foodGold;
        rest -= buy;
        // Жалованье, долг, терпение героя и уход равной долей — дверь содержания отряда.
        bandUpkeep(party, piece, need > 0 ? rest / need : 0);
      }
      run.purse = roam.purse;
      run.deserted += Math.max(0, before - total(band));
      if (before > 0 && total(band) <= 0 && run.ruinedAt === null) run.ruinedAt = t + dt;
      food = Math.min(food, cargoCap(roam));
      scaleNow().hours += dt;
      t += dt;
      while (nextRecruit <= t) {
        // Сколько пришло — дверь игры (`askrules.askCount`): ступень престижа, лагерь стиля, зима, мораль отряда.
        const mods = seasonMods(party);
        const came = askCount(askSeed, askK, {
          stage: stage(),
          camp: t < busyUntil ? 'none' : style.camp,
          winter: seasonOf(party.time) === 'winter',
          // Автопилот живёт средней землёй и без погоды (ПН-12л): места и неба у его отряда нет — `null`.
          morale: spiritNumbers(spiritOfIn(bandSpiritIn(party, roam, null))).morale,
        });
        // Ответ вести (ПН-Э1) — один из трёх, что видит игрок: «Принять всех», «Взять, сколько прокормим» (та же дверь, что у вести,
        // `askrules.askFeedable`: хлеб обоза на `askFeed` игр. дн. всем) или «Прогнать». Берётся больший ответ, который потянет устойчивый
        // доход с запасом стиля (`room` голов), — а не кошель: жалованье платится из дохода.
        const per = bandRationPerDay({ band: { clubman: 1 }, wounded: [] }, mods.food);
        const feed = Math.min(came, askFeedable(food, per, per > 0 ? bandRationPerDay(roam, mods.food) / per : 0));
        const head = (bandWage('clubman') + bandRationPerDay({ band: { clubman: 1 }, wounded: [] }, 1) * foodGold) * dayPerHour();
        const room = Math.max(0, Math.floor((incomeH() / style.keep - upkeepH()) / head));
        const n = came <= room ? came : feed <= room ? feed : 0;
        if (n > 0) {
          add(band, 'clubman', n);
          run.recruited += n;
        }
        askK++;
        nextRecruit = askAtHour(askK);
      }
    }
  };

  // Содержание отряда в настоящий час — жалованье и паёк по цене стиля (без фуража: расчёт вперёд с запасом).
  const upkeepH = (): number => (wages() + ration() * foodGold) * dayPerHour();
  // Запас: содержание отряда до следующего захода и поле стиля — ночь без заходов не должна кончаться уходом.
  const reserve = (gap: number): number => upkeepH() * (gap + style.margin);

  // Не таять неуплатой (ПН-Э1): кошеля не хватает до следующего захода — распустить лишних (дубинщиков первыми, потом самых дешёвых
  // по жалованью), как дверь `sim/bandranks.dismissBand`: людей нет, снаряжение — в обоз (обоз модель не считает). Один остаётся.
  const trim = (gap: number): void => {
    for (let i = 0; i < 400 && run.purse < upkeepH() * gap && total(band) > 1; i++) {
      const ids = (Object.keys(band) as TroopId[]).filter((id) => (band[id] ?? 0) > 0).sort((a, b) => (a === 'clubman' ? -1 : b === 'clubman' ? 1 : bandWage(a) - bandWage(b)));
      add(band, ids[0], -1);
      run.dismissed++;
    }
  };

  // Запас на зиму (ВП3, ПН-6): осенью — на всю зиму, зимой — на остаток; доля зимнего пайка стиля, хлебом села, не выше обоза и только
  // сверх запаса кошеля. Зимой паёк ×1.4 и фуража нет — без запаса кошель кончается зимой, и неуплата уводит отряд (ГДД 13.5).
  const stockWinter = (gap: number): void => {
    const season = seasonOf(party.time);
    const left = season === 'winter' ? 1 - seasonProgress(party.time) : season === 'autumn' ? 1 : 0;
    if (!(left > 0) || !(style.winter > 0)) return;
    const need = bandRationPerDay(roam, SEASON_MODIFIERS.winter.food) * SEASON_DAYS * left * style.winter;
    const want = Math.min(need, cargoCap(roam)) - food;
    const can = (run.purse - reserve(gap)) / k.foodPrice.village;
    const n = Math.max(0, Math.min(want, can));
    if (!(n > 0)) return;
    food += n;
    run.purse -= n * k.foodPrice.village;
  };

  // Рост на заходе: повышение дубинщиков в вид стиля, потом найм в городе — пока кошель выше запаса и содержание после роста
  // с запасом стиля укладывается в устойчивый доход (ПН-Э1: не нанимать сверх дохода).
  const grow = (gap: number): void => {
    for (let i = 0; i < 200; i++) {
      const up = (band.clubman ?? 0) > 0 ? k.upgrade('clubman', style.grow) * origin.gear : Infinity;
      const hire = k.hire(style.grow) * origin.hire;
      const price = Math.min(up, hire);
      if (!Number.isFinite(price) || run.purse - price < reserve(gap)) return;
      const promote = up <= hire;
      if (promote) add(band, 'clubman', -1);
      add(band, style.grow, 1);
      if (upkeepH() * style.keep > incomeH()) {
        add(band, style.grow, -1);
        if (promote) add(band, 'clubman', 1);
        return;
      }
      run.purse -= price;
    }
  };

  const wiped = (): void => {
    if (total(band) > 0) return;
    run.purse *= 1 - k.defeatPurse;
  };

  const sessionsOf = (day: number): number[] => {
    const n = whole(k.sessions.per[0], k.sessions.per[1]);
    return Array.from({ length: n }, () => day * 24 + between(k.sessions.wake[0], k.sessions.wake[1])).sort((a, b) => a - b);
  };

  // Часы партии — от первого захода: игрок видит отряд с минуты выхода, и до неё отряд не живёт.
  const drawn = Array.from({ length: k.limitDays }, (_, day) => sessionsOf(day)).flat();
  const times = drawn.map((h) => h - drawn[0]);
  // Настоящая минута первого захода — для сетки привоза доски (3 ч по UTC) и суток кастеляна.
  const t0 = T0 + drawn[0] * 3_600_000;
  /** Часов от `h` до первого захода не раньше `h` — того, на котором игрок сможет распорядиться отрядом снова. */
  const untilNext = (h: number): number => (times.find((x) => x > h) ?? h + 12) - h;
  let deed = 0;
  // С места выхода — к доске своего города.
  if (town) busyUntil = roamWalkMs(home, town, style.gait) / 3_600_000;
  for (const at of times) {
    if (run.castleAt !== null || at >= limit) break;
    live(at);
    if (at < busyUntil) continue;
    stockWinter(untilNext(at));
    const s = stage();
    const power = troopPower(band);
    // Вольный замок I (ПН-10) — сервером войны в памяти (`castle.castleTry`). Идёт стиль «к замку», когда окно замка, которое увидел
    // бы игрок, выполнено целиком (`freecastle.freeNeeds`, ПН-Э1): престиж ступени, сила отряда не ниже гарнизона — одних единиц
    // (`troopPower`), связь; «у стен» — дойдёт дорогой (`castleRoads`). Разведки сухими делами нет — у игрока её нет. Осадой: лагерь,
    // фазы, голод — и последняя вылазка гарнизона всем, кто остался (ПН-10).
    const ready = freeNeeds({ prestige: run.prestige, tier: 1, near: true, band: power, garrison: k.castle.power, online: true }).every((n) => n.ok);
    if (style.castle && ready) {
      deed++;
      run.storms++;
      const road = k.castleRoads[style.gait][spot];
      live(at + road);
      const r = castleTry(band, 1, 'siege', mixSeed(root, 5000 + deed));
      run.castleLost += total(r.lost);
      minus(band, r.lost);
      busyUntil = at + 2 * road + r.hours;
      live(at + road + r.hours);
      if (r.won) {
        run.castleAt = t;
        break;
      }
      gain(-run.prestige * k.defeatPrestige);
      wiped();
      continue;
    }
    // Договоры (ПН-7): доска города и кастеляна дверью игры (`world/dealboard.boardsAt`), условия — `contractrules.contractTerms`
    // (через `sim/contracts.termsOf`). Долг заказчику закрывает его доску — сначала уплатить. По силам — бой до `edge` ровного боя
    // ступени; берётся до `CONTRACTS_MAX` лучших по плате за час, подряд, и каждый — только если успевает в свой срок (3.8.4).
    for (const [id, g] of [...debts]) {
      if (run.purse < g) continue;
      run.purse -= g;
      debts.delete(id);
    }
    if (!town) {
      grow(untilNext(at));
      trim(untilNext(at));
      continue;
    }
    const nowMs = t0 + at * 3_600_000;
    const boards = boardsAt(seed, town, nowMs, run.prestige, near).filter((b) => !debts.has(b.from.id));
    const able = boards
      .flatMap((b) => b.offers)
      .filter((o) => !took.has(o.id) && (DEAL_DEFS[o.kind].fight !== 'strike' || o.power <= power * even[s] * style.edge));
    const legs = able.map((o) => {
      const road = o.roadMs > 0 ? roamWalkMs(o.from, o.target, style.gait) / 3_600_000 : 0;
      const stand = o.stand / gameDaysPerHour();
      // Исполнение: удар, груз, разведка — дорога туда; служба — стоянка у кастеляна. Занят — туда и назад к своей доске.
      const reach = o.kind === 'garrison' ? stand : road;
      const busy = o.kind === 'garrison' ? stand : 2 * road;
      return { o, t: termsOf(o), road, reach, busy };
    });
    legs.sort((a, b) => b.t.pay / Math.max(0.1, b.busy) - a.t.pay / Math.max(0.1, a.busy));
    let when = at;
    let picked = 0;
    for (const leg of legs) {
      if (picked >= CONTRACTS_MAX) break;
      const termH = leg.t.days / gameDaysPerHour();
      if (when - at + leg.reach > termH) continue;
      picked++;
      deed++;
      run.deeds++;
      took.add(leg.o.id);
      run.purse += leg.t.advance;
      run.earned += leg.t.advance;
      credit(leg.t.advance);
      const o = leg.o;
      const seedOf = mixSeed(root, deed);
      const fail = (): void => {
        run.failed++;
        debts.set(o.from.id, (debts.get(o.from.id) ?? 0) + leg.t.penalty);
      };
      const settle = (): void => {
        run.purse += leg.t.pay - leg.t.advance;
        run.earned += leg.t.pay - leg.t.advance;
        credit(leg.t.pay - leg.t.advance);
        gain(leg.t.fame);
      };
      if (leg.road > 0) {
        // Засада на дороге к цели (ГДД 3.6.3) — дверью встреч игры: шанс видимостью колонны (`world/sight`) по этой дороге, сила —
        // ватага по ступени престижа; бой — в пути, до дела.
        const way = { from: { x: o.from.x, y: o.from.y }, to: { x: o.target.x, y: o.target.y }, at: 0, until: leg.road * 3_600_000, ...(style.gait === 'normal' ? {} : { gait: style.gait }) };
        queue.push({
          at: when + leg.road / 2,
          apply: () => {
            if (total(band) <= 0 || rng() >= ambushChance(way, total(band), party.time, 0)) return;
            const p = foePower(run.prestige, 'band', between(k.foeRipe[0], k.foeRipe[1]), table, k.foeShare);
            const mid = { x: Math.round((o.from.x + o.target.x) / 2), y: Math.round((o.from.y + o.target.y) / 2) };
            const r = ambushFight(p, band, mid, mixSeed(seedOf, 77));
            run.ambushLost += total(r.lost);
            minus(band, r.lost);
            run.ambushes++;
            if (r.won) gain(p / k.S);
            else {
              gain(-run.prestige * k.defeatPrestige);
              wiped();
            }
          },
        });
      }
      queue.push({
        at: when + leg.reach,
        apply: () => {
          if (DEAL_DEFS[o.kind].fight !== 'strike') {
            // Груз, разведка, служба — исполнен, если отряд жив: сдача сразу (гонец заказчика).
            if (total(band) > 0) settle();
            else fail();
            return;
          }
          // Отряд, ослабший в прежнем бою цепочки, на дело не по силам не идёт: договор сорван — неустойка.
          if (o.power > troopPower(band) * even[s] * style.edge) return fail();
          const r = strikeFight(o.power, band, o.target, o.from, seedOf, `roam-${style.id}-${origin.id}-${seed}-${deed}`);
          run.fallen[Math.max(0, Math.min(2, o.tier - 1))] += total(r.lost);
          minus(band, r.lost);
          if (r.won) {
            run.wins++;
            // Победа — как в игре (`sim/roamfight.takeFight`): престиж мощь / S и золото логова (у Воина и Уведённого добычи больше, 3.1).
            run.purse += lairGold(o.power) * origin.loot;
            credit(lairGold(o.power) * origin.loot);
            gain(o.power / k.S);
            beatenUntil.set(o.target.id, t + LAIR_RUIN / 3_600_000);
            settle();
          } else {
            gain(-run.prestige * k.defeatPrestige);
            wiped();
            fail();
          }
        },
      });
      when += leg.busy;
    }
    if (picked === 0) {
      grow(untilNext(at));
      trim(untilNext(at));
      continue;
    }
    busyUntil = when;
    live(Math.min(busyUntil, limit));
    grow(untilNext(busyUntil));
    trim(untilNext(busyUntil));
  }
  return run;
}


