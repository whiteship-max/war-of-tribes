// Обстрел перед штурмом для ролика TW (docs/battle_tw.md, раздел 15): из записи боя — в доли пробитой стены по залпам.
// Ролик мира не читает (тест «показ не считает бой», `render/tw/plan.test.ts`), поэтому числа ему даёт зовущий — игра и
// стенд одной функцией, дверью ядра (`siegecraft.breachOf`): второй таблицы пролома нет ни у ролика, ни здесь.
import { breachOf, craftNote } from '@/world/siegecraft';
import type { BattleRecord } from '@/world/types';

/**
 * Доля пробитой стены после каждого из `shots` залпов, нарастающим итогом; нет залпов — пусто (пролога нет). Пролом даёт
 * исход фазы, а не залп (docs/siege_v2.md, 2.5): у записи с проломами (`breach`) ролик рушит их долю ровными кусками по
 * залпам — показ, а не счёт. Запись до фаз — прежними долями залпов (`siegecraft.breachOf`).
 */
export function barrageShares(shots: number | undefined, breach?: number): number[] {
  const n = Math.max(0, Math.floor(shots ?? 0));
  if (breach === undefined) return Array.from({ length: n }, (_, i) => breachOf({ shots: i + 1 }));
  const total = breachOf({ shots: n, breach });
  return Array.from({ length: n }, (_, i) => (total * (i + 1)) / n);
}

/**
 * Подпись пролога обстрела: у стены — словами той же двери, что считает пролом и дух (`siegecraft.craftNote`, правило 18);
 * у логова стены нет — пролом ему ничего не стоит, и подпись без чисел.
 */
export function barrageCaption(rec: Pick<BattleRecord, 'site' | 'shots' | 'breach'>): string {
  return rec.site === 'wall'
    ? craftNote({ shots: rec.shots, ...(rec.breach !== undefined ? { breach: rec.breach } : {}) })
    : 'Обстрел логова: камни ложатся меж шалашей, мораль гарнизона падает.';
}
