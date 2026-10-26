/**
 * Дух дружины глазами прибора (ДР-1, docs/siege_v2.md, 24.1): с какой моралью и дисциплиной наша сторона вошла в бой и какие
 * причины их сложили. Дух — слепок перед пульсом (`autopilot.Watch.profile`): тот же, что мост везёт в мир
 * (`PlayerProfile.spirit`), а строки причин — та же дверь `sim/spirit.spiritView`, из которой он сложен. Прибор не считает
 * ничего своего.
 */
import type { SpiritLineId, SpiritView } from '@/game/spiritrules';
import type { Spirit } from '@/battle';
import type { Front } from './front';

/** Причина: что она дала морали и дисциплине на входе в бой. */
export type SpiritLines = Partial<Record<SpiritLineId, { morale: number; discipline: number }>>;

/** Один бой: вид отчёта, бой ли у ворот по событию, дух нашей стороны на входе и его причины. */
export interface Spirited {
  kind: string;
  gate: boolean;
  morale: number;
  discipline: number;
  /** Потолок шкал — основа и причины строками, без жалованья и терпения (`spiritrules.axisOf`): то, что задают веса причин. */
  moraleCeil: number;
  disciplineCeil: number;
  lines: SpiritLines;
}

/** Строки «что влияет» обеих шкал одной таблицей: причина — мораль и дисциплина. */
export function linesOf(v: SpiritView): SpiritLines {
  const out: SpiritLines = {};
  for (const [axis, lines] of [['morale', v.morale.lines], ['discipline', v.discipline.lines]] as const) {
    for (const l of lines) {
      const row = (out[l.id] ??= { morale: 0, discipline: 0 });
      row[axis] += l.value;
    }
  }
  return out;
}

/** Бои пульса (записи боя — те же, что у «Ширины поля») с духом, который ушёл в этот пульс. */
export const spiritedOf = (fronts: readonly Front[], spirit: Spirit, view: SpiritView): Spirited[] =>
  fronts.map((f) => ({
    kind: f.kind,
    gate: f.gate,
    morale: spirit.morale,
    discipline: spirit.discipline,
    moraleCeil: view.morale.ceil,
    disciplineCeil: view.discipline.ceil,
    lines: linesOf(view),
  }));
