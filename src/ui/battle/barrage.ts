// Обстрел перед штурмом для ролика TW (docs/battle_tw.md, раздел 15): из записи боя — в доли пробитой стены по залпам.
// Ролик мира не читает (тест «показ не считает бой», `render/tw/plan.test.ts`), поэтому числа ему даёт зовущий — игра и
// стенд одной функцией, дверью ядра (`siegecraft.breachOf`): второй таблицы пролома нет ни у ролика, ни здесь.
import { breachOf, craftNote } from '@/world/siegecraft';
import type { BattleRecord } from '@/world/types';

/** Доля пробитой стены после каждого из `shots` залпов, нарастающим итогом; нет залпов — пусто (пролога нет). */
export function barrageShares(shots: number | undefined): number[] {
  const n = Math.max(0, Math.floor(shots ?? 0));
  return Array.from({ length: n }, (_, i) => breachOf({ shots: i + 1 }));
}

/**
 * Подпись пролога обстрела: у стены — словами той же двери, что считает пролом и дух (`siegecraft.craftNote`, правило 18);
 * у логова стены нет — пролом ему ничего не стоит, и подпись без чисел.
 */
export function barrageCaption(rec: Pick<BattleRecord, 'site' | 'shots'>): string {
  return rec.site === 'wall' ? craftNote({ shots: rec.shots }) : 'Обстрел логова: камни ложатся меж шалашей, мораль гарнизона падает.';
}
