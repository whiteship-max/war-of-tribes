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
  ARCHER_ORDERS,
  CAVALRY_ORDERS,
  CLASH_CAVALRY_IMPACT,
  COVER,
  CLASH_SPEAR_BRACE,
  COUNTER,
  ENVELOP,
  EVENT_MIN,
  EVENT_SHARE,
  FOOT_FLANK,
  GEAR,
  INFANTRY_ORDERS,
  JITTER,
  KITING,
  MELEE_RATE,
  MORALE,
  PHASE_MIN,
  PHASE_TICKS,
  PLANS,
  PYRRHIC_BELOW,
  RANGED_RATE,
  RANGED_SHOCK_LATE,
  RANGED_SHOCK_TICKS,
  RANGED_TICKS,
  RESERVE_LOSING,
  RETREAT,
  SLOW_CONTACT,
  SPEAR_ORDERS,
  SUPPORT_FLANK,
  TARGET_PRIORITY,
  TEMPER,
  UNIT_STATS,
  WITHDRAW_RATIO,
  moraleDamageMult,
} from './config';
import { seededRng, type Rng } from './rng';
import { emptyStack, stackTotal, validateSetup } from './setup';
import {
  FRONT,
  HORSE_KINDS,
  PHASES,
  REAR,
  SECTORS,
  SIDES,
  UNIT_KINDS,
  type ArmySetup,
  type BattleEvent,
  type BattleInput,
  type BattleResult,
  type CavalryOrder,
  type EventBody,
  type Lane,
  type PhaseId,
  type PhaseSpan,
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
 * Где группа стоит. Фронт и тыл — позиции своей полосы; `waiting` — конница,
 * ждущая своего манёвра; `strike` — ушла в обход и бьёт полосу противника;
 * `reserve` — ещё не введена; `pursue` — бережёт себя до преследования.
 */
type Row = 'front' | 'rear' | 'reserve' | 'waiting' | 'strike' | 'pursue';

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
  maneuver: CavalryOrder | null;
  /** Мораль сектора, 0..`MORALE.max`. Своя у каждой группы: сектор ломается сам, а не вся армия. */
  morale: number;
  /** Мораль упала до нуля: бегут, не держат линию, почти не отбиваются. */
  fled: boolean;
  /** Последний тик, когда группу били с фланга или тыла. */
  flankedTick: number;
  /** Потери группы за тик, взвешенные для морали. */
  lostTick: number;
  /** Вышли из-за тонкой линии: из какой ждущей группы (`Battle.expose`). */
  leftFrom?: Group;
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
  rangedBeforeContact: number;
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
  /** Позиция `b` сомкнута со всех сторон (тыловое каре). */
  bClosedAround: boolean;
  bRow: Row;
  aRow: Row;
}

const EPS = 0.5;
const alive = (g: Group): boolean => stackTotal(g.stack) >= EPS;
const laneOf = (s: Sector): Lane | null => (s === 'R' ? null : ((FRONT.indexOf(s as never) + REAR.indexOf(s as never) + 1) as Lane));
const rowOf = (s: Sector): Row => (s === 'R' ? 'reserve' : FRONT.includes(s as never) ? 'front' : 'rear');
const laneSector = (lane: Lane, row: 'front' | 'rear'): Sector => (row === 'front' ? FRONT[lane] : REAR[lane]);
const facing = (lane: Lane): Lane => (2 - lane) as Lane;
const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');
const phaseIndex = (p: PhaseId): number => PHASES.indexOf(p);
const zeroKills = (): Kills =>
  Object.fromEntries(UNIT_KINDS.map((k) => [k, Object.fromEntries(UNIT_KINDS.map((t) => [t, 0]))])) as Kills;
const cloneKills = (k: Kills[]): Kills[] => k.map((l) => JSON.parse(JSON.stringify(l)) as Kills);

/**
 * Сила отряда: рукопашная на стойкость по родам. Ею бой меряет полосу — кто проигрывает, кого
 * прикрывает линия. Открыта наружу ради стенда заслона (`bench.screenThinner`): «заслон тоньше
 * ждущих» там считается этой же функцией, а не своей копией формулы.
 */
export function stackPower(stack: Stack): number {
  let p = 0;
  for (const k of UNIT_KINDS) p += stack[k] * UNIT_STATS[k].melee * UNIT_STATS[k].toughness;
  return p;
}

/** Сила позиции: чем оценивают, кто проигрывает полосу. */
const power = (groups: Group[]): number => groups.reduce((p, g) => p + stackPower(g.stack), 0);

const sum = (groups: Group[], kind: UnitKind): number => groups.reduce((n, g) => n + g.stack[kind], 0);

/**
 * Приказ конному роду. Дверь одна на оба: у тяжёлой поле приказа необязательное, и
 * расстановка, записанная до второго конного рода, ведёт её приказом лёгкой.
 */
const horseOrder = (setup: ArmySetup, kind: UnitKind): CavalryOrder =>
  kind === 'heavy' ? setup.orders.heavy ?? setup.orders.cavalry : setup.orders.cavalry;

/** «Атаковать сразу» при плане «кавалерийский удар» — это и есть обход. */
function cavalryOrder(setup: ArmySetup, kind: UnitKind = 'cavalry'): CavalryOrder {
  const o = horseOrder(setup, kind);
  return setup.plan === 'cavalry-strike' && o === 'charge' ? 'flank' : o;
}

/** Ждёт ли конный род своего манёвра, а не идёт в строй сразу. */
const waits = (o: CavalryOrder): boolean => o === 'flank' || o === 'attack-archers' || o === 'reserve' || o === 'pursue';

/** Сколько в позиции конницы обоих родов. */
const horses = (groups: Group[]): number => HORSE_KINDS.reduce((n, k) => n + sum(groups, k), 0);

const spearsClosed = (setup: ArmySetup): boolean => SPEAR_ORDERS[setup.orders.spear].closed;

/** Сектор с пехотой заякорен: держит мораль и линию. */
const anchored = (stack: Stack): boolean => stack.infantry >= ANCHOR.infantryShare * Math.max(stackTotal(stack), EPS);

/**
 * Стартовая мораль группы: базовая мораль её родов, взвешенная числом людей,
 * плюс ступени снаряжения из кузницы, сдвиг плана и стойкость, с которой армия
 * вышла в поле (`setup.resolve` — ноль, если ничего такого не было).
 *
 * Открыта наружу ради одного читателя — карточки полководца: сколько натиска
 * съест потолок морали, она меряет этой самой функцией, а не своей копией
 * формулы. Ядро от этого чистым быть не перестаёт: функция по-прежнему ничего
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
  return Math.max(0, Math.min(MORALE.max, m / total + PLANS[setup.plan].morale + resolve));
}

function newGroup(side: Side, setup: ArmySetup, origin: Sector, stack: Stack, lane: Lane | null, row: Row, opts: { prefer?: 'rear' | 'front'; maneuver?: CavalryOrder | null; morale?: number } = {}): Group {
  return {
    side,
    origin,
    stack: { ...stack },
    initial: stackTotal(stack),
    lane,
    row,
    prefer: opts.prefer ?? 'rear',
    routed: false,
    maneuver: opts.maneuver ?? null,
    morale: opts.morale ?? startMorale(setup, stack),
    fled: false,
    flankedTick: -1,
    lostTick: 0,
  };
}

function buildGroups(side: Side, setup: ArmySetup): Group[] {
  const groups: Group[] = [];
  const push = (origin: Sector, stack: Stack, lane: Lane | null, row: Row, maneuver: CavalryOrder | null = null): void => {
    if (stackTotal(stack) <= 0) return;
    groups.push(newGroup(side, setup, origin, stack, lane, row, { maneuver }));
  };
  for (const sector of SECTORS) {
    const rest = { ...setup.sectors[sector] };
    const lane = laneOf(sector);
    const row = rowOf(sector);
    // Конные рода разбираются по одному: приказ у каждого свой, и ждущая половина уходит
    // в свою группу — иначе лёгкая с обходом утащила бы за собой тяжёлую с «атаковать сразу».
    for (const kind of HORSE_KINDS) {
      const cav = cavalryOrder(setup, kind);
      if (rest[kind] <= 0 || !waits(cav)) continue;
      const cavRow: Row = cav === 'pursue' ? 'pursue' : cav === 'reserve' || row === 'reserve' ? 'reserve' : 'waiting';
      push(sector, { ...emptyStack(), [kind]: rest[kind] }, cavRow === 'reserve' ? null : lane, cavRow, cav);
      rest[kind] = 0;
    }
    if (rest.spear > 0 && setup.orders.spear === 'guard-archers' && row === 'front') {
      push(sector, { ...emptyStack(), spear: rest.spear }, lane, 'rear');
      rest.spear = 0;
    }
    // Манёвр группы — приказ того конного рода, что в ней остался: ждущие рода ушли своими
    // группами выше, и приказ лёгкой, которой здесь нет, увёл бы латных бить лучников.
    const mounted = HORSE_KINDS.find((k) => rest[k] > 0);
    push(sector, rest, lane, row, row === 'reserve' && mounted ? cavalryOrder(setup, mounted) : null);
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
  winner: Winner | null = null;
  reason: ResultReason = 'draw';

  constructor(readonly input: BattleInput) {
    this.rng = seededRng(input.seed);
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

  jitter(): number {
    return 1 + (this.rng() * 2 - 1) * JITTER;
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

  /** Отношение сил на полосе: своё против вражеского фронта. */
  /** Отношение сил на полосе: свой фронт против того, с кем придётся драться, — вражеского фронта, а без него тыла. */
  ratio(side: Side, lane: Lane): number {
    const own = power(this.at(side, lane, 'front'));
    const front = power(this.enemyFront(side, lane));
    // Обходящие противника в этой полосе — тоже сила, с которой придётся считаться.
    const strikers = power(this.at(other(side), facing(lane), 'strike'));
    const enemy = (front > 0 ? front : power(this.enemyRear(side, lane))) + strikers;
    if (enemy <= 0) return Infinity;
    return own / enemy;
  }

  weakestLane(side: Side): Lane {
    let best: Lane = 1;
    let bestRatio = Infinity;
    for (const lane of [1, 0, 2] as Lane[]) {
      const r = this.ratio(side, lane);
      if (r < bestRatio) {
        bestRatio = r;
        best = lane;
      }
    }
    return best;
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

  /** Куда идёт конница в обход: где в тылу лучники без сомкнутых копий. */
  pickStrikeLane(side: Side, maneuver: CavalryOrder | null, home: Lane | null): Lane | null {
    const enemy = this.sides[other(side)];
    const closed = spearsClosed(enemy.setup);
    let best: Lane | null = null;
    let bestScore = -Infinity;
    const order: Lane[] = home === null ? [0, 2, 1] : [home, home === 1 ? 0 : 1, home === 1 ? 2 : facing(home)];
    for (const lane of order) {
      const rear = this.enemyRear(side, lane);
      const front = this.enemyFront(side, lane);
      if (rear.length === 0 && front.length === 0) continue;
      const archers = sum(rear, 'archer') + (maneuver === 'attack-archers' ? sum(front, 'archer') : 0);
      const spears = closed ? sum(rear, 'spear') : 0;
      const others = sum(rear, 'infantry') + horses(rear);
      const score = archers - 3 * spears - 0.3 * others + (lane === home ? 0.01 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = lane;
      }
    }
    return best;
  }

  // ----- Расписание -----

  schedule(): Array<{ phase: PhaseId; ticks: number }> {
    const tempo = PLANS[this.input.attacker.plan].tempo + PLANS[this.input.defender.plan].tempo;
    const ranged = Math.max(RANGED_TICKS.min, Math.min(RANGED_TICKS.max, PHASE_TICKS.ranged + tempo));
    return PHASES.map((phase) => ({ phase, ticks: phase === 'ranged' ? ranged : PHASE_TICKS[phase] }));
  }

  run(): BattleResult {
    const plan = this.schedule();
    let skipToMorale = false;
    for (const { phase, ticks } of plan) {
      if (skipToMorale && phaseIndex(phase) < phaseIndex('morale')) continue;
      this.phase = phase;
      const from = this.tick + 1;
      const lostBefore = { attacker: this.sides.attacker.lostTotal, defender: this.sides.defender.lostTotal };
      const menBefore = this.sectorMen();
      this.tick += 1;
      this.onPhaseStart();
      this.step();
      let done = 1;
      while (done < ticks) {
        const min = PHASE_MIN[phase] ?? ticks;
        const someoneBroken = this.sides.attacker.broken || this.sides.defender.broken;
        if (someoneBroken && phaseIndex(phase) >= phaseIndex('lines') && phaseIndex(phase) <= phaseIndex('morale') && done >= min) {
          // Сторона сломалась — обходы и ввод резерва пропускаются, фаза морали
          // обрывается: ждать больше нечего, а каждый лишний тик рубит бегущих.
          // Резерв, который ещё ждал, входит прикрыть отход, а не остаётся дома.
          for (const side of SIDES) this.commitReserve(side, true);
          skipToMorale = true;
          break;
        }
        this.tick += 1;
        this.step();
        done += 1;
      }
      this.onPhaseEnd();
      this.phases.push({
        phase,
        from,
        to: this.tick,
        losses: {
          attacker: Math.round((this.sides.attacker.lostTotal - lostBefore.attacker) * 10) / 10,
          defender: Math.round((this.sides.defender.lostTotal - lostBefore.defender) * 10) / 10,
        },
        bySector: this.lossBySector(menBefore),
      });
    }
    return this.finish();
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
    for (const side of SIDES) this.sides[side].killsAtPhase = cloneKills(this.sides[side].kills);
    switch (this.phase) {
      case 'clash':
        this.contact = true;
        this.clashTick = this.tick;
        for (const side of SIDES) {
          const s = this.sides[side];
          const losses = Math.round(s.rangedBeforeContact);
          if (losses >= 1) this.emit({ id: 'volley', side, losses });
          this.launchStrikes(side, 'attack-archers');
        }
        this.rangedVerdict();
        break;
      case 'lines':
        for (const side of SIDES) this.supportWeakFlank(side);
        break;
      case 'flanking':
        for (const side of SIDES) {
          this.launchStrikes(side, 'flank');
          this.envelop(side);
        }
        break;
      case 'reserve':
        for (const side of SIDES) this.commitReserve(side, true);
        break;
      case 'retreat':
        this.decide();
        break;
      default:
        break;
    }
  }

  onPhaseEnd(): void {
    if (this.phase === 'clash' || this.phase === 'flanking' || this.phase === 'reserve' || this.phase === 'lines') {
      for (const side of SIDES) this.explainKills(side);
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
      if (spearsClosed(s.setup) && spearVsCav >= notable && spearVsCav >= cavVsSpear) {
        const inFront = sum(this.at(side, lane, 'front'), 'spear') > 0;
        const sector = laneSector(lane, inFront ? 'front' : 'rear');
        this.once(`spears-held:${sector}:${this.phase}`, s, {
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
        this.once(`cav-archers:${target}:${this.phase}`, s, {
          id: 'cavalry-broke-archers',
          side,
          target,
          archersLost: Math.round(cavVsArcher),
        });
      }
    }
  }

  /**
   * Итог стрелковой фазы: сторона, потерявшая до контакта заметно больше
   * противника, идёт в рукопашную с просевшей моралью по всем позициям.
   */
  rangedVerdict(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      const enemy = this.sides[other(side)];
      const losses = enemy.rangedBeforeContact;
      const enemyLosses = s.rangedBeforeContact;
      if (losses < EVENT_MIN || losses < enemyLosses * MORALE.rangedLostRatio) continue;
      this.emit({ id: 'ranged-lost', side, losses: Math.round(losses), enemyLosses: Math.round(enemyLosses) });
      for (const g of s.groups) {
        if (!alive(g) || (g.row !== 'front' && g.row !== 'rear')) continue;
        this.shake(g, MORALE.rangedLost);
      }
    }
  }

  /** Разовый удар по морали группы с учётом плана, якоря и характера. */
  shake(g: Group, amount: number): void {
    if (g.fled) return;
    g.morale -= amount * this.moraleFactor(g);
  }

  // ----- Манёвры -----

  /** Ждущая конница с этим приказом уходит в обход. */
  launchStrikes(side: Side, maneuver: CavalryOrder): void {
    for (const g of this.sides[side].groups) {
      if (g.row !== 'waiting' || g.maneuver !== maneuver || !alive(g)) continue;
      const lane = this.pickStrikeLane(side, maneuver, g.lane);
      if (lane === null) continue;
      g.lane = lane;
      g.row = 'strike';
      g.prefer = 'rear';
    }
  }

  /** Охват: сильный фланг заворачивает часть людей к центру противника. */
  envelop(side: Side): void {
    const s = this.sides[side];
    if (s.setup.plan !== 'envelop') return;
    if (this.enemyFront(side, 1).length === 0) return;
    for (const lane of [0, 2] as Lane[]) {
      const own = this.at(side, lane, 'front');
      const enemy = power(this.enemyFront(side, lane));
      if (own.length === 0 || power(own) < enemy * ENVELOP.advantage) continue;
      for (const g of own) this.detach(g, ENVELOP.share, 1, 'strike', 'front');
    }
  }

  /** Пехота из центра — на слабый фланг, один раз за бой. */
  supportWeakFlank(side: Side): void {
    const s = this.sides[side];
    if (s.setup.orders.infantry !== 'support-weak-flank' || s.fired.has('shift')) return;
    let weak: Lane | null = null;
    let weakRatio = SUPPORT_FLANK.weakBelow;
    for (const lane of [0, 2] as Lane[]) {
      const r = this.ratio(side, lane);
      if (r < weakRatio) {
        weakRatio = r;
        weak = lane;
      }
    }
    if (weak === null) return;
    const center = this.at(side, 1, 'front').filter((g) => g.stack.infantry >= SUPPORT_FLANK.minCenter && !g.fled);
    let men = 0;
    for (const g of center) {
      const n = g.stack.infantry * SUPPORT_FLANK.share;
      const moved: Stack = { ...emptyStack(), infantry: n };
      g.stack.infantry -= n;
      g.initial -= n;
      s.groups.push(newGroup(side, s.setup, g.origin, moved, weak, 'front', { prefer: 'front', morale: g.morale }));
      men += n;
    }
    if (men >= 1) {
      s.fired.add('shift');
      this.emit({ id: 'infantry-shifted', side, to: laneSector(weak, 'front'), men: Math.round(men) });
    }
  }

  /** Отделить долю группы в новую на другой полосе. Начальная численность делится тоже: сумма по группам равна армии. */
  detach(g: Group, share: number, lane: Lane, row: Row, prefer: 'rear' | 'front'): void {
    if (g.fled) return;
    const moved = emptyStack();
    for (const k of UNIT_KINDS) {
      moved[k] = g.stack[k] * share;
      g.stack[k] -= moved[k];
    }
    const total = stackTotal(moved);
    if (total < EPS) return;
    g.initial -= total;
    this.sides[g.side].groups.push(newGroup(g.side, this.sides[g.side].setup, g.origin, moved, lane, row, { prefer, morale: g.morale }));
  }

  /** Условие ввода резерва; `force` — фаза «ввод резерва», входят все, кто ещё ждёт. */
  commitReserve(side: Side, force: boolean): void {
    const s = this.sides[side];
    const waiting = s.groups.filter((g) => g.row === 'reserve' && alive(g));
    if (waiting.length === 0) return;
    const trig = s.setup.reserve;
    let lane: Lane | null = null;
    if (force) lane = this.weakestLane(side);
    else
      switch (trig.kind) {
        case 'immediate':
          lane = 1;
          break;
        case 'center-losing':
          if (this.ratio(side, 1) < RESERVE_LOSING) lane = 1;
          break;
        case 'weak-flank': {
          const l = this.ratio(side, 0);
          const r = this.ratio(side, 2);
          if (Math.min(l, r) < RESERVE_LOSING) lane = l <= r ? 0 : 2;
          break;
        }
        case 'weakest': {
          const l = this.weakestLane(side);
          if (this.ratio(side, l) < RESERVE_LOSING) lane = l;
          break;
        }
        case 'morale':
          if (s.morale < MORALE.reserveTriggerAt) lane = this.weakestLane(side);
          break;
        case 'after-phase':
          if (phaseIndex(this.phase) > phaseIndex(trig.phase)) lane = this.weakestLane(side);
          break;
      }
    if (lane === null) return;
    let men = 0;
    for (const g of waiting) {
      if (g.maneuver === 'flank' || g.maneuver === 'attack-archers') {
        const target = this.pickStrikeLane(side, g.maneuver, lane);
        if (target === null) continue;
        g.lane = target;
        g.row = 'strike';
      } else {
        g.lane = lane;
        g.row = 'front';
      }
      men += stackTotal(g.stack);
    }
    if (men < 1) return;
    this.emit({ id: 'reserve-committed', side, sector: laneSector(lane, 'front'), men: Math.round(men) });
    // Свежие люди рядом держат тех, кто уже там стоит.
    for (const g of s.groups) {
      if (g.lane !== lane || (g.row !== 'front' && g.row !== 'rear') || g.origin === 'R' || !alive(g) || g.fled) continue;
      g.morale = Math.min(MORALE.max, g.morale + MORALE.reserveBoost);
    }
  }

  // ----- Тик -----

  step(): void {
    for (const side of SIDES) {
      this.sides[side].lostTick = 0;
      for (const g of this.sides[side].groups) g.lostTick = 0;
    }
    this.engagedNow = new Set();
    for (const side of SIDES) this.expose(side);
    if (this.phase === 'pursuit') {
      this.pursue();
    } else {
      if (this.contact && phaseIndex(this.phase) <= phaseIndex('reserve')) {
        for (const side of SIDES) this.commitReserve(side, false);
      }
      const hits: Hit[] = [];
      const contacts = this.contact && this.winner !== 'draw' ? this.buildContacts() : [];
      const engaged = new Map<Group, Group[]>();
      for (const c of contacts) {
        for (const g of c.a) engaged.set(g, [...(engaged.get(g) ?? []), ...c.b]);
        for (const g of c.b) engaged.set(g, [...(engaged.get(g) ?? []), ...c.a]);
      }
      const kiting = new Set<Group>();
      for (const g of engaged.keys()) this.engagedNow.add(g);
      for (const side of SIDES) {
        for (const g of this.sides[side].groups) {
          if (!alive(g) || g.stack.archer < EPS || this.sides[side].setup.orders.archer !== 'keep-distance') continue;
          const foes = engaged.get(g);
          if (!foes || foes.length === 0) continue;
          const slow = foes.every((f) => UNIT_KINDS.every((k) => f.stack[k] < EPS || UNIT_STATS[k].speed < UNIT_STATS.archer.speed));
          if (!slow) continue;
          kiting.add(g);
          this.engagedNow.delete(g);
          if (g.lane !== null) {
            const sector = laneSector(g.lane, g.row === 'front' ? 'front' : 'rear');
            this.once(`kiting:${sector}`, this.sides[side], { id: 'archers-kiting', side, sector });
          }
        }
      }
      for (const side of SIDES) {
        for (const g of this.sides[side].groups) {
          if (!alive(g) || g.stack.archer < EPS || g.lane === null) continue;
          if (g.row !== 'front' && g.row !== 'rear') continue;
          const isEngaged = engaged.has(g);
          if (isEngaged && !kiting.has(g)) continue;
          this.shoot(g, kiting.has(g), engaged, hits);
        }
      }
      // Сколько противника у каждой группы во всех её стычках разом: боец бьёт один раз за тик,
      // и группа, стоящая в нескольких стычках, делит свой удар между ними, а не бьёт в каждой целиком.
      const facingMen = new Map<Group, number>();
      for (const [g, foes] of engaged) facingMen.set(g, foes.reduce((n, f) => n + stackTotal(f.stack), 0));
      for (const c of contacts) {
        this.melee(c.a, c.b, c.aFlank, c.bClosedAround, c.bRow, false, kiting, facingMen, hits);
        // Ответ: позиция, сомкнутая со всех сторон, не считается обойдённой — копья там держат строй.
        this.melee(c.b, c.a, false, false, c.aRow, c.aFlank && !c.bClosedAround, kiting, facingMen, hits);
      }
      this.apply(hits);
      this.collapse();
      this.relocate();
    }
    this.updateMorale();
  }

  /**
   * Ждать манёвра можно только за своей линией, и прикрывает линия по своей силе, а не по
   * тому, что она есть. Конница, ждущая обхода, удара по лучникам или преследования, стоит
   * на своей полосе вне досягаемости: по ней не стреляют и с ней не сходятся — её прикрывает
   * строй впереди (фронт или тыл полосы, не смятый и не бегущий). Прикрыть он может не больше
   * `линия / COVER.K` силы ждущих (сила — `power`, та же мерка, какой бой меряет полосу);
   * остальные сами становятся линией: выходят во фронт и дерутся в лоб. Линии нет вовсе —
   * выходят все (docs/stable.md, раздел 3). Прежде линией считался любой строй на полосе, и
   * сотня латных прикрывала пятьсот лёгких (docs/stable.md, раздел 12).
   *
   * Правило читается каждый тик: линия поредела — из-за неё выходят ещё. Вышедшие на полосе
   * сами стоят в линии и прикрывают оставшихся, поэтому за один раз выходит ровно доля
   * 1 − линия / (K × ждущие), и вышедшие из одной группы копятся в одной группе фронта.
   */
  expose(side: Side): void {
    const groups = this.sides[side].groups;
    for (const lane of [0, 1, 2] as Lane[]) {
      const hidden = groups.filter((g) => (g.row === 'waiting' || g.row === 'pursue') && g.lane === lane && alive(g));
      if (hidden.length === 0) continue;
      const line = power(groups.filter((h) => h.lane === lane && (h.row === 'front' || h.row === 'rear') && alive(h) && !h.fled && !h.routed));
      const share = 1 - line / (COVER.K * power(hidden));
      if (share <= 0) continue;
      for (const g of hidden) {
        if (share >= 1) {
          g.row = 'front';
          continue;
        }
        const moved = emptyStack();
        for (const k of UNIT_KINDS) {
          moved[k] = g.stack[k] * share;
          g.stack[k] -= moved[k];
        }
        const men = stackTotal(moved);
        g.initial -= men;
        const out = groups.find((h) => h.leftFrom === g && h.lane === lane && h.row === 'front' && !h.fled);
        if (out) {
          for (const k of UNIT_KINDS) out.stack[k] += moved[k];
          out.initial += men;
        } else {
          const ng = newGroup(side, this.sides[side].setup, g.origin, moved, lane, 'front', { morale: g.morale });
          ng.leftFrom = g;
          groups.push(ng);
        }
      }
    }
  }

  /** Пары позиций, которые сейчас дерутся. */
  buildContacts(): Contact[] {
    const contacts: Contact[] = [];
    const pair = (a: Group[], b: Group[], aFlank: boolean, aRow: Row, bRow: Row): void => {
      if (a.length === 0 || b.length === 0) return;
      contacts.push({ a, b, aFlank, bClosedAround: bRow === 'rear', aRow, bRow });
    };
    // Обходы считаются первыми: кто перехватывает обходящих, в этот тик не стоит во фронте.
    const intercepting = new Set<Group>();
    for (const side of SIDES) {
      for (const g of this.sides[side].groups) {
        if (g.row !== 'strike' || !alive(g) || g.lane === null) continue;
        const enemy = other(side);
        const eLane = facing(g.lane);
        // Резерв с приказом «держать фланг» ждёт именно этого: выходит на полосу обхода навстречу.
        if (HORSE_KINDS.some((k) => horseOrder(this.sides[enemy].setup, k) === 'hold-flank')) {
          let men = 0;
          for (const h of this.sides[enemy].groups) {
            if (h.row !== 'reserve' || !alive(h)) continue;
            if (!HORSE_KINDS.some((k) => h.stack[k] >= EPS && horseOrder(this.sides[enemy].setup, k) === 'hold-flank')) continue;
            h.lane = eLane;
            h.row = 'front';
            men += stackTotal(h.stack);
          }
          if (men >= 1) this.emit({ id: 'reserve-committed', side: enemy, sector: laneSector(eLane, 'front'), men: Math.round(men) });
        }
        // Перехват: конница с приказом «держать фланг» или резерв, вошедший в эту полосу, —
        // единственные, кто разворачивается навстречу обходу. Остальные заняты фронтом.
        const holders = [...this.at(enemy, eLane, 'front'), ...this.at(enemy, eLane, 'rear')].filter(
          (h) =>
            HORSE_KINDS.some((k) => h.stack[k] >= EPS && horseOrder(this.sides[enemy].setup, k) === 'hold-flank') ||
            (h.origin === 'R' && h.row === 'front'),
        );
        if (holders.length > 0) {
          for (const h of holders) intercepting.add(h);
          pair([g], holders, false, 'strike', holders[0].row);
          if (horses([g]) >= EPS) {
            this.once(`intercepted:${g.lane}`, this.sides[side], { id: 'cavalry-intercepted', side, target: laneSector(eLane, holders[0].row === 'front' ? 'front' : 'rear') });
          }
          continue;
        }
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
            // Тыловое каре сомкнуто со всех сторон — обход его не пугает.
            if (rows[i] !== 'rear' || !spearsClosed(this.sides[enemy].setup)) for (const t of order[i]) this.shake(t, MORALE.flankTurned);
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
    const free = (groups: Group[]): Group[] => groups.filter((g) => !intercepting.has(g));
    for (const lane of [0, 1, 2] as Lane[]) {
      const aF = free(this.at('attacker', lane, 'front'));
      const dF = free(this.at('defender', facing(lane), 'front'));
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
  taken(g: Group, kind: UnitKind, frontal: boolean, kiting: boolean): number {
    const s = this.sides[g.side];
    const plan = PLANS[s.setup.plan];
    let m = plan.taken;
    if (kind === 'spear') m *= SPEAR_ORDERS[s.setup.orders.spear].taken;
    else if (kind === 'infantry') m *= INFANTRY_ORDERS[s.setup.orders.infantry].taken;
    else if (kind === 'archer') m *= ARCHER_ORDERS[s.setup.orders.archer].taken;
    else m *= CAVALRY_ORDERS[horseOrder(s.setup, kind)].taken;
    if (g.row === 'front' && !anchored(g.stack)) m *= ANCHOR.noInfantryDamageTaken;
    if (s.retreating) m *= RETREAT.taken;
    else if (s.broken) m *= MORALE.brokenTaken;
    if (g.fled) m *= MORALE.fledTaken;
    if (kiting) m *= KITING.damageTaken;
    if (this.phase === 'clash' && kind === 'spear' && frontal && spearsClosed(s.setup) && !g.routed && !g.fled) m *= CLASH_SPEAR_BRACE;
    return m;
  }

  /**
   * Множитель кольца: `kind` бьёт `target`. `targetBroken` — цель смята или бежит:
   * такие копья строя не держат, с какой стороны их ни бей.
   */
  counter(attacker: SideState, kind: UnitKind, target: UnitKind, targetSide: SideState, flank: boolean, closedAround: boolean, flanked: boolean, ranged: boolean, targetBroken: boolean): number {
    if (ranged) {
      if (target === 'spear') return COUNTER.archer.spear;
      if (target === 'infantry') return COUNTER.archer.infantry;
      if (target === 'cavalry') return COUNTER.archer.cavalry;
      if (target === 'heavy') return COUNTER.archer.heavy;
      return 1;
    }
    const spearsHold = spearsClosed(attacker.setup) && !flanked;
    const horse = target === 'cavalry' || target === 'heavy';
    switch (kind) {
      case 'spear':
        if (horse) return spearsHold ? COUNTER.spear.cavalryHolding : COUNTER.spear.cavalryAdvancing;
        return flank ? FOOT_FLANK : 1;
      case 'cavalry':
      case 'heavy': {
        // Своя половина кольца у каждого конного рода: лёгкая режет лучников и заходит во
        // фланг, тяжёлая ломает строй в лоб. Сомкнутые копья держат обеих одинаково.
        const c = COUNTER[kind];
        if (target === 'spear') {
          const closed = spearsClosed(targetSide.setup) && !targetBroken && (!flank || closedAround);
          if (closed) return c.spearClosed;
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

  /** Приоритет цели по приказу. */
  preference(attacker: SideState, kind: UnitKind, target: UnitKind): number {
    const o = attacker.setup.orders;
    const horse = target === 'cavalry' || target === 'heavy';
    if (kind === 'archer' && o.archer === 'priority-infantry' && target === 'infantry') return TARGET_PRIORITY;
    if (kind === 'archer' && o.archer === 'priority-cavalry' && horse) return TARGET_PRIORITY;
    if (kind === 'spear' && o.spear === 'priority-cavalry' && horse) return TARGET_PRIORITY;
    if ((kind === 'cavalry' || kind === 'heavy') && horseOrder(attacker.setup, kind) === 'attack-archers' && target === 'archer') return TARGET_PRIORITY;
    return 1;
  }

  /** Общие множители силы группы: план, полоса, мораль сектора, состояние. */
  dealtMult(g: Group, kind: UnitKind): number {
    const s = this.sides[g.side];
    const plan = PLANS[s.setup.plan];
    let m = plan.dealt * moraleDamageMult(g.morale);
    if (g.fled) m *= MORALE.fledDealt;
    if (g.lane !== null && g.row !== 'strike') m *= g.lane === 1 ? plan.center : plan.flank;
    if (kind === 'spear') m *= SPEAR_ORDERS[s.setup.orders.spear].dealt;
    else if (kind === 'infantry') {
      // «Прорывать центр» работает только в центре.
      const o = s.setup.orders.infantry;
      m *= o === 'break-center' && g.lane !== 1 ? 1 : INFANTRY_ORDERS[o].dealt;
    }
    else if (kind === 'archer') m *= ARCHER_ORDERS[s.setup.orders.archer].dealt;
    else m *= CAVALRY_ORDERS[horseOrder(s.setup, kind)].dealt;
    if (s.broken) m *= MORALE.brokenDealt;
    if (s.retreating) m *= RETREAT.dealt;
    return m;
  }

  /** Раздать урон `total` по группам позиции пропорционально числу и приоритету. */
  distribute(attacker: SideState, kind: UnitKind, total: number, targets: Group[], ctx: { flank: boolean; closedAround: boolean; flanked: boolean; ranged: boolean; frontal: boolean }, kiting: Set<Group>, byLane: Lane, hits: Hit[]): void {
    const targetSide = this.sides[targets[0].side];
    let weight = 0;
    for (const t of targets) for (const k of UNIT_KINDS) weight += t.stack[k] * this.preference(attacker, kind, k);
    if (weight <= 0) return;
    for (const t of targets) {
      for (const k of UNIT_KINDS) {
        const n = t.stack[k];
        if (n < EPS) continue;
        const share = (n * this.preference(attacker, kind, k)) / weight;
        const broken = t.routed || t.fled;
        const dmg = total * share * this.counter(attacker, kind, k, targetSide, ctx.flank, ctx.closedAround && !broken, ctx.flanked, ctx.ranged, broken);
        const casualties = (dmg / UNIT_STATS[k].toughness) * this.taken(t, k, ctx.frontal, kiting.has(t));
        // Тыловое каре сомкнуто со всех сторон: удар в него для морали не фланговый.
        const flankHit = ctx.flank && !(ctx.closedAround && !broken && spearsClosed(targetSide.setup) && t.stack.spear >= EPS);
        if (casualties > 0) hits.push({ target: t, kind: k, casualties, by: attacker.id, byKind: kind, byLane, ranged: ctx.ranged, flank: flankHit });
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
  melee(from: Group[], to: Group[], flank: boolean, closedAround: boolean, toRow: Row, flanked: boolean, kiting: Set<Group>, facingMen: Map<Group, number>, hits: Hit[]): void {
    const here = to.reduce((n, t) => n + stackTotal(t.stack), 0);
    for (const g of from) {
      const s = this.sides[g.side];
      if (g.lane === null) continue;
      const share = here / Math.max(here, facingMen.get(g) ?? here);
      for (const kind of UNIT_KINDS) {
        if (g.stack[kind] < EPS) continue;
        const n = g.stack[kind] * share;
        if (kind === 'archer' && kiting.has(g)) continue;
        let p = n * UNIT_STATS[kind].melee * MELEE_RATE * this.dealtMult(g, kind) * this.jitter();
        // Удар с разбега — вес, и он у тяжёлой. Обход усиливается планом у любого конного рода:
        // «кавалерийский удар» — про манёвр, а манёвр есть у обоих, пока им его приказали.
        if (kind === 'heavy' && this.phase === 'clash' && !flank && g.row === 'front') p *= CLASH_CAVALRY_IMPACT;
        if ((kind === 'cavalry' || kind === 'heavy') && flank) p *= PLANS[s.setup.plan].strike;
        this.distribute(s, kind, p, to, { flank, closedAround, flanked, ranged: false, frontal: !flank && toRow !== 'rear' }, kiting, g.lane, hits);
      }
    }
  }

  shoot(g: Group, kiting: boolean, engaged: Map<Group, Group[]>, hits: Hit[]): void {
    const s = this.sides[g.side];
    if (g.lane === null) return;
    const lane: Lane = s.setup.orders.archer === 'support-center' ? 1 : g.lane;
    const candidates: Group[][] = [this.enemyFront(g.side, lane), this.enemyRear(g.side, lane)];
    for (const l of [1, 0, 2] as Lane[]) if (l !== lane) candidates.push(this.enemyFront(g.side, l), this.enemyRear(g.side, l));
    const targets = candidates.find((c) => c.length > 0);
    if (!targets) return;
    // Пока цель не в рукопашной, стрельба идёт в полную силу; после контакта — через головы.
    let m = 1;
    if (kiting) m = KITING.ranged;
    else if (targets.some((t) => engaged.has(t))) m = COUNTER.archer.afterContact;
    const p = g.stack.archer * UNIT_STATS.archer.ranged * RANGED_RATE * PLANS[s.setup.plan].ranged * this.dealtMult(g, 'archer') * m * this.jitter();
    this.distribute(s, 'archer', p, targets, { flank: false, closedAround: false, flanked: false, ranged: true, frontal: false }, new Set(), g.lane, hits);
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
      if (h.ranged && !this.contact) by.rangedBeforeContact += actual;
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
    const s = this.sides[g.side];
    const total = stackTotal(g.stack);
    if (total < EPS) return 1;
    const flanked = g.flankedTick === this.tick;
    const inLine = g.row === 'front' || g.row === 'rear';
    const closed = spearsClosed(s.setup) && inLine && !g.routed && g.stack.spear >= EPS;
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

  /** Множитель всех потерь морали группы: характер, якорь пехоты, план. */
  moraleFactor(g: Group): number {
    return this.temper(g) * (anchored(g.stack) ? MORALE.anchor : 1) * PLANS[this.sides[g.side].setup.plan].shock;
  }

  /** Соседи по строю: смежные полосы в том же ряду и другой ряд той же полосы. Считаются до того, как сломанный фронт откатится в тыл. */
  neighbours(g: Group): Group[] {
    if (g.lane === null || (g.row !== 'front' && g.row !== 'rear')) return [];
    return this.sides[g.side].groups.filter(
      (n) =>
        n !== g &&
        alive(n) &&
        !n.fled &&
        n.lane !== null &&
        (n.row === 'front' || n.row === 'rear') &&
        ((n.row === g.row && Math.abs(n.lane - g.lane!) === 1) || (n.row !== g.row && n.lane === g.lane)),
    );
  }

  /** Сектор сломался: бегут, линия открыта, паника идёт по соседям. */
  breakGroup(g: Group): void {
    const s = this.sides[g.side];
    g.fled = true;
    g.morale = 0;
    // В журнале — сектор расстановки, а не позиция: смятый фронт, откатившийся в тыл, для игрока всё ещё «правый фланг».
    const sector = g.origin;
    const neighbours = this.neighbours(g);
    if (g.row === 'front') {
      g.row = 'rear';
      g.routed = true;
    }
    this.once(`broken:${sector}`, s, { id: 'sector-broken', side: g.side, sector });
    for (const n of neighbours) {
      const before = n.morale;
      n.morale -= MORALE.panic * (anchored(n.stack) ? MORALE.anchorPanic : 1) * this.moraleFactor(n);
      const to = n.origin;
      if (before - n.morale >= 1 && to !== sector) this.once(`panic:${sector}:${to}`, s, { id: 'panic-spread', side: g.side, from: sector, to });
    }
  }

  /**
   * Мораль по секторам: потери сектора, удар с фланга, сломанный сосед. Сектор
   * с нулевой моралью ломается; армия — когда сломанные и перебитые сектора
   * весят `armyBreakShare` её начальной численности.
   */
  updateMorale(): void {
    const phaseMult = this.phase === 'morale' ? MORALE.phaseMult : 1;
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
        g.morale -= drain * this.moraleFactor(g) * phaseMult;
        g.morale = Math.min(MORALE.max, g.morale);
        if (g.morale <= 0) toBreak.push(g);
      }
      for (const g of toBreak) this.breakGroup(g);

      let alive_ = 0;
      let moraleSum = 0;
      let brokenWeight = 0;
      let frontWeight = 0;
      let frontBroken = 0;
      for (const g of s.groups) {
        const n = stackTotal(g.stack);
        const gone = g.fled || !alive(g);
        if (gone) brokenWeight += g.initial;
        if (rowOf(g.origin) === 'front') {
          frontWeight += g.initial;
          if (gone) frontBroken += g.initial;
        }
        if (!alive(g)) continue;
        alive_ += n;
        moraleSum += n * g.morale;
      }
      s.morale = alive_ > 0 ? moraleSum / alive_ : 0;
      const brokenShare = brokenWeight / Math.max(1, s.initialTotal);
      // Линии больше нет: всё, что стояло во фронте, бежит или перебито, — армия сломана, сколько бы ни осталось в тылу.
      const lineGone = frontWeight > 0 && frontBroken >= frontWeight - EPS;
      const remaining = alive_;
      if (!s.broken && remaining < ANNIHILATED_AT * s.initialTotal) {
        s.broken = true;
        s.brokenAt = this.tick;
        s.brokenReason = 'annihilated';
        this.emit({ id: 'annihilated', side });
      } else if (!s.broken && (brokenShare >= MORALE.armyBreakShare || lineGone || s.lostTotal / s.initialTotal > MORALE.autoBreakLoss)) {
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

  /** Конец фазы морали: кто отходит. */
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
          let rate = RETREAT.pursuitKills[k];
          if ((k === 'cavalry' || k === 'heavy') && horseOrder(s.setup, k) === 'pursue') rate *= RETREAT.pursueOrder;
          kills += g.stack[k] * rate * moraleDamageMult(s.morale);
        }
      }
      kills *= this.jitter();
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
  return new Battle(input).run();
}
