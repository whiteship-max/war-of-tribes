// Надпись налога называет сбор со знаком самого числа.
//
// Граница области, где правило вообще спрашивается: сбор отрицательный. Он бывает там,
// где закят раздаёт больше, чем налог собирает (заведомо — «Без налога»), и тест
// утверждает, что такая точка у него есть: без неё любая надпись с приписанным плюсом
// прошла бы зелёной даром.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FaithId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { TAXES } from '@/game/data/policy';
import { taxQuote } from '@/game/derived';
import { signed } from './signed';

/** Посёлок с храмом десятого уровня: наклон веры — и закят, и десятина — в полную силу. */
function village(faith: FaithId | null): GameState {
  const s = createInitialState();
  s.pop = 200;
  for (const b of s.buildings) if (b.type === 'church') b.level = 10;
  s.faith.id = faith;
  return s;
}

/** Число, которое прочтёт игрок: знак и модуль из надписи. */
const read = (label: string): number => (label.startsWith('−') ? -1 : 1) * Number(label.replace(/^[+−]/, ''));

describe('знак надписи — из числа', () => {
  it('плюс у прибыли, минус у убытка, у нуля знака нет', () => {
    expect(signed(3.04)).toBe('+3.0');
    expect(signed(-1.14)).toBe('−1.1');
    expect(signed(0)).toBe('0.0');
    // Округлённое до нуля отрицательное — ноль, а не «−0.0».
    expect(signed(-0.04)).toBe('0.0');
    expect(signed(2, 0)).toBe('+2');
  });

  it('кнопки налога в деревне с закятом и без читаются тем же числом, что считает игра', () => {
    let negative = 0;
    for (const faith of ['islam', 'catholic', null] as (FaithId | null)[]) {
      const s = village(faith);
      for (const t of TAXES) {
        const gold = taxQuote(s, t.id).gold;
        if (gold < -0.05) negative++;
        const label = signed(gold);
        expect(read(label), `${faith ?? 'без веры'}, ${t.id}: «${label}» при ${gold}`).toBeCloseTo(gold, 1);
      }
    }
    // Точка внутри области правила: закят без налога уводит сбор в минус.
    expect(taxQuote(village('islam'), 'none').gold).toBeLessThan(0);
    expect(negative).toBeGreaterThan(0);
  });

  it('ратуша не приписывает знак к деньгам руками', () => {
    const src = readFileSync(join(__dirname, 'TownHall.tsx'), 'utf8');
    expect(src).not.toMatch(/[+−-]\{[^}]*(gold|taxIncomePerDay)/);
    expect(src).toContain('{signed(q.gold)}');
  });
});
