// Исход встречи с НПС для отряда бродяги (ПН-5, docs/gdd/path_of_sword.md, 3.6.4–3.6.5; `sim/roamfight`): победа, отход, перебит —
// герой ранен, перебит — герой погиб и путь продолжает наследник пути (соратников в Срезе 1 нет), запись в родословной.
//
// Путь включён подменой модуля. Граница области — утверждениями: отряд правда жив или правда перебит, кость гибели героя правда
// ниже порога или правда выше.
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { roamStub } from '../roamstubs';
import { troopTotal } from '../battle/kinds';
import { beginRoam } from './roam';
import { fallRoll, heroHurt, takeFight, type FightOut } from './roamfight';
import { plunder, HEAD_CARRY } from '@/world/spoils';
import '../roamdoor';

vi.mock('../roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

function party(): GameState {
  const s = createInitialState(7);
  expect(beginRoam(s, { origin: 'craftsman', hero: { name: 'Ратко', war: 3 }, band: { spearman: 10, clubman: 6 }, purse: 300, food: 120 })).toBeNull();
  s.prestige = 200;
  s.profile.arms = 'x';
  return s;
}

const fight = (over: Partial<FightOut>): FightOut => ({ how: 'strike', id: 'vataga:1:1', name: 'Ватага Лиса', power: 40, foeMen: 20, foeLoss: 0.2, won: false, lost: {}, seed: 1, at: 1000, ...over });

/** Сид боя, у которого кость гибели героя ниже или выше порога (поиск — утверждением). */
const seedWhere = (dies: boolean): number => {
  for (let i = 1; i < 10_000; i++) if (fallRoll(i) < roamStub('heroFall') === dies) return i;
  throw new Error('нет сида');
};

describe('проиграл, отряд жив — отход (ГДД 3.6.4)', () => {
  it('павшие уходят, часть ранена; обоз теряет то, что унесут уцелевшие враги (`plunder`); престиж — минус доля', () => {
    const s = party();
    const cargo = { ...s.roam!.cargo };
    const before = troopTotal(s.roam!.band);
    const line = takeFight(s, fight({ lost: { clubman: 4 } }));
    expect(troopTotal(s.roam!.band), 'граница: отряд жив').toBe(before - 4);
    expect(troopTotal(s.roam!.wounded[0]?.troops ?? {})).toBe(Math.round(4 * roamStub('bandWound')));
    const carry = Math.round(20 * (1 - 0.2)) * HEAD_CARRY;
    const taken = plunder(cargo, 0, carry).taken;
    expect((cargo.food ?? 0) - (s.roam!.cargo.food ?? 0)).toBeCloseTo(taken.food ?? 0, 9);
    expect(taken.food ?? 0, 'граница: что-то унесли').toBeGreaterThan(0);
    expect(s.prestige).toBeCloseTo(200 * (1 - roamStub('defeatPrestige')), 9);
    expect(s.roam!.purse, 'кошель у живого отряда цел').toBe(300);
    expect(line).toMatch(/^Бой: Ватага Лиса \(~20\) — отход\./);
    expect(s.log[0].text).toBe(line);
  });
});

describe('перебит (ГДД 3.6.4)', () => {
  it('герой жив — ранен на срок раненых; обоз — победителю целиком, кошель — доля', () => {
    const s = party();
    const seed = seedWhere(false);
    takeFight(s, fight({ lost: { ...s.roam!.band }, seed }));
    expect(troopTotal(s.roam!.band), 'граница: перебит').toBe(0);
    expect(s.roam!.cargo).toEqual({});
    expect(s.roam!.purse).toBeCloseTo(300 * (1 - roamStub('defeatPurse')), 9);
    expect(heroHurt(s)).not.toBeNull();
    expect(s.roam!.hero.name, 'тот же герой').toBe('Ратко');
    expect(s.log[0].text).toMatch(/отряд перебит, герой ранен/);
  });

  it('герой погиб — наследник пути: то же происхождение, 1-й уровень, доля престижа, знамя то же; запись в родословной', () => {
    const s = party();
    const seed = seedWhere(true);
    takeFight(s, fight({ lost: { ...s.roam!.band }, seed }));
    expect(troopTotal(s.roam!.band), 'граница: перебит').toBe(0);
    const r = s.roam!;
    expect(r.origin).toBe('craftsman');
    expect(r.hero.war).toBe(1);
    expect(r.hero.name).not.toBe('Ратко');
    expect(r.hero.deeds, 'новый — без дел прежнего').toBeUndefined();
    expect(s.prestige).toBeCloseTo(200 * (1 - roamStub('defeatPrestige')) * roamStub('heirPrestige'), 9);
    expect(s.profile.arms, 'знамя — то же').toBe('x');
    const book = s.lineage.ruler ?? [];
    expect(book[0]).toMatchObject({ name: 'Ратко', level: 3, end: 'fell' });
    expect(s.log[0].text).toMatch(/Ратко пал.*Путь продолжает наследник/);
  });
});

describe('победа (ГДД 3.6.1, 3.9)', () => {
  it('престиж — мощь / S, павшие и раненые; без потерь — «Без потерь»', () => {
    const s = party();
    takeFight(s, fight({ won: true, lost: {} }));
    expect(s.prestige).toBeCloseTo(200 + 40 / roamStub('prestigeS'), 9);
    expect(s.log[0].text).toMatch(/— победа\. Без потерь\./);
  });
});
