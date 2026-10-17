import { describe, expect, it } from 'vitest';
import { DEFAULT_ARMS, armsCode, lairArms } from '@/heraldry/arms';
import type { SettlementView } from '@/world/types';
import { marchArms, placeArms } from './arms';
import { placeMarkOf } from './tw/scene';

/** Место с полями, которых герб касается; прочее — как у карточки мира. */
const place = (over: Partial<SettlementView>): SettlementView =>
  ({ id: 's1', x: 1, y: 1, stage: 'village', relation: 'neutral', color: '#888', mine: false, castle: true, ruin: false, sacked: false, ...over }) as SettlementView;

const MINE = 'french-quarterly-azure-or-lion-gules';
const THEIRS = 'kite-plain-sable-sable-eagle-or';

describe('герб места на карте (П-2)', () => {
  it('свой город — герб профиля, сосед — из реестра, логово — свой по номеру, неизвестный сосед — башня', () => {
    expect(placeArms(place({ mine: true }), MINE)).toBe(MINE);
    expect(placeArms(place({ mine: true }), undefined)).toBe(armsCode(DEFAULT_ARMS));
    expect(placeArms(place({ arms: THEIRS }), MINE)).toBe(THEIRS);
    expect(placeArms(place({}), MINE)).toBe(armsCode(DEFAULT_ARMS));
    expect(placeArms(place({ id: 'lair-7', relation: 'barbarian', castle: false }), MINE)).toBe(armsCode(lairArms('lair-7')));
    // Подделанная строка в виде места — не наш набор: показывается башня.
    expect(placeArms(place({ arms: 'heater-plain-or-or-dragon-sable' }), MINE)).toBe(armsCode(DEFAULT_ARMS));
  });

  it('метка карты несёт герб места, у пепелища — нет', () => {
    expect(placeMarkOf(place({ mine: true, relation: 'self' }), MINE).arms).toBe(MINE);
    expect(placeMarkOf(place({ arms: THEIRS })).arms).toBe(THEIRS);
    expect(placeMarkOf(place({ ruin: true, relation: 'barbarian', castle: false })).arms).toBeUndefined();
  });

  it('знамя похода: свой — герб профиля; чужой, место выхода не загружено — разбойники или башня', () => {
    const at = { x: 99999, y: 99999 };
    expect(marchArms({ own: true, hostile: false, from: at }, MINE)).toBe(MINE);
    expect(marchArms({ own: false, hostile: true, from: at }, MINE)).toMatch(/axes/);
    expect(marchArms({ own: false, hostile: false, from: at }, MINE)).toBe(armsCode(DEFAULT_ARMS));
  });
});
