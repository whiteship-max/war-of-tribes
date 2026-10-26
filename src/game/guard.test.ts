// SETUP-3 и SETUP-4 (docs/audit/WORKPLAN.md): поиск по таблице — своим полем, а не прототипом, число — целым от нуля.
// Ключ из приказа, описи или сохранения — чужая строка; точки — ключи прототипа, которые `in` видит, а таблица не знает,
// и числа, мимо которых NaN проходил сам.
import { describe, expect, it } from 'vitest';
import { has, own, wholeNonNeg } from './guard';
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

describe('пояс границы: числа', () => {
  it('wholeNonNeg: целое от нуля до потолка — да; NaN, бесконечность, минус, дробь, строка, выше потолка — нет', () => {
    for (const v of [0, 1, 7, 10]) expect(wholeNonNeg(v, 10), String(v)).toBe(true);
    for (const v of [NaN, Infinity, -Infinity, -1, 1.5, '3', null, undefined, 11]) expect(wholeNonNeg(v, 10), String(v)).toBe(false);
  });

  it('состав из приказа: NaN, бесконечность и минус — не бойцы', () => {
    const home = { clubman: 5, spearman: 5 };
    for (const n of [NaN, Infinity, -Infinity, -2]) {
      expect(pickTroops({ clubman: n, spearman: 2 }, home), String(n)).toEqual({ spearman: 2 });
    }
    expect(pickTroops({ clubman: 2.7 }, home), 'дробь — вниз, как прежде').toEqual({ clubman: 2 });
  });
});
