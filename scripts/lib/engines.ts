// Расчёт орудия башни: сколько лучников оно требует — одной функцией на отчёт и на тест.
//
// Правило (docs/tower.md, раздел 4): **расчёт — наименьшее число лучников, чьё жалованье от
// осады до осады не меньше цены орудия.** Цены своей у орудия нет: оно стоит, как улучшение
// башни до уровня, на котором открывается, а считается эта цена своим трудом
// (`derived.selfCost` по ресурсам), как и наём лучника.
//
// Живёт правило здесь, а не в `data/engines.ts`, нарочно: это мерка, по которой число
// выбирают, а не число, которым играют, — игре её носить незачем. Зовут её двое: раздел
// «лучник против орудия» в `npm run siege:report` (с частотой осад из своего прогона) и тест
// `scripts/lib/engines.test.ts` (с той же частотой, записанной числом и названной командой).
// Второй копии этой арифметики быть не должно: разойдись они — отчёт скажет «сходится», а
// в игре будет стоять другое.
import { BUILDINGS } from '@/game/data/buildings';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { GOOD_BY_ID } from '@/game/data/market';
import { TROOP_BY_ID } from '@/game/data/troops';
import { ENGINE_BY_ID } from '@/game/data/engines';
import { selfCost, upgradeCost, wageOf } from '@/game/derived';
import { createInitialState } from '@/game/state';
import type { EngineId, GameState, ResourceId } from '@/game/types';

/** Во что обходится припас, если добывать его своим трудом, в золоте. Не товар рынка — ноль. */
const goodPrice = (r: string): number => {
  const good = GOOD_BY_ID[r as ResourceId];
  return good ? selfCost(good) : 0;
};

/** Во что обходится набор припасов, если добывать их своим трудом, в золоте. */
export const inGold = (cost: Partial<Record<string, number>>): number =>
  Object.entries(cost).reduce((n, [r, v]) => n + goodPrice(r) * (v ?? 0), 0);

/** Наём лучника своим трудом: припасы вида плюс припасы его снаряжения. */
export function archerRecruit(): number {
  const archer = TROOP_BY_ID.archer;
  let sum = inGold(archer.cost);
  for (const [id, k] of Object.entries(archer.gear) as [keyof typeof EQUIPMENT_BY_ID, number][]) {
    sum += inGold(EQUIPMENT_BY_ID[id].cost) * k;
  }
  return sum;
}

/** Цена орудия — улучшение башни до уровня, на котором оно открывается, своим трудом. */
export function enginePrice(id: EngineId): number {
  const tower = BUILDINGS.find((b) => b.id === 'tower')!;
  return inGold(upgradeCost(tower, ENGINE_BY_ID[id].level));
}

/** Что лучник стоит от осады до осады: наём плюс жалованье за столько игровых дней. */
export const archerPerSiege = (daysPerSiege: number, g: GameState = createInitialState()): number =>
  archerRecruit() + wageOf(g, 'archer') * daysPerSiege;

/**
 * Расчёт орудия при такой частоте осад: наименьшее число лучников, окупающее цену.
 * Частота — замер, а не свойство кода: её даёт `npm run siege:report`, раздел «частота».
 */
export const crewFor = (id: EngineId, daysPerSiege: number): number =>
  Math.ceil(enginePrice(id) / archerPerSiege(daysPerSiege));
