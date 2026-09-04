// Единственное место, где мир и племя знают друг о друге.
//
// Мир получает отсюда слепок деревни (сколько людей, чем обороняется, что можно
// унести) и отдаёт сюда последствия походов. Дальше вниз связи нет: симуляция
// племени не знает про координаты, а мир — про жителей и склад.
import type { GameState } from '@/game/types';
import { RESOURCE_IDS } from '@/game/constants';
import { defense, soldierPower } from '@/game/derived';
import {
  applyExpedition,
  sendableUnits,
  setAway,
  type ExpeditionOutcome,
} from '@/game/sim/expedition';
import type { HomeEffect, Loot, MarchView, PlayerProfile } from './types';

/** Слепок деревни для мира. Считается заново перед каждым обращением. */
export function playerProfile(s: GameState): PlayerProfile {
  const units = sendableUnits(s);
  const resources: Loot = {};
  for (const r of RESOURCE_IDS) resources[r] = Math.floor(s.resources[r]);
  return {
    name: 'Наше племя',
    pop: s.villagers.length,
    defense: defense(s),
    // Мощь одного бойца — среднее по составу армии: мир считает отряд числами,
    // а состав знает только племя.
    warriorPower: soldierPower(s),
    units: { warrior: units.warrior, scout: units.scout },
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
