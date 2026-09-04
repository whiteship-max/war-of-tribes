// Палитра — обещание: чистого белого и чёрного в сцене нет, затемнения холодные,
// сезон переопределяет только то, что есть в базе. Проверяется числами, не глазами.
import { describe, expect, it } from 'vitest';
import {
  AO_BASE,
  AO_POST,
  AO_WALL,
  EMISSIVE_KEYS,
  GROUND_SHADE,
  LIGHT_KEYS,
  PALETTE,
  SEASONAL_KEYS,
  SEASON_OVERRIDES,
  type PaletteKey,
} from './palette';

const channels = (hex: number): [number, number, number] => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];

describe('палитра', () => {
  it('ни одного чистого белого или чёрного канала, кроме огня и света', () => {
    for (const [key, hex] of Object.entries(PALETTE) as [PaletteKey, number][]) {
      if (EMISSIVE_KEYS.includes(key) || LIGHT_KEYS.includes(key)) continue;
      for (const c of channels(hex)) {
        expect(c, `${key}: канал слишком тёмный`).toBeGreaterThanOrEqual(0x10);
        expect(c, `${key}: канал слишком светлый`).toBeLessThanOrEqual(0xf4);
      }
    }
  });

  it('сезонные переопределения тоже держат правило и не выдумывают новых ключей', () => {
    for (const table of Object.values(SEASON_OVERRIDES)) {
      for (const [key, hex] of Object.entries(table) as [PaletteKey, number][]) {
        expect(PALETTE[key], `нет базового цвета для ${key}`).toBeDefined();
        for (const c of channels(hex)) {
          expect(c).toBeGreaterThanOrEqual(0x10);
          expect(c).toBeLessThanOrEqual(0xf4);
        }
      }
    }
  });

  it('снег ложится на кровли, землю и кроны', () => {
    for (const key of ['thatch', 'thatchDark', 'hide', 'shingle', 'tile', 'grass', 'leaves', 'dirt', 'trample', 'sky'] as const) {
      expect(SEASONAL_KEYS, `${key} должен меняться по сезону`).toContain(key);
      expect(SEASON_OVERRIDES.winter[key]).toBeDefined();
    }
  });

  it('стены и камень сезону не подчиняются', () => {
    for (const key of ['wood', 'stone', 'plaster', 'timber', 'metal', 'dark'] as const) {
      expect(SEASONAL_KEYS, `${key} не должен белеть зимой`).not.toContain(key);
    }
  });

  it('все затемнения холодные: синий канал не темнеет сильнее красного', () => {
    for (const mul of [AO_BASE, AO_WALL, AO_POST, GROUND_SHADE]) {
      expect(mul[2]).toBeGreaterThan(mul[0]);
      expect(mul[0]).toBeGreaterThan(0.5);
      expect(mul[2]).toBeLessThanOrEqual(1);
    }
  });
});
