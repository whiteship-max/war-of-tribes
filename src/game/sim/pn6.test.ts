// Люди и город отряда бродяги на клиенте (ПН-6, docs/gdd/path_of_sword.md, 3.3.1, 3.4, 3.7.1, 3.7.7; «Решения ПН-6»): повышение,
// разжалование и роспуск, пленные, весть «Просятся в отряд», постой и учения найма, хлеб села, рынок с ключом вольного города,
// заработки, лечение отряда. Каждое дело кладёт приказ книги отряда сервера (`outbox`).
//
// Путь включён подменой модуля. Граница области — утверждениями: отряд правда стоит у города (или правда в пути), город правда вольный,
// приход правда в окне — иначе правило мерило бы не то.
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { troopTotal } from '../battle/kinds';
import { beginRoam } from './roam';
import { standWay } from '@/world/roammove';
import { pointsIn, type RoamPoint } from '@/world/roampoints';
import { roamStub } from '../roamstubs';
import { promoteBill, promoteUnit } from '../promoterules';
import { captivesNow, demoteBand, dismissBand, promoteBand, takeCaptives } from './bandranks';
import { BAND_ASK, askAt, askTake, bandMailArrive } from './bandasks';
import { askCount } from '../askrules';
import { awayArrival } from '../mailgrid';
import { resolveEvent } from './actions';
import { lapseEvent } from './mail';
import { boardedAt, buyVillageFood, hireAt, hireBill, townStep, villageLeftAt, type TownPoint } from './roamtown';
import { boardDue, townKeyOf, villageFoodPrice, villageStock } from '../townrules';
import { buyGoods, marketLot, marketOffer, marketPress, sellGoods } from './market';
import { SHIFT } from '../shift';
import { GOOD_BY_ID } from '../data/market';
import { earnGold, earnHaul, settleEarn } from './bandearn';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_COST, MINIGAME_SHARE } from '../data/minigames';
import { YARD_BY_JOB } from '../data/yards';
import { levelOutputMult } from '../selfcost';
import { gameDaysOfMs } from '../pace';
import { townYardLevel } from '../townrules';
import { beginMinigame } from './minigames';
import { healBand } from './bandwounds';
import { takeFight } from './roamfight';
import { DAY_LENGTH } from '../constants';
import { drillRate, drillWork } from '../askrules';
import '../roamdoor';

vi.mock('../roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const NOW = 1_900_000_000_000;

/** Вольный город и село у Сицилии — общие и свои точки (поиск — утверждением). */
const POINTS = pointsIn(7, 700, 1280, 840, 1400);
const TOWN = POINTS.find((p) => p.kind === 'town') as RoamPoint;
const VILLAGE = POINTS.find((p) => p.kind === 'village') as RoamPoint;
/** Минута привоза, в который вольный город везёт товар `good` (поиск — утверждением). */
function shiftWith(s: GameState, good: string): number {
  const key = townKeyOf(TOWN.x, TOWN.y);
  for (let i = 0; i < 64; i++) if (marketOffer(s, NOW + i * SHIFT, key).some((g) => g.id === good)) return NOW + i * SHIFT;
  throw new Error(`${good} не везут`);
}

const ref = (p: RoamPoint): TownPoint => ({ id: p.id, kind: p.kind as 'town' | 'village', x: p.x, y: p.y, name: p.name, tier: p.tier });

function party(at = { x: 1, y: 1 }): GameState {
  const s = createInitialState(7);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 4, clubman: 6 }, purse: 3000, food: 200 })).toBeNull();
  s.roam!.way = standWay('normal', at, NOW - 60_000);
  return s;
}

describe('повышение, разжалование, роспуск (ГДД 3.4.2, 3.3.2)', () => {
  it('повысить — золото по правилам, обоз засчитан, приказ книги; в пути нельзя', () => {
    const s = party();
    s.roam!.gear = { spear: 1 };
    const bill = promoteBill('clubman', 'spearman', 2, { spear: 1 })!;
    expect(promoteBand(s, 'clubman', 'spearman', 2, NOW)).toBeNull();
    expect(s.roam!.purse).toBe(3000 - bill.gold);
    expect(bill.gold).toBe(2 * promoteUnit('clubman', 'spearman') - 40);
    expect(s.roam!.band).toEqual({ spearman: 6, clubman: 4 });
    expect(s.roam!.gear.spear).toBeUndefined();
    expect(s.roam!.outbox?.[0]).toMatchObject({ op: 'promote', from: 'clubman', to: 'spearman', n: 2 });
    // В пути — отказ.
    const walking = party();
    walking.roam!.way = { from: { x: 1, y: 1 }, to: { x: 9, y: 9 }, at: NOW - 1000, until: NOW + 60_000 };
    expect(promoteBand(walking, 'clubman', 'spearman', 1, NOW)).toMatch(/В пути/);
  });

  it('разжаловать — снятое в обоз, золото не возвращается; распустить — снаряжение в обоз', () => {
    const s = party();
    expect(demoteBand(s, 'spearman', 'clubman', 3, NOW)).toBeNull();
    expect(s.roam!.gear.spear).toBe(3);
    expect(s.roam!.purse).toBe(3000);
    expect(dismissBand(s, 'spearman', 1)).toBeNull();
    expect(s.roam!.gear.spear).toBe(4);
    expect(s.roam!.band).toEqual({ clubman: 9 });
    expect(s.roam!.outbox?.map((o) => o.op)).toEqual(['demote', 'dismiss']);
  });

  it('пленные после победы — доля уцелевших врагов, принимаются дубинщиками один раз', () => {
    const s = party();
    takeFight(s, { how: 'strike', id: 'vataga:1:1', name: 'Ватага', power: 40, foeMen: 30, foeLoss: 0.5, won: true, lost: {}, seed: 3, at: NOW });
    const n = Math.floor(15 * roamStub('captiveShare'));
    expect(n, 'граница: пленные есть').toBeGreaterThan(0);
    expect(captivesNow(s, NOW)).toBe(n);
    expect(takeCaptives(s, NOW)).toBeNull();
    expect(s.roam!.band.clubman).toBe(6 + n);
    expect(takeCaptives(s, NOW)).toMatch(/нет/);
    expect(s.roam!.outbox?.slice(-1)[0]).toMatchObject({ op: 'captives', n });
  });
});

describe('весть «Просятся в отряд» (ГДД 3.4.1)', () => {
  it('приходит на сетке почты по настоящему времени и сиду, не больше одной на столе', () => {
    const s = party();
    const k = 100;
    const t = awayArrival(s.seed, k);
    expect(bandMailArrive(s, t - 1, t + 1)).toBe(1);
    expect(s.inbox.map((e) => e.defId)).toEqual([BAND_ASK]);
    expect(s.roam!.ask).toEqual({ k, men: askCount(s.seed, k, askAt(s)) });
    // Следующий приход, пока весть на столе, второй не кладёт.
    const t2 = awayArrival(s.seed, k + 1);
    expect(t2 - t, 'граница: следующий приход в сроке первой вести').toBeLessThan(24 * 3600_000);
    expect(bandMailArrive(s, t + 1, t2 + 1)).toBe(0);
    expect(s.roam!.ask?.k, 'на столе — прежние просящиеся').toBe(k);
  });

  it('«Принять всех» — дубинщики и приказ книги; «Взять, сколько прокормим» — не больше хлеба; молчание — прогнать даром', () => {
    const s = party();
    const t = awayArrival(s.seed, 200);
    bandMailArrive(s, t - 1, t + 1);
    const men = s.roam!.ask!.men;
    expect(resolveEvent(s, 0).error).toBeNull();
    expect(s.roam!.band.clubman).toBe(6 + men);
    expect(s.roam!.outbox?.slice(-1)[0]).toMatchObject({ op: 'join', k: 200, n: men });

    const hungry = party();
    hungry.roam!.cargo.food = 0;
    const t3 = awayArrival(hungry.seed, 300);
    bandMailArrive(hungry, t3 - 1, t3 + 1);
    expect(askTake(hungry)).toBe(0);
    expect(resolveEvent(hungry, 1).error).toMatch(/Хлеба/);
    expect(lapseEvent(hungry)).not.toBeNull();
    expect(hungry.roam!.ask).toBeUndefined();
    expect(hungry.roam!.band.clubman).toBe(6);
  });

  it('число — от ступени престижа, лагеря, сезона и духа', () => {
    const s = party();
    const open = askCount(s.seed, 5, { stage: 4, camp: 'open', winter: false, morale: 60 });
    const hidden = askCount(s.seed, 5, { stage: 4, camp: 'hidden', winter: false, morale: 60 });
    const low = askCount(s.seed, 5, { stage: 0, camp: 'none', winter: false, morale: 60 });
    const winter = askCount(s.seed, 5, { stage: 4, camp: 'open', winter: true, morale: 60 });
    const sad = askCount(s.seed, 5, { stage: 4, camp: 'open', winter: false, morale: 10 });
    expect(open).toBeGreaterThan(hidden);
    expect(open).toBeGreaterThan(low);
    expect(open).toBeGreaterThan(winter);
    expect(open).toBeGreaterThan(sad);
  });
});

describe('город и село (ГДД 3.4.3, 3.3.4, 4.2)', () => {
  it('постой — плата за голову и игровой день, только в клетке города', () => {
    expect(TOWN, 'граница: вольный город есть').toBeDefined();
    const s = party({ x: TOWN.x, y: TOWN.y });
    expect(boardedAt(s.roam!, NOW)?.name).toBe(TOWN.name);
    townStep(s, DAY_LENGTH, NOW);
    expect(s.roam!.purse).toBeCloseTo(3000 - boardDue(10, DAY_LENGTH), 9);
    const field = party({ x: TOWN.x + 1, y: TOWN.y });
    expect(boardedAt(field.roam!, NOW)).toBeNull();
  });

  it('найм — припас и снаряжение из обоза, недостающее с рынка города; учения идут, пока стоят у города', () => {
    const s0 = party({ x: TOWN.x, y: TOWN.y });
    const now = shiftWith(s0, 'eq:spear');
    const s = party({ x: TOWN.x, y: TOWN.y });
    const p = ref(TOWN);
    const bill = hireBill(s, p, 'spearman', 2, now);
    expect(bill.block).toBeNull();
    expect(bill.fromCargo.food).toBe(28);
    expect(bill.buy['eq:spear']).toBe(2);
    expect(bill.gold).toBe(marketLot(s, GOOD_BY_ID['eq:spear'], 2, now, townKeyOf(TOWN.x, TOWN.y)).gold);
    expect(hireAt(s, p, 'spearman', 2, now)).toBeNull();
    expect(s.roam!.purse).toBe(3000 - bill.gold);
    expect(s.roam!.outbox?.slice(-1)[0]).toMatchObject({ op: 'hire', kind: 'spearman', n: 2, at: { x: TOWN.x, y: TOWN.y } });
    const work = drillWork('spearman') * 2;
    townStep(s, work / drillRate('spearman') - 1, now);
    expect(s.roam!.band.spearman).toBe(4);
    townStep(s, 2, now);
    expect(s.roam!.band.spearman).toBe(6);
    expect(s.roam!.drill).toBeUndefined();
  });

  it('учения стоят, пока отряд в пути: ушёл — заказ ждёт', () => {
    const now = shiftWith(party({ x: TOWN.x, y: TOWN.y }), 'eq:spear');
    const s = party({ x: TOWN.x, y: TOWN.y });
    expect(hireAt(s, ref(TOWN), 'spearman', 1, now)).toBeNull();
    const work = s.roam!.drill![0].work;
    s.roam!.way = { from: { x: TOWN.x, y: TOWN.y }, to: { x: TOWN.x + 9, y: TOWN.y }, at: now - 1000, until: now + 3_600_000 };
    townStep(s, 1, now);
    expect(s.roam!.drill?.[0]?.work, 'в пути учений нет').toBe(work);
    expect(s.roam!.band.spearman).toBe(4);
  });

  it('хлеб села — цена села (доля продажи рынка от основы), запас дня, обоз', () => {
    expect(VILLAGE, 'граница: село есть').toBeDefined();
    expect(villageFoodPrice()).toBeGreaterThan(1);
    expect(villageFoodPrice()).toBeLessThan(GOOD_BY_ID.food.price);
    const s = party({ x: VILLAGE.x, y: VILLAGE.y });
    s.roam!.cargo = {};
    const p = ref(VILLAGE);
    expect(buyVillageFood(s, p, 40, NOW)).toBeNull();
    expect(s.roam!.cargo.food).toBe(40);
    expect(s.roam!.purse).toBe(3000 - Math.ceil(40 * villageFoodPrice()));
    expect(villageLeftAt(s.roam!, p.id, NOW)).toBe(villageStock() - 40);
    expect(buyVillageFood(s, p, villageStock(), NOW)).toMatch(/запас дня/);
  });

  it('рынок с ключом вольного города — обоз и кошель отряда; рынок лорда не тронут', () => {
    const s = party({ x: TOWN.x, y: TOWN.y });
    const key = townKeyOf(TOWN.x, TOWN.y);
    const now = shiftWith(s, 'eq:spear');
    const lot = marketLot(s, GOOD_BY_ID['eq:spear'], 1, now, key);
    expect(buyGoods(s, 'eq:spear', 1, now, key)).toBeNull();
    expect(s.roam!.gear.spear).toBe(1);
    expect(s.roam!.purse).toBe(3000 - lot.gold);
    expect(s.caravans).toEqual([]);
    expect(s.roam!.markets?.[key]?.bought['eq:spear']).toBe(1);
    // Купленная штука — нажим у этого города; у рынка лорда нажима нет.
    expect(marketPress(s, 'eq:spear', now, key)).toBe(1);
    expect(marketPress(s, 'eq:spear', now)).toBe(0);
    expect(sellGoods(s, 'eq:spear', 1, now, key)).toBeNull();
    expect(s.roam!.gear.spear).toBeUndefined();
    expect(s.market.bought).toEqual({});
  });

  it('заработки — золото по цене продажи рынка, хозяина не касается, один раз на поход', () => {
    const s = party({ x: TOWN.x, y: TOWN.y });
    const out = beginMinigame(s, 'berries', NOW);
    expect(typeof out).not.toBe('string');
    const got = settleEarn(s, out as Exclude<typeof out, string>, ref(TOWN), NOW, 1);
    expect(typeof got).not.toBe('string');
    const gold = earnGold(earnHaul(TOWN.tier as 1 | 2 | 3, 'berries', 1));
    // Мерка — один работник на месте двора уровня ступени (решение ПН-6), доля игры — та же, что у промысла лорда.
    const one = (MINIGAME_SHARE * MINIGAME_COST * YARD_BY_JOB.get('gatherer')!.yield.food! * levelOutputMult(townYardLevel(TOWN.tier as 1 | 2 | 3)) * gameDaysOfMs(ENERGY_REFILL)) / ENERGY_MAX;
    expect(earnHaul(TOWN.tier as 1 | 2 | 3, 'berries', 1).food).toBe(Math.floor(one + 1e-9));
    expect(gold, 'граница: добыча есть').toBeGreaterThan(0);
    expect(s.roam!.purse).toBe(3000 + gold);
    expect(settleEarn(s, out as Exclude<typeof out, string>, ref(TOWN), NOW, 1)).toMatch(/засчитана/);
  });
});

describe('лечение отряда за алмазы (ГДД 3.3.1)', () => {
  it('раненые отряда со сроком не позже названного встают', () => {
    const s = party();
    s.time = 100;
    s.roam!.wounded = [
      { troops: { spearman: 2 }, until: 150 },
      { troops: { clubman: 1 }, until: 900 },
    ];
    expect(healBand(s, 150)).toBe(2);
    expect(s.roam!.band.spearman).toBe(6);
    expect(troopTotal(s.roam!.wounded[0].troops)).toBe(1);
  });
});
