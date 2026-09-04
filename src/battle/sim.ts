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
  CLASH_SPEAR_BRACE,
  COUNTER,
  ENVELOP,
  EVENT_MIN,
  EVENT_SHARE,
  FOOT_FLANK,
  INFANTRY_ORDERS,
  JITTER,
  KITING,
  MELEE_RATE,
  MORALE,
  PHASE_MIN,
  PHASE_TICKS,
  PLANS,
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
  UNIT_STATS,
  WITHDRAW_RATIO,
  moraleDamageMult,
} from './config';
import { seededRng, type Rng } from './rng';
import { emptyStack, stackTotal, validateSetup } from './setup';
import {
  FRONT,
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
}

type Kills = Record<UnitKind, Record<UnitKind, number>>;

interface SideState {
  id: Side;
  setup: ArmySetup;
  groups: Group[];
  initialTotal: number;
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

/** Сила позиции: чем оценивают, кто проигрывает полосу. */
function power(groups: Group[]): number {
  let p = 0;
  for (const g of groups) for (const k of UNIT_KINDS) p += g.stack[k] * UNIT_STATS[k].melee * UNIT_STATS[k].toughness;
  return p;
}

const sum = (groups: Group[], kind: UnitKind): number => groups.reduce((n, g) => n + g.stack[kind], 0);

/** «Атаковать сразу» при плане «кавалерийский удар» — это и есть обход. */
function cavalryOrder(setup: ArmySetup): CavalryOrder {
  return setup.plan === 'cavalry-strike' && setup.orders.cavalry === 'charge' ? 'flank' : setup.orders.cavalry;
}

const spearsClosed = (setup: ArmySetup): boolean => SPEAR_ORDERS[setup.orders.spear].closed;

function buildGroups(side: Side, setup: ArmySetup): Group[] {
  const groups: Group[] = [];
  const cav = cavalryOrder(setup);
  const push = (origin: Sector, stack: Stack, lane: Lane | null, row: Row, maneuver: CavalryOrder | null = null): void => {
    const total = stackTotal(stack);
    if (total <= 0) return;
    groups.push({ side, origin, stack: { ...stack }, initial: total, lane, row, prefer: 'rear', routed: false, maneuver });
  };
  for (const sector of SECTORS) {
    const rest = { ...setup.sectors[sector] };
    const lane = laneOf(sector);
    const row = rowOf(sector);
    if (rest.cavalry > 0 && (cav === 'flank' || cav === 'attack-archers' || cav === 'reserve' || cav === 'pursue')) {
      const cavRow: Row = cav === 'pursue' ? 'pursue' : cav === 'reserve' || row === 'reserve' ? 'reserve' : 'waiting';
      push(sector, { ...emptyStack(), cavalry: rest.cavalry }, cavRow === 'reserve' ? null : lane, cavRow, cav);
      rest.cavalry = 0;
    }
    if (rest.spear > 0 && setup.orders.spear === 'guard-archers' && row === 'front') {
      push(sector, { ...emptyStack(), spear: rest.spear }, lane, 'rear');
      rest.spear = 0;
    }
    push(sector, rest, lane, row, row === 'reserve' && rest.cavalry > 0 ? cav : null);
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
        morale: MORALE.start + PLANS[setup.plan].morale,
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
      const others = sum(rear, 'infantry') + sum(rear, 'cavalry');
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
      this.tick += 1;
      this.onPhaseStart();
      this.step();
      let done = 1;
      while (done < ticks) {
        const min = PHASE_MIN[phase] ?? ticks;
        const someoneBroken = this.sides.attacker.broken || this.sides.defender.broken;
        if (someoneBroken && phaseIndex(phase) >= phaseIndex('lines') && phaseIndex(phase) <= phaseIndex('reserve') && done >= min) {
          // Линия сломана — резерв, который ещё ждал, входит прикрыть отход, а не остаётся дома.
          for (const side of SIDES) this.commitReserve(side, true);
          skipToMorale = true;
          break;
        }
        this.tick += 1;
        this.step();
        done += 1;
      }
      this.onPhaseEnd();
      this.phases.push({ phase, from, to: this.tick });
    }
    return this.finish();
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
      const spearVsCav = d(s.kills, 'spear', 'cavalry') - d(s.killsAtPhase, 'spear', 'cavalry');
      const eLane = facing(lane);
      const cavVsSpear = enemy.kills[eLane].cavalry.spear - enemy.killsAtPhase[eLane].cavalry.spear;
      // Событие только про настоящий удар: мелкий размен на стыке — не «остановили».
      const enemyCavalry = SECTORS.reduce((n, id) => n + enemy.setup.sectors[id].cavalry, 0);
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
      const cavVsArcher = d(s.kills, 'cavalry', 'archer') - d(s.killsAtPhase, 'cavalry', 'archer');
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
    const center = this.at(side, 1, 'front').filter((g) => g.stack.infantry >= SUPPORT_FLANK.minCenter);
    let men = 0;
    for (const g of center) {
      const n = g.stack.infantry * SUPPORT_FLANK.share;
      const moved: Stack = { ...emptyStack(), infantry: n };
      g.stack.infantry -= n;
      s.groups.push({ side, origin: g.origin, stack: moved, initial: n, lane: weak, row: 'front', prefer: 'front', routed: false, maneuver: null });
      men += n;
    }
    if (men >= 1) {
      s.fired.add('shift');
      this.emit({ id: 'infantry-shifted', side, to: laneSector(weak, 'front'), men: Math.round(men) });
    }
  }

  /** Отделить долю группы в новую на другой полосе. */
  detach(g: Group, share: number, lane: Lane, row: Row, prefer: 'rear' | 'front'): void {
    const moved = emptyStack();
    for (const k of UNIT_KINDS) {
      moved[k] = g.stack[k] * share;
      g.stack[k] -= moved[k];
    }
    const total = stackTotal(moved);
    if (total < EPS) return;
    this.sides[g.side].groups.push({ side: g.side, origin: g.origin, stack: moved, initial: total, lane, row, prefer, routed: false, maneuver: null });
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
    if (men >= 1) this.emit({ id: 'reserve-committed', side, sector: laneSector(lane, 'front'), men: Math.round(men) });
  }

  // ----- Тик -----

  step(): void {
    for (const side of SIDES) this.sides[side].lostTick = 0;
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
      for (const side of SIDES) {
        for (const g of this.sides[side].groups) {
          if (!alive(g) || g.stack.archer < EPS || this.sides[side].setup.orders.archer !== 'keep-distance') continue;
          const foes = engaged.get(g);
          if (!foes || foes.length === 0) continue;
          const slow = foes.every((f) => UNIT_KINDS.every((k) => f.stack[k] < EPS || UNIT_STATS[k].speed < UNIT_STATS.archer.speed));
          if (!slow) continue;
          kiting.add(g);
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
      for (const c of contacts) {
        this.melee(c.a, c.b, c.aFlank, c.bClosedAround, c.bRow, false, kiting, hits);
        // Ответ: позиция, сомкнутая со всех сторон, не считается обойдённой — копья там держат строй.
        this.melee(c.b, c.a, false, false, c.aRow, c.aFlank && !c.bClosedAround, kiting, hits);
      }
      this.apply(hits);
      this.collapse();
      this.relocate();
    }
    this.updateMorale();
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
        // Перехват: конница с приказом «держать фланг» или резерв, вошедший в эту полосу, —
        // единственные, кто разворачивается навстречу обходу. Остальные заняты фронтом.
        const holders = [...this.at(enemy, eLane, 'front'), ...this.at(enemy, eLane, 'rear')].filter(
          (h) => (h.stack.cavalry >= EPS && this.sides[enemy].setup.orders.cavalry === 'hold-flank') || (h.origin === 'R' && h.row === 'front'),
        );
        if (holders.length > 0) {
          for (const h of holders) intercepting.add(h);
          pair([g], holders, false, 'strike', holders[0].row);
          if (g.stack.cavalry >= EPS) {
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
          this.once(`flanked:${sector}`, this.sides[enemy], { id: 'flank-turned', side: enemy, sector, by: side });
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
    s.morale -= MORALE.rearReached * PLANS[s.setup.plan].shock;
  }

  /** Множитель урона, который получает группа за один свой боец рода `kind`. */
  taken(g: Group, kind: UnitKind, frontal: boolean, kiting: boolean): number {
    const s = this.sides[g.side];
    const plan = PLANS[s.setup.plan];
    let m = plan.taken;
    if (kind === 'spear') m *= SPEAR_ORDERS[s.setup.orders.spear].taken;
    else if (kind === 'infantry') m *= INFANTRY_ORDERS[s.setup.orders.infantry].taken;
    else if (kind === 'archer') m *= ARCHER_ORDERS[s.setup.orders.archer].taken;
    else m *= CAVALRY_ORDERS[s.setup.orders.cavalry].taken;
    if (g.row === 'front' && g.stack.infantry < ANCHOR.infantryShare * stackTotal(g.stack)) m *= ANCHOR.noInfantryDamageTaken;
    if (s.retreating) m *= RETREAT.taken;
    if (kiting) m *= KITING.damageTaken;
    if (this.phase === 'clash' && kind === 'spear' && frontal && spearsClosed(s.setup)) m *= CLASH_SPEAR_BRACE;
    return m;
  }

  /** Множитель кольца: `kind` бьёт `target`. */
  counter(attacker: SideState, kind: UnitKind, target: UnitKind, targetSide: SideState, flank: boolean, closedAround: boolean, flanked: boolean, ranged: boolean): number {
    if (ranged) {
      if (target === 'spear') return COUNTER.archer.spear;
      if (target === 'infantry') return COUNTER.archer.infantry;
      if (target === 'cavalry') return COUNTER.archer.cavalry;
      return 1;
    }
    const spearsHold = spearsClosed(attacker.setup) && !flanked;
    switch (kind) {
      case 'spear':
        if (target === 'cavalry') return spearsHold ? COUNTER.spear.cavalryHolding : COUNTER.spear.cavalryAdvancing;
        return flank ? FOOT_FLANK : 1;
      case 'cavalry': {
        if (target === 'spear') {
          const closed = spearsClosed(targetSide.setup) && (!flank || closedAround);
          if (closed) return COUNTER.cavalry.spearClosed;
          return flank ? COUNTER.cavalry.flank : 1;
        }
        if (target === 'archer') return Math.max(COUNTER.cavalry.archer, flank ? COUNTER.cavalry.flank : 0);
        if (target === 'infantry') return flank ? COUNTER.cavalry.flank : COUNTER.cavalry.infantry;
        return flank ? COUNTER.cavalry.flank : 1;
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
    if (kind === 'archer' && o.archer === 'priority-infantry' && target === 'infantry') return TARGET_PRIORITY;
    if (kind === 'archer' && o.archer === 'priority-cavalry' && target === 'cavalry') return TARGET_PRIORITY;
    if (kind === 'spear' && o.spear === 'priority-cavalry' && target === 'cavalry') return TARGET_PRIORITY;
    if (kind === 'cavalry' && o.cavalry === 'attack-archers' && target === 'archer') return TARGET_PRIORITY;
    return 1;
  }

  /** Общие множители силы группы: план, полоса, мораль, состояние. */
  dealtMult(g: Group, kind: UnitKind): number {
    const s = this.sides[g.side];
    const plan = PLANS[s.setup.plan];
    let m = plan.dealt * moraleDamageMult(s.morale);
    if (g.lane !== null && g.row !== 'strike') m *= g.lane === 1 ? plan.center : plan.flank;
    if (kind === 'spear') m *= SPEAR_ORDERS[s.setup.orders.spear].dealt;
    else if (kind === 'infantry') {
      // «Прорывать центр» работает только в центре.
      const o = s.setup.orders.infantry;
      m *= o === 'break-center' && g.lane !== 1 ? 1 : INFANTRY_ORDERS[o].dealt;
    }
    else if (kind === 'archer') m *= ARCHER_ORDERS[s.setup.orders.archer].dealt;
    else m *= CAVALRY_ORDERS[s.setup.orders.cavalry].dealt;
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
        const dmg = total * share * this.counter(attacker, kind, k, targetSide, ctx.flank, ctx.closedAround && !t.routed, ctx.flanked, ctx.ranged);
        const casualties = (dmg / UNIT_STATS[k].toughness) * this.taken(t, k, ctx.frontal, kiting.has(t));
        if (casualties > 0) hits.push({ target: t, kind: k, casualties, by: attacker.id, byKind: kind, byLane, ranged: ctx.ranged });
      }
    }
  }

  melee(from: Group[], to: Group[], flank: boolean, closedAround: boolean, toRow: Row, flanked: boolean, kiting: Set<Group>, hits: Hit[]): void {
    for (const g of from) {
      const s = this.sides[g.side];
      if (g.lane === null) continue;
      for (const kind of UNIT_KINDS) {
        const n = g.stack[kind];
        if (n < EPS) continue;
        if (kind === 'archer' && kiting.has(g)) continue;
        let p = n * UNIT_STATS[kind].melee * MELEE_RATE * this.dealtMult(g, kind) * this.jitter();
        if (kind === 'cavalry' && this.phase === 'clash' && !flank && g.row === 'front') p *= CLASH_CAVALRY_IMPACT;
        if (kind === 'cavalry' && flank) p *= PLANS[s.setup.plan].strike;
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
      victim.lostTick += actual * (h.ranged && late ? RANGED_SHOCK_LATE : 1);
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
        const anchored = g.stack.infantry >= ANCHOR.infantryShare * Math.max(total, EPS);
        const at = anchored ? ANCHOR.collapseAt : ANCHOR.noInfantryCollapseAt;
        if (total >= at * g.initial) continue;
        g.row = 'rear';
        g.routed = true;
        const sector = laneSector(g.lane, 'front');
        if (s.fired.has(`collapsed:${sector}`)) continue;
        s.fired.add(`collapsed:${sector}`);
        this.emit({ id: 'sector-collapsed', side, sector });
        s.morale -= MORALE.sectorCollapsed * PLANS[s.setup.plan].shock;
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

  updateMorale(): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      const frac = s.lostTick / Math.max(1, s.initialTotal);
      s.morale -= frac * MORALE.perLoss * (this.phase === 'morale' ? MORALE.phaseMult : 1);
      s.morale = Math.max(0, Math.min(100 + 10, s.morale));
      const remaining = s.groups.reduce((n, g) => n + stackTotal(g.stack), 0);
      if (!s.broken && remaining < ANNIHILATED_AT * s.initialTotal) {
        s.broken = true;
        s.brokenAt = this.tick;
        s.brokenReason = 'annihilated';
        this.emit({ id: 'annihilated', side });
      } else if (!s.broken && (s.morale < MORALE.breakAt || s.lostTotal / s.initialTotal > MORALE.autoBreakLoss)) {
        s.broken = true;
        s.brokenAt = this.tick;
        s.brokenReason = 'morale';
        this.emit({ id: 'morale-collapsed', side, morale: Math.round(s.morale) });
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
          if (k === 'cavalry' && s.setup.orders.cavalry === 'pursue') rate *= RETREAT.pursueOrder;
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
    this.emit({ id: 'result', winner: this.winner, reason: this.reason });
    const sides = { attacker: this.sideResult('attacker'), defender: this.sideResult('defender') };
    // Стрельба не может выбить больше, чем противник потерял по итогу: округления сходятся к целым потерям.
    for (const side of SIDES) {
      const enemyLosses = sides[other(side)].total.losses;
      sides[side].rangedTotal = Math.min(sides[side].rangedTotal, enemyLosses);
      sides[side].rangedBeforeContact = Math.min(sides[side].rangedBeforeContact, sides[side].rangedTotal);
    }
    return {
      seed: this.input.seed,
      ticks: this.tick,
      winner: this.winner,
      reason: this.reason,
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
      sectors[sector] = { initial: init, final: fin };
    }
    const losses = emptyStack();
    for (const k of UNIT_KINDS) losses[k] = initial[k] - final[k];
    return {
      initial,
      final,
      losses,
      total: { initial: stackTotal(initial), final: stackTotal(final), losses: stackTotal(losses) },
      sectors,
      morale: Math.round(Math.max(0, Math.min(100, s.morale))),
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
