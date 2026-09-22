// Черты: условие — минимум дел плюс доля исходов, и черту можно потерять.
//
// Область, где правило вообще спрашивается, — «дел не меньше порога черты»: ниже
// порога черты нет ни при каком счёте, и точка там проходит при любом коде. Поэтому
// каждая точка, проверяющая долю, сначала проверяет, что она внутри области.
import { describe, expect, it } from 'vitest';
import { FIGURE_IDS } from '@/world/data/figures';
import type { Tally } from '../types';
import { LINEAGE_KEEP, TRAITS, TRAIT_BY_ID, deedsOf, holds, traitsOf, type TraitId } from './traits';

const tally = (ok: number, fail: number, bled = 0, burned = 0): Tally => ({ ok, fail, bled, burned });

/** Точка внутри области правила: дел не меньше порога черты. */
function inside(id: TraitId, t: Tally): Tally {
  expect(deedsOf(t), `${id}: точка внутри области — дел не меньше ${TRAIT_BY_ID[id].min}`).toBeGreaterThanOrEqual(
    TRAIT_BY_ID[id].min,
  );
  return t;
}

describe('таблица черт', () => {
  it('у дипломата черт нет: безделья без дела не бывает, и черты за него не заводим', () => {
    expect(TRAITS.filter((t) => t.agent === 'diplomat')).toEqual([]);
  });

  it('у каждого, у кого есть черты, есть и добрая, и дурная', () => {
    for (const id of FIGURE_IDS) {
      const own = TRAITS.filter((t) => t.agent === id);
      if (own.length === 0) continue;
      expect(own.some((t) => t.good), `${id}: добрая`).toBe(true);
      expect(own.some((t) => !t.good), `${id}: дурная`).toBe(true);
    }
  });

  it('родословная заведена у Статуи и у дома правителя, и книга одна', () => {
    // Дом правителя — пятое место в той же книге, а не вторая книга рядом
    // (docs/dynasty.md, раздел 1.2). Потолок у него тот же, что у Статуи: нового числа нет.
    expect(LINEAGE_KEEP).toEqual({ general: 6, scout: 0, spy: 0, diplomat: 0, ruler: 6 });
  });

  it('пары на одной оси не держатся разом ни при каком счёте', () => {
    const PAIRS: [TraitId, TraitId][] = [
      ['victor', 'beaten'],
      ['swift', 'butcher'],
      ['unseen', 'marked'],
      ['deft', 'lagging'],
    ];
    let checked = 0;
    for (let n = 0; n <= 24; n++) {
      for (let fail = 0; fail <= n; fail++) {
        for (const bledPer of [0, 1, 2, 9, 10, 11]) {
          for (let burned = 0; burned <= n; burned += 3) {
            const t = tally(n - fail, fail, bledPer * n, burned);
            for (const [a, b] of PAIRS) {
              expect(holds(TRAIT_BY_ID[a], t) && holds(TRAIT_BY_ID[b], t), `${a}+${b} при ${JSON.stringify(t)}`).toBe(false);
              if (holds(TRAIT_BY_ID[a], t) || holds(TRAIT_BY_ID[b], t)) checked++;
            }
          }
        }
      }
    }
    // Сравнение не пустое: одна из черт пары держится в тысячах точек.
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('порог — минимум дел плюс доля', () => {
  it('ниже порога дел черты нет, даже при безупречном счёте', () => {
    expect(holds(TRAIT_BY_ID.victor, tally(4, 0))).toBe(false);
    expect(holds(TRAIT_BY_ID.victor, inside('victor', tally(5, 0)))).toBe(true);
  });

  it('«Победоносный»: первое поражение его снимает', () => {
    const t = inside('victor', tally(9, 0));
    expect(traitsOf('general', t)).toContain('victor');
    t.fail += 1;
    expect(traitsOf('general', inside('victor', t))).not.toContain('victor');
  });

  it('доли сравниваются точно: ровно на границе черта держится, на шаг за ней — нет', () => {
    const edge: [TraitId, Tally, Tally][] = [
      ['beaten', tally(2, 2), tally(3, 2)],
      ['swift', tally(6, 0, 6), tally(6, 0, 7)],
      ['butcher', tally(3, 0, 30), tally(3, 0, 29)],
      ['carter', tally(4, 0, 0, 3), tally(5, 0, 0, 3)],
      ['unseen', tally(14, 2), tally(13, 2)],
      ['marked', tally(4, 2), tally(5, 2)],
      ['deft', tally(8, 2), tally(7, 2)],
      ['lagging', tally(3, 2), tally(4, 2)],
    ];
    for (const [id, on, off] of edge) {
      expect(holds(TRAIT_BY_ID[id], inside(id, on)), `${id} на границе`).toBe(true);
      expect(holds(TRAIT_BY_ID[id], inside(id, off)), `${id} за границей`).toBe(false);
    }
  });

  it('порог не зависит от длины жизни: та же доля на вдесятеро большем счёте даёт ту же черту', () => {
    for (const def of TRAITS) {
      const base = tally(def.min * 3, 0, def.min * 3, def.min * 3);
      const big = tally(def.min * 30, 0, def.min * 30, def.min * 30);
      expect(holds(def, inside(def.id, big)), def.id).toBe(holds(def, inside(def.id, base)));
    }
  });
});
