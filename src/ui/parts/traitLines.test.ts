// Слова черт выводятся из таблицы: правка множителя или порога меняет строку сама.
import { afterEach, describe, expect, it } from 'vitest';
import { TRAITS, TRAIT_BY_ID } from '@/game/data/traits';
import { buildingOfType, warningSeconds } from '@/game/derived';
import { createInitialState } from '@/game/state';
import { gameDaysOfMs } from '@/game/pace';
import { musterMs, warningMsOf } from '@/world/muster';
import { traitLines } from './traitLines';

const tally = { ok: 9, fail: 1, bled: 4, burned: 5 };

/** Прибавка Дозора к предупреждению о набеге на уровне `level` — тем же `warningSeconds`, что читает слепок. */
function watchAt(level: number) {
  const s = createInitialState();
  buildingOfType(s, 'watch')!.level = level;
  return warningSeconds(s);
}

describe('слова черт', () => {
  const saved = JSON.parse(JSON.stringify(TRAITS)) as typeof TRAITS;
  afterEach(() => {
    for (const def of TRAITS) Object.assign(def, JSON.parse(JSON.stringify(saved.find((x) => x.id === def.id))));
  });

  it('у каждой черты есть что она даёт и за что держится, с числами', () => {
    for (const line of traitLines(
      TRAITS.map((t) => t.id),
      tally,
      watchAt(1),
    )) {
      expect(line.what, line.id).toMatch(/\d/);
      expect(line.why, line.id).toMatch(/\d/);
      expect(line.why, `${line.id}: после «не меньше» — родительный`).not.toMatch(/не меньше \d+ (?:боя|бой|ходки|ходка|дела|дело)\b/);
    }
  });

  it('правка множителя и порога в таблице меняет строку', () => {
    const before = traitLines(['swift', 'unseen'], tally, watchAt(1));
    (TRAIT_BY_ID.swift.effect as { muster: number }).muster = 0.5;
    (TRAIT_BY_ID.unseen as { min: number }).min = 11;
    const after = traitLines(['swift', 'unseen'], tally, watchAt(1));
    expect(after[0].what).not.toBe(before[0].what);
    expect(after[0].what).toContain('50 %');
    expect(after[1].why).toContain('11');
  });

  it('черта сбора говорит живыми числами игры, успевает ли полный сбор до набега при нынешнем Дозоре', () => {
    // Слово владельца (docs/battle_eu4.md, 14.35): «Сбор с ним — N, Дозор предупреждает за M — успевает / не успевает»,
    // теми же функциями, что считает мир. «Мясник» — сбор ×1.5: 9 игровых дней против 7 и прибавки Дозора.
    const butcher = TRAIT_BY_ID.butcher.effect.muster!;
    const full = musterMs(Infinity, butcher);
    // Граница области: на 1-м уровне Дозора предупреждение ровно равно полному сбору «Мясника» — запаса нет, и окно
    // закрыто в минуту, когда набег стал виден; на 2-м оно уже длиннее. Точки по обе стороны сравнения.
    expect(gameDaysOfMs(warningMsOf(watchAt(1))), 'предупреждение на 1-м уровне Дозора').toBeCloseTo(gameDaysOfMs(full), 6);
    expect(warningMsOf(watchAt(2)), 'предупреждение на 2-м уровне Дозора').toBeGreaterThan(full);
    const at1 = traitLines(['butcher'], tally, watchAt(1))[0].what;
    const at2 = traitLines(['butcher'], tally, watchAt(2))[0].what;
    expect(at1, 'Дозор 1-го уровня').toContain('сбор не успевает');
    expect(at2, 'Дозор 2-го уровня').toContain('сбор успевает');
    expect(at1, 'полный сбор с ним — 9 игровых дней').toContain('9 игр. дн.');
    expect(at2, 'предупреждение — числом Дозора').not.toBe(at1);
    // «Скорый на сборы» при том же Дозоре успевает: строка одна на все черты сбора.
    expect(traitLines(['swift'], tally, watchAt(1))[0].what).toContain('сбор успевает');
  });
});
