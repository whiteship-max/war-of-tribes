import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sideReady } from './campSide';

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const panel = (name: string): string => strip(readFileSync(join(__dirname, '..', 'panels', name), 'utf8'));

describe('сторона лагеря словами — одна строка на оба окна осады', () => {
  it('дозревшая, растущая и та, куда не рубят', () => {
    expect(sideReady({ works: 1, ripeAt: 0 }, 0)).toBe('рогатки дозрели');
    expect(sideReady({ works: 0.4, ripeAt: 12 * 60_000 }, 0)).toMatch(/^40%, дозреют через /);
    expect(sideReady({ works: 0.4, ripeAt: Infinity }, 0)).toBe('40%, не растут');
  });

  it('окна осаждающего и обороняющегося своих слов о готовности не пишут', () => {
    for (const name of ['CampPanel.tsx', 'SiegePanel.tsx']) {
      const src = panel(name);
      expect(src, `${name}: читает sideReady`).toMatch(/\bsideReady\(/);
      expect(src, `${name}: свои слова о готовности`).not.toMatch(/дозрел|дозреют|не растут/);
    }
  });
});
