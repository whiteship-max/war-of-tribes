// Ядро боя: чистая детерминированная функция. На вход — состав и настройки
// обеих сторон плюс сид, на выход — исход, потери и журнал событий. Никаких
// обращений к состоянию игры, времени или случайности извне: сервер посчитает
// то же самое, а клиент прогонит ту же функцию, чтобы нарисовать бой.
//
// Модель: шесть секторов (три фронта, три тыла) и резерв у каждой стороны,
// фиксированные фазы, короткие тики. Полоса 0 — левый фланг со стороны своей
// армии; левый фланг нападающего стоит против правого фланга обороняющегося,
// поэтому полоса `l` одной стороны смотрит на полосу `2 - l` другой.
import {
  ANCHOR,
  ANNIHILATED_AT,
  BREAK_AFTER,
  CLASH_CAVALRY_IMPACT,
  CLASH_SPEAR_BRACE,
  COUNTER,
  DICE,
  EVENT_MIN,
  EVENT_SHARE,
  FOOT_FLANK,
  FRONT_WIDTH,
  GEAR,
  MELEE_RATE,
  MORALE,
  PHASE_PIP,
  PHASE_TICKS,
  PYRRHIC_BELOW,
  RANGED_RATE,
  RETREAT,
  CIRCLE_PHASES,
  circleTicks,
  SLOW_CONTACT,
  TEMPER,
  UNIT_STATS,
  WITHDRAW_RATIO,
  roundsCap,
} from './config';
import { seededRng, type Rng } from './rng';
import { emptyStack, reinforceInto, stackTotal, validateSetup } from './setup';
import {
  FRONT,
  HORSE_KINDS,
  REAR,
  SECTORS,
  SIDES,
  UNIT_KINDS,
  type ArmySetup,
  type BattleEvent,
  type BattleInput,
  type BattleResult,
  type EventBody,
  type Lane,
  type PhaseId,
  type PhaseSpan,
  type PipId,
  type ResultReason,
  type Sector,
  type Side,
  type SideResult,
  type Stack,
  type UnitKind,
  type Winner,
} from './types';

// ---------- Внутреннее состояние ----------

/**
 * Где группа стоит. Фронт и тыл — позиции своей полосы; `strike` — ушла в обход и бьёт полосу
 * противника; `reserve` — ещё не введена. Ждущих манёвра и бережёных до преследования рядов нет:
 * они жили приказами, а приказов у ядра больше нет (docs/battle_eu4.md, 14.5).
 */
type Row = 'front' | 'rear' | 'reserve' | 'strike';

interface Group {
  side: Side;
  /** Откуда группа родом — по нему считаются потери по секторам. */
  origin: Sector;
  stack: Stack;
  initial: number;
  lane: Lane | null;
  row: Row;
  /** Для обхода: кого бить первым — тыл (конница) или фронт (пехота, завернувшая с фланга). */
  prefer: 'rear' | 'front';
  /** Мораль сектора, 0..`MORALE.max`. Своя у каждой группы: сектор ломается сам, а не вся армия. */
  morale: number;
  /**
   * Мораль упала до нуля: бегут с поля (мораль EU4, docs/battle_eu4.md, 14.15). Полосы у бежавших нет (`lane` —
   * `null`): не бьют, не стоят в ряду, не закрывают собой тех, кто за ними, — их место занимает резерв. Достаёт их
   * только преследование. Соседей бежавший не заражает: паники на соседей у EU4 нет, и у нас её нет (14.21).
   */
  fled: boolean;
  /** Последний тик, когда группу били с фланга или тыла. */
  flankedTick: number;
  /** Какую долю её ряда накрыл обход в этот тик (`Hit.cover`, наибольшая): столько и бьёт по морали обход. */
  flankCover: number;
  /** Потери группы за тик, взвешенные для морали. */
  lostTick: number;
}

type Kills = Record<UnitKind, Record<UnitKind, number>>;

interface SideState {
  id: Side;
  setup: ArmySetup;
  groups: Group[];
  initialTotal: number;
  /** Мораль армии — средняя по живым группам, взвешенная числом людей. Только для отчёта и условия резерва. */
  morale: number;
  broken: boolean;
  brokenAt: number | null;
  brokenReason: 'morale' | 'annihilated' | null;
  retreating: boolean;
  /** Потери за тик, взвешенные для морали. */
  lostTick: number;
  lostTotal: number;
  /** Выбито стрельбой до первого столкновения: залп перед сшибкой первого прохода (событие `volley`, итог боя). */
  rangedBeforeContact: number;
  /**
   * Выбито стрельбой с тех пор, как линии разошлись, — обстрел нынешнего круга. У первого прохода это то же, что
   * `rangedBeforeContact`; круг обнуляет его в начале своего сближения. По нему судится перестрелка (`rangedVerdict`).
   */
  volley: number;
  rangedTotal: number;
  /** Сколько человек ещё может выбить преследование. */
  pursuitBudget: number;
  /** Кто кого выбил по полосам: [полоса][кто][кого]. Из этого выводятся события. */
  kills: Kills[];
  /** Снимок `kills` на начало фазы: события считаются по приросту. */
  killsAtPhase: Kills[];
  fired: Set<string>;
}

interface Hit {
  target: Group;
  kind: UnitKind;
  casualties: number;
  by: Side;
  byKind: UnitKind;
  byLane: Lane;
  ranged: boolean;
  /** Удар пришёл с фланга или тыла. */
  flank: boolean;
  /** Какую долю ряда цели накрывает этот обход (`Contact.aCover`): обход группой — весь ряд, край строя — свою долю. */
  cover: number;
}

interface Contact {
  a: Group[];
  b: Group[];
  /** Группы `a` бьют `b` с фланга или тыла. */
  aFlank: boolean;
  bRow: Row;
  aRow: Row;
  /**
   * Край строя: доля ряда `a`, против которой в полосе нет противника, — свес занятой ширины ряда над рядом `b`
   * (`occupied`), целыми людьми. Она бьёт `b` во фланг, остальные — в лоб. У `b` — то же своё.
   */
  aOver?: number;
  bOver?: number;
  /**
   * Какую долю ряда `b` накрывает край `a`: свес к ширине ряда `b`, не больше единицы. Обход по морали бьёт этой долей —
   * край в одного человека не ломает ряд, как обход целой группой (И3, И4 у той — прежние). Без поля — весь ряд.
   */
  aCover?: number;
  bCover?: number;
  /** Бьют только эти роды `a`: край, против которого нет противника во всей полосе, достаёт соседнюю (`REACH`). */
  kinds?: readonly UnitKind[];
  /** Полоса, куда ложится удар `a`, по своей нумерации, — у дотягивающейся конницы соседняя. Нет — полоса группы. */
  lane?: Lane;
}

const EPS = 0.5;
/** Род стоит в строю: в нём не меньше половины бойца. Меньше — удар его пропускает (`distribute`), и сам он не бьёт (`melee`). */
const stands = (n: number): boolean => n >= EPS;
/**
 * Жива ли группа — в той же единице, что удар: хоть один её род стоит (`stands`). Прежде «жив» считался суммой родов,
 * и группа, где каждого рода меньше половины бойца, а вместе больше, — «тень» — числилась в строю, а бить её было
 * нечем: сторона не ломалась, и бой стоял до потолка кругов (docs/battle_eu4.md, 14.25–14.27; слово владельца).
 * Открыта наружу ради теста «тень перебита»: правило проверяется этой самой функцией, а не своей копией.
 */
export const standing = (stack: Stack): boolean => UNIT_KINDS.some((k) => stands(stack[k]));
const alive = (g: Group): boolean => standing(g.stack);
const laneOf = (s: Sector): Lane | null => (s === 'R' ? null : ((FRONT.indexOf(s as never) + REAR.indexOf(s as never) + 1) as Lane));
const rowOf = (s: Sector): Row => (s === 'R' ? 'reserve' : FRONT.includes(s as never) ? 'front' : 'rear');
const laneSector = (lane: Lane, row: 'front' | 'rear'): Sector => (row === 'front' ? FRONT[lane] : REAR[lane]);
const facing = (lane: Lane): Lane => (2 - lane) as Lane;
/** Ключ ряда полосы стороны — для счёта ширины (`Battle.measureRows`). */
const rowKey = (side: Side, lane: Lane, row: Row): string => `${side}:${lane}:${row}`;
const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');
const zeroKills = (): Kills =>
  Object.fromEntries(UNIT_KINDS.map((k) => [k, Object.fromEntries(UNIT_KINDS.map((t) => [t, 0]))])) as Kills;
const cloneKills = (k: Kills[]): Kills[] => k.map((l) => JSON.parse(JSON.stringify(l)) as Kills);

/** Сила отряда: рукопашная на стойкость по родам. Ею бой меряет полосу — кто проигрывает, куда идёт тот, чья полоса очищена. */
export function stackPower(stack: Stack): number {
  let p = 0;
  for (const k of UNIT_KINDS) p += stack[k] * UNIT_STATS[k].melee * UNIT_STATS[k].toughness;
  return p;
}

/** Сила позиции: чем оценивают, кто проигрывает полосу. */
const power = (groups: Group[]): number => groups.reduce((p, g) => p + stackPower(g.stack), 0);

const sum = (groups: Group[], kind: UnitKind): number => groups.reduce((n, g) => n + g.stack[kind], 0);
/**
 * Дальность обхода по роду — в полосах (docs/battle_eu4.md, 14.5; ответ владельца 4; отношение EU4 — пехота 1,
 * конница 2): край строя, против которого нет противника, бьёт во фланг пеший — противника своей полосы, конный — ещё
 * и соседней. Кто, кроме этого, никого не достаёт, стоит.
 */
export const REACH: Record<UnitKind, number> = { spear: 1, infantry: 1, archer: 1, cavalry: 2, heavy: 2 };
/** Роды, которые достают соседнюю полосу. */
const farKinds = (): UnitKind[] => UNIT_KINDS.filter((k) => REACH[k] > 1);

/**
 * Сколько ширины занимает ряд: сколько в нём встало (`initial` стоящих групп), не больше ширины. Поредевшая группа
 * держит своё место — как полк EU4, сколько бы в нём ни осталось людей; место освобождают бежавшие и перебитые. Бьют
 * при этом живые, и край поредевшей бьёт долей своей численности от начальной (14.5) — без нового числа.
 */
const occupied = (groups: Group[], width: number): number => Math.min(width, groups.reduce((n, g) => n + g.initial, 0));
/** Людей этих родов в группах стычки; без родов — всех. */
const menIn = (groups: Group[], kinds?: readonly UnitKind[]): number =>
  groups.reduce((n, g) => n + (kinds ? kinds.reduce((m, k) => m + g.stack[k], 0) : stackTotal(g.stack)), 0);

/**
 * Сомкнуты ли копья группы — положение, а не приказ (docs/battle_eu4.md, 14.5, Е17): копья в строю
 * (фронт или тыл своей полосы) сомкнуты, пока не бегут. Удар во фланг размыкает их на тот тик, когда он
 * пришёл, — это читают кольцо и характер там, где знают, откуда удар. Смятых копий нет: смятия фронта потерями
 * больше нет (поставка 5, 14.33).
 */
const closedSpears = (g: Group): boolean => (g.row === 'front' || g.row === 'rear') && !g.fled && g.stack.spear >= EPS;

/** Сектор с пехотой заякорен: теряет мораль медленнее (`MORALE.anchor`), а фронт без неё получает больше урона. */
const anchored = (stack: Stack): boolean => stack.infantry >= ANCHOR.infantryShare * Math.max(stackTotal(stack), EPS);

/**
 * Стартовая мораль группы: базовая мораль её родов, взвешенная числом людей,
 * плюс ступени снаряжения из кузницы и стойкость, с которой армия вышла в поле
 * (`setup.resolve` — ноль, если ничего такого не было), — и всё это на долю полной
 * морали, с которой сторона вышла в бой (`setup.rest`, мораль между боями; нет — полная).
 *
 * Открыта наружу ради тестов мира: что стойкость стороны — один обряд храма, а
 * отметки полководца в мораль не идут, они меряют этой самой функцией, а не
 * своей копией формулы. Ядро от этого чистым быть не перестаёт: функция ничего
 * не знает ни об игре, ни о том, кто её зовёт.
 */
export function startMorale(setup: ArmySetup, stack: Stack): number {
  return fullMorale(setup, stack) * restOf(setup);
}

/**
 * Мораль, с которой группа встала бы в бой свежей: `startMorale` без доли `rest`. От неё меряется, с какой долей
 * уцелевшие выходят из боя (`SideResult.rest`).
 */
function fullMorale(setup: ArmySetup, stack: Stack): number {
  const total = stackTotal(stack);
  if (total <= 0) return 0;
  let m = 0;
  for (const k of UNIT_KINDS) {
    const gear = Math.max(0, Math.min(GEAR.max, setup.gear?.[k] ?? 0));
    m += stack[k] * (UNIT_STATS[k].morale + gear * GEAR.moralePerLevel);
  }
  const resolve = Math.max(0, setup.resolve ?? 0);
  return Math.max(0, Math.min(MORALE.max, m / total + resolve));
}

/** Доля полной морали, с которой сторона вышла в бой (`ArmySetup.rest`): 0..1, нет поля или не число — полная. */
const restOf = (setup: ArmySetup): number => {
  const r = setup.rest ?? 1;
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 1;
};

/** Отметки стороны по одной фазе: неотрицательное конечное число, нет поля — ноль. */
export const pipOf = (setup: ArmySetup, pip: PipId): number => {
  const n = setup.pips?.[pip] ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/**
 * Штраф кости стороны от места боя, в гранях (docs/battle_eu4.md, 14.5, 14.14; таблица EU4): земля — всегда, переправа
 * — если манёвр своего полководца не выше манёвра полководца противника. Работа манёвра у EU4 — ровно эта: снять
 * переправу; землю он не снимает. Одна дверь на бой и на карточку полководца (`world/agents.pipRows`).
 */
export function groundFaces(own: ArmySetup, enemy: ArmySetup): { land: number; crossing: number; lifted: boolean; faces: number } {
  const clean = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) ? Math.max(0, n) : 0);
  const land = clean(own.ground?.land);
  const crossing = clean(own.ground?.crossing);
  const lifted = crossing > 0 && pipOf(own, 'maneuver') > pipOf(enemy, 'maneuver');
  return { land, crossing, lifted, faces: land + (lifted ? 0 : crossing) };
}

/**
 * Множитель урона стороны в фазе: бросок кости плюс отметки её полководца (`DICE`). Открыт наружу
 * ради карточки полководца: что прибавляет отметка, карточка меряет этой самой функцией, а не своей
 * копией формулы. Меньше нуля не бывает — урон не становится лечением.
 */
export const phaseLuck = (roll: number, pips = 0): number => Math.max(0, 1 + DICE.step * (roll + pips - (DICE.faces - 1) / 2));

/**
 * Множитель кольца: `kind` бьёт `target`. Сомкнутость копий — положение (`closedSpears`), а не приказ
 * (docs/battle_eu4.md, 14.5, Е17): `fromOpen` — копья того, кто бьёт, не сомкнуты (обойдены в этот тик).
 * Копья-цель сомкнуты всегда, пока стоят: бежавшие в стычки не попадают, а смятия больше нет (поставка 5, 14.33).
 * Открыт наружу ради теста «копья держат конницу, пока не обойдены»: кольцо проверяется этой самой функцией, а не
 * своей копией.
 */
export function ringMult(kind: UnitKind, target: UnitKind, flank: boolean, fromOpen: boolean, ranged: boolean): number {
  if (ranged) {
    if (target === 'spear') return COUNTER.archer.spear;
    if (target === 'infantry') return COUNTER.archer.infantry;
    if (target === 'cavalry') return COUNTER.archer.cavalry;
    if (target === 'heavy') return COUNTER.archer.heavy;
    return 1;
  }
  const horse = target === 'cavalry' || target === 'heavy';
  switch (kind) {
    case 'spear':
      if (horse) return fromOpen ? 1 : COUNTER.spear.cavalryHolding;
      return flank ? FOOT_FLANK : 1;
    case 'cavalry':
    case 'heavy': {
      // Своя половина кольца у каждого конного рода: лёгкая режет лучников и заходит во
      // фланг, тяжёлая ломает строй в лоб. Сомкнутые копья держат обеих одинаково.
      const c = COUNTER[kind];
      if (target === 'spear') return flank ? c.flank : c.spearClosed;
      if (target === 'archer') return Math.max(c.archer, flank ? c.flank : 0);
      if (target === 'infantry') return flank ? Math.max(c.flank, c.infantry) : c.infantry;
      return flank ? c.flank : 1;
    }
    case 'infantry':
      return (flank ? FOOT_FLANK : 1) * COUNTER.infantry.all;
    case 'archer':
      return 1;
  }
}

function newGroup(side: Side, setup: ArmySetup, origin: Sector, stack: Stack, lane: Lane | null, row: Row, opts: { prefer?: 'rear' | 'front'; morale?: number } = {}): Group {
  return {
    side,
    origin,
    stack: { ...stack },
    initial: stackTotal(stack),
    lane,
    row,
    prefer: opts.prefer ?? 'rear',
    morale: opts.morale ?? startMorale(setup, stack),
    fled: false,
    flankedTick: -1,
    flankCover: 0,
    lostTick: 0,
  };
}

/** Группа на сектор расстановки: где встал — там и стоит. Приказов, разводящих сектор на части, нет. */
function buildGroups(side: Side, setup: ArmySetup): Group[] {
  const groups: Group[] = [];
  for (const sector of SECTORS) {
    const stack = setup.sectors[sector];
    if (stackTotal(stack) <= 0) continue;
    groups.push(newGroup(side, setup, sector, stack, laneOf(sector), rowOf(sector)));
  }
  return groups;
}

// ---------- Симуляция ----------

class Battle {
  readonly rng: Rng;
  readonly sides: Record<Side, SideState>;
  readonly log: BattleEvent[] = [];
  readonly phases: PhaseSpan[] = [];
  tick = 0;
  phase: PhaseId = 'ranged';
  contact = false;
  clashTick = 0;
  /** Кто в этот тик в рукопашной (лучники, держащие дистанцию, — нет). Для характера лучников. */
  engagedNow = new Set<Group>();
  /** Кость этой фазы: множитель всего урона стороны (`phaseLuck`). Фаза без кости — единица. */
  luck: Record<Side, number> = { attacker: 1, defender: 1 };
  /** Ширина фронта полосы в этом бою: столько бьёт в одном ряду полосы с одной стороны. */
  readonly width: number;
  /** Сколько живых стоит в ряду полосы в этот тик (`measureRows`): ключ — `rowKey`. */
  rowMen = new Map<string, number>();
  /** Сколько кругов прошло сверх первого (`run`); круг по счёту — на единицу больше. */
  round = 0;
  /** Начинается новый круг: первая его фаза разводит линии (`onPhaseStart`). */
  opening = false;
  /** Сколько резерва встало в каждую полосу за эту фазу: по нему в конце фазы пишется `reserve-committed`. */
  entered: Record<Side, number[]> = { attacker: [0, 0, 0], defender: [0, 0, 0] };
  /**
   * В какой своей полосе противник хоть раз стоял. Полоса, где его не было с начала боя, — край строя: оттуда
   * дотягивается только конница (`REACH`). Очищенная в бою — обход полосы (К5, `relocate`).
   */
  opposed: Record<Side, boolean[]> = { attacker: [false, false, false], defender: [false, false, false] };
  /** Какую долю ряда сектора уже накрыл разовый удар обхода (`flankTurned`), по ключу «сторона:сектор». */
  shaken = new Map<string, number>();
  /** Штраф кости сторон от места боя на весь бой (`groundFaces`). */
  ground!: Record<Side, ReturnType<typeof groundFaces>>;
  /**
   * Сколько фаз каждой отметки уже прошло целиком: фаза огня — обстрел круга (стрельба и сближение подряд), натиска —
   * сшибка. По ним минимум боя EU4 (`BREAK_AFTER`, `mayRetreat`).
   */
  passed: Partial<Record<PipId, number>> = {};
  winner: Winner | null = null;
  reason: ResultReason = 'draw';

  constructor(readonly input: BattleInput) {
    this.rng = seededRng(input.seed);
    // Своя ширина боя главнее; без неё — ширина фронта. `Infinity` — боя без ширины.
    this.width = input.width ?? FRONT_WIDTH;
    // Ряда шире ширины никто не кладёт: все, кто входит в бой, встают по правилу развёртывания (`setup.deploy`), а
    // раскладки руками с поставки 2 нет ни у кого (docs/battle_eu4.md, 14.27) — подрезать ряд ядру больше нечего.
    const make = (id: Side, setup: ArmySetup): SideState => {
      const groups = buildGroups(id, setup);
      const initialTotal = groups.reduce((n, g) => n + g.initial, 0);
      return {
        id,
        setup,
        groups,
        initialTotal,
        morale: groups.reduce((n, g) => n + g.morale * g.initial, 0) / Math.max(1, initialTotal),
        broken: false,
        brokenAt: null,
        brokenReason: null,
        retreating: false,
        lostTick: 0,
        lostTotal: 0,
        rangedBeforeContact: 0,
        volley: 0,
        rangedTotal: 0,
        pursuitBudget: 0,
        kills: [zeroKills(), zeroKills(), zeroKills()],
        killsAtPhase: [zeroKills(), zeroKills(), zeroKills()],
        fired: new Set(),
      };
    };
    this.sides = { attacker: make('attacker', input.attacker), defender: make('defender', input.defender) };
    this.ground = {
      attacker: groundFaces(input.attacker, input.defender),
      defender: groundFaces(input.defender, input.attacker),
    };
  }

  // ----- Служебное -----

  /**
   * Кость фазы: по броску на сторону из генератора боя. Бросают обе стороны всегда, есть ли у них
   * отметки или нет: иначе поток генератора зависел бы от того, кто привёл полководца, и один и тот же
   * бой с отметкой и без неё разошёлся бы не в одной фазе, а во всех следующих.
   */
  rollDice(): void {
    const pip = PHASE_PIP[this.phase];
    if (!pip) {
      this.luck = { attacker: 1, defender: 1 };
      return;
    }
    const rolls = { attacker: 0, defender: 0 };
    const pips = { attacker: 0, defender: 0 };
    const ground = { attacker: this.ground.attacker.faces, defender: this.ground.defender.faces };
    for (const side of SIDES) {
      rolls[side] = Math.floor(this.rng() * DICE.faces);
      pips[side] = pipOf(this.sides[side].setup, pip);
      // Штраф места снимает грани с каждой кости стороны на весь бой (EU4).
      this.luck[side] = phaseLuck(rolls[side], pips[side] - ground[side]);
    }
    // Поле штрафа — только когда он есть: у боя на ровном месте запись та же, что до поставки 1.
    this.emit(ground.attacker > 0 || ground.defender > 0 ? { id: 'dice', rolls, pips, ground } : { id: 'dice', rolls, pips });
  }

  emit(e: EventBody): void {
    this.log.push({ tick: this.tick, phase: this.phase, ...e } as BattleEvent);
  }

  /** Событие не чаще одного раза на ключ. */
  once(key: string, side: SideState, e: EventBody): void {
    if (side.fired.has(key)) return;
    side.fired.add(key);
    this.emit(e);
  }

  at(side: Side, lane: Lane, row: Row): Group[] {
    return this.sides[side].groups.filter((g) => g.lane === lane && g.row === row && alive(g));
  }

  /** Фронт противника напротив своей полосы. */
  enemyFront(side: Side, lane: Lane): Group[] {
    return this.at(other(side), facing(lane), 'front');
  }

  enemyRear(side: Side, lane: Lane): Group[] {
    return this.at(other(side), facing(lane), 'rear');
  }

  /** Есть ли у противника кто-нибудь на этой (своей) полосе — фронт или тыл. */
  enemyOnLane(side: Side, lane: Lane): boolean {
    return this.enemyFront(side, lane).length > 0 || this.enemyRear(side, lane).length > 0;
  }

  /** Соседняя полоса, где ещё есть противник; для центра — та, где его больше. */
  adjacentLane(side: Side, lane: Lane): Lane | null {
    let order: Lane[];
    if (lane === 1) {
      const l = power(this.enemyFront(side, 0)) + power(this.enemyRear(side, 0));
      const r = power(this.enemyFront(side, 2)) + power(this.enemyRear(side, 2));
      order = l >= r ? [0, 2] : [2, 0];
    } else order = [1, lane === 0 ? 2 : 0];
    for (const l of order) if (this.enemyOnLane(side, l)) return l;
    return null;
  }

  /**
   * Куда идти обходящему, когда строя противника не осталось ни в одной полосе (`relocate`): чужие обходящие у него в
   * полосе — стоять (`null`), они в досягаемости; иначе — соседняя полоса, где они стоят, тем же порядком, что у
   * `adjacentLane`; нет нигде — стоять.
   */
  strikerLane(side: Side, lane: Lane): Lane | null {
    const strikers = (l: Lane): Group[] => this.at(other(side), facing(l), 'strike');
    if (strikers(lane).length > 0) return null;
    const order: Lane[] = lane === 1 ? (power(strikers(0)) >= power(strikers(2)) ? [0, 2] : [2, 0]) : [1, lane === 0 ? 2 : 0];
    for (const l of order) if (strikers(l).length > 0) return l;
    return null;
  }

  // ----- Расписание -----

  /**
   * Бой — круги всем боем (docs/battle_eu4.md, разделы 3.1 и 12): обстрел, сшибка и сеча (`CIRCLE_PHASES`),
   * снова и снова, с новой костью в каждой фазе, пока кто-то не сломается, но не больше потолка (`roundsCap`
   * от глубины меньшей по ней стороны: вся её армия к трём полосам ширины фронта). Длины фаз — доля прежнего
   * боя в один проход на круг (`circleTicks`). Сломался кто-то — бой линий обрывается в тот же тик, и дальше отход с
   * погоней: драться после слома некому, и минимума фазы, который доигрывал пустые тики, больше нет (поставка 5, 14.33).
   */
  run(): BattleResult {
    const depth = Math.min(...SIDES.map((side) => this.sides[side].initialTotal / (FRONT.length * this.width)));
    const cap = roundsCap(depth);
    for (let k = 1; ; k += 1) {
      if (k > 1) {
        if (this.sides.attacker.broken || this.sides.defender.broken) break;
        if (this.round >= cap) {
          this.emit({ id: 'rounds-out', rounds: this.round + 1 });
          break;
        }
        this.round += 1;
        this.opening = true;
      }
      for (const phase of CIRCLE_PHASES) {
        const ticks = circleTicks(phase, k);
        if (ticks <= 0) continue;
        if (this.runPhase(phase, ticks)) break;
      }
    }
    this.runPhase('retreat', PHASE_TICKS.retreat);
    this.runPhase('pursuit', PHASE_TICKS.pursuit);
    return this.finish();
  }

  /**
   * Одна фаза целиком. Правда — после боя линий кто-то сломан, и ждать в этом круге больше нечего. Бой линий обрывается
   * в тик слома; сломался раньше — в обстреле или сшибке — бой линий идёт один тик: фаза не короче тика.
   */
  runPhase(phase: PhaseId, ticks: number): boolean {
    this.phase = phase;
    const from = this.tick + 1;
    const lostBefore = { attacker: this.sides.attacker.lostTotal, defender: this.sides.defender.lostTotal };
    const menBefore = this.sectorMen();
    let broke = false;
    this.tick += 1;
    this.onPhaseStart();
    this.step();
    let done = 1;
    while (done < ticks) {
      const someoneBroken = this.sides.attacker.broken || this.sides.defender.broken;
      if (someoneBroken && phase === 'lines') {
        // Сторона сломалась — бой линий обрывается: драться некому, бежавших достаёт только погоня.
        broke = true;
        break;
      }
      this.tick += 1;
      this.step();
      done += 1;
    }
    this.onPhaseEnd();
    this.phases.push({
      phase,
      ...(this.round > 0 && CIRCLE_PHASES.includes(phase) ? { round: this.round + 1 } : {}),
      from,
      to: this.tick,
      losses: {
        attacker: Math.round((this.sides.attacker.lostTotal - lostBefore.attacker) * 10) / 10,
        defender: Math.round((this.sides.defender.lostTotal - lostBefore.defender) * 10) / 10,
      },
      bySector: this.lossBySector(menBefore),
    });
    return broke || (phase === 'lines' && (this.sides.attacker.broken || this.sides.defender.broken));
  }

  /**
   * Сколько людей осталось у каждого сектора расстановки. Считается по `origin`
   * группы, а он за бой не меняется: пехота, ушедшая на слабый фланг, и резерв,
   * вошедший в центр, остаются родом из своего сектора. Иначе потери «переезжали»
   * бы вместе с людьми, и сумма по секторам не сошлась бы с потерями стороны.
   */
  private sectorMen(): Record<Side, Partial<Record<Sector, number>>> {
    const out = { attacker: {}, defender: {} } as Record<Side, Partial<Record<Sector, number>>>;
    for (const side of SIDES) {
      for (const g of this.sides[side].groups) {
        out[side][g.origin] = (out[side][g.origin] ?? 0) + stackTotal(g.stack);
      }
    }
    return out;
  }

  /** Потери за фазу по секторам: сколько у каждого убыло с её начала. */
  private lossBySector(
    before: Record<Side, Partial<Record<Sector, number>>>,
  ): Record<Side, Partial<Record<Sector, number>>> {
    const now = this.sectorMen();
    const out = { attacker: {}, defender: {} } as Record<Side, Partial<Record<Sector, number>>>;
    for (const side of SIDES) {
      for (const sector of SECTORS) {
        const lost = (before[side][sector] ?? 0) - (now[side][sector] ?? 0);
        if (lost > 0.05) out[side][sector] = Math.round(lost * 10) / 10;
      }
    }
    return out;
  }

  // ----- Начало и конец фаз -----

  onPhaseStart(): void {
    this.emit({ id: 'phase-start' });
    // Место боя — раз, в начале боя: земля и переправа, и снял ли переправу манёвр.
    if (this.tick === 1) {
      for (const side of SIDES) {
        const g = this.ground[side];
        if (g.land > 0 || g.crossing > 0) this.emit({ id: 'ground', side, land: g.land, crossing: g.crossing, lifted: g.lifted });
      }
      // Сторона вышла в бой уставшей — раз, в начале боя: с какой долей полной морали (мораль между боями, 14.31).
      for (const side of SIDES) {
        const rest = Math.round(restOf(this.sides[side].setup) * 100) / 100;
        if (rest < 1) this.emit({ id: 'weary', side, rest });
      }
    }
    this.rollDice();
    for (const side of SIDES) this.sides[side].killsAtPhase = cloneKills(this.sides[side].kills);
    if (this.opening) {
      // Новый круг: линии расходятся для нового разбега. До сшибки рукопашной нет, и лучники бьют в полную
      // силу; перестрелка круга судится по тому, что выбито с этой минуты.
      this.opening = false;
      this.contact = false;
      for (const side of SIDES) this.sides[side].volley = 0;
      this.emit({ id: 'round', round: this.round + 1 });
    }
    switch (this.phase) {
      case 'clash':
        this.contact = true;
        this.clashTick = this.tick;
        for (const side of SIDES) {
          const s = this.sides[side];
          // Залп «до столкновения» — один, перед первой сшибкой: обстрел круга судится (`rangedVerdict`), но залпом не зовётся.
          const losses = Math.round(s.rangedBeforeContact);
          if (this.round === 0 && losses >= 1) this.emit({ id: 'volley', side, losses });
        }
        this.rangedVerdict();
        break;
      case 'retreat':
        this.decide();
        break;
      default:
        break;
    }
  }

  onPhaseEnd(): void {
    // Фаза отметки кончилась, когда следующая фаза круга — другой отметки: стрельба и сближение — одна фаза огня.
    const at = CIRCLE_PHASES.indexOf(this.phase);
    const pip = PHASE_PIP[this.phase];
    if (pip && at >= 0 && PHASE_PIP[CIRCLE_PHASES[at + 1]] !== pip) this.passed[pip] = (this.passed[pip] ?? 0) + 1;
    if (this.phase === 'clash' || this.phase === 'lines') {
      for (const side of SIDES) this.explainKills(side);
    }
    // Резерв встаёт в дыры строя в любой тик; в журнал — одна строка на полосу за фазу, в её последний тик.
    for (const side of SIDES) {
      this.entered[side].forEach((men, lane) => {
        if (men >= 1) this.emit({ id: 'reserve-committed', side, sector: laneSector(lane as Lane, 'front'), men: Math.round(men) });
      });
      this.entered[side] = [0, 0, 0];
    }
    if (this.phase === 'pursuit') {
      for (const side of SIDES) {
        const s = this.sides[side];
        const enemy = this.sides[other(side)];
        if (!enemy.retreating || s.retreating) continue;
        const losses = Math.round(enemy.pursuitBudget);
        if (losses >= 1) this.emit({ id: 'pursuit', side, losses });
      }
    }
  }

  /** Из прироста матрицы «кто кого выбил» — события про копья и конницу. */
  explainKills(side: Side): void {
    const s = this.sides[side];
    const enemy = this.sides[other(side)];
    for (const lane of [0, 1, 2] as Lane[]) {
      const d = (k: Kills[], a: UnitKind, b: UnitKind): number => k[lane][a][b];
      const spearVsCav = HORSE_KINDS.reduce((n, k) => n + d(s.kills, 'spear', k) - d(s.killsAtPhase, 'spear', k), 0);
      const eLane = facing(lane);
      const cavVsSpear = HORSE_KINDS.reduce((n, k) => n + enemy.kills[eLane][k].spear - enemy.killsAtPhase[eLane][k].spear, 0);
      // Событие только про настоящий удар: мелкий размен на стыке — не «остановили». Доля — от конницы противника в этой
      // же полосе, как и выбитое: стоящей в ней сейчас и выбитой копьями за фазу — тем же счётом, что у события
      // «конница дошла до лучников» ниже. Прежде доля бралась от всей конницы противника, а выбитое — в одной полосе, и
      // единицы не сходились (решение владельца по 14.21).
      const horseIn = (row: Row): number => HORSE_KINDS.reduce((n, k) => n + sum(this.at(enemy.id, eLane, row), k), 0);
      const enemyCavalry = horseIn('front') + horseIn('rear') + horseIn('strike') + spearVsCav;
      const notable = Math.max(EVENT_MIN, EVENT_SHARE * enemyCavalry);
      if (spearVsCav >= notable && spearVsCav >= cavVsSpear) {
        const inFront = sum(this.at(side, lane, 'front'), 'spear') > 0;
        const sector = laneSector(lane, inFront ? 'front' : 'rear');
        // Ключ — фаза и её круг: сшибка повторяется каждым кругом, и копья, удержавшие удар снова, пишут это снова.
        this.once(`spears-held:${sector}:${this.phase}:${this.round}`, s, {
          id: 'spears-held',
          side,
          sector,
          cavalryLost: Math.round(spearVsCav),
          spearsLost: Math.round(cavVsSpear),
        });
      }
      const cavVsArcher = HORSE_KINDS.reduce((n, k) => n + d(s.kills, k, 'archer') - d(s.killsAtPhase, k, 'archer'), 0);
      const enemyArchersRear = sum(this.at(enemy.id, eLane, 'rear'), 'archer');
      const enemyArchersFront = sum(this.at(enemy.id, eLane, 'front'), 'archer');
      const before = enemyArchersRear + enemyArchersFront + cavVsArcher;
      if (cavVsArcher >= Math.max(EVENT_MIN, 2 * EVENT_SHARE * before)) {
        const target = laneSector(eLane, enemyArchersRear >= enemyArchersFront ? 'rear' : 'front');
        this.once(`cav-archers:${target}:${this.phase}:${this.round}`, s, {
          id: 'cavalry-broke-archers',
          side,
          target,
          archersLost: Math.round(cavVsArcher),
        });
      }
    }
  }

  /**
   * Итог обстрела: сторона, потерявшая до контакта заметно больше противника, идёт в рукопашную с
   * просевшей моралью по всем позициям. Судится каждая сшибка — по обстрелу своего круга (`volley`).
   */
  rangedVerdict(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      const enemy = this.sides[other(side)];
      const losses = enemy.volley;
      const enemyLosses = s.volley;
      if (losses < EVENT_MIN || losses < enemyLosses * MORALE.rangedLostRatio) continue;
      this.emit({ id: 'ranged-lost', side, losses: Math.round(losses), enemyLosses: Math.round(enemyLosses) });
      for (const g of s.groups) {
        if (!alive(g) || (g.row !== 'front' && g.row !== 'rear')) continue;
        this.shake(g, MORALE.rangedLost);
      }
    }
  }

  /** Разовый удар по морали группы с учётом якоря и характера. */
  shake(g: Group, amount: number): void {
    if (g.fled) return;
    g.morale -= amount * this.moraleFactor(g);
  }

  // ----- Резерв -----

  /** Группы резерва стороны: ещё не встали в строй. */
  reserveOf(side: Side): Group[] {
    return this.sides[side].groups.filter((g) => g.row === 'reserve' && !g.fled && alive(g));
  }

  /** Кто из резерва может встать — целыми людьми по родам: так он и встаёт (`refill`). */
  reservePool(reserve: Group[]): Stack {
    const pool = emptyStack();
    for (const g of reserve) for (const k of UNIT_KINDS) pool[k] += Math.floor(g.stack[k] + 1e-9);
    return pool;
  }

  /** Сколько человек ещё может встать в строй. Меньше одного — встать некому. */
  reserveMen(side: Side): number {
    return stackTotal(this.reservePool(this.reserveOf(side)));
  }

  /**
   * Автоматический резерв (docs/battle_eu4.md, 14.2 и 14.5; решение владельца — вариант (а)). Кто не встал в ряд —
   * стоит в резерве стороны: вне строя, со своей моралью, которую до ввода не теряет (14.19.4). В каждый тик он
   * встаёт в любую дыру строя — на место убитых и бежавших — без предпочтения рода, как у EU4 (`setup.reinforceInto`):
   * пешие и конные — в дыры первой линии одним потоком, в доле их в резерве; лучники — во вторую линию. Фланги за
   * конницей — только у начальной расстановки (решение владельца по 14.21). Места —
   * ширина ряда минус те, кто в нём стоит и не бежит. Вошедшие встают своей группой полосы — родом из резерва (`R`):
   * их мораль — их собственная, а не тех, чьё место они заняли.
   */
  refill(side: Side): void {
    const s = this.sides[side];
    const reserve = this.reserveOf(side);
    if (reserve.length === 0) return;
    const pool = this.reservePool(reserve);
    if (stackTotal(pool) < 1) return;
    const cap = Number.isFinite(this.width) ? Math.floor(this.width) : Infinity;
    const room = (row: 'front' | 'rear'): number[] =>
      ([0, 1, 2] as Lane[]).map((lane) => {
        const men = s.groups.reduce((n, g) => (g.lane === lane && g.row === row && alive(g) && !g.fled ? n + stackTotal(g.stack) : n), 0);
        return Math.max(0, Math.floor(cap - men + 1e-9));
      });
    const into = reinforceInto(pool, { front: room('front'), rear: room('rear') });
    for (const row of ['front', 'rear'] as const) {
      into[row].forEach((moved, lane) => {
        const men = stackTotal(moved);
        if (men < 1) return;
        // Снять с резерва — по родам, из групп резерва по порядку.
        for (const k of UNIT_KINDS) {
          let left = moved[k];
          for (const g of reserve) {
            if (left <= 0) break;
            const take = Math.min(g.stack[k], left);
            g.stack[k] -= take;
            g.initial -= take;
            left -= take;
          }
        }
        const fresh = startMorale(s.setup, moved);
        const into_ = s.groups.find((g) => g.origin === 'R' && g.lane === lane && g.row === row && alive(g) && !g.fled);
        if (into_) {
          const had = stackTotal(into_.stack);
          into_.morale = (into_.morale * had + fresh * men) / (had + men);
          for (const k of UNIT_KINDS) into_.stack[k] += moved[k];
          into_.initial += men;
        } else {
          s.groups.push(newGroup(side, s.setup, 'R', moved, lane as Lane, row, { morale: fresh }));
        }
        this.entered[side][lane] += men;
      });
    }
  }

  // ----- Тик -----

  step(): void {
    for (const side of SIDES) {
      this.sides[side].lostTick = 0;
      for (const g of this.sides[side].groups) g.lostTick = 0;
    }
    this.engagedNow = new Set();
    if (this.phase === 'pursuit') {
      this.pursue();
    } else {
      // Дыры строя закрывает резерв — до стычек, чтобы вошедшие дрались в этот же тик. У сломанной стороны встать
      // некому по определению слома (`updateMorale`), и резерв после слома не встаёт.
      for (const side of SIDES) if (!this.sides[side].retreating && !this.sides[side].broken) this.refill(side);
      for (const side of SIDES) for (const lane of [0, 1, 2] as Lane[]) if (this.enemyOnLane(side, lane)) this.opposed[side][lane] = true;
      const hits: Hit[] = [];
      const contacts = this.contact && this.winner !== 'draw' ? this.buildContacts() : [];
      const engaged = new Map<Group, Group[]>();
      for (const c of contacts) {
        for (const g of c.a) engaged.set(g, [...(engaged.get(g) ?? []), ...c.b]);
        for (const g of c.b) engaged.set(g, [...(engaged.get(g) ?? []), ...c.a]);
      }
      this.measureRows();
      for (const g of engaged.keys()) this.engagedNow.add(g);
      for (const side of SIDES) {
        for (const g of this.sides[side].groups) {
          if (!alive(g) || g.stack.archer < EPS || g.lane === null) continue;
          if (g.row !== 'front' && g.row !== 'rear') continue;
          if (engaged.has(g)) continue;
          this.shoot(g, engaged, hits);
        }
      }
      // Сколько противника у каждой группы во всех её стычках разом: боец бьёт один раз за тик,
      // и группа, стоящая в нескольких стычках, делит свой удар между ними, а не бьёт в каждой целиком.
      // У дотягивающейся конницы в стычке только конные — и считаются, и бьют, и получают они.
      const facingMen = new Map<Group, number>();
      for (const c of contacts) {
        for (const g of c.a) facingMen.set(g, (facingMen.get(g) ?? 0) + menIn(c.b));
        for (const g of c.b) facingMen.set(g, (facingMen.get(g) ?? 0) + menIn(c.a, c.kinds));
      }
      for (const c of contacts) {
        const aOver = c.aOver ?? 0;
        const bOver = c.bOver ?? 0;
        const aCover = c.aCover ?? 1;
        const bCover = c.bCover ?? 1;
        this.melee(c.a, c.b, { flank: c.aFlank, toRow: c.bRow, open: bOver > 0 ? bCover : 0, over: aOver, cover: aCover, kinds: c.kinds, lane: c.lane }, facingMen, hits);
        // Ответ: обойдённые отбиваются тем, кто их обходит, но копья накрытой обходом доли ряда в этот тик разомкнуты.
        this.melee(c.b, c.a, { flank: false, toRow: c.aRow, open: c.aFlank ? 1 : aOver > 0 ? aCover : 0, over: bOver, cover: bCover, targetKinds: c.kinds }, facingMen, hits);
      }
      this.apply(hits);
      this.relocate();
    }
    this.updateMorale();
  }

  /**
   * Ширина фронта (docs/battle_eu4.md, пачка 2). В ряду полосы — фронте, тылу, обходе — с каждой стороны
   * бьёт и стреляет не больше `width` человек: ряд шире — каждая его группа работает долей
   * `width / людей в ряду`. Потери ложатся на всех, мораль уходит долей от всех (`updateMorale`), поэтому
   * лишние — глубина: они держат ряд и встают на место павших сами, когда он редеет. Численность даёт
   * стойкость, а не убийства; бой, где ряды уже ширины, идёт как без неё.
   *
   * Бежавшие ряда не держат: их нет ни в счёте, ни в доле. Резерв не бьёт — его нет в рядах вовсе.
   * Решения боя — кто проигрывает полосу, куда вводить резерв — меряют силу всего ряда, а не
   * работающих: глубина тоже сила, и противник её видит.
   */
  measureRows(): void {
    this.rowMen.clear();
    for (const side of SIDES) {
      for (const g of this.sides[side].groups) {
        if (g.lane === null || g.fled || !alive(g) || (g.row !== 'front' && g.row !== 'rear' && g.row !== 'strike')) continue;
        const key = rowKey(side, g.lane, g.row);
        this.rowMen.set(key, (this.rowMen.get(key) ?? 0) + stackTotal(g.stack));
      }
    }
  }

  /** Какая доля группы бьёт в этот тик: ряд уже ширины — вся. Первый раз зажатый ряд пишется в журнал. */
  widthShare(g: Group): number {
    if (g.lane === null || (g.row !== 'front' && g.row !== 'rear' && g.row !== 'strike')) return 1;
    const men = this.rowMen.get(rowKey(g.side, g.lane, g.row)) ?? 0;
    if (men <= this.width) return 1;
    const row = g.row;
    const sector = laneSector(g.lane, row === 'rear' ? 'rear' : 'front');
    this.once(`depth:${row}:${sector}`, this.sides[g.side], { id: 'depth', side: g.side, sector, row, men: Math.round(men), width: this.width });
    return this.width / men;
  }

  /** Пары позиций, которые сейчас дерутся. */
  buildContacts(): Contact[] {
    const contacts: Contact[] = [];
    const pair = (a: Group[], b: Group[], aFlank: boolean, aRow: Row, bRow: Row): void => {
      if (a.length === 0 || b.length === 0) return;
      contacts.push({ a, b, aFlank, aRow, bRow });
    };
    // Обходы: навстречу обходу не разворачивается никто — перехват жил приказом «держать фланг».
    for (const side of SIDES) {
      for (const g of this.sides[side].groups) {
        if (g.row !== 'strike' || !alive(g) || g.lane === null) continue;
        const enemy = other(side);
        const eLane = facing(g.lane);
        const rear = this.at(enemy, eLane, 'rear');
        const front = this.at(enemy, eLane, 'front');
        const order = g.prefer === 'rear' ? [rear, front] : [front, rear];
        const rows: Array<'rear' | 'front'> = g.prefer === 'rear' ? ['rear', 'front'] : ['front', 'rear'];
        for (let i = 0; i < 2; i += 1) {
          if (order[i].length === 0) continue;
          pair([g], order[i], true, 'strike', rows[i]);
          this.flankTurned(side, enemy, eLane, rows[i], order[i]);
          break;
        }
      }
    }
    // Обходящий, у которого в полосе нет ни фронта, ни тыла противника, бьёт того, кто в его досягаемости, — и чужого
    // обходящего той же полосы, как полк EU4 бьёт полк напротив (слово владельца, docs/battle_eu4.md, 14.25). Прежде
    // обходящие одной полосы друг друга не видели, и бой стоял без потерь до потолка кругов: у обеих сторон в строю
    // кто-то есть, сломаться некому (14.22). Сходятся лицом к лицу — это не обход, и фланга у стычки нет. Стычка на
    // полосу одна: все обходящие стороны в полосе либо заняты строем противника, либо свободны, и свободная сторона
    // бьёт всех обходящих другой — те отвечают, занятые при этом делят удар (`facingMen`).
    for (const lane of [0, 1, 2] as Lane[]) {
      const aS = this.at('attacker', lane, 'strike');
      const dS = this.at('defender', facing(lane), 'strike');
      if (aS.length === 0 || dS.length === 0) continue;
      const aFree = !this.enemyOnLane('attacker', lane);
      const dFree = !this.enemyOnLane('defender', facing(lane));
      if (aFree) pair(aS, dS, false, 'strike', 'strike');
      else if (dFree) pair(dS, aS, false, 'strike', 'strike');
    }
    // Медленные не могут сократить дистанцию: пока быстрых нет ни у кого,
    // рукопашная в полосе начинается позже, а лучники всё это время бьют в полную силу.
    const slow = (groups: Group[]): boolean =>
      groups.every((g) => UNIT_KINDS.every((k) => g.stack[k] < EPS || UNIT_STATS[k].speed <= SLOW_CONTACT.speedAtMost));
    const late = this.tick < this.clashTick + SLOW_CONTACT.delay;
    for (const lane of [0, 1, 2] as Lane[]) {
      const aF = this.at('attacker', lane, 'front');
      const dF = this.at('defender', facing(lane), 'front');
      const aR = this.at('attacker', lane, 'rear');
      const dR = this.at('defender', facing(lane), 'rear');
      if (aF.length > 0 && dF.length > 0) {
        if (late && slow(aF) && slow(dF)) continue;
        // Край строя в своей полосе: кто шире, тот свесом бьёт во фланг. Ширину ряд занимает тем, чем встал (`occupied`),
        // а не тем, сколько в нём живых: поредевший держит своё место, как полк EU4, и бьёт краем долей своей
        // численности от начальной — потому что бьют живые.
        const aOcc = occupied(aF, this.width);
        const dOcc = occupied(dF, this.width);
        const over = (x: number, y: number): number => (x > 0 ? Math.floor(Math.max(0, x - y) + 1e-9) / x : 0);
        const aOver = over(aOcc, dOcc);
        const dOver = over(dOcc, aOcc);
        const cover = (x: number, y: number): number => (y > 0 ? Math.min(1, Math.floor(Math.max(0, x - y) + 1e-9) / y) : 1);
        const aCover = cover(aOcc, dOcc);
        const dCover = cover(dOcc, aOcc);
        contacts.push({ a: aF, b: dF, aFlank: false, aRow: 'front', bRow: 'front', aOver, bOver: dOver, aCover, bCover: dCover });
        if (aOver > 0) this.flankTurned('attacker', 'defender', facing(lane), 'front', dF, aCover);
        if (dOver > 0) this.flankTurned('defender', 'attacker', lane, 'front', aF, dCover);
      } else if (aF.length > 0 && dR.length > 0) {
        if (late && slow(aF)) continue;
        pair(aF, dR, false, 'front', 'rear');
        this.reached('defender', facing(lane));
      } else if (dF.length > 0 && aR.length > 0) {
        if (late && slow(dF)) continue;
        pair(dF, aR, false, 'front', 'rear');
        this.reached('attacker', lane);
      }
    }
    // Край, против которого во всей полосе противника нет с начала боя, дотягивается до соседней полосы теми родами,
    // чья дальность больше своей полосы (`REACH`): первым — до её тыла (лучников), нет тыла — до фронта. Остальные
    // стоят: их дальность — своя полоса.
    const far = farKinds();
    for (const side of SIDES) {
      const enemy = other(side);
      for (const lane of [0, 1, 2] as Lane[]) {
        if (this.opposed[side][lane] || far.length === 0) continue;
        const riders = this.at(side, lane, 'front').filter((g) => menIn([g], far) >= EPS);
        if (riders.length === 0) continue;
        for (const to of [lane - 1, lane + 1]) {
          if (to < 0 || to > 2) continue;
          const eLane = facing(to as Lane);
          const rear = this.at(enemy, eLane, 'rear');
          const front = this.at(enemy, eLane, 'front');
          const row: 'rear' | 'front' | null = rear.length > 0 ? 'rear' : front.length > 0 ? 'front' : null;
          if (row === null) continue;
          const targets = row === 'rear' ? rear : front;
          contacts.push({ a: riders, b: targets, aFlank: true, aRow: 'front', bRow: row, kinds: far, lane: to as Lane });
          this.flankTurned(side, enemy, eLane, row, targets);
        }
      }
    }
    return contacts;
  }

  /**
   * Фланг обойдён: раз на сектор — событие, и разовый удар по морали тех, кого обошли, — долей накрытого ряда (`cover`).
   * Обход, накрывший больше прежнего, добирает удар до этой доли; целиком он не больше `MORALE.flankTurned`.
   */
  flankTurned(by: Side, victim: Side, lane: Lane, row: 'front' | 'rear', targets: Group[], cover = 1): void {
    const sector = laneSector(lane, row);
    this.once(`flanked:${sector}`, this.sides[victim], { id: 'flank-turned', side: victim, sector, by });
    const key = `${victim}:${sector}`;
    const done = this.shaken.get(key) ?? 0;
    if (cover <= done) return;
    this.shaken.set(key, cover);
    for (const t of targets) this.shake(t, MORALE.flankTurned * (cover - done));
  }

  reached(victim: Side, lane: Lane): void {
    const sector = laneSector(lane, 'rear');
    const s = this.sides[victim];
    if (s.fired.has(`reached:${sector}`)) return;
    s.fired.add(`reached:${sector}`);
    this.emit({ id: 'rear-reached', side: victim, sector, by: other(victim) });
    for (const g of this.at(victim, lane, 'rear')) this.shake(g, MORALE.rearReached);
  }

  /** Множитель урона, который получает группа за один свой боец рода `kind`. */
  taken(g: Group, kind: UnitKind, frontal: boolean): number {
    const s = this.sides[g.side];
    let m = 1;
    if (g.row === 'front' && !anchored(g.stack)) m *= ANCHOR.noInfantryDamageTaken;
    if (s.retreating) m *= RETREAT.taken;
    if (this.phase === 'clash' && kind === 'spear' && frontal && closedSpears(g)) m *= CLASH_SPEAR_BRACE;
    return m;
  }

  /**
   * Общие множители силы группы: кость фазы и отход. Мораль в урон не входит — у EU4 урон от силы полка, а не от его
   * морали (поставка 5, docs/battle_eu4.md, 14.33; прежде — ×(0.5 + 0.5 · мораль / 100)).
   */
  dealtMult(g: Group): number {
    const s = this.sides[g.side];
    let m = this.luck[g.side];
    if (s.retreating) m *= RETREAT.dealt;
    return m;
  }

  /**
   * Раздать урон `total` по группам позиции пропорционально числу: приоритета цели нет — он жил
   * приказами. `fromOpen` — копья того, кто бьёт, не сомкнуты (`ringMult`).
   */
  distribute(
    from: Group,
    kind: UnitKind,
    total: number,
    targets: Group[],
    ctx: { flank: boolean; fromOpen: boolean; ranged: boolean; frontal: boolean; kinds?: readonly UnitKind[]; cover?: number },
    byLane: Lane,
    hits: Hit[],
  ): void {
    const kinds: readonly UnitKind[] = ctx.kinds ?? UNIT_KINDS;
    let weight = 0;
    for (const t of targets) for (const k of kinds) weight += t.stack[k];
    if (weight <= 0) return;
    for (const t of targets) {
      for (const k of kinds) {
        const n = t.stack[k];
        if (!stands(n)) continue;
        const share = n / weight;
        const dmg = total * share * ringMult(kind, k, ctx.flank, ctx.fromOpen, ctx.ranged);
        const casualties = (dmg / UNIT_STATS[k].toughness) * this.taken(t, k, ctx.frontal);
        if (casualties > 0) hits.push({ target: t, kind: k, casualties, by: from.side, byKind: kind, byLane, ranged: ctx.ranged, flank: ctx.flank, cover: ctx.cover ?? 1 });
      }
    }
  }

  /**
   * Рукопашная `from` по `to` в одной стычке. Группа бьёт в эту стычку только ту долю
   * своих людей, какую составляет здесь противник от всех, с кем она сейчас дерётся
   * (`facingMen`): окружённый строй отбивается во все стороны, но тем же числом рук.
   * Прежде доля не делилась, и группа, обойдённая с двух сторон, била трижды за тик —
   * обход, задуманный наказанием за скученность, умножал силу окружённого.
   */
  melee(
    from: Group[],
    to: Group[],
    ctx: { flank: boolean; toRow: Row; open: number; over: number; cover: number; kinds?: readonly UnitKind[]; targetKinds?: readonly UnitKind[]; lane?: Lane },
    facingMen: Map<Group, number>,
    hits: Hit[],
  ): void {
    const here = menIn(to, ctx.targetKinds);
    const kinds: readonly UnitKind[] = ctx.kinds ?? UNIT_KINDS;
    for (const g of from) {
      if (g.lane === null) continue;
      // Своя доля стычки и доля ряда, которую пускает ширина фронта: остальные — глубина.
      const share = (here / Math.max(here, facingMen.get(g) ?? here)) * this.widthShare(g);
      // Сомкнутые копья размыкаются той долей ряда, которую накрыл обход (`open`); остальные держат упор.
      const parts: Array<[number, boolean]> = closedSpears(g) ? [[1 - ctx.open, false], [ctx.open, true]] : [[1, true]];
      const lane = ctx.lane ?? g.lane;
      for (const kind of kinds) {
        if (!stands(g.stack[kind])) continue;
        const n = g.stack[kind] * share;
        let p = n * UNIT_STATS[kind].melee * MELEE_RATE * this.dealtMult(g);
        // Удар с разбега — вес, и он у тяжёлой.
        if (kind === 'heavy' && this.phase === 'clash' && !ctx.flank && g.row === 'front') p *= CLASH_CAVALRY_IMPACT;
        // Свес ряда бьёт во фланг, остальные — в лоб.
        for (const [part, fromOpen] of parts) {
          if (part <= 0) continue;
          const front = p * part * (1 - ctx.over);
          const edge = p * part * ctx.over;
          const base = { fromOpen, ranged: false, kinds: ctx.targetKinds };
          if (front > 0) this.distribute(g, kind, front, to, { ...base, flank: ctx.flank, frontal: !ctx.flank && ctx.toRow !== 'rear', cover: 1 }, lane, hits);
          if (edge > 0) this.distribute(g, kind, edge, to, { ...base, flank: true, frontal: false, cover: ctx.cover }, lane, hits);
        }
      }
    }
  }

  shoot(g: Group, engaged: Map<Group, Group[]>, hits: Hit[]): void {
    if (g.lane === null) return;
    const lane: Lane = g.lane;
    const candidates: Group[][] = [this.enemyFront(g.side, lane), this.enemyRear(g.side, lane)];
    for (const l of [1, 0, 2] as Lane[]) if (l !== lane) candidates.push(this.enemyFront(g.side, l), this.enemyRear(g.side, l));
    const targets = candidates.find((c) => c.length > 0);
    if (!targets) return;
    // Пока цель не в рукопашной, стрельба идёт в полную силу; после контакта — через головы.
    const m = targets.some((t) => engaged.has(t)) ? COUNTER.archer.afterContact : 1;
    // Стреляет не больше ширины ряда: лучники за строем шире фронта — та же глубина, что у пехоты.
    const p = g.stack.archer * UNIT_STATS.archer.ranged * RANGED_RATE * this.dealtMult(g) * m * this.widthShare(g);
    this.distribute(g, 'archer', p, targets, { flank: false, fromOpen: false, ranged: true, frontal: false }, g.lane, hits);
  }

  apply(hits: Hit[]): void {
    for (const h of hits) {
      const actual = Math.min(h.target.stack[h.kind], h.casualties);
      if (actual <= 0) continue;
      h.target.stack[h.kind] -= actual;
      const victim = this.sides[h.target.side];
      victim.lostTotal += actual;
      victim.lostTick += actual;
      // Стрелы бьют по морали своими потерями весь бой одинаково: «обвыклись» — вполсилы после 8-го тика — ушло (поставка 5,
      // docs/battle_eu4.md, 14.33): отдельного счёта у морали нет (14.19.3).
      h.target.lostTick += actual;
      if (h.flank) {
        if (h.target.flankedTick !== this.tick) h.target.flankCover = 0;
        h.target.flankedTick = this.tick;
        h.target.flankCover = Math.max(h.target.flankCover, h.cover);
      }
      const by = this.sides[h.by];
      by.kills[h.byLane][h.byKind][h.kind] += actual;
      if (h.ranged) by.rangedTotal += actual;
      if (h.ranged && !this.contact) {
        by.volley += actual;
        if (this.round === 0) by.rangedBeforeContact += actual;
      }
    }
  }

  /**
   * Полоса очищена в бою — фронт и обходящие переходят на соседнюю (К5). Полоса, где противника не было с начала
   * боя, — не очищенная, а край строя: оттуда дотягивается только конница (`buildContacts`), пешие стоят.
   *
   * Строя противника не осталось ни в одной полосе — обходящий идёт к чужим обходящим: стоит, если они у него в полосе,
   * иначе переходит в соседнюю, где они стоят (docs/battle_eu4.md, 14.25). Прежде `relocate` противником считал только
   * фронт и тыл, и обходящие двух сторон в соседних полосах стояли врозь до потолка кругов: «уйти некуда» (14.22).
   * Стороны ходят по очереди, поэтому вторая застаёт первую уже у себя в полосе и стоит — встречные не меняются местами.
   */
  relocate(): void {
    if (!this.contact) return;
    for (const side of SIDES) {
      for (const g of this.sides[side].groups) {
        if (!alive(g) || g.lane === null || (g.row !== 'front' && g.row !== 'strike')) continue;
        if (this.enemyOnLane(side, g.lane)) continue;
        if (g.row === 'front' && !this.opposed[side][g.lane]) continue;
        const next = this.adjacentLane(side, g.lane) ?? (g.row === 'strike' ? this.strikerLane(side, g.lane) : null);
        if (next === null) continue;
        g.lane = next;
        if (g.row === 'front') {
          g.row = 'strike';
          g.prefer = 'front';
        }
      }
    }
  }

  // ----- Мораль -----

  /**
   * Характер группы сейчас: множитель потерь морали по родам, взвешенный числом
   * людей. Копья стойки в сомкнутом строю и ломки под ударом во фланг; конница
   * крепка на разгоне и хрупка, когда стоит; лучники в рукопашной ломаются быстро.
   */
  temper(g: Group): number {
    const total = stackTotal(g.stack);
    if (total < EPS) return 1;
    // Обойдённая доля ряда (`flankCover`): край строя накрывает свою долю, обход группой — весь ряд.
    const flanked = g.flankedTick === this.tick ? g.flankCover : 0;
    const inLine = g.row === 'front' || g.row === 'rear';
    const closed = closedSpears(g);
    let m = 0;
    for (const k of UNIT_KINDS) {
      const n = g.stack[k];
      if (n < EPS) continue;
      let t = 1;
      if (k === 'spear') t = flanked * TEMPER.spear.flanked + (1 - flanked) * (closed ? TEMPER.spear.holding : TEMPER.spear.advancing);
      else if (k === 'infantry') t = TEMPER.infantry.all;
      // Лучники под прикрытием сомкнутых копий той же позиции стреляют из-за строя, а не дерутся.
      else if (k === 'archer') t = this.engagedNow.has(g) && !closed ? TEMPER.archer.melee : TEMPER.archer.shooting;
      else if (g.row === 'strike' || this.phase === 'clash') t = TEMPER[k].charging;
      else if (inLine && this.contact) t = TEMPER[k].stalled;
      else t = TEMPER[k].waiting;
      m += n * t;
    }
    return m / total;
  }

  /** Множитель всех потерь морали группы: характер и якорь пехоты. */
  moraleFactor(g: Group): number {
    return this.temper(g) * (anchored(g.stack) ? MORALE.anchor : 1);
  }

  /**
   * Сектор сломался: бегут с поля, место открыто резерву. Соседей это не трогает — паники на соседей нет, как у EU4
   * (docs/battle_eu4.md, 14.21): каждый сектор отходит сам, по своей морали, а на его место встаёт резерв.
   */
  breakGroup(g: Group): void {
    const s = this.sides[g.side];
    // В журнале — сектор расстановки, а не позиция: пехота, ушедшая обходом на соседнюю полосу, для игрока всё ещё «правый фланг».
    const sector = g.origin;
    g.fled = true;
    g.morale = 0;
    g.lane = null;
    this.once(`broken:${sector}`, s, { id: 'sector-broken', side: g.side, sector });
  }

  /**
   * Минимум боя EU4 (`BREAK_AFTER`, 14.21): прошли ли уже две фазы огня и две натиска. До того сторона моралью не
   * ломается, даже если в строю у неё никого, — ломается в первый тик после.
   */
  mayRetreat(): boolean {
    return Object.entries(BREAK_AFTER).every(([pip, n]) => (this.passed[pip as PipId] ?? 0) >= (n ?? 0));
  }

  /**
   * Мораль по секторам: потери сектора и удар с фланга. Сектор с нулевой моралью бежит с поля. Бегство соседа мораль
   * не трогает (14.21). Сторона сломана, когда в строю никого нет и встать некому — резерв исчерпан (мораль EU4,
   * docs/battle_eu4.md, 14.15), но не раньше минимума боя (`mayRetreat`), — или перебита: этого минимум не держит.
   */
  updateMorale(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      // Противник сломался — своим больше нечего бояться: мораль не падает.
      const enemyBroken = this.sides[other(side)].broken && !s.broken;
      const toBreak: Group[] = [];
      for (const g of s.groups) {
        if (!alive(g) || g.fled || enemyBroken) continue;
        let drain = (g.lostTick / Math.max(1, g.initial)) * MORALE.perLoss;
        if (g.flankedTick === this.tick) drain += MORALE.flankDrain * g.flankCover;
        g.morale -= drain * this.moraleFactor(g);
        g.morale = Math.min(MORALE.max, g.morale);
        if (g.morale <= 0) toBreak.push(g);
      }
      for (const g of toBreak) this.breakGroup(g);

      let alive_ = 0;
      let moraleSum = 0;
      let brokenWeight = 0;
      let inLine = 0;
      for (const g of s.groups) {
        const n = stackTotal(g.stack);
        if (g.fled || !alive(g)) brokenWeight += g.initial;
        if (!alive(g)) continue;
        if (!g.fled && g.lane !== null) inLine += n;
        alive_ += n;
        moraleSum += n * g.morale;
      }
      s.morale = alive_ > 0 ? moraleSum / alive_ : 0;
      const brokenShare = brokenWeight / Math.max(1, s.initialTotal);
      // В строю никого, и встать некому: резерв — тем же счётом, каким он встаёт (`reserveMen`).
      const nobody = inLine < EPS && this.reserveMen(side) < 1;
      const remaining = alive_;
      if (!s.broken && remaining < ANNIHILATED_AT * s.initialTotal) {
        s.broken = true;
        s.brokenAt = this.tick;
        s.brokenReason = 'annihilated';
        this.emit({ id: 'annihilated', side });
      } else if (!s.broken && nobody && this.mayRetreat()) {
        s.broken = true;
        s.brokenAt = this.tick;
        s.brokenReason = 'morale';
        this.emit({ id: 'morale-collapsed', side, morale: Math.round(s.morale), brokenShare: Math.round(brokenShare * 100) / 100 });
      } else if (s.broken && s.brokenReason === 'morale' && remaining < ANNIHILATED_AT * s.initialTotal && !s.fired.has('annihilated')) {
        s.fired.add('annihilated');
        this.emit({ id: 'annihilated', side });
      }
    }
  }

  /** Начало отступления: кто отходит. */
  decide(): void {
    const a = this.sides.attacker;
    const d = this.sides.defender;
    const remain = (s: SideState): number => s.groups.reduce((n, g) => n + stackTotal(g.stack), 0) / Math.max(1, s.initialTotal);
    let loser: SideState | null = null;
    if (a.broken && !d.broken) loser = a;
    else if (d.broken && !a.broken) loser = d;
    else if (a.broken && d.broken) {
      if ((a.brokenAt ?? 0) !== (d.brokenAt ?? 0)) loser = (a.brokenAt ?? 0) < (d.brokenAt ?? 0) ? a : d;
      else loser = remain(a) <= remain(d) ? a : d;
    } else {
      const ra = remain(a);
      const rd = remain(d);
      if (ra >= rd * WITHDRAW_RATIO) loser = d;
      else if (rd >= ra * WITHDRAW_RATIO) loser = a;
    }
    if (!loser) {
      this.winner = 'draw';
      this.reason = 'draw';
      return;
    }
    loser.retreating = true;
    loser.pursuitBudget = loser.groups.reduce((n, g) => n + stackTotal(g.stack), 0) * RETREAT.pursuitCap;
    this.winner = other(loser.id);
    this.reason = loser.brokenReason ?? 'losses';
    if (!loser.broken) {
      // Никто не сломался — исход решил размен. Отчёту нужно, чем именно.
      const winner = this.sides[this.winner];
      this.emit({ id: 'outfought', side: loser.id, kept: Math.round(remain(loser) * 100), enemyKept: Math.round(remain(winner) * 100) });
    }
    this.emit({ id: 'retreat', side: loser.id, orderly: !loser.broken });
  }

  /** Преследование: победитель добивает отступающих, но не больше доли. */
  pursue(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      const enemy = this.sides[other(side)];
      if (!enemy.retreating || s.retreating) continue;
      let kills = 0;
      for (const g of s.groups) {
        if (!alive(g)) continue;
        for (const k of UNIT_KINDS) {
          if (g.stack[k] < EPS) continue;
          kills += g.stack[k] * RETREAT.pursuitKills[k];
        }
      }
      kills = Math.min(kills, enemy.pursuitBudget);
      if (kills <= 0) continue;
      enemy.pursuitBudget -= kills;
      // Медленных догоняют первыми.
      const targets = enemy.groups.filter(alive);
      let weight = 0;
      for (const t of targets) for (const k of UNIT_KINDS) weight += t.stack[k] / UNIT_STATS[k].speed;
      if (weight <= 0) continue;
      for (const t of targets) {
        for (const k of UNIT_KINDS) {
          const n = t.stack[k];
          if (n < EPS) continue;
          const actual = Math.min(n, (kills * (n / UNIT_STATS[k].speed)) / weight);
          t.stack[k] -= actual;
          enemy.lostTotal += actual;
          enemy.lostTick += actual;
        }
      }
    }
  }

  // ----- Итог -----

  finish(): BattleResult {
    if (this.winner === null) {
      this.winner = 'draw';
      this.reason = 'draw';
    }
    const sides = { attacker: this.sideResult('attacker'), defender: this.sideResult('defender') };
    // Стрельба не может выбить больше, чем противник потерял по итогу: округления сходятся к целым потерям.
    for (const side of SIDES) {
      const enemyLosses = sides[other(side)].total.losses;
      sides[side].rangedTotal = Math.min(sides[side].rangedTotal, enemyLosses);
      sides[side].rangedBeforeContact = Math.min(sides[side].rangedBeforeContact, sides[side].rangedTotal);
    }
    // Результат и цена отдельно: поле удержано, но потеряно больше, чем у противника, — победа с непомерными потерями.
    let pyrrhic = false;
    if (this.winner !== 'draw') {
      const w = sides[this.winner].total.losses;
      const l = sides[other(this.winner)].total.losses;
      pyrrhic = w > 0 && l / w < PYRRHIC_BELOW;
      sides[this.winner].verdict = pyrrhic ? 'pyrrhic' : 'victory';
      sides[other(this.winner)].verdict = 'defeat';
    }
    this.emit({ id: 'result', winner: this.winner, reason: this.reason, pyrrhic });
    return {
      seed: this.input.seed,
      ticks: this.tick,
      winner: this.winner,
      reason: this.reason,
      pyrrhic,
      phases: this.phases,
      sides,
      log: this.log,
    };
  }

  sideResult(side: Side): SideResult {
    const s = this.sides[side];
    const sectors = {} as SideResult['sectors'];
    const initial = emptyStack();
    const final = emptyStack();
    for (const sector of SECTORS) {
      const init = { ...s.setup.sectors[sector] };
      const fin = emptyStack();
      for (const k of UNIT_KINDS) {
        let n = 0;
        for (const g of s.groups) if (g.origin === sector) n += g.stack[k];
        fin[k] = Math.min(init[k], Math.round(n));
        initial[k] += init[k];
        final[k] += fin[k];
      }
      // Мораль сектора — по живым группам, что оттуда родом; сектор бежал, если бежали все они.
      const own = s.groups.filter((g) => g.origin === sector);
      const men = own.reduce((n, g) => n + stackTotal(g.stack), 0);
      const morale = men > 0 ? own.reduce((n, g) => n + g.morale * stackTotal(g.stack), 0) / men : 0;
      const broken = own.length > 0 && own.every((g) => g.fled || !alive(g));
      sectors[sector] = { initial: init, final: fin, morale: Math.round(Math.max(0, Math.min(MORALE.max, morale))), broken };
    }
    const losses = emptyStack();
    for (const k of UNIT_KINDS) losses[k] = initial[k] - final[k];
    // С какой долей полной морали выходят уцелевшие: их мораль к свежей, взвешенная людьми (мораль между боями, 14.31).
    let kept = 0;
    let full = 0;
    for (const g of s.groups) {
      if (!alive(g)) continue;
      const n = stackTotal(g.stack);
      kept += n * Math.max(0, g.morale);
      full += n * fullMorale(s.setup, g.stack);
    }
    const rest = full > 0 ? Math.round(Math.max(0, Math.min(1, kept / full)) * 100) / 100 : 1;
    return {
      initial,
      final,
      losses,
      total: { initial: stackTotal(initial), final: stackTotal(final), losses: stackTotal(losses) },
      sectors,
      morale: Math.round(Math.max(0, Math.min(MORALE.max, s.morale))),
      rest,
      verdict: 'draw',
      brokenAt: s.brokenAt,
      rangedBeforeContact: Math.round(s.rangedBeforeContact),
      rangedTotal: Math.round(s.rangedTotal),
    };
  }
}

/** Единственная дверь: бой целиком, детерминированно по сиду. */
export function simulateBattle(input: BattleInput): BattleResult {
  for (const side of SIDES) {
    const err = validateSetup(input[side]);
    if (err) throw new Error(`battle: ${side}: ${err}`);
  }
  // Ширина — положительное число; `Infinity` законна и значит «боя без ширины».
  if (input.width !== undefined && !(input.width > 0)) throw new Error(`battle: ширина фронта ${input.width}`);
  return new Battle(input).run();
}
