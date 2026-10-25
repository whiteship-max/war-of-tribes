// Правило склада — одно на игру и на книгу запасов сервера (docs/audit/OWNER-DECISIONS.md, п. 1, решение владельца):
// запас никогда не выше вместимости и не ниже нуля. Прибавка сверх вместимости не ложится, убавка — до нуля.
//
// Чистое, без `@/`: его читает и сервер (`netlify/lib/goods.ts` — опись и книга запасов приводятся к вместимости им же).
// Дверь игры к складу — `sim/stock.addStock`; своей арифметики «не выше вместимости» больше нигде нет (структурный тест
// `sim/stock.test.ts`).

/**
 * Запас после прибавки `n` (со знаком) к `before` при вместимости `cap`: `max(0, min(cap, before + n))`. Не-число на входе
 * (испорченная прибавка или запас) — ноль, а не порча склада: `Math.max(0, NaN)` — тоже NaN, и он остался бы в партии навсегда
 * (тест-свойство `sim/stockprop.test.ts`).
 */
export const fitStock = (before: number, n: number, cap: number): number => {
  const v = (Number.isNaN(before) ? 0 : before) + (Number.isNaN(n) ? 0 : n);
  return Math.max(0, Math.min(cap, Number.isNaN(v) ? 0 : v));
};
