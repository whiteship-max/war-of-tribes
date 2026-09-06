// Режиссура ролика о бое: журнал → раскадровка. Проигрыватель журнала, а не
// второй симулятор.
//
// Бой уже посчитан детерминированно и оставил журнал именованных событий по
// фазам и секторам. Отсюда берётся всё: когда камера едет, к какому сектору она
// подаётся, сколько фигур стоит и сколько уже лежит. Кубиков здесь нет, вызова
// симуляции нет, `Math.random` нет — и это держит тест, читающий исходник.
//
// Причина не архитектурная, а игровая: если картинка считает сама, она рано или
// поздно разойдётся с отчётом, и игрок увидит, как его конница смяла фланг, а
// в отчёте прочитает обратное. Это тот же принцип, что «карточка вида и фигура
// выводятся из одного снаряжения».
//
// Модуль живёт в `battle/` и, как весь этот каталог, не зависит ни от чего
// снаружи: сервер соберёт ту же раскадровку у себя, а клиент покажет её по
// журналу, приехавшему с сервера. Готовая раскадровка (`Cast`) самодостаточна:
// проигрывателю итог боя больше не нужен, ему хватает её одной.
import { describeEvent } from './log';
import {
  FRONT,
  REAR,
  SECTORS,
  UNIT_KINDS,
  type BattleEvent,
  type BattleResult,
  type EventId,
  type Lane,
  type PhaseId,
  type Sector,
  type Side,
  type Stack,
  type UnitKind,
} from './types';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
/** Плавный вход и выход: скорость на стыке ключей — ноль, поэтому склейки не видно. */
const ease = (u: number): number => u * u * (3 - 2 * u);
const other = (side: Side): Side => (side === 'attacker' ? 'defender' : 'attacker');
const SIDES2: readonly Side[] = ['attacker', 'defender'];

// ---------- Сколько фигур ----------

/**
 * Потолок фигур на сторону. Сотни бойцов на телефоне не сосчитать, а рисовать
 * их дорого — та же причина, по которой у костра стоит десяток жителей, а не
 * всё племя.
 */
export const FIGURE_CAP = 44;

/** Меньше этого сторона не показывается, пока в ней есть хоть один боец. */
export const FIGURE_MIN = 3;

/**
 * Сколько фигур ставится за столько бойцов. Корень с потолком: разница между
 * двадцатью и двумя сотнями обязана быть видна, а между пятью сотнями и тысячей
 * — уже нет, там всё равно «толпа до горизонта».
 *
 * Во второй пачке функция станет настоящей (масса, глубина строя, древки);
 * пока она нарочно одна и вынесена сюда, чтобы менять её в одном месте.
 */
export function figureCount(men: number): number {
  if (men <= 0) return 0;
  return Math.min(FIGURE_CAP, Math.max(FIGURE_MIN, Math.round(Math.sqrt(men) * 2)));
}

/** Сколько фигур стоит в кадре близкого плана: горстка с каждой стороны. */
export const MUSTER_FIGURES = 7;

// ---------- Поле ----------

/**
 * Геометрия поля в метрах сцены. Общая и для камеры, и для расстановки фигур:
 * два набора чисел разъехались бы, и камера подавалась бы мимо сектора.
 *
 * Наша сторона всегда на −Z, чужая на +Z, полосы идут по X. Полоса 0 — левый
 * фланг со стороны своей армии, поэтому чужой сектор полосы l стоит там же, где
 * наш сектор полосы 2−l: это и есть `facing` симуляции.
 */
export const FIELD = {
  /** Шаг между полосами. */
  laneW: 3.3,
  /** Расстояние от центра до фронта, пока строи не сошлись. */
  frontZ: 5,
  /** И когда сошлись. */
  contactZ: 1.4,
  /** Тыл за своим фронтом. */
  rowGap: 3.4,
  /** Резерв за тылом. */
  reserveGap: 3.6,
} as const;

// ---------- Строй ----------

/** Интервал в шеренге: плечом к плечу. */
export const FILE_STEP = 0.62;
/** Дистанция между рядами: чуть больше интервала. */
export const RANK_STEP = 0.74;

/**
 * Глубина строя растёт с числом БОЙЦОВ, не фигур. Фигур на сторону всегда не
 * больше `FIGURE_CAP`, и массы по ним не видно; а ряды видно сразу — сотня
 * стоит в два ряда, восемь сотен в четыре.
 *
 * Больше `MAX_RANKS` нельзя: блок вылезет за `FIELD.rowGap` и сядет на тыловой
 * сектор своей же полосы. Это проверяется тестом, а не помнится наизусть.
 */
export const RANK_MEN = 30;
export const MAX_RANKS = 4;

export function ranksFor(men: number, figures: number): number {
  if (figures <= 1) return 1;
  const byMen = Math.min(MAX_RANKS, Math.max(1, Math.floor(Math.log2(Math.max(1, men) / RANK_MEN)) + 1));
  // Глубже, чем позволяет число фигур, строй не ставим: три фигуры в четыре
  // ряда — это колонна по одному, а не строй.
  return Math.max(1, Math.min(byMen, Math.round(Math.sqrt(figures))));
}

/** Насколько блок уходит назад от своей передней шеренги. */
export const blockDepth = (ranks: number): number => Math.max(0, ranks - 1) * RANK_STEP;

// ---------- Масса ----------

/**
 * Одно знамя на столько бойцов. Знамёна можно сосчитать глазами, и это честная
 * единица измерения: три знамени против одного объясняют расклад без цифр.
 * Точное число при этом всё равно стоит цифрой в строке состояния — знамя
 * показывает порядок, а не подменяет счёт.
 */
export const BANNER_MEN = 50;

export const bannersFor = (men: number): number => (men > 0 ? Math.max(1, Math.round(men / BANNER_MEN)) : 0);

/**
 * Древков на фигуру. Их ставится больше, чем людей, — и это не украшение:
 * у реального строя издалека видно именно лес древков, а не лица. Один
 * инстансированный примитив, один вызов отрисовки.
 *
 * Плотность зависит от рода: копейная стена — сплошной частокол, у лучников
 * торчат луки, у конницы пики немногих всадников.
 */
export const SHAFTS_PER_FIGURE: Record<UnitKind, number> = {
  spear: 3.2,
  infantry: 2,
  archer: 1.4,
  cavalry: 1.6,
};

export function shaftsFor(byFace: readonly FaceCount[]): number {
  let n = 0;
  for (const f of byFace) n += f.figures * SHAFTS_PER_FIGURE[f.kind];
  return Math.round(n);
}

/**
 * Радиус тёмного пятна под строем. Площадь пропорциональна числу бойцов, а не
 * фигур: масса должна читаться и там, где фигур мало, — двадцать против пятисот
 * это ровно тот случай.
 */
export const DUST_PER_MAN = 0.055;
export const dustRadius = (men: number): number => (men > 0 ? Math.sqrt(men * DUST_PER_MAN) : 0);

export type Row = 'front' | 'rear' | 'reserve';

export const rowOf = (s: Sector): Row =>
  s === 'R' ? 'reserve' : FRONT.includes(s as never) ? 'front' : 'rear';

/** Полоса сектора: A/D — 0, B/E — 1, C/F — 2; у резерва полосы нет. */
export const laneOf = (s: Sector): Lane | null =>
  s === 'R' ? null : ((FRONT.indexOf(s as never) + REAR.indexOf(s as never) + 1) as Lane);

/** Насколько фронт выдвинут вперёд при данном сближении. */
export const frontDist = (closing: number): number =>
  FIELD.frontZ + (FIELD.contactZ - FIELD.frontZ) * clamp01(closing);

/**
 * Где на поле стоит сектор. `us` — сторона игрока: она всегда на −Z, чтобы
 * ролик показывал бой глазами того, кто его смотрит.
 */
export function sectorSpot(
  side: Side,
  us: Side,
  sector: Sector,
  closing: number,
): { x: number; z: number } {
  const sign = side === us ? -1 : 1;
  const lane = laneOf(sector);
  const x = lane === null ? 0 : sign === -1 ? (lane - 1) * FIELD.laneW : (1 - lane) * FIELD.laneW;
  const row = rowOf(sector);
  const d =
    frontDist(closing) +
    (row === 'front' ? 0 : row === 'rear' ? FIELD.rowGap : FIELD.rowGap + FIELD.reserveGap);
  return { x, z: sign * d };
}

// ---------- Камера ----------

/**
 * Положение камеры на кадре. Точками, а не углами: между двумя ключами всё
 * интерполируется покомпонентно, и ход выходит непрерывным сам собой.
 *
 * Числа подобраны под телефон в портрете (390 px). У three.js `fov`
 * вертикальный, а узкая сторона в портрете — горизонтальная, поэтому
 * стратегический план стоит дальше, чем кажется нужным по высоте кадра.
 */
export interface CameraShot {
  x: number;
  y: number;
  z: number;
  atX: number;
  atY: number;
  atZ: number;
  fov: number;
}

/**
 * Близкий план: камера у земли, за нашим левым флангом; видно горстку с обеих
 * сторон. Смотрит чуть вниз, а не по горизонту: в портрете кадр высокий, и
 * ровный взгляд отдаёт полэкрана пустому небу.
 */
const SHOT_MUSTER: CameraShot = { x: -5.9, y: 2.9, z: -12.4, atX: -3.2, atY: 0.75, atZ: -5, fov: 38 };

/** Тот же план чуть позже: камера уже пошла, но ещё внизу. */
const SHOT_MUSTER_END: CameraShot = { x: -5.5, y: 4.1, z: -12.8, atX: -2.8, atY: 0.75, atZ: -4, fov: 40 };

/**
 * Стратегический план: видны оба войска и все шесть секторов. Наклон подобран
 * так, чтобы вверху кадра оставалась полоска неба: отвесный взгляд превращает
 * бой в зелёную схему, а горизонт — единственное, что говорит «это поле».
 */
const SHOT_FIELD: CameraShot = { x: 0, y: 9.3, z: -17.5, atX: 0, atY: 0.9, atZ: 1.6, fov: 50 };

/** Спуск в конце — половина пути вниз. */
const SHOT_DOWN: CameraShot = { x: 0.8, y: 6, z: -15.5, atX: 0.3, atY: 0.7, atZ: -1.5, fov: 48 };

/** Финал: камера снова у земли — последнее знамя, бегущие, поле. */
const SHOT_LAST: CameraShot = { x: 3.4, y: 2.1, z: -9, atX: 0.4, atY: 0.6, atZ: -2, fov: 40 };

/** Подача к сектору на стратегическом плане: камера смещается, но плана не меняет. */
function shotAt(spot: { x: number; z: number }): CameraShot {
  return {
    x: spot.x * 0.25,
    y: 8.7,
    z: -16.9,
    atX: spot.x * 0.45,
    atY: 0.9,
    atZ: spot.z * 0.4 + 1.6,
    fov: 48,
  };
}

// ---------- Такты ----------

/**
 * Четыре такта — четыре положения камеры. Один непрерывный ход: близко →
 * отъезд → поле → снова близко. Склейки нет ни одной: она читается как другая
 * сцена, а непрерывность — как «та же битва, шире взгляд».
 */
export type Act = 'muster' | 'pullback' | 'melee' | 'rout';
export const ACTS: readonly Act[] = ['muster', 'pullback', 'melee', 'rout'];

/** Какие фазы боя укладываются в какой такт. */
export const ACT_PHASES: Record<Act, readonly PhaseId[]> = {
  muster: ['ranged'],
  pullback: ['approach'],
  melee: ['clash', 'lines', 'flanking', 'reserve', 'morale'],
  rout: ['retreat', 'pursuit'],
};

const ACT_OF = (() => {
  const map = {} as Record<PhaseId, Act>;
  for (const act of ACTS) for (const p of ACT_PHASES[act]) map[p] = act;
  return map;
})();

/** Близкий план — три-пять секунд: дольше нечего показывать, короче не разглядеть. */
export const MUSTER_SECONDS = 4;
/** Отъезд: на нём и становится видно соотношение сил. */
export const PULLBACK_SECONDS = 6;
/** Спуск к полю в конце. */
export const ROUT_SECONDS = 6;
/** Бой линий: длительность из содержания журнала, а не из числа тиков. */
export const MELEE_SECONDS = { base: 16, perMark: 1.6, min: 16, max: 40 };

/** Ближе этого камера к новому сектору не подаётся: иначе она мечется. */
export const MARK_HOLD = 2.0;
/** Сколько держится подпись события. */
export const CAPTION_HOLD = 2.6;

// ---------- Раскадровка ----------

export interface Keyframe {
  t: number;
  act: Act;
  shot: CameraShot;
}

/** Событие журнала, положенное на время и на место. */
export interface Mark {
  t: number;
  tick: number;
  phase: PhaseId;
  act: Act;
  id: EventId;
  side: Side;
  sector: Sector | null;
  lane: Lane | null;
  text: string;
}

/**
 * Кто именно стоит в строю: метка, род боя и сколько людей. **Ядро метку не
 * читает** — оно только делит фигуры в той же пропорции, в какой стоят люди.
 * Что означает `id`, знает тот, кто рисует: у племени это вид бойца или
 * ополчение, у сервера — что он туда положит.
 *
 * Так ядро остаётся ядром: `Face` для него — строка с весом, ровно как `Sector`
 * для него буква. А раскадровка остаётся самодостаточной: всё, что нужно
 * картинке, лежит в ней, и второго входа у показа нет.
 */
export interface Face {
  id: string;
  kind: UnitKind;
  men: number;
}

/** Столько фигур этой метки стоит в секторе. */
export interface FaceCount {
  id: string;
  kind: UnitKind;
  figures: number;
}

/** Сектор расстановки как объект показа: сколько фигур, каких, когда побежал. */
export interface CastSector {
  side: Side;
  sector: Sector;
  lane: Lane | null;
  row: Row;
  /** Бойцов на старте и к концу боя — из итога, а не из пересчёта. */
  men: number;
  finalMen: number;
  /** Фигуры по видам; сумма — `figures`. */
  byFace: FaceCount[];
  figures: number;
  /** Строй сектора: сколько рядов в глубину и сколько человек в шеренге. */
  ranks: number;
  files: number;
  /** Знамён, древков и радиус пятна массы — на полный сектор. */
  banners: number;
  shafts: number;
  dust: number;
  /** Ранг удалённости от кадра близкого плана: по нему фигуры и проявляются. */
  rank: number;
  /** Когда сектор побежал — из события журнала. null — не бежал. */
  brokenAt: number | null;
}

/** Фаза боя, положенная на время ролика. */
export interface Span {
  phase: PhaseId;
  act: Act;
  from: number;
  to: number;
  t0: number;
  t1: number;
  losses: Record<Side, number>;
  /** Те же потери по секторам, если журнал их знает. */
  bySector?: Record<Side, Partial<Record<Sector, number>>>;
}

export interface ActWindow {
  act: Act;
  from: number;
  to: number;
}

export interface Cast {
  /** Сторона игрока: она всегда на −Z и называется «наши». */
  us: Side;
  seed: number;
  /**
   * Журнал знает потери по секторам на каждую фазу. Тогда фланг, выбитый за одну
   * фазу, и тает за одну фазу. У записей боя, посчитанных до появления
   * `PhaseSpan.bySector`, этого нет, и сектор тает по общему ходу потерь стороны.
   */
  detailed: boolean;
  seconds: number;
  acts: ActWindow[];
  spans: Span[];
  keys: Keyframe[];
  marks: Mark[];
  sectors: CastSector[];
  /** Бойцов и фигур на стороне на старте. */
  men: Record<Side, number>;
  figures: Record<Side, number>;
  /** Кто удержал поле — чтобы финальный кадр знал, чьё знамя стоит. */
  winner: Side | 'draw';
}

// ---------- Управление ----------

/**
 * Кнопки кадра. Управление живёт в раскадровке, а не в разметке: «Пропустить»
 * обязана быть на каждом кадре, и проверить это можно только тогда, когда она
 * есть в данных. В JSX ролика не пишется ни одной кнопки — так же, как в
 * карточке вида не пишется ни одного множителя.
 */
export interface Control {
  id: 'skip';
  label: string;
  /** Куда ведёт: в отчёт цифрами. */
  goes: 'report';
}

export const SKIP: Control = { id: 'skip', label: 'Пропустить', goes: 'report' };
const CONTROLS: readonly Control[] = [SKIP];

// ---------- Кадр ----------

export interface SectorFrame {
  side: Side;
  sector: Sector;
  lane: Lane | null;
  row: Row;
  byFace: FaceCount[];
  /** Строй блока: ряды в глубину и человек в шеренге. Масса ставится по нему же. */
  ranks: number;
  files: number;
  /** Сколько фигур поставлено сейчас: на близком плане — кусок строя, дальше — всё. */
  figures: number;
  /** Сколько из них на ногах; остальные лежат. */
  standing: number;
  /** Масса на этом кадре: она проявляется вместе с фигурами и тает вместе с ними. */
  banners: number;
  shafts: number;
  dust: number;
  /** Сектор уже побежал — по журналу. */
  broken: boolean;
  x: number;
  z: number;
}

export interface SideFrame {
  /** Бойцов ещё живо. */
  men: number;
  figures: number;
  standing: number;
  /** Знамён в кадре: их считают глазами, поэтому число обязано сходиться. */
  banners: number;
}

export interface Frame {
  t: number;
  act: Act;
  phase: PhaseId;
  tick: number;
  shot: CameraShot;
  /** 0 — строи врозь, 1 — сошлись. */
  closing: number;
  /** К какому сектору подана камера. */
  focus: { side: Side; sector: Sector; lane: Lane | null } | null;
  caption: string | null;
  sectors: SectorFrame[];
  side: Record<Side, SideFrame>;
  controls: readonly Control[];
  done: boolean;
}

// ---------- Сборка ----------

const stackTotal = (s: Stack): number => UNIT_KINDS.reduce((n, k) => n + (s[k] ?? 0), 0);

/**
 * Разложить `total` целых единиц по весам `men`. Наибольший остаток: сумма
 * обязана сойтись ровно, иначе фигуры то прибывали бы, то убывали при
 * перекладывании — та же беда, из-за которой округление в `toArmySetup` одно
 * на род. Доля меньше половины фигуры из кадра выпадает: показать тридцать
 * всадников из трёхсот пеших одной фигурой честнее нечем.
 */
function spreadBy(men: number[], total: number): number[] {
  const sum = men.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return men.map(() => 0);
  const exact = men.map((m) => (m / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let given = out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - out[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; given < total; k++, given++) out[order[k % order.length].i] += 1;
  return out;
}

/**
 * Фигуры сектора по видам. Сначала по родам — их знает итог боя по секторам, —
 * потом внутри рода по видам в той пропорции, в какой они стоят во всей армии.
 *
 * Пропорция армейская, а не посекторная, потому что посекторной нет ни у кого:
 * `toArmySetup` складывает виды в роды ещё до боя, и ядро с этого места видит
 * только роды. Врать этим нельзя — можно ошибиться разве что в том, что латники
 * стояли не поровну по флангам.
 *
 * Метки не даны — метка равна роду. Так ядро остаётся работоспособным само по
 * себе; в игре состав есть всегда, и до картинки такая метка не доходит.
 */
function facesFor(stack: Stack, total: number, faces: Face[]): FaceCount[] {
  const kinds = spreadBy(
    UNIT_KINDS.map((k) => stack[k] ?? 0),
    total,
  );
  const out: FaceCount[] = [];
  UNIT_KINDS.forEach((kind, i) => {
    const n = kinds[i];
    if (n <= 0) return;
    const mine = faces.filter((f) => f.kind === kind && f.men > 0);
    if (mine.length === 0) {
      out.push({ id: kind, kind, figures: n });
      return;
    }
    const split = spreadBy(mine.map((f) => f.men), n);
    mine.forEach((f, j) => {
      if (split[j] > 0) out.push({ id: f.id, kind, figures: split[j] });
    });
  });
  return out;
}

/**
 * Сколько времени занимает бой линий. Из содержания журнала: мало событий —
 * короткий ролик. Асимметричные бои коротки сами собой, растягивать их нечем
 * и незачем.
 */
function meleeSeconds(marks: number): number {
  const raw = MELEE_SECONDS.base + MELEE_SECONDS.perMark * marks;
  return Math.min(MELEE_SECONDS.max, Math.max(MELEE_SECONDS.min, Math.round(raw * 10) / 10));
}

/** Границы тактов. Три из четырёх постоянные: близкий план и отъезд и есть лицо ролика. */
function actWindows(result: BattleResult): ActWindow[] {
  const meleeMarks = result.log.filter(
    (e) => e.id !== 'phase-start' && ACT_OF[e.phase] === 'melee',
  ).length;
  const lengths: Record<Act, number> = {
    muster: MUSTER_SECONDS,
    pullback: PULLBACK_SECONDS,
    melee: meleeSeconds(meleeMarks),
    rout: ROUT_SECONDS,
  };
  const out: ActWindow[] = [];
  let t = 0;
  for (const act of ACTS) {
    out.push({ act, from: t, to: t + lengths[act] });
    t += lengths[act];
  }
  return out;
}

/** Фазы внутри такта делят его время по числу тиков: тик — мера содержания. */
function layout(result: BattleResult, acts: ActWindow[]): Span[] {
  const out: Span[] = [];
  for (const win of acts) {
    const inAct = result.phases.filter((p) => ACT_OF[p.phase] === win.act);
    const ticks = inAct.reduce((n, p) => n + (p.to - p.from + 1), 0);
    let t = win.from;
    for (const p of inAct) {
      const dur = ticks > 0 ? ((p.to - p.from + 1) / ticks) * (win.to - win.from) : 0;
      out.push({
        phase: p.phase,
        act: win.act,
        from: p.from,
        to: p.to,
        t0: t,
        t1: t + dur,
        losses: p.losses,
        bySector: p.bySector,
      });
      t += dur;
    }
    // Фазы, которой в итоге нет, быть не должно, но такт без содержания всё
    // равно занимает своё время: камера едет по нему.
    if (inAct.length === 0) {
      const last = result.phases[result.phases.length - 1];
      const tick = last ? last.to : 0;
      out.push({
        phase: ACT_PHASES[win.act][0],
        act: win.act,
        from: tick,
        to: tick,
        t0: win.from,
        t1: win.to,
        losses: { attacker: 0, defender: 0 },
      });
    }
  }
  return out;
}

/**
 * Разложить `total` фигур по секторам пропорционально их численности. Сумма
 * обязана сойтись с `figureCount` стороны ровно: округляй каждый сектор сам по
 * себе — и на отъезде войско недосчитается фигуры без всякой причины. Сектор с
 * бойцами получает хотя бы одну, пока фигуры есть у кого занять: пустое место в
 * строю читается как «там никого нет».
 */
function spread(men: number[], total: number): number[] {
  const out = spreadBy(men, total);
  // Занять фигуру у самого многолюдного сектора для того, кому не досталось.
  for (let i = 0; i < out.length; i++) {
    if (out[i] > 0 || men[i] <= 0) continue;
    let donor = -1;
    for (let j = 0; j < out.length; j++) if (out[j] > 1 && (donor < 0 || out[j] > out[donor])) donor = j;
    if (donor < 0) break;
    out[donor] -= 1;
    out[i] += 1;
  }
  return out;
}

/** Сектора обеих сторон как объекты показа. */
function castSectors(result: BattleResult, us: Side, faces: Record<Side, Face[]>): CastSector[] {
  const out: CastSector[] = [];
  for (const side of SIDES2) {
    const res = result.sides[side];
    const total = figureCount(res.total.initial);
    const live = SECTORS.filter((sector) => stackTotal(res.sectors[sector].initial) > 0);
    const figures = spread(
      live.map((sector) => stackTotal(res.sectors[sector].initial)),
      total,
    );
    // Знамёна раскладываются на сторону целиком, а не считаются по секторам:
    // округление в каждом секторе врозь дало бы то шесть знамён, то девять при
    // одной и той же армии, а их считают глазами.
    const banners = spread(
      live.map((sector) => stackTotal(res.sectors[sector].initial)),
      bannersFor(res.total.initial),
    );
    live.forEach((sector, i) => {
      const cell = res.sectors[sector];
      const men = stackTotal(cell.initial);
      const byFace = facesFor(cell.initial, figures[i], faces[side]);
      const ranks = ranksFor(men, figures[i]);
      out.push({
        side,
        sector,
        lane: laneOf(sector),
        row: rowOf(sector),
        men,
        finalMen: stackTotal(cell.final),
        byFace,
        figures: figures[i],
        ranks,
        files: Math.max(1, Math.ceil(figures[i] / ranks)),
        banners: banners[i],
        shafts: shaftsFor(byFace),
        dust: dustRadius(men),
        rank: 0,
        brokenAt: null,
      });
    });
  }
  // Ранг удалённости от близкого плана: он смотрит на наш левый фланг, и фигуры
  // проявляются оттуда наружу — тогда отъезд читается как «видно шире», а не
  // как «всё выскочило разом».
  const near = sectorSpot(us, us, 'A', 0);
  const dist = (c: CastSector): number => {
    const p = sectorSpot(c.side, us, c.sector, 0);
    return (p.x - near.x) ** 2 + (p.z - near.z) ** 2;
  };
  [...out]
    .sort((a, b) => dist(a) - dist(b) || (a.side < b.side ? -1 : 1) || a.sector.localeCompare(b.sector))
    .forEach((c, i) => {
      c.rank = i;
    });
  return out;
}

/** Место события: у одних оно записано сектором, у других — целью удара. */
function sectorOf(e: BattleEvent): Sector | null {
  if ('sector' in e && e.sector) return e.sector;
  if ('target' in e && e.target) return e.target;
  if ('to' in e && e.to) return e.to;
  return null;
}

/** События журнала на времени и на месте. `phase-start` и `result` — служебные. */
function markLog(result: BattleResult, spans: Span[], us: Side): Mark[] {
  const at = (tick: number, phase: PhaseId): { t: number; act: Act } => {
    const span = spans.find((s) => s.phase === phase) ?? spans[0];
    const len = Math.max(1, span.to - span.from + 1);
    const u = clamp01((tick - span.from) / len);
    return { t: span.t0 + (span.t1 - span.t0) * u, act: span.act };
  };
  const out: Mark[] = [];
  for (const e of result.log) {
    if (e.id === 'phase-start' || e.id === 'result') continue;
    const { t, act } = at(e.tick, e.phase);
    const sector = sectorOf(e);
    out.push({
      t,
      tick: e.tick,
      phase: e.phase,
      act,
      id: e.id,
      side: 'side' in e ? e.side : us,
      sector,
      lane: sector ? laneOf(sector) : null,
      text: describeEvent(e, us),
    });
  }
  return out.sort((a, b) => a.t - b.t || a.tick - b.tick);
}

/**
 * Ход камеры. Один непрерывный: близкий план → отъезд → поле с подачей к
 * событиям → спуск к полю. Между соседними ключами всё интерполируется, поэтому
 * склейки нет по построению.
 */
function keyframes(us: Side, acts: ActWindow[], marks: Mark[]): Keyframe[] {
  const win = (a: Act): ActWindow => acts.find((w) => w.act === a)!;
  const keys: Keyframe[] = [
    { t: 0, act: 'muster', shot: SHOT_MUSTER },
    { t: win('muster').to, act: 'muster', shot: SHOT_MUSTER_END },
    { t: win('pullback').to, act: 'pullback', shot: SHOT_FIELD },
  ];

  // Бой линий: камера подаётся к сектору, где по журналу сейчас событие. Ключи
  // не чаще MARK_HOLD — иначе камера мечется и разглядеть не успеваешь ничего.
  const melee = win('melee');
  let last = melee.from - MARK_HOLD;
  for (const m of marks) {
    if (m.act !== 'melee' || !m.sector) continue;
    if (m.t - last < MARK_HOLD) continue;
    if (m.t > melee.to - 1) break;
    last = m.t;
    keys.push({ t: m.t, act: 'melee', shot: shotAt(sectorSpot(m.side, us, m.sector, 1)) });
  }
  keys.push({ t: melee.to, act: 'melee', shot: SHOT_FIELD });

  // Спуск: камера снова опускается к земле. Начали близко — закончили близко.
  const rout = win('rout');
  keys.push({ t: rout.from + (rout.to - rout.from) * 0.45, act: 'rout', shot: SHOT_DOWN });
  keys.push({ t: rout.to, act: 'rout', shot: SHOT_LAST });
  return keys.sort((a, b) => a.t - b.t);
}

/** Пустой состав: ядро обходится без меток, метка тогда равна роду. */
const NO_FACES: Record<Side, Face[]> = { attacker: [], defender: [] };

/**
 * Раскадровка боя. Один и тот же журнал даёт одну и ту же раскадровку.
 *
 * `faces` — кто именно стоял в строю с каждой стороны. Ядро эти метки не читает,
 * оно только делит по ним фигуры; без них метка равна роду боя. Игра передаёт
 * состав всегда — иначе близкий план не выполняет своего обещания.
 */
export function buildCast(result: BattleResult, us: Side, faces: Record<Side, Face[]> = NO_FACES): Cast {
  const acts = actWindows(result);
  const spans = layout(result, acts);
  const marks = markLog(result, spans, us);
  const sectors = castSectors(result, us, faces);
  for (const c of sectors) {
    const broke = marks.find((m) => m.id === 'sector-broken' && m.side === c.side && m.sector === c.sector);
    c.brokenAt = broke ? broke.t : null;
  }
  return {
    us,
    seed: result.seed,
    detailed: result.phases.every((p) => p.bySector !== undefined),
    seconds: acts[acts.length - 1].to,
    acts,
    spans,
    keys: keyframes(us, acts, marks),
    marks,
    sectors,
    men: {
      attacker: result.sides.attacker.total.initial,
      defender: result.sides.defender.total.initial,
    },
    figures: {
      attacker: figureCount(result.sides.attacker.total.initial),
      defender: figureCount(result.sides.defender.total.initial),
    },
    winner: result.winner,
  };
}

// ---------- Кадр в момент t ----------

const shotBetween = (a: CameraShot, b: CameraShot, u: number): CameraShot => ({
  x: lerp(a.x, b.x, u),
  y: lerp(a.y, b.y, u),
  z: lerp(a.z, b.z, u),
  atX: lerp(a.atX, b.atX, u),
  atY: lerp(a.atY, b.atY, u),
  atZ: lerp(a.atZ, b.atZ, u),
  fov: lerp(a.fov, b.fov, u),
});

/** Положение камеры на момент `t`. Непрерывно по построению: ключи и сглаживание. */
export function shotAtTime(cast: Cast, t: number): CameraShot {
  const keys = cast.keys;
  if (t <= keys[0].t) return keys[0].shot;
  const lastKey = keys[keys.length - 1];
  if (t >= lastKey.t) return lastKey.shot;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = b.t === a.t ? 1 : ease((t - a.t) / (b.t - a.t));
  return shotBetween(a.shot, b.shot, u);
}

/**
 * Сколько фигур стороне поставлено на момент `t`. На близком плане — горстка:
 * это кадрированный фрагмент строя, больше на такой дистанции и не видно. На
 * отъезде число РАСТЁТ до полного войска: армия не должна выглядеть тающей.
 */
export function placedAt(cast: Cast, side: Side, t: number): number {
  const total = cast.figures[side];
  const pull = cast.acts[1];
  const u = t <= pull.from ? 0 : t >= pull.to ? 1 : ease((t - pull.from) / (pull.to - pull.from));
  return Math.round(lerp(Math.min(MUSTER_FIGURES, total), total, u));
}

/** Доля потерь стороны, уже случившихся к моменту `t`: из фазовых потерь итога. */
function lossProgress(spans: Span[], side: Side, t: number): number {
  const total = spans.reduce((n, s) => n + s.losses[side], 0);
  if (total <= 0) return 0;
  let done = 0;
  for (const s of spans) {
    if (t >= s.t1) {
      done += s.losses[side];
      continue;
    }
    if (t > s.t0) done += s.losses[side] * ((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
    break;
  }
  return clamp01(done / total);
}

/**
 * Сколько сектор потерял к моменту `t` — по фазам, как записано в журнале. Внутри
 * фазы потери размазаны ровно: точнее журнал и не знает, а между фазами разница
 * уже видна. Это и есть смысл поля: фланг, выбитый за одну фазу, тает за одну
 * фазу, а не плавно вместе со всей армией.
 */
function sectorLost(spans: Span[], side: Side, sector: Sector, t: number): number {
  let lost = 0;
  for (const s of spans) {
    const n = s.bySector?.[side]?.[sector] ?? 0;
    if (t >= s.t1) {
      lost += n;
      continue;
    }
    if (t > s.t0) lost += n * ((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
    break;
  }
  return lost;
}

/** Событие, о котором ролик говорит сейчас: последнее случившееся. */
function activeMark(cast: Cast, t: number): Mark | null {
  let out: Mark | null = null;
  for (const m of cast.marks) {
    if (m.t > t) break;
    out = m;
  }
  return out;
}

/**
 * Кадр ролика. Всё, что в нём есть, выведено из раскадровки: ни одного броска
 * кубика, ни одного вызова симуляции, ни одного обращения к итогу боя.
 */
export function frameAt(cast: Cast, t: number): Frame {
  const time = Math.max(0, Math.min(cast.seconds, t));
  const span = cast.spans.find((s) => time < s.t1) ?? cast.spans[cast.spans.length - 1];
  const act = span.act;
  const pull = cast.acts[1];
  const closing =
    act === 'muster'
      ? 0
      : act === 'pullback'
        ? ease(clamp01((time - pull.from) / Math.max(1e-6, pull.to - pull.from)))
        : 1;
  const tick = Math.round(
    lerp(span.from, span.to, clamp01((time - span.t0) / Math.max(1e-6, span.t1 - span.t0))),
  );

  const mark = activeMark(cast, time);
  const focus = mark && mark.sector ? { side: mark.side, sector: mark.sector, lane: mark.lane } : null;

  const sectors: SectorFrame[] = [];
  const sideFrame = {} as Record<Side, SideFrame>;
  for (const side of SIDES2) {
    const progress = lossProgress(cast.spans, side, time);
    let left = placedAt(cast, side, time);
    let figures = 0;
    let standing = 0;
    let men = 0;
    let banners = 0;
    for (const c of cast.sectors.filter((x) => x.side === side).sort((a, b) => a.rank - b.rank)) {
      const shown = Math.max(0, Math.min(c.figures, left));
      left -= shown;
      // Сколько в секторе осталось людей. Журнал знает потери сектора по фазам —
      // берём их. Не знает (старая запись боя) — идём от начального к конечному
      // по общему ходу потерь стороны: итог знает оба конца, но не темп.
      const now = cast.detailed
        ? Math.max(0, c.men - sectorLost(cast.spans, side, c.sector, time))
        : c.men + (c.finalMen - c.men) * progress;
      men += now;
      const alive = c.men > 0 ? clamp01(now / c.men) : 0;
      const up = shown === 0 ? 0 : Math.min(shown, Math.max(now > 0.5 ? 1 : 0, Math.round(shown * alive)));
      figures += shown;
      standing += up;
      const spot = sectorSpot(side, cast.us, c.sector, closing);
      // Масса проявляется вместе с фигурами и убывает вместе с живыми: иначе на
      // близком плане над горсткой людей стояло бы всё войско знамён.
      const part = c.figures > 0 ? shown / c.figures : 0;
      const flags = shown > 0 ? Math.max(1, Math.round(c.banners * part * alive)) : 0;
      sectors.push({
        side,
        sector: c.sector,
        lane: c.lane,
        row: c.row,
        byFace: c.byFace,
        ranks: c.ranks,
        files: c.files,
        figures: shown,
        standing: up,
        banners: Math.min(c.banners, flags),
        shafts: Math.round(c.shafts * part * alive),
        // Пятно проявляется вместе с фигурами и убывает вместе с живыми: площадь
        // ему задаёт число людей, а не радиус, поэтому под корнем произведение.
        dust: c.dust * Math.sqrt(Math.max(0, part * alive)),
        broken: c.brokenAt !== null && time >= c.brokenAt,
        x: spot.x,
        z: spot.z,
      });
      banners += Math.min(c.banners, flags);
    }
    sideFrame[side] = { men: Math.round(men), figures, standing, banners };
  }

  return {
    t: time,
    act,
    phase: span.phase,
    tick,
    shot: shotAtTime(cast, time),
    closing,
    focus,
    caption: mark && time - mark.t <= CAPTION_HOLD ? mark.text : null,
    sectors,
    side: sideFrame,
    controls: CONTROLS,
    done: t >= cast.seconds,
  };
}

/** Чужая сторона для стороны `side`. */
export const foeOf = other;
