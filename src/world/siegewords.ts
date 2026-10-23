// Хлеб осады словами (ОС-1, docs/siege_v2.md, раздел 23) — штраф к добыче, соотношение сил и срок хлеба. Числа — функциями
// двери хлеба (`siegefood.siegeCut`, `yieldShare`) и кольца (`blockade.ratioWords`), своей арифметики здесь нет (правило 18).
// Отдельным модулем от правил: слова читают окно защитника (кусок нового вида) и консоль, а правила едут с миром в первой
// загрузке. Без `@/`, как и сама дверь.
import { realSpan } from '../game/span';
import { ratioWords } from './blockade';
import { siegeCut, yieldShare } from './siegefood';

/** Соотношение сил словами: «лагерь слабее гарнизона (×0,8)», «силы равны (×1)», «лагерь сильнее гарнизона (×1,6)». */
export function ratioReason(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'гарнизона за воротами нет';
  const r = Math.round(ratio * 10) / 10;
  if (r < 1) return `лагерь слабее гарнизона (${ratioWords(ratio)})`;
  if (r > 1) return `лагерь сильнее гарнизона (${ratioWords(ratio)})`;
  return `силы равны (${ratioWords(ratio)})`;
}

/** Соотношение сил коротко — строкой окна: «слабее, ×0,7», «вровень, ×1», «сильнее, ×1,6»; гарнизона нет — «гарнизона нет». */
export function ratioShort(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'гарнизона нет';
  const r = Math.round(ratio * 10) / 10;
  return `${r < 1 ? 'слабее' : r > 1 ? 'сильнее' : 'вровень'}, ${ratioWords(ratio)}`;
}

/**
 * Соотношение по штрафу коротко (ОС-1б, окно лагеря): внутри кривой — как `ratioShort`, за краями — граница: «сильнее, ×1,5 и
 * больше», «слабее, ×0,7 и меньше» (`siegefood.ratioOfCut`).
 */
export function ratioBound(ratio: number, bound?: 'min' | 'max'): string {
  if (bound === 'min') return `сильнее, ${ratioWords(ratio)} и больше`;
  if (bound === 'max') return `слабее, ${ratioWords(ratio)} и меньше`;
  return ratioShort(ratio);
}

/** Доля лагеря за фазу коротко: «~4 % за фазу» (`siegeroll.wasteOf`). */
export const meltShort = (waste: number): string => `~${Math.round(waste * 100)} % за фазу`;

/** Штраф к хлебу коротко — строкой окна: «−86 %». */
export const cutFood = (cut: number): string => `−${Math.round((1 - yieldShare(cut, true)) * 100)} %`;

/** Штраф коротко: «хлеб −86 %, прочее −64 %». */
export function cutShort(cut: number): string {
  const food = Math.round((1 - yieldShare(cut, true)) * 100);
  const other = Math.round((1 - yieldShare(cut, false)) * 100);
  return `хлеб −${food} %, прочее −${other} %`;
}

/** Штраф словами: «Добыча: хлеб −86 %, прочее −64 % — силы равны (×1).». */
export const cutWords = (ratio: number): string => `Добыча: ${cutShort(siegeCut(ratio))} — ${ratioReason(ratio)}.`;

/**
 * Срок хлеба коротко — для сведения: «~6 ч 30 мин», «меньше получаса», «не кончится». `realSec` — настоящие секунды до пустого
 * склада (бесконечность — не опустеет). Настоящим временем (`game/span.realSpan`), с точностью до получаса: прогноз, а не
 * минута голода.
 */
export function breadSpan(realSec: number): string {
  if (!Number.isFinite(realSec)) return 'не кончится';
  if (realSec < 1800) return 'меньше получаса';
  return `~${realSpan(Math.round(realSec / 1800) * 1800)}`;
}

/** Сколько хлеба хватит, словами: «Хлеба хватит на ~6 ч 30 мин.», «Хлеба хватает: поля кормят город.». */
export function breadWords(realSec: number): string {
  if (!Number.isFinite(realSec)) return 'Хлеба хватает: поля кормят город.';
  if (realSec < 1800) return 'Хлеба хватит меньше чем на полчаса.';
  return `Хлеба хватит на ${breadSpan(realSec)}.`;
}
