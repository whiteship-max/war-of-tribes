// На сколько дней хватит еды при нынешнем пайке — одна строка склада.
//
// Своей формулы расхода здесь нет: дневной баланс еды целиком отдаёт `netPerDay` —
// производство минус расход с сезоном и пайком, ровно то, что шаг симуляции кладёт на
// склад и снимает с него (`sim/tick`). От баланса до срока — одно деление, и сверяет его
// с настоящим шагом тест (`foodLeft.test.ts`), а не с константой.
import type { GameState } from '@/game/types';
import { netPerDay } from '@/game/derived';

export interface FoodLeft {
  /** Дней до пустого амбара. null — еда не убывает: добывают не меньше, чем едят. */
  days: number | null;
}

export function foodLeft(s: GameState): FoodLeft {
  const drain = -netPerDay(s).food;
  return { days: drain > 0 ? Math.max(0, s.resources.food) / drain : null };
}
