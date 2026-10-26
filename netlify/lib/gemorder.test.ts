// SETUP-4 (docs/audit/WORKPLAN.md): число приказа алмазов — чужое число. Ускоряется идущая стройка, а её уровень —
// следующий за построенным: от второго (первый стоит с начала партии, `createInitialState`) до потолка описи, как у
// идущей стройки и очереди в описи (`readSite`, `readQueue`). Цена — целые алмазы, не меньше нуля.
import { describe, expect, it } from 'vitest';
import { readGemOrder, type GemOrder } from './contract.js';

const rush = (over: Record<string, unknown>) => readGemOrder({ op: 'rush', key: 'rush-key-1', building: 'forge', level: 3, work: 120, price: 7, ...over });

describe('приказ ускорения: числа', () => {
  it('точка внутри области: честное ускорение читается', () => {
    expect(rush({})).toEqual({ op: 'rush', key: 'rush-key-1', building: 'forge', level: 3, work: 120, price: 7 });
    const of = (o: GemOrder | null) => (o?.op === 'rush' ? o : null);
    expect(of(rush({ level: 2 }))?.level).toBe(2);
    expect(of(rush({ level: 100 }))?.level).toBe(100);
    expect(of(rush({ price: 0 }))?.price).toBe(0);
  });

  it('уровень ниже второго, выше потолка, дробный или не число — отказ', () => {
    for (const level of [1, 0, -1, -1e9, 101, 2.5, NaN, Infinity, '3', null]) expect(rush({ level }), String(level)).toBeNull();
  });

  it('цена минусом, дробью, бесконечностью или не числом — отказ', () => {
    for (const price of [-1, 1.5, Infinity, NaN, '7', null]) expect(rush({ price }), String(price)).toBeNull();
  });

  it('работа минусом, бесконечностью или не числом — отказ', () => {
    for (const work of [-1, Infinity, NaN, '120']) expect(rush({ work }), String(work)).toBeNull();
  });
});
