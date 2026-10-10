// Что даёт указ и паёк — числами из полей их записи (правило 18). Подпись в данных (`effect`) говорит смысл словами;
// числа прежде стояли в ней руками («+10% ко всей выработке, −0.5 морали в день») и разошлись бы с полем при первой
// правке. Строку видно на кнопке указа и пайка в ратуше и под рядом вкладки «Указы» державы.
import type { DecreeDef, RationDef } from '@/game/data/policy';
import { signed } from './signed';
import { num } from '@/game/num';

/** Дробь — запятой (docs/ui_audit.md, 4.5). */
/** Множитель — процентом перемены: 1.1 → «+10%», 0.7 → «−30%». */
const pct = (mult: number): string => `${signed((mult - 1) * 100, 0)}%`;
const morale = (perDay: number): string => `мораль ${signed(perDay)} в день`;
const first = (parts: string[]): string | null =>
  parts.length === 0 ? null : parts.join(', ').replace(/^./, (c) => c.toUpperCase());

/** «Выработка +10%, мораль −0,5 в день»; указ без перемен — `null`, тогда говорит подпись записи. */
export function decreeNumbers(d: DecreeDef): string | null {
  const parts: string[] = [];
  if (d.output !== 1) parts.push(`выработка ${pct(d.output)}`);
  if (d.moralePerDay !== 0) parts.push(morale(d.moralePerDay));
  return first(parts);
}

/** «Еда −30%, мораль −0,6 в день, рождений нет»; паёк без перемен — `null`. */
export function rationNumbers(r: RationDef): string | null {
  const parts: string[] = [];
  if (r.food !== 1) parts.push(`еда ${pct(r.food)}`);
  if (r.moralePerDay !== 0) parts.push(morale(r.moralePerDay));
  if (r.growth === 0) parts.push('рождений нет');
  else if (r.growth !== 1) parts.push(`рождения ×${num(r.growth, 3)}`);
  return first(parts);
}

/**
 * Два слоя (docs/voice.md, 3): образ словами записи, за ним — числа. «Стража на улицах, работа от зари до зари.
 * Выработка +10%, мораль −0,5 в день». Без перемен — один образ.
 */
const both = (effect: string, numbers: string | null): string => (numbers ? `${effect}. ${numbers}` : effect);

export const decreeLine = (d: DecreeDef): string => both(d.effect, decreeNumbers(d));
export const rationLine = (r: RationDef): string => both(r.effect, rationNumbers(r));
