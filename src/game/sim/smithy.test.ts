import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { ATTENTION_META, buildingAttention, buildingOfType, forgeInfo, alerts } from '../derived';
import { assignWorker } from './workers';
import { cancelForge, forgeCheck, startForge } from './smithy';
import { study, studyInfo } from './tech';
import { POINTS_CAP } from '../data/realm';

/**
 * Кузница с людьми у горна и складом, которого хватает на любой заказ. Все
 * прочие дворы пустые нарочно: заказ мерится по складу, а добыча со стороны
 * сбивала бы счёт.
 */
function smithy(hands = 4): GameState {
  const s = createInitialState();
  s.workers = {};
  s.freeJobs = {};
  for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 3000;
  const b = buildingOfType(s, 'smithy')!;
  if (hands > 0) assignWorker(s, b.id, hands);
  learnWar(s);
  return s;
}
/**
 * Военная ветвь изучена целиком: здесь проверяют кузницу, а не гейт. Ступени покупаются
 * настоящей дверью (`sim/tech.study`) — подставляются только очки, потому что копить их
 * часами деревни значило бы сдвинуть сезон, а сезон в этих проверках участвует.
 */
function learnWar(s: GameState): void {
  while (studyInfo(s, 'war').next > 0) {
    s.realm.points.war = POINTS_CAP;
    s.realm.pointsAt = s.time;
    if (study(s, 'war') !== null) break;
  }
}


/** Крутим время, пока очередь не опустеет: точную скорость знать не надо. */
function untilDone(s: GameState, limit = 3000): void {
  for (let i = 0; i < limit && s.forge.length > 0; i++) tick(s, 1);
}

const forgeBuilding = (s: GameState) => buildingOfType(s, 'smithy')!;

describe('кузница: заказы', () => {
  it('заказ на десять делает ровно десять и встаёт', () => {
    const s = smithy();
    expect(startForge(s, 'spear', 10)).toBeNull();
    untilDone(s);
    expect(s.equipment.spear).toBe(10);
    expect(s.forge).toHaveLength(0);
    // И дальше не куёт: ни одиннадцатого копья, ни чего-либо ещё.
    catchUp(s, 600, 1);
    expect(s.equipment.spear).toBe(10);
  });

  it('ресурсы списываются при постановке, а не по предмету', () => {
    const s = smithy();
    const def = EQUIPMENT_BY_ID.sword;
    const iron0 = s.resources.iron;
    expect(startForge(s, 'sword', 6)).toBeNull();
    expect(s.resources.iron).toBe(iron0 - (def.cost.iron ?? 0) * 6);
    // Дальше склад не трогается вовсе: за заказ уже заплачено.
    const iron1 = s.resources.iron;
    const copper1 = s.resources.copper;
    catchUp(s, 200, 1);
    expect(s.equipment.sword).toBeGreaterThan(0);
    expect(s.resources.copper).toBe(copper1);
    expect(s.resources.iron).toBe(iron1);
  });

  it('очередь идёт последовательно, остаток работы переходит следующему', () => {
    const s = smithy();
    expect(startForge(s, 'spear', 2)).toBeNull();
    expect(startForge(s, 'bow', 2)).toBeNull();
    expect(s.forge).toHaveLength(2);
    // Пока идёт первый, второй ждёт и не растёт.
    tick(s, 20);
    expect(s.forge[0].item).toBe('spear');
    expect(s.forge[1].work).toBe(0);
    untilDone(s);
    expect(s.equipment.spear).toBe(2);
    expect(s.equipment.bow).toBe(2);
    expect(s.forge).toHaveLength(0);
  });

  it('заказ доводится в офлайне так же, как при непрерывной игре', () => {
    const offline = smithy();
    startForge(offline, 'sword', 8);
    catchUp(offline, 4 * 3600, 2);
    expect(offline.equipment.sword).toBe(8);

    const online = smithy();
    startForge(online, 'sword', 8);
    for (let i = 0; i < 4 * 3600; i++) tick(online, 1);
    expect(online.equipment.sword).toBe(8);
  });

  it('весь заказ — одна строка в летописи, а не строка на предмет', () => {
    const s = smithy();
    s.log = [];
    startForge(s, 'spear', 12);
    untilDone(s);
    const lines = s.log.filter((l) => l.text.includes('Кузница'));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('12');
    expect(lines[0].n ?? 1).toBe(1);
  });

  it('отмена: нетронутое целиком, начатое наполовину', () => {
    const s = smithy();
    const def = EQUIPMENT_BY_ID.spear;
    const wood0 = s.resources.wood;
    startForge(s, 'spear', 4);
    expect(s.resources.wood).toBe(wood0 - (def.cost.wood ?? 0) * 4);
    // Один готов, над вторым уже стучали.
    for (let i = 0; i < 600 && !(s.forge[0]?.done > 0 && s.forge[0]?.work > 0); i++) tick(s, 1);
    const order = s.forge[0];
    expect(order.done).toBeGreaterThan(0);
    expect(order.work).toBeGreaterThan(0);
    const left = order.count - order.done;
    // Мерим ровно возврат: за прошедшие тики склад мог пополниться наградой
    // задания, и считать его от начала было бы мерить не то.
    const before = s.resources.wood;
    cancelForge(s, order.id);
    const back = (def.cost.wood ?? 0) * (left - 1) + Math.floor((def.cost.wood ?? 0) / 2);
    expect(s.resources.wood).toBe(before + back);
    expect(s.forge).toHaveLength(0);
  });

  it('простаивающая кузница видна: маркер, тревога и строка в панели', () => {
    const s = smithy();
    const b = forgeBuilding(s);
    // Кузнецы есть, заказов нет — это и есть простой.
    expect(forgeInfo(s).idle).toBe(true);
    expect(buildingAttention(s, b)).toBe('order');
    expect(ATTENTION_META.order.text).toMatch(/заказ/i);
    expect(alerts(s).some((a) => a.id === 'forge-idle')).toBe(true);
    expect(forgeInfo(s).blocked).toMatch(/Заказов нет/);

    // Заказ поставлен — простоя нет.
    startForge(s, 'spear', 3);
    expect(forgeInfo(s).idle).toBe(false);
    expect(buildingAttention(s, b)).not.toBe('order');
    expect(alerts(s).some((a) => a.id === 'forge-idle')).toBe(false);

    // Заказ кончился — простой вернулся сам.
    untilDone(s);
    expect(forgeInfo(s).idle).toBe(true);
    expect(alerts(s).some((a) => a.id === 'forge-idle')).toBe(true);
  });

  it('кузница без людей не «простаивает» — она пуста, и лечится это людьми', () => {
    const s = smithy(0);
    expect(forgeInfo(s).idle).toBe(false);
    expect(buildingAttention(s, forgeBuilding(s))).toBe('idle');
    expect(alerts(s).some((a) => a.id === 'forge-idle')).toBe(false);
  });

  it('без материалов заказ не ставится, и сказано об этом прямо', () => {
    const s = smithy();
    for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 1;
    const check = forgeCheck(s, 'armor', 5);
    expect(check.blocked).toMatch(/Не хватает запасов/);
    expect(startForge(s, 'armor', 5)).toBe(check.blocked);
    expect(s.forge).toHaveLength(0);
  });

  it('снятые с горна кузнецы останавливают заказ, а не отменяют его', () => {
    const s = smithy();
    startForge(s, 'sword', 3);
    for (let i = 0; i < 600 && s.equipment.sword === 0; i++) tick(s, 1);
    const b = forgeBuilding(s);
    s.workers[b.id] = 0;
    const made = s.equipment.sword;
    expect(made).toBeGreaterThan(0);
    catchUp(s, 600, 1);
    expect(s.equipment.sword).toBe(made);
    expect(forgeInfo(s).blocked).toMatch(/никто не работает/);
    // Вернули людей — заказ пошёл дальше с того же места.
    assignWorker(s, b.id, 4);
    untilDone(s);
    expect(s.equipment.sword).toBe(3);
  });
});
