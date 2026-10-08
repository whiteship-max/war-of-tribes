/**
 * Книга войска (docs/pvp.md, раздел 6): сколько бойцов каждого вида сервер может подтвердить у игрока. В бою между
 * игроками участвует только подтверждённое войско — у нападающего и в слепке обороны защитника (`war.liveSheet`), и
 * приказ сверх него отклоняется с флагом в описи наблюдения.
 *
 * **Что считается.** Тела по видам: бойцы и раненые (`WatchCard.troops` + `hurt`) — раненый встаёт тем же бойцом. Книга
 * растёт только тем, что сервер может объяснить правилами игры за прошедшее **серверное** время:
 *  · обучением — не быстрее, чем выучили бы казармы и конюшня (`train.trainRateAt`) с запасом `BOOK_SLACK`; уровень
 *    здания берётся из описи, но не выше, чем позволяет время на сервере (`LEVEL_STEP_MS` на уровень от первой встречи);
 *    неизрасходованная работа ждёт в копилке, но не больше одной головы самого долгого вида (`ArmyBook.credit`);
 *  · указами админа — их сервер отдаёт сам (`GrantsFile`).
 * Убывает книга всем, что показала опись (потери в походах, уход, голод: подтверждённое — не больше заявленного), и
 * потерями войны, которые посчитал сам сервер, — сама, по номеру боя, даже если клиент их «не принял». Из потерь войны
 * сервер вычитает только тех, кто наверняка погиб: долю `INFIRMARY_HEAL_CAP` он оставляет на раненых, которых честный
 * лазарет поднимет.
 *
 * Пишет книгу одна дверь — запись партии (`routes/save.ts` → `watch.observe`); читает — война (`routes/war.ts`). Лежит в
 * записи наблюдения игрока (`WatchRecord.book`). Чистая: без хранилища и без часов.
 */
import { troopTotal, type TroopStack } from '../../src/game/battle/kinds.js';
import { TROOP_BY_ID } from '../../src/game/data/troops.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { INFIRMARY_HEAL_CAP, MAX_BUILDING_LEVEL } from '../../src/game/constants.js';
import { gameSecondsOfMs } from '../../src/game/pace.js';
import { trainRateAt } from '../../src/game/train.js';
import { FAITHS, OBSERVANCES, tiltAt } from '../../src/game/data/faiths.js';
import { MAX_AGENT_LEVEL } from '../../src/game/data/agents.js';
import { PIP_IDS } from '../../src/battle/index.js';
import { readCounts, warFallId, type AdminGrant, type Counts } from './contract.js';
import type { WarFile } from './war.js';

/**
 * Подтверждённое войско игрока на минуту `at`. `since` — когда сервер впервые встретил игрока: от неё отсчитывается
 * потолок уровня казарм и конюшни.
 */
export interface ArmyBook {
  since: number;
  at: number;
  /** Тела по видам: бойцы и раненые. */
  bodies: Counts;
  /**
   * Работа обучения, которую здание успело сделать, а книга ещё не потратила (`barracks`, `stable`): голова выходит из
   * казарм целиком, когда набрана вся её работа, и записи партии между этим ловят дробь. Не больше одной головы самого
   * долгого вида (`longest`): копить пустое время на подделку нельзя.
   */
  credit: Counts;
  /** Номер последнего указа админа, вошедшего в книгу. */
  grant: number;
  /** Бои и падения войны, чьи потери книга уже вычла (`WarBattle.id`, `<война>.fall`). */
  lost: string[];
}

/**
 * Сколько настоящего времени на сервере стоит уровень казарм или конюшни сверх первого. Моё число: честная стройка
 * уровня идёт десятки минут и часы (труд `upgradeWork` растёт в 1.4 раза за уровень), быстрее — только алмазами; тогда
 * книга отстаёт на минуты, и отставание стоит лишь части запаса обучения за эти минуты — книга догоняет сама.
 */
export const LEVEL_STEP_MS = 10 * 60_000;

/**
 * Во сколько раз подтверждённое обучение может обогнать скорость здания. Тот же довод, что у флага роста войска
 * (`watch.GROWTH_SLACK`): уровень меняется внутри промежутка, а опись видит его только на концах.
 */
export const BOOK_SLACK = 2;

/** Сколько тел сверх подтверждённого — ещё не флаг: дробь работы и раздел запаса по видам. */
export const FORGED_SLACK = 2;

/** Сколько боёв книга помнит вычтенными: не больше, чем лежит у сервера войн на одного игрока. */
export const BOOK_LOST_MAX = 200;

export const seedBook = (at: number): ArmyBook => ({ since: at, at, bodies: {}, credit: {}, grant: 0, lost: [] });

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Копилка работы по зданиям: только казармы и конюшня, не больше головы самого долгого вида. */
function readReal(v: unknown): Counts {
  const out: Counts = {};
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  for (const school of SCHOOLS) {
    const x = Math.min(longest(school), Math.max(0, n0(r[school])));
    if (x > 0) out[school] = x;
  }
  return out;
}

/** Книга из записи наблюдения; нет или испорчена — `null`. */
export function readBook(v: unknown): ArmyBook | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const since = n0(r.since);
  const at = n0(r.at);
  if (since <= 0 || at <= 0) return null;
  return {
    since,
    at,
    bodies: readCounts(r.bodies),
    credit: readReal(r.credit),
    grant: Math.max(0, Math.floor(n0(r.grant))),
    lost: Array.isArray(r.lost) ? r.lost.filter((x): x is string => typeof x === 'string' && x.length <= 48).slice(-BOOK_LOST_MAX) : [],
  };
}

// ------------------------------------------------ счёт по видам ---

function plus(a: Counts, b: Counts): Counts {
  const out: Counts = { ...a };
  for (const [k, v] of Object.entries(b)) if ((v ?? 0) > 0) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out;
}

function minus(a: Counts, b: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(a)) {
    const left = Math.max(0, (v ?? 0) - Math.max(0, b[k] ?? 0));
    if (left > 0) out[k] = left;
  }
  return out;
}

/** По видам — меньшее из двух. */
export function least(a: Counts, b: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(a)) {
    const n = Math.min(Math.max(0, v ?? 0), Math.max(0, b[k] ?? 0));
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Сколько в `a` сверх `b`, всего. */
export const over = (a: Counts, b: Counts): number =>
  Object.entries(a).reduce((t, [k, v]) => t + Math.max(0, (v ?? 0) - Math.max(0, b[k] ?? 0)), 0);

// ------------------------------------------------ потери войны ---

/** Потеря войны одного игрока: номер боя или падения, кто выбыл и могли ли из них быть раненые. */
export interface WarLoss {
  id: string;
  lost: Counts;
  /** Рассеянный гарнизон (падение голодом) ранеными не бывает: пациентов нет. */
  wounds: boolean;
}

/**
 * Все потери игрока `key` в записи войн, по номерам: войско его похода (`atkLost`), гарнизон и дружина его города
 * (`homeLost`, `genLost`) и гарнизон, разошедшийся при падении (`routed`).
 */
export function warLosses(file: WarFile, key: string): WarLoss[] {
  const out: WarLoss[] = [];
  for (const w of file.wars) {
    if (w.atk === key) for (const b of w.battles) out.push({ id: b.id, lost: b.atkLost, wounds: true });
    if (w.def !== key) continue;
    for (const b of w.battles) out.push({ id: b.id, lost: plus(b.homeLost, b.genLost ?? {}), wounds: true });
    if (w.fall) out.push({ id: warFallId(w.id), lost: w.fall.routed, wounds: false });
  }
  return out;
}

/**
 * Кто из выбывших наверняка погиб: всё, кроме доли, которую лазарет мог бы поднять (`INFIRMARY_HEAL_CAP`, с округлением
 * вверх по виду). Честный клиент кладёт в лазарет не больше этой доли, и его книга не урежется.
 */
export function deadOf(l: WarLoss): Counts {
  if (!l.wounds) return { ...l.lost };
  const out: Counts = {};
  for (const [k, v] of Object.entries(l.lost)) {
    const n = Math.max(0, (v ?? 0) - Math.ceil((v ?? 0) * INFIRMARY_HEAL_CAP));
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Погибшие боёв, которых нет в `except`, одним набором. */
export function deadExcept(losses: WarLoss[], except: ReadonlySet<string>): Counts {
  let out: Counts = {};
  for (const l of losses) if (!except.has(l.id)) out = plus(out, deadOf(l));
  return out;
}

/** Книга сейчас: вычтены и потери войны, которых она ещё не видела. Это потолок войска, которое пойдёт в бой. */
export const bookLive = (book: ArmyBook, file: WarFile, key: string): Counts =>
  minus(book.bodies, deadExcept(warLosses(file, key), new Set(book.lost)));

// ------------------------------------------------ обучение ---

/** Здания, где учат: казармы — пеших, конюшня — конных. */
const SCHOOLS = ['barracks', 'stable'] as const;
type School = (typeof SCHOOLS)[number];

const schoolOf = (kind: string): School | null => {
  const def = (TROOP_BY_ID as Record<string, { mounted?: boolean } | undefined>)[kind];
  return def ? (def.mounted ? 'stable' : 'barracks') : null;
};

const workOf = (kind: string): number => (TROOP_BY_ID as Record<string, { work: number } | undefined>)[kind]?.work ?? Infinity;

/** Работа самого долгого вида здания — потолок копилки (`ArmyBook.credit`). */
const longest = (school: School): number =>
  Math.max(...Object.keys(TROOP_BY_ID).filter((k) => schoolOf(k) === school).map(workOf));

/**
 * Уровень здания, который сервер готов признать в минуту `at`: заявленный описью, но не выше потолка здания и не выше
 * того, что прошло времени с первой встречи (`LEVEL_STEP_MS` на уровень сверх первого).
 */
export function levelAt(book: ArmyBook, school: School, claimed: number, at: number): number {
  const cap = Math.min(BUILDING_BY_ID[school].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  const time = 1 + Math.floor(Math.max(0, at - book.since) / LEVEL_STEP_MS);
  return Math.max(0, Math.min(Math.floor(claimed), cap, time));
}

/** Работа обучения, которую здание могло сделать между записями книги, с запасом, — и копилка прежних записей. */
export function workAllowed(book: ArmyBook, school: School, claimed: number, at: number): number {
  const level = levelAt(book, school, claimed, at);
  const rate = trainRateAt(school === 'stable', level);
  return (book.credit[school] ?? 0) + rate * gameSecondsOfMs(Math.max(0, at - book.at)) * BOOK_SLACK;
}

// ------------------------------------------------ запись книги ---

/** Что заявила опись: бойцы, раненые и уровни зданий. */
export interface BookClaim {
  troops: Counts;
  hurt?: Counts;
  buildings?: Counts;
}

export interface BookStep {
  book: ArmyBook;
  /** Сколько тел заявлено сверх подтверждённого, не считая потерь войны, о которых клиент ещё не знает. */
  forged: number;
  /** Подтверждено и заявлено всего — для слов флага. */
  confirmed: number;
  claimed: number;
}

/**
 * Книга после записи партии в минуту `at` (серверную). Порядок:
 *  1. вычесть погибших в боях войны, которых книга ещё не видела (`file`; нет записи войн — потери ждут следующей);
 *  2. прибавить указы админа старше `book.grant`;
 *  3. каждому виду — не больше заявленного и не больше прежнего с обучением за прошедшее время; если заявленный рост
 *     обгоняет работу здания, запас делится между видами пропорционально росту.
 * `seen` — бои, которые клиент уже принял (`WarSheet.seen`): для флага заявленное сравнивается с книгой за вычетом
 * погибших в боях, о которых клиент ещё не знает, — честный клиент, не успевший принять бой, флага не получает.
 */
export function bookAfter(
  prev: ArmyBook,
  at: number,
  claim: BookClaim,
  grants: readonly Pick<AdminGrant, 'n' | 'troops'>[],
  file: WarFile | null,
  key: string,
  seen: readonly string[] = [],
): BookStep {
  let bodies = { ...prev.bodies };
  let lost = prev.lost;
  let unseen: Counts = {};
  if (file) {
    const losses = warLosses(file, key);
    const done = new Set(prev.lost);
    bodies = minus(bodies, deadExcept(losses, done));
    unseen = deadExcept(losses, new Set(seen));
    // Помнит только бои, что ещё лежат у сервера: остальных он больше не вычтет.
    lost = losses.map((l) => l.id).slice(-BOOK_LOST_MAX);
  }
  let grant = prev.grant;
  for (const g of [...grants].sort((a, b) => a.n - b.n)) {
    if (g.n <= grant) continue;
    grant = g.n;
    for (const [k, v] of Object.entries(g.troops)) bodies[k] = Math.max(0, (bodies[k] ?? 0) + (v ?? 0));
  }
  const claimed = plus(claim.troops, claim.hurt ?? {});
  const next: Counts = {};
  const credit: Counts = {};
  for (const school of SCHOOLS) {
    const kinds = Object.keys(claimed).filter((k) => schoolOf(k) === school);
    const grow: Counts = {};
    let need = 0;
    for (const k of kinds) {
      const g = Math.max(0, (claimed[k] ?? 0) - (bodies[k] ?? 0));
      if (g > 0) grow[k] = g;
      need += g * workOf(k);
    }
    const allowed = workAllowed(prev, school, claim.buildings?.[school] ?? 0, at);
    const share = need > 0 ? Math.min(1, allowed / need) : 1;
    let used = 0;
    for (const k of kinds) {
      const add = Math.floor((grow[k] ?? 0) * share);
      used += add * workOf(k);
      const n = Math.min(claimed[k] ?? 0, (bodies[k] ?? 0) + add);
      if (n > 0) next[k] = n;
    }
    const left = Math.min(longest(school), Math.max(0, allowed - used));
    if (left > 0) credit[school] = left;
  }
  const book: ArmyBook = { since: prev.since, at, bodies: next, credit, grant, lost };
  return {
    book,
    forged: Math.max(0, over(minus(claimed, unseen), next) - FORGED_SLACK),
    confirmed: troopTotal(next as TroopStack),
    claimed: troopTotal(claimed as TroopStack),
  };
}

// ------------------------------------------------ потолки правил ---

/**
 * Потолок стойкости (обряд веры, `derived.fervour`): наибольший наклон веры при высшем уровне храма и самом строгом
 * укладе. Больше стойкости у игрока не бывает никак.
 */
export const RESOLVE_MAX = Math.max(
  0,
  ...FAITHS.flatMap((f) => OBSERVANCES.map((o) => tiltAt(f.id, MAX_BUILDING_LEVEL, o.id).fervour)),
);

/** Потолок отметок полководца (`sim/agents.pipsAt`): кружок за каждый уровень сверх первого, не выше последнего. */
export const PIPS_MAX = Math.max(0, MAX_AGENT_LEVEL - 1);

/** Стойкость в пределах правил. */
export const ruleResolve = (r: number): number => Math.min(RESOLVE_MAX, Math.max(0, r));

/** Отметки в пределах правил: только известные (`PIP_IDS`), целые, сумма не выше `PIPS_MAX` — сверх неё срезаются с конца. */
export function rulePips(p: Counts): Counts {
  const out: Counts = {};
  let left = PIPS_MAX;
  for (const k of PIP_IDS) {
    const n = Math.min(left, Math.max(0, Math.floor(p[k] ?? 0)));
    if (n > 0) out[k] = n;
    left -= n;
  }
  return out;
}
