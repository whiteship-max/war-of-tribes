// Слова черт выводятся из таблицы: правка множителя или порога меняет строку сама.
import { afterEach, describe, expect, it } from 'vitest';
import { TRAITS, TRAIT_BY_ID } from '@/game/data/traits';
import { gameDaysOfMs } from '@/game/pace';
import { gameDaysText } from '@/ui/parts/wait';
import { musterMs } from '@/world/muster';
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

  /**
   * Черта сбора называет полный сбор с этим человеком той же функцией, что мир (`musterMs`), и где он идёт — в поле у своих
   * ворот; в городе перевод мгновенный, и в осаде (решения владельца 06.10.2026 и 16.10.2026, docs/ui_v2.md, 6.11; прежде
   * сбор шёл в осаде своего города). Прежде строка сравнивала сбор с предупреждением Дозора
   * («сбор успевает» / «не успевает», слово владельца, docs/battle_eu4.md, 14.35), и тест держал это сравнение на 1-м и
   * 2-м уровне Дозора: сбора дома больше нет — сравнивать не с чем. «Мясник» — сбор ×1.5, 9 игровых дней.
   */
  it('черта сбора говорит живым сроком полного сбора — в поле у своих ворот; о набеге и Дозоре не говорит', () => {
    for (const id of ['butcher', 'swift'] as const) {
      const full = musterMs(Infinity, TRAIT_BY_ID[id].effect.muster!);
      const what = traitLines([id], tally)[0].what;
      const days = gameDaysText(Math.round(gameDaysOfMs(full) * 10) / 10);
      expect(what, `${id}: полный сбор числом мира`).toContain(`Полный сбор ${days}`);
      // Без скобок (docs/voice.md, 12): настоящее время — своей частью фразы, «по часам …».
      expect(what, `${id}: где идёт сбор`).toMatch(/в поле у своих ворот, по часам \d.*\. В городе перевод мгновенный/);
      expect(what, `${id}: об осаде ни слова — в осаде перевод мгновенный`).not.toMatch(/осад/);
      expect(what, `${id}: о набеге и Дозоре ни слова`).not.toMatch(/Дозор|набег|успевает/);
    }
    expect(traitLines(['butcher'], tally)[0].what, 'полный сбор с «Мясником» — 9 игровых дней').toContain('9 игр. дн.');
  });
});
