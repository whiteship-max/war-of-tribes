// Мораль боя у своих ворот — одно число мира (`GATE_MORALE_WON`, `GATE_MORALE_LOST`), и его называет справка морали.
// Прежде справка и бой события говорили −12, а мир писал набегу −10 литералом (docs/PROMISES_DEBT.md; слово владельца
// по docs/battle_eu4.md, 14.28: −10, как в мире). Держит это чтение исходников: число стоит в одном месте, а читатели
// берут его по имени.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_MORALE_LOST, GATE_MORALE_WON } from './data/tuning';

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

describe('мораль боя у ворот — одно число мира', () => {
  it('поражение у ворот стоит −10, как в мире; победа +5', () => {
    expect(GATE_MORALE_LOST).toBe(10);
    expect(GATE_MORALE_WON).toBe(5);
  });

  it('справка морали и бой у стены читают число мира по имени, литерала нет', () => {
    const panel = read('src/ui/panels/MoralePanel.tsx');
    expect(panel, 'справка называет число мира').toMatch(/GATE_MORALE_WON/);
    expect(panel, 'справка называет число мира').toMatch(/GATE_MORALE_LOST/);
    expect(panel, 'своего числа у справки нет').not.toMatch(/BATTLE_MORALE/);
    const world = read('src/world/local/LocalWorld.ts');
    const defense = world.match(/id: `\$\{m\.id\}-defense`[\s\S]*?good:/);
    expect(defense, 'последствие боя у стены найдено').not.toBeNull();
    expect(defense![0], 'мораль боя у стены — числом мира').toMatch(/morale: [^,]*GATE_MORALE_LOST[^,]*GATE_MORALE_WON/);
    expect(defense![0], 'литерала морали у боя у стены нет').not.toMatch(/morale: [^,]*\d/);
  });
});
