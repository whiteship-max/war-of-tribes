// SETUP-3 (docs/audit/WORKPLAN.md): поиск по таблице — своим полем, а не прототипом. Ключ из приказа, описи или
// сохранения — чужая строка; точки — ключи прототипа, которые `in` видит, а таблица не знает.
import { describe, expect, it } from 'vitest';
import { has, own } from './guard';
import { CROWN_RULES, isCrown } from './crownrules';
import { crownText } from './data/crownWords';
import { createInitialState } from './state';
import { pickTroops } from '@/world/muster';

const PROTO = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];

describe('пояс границы: ключи прототипа', () => {
  it('точка внутри области: `in` видит ключи прототипа', () => {
    for (const k of PROTO) expect(k in CROWN_RULES, k).toBe(true);
  });

  it('has и own: своё поле — да, прототип — нет', () => {
    const t: Record<string, number> = { a: 1 };
    expect(has(t, 'a')).toBe(true);
    expect(own(t, 'a')).toBe(1);
    for (const k of PROTO) {
      expect(has(t, k), k).toBe(false);
      expect(own(t, k), k).toBeUndefined();
    }
  });

  it('весть державы: ключ прототипа — не весть, и текста у неё нет', () => {
    const s = createInitialState();
    expect(isCrown('cr_comet')).toBe(true);
    for (const k of PROTO) {
      expect(isCrown(k), k).toBe(false);
      expect(crownText(k, s), k).toBe('');
    }
  });

  it('состав из приказа: ключ прототипа — не вид бойца, и в отряд он не идёт', () => {
    const home = { clubman: 5 };
    for (const k of PROTO) {
      const order = JSON.parse(`{"clubman": 2, "${k}": 3}`) as Record<string, number>;
      expect(pickTroops(order, home), k).toEqual({ clubman: 2 });
    }
    expect(pickTroops({ clubman: 6 }, home), 'больше, чем дома').toBeNull();
  });
});
