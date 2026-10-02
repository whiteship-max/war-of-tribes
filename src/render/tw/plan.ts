// Режиссура ролика боя в стиле Total War — чистая, без three (docs/battle_tw.md, разделы 2–4 и 8).
//
// Ролик — проигрыватель журнала, а не второй симулятор (docs/battle-replay.md). Время у него — прежней раскадровки
// (`Cast`: такты, фазы на секундах, мгновения слома, потери по секторам на фазу), а здесь к нему добавляются место,
// строй и движение: какие отряды стоят, где, сколько в них фигур, куда они идут и кто когда падает. Своих чисел
// исхода нет: сколько фигур упало к секунде `t` — те же потери журнала, что у отчёта, переведённые в фигуры одним
// на весь бой `k` (`ratioOf`).
//
// Тот же журнал — тот же ролик до фигуры: разброс места, роста, тона и фазы шага — от сида боя и номера фигуры
// (`terrain.hash`), без `Math.random`.
import { lossProgress, sectorLost, type Cast, type Face } from '@/battle/replay';
import { UNIT_STATS } from '@/battle/config';
import { FRONT, SECTORS, UNIT_KINDS, type BattleResult, type Lane, type Sector, type Side, type UnitKind } from '@/battle/types';
import { wearOf } from '@/game/battle/faces';
import { gearOfTroop } from '@/game/battle/kinds';
import { TROOP_BY_ID } from '@/game/data/troops';
import type { TroopId } from '@/game/types';
import type { Quality } from '../quality';
import { TW_SPEC } from './spec';
import { hash, heightAt, inWater, type TwField } from './terrain';
import {
  CLIMB_SPEED,
  GATEHOUSE,
  LADDER_FOOT,
  LADDER_QUEUE,
  LADDER_RUNG,
  LADDER_STEP,
  LANE_GAP_WALL,
  OVER_GAP,
  POMERIUM,
  RAM_PERIOD,
  SQUARE_R,
  STREET_HALF,
  WALL_THICK,
  WALL_TOP,
  GATE_HALF,
  campOf,
  onWalk,
  outOf,
  overLift,
  standY,
  townHouses,
  wallTowers,
  type Rect,
  type TwSite,
  type TwSiteKind,
  type TwWall,
} from './site';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (u: number): number => {
  const k = clamp01(u);
  return k * k * (3 - 2 * k);
};
const SIDES2: readonly Side[] = ['attacker', 'defender'];
const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

// ---------- Сколько фигур ----------

/**
 * Одна фигура — `k` бойцов ядра, и `k` один на весь бой, у обеих сторон (docs/battle_tw.md, раздел 2, решение 1):
 * пятьсот против двадцати обязаны выглядеть пятьюстами против двадцати. Потолок — фигур на сторону у уровня
 * качества; больше потолка не стоит ни одна сторона.
 */
export function ratioOf(attacker: number, defender: number, perSide: number): number {
  return Math.max(1, Math.ceil(Math.max(attacker, defender, 0) / Math.max(1, perSide)));
}

/** Наибольший остаток: сумма сходится ровно, у кого больше доля — тому лишняя единица. */
export function spreadBy(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let given = out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - out[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; given < total; k++, given++) out[order[k % order.length].i] += 1;
  return out;
}

// ---------- Строй ----------

/** Как стоит отряд: шаг по фронту и в глубину, сколько шеренг, потолок фигур и разброс места. */
export type Form = 'foot' | 'folk' | 'bow' | 'horse' | 'heavy' | 'pack';

export interface FormSpec {
  /** Шаг по фронту и в глубину, метры сцены. */
  file: number;
  rank: number;
  /** Фронт к глубине: шеренг — корень из фигур на это число. */
  aspect: number;
  minRanks: number;
  maxRanks: number;
  /** Фигур в отряде, не больше: больше — соседний отряд со своим знаменем. */
  cap: number;
  /** Разброс места в долях шага: выученный строй ровнее ополчения, стая — не строй. */
  jitter: number;
  /** Насколько к краю армии встаёт отряд в своей полосе: конница — на краях (фланги за конницей, EU4). */
  outer: number;
}

export const FORM: Record<Form, FormSpec> = {
  foot: { file: 0.6, rank: 0.74, aspect: 2.6, minRanks: 2, maxRanks: 8, cap: 160, jitter: 0.06, outer: 0 },
  folk: { file: 0.66, rank: 0.8, aspect: 2.6, minRanks: 2, maxRanks: 8, cap: 160, jitter: 0.16, outer: 0 },
  bow: { file: 0.8, rank: 0.95, aspect: 3.5, minRanks: 2, maxRanks: 5, cap: 120, jitter: 0.1, outer: 1 },
  horse: { file: 1.05, rank: 2.1, aspect: 3, minRanks: 1, maxRanks: 4, cap: 60, jitter: 0.07, outer: 3 },
  heavy: { file: 1.15, rank: 2.3, aspect: 3, minRanks: 1, maxRanks: 4, cap: 50, jitter: 0.05, outer: 2 },
  pack: { file: 1.0, rank: 1.1, aspect: 2.5, minRanks: 2, maxRanks: 8, cap: 80, jitter: 0.5, outer: 0 },
};

export function formOf(kind: UnitKind, face: string): Form {
  // Кто это — спрашивается у моста (`wearOf`), своей таблицы меток у показа нет.
  const wear = wearOf(face, kind).wear;
  if (wear === 'beast') return 'pack';
  if (kind === 'archer') return 'bow';
  if (kind === 'cavalry') return 'horse';
  if (kind === 'heavy') return 'heavy';
  if (wear === 'folk') return 'folk';
  return 'foot';
}

/** Сколько железа на виде: тяжёлые встают в середину отряда. Ополчение и зверь — без снаряжения. */
const gearOf = (id: string): number => (id in TROOP_BY_ID ? gearOfTroop(id as TroopId) : -1);

/** Шеренг у отряда в столько фигур. */
export function ranksOf(form: Form, figures: number): number {
  const f = FORM[form];
  if (figures <= 1) return 1;
  const r = Math.round(Math.sqrt(figures / f.aspect));
  return Math.max(1, Math.min(figures, Math.max(f.minRanks, Math.min(f.maxRanks, r))));
}

// ---------- Поле ----------

/** Передние шеренги стоят здесь от линии соприкосновения на построении. */
export const DEPLOY_HALF = 15;
/** Полузазор линии соприкосновения: передние шеренги сторон стоят на столько от неё в сече. */
export const CONTACT_HALF = 0.42;
/** Вторая линия за первой и резерв за второй — зазор от последней шеренги. */
export const REAR_GAP = 3.5;
export const RESERVE_GAP = 6;
/** Отряд резерва встаёт в бой, когда журнал ввёл в полосы столько от его людей. */
export const RESERVE_SHARE = 0.25;
/** Зазор между полосами и между отрядами одного ряда. */
export const LANE_GAP = 1.8;
export const UNIT_GAP = 1.0;
/** Холм и переправа: обороняющийся ждёт у гребня или берега на столько от линии. */
export const HOLD_HALF = 3;

// ---------- Время ----------

/** Вступление ролика TW: построение и сближение. В раскадровке оно — 10 с, здесь — 12 (раздел 4). */
export const INTRO_SECONDS = 12;
/** Потолок ролика — прежний (docs/battle_tw.md, раздел 7). */
export const MAX_SECONDS = 70;
/** С какой секунды линии идут навстречу: до этого видно построение. Кому идти дальше — раньше. */
export const ADVANCE_FROM = 2.5;
export const ADVANCE_EARLY = 1;
/** Сколько секунд перед сшибкой идут бегом, и во сколько раз бег быстрее шага. */
export const RUN_LAST = 2.2;
export const RUN_FACTOR = 2.4;
/**
 * Скорость шага, при которой клип «марш» не скользит по земле: шаг клипа — 0.74 с на два шага по полметра
 * (`poses.BEAT.walk`, мах ноги 0.55). Быстрее — клип играется быстрее, а не скользит.
 */
export const WALK_SPEED = 1.35;
/** То же для бега: цикл 0.5 с на два шага по 0.8 м. */
export const RUN_SPEED = 3.2;
/** В воде строй идёт вдвое медленнее и вдвое рыхлее (переправа). */
export const WATER_SLOW = 0.5;
/** Отход линий между кругами: на столько отступают передние шеренги в огне круга. */
export const SEP = 1.6;
/** Бегущие: скорость и как быстро разворачиваются. */
export const FLEE_SPEED = 3.4;
export const TURN_SECONDS = 0.6;
/** Стрельба: период залпа, когда в нём срывается стрела, и время полёта. */
export const SHOOT_PERIOD = 3;
export const SHOOT_RELEASE = 0.62;
export const ARROW_FLIGHT = 1.7;
/** Удар строя о строй на первой сшибке: передние шеренги влетают в чужой строй и отскакивают — секунды и метры. */
export const IMPACT_SECONDS = 0.9;
export const IMPACT_LURCH = { foot: 0.45, horse: 1.1 };
/** Свалка: передние шеренги ходят вперёд-назад на столько метров, строй у линии рыхлее во столько раз. */
export const SCRUM_SWAY = 0.22;
export const SCRUM_LOOSE = 1.3;
/** Линия соприкосновения полосы уходит к тому, кто теряет больше, — не дальше стольких метров; входит за столько секунд. */
export const PUSH_MAX = 1.4;
export const PUSH_IN = 2;
/** Перед бегством отряд дрожит столько секунд: рыхлеет, пятится, задние оглядываются. */
export const WAVER_SECONDS = 1.4;
/** Галоп конницы в обходе и в погоне, метры в секунду. */
export const GALLOP_SPEED = 7;
/** Резерв уходит в дыру струйкой, растянутой на фазу метки: не короче `STREAM_GAP` и не дольше `STREAM_MAX` секунд. */
export const STREAM_GAP = 0.05;
export const STREAM_MAX = 2.5;
/** Погоня: сколько секунд гонят, прежде чем встать; на сколько метров держатся за спиной бегущих. */
export const CHASE_SECONDS = 7;
export const CHASE_GAP = 1.6;
/** Полководец въезжает в сечу через столько секунд после сшибки и за столько секунд. */
export const GENERAL_IN = { after: 1, seconds: 3 };

export interface TwTiming {
  /** Конец вступления в секундах ролика TW и раскадровки. */
  intro: number;
  castIntro: number;
  /** Сеча: в TW и в раскадровке. */
  melee: [number, number];
  castMelee: [number, number];
  /** Бегство. */
  rout: [number, number];
  castRout: [number, number];
  seconds: number;
}

/**
 * Время ролика TW: вступление растянуто с 10 с раскадровки до 12, сеча укорочена так, чтобы весь ролик не
 * превысил 70 с; бегство — как в раскадровке. Других перемен времени нет (решение 5).
 */
export function twTiming(cast: Cast): TwTiming {
  const melee = cast.acts.find((a) => a.act === 'melee')!;
  const rout = cast.acts.find((a) => a.act === 'rout')!;
  const routLen = rout.to - rout.from;
  const meleeLen = Math.min(melee.to - melee.from, MAX_SECONDS - INTRO_SECONDS - routLen);
  const intro = INTRO_SECONDS;
  return {
    intro,
    castIntro: melee.from,
    melee: [intro, intro + meleeLen],
    castMelee: [melee.from, melee.to],
    rout: [intro + meleeLen, intro + meleeLen + routLen],
    castRout: [rout.from, rout.to],
    seconds: intro + meleeLen + routLen,
  };
}

/** Секунда раскадровки на секунде ролика TW. */
export function twToCast(tm: TwTiming, t: number): number {
  if (t <= tm.intro) return (Math.max(0, t) / tm.intro) * tm.castIntro;
  if (t <= tm.melee[1]) {
    const u = (t - tm.melee[0]) / Math.max(1e-6, tm.melee[1] - tm.melee[0]);
    return tm.castMelee[0] + u * (tm.castMelee[1] - tm.castMelee[0]);
  }
  return Math.min(tm.castRout[1], tm.castRout[0] + (t - tm.rout[0]));
}

/** И обратно: секунда ролика TW на секунде раскадровки. */
export function castToTw(tm: TwTiming, c: number): number {
  if (c <= tm.castIntro) return (Math.max(0, c) / Math.max(1e-6, tm.castIntro)) * tm.intro;
  if (c <= tm.castMelee[1]) {
    const u = (c - tm.castMelee[0]) / Math.max(1e-6, tm.castMelee[1] - tm.castMelee[0]);
    return tm.melee[0] + u * (tm.melee[1] - tm.melee[0]);
  }
  return Math.min(tm.seconds, tm.rout[0] + (c - tm.castRout[0]));
}

// ---------- Отряды ----------

export type Row = 'front' | 'rear' | 'reserve' | 'general';

/** Отряд: группа ядра на месте — сектор × вид бойца (docs/battle_tw.md, раздел 2). */
export interface TwUnit {
  id: number;
  side: Side;
  ours: boolean;
  sector: Sector;
  lane: Lane | null;
  row: Row;
  kind: UnitKind;
  /** Вид, которого в отряде больше всех, — лицо отряда (строй, знак на знамени). */
  face: string;
  /**
   * Рода отряда: у пеших сектора копья и пехота стоят одним строем полосами (одно знамя на сектор пеших), у
   * остальных — один род. У каждого рода свои бойцы, свои потери (`SideResult.sectors[s].final` по роду) и виды.
   */
  parts: UnitPart[];
  form: Form;
  /** Бойцов ядра на старте и к концу боя. */
  men: number;
  finalMen: number;
  figures: number;
  ranks: number;
  files: number;
  /** Ширина фронта и глубина строя, метры сцены. */
  width: number;
  depth: number;
  /** Середина передней шеренги на построении. */
  x: number;
  z: number;
  /** Куда смотрит: 0 — на +Z (наши), π — на −Z (чужие). */
  yaw: number;
  /** Когда побежал — секунда ролика TW; null — не бежал. */
  fleeAt: number | null;
  /** Знамя: у каждого отряда, у стаи — нет; у полководца — стяг. */
  banner: 'unit' | 'standard' | null;
  /** Первая фигура отряда в общих массивах фигур. */
  first: number;
  /** Куда идёт резерв, вошедший в бой: секунда и место. */
  commit: { at: number; x: number; z: number } | null;
  /** Залпы отряда лучников: секунды срыва стрел. */
  volleys: number[];
  /**
   * Погоня (`chaseTargets`): кого гонит отряд победителя и с какой секунды. Гонит только тот, кто быстрее бегущего
   * (`UNIT_STATS.speed`, правило погони ядра); остальные проходят шаг за бегущими и встают. null — не гонит.
   */
  chase: { target: number; from: number } | null;
  /**
   * Стоит на стене (docs/battle_tw.md, раздел 13): защитники на боевом ходу при штурме, стрелки на стене у ворот. Такой
   * отряд не сходится, не отходит между кругами и не пятится от давления — стена стоит; бежит — со стены вниз и к площади.
   */
  perch: boolean;
}

/** Род внутри отряда: бойцы на старте и к концу, виды племени и сколько фигур ему досталось. */
export interface UnitPart {
  kind: UnitKind;
  men: number;
  finalMen: number;
  faces: { id: string; men: number }[];
  figures: number;
}

/** Род отряда на поле: пешие сектора — один строй; лучники, лёгкая и латная конница — каждые своим. */
type Arm = 'foot' | 'archer' | 'cavalry' | 'heavy';
const armOf = (k: UnitKind): Arm => (k === 'spear' || k === 'infantry' ? 'foot' : k);

/** Залп в небе: кто, куда, когда сорвался и сколько стрел. */
export interface TwVolley {
  from: number;
  to: number;
  at: number;
  arrows: number;
}

export interface TwPlan {
  quality: Quality;
  /** Одна фигура — `k` бойцов. */
  k: number;
  us: Side;
  timing: TwTiming;
  seconds: number;
  units: TwUnit[];
  field: TwField;
  /** Сколько фигур всего и у каждой стороны. */
  figures: number;
  sideFigures: Record<Side, number>;
  /** Секунда первой сшибки (ролик TW) и места фронтов. */
  clashAt: number;
  /** Где стоит передняя шеренга стороны в сече (Z) и на построении. */
  contactZ: Record<Side, number>;
  deployZ: Record<Side, number>;
  /** Нападающий переходит реку (штраф переправы ядра). */
  crossing: Side | null;
  /** Сторона сломана — с этой секунды ролика бегут все её отряды; null — не ломалась. */
  brokenAt: Record<Side, number | null>;
  cast: Cast;
  // Фигуры — плоскими массивами: по ним кадр раскладывается без мусора.
  /** Отряд фигуры. */
  unitOf: Int32Array;
  /** Место в строю относительно середины передней шеренги, в осях отряда (вперёд — +z). */
  lx: Float32Array;
  lz: Float32Array;
  /** Шеренга фигуры, 0 — передняя. */
  rank: Int16Array;
  /** Вид фигуры — номер в `faceIds`: метка вида и род, в котором он стоит (ополчение бывает и пехотой, и лучником). */
  faceOf: Int16Array;
  faceIds: { id: string; kind: UnitKind }[];
  scale: Float32Array;
  tone: Float32Array;
  /** Своя фаза клипа: иначе отряд машет ногами в такт. */
  phase: Float32Array;
  /** Когда падает — секунда ролика TW; Infinity — доживает. */
  deathAt: Float32Array;
  /** Где лежит павший: место отряда в мгновение гибели (тела не уезжают с бегущими). */
  deadX: Float32Array;
  deadZ: Float32Array;
  deadYaw: Float32Array;
  /** Окна огня кругов в секундах ролика TW (`fireWindows`) — считаются один раз. */
  fire: [number, number][];
  /** Середина и ширина слотов полос на поле (слот 0 — наш левый фланг, у +X). */
  slotX: number[];
  slotW: number[];
  /** Порядок гибели фигур отряда: с `u.first` по `u.first + u.figures` — номера фигур в том порядке, в каком падают. */
  fallOrder: Int32Array;
  /**
   * Свой путь фигуры: резерв уходит в дыру понемногу (`reserve-committed` журнала), часть отряда — в обход (`moves`
   * итога боя). С секунды `goAt` фигура идёт своим путём — по дуге от места в строю к месту в полосе — и там стоит или
   * рубится. Infinity — фигура весь бой в строю своего отряда.
   */
  goAt: Float32Array;
  /** Путь: откуда (x, z), перегиб дуги (x, z), куда (x, z), разворот там, сколько идти — по `PATH` чисел на фигуру. */
  path: Float32Array;
  /** Каким путём: 1 — резерв в полосу, 2 — обход; в какую полосу пришла (своя нумерация стороны); рубится ли там. */
  goKind: Uint8Array;
  goLane: Int8Array;
  goFight: Uint8Array;
  /** Сколько фигур ушло в обход по ходам итога боя: ноль — ходов нет (запись старая или из сохранения) или не было. */
  flankers: number;
  /** Место боя: стена, ворота, город, лагерь, логово (`site.ts`); null — поле. */
  site: TwSite | null;
  /** Лестница штурмующего (номер в `site.ladders`, −1 — не на лестнице) и место в её очереди, снизу. */
  climb: Int16Array;
  climbQ: Uint8Array;
}

/** Чисел на путь фигуры в `TwPlan.path`. */
const PATH = 8;

export interface PlanInput {
  cast: Cast;
  result: BattleResult;
  faces: Record<Side, Face[]>;
  quality: Quality;
  /** Место боя по метке записи (`BattleRecord.site`); нет — поле. */
  site?: TwSiteKind | null;
}

/** Мера «наружу» для полосы-слота: 0 — наша левая (у +X), 2 — правая (у −X). */
const SLOT_SIGN: Record<number, number> = { 0: 1, 1: 0, 2: -1 };

/** Слот полосы на поле: наша полоса l — слот l, чужая — слот 2 − l (`facing` ядра). */
const slotOf = (ours: boolean, lane: Lane): number => (ours ? lane : 2 - lane);

const rowOfSector = (s: Sector): Row => (s === 'R' ? 'reserve' : s === 'A' || s === 'B' || s === 'C' ? 'front' : 'rear');
const laneOfSector = (s: Sector): Lane | null =>
  s === 'R' ? null : s === 'A' || s === 'D' ? 0 : s === 'B' || s === 'E' ? 1 : 2;

/** Отметки полководца у стороны: стяг ставится там, где полководец есть (событие `dice`, `pips` > 0). */
function hasGeneral(result: BattleResult, side: Side): boolean {
  return result.log.some((e) => e.id === 'dice' && (e.pips?.[side] ?? 0) > 0);
}

/** Штраф переправы нападающему: река между линиями. Снят манёвром — переправы на поле нет. */
function crossingOf(result: BattleResult): Side | null {
  for (const e of result.log) if (e.id === 'ground' && e.crossing > 0 && !e.lifted) return e.side;
  return null;
}

/** Штраф земли нападающему (лес, холмы): оборона стоит выше. */
function landPenalty(result: BattleResult): Side | null {
  for (const e of result.log) if (e.id === 'ground' && e.land > 0) return e.side;
  return null;
}

/** Секунда раскадровки на тике боя: тик ищет фазу, в чьи тики попал, как метки журнала. */
function castTimeOfTick(cast: Cast, tick: number): number {
  const span = cast.spans.find((s) => tick >= s.from && tick <= s.to) ?? cast.spans[cast.spans.length - 1];
  const len = Math.max(1, span.to - span.from + 1);
  return span.t0 + (span.t1 - span.t0) * clamp01((tick - span.from) / len);
}

export function buildPlan(input: PlanInput): TwPlan {
  const { cast, result, faces, quality } = input;
  const kind = input.site ?? null;
  // Лагерь стоит за рогатками (или частоколом логова) и ждёт: сходятся у них, а не в чистом поле.
  const camped = kind === 'sortie' || kind === 'camp' || kind === 'joint' || kind === 'lair';
  const laneGap = kind === 'wall' ? LANE_GAP_WALL : LANE_GAP;
  const spec = TW_SPEC[quality];
  const us = cast.us;
  const timing = twTiming(cast);
  const k = ratioOf(result.sides.attacker.total.initial, result.sides.defender.total.initial, spec.perSide);
  const seed = cast.seed | 0;

  // ---- отряды: сектор × род — ровно группа ядра; виды внутри — в армейской пропорции; фигуры по `k` ----
  interface Draft {
    side: Side;
    sector: Sector;
    parts: UnitPart[];
    men: number;
  }
  const drafts: Draft[] = [];
  for (const side of SIDES2) {
    const res = result.sides[side];
    for (const sector of SECTORS) {
      const cell = res.sectors[sector];
      const byArm = new Map<Arm, Draft>();
      for (const kind of UNIT_KINDS) {
        const men = Math.round(cell.initial[kind] ?? 0);
        if (men <= 0) continue;
        const fin = Math.max(0, Math.min(men, Math.round(cell.final[kind] ?? 0)));
        const mine = faces[side].filter((f) => f.kind === kind && f.men > 0);
        // Внутри рода сектор делится между видами в армейской пропорции — посекторной нет ни у кого.
        const split = mine.length ? spreadBy(mine.map((f) => f.men), men) : [men];
        const list = mine.length ? mine.map((f, i) => ({ id: f.id, men: split[i] })).filter((f) => f.men > 0) : [{ id: kind, men }];
        const arm = armOf(kind);
        const d = byArm.get(arm) ?? { side, sector, parts: [], men: 0 };
        d.parts.push({ kind, men, finalMen: fin, faces: list, figures: 0 });
        d.men += men;
        byArm.set(arm, d);
      }
      drafts.push(...byArm.values());
    }
  }
  const sideFigures = { attacker: 0, defender: 0 } as Record<Side, number>;
  const draftFigures = new Array<number>(drafts.length).fill(0);
  for (const side of SIDES2) {
    const idx = drafts.map((d, i) => (d.side === side ? i : -1)).filter((i) => i >= 0);
    const total = Math.min(spec.perSide, Math.round(result.sides[side].total.initial / k));
    const figs = spreadBy(idx.map((i) => drafts[i].men), Math.max(total, 0));
    // У отряда, где есть хоть один боец, хоть одна фигура: пустое место в строю читается «там никого нет».
    for (let j = 0; j < idx.length; j++) {
      if (figs[j] > 0) continue;
      let donor = -1;
      for (let m = 0; m < figs.length; m++) if (figs[m] > 1 && (donor < 0 || figs[m] > figs[donor])) donor = m;
      if (donor < 0) break;
      figs[donor] -= 1;
      figs[j] += 1;
    }
    idx.forEach((i, j) => {
      draftFigures[i] = figs[j];
    });
    sideFigures[side] = figs.reduce((a, b) => a + b, 0);
  }

  const units: TwUnit[] = [];
  drafts.forEach((d, i) => {
    const figures = draftFigures[i];
    if (figures <= 0) return;
    // Лицо отряда — род и вид, которых в нём больше всех: по ним строй (ополчение рыхлее, стая — не строй) и знак.
    const main = [...d.parts].sort((a, b) => b.men - a.men || UNIT_KINDS.indexOf(a.kind) - UNIT_KINDS.indexOf(b.kind))[0];
    const face = [...main.faces].sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1))[0].id;
    const form = formOf(main.kind, face);
    const count = Math.ceil(figures / FORM[form].cap);
    const figSplit = spreadBy(new Array(count).fill(1), figures);
    // Каждый род делится между частями отряда в доле их фигур — люди, потери и виды.
    const kindMen = d.parts.map((pt) => spreadBy(figSplit, pt.men));
    const kindFin = d.parts.map((pt, j) => spreadBy(kindMen[j], pt.finalMen));
    for (let p = 0; p < count; p++) {
      const n = figSplit[p];
      const ranks = ranksOf(form, n);
      const files = Math.max(1, Math.ceil(n / ranks));
      const f = FORM[form];
      const partMen = d.parts.map((_, j) => kindMen[j][p]);
      const partFigs = spreadBy(partMen, n);
      const parts: UnitPart[] = d.parts
        .map((pt, j) => {
          const fs = spreadBy(pt.faces.map((x) => x.men), partMen[j]);
          return {
            kind: pt.kind,
            men: partMen[j],
            finalMen: Math.min(partMen[j], kindFin[j][p]),
            faces: pt.faces.map((x, q) => ({ id: x.id, men: fs[q] })).filter((x) => x.men > 0),
            figures: partFigs[j],
          };
        })
        .filter((pt) => pt.men > 0 && pt.figures > 0);
      if (parts.length === 0) continue;
      const men = parts.reduce((a, pt) => a + pt.men, 0);
      units.push({
        id: units.length,
        side: d.side,
        ours: d.side === us,
        sector: d.sector,
        lane: laneOfSector(d.sector),
        row: rowOfSector(d.sector),
        kind: main.kind,
        face,
        parts,
        form,
        men,
        finalMen: parts.reduce((a, pt) => a + pt.finalMen, 0),
        figures: n,
        ranks,
        files,
        width: files * f.file,
        depth: Math.max(0, ranks - 1) * f.rank,
        x: 0,
        z: 0,
        yaw: d.side === us ? 0 : Math.PI,
        fleeAt: null,
        banner: form === 'pack' ? null : 'unit',
        first: 0,
        commit: null,
        volleys: [],
        chase: null,
        perch: false,
      });
    }
  });

  // ---- место на поле ----
  const crossing = crossingOf(result);
  const uphill = landPenalty(result);
  const sign = (side: Side): number => (side === us ? -1 : 1);
  // Обороняющийся ждёт у берега или на гребне: нападающему идти дальше (переправа, холм).
  // У ворот гарнизон ждёт перед ними; на стене и в лагере — стоит на месте, к ним идут дальше.
  const holds: Side | null = crossing ? other(crossing) : uphill ? other(uphill) : kind === 'gate' ? 'defender' : null;
  const deployZ = {} as Record<Side, number>;
  const contactZ = {} as Record<Side, number>;
  for (const side of SIDES2) {
    contactZ[side] = sign(side) * CONTACT_HALF;
    let d = holds === null ? DEPLOY_HALF : side === holds ? HOLD_HALF : DEPLOY_HALF + HOLD_HALF;
    if (kind === 'wall' || camped) d = side === 'defender' ? CONTACT_HALF : DEPLOY_HALF + HOLD_HALF + (kind === 'wall' ? 4 : 0);
    deployZ[side] = sign(side) * d;
  }

  // Ширина слота — по самому широкому ряду любой стороны в нём: фронты напротив друг друга.
  const slotW = [0, 0, 0];
  const rowWidth = (side: Side, slot: number, row: Row): number => {
    const list = units.filter((u) => u.side === side && u.row === row && u.lane !== null && slotOf(u.ours, u.lane) === slot);
    return list.reduce((n, u) => n + u.width, 0) + Math.max(0, list.length - 1) * UNIT_GAP;
  };
  for (let s = 0; s < 3; s++) {
    for (const side of SIDES2) for (const row of ['front', 'rear'] as Row[]) slotW[s] = Math.max(slotW[s], rowWidth(side, s, row));
    slotW[s] = Math.max(slotW[s], 6);
  }
  const slotX = [slotW[1] / 2 + laneGap + slotW[0] / 2, 0, -(slotW[1] / 2 + laneGap + slotW[2] / 2)];

  for (const side of SIDES2) {
    const s = sign(side);
    const ours = side === us;
    const sideUnits = units.filter((u) => u.side === side);
    const frontDepth = Math.max(0, ...sideUnits.filter((u) => u.row === 'front').map((u) => u.depth));
    const rearDepth = Math.max(0, ...sideUnits.filter((u) => u.row === 'rear').map((u) => u.depth));
    const rowZ: Record<'front' | 'rear' | 'reserve', number> = {
      front: deployZ[side],
      rear: deployZ[side] + s * (frontDepth + REAR_GAP),
      reserve: deployZ[side] + s * (frontDepth + REAR_GAP + rearDepth + RESERVE_GAP),
    };
    // Если второй линии нет, резерв встаёт сразу за первой.
    if (!sideUnits.some((u) => u.row === 'rear')) rowZ.reserve = deployZ[side] + s * (frontDepth + RESERVE_GAP);
    for (let slot = 0; slot < 3; slot++) {
      for (const row of ['front', 'rear'] as const) {
        const list = sideUnits.filter((u) => u.row === row && u.lane !== null && slotOf(ours, u.lane) === slot);
        lineUp(list, slotX[slot], SLOT_SIGN[slot], rowZ[row]);
      }
    }
    // Резерв — рядами не шире фронта: у большой армии он больше первой линии (ядро ставит в ряд полосы не больше W),
    // и одной шеренгой отрядов он уходил бы за края поля (самопроверка, большой бой).
    const reserve = sideUnits.filter((u) => u.row === 'reserve').sort((a, b) => FORM[a.form].outer - FORM[b.form].outer || a.id - b.id);
    const frontWidth = Math.max(24, slotW[0] + slotW[1] + slotW[2] + 2 * laneGap);
    let rz = rowZ.reserve;
    for (let i = 0; i < reserve.length; ) {
      const row: TwUnit[] = [];
      let w = 0;
      while (i < reserve.length && (row.length === 0 || w + UNIT_GAP + reserve[i].width <= frontWidth)) {
        w += (row.length ? UNIT_GAP : 0) + reserve[i].width;
        row.push(reserve[i++]);
      }
      lineUp(row, 0, 0, rz);
      rz += s * (Math.max(...row.map((u) => u.depth)) + REAR_GAP);
    }
    if (hasGeneral(result, side)) {
      const z = (sideUnits.some((u) => u.row === 'rear') ? rowZ.rear + s * (rearDepth + 2.6) : rowZ.front + s * (frontDepth + 2.6));
      units.push({
        id: units.length,
        side,
        ours,
        sector: 'B',
        lane: 1,
        row: 'general',
        kind: 'heavy',
        face: 'knight',
        parts: [{ kind: 'heavy', men: 0, finalMen: 0, faces: [{ id: 'knight', men: 1 }], figures: 1 }],
        form: 'heavy',
        men: 0,
        finalMen: 0,
        figures: 1,
        ranks: 1,
        files: 1,
        width: FORM.heavy.file,
        depth: 0,
        x: 0,
        z,
        yaw: ours ? 0 : Math.PI,
        fleeAt: null,
        banner: 'standard',
        first: 0,
        commit: null,
        volleys: [],
        chase: null,
        perch: false,
      });
    }
  }

  // ---- место: стена, город, лагерь (docs/battle_tw.md, раздел 13) ----
  const site = kind ? placeSite(kind, units, us, deployZ, contactZ, slotX, slotW, laneGap, TW_SPEC[quality], seed) : null;

  // ---- поле ----
  const xs = units.map((u) => Math.abs(u.x) + u.width / 2);
  const armyHalf = Math.max(12, ...xs);
  const zs = units.map((u) => u.z + Math.sign(u.z || 1) * u.depth);
  const field: TwField = {
    halfX: armyHalf + 34,
    minZ: Math.min(-30, ...zs) - 34,
    maxZ: Math.max(30, ...zs) + 34,
    seed,
    land: cast.ground.land,
    hill: null,
    river: null,
    woods: cast.ground.woods,
    road: cast.ground.road,
    ridge: null,
    winter: cast.ground.winter,
    calm: null,
  };
  const defender: Side = 'defender';
  const sD = sign(defender);
  if (uphill || cast.ground.land === 'hills') {
    const high = uphill ? other(uphill) : defender;
    field.hill = { h: 2.4, side: sign(high) as 1 | -1, from: -4, to: HOLD_HALF + 10 };
    // Стена на штурме стоит на гребне: склон — перед ней, к стене идут в гору.
    if (kind === 'wall' && high === defender) field.hill = { h: 2.4, side: sD as 1 | -1, from: -14, to: -2.5 };
  }
  if (site) fitSite(site, field, units);
  if (crossing) {
    // Река между линиями, у берега обороны: нападающий переходит её на сближении и бьётся из воды.
    const sC = sign(crossing);
    const half = 2.2;
    field.river = { z: sC * (0.25 + half), half, ford: cast.ground.ford, fordX: 0, fordHalf: 5, between: true };
  } else if (cast.ground.river && !(site?.wall && site.wall.side === 'attacker')) {
    // Переправы ядро не штрафовало (снята манёвром или не было): река за спиной нападающего.
    const sA = sign('attacker');
    const back = Math.max(...units.filter((u) => u.side === 'attacker').map((u) => Math.abs(u.z) + u.depth));
    field.river = { z: sA * (back + 9), half: 3, ford: cast.ground.ford, fordX: 0, fordHalf: 5, between: false };
  }
  if (cast.ground.ridge && !site) {
    const back = Math.max(...units.filter((u) => u.side === defender).map((u) => Math.abs(u.z) + u.depth));
    field.ridge = { side: sD as 1 | -1, at: sD * (back + 7) };
  }

  // ---- время: слом, резерв, залпы ----
  const brokenAt = { attacker: null, defender: null } as Record<Side, number | null>;
  for (const side of SIDES2) {
    const tick = result.sides[side].brokenAt;
    if (tick !== null) brokenAt[side] = castToTw(timing, castTimeOfTick(cast, tick));
  }
  for (const u of units) {
    const c = cast.sectors.find((x) => x.side === u.side && x.sector === u.sector);
    const own = c?.brokenAt != null ? castToTw(timing, c.brokenAt) : null;
    const all = brokenAt[u.side];
    u.fleeAt = own !== null && all !== null ? Math.min(own, all) : (own ?? all);
    if (u.row === 'general') u.fleeAt = all;
  }
  const clash = cast.spans.find((s) => s.phase === 'clash');
  const clashAt = castToTw(timing, clash ? clash.t0 : timing.castIntro);

  // ---- фигуры ----
  const figures = units.reduce((n, u) => n + u.figures, 0);
  const unitOf = new Int32Array(figures);
  const lx = new Float32Array(figures);
  const lz = new Float32Array(figures);
  const rank = new Int16Array(figures);
  const faceOf = new Int16Array(figures);
  const faceIds: { id: string; kind: UnitKind }[] = [];
  const faceIndex = (id: string, kind: UnitKind): number => {
    let i = faceIds.findIndex((x) => x.id === id && x.kind === kind);
    if (i < 0) i = faceIds.push({ id, kind }) - 1;
    return i;
  };
  const scale = new Float32Array(figures);
  const tone = new Float32Array(figures);
  const phase = new Float32Array(figures);
  const deathAt = new Float32Array(figures).fill(Infinity);
  const fallOrder = new Int32Array(figures);
  let at = 0;
  for (const u of units) {
    u.first = at;
    const f = FORM[u.form];
    const order: { i: number; key: number }[] = [];
    for (let i = 0; i < u.figures; i++) {
      const r = Math.floor(i / u.files);
      const inRank = r === u.ranks - 1 ? u.figures - r * u.files : u.files;
      const c = i - r * u.files;
      const h1 = hash(seed, u.id * 4099 + i, 1);
      const h2 = hash(seed, u.id * 4099 + i, 2);
      const j = at + i;
      unitOf[j] = u.id;
      lx[j] = (c - (inRank - 1) / 2) * f.file + (h1 - 0.5) * 2 * f.jitter * f.file;
      lz[j] = -r * f.rank + (h2 - 0.5) * 2 * f.jitter * f.rank;
      rank[j] = r;
      scale[j] = 1 + (hash(seed, u.id * 4099 + i, 3) - 0.5) * 0.08;
      tone[j] = (hash(seed, u.id * 4099 + i, 4) - 0.5) * 0.12;
      phase[j] = hash(seed, u.id * 4099 + i, 5) * 10;
      // Падают с передних шеренг, но не строго по одной: шеренга — ключ, разброс — полторы шеренги.
      order.push({ i: j, key: r + hash(seed, u.id * 4099 + i, 6) * 1.5 });
    }
    order.sort((a, b) => a.key - b.key || a.i - b.i);
    order.forEach((o, k) => {
      fallOrder[at + k] = o.i;
    });
    // Виды отряда — полосами от середины: тяжёлые в середине строя, лёгкие к краям, как стоят полки одного рода.
    const stripes = u.parts
      .flatMap((pt) => {
        const counts = spreadBy(pt.faces.map((x) => x.men), pt.figures);
        return pt.faces.map((x, i) => ({ id: x.id, kind: pt.kind, n: counts[i], w: gearOf(x.id) }));
      })
      .sort((a, b) => b.w - a.w || UNIT_KINDS.indexOf(a.kind) - UNIT_KINDS.indexOf(b.kind) || (a.id < b.id ? -1 : 1));
    const byCenter: number[] = [];
    for (let i = 0; i < u.figures; i++) byCenter.push(at + i);
    byCenter.sort((a, b) => Math.abs(lx[a]) - Math.abs(lx[b]) || lz[b] - lz[a] || a - b);
    let pos = 0;
    for (const f of stripes) for (let n = 0; n < f.n && pos < byCenter.length; n++) faceOf[byCenter[pos++]] = faceIndex(f.id, f.kind);
    // Гибель — по роду: у каждого рода свои потери в итоге боя, а темп — сектора.
    for (const pt of u.parts) {
      const mine = order.map((o) => o.i).filter((i) => faceIds[faceOf[i]].kind === pt.kind);
      deathTimes(u, pt, cast, timing, mine, deathAt);
    }
    at += u.figures;
  }

  // Залпы — после фигур: сколько стрел, считает живых.
  const plan: TwPlan = {
    quality,
    k,
    us,
    timing,
    seconds: timing.seconds,
    units,
    field,
    figures,
    sideFigures,
    clashAt,
    contactZ,
    deployZ,
    crossing,
    brokenAt,
    cast,
    unitOf,
    lx,
    lz,
    rank,
    faceOf,
    faceIds,
    scale,
    tone,
    phase,
    deathAt,
    deadX: new Float32Array(figures),
    deadZ: new Float32Array(figures),
    deadYaw: new Float32Array(figures),
    fire: [],
    slotX,
    slotW,
    fallOrder,
    goAt: new Float32Array(figures).fill(Infinity),
    path: new Float32Array(figures * PATH),
    goKind: new Uint8Array(figures),
    goLane: new Int8Array(figures).fill(-1),
    goFight: new Uint8Array(figures),
    flankers: 0,
    site,
    climb: new Int16Array(figures).fill(-1),
    climbQ: new Uint8Array(figures),
  };
  plan.fire = fireWindows(plan);
  // Штурм: лестницы, таран и ворота — по журналу (кто когда дрогнул); до путей фигур — лезущие стоят на лестницах.
  if (site?.kind === 'wall') siegeWall(plan);
  // Пути фигур — до залпов: резерв-лучник стреляет, когда вошёл (`commit`), а лучники в обход не ходят.
  trickleReserve(plan);
  plan.flankers = flankMoves(plan, result);
  chaseTargets(plan);
  if (site?.kind === 'wall') siegeStorm(plan);
  for (const u of units) if (u.form === 'bow') u.volleys = volleyTimes(plan, u);
  arrowDeaths(plan);
  // Где лежит павший: место фигуры в мгновение гибели — в строю, на своём пути или на бегу.
  const q = figureState();
  for (let i = 0; i < figures; i++) {
    if (!Number.isFinite(deathAt[i])) continue;
    figurePose(plan, i, deathAt[i], null, q);
    plan.deadX[i] = q.x;
    plan.deadZ[i] = q.z;
    // Павшие падают не строем: каждый — со своим поворотом тела, от сида и номера.
    plan.deadYaw[i] = q.yaw + (hash(seed, i, 24) - 0.5) * 1.8;
  }
  return plan;
}

// ---------- Место боя (docs/battle_tw.md, раздел 13) ----------

/** Прямоугольник строя отряда на построении: от передней шеренги назад на глубину. */
function unitRect(u: TwUnit): Rect {
  const back = u.ours ? -1 : 1;
  const za = u.z;
  const zb = u.z + back * u.depth;
  return { x0: u.x - u.width / 2, x1: u.x + u.width / 2, z0: Math.min(za, zb), z1: Math.max(za, zb) };
}

/** Насколько далеко строй стороны уходит назад от линии соприкосновения (по своей оси). */
function sideBack(units: readonly TwUnit[], side: Side, sgn: number): number {
  return Math.max(DEPLOY_HALF, ...units.filter((u) => u.side === side).map((u) => sgn * u.z + u.depth));
}

/**
 * Место боя: где стена и ворота, кто на стене, где город за ней и лагерь. Только место — время (лестницы, таран, выбитые
 * ворота) ставит режиссура штурма по журналу (`siegeWall`), когда известны слом и потери.
 */
function placeSite(
  kind: TwSiteKind,
  units: TwUnit[],
  us: Side,
  deployZ: Record<Side, number>,
  contactZ: Record<Side, number>,
  slotX: number[],
  slotW: number[],
  laneGap: number,
  spec: { houses: number; tents: number },
  seed: number,
): TwSite {
  const sign = (side: Side): number => (side === us ? -1 : 1);
  const armyHalf = Math.max(12, ...units.map((u) => Math.abs(u.x) + u.width / 2));
  const halfX = armyHalf + 18;
  const site: TwSite = { kind, wall: null, ladders: [], ram: null, houses: [], square: null, street: null, camp: null };
  // Где стоит город (за чьим строем) и чей он: у удара по лагерю город наш, а стоит он за лагерем.
  const town: Side | null = kind === 'sortie' ? 'attacker' : kind === 'lair' ? null : 'defender';
  const owner: Side | null = kind === 'camp' || kind === 'joint' ? 'attacker' : town;
  // Лагерь — за строем обороны: шатры, костры, рогатки по линии соприкосновения (у логова — частокол).
  if (kind === 'sortie' || kind === 'camp' || kind === 'joint' || kind === 'lair') {
    const sD = sign('defender');
    site.camp = campOf(kind, armyHalf, sD * (sideBack(units, 'defender', sD) + 1), sD as 1 | -1, contactZ.defender * 0.1, spec.tents, seed);
  }
  if (town) {
    const sT = sign(town);
    let z: number;
    if (kind === 'wall') z = 0;
    else if (site.camp && town === 'defender') z = sT * (Math.max(Math.abs(site.camp.z0), Math.abs(site.camp.z1)) + 8);
    else {
      // У ворот и на вылазке стена — за строем своих: вышли из ворот и встали перед ними. Стрелки — на стене (ниже).
      const away = units.filter((u) => u.side === town && !(kind === 'gate' && u.form === 'bow' && u.row !== 'reserve'));
      z = sT * (sideBack(away, town, sT) + 6);
    }
    const between = [slotX[0] - slotW[0] / 2 - laneGap / 2, slotX[2] + slotW[2] / 2 + laneGap / 2, slotW[1] / 2 + laneGap / 2, -(slotW[1] / 2 + laneGap / 2)];
    const wall: TwWall = {
      z,
      inward: sT as 1 | -1,
      base: 0,
      top: WALL_TOP,
      thick: WALL_THICK,
      halfX,
      gateX: slotX[1],
      gateHalf: GATE_HALF,
      // Ворота: у ворот, на вылазке и в совместном ударе — открыты (вышли из них); на штурме — пока не выбиты.
      gateAt: kind === 'gate' || kind === 'sortie' || kind === 'joint' ? -Infinity : null,
      towers: wallTowers(halfX, slotX[1], kind === 'wall' ? between.slice(2) : [], seed),
      side: owner!,
    };
    site.wall = wall;
    if (kind === 'wall') {
      // Штурм: первая линия обороны — на боевом ходу (передние шеренги наверху, задние у стены изнутри). Конница на
      // стену не лезет: ждёт за ней, в межпорядке, — к воротам.
      for (const u of units) {
        if (u.side !== 'defender' || u.row !== 'front') continue;
        u.perch = true;
        if (mounted(u)) u.z = sT * (WALL_THICK + 1.4);
      }
    }
    if (kind === 'gate') {
      // Стрелки гарнизона — на стене над воротами: по две шеренги вдоль хода, по обе стороны надвратной.
      const bows = units.filter((u) => u.side === 'defender' && u.form === 'bow' && u.row !== 'reserve').sort((a, b) => a.id - b.id);
      let left = wall.gateX - GATEHOUSE / 2 - 1;
      let right = wall.gateX + GATEHOUSE / 2 + 1;
      bows.forEach((u, i) => {
        u.ranks = Math.min(2, u.figures);
        u.files = Math.max(1, Math.ceil(u.figures / u.ranks));
        u.width = u.files * FORM.bow.file;
        u.depth = (u.ranks - 1) * 0.7;
        u.perch = true;
        u.z = z + sT * (PARAPET_IN + 0.12);
        if (i % 2 === 0) {
          u.x = right + u.width / 2;
          right += u.width + 1.5;
        } else {
          u.x = left - u.width / 2;
          left -= u.width + 1.5;
        }
      });
      wall.halfX = Math.max(halfX, right + 6, -left + 6);
    }
    // Город за стеной: улица от ворот, площадь, дома — не там, где стоят люди.
    const inside = (zz: number): number => sT * zz;
    const ownBack = kind === 'wall' ? sideBack(units, 'defender', sT) : 0;
    const sqDist = kind === 'wall' ? ownBack + SQUARE_R + 4 : wall.thick + POMERIUM + 14;
    const square = { x: wall.gateX, z: z + inside(sqDist), r: SQUARE_R };
    site.square = square;
    site.street = { x: wall.gateX, half: STREET_HALF, z0: z, z1: square.z };
    const avoid: Rect[] = [];
    const mine = units.filter((u) => u.side === town);
    if (mine.length && kind === 'wall') {
      const rs = mine.map(unitRect);
      avoid.push({ x0: Math.min(...rs.map((r) => r.x0)) - 1.5, x1: Math.max(...rs.map((r) => r.x1)) + 1.5, z0: Math.min(...rs.map((r) => r.z0)) - 1.5, z1: Math.max(...rs.map((r) => r.z1)) + 1.5 });
    }
    for (const u of mine) if (u.perch) avoid.push(unitRect(u));
    site.houses = townHouses(wall, sqDist + SQUARE_R + 8 - wall.thick - POMERIUM, avoid, square, spec.houses, seed);
  }
  return site;
}

/** Парапет изнутри: передняя шеренга на стене стоит сразу за ним. */
const PARAPET_IN = 0.32;

/** Поле под место: ровно под городом, лес вокруг логова, края поля — с городом и лагерем; высота подошвы стены. */
function fitSite(site: TwSite, field: TwField, units: readonly TwUnit[]): void {
  const w = site.wall;
  if (site.kind === 'lair') field.woods = true;
  if (w) {
    field.calm = { z: w.z - w.inward * 4, dir: w.inward };
    field.halfX = Math.max(field.halfX, w.halfX + 8);
    const far = (site.square?.z ?? w.z) + w.inward * (SQUARE_R + 10);
    field.minZ = Math.min(field.minZ, far - 4, w.z - 4);
    field.maxZ = Math.max(field.maxZ, far + 4, w.z + 4);
    w.base = heightAt(field, w.gateX, w.z + w.inward * (w.thick / 2));
  }
  const c = site.camp;
  if (c) {
    field.minZ = Math.min(field.minZ, c.z0 - 10);
    field.maxZ = Math.max(field.maxZ, c.z1 + 10);
  }
  void units;
}

/** Мировое место фигуры в строю отряда на построении. */
const deployX = (plan: TwPlan, u: TwUnit, i: number): number => u.x + plan.lx[i] * Math.cos(u.yaw) + plan.lz[i] * Math.sin(u.yaw);

/**
 * Штурм стены: лестницы и кто на них лезет, таран и когда выбиты ворота. Всё — из журнала: лестницы встают к сшибке;
 * ворота выбиты, когда дрогнула оборона у ворот (сектор слома, `fleeAt`) или сломана вся оборона, и только если таран к
 * тому времени ещё у ворот. Оборона устояла — ворота целы, сколько бы таран ни бил (`site.test.ts`).
 */
function siegeWall(plan: TwPlan): void {
  const site = plan.site!;
  const w = site.wall!;
  const att: Side = w.side === 'defender' ? 'attacker' : 'defender';
  const seed = plan.cast.seed;
  for (const u of plan.units) {
    if (u.side !== att || u.row !== 'front' || u.form === 'pack') continue;
    const x0 = u.x - u.width / 2 + 0.7;
    const x1 = u.x + u.width / 2 - 0.7;
    if (x1 <= x0) continue;
    const n = Math.max(1, Math.floor((x1 - x0) / LADDER_STEP) + 1);
    const lad: number[] = [];
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1);
      if (Math.abs(x - w.gateX) < GATEHOUSE / 2 + 0.9) continue;
      if (w.towers.some((t) => Math.abs(x - t.x) < t.size / 2 + 0.6)) continue;
      lad.push(site.ladders.push({ x, unit: u.id, raiseAt: plan.clashAt - 0.3 + hash(seed, u.id * 31 + k, 81) * 0.9, queue: [] }) - 1);
    }
    if (lad.length === 0) continue;
    // Очередь на лестницу — ближние передних шеренг; знаменосец не лезет.
    const bearer = bearerOf(plan, u);
    const cands: { i: number; l: number; key: number }[] = [];
    for (let i = u.first; i < u.first + u.figures; i++) {
      if (i === bearer || plan.rank[i] > 2) continue;
      const x = deployX(plan, u, i);
      let best = -1;
      let bd = Infinity;
      for (const l of lad) {
        const d = Math.abs(site.ladders[l].x - x);
        if (d < bd) {
          bd = d;
          best = l;
        }
      }
      if (best >= 0 && bd < LADDER_STEP / 2) cands.push({ i, l: best, key: plan.rank[i] * 10 + bd });
    }
    cands.sort((a, b) => a.key - b.key || a.i - b.i);
    for (const c of cands) {
      const l = site.ladders[c.l];
      if (l.queue.length >= LADDER_QUEUE) continue;
      plan.climb[c.i] = c.l;
      plan.climbQ[c.i] = l.queue.length;
      l.queue.push(c.i);
    }
  }
  // Таран — у отряда первой линии напротив ворот.
  const ramUnit = plan.units
    .filter((u) => u.side === att && u.row === 'front' && u.form !== 'pack' && u.form !== 'bow' && Math.abs(u.x - w.gateX) < u.width / 2 + 1)
    .sort((a, b) => Math.abs(a.x - w.gateX) - Math.abs(b.x - w.gateX))[0];
  // Ворота выбиты, когда дрогнула оборона у ворот или сломана вся — и таран (или штурмующие) ещё у ворот.
  const guards = plan.units.filter((u) => u.side === w.side && u.row === 'front' && Math.abs(u.x - w.gateX) < u.width / 2 + GATE_HALF);
  const cands = [...guards.map((u) => u.fleeAt), plan.brokenAt[w.side]].filter((x): x is number => x !== null && x > plan.clashAt);
  const broke = cands.length ? Math.min(...cands) : null;
  const leave = ramUnit ? (ramUnit.fleeAt ?? plan.brokenAt[att]) : plan.brokenAt[att];
  w.gateAt = broke !== null && broke < plan.seconds && (leave === null || broke < leave) ? broke : null;
  if (ramUnit) {
    const hits: number[] = [];
    const stop = Math.min(w.gateAt ?? Infinity, leave ?? Infinity, plan.seconds);
    for (let t = plan.clashAt + 0.6; t < stop - 0.2; t += RAM_PERIOD) hits.push(t);
    if (w.gateAt !== null) hits.push(w.gateAt);
    site.ram = { unit: ramUnit.id, x: w.gateX, hits };
  }
}

/**
 * Штурм после пролома: через выбитые ворота штурмующие идут потоком в город — по улице к площади; где на стене дрогнула
 * оборона (сектор бежит или сломана вся), лезут через стену по своим лестницам — по одному, сколько лестница пропустит.
 * Кто и сколько — живые этого отряда в миг пролома; падают они по журналу, как и падали бы.
 */
function siegeStorm(plan: TwPlan): void {
  const site = plan.site!;
  const w = site.wall!;
  const att: Side = w.side === 'defender' ? 'attacker' : 'defender';
  const seed = plan.cast.seed;
  const q = figureState();
  // Погони через стену нет: штурмующие снаружи остаются у стены.
  for (const u of plan.units) if (u.side === att) u.chase = null;
  const all = plan.brokenAt[w.side];
  if (w.gateAt !== null && w.gateAt > 0) {
    const gateAt = w.gateAt;
    const deep = all !== null && all <= gateAt + 1;
    const pour: { i: number; u: TwUnit; d: number }[] = [];
    for (const u of plan.units) {
      if (u.side !== att || u.row === 'reserve' || u.row === 'general' || u.form === 'bow') continue;
      if (Math.abs(u.x - w.gateX) > plan.slotW[1] / 2 + 1.5) continue;
      if (u.fleeAt !== null && u.fleeAt <= gateAt) continue;
      for (let i = u.first; i < u.first + u.figures; i++) {
        if (plan.deathAt[i] <= gateAt + 0.4 || Number.isFinite(plan.goAt[i]) || plan.climb[i] >= 0) continue;
        figurePose(plan, i, gateAt, null, q);
        pour.push({ i, u, d: Math.hypot(q.x - w.gateX, outOf(w, q.z)) });
      }
    }
    pour.sort((a, b) => a.d - b.d || a.i - b.i);
    pour.forEach((e, k) => {
      const at = gateAt + 0.3 + k * 0.11;
      if (at >= plan.seconds || (e.u.fleeAt !== null && e.u.fleeAt <= at)) return;
      const x1 = w.gateX + (hash(seed, e.i, 82) - 0.5) * 2 * (STREET_HALF - 0.5);
      const z1 = w.z + w.inward * (w.thick + 2 + hash(seed, e.i, 83) * (deep ? 16 : 6));
      figurePose(plan, e.i, at, null, q);
      // Дуга через проезд: середина пути — в воротах.
      const gx = w.gateX + (hash(seed, e.i, 84) - 0.5) * w.gateHalf;
      const gz = w.z + w.inward * (w.thick * 0.5);
      const bend: [number, number] = [2 * gx - 0.5 * (q.x + x1), 2 * gz - 0.5 * (q.z + z1)];
      detour(plan, e.i, at, x1, z1, e.u.yaw, RUN_SPEED, bend);
      plan.goKind[e.i] = 3;
      plan.goLane[e.i] = 1;
      plan.goFight[e.i] = 1;
    });
  }
  // Через стену — по лестницам отряда, где оборона напротив дрогнула.
  for (const u of plan.units) {
    if (u.side !== att) continue;
    const mine = site.ladders.map((l, k) => ({ l, k })).filter((e) => e.l.unit === u.id);
    if (mine.length === 0) continue;
    const facing = plan.units.filter((d) => d.side === w.side && d.row === 'front' && Math.abs(d.x - u.x) < (d.width + u.width) / 2);
    const times = [...facing.map((d) => d.fleeAt), all].filter((x): x is number => x !== null && x > plan.clashAt);
    if (times.length === 0) continue;
    const over = Math.min(...times);
    if (over >= plan.seconds || (u.fleeAt !== null && u.fleeAt <= over)) continue;
    const per = new Map<number, { i: number; key: number }[]>();
    for (let i = u.first; i < u.first + u.figures; i++) {
      if (plan.deathAt[i] <= over + 0.5 || Number.isFinite(plan.goAt[i])) continue;
      let best = mine[0];
      if (plan.climb[i] >= 0) best = mine.find((e) => e.k === plan.climb[i]) ?? best;
      else {
        const x = deployX(plan, u, i);
        for (const e of mine) if (Math.abs(e.l.x - x) < Math.abs(best.l.x - x)) best = e;
      }
      const list = per.get(best.k) ?? [];
      list.push({ i, key: plan.climb[i] >= 0 ? plan.climbQ[i] - 10 : plan.rank[i] + hash(seed, i, 85) });
      per.set(best.k, list);
    }
    for (const [k, list] of per) {
      const l = site.ladders[k];
      // Первым — тот, кто уже на лестнице, выше всех — первый в её очереди; потом ждущие внизу, передние раньше.
      list.sort((a, b) => a.key - b.key || a.i - b.i);
      list.forEach((e, j) => {
        const at = over + 0.2 + j * OVER_GAP;
        if (at >= plan.seconds || (u.fleeAt !== null && u.fleeAt <= at)) return;
        figurePose(plan, e.i, at, null, q);
        const x1 = l.x + (hash(seed, e.i, 86) - 0.5) * 2.6;
        const z1 = w.z + w.inward * (w.thick + 1.2 + (j % 5) * 0.75 + hash(seed, e.i, 87));
        const gz = w.z - w.inward * 0.05;
        const bend: [number, number] = [2 * l.x - 0.5 * (q.x + x1), 2 * gz - 0.5 * (q.z + z1)];
        detour(plan, e.i, at, x1, z1, u.yaw, CLIMB_SPEED * 1.6, bend);
        plan.goKind[e.i] = 4;
        plan.goLane[e.i] = u.lane ?? 1;
        plan.goFight[e.i] = 1;
      });
    }
  }
}

/** Ряд отрядов слева направо в слоте: внутренние к середине армии, конница — к краю (`FormSpec.outer`). */
function lineUp(list: TwUnit[], cx: number, outward: number, z: number): void {
  if (list.length === 0) return;
  const sorted = [...list].sort((a, b) => FORM[a.form].outer - FORM[b.form].outer || a.id - b.id);
  const total = sorted.reduce((n, u) => n + u.width, 0) + (sorted.length - 1) * UNIT_GAP;
  if (outward !== 0) {
    // Слот на краю: от середины армии наружу.
    let x = cx - outward * (total / 2);
    for (const u of sorted) {
      u.x = x + outward * (u.width / 2);
      u.z = z;
      x += outward * (u.width + UNIT_GAP);
    }
    return;
  }
  // Середина: первый — в центре, дальше по очереди вправо и влево.
  let right = cx;
  let left = cx;
  sorted.forEach((u, i) => {
    if (i === 0) {
      u.x = cx;
      right = cx + u.width / 2 + UNIT_GAP;
      left = cx - u.width / 2 - UNIT_GAP;
    } else if (i % 2 === 1) {
      u.x = right + u.width / 2;
      right += u.width + UNIT_GAP;
    } else {
      u.x = left - u.width / 2;
      left -= u.width + UNIT_GAP;
    }
    u.z = z;
  });
  // Ряд, сложенный неровно вправо-влево, сдвигается в середину слота.
  const mid = (right + left) / 2 - cx;
  for (const u of sorted) u.x -= mid;
}

/**
 * Когда падает каждая фигура отряда. Сколько бойцов сектор потерял к секунде — потери журнала по фазам
 * (`sectorLost`), а не своя мерка; без потерь по секторам (старая запись) — общий ход потерь стороны. Отряд
 * несёт долю потерь сектора по своим людям, фигура падает, когда выбитых бойцов на ней набралось на `k`.
 */
function deathTimes(u: TwUnit, pt: UnitPart, cast: Cast, tm: TwTiming, order: number[], out: Float32Array): void {
  if (u.row === 'general' || pt.men <= 0) return;
  const dead = pt.men - pt.finalMen;
  if (dead <= 0) return;
  const figsDead = Math.min(order.length, Math.round((order.length * dead) / pt.men));
  if (figsDead <= 0) return;
  const lostAll = cast.detailed ? sectorLost(cast.spans, u.side, u.sector, Infinity) : 0;
  const share = (c: number): number =>
    lostAll > 0 ? clamp01(sectorLost(cast.spans, u.side, u.sector, c) / lostAll) : lossProgress(cast.spans, u.side, c);
  // Выборка шагом в двадцатую секунды: падение — событие кадра, точнее не нужно.
  let j = 0;
  for (let t = 0; t <= tm.seconds + 1e-6 && j < figsDead; t += 0.05) {
    const down = Math.round(figsDead * share(twToCast(tm, t)));
    while (j < down && j < figsDead) out[order[j++]] = t;
  }
  while (j < figsDead) out[order[j++]] = tm.seconds;
}

/** Огонь стороны: окна фаз огня в секундах ролика TW (стрельба — `ranged` и `approach` в каждом круге). */
export function fireWindows(plan: TwPlan): [number, number][] {
  const out: [number, number][] = [];
  for (const s of plan.cast.spans) {
    if (s.phase !== 'ranged' && s.phase !== 'approach') continue;
    const a = castToTw(plan.timing, s.t0);
    const b = castToTw(plan.timing, s.t1);
    const last = out[out.length - 1];
    if (last && a - last[1] < 0.3) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Когда срываются залпы отряда лучников. Стреляют они в огне каждого круга, а в сече — через головы своих, в
 * полсилы (`FIRE_AFTER_CONTACT` ядра): залп через раз. Пока жив хоть один и отряд не побежал.
 */
function volleyTimes(plan: TwPlan, u: TwUnit): number[] {
  const out: number[] = [];
  const fire = plan.fire;
  const end = Math.min(u.fleeAt ?? Infinity, plan.timing.rout[0]);
  // Резерв не стреляет, пока не вошёл в бой: он вне строя (EU4).
  const from = u.row === 'reserve' ? (u.commit ? u.commit.at + 4 : Infinity) : 0;
  const offset = hash(plan.cast.seed, u.id, 9) * 0.6;
  for (let t = 0.6 + offset; t < end; t += SHOOT_PERIOD) {
    const inFire = fire.some(([a, b]) => t >= a && t <= b);
    const inMelee = t >= plan.clashAt;
    if (t < from || (!inFire && !inMelee)) continue;
    if (!inFire && Math.round(t / SHOOT_PERIOD) % 2 === 1) continue;
    if (aliveFigures(plan, u, t) <= 0) break;
    out.push(t);
  }
  return out;
}

// ---------- Свой путь фигуры: резерв понемногу, обход, погоня ----------

/**
 * Знаменосец отряда — фигура ближе всех к середине строя, во второй шеренге, если она есть. Одна дверь: знамя
 * (`banners.ts`) стоит над ним, а резерв и обход уводят его последним — знамя уходит с отрядом, а не с одиночкой.
 */
export function bearerOf(plan: TwPlan, u: TwUnit): number {
  const want = -Math.min(1, u.ranks - 1) * (u.depth / Math.max(1, u.ranks - 1));
  let best = u.first;
  let bestD = Infinity;
  for (let i = u.first; i < u.first + u.figures; i++) {
    const d = Math.abs(plan.lx[i]) + Math.abs(plan.lz[i] - want);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Пустить фигуру своим путём с секунды `at`: от того места, где она в этот миг (строй отряда или прежний путь), по дуге
 * через `bend` к месту `x1, z1`, со скоростью `speed`; там она смотрит по `yaw1`. `bend` — null: дуга прямая.
 */
function detour(plan: TwPlan, i: number, at: number, x1: number, z1: number, yaw1: number, speed: number, bend: [number, number] | null): void {
  const q = figurePose(plan, i, at, null, figureState());
  const cx = bend ? bend[0] : (q.x + x1) / 2;
  const cz = bend ? bend[1] : (q.z + z1) / 2;
  // Длина дуги — ломаной в восемь звеньев: точнее не нужно, по ней только время в пути.
  let len = 0;
  let px = q.x;
  let pz = q.z;
  for (let k = 1; k <= 8; k++) {
    const u = k / 8;
    const x = (1 - u) * (1 - u) * q.x + 2 * (1 - u) * u * cx + u * u * x1;
    const z = (1 - u) * (1 - u) * q.z + 2 * (1 - u) * u * cz + u * u * z1;
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  const o = i * PATH;
  plan.path.set([q.x, q.z, cx, cz, x1, z1, yaw1, Math.max(0.2, len / speed)], o);
  plan.goAt[i] = at;
}

/** Глубина первой линии стороны — до последней шеренги самого глубокого отряда. */
const frontDepthOf = (plan: TwPlan, side: Side): number =>
  Math.max(0, ...plan.units.filter((x) => x.side === side && x.row === 'front').map((x) => x.depth));

/**
 * Резерв входит в дыры понемногу, как пишет ядро (`reserve-committed`: людей и полоса за фазу). Отряд резерва не
 * трогается целым блоком: в полосу уходит ровно столько его фигур, сколько людей журнал туда ввёл (в долях `k`), — из
 * всех отрядов резерва в их доле, как ядро снимает резерв по родам (`setup.reinforceInto`), струйкой с начала фазы. Уходят
 * первыми те, кто первыми и падёт (`fallOrder`): павший резерва лежит у линии, а не в строю позади неё. Лучники встают во
 * вторую линию, пешие и конные — за первой; полосу, где первая линия уже бежала, резерв занимает на линии и рубится.
 */
function trickleReserve(plan: TwPlan): void {
  const { cast, timing } = plan;
  for (const side of SIDES2) {
    const pool = plan.units.filter((u) => u.side === side && u.row === 'reserve').sort((a, b) => a.id - b.id);
    if (pool.length === 0) continue;
    const ours = side === plan.us;
    const s = ours ? -1 : 1;
    const frontDepth = frontDepthOf(plan, side);
    // Очередь — все отряды резерва вперемешку в их доле: фигура k отряда из n стоит в очереди на (k + ½) / n.
    // Знаменосец — в самый хвост очереди: знамя уходит последним, с отрядом, а не с первым ушедшим.
    const queue = pool
      .flatMap((u) => {
        const bearer = bearerOf(plan, u);
        return Array.from({ length: u.figures }, (_, k) => {
          const i = plan.fallOrder[u.first + k];
          return { u, i, key: i === bearer ? 2 : (k + 0.5) / u.figures };
        });
      })
      .sort((a, b) => a.key - b.key || a.u.id - b.u.id);
    let next = 0;
    let owed = 0;
    const placed = new Map<string, number>();
    type Entry = (typeof queue)[number];
    const batches: { lane: Lane; t: number; at0: number; at1: number; goes: Entry[] }[] = [];
    for (const m of cast.marks) {
      if (m.id !== 'reserve-committed' || m.side !== side || m.lane === null) continue;
      owed += m.amount;
      // Ядро вводит резерв в любой тик фазы, а метку пишет в её последний (`reserve-committed`): струя растянута на
      // фазу. До сшибки строй ещё идёт, и встать за ним некуда — резерв, введённый в огне первого круга (на место
      // выбитых стрелами), трогается с разбегом первой линии.
      const span = cast.spans.find((sp) => m.t >= sp.t0 && m.t <= sp.t1);
      const at0 = Math.max(castToTw(timing, span ? span.t0 : m.t), plan.clashAt - RUN_LAST);
      const at1 = Math.max(at0 + STREAM_GAP, Math.min(castToTw(timing, m.t), at0 + STREAM_MAX));
      const goes: Entry[] = [];
      while (next < queue.length && queue[next].u.men / queue[next].u.figures <= owed + 1e-6) {
        const e = queue[next++];
        owed -= e.u.men / e.u.figures;
        goes.push(e);
      }
      batches.push({ lane: m.lane, t: m.t, at0, at1, goes });
    }
    // Метки одного тика (по полосе на метку) — одна струя: фигуры всех полос в порядке очереди, время — по месту в общей
    // струе. Иначе струи полос шли бы по тому же отрезку вперемешку, и хвост очереди (знаменосец) трогался бы раньше.
    for (let a = 0; a < batches.length; ) {
      let b = a;
      let total = 0;
      while (b < batches.length && batches[b].t === batches[a].t) total += batches[b++].goes.length;
      let n = 0;
      for (let j = a; j < b; j++) {
        const { lane, at0, at1, goes } = batches[j];
        const slot = slotOf(ours, lane);
        // Первая линия этой полосы уже бежит — резерв встаёт на её место, на линию соприкосновения; ещё стоит — за ней.
        const gone = plan.units.some((x) => x.side === side && x.row === 'front' && x.lane === lane && x.fleeAt !== null && x.fleeAt <= at0 + 5);
        for (const e of goes) {
          const at = at0 + ((n++ + 0.5) / total) * (at1 - at0);
          // Отряд побежал раньше, чем фигура тронулась, — она бежит с ним, а не идёт в дыру.
          if (e.u.fleeAt !== null && e.u.fleeAt <= at) continue;
          const bow = e.u.form === 'bow';
          const f = FORM[e.u.form];
          const key = `${slot}:${bow ? 'rear' : 'front'}`;
          const c = placed.get(key) ?? 0;
          placed.set(key, c + 1);
          const files = Math.max(4, Math.floor(plan.slotW[slot] / f.file));
          const file = c % files;
          const rank = Math.floor(c / files);
          const base = bow
            ? plan.contactZ[side] + s * (frontDepth + REAR_GAP + 1.5)
            : plan.contactZ[side] + (gone ? 0 : s * (frontDepth + 1.5));
          const x1 = plan.slotX[slot] + (file - (files - 1) / 2) * f.file + (hash(cast.seed, e.i, 19) - 0.5) * f.file * 0.3;
          const z1 = base + s * rank * f.rank;
          detour(plan, e.i, at, x1, z1, e.u.yaw, mounted(e.u) ? GALLOP_SPEED * 0.7 : RUN_SPEED, null);
          plan.goKind[e.i] = 1;
          plan.goLane[e.i] = lane;
          plan.goFight[e.i] = !bow && gone && rank < 2 ? 1 : 0;
          if (!e.u.commit || at < e.u.commit.at) e.u.commit = { at, x: x1, z: z1 };
        }
      }
      a = b;
    }
  }
}

/**
 * Обход по ходам ядра (`BattleResult.moves`): часть сектора — те рода, сколько ушло, в долях `k` — уходит из своей полосы
 * по дуге к флангу чужого строя в соседней полосе и рубится там лицом во фланг. Уходят ближние к полосе обхода; конница —
 * галопом, пешие — бегом. Ходов нет (запись старая или из сохранения) — обхода не видно, как и было: показ не угадывает,
 * кто ушёл. Отдаёт, сколько фигур ушло.
 */
function flankMoves(plan: TwPlan, result: BattleResult): number {
  const moves = result.moves;
  if (!moves || moves.length === 0) return 0;
  let gone = 0;
  const q = figureState();
  for (const m of moves) {
    const at = castToTw(plan.timing, castTimeOfTick(plan.cast, m.tick));
    if (at >= plan.seconds) continue;
    const ours = m.side === plan.us;
    const enemy = other(m.side);
    const sE = enemy === plan.us ? -1 : 1;
    const fromSlot = slotOf(ours, m.from);
    const toSlot = slotOf(ours, m.to);
    // С какой стороны заходят: со стороны своей прежней полосы.
    const dir = Math.sign(plan.slotX[fromSlot] - plan.slotX[toSlot]) || 1;
    const edge = plan.slotX[toSlot] + dir * (plan.slotW[toSlot] / 2 + 1.2);
    // Где он сейчас: в строю своего отряда — в полосе отряда, пришедший резервом или прежним обходом — в полосе пути.
    const laneNow = (u: TwUnit, i: number): number => (plan.goAt[i] <= at ? plan.goLane[i] : u.lane === null ? -1 : u.lane);
    let c = 0;
    for (const kind of UNIT_KINDS) {
      const men = m.men[kind] ?? 0;
      const need = Math.round(men / plan.k);
      if (need <= 0) continue;
      const cands: { i: number; d: number; u: TwUnit }[] = [];
      for (const u of plan.units) {
        if (u.side !== m.side || u.sector !== m.sector || u.row === 'general') continue;
        if (u.fleeAt !== null && u.fleeAt <= at + 0.6) continue;
        const bearer = bearerOf(plan, u);
        for (let i = u.first; i < u.first + u.figures; i++) {
          if (i === bearer) continue;
          if (plan.faceIds[plan.faceOf[i]].kind !== kind || plan.deathAt[i] <= at || laneNow(u, i) !== m.from) continue;
          figurePose(plan, i, at, null, q);
          cands.push({ i, d: Math.abs(q.x - edge), u });
        }
      }
      cands.sort((a, b) => a.d - b.d || a.i - b.i);
      for (const e of cands.slice(0, need)) {
        const f = FORM[e.u.form];
        // Колонной в три ряда вдоль чужого фланга: у края строя, лицом к нему.
        const x1 = edge + dir * (c % 3) * f.file;
        const z1 = plan.contactZ[enemy] + sE * (0.8 + Math.floor(c / 3) * f.file);
        figurePose(plan, e.i, at, null, q);
        // Дуга обхода: сперва вперёд, к чужой линии, потом внутрь, во фланг.
        const bend: [number, number] = [q.x + dir * 2.5, z1 - sE * 1.5];
        detour(plan, e.i, at + hash(plan.cast.seed, e.i, 20) * 0.6, x1, z1, -dir * (Math.PI / 2), mounted(e.u) ? GALLOP_SPEED : RUN_SPEED, bend);
        plan.goKind[e.i] = 2;
        plan.goLane[e.i] = m.to;
        plan.goFight[e.i] = 1;
        c += 1;
        gone += 1;
      }
    }
  }
  return gone;
}

/**
 * Кого гонит победитель (правило погони ядра, docs/handbook/battle.md, «Мораль»): догоняет только тот, кто быстрее
 * (`UNIT_STATS.speed`) — лёгкая конница всех, кроме всадников; пехота, лучники и латные — одни копья; всадников не
 * догоняет никто. Отряд гонит ближний по фронту бежавший отряд, которого догоняет.
 */
function chaseTargets(plan: TwPlan): void {
  for (const side of SIDES2) {
    const from = plan.brokenAt[other(side)];
    if (from === null) continue;
    // Гонят только недавно побежавших и живых: отряд, бежавший полминуты назад, уже за краем поля.
    const fled = plan.units.filter(
      (e) => e.side !== side && e.fleeAt !== null && e.row !== 'general' && e.fleeAt >= from - CHASE_SECONDS && aliveFigures(plan, e, from) > 0,
    );
    for (const u of plan.units) {
      if (u.side !== side || u.row === 'reserve' || u.row === 'rear' || u.fleeAt !== null) continue;
      const speed = UNIT_STATS[u.kind].speed;
      let best: TwUnit | null = null;
      for (const e of fled) {
        if (UNIT_STATS[e.kind].speed >= speed) continue;
        if (!best || Math.abs(e.x - u.x) < Math.abs(best.x - u.x)) best = e;
      }
      if (best) u.chase = { target: best.id, from };
    }
  }
}

/**
 * Гибель под стрелами — в миг, когда залп ложится: в фазах огня рукопашной нет, и все потери окна огня — стрелы. Фигура
 * цели, которой журнал велит пасть в ближайший период залпа, падает, когда туча до неё долетела, а не ровной струйкой
 * между залпами. Сколько павших за окно — то же, что у журнала: время сдвигается только внутри окна.
 */
function arrowDeaths(plan: TwPlan): void {
  for (const u of plan.units) {
    if (u.form !== 'bow') continue;
    for (const v of u.volleys) {
      const win = plan.fire.find(([a, b]) => v >= a && v <= b);
      const land = v + ARROW_FLIGHT;
      if (!win || land > win[1]) continue;
      const e = targetOf(plan, u, v);
      if (!e) continue;
      const until = Math.min(win[1], land + SHOOT_PERIOD);
      for (let i = e.first; i < e.first + e.figures; i++) {
        const d = plan.deathAt[i];
        if (d > land && d <= until) plan.deathAt[i] = land + hash(plan.cast.seed, i, 16) * 0.35;
      }
    }
  }
}

/** Сколько фигур отряда на ногах в секунду `t`. */
export function aliveFigures(plan: TwPlan, u: TwUnit, t: number): number {
  let n = 0;
  for (let i = u.first; i < u.first + u.figures; i++) if (plan.deathAt[i] > t) n++;
  return n;
}

// ---------- Движение ----------

/** Что делает фигура: запечённые клипы (`bake.ts`). Порядок — номер клипа в текстуре. */
export type ClipId = 'idle' | 'march' | 'run' | 'guard' | 'strike' | 'shoot' | 'fall';
export const CLIPS: readonly ClipId[] = ['idle', 'march', 'run', 'guard', 'strike', 'shoot', 'fall'];

/** Положение отряда на секунде `t`: где середина передней шеренги, куда смотрит, что делает. */
export interface UnitPose {
  x: number;
  z: number;
  yaw: number;
  clip: ClipId;
  /** Во сколько раз быстрее играть клип: шаг не скользит по земле. */
  rate: number;
  /** 0..1 — насколько отряд уже убежал. */
  flee: number;
  /** Сколько метров пробежал бегущий отряд: по ним поток бегущих растягивается (`figurePose`). */
  fleeRun: number;
  /** Строй рыхлее во столько раз: в воде, на бегу, в свалке. */
  loose: number;
  /** Отряд в сече на линии соприкосновения: передние шеренги рубятся. */
  fighting: boolean;
  /** 0..1 — отряд дрожит перед бегством (`WAVER_SECONDS`): рыхлеет, пятится, задние оглядываются. */
  waver: number;
  /** 0..1 — бегущие к своим воротам или по улице сбиваются в поток: строй сжимается к проезду (место боя). */
  funnel: number;
}

/**
 * Сколько отряд прошёл вперёд на сближении к секунде `t`: шагом до последних `RUN_LAST` секунд, потом бегом, и
 * к сшибке ровно на линии соприкосновения. В воде медленнее вдвое — время сшибки то же, поэтому до реки быстрее.
 */
export function advanceOf(plan: TwPlan, side: Side, t: number, walkOnly = false): { dist: number; speed: number; running: boolean } {
  const total = Math.abs(plan.deployZ[side] - plan.contactZ[side]);
  const water = waterSpan(plan, side);
  // Кому идти дальше (к гребню или через реку), тот трогается раньше: шаг не должен срываться в бег.
  const t0 = total > DEPLOY_HALF + 1 ? ADVANCE_EARLY : ADVANCE_FROM;
  const t1 = Math.max(t0 + 0.5, plan.clashAt);
  // Через реку не разбегаются: нападающий переходит её шагом и бьётся у берега из воды — это и есть штраф переправы.
  const run = water ? 0 : Math.min(RUN_LAST, (t1 - t0) * 0.4);
  // Вторая линия, резерв и полководец бегом не идут: в бег срывается только первая, и разрыв растёт.
  if (walkOnly && t > t1 - run) {
    const a = advanceOf(plan, side, t1 - run);
    return { dist: a.dist, speed: 0, running: false };
  }
  if (t <= t0) return { dist: 0, speed: 0, running: false };
  if (t >= t1) return { dist: total, speed: 0, running: false };
  // Ход — в «усилии»: шаг весит 1, бег — RUN_FACTOR; вода режет скорость, а не усилие.
  const effort = (tt: number): number => {
    const walk = Math.min(tt, t1 - run) - t0;
    const ran = Math.max(0, tt - (t1 - run));
    return Math.max(0, walk) + ran * RUN_FACTOR;
  };
  const full = effort(t1);
  // Путь, пересчитанный водой: метр воды стоит 1/WATER_SLOW метров суши.
  const cost = total + (water ? water[1] - water[0] : 0) * (1 / WATER_SLOW - 1);
  const e = (effort(t) / full) * cost;
  const dist = water ? fromCost(e, water) : e;
  const running = t > t1 - run;
  const base = (cost / full) * (running ? RUN_FACTOR : 1);
  const wet = water !== null && dist >= water[0] && dist <= water[1];
  return { dist: Math.min(total, dist), speed: base * (wet ? WATER_SLOW : 1), running };
}

/** Где на пути стороны вода: от и до, в метрах пройденного. null — переходить нечего. */
function waterSpan(plan: TwPlan, side: Side): [number, number] | null {
  const r = plan.field.river;
  if (!r || !r.between || plan.crossing !== side) return null;
  const z0 = plan.deployZ[side];
  const dir = Math.sign(plan.contactZ[side] - z0);
  const a = (r.z - r.half - z0) * dir;
  const b = (r.z + r.half - z0) * dir;
  return [Math.max(0, Math.min(a, b)), Math.max(a, b)];
}

/** Обратный ход: сколько метров пройдено при таком «усилии», если вода стоит дороже. */
function fromCost(e: number, w: [number, number]): number {
  if (e <= w[0]) return e;
  const wet = (w[1] - w[0]) / WATER_SLOW;
  if (e <= w[0] + wet) return w[0] + (e - w[0]) * WATER_SLOW;
  return w[1] + (e - w[0] - wet);
}

/** Отход линий в огне кругов: 0 — в сече, `SEP` — разошлись на разбег. */
export function separationOf(plan: TwPlan, t: number): number {
  if (t <= plan.clashAt) return 0;
  for (const [a, b] of plan.fire) {
    if (b <= plan.clashAt) continue;
    if (t >= a && t <= b) return SEP * Math.sin(Math.PI * clamp01((t - a) / Math.max(0.1, b - a)));
  }
  return 0;
}

/** Верхом или стая: удар с разбега у них глубже, обход и погоня — галопом. */
const mounted = (u: TwUnit): boolean => u.form === 'horse' || u.form === 'heavy' || u.form === 'pack';

/**
 * Давление полосы: линия соприкосновения уходит к тому, кто в этой полосе теряет больше, — метры по оси Z мира (плюс —
 * к чужим). Доли потерь — передних секторов полосы по журналу (`sectorLost`), той же мерой, что гибель фигур: линия
 * пятится там, где фигуры и падают. Своего числа исхода у давления нет — только куда сдвинуть уже посчитанное.
 */
export function pushOf(plan: TwPlan, slot: number, t: number): number {
  // На штурме линия — стена: её не сдвинуть.
  if (t <= plan.clashAt || plan.site?.kind === 'wall') return 0;
  const c = twToCast(plan.timing, t);
  const share = (side: Side): number => {
    const lane = (side === plan.us ? slot : 2 - slot) as Lane;
    const sector = FRONT[lane];
    const cell = plan.cast.sectors.find((x) => x.side === side && x.sector === sector);
    if (!cell || cell.men <= 0) return 0;
    const lost = plan.cast.detailed
      ? sectorLost(plan.cast.spans, side, sector, c)
      : lossProgress(plan.cast.spans, side, c) * (cell.men - cell.finalMen);
    return lost / cell.men;
  };
  const d = share(other(plan.us)) - share(plan.us);
  return PUSH_MAX * Math.tanh(3 * d) * clamp01((t - plan.clashAt) / PUSH_IN);
}

/** Сколько метров пробежал бегущий за `dt` секунд с мига слома: разворот, разгон, бег. */
const fleeDistance = (dt: number): number => {
  const run = Math.max(0, dt - TURN_SECONDS * 0.5);
  return FLEE_SPEED * run * (0.6 + 0.4 * clamp01(run / 2));
};

/** Положение отряда на секунде `t`. Всё — из журнала через раскадровку: сшибка, круги, давление, слом, погоня. */
export function unitPose(plan: TwPlan, u: TwUnit, t: number): UnitPose {
  const s = u.ours ? -1 : 1;
  const fwd = -s;
  // Бегство: разворот и бег от противника — от того места, где отряд был в миг слома (сеча, обход, въезд полководца).
  if (u.fleeAt !== null && t > u.fleeAt) {
    const base = unitPose(plan, u, u.fleeAt);
    const dt = t - u.fleeAt;
    const run = fleeDistance(dt);
    // Свои ворота за спиной (у ворот, на вылазке) или улица к площади (штурм): бегущие сбиваются к проезду.
    const w = plan.site?.wall;
    if (w && w.side === u.side && w.inward === (u.ours ? -1 : 1)) {
      const reach = Math.max(2, outOf(w, base.z) + (plan.site!.kind === 'wall' ? 8 : 1));
      const funnel = ease(clamp01(run / reach));
      return {
        x: base.x + (w.gateX - base.x) * funnel,
        z: base.z + w.inward * run,
        yaw: u.yaw + Math.PI * ease(dt / TURN_SECONDS),
        clip: 'run',
        rate: 1,
        flee: clamp01(dt / 8),
        fleeRun: run,
        loose: 1.8,
        fighting: false,
        waver: base.waver * (1 - ease(dt / TURN_SECONDS)),
        funnel,
      };
    }
    return {
      x: base.x + Math.sign(u.x || 1) * Math.max(0, dt - TURN_SECONDS * 0.5) * 0.35,
      z: base.z + s * run,
      yaw: u.yaw + Math.PI * ease(dt / TURN_SECONDS),
      clip: 'run',
      rate: 1,
      flee: clamp01(dt / 8),
      fleeRun: run,
      loose: 1.8,
      fighting: false,
      // Оглянувшиеся в дрожи не дёргаются назад в миг слома: их поворот гаснет вместе с разворотом.
      waver: base.waver * (1 - ease(dt / TURN_SECONDS)),
      funnel: 0,
    };
  }
  if (u.perch) return perchPose(plan, u, t);
  let x = u.x;
  let z = u.z;
  let clip: ClipId = 'idle';
  let rate = 1;
  let loose = 1;
  let fighting = false;
  const fire = u.form === 'bow' && u.volleys.some((v) => t >= v - SHOOT_PERIOD * SHOOT_RELEASE - 0.2 && t <= v + 0.6);

  // Сближение: первая линия — шагом и последние секунды бегом; вторая линия, резерв и полководец — шагом.
  const adv = advanceOf(plan, u.side, t, u.row !== 'front');
  z += fwd * adv.dist;
  if (adv.speed > 0) {
    const running = adv.running && u.row === 'front';
    clip = running ? 'run' : 'march';
    rate = running ? adv.speed / RUN_SPEED : adv.speed / WALK_SPEED;
    if (running) loose = 1.25;
  }
  if (u.row === 'front' && t > plan.clashAt) {
    const sep = separationOf(plan, t);
    z -= fwd * sep;
    clip = 'guard';
    fighting = sep < 0.3;
    // Удар строя о строй: передние шеренги влетают в чужой строй и отскакивают; у конницы удар глубже.
    const k = (t - plan.clashAt) / IMPACT_SECONDS;
    if (k < 1 && plan.site?.kind !== 'wall') z += fwd * (mounted(u) ? IMPACT_LURCH.horse : IMPACT_LURCH.foot) * Math.sin(Math.PI * k);
    // Давление: линия полосы уходит к тому, кто теряет больше, — обе стороны вместе, строи не расходятся.
    if (u.lane !== null) z += pushOf(plan, slotOf(u.ours, u.lane), t);
    if (fighting) loose = SCRUM_LOOSE;
  }
  // На штурме полководец не въезжает в сечу: у обороны она на стене, у штурмующих — на лестницах.
  if (u.row === 'general' && t > plan.clashAt + GENERAL_IN.after && plan.site?.kind !== 'wall') {
    // Полководец в сече: въезжает за середину первой линии и рубится там, пока его армия держится.
    const k = ease(clamp01((t - plan.clashAt - GENERAL_IN.after) / GENERAL_IN.seconds));
    const sep = separationOf(plan, t);
    const tz = plan.contactZ[u.side] - fwd * (1.1 + sep) + pushOf(plan, 1, t);
    x += (0 - x) * k;
    z += (tz - z) * k;
    if (k < 1) {
      clip = 'march';
      rate = 1.6;
    } else {
      clip = sep < 0.3 ? 'strike' : 'guard';
      fighting = sep < 0.3;
    }
  }
  if (inWater(plan.field, x, z)) loose = 2;
  if (fire && clip !== 'march' && clip !== 'run') clip = 'shoot';

  // Дрожь перед бегством: мораль сектора на исходе — строй рыхлеет и пятится, задние оглядываются (`figurePose`).
  let waver = 0;
  if (u.fleeAt !== null && u.row !== 'general' && t > u.fleeAt - WAVER_SECONDS) {
    waver = clamp01((t - (u.fleeAt - WAVER_SECONDS)) / WAVER_SECONDS);
    z -= fwd * 0.6 * waver;
    loose = Math.max(loose, 1 + 0.7 * waver);
    if (waver > 0.5) fighting = false;
  }

  // Погоня: противник сломан. Кто быстрее бегущих, гонит их (`chaseTargets`); остальные идут следом шагом и встают.
  const foeBroke = plan.brokenAt[other(u.side)];
  if (foeBroke !== null && t > foeBroke && u.row !== 'reserve') {
    if (u.chase) {
      const target = plan.units[u.chase.target];
      const dt = Math.min(t, u.chase.from + CHASE_SECONDS) - u.chase.from;
      const tp = unitPose(plan, target, u.chase.from + dt);
      const sT = target.ours ? -1 : 1;
      // К спине бегущих — не быстрее своего бега: конница галопом, пешие бегом.
      const ax = tp.x - x;
      const az = tp.z - sT * CHASE_GAP - z;
      const gap = Math.hypot(ax, az);
      const go = Math.min(gap, dt * (mounted(u) ? GALLOP_SPEED : RUN_SPEED));
      if (gap > 0) {
        x += (ax / gap) * go;
        z += (az / gap) * go;
      }
      const running = t < u.chase.from + CHASE_SECONDS;
      return { x, z, yaw: u.yaw, clip: running ? 'run' : 'idle', rate: 1, flee: 0, fleeRun: 0, loose: running ? 1.6 : 1.2, fighting: false, waver: 0, funnel: 0 };
    }
    // Штурмующие под стеной стоят у неё: вперёд — только стена.
    if ((u.row === 'front' || u.row === 'general') && !(plan.site?.kind === 'wall' && plan.site.wall!.side !== u.side)) {
      const go = Math.min(6, (t - foeBroke) * WALK_SPEED);
      z += fwd * go;
      clip = go < 6 ? 'march' : 'idle';
      rate = 1;
      fighting = false;
      loose = 1;
    }
  }
  return { x, z, yaw: u.yaw, clip, rate, flee: 0, fleeRun: 0, loose, fighting, waver, funnel: 0 };
}

/**
 * Отряд на стене: стоит, где поставили, — не сходится, не отходит между кругами, не пятится от давления. На штурме
 * передние рубят лезущих по лестницам (`figurePose`), стрелки бьют залпами. Дрожит — на полшага; бежит — общим путём.
 */
function perchPose(plan: TwPlan, u: TwUnit, t: number): UnitPose {
  const fire = u.form === 'bow' && u.volleys.some((v) => t >= v - SHOOT_PERIOD * SHOOT_RELEASE - 0.2 && t <= v + 0.6);
  const foeBroke = plan.brokenAt[other(u.side)];
  const fighting = plan.site?.kind === 'wall' && u.row === 'front' && t > plan.clashAt && separationOf(plan, t) < 0.3 && (foeBroke === null || t < foeBroke);
  let waver = 0;
  let z = u.z;
  if (u.fleeAt !== null && t > u.fleeAt - WAVER_SECONDS) {
    waver = clamp01((t - (u.fleeAt - WAVER_SECONDS)) / WAVER_SECONDS);
    z -= (u.ours ? 1 : -1) * 0.15 * waver;
  }
  const clip: ClipId = fire ? 'shoot' : fighting ? 'guard' : 'idle';
  return { x: u.x, z, yaw: u.yaw, clip, rate: 1, flee: 0, fleeRun: 0, loose: fighting ? 1.15 : 1, fighting: fighting && waver < 0.5, waver, funnel: 0 };
}

/** Кадр фигур: место, разворот, клип и время клипа — плоскими массивами, без мусора. */
export interface FigureFrame {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  clip: Uint8Array;
  time: Float32Array;
  /** Фигура видна: павшие лежат и видны; бежавшие за край поля гаснут. */
  shown: Uint8Array;
}

export function figureFrame(n: number): FigureFrame {
  return {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    clip: new Uint8Array(n),
    time: new Float32Array(n),
    shown: new Uint8Array(n),
  };
}

const CLIP_INDEX: Record<ClipId, number> = { idle: 0, march: 1, run: 2, guard: 3, strike: 4, shoot: 5, fall: 6 };

/** Положение одной фигуры — для кадра и для места павшего. */
export interface FigureState {
  x: number;
  z: number;
  yaw: number;
  clip: ClipId;
  /** Время клипа: своя фаза, разгон шага, миг срыва стрелы. */
  time: number;
  shown: boolean;
  /** Высота, если её задаёт путь (лестница, через стену); NaN — стоит на земле или на боевом ходу (`site.standY`). */
  y: number;
}

export const figureState = (): FigureState => ({ x: 0, z: 0, yaw: 0, clip: 'idle', time: 0, shown: true, y: NaN });

/** Бежавший за краем поля гаснет: дальше смотреть не на что, а инстанс — лишний. */
const offField = (plan: TwPlan, x: number, z: number): boolean => {
  const f = plan.field;
  return z < f.minZ + 4 || z > f.maxZ - 4 || Math.abs(x) > f.halfX - 4;
};

/** Место на своём пути (квадратичная дуга) на секунде `t`: фигура в пути бежит, пришедшая — стоит или рубится. */
function pathPose(plan: TwPlan, i: number, t: number, out: FigureState): boolean {
  const o = i * PATH;
  const p = plan.path;
  const k = clamp01((t - plan.goAt[i]) / Math.max(1e-3, p[o + 7]));
  const a = (1 - k) * (1 - k);
  const b = 2 * (1 - k) * k;
  const c = k * k;
  out.x = a * p[o] + b * p[o + 2] + c * p[o + 4];
  out.z = a * p[o + 1] + b * p[o + 3] + c * p[o + 5];
  if (k < 1) {
    const dx = 2 * (1 - k) * (p[o + 2] - p[o]) + 2 * k * (p[o + 4] - p[o + 2]);
    const dz = 2 * (1 - k) * (p[o + 3] - p[o + 1]) + 2 * k * (p[o + 5] - p[o + 3]);
    out.yaw = Math.atan2(dx, dz);
    out.clip = 'run';
    return false;
  }
  out.yaw = p[o + 6];
  out.clip = 'guard';
  return true;
}

/**
 * Положение фигуры на секунде `t`: место в строю отряда (или свой путь), разброс рыхлого строя, свалка у линии, дрожь
 * перед бегством, поток бегущих. `pose` — положение её отряда, если уже посчитано (кадр считает его раз на отряд).
 */
export function figurePose(plan: TwPlan, i: number, t: number, pose: UnitPose | null, out: FigureState): FigureState {
  const u = plan.units[plan.unitOf[i]];
  const seed = plan.cast.seed;
  const s = u.ours ? -1 : 1;
  const phase = plan.phase[i];
  out.shown = true;
  out.y = NaN;
  const go = plan.goAt[i];
  // Свой путь — только если фигура тронулась раньше, чем её отряд побежал; иначе она бежит с отрядом.
  if (go < t && (u.fleeAt === null || go < u.fleeAt)) {
    // Свой путь: резерв в дыру, отряд в обход. Побежал отряд — фигура бежит от того места, где была в миг слома.
    const fled = u.fleeAt !== null && t > u.fleeAt;
    const arrived = pathPose(plan, i, fled ? Math.max(go, u.fleeAt!) : t, out);
    if (plan.goKind[i] === 4 && !fled) {
      // Через стену по лестнице: вверх по ней, по ходу, вниз в город.
      const w = plan.site!.wall!;
      const lift = overLift(w, outOf(w, out.z));
      if (lift > 0) out.y = w.base + lift;
    }
    if (fled) {
      const dt = t - u.fleeAt!;
      const run = fleeDistance(dt) * (0.85 + 0.3 * hash(seed, i, 14));
      const w = plan.site?.wall;
      if (w && (plan.goKind[i] === 3 || plan.goKind[i] === 4) && outOf(w, out.z) < 0) {
        // Пролезшие в город и отбитые уходят назад: воротами, если выбиты, иначе по своей лестнице.
        const inside = -outOf(w, out.z);
        const gate = w.gateAt !== null && w.gateAt <= u.fleeAt!;
        let toX = w.gateX;
        if (!gate) for (const l of plan.site!.ladders) if (l.unit === u.id && Math.abs(l.x - out.x) < Math.abs(toX - out.x)) toX = l.x;
        out.x += (toX - out.x) * ease(clamp01(run / Math.max(0.5, inside)));
        out.z -= w.inward * run;
        if (!gate) {
          const lift = overLift(w, outOf(w, out.z));
          if (lift > 0) out.y = w.base + lift;
        }
      } else {
        out.z += s * run;
        out.x += (hash(seed, i, 15) - 0.5) * 0.5 * run;
      }
      // Разворот — от того, куда фигура смотрела в миг слома (во фланг, на бегу), к спине врагу.
      const from = out.yaw;
      const to = u.yaw + Math.PI;
      const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
      out.yaw = from + turn * ease(dt / TURN_SECONDS);
      out.clip = 'run';
      out.time = t + phase;
      out.shown = !offField(plan, out.x, out.z);
      return out;
    }
    if (arrived) {
      const enemy = other(u.side);
      const foeBroke = plan.brokenAt[enemy];
      const contact = t > plan.clashAt && separationOf(plan, t) < 0.3 && (foeBroke === null || t < foeBroke);
      if (plan.goFight[i] && contact) {
        // В свалке: вперёд-назад по своему развороту, как передние шеренги отряда.
        const sway = SCRUM_SWAY * Math.sin(2.3 * t + phase * 1.7);
        out.x += Math.sin(out.yaw) * sway;
        out.z += Math.cos(out.yaw) * sway;
        out.clip = 'strike';
      } else if (foeBroke !== null && t > foeBroke) out.clip = 'idle';
      else if (u.form === 'bow' && u.volleys.some((v) => t >= v - SHOOT_PERIOD * SHOOT_RELEASE - 0.2 && t <= v + 0.6)) {
        // Лучник резерва, вставший во вторую линию, стреляет залпами своего отряда — оттуда, где стоит.
        out.clip = 'shoot';
        out.time = shootTime(plan, u, t, i);
        return out;
      }
    }
    out.time = t + phase;
    return out;
  }
  const q = pose ?? unitPose(plan, u, t);
  const c = Math.cos(q.yaw);
  const sn = Math.sin(q.yaw);
  let ox = plan.lx[i];
  let oz = plan.lz[i];
  // Поток к воротам: строй сжимается к проезду.
  if (q.funnel > 0) {
    ox *= 1 - 0.88 * q.funnel;
    oz *= 1 - 0.3 * q.funnel;
  }
  // Рыхлость строя — разброс от своего места, а не от середины: шеренги остаются шеренгами, только кривыми.
  if (q.loose > 1) {
    ox += (hash(seed, i, 11) - 0.5) * (q.loose - 1) * 0.9;
    oz += (hash(seed, i, 12) - 0.5) * (q.loose - 1) * 0.9;
  }
  const rank = plan.rank[i];
  // Свалка: передние шеренги ходят вперёд-назад каждая в своём такте — линия не стоит стеной. На стене — едва.
  if (q.fighting && rank < 3) oz += SCRUM_SWAY * (rank === 0 ? 1 : 0.6) * (u.perch ? 0.35 : 1) * Math.sin(2.3 * t + phase * 1.7);
  out.x = q.x + ox * c + oz * sn;
  out.z = q.z - ox * sn + oz * c;
  out.yaw = q.yaw;
  let clip = q.clip;
  // Дрожь: задние оглядываются через плечо — каждый в свою сторону.
  if (q.waver > 0 && hash(seed, i, 17) < 0.45) out.yaw += (hash(seed, i, 18) - 0.5) * 2.4 * q.waver;
  if (q.fleeRun > 0) {
    // Поток бегущих: кто резвее, кто отстал — блок рассыпается в толпу.
    out.z += s * q.fleeRun * (hash(seed, i, 14) * 0.3 - 0.15);
    out.x += (hash(seed, i, 15) - 0.5) * 0.12 * q.fleeRun;
  }
  // За краем поля гаснут и бегущие, и гонящие их; ушедшие в город за стеной — тоже.
  out.shown = !offField(plan, out.x, out.z) && !(q.fleeRun > 0 && q.funnel > 0 && intoTown(plan, out.z));
  // В сече рубятся две передние шеренги, остальные в упоре.
  if (clip === 'guard' && q.fighting && rank < 2) clip = 'strike';
  const site = plan.site;
  if (site?.kind === 'wall' && clip === 'strike') {
    // Штурм: под стеной рубить некого — держат щиты; на стене рубят там, где к ней встала лестница.
    const w = site.wall!;
    if (u.side !== w.side || !onWalk(w, out.x, out.z)) clip = 'guard';
    else if (!site.ladders.some((l) => Math.abs(l.x - out.x) < 2.2 && t > l.raiseAt)) clip = 'guard';
  }
  out.clip = clip;
  out.time = clip === 'shoot' ? shootTime(plan, u, t, i) : t * q.rate + phase;
  if (plan.climb[i] >= 0) ladderPose(plan, u, i, t, out);
  return out;
}

/** Бежавший своими воротами ушёл в город: за стеной его не видно (у ворот — сразу за ней, на штурме — за площадью). */
function intoTown(plan: TwPlan, z: number): boolean {
  const site = plan.site;
  const w = site?.wall;
  if (!w) return false;
  const deep = -outOf(w, z);
  const far = site!.kind === 'wall' && site!.square ? Math.abs(site!.square.z - w.z) + 3 : w.thick + 6;
  return deep > far;
}

/**
 * Штурмующий на лестнице: со стены поднятой лестницы лезет вверх; выше — тот, кто раньше в очереди, и место его
 * занимает следующий, когда тот пал или перелез (плавно, без скачка). Пока лестницу поднимают, идёт к её пяте.
 */
function ladderPose(plan: TwPlan, u: TwUnit, i: number, t: number, out: FigureState): void {
  const fled = u.fleeAt !== null && t > u.fleeAt;
  if (fled) {
    // Отряд побежал: кто был на лестнице, спрыгивает с того места, где был, и бежит от стены.
    const site = plan.site!;
    const w = site.wall!;
    const at = figureState();
    ladderPose(plan, u, i, u.fleeAt!, at);
    if (Number.isNaN(at.y)) return;
    const dt = t - u.fleeAt!;
    const run = fleeDistance(dt);
    out.x = at.x;
    out.z = at.z - w.inward * run;
    out.y = Math.max(heightAt(plan.field, out.x, out.z), at.y - 9 * dt * dt);
    out.yaw = u.yaw + Math.PI * ease(dt / TURN_SECONDS);
    out.clip = 'run';
    out.time = t + plan.phase[i];
    return;
  }
  const site = plan.site!;
  const l = site.ladders[plan.climb[i]];
  const w = site.wall!;
  const qn = plan.climbQ[i];
  const approach = l.raiseAt - 0.6;
  if (t <= approach) return;
  const start = l.raiseAt + 0.25 + qn * 0.7;
  const footX = l.x + (hash(plan.cast.seed, i, 88) - 0.5) * 0.14;
  if (t < start) {
    // К пяте лестницы: из строя — шагом.
    const k = ease((t - approach) / (start - approach));
    const fz = w.z - w.inward * (LADDER_FOOT + 0.18 + (LADDER_QUEUE - 1 - qn) * 0.02 + qn * 0.55);
    out.x += (footX - out.x) * k;
    out.z += (fz - out.z) * k;
    out.yaw = u.yaw;
    if (k < 1) out.clip = 'march';
    return;
  }
  let slot = 0;
  for (let j = 0; j < qn; j++) {
    const a = l.queue[j];
    const gone = Math.min(plan.deathAt[a], plan.goAt[a]);
    slot += t < gone ? 1 : 1 - ease((t - gone) / 0.9);
  }
  const target = w.top - 0.3 - slot * LADDER_RUNG;
  const h = Math.max(0, Math.min((t - start) * CLIMB_SPEED, target));
  const d = LADDER_FOOT * (1 - h / w.top);
  out.x = footX;
  out.z = w.z - w.inward * (d + 0.18);
  out.y = w.base + h;
  out.yaw = u.yaw;
  out.clip = h < target - 0.02 ? 'march' : h >= w.top - 0.7 ? 'strike' : 'guard';
  out.time = t * 1.3 + plan.phase[i];
  out.shown = true;
}

const scratch = figureState();

/**
 * Разложить кадр по фигурам. Павший лежит там, где упал: его место — место фигуры в мгновение гибели, а не нынешнее
 * (иначе тела уезжали бы вместе с бегущими).
 */
export function poseFigures(plan: TwPlan, t: number, out: FigureFrame): void {
  const poses = plan.units.map((u) => unitPose(plan, u, t));
  for (const u of plan.units) {
    const p = poses[u.id];
    for (let i = u.first; i < u.first + u.figures; i++) {
      if (plan.deathAt[i] <= t) {
        out.x[i] = plan.deadX[i];
        out.z[i] = plan.deadZ[i];
        out.y[i] = standY(plan.field, plan.site, plan.deadX[i], plan.deadZ[i]);
        out.yaw[i] = plan.deadYaw[i];
        out.shown[i] = 1;
        out.clip[i] = CLIP_INDEX.fall;
        out.time[i] = t - plan.deathAt[i];
        continue;
      }
      const q = figurePose(plan, i, t, p, scratch);
      if (u.form === 'pack' && q.clip === 'strike') {
        // Волк бросается: прыжок вперёд и вверх в такт броска, не стоит на месте.
        const hop = Math.max(0, Math.sin(2.4 * t + plan.phase[i] * 1.3));
        q.x += Math.sin(q.yaw) * 0.4 * hop;
        q.z += Math.cos(q.yaw) * 0.4 * hop;
        q.y = standY(plan.field, plan.site, q.x, q.z) + 0.3 * hop * hop;
      }
      out.x[i] = q.x;
      out.z[i] = q.z;
      out.y[i] = Number.isNaN(q.y) ? standY(plan.field, plan.site, q.x, q.z) : q.y;
      out.yaw[i] = q.yaw;
      out.shown[i] = q.shown ? 1 : 0;
      out.clip[i] = CLIP_INDEX[q.clip];
      out.time[i] = q.time;
    }
  }
}

/** Время клипа стрельбы: стрела срывается в мгновение залпа отряда (`SHOOT_RELEASE` цикла), а не своё. */
function shootTime(plan: TwPlan, u: TwUnit, t: number, i: number): number {
  let next = u.volleys.find((v) => v >= t - 0.6);
  if (next === undefined) next = t;
  const jitter = (hash(plan.cast.seed, i, 13) - 0.5) * 0.3;
  return SHOOT_PERIOD * SHOOT_RELEASE - (next - t) + jitter;
}

/** Залпы, чьи стрелы сейчас в воздухе. */
export function volleysAt(plan: TwPlan, t: number, cap: number): TwVolley[] {
  const out: TwVolley[] = [];
  let arrows = 0;
  for (const u of plan.units) {
    if (u.form !== 'bow') continue;
    for (const v of u.volleys) {
      if (t < v || t > v + ARROW_FLIGHT) continue;
      const target = targetOf(plan, u, v);
      if (!target) continue;
      const n = Math.min(aliveFigures(plan, u, v), cap - arrows);
      if (n <= 0) continue;
      arrows += n;
      out.push({ from: u.id, to: target.id, at: v, arrows: n });
    }
  }
  return out;
}

/** Цель залпа: ближайший по фронту отряд первой линии противника, ещё стоящий; нет такого — любой. */
export function targetOf(plan: TwPlan, u: TwUnit, t: number): TwUnit | null {
  let best: TwUnit | null = null;
  let bestD = Infinity;
  for (const e of plan.units) {
    if (e.side === u.side || e.row === 'general') continue;
    if (e.fleeAt !== null && t > e.fleeAt) continue;
    if (aliveFigures(plan, e, t) <= 0) continue;
    const d = Math.abs(e.x - u.x) + (e.row === 'front' ? 0 : 30) + (e.row === 'reserve' ? 30 : 0);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
