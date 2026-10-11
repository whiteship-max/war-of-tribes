// Ход осады фазами — одна дверь на мир и на сервер войны (docs/siege_v2.md, разделы 2, 3 и 8.3; этап 2б).
//
// Модуль чистый, того же рода, что `siege.ts` и `siegecraft.ts`: ни состояния мира, ни часов, ни `Math.random`, и без
// `@/` — его собирает сервер войны (`netlify/lib/war.ts`). Правило то же — **тика нет**. Фаза — минута, выведенная из
// отметки осады: `t_k = since + k × SIEGE_PHASE`. Бросок фазы — кость из сида осады и номера фазы, исход — чистая функция
// от броска, входов на минуту фазы (окно осады: стена, часы голода, журнал дел с минутами) и исходов прошлых фаз. Тот же
// вход даёт тот же исход у кого угодно; мир и сервер разбирают фазу как событие своей очереди, в её минуту, и пишут
// строку в окно (`SiegeWindow.phases`) — журнал, который видят обе стороны.
//
// Что фаза делает с миром, решает мир (пролом — в окне, мор и истощение — людьми лагеря, ворота — падение города той же
// дверью, что голод). Здесь — кость, поправки, исход, доля истощения, наказы и слова о них (правило 18).
import type { SiegeWindow } from './siege';
import type { Fate } from './types';
import { siegeSince, starvesAt } from './siege';
import {
  BREACH_MAX,
  CAMP_WASTE,
  CAMP_WASTE_DAYS,
  CAMP_WASTE_HUNGRY,
  LEGACY_VOLLEY_WALL,
  MOD_BREACH,
  MOD_HUNGER,
  MOD_PROGRESS,
  MOD_VOLLEY,
  OUT_BREACH_MAX,
  OUT_CALM_MAX,
  OUT_PLAGUE_MAX,
  OUT_SHORT_MAX,
  SIEGE_DIE,
  SIEGE_PHASE,
  VOLLEY_SHAKE_DECAY,
  VOLLEY_SHAKE_FIRST,
  WALL_FACES_MAX,
  WALL_LEVELS_PER_FACE,
} from './data/siegeroll';

/** Исход фазы (docs/siege_v2.md, 2.4): мор в лагере, без перемен, нехватка в городе, пролом, ворота открыли. */
export type PhaseOut = 'plague' | 'calm' | 'short' | 'breach' | 'gates';

/** Поправка к кости фазы. Порядок — порядок строки журнала. */
export type ModId = 'breach' | 'volley' | 'hunger' | 'progress' | 'wall';
export const MOD_IDS: readonly ModId[] = ['breach', 'volley', 'hunger', 'progress', 'wall'];
export type PhaseMods = Partial<Record<ModId, number>>;

/** Наказ на отлучку, сработавший в минуту фазы (docs/siege_v2.md, 8.3). */
export type OrderId = 'volley' | 'storm';

/** Строка журнала фаз: брошенная фаза. Пишет её мир или сервер в минуту фазы; дальше она не меняется. */
export interface PhaseRow {
  /** Минута броска, мс мира. */
  at: number;
  /** Кость, 1..14. */
  die: number;
  /** Поправки, целыми гранями; нулевых нет. */
  mods: PhaseMods;
  out: PhaseOut;
  /** Какая доля бойцов строя ушла из лагеря в эту фазу — истощение и мор (раздел 3). */
  waste: number;
  /** Наказы, сработавшие в эту минуту. Нет поля — ни одного. */
  orders?: OrderId[];
}

/** Дело с минутой в журнале окна: входы фазы должны быть известны задним числом (docs/siege_v2.md, 2.1). */
export interface SiegeDeed {
  at: number;
  act: 'volley';
}

/**
 * Наказы осаждающего — стоящие приказы, которые срабатывают в минуту фазы той же дверью, что ручные (8.3): залп каждую
 * фазу, пока энергии хватает и на залп, и на штурм после него; штурм, когда проломов не меньше `storm`. Наказы
 * защитника приходят с его делами (починка, паёк, вылазка на машину — этап 2г).
 */
export interface SiegeOrders {
  volley?: boolean;
  /** Штурмовать, когда проломов столько (1..3). Нет поля — не штурмовать. */
  storm?: number;
}

/** Окно глазами двери фаз: что ей нужно из `SiegeWindow`. Тот же тип у лагеря сервера войны (`contract.WarCamp`). */
export type RollWindow = Pick<
  SiegeWindow,
  'campId' | 'startedAt' | 'sinceAt' | 'foodAtStart' | 'garrisonAtStart' | 'townPerHour' | 'perManPerHour' | 'craft' | 'wall' | 'log' | 'phases'
>;

/** Минута броска фазы `k` (с единицы). */
export const phaseAt = (since: number, k: number): number => since + k * SIEGE_PHASE;

/** Номер фазы, в которой лежит минута `at`: с единицы, фаза `k` — промежуток [t_{k−1}, t_k). */
export const phaseOf = (since: number, at: number): number => Math.floor(Math.max(0, at - since) / SIEGE_PHASE) + 1;

/** Брошенные фазы окна. */
export const rowsOf = (w: Pick<RollWindow, 'phases'>): readonly PhaseRow[] => w.phases ?? [];

/** Минута следующего броска. */
export const nextRollAt = (w: RollWindow): number => phaseAt(siegeSince(w as SiegeWindow), rowsOf(w).length + 1);

/** Сколько проломов у окна из сохранения до фаз: прежние залпы, доля стены × 3, вниз до целого. */
function legacyBreaches(w: Pick<RollWindow, 'craft' | 'log'>): number {
  if (w.log) return 0;
  const shots = Math.max(0, Math.floor(w.craft?.shots ?? 0));
  const share = LEGACY_VOLLEY_WALL.slice(0, shots).reduce((n, v) => n + v, 0);
  return Math.floor(share * BREACH_MAX + 1e-9);
}

/** Проломов среди строк, без потолка и без прежних залпов. */
const breachRows = (rows: readonly PhaseRow[]): number => rows.filter((r) => r.out === 'breach').length;

/** Сколько проломов в стене после брошенных фаз: 0..3 (`BREACH_MAX`). */
export function breachesOf(w: Pick<RollWindow, 'craft' | 'log' | 'phases'>, rows: readonly PhaseRow[] = rowsOf(w)): number {
  return Math.min(BREACH_MAX, legacyBreaches(w) + breachRows(rows));
}

/**
 * Накопленный ход осады — ступени: нехватка в городе даёт одну, пролом одну, пролом сверх трёх — ещё одну вместо пролома
 * (docs/siege_v2.md, 2.4).
 */
export function progressOf(w: Pick<RollWindow, 'craft' | 'log' | 'phases'>, rows: readonly PhaseRow[] = rowsOf(w)): number {
  let steps = 0;
  let breaches = legacyBreaches(w);
  for (const r of rows) {
    if (r.out === 'short') steps += 1;
    if (r.out === 'breach') {
      steps += breaches >= BREACH_MAX ? 2 : 1;
      breaches += 1;
    }
  }
  return steps;
}

/** Доля хлеба города в минуту `at`, 0..1: от часов голода окна — единица, когда встал лагерь, ноль в минуту голода. */
export function breadLeft(w: RollWindow, at: number): number {
  const since = siegeSince(w as SiegeWindow);
  const end = starvesAt(w as SiegeWindow);
  if (!(end > since)) return 0;
  return Math.min(1, Math.max(0, (end - at) / (end - since)));
}

/** Залпы в журнале окна. */
export const volleysOf = (w: Pick<RollWindow, 'log'>): readonly SiegeDeed[] => (w.log ?? []).filter((d) => d.act === 'volley');

/** Дан ли залп в фазе `k`. */
export function volleyIn(w: RollWindow, k: number): boolean {
  const since = siegeSince(w as SiegeWindow);
  const from = phaseAt(since, k - 1);
  const to = phaseAt(since, k);
  return volleysOf(w).some((d) => d.at >= from && d.at < to);
}

/** Стена в гранях: −1 за каждые два уровня частокола, до −5. У логова и двора мира стены нет — ноль. */
export const wallFaces = (level: number | undefined): number =>
  -Math.min(WALL_FACES_MAX, Math.floor(Math.max(0, level ?? 0) / WALL_LEVELS_PER_FACE));

/**
 * Поправки фазы `k` (docs/siege_v2.md, 2.3) — по окну и строкам до неё. Нулевых в ответе нет: строка журнала называет
 * только то, что сыграло.
 */
export function modsOf(w: RollWindow, k: number, prior: readonly PhaseRow[] = rowsOf(w).slice(0, k - 1)): PhaseMods {
  const at = phaseAt(siegeSince(w as SiegeWindow), k);
  const bread = breadLeft(w, at);
  const hunger = MOD_HUNGER.find((h) => bread < h.below)?.faces ?? 0;
  const mods: PhaseMods = {
    breach: breachesOf(w, prior) * MOD_BREACH,
    volley: volleyIn(w, k) ? MOD_VOLLEY : 0,
    hunger,
    progress: progressOf(w, prior) * MOD_PROGRESS,
    wall: wallFaces(w.wall),
  };
  for (const id of MOD_IDS) if (!mods[id]) delete mods[id];
  return mods;
}

/** Сумма поправок. */
export const modsSum = (mods: PhaseMods): number => MOD_IDS.reduce((n, id) => n + (mods[id] ?? 0), 0);

/**
 * Исход по итогу (таблица EU4, 2.4) — с ответом владельца 7: **город не падает раньше, чем через фазу после вести о
 * проломе.** Весть уходит защитнику в минуту пролома, поэтому «ворота открыли» возможно, только если пролом был в
 * прошлой фазе или раньше; иначе выпавшая сдача — пролом.
 */
export function outOf(total: number, prior: readonly PhaseRow[], legacy = 0): PhaseOut {
  if (total <= OUT_PLAGUE_MAX) return 'plague';
  if (total <= OUT_CALM_MAX) return 'calm';
  if (total <= OUT_SHORT_MAX) return 'short';
  if (total <= OUT_BREACH_MAX) return 'breach';
  return legacy + breachRows(prior) > 0 ? 'gates' : 'breach';
}

/** Сид осады: лагерь и минута, когда он встал. Пересчёт часов голода его не двигает. */
export const rollSeed = (w: Pick<RollWindow, 'campId' | 'startedAt' | 'sinceAt'>): string =>
  `${w.campId}:${siegeSince(w as SiegeWindow)}`;

/** Кость фазы `k`: 1..14 из сида осады и номера фазы. FNV-1a и шаг mulberry32 — тот же вход, тот же бросок везде. */
export function dieOf(seed: string, k: number): number {
  let h = 0x811c9dc5;
  const s = `${seed}#${k}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return 1 + Math.floor(r * SIEGE_DIE);
}

let dieOverride: ((seed: string, k: number) => number) | null = null;

/**
 * Подмена кости фаз — только для тестов, как `sim/random.setRandom`: правило голода, участи и прохода проверяется без
 * сдачи и пролома, которые иначе выпадали бы на своих фазах. `null` — кость своя.
 */
export function setPhaseDie(fn: ((seed: string, k: number) => number) | null): void {
  dieOverride = fn;
}

/**
 * Доля лагеря, уходящая за фазу (раздел 3): `a × (1 + дни пути от дома / D)`, мор — ещё одна такая доля, пустой амбар
 * дома — вдвое. Не больше единицы.
 */
export function wasteOf(out: PhaseOut, homeDays: number | undefined, hungry = false): number {
  const base = CAMP_WASTE * (1 + Math.max(0, homeDays ?? 0) / CAMP_WASTE_DAYS) * (hungry ? CAMP_WASTE_HUNGRY : 1);
  return Math.min(1, base * (out === 'plague' ? 2 : 1));
}

/**
 * Бросок фазы `k` по окну — строка журнала. `homeDays` и `hungry` — для истощения: путь лагеря от дома и пуст ли амбар
 * дома (только у лагеря игрока).
 */
export function rollPhase(w: RollWindow & Pick<SiegeWindow, 'homeDays'>, k: number, hungry = false): PhaseRow {
  const prior = rowsOf(w).slice(0, k - 1);
  const mods = modsOf(w, k, prior);
  const die = (dieOverride ?? dieOf)(rollSeed(w), k);
  const out = outOf(die + modsSum(mods), prior, legacyBreaches(w));
  return { at: phaseAt(siegeSince(w as SiegeWindow), k), die, mods, out, waste: wasteOf(out, w.homeDays, hungry) };
}

/**
 * Будущие фазы окна до минуты `until`, если ничего больше не сделано: без залпов, наказов и пересчётов. Кончаются на
 * сдаче. Так черновик вести знает минуту пролома и сдачи заранее (`world/notice`): у бота-осаждающего дел нет, и
 * прогноз здесь — то, что случится, пока никто не вмешался; вмешательство — разрыв.
 */
export function projectPhases(w: RollWindow & Pick<SiegeWindow, 'homeDays'>, until: number): PhaseRow[] {
  const out: PhaseRow[] = [];
  const end = Math.min(until, starvesAt(w as SiegeWindow));
  let win: RollWindow & Pick<SiegeWindow, 'homeDays'> = { ...w, phases: [...rowsOf(w)] };
  for (let k = rowsOf(w).length + 1; phaseAt(siegeSince(w as SiegeWindow), k) < end; k++) {
    const row = rollPhase(win, k);
    out.push(row);
    if (row.out === 'gates') break;
    win = { ...win, phases: [...rowsOf(win), row] };
  }
  return out;
}

/**
 * Участь при сдаче — на ступень мягче объявленной (ответ владельца 5): сжечь → увести, увести → ограбить; «ограбить» —
 * самая мягкая ступень, мягче некуда. Гарнизон при сдаче уходит живым — это решает мир.
 */
export const softerFate = (fate: Fate): Fate => (fate === 'burn' ? 'captives' : 'plunder');

/** Минута, когда город сдаётся по брошенным строкам; нет сдачи — null. */
export const gatesAt = (rows: readonly PhaseRow[]): number | null => rows.find((r) => r.out === 'gates')?.at ?? null;

/** Залп в этой фазе уже дан — отказ строкой; null — можно (один залп на фазу, 2.5). */
export function volleyBlock(w: RollWindow, now: number): string | null {
  return volleyIn(w, phaseOf(siegeSince(w as SiegeWindow), now)) ? 'Залп этой фазы уже дан. Следующий — в новой фазе.' : null;
}

/**
 * На какую долю пути до дна залпы продвинули износ гарнизона (2.5, 2.6): первый — на пятую часть, каждый следующий —
 * на половину предыдущего.
 */
export function shakeShare(n: number): number {
  let share = 0;
  let step = VOLLEY_SHAKE_FIRST;
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    share += step;
    step *= VOLLEY_SHAKE_DECAY;
  }
  return share;
}

/** Залп по наказу: наказ стоит и энергии хватит на залп, а после него — на штурм (8.3). */
export const orderVolleys = (orders: SiegeOrders | undefined, energy: number, volleyPrice: number, stormPrice: number): boolean =>
  Boolean(orders?.volley) && energy + 1e-9 >= volleyPrice + stormPrice;

/** Штурм по наказу: наказ стоит и проломов не меньше названного. Энергию проверяет дверь энергии. */
export const orderStorms = (orders: SiegeOrders | undefined, breaches: number): boolean =>
  orders?.storm !== undefined && orders.storm > 0 && breaches >= orders.storm;

/** Наказы, приведённые к правилу: штурм — 1..3 пролома, пустые — без поля. */
export function cleanOrders(o: SiegeOrders | undefined): SiegeOrders | undefined {
  if (!o) return undefined;
  const storm = Number.isFinite(o.storm) ? Math.min(BREACH_MAX, Math.max(0, Math.floor(o.storm as number))) : 0;
  const out: SiegeOrders = { ...(o.volley ? { volley: true } : {}), ...(storm > 0 ? { storm } : {}) };
  return out.volley || out.storm ? out : undefined;
}

// ------------------------------------------------ слова (правило 18: числа — этими же функциями) ---

const MOD_NAMES: Record<ModId, string> = {
  breach: 'пролом',
  volley: 'залп',
  hunger: 'голод',
  progress: 'ход осады',
  wall: 'стена',
};

export const OUT_NAMES: Record<PhaseOut, string> = {
  plague: 'мор в лагере',
  calm: 'без перемен',
  short: 'нехватка в городе',
  breach: 'пролом',
  gates: 'ворота открыли',
};

const ORDER_NAMES: Record<OrderId, string> = { volley: 'залп по наказу', storm: 'штурм по наказу' };

/** Поправки словами, как у EU4: «+1 пролом, +2 залп, −2 стена». Нет поправок — «без поправок». */
export function modsText(mods: PhaseMods): string {
  const parts = MOD_IDS.filter((id) => mods[id]).map((id) => {
    const v = mods[id] as number;
    return `${v > 0 ? '+' : '−'}${Math.abs(v)} ${MOD_NAMES[id]}`;
  });
  return parts.length ? parts.join(', ') : 'без поправок';
}

/** Строка журнала: «Ф3 · кость 9 +1 пролом +2 залп −2 стена = 10 · нехватка в городе · ушло 4 %». */
export function phaseText(row: PhaseRow, k: number): string {
  const sum = row.die + modsSum(row.mods);
  const mods = MOD_IDS.filter((id) => row.mods[id])
    .map((id) => {
      const v = row.mods[id] as number;
      return ` ${v > 0 ? '+' : '−'} ${Math.abs(v)} ${MOD_NAMES[id]}`;
    })
    .join('');
  const lost = Math.round(row.waste * 100);
  const orders = row.orders?.length ? ` · ${row.orders.map((o) => ORDER_NAMES[o]).join(', ')}` : '';
  return `Ф${k} · кость ${row.die}${mods} = ${sum} · ${OUT_NAMES[row.out]}${lost > 0 ? ` · из лагеря ушло ${lost} %` : ''}${orders}`;
}

/** Журнал словами, новые сверху. */
export const journalOf = (w: Pick<RollWindow, 'phases'>): string[] =>
  rowsOf(w)
    .map((r, i) => phaseText(r, i + 1))
    .reverse();

/** Поправки следующей фазы словами (ответ владельца 2: описание состояния, процента исхода нет). */
export function nextModsText(w: RollWindow, now: number): string {
  const k = Math.max(rowsOf(w).length + 1, phaseOf(siegeSince(w as SiegeWindow), now));
  return modsText(modsOf(w, k, rowsOf(w)));
}
