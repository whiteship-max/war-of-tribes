// Обстрел перед штурмом для ролика TW: доли пролома и подпись — дверью ядра (`siegecraft`), своей арифметики нет (правило 18).
import { describe, expect, it } from 'vitest';
import { breachOf, craftNote } from '@/world/siegecraft';
import { barrageCaption, barrageShares } from './barrage';

describe('обстрел для ролика', () => {
  it('доли пробитой стены — `breachOf` после каждого залпа; без залпов — пусто', () => {
    expect(barrageShares(undefined)).toEqual([]);
    expect(barrageShares(0)).toEqual([]);
    expect(barrageShares(3)).toEqual([1, 2, 3].map((shots) => breachOf({ shots })));
    // Нарастающим итогом: каждый залп добавляет.
    const s = barrageShares(3);
    expect(s[0]).toBeGreaterThan(0);
    expect(s[1]).toBeGreaterThan(s[0]);
    expect(s[2]).toBeGreaterThan(s[1]);
  });

  it('подпись у стены — строка двери (`craftNote`), у логова — без чисел', () => {
    for (const shots of [1, 2, 3]) expect(barrageCaption({ site: 'wall', shots })).toBe(craftNote({ shots }));
    expect(barrageCaption({ site: 'lair', shots: 2 })).not.toMatch(/\d/);
  });
});
