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
  RANGED_SHOCK_LATE,
  RANGED_SHOCK_TICKS,
  RETREAT,
  CIRCLE_PHASES,
  circleMin,
  circleTicks,
  SLOW_CONTACT,
  TEMPER,
  UNIT_STATS,
  WITHDRAW_RATIO,
  moraleDamageMult,
  roundsCap,
} from './config';
import { seededRng, type Rng } from './rng';
import { deployInto, emptyStack, fitRows, stackTotal, validateSetup } from './setup';
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
  /** Фронт смят: откатились в тыл и больше не сомкнутый строй. */
  routed: boolean;
  /** Мораль сектора, 0..`MORALE.max`. Своя у каждой группы: сектор ломается сам, а не вся армия. */
  morale: number;
  /**
   * Мораль упала до нуля: бегут с поля (мораль EU4, docs/battle_eu4.md, 14.15). Полосы у бежавших нет (`lane` —
   * `null`): не бьют, не стоят в ряду, не закрывают собой тех, кто за ними, — их место занимает резерв. Достаёт их
   * только преследование.
   */
  fled: boolean;
  /** Где стояли, когда побежали: соседям по строю — паника от бежавшего рядом (`neighbours`). До поставки 5. */
  fledFrom: { lane: Lane; row: Row } | null;
  /** Последний тик, когда группу били с фланга или тыла. */
  flankedTick: number;
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
}

interface Contact {
  a: Group[];
  b: Group[];
  /** Группы `a` бьют `b` с фланга или тыла. */
  aFlank: boolean;
  bRow: Row;
  aRow: Row;
}

const EPS = 0.5;
const alive = (g: Group): boolean => stackTotal(g.stack) >= EPS;
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
 * Сомкнуты ли копья группы — положение, а не приказ (docs/battle_eu4.md, 14.5, Е17): копья в строю
 * (фронт или тыл своей полосы) сомкнуты, пока не смяты и не бегут. Удар во фланг размыкает их на тот
 * тик, когда он пришёл, — это читают кольцо и характер там, где знают, откуда удар.
 */
const closedSpears = (g: Group): boolean => (g.row === 'front' || g.row === 'rear') && !g.routed && !g.fled && g.stack.spear >= EPS;

/** Сектор с пехотой заякорен: держит мораль и линию. */
const anchored = (stack: Stack): boolean => stack.infantry >= ANCHOR.infantryShare * Math.max(stackTotal(stack), EPS);

/**
 * Стартовая мораль группы: базовая мораль её родов, взвешенная числом людей,
 * плюс ступени снаряжения из кузницы и стойкость, с которой армия вышла в поле
 * (`setup.resolve` — ноль, если ничего такого не было).
 *
 * Открыта наружу ради тестов мира: что стойкость стороны — один обряд храма, а
 * отметки полководца в мораль не идут, они меряют этой самой функцией, а не
 * своей копией формулы. Ядро от этого чистым быть не перестаёт: функция ничего
 * не знает ни об игре, ни о том, кто её зовёт.
 */
export function startMorale(setup: ArmySetup, stack: Stack): number {
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

/** Отметки стороны по одной фазе: неотрицательное конечное число, нет поля — ноль. */
export const pipOf = (setup: ArmySetup, pip: PipId): number => {
  const n = setup.pips?.[pip] ?? 0;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/**
 * Множитель урона стороны в фазе: бросок кости плюс отметки её полководца (`DICE`). Открыт наружу
 * ради карточки полководца: что прибавляет отметка, карточка меряет этой самой функцией, а не своей
 * копией формулы. Меньше нуля не бывает — урон не становится лечением.
 */
export const phaseLuck = (roll: number, pips = 0): number => Math.max(0, 1 + DICE.step * (roll + pips - (DICE.faces - 1) / 2));

/**
 * Множитель кольца: `kind` бьёт `target`. Сомкнутость копий — положение (`closedSpears`), а не приказ
 * (docs/battle_eu4.md, 14.5, Е17): `fromOpen` — копья того, кто бьёт, не сомкнуты (смяты, бегут или
 * обойдены в этот тик); `targetBroken` — цель смята или бежит: такие копья строя не держат, с какой стороны
 * их ни бей. Открыт наружу ради теста «копья держат конницу, пока не обойдены»: кольцо проверяется этой
 * самой функцией, а не своей копией.
 */
export function ringMult(kind: UnitKind, target: UnitKind, flank: boolean, fromOpen: boolean, ranged: boolean, targetBroken: boolean): number {
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
      if (target === 'spear') {
        if (!targetBroken && !flank) return c.spearClosed;
        return flank ? c.flank : 1;
      }
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
    routed: false,
    morale: opts.morale ?? startMorale(setup, stack),
    fled: false,
    fledFrom: null,
    flankedTick: -1,
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
  winner: Winner | null = null;
  reason: ResultReason = 'draw';

  constructor(readonly input: BattleInput) {
    this.rng = seededRng(input.seed);
    // Своя ширина боя главнее; без неё — ширина фронта. `Infinity` — боя без ширины.
    this.width = input.width ?? FRONT_WIDTH;
    const make = (id: Side, given: ArmySetup): SideState => {
      // Ряд шире ширины не стоит: кто сверх, — в резерве стороны (`setup.fitRows`). Правило развёртывания такого
      // ряда не кладёт; кладёт раскладка руками — оборона игрока до поставки 2. Запись боя видит то, что встало.
      const setup: ArmySetup = { ...given, sectors: fitRows(given.sectors, this.width) };
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
    for (const side of SIDES) {
      rolls[side] = Math.floor(this.rng() * DICE.faces);
      pips[side] = pipOf(this.sides[side].setup, pip);
      this.luck[side] = phaseLuck(rolls[side], pips[side]);
    }
    this.emit({ id: 'dice', rolls, pips });
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

  // ----- Расписание -----

  /**
   * Бой — круги всем боем (docs/battle_eu4.md, разделы 3.1 и 12): обстрел, сшибка и сеча (`CIRCLE_PHASES`),
   * снова и снова, с новой костью в каждой фазе, пока кто-то не сломается, но не больше потолка (`roundsCap`
   * от глубины меньшей по ней стороны: вся её армия к трём полосам ширины фронта). Длины фаз — доля прежнего
   * боя в один проход на круг (`circleTicks`). Сломался кто-то — бой линий обрывается на своём минимуме, и
   * дальше отход с погоней.
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
        if (this.runPhase(phase, ticks, circleMin(phase, k))) break;
      }
    }
    this.runPhase('retreat', PHASE_TICKS.retreat, PHASE_TICKS.retreat);
    this.runPhase('pursuit', PHASE_TICKS.pursuit, PHASE_TICKS.pursuit);
    return this.finish();
  }

  /** Одна фаза целиком. Правда — сторона сломалась посреди сечи, и ждать в этом круге больше нечего. */
  runPhase(phase: PhaseId, ticks: number, min: number): boolean {
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
      if (someoneBroken && phase === 'lines' && done >= min) {
        // Сторона сломалась — бой линий обрывается на своём минимуме: ждать больше нечего, а каждый лишний тик
        // рубит бегущих.
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
    return broke || this.sides.attacker.broken || this.sides.defender.broken;
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
      // Событие только про настоящий удар: мелкий размен на стыке — не «остановили».
      const enemyCavalry = SECTORS.reduce((n, id) => n + HORSE_KINDS.reduce((m, k) => m + enemy.setup.sectors[id][k], 0), 0);
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
   * встаёт в любую дыру строя — на место убитых и бежавших — тем же правилом развёртывания, каким войско встало
   * перед боем (`setup.deployInto`): пешие от центра к краям, конница с краёв, лучники во вторую линию. Места —
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
    const into = deployInto(pool, { front: room('front'), rear: room('rear') });
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
        const into_ = s.groups.find((g) => g.origin === 'R' && g.lane === lane && g.row === row && alive(g) && !g.fled && !g.routed);
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
      // Дыры строя закрывает резерв — до стычек, чтобы вошедшие дрались в этот же тик.
      for (const side of SIDES) if (!this.sides[side].retreating) this.refill(side);
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
      const facingMen = new Map<Group, number>();
      for (const [g, foes] of engaged) facingMen.set(g, foes.reduce((n, f) => n + stackTotal(f.stack), 0));
      for (const c of contacts) {
        this.melee(c.a, c.b, c.aFlank, c.bRow, false, facingMen, hits);
        // Ответ: обойдённые отбиваются тем, кто их обходит, но их копья в этот тик разомкнуты.
        this.melee(c.b, c.a, false, c.aRow, c.aFlank, facingMen, hits);
      }
      this.apply(hits);
      this.collapse();
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
          const sector = laneSector(eLane, rows[i]);
          if (!this.sides[enemy].fired.has(`flanked:${sector}`)) {
            this.once(`flanked:${sector}`, this.sides[enemy], { id: 'flank-turned', side: enemy, sector, by: side });
            for (const t of order[i]) this.shake(t, MORALE.flankTurned);
          }
          break;
        }
      }
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
        pair(aF, dF, false, 'front', 'front');
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
    return contacts;
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
    else if (s.broken) m *= MORALE.brokenTaken;
    if (this.phase === 'clash' && kind === 'spear' && frontal && closedSpears(g)) m *= CLASH_SPEAR_BRACE;
    return m;
  }

  /** Общие множители силы группы: мораль сектора, кость фазы, состояние. */
  dealtMult(g: Group): number {
    const s = this.sides[g.side];
    let m = moraleDamageMult(g.morale) * this.luck[g.side];
    if (s.broken) m *= MORALE.brokenDealt;
    if (s.retreating) m *= RETREAT.dealt;
    return m;
  }

  /**
   * Раздать урон `total` по группам позиции пропорционально числу: приоритета цели нет — он жил
   * приказами. `fromOpen` — копья того, кто бьёт, не сомкнуты (`ringMult`).
   */
  distribute(from: Group, kind: UnitKind, total: number, targets: Group[], ctx: { flank: boolean; fromOpen: boolean; ranged: boolean; frontal: boolean }, byLane: Lane, hits: Hit[]): void {
    let weight = 0;
    for (const t of targets) weight += stackTotal(t.stack);
    if (weight <= 0) return;
    for (const t of targets) {
      for (const k of UNIT_KINDS) {
        const n = t.stack[k];
        if (n < EPS) continue;
        const share = n / weight;
        const dmg = total * share * ringMult(kind, k, ctx.flank, ctx.fromOpen, ctx.ranged, t.routed);
        const casualties = (dmg / UNIT_STATS[k].toughness) * this.taken(t, k, ctx.frontal);
        if (casualties > 0) hits.push({ target: t, kind: k, casualties, by: from.side, byKind: kind, byLane, ranged: ctx.ranged, flank: ctx.flank });
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
  melee(from: Group[], to: Group[], flank: boolean, toRow: Row, flanked: boolean, facingMen: Map<Group, number>, hits: Hit[]): void {
    const here = to.reduce((n, t) => n + stackTotal(t.stack), 0);
    for (const g of from) {
      if (g.lane === null) continue;
      // Своя доля стычки и доля ряда, которую пускает ширина фронта: остальные — глубина.
      const share = (here / Math.max(here, facingMen.get(g) ?? here)) * this.widthShare(g);
      const fromOpen = flanked || !closedSpears(g);
      for (const kind of UNIT_KINDS) {
        if (g.stack[kind] < EPS) continue;
        const n = g.stack[kind] * share;
        let p = n * UNIT_STATS[kind].melee * MELEE_RATE * this.dealtMult(g);
        // Удар с разбега — вес, и он у тяжёлой.
        if (kind === 'heavy' && this.phase === 'clash' && !flank && g.row === 'front') p *= CLASH_CAVALRY_IMPACT;
        this.distribute(g, kind, p, to, { flank, fromOpen, ranged: false, frontal: !flank && toRow !== 'rear' }, g.lane, hits);
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
    const late = this.tick > RANGED_SHOCK_TICKS;
    for (const h of hits) {
      const actual = Math.min(h.target.stack[h.kind], h.casualties);
      if (actual <= 0) continue;
      h.target.stack[h.kind] -= actual;
      const victim = this.sides[h.target.side];
      victim.lostTotal += actual;
      victim.lostTick += actual;
      h.target.lostTick += actual * (h.ranged && late ? RANGED_SHOCK_LATE : 1);
      if (h.flank) h.target.flankedTick = this.tick;
      const by = this.sides[h.by];
      by.kills[h.byLane][h.byKind][h.kind] += actual;
      if (h.ranged) by.rangedTotal += actual;
      if (h.ranged && !this.contact) {
        by.volley += actual;
        if (this.round === 0) by.rangedBeforeContact += actual;
      }
    }
  }

  /** Смятый фронт откатывается в тыл. */
  collapse(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      for (const g of s.groups) {
        if (g.row !== 'front' || g.lane === null) continue;
        const total = stackTotal(g.stack);
        const at = anchored(g.stack) ? ANCHOR.collapseAt : ANCHOR.noInfantryCollapseAt;
        if (total >= at * g.initial) continue;
        g.row = 'rear';
        g.routed = true;
        const sector = laneSector(g.lane, 'front');
        if (s.fired.has(`collapsed:${sector}`)) continue;
        s.fired.add(`collapsed:${sector}`);
        this.emit({ id: 'sector-collapsed', side, sector });
      }
    }
  }

  /** Полоса очищена — фронт и обходящие переходят на соседнюю. */
  relocate(): void {
    if (!this.contact) return;
    for (const side of SIDES) {
      for (const g of this.sides[side].groups) {
        if (!alive(g) || g.lane === null || (g.row !== 'front' && g.row !== 'strike')) continue;
        if (this.enemyOnLane(side, g.lane)) continue;
        const next = this.adjacentLane(side, g.lane);
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
    const flanked = g.flankedTick === this.tick;
    const inLine = g.row === 'front' || g.row === 'rear';
    const closed = closedSpears(g);
    let m = 0;
    for (const k of UNIT_KINDS) {
      const n = g.stack[k];
      if (n < EPS) continue;
      let t = 1;
      if (k === 'spear') t = flanked ? TEMPER.spear.flanked : closed ? TEMPER.spear.holding : TEMPER.spear.advancing;
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
   * Соседи по строю: смежные полосы в том же ряду и другой ряд той же полосы. У бежавшего — по месту, где он стоял,
   * когда побежал (`fledFrom`): его в строю нет, а паника от него у соседей остаётся.
   */
  neighbours(g: Group): Group[] {
    const at = g.fled ? g.fledFrom : g.lane === null ? null : { lane: g.lane, row: g.row };
    if (at === null || (at.row !== 'front' && at.row !== 'rear')) return [];
    return this.sides[g.side].groups.filter(
      (n) =>
        n !== g &&
        alive(n) &&
        !n.fled &&
        n.lane !== null &&
        (n.row === 'front' || n.row === 'rear') &&
        ((n.row === at.row && Math.abs(n.lane - at.lane) === 1) || (n.row !== at.row && n.lane === at.lane)),
    );
  }

  /** Сектор сломался: бегут с поля, место открыто резерву, паника идёт по соседям. */
  breakGroup(g: Group): void {
    const s = this.sides[g.side];
    // В журнале — сектор расстановки, а не позиция: смятый фронт, откатившийся в тыл, для игрока всё ещё «правый фланг».
    const sector = g.origin;
    const neighbours = this.neighbours(g);
    g.fledFrom = g.lane === null ? null : { lane: g.lane, row: g.row };
    g.fled = true;
    g.morale = 0;
    g.lane = null;
    this.once(`broken:${sector}`, s, { id: 'sector-broken', side: g.side, sector });
    for (const n of neighbours) {
      const before = n.morale;
      n.morale -= MORALE.panic * (anchored(n.stack) ? MORALE.anchorPanic : 1) * this.moraleFactor(n);
      const to = n.origin;
      if (before - n.morale >= 1 && to !== sector) this.once(`panic:${sector}:${to}`, s, { id: 'panic-spread', side: g.side, from: sector, to });
    }
  }

  /**
   * Мораль по секторам: потери сектора, удар с фланга, сломанный сосед. Сектор с нулевой моралью бежит с поля.
   * Сторона сломана, когда в строю никого нет и встать некому — резерв исчерпан (мораль EU4, docs/battle_eu4.md,
   * 14.15), — или перебита.
   */
  updateMorale(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      // Противник сломался — своим больше нечего бояться: мораль не падает.
      const enemyBroken = this.sides[other(side)].broken && !s.broken;
      const fledNeighbour = new Set<Group>();
      for (const g of s.groups) {
        if (!g.fled || !alive(g)) continue;
        for (const n of this.neighbours(g)) fledNeighbour.add(n);
      }
      const toBreak: Group[] = [];
      for (const g of s.groups) {
        if (!alive(g) || g.fled || enemyBroken) continue;
        let drain = (g.lostTick / Math.max(1, g.initial)) * MORALE.perLoss;
        if (g.flankedTick === this.tick) drain += MORALE.flankDrain;
        if (fledNeighbour.has(g)) drain += MORALE.panicDrain * (anchored(g.stack) ? MORALE.anchorPanic : 1);
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
      } else if (!s.broken && (nobody || s.lostTotal / s.initialTotal > MORALE.autoBreakLoss)) {
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
          kills += g.stack[k] * RETREAT.pursuitKills[k] * moraleDamageMult(s.morale);
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
    return {
      initial,
      final,
      losses,
      total: { initial: stackTotal(initial), final: stackTotal(final), losses: stackTotal(losses) },
      sectors,
      morale: Math.round(Math.max(0, Math.min(MORALE.max, s.morale))),
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
