import type { GameState } from '../types';
import { GATE_MORALE_LOST, GATE_MORALE_WON } from '@/world/data/tuning';
import { defense } from '../derived';
import { roll } from './roll';
import { famineToll, killPop } from './population';
import { log } from './log';
import { recordBattle, recordRaidLoss } from '@/profile/stats';

export interface BattleResult {
  won: boolean;
  text: string;
}

/**
 * Короткий автоматический бой: защита поселения против силы врага.
 * Потери и награды применяются к состоянию сразу.
 */
export function resolveBattle(s: GameState, enemyPower: number, enemyName: string): BattleResult {
  const ours = defense(s) * (0.85 + roll(s) * 0.3);
  const won = ours >= enemyPower;
  if (won) {
    recordBattle(s, 'won');
    s.prestige += 3;
    s.morale = Math.min(100, s.morale + GATE_MORALE_WON);
    const text = `Племя отбило нападение: ${enemyName}. Мораль выросла.`;
    log(s, text, 'good');
    return { won, text };
  }
  recordBattle(s, 'lost');
  s.morale = Math.max(0, s.morale - GATE_MORALE_LOST);
  const foodLost = Math.round(s.resources.food * 0.25);
  s.resources.food -= foodLost;
  recordRaidLoss(s, { food: foodLost });
  let text = `Не удалось сдержать: ${enemyName}. Потеряно ${foodLost} еды.`;
  // Проигранная стычка стоит людей — доли посёлка, а не одного безымянного жителя.
  const fallen = killPop(s, Math.ceil(famineToll(s) * (0.5 + roll(s))), 'бой');
  if (fallen > 0) text += ` Не вернулись из боя: ${fallen} чел.`;
  log(s, text, 'bad');
  return { won, text };
}
