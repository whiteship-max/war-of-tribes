// Хлеб осаждённого города — одна дверь на племя, мир на клиенте и сервер войны (ОС-1, docs/siege_v2.md, раздел 23).
//
// Модуль чистый, того же рода, что `siege.ts` и `blockade.ts`: ни состояния, ни часов, ни `Math.random`, и без `@/` — его
// собирает сервер войны. Здесь два правила; слова о них — `siegewords.ts` (правило 18: теми же функциями), своим модулем:
// их читают окно защитника и консоль, а правила едут с миром в первой загрузке.
//
// 1. **Штраф к добыче — от соотношения сил.** Мерка — мощь лагеря к мощи гарнизона, та же, что у кольца блокады
//    (`blockade.blockadeRatio`: бойцы строя, лагерь — без выбитых башней, гарнизон — без ополчения: поля за стеной держит тот,
//    кто выходит за ворота). Кривая — монотонный кубический сплайн Эрмита по логарифму соотношения через три точки (слабее,
//    вровень, сильнее), плоская за крайними: гладкая, без скачков и изломов на порогах, без перехлёста.
// 2. **Сдача голодом — только когда склад не оплатил прокорм шага**: добыча → прокорм → проверка, баланс ниже нуля
//    (`starves`). Ровно ноль, дробный остаток, хлеб, пришедший в тот же шаг, — не голод. Прогноз судьёй не бывает.
//
// Сколько хлеба хватит, окно защитника пишет для сведения (`siegewords.breadWords`): решает голод не прогноз, а шаг.
import { SIEGE_YIELD } from '../game/constants';
import { blockadeRatio } from './blockade';
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
