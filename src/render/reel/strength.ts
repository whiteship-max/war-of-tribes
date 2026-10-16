// Шкала сил ролика — сколько у каждой стороны в строю на секунде боя (docs/gfx.md, «Шкала сил»). Чистая, без three.
//
// Концы — итог ядра: на старте `total.initial`, к концу боя `total.final`, те же числа, что в отчёте и в карточке
// итога (CLAUDE.md, правило 18: своей арифметики у строки нет). Темп — журнал: потери по секторам на фазу
// (`PhaseSpan.bySector`), сложенные по стороне, — та же мерка, по которой в ролике падают фигуры; у записи без потерь
// по секторам — общий ход потерь стороны (`lossProgress`). Фазы пишут потери до десятых и отбрасывают малые, а итог
// считает остаток целыми по родам, поэтому журнал даёт долю пути, а приходит шкала туда же, куда отчёт.
import { lossProgress, sectorLost, type Cast } from '@/battle/replay';
import { SECTORS, type BattleResult, type Side } from '@/battle/types';

const SIDES: readonly Side[] = ['attacker', 'defender'];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Доля потерь стороны, случившихся к секунде раскадровки `c`: 0 — до первых потерь, 1 — все потери итога. */
export function lossShare(cast: Cast, side: Side, c: number): number {
  if (cast.detailed) {
    let all = 0;
    let done = 0;
    for (const s of SECTORS) {
      all += sectorLost(cast.spans, side, s, Infinity);
      done += sectorLost(cast.spans, side, s, c);
    }
    if (all > 0) return clamp01(done / all);
  }
  return lossProgress(cast.spans, side, c);
}

/** Сила стороны на секунде: сколько в строю, с какими начали и сколько пало к этой секунде. */
export interface SideStrength {
  /** В строю сейчас — целыми; на конце боя ровно `total.final` итога. */
  men: number;
  /** С какими начали — `total.initial`. */
  initial: number;
  /** Пало к этой секунде: `initial − men`. */
  lost: number;
}

/** Шкала сил на секунде раскадровки `c` (секунду ролика переводят часы, `clock.reelToCast`). */
export function strengthAt(cast: Cast, result: BattleResult, c: number): Record<Side, SideStrength> {
  const out = {} as Record<Side, SideStrength>;
  for (const side of SIDES) {
    const t = result.sides[side].total;
    const men = Math.round(t.initial - (t.initial - t.final) * lossShare(cast, side, c));
    out[side] = { men, initial: t.initial, lost: t.initial - men };
  }
  return out;
}

/** Доля наших в общей силе на поле, 0..1 — длина золотой части шкалы. Поле пусто — поровну. */
export function oursShare(s: Record<Side, SideStrength>, us: Side): number {
  const them: Side = us === 'attacker' ? 'defender' : 'attacker';
  const all = s[us].men + s[them].men;
  return all > 0 ? s[us].men / all : 0.5;
}
