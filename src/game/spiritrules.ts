// Дух войска (ДР-1, docs/siege_v2.md, «Решения ДР-1») — числа и формулы, одни на игру и на книгу духа сервера (правило
// «spirit», `netlify/lib/watch.ts`). Своих источников у духа нет: он строится поверх того, что игра уже знает, — стабильности,
// терпения дружины (СБ-1: полоса войска — `sim/stability.armyBar`), стойкости (обряд, Воевода РТ-1, рыцари и купцы РТ-2 — та же
// шкала `FERVOUR_SCALE`), голода, полководца, казарм и Статуи Героя (ДР-7, `statuerules`), — и складывает их в две шкалы 0…100: мораль и дисциплину. Здесь только
// арифметика от готовых чисел (`SpiritIn`); из партии их собирает дверь `sim/spirit`, у сервера — книги.
//
// Устройство одной шкалы: **потолок** — основа и причины строками (что влияет), не ниже дна и не выше верха; **значение** — дно
// плюс доля пути от дна до потолка, которую держит жалованье: доля восстановления после минимального жалованья (`payShareAt`) на
// долю терпения, которое ещё не кончилось. Минимальное жалованье ведёт обе шкалы к дну, полное возвращает к потолку за
// `WAGE_RECOVER_MS`; неуплата — та же дверь: кончилось терпение — шкалы на дне, как при минимальном.
//
// Модуль без `@/`: его читает сервер.
import { SPIRIT } from '../battle/config';
import { realTime } from './pace';
import { FERVOUR_SCALE } from './estaterules';
import { STAB_MAX } from './stabrules';
import { MAX_BUILDING_LEVEL } from './constants';

const HOUR = 3600_000;

// ---------- Жалованье ----------

/** Жалованье дружине: полное или минимальное. */
export type WageMode = 'full' | 'min';
export const WAGE_MODES: readonly WageMode[] = ['full', 'min'];

/**
 * Какую долю полного жалованья платит минимальное. **Выведено:** минимальное держит дух на дне, а сила войска на дне обеих
 * шкал — ×0,747 (`npm run fight -- --derive-spirit --check`, строка «обе на дне», 200 сидов; docs/siege_v2.md, 24.2); платят ровно
 * за ту силу, что покупают, — минимальное не выгоднее полного на единицу силы, оно лишь дешевле, пока войско не нужно (Д3).
 */
export const WAGE_MIN_SHARE = 0.75;

/** Минимальное → полное: от дна до потолка за шесть настоящих часов (слово владельца: «~6 настоящих часов»). */
export const WAGE_RECOVER_MS = realTime(6 * HOUR);

/** Полное → минимальное: от потолка до дна за два настоящих часа — уйти легче, чем вернуться (Д3). */
export const WAGE_FALL_MS = realTime(2 * HOUR);

/**
 * Доля восстановления жалованья через `elapsedMs` настоящего времени после смены на `mode`, начатой с доли `from`, 0…1.
 * Полное — кривая «быстро, потом тише» `1 − (1 − t/T)²` по всему пути от дна: с середины пути до потолка — его остаток по той
 * же кривой, а не новые шесть часов. Минимальное — прямая к дну за `WAGE_FALL_MS`.
 */
export function payShareAt(mode: WageMode, from: number, elapsedMs: number): number {
  const f = Math.max(0, Math.min(1, Number.isFinite(from) ? from : 1));
  const dt = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  if (mode === 'min') return Math.max(0, f - dt / WAGE_FALL_MS);
  const t0 = WAGE_RECOVER_MS * (1 - Math.sqrt(1 - f));
  const t = Math.min(1, (t0 + dt) / WAGE_RECOVER_MS);
  return 1 - (1 - t) * (1 - t);
}

/** Сколько настоящего времени до потолка (полное) или до дна (минимальное) с доли `share`; уже там — ноль. */
export function payLeftMs(mode: WageMode, share: number): number {
  const f = Math.max(0, Math.min(1, share));
  if (mode === 'min') return f * WAGE_FALL_MS;
  return WAGE_RECOVER_MS * Math.sqrt(1 - f);
}

// ---------- Шкалы ----------

/** Дно и верх шкал; основа — нейтраль боя (`SPIRIT.even`): здоровое войско без причин бьётся, как до духа. */
export const SPIRIT_FLOOR = 0;
export const SPIRIT_TOP = SPIRIT.top;
export const SPIRIT_BASE = SPIRIT.even;

/** Ступень стабильности (−3…+3): мораль и дисциплина за ступень. */
export const STAB_MORALE = 4;
export const STAB_DRILL = 2;

/** Голод: вся дружина некормлена — мораль и дисциплина ниже на столько. */
export const HUNGER_MORALE = 20;
export const HUNGER_DRILL = 10;

/**
 * Память боёв: победа прибавляет, поражение отнимает (горше, чем радует победа), не дальше `GLORY_CAP` в обе стороны; память
 * тает вдвое за `GLORY_HALF_MS`. Дисциплине — половина: строй держит выучка, а не слава.
 */
export const GLORY_WIN = 5;
export const GLORY_LOSS = 8;
export const GLORY_CAP = 15;
export const GLORY_HALF_MS = realTime(24 * HOUR);
export const GLORY_DRILL = 0.5;

/** Память боёв через `elapsedMs` настоящего времени после отметки `glory`. */
export const gloryAt = (glory: number, elapsedMs: number): number =>
  Number.isFinite(glory) ? Math.max(-GLORY_CAP, Math.min(GLORY_CAP, glory)) * 2 ** (-Math.max(0, elapsedMs) / GLORY_HALF_MS) : 0;

/**
 * Отметка памяти после боя: что было сейчас, плюс победа или минус поражение, в пределах `GLORY_CAP`. `edge` — прибавка черты
 * правителя к этому исходу (ПН-2: «Воитель» после победы, «Трус» после поражения; `rulertraits`): память одна, и потолок у неё
 * общий — сервер её прибавки не видит и не должен.
 */
export const gloryAfter = (now: number, won: boolean, edge = 0): number =>
  Math.max(-GLORY_CAP, Math.min(GLORY_CAP, now + (won ? GLORY_WIN : -GLORY_LOSS) + edge));

/**
 * Стойкость (обряд, Воевода, рыцари; шкала `FERVOUR_SCALE` — вся стартовая мораль дружины) в очках морали: **вся шкала стойкости
 * — весь путь от основы до верха**. Прежде стойкость шла в бой прибавкой к стартовой морали; теперь — строкой морали, одной
 * дверью (Д2): Воевода, обряд и рыцари поднимают мораль долей своей шкалы, купцы режут сумму своей долей.
 */
export const RESOLVE_SPAN = SPIRIT.top - SPIRIT.even;
export const resolvePoints = (resolve: number): number => (Math.max(0, resolve) / FERVOUR_SCALE) * RESOLVE_SPAN;

/** Полководец: дисциплина за каждый уровень сверх первого; места нет — строй без начальника. */
export const GENERAL_DRILL = 2.5;
export const GENERAL_VACANT = 5;

/** Казармы: дисциплина за каждый уровень сверх первого — выучка. */
export const BARRACKS_DRILL = 1;

/** Причины шкалы — строками «что влияет». */
export type SpiritLineId =
  | 'base'
  | 'stab'
  | 'glory'
  | 'hunger'
  | 'rite'
  | 'marshal'
  | 'knights'
  | 'merchants'
  | 'general'
  | 'barracks'
  | 'statue'
  | 'ruler'
  | 'cap'
  | 'wage'
  | 'patience';

export interface SpiritLine {
  id: SpiritLineId;
  value: number;
}

/** Готовые числа, из которых складывается дух: из партии — `sim/spirit.spiritIn`, у сервера — книги. */
export interface SpiritIn {
  /** Ступень стабильности, −3…+3. */
  stab: number;
  /** Полоса терпения дружины, 0…100 (`sim/stability.armyBar`): долг или голод, сколько уже вытерпели. */
  patience: number;
  /** Доля дружины, которую нечем кормить, 0…1. */
  unfed: number;
  /** Память боёв сейчас (`gloryAt`). */
  glory: number;
  /** Стойкость по источникам, в очках шкалы `FERVOUR_SCALE`: обряд, Воевода, рыцари. */
  rite: number;
  marshal: number;
  knights: number;
  /** Минус купцов, доля: режет стойкость (`derived.armyResolve`). */
  merchants: number;
  /** Уровень полководца; места нет — `null`. */
  general: number | null;
  /** Уровень казарм; казарм нет — 0. */
  barracks: number;
  /** Мораль от Статуи Героя, очков шкалы (`statuerules.statueMorale`); Статуи нет — 0. */
  statue: number;
  /** Доля восстановления жалованья, 0…1 (`payShareAt`). */
  pay: number;
  /** Дисциплина от черт правителя (ПН-2: «Щедрый», «Скупой» — `rulertraits.rulerTraitNumbers`); нет — ноль. */
  ruler?: number;
}

/** Одна шкала: значение, потолок и строки. Сумма строк — значение. */
export interface SpiritAxis {
  value: number;
  ceil: number;
  lines: SpiritLine[];
}

export interface SpiritView {
  morale: SpiritAxis;
  discipline: SpiritAxis;
}

const clamp = (v: number): number => Math.max(SPIRIT_FLOOR, Math.min(SPIRIT_TOP, v));
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

/** Строки стойкости: обряд, Воевода и рыцари своей долей шкалы, купцы режут их сумму. */
function resolveLines(i: SpiritIn): SpiritLine[] {
  const rite = resolvePoints(fin(i.rite));
  const marshal = resolvePoints(fin(i.marshal));
  const knights = resolvePoints(fin(i.knights));
  const cut = Math.max(0, Math.min(1, fin(i.merchants)));
  return [
    { id: 'rite', value: rite },
    { id: 'marshal', value: marshal },
    { id: 'knights', value: knights },
    { id: 'merchants', value: -(rite + marshal + knights) * cut },
  ];
}

/** Строки жалованья и терпения: путь от дна до потолка, который жалованье не держит. */
function payLines(ceil: number, i: SpiritIn): SpiritLine[] {
  const pay = Math.max(0, Math.min(1, fin(i.pay, 1)));
  const bar = Math.max(0, Math.min(100, fin(i.patience))) / 100;
  const span = ceil - SPIRIT_FLOOR;
  return [
    { id: 'wage', value: -span * (1 - pay) },
    { id: 'patience', value: -span * pay * bar },
  ];
}

function axisOf(ceilLines: SpiritLine[], i: SpiritIn): SpiritAxis {
  const sum = ceilLines.reduce((n, l) => n + l.value, 0);
  const ceil = clamp(sum);
  // Срез у верха или дна — своей строкой («шкала кончилась»), чтобы сумма строк была значением.
  const lines = [...ceilLines, { id: 'cap' as const, value: ceil - sum }];
  const pay = payLines(ceil, i);
  const value = clamp(ceil + pay.reduce((n, l) => n + l.value, 0));
  return { value, ceil, lines: [...lines, ...pay].filter((l) => l.id === 'base' || Math.abs(l.value) > 1e-9) };
}

/** Мораль и дисциплина из готовых чисел: потолок строками, значение — с жалованьем и терпением. */
export function spiritOfIn(i: SpiritIn): SpiritView {
  const stab = Math.max(-STAB_MAX, Math.min(STAB_MAX, Math.round(fin(i.stab))));
  const unfed = Math.max(0, Math.min(1, fin(i.unfed)));
  const glory = Math.max(-GLORY_CAP, Math.min(GLORY_CAP, fin(i.glory)));
  const res = resolveLines(i);
  const marshal = res.find((l) => l.id === 'marshal')?.value ?? 0;
  const morale = axisOf(
    [
      { id: 'base', value: SPIRIT_BASE },
      { id: 'stab', value: STAB_MORALE * stab },
      { id: 'glory', value: glory },
      { id: 'hunger', value: -HUNGER_MORALE * unfed },
      ...res,
      // Статуя Героя (ДР-7): памятник, а не стойкость — купцы его не режут.
      { id: 'statue', value: Math.max(0, fin(i.statue)) },
    ],
    i,
  );
  const general = i.general === null ? -GENERAL_VACANT : GENERAL_DRILL * Math.max(0, Math.floor(fin(i.general, 1)) - 1);
  const discipline = axisOf(
    [
      { id: 'base', value: SPIRIT_BASE },
      { id: 'stab', value: STAB_DRILL * stab },
      { id: 'glory', value: GLORY_DRILL * glory },
      { id: 'hunger', value: -HUNGER_DRILL * unfed },
      // Воевода учит строй той же долей, какой поднимает мораль: польза одна, строки две.
      { id: 'marshal', value: marshal },
      { id: 'general', value: general },
      { id: 'barracks', value: BARRACKS_DRILL * Math.max(0, Math.min(MAX_BUILDING_LEVEL, Math.floor(fin(i.barracks))) - 1) },
      // Черты правителя (ПН-2): щедрость и скупость — в строй; ноль строкой не показывается.
      { id: 'ruler', value: fin(i.ruler ?? 0) },
    ],
    i,
  );
  return { morale, discipline };
}

/** Дух целыми десятыми — то, что едет в бой и на сервер: без хвоста плавающей точки. */
export const spiritNumbers = (v: SpiritView): { morale: number; discipline: number } => ({
  morale: Math.round(v.morale.value * 10) / 10,
  discipline: Math.round(v.discipline.value * 10) / 10,
});

/** Допуск сверки сервера: опись округлена и снята чуть раньше минуты книги. */
export const SPIRIT_SLACK = 1;
