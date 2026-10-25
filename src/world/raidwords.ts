// Слова о наших людях, которых уводит прорвавшийся набег (АУ-8, п. 5; OWNER-DECISIONS п. 18): одна строка на «Походы»,
// карточку отряда и донесение о прорыве. Числа — мира: сколько ведут (`MarchView.taking`) и когда дойдут (`arriveAt`).
import { formatLeft, secondsLeft } from './geo';
import { plural } from '../ui/parts/plural';

/** «Уводят N пленных» — сколько наших ведёт отряд: пленные под выкуп и уведённые невольниками и горожанами. */
export const takingWords = (n: number): string => `Уводят ${n} ${plural(n, 'пленного', 'пленных', 'пленных')}`;

/** «Уводят N пленных, дойдут через X» — строка отряда, идущего домой с нашими людьми; не ведёт никого — пусто. */
export function takingLine(m: { taking?: number; arriveAt: number }, now: number): string {
  if (!m.taking) return '';
  return `${takingWords(m.taking)}, дойдут через ${formatLeft(secondsLeft(m.arriveAt, now))}`;
}
