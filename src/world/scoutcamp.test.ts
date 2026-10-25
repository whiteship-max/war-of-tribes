// Бой у рогаток стоит лагерю хотя бы человека — и лагерю из одних разведчиков (MAP-8, docs/audit/WORKPLAN.md; архив
// round2/prove-19-1). Гарантированный человек снимался воином: у лагеря без воинов `stackAfter` его не находил, и бой
// у рогаток не стоил такому лагерю никого.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { SiegeWindow } from './siege';
import type { UnitStack } from './types';

const NOW = 1_700_000_000_000;

interface Inner {
  save: { marches: Array<{ id: string; units: UnitStack; power: number }> };
  wearCamp(w: SiegeWindow, loss: number, at: number, why: string, after?: string, atLeastOne?: boolean): number;
}

function camp(units: UnitStack) {
  const w = new LocalWorld({ seed: 7, now: () => NOW, storage: null }) as unknown as Inner;
  w.save.marches.push({ id: 'camp19', units, power: 10 });
  // Лагерь бота: полководца нет, войско — в марше.
  const win = { campId: 'camp19' } as SiegeWindow;
  return { w, win, units: () => w.save.marches.find((m) => m.id === 'camp19')!.units };
}

describe('бой у рогаток стоит лагерю человека (MAP-8)', () => {
  it('лагерь из одних разведчиков теряет разведчика', () => {
    const { w, win, units } = camp({ scout: 5 });
    expect(w.wearCamp(win, 0.05, NOW, 'Вылазка.')).toBe(1);
    expect(units()).toEqual({ scout: 4 });
  });

  it('лагерь с воинами по-прежнему теряет воина', () => {
    const { w, win, units } = camp({ warrior: 5, scout: 5 });
    expect(w.wearCamp(win, 0.01, NOW, 'Вылазка.')).toBe(1);
    expect(units()).toEqual({ warrior: 4, scout: 5 });
  });

  it('истощение фазы гарантии не даёт', () => {
    const { w, win, units } = camp({ scout: 5 });
    expect(w.wearCamp(win, 0.05, NOW, 'Истощение.', undefined, false)).toBe(0);
    expect(units()).toEqual({ scout: 5 });
  });
});
