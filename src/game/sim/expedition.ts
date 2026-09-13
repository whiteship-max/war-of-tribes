// Последствия походов для племени. Мир считает исход боя сам; сюда приезжает
// готовый итог, и племя применяет его к себе. Про карту, соседей и координаты
// эта сторона по-прежнему ничего не знает.
import type { Building, EquipmentId, GameState, LogEntry, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import {
  bondedCount,
  handsCount,
  healShare,
  heroDownSeconds,
  homeArmy,
  idleCount,
  isOutsideWall,
  storageCap,
} from '../derived';
import { removeSoldiers } from './army';
import { TROOP_IDS } from '../data/troops';
import type { TroopStack } from '../battle/kinds';
import { ORDER_TEXT } from '../data/order';
import { addBonded, addPop, loseBonded, losePop } from './population';
import { log } from './log';
import { loseRelic } from './faith';
import { recordBattle, recordLairBurned, recordLoot, recordRaidLoss, recordTroopsLost } from '@/profile/stats';

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
  /**
   * Сколько людей прибавилось в племени. Только плюс, и своей строки в летописи
   * у него нет: единственный источник — выкуп пленных, а про него сказано в
   * тексте самого последствия.
   */
  pop?: number;
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
  /**
   * Сколько оружия взято в логове, штук. Мир отдаёт число, а какие это будут
   * предметы, решает племя (`ARMS_TROPHY`): про кузницу и её список мир не
   * знает и знать не должен — та же условность, что у `sacked`.
   */
  arms?: number;
  /** Логово сожжено этим походом: его считает профиль. */
  lair?: boolean;
  /**
   * Невольники: плюс — приведены из павшего города, минус — уведены из нашего.
   * Кого и сколько, решает мир одним правилом на обе стороны
   * (`world/spoils.lead`); племя только прибавляет или убавляет число.
   */
  bonded?: number;
  text: string;
  kind: LogEntry['kind'];
}

/**
 * Во что превращается взятое в логове оружие. Разбойничье снаряжение простое:
 * мечей и доспехов у них не водится — за ними в кузницу. Порядок — порядок
 * раздачи: остаток от деления достаётся первым в списке, ровно так же, как мир
 * делит добычу между ресурсами.
 */
export const ARMS_TROPHY: EquipmentId[] = ['spear', 'bow', 'axe', 'shield'];

/**
 * Раскладывает взятое оружие по видам. Вместимость склада на снаряжение не
 * действует, поэтому обрезать тут нечего: полный склад не должен молча съедать
 * трофей — по той же причине, по которой он не останавливает кузницу.
 */
export function takeArms(s: GameState, arms: number): Partial<Record<EquipmentId, number>> {
  const total = Math.max(0, Math.round(arms));
  if (total <= 0) return {};
  const out: Partial<Record<EquipmentId, number>> = {};
  const per = Math.floor(total / ARMS_TROPHY.length);
  let rest = total - per * ARMS_TROPHY.length;
  for (const id of ARMS_TROPHY) {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    const n = per + extra;
    if (n <= 0) continue;
    out[id] = n;
    s.equipment[id] = Math.max(0, (s.equipment[id] ?? 0) + n);
  }
  return out;
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
  // и работа. При равенстве вперёд идёт двор постарше. Людно — это все руки на
  // местах: невольники в поле стоят там же, где вольные.
  const yards: Building[] = s.buildings
    .filter((b) => isOutsideWall(b.type))
    .sort((a, b) => handsCount(s, b.id) - handsCount(s, a.id) || b.level - a.level);

  const names: string[] = [];
  for (const b of yards.slice(0, count)) {
    const men = handsCount(s, b.id);
    // Уровень теряет только самый людный двор и только при заметном разоре:
    // снимать по уровню со всего хозяйства за каждый набег — это не игра, а налог.
    const burn = names.length === 0 && hurt >= 0.5 && b.level > 1;
    if (men === 0 && !burn) continue;
    s.workers[b.id] = 0;
    // Невольников набег не уводит — уводит их только победитель павшего города.
    // Со двора их сгоняет так же, как вольных: двор стоит, пока их не вернут.
    if (bondedCount(s, b.id) > 0) delete s.bondedWork[b.id];
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
  return losePop(s, Math.min(Math.max(0, n), Math.max(0, s.pop - 1)));
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
  const fallen = takeFallenScouts(s, o.scoutsLost);

  // Лазарет: часть тех, кого считали убитыми, отлежится и вернётся в племя.
  // Именно в племя, а не в строй: боец потерян, снаряжение потрачено, человек
  // жив. Доля упирается в INFIRMARY_HEAL_CAP — война не должна дешеветь до нуля.
  const wounded = Math.floor((soldiersLost + fallen) * healShare(s));
  if (wounded > 0) addPop(s, wounded);
  s.stats.died += Math.max(0, soldiersLost + fallen - wounded);
  recordTroopsLost(s, soldiersLost);

  const cap = storageCap(s);
  // Плюс — привезли своё, минус — унесли у нас. Профиль считает и то, и другое:
  // привезённое итогом, унесённое по ресурсам — на вопрос «что утекает» итог
  // не отвечает.
  const brought: Partial<Record<ResourceId, number>> = {};
  const taken: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) {
    const n = o.resources[r];
    if (!n) continue;
    const before = s.resources[r];
    s.resources[r] = Math.max(0, Math.min(cap, s.resources[r] + n));
    const delta = s.resources[r] - before;
    if (delta > 0) brought[r] = delta;
    else if (delta < 0) taken[r] = -delta;
  }
  recordRaidLoss(s, taken);

  // Выкупленные пленные возвращаются в племя людьми, а не в строй: боец
  // потерян, снаряжение потрачено, человек жив — то же правило, что у лазарета.
  if (o.pop && o.pop > 0) addPop(s, Math.round(o.pop));
  // Невольники из павшего города — и уведённые из нашего. Число решил мир.
  const bondedIn = o.bonded && o.bonded > 0 ? addBonded(s, o.bonded) : 0;
  const bondedOut = o.bonded && o.bonded < 0 ? loseBonded(s, -o.bonded) : 0;
  if (o.gold) s.gold = Math.max(0, s.gold + o.gold);
  const arms = takeArms(s, o.arms ?? 0);
  recordLoot(s, brought, Math.max(0, o.gold));
  // Сожжённое логово считается само по себе, а не по добыче: пустое логово тоже
  // сожжено, и победа над ним стоила того же похода.
  if (o.lair) recordLairBurned(s);
  // Золото везут только из замков: привезли — значит, замок взят.
  if (o.gold > 0) s.stats.castles = (s.stats.castles ?? 0) + 1;
  if (o.prestige) s.prestige = Math.max(0, s.prestige + o.prestige);
  if (o.morale) s.morale = Math.max(0, Math.min(100, s.morale + o.morale));
  if (o.battle === 'won') recordBattle(s, 'won');
  if (o.battle === 'lost') recordBattle(s, 'lost');

  // Прорвавшийся набег хозяйничает в поле: до того, что за стеной, он не дошёл.
  const sacked = o.sacked ? sackOutskirts(s, o.sacked) : [];
  // Реликвию уносят вместе с остальным: она вещь, а не обещание, и цена ей —
  // ровно та, что её можно потерять. Тайник её не прячет: святыню держат в
  // храме на виду, иначе она не значила бы для прихода ничего.
  const relicLost = o.sacked ? loseRelic(s) : null;
  // Герой возвращается вместе с отрядом. Разбитый отряд приносит его на щите —
  // но не насовсем: имя у племени остаётся, а через несколько дней и сам герой.
  const heroFell = o.battle === 'lost' && s.hero.marchId !== null;
  if (o.battle !== null && s.hero.marchId !== null) {
    s.hero.marchId = null;
    if (heroFell) s.hero.downUntil = s.time + heroDownSeconds();
  }

  log(s, o.text, o.kind);
  if (sacked.length > 0) {
    log(s, `Разорено за стеной: ${sacked.join(', ')}. Люди разбежались по домам.`, 'bad');
  }
  if (relicLost) log(s, `${relicLost} унесли из храма. Приход осиротел.`, 'bad');
  if (bondedOut > 0) log(s, ORDER_TEXT.ledAway(bondedOut), 'bad');
  if (bondedIn > 0) log(s, ORDER_TEXT.broughtIn(bondedIn), 'info');
  if (o.gold > 0) log(s, `В казну легло золота: ${Math.round(o.gold)}.`, 'good');
  const armsText = Object.entries(arms)
    .map(([id, n]) => `${EQUIPMENT_BY_ID[id as EquipmentId].name.toLowerCase()} — ${n}`)
    .join(', ');
  if (armsText) log(s, `Из логова принесли оружие: ${armsText}.`, 'good');
  if (soldiersLost > 0) log(s, `Не вернулись из похода: бойцов — ${soldiersLost}.`, 'bad');
  if (fallen > 0) log(s, `Не вернулись из разведки: ${fallen} чел.`, 'bad');
  if (wounded > 0) log(s, `В лазарете выходили раненых: ${wounded} чел. вернулись в племя.`, 'good');
  if (heroFell) log(s, `${s.hero.name} пал в бою. Его выходят и поставят в строй снова.`, 'bad');
}
