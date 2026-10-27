// Где стоит боец, — одно правило на мир и на племя.
//
// Армий две, и боец переходит из одной в другую, а не копируется. **Гарнизон** —
// войско города, лимита у него нет. **Дружина** — те, кого полководец забрал из
// города; Статуя ограничивает не оборону, а то, сколько можно из города вынести.
//
// **Где дружина, там и её люди** (`postureOf`). Полководец в городе — у своих ворот
// или укрывшись (`inTown`), — и его отряд **часть гарнизона**, не «рядом с ним», а в
// нём: стоит у частокола, ест за стеной, рассеивается при падении и выходит на
// вылазку вместе с остальными, и оборону ведёт сам полководец. Так и во время сбора:
// перевод бойцов внутри города из стен их не выводит (правило владельца 15.10.2026 —
// полководец и его отряд, пока внутри города, в оборонительных боях считаются
// гарнизоном; docs/ui_v2.md, 5.3; и полководец без отряда ведёт оборону — 6.10). Отдельного
// действия для этого нет — это то же «где полководец», прочитанное в минуту вопроса. Сбор
// бывает только вне города — в поле у своих ворот (в городе перевод мгновенный, и в осаде,
// 6.11) — и выводит этих людей из строя: не защищают никого. В пути, в поле, в
// погоне, в лагере — дружина занята и в гарнизоне её нет, даже в двух шагах от
// ворот; за ворота из поля она выходит своим приказом, а из города — только вылазкой.
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
import { own, wholeNonNeg } from '@/game/guard';
import { realMs } from '@/game/pace';
import { AI_WARNING_BASE, HANDOVER_BASE, HANDOVER_MAX, HANDOVER_PER_MAN } from './data/tuning';
import type { FigurePhase } from './types';

/**
 * Срок сбора или роспуска дружины из `moved` человек при множителе черт полководца `mult`, мс мира: база и доля на
 * бойца, но не дольше потолка, и множится после потолка — «Мясника» ждут дольше и у дружины, которая и так упиралась
 * в него. Одно правило на мир (`LocalWorld.musterWait`) и на слова черты (`ui/parts/traitLines`): полный сбор — это
 * `moved` = `Infinity`. Сбор идёт только в поле у своих ворот: в своём городе перевод мгновенный, и в осаде тоже (решение
 * владельца 16.10.2026, docs/ui_v2.md, 6.11), и окна ответа на набег он не держит — оно до прихода (docs/NOTIFY.md, 12.11).
 */
export const musterMs = (moved: number, mult = 1): number =>
  Math.round(Math.min(HANDOVER_MAX, HANDOVER_BASE + moved * HANDOVER_PER_MAN) * mult);

/**
 * Сколько игрок видит чужую армию до её прихода, мс мира: база и прибавка Дозора (`PlayerProfile.warning`, игровые
 * секунды — дверью времени). Одно правило на мир (`LocalWorld.warningMs`) и на слова черты (`ui/parts/traitLines`).
 */
export const warningMsOf = (warning: number): number => AI_WARNING_BASE + realMs(Math.max(0, warning));

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
 * - `stands` — полководец в городе: отряд в обороне, и во время сбора тоже;
 * - `gathering` — сбор или роспуск вне города (в поле у своих ворот): не защищает никого;
 * - `engaged` — в пути, в поле, в погоне, в лагере или полководец выбыл: в обороне
 *   её нет, даже когда он у самых ворот.
 */
export type Posture = 'none' | 'stands' | 'gathering' | 'engaged';

/**
 * Полководец в своём городе в минуту `at`: дома — у своих ворот или укрывшись (`phase` = `home`, `world/shelter`) — и
 * встал там не позже этой минуты. Без `at` — «сейчас». Мерка правила владельца: полководец и его отряд, пока внутри
 * города, в оборонительных боях считаются гарнизоном (15.10.2026, docs/ui_v2.md, 5.3) — отряд стоит у стен и во время
 * сбора (`postureOf`), а оборону ведёт полководец, с отрядом и без (`LocalWorld.homePips`; решение владельца 16.10.2026,
 * 6.10). В городе и перевод мгновенный, и в осаде (`LocalWorld.regroupInstant`, 6.11). Выбывший (`down`) — не в городе:
 * его нет ни на карте, ни за стеной.
 */
export const inTown = (f: Pick<Holding, 'phase' | 'departAt'>, at?: number): boolean =>
  f.phase === 'home' && !(at !== undefined && at < (f.departAt ?? 0));

/**
 * Где дружина. `at` — минута, о которой спрашивают; без неё — «сейчас», то есть
 * минута, в которую снят сам вид фигуры.
 *
 * Минута нужна миру: очередь событий разбирается после шага фигур, и набег,
 * пришедший раньше полководца, не должен застать у частокола дружину, которая
 * встала у ворот позже него.
 *
 * Город спрашивается раньше сбора: сбор внутри города бойцов из стен не выводит — прежде они на срок сбора не защищали
 * никого и не ели за стеной, хотя стояли в городе. С 16.10.2026 сбора в городе нет вовсе (перевод мгновенный и в осаде,
 * docs/ui_v2.md, 6.11); правило осталось для сбора, начатого по прежним правилам и лежащего в сохранении.
 */
export function postureOf(f: Holding, at?: number): Posture {
  if (troopTotal(f.troops ?? {}) === 0) return 'none';
  if (inTown(f, at)) return 'stands';
  const until = f.handover ? f.handover.until : (f.readyAt ?? 0);
  if (until > 0 && (at === undefined || at < until)) return 'gathering';
  return 'engaged';
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
 * Сколько людей не в гарнизоне: отряды в пути и дружина не дома. Племя хранит тех же людей
 * по видам (`s.away`, мост — `bridge.awayTroops`) и по ним считает оборону: гарнизон и есть оборона.
 */
export const awayMen = (away: Away): number => troopTotal(away.troops) + Math.max(0, away.loose);

/**
 * Дружина в поле — та, что может ударить из поля. Дома она гарнизон, и её путь
 * за ворота — вылазка; в сборе она не годится никуда. Это не проверка приказа, а
 * то же правило места, прочитанное с другой стороны.
 */
export const fieldTroops = (f: Holding, at?: number): TroopStack =>
  postureOf(f, at) === 'engaged' ? { ...(f.troops ?? {}) } : {};

/**
 * Отказ «отряда нет» полководцу в своём городе (ДР-6, docs/siege_v2.md, «Решения ДР-6»): в городе отряда у него не бывает —
 * его состав выбирают из гарнизона в окне дела (`ErrandOrder.troops`), и окно этот отказ снимает. «нет отряда» — мерка
 * окна (`ui/map/ring.emptyRetinue`), одна на все двери полководца.
 */
export const NO_BAND_HOME = 'У полководца нет отряда. Бойцов ему дают из гарнизона в окне дела.';

/** Отказ составу дела вне города: в поле состав не меняется (ДР-6, `LocalWorld.takeBand`). */
export const BAND_AS_IS = 'Полководец не в городе: уходит с тем отрядом, что при нём.';

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
 * Кого выводит приказ из тех, кто стоит в `home`: вылазка, прорыв, вылазка к машине, раскладка дружины. Состав из
 * приказа — чужие ключи и числа; больше, чем стоит, — `null` («Столько бойцов дома нет»). Одна дверь на все приказы
 * мира с составом.
 */
export function pickTroops(troops: TroopStack | null | undefined, home: TroopStack): TroopStack | null {
  const going: TroopStack = {};
  // По видам бойцов, а не по ключам приказа: «constructor» из приказа — не вид (SETUP-3). NaN и бесконечность — не число
  // бойцов (SETUP-4); дробь — вниз.
  for (const id of TROOP_IDS) {
    const n = Math.floor(own(troops ?? {}, id) ?? 0);
    if (!wholeNonNeg(n, Number.MAX_SAFE_INTEGER) || n === 0) continue;
    if (n > (home[id] ?? 0)) return null;
    going[id] = n;
  }
  return going;
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
