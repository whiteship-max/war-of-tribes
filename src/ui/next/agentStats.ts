// Характеристики агента числами для раздела «Агенты» Ратуши (АГ-1): у человека на месте — нынешние, у кандидата — те, с какими
// он встанет в этом городе (первый уровень, врождённое). Своих чисел нет: те же двери, что считают дело
// (`sim/agents.pipsOf`, `circlesOf`, `sabotageCirclesOf`, `agentrules.statCircles`).
import type { FigureId } from '@/world/types';
import type { GameState } from '@/game/types';
import { PIP_IDS, type PipId } from '@/battle';
import { ROLE_STATS, skillCircles, statCircles, type AgentStat, type Recruit } from '@/game/agentrules';
import { circlesOf, pipLevel, pipsAt, pipsOf, sabotageCirclesOf, seated } from '@/game/sim/agents';
import { PIP_WORD, STAT_WORD, type StatWord } from '@/game/data/agentWords';

/** Одна характеристика: ключ, слова и число. */
export interface StatValue {
  key: AgentStat | PipId;
  word: StatWord;
  value: number;
}

const pipRows = (pips: Partial<Record<PipId, number>>): StatValue[] =>
  PIP_IDS.map((k) => ({ key: k, word: PIP_WORD[k], value: pips[k] ?? 0 }));

/** Нынешние характеристики человека на месте; пустое место — ни одной. */
export function statsNow(s: GameState, role: FigureId): StatValue[] {
  if (!seated(s, role)) return [];
  if (role === 'general') return pipRows(pipsOf(s));
  return ROLE_STATS[role].map((stat) => {
    const value = stat === 'sabotage' ? sabotageCirclesOf(s) : circlesOf(s, role, stat as 'sight' | 'stealth' | 'eloquence');
    return { key: stat, word: STAT_WORD[stat as Exclude<AgentStat, 'pips'>], value };
  });
}

/** Характеристики кандидата в минуту найма в этом городе: первый уровень и врождённое. */
export function statsOfRecruit(s: GameState, r: Recruit): StatValue[] {
  if (r.role === 'general') return pipRows(pipsAt(s.seed, 0, pipLevel(skillCircles(1, r.head.pips ?? 0)), r.n));
  return ROLE_STATS[r.role].map((stat) => ({
    key: stat,
    word: STAT_WORD[stat as Exclude<AgentStat, 'pips'>],
    value: statCircles(stat, 1, r.head),
  }));
}
