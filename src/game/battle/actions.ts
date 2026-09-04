// Действия игрока вокруг боя: оборона деревни, сохранённые схемы, выбор между
// мгновенным итогом и просмотром. Как и все действия, возвращают null при успехе
// или текст ошибки — стор покажет его тостом.
import type { GameState } from '../types';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { PLAN_META } from '@/battle';
import {
  TEMPLATES_MAX,
  cloneFormation,
  placedTroops,
  type BattlePlanTemplate,
  type Formation,
} from './formation';
import { troopTotal, type TroopStack } from './kinds';

/** Как деревня встречает набег. Заморозку проверяет панель: она знает про таймер. */
export function setDefenseFormation(s: GameState, f: Formation | null): string | null {
  s.defenseFormation = f ? cloneFormation(f) : null;
  return null;
}

/** Что игрок предпочитает после боя: сразу итог или журнал по фазам. Выбор запоминается. */
export function setBattleWatch(s: GameState, watch: boolean): string | null {
  s.battleWatch = watch;
  return null;
}

/**
 * Имя схемы выводится из состава и плана: спрашивать название на телефоне —
 * это клавиатура поверх шторки ради строки, которую всё равно никто не читает.
 */
export function templateName(troops: TroopStack, plan: Formation['plan']): string {
  const main = TROOP_IDS.filter((t) => (troops[t] ?? 0) > 0)
    .sort((a, b) => (troops[b] ?? 0) - (troops[a] ?? 0))
    .slice(0, 2)
    .map((t) => TROOP_BY_ID[t].name.toLowerCase());
  const who = main.length > 0 ? main.join(' + ') : 'пустая';
  return `${who} · ${PLAN_META[plan].name.toLowerCase()}`;
}

export function saveTemplate(s: GameState, formation: Formation): string | null {
  const troops = placedTroops(formation);
  if (troopTotal(troops) === 0) return 'Пустую схему сохранять незачем.';
  if (!s.battlePlans) s.battlePlans = [];
  if (s.battlePlans.length >= TEMPLATES_MAX) {
    return `Схем уже ${TEMPLATES_MAX}. Удали ненужную.`;
  }
  const tpl: BattlePlanTemplate = {
    id: s.nextId++,
    name: templateName(troops, formation.plan),
    troops,
    formation: cloneFormation(formation),
  };
  s.battlePlans.push(tpl);
  return null;
}

export function deleteTemplate(s: GameState, id: number): string | null {
  const i = (s.battlePlans ?? []).findIndex((t) => t.id === id);
  if (i < 0) return 'Схема не найдена.';
  s.battlePlans.splice(i, 1);
  return null;
}
