/**
 * Мораль между боями глазами прибора (docs/battle_eu4.md, 14.30–14.31): с какой долей полной морали каждая сторона
 * вошла в бой и вышла из него. Входит — событие журнала «вышли уставшими» (`weary`, его пишет ядро, когда доля меньше
 * полной); выходит — `SideResult.rest`. Всё из записи боя в отчётах пульса: прибор не считает ничего своего.
 */
import type { Side } from '@/battle';
import type { WorldPulse } from '@/world/types';
import { gateReportId } from '@/world/data/gate';

/** Один бой: вид отчёта, бой ли у ворот по событию, наша сторона — с чем вошли и вышли обе. */
export interface Rested {
  kind: string;
  gate: boolean;
  won: boolean;
  inUs: number;
  inFoe: number;
  outUs: number;
  outFoe: number;
}

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

export function pulseRests(pulse: Pick<WorldPulse, 'reports' | 'effects'>): Rested[] {
  const gates = new Set(pulse.effects.flatMap((e) => (e.gate ? [gateReportId(e.gate)] : [])));
  return pulse.reports.flatMap((r) => {
    const rec = r.battle;
    if (!rec) return [];
    const us = rec.us;
    const entry = (side: Side): number => {
      const e = rec.result.log.find((x) => x.id === 'weary' && x.side === side);
      return e && e.id === 'weary' ? e.rest : 1;
    };
    return [
      {
        kind: r.kind,
        gate: gates.has(r.id),
        won: rec.result.winner === us,
        inUs: entry(us),
        inFoe: entry(other(us)),
        outUs: rec.result.sides[us].rest ?? 1,
        outFoe: rec.result.sides[other(us)].rest ?? 1,
      },
    ];
  });
}
