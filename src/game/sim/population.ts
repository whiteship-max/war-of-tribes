// Население. Поимённых жителей с именем, возрастом, полом и талантом в игре нет:
// племя — это число. Рождений и смертей от старости нет тоже — вместо них прирост,
// который зависит от свободного жилья, запаса еды и морали.
//
// Мораль здесь главная: ниже `MORALE_GROWTH_ZERO` прирост уходит в минус и племя
// разбегается. Поэтому рацион, указ и налог из ратуши видны не только в
// выработке, но и в том, сколько народу в посёлке.
import type { GameState } from '../types';
import {
  DAY_LENGTH,
  FAMINE_TOLL,
  GROWTH_FOOD_DAYS,
  GROWTH_ROOM,
  MORALE_GROWTH_FULL,
  MORALE_GROWTH_ZERO,
  POP_GROWTH_BASE,
  POP_GROWTH_PER_DAY,
} from '../constants';
import { FREE_JOBS } from '../data/jobs';
import {
  bondedIdle,
  bondedTotal,
  deedBonded,
  deedWorkers,
  estateGrowthMult,
  faithTilt,
  foodConsumptionPerDay,
  freeJobCount,
  housingCapacity,
  idleCount,
  rationOf,
} from '../derived';
import type { SeasonModifiers } from '../data/seasons';
import { log } from './log';
import { staffedDeeds } from './workers';

/** Прибавляет людей в посёлок. Возвращает, сколько прибавилось. */
export function addPop(s: GameState, n: number): number {
  const add = Math.max(0, Math.round(n));
  if (add > 0) s.pop += add;
  return add;
}

/**
 * Забирает людей из посёлка. Первыми уходят свободные руки, потом вольный сбор,
 * последними — рабочие зданий, и там с самого многолюдного: посёлок не должен
 * разом остаться без единственного кузнеца.
 */
export function losePop(s: GameState, n: number): number {
  let left = Math.min(Math.max(0, Math.round(n)), s.pop);
  const gone = left;
  s.pop -= left;

  left -= Math.min(left, idleCount(s));
  if (left <= 0) return gone;

  for (const job of FREE_JOBS) {
    if (left <= 0) break;
    const have = freeJobCount(s, job);
    const take = Math.min(have, left);
    if (take > 0) {
      s.freeJobs[job] = have - take;
      left -= take;
    }
  }
  while (left > 0) {
    const job = staffedDeeds(s, (j) => deedWorkers(s, j))[0];
    if (!job) break;
    s.workers[job] = deedWorkers(s, job) - 1;
    left -= 1;
  }
  return gone;
}

// ---------- Невольники ----------
//
// Прибавляются и убывают тем же порядком, что жители: число, а не список, и
// убыль снимается сначала с тех, кто без места, потом с самого многолюдного
// здания. Прироста у невольников нет — ни рождений, ни ухода от низкой морали:
// они приходят с рынка и из павших городов, а уходят проданными, отпущенными,
// уведёнными и при мятеже.

/** Прибавляет невольников в посёлок. Без места они встают на стройку. */
export function addBonded(s: GameState, n: number): number {
  const add = Math.max(0, Math.round(n));
  if (add > 0) s.bonded = bondedTotal(s) + add;
  return add;
}

/**
 * Убирает невольников из посёлка. Первыми уходят те, кто на стройке, потом с
 * мест — с самого многолюдного дела: так уведённые не оставляют одну
 * каменоломню пустой, пока в поле толпа.
 */
export function loseBonded(s: GameState, n: number): number {
  let left = Math.min(Math.max(0, Math.round(n)), bondedTotal(s));
  const gone = left;
  // Сначала — без места: их с места снимать не надо.
  left -= Math.min(left, bondedIdle(s));
  s.bonded = bondedTotal(s) - gone;
  while (left > 0) {
    const job = staffedDeeds(s, (j) => deedBonded(s, j))[0];
    if (!job) break;
    const next = deedBonded(s, job) - 1;
    if (next > 0) s.bondedWork[job] = next;
    else delete s.bondedWork[job];
    left -= 1;
  }
  return gone;
}

/** Сколько человек забирает один удар голода или холода: доля от посёлка. */
export const famineToll = (s: GameState): number =>
  Math.max(1, Math.round(s.pop * FAMINE_TOLL));

/** Убыль от голода, холода или боя. Пишет причину в летопись. */
export function killPop(s: GameState, n: number, reason: string): number {
  // Племя не вымирает целиком: последний человек не уходит никогда.
  const gone = losePop(s, Math.min(n, Math.max(0, s.pop - 1)));
  if (gone > 0) {
    s.stats.died += gone;
    log(s, `Жителей стало меньше на ${gone}: ${reason}.`, 'bad');
  }
  return gone;
}

// ---------- Прирост ----------

/** Множитель морали для прироста: −1 при полном унынии, +1 при полном довольстве. */
export function moraleGrowthFactor(morale: number): number {
  const k = (morale - MORALE_GROWTH_ZERO) / (MORALE_GROWTH_FULL - MORALE_GROWTH_ZERO);
  return Math.max(-1, Math.min(1, k));
}

export interface GrowthInfo {
  /** Сколько человек прибавится (или убудет) за игровой день. */
  perDay: number;
  /** Составляющие — их же показывает панель, чтобы игрок видел, что мешает. */
  morale: number;
  housing: number;
  food: number;
  /**
   * Прибавка от веры, множителем и **не меньше единицы**. Стоит отдельно от
   * трёх остальных нарочно: те трое режут прирост и потому спорят за звание
   * узкого места, а этот только добавляет — поставь его в тот же ряд, и панель
   * начала бы называть узким местом веру, которая ничего не тормозит.
   */
  faith: number;
  /**
   * Сословия (РТ-2): крестьянство в силе прибавляет рождений, рыцарство — отнимает (`derived.estateGrowthMult`); единица —
   * сословия прироста не трогают. Как вера — только у прироста, не у ухода.
   */
  estates: number;
  /**
   * Основа — прирост без множителей: от числа жителей (`POP_GROWTH_PER_DAY`). `perDay` — она под множителями, и разбор «в
   * день» жителей (`ui/next/hudTips`) пишет каждый множитель тем, что он прибавил к набранному.
   */
  base: number;
  /** Множитель пайка (`RationDef.growth`): скудный паёк гасит рождения. */
  ration: number;
  /** Что именно упирается; null — ничто. */
  blocked: string | null;
}

/**
 * Прирост населения за игровой день. Считается из трёх множителей и рациона:
 * свободное жильё, запас еды и мораль. Мораль единственная умеет уйти в минус —
 * из недовольного племени люди уходят сами.
 */
export function popGrowth(s: GameState, mods?: SeasonModifiers): GrowthInfo {
  const morale = moraleGrowthFactor(s.morale);
  // Вера прибавляет к приросту, а не режет его: закят держит бедных на ногах,
  // и детей в такой деревне доживает больше. Единица — вера прироста не трогает.
  const faith = 1 + Math.max(0, faithTilt(s).growth);
  const cap = housingCapacity(s);
  const room = Math.max(0, cap - s.pop);
  const housing = Math.max(0, Math.min(1, room / GROWTH_ROOM));
  const eat = foodConsumptionPerDay(s, mods);
  const foodDays = s.resources.food / Math.max(1, eat);
  const food = Math.max(0, Math.min(1, foodDays / GROWTH_FOOD_DAYS));
  const ration = rationOf(s).growth;
  const estates = estateGrowthMult(s);
  const base = POP_GROWTH_PER_DAY * (s.pop + POP_GROWTH_BASE);

  // Люди уходят вне зависимости от жилья и запасов: их держит не крыша, а вождь.
  if (morale < 0) {
    // Уходящих вера не удерживает: она прибавляет к росту, а не гасит убыль, —
    // иначе высокий храм отменял бы цену низкой морали.
    return { perDay: base * morale, morale, housing, food, faith, estates, base, ration, blocked: 'Мораль слишком низкая, жители уходят.' };
  }
  const perDay = base * morale * housing * food * ration * faith * estates;
  let blocked: string | null = null;
  if (ration <= 0) blocked = 'На скудном пайке город не растёт.';
  else if (housing <= 0) blocked = 'Нет свободного жилья.';
  else if (food <= 0.01) blocked = 'Нет запаса еды.';
  else if (morale <= 0.01) blocked = 'Мораль слишком низкая.';
  return { perDay, morale, housing, food, faith, estates, base, ration, blocked };
}

/** Шаг прироста: накапливает дробную часть, целые головы применяет сразу. */
export function growthTick(s: GameState, dt: number, mods?: SeasonModifiers): void {
  s.growth += (popGrowth(s, mods).perDay * dt) / DAY_LENGTH;
  if (s.growth >= 1) {
    const n = Math.floor(s.growth);
    s.growth -= n;
    s.stats.born += addPop(s, n);
  } else if (s.growth <= -1) {
    const n = Math.floor(-s.growth);
    s.growth += n;
    // Уходящие — не погибшие: летопись про них скажет отдельной строкой за день.
    s.stats.died += losePop(s, Math.min(n, Math.max(0, s.pop - 1)));
  }
}

/**
 * Строка летописи о том, как за день изменилось племя. Пишется раз в игровой день,
 * а не на каждого человека: в посёлке на сотни душ поимённые строки были бы шумом.
 */
export function logPopDay(s: GameState): void {
  const delta = s.pop - s.popDay;
  s.popDay = s.pop;
  if (delta > 0) log(s, `В городе прибыло жителей: ${delta}. Всего ${s.pop}.`, 'good');
  else if (delta < 0) log(s, `Город недосчитался жителей: ${-delta}. Осталось ${s.pop}.`, 'bad');
}
