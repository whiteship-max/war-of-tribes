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
import { SECTORS, UNIT_KINDS, type BattleResult, type Lane, type Sector, type Side, type UnitKind } from '@/battle/types';
import { wearOf } from '@/game/battle/faces';
import { gearOfTroop } from '@/game/battle/kinds';
import { TROOP_BY_ID } from '@/game/data/troops';
import type { TroopId } from '@/game/types';
import type { Quality } from '../quality';
import { TW_SPEC } from './spec';
import { hash, heightAt, inWater, type TwField } from './terrain';

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
/** С какой секунды линии идут навстречу: до этого видно построение. */
export const ADVANCE_FROM = 2.5;
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
}

export interface PlanInput {
  cast: Cast;
  result: BattleResult;
  faces: Record<Side, Face[]>;
  quality: Quality;
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
      });
    }
  });

  // ---- место на поле ----
  const crossing = crossingOf(result);
  const uphill = landPenalty(result);
  const sign = (side: Side): number => (side === us ? -1 : 1);
  // Обороняющийся ждёт у берега или на гребне: нападающему идти дальше (переправа, холм).
  const holds: Side | null = crossing ? other(crossing) : uphill ? other(uphill) : null;
  const deployZ = {} as Record<Side, number>;
  const contactZ = {} as Record<Side, number>;
  for (const side of SIDES2) {
    contactZ[side] = sign(side) * CONTACT_HALF;
    const d = holds === null ? DEPLOY_HALF : side === holds ? HOLD_HALF : DEPLOY_HALF * 2 - HOLD_HALF;
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
  const slotX = [slotW[1] / 2 + LANE_GAP + slotW[0] / 2, 0, -(slotW[1] / 2 + LANE_GAP + slotW[2] / 2)];

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
    lineUp(
      sideUnits.filter((u) => u.row === 'reserve'),
      0,
      0,
      rowZ.reserve,
    );
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
      });
    }
  }

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
  };
  const defender: Side = 'defender';
  const sD = sign(defender);
  if (uphill || cast.ground.land === 'hills') {
    const high = uphill ? other(uphill) : defender;
    field.hill = { h: 2.4, side: sign(high) as 1 | -1, from: -4, to: HOLD_HALF + 10 };
  }
  if (crossing) {
    // Река между линиями, у берега обороны: нападающий переходит её на сближении и бьётся из воды.
    const sC = sign(crossing);
    const half = 2.2;
    field.river = { z: sC * (0.25 + half), half, ford: cast.ground.ford, fordX: 0, fordHalf: 5, between: true };
  } else if (cast.ground.river) {
    // Переправы ядро не штрафовало (снята манёвром или не было): река за спиной нападающего.
    const sA = sign('attacker');
    const back = Math.max(...units.filter((u) => u.side === 'attacker').map((u) => Math.abs(u.z) + u.depth));
    field.river = { z: sA * (back + 9), half: 3, ford: cast.ground.ford, fordX: 0, fordHalf: 5, between: false };
  }
  if (cast.ground.ridge) {
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

  // Резерв входит в полосу: метки журнала `reserve-committed` (людей и полоса) съедают резерв по очереди.
  for (const side of SIDES2) {
    const pool = units.filter((u) => u.side === side && u.row === 'reserve').sort((a, b) => a.id - b.id);
    if (pool.length === 0) continue;
    let given = 0;
    let owed = 0;
    for (const m of cast.marks) {
      if (m.id !== 'reserve-committed' || m.side !== side || m.lane === null) continue;
      owed += m.amount;
      while (given < pool.length && pool[given].men <= owed + 0.5) {
        const u = pool[given];
        owed -= u.men;
        given++;
        const slot = slotOf(u.ours, m.lane);
        const sideFront = units.filter((x) => x.side === side && x.row === 'front');
        const frontDepth = Math.max(0, ...sideFront.map((x) => x.depth));
        u.commit = { at: castToTw(timing, m.t), x: slotX[slot], z: contactZ[side] + sign(side) * (frontDepth + 1.5) };
      }
    }
  }

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
  };
  plan.fire = fireWindows(plan);
  for (const u of units) if (u.form === 'bow') u.volleys = volleyTimes(plan, u);
  for (const u of units) {
    for (let i = u.first; i < u.first + u.figures; i++) {
      if (!Number.isFinite(deathAt[i])) continue;
      const q = unitPose(plan, u, deathAt[i]);
      const c = Math.cos(q.yaw);
      const sn = Math.sin(q.yaw);
      plan.deadX[i] = q.x + lx[i] * c + lz[i] * sn;
      plan.deadZ[i] = q.z - lx[i] * sn + lz[i] * c;
      plan.deadYaw[i] = q.yaw;
    }
  }
  return plan;
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
  /** Строй рыхлее во столько раз: в воде и на бегу. */
  loose: number;
}

/**
 * Сколько отряд прошёл вперёд на сближении к секунде `t`: шагом до последних `RUN_LAST` секунд, потом бегом, и
 * к сшибке ровно на линии соприкосновения. В воде медленнее вдвое — время сшибки то же, поэтому до реки быстрее.
 */
export function advanceOf(plan: TwPlan, side: Side, t: number, walkOnly = false): { dist: number; speed: number; running: boolean } {
  const total = Math.abs(plan.deployZ[side] - plan.contactZ[side]);
  const t0 = ADVANCE_FROM;
  const t1 = Math.max(t0 + 0.5, plan.clashAt);
  const run = Math.min(RUN_LAST, (t1 - t0) * 0.4);
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
  const water = waterSpan(plan, side);
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

/** Положение отряда на секунде `t`. Всё — из журнала через раскадровку: сшибка, круги, слом, резерв. */
export function unitPose(plan: TwPlan, u: TwUnit, t: number): UnitPose {
  const s = u.ours ? -1 : 1;
  const fwd = -s;
  let x = u.x;
  let z = u.z;
  let clip: ClipId = 'idle';
  let rate = 1;
  let loose = 1;
  const fire = u.form === 'bow' && u.volleys.some((v) => t >= v - SHOOT_PERIOD * SHOOT_RELEASE - 0.2 && t <= v + 0.6);

  const walking = u.row !== 'front';
  if (u.row === 'front' || u.row === 'rear' || u.row === 'general' || (u.row === 'reserve' && !(u.commit && t > u.commit.at))) {
    const adv = advanceOf(plan, u.side, t, walking);
    z += fwd * adv.dist;
    if (u.row === 'front' && t > plan.clashAt) {
      z -= fwd * separationOf(plan, t);
      clip = 'guard';
    }
    if (adv.speed > 0) {
      clip = adv.running && u.row === 'front' ? 'run' : 'march';
      rate = adv.running && u.row === 'front' ? adv.speed / RUN_SPEED : adv.speed / WALK_SPEED;
      if (adv.running && u.row === 'front') loose = 1.25;
    }
    if (inWater(plan.field, x, z)) loose = 2;
  } else if (u.row === 'reserve' && u.commit && t > u.commit.at) {
    // Резерв идёт в свою полосу шагом и встаёт за первой линией — от того места, куда дошёл со всей армией.
    const from = u.z - s * advanceOf(plan, u.side, u.commit.at, true).dist;
    z = from;
    const dx = u.commit.x - u.x;
    const dz = u.commit.z - from;
    const len = Math.hypot(dx, dz);
    const go = Math.min(len, (t - u.commit.at) * WALK_SPEED * 1.4);
    if (len > 0) {
      x += (dx / len) * go;
      z += (dz / len) * go;
    }
    if (go < len) {
      clip = 'march';
      rate = 1.4;
    } else clip = 'guard';
  }
  if (fire && clip !== 'march' && clip !== 'run') clip = 'shoot';

  // Бегство: разворот и бег от противника, у каждого отряда со своего мгновения слома.
  let flee = 0;
  if (u.fleeAt !== null && t > u.fleeAt) {
    const dt = t - u.fleeAt;
    flee = clamp01(dt / 8);
    const run = Math.max(0, dt - TURN_SECONDS * 0.5);
    z += s * FLEE_SPEED * run * (0.6 + 0.4 * clamp01(run / 2));
    x += Math.sign(u.x || 1) * run * 0.35;
    clip = 'run';
    rate = 1;
    loose = 1.8;
    return { x, z, yaw: u.yaw + Math.PI * ease(dt / TURN_SECONDS), clip, rate, flee, loose };
  }
  // Погоня: победитель после слома противника идёт следом шагом и останавливается.
  const foeBroke = plan.brokenAt[other(u.side)];
  if (foeBroke !== null && t > foeBroke && (u.row === 'front' || u.row === 'general')) {
    const go = Math.min(6, (t - foeBroke) * WALK_SPEED);
    z += fwd * go;
    if (go < 6) {
      clip = 'march';
      rate = 1;
    } else clip = 'idle';
  }
  return { x, z, yaw: u.yaw, clip, rate, flee, loose };
}

/** Кадр фигур: место, разворот, клип и время клипа — плоскими массивами, без мусора. */
export interface FigureFrame {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  clip: Uint8Array;
  time: Float32Array;
  /** Фигура видна: бежавшие за краем поля и упавшие давно — тоже видны (лежат). */
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

/**
 * Разложить кадр по фигурам. Павший лежит там, где упал: его место — место отряда в мгновение гибели, а не
 * нынешнее (иначе тела уезжали бы вместе с бегущими).
 */
export function poseFigures(plan: TwPlan, t: number, out: FigureFrame): void {
  const poses = plan.units.map((u) => unitPose(plan, u, t));
  for (const u of plan.units) {
    const p = poses[u.id];
    for (let i = u.first; i < u.first + u.figures; i++) {
      if (plan.deathAt[i] <= t) {
        out.x[i] = plan.deadX[i];
        out.z[i] = plan.deadZ[i];
        out.y[i] = heightAt(plan.field, plan.deadX[i], plan.deadZ[i]);
        out.yaw[i] = plan.deadYaw[i];
        out.shown[i] = 1;
        out.clip[i] = CLIP_INDEX.fall;
        out.time[i] = t - plan.deathAt[i];
        continue;
      }
      const q = p;
      const c = Math.cos(q.yaw);
      const sn = Math.sin(q.yaw);
      const loose = q.loose;
      const ox = plan.lx[i];
      const oz = plan.lz[i];
      // Рыхлость строя — разброс от своего места, а не от середины: шеренги остаются шеренгами, только кривыми.
      const jx = loose > 1 ? (hash(plan.cast.seed, i, 11) - 0.5) * (loose - 1) * 0.9 : 0;
      const jz = loose > 1 ? (hash(plan.cast.seed, i, 12) - 0.5) * (loose - 1) * 0.9 : 0;
      const lxw = ox + jx;
      const lzw = oz + jz;
      const x = q.x + lxw * c + lzw * sn;
      const z = q.z - lxw * sn + lzw * c;
      out.x[i] = x;
      out.z[i] = z;
      out.y[i] = heightAt(plan.field, x, z);
      out.yaw[i] = q.yaw;
      out.shown[i] = 1;
      let clip = q.clip;
      // В сече рубятся две передние шеренги, остальные в упоре.
      if (clip === 'guard' && u.row === 'front' && plan.rank[i] < 2 && t > plan.clashAt && separationOf(plan, t) < 0.3) clip = 'strike';
      out.clip[i] = CLIP_INDEX[clip];
      out.time[i] = clip === 'shoot' ? shootTime(plan, u, t, i) : t * q.rate + plan.phase[i];
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
