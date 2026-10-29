// Содержание отряда бродяги (ПН-1, ГДД 3.3.2) — вход «отряд» двери содержания войска `sim/upkeep`. Своим модулем (ПН-5, хвост а):
// его зовёт только шаг отряда, а Путь меча докачивается тому, кому открыт (`game/roamlazy`), — в первую загрузку игрока он не едет.
// Правила ухода — те же, что у города, из той же двери (`upkeep.starve`, `desertRate`, `splitShare`, `draw`); ведомость одна —
// `s.pay`.
import type { GameState } from '../types';
import { DAY_LENGTH } from '../constants';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { UPKEEP_TEXT } from '../data/upkeep';
import { bandPatienceDays, bandUnpaid, bandWagesPerDay, woundedOf } from '../roamrules';
import { desertRate, draw, splitShare, starve } from './upkeep';
import { wageMode } from './spirit';
import { loseBandWounded } from './bandwounds';
import { log } from './log';

/** Слова отряда: уходят из отряда, а не из дружины города, и жителем не остаются — крыши нет. */
const BAND_TEXT = {
  left: (one: string, why: string): string => `Ушёл из отряда ${one}: ${why}.`,
  woundedStarved: (one: string): string => `Ушёл из отряда раненый ${one}: нет еды.`,
} as const;

/**
 * Шаг содержания отряда бродяги — та же дверь, вход «отряд» (ГДД 3.3.2, «Решения ПН-1»). Правила — городские, двери — те же:
 *   — жалованье вида — формула 3.3.2 (`roamrules.bandWage`), полное или минимальное (ДР-1, `PayState.wage`); платит кошель
 *     (`RoamState.purse`), не хватило — долг в той же ведомости (`s.pay`: она одна на войско партии);
 *   — паёк ест зовущий (`sim/roam.roamStep`: фураж, потом обоз) и передаёт сюда, какая доля отряда голодна (`unfed`);
 *   — долг или голод — идёт терпение (`PayState.late`): две игр. дн. и по полдня за кружок Военного дела героя
 *     (`roamrules.bandPatienceDays`); кончилось — за игровой день уходит `DESERT_SHARE` от неоплаченной или некормленной части,
 *     **равной долей каждого вида**, голод первым (`splitShare`, `draw` — те же, что у города);
 *   — ушедший неуплатой у бродяги уходит совсем: крыши нет (у города он остаётся жителем); раненые при голоде — голодом и
 *     совсем (`sim/infirmary.loseBandWounded`);
 *   — ушедшие уносят свою долю долга: дохода у отряда нет, и долг убывает вместе с жалованьем.
 */
export function bandUpkeep(s: GameState, dt: number, unfed: number): void {
  const r = s.roam;
  if (!r) return;
  const pay = s.pay;
  const mode = wageMode(s);
  const due = bandWagesPerDay(r.band, mode);
  if (due > 0) {
    const need = (due * dt) / DAY_LENGTH;
    const paid = Math.min(r.purse, need);
    r.purse -= paid;
    pay.debt += need - paid;
    // Счёт уплаченного (ДР-1) — для книги духа: у отряда это ровно то, что ушло из кошеля на жалованье.
    pay.paid = (pay.paid ?? 0) + paid;
  }
  // Долг гасится из того, что осталось в кошеле: жалованье первым, долг вторым.
  if (pay.debt > 0 && r.purse > 0) {
    const back = Math.min(r.purse, pay.debt);
    r.purse -= back;
    pay.debt -= back;
  }
  if (pay.debt < 1e-6) pay.debt = 0;

  const { share, hungry, owed } = splitShare(bandUnpaid(pay.debt, due), unfed);
  if (pay.debt === 0 && unfed <= 0) {
    pay.late = 0;
    return;
  }
  pay.late += dt;
  if (share <= 0 || pay.late < bandPatienceDays(r.hero.war) * DAY_LENGTH) return;

  pay.starved ??= {};
  for (const id of TROOP_IDS) {
    const have = Math.max(0, r.band[id] ?? 0);
    if (have <= 0) {
      delete pay.gone[id];
      delete pay.starved[id];
      continue;
    }
    const byFood = draw(pay.starved, id, have, have, desertRate(hungry, dt));
    const byPay = draw(pay.gone, id, have, have - byFood, desertRate(owed, dt));
    const whole = byFood + byPay;
    if (whole <= 0) continue;
    if (have - whole > 0) r.band[id] = have - whole;
    else delete r.band[id];
    const one = TROOP_BY_ID[id].one;
    for (let i = 0; i < byPay; i++) log(s, BAND_TEXT.left(one, UPKEEP_TEXT.why.pay), 'bad', `band:desert:${id}`);
    for (let i = 0; i < byFood; i++) log(s, BAND_TEXT.left(one, UPKEEP_TEXT.why.food), 'bad', `band:desert:${id}:food`);
  }
  // Раненые едят тот же паёк и при голоде уходят той же долей — всегда голодом и совсем.
  if (unfed > 0) {
    pay.hurt ??= {};
    starve(woundedOf(r), pay.hurt, desertRate(unfed, dt), (id, n) => loseBandWounded(s, id, n), (id) => {
      log(s, BAND_TEXT.woundedStarved(TROOP_BY_ID[id].one), 'bad', `band:starve:${id}`);
    });
  }
  // Ушедшие уносят свою долю долга: дохода нет, и долг убывает той же долей, что жалованье.
  if (pay.debt > 0 && due > 0) {
    pay.debt *= bandWagesPerDay(r.band, mode) / due;
    if (pay.debt < 1e-6) pay.debt = 0;
  }
}
