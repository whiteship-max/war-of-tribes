// Вход админа в путь Воином (30.10.2026, `game/roamorigin`) — те же ориентиры ГДД 3.1, что вход-заглушка прибора `roam:report`
// («origins»): второго числа нет, расходиться им не с чего.
import { describe, expect, it } from 'vitest';
import { INPUTS } from './inputs';
import { WARRIOR } from '../../src/game/roamorigin';

describe('Воин игры = Воин прибора', () => {
  it('отряд, золото, провиант в днях, Военное дело героя', () => {
    const w = INPUTS.origins.value.find((o) => o.id === 'warrior');
    expect(w, 'граница: у прибора есть Воин').toBeDefined();
    expect({ band: WARRIOR.band, gold: WARRIOR.gold, foodDays: WARRIOR.foodDays, war: WARRIOR.war }).toEqual({ band: w!.band, gold: w!.gold, foodDays: w!.foodDays, war: w!.war });
  });
});
