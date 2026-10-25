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
import { foodLeft, siegeSince, starvesAt } from './siege';
import { machineFaces, phaseShots, shotsText, type Aim, type GunAim } from './shelling';
import { blockadeAt, type BlockadeBreak } from './blockade';
import { MOD_BLOCKADE } from './data/blockade';
import type { ArtilleryId, MachineId } from './data/machines';
import {
  BREACH_MAX,
  CAMP_WASTE,
  CAMP_WASTE_DAYS,
  CAMP_WASTE_HUNGRY,
  LEGACY_VOLLEY_WALL,
  MOD_BREACH,
  MOD_GENERAL,
  MOD_HUNGER,
  MOD_PROGRESS,
  MOD_VOLLEY,
  OUT_BREACH_MAX,
  OUT_CALM_MAX,
  OUT_PLAGUE_MAX,
  OUT_SHORT_MAX,
  SIEGE_DIE,
  SIEGE_PHASE,
  SIEGE_PIPS_MAX,
  VOLLEY_SHAKE_DECAY,
  VOLLEY_SHAKE_FIRST,
  WALL_FACES_MAX,
  WALL_LEVELS_PER_FACE,
} from './data/siegeroll';

/** Исход фазы (docs/siege_v2.md, 2.4): мор в лагере, без перемен, нехватка в городе, пролом, ворота открыли. */
export type PhaseOut = 'plague' | 'calm' | 'short' | 'breach' | 'gates';

/** Поправка к кости фазы. Порядок — порядок строки журнала. */
export type ModId = 'breach' | 'volley' | 'machine' | 'general' | 'hunger' | 'blockade' | 'progress' | 'wall';
export const MOD_IDS: readonly ModId[] = ['breach', 'volley', 'machine', 'general', 'hunger', 'blockade', 'progress', 'wall'];
export type PhaseMods = Partial<Record<ModId, number>>;

/**
 * Наказ на отлучку, сработавший в минуту фазы (docs/siege_v2.md, 8.3): у осаждающего — залп и штурм, у осаждённого —
 * починка пролома и урезанный паёк (этап 2г).
 */
export type OrderId = 'volley' | 'storm' | 'repair' | 'ration';

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
  /** Выстрелы артиллерии лагеря по городу или машинам на стене (Р-5, `world/shelling`). Нет поля — не стреляли. */
  shots?: Shot[];
  /** Выстрелы требушета на стене по лагерю или его машинам (Р-5). Нет поля — не стрелял. */
  gun?: Shot[];
}

/**
 * Выстрел фазы (Р-5, `world/shelling`): чья машина била, попала ли и во что — в постройку (`building`; `lost` — это второе
 * попадание в неё за осаду, −1 уровень), в требушет на стене (`gun`), в лагерь (`camp`, ещё доля истощения) или в машину
 * лагеря (`machine`, разбита).
 */
export interface Shot {
  by: ArtilleryId | 'gun';
  hit: boolean;
  building?: string;
  lost?: true;
  gun?: true;
  camp?: true;
  machine?: MachineId;
}

/** Дело с минутой в журнале окна: входы фазы должны быть известны задним числом (docs/siege_v2.md, 2.1). */
export interface SiegeDeed {
  at: number;
  /**
   * Залп осаждающего (`volley`, 2.5) или починка пролома осаждённым (`repair`, раздел 5): заделанный пролом закрыт к концу
   * фазы, в которой начали чинить, — к минуте её броска (`repairDoneAt`). С Р-5 (docs/siege_v2.md, 21.1): цель артиллерии
   * лагеря (`aim`), цель требушета на стене (`gunAim`), кольцо блокады (`blockade`: `on`, чем разомкнуто — `why`).
   */
  act: 'volley' | 'repair' | 'aim' | 'gunAim' | 'blockade';
  /** Цель: у `aim` — стены, город, машины; у `gunAim` — лагерь, машины. */
  aim?: Aim | GunAim;
  /** Кольцо блокады: замкнуто или разомкнуто. */
  on?: boolean;
  why?: BlockadeBreak;
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
  /** Принять дань не меньше справедливой (8.3; этап 2е, `world/parley`). Нет поля — отвечает сам. */
  tribute?: boolean;
}

/**
 * Наказы осаждённого (docs/siege_v2.md, 8.3; этап 2г) — те же дела той же дверью, что кнопки окна осады, в минуту фазы:
 * чинить пролом, пока хватает дерева и камня; урезать паёк, когда хлеба меньше половины. Состав вылазки наказ не выбирает
 * («наказ — не автопилот боя»), поэтому вылазки на машину в наказах нет.
 */
export interface DefendOrders {
  repair?: boolean;
  ration?: boolean;
  /** Принять сдачу на условиях не хуже этой участи (8.3; этап 2е, `world/parley`). Нет поля — отвечает сам. */
  terms?: Fate;
}

/** Окно глазами двери фаз: что ей нужно из `SiegeWindow`. Тот же тип у лагеря сервера войны (`contract.WarCamp`). */
export type RollWindow = Pick<
  SiegeWindow,
  | 'campId'
  | 'startedAt'
  | 'sinceAt'
  | 'foodAtStart'
  | 'garrisonAtStart'
  | 'townPerHour'
  | 'perManPerHour'
  | 'craft'
  | 'wall'
  | 'log'
  | 'phases'
  | 'wood'
  | 'machines'
  | 'ration'
  | 'lead'
  | 'offers'
  | 'guns'
  | 'targets'
  | 'yieldPerHour'
  | 'cut'
  | 'breadAtSince'
>;

/** Минута броска фазы `k` (с единицы). */
export const phaseAt = (since: number, k: number): number => since + k * SIEGE_PHASE;

/** Сколько фаз вперёд смотрит прогноз (`projectPhases`): восемь игровых месяцев — дольше осада не стоит ни в одном прогоне. */
export const PROJECT_PHASES = 64;

/**
 * Шаг осады, в котором склад, опустевший в минуту `t`, не оплатит прокорм (ОС-1): первая фаза **после** этой минуты. Склад,
 * опустевший ровно в минуту броска, этот шаг оплатил — ноль не ниже нуля. Бесконечность — бесконечность.
 */
export const hungerStepAt = (since: number, t: number): number =>
  Number.isFinite(t) ? phaseAt(since, Math.floor(Math.max(0, t - since) / SIEGE_PHASE) + 1) : Infinity;

/** Номер фазы, в которой лежит минута `at`: с единицы, фаза `k` — промежуток [t_{k−1}, t_k). */
export const phaseOf = (since: number, at: number): number => Math.floor(Math.max(0, at - since) / SIEGE_PHASE) + 1;

/** Брошенные фазы окна. */
export const rowsOf = (w: Pick<RollWindow, 'phases'>): readonly PhaseRow[] => w.phases ?? [];

/** Минута следующего броска. */
export const nextRollAt = (w: RollWindow): number => phaseAt(siegeSince(w as SiegeWindow), rowsOf(w).length + 1);

/**
 * Залпы окна из сохранения до фаз: счётчик залпов за осаду (`Craft.shots`) без залпов журнала. Залп фаз кладёт и счётчик, и
 * строку журнала (`siegecraft.craftAfter`), а прежний — только счётчик, без минуты. Прежде прежние залпы читались, только
 * пока журнала нет вовсе, и первое дело с журналом (цель артиллерии, кольцо, починка, новый залп) стирало их проломы (MAP-7).
 */
export const legacyShots = (w: Pick<RollWindow, 'craft' | 'log'>): number =>
  Math.max(0, Math.floor(w.craft?.shots ?? 0) - volleysOf(w).length);

/** Сколько проломов у окна из сохранения до фаз: прежние залпы, доля стены × 3, вниз до целого. */
function legacyBreaches(w: Pick<RollWindow, 'craft' | 'log'>): number {
  const shots = legacyShots(w);
  const share = LEGACY_VOLLEY_WALL.slice(0, shots).reduce((n, v) => n + v, 0);
  return Math.floor(share * BREACH_MAX + 1e-9);
}

/** Проломов среди строк, без потолка и без прежних залпов. */
const breachRows = (rows: readonly PhaseRow[]): number => rows.filter((r) => r.out === 'breach').length;

/** Окно глазами счёта проломов: прежние залпы, журнал дел с починками, начало осады. */
type BreachWindow = Pick<RollWindow, 'craft' | 'log' | 'phases' | 'startedAt' | 'sinceAt'>;

/** Починки в журнале окна. */
export const repairsOf = (w: Pick<RollWindow, 'log'>): readonly SiegeDeed[] => (w.log ?? []).filter((d) => d.act === 'repair');

/**
 * Минута, когда починка закрыла пролом: конец фазы, в которой начали чинить (docs/siege_v2.md, раздел 5: «−1 пролом в конце
 * фазы»), — минута её броска. Бросок этой фазы видит стену уже заделанной.
 */
export const repairDoneAt = (since: number, deedAt: number): number => phaseAt(since, phaseOf(since, deedAt));

/** Минута, после которой считать: последняя брошенная фаза, а до неё — начало осады. */
const lastRollAt = (w: BreachWindow, rows: readonly PhaseRow[]): number =>
  rows.length ? rows[rows.length - 1].at : siegeSince(w as SiegeWindow);

/**
 * Проломы и ход осады по порядку времени: строки фаз и починки, закрывшие пролом к минуте `until`. Починка, закрытая в
 * минуту броска, ложится раньше броска — бросок видит стену заделанной. Пролом сверх трёх — ход +1 вместо пролома (2.4).
 */
function breachWalk(w: BreachWindow, rows: readonly PhaseRow[], until: number): { breaches: number; steps: number } {
  const since = siegeSince(w as SiegeWindow);
  const fixes = repairsOf(w)
    .map((d) => repairDoneAt(since, d.at))
    .sort((a, b) => a - b);
  let breaches = legacyBreaches(w);
  let steps = 0;
  let i = 0;
  const close = (t: number): void => {
    for (; i < fixes.length && fixes[i] <= t; i++) if (breaches > 0) breaches -= 1;
  };
  for (const r of rows) {
    close(r.at);
    if (r.out === 'short') steps += 1;
    if (r.out === 'breach') {
      steps += breaches >= BREACH_MAX ? 2 : 1;
      breaches = Math.min(BREACH_MAX, breaches + 1);
    }
  }
  close(until);
  return { breaches, steps };
}

/**
 * Сколько проломов в стене после брошенных фаз: 0..3 (`BREACH_MAX`), за вычетом починок, закрытых к минуте `until` — по
 * умолчанию к последнему брошенному броску: починка, начатая в этой фазе, закроет пролом только к её концу.
 */
export function breachesOf(w: BreachWindow, rows: readonly PhaseRow[] = rowsOf(w), until = lastRollAt(w, rows)): number {
  return breachWalk(w, rows, until).breaches;
}

/**
 * Накопленный ход осады — ступени: нехватка в городе даёт одну, пролом одну, пролом сверх трёх — ещё одну вместо пролома
 * (docs/siege_v2.md, 2.4). Починка хода не отнимает: заделанная стена — не возвращённый хлеб.
 */
export function progressOf(w: BreachWindow, rows: readonly PhaseRow[] = rowsOf(w)): number {
  return breachWalk(w, rows, lastRollAt(w, rows)).steps;
}

/** Починка, начатая и ещё не закрытая к минуте `now`: минута, когда пролом закроется. Нет — null. */
export function repairPending(w: BreachWindow, now: number): number | null {
  const since = siegeSince(w as SiegeWindow);
  const after = lastRollAt(w, rowsOf(w));
  const open = repairsOf(w)
    .map((d) => (d.at <= now ? repairDoneAt(since, d.at) : Infinity))
    .filter((t) => t > after && t < Infinity);
  return open.length ? Math.min(...open) : null;
}

/**
 * Почему пролом не починить в минуту `now` (docs/siege_v2.md, раздел 5); null — можно. Цену и склад спрашивает тот, кто
 * платит: у мира — слепок деревни, у сервера войны — слепок обороны.
 */
export function repairBlock(w: BreachWindow, now: number): string | null {
  if (repairPending(w, now) !== null) return 'Пролом этой фазы уже заделывают. Следующий — в новой фазе.';
  if (breachesOf(w) <= 0) return 'Проломов нет, заделывать нечего.';
  return null;
}

/** Окно после починки, начатой в минуту `at`. */
export const repairAfter = (w: Pick<RollWindow, 'log'>, at: number): { log: SiegeDeed[] } => ({ log: [...(w.log ?? []), { at, act: 'repair' }] });

/**
 * Доля хлеба города в минуту `at`, 0..1 (ОС-1): хлеб окна к хлебу в минуту, когда встал лагерь (`breadAtSince`), — доля
 * **хлеба**, а не времени до прогноза голода: зимнее окно не прибавляет «голода» сытому городу. Окно до ОС-1 (без меры) — по
 * часам голода, как было: единица, когда встал лагерь, ноль в минуту голода.
 */
export function breadLeft(w: RollWindow, at: number): number {
  if (w.breadAtSince !== undefined) return w.breadAtSince > 0 ? Math.min(1, Math.max(0, foodLeft(w as SiegeWindow, at) / w.breadAtSince)) : 0;
  const since = siegeSince(w as SiegeWindow);
  const end = starvesAt(w as SiegeWindow);
  if (!(end > since)) return 0;
  if (!Number.isFinite(end)) return 1;
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
export function modsOf(w: RollWindow, k: number, prior: readonly PhaseRow[] = rowsOf(w).slice(0, k - 1), share?: number): PhaseMods {
  const at = phaseAt(siegeSince(w as SiegeWindow), k);
  // Доля хлеба: у города, чей склад — не окно (наш город под логовом, ОС-1), её приносит мир со склада; иначе — окно.
  const bread = share ?? breadLeft(w, at);
  const hunger = MOD_HUNGER.find((h) => bread < h.below)?.faces ?? 0;
  const mods: PhaseMods = {
    // Проломы к минуте броска: починка, закрытая в эту минуту, уже легла (раздел 5).
    breach: breachesOf(w, prior, at) * MOD_BREACH,
    volley: volleyIn(w, k) ? MOD_VOLLEY : 0,
    // Артиллерия лагеря по стенам к минуте фазы — камнемёт +1, требушет +2 (docs/siege_v2.md, 2.3 и 21.1; `world/shelling`).
    machine: machineFaces(w, at),
    // Отметки полководца «осада», замороженные при постановке лагеря (этап 2е).
    general: leadFaces(w.lead),
    hunger,
    // Кольцо блокады в минуту фазы — город отрезан (Р-5, `world/blockade`).
    blockade: blockadeAt(w, at) ? MOD_BLOCKADE : 0,
    progress: progressOf(w, prior) * MOD_PROGRESS,
    wall: wallFaces(w.wall),
  };
  for (const id of MOD_IDS) if (!mods[id]) delete mods[id];
  return mods;
}

/** Отметки полководца «осада» в гранях: +1 за каждую, до трёх (2.3). Нет полководца или отметок — ноль. */
export const leadFaces = (lead: number | undefined): number =>
  MOD_GENERAL * Math.min(SIEGE_PIPS_MAX, Math.max(0, Math.floor(Number.isFinite(lead) ? (lead as number) : 0)));

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

/** Доля [0, 1) из сида осады, номера фазы и метки — тот же хеш, что у кости фазы. */
function unitOf(seed: string, k: number, tag: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}#${k}#${tag}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Кто уходит с лагеря за фазу (раздел 3; АУ-8, п. 3, OWNER-DECISIONS п. 15 — решение владельца 26.10.2026): доля `share`
 * каждого вида, целая часть — всегда, дробь — бойцом с вероятностью, равной дроби, по кости от сида осады, номера фазы и
 * вида. Так в среднем лагерь теряет ровно свою долю (прогноз окна лагеря, `siegefood.phasesToEven`, тот же), а малый род и
 * войско, раздробленное на мелкие роды, тают так же, как большое: прежде дробь рода шла к ближнему (`price.shareLosses`), и
 * 20 латных всадников при 2,1 % не теряли никого. Одна дверь у мира (`LocalWorld.wearCamp`) и сервера войны (`phaseStep`):
 * тот же сид — тот же уход. Подмена кости фаз (`setPhaseDie`) эту кость не трогает.
 */
export function wasteLosses<T extends Partial<Record<string, number>>>(troops: T, share: number, seed: string, k: number): T {
  const out: Partial<Record<string, number>> = {};
  const p = Math.min(1, Math.max(0, share));
  if (p <= 0) return out as T;
  for (const id of Object.keys(troops).sort()) {
    const n = Math.max(0, Math.floor(troops[id] ?? 0));
    if (n <= 0) continue;
    const x = n * p;
    const whole = Math.floor(x + 1e-9);
    const frac = x - whole;
    const lost = Math.min(n, whole + (frac > 1e-9 && unitOf(seed, k, `waste:${id}`) < frac ? 1 : 0));
    if (lost > 0) out[id] = lost;
  }
  return out as T;
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
export function rollPhase(w: RollWindow & Pick<SiegeWindow, 'homeDays'>, k: number, hungry = false, share?: number): PhaseRow {
  const prior = rowsOf(w).slice(0, k - 1);
  const mods = modsOf(w, k, prior, share);
  const seed = rollSeed(w);
  const die = (dieOverride ?? dieOf)(seed, k);
  const out = outOf(die + modsSum(mods), prior, legacyBreaches(w));
  const at = phaseAt(siegeSince(w as SiegeWindow), k);
  // Выстрелы фазы (Р-5, `world/shelling`) — кость той же осады и фазы по метке выстрела; подмена кости фаз их не трогает.
  const { shots, gun } = phaseShots(w as SiegeWindow, at, (tag) => dieOf(`${seed}#${tag}`, k), prior);
  // Попадание требушета на стене по лагерю — ещё одна доля истощения фазы (как мор).
  const hits = gun.filter((s) => s.hit && s.camp).length;
  const waste = Math.min(1, wasteOf(out, w.homeDays, hungry) + hits * wasteOf('calm', w.homeDays, hungry));
  return { at, die, mods, out, waste, ...(shots.length ? { shots } : {}), ...(gun.length ? { gun } : {}) };
}

/**
 * Будущие фазы окна до минуты `until`, если ничего больше не сделано: без залпов, наказов и пересчётов. Кончаются на
 * сдаче. Так черновик вести знает минуту пролома и сдачи заранее (`world/notice`): у бота-осаждающего дел нет, и
 * прогноз здесь — то, что случится, пока никто не вмешался; вмешательство — разрыв.
 */
export function projectPhases(w: RollWindow & Pick<SiegeWindow, 'homeDays'>, until: number): PhaseRow[] {
  const out: PhaseRow[] = [];
  // Конец осады называет тот, кто зовёт: у города, чей склад — окно, это час голода окна; у нашего (ОС-1) — шаг голода склада.
  const end = until;
  let win: RollWindow & Pick<SiegeWindow, 'homeDays'> = { ...w, phases: [...rowsOf(w)] };
  // Город, который кормится сам (ОС-1), голода не ждёт вовсе: прогноз смотрит не дальше `PROJECT_PHASES` фаз.
  const last = rowsOf(w).length + PROJECT_PHASES;
  for (let k = rowsOf(w).length + 1; k <= last && phaseAt(siegeSince(w as SiegeWindow), k) < end; k++) {
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

/** Хлеба меньше этой доли — наказ урезает паёк: «когда еды меньше половины» (8.3) — тот же порог, что у поправки голода. */
export const RATION_ORDER_BELOW = 0.5;

/** Починка по наказу в минуту фазы: наказ стоит, пролом есть и не заделывается, на починку хватает (`afford`). */
export const orderRepairs = (d: DefendOrders | undefined, w: BreachWindow, at: number, afford: boolean): boolean =>
  Boolean(d?.repair) && afford && repairBlock(w, at) === null;

/** Паёк по наказу: наказ стоит, паёк ещё обычный, хлеба меньше половины (`breadLeft`). */
export const orderRations = (d: DefendOrders | undefined, on: boolean, bread: number): boolean =>
  Boolean(d?.ration) && !on && bread < RATION_ORDER_BELOW;

/** Наказы осаждённого, приведённые к правилу: пустые — без поля. */
export function cleanDefend(d: DefendOrders | undefined): DefendOrders | undefined {
  if (!d) return undefined;
  const out: DefendOrders = {
    ...(d.repair ? { repair: true } : {}),
    ...(d.ration ? { ration: true } : {}),
    ...(d.terms === 'plunder' || d.terms === 'captives' || d.terms === 'burn' ? { terms: d.terms } : {}),
  };
  return out.repair || out.ration || out.terms ? out : undefined;
}

/** Наказы, приведённые к правилу: штурм — 1..3 пролома, пустые — без поля. */
export function cleanOrders(o: SiegeOrders | undefined): SiegeOrders | undefined {
  if (!o) return undefined;
  const storm = Number.isFinite(o.storm) ? Math.min(BREACH_MAX, Math.max(0, Math.floor(o.storm as number))) : 0;
  const out: SiegeOrders = { ...(o.volley ? { volley: true } : {}), ...(storm > 0 ? { storm } : {}), ...(o.tribute ? { tribute: true } : {}) };
  return out.volley || out.storm || out.tribute ? out : undefined;
}

// ------------------------------------------------ слова (правило 18: числа — этими же функциями) ---

const MOD_NAMES: Record<ModId, string> = {
  breach: 'пролом',
  volley: 'залп',
  machine: 'камнемёт',
  general: 'полководец',
  hunger: 'голод',
  blockade: 'блокада',
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

const ORDER_NAMES: Record<OrderId, string> = {
  volley: 'залп по наказу',
  storm: 'штурм по наказу',
  repair: 'починка по наказу',
  ration: 'паёк по наказу',
};

/** Поправки словами, как у EU4: «+1 пролом, +2 залп, −2 стена». Нет поправок — «без поправок». */
export function modsText(mods: PhaseMods): string {
  const parts = MOD_IDS.filter((id) => mods[id]).map((id) => {
    const v = mods[id] as number;
    return `${v > 0 ? '+' : '−'}${Math.abs(v)} ${MOD_NAMES[id]}`;
  });
  return parts.length ? parts.join(', ') : 'без поправок';
}

/**
 * Строка журнала: «Ф3 · кость 9 +1 пролом +2 залп −2 стена = 10 · нехватка в городе · ушло 4 %». С Р-5 — и выстрелы фазы
 * (`shelling.shotsText`); `name` — имя постройки по её ключу (мир знает имена, сервер — нет).
 */
export function phaseText(row: PhaseRow, k: number, name?: (building: string) => string, machine?: (id: MachineId) => string): string {
  const sum = row.die + modsSum(row.mods);
  const mods = MOD_IDS.filter((id) => row.mods[id])
    .map((id) => {
      const v = row.mods[id] as number;
      return ` ${v > 0 ? '+' : '−'} ${Math.abs(v)} ${MOD_NAMES[id]}`;
    })
    .join('');
  const lost = Math.round(row.waste * 100);
  const orders = row.orders?.length ? ` · ${row.orders.map((o) => ORDER_NAMES[o]).join(', ')}` : '';
  const shots = row.shots?.length || row.gun?.length ? shotsText(row.shots ?? [], row.gun ?? [], name, machine) : '';
  return `Ф${k} · кость ${row.die}${mods} = ${sum} · ${OUT_NAMES[row.out]}${lost > 0 ? ` · из лагеря ушло ${lost} %` : ''}${shots ? ` · ${shots}` : ''}${orders}`;
}

/** Журнал словами, новые сверху. */
export const journalOf = (w: Pick<RollWindow, 'phases'>, name?: (building: string) => string, machine?: (id: MachineId) => string): string[] =>
  rowsOf(w)
    .map((r, i) => phaseText(r, i + 1, name, machine))
    .reverse();

/** Поправки следующей фазы словами (ответ владельца 2: описание состояния, процента исхода нет). */
export function nextModsText(w: RollWindow, now: number): string {
  const k = Math.max(rowsOf(w).length + 1, phaseOf(siegeSince(w as SiegeWindow), now));
  return modsText(modsOf(w, k, rowsOf(w)));
}
