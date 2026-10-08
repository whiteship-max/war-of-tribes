// Лазутчик против соседа-игрока — одна дверь расчёта на сервер войны и на меню (docs/spy_pvp.md).
//
// ИСХОД СЧИТАЕТ СЕРВЕР. Этот модуль чистый — ни часов, ни хранилища, ни `Math.random`: шанс, гибель, кость и то, что
// дело сделало с городом, — функции от входа. Зовёт его `netlify/lib/war.ts` (приказ, ход времени, меню до приказа);
// клиент его исхода не считает и не присылает, он только применяет то, что сказал сервер.
//
// ОДНОЙ ДВЕРЬЮ С ДЕЛАМИ ПРОТИВ ЛОГОВ. Шанс — `spy.spyChance` (трудность дела — строкой `data/spy.RIVAL_DEEDS`), стража —
// `spy.guardOf`, гибель — `peril.perilOf` и `peril.diesAt`, «заметили ли провал» — `agents.slipped`, что уносят и что
// горит — `spoils.plunder` (та же дверь, что делит склад взятого города). Своей арифметики у дел против игрока нет —
// только числа дизайна `data/spy.RIVAL_POWER` и `RIVAL_GUARD`.
//
// ЗАЩИТА СОСЕДА — стража (мощь тех, кто дома), его Дозор и его лазутчик дома. Чем сильнее охрана, тем ниже шанс — и тем
// чаще провал, а провал, которого не скрыла скрытность, и есть поимка: плен (задержание) или гибель своей костью.
import { seeded } from '@/game/sim/random';
import { troopPower } from '@/game/battle/price';
import type { TroopStack } from '@/game/battle/kinds';
import { hashId } from './diplomacy';
import { guardOf, spyChance } from './spy';
import { diesAt, perilOf, perilShare, perilWhy, type PerilCase } from './peril';
import { slipped } from './agents';
import { plunder } from './spoils';
import { stackCarry } from './data/units';
import { RIVAL_DEED_BY_ID, RIVAL_GUARD, RIVAL_POWER } from './data/spy';
import type { Loot, RivalDeedId } from './types';

export const RIVAL_DEED_IDS = ['look', 'fire', 'theft', 'unrest'] as const satisfies readonly RivalDeedId[];

/** Числа по видам — как в договоре (`contract.Counts`). */
type Counts = Record<string, number>;

/** Что дело защиты знает о соседе: мощь тех, кто дома, его Дозор и стоит ли его лазутчик дома. */
export interface RivalDefence {
  /** Мощь тех, кто дома (`troopPower` гарнизона и дружины у ворот). */
  homePower: number;
  /** Дозор соседа (`intelKeen`, от единицы). */
  keen: number;
  /** Его лазутчик дома — у ворот или в городе. */
  spyHome: boolean;
}

/** Мощь тех, кто дома, — по видам слепка обороны. */
export const homePowerOf = (home: Counts): number => troopPower(home as TroopStack);

/** Стража города против лазутчика: та же `guardOf`, что у логова (замок), с Дозором соседа и его лазутчиком дома. */
export function rivalGuard(d: RivalDefence): number {
  return guardOf(d.homePower, true) * Math.max(1, d.keen) ** RIVAL_GUARD.watch * (d.spyHome ? RIVAL_GUARD.counter : 1);
}

/** Шанс дела — та же `spyChance`, что у логова: Дозор нападающего, стража соседа, даль. */
export const rivalChance = (deed: RivalDeedId, keen: number, guard: number, distance: number): number =>
  spyChance({ action: deed, keen, guard, distance });

/**
 * Обстановка гибели у города соседа: скрытность нападающего, час и время года **в городе соседа** (темнота прячет там,
 * куда идут), память заходов этого игрока к этому городу, даль. Спелость — единица: город всегда настороже, как замок.
 */
export const rivalPerilCase = (veil: number, villageTime: number, visits: number, distance: number): PerilCase => ({
  veil: Math.max(0, Math.min(1, veil)),
  ripeness: 1,
  villageTime: Math.max(0, villageTime),
  visits,
  distance,
  city: true,
});

/** Гибель долей — замером той же `diesAt`, что решит исход (`peril.perilShare`), и две причины словами. */
export function rivalPeril(c: PerilCase): { peril: number; why: string[] } {
  return { peril: perilShare(perilOf(c)), why: perilWhy(c) };
}

/**
 * Две кости дела из номера дела: исход и гибель. Своя кость гибели без шанса дела в зерне — как у логова
 * (`spy.spyDeathRoll`): Дозор, поднявший шанс, гибель не перебрасывает. Номер дела назначает сервер при приказе, и тот
 * же номер даёт те же кости, кто бы и когда ни разбирал приход.
 */
export function rivalRolls(id: string): { deed: number; death: number } {
  return { deed: seeded(hashId(`rival|${id}|deed`))(), death: seeded(hashId(`rival|${id}|death`))() };
}

/** Чем кончилось дело для самого лазутчика. */
export interface RivalFate {
  ok: boolean;
  /** Провал, которого не заметили (скрытность): ушёл тихо, никто не знает, чей он. */
  slipped: boolean;
  /** Схвачен и держат (плен). */
  held: boolean;
  /** Погиб — своей костью, удача дела её не отменяет. */
  dead: boolean;
}

/** Исход дела для лазутчика: удача, тихий провал, плен или гибель — чистая функция от шанса, гибели и костей. */
export function rivalFate(chance: number, peril: number, stealth: number, rolls: { deed: number; death: number }): RivalFate {
  const ok = rolls.deed < chance;
  const miss = ok || chance >= 1 ? 0 : Math.max(0, Math.min(1, (rolls.deed - chance) / (1 - chance)));
  const dead = diesAt(rolls.death, peril);
  const quiet = !ok && !dead && slipped(miss, stealth);
  return { ok, slipped: quiet, held: !ok && !quiet && !dead, dead };
}

/** Город соседа, каким его видит дело: склад, казна, тайник, горожане — из слепка обороны. */
export interface RivalCity {
  stock: Counts;
  gold: number;
  stash: number;
  pop: number;
}

/** Что дело сделало с городом. Все числа положительные: потеря у соседа, а у кражи и смуты — ровно столько же у нас. */
export interface RivalHarm {
  /** Сгорело со склада (поджог). Казна не горит. */
  burned?: Counts;
  /** Унесено со склада и из казны (кража, ключ `gold` — казна). Ровно это получает нападающий. */
  stolen?: Counts;
  /** Ушло горожан к нападающему (смута). */
  lured?: number;
  /** Дух города (смута), отрицательный. */
  morale?: number;
}

/** Склад без алмазов: алмазы не лежат на складе и не переходят никаким делом (CLAUDE.md, «Алмазы»). */
function goodsOf(stock: Counts): Loot {
  const out: Loot = {};
  for (const [k, v] of Object.entries(stock)) if (k !== 'gems' && k !== 'gold' && (v ?? 0) > 0) out[k as keyof Loot] = Math.floor(v);
  return out;
}

const counts = (l: Loot): Counts => {
  const out: Counts = {};
  for (const [k, v] of Object.entries(l)) if ((v ?? 0) > 0) out[k] = v as number;
  return out;
};

/** Сколько всего лежит сверх тайника — той же меркой, что `plunder` (тайник по каждому припасу). */
const openTotal = (stock: Loot, stash: number): number =>
  Object.values(stock).reduce((n: number, v) => n + Math.max(0, Math.floor(v ?? 0) - Math.max(0, stash)), 0);

/** Сколько поклажи уносит лазутчик — той же `stackCarry`, что обоз войска. */
export const theftCarry = (): number => stackCarry({ warrior: RIVAL_POWER.theftCarriers });

/**
 * Что удавшееся дело сделало с городом. Разведка не трогает ничего. Поджог и кража делят склад той же `plunder`, что
 * участь взятого города: тайник не трогают, взятое не больше лежащего на виду. Кража — переход: что ушло у соседа, ровно
 * то и пришло к нападающему (`stolen` одно на обе стороны).
 */
export function rivalHarm(deed: RivalDeedId, city: RivalCity): RivalHarm {
  if (deed === 'fire') {
    const stock = goodsOf(city.stock);
    const burn = Math.floor(openTotal(stock, city.stash) * RIVAL_POWER.fireShare);
    const burned = counts(plunder(stock, city.stash, burn).taken);
    return Object.keys(burned).length ? { burned } : {};
  }
  if (deed === 'theft') {
    const all: Loot = { ...goodsOf(city.stock), gold: Math.max(0, Math.floor(city.gold)) };
    const carry = Math.min(theftCarry(), Math.floor(openTotal(all, city.stash) * RIVAL_POWER.theftShare));
    const stolen = counts(plunder(all, city.stash, carry).taken);
    return Object.keys(stolen).length ? { stolen } : {};
  }
  if (deed === 'unrest') {
    const pop = Math.max(0, Math.floor(city.pop));
    // Последний житель не уходит никогда — то же правило, что у участи взятого города.
    const lured = Math.max(0, Math.min(RIVAL_POWER.unrestCap, Math.floor(pop * RIVAL_POWER.unrestShare), pop - 1));
    return { morale: RIVAL_POWER.unrestMorale, ...(lured > 0 ? { lured } : {}) };
  }
  return {};
}

/** Нападение ли дело — вредит ли его удача городу. По нему бот пишет соседу (docs/NOTIFY.md, docs/spy_pvp.md). */
export const rivalHostile = (deed: RivalDeedId): boolean => RIVAL_DEED_BY_ID[deed].hostile;
