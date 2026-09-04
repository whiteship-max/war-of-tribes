import type { Building, BuildingTypeId, GameState } from './types';
import { BUILDINGS } from './data/buildings';
import { addVillager } from './sim/population';
import { emptyEquipment } from './data/equipment';
import { emptyArmy } from './data/troops';

/**
 * Формат сохранения. Поднимается при изменении структуры состояния (см. save.ts).
 * Версия 5 — старт в позднем средневековье: сохранения младших версий не
 * приводятся, партия начинается заново.
 */
export const SAVE_VERSION = 5;

const built = (s: GameState, type: BuildingTypeId): Building => ({
  id: s.nextId++,
  type,
  level: 1,
  work: 0,
  workRequired: 0,
});

/**
 * Новая партия: посёлок стоит целиком, включая стену, всё первого уровня.
 * Стройки с нуля в игре нет — единственная прогрессия посёлка это уровни, а
 * центр игры — карта, армия и бой. Стартовые запасы рассчитаны так, чтобы первые
 * копьё и боец делались без ожидания, но на дружину пришлось работать.
 */
export function createInitialState(): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    time: 0,
    resources: { wood: 120, stone: 80, food: 160, hides: 24, bones: 20, copper: 24, iron: 16 },
    equipment: emptyEquipment(),
    army: emptyArmy(),
    recruits: [],
    forging: null,
    forgeWork: 0,
    decree: 'none',
    ration: 'normal',
    tax: 'none',
    gold: 40,
    market: { day: 0, bought: {} },
    caravans: [],
    villagers: [],
    buildings: [],
    completedQuests: [],
    activeEvent: null,
    nextEventAt: 50,
    morale: 60,
    prestige: 5,
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
    stats: { hunts: 0, battlesWon: 0, battlesLost: 0, born: 0, died: 0, eventsResolved: 0, scouted: 0, raids: 0, castles: 0, purchases: 0 },
    nextId: 1,
    lastSaved: Date.now(),
  };
  for (const def of BUILDINGS) s.buildings.push(built(s, def.id));
  const at = (type: BuildingTypeId): number => s.buildings.find((b) => b.type === type)!.id;

  // Хозяйство укомплектовано по одному человеку на двор: еда, лес, камень, руда.
  addVillager(s, { sex: 'm', age: 34, talent: 'hunter', job: 'hunter' }).workplace = at('hunter_hut');
  addVillager(s, { sex: 'f', age: 27, talent: null, job: 'farmer' }).workplace = at('farm');
  addVillager(s, { sex: 'f', age: 24, talent: null, job: 'gatherer' }).workplace = at('gathering');
  addVillager(s, { sex: 'm', age: 31, talent: null, job: 'woodcutter' }).workplace = at('sawmill');
  addVillager(s, { sex: 'm', age: 29, talent: null, job: 'stonecutter' }).workplace = at('quarry');
  addVillager(s, { sex: 'm', age: 26, talent: 'miner', job: 'miner' }).workplace = at('mine');
  // Свободные руки у костра: из них выйдут кузнец, ремесленник и первые бойцы.
  addVillager(s, { sex: 'm', age: 22, talent: 'smith', job: 'idle' });
  addVillager(s, { sex: 'f', age: 19, talent: 'crafter', job: 'idle' });
  addVillager(s, { sex: 'm', age: 20, talent: null, job: 'idle' });
  addVillager(s, { sex: 'm', age: 23, talent: null, job: 'idle' });
  addVillager(s, { sex: 'f', age: 21, talent: null, job: 'idle' });

  s.log.push({ at: 0, text: 'Посёлок стоит за стеной, у ворот рынок, в кузнице холодный горн. Соседи не дремлют.', kind: 'info' });
  s.log.push({ at: 0, text: 'Поставь кузнеца к горну, скуй копьё и найми первого бойца — дальше карта.', kind: 'info' });
  return s;
}
