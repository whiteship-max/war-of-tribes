// Где стоит боец, — одно правило на мир и на племя.
//
// Армий две, и боец переходит из одной в другую, а не копируется. **Гарнизон** —
// войско города, лимита у него нет. **Дружина** — те, кого полководец забрал из
// города: в городе их больше нет, и Статуя ограничивает не оборону, а то, сколько
// можно из города вынести. Третьего места — свой отряд в пути — у бойца тоже
// ровно одно.
//
// Гарнизоном дружина не становится никогда, где бы полководец ни стоял: из
// гарнизона выходят на вылазку, уходят в отряд и забираются полководцу, и тех,
// кто уже при нём, в нём нет. Иначе тех же бойцов отдавали бы полководцу второй
// раз — так десять дубинщиков и становились дружиной в сто десять.
//
// **Оборона** — другой вопрос, и ответ на него зависит от того, где дружина
// (`postureOf`). Собрана и дома — стоит в обороне вместе с гарнизоном: у
// частокола, за стеной у амбара и под рассеянием, если город падёт. Идёт сбор или
// роспуск — эти люди не защищают никого: из гарнизона они вышли, в строй ещё не
// встали. В пути, в поле, в погоне, в лагере — дружина занята и в обороне не
// стоит, даже в двух шагах от ворот. Занятость — не поле и не флаг: это то же
// самое «где полководец», прочитанное в минуту боя.
//
// Двойного счёта нет по построению: `troops` (не в гарнизоне) и `standing` (из
// них в обороне) — одна и та же дружина, разложенная по месту, а оборона —
// гарнизон плюс `standing`. Гарнизон `standing` не содержит, поэтому сложить их
// дважды нечем.
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

/** Кто из дружины не в гарнизоне и кто из них стоит в обороне. */
export interface Away {
  /** Поимённо по видам: войско при полководце и состав своих отрядов. */
  troops: TroopStack;
  /**
   * Отряд, ушедший числом, без состава (поддержка, отправленная гонцом). Кто
   * именно ушёл, неизвестно — снимается со слабых, так же как они гибнут.
   */
  loose: number;
  /**
   * Часть `troops`, которая стоит в обороне: дружина, собранная и стоящая дома.
   * Гарнизоном она от этого не становится.
   */
  standing: TroopStack;
}

export const NOBODY_AWAY: Away = { troops: {}, loose: 0, standing: {} };

/**
 * Кто не в гарнизоне: свои отряды в пути и войско при полководце — в любой фазе.
 * Из них в обороне — дружина, которая собрана и стоит дома (`postureOf`).
 */
export function awayOf(marches: readonly Marching[], figures: readonly Holding[], at?: number): Away {
  const troops: TroopStack = {};
  const standing: TroopStack = {};
  let loose = 0;
  const add = (to: TroopStack, stack: TroopStack | undefined): void => {
    for (const id of TROOP_IDS) {
      const n = Math.max(0, stack?.[id] ?? 0);
      if (n > 0) to[id] = (to[id] ?? 0) + n;
    }
  };
  for (const m of marches) {
    if (!m.own) continue;
    if (m.troops && troopTotal(m.troops) > 0) add(troops, m.troops);
    else loose += Math.max(0, Math.round(m.units.warrior ?? 0));
  }
  for (const f of figures) {
    add(troops, f.troops);
    if (postureOf(f, at) === 'stands') add(standing, f.troops);
  }
  return { troops, loose, standing };
}

/** Сколько людей из дружины не в гарнизоне: при полководце в любой фазе и в отрядах. */
export const awayMen = (away: Away): number => troopTotal(away.troops) + Math.max(0, away.loose);

/**
 * Сколько людей не стоит в обороне: отряды в пути и дружина, которая не собрана
 * дома. Этим числом живёт `s.warriorsAway`, по нему племя считает оборону.
 */
export const outMen = (away: Away): number => awayMen(away) - troopTotal(away.standing);

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
 * Гарнизон: всё войско минус те, кто не в нём. Ушедших поимённо вычитают по видам,
 * ушедших числом — со слабых. Отрицательного гарнизона не бывает: если в мире
 * числится больше, чем есть у племени, дома просто никого этого вида нет.
 */
export function homeOf(army: TroopStack, away: Away): TroopStack {
  const named = troopsAfter(army, away.troops);
  return troopsAfter(named, weakest(named, away.loose));
}

/**
 * Оборона деревни поимённо: гарнизон плюс дружина, собранная дома. Дружины в ней
 * не больше, чем есть у племени сверх гарнизона, — лишнего бойца из старого
 * сохранения сверка вычеркнет на пульсе, а до того в оборону он не встанет.
 */
export function defendersOf(army: TroopStack, away: Away): TroopStack {
  return plus(homeOf(army, away), standingTroops(army, away));
}

/** Дружина в обороне — та её часть, что есть у племени сверх гарнизона. */
export function standingTroops(army: TroopStack, away: Away): TroopStack {
  const garrison = homeOf(army, away);
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = Math.min(Math.max(0, away.standing[id] ?? 0), Math.max(0, (army[id] ?? 0) - (garrison[id] ?? 0)));
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * Потери обороны — поровну по видам между гарнизоном и дружиной, пропорционально
 * тому, сколько каждого вида стоит в каждой. Своей доли у дружины нет: у частокола
 * стоят вместе и гибнут вместе. Возвращается доля дружины; гарнизону достаётся
 * остаток, и сумма двух долей равна потерям до бойца.
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

const plus = (a: TroopStack, b: TroopStack): TroopStack => {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (a[id] ?? 0) + (b[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
};
