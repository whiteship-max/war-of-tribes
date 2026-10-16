// Полоса ролика TW сверху, как полоса боя EU4 (docs/battle_tw.md, раздел 4): фаза с кругом и мораль армий на секунде
// раскадровки. Чистая, без three и без React: интерфейс (`ui/battle/TwReplay`) только раскладывает, что вернулось.
//
// Мораль — из журнала (`PhaseSpan.morale`, наблюдение ядра: мораль сторон к концу фазы), внутри фазы — прямой от
// предыдущей фазы к этой: ядро её не пишет по тикам, а полоса не досчитывает своего. Нет поля (запись старая) — морали
// нет, и полоса показывает только людей. Люди — у прежней раскадровки (`frameAt`), той же, что ведёт подпись.
import type { Cast, Span } from '@/battle/replay';
import { SECTORS, type BattleResult, type PhaseId, type PhaseSpan, type Side } from '@/battle/types';

export interface TwHud {
  /** Фаза журнала на этой секунде и круг (первый проход — 1). */
  phase: PhaseId;
  round: number;
  /** Мораль армий, 0..1 от полной морали этой армии (`fullMorale`); null — журнал её не знает. */
  morale: Record<Side, number | null>;
}

const SIDES: readonly Side[] = ['attacker', 'defender'];

/** Фаза итога под фазой раскадровки: одна и та же по тикам (`Span.from`, `Span.to`). */
const phaseOf = (result: BattleResult, span: Span): PhaseSpan | undefined =>
  result.phases.find((p) => p.from === span.from && p.to === span.to && p.phase === span.phase);

/**
 * Мораль стороны на входе в бой: та, с какой встали сектора (`SideResult.sectors[].start`), взвешенная людьми. Поля нет
 * (запись из сохранения мира его не несёт) — мораль к концу первой фазы.
 */
function startMorale(result: BattleResult, side: Side): number | null {
  const res = result.sides[side];
  let men = 0;
  let sum = 0;
  for (const s of SECTORS) {
    const cell = res.sectors[s];
    const n = Object.values(cell.initial).reduce((a, b) => a + b, 0);
    if (n <= 0 || cell.start === undefined) continue;
    men += n;
    sum += n * cell.start;
  }
  if (men > 0) return sum / men;
  return result.phases[0]?.morale?.[side] ?? null;
}

/**
 * Полная мораль армии — во что полоса упирается, как у EU4 (полоса — мораль к наибольшей морали армии): с какой моралью
 * армия встала бы в бой свежей — мораль на входе, делённая на долю усталости (`weary`: недавний бой, `ArmySetup.rest`).
 * Свежая армия начинает полной полосой, уставшая — неполной. Нет ничего — наибольшая мораль фаз.
 */
export function fullMorale(result: BattleResult, side: Side): number | null {
  const start = startMorale(result, side) ?? Math.max(0, ...result.phases.map((p) => p.morale?.[side] ?? 0));
  if (!(start > 0)) return null;
  const weary = result.log.find((e) => e.id === 'weary' && e.side === side);
  const rest = weary && weary.id === 'weary' && weary.rest > 0 ? weary.rest : 1;
  return start / rest;
}

/** Полоса на секунде раскадровки `t`. */
export function hudAt(cast: Cast, result: BattleResult, t: number): TwHud {
  const spans = cast.spans;
  let j = spans.findIndex((s) => t >= s.t0 && t <= s.t1);
  if (j < 0) j = t < (spans[0]?.t0 ?? 0) ? 0 : spans.length - 1;
  const span = spans[j];
  const now = span ? phaseOf(result, span) : undefined;
  const before = j > 0 ? phaseOf(result, spans[j - 1]) : undefined;
  const u = span && span.t1 > span.t0 ? Math.max(0, Math.min(1, (t - span.t0) / (span.t1 - span.t0))) : 1;
  const morale = {} as Record<Side, number | null>;
  for (const side of SIDES) {
    const to = now?.morale?.[side];
    if (to === undefined) {
      morale[side] = null;
      continue;
    }
    const from = before?.morale?.[side] ?? (j === 0 ? startMorale(result, side) : null) ?? to;
    const full = fullMorale(result, side) ?? 1;
    morale[side] = Math.max(0, Math.min(1, (from + (to - from) * u) / full));
  }
  return { phase: span?.phase ?? 'ranged', round: now?.round ?? 1, morale };
}
