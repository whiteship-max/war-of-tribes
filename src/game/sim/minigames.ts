// Промыслы: энергия, потолок добычи и начисление — одна дверь к полю `GameState.energyFull` (docs/minigames.md).
//
// ЭНЕРГИЯ — ЧИСТАЯ ФУНКЦИЯ ОТ ВРЕМЕНИ. В партии лежит одна отметка трат: когда запас снова будет полон, настоящими
// мс. Сколько энергии сейчас, выводится из неё на чтении; тика, таймера и догона нет, и сутки без игры считаются тем
// же выражением, что секунда. Время приходит доводом (`now`, `serverNow` у вызывающего): модуль часов не читает.
//
// ДОБЫЧА — ДОЛЯ ПОТОЛКА. Игра отдаёт долю собранного (`score`), дверь сжимает её в [0, 1] и множит на потолок; потолок
// — доля суточной выработки города в пропорции выработки двора, которому игра соответствует. Поэтому подделанный на
// клиенте итог даёт не больше потолка, а полный запас энергии — не больше `MINIGAME_SHARE` суточной выработки
// каждого запаса (тест-свойство, `minigames.test.ts`).
//
// ТРАТА — В НАЧАЛЕ ИГРЫ, ДОБЫЧА — В КОНЦЕ (решение владельца 04.10.2026). «Начать» списывает энергию и выдаёт поход
// (`beginMinigame`), итог кладёт добычу по походу и только один раз (`harvest`): без траты добычи не бывает, а ушедший
// посреди игры энергию потерял — и зайдёт в новую раскладку (зерно — от отметки, она сдвинулась), а не переиграет те же
// кусты наизусть. Поход в сохранение не едет: второго поля не нужно. Пишет поле только этот модуль.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { productionPerDay } from '../derived';
import { addStock, stockWords } from './stock';
import { gameDaysOfMs } from '../pace';
import { YARD_BY_JOB } from '../data/yards';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_BY_ID, MINIGAME_COST, MINIGAME_SHARE, MINIGAMES, type MinigameId } from '../data/minigames';
import { mixSeed } from './random';
import { log } from './log';

export type Haul = Partial<Record<ResourceId, number>>;

/** Когда запас полон, настоящие мс. Поля нет — полон с начала времён. */
const fullAt = (s: GameState): number => (typeof s.energyFull === 'number' && Number.isFinite(s.energyFull) ? s.energyFull : 0);

/** Сколько энергии сейчас: от нуля до `ENERGY_MAX`, дробью. Показывают её целой вниз (`energyShown`). */
export function energyAt(s: GameState, now: number): number {
  const short = fullAt(s) - now;
  if (!(short > 0)) return ENERGY_MAX;
  return ENERGY_MAX * Math.max(0, Math.min(1, 1 - short / ENERGY_REFILL));
}

/** Энергия числом на экране: целая вниз — обещать игру, которой ещё нет, нельзя. */
export const energyShown = (s: GameState, now: number): number => Math.floor(energyAt(s, now) + 1e-9);

/** Сколько настоящих мс до полного запаса; полон — ноль. */
export const energyFullIn = (s: GameState, now: number): number => Math.max(0, fullAt(s) - now);

/** Сколько настоящих мс до энергии на одну игру; хватает — ноль. */
export function energyReadyIn(s: GameState, now: number): number {
  const lack = MINIGAME_COST - energyAt(s, now);
  return lack > 1e-9 ? (lack / ENERGY_MAX) * ENERGY_REFILL : 0;
}

/** Хватает ли энергии на игру. Та же граница, что у отказа `beginMinigame`. */
export const canPlay = (s: GameState, now: number): boolean => energyReadyIn(s, now) === 0;

/**
 * Зерно игры: раскладка ягод и поведение скота выводятся из него (`src/minigames`). От сида партии, игры и отметки
 * трат: после каждой начатой игры раскладка новая — и у доигранной, и у брошенной посреди. Заходит в ту же только тот,
 * кто ушёл с карточки начала, не нажав «Начать»: он видел поле со старта, а не играл его.
 * Кость партии (`sim/roll`) не трогается: промысел не должен сдвигать события деревни.
 */
export function minigameSeed(s: GameState, id: MinigameId): number {
  const game = MINIGAMES.findIndex((g) => g.id === id);
  return mixSeed(mixSeed(s.seed >>> 0, game), Math.floor(fullAt(s) / 1000)) >>> 0;
}

/**
 * Доли запасов у игры — пропорция выработки её дела (`data/yards.ts`), в сумме единица. «Ягоды» — вся еда сбора
 * Охотничьего двора; «Скот» — еда и шкуры загона Фермы, как их даёт пастух.
 */
export function minigameShares(id: MinigameId): Haul {
  const yard = YARD_BY_JOB.get(MINIGAME_BY_ID[id].deed);
  if (!yard) throw new Error(`${id}: дела ${MINIGAME_BY_ID[id].deed} нет в YARDS`);
  const total = RESOURCE_IDS.reduce((n, r) => n + (yard.yield[r] ?? 0), 0);
  const out: Haul = {};
  for (const r of RESOURCE_IDS) {
    const y = yard.yield[r];
    if (y) out[r] = y / total;
  }
  return out;
}

/** Валовая выработка города за сутки — те же сутки, за которые копится энергия. */
export function dailyOutput(s: GameState): Record<ResourceId, number> {
  const perDay = productionPerDay(s);
  const days = gameDaysOfMs(ENERGY_REFILL);
  const out = {} as Record<ResourceId, number>;
  for (const r of RESOURCE_IDS) out[r] = Math.max(0, perDay[r]) * days;
  return out;
}

/**
 * Потолок игры: сколько она принесёт при полном счёте. Дробью — целой его делает начисление. Строка «до N»
 * в окне промыслов и в карточке начала считается этой же функцией (правило 18).
 */
export function minigameCap(s: GameState, id: MinigameId): Record<ResourceId, number> {
  const day = dailyOutput(s);
  const shares = minigameShares(id);
  const k = (MINIGAME_SHARE * MINIGAME_COST) / ENERGY_MAX;
  const out = {} as Record<ResourceId, number>;
  for (const r of RESOURCE_IDS) out[r] = k * day[r] * (shares[r] ?? 0);
  return out;
}

/** Доля собранного, как её примет начисление: [0, 1], мусор — ноль. Подделка итога упирается здесь. */
export const scoreOf = (score: number): number => (Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0);

/** Добыча при таком счёте — до склада: целыми вниз, нули опущены. */
export function minigameHaul(s: GameState, id: MinigameId, score: number): Haul {
  const cap = minigameCap(s, id);
  const q = scoreOf(score);
  const out: Haul = {};
  for (const r of RESOURCE_IDS) {
    const n = Math.floor(cap[r] * q + 1e-9);
    if (n > 0) out[r] = n;
  }
  return out;
}

export interface Harvest {
  /** Добыто по счёту. */
  got: Haul;
  /** Легло на склад — не выше вместимости. */
  stored: Haul;
  /** Энергия после траты, целой вниз. */
  energy: number;
}

/**
 * Начатая игра: энергия за неё списана, добыча ещё не легла. Выдаёт поход только `beginMinigame`, принимает `harvest`
 * — один раз. В сохранение не едет: закрывший игру посреди неё теряет энергию, а добычи не получает.
 */
export interface Outing {
  readonly id: MinigameId;
}

/** Выданные и ещё не засчитанные походы. Слабое множество: брошенный поход уходит вместе с экраном игры. */
const unpaid = new WeakSet<Outing>();

/** «Начать»: списать энергию и выдать поход. Энергии нет — отказ словами, и ничего не меняется. */
export function beginMinigame(s: GameState, id: MinigameId, now: number): Outing | string {
  if (!canPlay(s, now)) return 'Не хватает энергии';
  s.energyFull = Math.max(fullAt(s), now) + (MINIGAME_COST / ENERGY_MAX) * ENERGY_REFILL;
  const outing: Outing = { id };
  unpaid.add(outing);
  return outing;
}

/**
 * Итог игры: положить добычу похода на склад — один раз на поход. Чужой или засчитанный поход — отказ, и ничего не
 * меняется. Сверх вместимости на склад не ложится ничего — то же правило, что у выработки и возврата цены (`sim/pay`).
 */
export function harvest(s: GameState, outing: Outing, now: number, score: number): Harvest | string {
  if (!unpaid.delete(outing)) return 'Добыча уже засчитана';
  const id = outing.id;
  const got = minigameHaul(s, id, score);
  const stored: Haul = {};
  for (const r of RESOURCE_IDS) {
    const n = got[r];
    if (!n) continue;
    // Целыми, как их видит игрок: дробь, которую склад ещё вмещал, — не добыча.
    const before = Math.floor(s.resources[r]);
    addStock(s, r, n);
    const put = Math.floor(s.resources[r]) - before;
    if (put > 0) stored[r] = put;
  }
  const def = MINIGAME_BY_ID[id];
  // Счёт промыслов и их добычи — для наблюдения сервера (docs/admin.md): что легло на склад, а не что выиграно.
  s.stats.games = (s.stats.games ?? 0) + 1;
  s.stats.haul = (s.stats.haul ?? 0) + Object.values(stored).reduce((t, n) => t + (n ?? 0), 0);
  log(s, `Промысел «${def.name}»: ${stockWords(stored, '+') || 'склад полон'}.`, 'good');
  return { got, stored, energy: energyShown(s, now) };
}

/**
 * Код проверки «energy» (`src/cheats.ts`, только вне Telegram): запас снова полон. Отметку снимает эта же дверь —
 * поля нет, значит запас полон (`fullAt`).
 */
export function refillEnergy(s: GameState): void {
  delete s.energyFull;
}
