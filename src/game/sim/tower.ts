// Орудие на башне: что стоит, готово ли и что можно поставить.
//
// Устроено как изучение округи (`sim/survey.ts`): **орудие ставится из отметки
// времени, а не из работы**. В состоянии лежит, какое орудие и когда оно встанет
// (`s.engine`), и готовность считается при чтении — тика нет, офлайн-догон просто
// проходит мимо отметки.
//
// Уровень башни — право, а не источник: орудие N-го уровня молчит, пока башня ниже
// N (например, после падения города). Отметка при этом не стирается — башню
// отстроили, и орудие снова бьёт.
import type { EngineId, GameState } from '../types';
import { ENGINES, ENGINE_BY_ID, type EngineDef } from '../data/engines';
import { BUILDING_BY_ID } from '../data/buildings';
import { buildingOfType, canAfford, towerSeats, upgradeCost, upgradeWork } from '../derived';
import { GEM_REF_RATE } from './gems';
import { log } from './log';
import { pay } from './pay';

/** Одно орудие в панели башни: чего стоит, сколько ставить и почему нельзя. */
export interface EngineOption {
  def: EngineDef;
  cost: ReturnType<typeof upgradeCost>;
  /** Сколько игровых секунд его ставят. */
  seconds: number;
  /** Почему поставить нельзя; null — можно. */
  blocked: string | null;
}

export interface EngineInfo {
  /** Что стоит или ставится; null — башня без орудия. */
  current: EngineDef | null;
  /** Бьёт ли оно: поставлено и башне хватает уровня. */
  ready: boolean;
  /** Секунд до того, как поставят; 0 — не ставится. */
  left: number;
  /** Мест лучников на башне. */
  seats: number;
  /** Уровень башни. */
  level: number;
  options: EngineOption[];
}

const TOWER = BUILDING_BY_ID.tower;

/**
 * Сколько игровых секунд ставят орудие: труд улучшения башни до его уровня
 * (`upgradeWork`), поделённый на нормативную скорость стройки — ту же, какой меряется
 * цена достройки за алмазы (`GEM_REF_RATE`). Нормативную, а не настоящую: срок не
 * должен прыгать от того, кого сняли с площади.
 */
export const engineSeconds = (def: EngineDef): number => Math.max(1, Math.round(upgradeWork(TOWER, def.level) / GEM_REF_RATE));

/** Цена орудия — улучшение башни до уровня, на котором оно открывается. */
export const engineCost = (def: EngineDef): ReturnType<typeof upgradeCost> => upgradeCost(TOWER, def.level);

/** Орудие, которое бьёт прямо сейчас; null — башня молчит. Лучников оно не считает: их считает мир. */
export function readyEngine(s: GameState): EngineDef | null {
  const id = s.engine?.id;
  if (!id) return null;
  const def = ENGINE_BY_ID[id];
  const level = buildingOfType(s, 'tower')?.level ?? 0;
  return s.time >= s.engine.until && level >= def.level ? def : null;
}

export function engineInfo(s: GameState): EngineInfo {
  const tower = buildingOfType(s, 'tower');
  const level = tower?.level ?? 0;
  const id = s.engine?.id ?? null;
  const current = id ? ENGINE_BY_ID[id] : null;
  const installing = current !== null && s.time < s.engine.until;
  const options = ENGINES.map((def): EngineOption => {
    const cost = engineCost(def);
    let blocked: string | null = null;
    if (!tower) blocked = 'Башни в посёлке нет.';
    else if (installing) blocked = `Башня занята: ставят ${current.acc}.`;
    else if (current?.id === def.id) blocked = 'Уже стоит.';
    else if (def.level > level) blocked = `Нужна башня ${def.level} уровня — сейчас ${level}.`;
    else if (!canAfford(s, cost)) blocked = 'Не хватает припаса.';
    return { def, cost, seconds: engineSeconds(def), blocked };
  });
  return {
    current,
    ready: readyEngine(s) !== null,
    left: installing ? Math.max(0, s.engine.until - s.time) : 0,
    seats: towerSeats(s),
    level,
    options,
  };
}

/**
 * Поставить орудие или сменить стоящее. Плата снимается сразу, как за стройку; пока
 * ставят, башня молчит — прежнее орудие снимают в ту же минуту.
 */
export function setEngine(s: GameState, id: EngineId): string | null {
  const option = engineInfo(s).options.find((o) => o.def.id === id);
  if (!option) return 'Такого орудия нет.';
  if (option.blocked) return option.blocked;
  const was = s.engine?.id ? ENGINE_BY_ID[s.engine.id] : null;
  pay(s, option.cost);
  s.engine = { id, until: s.time + option.seconds };
  log(
    s,
    was
      ? `Башня: снимают ${was.acc}, ставят ${option.def.acc}.`
      : `Башня: ставят ${option.def.acc}.`,
  );
  return null;
}
