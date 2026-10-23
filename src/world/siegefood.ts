// Хлеб осаждённого города — одна дверь на племя, мир на клиенте и сервер войны (ОС-1, docs/siege_v2.md, раздел 23).
//
// Модуль чистый, того же рода, что `siege.ts` и `blockade.ts`: ни состояния, ни часов, ни `Math.random`, и без `@/` — его
// собирает сервер войны. Здесь три правила и слова о них (правило 18):
//
// 1. **Штраф к добыче — от соотношения сил.** Мерка — мощь лагеря к мощи гарнизона, та же, что у кольца блокады
//    (`blockade.blockadeRatio`: бойцы строя, лагерь — без выбитых башней, гарнизон — без ополчения: поля за стеной держит тот,
//    кто выходит за ворота). Кривая — монотонный кубический сплайн Эрмита по логарифму соотношения через три точки (слабее,
//    вровень, сильнее), плоская за крайними: гладкая, без скачков и изломов на порогах, без перехлёста.
// 2. **Сдача голодом — только когда склад не оплатил прокорм шага**: добыча → прокорм → проверка, баланс ниже нуля
//    (`starves`). Ровно ноль, дробный остаток, хлеб, пришедший в тот же шаг, — не голод. Прогноз судьёй не бывает.
// 3. **Сколько хлеба хватит** — для сведения: окно защитника пишет срок этой дверью, решает голод не он.
import { SIEGE_YIELD } from '../game/constants';
import { realSpan } from '../game/span';
import { blockadeRatio, ratioWords } from './blockade';
import { CUT_MAX, CUT_MID, CUT_MIN, CUT_RATIO_EVEN, CUT_RATIO_STRONG, CUT_RATIO_WEAK } from './data/siegefood';

export { blockadeRatio as siegeRatio };

/** Кубический Эрмит на отрезке длины `h`: значения `ya`, `yb` и наклоны `ma`, `mb` по краям, `t` — доля пути 0..1. */
function hermite(t: number, h: number, ya: number, yb: number, ma: number, mb: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ya + (t3 - 2 * t2 + t) * h * ma + (-2 * t3 + 3 * t2) * yb + (t3 - t2) * h * mb;
}

/** Точки кривой в логарифме соотношения и наклон в средней: гармоническое среднее соседних наклонов (Фрич — Карлсон). */
function knots(): { x: [number, number, number]; y: [number, number, number]; m: number } {
  const x: [number, number, number] = [Math.log(CUT_RATIO_WEAK), Math.log(CUT_RATIO_EVEN), Math.log(CUT_RATIO_STRONG)];
  const y: [number, number, number] = [CUT_MIN, CUT_MID, CUT_MAX];
  const d0 = (y[1] - y[0]) / (x[1] - x[0]);
  const d1 = (y[2] - y[1]) / (x[2] - x[1]);
  return { x, y, m: d0 > 0 && d1 > 0 ? (2 * d0 * d1) / (d0 + d1) : 0 };
}

/**
 * Штраф к добыче хлеба осаждённого города при соотношении `ratio` (лагерь к гарнизону), 0..1: доля, которую лагерь отнимает у
 * полей за стеной. Не дальше слабой точки — `CUT_MIN`, от сильной — `CUT_MAX`, вровень — `CUT_MID`; между ними — сплайн по
 * логарифму. Гарнизона нет (бесконечность) — наибольший; число не число — тоже: прежняя осада.
 */
export function siegeCut(ratio: number): number {
  if (Number.isNaN(ratio)) return CUT_MAX;
  const { x, y, m } = knots();
  const lx = ratio > 0 ? Math.log(ratio) : -Infinity;
  if (lx <= x[0]) return y[0];
  if (lx >= x[2]) return y[2];
  // На краях наклон ноль: за крайними точками кривая плоская, и стык с ней гладкий.
  if (lx <= x[1]) return hermite((lx - x[0]) / (x[1] - x[0]), x[1] - x[0], y[0], y[1], 0, m);
  return hermite((lx - x[1]) / (x[2] - x[1]), x[2] - x[1], y[1], y[2], m, 0);
}

/** Штраф по мощи лагеря и гарнизона — та же мерка, что у кольца. */
export const siegeCutOf = (campPower: number, garrisonPower: number): number => siegeCut(blockadeRatio(campPower, garrisonPower));

/**
 * Какая доля добычи идёт под этим штрафом: хлеб — за стеной целиком (поля, загон, угодья), прочее — на три четверти (рудник и
 * каменоломня снаружи, внутри стены работают запасом сырья — `SIEGE_YIELD`). При наибольшем штрафе — как прежняя осада: хлеб
 * ноль, прочее четверть.
 */
export const yieldShare = (cut: number, food: boolean): number => {
  const c = Math.min(1, Math.max(0, Number.isFinite(cut) ? cut : 1));
  return food ? 1 - c : 1 - c * (1 - SIEGE_YIELD);
};

/**
 * Правило шага осады: прокорм не оплачен складом — баланс шага (склад + добыча − прокорм) ниже нуля. Ровно ноль — оплачен.
 * Одна мерка у племени (`sim/siege`), у мира и у сервера войны: округления здесь нет нарочно.
 */
export const starves = (balance: number): boolean => balance < 0;

// ------------------------------------------------ слова (правило 18: числа — этими же функциями) ---

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
