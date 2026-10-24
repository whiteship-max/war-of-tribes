// Хлеб осады словами (ОС-1, docs/siege_v2.md, раздел 23) — штраф к добыче, соотношение сил и срок хлеба. Числа — функциями
// двери хлеба (`siegefood.siegeCut`, `yieldShare`) и кольца (`blockade.ratioWords`), своей арифметики здесь нет (правило 18).
// Отдельным модулем от правил: слова читают окно защитника (кусок нового вида) и консоль, а правила едут с миром в первой
// загрузке. Без `@/`, как и сама дверь.
import { realSpan } from '../game/span';
import { ratioWords, type RingOdds } from './blockade';
import { BLOCKADE_RATIO } from './data/blockade';
import { siegeCut, yieldShare, type RatioRange } from './siegefood';

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
 * Соотношение вилкой (ОС-1в, окно лагеря под городом игрока, `siegefood.RatioRange`): точка — «×1,3», открытая сверху — «×1,5
 * и больше», открытая снизу — «до ×0,7», иначе «от ×2 до ×2,6»; ничего не известно — «неизвестно».
 */
export function rangeWords(r: RatioRange): string {
  if (r.lo === r.hi) return ratioWords(r.lo);
  if (!Number.isFinite(r.hi)) return r.lo > 0 ? `${ratioWords(r.lo)} и больше` : 'неизвестно';
  if (r.lo <= 0) return `до ${ratioWords(r.hi)}`;
  return `от ${ratioWords(r.lo)} до ${ratioWords(r.hi)}`;
}

/** Исход кнопки «Замкнуть кольцо» коротко (ОС-1в, `blockade.ringOdds`). */
export const RING_ODDS_SHORT: Record<RingOdds, string> = { yes: 'удастся', no: 'не удастся', maybe: 'зависит от гарнизона' };

/** Исход кнопки «Замкнуть кольцо» словами: порог — тем же числом, что у решения (`BLOCKADE_RATIO`). */
export function ringOddsWords(odds: RingOdds): string {
  const need = ratioWords(BLOCKADE_RATIO);
  if (odds === 'yes') return `Замкнуть удастся: при любом гарнизоне из вилки лагерь не слабее нужного — ${need}.`;
  if (odds === 'no') return `Не удастся: при любом гарнизоне из вилки лагерь слабее нужного — ${need}.`;
  return `Зависит от гарнизона: вилка накрывает порог ${need}. Решит сервер по настоящему гарнизону; узнать точнее — разведкой лазутчика.`;
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
