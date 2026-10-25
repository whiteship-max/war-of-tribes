// Вызов к воротам — дверь племени к бою события у своих ворот (docs/battle_eu4.md, 14.28; слово владельца: бой считает
// мир той же дверью, что бой у стены, и исход приходит отчётом в «Походы»).
//
// Событие (волки, разбойники; мятежники — `sim/stability`) кладёт вызов ответом или молчанием (`callGate`); слепок везёт
// вызов миру без трофеев (`gateCalls`); мир бьётся на ближайшем пульсе и возвращает последствие с отметкой вызова —
// павших, мораль, славу и унесённое — и список посчитанных вызовов. Здесь при победе выдаются трофеи события (`settleGate`), а снимаются вызовы
// одним путём — по списку мира (`dropGates`): он называет и посчитанные в этот пульс, и те, чьё последствие потерялось.
import type { GameState, ResourceId, TribeGate } from '../types';
import type { GateCall, GateFoe, HomeEffect } from '@/world/types';
import { GATE_FOES } from '@/world/data/gate';
import { addStock, stockWords, type Gains } from './stock';
import { roll } from './roll';
import { log } from './log';
import { rebelsSettled } from './stability';

/**
 * Положить вызов к воротам. Сид боя — кость партии в эту минуту, номер — по счёту её бросков: бой повторяется из партии,
 * а не из часов мира, и тот же номер не выпадает дважды.
 */
export function callGate(s: GameState, foe: GateFoe, power: number, spoils: Partial<Record<ResourceId, number>>): TribeGate {
  const seed = Math.floor(roll(s) * 0x7fffffff);
  const call: TribeGate = { id: `gate-${s.rolls}`, foe, power, seed, spoils };
  s.gate = [...(s.gate ?? []), call];
  return call;
}

/** Вызовы для слепка мира — без трофеев: что даст победа, решает событие, а не мир. */
export const gateCalls = (s: GameState): GateCall[] =>
  (s.gate ?? []).map(({ id, foe, power, seed }) => ({ id, foe, power, seed }));

/**
 * Последствие вызова пришло: при победе — трофеи события, под потолок склада; победа над зверями засчитывается охотой,
 * как прежде. Павших, мораль и славу положило само последствие (`applyExpedition`), а снимет вызов список мира
 * (`dropGates`) в том же пульсе.
 */
export function settleGate(s: GameState, e: HomeEffect): void {
  const call = (s.gate ?? []).find((c) => c.id === e.gate);
  if (!call) return;
  // Мятежники у ворот: исход решает стабильность — подавлен мятеж или на стол ложатся условия (docs/stability.md, 2.4).
  if (call.foe === 'rebels') {
    rebelsSettled(s, e.battle === 'won');
    return;
  }
  if (e.battle !== 'won') return;
  const got: Gains = {};
  for (const [r, n] of Object.entries(call.spoils) as [ResourceId, number][]) got[r] = Math.round(addStock(s, r, n));
  if (GATE_FOES[call.foe].beasts) s.stats.hunts++;
  const words = stockWords(got);
  if (words) log(s, `Добыча у ворот: ${words}.`, 'good');
}

/** Мир посчитал эти вызовы — в этот пульс или раньше: что ещё лежит, снимается. */
export function dropGates(s: GameState, done: readonly string[] | undefined): void {
  if (!done || done.length === 0) return;
  s.gate = (s.gate ?? []).filter((c) => !done.includes(c.id));
}
