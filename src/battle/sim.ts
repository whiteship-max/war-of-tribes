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
  DICE,
  DICE_PHASES,
  EVENT_MIN,
  EVENT_SHARE,
  FIRE_AFTER_CONTACT,
  FRONT_WIDTH,
  KIND_PROFILE,
  MELEE_RATE,
  MORALE,
  PHASE_PIPS,
  PHASE_TICKS,
  PIP,
  PYRRHIC_BELOW,
  RANGED_RATE,
  RETREAT,
  CIRCLE_PHASES,
  circleTicks,
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
  type GroupMove,
  type Lane,
  type PhaseId,
  type PhaseSpan,
  type PipId,
  type Profile,
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
  /** С какой моралью группа каждого сектора встала в бой — снимок при расстановке, в итог (`SideResult.sectors[].start`). */
  start: Partial<Record<Sector, number>>;
  broken: boolean;
  brokenAt: number | null;
  brokenReason: 'morale' | 'annihilated' | null;
  retreating: boolean;
  /** Потери за тик, взвешенные для морали. */
  lostTick: number;
  lostTotal: number;
  /** Выбито стрельбой до первого столкновения: залп перед сшибкой первого прохода (событие `volley`, итог боя). */
  rangedBeforeContact: number;
  rangedTotal: number;
  /** Сколько человек эта сторона потеряла в погоне: столько добил противник (событие `pursuit`). */
  chased: number;
  /** Кто кого выбил по полосам: [полоса][кто][кого]. Из этого выводятся события. */
  kills: Kills[];
  /** Снимок `kills` на начало фазы: события считаются по приросту. */
  killsAtPhase: Kills[];
  fired: Set<string>;
  /**
   * Сколько мест стороны в ряду каждой полосы: сколько встало в него при расстановке плюс сколько вошло из резерва. Резерв
   * встаёт на место убитых и бежавших (`refill`), а не в полосу, где стороны не было, — её оставила пустой расстановка.
   */
  held: Record<'front' | 'rear', number[]>;
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
  /** Какую долю ряда цели накрывает этот обход (`Contact.aCover`, `coverOf`): край строя и обходящие — свою долю. */
  cover: number;
  /** Во сколько раз потеря этого удара бьёт по морали цели: показатели морали бьющего и цели (`moraleOf`). */
  moraleW: number;
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
   * Какую долю ряда `b` накрывает обход `a` (`coverOf`): у края — свес к ширине ряда `b`, у обходящих — их ширина к ней,
   * не больше единицы. Обход по морали бьёт этой долей — край или горстка в одного человека не ломает ряд, как целая
   * группа. Без поля — весь ряд.
   */
  aCover?: number;
  bCover?: number;
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

/**
 * Сила отряда: люди на силу рода в натиске. Ею бой меряет полосу — куда идти тому, у кого в полосе противника нет, когда
 * он есть в обеих соседних (`adjacentLane`, `strikerLane`). Показатели сюда не входят: выбор полосы — где людей и натиска
 * больше, а не кто кого бьёт.
 */
export function stackPower(stack: Stack): number {
  let p = 0;
  for (const k of UNIT_KINDS) p += stack[k] * UNIT_STATS[k].melee;
  return p;
}

/** Сила позиции: чем оценивают, кто проигрывает полосу. */
const power = (groups: Group[]): number => groups.reduce((p, g) => p + stackPower(g.stack), 0);

const sum = (groups: Group[], kind: UnitKind): number => groups.reduce((n, g) => n + g.stack[kind], 0);

/**
 * Сколько ширины занимает ряд: сколько в нём встало (`initial` стоящих групп), не больше ширины. Поредевшая группа
 * держит своё место — как полк EU4, сколько бы в нём ни осталось людей; место освобождают бежавшие и перебитые. Бьют
 * при этом живые, и край поредевшей бьёт долей своей численности от начальной (14.5) — без нового числа.
 */
const occupied = (groups: Group[], width: number): number => Math.min(width, groups.reduce((n, g) => n + g.initial, 0));
/**
 * Какую долю ряда шириной `row` накрывает удар во фланг шириной `over`, целыми людьми, не больше всего ряда: столько и бьёт
 * обход по морали (`flankTurned`, `MORALE.flankDrain`). Одно правило на край строя (свес ряда над рядом противника) и на
 * обходящих — край в одного человека не ломает ряд, как обход целой группой. Ряда нет — весь.
 */
const coverOf = (over: number, row: number): number => (row > 0 ? Math.min(1, Math.floor(over + 1e-9) / row) : 1);
/** Людей в группах стычки. */
const menIn = (groups: Group[]): number => groups.reduce((n, g) => n + stackTotal(g.stack), 0);

/**
 * Сомкнуты ли копья группы — положение, а не приказ (docs/battle_eu4.md, 14.5, Е17): копья в строю
 * (фронт или тыл своей полосы) сомкнуты, пока не бегут. Удар во фланг размыкает их на тот тик, когда он
 * пришёл, — это читает характер (`temper`), где знает, откуда удар. Смятых копий нет: смятия фронта потерями
 * больше нет (поставка 5, 14.33). Кольца, где сомкнутые копья держали конницу, нет (14.35).
 */
const closedSpears = (g: Group): boolean => (g.row === 'front' || g.row === 'rear') && !g.fled && g.stack.spear >= EPS;

/**
 * Какая доля группы заякорена пехотой, 0..1: каждый пехотинец держит `1 / ANCHOR.infantryShare` человек своей группы
 * (себя и четверых), и заякоренные теряют мораль медленнее (`MORALE.anchor`). Прежде якорь был порогом — доля пехоты не
 * меньше `infantryShare`, — и один пехотинец, ушедший из группы округлением раскладки, снимал якорь со всего сектора:
 * армия того же состава на 10 % больше держала поле реже меньшей (слово владельца, docs/battle_eu4.md, 14.35: правило
 * не решается одним человеком). Числа те же, у полной доли — прежний якорь.
 */
export const anchorShare = (stack: Stack): number =>
  Math.min(1, stack.infantry / (ANCHOR.infantryShare * Math.max(stackTotal(stack), EPS)));

/**
 * Стартовая мораль группы: мораль её родов, взвешенная числом людей, плюс
 * стойкость, с которой армия вышла в поле
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
  for (const k of UNIT_KINDS) m += stack[k] * UNIT_STATS[k].morale;
  const resolve = Math.max(0, setup.resolve ?? 0);
  return Math.max(0, Math.min(MORALE.max, m / total + resolve));
}

/** Доля полной морали, с которой сторона вышла в бой (`ArmySetup.rest`): 0..1, нет поля или не число — полная. */
const restOf = (setup: ArmySetup): number => {
  const r = setup.rest ?? 1;
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 1;
};

/** Вид фазы EU4 — огонь или натиск: первая отметка фазы (`PHASE_PIPS`); у фазы без кости — нет. */
const eu4Phase = (phase: PhaseId | undefined): PipId | null => (phase ? (PHASE_PIPS[phase][0] ?? null) : null);

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
 * Сторонняя часть множителя урона в фазе, без показателей: разброс кости и штраф места — в гранях (`DICE.step`), отметки
 * полководца по фазе — в цене отметки EU4 (`PIP`; слово владельца по 14.35, пп. 4–5). Может уйти ниже нуля: ниже нуля её
 * не пускает удар (`hitMult`), сложив с показателями.
 */
const luckOf = (roll: number, pips: number, ground: number): number => 1 + DICE.step * (roll - ground - (DICE.faces - 1) / 2) + PIP * pips;

/**
 * Множитель урона стороны в фазе без показателей родов: бросок кости, отметки её полководца и штраф места. Открыт наружу
 * ради карточки полководца: что прибавляет отметка и что снимает переправа, карточка меряет этой самой функцией, а не
 * своей копией формулы. Меньше нуля не бывает — урон не становится лечением.
 */
export const phaseLuck = (roll: number, pips = 0, ground = 0): number => Math.max(0, luckOf(roll, pips, ground));

/**
 * Множитель удара одного рода по другому в фазе: сторонняя часть (`luckOf`) и разница нападения бьющего с защитой цели в
 * этой фазе — огонь у стрельбы, натиск у рукопашной, — в цене отметки EU4 (как у EU4: `15 + 5 · (кость + отметки +
 * нападение − защита)`). Кольца «род против рода» нет: кто кого бьёт, следует из показателей. Меньше нуля не бывает.
 */
export const hitMult = (luck: number, by: Profile, target: Profile, ranged: boolean): number =>
  Math.max(0, luck + PIP * (ranged ? by.fireAtk - target.fireDef : by.shockAtk - target.shockDef));

/** Во сколько раз потеря от удара бьёт по морали цели: показатели морали бьющего и цели в цене отметки (не ниже нуля). */
export const moraleMult = (by: Profile, target: Profile): number => Math.max(0, 1 + PIP * (by.moraleAtk - target.moraleDef));

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
  /** Кто в этот тик в рукопашной (лучники, держащие дистанцию, — нет). Для характера лучников. */
  engagedNow = new Set<Group>();
  /**
   * Сторонняя часть множителя урона в этой фазе: кость, отметки полководца и штраф места (`luckOf`), ещё без показателей
   * родов — их прибавляет каждый удар (`hitMult`). Фаза без кости — единица.
   */
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
  /**
   * Наблюдение для показа: кто уходил в обход (`BattleResult.moves`) и мораль сторон к концу фазы (`PhaseSpan.morale`).
   * Ядро его не читает — только пишет; `observe` выключает запись ради теста «наблюдение не меняет исход».
   */
  private moved: { span: number; move: GroupMove; men: Stack }[] = [];

  constructor(
    readonly input: BattleInput,
    readonly observe = true,
  ) {
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
        start: Object.fromEntries(groups.map((g) => [g.origin, g.morale])),
        broken: false,
        brokenAt: null,
        brokenReason: null,
        retreating: false,
        lostTick: 0,
        lostTotal: 0,
        rangedBeforeContact: 0,
        rangedTotal: 0,
        chased: 0,
        kills: [zeroKills(), zeroKills(), zeroKills()],
        killsAtPhase: [zeroKills(), zeroKills(), zeroKills()],
        fired: new Set(),
        held: {
          front: ([0, 1, 2] as Lane[]).map((lane) => stackTotal(setup.sectors[laneSector(lane, 'front')])),
          rear: ([0, 1, 2] as Lane[]).map((lane) => stackTotal(setup.sectors[laneSector(lane, 'rear')])),
        },
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
   *
   * Кость одна на фазу EU4 — огонь или натиск (слово владельца по 14.35, п. 2): сближение — хвост огня, и нового броска
   * у него нет, кость стрельбы идёт дальше. Отметки фазы — все её (`PHASE_PIPS`): в натиск идут и сшибка, и сеча. У погони
   * кость своя и без отметок (`DICE_PHASES`, П2); у отступления кости нет.
   */
  rollDice(): void {
    if (!DICE_PHASES.includes(this.phase)) {
      this.luck = { attacker: 1, defender: 1 };
      return;
    }
    const kind = eu4Phase(this.phase);
    const at = CIRCLE_PHASES.indexOf(this.phase);
    if (kind && at > 0 && eu4Phase(CIRCLE_PHASES[at - 1]) === kind) return;
    const rolls = { attacker: 0, defender: 0 };
    const pips = { attacker: 0, defender: 0 };
    const ground = { attacker: this.ground.attacker.faces, defender: this.ground.defender.faces };
    for (const side of SIDES) {
      rolls[side] = Math.floor(this.rng() * DICE.faces);
      pips[side] = PHASE_PIPS[this.phase].reduce((n, pip) => n + pipOf(this.sides[side].setup, pip), 0);
      // Штраф места снимает грани с каждой кости стороны на весь бой (EU4); отметки полководца — в цене отметки (`PIP`).
      this.luck[side] = luckOf(rolls[side], pips[side], ground[side]);
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

  /** Есть ли у противника в этой (своей) полосе хоть кто-то — строй или обходящие: против него и стоят (`relocate`). */
  enemyInLane(side: Side, lane: Lane): boolean {
    return this.enemyOnLane(side, lane) || this.at(other(side), facing(lane), 'strike').length > 0;
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
   * Бой — круги всем боем: огонь и натиск поровну, по очереди, как у EU4 (`CIRCLE_PHASES`; слово владельца по 14.35, п. 2),
   * снова и снова, с новой костью в каждой фазе, пока кто-то не сломается, но не больше потолка (`roundsCap`
   * от глубины меньшей по ней стороны: вся её армия к трём полосам ширины фронта). Длины фаз — половины нынешнего круга
   * (`circleTicks`). Сломался кто-то — круг обрывается в тот же тик, в огне или в натиске, и дальше отход с погоней:
   * драться после слома некому, и минимума фазы, который доигрывал пустые тики, больше нет (поставка 5, 14.33; 14.35).
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
   * Одна фаза целиком. Правда — кто-то сломан, и ждать в этом круге больше нечего: фаза круга обрывается в тик слома — в
   * огне так же, как в натиске (драться после слома некому), и оставшиеся фазы круга не идут. Фаза не короче тика.
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
      if (someoneBroken && CIRCLE_PHASES.includes(phase)) {
        // Сторона сломалась — фаза круга обрывается: драться некому, бежавших достаёт только погоня.
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
      ...(this.observe ? { morale: { attacker: moraleOut(this.sides.attacker.morale), defender: moraleOut(this.sides.defender.morale) } } : {}),
    });
    return broke || (CIRCLE_PHASES.includes(phase) && (this.sides.attacker.broken || this.sides.defender.broken));
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
      // Новый круг: линии расходятся для нового разбега. До сшибки рукопашной нет, и лучники бьют в полную силу.
      this.opening = false;
      this.contact = false;
      this.emit({ id: 'round', round: this.round + 1 });
    }
    switch (this.phase) {
      case 'clash':
        this.contact = true;
        for (const side of SIDES) {
          const s = this.sides[side];
          // Залп «до столкновения» — один, перед первой сшибкой. Судьи перестрелки нет (поставка 5, 14.33): проигранный
          // обстрел бьёт по морали только своими потерями, отдельного счёта у морали нет (14.19.3).
          const losses = Math.round(s.rangedBeforeContact);
          if (this.round === 0 && losses >= 1) this.emit({ id: 'volley', side, losses });
        }
        break;
      case 'retreat':
        this.decide();
        break;
      default:
        break;
    }
  }

  onPhaseEnd(): void {
    // Фаза EU4 кончилась, когда следующая фаза круга — другого вида: стрельба и сближение — одна фаза огня.
    const at = CIRCLE_PHASES.indexOf(this.phase);
    const kind = eu4Phase(this.phase);
    if (kind && at >= 0 && eu4Phase(CIRCLE_PHASES[at + 1]) !== kind) this.passed[kind] = (this.passed[kind] ?? 0) + 1;
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
        // Сколько добила погоня — прежде событие брало остаток потолка, а не выбитых, и не писалось почти никогда.
        const losses = Math.round(enemy.chased);
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

  /**
   * Куда резерв стороны встал бы сейчас (`refill`): места — те, что сторона в ряду держала, минус стоящие; раскладка —
   * `setup.reinforceInto`. Нет резерва — `null`.
   */
  entering(side: Side): { reserve: Group[]; into: ReturnType<typeof reinforceInto> } | null {
    const s = this.sides[side];
    const reserve = this.reserveOf(side);
    if (reserve.length === 0) return null;
    const pool = this.reservePool(reserve);
    if (stackTotal(pool) < 1) return null;
    const cap = Number.isFinite(this.width) ? Math.floor(this.width) : Infinity;
    const room = (row: 'front' | 'rear'): number[] =>
      ([0, 1, 2] as Lane[]).map((lane) => {
        const men = s.groups.reduce((n, g) => (g.lane === lane && g.row === row && alive(g) && !g.fled ? n + stackTotal(g.stack) : n), 0);
        return Math.max(0, Math.floor(Math.min(cap, s.held[row][lane]) - men + 1e-9));
      });
    return { reserve, into: reinforceInto(pool, { front: room('front'), rear: room('rear') }) };
  }

  /**
   * Сколько человек резерва встало бы в строй сейчас. Меньше одного — встать некому: резерва нет или его некуда
   * поставить (нечётный остаток при двух открытых краях ждёт по правилу округления, а полосы, где стороны не было, резерв
   * не занимает). Тем же счётом, каким резерв встаёт, — иначе сторона, которой встать некуда, держалась бы бойцом, который
   * в строй не войдёт никогда, и бой стоял бы до потолка кругов.
   */
  reserveMen(side: Side): number {
    const e = this.entering(side);
    if (!e) return 0;
    return [...e.into.front, ...e.into.rear].reduce((n, st) => n + stackTotal(st), 0);
  }

  /**
   * Автоматический резерв (docs/battle_eu4.md, 14.2 и 14.5; решение владельца — вариант (а)). Кто не встал в ряд —
   * стоит в резерве стороны: вне строя, со своей моралью, которую до ввода не теряет (14.19.4). В каждый тик он
   * встаёт в любую дыру строя — на место убитых и бежавших — без предпочтения рода, как у EU4 (`setup.reinforceInto`):
   * пешие и конные — в дыры первой линии одним потоком, в доле их в резерве; лучники — во вторую линию. Фланги за
   * конницей — только у начальной расстановки (решение владельца по 14.21). Места — те, что сторона в ряду держала
   * (`SideState.held`: встали при расстановке и вошли из резерва, не больше ширины), минус те, кто в нём стоит и не
   * бежит. Полосу, где стороны не было, резерв не занимает: её оставила пустой расстановка — конница идёт в центр, только
   * когда края полны, нечётный остаток краёв ждёт, — и ввод резерва на первом же тике не переписывает её решения.
   * Прежде места считались от ширины, и нечётный всадник вставал один в пустой центр: на нём стрелы противника тратили
   * тик, край армии сохранял мораль, и стая на одного волка больше проигрывала там, где меньшая брала верх (14.35).
   * Вошедшие встают своей группой полосы — родом из резерва (`R`): их мораль — их собственная, а не тех, чьё место они
   * заняли.
   */
  refill(side: Side): void {
    const s = this.sides[side];
    const e = this.entering(side);
    if (!e) return;
    const { reserve, into } = e;
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
        s.held[row][lane] += men;
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
      // Погоня — рукопашная той же дверью урона (`distribute`): ширина ряда — та же, что в бою.
      this.measureRows();
      const hits: Hit[] = [];
      this.pursue(hits);
      const before = { attacker: this.sides.attacker.lostTotal, defender: this.sides.defender.lostTotal };
      this.apply(hits);
      for (const side of SIDES) this.sides[side].chased += this.sides[side].lostTotal - before[side];
    } else {
      // Дыры строя закрывает резерв — до стычек, чтобы вошедшие дрались в этот же тик. У сломанной стороны встать
      // некому по определению слома (`updateMorale`), и резерв после слома не встаёт.
      for (const side of SIDES) if (!this.sides[side].retreating && !this.sides[side].broken) this.refill(side);
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
      for (const c of contacts) {
        for (const g of c.a) facingMen.set(g, (facingMen.get(g) ?? 0) + menIn(c.b));
        for (const g of c.b) facingMen.set(g, (facingMen.get(g) ?? 0) + menIn(c.a));
      }
      for (const c of contacts) {
        const aOver = c.aOver ?? 0;
        const bOver = c.bOver ?? 0;
        const aCover = c.aCover ?? 1;
        const bCover = c.bCover ?? 1;
        this.melee(c.a, c.b, { flank: c.aFlank, over: aOver, cover: aCover }, facingMen, hits);
        // Ответ: обойдённые отбиваются тем, кто их обходит.
        this.melee(c.b, c.a, { flank: false, over: bOver, cover: bCover }, facingMen, hits);
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
    // Обходы: навстречу обходу не разворачивается никто — перехват жил приказом «держать фланг». По морали обход бьёт
    // долей ряда, которую накрывает, — тем же правилом, что край строя ниже (`cover`): ширина обходящих этой полосы, что
    // бьют этот ряд (`occupied`), к ширине ряда. Прежде обход бил весь ряд, сколько бы в нём ни было, — и горстка, ушедшая
    // в обход, ломала ряд, как целая группа: с охватом по излишку в обход уходят и горстки (`relocate`; 14.35).
    for (const side of SIDES) {
      const enemy = other(side);
      for (const lane of [0, 1, 2] as Lane[]) {
        const strikers = this.at(side, lane, 'strike');
        if (strikers.length === 0) continue;
        const eLane = facing(lane);
        const rows = { rear: this.at(enemy, eLane, 'rear'), front: this.at(enemy, eLane, 'front') };
        const aimed: Record<'rear' | 'front', Group[]> = { rear: [], front: [] };
        for (const g of strikers) {
          const order: Array<'rear' | 'front'> = g.prefer === 'rear' ? ['rear', 'front'] : ['front', 'rear'];
          const row = order.find((r) => rows[r].length > 0);
          if (row) aimed[row].push(g);
        }
        for (const row of ['rear', 'front'] as const) {
          if (aimed[row].length === 0) continue;
          const cover = coverOf(occupied(aimed[row], this.width), occupied(rows[row], this.width));
          for (const g of aimed[row]) contacts.push({ a: [g], b: rows[row], aFlank: true, aRow: 'strike', bRow: row, aCover: cover });
          if (cover > 0) this.flankTurned(side, enemy, eLane, row, rows[row], cover);
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
    // Медленных, которые не могут сократить дистанцию, больше нет (слово владельца, docs/battle_eu4.md, 14.35): задержка
    // рукопашной у рядов из одних медленных жила кольцом — пока копья шли, лучники били их в полную силу («лучники бьют
    // копья»), — и уходит вместе с ним; один быстрый в ряду включал её для всего ряда разом.
    for (const lane of [0, 1, 2] as Lane[]) {
      const aF = this.at('attacker', lane, 'front');
      const dF = this.at('defender', facing(lane), 'front');
      const aR = this.at('attacker', lane, 'rear');
      const dR = this.at('defender', facing(lane), 'rear');
      if (aF.length > 0 && dF.length > 0) {
        // Край строя в своей полосе: кто шире, тот свесом бьёт во фланг. Ширину ряд занимает тем, чем встал (`occupied`),
        // а не тем, сколько в нём живых: поредевший держит своё место, как полк EU4, и бьёт краем долей своей
        // численности от начальной — потому что бьют живые.
        const aOcc = occupied(aF, this.width);
        const dOcc = occupied(dF, this.width);
        const over = (x: number, y: number): number => (x > 0 ? Math.floor(Math.max(0, x - y) + 1e-9) / x : 0);
        const aOver = over(aOcc, dOcc);
        const dOver = over(dOcc, aOcc);
        const aCover = coverOf(Math.max(0, aOcc - dOcc), dOcc);
        const dCover = coverOf(Math.max(0, dOcc - aOcc), aOcc);
        contacts.push({ a: aF, b: dF, aFlank: false, aRow: 'front', bRow: 'front', aOver, bOver: dOver, aCover, bCover: dCover });
        if (aOver > 0) this.flankTurned('attacker', 'defender', facing(lane), 'front', dF, aCover);
        if (dOver > 0) this.flankTurned('defender', 'attacker', lane, 'front', aF, dCover);
      } else if (aF.length > 0 && dR.length > 0) {
        pair(aF, dR, false, 'front', 'rear');
        this.reached('defender', facing(lane));
      } else if (dF.length > 0 && aR.length > 0) {
        pair(dF, aR, false, 'front', 'rear');
        this.reached('attacker', lane);
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

  /** Множитель урона, который получает группа: отходящие отбиваются слабо и выходят из контакта. */
  taken(g: Group): number {
    return this.sides[g.side].retreating ? RETREAT.taken : 1;
  }

  /**
   * Общий множитель силы группы — отход. Кость, отметки и показатели — в каждом ударе (`hitMult`). Мораль в урон не входит
   * — у EU4 урон от силы полка, а не от его морали (поставка 5, docs/battle_eu4.md, 14.33).
   */
  dealtMult(g: Group): number {
    return this.sides[g.side].retreating ? RETREAT.dealt : 1;
  }

  /**
   * Раздать урон `total` по группам позиции пропорционально числу: приоритета цели нет — он жил приказами. Каждая доля
   * множится на удар рода `kind` по роду цели (`hitMult`: кость, отметки полководца, нападение бьющего и защита цели в этой
   * фазе); потеря бьёт по морали цели с весом показателей морали (`moraleMult`).
   */
  distribute(
    from: Group,
    kind: UnitKind,
    total: number,
    targets: Group[],
    ctx: { flank: boolean; ranged: boolean; cover?: number; chase?: boolean },
    byLane: Lane,
    hits: Hit[],
  ): void {
    // Погоня (`chase`) достаёт только тех, кто медленнее бьющего, и пойманные из контакта не выходят: отход (`taken`) —
    // это строй, уходящий в фазе отступления, а в погоне его догнали (П2, docs/battle_eu4.md, 14.35).
    const reached = (k: UnitKind): boolean => !ctx.chase || UNIT_STATS[k].speed < UNIT_STATS[kind].speed;
    let weight = 0;
    for (const t of targets) for (const k of UNIT_KINDS) if (reached(k)) weight += t.stack[k];
    if (weight <= 0) return;
    const by = KIND_PROFILE[kind];
    for (const t of targets) {
      for (const k of UNIT_KINDS) {
        const n = t.stack[k];
        if (!stands(n) || !reached(k)) continue;
        const share = n / weight;
        const target = KIND_PROFILE[k];
        const casualties = total * share * hitMult(this.luck[from.side], by, target, ctx.ranged) * (ctx.chase ? 1 : this.taken(t));
        if (casualties > 0) {
          hits.push({ target: t, kind: k, casualties, by: from.side, byKind: kind, byLane, ranged: ctx.ranged, flank: ctx.flank, cover: ctx.cover ?? 1, moraleW: moraleMult(by, target) });
        }
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
    ctx: { flank: boolean; over: number; cover: number },
    facingMen: Map<Group, number>,
    hits: Hit[],
  ): void {
    const here = menIn(to);
    for (const g of from) {
      if (g.lane === null) continue;
      // Своя доля стычки и доля ряда, которую пускает ширина фронта: остальные — глубина.
      const share = (here / Math.max(here, facingMen.get(g) ?? here)) * this.widthShare(g);
      const lane = g.lane;
      for (const kind of UNIT_KINDS) {
        if (!stands(g.stack[kind])) continue;
        const n = g.stack[kind] * share;
        const p = n * UNIT_STATS[kind].melee * MELEE_RATE * this.dealtMult(g);
        // Свес ряда бьёт во фланг, остальные — в лоб; обходящие бьют во фланг все, долей ряда, которую накрывают.
        const front = p * (1 - ctx.over);
        const edge = p * ctx.over;
        if (front > 0) this.distribute(g, kind, front, to, { flank: ctx.flank, ranged: false, cover: ctx.flank ? ctx.cover : 1 }, lane, hits);
        if (edge > 0) this.distribute(g, kind, edge, to, { flank: true, ranged: false, cover: ctx.cover }, lane, hits);
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
    // Пока цель не в рукопашной, стрельба идёт в полную силу; после контакта — через головы своих (`FIRE_AFTER_CONTACT`).
    const m = targets.some((t) => engaged.has(t)) ? FIRE_AFTER_CONTACT : 1;
    // Стреляет не больше ширины ряда: лучники за строем шире фронта — та же глубина, что у пехоты.
    const p = g.stack.archer * UNIT_STATS.archer.ranged * RANGED_RATE * this.dealtMult(g) * m * this.widthShare(g);
    this.distribute(g, 'archer', p, targets, { flank: false, ranged: true }, g.lane, hits);
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
      // docs/battle_eu4.md, 14.33): отдельного счёта у морали нет (14.19.3). Потеря весит показателями морали бьющего и цели
      // (`moraleMult`): мораль по-прежнему от потерь (слово владельца по 14.35, п. 3).
      h.target.lostTick += actual * h.moraleW;
      if (h.flank) {
        if (h.target.flankedTick !== this.tick) h.target.flankCover = 0;
        h.target.flankedTick = this.tick;
        h.target.flankCover = Math.max(h.target.flankCover, h.cover);
      }
      const by = this.sides[h.by];
      by.kills[h.byLane][h.byKind][h.kind] += actual;
      if (h.ranged) by.rangedTotal += actual;
      if (h.ranged && !this.contact && this.round === 0) by.rangedBeforeContact += actual;
    }
  }

  /**
   * Охват — по излишку ширины, одно правило без истории (слово владельца, docs/battle_eu4.md, 14.35: пункт 1 и «Всадник у
   * ворот»; как у EU4, где полк, против которого впереди никого, бьёт того, кто в досягаемости). В охват идут те, кому
   * напротив нет противника: излишек ширины строя полосы над противником в ней — строем, тылом и обходящими, в ширине,
   * которую они держат (`occupied`), — идёт к ближней полосе, где противник есть, и бьёт её обходом. Противника в полосе
   * нет вовсе — излишек и есть вся полоса: уходят все, и обходящие тоже; строя противника не осталось ни в одной полосе —
   * идут к его обходящим. Своего числа у правила нет.
   *
   * Прежде полосу занимало присутствие, а не число: горстка напротив держала всю группу, а группа, против которой в полосе
   * не стало никого, уходила в обход целиком. Один всадник гарнизона, вставший на край, держал так всю стаю на краю, а центр
   * гарнизона уходил в обход — и мерка 1-го уровня без всадников с одним всадником держала 146 волков вместо 80
   * (`raid-mix:report`, раздел 4в, на `0636bd0`; 14.35, «Всадник у ворот»). Горстка держит теперь столько, сколько сама
   * занимает. Прежние частные правила — обход очищенной полосы (К5), ход обходящих к обходящим (14.25) и охват без истории
   * — это правило покрывает.
   *
   * Обходящие уходят только из полосы, где противника нет вовсе: они уже в охвате и бьют того, кто в полосе. Излишек строя
   * уходит частью группы — те же рода той же долей, с той же моралью (`detach`). Стороны ходят по очереди, поэтому вторая
   * застаёт первую уже у себя в полосе и стоит — встречные не меняются местами.
   */
  relocate(): void {
    if (!this.contact) return;
    for (const side of SIDES) {
      // Кто где стоял до хода: ушедшие в эту же минуту второй раз не ходят.
      const lanes = ([0, 1, 2] as Lane[]).map((lane) => ({ lane, front: this.at(side, lane, 'front'), strike: this.at(side, lane, 'strike') }));
      for (const { lane, front, strike } of lanes) {
        if (front.length === 0 && strike.length === 0) continue;
        const next = this.adjacentLane(side, lane) ?? this.strikerLane(side, lane);
        if (!this.enemyInLane(side, lane)) {
          if (next === null) continue;
          for (const g of [...front, ...strike]) {
            this.noteMove(side, g.origin, lane, next, g.stack);
            g.lane = next;
            if (g.row === 'front') {
              g.row = 'strike';
              g.prefer = 'front';
            }
          }
          continue;
        }
        if (front.length === 0 || next === null) continue;
        const eLane = facing(lane);
        const enemy = other(side);
        const facingRows = [...this.at(enemy, eLane, 'front'), ...this.at(enemy, eLane, 'rear'), ...this.at(enemy, eLane, 'strike')];
        const own = occupied(front, this.width);
        const held = occupied(facingRows, this.width);
        if (Math.floor(own - held + 1e-9) < 1) continue;
        // Ширину строя полосы группы держат своим `initial`: остаётся ровно та, что напротив противника.
        const spread = front.reduce((n, g) => n + g.initial, 0);
        this.detach(side, front, 1 - held / spread, next);
      }
    }
  }

  /**
   * Часть строя полосы уходит в обход: от каждой группы — доля `share` каждого рода и её места в ширине (`initial`), с
   * той же моралью. Ушедшие встают обходящими той же группы рода (`origin`) в полосе `to`, если такая там уже есть, —
   * мораль взвешивается людьми, как у вошедших из резерва (`refill`), — иначе своей группой.
   */
  detach(side: Side, front: Group[], share: number, to: Lane): void {
    const s = this.sides[side];
    for (const g of front) {
      const moved = emptyStack();
      for (const k of UNIT_KINDS) {
        // Щепок меньше полбойца (`stands`) дележ не оставляет: остаток рода не стоит — уходит весь род, уходящих не хватает
        // на полбойца — род остаётся.
        let m = g.stack[k] * share;
        if (g.stack[k] - m < EPS) m = g.stack[k];
        else if (m < EPS) m = 0;
        moved[k] = m;
        g.stack[k] -= m;
      }
      const width = g.initial * share;
      g.initial -= width;
      const men = stackTotal(moved);
      if (men <= 0) continue;
      if (g.lane !== null) this.noteMove(side, g.origin, g.lane, to, moved);
      const into = s.groups.find((x) => x.origin === g.origin && x.lane === to && x.row === 'strike' && alive(x) && !x.fled);
      if (into) {
        const had = stackTotal(into.stack);
        into.morale = (into.morale * had + g.morale * men) / (had + men);
        for (const k of UNIT_KINDS) into.stack[k] += moved[k];
        into.initial += width;
      } else {
        const part = newGroup(side, s.setup, g.origin, moved, to, 'strike', { prefer: 'front', morale: g.morale });
        part.initial = width;
        s.groups.push(part);
      }
    }
  }

  /**
   * Записать ход группы в обход (`BattleResult.moves`). Ходы одной фазы с теми же стороной, сектором и полосами
   * складываются: излишек строя уходит понемногу, тик за тиком, а показу нужен отряд, а не сотня строк.
   */
  noteMove(side: Side, sector: Sector, from: Lane, to: Lane, stack: Stack): void {
    if (!this.observe || from === to) return;
    const span = this.phases.length;
    let row = this.moved.find((r) => r.span === span && r.move.side === side && r.move.sector === sector && r.move.from === from && r.move.to === to);
    if (!row) {
      row = { span, move: { tick: this.tick, phase: this.phase, side, sector, from, to, men: {} }, men: emptyStack() };
      this.moved.push(row);
    }
    for (const k of UNIT_KINDS) row.men[k] += stack[k];
  }

  // ----- Мораль -----

  /**
   * Характер группы сейчас: множитель потерь морали по родам, взвешенный числом людей, — по положению. Копья стойки в
   * сомкнутом строю и ломки под ударом во фланг; конница крепка в обходе; лучники в рукопашной ломаются быстро.
   */
  temper(g: Group): number {
    const total = stackTotal(g.stack);
    if (total < EPS) return 1;
    // Обойдённая доля ряда (`flankCover`): край строя и обходящие накрывают свою долю (`coverOf`).
    const flanked = g.flankedTick === this.tick ? g.flankCover : 0;
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
      else t = g.row === 'strike' ? TEMPER[k].charging : TEMPER[k].waiting;
      m += n * t;
    }
    return m / total;
  }

  /** Множитель всех потерь морали группы: характер и якорь пехоты. */
  moraleFactor(g: Group): number {
    return this.temper(g) * (1 - (1 - MORALE.anchor) * anchorShare(g.stack));
  }

  /**
   * Группа сломалась: бегут с поля, место открыто резерву. Соседей это не трогает — паники на соседей нет, как у EU4
   * (docs/battle_eu4.md, 14.21): каждый отходит сам, по своей морали, а на его место встаёт резерв.
   *
   * Сектор в журнале сломан, когда побежала последняя его стоящая часть, — тем же правилом, каким сектор сломан в итоге
   * боя (`sideResult`: все его группы бежали или перебиты). Излишек строя уходит в обход частью сектора (`detach`), и
   * «левый фланг побежал», пока большая его часть бьёт центр с фланга, было бы неправдой.
   */
  breakGroup(g: Group): void {
    const s = this.sides[g.side];
    // В журнале — сектор расстановки, а не позиция: пехота, ушедшая обходом на соседнюю полосу, для игрока всё ещё «правый фланг».
    const sector = g.origin;
    g.fled = true;
    g.morale = 0;
    g.lane = null;
    if (s.groups.some((x) => x.origin === sector && !x.fled && alive(x))) return;
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
   *
   * Обе стороны теряют мораль тика одновременно: кто сломан, читается на начало тика. Иначе сторона, которую счёт
   * обходит первой, ломалась бы, а вторая в тот же тик уже «не боялась бы» — и одновременный слом решал бы порядок
   * обхода в пользу обороны, а не правило одновременного слома (`decide`: меньше сохранил — тот и отходит).
   */
  updateMorale(): void {
    const brokenAtStart: Record<Side, boolean> = { attacker: this.sides.attacker.broken, defender: this.sides.defender.broken };
    for (const side of SIDES) {
      const s = this.sides[side];
      // Противник сломался — своим больше нечего бояться: мораль не падает.
      const enemyBroken = brokenAtStart[other(side)] && !brokenAtStart[side];
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
    this.winner = other(loser.id);
    this.reason = loser.brokenReason ?? 'losses';
    if (!loser.broken) {
      // Никто не сломался — исход решил размен. Отчёту нужно, чем именно.
      const winner = this.sides[this.winner];
      this.emit({ id: 'outfought', side: loser.id, kept: Math.round(remain(loser) * 100), enemyKept: Math.round(remain(winner) * 100) });
    }
    this.emit({ id: 'retreat', side: loser.id, orderly: !loser.broken });
  }

  /**
   * Погоня (слово владельца по 14.35, п. 5; П2): победитель бьёт отходящих той же рукопашной, что в бою, — сила рода в
   * натиске на `MELEE_RATE`, удар через `hitMult` с костью погони (без отметок), в ширину ряда (`widthShare`: погоню ведут
   * те, кто стоит в строю и в обходе, резерв — нет) и в спину — ударом с фланга. Достаёт только тех, кто медленнее бьющего
   * (`distribute`, `chase`): одних копий у пехоты, всех, кроме всадников, у лёгкой конницы; всадников не догоняет никто. Потолка
   * нет: погоня, выбившая всех бегущих, и есть уничтоженная армия (п. 6) — «перебита» пишет мораль тика (`ANNIHILATED_AT`).
   * Отходящие не отвечают: бегущие не бьют, а строй уходит.
   */
  pursue(hits: Hit[]): void {
    for (const side of SIDES) {
      const s = this.sides[side];
      const enemy = this.sides[other(side)];
      if (!enemy.retreating || s.retreating) continue;
      const targets = enemy.groups.filter(alive);
      if (targets.length === 0) continue;
      for (const g of s.groups) {
        if (!alive(g) || g.fled || g.lane === null) continue;
        const share = this.widthShare(g);
        for (const kind of UNIT_KINDS) {
          if (!stands(g.stack[kind])) continue;
          const p = g.stack[kind] * share * UNIT_STATS[kind].melee * MELEE_RATE;
          this.distribute(g, kind, p, targets, { flank: true, ranged: false, chase: true }, g.lane, hits);
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
      ...(this.observe ? { moves: this.moved.map((r) => movedOut(r.move, r.men)).filter((m) => Object.keys(m.men).length > 0) } : {}),
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
      const start = Math.round((s.start[sector] ?? 0) * 100) / 100;
      sectors[sector] = { initial: init, final: fin, morale: Math.round(Math.max(0, Math.min(MORALE.max, morale))), broken, start };
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

/** Мораль наружу — той же мерой, что `SideResult.morale`: 0..100, до целых. */
const moraleOut = (m: number): number => Math.round(Math.max(0, Math.min(MORALE.max, m)));

/** Ход в обход наружу: люди по родам до десятых, рода меньше десятой бойца не пишутся. */
function movedOut(move: GroupMove, men: Stack): GroupMove {
  const out: GroupMove['men'] = {};
  for (const k of UNIT_KINDS) {
    const n = Math.round(men[k] * 10) / 10;
    if (n > 0) out[k] = n;
  }
  return { ...move, men: out };
}

/**
 * Единственная дверь: бой целиком, детерминированно по сиду. `observe: false` — без наблюдения для показа
 * (`BattleResult.moves`, `PhaseSpan.morale`): только для теста «наблюдение не меняет исход», игра его не выключает.
 */
export function simulateBattle(input: BattleInput, opts: { observe?: boolean } = {}): BattleResult {
  for (const side of SIDES) {
    const err = validateSetup(input[side]);
    if (err) throw new Error(`battle: ${side}: ${err}`);
  }
  // Ширина — положительное число; `Infinity` законна и значит «боя без ширины».
  if (input.width !== undefined && !(input.width > 0)) throw new Error(`battle: ширина фронта ${input.width}`);
  return new Battle(input, opts.observe ?? true).run();
}
