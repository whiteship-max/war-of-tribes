// Последствия походов для племени. Мир считает исход боя сам; сюда приезжает
// готовый итог, и племя применяет его к себе. Про карту, соседей и координаты
// эта сторона по-прежнему ничего не знает.
import type { Building, GameState, LogEntry, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { homeArmy, idleCount, isOutsideWall, storageCap, workerCount } from '../derived';
import { removeSoldiers } from './army';
import { TROOP_IDS } from '../data/troops';
import type { TroopStack } from '../battle/kinds';
import { losePop } from './population';
import { log } from './log';

/** Что случилось с деревней, пока отряд был в пути. */
export interface ExpeditionOutcome {
  /** Погибшие воины и разведчики. */
  warriorsLost: number;
  scoutsLost: number;
  /**
   * Кто именно не вернулся. Бой считает по составу отряда, поэтому потери
   * приходят поимённо по видам, а не одним числом: иначе поход из латников
   * списывал бы дубинщиков, оставшихся дома.
   */
  troopsLost?: TroopStack;
  /** Плюс — привезли добычу, минус — унесли у нас. */
  resources: Partial<Record<ResourceId, number>>;
  /** Золото из чужой казны. Вместимость склада на него не действует. */
  gold: number;
  prestige: number;
  morale: number;
  /** Для статистики племени: только настоящие бои. */
  battle: 'won' | 'lost' | null;
  /**
   * Насколько плохо кончился бой у стены, 0..1. Больше нуля — чужие хозяйничали
   * в поле: см. `sackOutskirts`. Ноль — набега не было или его отбили.
   */
  sacked?: number;
  text: string;
  kind: LogEntry['kind'];
}

/**
 * Что набег делает с хозяйством за стеной.
 *
 * Стена защищает ровно то, что за ней: до жилья, склада, кузницы и казарм чужие
 * не доходят никогда, до дворов в поле — всегда, если прорвались. В этом и смысл
 * укреплений помимо кражи со склада, и цена того, что производство вынесено
 * наружу. Что именно стоит снаружи, знает `isOutsideWall`, а не план поселения.
 *
 * Разор устроен так: работники разбегаются по всем разорённым дворам — двор
 * стоит, пока игрок не вернёт туда людей, — а самый людный из них теряет ещё и
 * уровень. Не ниже первого: сносить здание набегом нельзя, зданий по одному.
 */
export function sackOutskirts(s: GameState, severity: number): string[] {
  const hurt = Math.max(0, Math.min(1, severity));
  if (hurt <= 0) return [];
  // Дворов трогается от одного до трёх — по тому, насколько плохо кончился бой.
  const count = 1 + Math.floor(hurt * 2.99);
  // Цель выбирается не случайно: чужие идут туда, где людно, — там и добро,
  // и работа. При равенстве вперёд идёт двор постарше.
  const yards: Building[] = s.buildings
    .filter((b) => isOutsideWall(b.type))
    .sort((a, b) => workerCount(s, b.id) - workerCount(s, a.id) || b.level - a.level);

  const names: string[] = [];
  for (const b of yards.slice(0, count)) {
    const men = workerCount(s, b.id);
    // Уровень теряет только самый людный двор и только при заметном разоре:
    // снимать по уровню со всего хозяйства за каждый набег — это не игра, а налог.
    const burn = names.length === 0 && hurt >= 0.5 && b.level > 1;
    if (men === 0 && !burn) continue;
    s.workers[b.id] = 0;
    if (burn) b.level -= 1;
    names.push(`${BUILDING_BY_ID[b.type].name}${burn ? ' (−1 уровень)' : ''}`);
  }
  return names;
}

/**
 * Кого можно отправить прямо сейчас: бойцы из армии и свободные жители под разведку.
 * Отдельной профессии «воин» больше нет — армия живёт счётчиками в s.army.
 */
export function sendableUnits(s: GameState): { warrior: number; scout: number } {
  return {
    warrior: homeArmy(s),
    scout: Math.max(0, idleCount(s) - Math.max(0, s.scoutsAway)),
  };
}

/** Сколько людей числится в походе. Считается миром и переставляется целиком. */
export function setAway(s: GameState, warriors: number, scouts: number): void {
  s.warriorsAway = Math.max(0, Math.round(warriors));
  s.scoutsAway = Math.max(0, Math.round(scouts));
}

/** Убирает не вернувшихся разведчиков. Племя не вымирает целиком из-за разведки. */
function takeFallenScouts(s: GameState, n: number): number {
  const gone = losePop(s, Math.min(Math.max(0, n), Math.max(0, s.pop - 1)));
  s.stats.died += gone;
  return gone;
}

/**
 * Применяет итог похода: погибшие, добыча или потери склада, слава и мораль.
 * Ушедших в поход пересчитывает мир — здесь их число не трогаем.
 */
export function applyExpedition(s: GameState, o: ExpeditionOutcome): void {
  // Бойцы гибнут по составу отряда; если состава нет (старый поход) — слабые первыми.
  let soldiersLost = 0;
  if (o.troopsLost) {
    for (const id of TROOP_IDS) {
      const n = Math.min(Math.max(0, s.army[id] ?? 0), Math.max(0, o.troopsLost[id] ?? 0));
      if (n > 0) {
        s.army[id] -= n;
        soldiersLost += n;
      }
    }
  }
  if (soldiersLost === 0) soldiersLost = removeSoldiers(s, o.warriorsLost);
  s.stats.died += soldiersLost;
  const fallen = takeFallenScouts(s, o.scoutsLost);

  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = o.resources[r];
    if (!n) continue;
    s.resources[r] = Math.max(0, Math.min(cap, s.resources[r] + n));
  }

  if (o.gold) s.gold = Math.max(0, s.gold + o.gold);
  // Золото везут только из замков: привезли — значит, замок взят.
  if (o.gold > 0) s.stats.castles = (s.stats.castles ?? 0) + 1;
  if (o.prestige) s.prestige = Math.max(0, s.prestige + o.prestige);
  if (o.morale) s.morale = Math.max(0, Math.min(100, s.morale + o.morale));
  if (o.battle === 'won') s.stats.battlesWon++;
  if (o.battle === 'lost') s.stats.battlesLost++;

  // Прорвавшийся набег хозяйничает в поле: до того, что за стеной, он не дошёл.
  const sacked = o.sacked ? sackOutskirts(s, o.sacked) : [];

  log(s, o.text, o.kind);
  if (sacked.length > 0) {
    log(s, `Разорено за стеной: ${sacked.join(', ')}. Люди разбежались по домам.`, 'bad');
  }
  if (o.gold > 0) log(s, `В казну легло золота: ${Math.round(o.gold)}.`, 'good');
  if (soldiersLost > 0) log(s, `Не вернулись из похода: бойцов — ${soldiersLost}.`, 'bad');
  if (fallen > 0) log(s, `Не вернулись из разведки: ${fallen} чел.`, 'bad');
}
