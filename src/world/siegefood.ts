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

/**
 * Соотношение сил по штрафу (ОС-1б) — обратная `siegeCut`: внутри кривой — точное число (кривая строго растёт между крайними
 * точками), за краями — граница: штраф наибольший — лагерь «не слабее» ×1,5 (`bound: 'min'`), наименьший — «не сильнее» ×⅔
 * (`bound: 'max'`). Окно лагеря знает штраф, по которому сервер режет поля города (`WarCamp.cut`), а мощь гарнизона — только
 * вилкой реестра: соотношение оно выводит из штрафа.
 */
export function ratioOfCut(cut: number): { ratio: number; bound?: 'min' | 'max' } {
  if (!(cut < CUT_MAX)) return { ratio: CUT_RATIO_STRONG, bound: 'min' };
  if (cut <= CUT_MIN) return { ratio: CUT_RATIO_WEAK, bound: 'max' };
  // Делением пополам по логарифму: кривая там монотонна, шестьдесят шагов — точность double.
  let lo = Math.log(CUT_RATIO_WEAK);
  let hi = Math.log(CUT_RATIO_STRONG);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (siegeCut(Math.exp(mid)) < cut) lo = mid;
    else hi = mid;
  }
  return { ratio: Math.exp((lo + hi) / 2) };
}

/**
 * Что окно лагеря под городом игрока знает о соотношении сил (ОС-1в): вилка `lo`..`hi` — точка, если `lo === hi`; `hi` —
 * бесконечность, если сверху не ограничено. Мощь гарнизона нападающему не видна; знание — штраф сервера и разведка.
 */
export interface RatioRange {
  lo: number;
  hi: number;
}

/** Вилка по штрафу сервера (ОС-1в): внутри кривой — точка, на краях — полупрямая (`ratioOfCut`). */
export function ratioRangeOfCut(cut: number): RatioRange {
  const { ratio, bound } = ratioOfCut(cut);
  if (bound === 'min') return { lo: ratio, hi: Infinity };
  if (bound === 'max') return { lo: 0, hi: ratio };
  return { lo: ratio, hi: ratio };
}

/**
 * Две вилки об одном соотношении — их пересечение (ОС-1в). Не пересеклись — правда первой: штраф сервера свежее разведки,
 * которая стареет.
 */
export function ratioWithin(a: RatioRange, b: RatioRange | null): RatioRange {
  if (!b) return a;
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  return lo <= hi ? { lo, hi } : a;
}

/**
 * Через сколько фаз штраф к добыче упадёт к среднему (ОС-1б): лагерь тает долей `waste` за фазу, гарнизон стоит, и соотношение
 * после `k` фаз — `ratio × (1 − waste)^k`; среднее — «вровень» (`CUT_RATIO_EVEN`). Ноль — уже не выше среднего; `null` — не
 * упадёт (гарнизона нет или лагерь не тает). Прогноз «если ничего больше не случится»: вылазки, мор и подкрепление гарнизона
 * его двигают.
 */
export function phasesToEven(ratio: number, waste: number): number | null {
  if (Number.isNaN(ratio)) return null;
  if (ratio <= CUT_RATIO_EVEN) return 0;
  if (!Number.isFinite(ratio) || !(waste > 0)) return null;
  if (waste >= 1) return 1;
  const after = (k: number): number => ratio * Math.pow(1 - waste, k);
  let k = Math.max(1, Math.ceil(Math.log(CUT_RATIO_EVEN / ratio) / Math.log(1 - waste)));
  // Логарифм в double может промахнуться на шаг у самой границы — правят сами шаги, тем же умножением, что прогноз.
  while (k > 1 && after(k - 1) <= CUT_RATIO_EVEN) k--;
  while (after(k) > CUT_RATIO_EVEN) k++;
  return k;
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
