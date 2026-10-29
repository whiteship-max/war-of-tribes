// Престиж — одна дверь (ПН-2, docs/gdd/path_of_sword.md, «Решения ПН-2»): писать `GameState.prestige` может только
// `sim/prestige.movePrestige`; прежние три писателя (итог похода, награда задания, ответ вести) зовут её.
//
// Граница области (правило 11): «ниже нуля не падает» проверяется на сдвиге, который без двери увёл бы престиж ниже нуля,
// а «сдвиг как есть» — на точке внутри, где пол не спрашивается.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { applyEffects } from '@/world/bridge';
import { moveFame } from '../data/eventKit';
import { PRESTIGE_STAGES, movePrestige, prestigeAfter, prestigeStage } from './prestige';

const ROOT = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mts|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Код без комментариев. */
const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('престиж пишет одна дверь', () => {
  it('в src и на сервере `.prestige =` — только в sim/prestige.ts', () => {
    const door = join('src', 'game', 'sim', 'prestige.ts');
    const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'netlify'))];
    expect(files.length, 'граница: исходники найдены').toBeGreaterThan(300);
    const bad = files.filter((f) => !f.endsWith(door) && /\.prestige\s*([-+*/]?=)(?!=)/.test(bare(f)));
    expect(bad, 'престиж правят мимо двери').toEqual([]);
    expect(bare(join(ROOT, door)), 'сама дверь пишет').toMatch(/s\.prestige\s*=/);
  });

  it('прежние три писателя зовут дверь', () => {
    for (const rel of [['sim', 'expedition.ts'], ['sim', 'tick.ts'], ['data', 'eventKit.ts']]) {
      const code = bare(join(ROOT, 'src', 'game', ...rel));
      expect(code, `${rel.join('/')} зовёт movePrestige`).toMatch(/movePrestige\(/);
      expect(code, `${rel.join('/')} не считает престиж своей арифметикой`).not.toMatch(/prestige\s*[-+]\s*[\w.]+\s*\)/);
    }
  });
});

describe('дверь престижа', () => {
  it('сдвиг внутри области — как есть; ниже нуля не падает', () => {
    const s = createInitialState(7);
    s.prestige = 10;
    expect(movePrestige(s, 4), 'точка внутри: пол не спрашивается').toBe(4);
    expect(s.prestige).toBe(14);
    expect(14 - 20, 'граница: без пола ушло бы ниже нуля').toBeLessThan(0);
    expect(movePrestige(s, -20), 'сдвинулся на то, что было').toBe(-14);
    expect(s.prestige).toBe(0);
    expect(prestigeAfter(3, -5)).toBe(0);
    expect(prestigeAfter(3, 2.5)).toBe(5.5);
  });

  it('итог похода и ответ вести идут той же дверью', () => {
    const s = createInitialState(7);
    s.prestige = 2;
    applyEffects(s, [{ id: 'p1', lost: {}, resources: {}, prestige: 3, morale: 0, battle: null, text: '', good: true }]);
    expect(s.prestige).toBe(5);
    applyEffects(s, [{ id: 'p2', lost: {}, resources: {}, prestige: -9, morale: 0, battle: null, text: '', good: false }]);
    expect(s.prestige, 'поражение не уводит ниже нуля').toBe(0);
    moveFame(s, 4);
    expect(s.prestige).toBe(4);
    moveFame(s, -10);
    expect(s.prestige).toBe(0);
  });

  it('ступень — по порогам, которые передали; порогов в коде нет', () => {
    const steps = [0, 50, 150, 400, 1000];
    expect([0, 49, 50, 149, 150, 399, 400, 999, 1000, 1e6].map((p) => prestigeStage(p, steps))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(prestigeStage(1e9, [0, 1, 2, 3, 4, 5, 6]), 'ступеней не больше, чем имён').toBe(PRESTIGE_STAGES.length - 1);
    expect(prestigeStage(5, []), 'без порогов — первая').toBe(0);
    const code = bare(join(ROOT, 'src', 'game', 'sim', 'prestige.ts'));
    expect(code, 'пороги-ориентиры в код не идут').not.toMatch(/\b(50|150|400|1000)\b/);
  });
});
