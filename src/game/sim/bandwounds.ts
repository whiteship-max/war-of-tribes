// Раненые отряда бродяги (ПН-1, ГДД 3.3.1) — половина двери раненых `sim/infirmary` без лазарета. Своим модулем (ПН-5, хвост а):
// его читает только Путь меча, а он докачивается тому, кому открыт (`game/roamlazy`), — в первую загрузку игрока он не едет.
// Раскладка «встать в строй» и «снять голодом» — общие с лазаретом города (`infirmary.rise`, `takeWounded`): правило одно.
//
// Лазарета у бродяги нет (ГДД 3.3.1): раненые лежат при отряде — мест не занимают и не ограничены местами, встают через тот же
// срок `WOUND_DAYS`, едят тот же паёк и при голоде уходят той же дверью содержания (вход «отряд» двери содержания, `sim/bandkeep.bandUpkeep`) — всегда голодом и
// совсем. Сколько павших ранено без лазарета, решает бой отряда (ПН-5) — сюда он кладёт уже раненых.

import type { GameState, TroopId } from '../types';
import { DAY_LENGTH, WOUND_DAYS } from '../constants';
import { TROOP_IDS } from '../data/troops';
import { troopTotal } from '../battle/kinds';
import { rise, takeWounded } from './infirmary';

/** Уложить раненых при отряде: срок `WOUND_DAYS` с этой минуты, мест не нужно. Возвращает, сколько легло. */
export function layBandWounds(s: GameState, wounded: Partial<Record<TroopId, number>>): number {
  const r = s.roam;
  if (!r) return 0;
  const troops: Partial<Record<TroopId, number>> = {};
  for (const id of TROOP_IDS) {
    const n = Math.max(0, Math.floor(wounded[id] ?? 0));
    if (n > 0) troops[id] = n;
  }
  const n = troopTotal(troops);
  if (n > 0) r.wounded.push({ troops, until: s.time + WOUND_DAYS * DAY_LENGTH });
  return n;
}

/**
 * Раненые отряда поправляются быстрее часов (ПН-3, открытый лагерь — ГДД 3.5.3): срок каждой группы, ещё не наступивший,
 * подходит на `ahead` игровых секунд. Встают они потом тем же шагом (`settleBandWounds`), а не здесь.
 */
export function hastenBandWounds(s: GameState, ahead: number): void {
  const r = s.roam;
  if (!r || !(ahead > 0)) return;
  for (const g of r.wounded) if (g.until !== null && g.until > s.time) g.until = Math.max(s.time, g.until - ahead);
}

/** Шаг отряда: чей срок прошёл — встают в строй отряда. Возвращает, сколько встало. */
export function settleBandWounds(s: GameState): number {
  const r = s.roam;
  if (!r || r.wounded.length === 0) return 0;
  const { keep, back } = rise(s, r.wounded, r.band, (one) => `Раненый встал в строй отряда: ${one}.`, (id) => `wound:band:${id}`);
  r.wounded = keep;
  return back;
}

/** Снять `n` раненых отряда вида `id` — голодом, совсем. Возвращает, сколько снято. */
export function loseBandWounded(s: GameState, id: TroopId, n: number): number {
  const r = s.roam;
  if (!r) return 0;
  const { keep, gone } = takeWounded(r.wounded, id, n);
  r.wounded = keep;
  return gone;
}
