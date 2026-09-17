// Содержание войска: плата, терпение, уход и роспуск.
//
// Потолка дружины нет — войско держит цена (`data/upkeep.ts`). Дверь, через которую
// войско убывает само, **одна, а поводов у неё два**: нечем платить и нечем кормить.
// Второй двери под голод нет: голод, который бьёт по жителям, пока войско сыто, —
// это посёлок, платящий за армию, и потолок по еде тогда не касался бы войска вовсе.
//
// Устройство:
// - жалованье снимается с казны непрерывно, тем же шагом, каким в неё капает налог;
//   не хватило — копится долг;
// - долг есть или войско нечем кормить — идёт терпение (`PayState.late`), **только
//   при игроке**: без него долг копится, а уход ждёт, как ропот невольников;
// - терпение дошло до срока Статуи — за игровой день уходит `DESERT_SHARE` от
//   неоплаченной или некормленной части войска, равной долей каждого вида;
// - ушедшие уносят свою долю долга; сошлись доход и жалованье — долга нет, уход
//   встаёт сам и ниже того, что казна тянет, войско не опускается;
// - **ушедший неуплатой возвращается жителем, если в посёлке есть крыша**; нет места —
//   уходит совсем. Снаряжение и время учений он не возвращает — этого наказания хватает:
//   ошибка найма должна быть дорогой, а не необратимой (решение владельца, docs/hiring.md,
//   раздел 9). Ушедший голодом уходит совсем: в посёлке, которому нечем кормить войско,
//   лишний рот — не возврат, а следующий голод;
// - казна погасила долг и войско сыто — терпение начинается заново.
import type { GameState, TroopId } from '../types';
import { DAY_LENGTH } from '../constants';
import { DESERT_SHARE, UPKEEP_TEXT } from '../data/upkeep';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import {
  homeTroops,
  housingCapacity,
  payGraceDays,
  taxIncomePerDay,
  unpaidShare,
  wageOf,
  wagesDue,
} from '../derived';
import { addPop } from './population';
import { log } from './log';

/**
 * Шаг содержания. Зовётся после того, как налог лёг в казну (`marketTick`), с тем,
 * какую долю войска на этом шаге нечем кормить (`derived.foodShortfall`).
 * `online` — идёт живая игра, а не офлайн-догон.
 */
export function upkeepTick(s: GameState, dt: number, online: boolean, unfed: number): void {
  const pay = s.pay;
  const due = wagesDue(s);
  if (due > 0) {
    const need = (due * dt) / DAY_LENGTH;
    const paid = Math.min(s.gold, need);
    s.gold -= paid;
    pay.debt += need - paid;
  }
  // Долг гасится из того, что осталось в казне: жалованье первым, долг вторым.
  if (pay.debt > 0 && s.gold > 0) {
    const back = Math.min(s.gold, pay.debt);
    s.gold -= back;
    pay.debt -= back;
  }
  if (pay.debt < 1e-6) pay.debt = 0;

  const unpaid = unpaidShare(s);
  const share = Math.max(unpaid, unfed);
  if (pay.debt === 0 && unfed <= 0) {
    pay.late = 0;
    return;
  }
  if (!online) return;
  pay.late += dt;
  if (share <= 0 || pay.late < payGraceDays(s) * DAY_LENGTH) return;

  const gapBefore = wagesDue(s) - taxIncomePerDay(s);
  const unpaidLeave = unpaid >= unfed;
  const why = UPKEEP_TEXT.why[unpaidLeave ? 'pay' : 'food'];
  const rate = (DESERT_SHARE * share * dt) / DAY_LENGTH;
  for (const id of TROOP_IDS) {
    const have = Math.max(0, s.army[id] ?? 0);
    if (have <= 0) {
      delete pay.gone[id];
      continue;
    }
    const gone = (pay.gone[id] ?? 0) + have * rate;
    const whole = Math.min(have, Math.floor(gone));
    pay.gone[id] = gone - whole;
    if (whole <= 0) continue;
    s.army[id] = have - whole;
    const home = unpaidLeave ? addPop(s, Math.min(whole, Math.max(0, housingCapacity(s) - s.pop))) : 0;
    const one = TROOP_BY_ID[id].one;
    for (let i = 0; i < home; i++) log(s, UPKEEP_TEXT.desertedHome(one, why), 'bad', `desert:${id}:home`);
    for (let i = home; i < whole; i++) log(s, UPKEEP_TEXT.deserted(one, why), 'bad', `desert:${id}`);
  }
  // Ушедшие уносят свою долю долга: сократилась нехватка — сократился и долг.
  // Сошлись доход и жалованье — долга не остаётся, и следующий наём начнёт с
  // терпения, а не с ухода.
  if (pay.debt > 0 && gapBefore > 0) {
    const gapAfter = Math.max(0, wagesDue(s) - taxIncomePerDay(s));
    pay.debt *= gapAfter / gapBefore;
    if (pay.debt < 1e-6) pay.debt = 0;
  }
}

export interface DismissCheck {
  /** Сколько бойцов этого вида можно распустить сейчас. */
  max: number;
  /** Сколько жалованья в день это снимет. */
  saves: number;
  blocked: string | null;
}

/**
 * Можно ли распустить бойцов. Распускают только тех, кто дома: дружина в поле и
 * отряды в пути в казармы не заходят. Дома ли, спрашивается **по виду**
 * (`derived.homeTroops`), а не числом: латник в поле дубинщиком дома не
 * становится. Прежде проверка шла по числу, и при латниках в дружине в поле
 * пускала распустить всех латников — а мир на следующем слепке вычёркивал их из
 * дружины (`LocalWorld.muster`): люди уходили из поля без единого боя.
 */
export function dismissCheck(s: GameState, troop: TroopId, count: number): DismissCheck {
  const have = Math.max(0, s.army[troop] ?? 0);
  const max = Math.min(have, homeTroops(s)[troop] ?? 0);
  const n = Math.max(0, Math.floor(count));
  let blocked: string | null = null;
  if (have === 0) blocked = 'Таких бойцов нет.';
  else if (max === 0) blocked = 'Дома таких нет: все в поле или в пути.';
  else if (n < 1) blocked = 'Сколько распустить?';
  else if (n > max) blocked = `Дома только ${max}.`;
  return { max, saves: wageOf(s, troop) * Math.min(n, max), blocked };
}

/**
 * Распустить бойцов по домам. Это выход без потерь, и без него правило наказывало
 * бы за незнание: люди возвращаются в посёлок жителями, снаряжение — на склад
 * снаряжения. Ресурсы найма и время учений потрачены — их не вернуть, как и у
 * отменённого на середине набора.
 */
export function dismissSoldiers(s: GameState, troop: TroopId, count: number): string | null {
  const check = dismissCheck(s, troop, count);
  if (check.blocked) return check.blocked;
  const n = Math.floor(count);
  const def = TROOP_BY_ID[troop];
  s.army[troop] = (s.army[troop] ?? 0) - n;
  for (const [id, per] of Object.entries(def.gear)) {
    if (per) s.equipment[id as keyof typeof s.equipment] = (s.equipment[id as keyof typeof s.equipment] ?? 0) + per * n;
  }
  addPop(s, n);
  for (let i = 0; i < n; i++) log(s, UPKEEP_TEXT.dismissed(def.one), 'info', `dismiss:${troop}`);
  return null;
}
