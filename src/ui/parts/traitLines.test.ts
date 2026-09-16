// Слова черт выводятся из таблицы: правка множителя или порога меняет строку сама.
import { afterEach, describe, expect, it } from 'vitest';
import { TRAITS, TRAIT_BY_ID } from '@/game/data/traits';
import { traitLines } from './traitLines';

const tally = { ok: 9, fail: 1, bled: 4, burned: 5 };

describe('слова черт', () => {
  const saved = JSON.parse(JSON.stringify(TRAITS)) as typeof TRAITS;
  afterEach(() => {
    for (const def of TRAITS) Object.assign(def, JSON.parse(JSON.stringify(saved.find((x) => x.id === def.id))));
  });

  it('у каждой черты есть что она даёт и за что держится, с числами', () => {
    for (const line of traitLines(
      TRAITS.map((t) => t.id),
      tally,
    )) {
      expect(line.what, line.id).toMatch(/\d/);
      expect(line.why, line.id).toMatch(/\d/);
      expect(line.why, `${line.id}: после «не меньше» — родительный`).not.toMatch(/не меньше \d+ (?:боя|бой|ходки|ходка|дела|дело)\b/);
    }
  });

  it('правка множителя и порога в таблице меняет строку', () => {
    const before = traitLines(['swift', 'unseen'], tally);
    (TRAIT_BY_ID.swift.effect as { muster: number }).muster = 0.5;
    (TRAIT_BY_ID.unseen as { min: number }).min = 11;
    const after = traitLines(['swift', 'unseen'], tally);
    expect(after[0].what).not.toBe(before[0].what);
    expect(after[0].what).toContain('50 %');
    expect(after[1].why).toContain('11');
  });
});
