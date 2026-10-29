// С чем Воин выходит на дорогу (ГДД 3.1; `roamorigin`) — числа без вывода, своим модулем без `@/`: их читает и книга отряда сервера
// (ПН-6, `netlify/lib/roambook.startBook` — старт книги), а `roamorigin` тянет двери партии. Число одно — прибор сверяет его своим
// входом «origins» (`origin.test.ts`).
import type { TroopId } from './types';

/** Воин (ГДД 3.1): ориентиры, без вывода. */
export const WARRIOR = {
  band: { spearman: 4, clubman: 2 } as Partial<Record<TroopId, number>>,
  gold: 120,
  foodDays: 4,
  war: 2,
} as const;
