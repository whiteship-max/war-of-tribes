import type { Building, BuildingTypeId, GameState } from './types';
import { BUILDINGS } from './data/buildings';
import { emptyEquipment } from './data/equipment';
import { emptyArmy } from './data/troops';

/**
 * Формат сохранения. Поднимается при изменении структуры состояния (см. save.ts).
 * Версия 7 — перестройка посёлка: укрытия больше нет, тотем стал церковью,
 * хижина — жилищами, а `s.totem` — `s.patron`. Все три поля в сохранении шестой
 * версии называются иначе, чем в состоянии, поэтому мержить его поверх нового
 * начального нельзя: сохранение младшей версии отбрасывается, партия начинается
 * заново, и игроку об этом говорят прямо (LegacyModal).
 */
export const SAVE_VERSION = 7;

const built = (s: GameState, type: BuildingTypeId): Building => ({
  id: s.nextId++,
  type,
  level: 1,
  work: 0,
  workRequired: 0,
});

/** Сколько человек в племени на старте. Крыш хватает ещё примерно на столько же. */
const START_POP = 30;

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
    resources: { wood: 900, stone: 600, food: 900, hides: 180, bones: 150, copper: 180, iron: 120 },
    equipment: emptyEquipment(),
    army: emptyArmy(),
    recruits: [],
    forging: null,
    forgeWork: 0,
    decree: 'none',
    ration: 'normal',
    tax: 'none',
    gold: 320,
    market: { day: 0, bought: {} },
    caravans: [],
    pop: START_POP,
    workers: {},
    freeJobs: {},
    buildings: [],
    completedQuests: [],
    activeEvent: null,
    nextEventAt: 50,
    morale: 60,
    prestige: 5,
    patron: null,
    starvation: 0,
    freezing: 0,
    winterWarnedYear: 0,
    winterWarning: false,
    growth: 0,
    popDay: START_POP,
    warriorsAway: 0,
    scoutsAway: 0,
    defenseFormation: null,
    battlePlans: [],
    battleWatch: false,
    feastUntil: 0,
    feastAt: 0,
    tutorialStep: 0,
    tutorialDone: false,
    log: [],
    stats: { hunts: 0, battlesWon: 0, battlesLost: 0, born: 0, died: 0, eventsResolved: 0, scouted: 0, raids: 0, castles: 0, purchases: 0 },
    nextId: 1,
    lastSaved: Date.now(),
  };
  for (const def of BUILDINGS) s.buildings.push(built(s, def.id));
  const at = (type: BuildingTypeId): number => s.buildings.find((b) => b.type === type)!.id;

  // Хозяйство укомплектовано: еда, лес, камень, руда. Назначение — число людей
  // в здании, а не список имён: люди одинаковы, разницу делает уровень постройки.
  const crew: [BuildingTypeId, number][] = [
    ['hunter_hut', 5],
    ['farm', 4],
    ['gathering', 4],
    ['sawmill', 5],
    ['quarry', 3],
    ['mine', 2],
  ];
  for (const [type, n] of crew) s.workers[at(type)] = n;
  // Остаток — свободные руки у костра: из них выйдут кузнецы, ремесленники и
  // первые бойцы. Сколько их, столько и видно на площади.

  s.log.push({ at: 0, text: 'Посёлок стоит за стеной, у ворот рынок, в кузнице холодный горн. Соседи не дремлют.', kind: 'info' });
  s.log.push({ at: 0, text: 'Поставь кузнеца к горну, скуй копьё и найми первого бойца — дальше карта.', kind: 'info' });
  return s;
}
