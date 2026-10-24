// Лазарет и «кто ест — тот считается» (docs/infirmary.md, решения 1–8).
//
// Тесты-свойства: каждая точка сначала утверждает, что она внутри области правила — раненые есть и
// мест им хватает (или не хватает, если меряется ёмкость), срок не прошёл (или прошёл), голод идёт и
// терпение Статуи кончилось. Иначе тест проходил бы даром (CLAUDE.md, правило 11). Шаг — настоящий
// (`tick`, `catchUp`, `applyExpedition`), а не формула рядом.
import { describe, expect, it, vi } from 'vitest';
import type { GameState, TroopId } from '../types';
import { createInitialState } from '../state';
import { DAY_LENGTH, RESOURCE_IDS, WOUND_DAYS } from '../constants';
import { QUESTS } from '../data/quests';
import { BUILDINGS } from '../data/buildings';
import {
  armySize,
  bedsTaken,
  foodConsumptionPerDay,
  foodShortfall,
  healShare,
  infirmaryBeds,
  mouthCount,
  payGraceDays,
  productionPerDay,
  soldierFoodPerDay,
  townFoodPerDay,
} from '../derived';
import { BATTLE_MAN, troopTotal, type TroopStack } from '../battle/kinds';
import { troopPower } from '../battle/price';
import { applyExpedition, type ExpeditionOutcome } from './expedition';
import { catchUp, tick } from './tick';
import { woundsHome, woundsOfBattle } from './infirmary';
import { fieldWoundedHome } from '@/world/bridge';
import type { FigureView } from '@/world/types';

// ВРЕМЕННО ВОЙСКО НЕ ЕСТ ДЛЯ ТЕСТА: этот тест держит расход и голод бойца при пайке — держим `TEST_ARMY_FOOD` 1;
// 0 проверяет src/game/armyfood.test.ts. Снять при возврате 1.
vi.mock('@/game/constants', async (actual) => ({ ...(await actual<object>()), TEST_ARMY_FOOD: 1 }));

const DT = 0.5;

function town(level: number): GameState {
  const s = createInitialState(4242);
  s.tutorialDone = true;
  s.nextEventAt = Infinity;
  s.completedQuests = QUESTS.map((q) => q.id);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  // Казна полна: здесь меряется лазарет, а не неуплата.
  s.gold = 1e9;
  const inf = s.buildings.find((b) => b.type === 'infirmary')!;
  inf.level = level;
  return s;
}

const battle = (lost: TroopStack, over: Partial<ExpeditionOutcome> = {}): ExpeditionOutcome => ({
  warriorsLost: troopTotal(lost),
  troopsLost: lost,
  scoutsLost: 0,
  resources: {},
  gold: 0,
  prestige: 0,
  morale: 0,
  battle: 'won',
  text: '',
  kind: 'bad',
  ...over,
});

const lying = (s: GameState, id?: TroopId): number =>
  s.wounded.filter((g) => g.until !== null).reduce((n, g) => n + (id ? (g.troops[id] ?? 0) : troopTotal(g.troops)), 0);

/**
 * Живая игра на `seconds` секунд; амбар держим полным, если не сказано иначе. Учения стоят: работа
 * заказа обнуляется перед каждым шагом — новобранцы остаются новобранцами, сколько бы ни прошло.
 */
function play(s: GameState, seconds: number, feed = true): void {
  for (let t = 0; t < seconds; t += DT) {
    for (const o of s.recruits) o.work = 0;
    tick(s, DT);
    if (feed) s.resources.food = Math.max(s.resources.food, 5000);
  }
}

describe('раненый встаёт в строй тем же бойцом со снаряжением', () => {
  it('после срока войско возвращает ровно легших, по видам; посёлок и снаряжение не меняются', () => {
    const s = town(10);
    s.army.spearman = 200;
    s.army.archer = 100;
    const pop = s.pop;
    const born = s.stats.born;
    const gear = { ...s.equipment };
    // Потери такие, чтобы весь их строй поместился: место — боец строя, и копейщик занимает два.
    const lost = { spearman: 16, archer: 8 };
    applyExpedition(s, battle(lost));
    const laidSpear = lying(s, 'spearman');
    const laidArcher = lying(s, 'archer');
    expect(laidSpear + laidArcher, 'точка внутри области: раненые легли').toBeGreaterThan(0);
    // Граница: мест хватает — раненые лёгкие, и весь их строй помещается в лазарет.
    expect(troopPower({ spearman: laidSpear, archer: laidArcher }) / BATTLE_MAN, 'строя легло').toBeLessThanOrEqual(infirmaryBeds(s));
    expect(laidSpear + laidArcher, 'точка внутри области: мест хватило всем раненым').toBe(Math.round(24 * healShare(s)));
    expect(laidSpear, 'ранены из павших этого вида, не больше').toBeLessThanOrEqual(16);
    expect(laidArcher).toBeLessThanOrEqual(8);
    expect(s.army.spearman).toBe(184);

    play(s, WOUND_DAYS * DAY_LENGTH + DT);
    expect(s.army.spearman, 'копейщики вернулись копейщиками').toBe(184 + laidSpear);
    expect(s.army.archer, 'лучники — лучниками').toBe(92 + laidArcher);
    expect(s.pop - (s.stats.born - born), 'раненый не становится жителем: посёлок вырос только приростом').toBe(pop);
    expect(s.equipment, 'снаряжение не куётся второй раз и не пропадает').toEqual(gear);
    expect(s.wounded).toEqual([]);
  });

  it('рассеянные не ранены: падение голодом и разгром полководца лазарет не кладёт', () => {
    const s = town(10);
    s.army.spearman = 100;
    applyExpedition(s, battle({ spearman: 50 }, { routed: true }));
    expect(healShare(s), 'точка внутри области: лазарет есть').toBeGreaterThan(0);
    expect(s.wounded).toEqual([]);
    expect(s.stats.died).toBe(50);
  });
});

describe('места: сверх мест раненые не выживают', () => {
  it('места общие на все бои и освобождаются только сроком', () => {
    const s = town(1);
    const beds = infirmaryBeds(s);
    expect(beds, 'мест на первом уровне — сколько дало здание').toBe(BUILDINGS.find((b) => b.id === 'infirmary')!.beds);
    // Павших столько, чтобы раненых было вдвое больше мест: дубинщик — один боец строя.
    const fall = Math.ceil((2 * beds) / healShare(s));
    s.army.clubman = 10 * fall;
    const first = woundsOfBattle(s, { clubman: fall }, undefined, false);
    expect(first.laid + first.noBed, 'точка внутри области: раненых больше мест').toBeGreaterThan(beds);
    expect(first.laid).toBe(beds);
    expect(bedsTaken(s)).toBe(beds);

    // Второй бой, пока первые лежат: мест нет, и все его раненые не выживают.
    const second = woundsOfBattle(s, { clubman: fall }, undefined, false);
    expect(second.laid, 'занятые места не отдаются второй раз').toBe(0);
    expect(second.noBed).toBe(first.laid + first.noBed);

    play(s, WOUND_DAYS * DAY_LENGTH + DT);
    expect(bedsTaken(s), 'срок прошёл — места свободны').toBe(0);
    const third = woundsOfBattle(s, { clubman: fall }, undefined, false);
    expect(third.laid).toBe(beds);
  });

  it('не выжившие сверх мест записаны погибшими, легшие — нет', () => {
    const s = town(2);
    s.army.clubman = 500;
    applyExpedition(s, battle({ clubman: 300 }));
    const laid = lying(s);
    expect(laid, 'точка внутри области: мест меньше, чем раненых').toBe(infirmaryBeds(s));
    expect(Math.round(300 * healShare(s))).toBeGreaterThan(laid);
    expect(s.stats.died).toBe(300 - laid);
  });
});

describe('срок: два игровых дня с минуты, когда легли', () => {
  it('за шаг до срока лежат, на сроке встают — и в игре, и офлайн-догоном', () => {
    for (const offline of [false, true]) {
      const s = town(10);
      s.army.spearman = 100;
      applyExpedition(s, battle({ spearman: 30 }));
      const laid = lying(s);
      expect(laid, 'точка внутри области: легли').toBeGreaterThan(0);
      const step = (sec: number) => (offline ? catchUp(s, sec, DT) : play(s, sec));
      step(WOUND_DAYS * DAY_LENGTH - 2 * DT);
      expect(s.army.spearman, `${offline ? 'догон' : 'игра'}: до срока в строю нет`).toBe(70);
      step(3 * DT);
      expect(s.army.spearman, `${offline ? 'догон' : 'игра'}: на сроке встали`).toBe(70 + laid);
    }
  });

  it('раненые полководца лежат при нём: ни мест, ни срока, пока дружина не вернулась', () => {
    const s = town(10);
    s.army.legionary = 100;
    // Латник по мощи — восемь бойцов строя: места лазарета меряются мощью (`troopPower / BATTLE_MAN`, docs/stable.md).
    applyExpedition(s, battle({ legionary: 8 }, { field: { legionary: 8 } }));
    const carried = s.wounded.filter((g) => g.until === null).reduce((n, g) => n + troopTotal(g.troops), 0);
    expect(carried, 'точка внутри области: раненые при полководце').toBe(Math.round(8 * healShare(s)));
    expect(bedsTaken(s), 'мест не занимают').toBe(0);

    play(s, 10 * WOUND_DAYS * DAY_LENGTH);
    expect(s.army.legionary, 'дружина в поле — срок не идёт, сколько бы ни прошло').toBe(92);

    woundsHome(s);
    // Граница: мест на них хватает — иначе проверялось бы не «срок идёт с возвращения», а ёмкость.
    expect(troopPower({ legionary: carried }) / BATTLE_MAN).toBeLessThanOrEqual(infirmaryBeds(s));
    expect(lying(s), 'вернулась — легли').toBe(carried);
    play(s, WOUND_DAYS * DAY_LENGTH - 2 * DT);
    expect(s.army.legionary, 'срок идёт с возвращения').toBe(92);
    play(s, 3 * DT);
    expect(s.army.legionary).toBe(92 + carried);
  });

  it('дружина «вернулась» — у ворот, или её в поле больше нет', () => {
    const general = (over: Partial<FigureView>): FigureView[] =>
      [{ id: 'general', atHome: false, gone: null, downUntil: 0, ...over } as FigureView];
    expect(fieldWoundedHome(general({}), 1000)).toBe(false);
    expect(fieldWoundedHome(general({ atHome: true }), 1000)).toBe(true);
    expect(fieldWoundedHome(general({ gone: 'died' }), 1000)).toBe(true);
    expect(fieldWoundedHome(general({ downUntil: 5000 }), 1000)).toBe(true);
    expect(fieldWoundedHome([], 1000)).toBe(true);
  });
});

describe('кто ест — тот считается: строй, новобранцы и раненые', () => {
  /** Посёлок, где на пайке и строй, и новобранцы на учениях, и раненые. */
  function mouths(): GameState {
    const s = town(10);
    s.army.spearman = 300;
    s.recruits = [{ id: 1, troop: 'spearman', count: 300, done: 0, work: 0, people: 300 }];
    s.wounded = [{ troops: { spearman: 300 }, until: s.time + 1e9 }];
    return s;
  }

  it('расход и делитель голода читают один список ртов', () => {
    const s = mouths();
    expect(mouthCount(s), 'точка внутри области: едят все три').toBe(900);
    expect(foodConsumptionPerDay(s) - townFoodPerDay(s)).toBeCloseTo(900 * soldierFoodPerDay(s), 6);

    // Амбар пуст, нехватка — треть пайка всех ртов: доля некормленных — треть, а не больше.
    s.resources.food = 0;
    const short = foodConsumptionPerDay(s) - productionPerDay(s).food;
    expect(short, 'точка внутри области: нехватка есть').toBeGreaterThan(0);
    expect(short, 'точка внутри области: доля не упёрлась в потолок').toBeLessThan(900 * soldierFoodPerDay(s));
    expect(foodShortfall(s).army * 900 * soldierFoodPerDay(s)).toBeCloseTo(short, 6);
  });

  it('при голоде уходит одна и та же доля строя, новобранцев и раненых', () => {
    const s = mouths();
    s.resources.food = 0;
    s.gold = 1e9;
    const unfed = foodShortfall(s).army;
    expect(unfed, 'точка внутри области: голод').toBeGreaterThan(0);
    expect(unfed, 'точка внутри области: доля ниже потолка').toBeLessThan(1);
    // Терпение Статуи — сначала: до него не уходит никто.
    play(s, payGraceDays(s) * DAY_LENGTH + DT, false);
    expect(armySize(s), 'до конца терпения строй на месте').toBe(300);
    play(s, 3 * DAY_LENGTH, false);
    const army = 300 - armySize(s);
    const recruits = 300 - s.recruits.reduce((n, o) => n + o.count - o.done, 0);
    const wounded = 300 - troopTotal(s.wounded[0]?.troops ?? {});
    expect(army, 'точка внутри области: строй уходит').toBeGreaterThan(10);
    expect(recruits, 'новобранцы уходят той же долей').toBeGreaterThanOrEqual(army - 1);
    expect(recruits).toBeLessThanOrEqual(army + 1);
    expect(wounded, 'раненые — той же долей').toBeGreaterThanOrEqual(army - 1);
    expect(wounded).toBeLessThanOrEqual(army + 1);
  });

  it('раненые и новобранцы уходят голодом и совсем, даже когда повод шага — неуплата', () => {
    const s = mouths();
    s.recruits[0].count = 100;
    s.recruits[0].people = 100;
    s.wounded[0].troops.spearman = 100;
    s.resources.food = 0;
    s.gold = 0;
    s.tax = 'none';
    s.pay.debt = 1;
    s.pop = 10;
    const pop = s.pop;
    const born = s.stats.born;
    // Неуплата сильнее голода — ушедшие из строя возвращаются жителями, если есть крыша.
    play(s, payGraceDays(s) * DAY_LENGTH + 3 * DAY_LENGTH, false);
    const armyGone = 300 - armySize(s);
    const woundedGone = 100 - troopTotal(s.wounded[0]?.troops ?? {});
    const recruitsGone = 100 - s.recruits.reduce((n, o) => n + o.count - o.done, 0);
    expect(armyGone / 300, 'точка внутри области: строй ушёл неуплатой — большей долей, чем голодом').toBeGreaterThan(woundedGone / 100);
    expect(woundedGone, 'точка внутри области: раненые ушли голодом').toBeGreaterThan(0);
    expect(recruitsGone, 'точка внутри области: новобранцы ушли голодом').toBeGreaterThan(0);
    // Кто из ушедших остался жителем, дверь пишет в летопись по виду (`desert:<вид>:home`).
    const stayed = s.log.filter((e) => e.group?.startsWith('desert:') && e.group.endsWith(':home')).reduce((n, e) => n + (e.n ?? 1), 0);
    expect(stayed, 'точка внутри области: из строя ушли жителями').toBeGreaterThan(0);
    expect(s.pop - pop - (s.stats.born - born), 'жителями стали ровно ушедшие из строя, ни одного раненого и новобранца').toBe(stayed);
  });
});

/**
 * Раскладка держится, пока бойцы живы (docs/retinue.md, решение 9): раненые отряда полководца — в поле все, дома его
 * доля — лежат своей группой и, встав, прибавляются к счётчику партии (`GameState.risen`), по которому мир возвращает их
 * полководцу. Область правила — раненые есть, лежат и встают; что точка внутри, проверяется утверждением.
 */
describe('раненые отряда полководца встают его бойцами', () => {
  it('дома — его доля по виду, в поле — все; встав, они в гарнизоне и в счётчике, прочие — только в гарнизоне', () => {
    const s = town(10);
    s.army.spearman = 200;
    s.army.archer = 100;
    // У стены пали 20 копейщиков и 10 лучников; из копейщиков половина была его отрядом, лучников у него не было.
    applyExpedition(s, battle({ spearman: 20, archer: 10 }, { standing: { spearman: 10 } }));
    const ours = s.wounded.filter((g) => g.gen);
    const theirs = s.wounded.filter((g) => !g.gen);
    const gen = ours.reduce((n, g) => n + (g.troops.spearman ?? 0), 0);
    const laid = lying(s, 'spearman');
    expect(laid, 'точка внутри области: копейщики легли').toBeGreaterThan(1);
    expect(gen, 'его доля среди раненых копейщиков — та же, что среди павших').toBe(Math.round(laid / 2));
    expect(ours.every((g) => (g.troops.archer ?? 0) === 0), 'лучников у него не было').toBe(true);
    expect(theirs.length).toBeGreaterThan(0);

    // В поле: все раненые — его, лягут по возвращении той же отметкой.
    applyExpedition(s, battle({ spearman: 12 }, { field: { spearman: 12 } }));
    const carried = s.wounded.filter((g) => g.until === null);
    expect(carried.length, 'точка внутри области: раненые при полководце').toBe(1);
    expect(carried[0].gen).toBe(true);
    const carriedN = troopTotal(carried[0].troops);
    woundsHome(s);
    const genLying = s.wounded.filter((g) => g.gen && g.until !== null).reduce((n, g) => n + troopTotal(g.troops), 0);
    expect(genLying, 'привезённые легли его группой').toBe(gen + carriedN);

    const army = s.army.spearman;
    const all = lying(s, 'spearman');
    play(s, WOUND_DAYS * DAY_LENGTH + DT);
    expect(s.wounded, 'точка внутри области: все встали').toEqual([]);
    expect(s.army.spearman, 'встали все — в войско').toBe(army + all);
    expect(s.risen.spearman ?? 0, 'в счётчике — только его').toBe(gen + carriedN);
    expect(s.risen.archer ?? 0).toBe(0);
  });
});
