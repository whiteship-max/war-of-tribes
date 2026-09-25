// Раздел наёмных мастеров в Мастерской: своих чисел у него нет, и показывает он ровно то, что
// считает игра. Врать числом здесь нельзя: ценность мастеров — спор за золото, и строка «мастер в
// жалованье — N копейщиков», разошедшаяся с ведомостью, учила бы игрока неправде.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { ADMIN_LEVELS, MASTERS_AT } from '@/game/data/realm';
import { crafterHeadShare, masterHands, masterWage, mastersBuildShare, upkeepInfo, wageOf } from '@/game/derived';
import { MASTER_PAID_AS } from '@/game/data/upkeep';
import { hireMasters, mastersInfo } from '@/game/sim/masters';

const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('раздел мастеров', () => {
  it('своих формул в разметке нет: числа — у двери мастеров и у ведомости', () => {
    const src = bare(join(process.cwd(), 'src', 'ui', 'parts', 'Masters.tsx'));
    expect(src, 'читает дверь мастеров').toMatch(/mastersInfo\(/);
    expect(src, 'и ведомость').toMatch(/upkeepInfo\(/);
    for (const name of ['CRAFTER_BUILD', 'WAGE_HEAD', 'WAGE_MAN', 'TAX_PER_POP', 'wageOf', 'masterWage', 'crafterBuildRate', 'mastersCap']) {
      expect(src.includes(name), `разметка не считает сама: ${name}`).toBe(false);
    }
  });

  /**
   * Что показывает раздел — то, что считает игра. Область: мастера и правда стоят, иначе «дают
   * стройке» было бы нулём при любом коде.
   */
  it('показанные числа — ровно числа двери', () => {
    const s = createInitialState(4242);
    s.pop = 400;
    s.buildings.find((b) => b.type === MASTERS_AT)!.level = 10;
    s.realm.tech.admin = ADMIN_LEVELS;
    s.army.spearman = 30;
    expect(hireMasters(s, 12)).toBeNull();
    const m = mastersInfo(s);
    expect(m.have, 'точка внутри области: мастера стоят').toBe(12);
    expect(m.wage).toBe(masterWage(s));
    expect(m.hands).toBe(masterHands(s));
    expect(m.inSoldiers).toBeCloseTo(masterWage(s) / wageOf(s, MASTER_PAID_AS), 12);
    expect(m.inSoldiers, 'мастер стоит столько бойцов, сколько даёт рук').toBeCloseTo(m.hands, 12);
    expect(m.each).toBe(crafterHeadShare(s));
    expect(m.gain).toBeCloseTo(mastersBuildShare(s), 12);
    expect(m.gain).toBeCloseTo(12 * m.each, 9);
    const up = upkeepInfo(s);
    expect(up.mastersWages).toBeCloseTo(12 * m.wage, 9);
    expect(up.armyWages + up.mastersWages).toBeCloseTo(up.wages, 9);
  });
});
