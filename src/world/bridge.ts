// Единственное место, где мир и племя знают друг о друге.
//
// Мир получает отсюда слепок деревни (сколько людей, чем обороняется, что можно
// унести) и отдаёт сюда последствия походов. Дальше вниз связи нет: симуляция
// племени не знает про координаты, а мир — про жителей и склад.
import type { GameState } from '@/game/types';
import { RESOURCE_IDS } from '@/game/constants';
import { TROOP_IDS } from '@/game/data/troops';
import { defense, homeArmyPower, soldierPower } from '@/game/derived';
import { BATTLE_MAN, type TroopStack } from '@/game/battle/kinds';
import { clampFormation, stashUnplaced, toArmySetup } from '@/game/battle/formation';
import { troopTotal } from '@/game/battle/kinds';
import {
  applyExpedition,
  sendableUnits,
  setAway,
  type ExpeditionOutcome,
} from '@/game/sim/expedition';
import type { HomeEffect, Loot, MarchView, PlayerProfile } from './types';

/**
 * Гарнизон дома по видам бойцов: ушедшие в поход в обороне не участвуют.
 * Ушедшие числятся одним числом, поэтому снимаются со слабых — так же, как
 * гибнут (`removeSoldiers`).
 */
export function homeTroops(s: GameState): TroopStack {
  let away = Math.max(0, s.warriorsAway);
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const have = Math.max(0, s.army?.[id] ?? 0);
    const gone = Math.min(have, away);
    away -= gone;
    const left = have - gone;
    if (left > 0) out[id] = left;
  }
  return out;
}

/**
 * Ополчение: та часть обороны, которую дают не бойцы, а частокол, башня и сами
 * жители. В поле оно выходит пехотой без снаряжения — иначе набеги ИИ, чей
 * потолок считается от `defense()`, били бы по пустому месту.
 */
export const militiaMen = (s: GameState): number =>
  Math.max(0, Math.round((defense(s) - homeArmyPower(s)) / BATTLE_MAN));

/** Слепок деревни для мира. Считается заново перед каждым обращением. */
export function playerProfile(s: GameState): PlayerProfile {
  const units = sendableUnits(s);
  const resources: Loot = {};
  for (const r of RESOURCE_IDS) resources[r] = Math.floor(s.resources[r]);
  const army = homeTroops(s);
  // Расстановка обороны подрезается по тому, кто сейчас дома: часть могла уйти
  // в поход или погибнуть, а нанятые с прошлого раза встают в резерв.
  let defenseSetup = null;
  if (s.defenseFormation) {
    const { formation, extra } = clampFormation(s.defenseFormation, army);
    const fitted = troopTotal(extra) > 0 ? stashUnplaced(formation, extra) : formation;
    defenseSetup = toArmySetup(fitted, militiaMen(s));
  }
  return {
    name: 'Наше племя',
    pop: s.pop,
    defense: defense(s),
    // Мощь одного бойца — среднее по составу армии: мир считает отряд числами,
    // а состав знает только племя.
    warriorPower: soldierPower(s),
    units: { warrior: units.warrior, scout: units.scout },
    army,
    militia: militiaMen(s),
    defenseSetup,
    // Золото в слепок не кладём: чужой набег уносит со склада, а не из казны.
    resources,
  };
}

/**
 * Сколько людей сейчас в походе. Число не хранится дважды: оно выводится из списка
 * походов, поэтому потерянное сохранение мира не оставит деревню без армии навсегда.
 */
export function syncAway(s: GameState, marches: MarchView[]): boolean {
  let warriors = 0;
  let scouts = 0;
  for (const m of marches) {
    if (!m.own) continue;
    warriors += m.units.warrior ?? 0;
    scouts += m.units.scout ?? 0;
  }
  if (s.warriorsAway === warriors && s.scoutsAway === scouts) return false;
  setAway(s, warriors, scouts);
  return true;
}

/** Перевод мирового последствия в понятный племени итог. */
export function toOutcome(e: HomeEffect): ExpeditionOutcome {
  return {
    warriorsLost: e.lost.warrior ?? 0,
    // Бой знает, кто именно погиб: списывать надо тех же, а не «слабых первыми».
    troopsLost: e.lostTroops,
    scoutsLost: e.lost.scout ?? 0,
    resources: e.resources,
    // Золото едет в той же добыче отдельным ключом: складом оно не считается.
    gold: e.resources.gold ?? 0,
    prestige: e.prestige,
    morale: e.morale,
    battle: e.battle,
    text: e.text,
    kind: e.good ? 'good' : 'bad',
  };
}

export function applyEffects(s: GameState, effects: HomeEffect[]): void {
  for (const e of effects) applyExpedition(s, toOutcome(e));
}
