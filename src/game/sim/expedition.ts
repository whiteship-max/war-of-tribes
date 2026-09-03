// Последствия походов для племени. Мир считает исход боя сам; сюда приезжает
// готовый итог, и племя применяет его к себе. Про карту, соседей и координаты
// эта сторона по-прежнему ничего не знает.
import type { GameState, LogEntry, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { homeArmy, jobCounts, storageCap } from '../derived';
import { removeSoldiers } from './army';
import { removeVillager } from './population';
import { log } from './log';

/** Что случилось с деревней, пока отряд был в пути. */
export interface ExpeditionOutcome {
  /** Погибшие воины и разведчики. */
  warriorsLost: number;
  scoutsLost: number;
  /** Плюс — привезли добычу, минус — унесли у нас. */
  resources: Partial<Record<ResourceId, number>>;
  /** Золото из чужой казны. Вместимость склада на него не действует. */
  gold: number;
  prestige: number;
  morale: number;
  /** Для статистики племени: только настоящие бои. */
  battle: 'won' | 'lost' | null;
  text: string;
  kind: LogEntry['kind'];
}

/**
 * Кого можно отправить прямо сейчас: бойцы из армии и свободные жители под разведку.
 * Отдельной профессии «воин» больше нет — армия живёт счётчиками в s.army.
 */
export function sendableUnits(s: GameState): { warrior: number; scout: number } {
  const counts = jobCounts(s);
  return {
    warrior: homeArmy(s),
    scout: Math.max(0, counts.idle - Math.max(0, s.scoutsAway)),
  };
}

/** Сколько людей числится в походе. Считается миром и переставляется целиком. */
export function setAway(s: GameState, warriors: number, scouts: number): void {
  s.warriorsAway = Math.max(0, Math.round(warriors));
  s.scoutsAway = Math.max(0, Math.round(scouts));
}

/** Убирает n свободных жителей (разведчиков) и возвращает их имена. */
function takeFallenScouts(s: GameState, n: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    // Племя не должно вымереть целиком из-за неудачной разведки.
    if (s.villagers.length <= 1) break;
    const v = s.villagers.find((x) => x.job === 'idle') ?? null;
    if (!v) break;
    removeVillager(s, v.id);
    s.stats.died++;
    names.push(v.name);
  }
  return names;
}

/**
 * Применяет итог похода: погибшие, добыча или потери склада, слава и мораль.
 * Ушедших в поход пересчитывает мир — здесь их число не трогаем.
 */
export function applyExpedition(s: GameState, o: ExpeditionOutcome): void {
  // Бойцы гибнут из армии, слабые первыми; разведчики — из свободных жителей.
  const soldiersLost = removeSoldiers(s, o.warriorsLost);
  s.stats.died += soldiersLost;
  const fallen = takeFallenScouts(s, o.scoutsLost);

  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = o.resources[r];
    if (!n) continue;
    s.resources[r] = Math.max(0, Math.min(cap, s.resources[r] + n));
  }

  if (o.gold) s.gold = Math.max(0, s.gold + o.gold);
  if (o.prestige) s.prestige = Math.max(0, s.prestige + o.prestige);
  if (o.morale) s.morale = Math.max(0, Math.min(100, s.morale + o.morale));
  if (o.battle === 'won') s.stats.battlesWon++;
  if (o.battle === 'lost') s.stats.battlesLost++;

  log(s, o.text, o.kind);
  if (o.gold > 0) log(s, `В казну легло золота: ${Math.round(o.gold)}.`, 'good');
  if (soldiersLost > 0) log(s, `Не вернулись из похода: бойцов — ${soldiersLost}.`, 'bad');
  if (fallen.length > 0) log(s, `Не вернулись: ${fallen.join(', ')}.`, 'bad');
}
