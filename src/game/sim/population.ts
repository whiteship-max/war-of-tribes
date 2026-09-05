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
  foodConsumptionPerDay,
  freeJobCount,
  housingCapacity,
  idleCount,
  rationOf,
  workerCount,
} from '../derived';
import type { SeasonModifiers } from '../data/seasons';
import { log } from './log';

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
    const staffed = s.buildings
      .filter((b) => workerCount(s, b.id) > 0)
      .sort((a, b) => workerCount(s, b.id) - workerCount(s, a.id));
    if (staffed.length === 0) break;
    const b = staffed[0];
    s.workers[b.id] = workerCount(s, b.id) - 1;
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
    log(s, `Племя потеряло ${gone} чел.: ${reason}.`, 'bad');
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
  const cap = housingCapacity(s);
  const room = Math.max(0, cap - s.pop);
  const housing = Math.max(0, Math.min(1, room / GROWTH_ROOM));
  const eat = foodConsumptionPerDay(s, mods);
  const foodDays = s.resources.food / Math.max(1, eat);
  const food = Math.max(0, Math.min(1, foodDays / GROWTH_FOOD_DAYS));
  const ration = rationOf(s).growth;
  const base = POP_GROWTH_PER_DAY * (s.pop + POP_GROWTH_BASE);

  // Люди уходят вне зависимости от жилья и запасов: их держит не крыша, а вождь.
  if (morale < 0) {
    return { perDay: base * morale, morale, housing, food, blocked: 'Мораль слишком низкая — люди уходят.' };
  }
  const perDay = base * morale * housing * food * ration;
  let blocked: string | null = null;
  if (ration <= 0) blocked = 'На скудном пайке племя не растёт.';
  else if (housing <= 0) blocked = 'Нет свободного жилья.';
  else if (food <= 0.01) blocked = 'Нет запаса еды.';
  else if (morale <= 0.01) blocked = 'Мораль слишком низкая.';
  return { perDay, morale, housing, food, blocked };
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
 * а не на каждого человека: в посёлке на семьсот душ поимённые строки были бы шумом.
 */
export function logPopDay(s: GameState): void {
  const delta = s.pop - s.popDay;
  s.popDay = s.pop;
  if (delta > 0) log(s, `В племя пришло ${delta} чел. Всего ${s.pop}.`, 'good');
  else if (delta < 0) log(s, `Племя убыло на ${-delta} чел. Осталось ${s.pop}.`, 'bad');
}
