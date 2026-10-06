// Ступень промысла по уровню игры (docs/perf.md): не дороже уровня, адрес сильнее.
import { describe, expect, it } from 'vitest';
import { TIERS } from '@/prologue/look';
import { QUALITIES } from '@/render/quality';
import { TIER_OF_QUALITY, miniTier } from './tier';

describe('ступень промысла по уровню игры', () => {
  it('«Низкое» — пол поляны с любой ступени устройства; «Среднее» — не выше lite; «Высокое» ступени не опускает', () => {
    for (const t of TIERS) {
      expect(miniTier(t, 'low', false), t).toBe('base');
      expect(miniTier(t, 'medium', false), t).toBe(t === 'full' ? 'lite' : t);
      expect(miniTier(t, 'high', false), t).toBe(t);
    }
  });

  it('ступень из адреса (стенд) — сильнее уровня', () => {
    for (const q of QUALITIES) expect(miniTier('full', q, true), q).toBe('full');
  });

  it('у каждого уровня своя ступень, и дешевле уровень — не дороже ступень', () => {
    const order = QUALITIES.map((q) => TIERS.indexOf(TIER_OF_QUALITY[q]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(QUALITIES.length);
  });
});
