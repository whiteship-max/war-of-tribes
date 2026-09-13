// Кто из дружины дома, а кто нет, — одно правило на мир и на племя.
//
// Боец стоит ровно в одном месте. При полководце — значит не дома, **где бы
// полководец ни стоял**: у своих ворот, в пути, в поле и пока идёт передача (в
// ней числятся и уходящие, и возвращающиеся — эти люди уже не в гарнизоне и ещё
// не в строю). Свой отряд в пути — тоже не дома.
//
// Правило было записано дважды, и оба раза с одной оговоркой: войско полководца,
// стоящего у своих ворот, считалось ещё и домашним. Из одной оговорки выросло
// всё сразу: тех же бойцов отдавали полководцу второй раз (десять дубинщиков
// становились дружиной в сто десять, и ядро боя считало все сто десять), они же
// выходили на вылазку, вставали у частокола по запертой расстановке и
// рассеивались голодом, оставаясь при полководце.
//
// Модуль чистый: ни состояния, ни часов. Считают по нему двое — мир, в ту
// минуту, когда решает (передача дружины, вылазка, бой у частокола, падение
// от голода, часы осады), и мост, когда племя пересчитывает ушедших и панели
// показывают гарнизон. Второй правды о том, где стоит боец, между ними быть не
// должно.
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';

/** Свой или чужой отряд в пути — ровно то, что о нём нужно учёту. */
interface Marching {
  own: boolean;
  units: { warrior?: number };
  troops?: TroopStack;
}

/** Кто держит войско при себе. Из фигур оно бывает только у полководца. */
interface Holding {
  troops?: TroopStack;
}

/** Кто из дружины не дома. */
export interface Away {
  /** Поимённо по видам: войско при полководце и состав своих отрядов. */
  troops: TroopStack;
  /**
   * Отряд, ушедший числом, без состава (поддержка, отправленная гонцом). Кто
   * именно ушёл, неизвестно — снимается со слабых, так же как они гибнут.
   */
  loose: number;
}

export const NOBODY_AWAY: Away = { troops: {}, loose: 0 };

/** Кто из дружины не дома: свои отряды в пути и войско при полководце — в любой фазе. */
export function awayOf(marches: readonly Marching[], figures: readonly Holding[]): Away {
  const troops: TroopStack = {};
  let loose = 0;
  const add = (stack: TroopStack | undefined): void => {
    for (const id of TROOP_IDS) {
      const n = Math.max(0, stack?.[id] ?? 0);
      if (n > 0) troops[id] = (troops[id] ?? 0) + n;
    }
  };
  for (const m of marches) {
    if (!m.own) continue;
    if (m.troops && troopTotal(m.troops) > 0) add(m.troops);
    else loose += Math.max(0, Math.round(m.units.warrior ?? 0));
  }
  for (const f of figures) add(f.troops);
  return { troops, loose };
}

/** Сколько людей из дружины не дома. Этим числом живёт `s.warriorsAway`. */
export const awayMen = (away: Away): number => troopTotal(away.troops) + Math.max(0, away.loose);

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
 * Гарнизон: всё войско минус те, кто не дома. Ушедших поимённо вычитают по видам,
 * ушедших числом — со слабых. Отрицательного гарнизона не бывает: если в мире
 * числится больше, чем есть у племени, дома просто никого этого вида нет.
 */
export function homeOf(army: TroopStack, away: Away): TroopStack {
  const named = troopsAfter(army, away.troops);
  return troopsAfter(named, weakest(named, away.loose));
}
