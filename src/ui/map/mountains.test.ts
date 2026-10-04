// Горы рисуются как холмы (решение владельца, docs/battle_eu4.md, 14.19.1): класс «горы» заведён
// ради кости боя, а картинка карты от него не меняется. Отличить горы глазом — отдельное решение.
import { describe, expect, it } from 'vitest';
import { drawnAs } from './scatter';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';

describe('горы на карте', () => {
  it('рисуются холмами, а прочие классы — собой', () => {
    expect(drawnAs('mountains')).toBe('hills');
    for (const t of TERRAIN_ORDER) if (t !== 'mountains') expect(drawnAs(t), t).toBe(t);
    expect(drawnAs(null)).toBeNull();
  });

  it('заливка, крап и цена хода у гор — холмов', () => {
    const { color, detail, cost } = TERRAIN_META.hills;
    expect(TERRAIN_META.mountains).toMatchObject({ color, detail, cost });
    expect(TERRAIN_META.mountains.name).toBe('Горы');
  });
});
