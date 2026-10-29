// С чем бродяга выходит на дорогу со стартового экрана (30.10.2026, решение владельца: админ начинает Путь меча с нуля).
//
// Происхождений игра ещё не знает — экран выбора и их числа даёт ПН-17 (ГДД 3.1). До него вход один — **Воин** с ориентирами ГДД:
// герой с Военным делом 2, четыре копейщика и два дубинщика, 120 золота и провиант на 4 игр. дн. Числа — те же, что у входа-заглушки
// прибора `roam:report` («origins»): второго числа нет, сверяет тест прибора (`origin.test.ts`). Вывода
// у них нет — это заглушка, как `roamstubs`, и читает её только вход в путь за выключателем (`roamflag.roamOn`).
import type { GameState, TroopId } from './types';
import type { RoamStart } from './sim/roam';
import { seasonMods } from './derived';
import { bandRationPerDay } from './roamrules';

/** Воин (ГДД 3.1): ориентиры, без вывода. */
export const WARRIOR = {
  band: { spearman: 4, clubman: 2 } as Partial<Record<TroopId, number>>,
  gold: 120,
  foodDays: 4,
  war: 2,
} as const;

/** Вход Воином: провиант — паёк отряда по сезону партии на `foodDays` игр. дн. той же дверью, что шаг отряда. */
export function warriorStart(s: GameState, hero: string): RoamStart {
  const food = bandRationPerDay({ band: WARRIOR.band, wounded: [] }, seasonMods(s).food) * WARRIOR.foodDays;
  return { origin: 'warrior', hero: { name: hero, war: WARRIOR.war }, band: { ...WARRIOR.band }, purse: WARRIOR.gold, food };
}
