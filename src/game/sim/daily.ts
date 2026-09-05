// Ежедневное задание: попытка, исход и награда.
//
// Календарный день сюда приходит числом, а не читается часами: симуляция
// остаётся чистой функцией от состояния, `tick` про ежедневку не знает вовсе, а
// тесты обходятся без подмены глобального времени.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { DAILY_GAME_BY_ID, dailyGameOf, dailySeed, type DailyGameId } from '../data/daily';
import { population, storageCap } from '../derived';
import { log } from './log';

/** Посёлок, под который писались базовые числа наград, — тот же, что у событий. */
const REFERENCE_POP = 30;

/**
 * Потолок одной награды — доля вместимости склада. Он не про баланс, а про
 * нелепость: посёлок, где людей много, а склада нет, не должен получать за
 * минуту игры больше, чем в этот склад влезает.
 */
export const DAILY_CAP_SHARE = 0.15;

/** Что с ежедневкой на этот календарный день. */
export interface DailyStatus {
  day: number;
  game: DailyGameId;
  /** Сид задания: из него выводятся мишень, составы и лабиринт. */
  seed: number;
  /** Попытка на сегодня уже потрачена — начали играть. */
  played: boolean;
  /** Сегодня выиграли, награда выдана. */
  won: boolean;
}

export function dailyStatus(s: GameState, day: number): DailyStatus {
  // Запись за другой день просрочена: попытка снова есть.
  const today = s.daily.day === day ? s.daily.result : 'none';
  return {
    day,
    game: dailyGameOf(day),
    seed: dailySeed(day),
    played: today !== 'none',
    won: today === 'won',
  };
}

/**
 * Награда под нынешний размер посёлка. Считается так же, как всё, что дают и
 * отнимают события: долей от того, во сколько раз племя больше стартовых
 * тридцати. Иначе к середине партии «+90 еды» тонет в дневной выработке, и
 * ежедневка перестаёт быть поводом зайти.
 *
 * Ресурсы и только они. Ни золота, ни алмазов: золото — рычаг ратуши и замков,
 * а алмазы начисляет единственная дверь `creditGems`, ждущая сервера. Тип
 * возвращаемого значения физически не может нести ни то, ни другое.
 */
export function dailyReward(s: GameState, game: DailyGameId): Partial<Record<ResourceId, number>> {
  const k = Math.max(1, population(s) / REFERENCE_POP);
  const cap = Math.floor(storageCap(s) * DAILY_CAP_SHARE);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) {
    const base = DAILY_GAME_BY_ID[game].reward[r];
    if (!base) continue;
    out[r] = Math.max(1, Math.min(Math.round(base * k), cap));
  }
  return out;
}

/**
 * Игрок берётся за сегодняшнее задание. Попытка тратится здесь, а не на победе,
 * и записывается сразу как проигранная: уйти с экрана посреди лабиринта и зайти
 * заново — это и есть вторая попытка, а её быть не должно. Победа потом поднимет
 * запись до выигранной.
 */
export function startDaily(s: GameState, day: number): string | null {
  const st = dailyStatus(s, day);
  if (st.played) return st.won ? 'Сегодняшнее задание уже выполнено.' : 'Попытка на сегодня потрачена.';
  s.daily = { day, result: 'lost' };
  return null;
}

/**
 * Итог попытки. Победа кладёт награду на склад, поражение только закрывает день:
 * повтора сегодня нет, в этом и весь вес одной попытки.
 *
 * Кнопке здесь не верят: без начатой попытки итог не принимается, и второй раз
 * за день выиграть нельзя, сколько ни перезагружай страницу.
 */
export function finishDaily(s: GameState, day: number, won: boolean): string | null {
  if (s.daily.day !== day || s.daily.result === 'none') return 'Задание на сегодня не начато.';
  if (s.daily.result === 'won') return 'Сегодняшнее задание уже выполнено.';
  const game = dailyGameOf(day);
  const def = DAILY_GAME_BY_ID[game];
  if (!won) {
    log(s, `${def.icon} ${def.name}: не вышло. Следующая попытка — завтра.`);
    return null;
  }

  s.daily = { day, result: 'won' };
  s.stats.dailyWins++;
  const reward = dailyReward(s, game);
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = reward[r];
    if (n) s.resources[r] = Math.min(cap, s.resources[r] + n);
  }
  log(s, `${def.icon} ${def.name}: задание дня выполнено. Награда на складе.`, 'good');
  return null;
}
