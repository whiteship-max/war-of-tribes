// Где стоит боец, — одно правило на мир и на племя.
//
// Армий две, и боец переходит из одной в другую, а не копируется. **Гарнизон** —
// войско города, лимита у него нет. **Дружина** — те, кого полководец забрал из
// города; Статуя ограничивает не оборону, а то, сколько можно из города вынести.
//
// **Где дружина, там и её люди** (`postureOf`). Полководец в городе — дружина
// собрана и дома — и она **часть гарнизона**, не «рядом с ним», а в нём: стоит у
// частокола, ест за стеной, рассеивается при падении и выходит на вылазку вместе с
// остальными. Отдельного действия для этого нет — это то же «где полководец»,
// прочитанное в минуту вопроса. Идёт сбор или роспуск — эти люди не в гарнизоне и
// не в строю: не защищают никого. В пути, в поле, в погоне, в лагере — дружина
// занята и в гарнизоне её нет, даже в двух шагах от ворот; за ворота из поля она
// выходит своим приказом, а из города — только вылазкой.
//
// Двойного счёта нет по построению: `troops` — те, кого в гарнизоне нет (походы и
// дружина не дома), `standing` — дружина, которая в гарнизоне. Одна и та же
// дружина лежит ровно в одном из двух списков, а гарнизон — всё войско минус
// `troops`. Сложить её дважды нечем, и отдать полководцу второй раз тоже: сколько
// ему можно держать, считается от войска без походов (`roomOf`), а не от гарнизона
// плюс того, что уже при нём, — так десять дубинщиков и становились дружиной в сто
// десять.
//
// Модуль чистый: ни состояния, ни часов. Считают по нему двое — мир, в ту
// минуту, когда решает, и мост, когда племя пересчитывает ушедших и панели
// показывают гарнизон. Второй правды о том, где стоит боец, между ними быть не
// должно.
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import type { FigurePhase } from './types';

/** Свой или чужой отряд в пути — ровно то, что о нём нужно учёту. */
interface Marching {
  own: boolean;
  units: { warrior?: number };
  troops?: TroopStack;
}

/**
 * Кто держит войско при себе. Из фигур оно бывает только у полководца. Годится и
 * фигура из сохранения мира (`handover`), и вид фигуры из пульса (`readyAt`).
 */
export interface Holding {
  phase: FigurePhase;
  troops?: TroopStack;
  /** Когда встал на нынешнее место или вышел в путь. */
  departAt?: number;
  /** Идущая передача дружины — у фигуры из сохранения. */
  handover?: { until: number } | null;
  /** Когда кончится передача, 0 — все на месте. У вида фигуры из пульса. */
  readyAt?: number;
}

/**
 * Где дружина в эту минуту — ровно то, за что игрок платит:
 * - `none` — при полководце никого;
 * - `stands` — собрана и дома: в обороне;
 * - `gathering` — идёт сбор или роспуск: не защищает никого;
 * - `engaged` — в пути, в поле, в погоне, в лагере или полководец выбыл: в обороне
 *   её нет, даже когда он у самых ворот.
 */
export type Posture = 'none' | 'stands' | 'gathering' | 'engaged';

/**
 * Где дружина. `at` — минута, о которой спрашивают; без неё — «сейчас», то есть
 * минута, в которую снят сам вид фигуры.
 *
 * Минута нужна миру: очередь событий разбирается после шага фигур, и набег,
 * пришедший раньше полководца, не должен застать у частокола дружину, которая
 * встала у ворот позже него.
 */
export function postureOf(f: Holding, at?: number): Posture {
  if (troopTotal(f.troops ?? {}) === 0) return 'none';
  const until = f.handover ? f.handover.until : (f.readyAt ?? 0);
  if (until > 0 && (at === undefined || at < until)) return 'gathering';
  if (f.phase !== 'home') return 'engaged';
  if (at !== undefined && at < (f.departAt ?? 0)) return 'engaged';
  return 'stands';
}

/** Кого нет в гарнизоне и кто из дружины в нём стоит. */
export interface Away {
  /**
   * Не в гарнизоне, поимённо по видам: состав своих отрядов и дружина, которая не
   * дома, — в сборе, в пути, в поле, в лагере.
   */
  troops: TroopStack;
  /**
   * Отряд, ушедший числом, без состава (поддержка, отправленная гонцом). Кто
   * именно ушёл, неизвестно — снимается со слабых, так же как они гибнут.
   */
  loose: number;
  /**
   * Дружина, собранная и стоящая дома: она **в гарнизоне**. Отдельно названа
   * только затем, чтобы потери гарнизона ложились на неё её долей
   * (`standingShare`), — числом гарнизона она уже учтена.
   */
  standing: TroopStack;
}

export const NOBODY_AWAY: Away = { troops: {}, loose: 0, standing: {} };

/**
 * Кто где: свои отряды в пути и дружина не дома — не в гарнизоне; дружина,
 * собранная и стоящая дома (`postureOf`), — в нём. Каждая дружина ровно в одном
 * из двух списков.
 */
export function awayOf(marches: readonly Marching[], figures: readonly Holding[], at?: number): Away {
  const troops: TroopStack = {};
  const standing: TroopStack = {};
  let loose = 0;
  for (const m of marches) {
    if (!m.own) continue;
    if (m.troops && troopTotal(m.troops) > 0) add(troops, m.troops);
    else loose += Math.max(0, Math.round(m.units.warrior ?? 0));
  }
  for (const f of figures) add(postureOf(f, at) === 'stands' ? standing : troops, f.troops);
  return { troops, loose, standing };
}

/**
 * Сколько людей не в гарнизоне: отряды в пути и дружина не дома. Этим числом
 * живёт `s.warriorsAway`, по нему племя считает оборону: гарнизон и есть оборона.
 */
export const awayMen = (away: Away): number => troopTotal(away.troops) + Math.max(0, away.loose);

/**
 * Дружина в поле — та, что может ударить из поля. Дома она гарнизон, и её путь
 * за ворота — вылазка; в сборе она не годится никуда. Это не проверка приказа, а
 * то же правило места, прочитанное с другой стороны.
 */
export const fieldTroops = (f: Holding, at?: number): TroopStack =>
  postureOf(f, at) === 'engaged' ? { ...(f.troops ?? {}) } : {};

/** Первые `n` бойцов со слабого конца: список казарм идёт от дешёвого к дорогому. */
export function weakest(t: TroopStack, n: number): TroopStack {
  const out: TroopStack = {};
  let left = Math.max(0, Math.round(n));
  for (const id of TROOP_IDS) {
    if (left <= 0) break;
    const take = Math.min(Math.max(0, t[id] ?? 0), left);
    if (take > 0) out[id] = take;
    left -= take;
  }
  return out;
}

/**
 * Сколько войска может держать полководец: всё, что не ушло отрядами. Дружина
 * берётся из этого, а не из «гарнизон плюс то, что уже при нём»: дома дружина и
 * так в гарнизоне, и сложить её второй раз нельзя.
 */
export const roomOf = (army: TroopStack, marches: readonly Marching[]): TroopStack =>
  homeOf(army, awayOf(marches, []));

/**
 * Гарнизон поимённо: всё войско минус те, кто не в нём, — вместе с дружиной,
 * собранной дома. Ушедших поимённо вычитают по видам, ушедших числом — со слабых
 * из тех, кто не дружина. Отрицательного гарнизона не бывает: если в мире числится
 * больше, чем есть у племени, дома просто никого этого вида нет; дружины в нём не
 * больше, чем есть у племени, — лишнего бойца из старого сохранения сверка
 * вычеркнет на пульсе, а до того в строй он не встанет.
 */
export function homeOf(army: TroopStack, away: Away): TroopStack {
  return plus(ownOf(army, away), standingTroops(army, away));
}

/** Гарнизон без дружины: тем, кто в нём не с полководцем, достаётся своя доля потерь. */
export function ownOf(army: TroopStack, away: Away): TroopStack {
  const named = troopsAfter(army, plus(away.troops, away.standing));
  return troopsAfter(named, weakest(named, away.loose));
}

/** Дружина в гарнизоне — та её часть, что есть у племени сверх остального гарнизона. */
export function standingTroops(army: TroopStack, away: Away): TroopStack {
  const own = ownOf(army, away);
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = Math.min(
      Math.max(0, away.standing[id] ?? 0),
      Math.max(0, (army[id] ?? 0) - (away.troops[id] ?? 0) - (own[id] ?? 0)),
    );
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * Потери гарнизона — поровну по видам между дружиной, стоящей в нём, и остальными,
 * пропорционально тому, сколько каждого вида стоит в каждой части. Своей доли у
 * дружины нет: у частокола стоят вместе, на вылазку выходят вместе и гибнут
 * вместе. Возвращается доля дружины; остальным достаётся остаток, и сумма двух
 * долей равна потерям до бойца.
 */
export function standingShare(garrison: TroopStack, standing: TroopStack, lost: TroopStack): TroopStack {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const g = Math.max(0, garrison[id] ?? 0);
    const s = Math.max(0, standing[id] ?? 0);
    const l = Math.min(Math.max(0, lost[id] ?? 0), g + s);
    if (l === 0 || s === 0) continue;
    const n = Math.min(s, Math.max(l - g, Math.round((l * s) / (g + s))));
    if (n > 0) out[id] = n;
  }
  return out;
}

function add(to: TroopStack, stack: TroopStack | undefined): void {
  for (const id of TROOP_IDS) {
    const n = Math.max(0, stack?.[id] ?? 0);
    if (n > 0) to[id] = (to[id] ?? 0) + n;
  }
}

export const plus = (a: TroopStack, b: TroopStack): TroopStack => {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (a[id] ?? 0) + (b[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
};
