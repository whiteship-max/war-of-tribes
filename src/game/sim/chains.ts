// Единственная дверь, откладывающая следствие ответа на потом (`GameState.chains`; docs/events.md, раздел 4).
//
// Ответ на весть иногда ведёт к следующей вести — купец вернётся за долгом, ил после разлива, вражда
// после неразобранного спора. Откладывается она в игровых сезонах: следствие идёт по часам племени,
// как и всё, что сравнивается с хозяйством. На стол её выкладывает почта (`sim/mail.mailArrive`)
// тем же правилом стола, что любую весть.
//
// Одна и та же цепочка дважды не откладывается: пока одно следствие ждёт, второе того же вида не
// ложится — иначе один долг пришёл бы взыскивать дважды (тест).
import type { GameState } from '../types';
import { SEASON_SECONDS } from '../data/seasons';

/** Отложить весть `defId` на `seasons` игровых сезонов. Возвращает, легла ли она. */
export function scheduleChain(s: GameState, defId: string, seasons: number): boolean {
  s.chains ??= [];
  if (s.chains.some((c) => c.defId === defId) || s.inbox.some((e) => e.defId === defId)) return false;
  s.chains.push({ defId, at: s.time + seasons * SEASON_SECONDS });
  return true;
}

/** Ждёт ли своего часа следствие этого вида — на столе или в отложенных. */
export const chainPending = (s: GameState, defId: string): boolean =>
  (s.chains ?? []).some((c) => c.defId === defId) || s.inbox.some((e) => e.defId === defId);
