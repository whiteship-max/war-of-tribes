import type { Building, BuildingTypeId, GameState } from './types';
import { addVillager } from './sim/population';
import { emptyEquipment } from './data/equipment';
import { emptyArmy } from './data/troops';

/** Формат сохранения. Поднимается при изменении структуры состояния (см. save.ts). */
export const SAVE_VERSION = 4;

const built = (s: GameState, type: BuildingTypeId): Building => ({
  id: s.nextId++,
  type,
  slot: -1,
  level: 1,
  work: 0,
  workRequired: 0,
});

export function createInitialState(): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    time: 0,
    resources: { wood: 26, stone: 14, food: 40, hides: 3, bones: 3, copper: 0, iron: 0 },
    equipment: emptyEquipment(),
    army: emptyArmy(),
    recruits: [],
    forging: null,
    forgeWork: 0,
    decree: 'none',
    ration: 'normal',
    villagers: [],
    buildings: [],
    techs: [],
    research: null,
    completedQuests: [],
    activeEvent: null,
    nextEventAt: 50,
    morale: 60,
    prestige: 0,
    totem: null,
    starvation: 0,
    freezing: 0,
    winterWarnedYear: 0,
    winterWarning: false,
    growth: 0,
    warriorsAway: 0,
    scoutsAway: 0,
    tutorialStep: 0,
    tutorialDone: false,
    log: [],
    stats: { hunts: 0, battlesWon: 0, battlesLost: 0, born: 0, died: 0, eventsResolved: 0 },
    nextId: 1,
    lastSaved: Date.now(),
  };
  s.buildings.push(built(s, 'campfire'));
  // Укрытий одно на всех: типов по одному, а вместимость набирается уровнями.
  s.buildings.push(built(s, 'shelter'));
  // Склад стоит с первого дня: ресурсы видны только в его панели, а без неё игрок
  // не видит ни одного числа о запасах.
  s.buildings.push(built(s, 'storage'));
  // Стартовые работники ходят вольным сбором: зданий добычи ещё нет, доход половинный.
  addVillager(s, { sex: 'm', age: 28, talent: 'hunter', job: 'hunter' });
  addVillager(s, { sex: 'f', age: 24, talent: null, job: 'gatherer' });
  addVillager(s, { sex: 'm', age: 31, talent: null, job: 'woodcutter' });
  addVillager(s, { sex: 'f', age: 19, talent: 'crafter', job: 'idle' });
  addVillager(s, { sex: 'm', age: 22, talent: null, job: 'idle' });
  s.log.push({ at: 0, text: 'Пять человек собрались у костра. Так началось племя.', kind: 'info' });
  s.log.push({ at: 0, text: 'Тапни по зданию, чтобы открыть его. Лесопилка удвоит труд лесоруба.', kind: 'info' });
  return s;
}
