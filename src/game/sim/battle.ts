import type { GameState } from '../types';
import { defense } from '../derived';
import { chance, rnd } from './random';
import { killRandomVillager } from './population';
import { log } from './log';

export interface BattleResult {
  won: boolean;
  text: string;
}

/**
 * Короткий автоматический бой: защита поселения против силы врага.
 * Потери и награды применяются к состоянию сразу.
 */
export function resolveBattle(s: GameState, enemyPower: number, enemyName: string): BattleResult {
  const ours = defense(s) * (0.85 + rnd() * 0.3);
  const won = ours >= enemyPower;
  if (won) {
    s.stats.battlesWon++;
    s.prestige += 3;
    s.morale = Math.min(100, s.morale + 5);
    const text = `Племя отбило нападение: ${enemyName}. Мораль выросла.`;
    log(s, text, 'good');
    return { won, text };
  }
  s.stats.battlesLost++;
  s.morale = Math.max(0, s.morale - 12);
  const foodLost = Math.round(s.resources.food * 0.25);
  s.resources.food -= foodLost;
  let text = `Не удалось сдержать: ${enemyName}. Потеряно ${foodLost} еды.`;
  if (s.villagers.length > 2 && chance(0.35)) {
    const v = killRandomVillager(s, 'бой');
    if (v) text += ` ${v.name} не вернулся из боя.`;
  }
  log(s, text, 'bad');
  return { won, text };
}
