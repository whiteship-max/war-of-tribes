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
//   лишний рот — не возврат, а следующий голод. **Поводы делят уходящих, а не спорят за них:**
//   в шаге, где нечем и платить, и кормить, голодная часть (`unfed`) уходит совсем, а та, что
//   сверх неё, — неуплатой и жителем. Строка тревоги при этом по-прежнему одна и называет
//   больший из поводов (`derived.upkeepInfo.why`): у неё одно место и одно лечение;
// - казна погасила долг и войско сыто — терпение начинается заново.
//
// **Наёмные мастера — в той же ведомости и за тем же столом** (docs/admin_branch.md, раздел 4.1):
// их жалованье входит в `wagesPerDay`, их паёк — в тех, кто ест последним (`foodShortfall`), и
// уходят они отсюда же, той же долей и по тем же двум поводам. Жителем ушедший мастер не
// остаётся: он им не был. Второй двери под мастеров нет.
import type { GameState, PayState, TroopId } from '../types';
import { DAY_LENGTH } from '../constants';
import { DESERT_SHARE, UPKEEP_TEXT } from '../data/upkeep';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import {
  armyWagesPerDay,
  homeTroops,
  housingCapacity,
  mastersCount,
  payGraceDays,
  soldierMouths,
  taxIncomePerDay,
  troopsEat,
  troopWage,
  unpaidShare,
  wagesDue,
} from '../derived';
import { addPop } from './population';
import { loseWounded } from './infirmary';
import { loseRecruits } from './army';
import { loseMasters } from './masters';
import type { TroopStack } from '../battle/kinds';
import { log } from './log';
import { WAGE_MODES, type WageMode } from '../spiritrules';
import { payShare, wageMode } from './spirit';

/**
 * Голодом уходит доля `rate` каждого вида из `stack`, дробь копится в `carry` до целого человека.
 * Один счёт на раненых и новобранцев: у строя свой — у него два повода.
 */
function starve(
  stack: TroopStack,
  carry: Partial<Record<TroopId, number>>,
  rate: number,
  lose: (id: TroopId, n: number) => number,
  each: (id: TroopId) => void,
): void {
  for (const id of TROOP_IDS) {
    const have = stack[id] ?? 0;
    if (have <= 0) {
      delete carry[id];
      continue;
    }
    const due = (carry[id] ?? 0) + have * rate;
    const whole = Math.min(have, Math.floor(due));
    carry[id] = due - whole;
    if (whole <= 0) continue;
    const gone = lose(id, whole);
    for (let i = 0; i < gone; i++) each(id);
  }
}

/**
 * Шаг содержания. Зовётся после того, как налог лёг в казну (`marketTick`), с тем,
 * какую долю войска на этом шаге нечем кормить (`derived.foodShortfall`).
 *
 * **Терпение и уход зреют по времени, а не по присутствию** (docs/time.md, раздел 14): шаг один — при игроке
 * и в догоне отлучки. Прежде уход шёл только при игроке, и при медленном дне это значило «никогда»:
 * четверть часа игры в сутки не набирали терпения Статуи и за неделю.
 */
export function upkeepTick(s: GameState, dt: number, unfed: number): void {
  const pay = s.pay;
  const due = wagesDue(s);
  if (due > 0) {
    const need = (due * dt) / DAY_LENGTH;
    const paid = Math.min(s.gold, need);
    s.gold -= paid;
    pay.debt += need - paid;
    // Счёт уплаченного дружине (ДР-1) — для книги духа сервера: жалованье войска этой доли ведомости, без недоплаченного, как
    // у совета и агентов.
    pay.paid = (pay.paid ?? 0) + (armyWagesPerDay(s) * (1 - unpaidShare(s)) * dt) / DAY_LENGTH;
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
  pay.late += dt;
  if (share <= 0 || pay.late < payGraceDays(s) * DAY_LENGTH) return;

  const gapBefore = wagesDue(s) - taxIncomePerDay(s);
  // **Поводы не спорят за одного человека, а делят уходящих.** Уходит доля `share` — больший из двух
  // недостатков; голодная его часть — это `unfed`, остальное недодано жалованьем. Прежде повод
  // назывался одним словом на весь шаг, по большему из двух (`unpaid >= unfed` → «неуплата»), и в шаге,
  // где нечем и платить, и кормить, **ушедший голодом возвращался жителем** вопреки правилу «ушедший
  // голодом уходит совсем»: посёлку, которому нечем кормить войско, лишний рот — следующий голод.
  // Случалось это редко (1 шаг из 65 с нехваткой еды, `npm run raid-hiring:report`, «Лазарет», «Голод»),
  // но называлась неправда. Теперь у каждой части свой повод, свой остаток дроби и своя судьба.
  const hungry = Math.min(share, unfed);
  const owed = Math.max(0, share - hungry);
  // Бойцы, что не едят (ВРЕМЕННО ДЛЯ ТЕСТА, `derived.troopsEat`), голодом не уходят: их доля — одна неуплата. При пайке —
  // те же `hungry` и `owed`.
  const troopUnfed = troopsEat(s) ? unfed : 0;
  const troopShare = Math.max(unpaid, troopUnfed);
  const troopHungry = Math.min(troopShare, troopUnfed);
  const troopOwed = Math.max(0, troopShare - troopHungry);
  const rateOf = (part: number): number => (DESERT_SHARE * part * dt) / DAY_LENGTH;
  /** Сколько целых бойцов уходит этой долей: дробь копится в своём остатке, а `cap` держит сумму обоих поводов. */
  const draw = <K extends string>(carry: Partial<Record<K, number>>, id: K, have: number, cap: number, rate: number): number => {
    const due = (carry[id] ?? 0) + have * rate;
    const whole = Math.min(cap, Math.floor(due));
    carry[id] = due - whole;
    return whole;
  };
  pay.starved ??= {};
  for (const id of TROOP_IDS) {
    const have = Math.max(0, s.army[id] ?? 0);
    if (have <= 0) {
      delete pay.gone[id];
      delete pay.starved[id];
      continue;
    }
    // Голод считается первым: он забирает своих совсем, и неуплате остаётся то, что сверх него.
    const byFood = draw(pay.starved, id, have, have, rateOf(troopHungry));
    const byPay = draw(pay.gone, id, have, have - byFood, rateOf(troopOwed));
    const whole = byFood + byPay;
    if (whole <= 0) continue;
    s.army[id] = have - whole;
    const home = byPay > 0 ? addPop(s, Math.min(byPay, Math.max(0, housingCapacity(s) - s.pop))) : 0;
    const one = TROOP_BY_ID[id].one;
    for (let i = 0; i < home; i++) log(s, UPKEEP_TEXT.desertedHome(one, UPKEEP_TEXT.why.pay), 'bad', `desert:${id}:home`);
    for (let i = home; i < byPay; i++) log(s, UPKEEP_TEXT.deserted(one, UPKEEP_TEXT.why.pay), 'bad', `desert:${id}`);
    for (let i = 0; i < byFood; i++) log(s, UPKEEP_TEXT.deserted(one, UPKEEP_TEXT.why.food), 'bad', `desert:${id}:food`);
  }
  // Наёмные мастера — та же доля и те же два повода, что у строя: голодная часть и недоплаченная,
  // каждая своим остатком дроби. Жителем ушедший мастер не остаётся (`sim/masters.loseMasters`).
  const masters = mastersCount(s);
  if (masters > 0) {
    pay.masters ??= {};
    const byFood = draw(pay.masters, 'unfed', masters, masters, rateOf(hungry));
    const byPay = draw(pay.masters, 'unpaid', masters, masters - byFood, rateOf(owed));
    loseMasters(s, byFood, byPay);
  } else if (pay.masters) {
    delete pay.masters;
  }
  // Раненые и новобранцы на учениях едят тот же паёк и делят ту же нехватку (`derived.soldierMouths`):
  // кто ест — тот и считается. При голоде они уходят той же долей, что строй, но **всегда голодом и
  // совсем**: жалованья им не положено, и повод «неуплата», возвращающий ушедшего жителем, к ним
  // не относится, в каком бы поводе ни шёл шаг для строя (docs/infirmary.md, решение 4).
  if (troopUnfed > 0) {
    const starveRate = rateOf(troopUnfed);
    const mouths = soldierMouths(s);
    pay.hurt ??= {};
    pay.drafts ??= {};
    starve(mouths.wounded, pay.hurt, starveRate, (id, n) => loseWounded(s, id, n), (id) => {
      log(s, UPKEEP_TEXT.woundedStarved(TROOP_BY_ID[id].one), 'bad', `starve:wounded:${id}`);
    });
    starve(mouths.recruits, pay.drafts, starveRate, (id, n) => loseRecruits(s, id, n), (id) => {
      log(s, UPKEEP_TEXT.draftStarved(TROOP_BY_ID[id].one), 'bad', `starve:draft:${id}`);
    });
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
  else if (max === 0) blocked = 'Дома таких нет, все в походе.';
  else if (n < 1) blocked = 'Сколько распустить?';
  else if (n > max) blocked = `Дома только ${max}.`;
  return { max, saves: troopWage(s, troop) * Math.min(n, max), blocked };
}

/**
 * Что вернётся, если распустить `n` бойцов вида `troop`: люди — жителями, снаряжение — на склад снаряжения. Одна функция на
 * роспуск и на окно «Дружины», которое называет это до подтверждения (правило 18).
 */
export function dismissReturns(troop: TroopId, n: number): { people: number; gear: Partial<Record<keyof GameState['equipment'], number>> } {
  const k = Math.max(0, Math.floor(n));
  const gear: Partial<Record<keyof GameState['equipment'], number>> = {};
  for (const [id, per] of Object.entries(TROOP_BY_ID[troop].gear)) if (per && k > 0) gear[id as keyof GameState['equipment']] = per * k;
  return { people: k, gear };
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
  const back = dismissReturns(troop, n);
  s.army[troop] = (s.army[troop] ?? 0) - n;
  for (const [id, k] of Object.entries(back.gear)) {
    if (k) s.equipment[id as keyof typeof s.equipment] = (s.equipment[id as keyof typeof s.equipment] ?? 0) + k;
  }
  addPop(s, back.people);
  for (let i = 0; i < n; i++) log(s, UPKEEP_TEXT.dismissed(def.one), 'info', `dismiss:${troop}`);
  return null;
}

// ---------- Жалованье: полное или минимальное (ДР-1) ----------

/** Почему сменить жалованье нельзя; можно — `null`. */
export function wageModeBlock(s: GameState, mode: WageMode): string | null {
  if (!WAGE_MODES.includes(mode)) return 'Такого жалованья нет.';
  if (wageMode(s) === mode) return mode === 'full' ? 'Дружине уже платят полное.' : 'Дружине уже платят минимальное.';
  return null;
}

/**
 * Сменить жалованье дружине (ДР-1, docs/siege_v2.md, «Решения ДР-1»): с этой минуты казна платит полную долю или
 * `spiritrules.WAGE_MIN_SHARE` (`derived.armyWagesPerDay`), а дух идёт к потолку или к дну с той доли, на которой стоит
 * (`payShareAt`): смена на середине пути начинает с середины, а не с края. Пишет `PayState.wage` только она.
 */
export function setWageMode(s: GameState, mode: WageMode): string | null {
  const why = wageModeBlock(s, mode);
  if (why) return why;
  const from = payShare(s);
  s.pay.wage = { mode, since: s.time, from };
  log(s, UPKEEP_TEXT.wageSet(mode), mode === 'full' ? 'good' : 'bad', 'wage');
  return null;
}

/** Жалованье и счёт уплаченного из сохранения: режим — только из списка и с числами; иначе поля нет (полное, давно). */
export function mergeWage(saved: unknown): Pick<PayState, 'wage' | 'paid'> {
  const r = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const w = (r.wage && typeof r.wage === 'object' ? r.wage : null) as Record<string, unknown> | null;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const wage =
    w && WAGE_MODES.includes(w.mode as WageMode) && n(w.since) !== null && n(w.from) !== null
      ? { mode: w.mode as WageMode, since: n(w.since) as number, from: Math.max(0, Math.min(1, n(w.from) as number)) }
      : undefined;
  const paid = n(r.paid);
  return { ...(wage ? { wage } : {}), ...(paid !== null && paid > 0 ? { paid } : {}) };
}
