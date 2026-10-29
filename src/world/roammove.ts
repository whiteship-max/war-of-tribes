// Запись хода отряда бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.2–3.5.3; «Решения ПН-3») — форма и её чтение, без правил.
//
// Правила хода и лагеря — дверь `world/roam` (путь, отказы, энергия, рогатки, место выхода). Здесь — только то, что нужно шагу
// партии и чтению сохранения: вид лагеря, режим марша хода и разбор записи из сохранения и из реестра. Отдельным модулем
// нарочно: шаг партии (`sim/roam`) зовёт диспетчер шага города, и дверь хода с её землёй, регионами и руинами, импортированная
// оттуда, уехала бы в первую загрузку (как дверь режима марша в ПН-1, «Решения ПН-1», Р11).
//
// Без `@/` и без вычислений на верхнем уровне: модуль собирает сервер (строка отряда в реестре).
import { GAIT_SPEED, readGait, type Gait } from './data/gait';
import type { EnergyMark, EnergyMode } from './energy';

/** Вид лагеря (ГДД 3.5.3): открытый (костры, шатры), скрытый (без огня), в руинах. */
export type CampKind = 'open' | 'hidden' | 'ruin';
export const CAMP_KINDS: readonly CampKind[] = ['open', 'hidden', 'ruin'];

/** Клетка мира — та же, что `world/land.Spot`, по устройству. */
export interface Cell {
  x: number;
  y: number;
}

/**
 * Ход отряда: откуда и куда, когда вышел и когда придёт (часы мира, мс) и в каком режиме марша (`gait`; обычный — без поля).
 * Стоит — `from` = `to` или срок прошёл. **Режим марша отряда живёт здесь и больше нигде** (решение ПН-3).
 */
export interface RoamWay {
  from: Cell;
  to: Cell;
  at: number;
  until: number;
  gait?: 'light' | 'train';
}

/** Лагерь отряда: вид, с какой минуты стоит (часы мира, мс; от неё растут рогатки) и сколько бойцов строя их ставили. */
export interface RoamCampRec {
  kind: CampKind;
  since: number;
  builders: number;
}

/** Запись хода целиком — то, что лежит в партии (`GameState.roam`) и в строке отряда реестра сервера. */
export interface RoamMove {
  way: RoamWay;
  camp: RoamCampRec | null;
  /** Энергия отряда (`world/energy`); нет поля — полный запас. */
  energy?: EnergyMark;
}

/** Режим марша хода. Хода нет (место выхода не названо) — обычный. */
export const wayGait = (w: Pick<RoamWay, 'gait'> | undefined): Gait => readGait(w?.gait);

/** Ход отряда, стоящего на клетке `at` с минуты `now` в режиме `g`: обычный — без поля режима. */
export const standWay = (g: Gait, at: Cell = { x: 0, y: 0 }, now = 0): RoamWay => ({
  from: { x: at.x, y: at.y },
  to: { x: at.x, y: at.y },
  at: now,
  until: now,
  ...(g === 'light' || g === 'train' ? { gait: g } : {}),
});

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function cellOf(v: unknown): Cell | null {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const x = num(r.x);
  const y = num(r.y);
  return x === null || y === null ? null : { x: Math.round(x), y: Math.round(y) };
}

/** Ход из записи: новый объект; мусор — `null`. Срок не раньше выхода. */
export function readWay(v: unknown): RoamWay | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const from = cellOf(r.from);
  const to = cellOf(r.to);
  const at = num(r.at);
  const until = num(r.until);
  if (!from || !to || at === null || until === null) return null;
  const g = readGait(r.gait);
  return { from, to, at, until: Math.max(at, until), ...(g === 'normal' ? {} : { gait: g }) };
}

/** Лагерь из записи: вид из списка, минута, строители не ниже нуля; мусор — `null`. */
export function readCamp(v: unknown): RoamCampRec | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const kind = CAMP_KINDS.includes(r.kind as CampKind) ? (r.kind as CampKind) : null;
  const since = num(r.since);
  if (kind === null || since === null) return null;
  return { kind, since, builders: Math.max(0, Math.floor(num(r.builders) ?? 0)) };
}

const MODES: readonly EnergyMode[] = ['drain', 'fill', 'camp', 'hold'];

/**
 * Отметка энергии отряда из записи: новый объект, запас 0…100, режим из списка; мусор — нет отметки (полный запас). Минута
 * отметки — не позже `latest` (сервер передаёт свои часы): до минуты отметки запас не убывает, и отметка из будущего держала бы
 * отряд свежим весь путь; поворот — не раньше отметки.
 */
export function readMark(v: unknown, latest = Infinity): EnergyMark | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const value = num(r.value);
  const raw = num(r.at);
  const mode = MODES.includes(r.mode as EnergyMode) ? (r.mode as EnergyMode) : null;
  if (value === null || raw === null || mode === null) return undefined;
  const at = Math.min(raw, latest);
  const turn = (x: unknown): number | null => {
    const n = num(x);
    return n === null ? null : Math.max(at, n);
  };
  const homeAt = turn(r.homeAt);
  const stopAt = turn(r.stopAt);
  // Темп дороги — в пределах скоростей режимов марша (как `contract.readEnergy` у войны).
  const raw2 = num(r.rate);
  const speeds = Object.values(GAIT_SPEED);
  const rate = raw2 === null ? null : Math.max(Math.min(...speeds), Math.min(Math.max(...speeds), raw2));
  return {
    value: Math.max(0, Math.min(100, value)),
    at,
    mode,
    ...(homeAt !== null ? { homeAt } : {}),
    ...(stopAt !== null ? { stopAt } : {}),
    ...(mode === 'drain' && rate !== null && rate !== 1 ? { rate } : {}),
  };
}

/** Запись хода из сохранения или реестра: без хода — `null` (место выхода не названо). */
export function readMove(v: unknown, latest = Infinity): RoamMove | null {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const way = readWay(r.way);
  if (!way) return null;
  const energy = readMark(r.energy, latest);
  return { way, camp: readCamp(r.camp), ...(energy ? { energy } : {}) };
}

// ---------- Встреча с НПС, замороженная при отправке (ПН-5, ГДД 3.6.3) ----------

/** Вид цели удара (ГДД 3.6.1): логово, ватага НПС, ополчение села. Слова и сила — дверь `world/roamfoes`. */
export type TripFoe = 'lair' | 'band' | 'militia';

/**
 * Встреча хода с НПС — то, что заморожено в минуту приказа и показано до него (`world/encounter.tripOf`): шанс засады и её сила, а
 * если кость засады выпала — где и когда встреча; удар по цели в минуту прихода — её сила. Лежит в партии (`RoamState.trip`), пишет
 * одна дверь (`sim/roam.setTrip`); разобрана встреча — отметка `done`, второй раз бой не идёт. Ход сменился — встреча прежнего хода
 * снимается (`setMove`).
 */
export interface RoamTrip {
  /** Ход, к которому заморожено: приход и цель. */
  until: number;
  to: Cell;
  /** Шанс засады и сила засады — показанные до приказа числа. */
  odds: { p: number; power: number };
  /** Засада состоится: минута и клетка встречи (`pursuit.intercept`), сид боя. */
  ambush?: { at: number; cell: Cell; seed: number; done?: true };
  /** Удар по цели в минуту прихода: номер точки, вид, имя, сила, сид боя. */
  strike?: { id: string; kind: TripFoe; name: string; power: number; seed: number; done?: true };
}

const FOES: readonly TripFoe[] = ['lair', 'band', 'militia'];

/** Встреча из записи: новый объект; мусор — `null`. */
export function readTrip(v: unknown): RoamTrip | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const until = num(r.until);
  const to = cellOf(r.to);
  const o = (r.odds && typeof r.odds === 'object' ? r.odds : {}) as Record<string, unknown>;
  const p = num(o.p);
  const power = num(o.power);
  if (until === null || !to || p === null || power === null) return null;
  const out: RoamTrip = { until, to, odds: { p: Math.max(0, Math.min(1, p)), power: Math.max(0, power) } };
  const a = (r.ambush && typeof r.ambush === 'object' ? r.ambush : null) as Record<string, unknown> | null;
  const at = a ? num(a.at) : null;
  const cell = a ? cellOf(a.cell) : null;
  const seed = a ? num(a.seed) : null;
  if (a && at !== null && cell && seed !== null) out.ambush = { at, cell, seed, ...(a.done === true ? { done: true as const } : {}) };
  const st = (r.strike && typeof r.strike === 'object' ? r.strike : null) as Record<string, unknown> | null;
  if (st && typeof st.id === 'string' && FOES.includes(st.kind as TripFoe) && typeof st.name === 'string') {
    const sp = num(st.power);
    const ss = num(st.seed);
    if (sp !== null && ss !== null) {
      out.strike = { id: st.id.slice(0, 64), kind: st.kind as TripFoe, name: st.name.slice(0, 60), power: Math.max(0, sp), seed: ss, ...(st.done === true ? { done: true as const } : {}) };
    }
  }
  return out;
}

/** Встреча относится к ходу `way`: тот же приход и та же цель. */
export const tripOfWay = (t: Pick<RoamTrip, 'until' | 'to'>, way: Pick<RoamWay, 'until' | 'to'>): boolean =>
  t.until === way.until && t.to.x === way.to.x && t.to.y === way.to.y;
