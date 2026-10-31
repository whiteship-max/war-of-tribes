// Окно «Что нужно, чтобы взять» вольный замок (ПН-Э2б, docs/gdd/path_of_sword.md, 3.11.2, 5.4, 23.9 и 23.11) — одна дверь на окно
// замка (сервер — `/api/odds`, ПН-Э2г) и на автопилот прибора (`roam:report`, стиль «к замку»). Окно показывает **настоящий шанс**, а не равенство
// мощи: каждая строка силы — репетиция дела **сервером войны в памяти** (`netlify/lib/war.ts`: поход отряда `marchFree`, НПС-слепок,
// стена, фазы, голод → последняя вылазка) — тем же кодом, которым сервер посчитает настоящее дело. Своей арифметики боя здесь нет.
//
// Что здесь:
//   — **репетиция** (`rehearse`): одно дело у стен вольного замка — штурм с ходу или осада, минута приказа и кость фаз — от сида;
//   — **что видит отряд** (`freeLook`): гарнизон ступени — правило, видное всем (3.11.1), выше него гарнизона не бывает; ниже — бывает,
//     если замок потрепали чужие осады (`war.npcSheet` вычитает их потери). Стоящий отряд, в чьём круге обзора замок (`world/sight`,
//     наблюдатель «отряд»), видит стены и людей на них — гарнизон точкой; иначе — вилкой вниз на долю `INTEL_ROUGH_SPREAD` (ступень
//     «примерно» разведданных, `world/intel`);
//   — **шанс** (`freeChance`): доля взятий на сидах `1…FREE_ODDS_SEEDS` при составе отряда как есть; при вилке гарнизона — по обоим
//     краям вилки;
//   — **сколько нужно** (`freeNeedMen`): наименьшее число людей того же состава, при котором шанс не ниже порога (`freeOdds`) и
//     держится на всех проверенных больших; точка, где больший отряд того же состава ниже порога, — «падение»: окно говорит вилку и
//     пометку;
//   — **строки окна** (`freeNeeds`): престиж, у стен, штурм, измор (голод в осаде и цена содержания), связь.
// Исход считает только сервер: окно — предсказание тем же кодом, приказ уходит на сервер войны (`RoamWorld.roamSiege`), и ни одна строка
// отсюда в партию не пишет. В браузер модуль не едет вовсе (ПН-Э2г): окно игрока считает сервер (`netlify/lib/oddsdesk`, адрес
// `/api/odds`) — строки пути `freePathsSteps` своим потоком и кэшем, голову и хвост `freeRowsOf`; сборка клиента его не пускает
// (`vite.config`, `noWarServerPlugin`).
//
// Порог шанса — заглушка игры `freeOdds` за выключателем пути (`roamStub`); вывод — `roam:report`, раздел «Окно замка: порог шанса»
// (40 сидов полного прогона). Модуль не в `freecastle`: его читает сервер войны при загрузке (`FATES.occupy`), а этот модуль читает
// сервер войны — кольцо импортов уронило бы загрузку.
import { advance, applyOrder, emptyWars, type WarRow } from '../../netlify/lib/war';
import { unsealed } from '../../netlify/lib/warseal';
import { emptyRoster } from '../../netlify/lib/roster';
import type { RosterFile, WarBattle } from '../../netlify/lib/contract';
import { freePrestige, freeTroopPower, freeTroops } from './freecastle';
import { freeHeadRows, freeOnlineRow, type FreeAt, type FreeLook, type FreeNeedId } from './freelook';
import { roamSeat } from './roam';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { troopPower } from '@/game/battle/price';
import { bandRationPerDay, bandWagesPerDay } from '@/game/roamrules';
import { gameDaysOfMs } from '@/game/pace';
import { roamStub } from '@/game/roamstubs';
import type { TroopId } from '@/game/types';

const HOUR = 3_600_000;
/** Дольше осада репетиции не стоит: замок без хлеба выходит раньше. */
const SIEGE_MAX_H = 24 * 14;
const KEY = 'tg-odds';
const PRIOR = 'tg-prior';

/** Сидов репетиции у окна [код]: шанс — доля взятий на сидах `1…N`. Порог к ним выводит прибор на 40 сидах (`freeOdds`). */
export const FREE_ODDS_SEEDS = 10;
/** Предел поиска «сколько нужно» [код]: не больше стольких мощей гарнизона — дальше окно говорит «этим составом не взять». */
export const FREE_NEED_CAP = 8;
/** Точек проверки «держится при больших» над найденным числом [код] и шаг между ними — доля числа. */
export const FREE_NEED_TAIL = 3;
export const FREE_NEED_STEP = 0.05;
/** Точность поиска [код]: число людей — до доли (и не мельче человека). */
export const FREE_NEED_RES = 0.01;

export { freeAt, freeLook, freeSeen, type FreeAt, type FreeLook, type FreeNeedId } from './freelook';

export type FreeMode = 'storm' | 'siege';
export const FREE_MODES: readonly FreeMode[] = ['storm', 'siege'];

export interface Rehearsal {
  won: boolean;
  /** Сколько отряд потерял за дело: павшие, истощение лагеря, выбитые башней. */
  lost: TroopStack;
  /** Часов от приказа до конца дела. */
  hours: number;
  /** Часов от прихода к стенам до конца хлеба замка (осада); `null` — лагеря не было или хлеб не кончился. */
  starveH: number | null;
}

type OrderCtx = Parameters<typeof applyOrder>[4];

/** Война у стен вольного замка целиком — запись сервера войны в памяти (одна дверь у репетиции и разбора карты прибора). */
export function rehearseWar(band: TroopStack, at: FreeAt, mode: FreeMode, seed: number, share = 1): { w: WarRow; troops: Record<string, number>; t0: number; starveAt: number | null } {
  // Репетиция — не живая война: сиды окна без секрета сервера (БЕЗ-1, `warseal.unsealed`), те же у сервера и у прибора.
  return unsealed(() => rehearseBare(band, at, mode, seed, share));
}

function rehearseBare(band: TroopStack, at: FreeAt, mode: FreeMode, seed: number, share: number): { w: WarRow; troops: Record<string, number>; t0: number; starveAt: number | null } {
  const t0 = Date.UTC(2026, 9, 30) + (Math.abs(seed) % 46_656) * 60_000;
  const troops = Object.fromEntries(Object.entries(band).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>;
  const row = (born: number, men: Record<string, number>) => ({
    way: roamSeat({ x: at.x + 1, y: at.y }, born).way,
    born,
    name: 'Окно замка',
    prestige: freePrestige(at.tier),
    men: troopTotal(men as TroopStack),
    seenAt: born,
    book: { troops: men, join: -1, drill: 0, fights: 0, grant: 0, keys: [] },
  });
  const roster: RosterFile = {
    ...emptyRoster(),
    bands: { [KEY]: row(t0, troops), ...(share < 1 ? { [PRIOR]: row(t0 - 2 * HOUR, { clubman: 1 }) } : {}) },
    free: { [at.id]: { x: at.x, y: at.y, tier: at.tier, born: t0 - 4 * HOUR } },
  };
  const ctx: OrderCtx = { roster, sheet: () => null, roamOpen: true };
  const file = emptyWars();
  if (share < 1) bleed(file, at, share, t0, ctx);
  const no = applyOrder(file, KEY, { op: 'march', target: at.id, mode, fate: 'occupy', army: { troops, resolve: 0, pips: {} } }, t0, ctx);
  if (no) throw new Error(`окно замка: приказ репетиции не принят — ${no}`);
  const w = file.wars[file.wars.length - 1];
  let starveAt: number | null = null;
  for (let t = w.arriveAt + 1; w.phase !== 'done' && t <= t0 + SIEGE_MAX_H * HOUR; t += HOUR) {
    advance(file, t, new Map());
    if (starveAt === null && w.starvesAt !== undefined) starveAt = w.starvesAt;
  }
  if (w.phase === 'march' || w.phase === 'camp') applyOrder(file, KEY, { op: 'retreat', id: w.id }, t0 + SIEGE_MAX_H * HOUR, ctx);
  return { w, troops, t0, starveAt };
}

/**
 * Гарнизон ниже правила ступени — так, как его видит сервер войны: прежняя война другого отряда, кончившаяся минутой раньше, унесла
 * долю `1 − share` каждого вида (`war.npcSheet` вычитает потери войн замка, кончившихся меньше `BURN_IMMUNE` назад). Строку войны
 * кладёт сам сервер приказом похода; здесь у неё только конец и одна убыль.
 */
function bleed(file: ReturnType<typeof emptyWars>, at: FreeAt, share: number, t0: number, ctx: OrderCtx): void {
  const no = applyOrder(file, PRIOR, { op: 'march', target: at.id, mode: 'storm', fate: 'occupy', army: { troops: { clubman: 1 }, resolve: 0, pips: {} } }, t0 - 2 * HOUR, ctx);
  if (no) throw new Error(`окно замка: прежняя война не легла — ${no}`);
  const prior = file.wars[file.wars.length - 1];
  const lost: Record<string, number> = {};
  for (const [id, n] of Object.entries(freeTroops(at.id, at.tier))) {
    const d = (n ?? 0) - Math.round((n ?? 0) * share);
    if (d > 0) lost[id] = d;
  }
  const b = { id: `${prior.id}.0`, at: t0 - 2, site: 'storm', by: 'atk', won: false, atkTroops: {}, atkLost: {}, homeTroops: {}, homeLost: lost } as unknown as WarBattle;
  Object.assign(prior, { phase: 'done', end: 'beaten', endAt: t0 - 1, battles: [b] });
}

/** Одно дело у стен: штурм с ходу или осада. Победа — замок взят (штурмом или отбитой последней вылазкой). */
export function rehearse(band: TroopStack, at: FreeAt, mode: FreeMode, seed: number, share = 1): Rehearsal {
  if (troopTotal(band) <= 0) return { won: false, lost: {}, hours: 0, starveH: null };
  const { w, troops, t0, starveAt } = rehearseWar(band, at, mode, seed, share);
  const lost: TroopStack = {};
  for (const [k, n] of Object.entries(troops)) {
    const d = n - ((w.army.troops as Record<string, number>)[k] ?? 0);
    if (d > 0) lost[k as TroopId] = d;
  }
  return { won: w.end === 'taken', lost, hours: ((w.endAt ?? t0) - t0) / HOUR, starveH: starveAt === null ? null : (starveAt - w.arriveAt) / HOUR };
}

// ---------- память репетиций ----------
//
// Окно открывают снова и снова при том же отряде, автопилот спрашивает о тех же числах: одна и та же репетиция считается один раз.

const MEMO_MAX = 20_000;
const memo = new Map<string, Rehearsal>();
const sig = (band: TroopStack): string =>
  Object.entries(band)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, n]) => `${k}${n}`)
    .join(',');

/** Шаг счёта: одна репетиция. Генератор отдаёт управление после каждой: сервер проверяет между ними срок расчёта (`oddsdesk.countPaths`). */
function* tryOne(band: TroopStack, at: FreeAt, mode: FreeMode, seed: number, share: number): Generator<void, Rehearsal> {
  const key = `${at.id}|${at.tier}|${mode}|${share}|${seed}|${sig(band)}`;
  const had = memo.get(key);
  if (had) return had;
  const r = rehearse(band, at, mode, seed, share);
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, r);
  yield;
  return r;
}

// ---------- что видит отряд — `world/freelook` (лёгкая часть окна: её читает мир бродяги без сервера войны) ----------

/** Доли гарнизона на краях вилки: худший край (правило ступени) первым. */
const sharesOf = (look: FreeLook): number[] => (look.spread > 0 ? [1, 1 - look.spread] : [1]);

// ---------- шанс и «сколько нужно» ----------

/** Шанс дела: доля взятий на сидах `1…FREE_ODDS_SEEDS`, часы дела (медиана) и конец хлеба замка. */
export interface FreeChance {
  wins: number;
  seeds: number;
  chance: number;
  hours: number;
  starveH: number | null;
}

function* chanceG(band: TroopStack, at: FreeAt, mode: FreeMode, share: number): Generator<void, FreeChance> {
  let wins = 0;
  const hours: number[] = [];
  let starveH: number | null = null;
  for (let s = 1; s <= FREE_ODDS_SEEDS; s++) {
    const r = yield* tryOne(band, at, mode, s, share);
    if (r.won) wins++;
    hours.push(r.hours);
    if (starveH === null) starveH = r.starveH;
  }
  hours.sort((a, b) => a - b);
  return { wins, seeds: FREE_ODDS_SEEDS, chance: wins / FREE_ODDS_SEEDS, hours: hours[Math.floor(hours.length / 2)] ?? 0, starveH };
}

/** Не ниже ли порога шанс: досрочно — как только порог взят или уже недостижим (тот же счёт, что `chanceG`). */
function* atLeastG(band: TroopStack, at: FreeAt, mode: FreeMode, share: number, bar: number): Generator<void, boolean> {
  const need = Math.ceil(bar * FREE_ODDS_SEEDS - 1e-9);
  let wins = 0;
  for (let s = 1; s <= FREE_ODDS_SEEDS; s++) {
    if ((yield* tryOne(band, at, mode, s, share)).won) wins++;
    if (wins >= need) return true;
    if (wins + (FREE_ODDS_SEEDS - s) < need) return false;
  }
  return wins >= need;
}

/** Отряд того же состава в `men` человек — доли видов наибольшими остатками, вид по имени при равных; пустой отряд — пустой. */
export function scaleBand(band: TroopStack, men: number): TroopStack {
  const all = troopTotal(band);
  const parts = (Object.entries(band) as [TroopId, number][]).filter(([, n]) => n > 0).map(([id, n]) => ({ id, exact: (n * men) / all }));
  const out: TroopStack = {};
  if (parts.length === 0) return out;
  for (const p of parts) out[p.id] = Math.floor(p.exact);
  const left = men - troopTotal(out);
  parts.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < left; i++) out[parts[i % parts.length].id] = (out[parts[i % parts.length].id] ?? 0) + 1;
  for (const id of Object.keys(out) as TroopId[]) if (!((out[id] ?? 0) > 0)) delete out[id];
  return out;
}

/**
 * «Сколько нужно»: `need` — наименьшее найденное число людей того же состава, с которого шанс не ниже порога на всех проверенных
 * больших (`FREE_NEED_TAIL` точек шагом `FREE_NEED_STEP` над ним и отряд как есть); `first` — первое найденное число с шансом не ниже
 * порога; `drop` — нашлось ли выше `first` падение (больший отряд того же состава ниже порога), тогда `first < need`. `need === null` —
 * этим составом не взять и при `FREE_NEED_CAP` мощях гарнизона.
 */
export interface FreeNeedMen {
  need: number | null;
  first: number | null;
  drop: boolean;
}

function* needG(band: TroopStack, at: FreeAt, mode: FreeMode, share: number, bar: number): Generator<void, FreeNeedMen> {
  const men0 = troopTotal(band);
  const perMan = troopPower(band) / Math.max(1, men0);
  const cap = Math.max(1, Math.ceil((FREE_NEED_CAP * freeTroopPower(at.id, at.tier) * share) / Math.max(1e-9, perMan)));
  const seen = new Map<number, boolean>();
  const yes = function* (m: number): Generator<void, boolean> {
    const had = seen.get(m);
    if (had !== undefined) return had;
    const v = yield* atLeastG(scaleBand(band, m), at, mode, share, bar);
    seen.set(m, v);
    return v;
  };
  /** Пополам между «нет» (`lo`) и «да» (`hi`) — до точности `FREE_NEED_RES`. */
  const halve = function* (lo: number, hi: number): Generator<void, number> {
    while (hi - lo > Math.max(1, Math.ceil(hi * FREE_NEED_RES))) {
      const mid = Math.floor((lo + hi) / 2);
      if (yield* yes(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  /** Первое число «да» выше `lo` (оно — «нет»): галопом вверх до предела, потом пополам. */
  const up = function* (lo: number): Generator<void, number | null> {
    for (let step = Math.max(1, lo); ; step *= 2) {
      const m = Math.min(cap, lo + step);
      if (yield* yes(m)) return yield* halve(lo, m);
      if (m >= cap) return null;
      lo = m;
    }
  };
  let first: number | null;
  if (yield* yes(men0)) {
    // Уже хватает: вниз — галопом до первого «нет», потом пополам.
    let hi = men0;
    let lo = 0;
    for (let m = Math.floor(men0 / 2); m >= 1; m = Math.floor(m / 2)) {
      if (!(yield* yes(m))) {
        lo = m;
        break;
      }
      hi = m;
    }
    first = yield* halve(lo, hi);
  } else first = yield* up(men0);
  if (first === null) return { need: null, first: null, drop: false };
  let need: number | null = first;
  let drop = false;
  // «Держится при всех больших»: точки над найденным числом и отряд как есть; упала — искать снова выше точки падения (до трёх раз).
  for (let round = 0; round < 3 && need !== null; round++) {
    const base: number = need;
    const step = Math.max(1, Math.round(base * FREE_NEED_STEP));
    let fell: number | null = null;
    for (let k = 1; k <= FREE_NEED_TAIL && fell === null; k++) {
      const m = base + k * step;
      if (m > cap) break;
      if (!(yield* yes(m))) fell = m;
    }
    if (fell === null && men0 > base && !(yield* yes(men0))) fell = men0;
    if (fell === null) break;
    drop = true;
    need = yield* up(fell);
  }
  return { need, first, drop };
}

/** Порог шанса, с которого окно говорит «да», — заглушка игры до вывода прибора (раздел «Окно замка: порог шанса»). */
export const freeBar = (): number => roamStub('freeOdds');

/** Прогнать генератор до конца — синхронно. */
export function drive<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** Шанс дела отрядом как есть (синхронно; окно считает генератором `freeNeedsSteps`). */
export const freeChance = (band: TroopStack, at: FreeAt, mode: FreeMode, share = 1): FreeChance => drive(chanceG(band, at, mode, share));

/** «Сколько нужно» тем же составом (синхронно). */
export const freeNeedMen = (band: TroopStack, at: FreeAt, mode: FreeMode, share = 1, bar = freeBar()): FreeNeedMen => drive(needG(band, at, mode, share, bar));

// ---------- строки окна ----------

/** Что окно знает о деле: престиж, замок, у стен ли отряд, что он видит, отряд бойцами, связь. */
export interface FreeNeedIn {
  prestige: number;
  at: FreeAt;
  near: boolean;
  look: FreeLook;
  /** Отряд бойцами (`RoamState.band`) — состав, а не одна мощь. */
  band: TroopStack;
  online: boolean;
  /** Множитель еды сезона (`SEASON_MODIFIERS`) — паёк в цене содержания осады; нет — без поправки. */
  seasonFood?: number;
}

/** Строка окна; у строк пути — числа, которыми она сказана (автопилот и тесты читают их, а не слова). */
export interface FreeNeedRow {
  id: FreeNeedId;
  text: string;
  ok: boolean;
  odds?: FreeOddsRow;
}

/** Путь (штурм или измор): шанс и «сколько нужно» по краям вилки гарнизона (худший — первым), голод и содержание осады. */
export interface FreeOddsRow {
  mode: FreeMode;
  bar: number;
  chance: number[];
  need: FreeNeedMen[];
  /** Часов от прихода к стенам до конца хлеба замка (осада; худший край вилки); `null` — хлеб не кончится за две недели. */
  starveH: number | null;
  /** Часов дела — медиана сидов при худшем крае вилки. */
  hours: number;
  /** Содержание отряда за дело (измор): жалованье и паёк за те же часы. */
  upkeep: { gold: number; food: number } | null;
}

const pct = (x: number): string => `${Math.round(x * 100)} %`;
const span = (xs: readonly number[], f: (x: number) => string): string => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
};

function needWords(ns: readonly FreeNeedMen[]): string {
  const known = ns.filter((n) => n.need !== null).map((n) => n.need as number);
  if (known.length < ns.length) {
    return known.length ? `нужно от ${Math.min(...known)} чел. этим составом, а при гарнизоне по правилу ступени этим составом не взять` : `этим составом не взять и при ${FREE_NEED_CAP}-кратной мощи гарнизона`;
  }
  const drop = ns.find((n) => n.drop);
  const note = drop ? ` (точки падения: берут уже с ${drop.first} чел., а держится с ${drop.need} — между ними больший отряд бывает хуже)` : '';
  return `нужно ${span(known, String)} чел. этим составом${note}`;
}

function* oddsG(i: FreePathIn, mode: FreeMode, bar: number): Generator<void, FreeOddsRow> {
  const chance: number[] = [];
  const need: FreeNeedMen[] = [];
  let hours = 0;
  let starveH: number | null = null;
  for (const share of sharesOf(i.look)) {
    const c = yield* chanceG(i.band, i.at, mode, share);
    chance.push(c.chance);
    if (share === 1) {
      hours = c.hours;
      starveH = c.starveH;
    }
    need.push(yield* needG(i.band, i.at, mode, share, bar));
  }
  const days = gameDaysOfMs(hours * HOUR);
  const upkeep =
    mode === 'siege' ? { gold: Math.round(bandWagesPerDay(i.band) * days), food: Math.round(bandRationPerDay({ band: i.band, wounded: [] }, i.seasonFood ?? 1) * days) } : null;
  return { mode, bar, chance, need, starveH, hours, upkeep };
}

function oddsText(o: FreeOddsRow, men: number): string {
  const odds = `шанс ${span(o.chance, pct)} при ${men} чел. по ${FREE_ODDS_SEEDS} репетициям (порог «да» — ${pct(o.bar)})`;
  const need = needWords(o.need);
  if (o.mode === 'storm') return `Штурм с ходу — стеной и лестницами: ${odds}; ${need}`;
  const starve =
    o.starveH === null ? 'хлеб у замка не кончится за две недели' : `хлеб у замка кончится через ${Math.round(gameDaysOfMs(o.starveH * HOUR))} игр. дн. (${Math.round(o.starveH)} ч)`;
  const keep = o.upkeep ? `; содержание отряда за дело — ${o.upkeep.gold} золота и ${o.upkeep.food} хлеба` : '';
  return `Измор — осада до голода: ${starve}, тогда гарнизон выйдет в последнюю вылазку${keep}; ${odds}; ${need}`;
}

/** Что строки пути знают о деле: замок, что видит отряд, отряд бойцами, множитель еды сезона (ключ кэша сервера — `oddsdesk`). */
export type FreePathIn = Pick<FreeNeedIn, 'at' | 'look' | 'band' | 'seasonFood'>;

/**
 * Строки пути — штурм и измор — шагами генератора: шанс и «сколько нужно» репетициями. Строка выполнена, когда шанс не ниже порога
 * **при любом гарнизоне из вилки** (худший край — правило ступени). Это тяжёлая часть окна: сервер считает её своим потоком и держит в
 * кэше (`netlify/lib/oddsdesk`), голову и хвост кладёт свежими.
 */
export function* freePathsSteps(i: FreePathIn): Generator<void, FreeNeedRow[]> {
  const bar = freeBar();
  const men = troopTotal(i.band);
  const rows: FreeNeedRow[] = [];
  for (const mode of FREE_MODES) {
    if (men <= 0) {
      rows.push({ id: mode, text: mode === 'storm' ? 'Штурм с ходу: в отряде нет бойцов' : 'Измор: в отряде нет бойцов', ok: false });
      continue;
    }
    const odds = yield* oddsG(i, mode, bar);
    rows.push({ id: mode, text: oddsText(odds, men), ok: odds.chance[0] >= bar, odds });
  }
  return rows;
}

/** Строки окна целиком: голова (престиж, у стен), строки пути, связь — порядок окна. */
export const freeRowsOf = (i: Pick<FreeNeedIn, 'prestige' | 'at' | 'near' | 'online'>, paths: readonly FreeNeedRow[]): FreeNeedRow[] => [
  ...freeHeadRows(i.prestige, i.at.tier, i.near),
  ...paths,
  freeOnlineRow(i.online),
];

/**
 * Что нужно, чтобы взять замок (ГДД 3.11.2, 5.4): строки окна и выполнено ли каждое — шагами генератора (окно считает кусками).
 * Строка пути выполнена, когда шанс не ниже порога **при любом гарнизоне из вилки** (худший край — правило ступени).
 */
export function* freeNeedsSteps(i: FreeNeedIn): Generator<void, FreeNeedRow[]> {
  return freeRowsOf(i, yield* freePathsSteps(i));
}

/** Строки окна синхронно — автопилот прибора и тесты. */
export const freeNeeds = (i: FreeNeedIn): FreeNeedRow[] => drive(freeNeedsSteps(i));

/** Окно выполнено: престиж, у стен, связь — и хотя бы один путь (штурм или измор) не ниже порога. Какой — `freeWay`. */
export const freeReady = (rows: readonly FreeNeedRow[]): boolean =>
  rows.every((r) => r.ok || r.id === 'storm' || r.id === 'siege') && rows.some((r) => (r.id === 'storm' || r.id === 'siege') && r.ok);

/** Путь, которым идти: из выполненных — с большим шансом при худшем крае вилки (при равных — измор). */
export function freeWay(rows: readonly FreeNeedRow[]): FreeMode | null {
  const ok = rows.filter((r) => (r.id === 'storm' || r.id === 'siege') && r.ok && r.odds).map((r) => r.odds as FreeOddsRow);
  if (!ok.length) return null;
  ok.sort((a, b) => b.chance[0] - a.chance[0] || (a.mode === 'siege' ? -1 : 1));
  return ok[0].mode;
}
