// Золото, налог и рынок. Проверяется не то, что код что-то делает, а обещания,
// на которых держится баланс: рынок всегда дороже собственного труда, дневной
// лимит не обходится дроблением, а зима не покупается.
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { buyGoods, setTax } from './actions';
import { marketCheck, marketDepth, marketHas, marketLeft, marketLot, marketOffer, marketPrice, marketSupply } from './market';
import { assignWorker } from './workers';
import { seeded, setRandom } from './random';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { SEASONS, SEASON_DAYS, SEASON_SECONDS, YEAR_DAYS } from '../data/seasons';
import { GOODS, GOOD_BY_ID, MIN_MARKUP, offerFor, type GoodDef } from '../data/market';
import { SHIFT, buyUnit, depthOf, shiftDays, shiftOf } from '../marketrules';
import { TAXES } from '../data/policy';
import {
  buildingOfType,
  buildingSlots,
  deedBuilding,
  deedSlots,
  deedWorkers,
  foodConsumptionPerDay,
  moraleOutputMult,
  moraleTarget,
  productionPerDay,
  seasonModsFor,
  selfCost,
  taxIncomePerDay,
  taxQuote,
  workerCount,
  caravanSeconds,
} from '../derived';

beforeEach(() => setRandom(seeded(7)));

/** Ставит готовое здание нужного уровня. Тип в посёлке один, поэтому повтор задаёт уровень. */
function place(s: GameState, type: Parameters<typeof buildingOfType>[1], level = 1): void {
  const exist = s.buildings.find((b) => b.type === type);
  if (exist) {
    exist.level = level;
    exist.work = 0;
    exist.workRequired = 0;
    return;
  }
  s.buildings.push({ id: s.nextId++, type, level, work: 0, workRequired: 0 });
}

/** Расставляет людей по свободным местам зданий — иначе город ничего не производит. */
function staff(s: GameState): void {
  for (const b of s.buildings) {
    while (workerCount(s, b.id) < buildingSlots(b)) {
      if (assignWorker(s, b.id) !== null) break;
    }
  }
}

/**
 * Поздняя партия: город со всеми постройками на потолке и рынком.
 * На таком состоянии и проверяется баланс золота.
 */
function city(pop = 700, marketLevel = MAX_BUILDING_LEVEL): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  s.pop = pop;
  s.workers = {};
  s.freeJobs = {};
  for (const type of [
    'houses',
    'storage',
    'sawmill',
    'hunter_hut',
    'mine',
    'workshop',
    'farm',
    'church',
    'town_hall',
    'smithy',
    'barracks',
    'palisade',
    'tower',
  ] as const) {
    place(s, type, MAX_BUILDING_LEVEL);
  }
  place(s, 'market', marketLevel);
  staff(s);
  s.resources = { wood: 4000, stone: 4000, food: 4000, hides: 1000, charcoal: 1000, copper: 1000, iron: 1000 };
  s.morale = moraleTarget(s);
  return s;
}

/**
 * Племя, которому зимой действительно нечего есть: людей поставили на лес, камень
 * и руду, а на еду почти никого. Это и есть та самая дыра, ради которой игрок
 * бежит на рынок, — и она не должна закрываться покупкой.
 */
function hungryTribe(): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  s.pop = 240;
  s.workers = {};
  s.freeJobs = {};
  for (const type of ['houses', 'storage', 'sawmill', 'mine', 'town_hall'] as const) {
    place(s, type, 5);
  }
  // Единственный источник еды — сбор маленького Охотничьего двора: поле, загон и
  // охота стоят пустыми, люди ушли на лес, камень и руду.
  place(s, 'hunter_hut', 2);
  place(s, 'market', 5);
  for (const job of ['woodcutter', 'stonecutter', 'miner', 'gatherer'] as const) {
    const b = deedBuilding(s, job)!;
    while (deedWorkers(s, job) < deedSlots(b)) {
      if (assignWorker(s, b.id, 1, job) !== null) break;
    }
  }
  s.resources = { wood: 2000, stone: 1000, food: 1200, hides: 200, charcoal: 200, copper: 0, iron: 0 };
  s.morale = moraleTarget(s);
  return s;
}


/** Общая масса ресурсов за день — ею меряется потеря от просевшей морали. */
const totalOutput = (s: GameState): number => {
  const p = productionPerDay(s);
  return RESOURCE_IDS.reduce((n, r) => n + p[r], 0);
};

/** Самый дешёвый товар рынка: по нему считается лучшее, что можно выжать из золота. */
const cheapest = (): number => Math.min(...GOODS.filter((g) => g.resource).map((g) => g.price));

describe('золото', () => {
  it('налог включается с первого дня и казна растёт от населения', () => {
    const s = city();
    expect(setTax(s, 'high')).toBeNull();
    expect(taxIncomePerDay(s)).toBeGreaterThan(0);

    // Тот же налог в стартовом посёлке приносит заметно меньше, чем в городе: население — ценность.
    const small = createInitialState();
    small.tax = 'high';
    expect(taxIncomePerDay(small)).toBeLessThan(taxIncomePerDay(s) / 3);

    // За игровой день в казну ложится дневной сбор. Точное совпадение требовать
    // нельзя: за день посёлок мог подрасти, а с ним и сбор.
    const expected = taxIncomePerDay(s);
    const before = s.gold;
    tick(s, DAY_LENGTH, { offline: true });
    const got = s.gold - before;
    expect(got).toBeGreaterThan(expected * 0.9);
    expect(got).toBeLessThan(expected * 1.1);
  });
});

describe('налог', () => {
  it('высокий налог за год приносит меньше, чем отнимает просевшая мораль', () => {
    const s = city();
    const rate = (tax: 'none' | 'high'): { output: number; gold: number } => {
      s.tax = tax;
      // Мораль приходит к своей цели за считанные секунды — берём её сразу.
      s.morale = moraleTarget(s);
      return { output: totalOutput(s), gold: taxIncomePerDay(s) };
    };
    const free = rate('none');
    const taxed = rate('high');

    expect(taxed.gold).toBeGreaterThan(0);
    expect(taxed.output).toBeLessThan(free.output);

    // Лучшее, что можно выжать из собранного золота: самый дешёвый товар рынка,
    // по базовой цене, без роста от скупки. Реальная покупка будет только хуже.
    const boughtPerDay = taxed.gold / cheapest();
    const lostPerDay = free.output - taxed.output;
    expect(
      boughtPerDay * YEAR_DAYS,
      'высокий налог окупается — так его будут держать всегда',
    ).toBeLessThan(lostPerDay * YEAR_DAYS);
  });

  it('умеренный налог мягче высокого и по сбору, и по морали', () => {
    const s = city();
    const at = (tax: 'none' | 'moderate' | 'high'): { gold: number; morale: number } => {
      s.tax = tax;
      return { gold: taxIncomePerDay(s), morale: moraleTarget(s) };
    };
    const none = at('none');
    const mid = at('moderate');
    const high = at('high');
    expect(mid.gold).toBeGreaterThan(0);
    expect(mid.gold).toBeLessThan(high.gold);
    expect(mid.morale).toBeLessThan(none.morale);
    expect(mid.morale).toBeGreaterThan(high.morale);
  });

  it('цена на кнопке налога — те же числа, что игра насчитает при этом налоге', () => {
    const s = city();
    const was = s.tax;
    for (const t of TAXES) {
      const q = taxQuote(s, t.id);
      expect(s.tax, 'подсказка налог не меняет').toBe(was);
      const set = { ...s, tax: t.id };
      expect(q.gold).toBe(taxIncomePerDay(set));
      expect(q.morale).toBe(moraleTarget(set));
      expect(q.output).toBe(moraleOutputMult(moraleTarget(set)));
    }
    const none = taxQuote(s, 'none');
    const high = taxQuote(s, 'high');
    expect(high.gold, 'точка внутри области: налог собирает').toBeGreaterThan(none.gold);
    expect(high.morale, 'и стоит морали').toBeLessThan(none.morale);
  });

  it('последствия налога написаны на кнопке и сходятся с числами', () => {
    for (const t of TAXES) {
      expect(t.effect.length).toBeGreaterThan(0);
      // Ноль сбора — ноль платы за него, и наоборот.
      expect(t.perPop > 0).toBe(t.moralePenalty > 0);
    }
  });
});

/** 10:00 UTC — привоз 09:00–12:00 (сетка РН-1б, каждые 3 часа): рынок считает привоз по настоящим часам. */
const NOW = Date.UTC(2026, 9, 23, 10, 0);
/** Товар со склада, который привезли в этот привоз. */
const brought = (s: GameState): GoodDef => marketOffer(s, NOW).find((g) => g.resource)!;

describe('рынок', () => {
  it('купить дешевле, чем произвести, нельзя ни при каком уровне рынка, привозе и чужих продажах', () => {
    const w0 = shiftOf(NOW);
    for (const def of GOODS) {
      const floor = selfCost(def) * MIN_MARKUP;
      for (let level = 1; level <= MAX_BUILDING_LEVEL; level++) {
        const depth = depthOf(def, level);
        for (let w = w0; w < w0 + 8; w++) {
          // Самая выгодная точка привоза — первая покупка; продажи цену покупки ниже основы не сбивают.
          for (const q of [0, -depth, -10 * depth]) {
            const best = buyUnit(def, w, depth, q);
            expect(best, `${def.id} на ${level} уровне дешевле своего труда`).toBeGreaterThanOrEqual(floor);
            expect(best).toBeGreaterThanOrEqual(def.price);
          }
        }
      }
    }
  });

  it('готовое снаряжение дороже своих материалов', () => {
    for (const def of GOODS.filter((g) => g.equipment)) {
      const materials = selfCost(def);
      expect(materials).toBeGreaterThan(0);
      expect(def.price, `${def.id} дешевле, чем купить материалы`).toBeGreaterThanOrEqual(
        materials * MIN_MARKUP,
      );
    }
  });

  it('уровень рынка добавляет запас и ассортимент, но не скидку', () => {
    const food = GOOD_BY_ID.food;
    const w = shiftOf(NOW);
    expect(depthOf(food, 10)).toBeGreaterThan(depthOf(food, 1));
    expect(buyUnit(food, w, depthOf(food, 10), 0)).toBe(buyUnit(food, w, depthOf(food, 1), 0));
    const wide = offerFor(w, 10, GOODS);
    const narrow = offerFor(w, 1, GOODS);
    expect(wide.length).toBeGreaterThan(narrow.length);
    // Ассортимент выводится из номера привоза: перезагрузка его не тасует.
    expect(offerFor(w, 5, GOODS).map((g) => g.id)).toEqual(offerFor(w, 5, GOODS).map((g) => g.id));
    expect(offerFor(w + 1, 5, GOODS).map((g) => g.id)).not.toEqual(offerFor(w, 5, GOODS).map((g) => g.id));
  });

  it('цена растёт по мере скупки одного товара за привоз', () => {
    const s = city();
    const def = brought(s);
    expect(marketLot(s, def, marketDepth(s, def, NOW), NOW).last).toBeGreaterThan(marketPrice(s, def, NOW));
  });

  it('запас привоза соблюдается и не обходится дроблением покупок', () => {
    const s = city();
    s.gold = 10_000_000;
    s.resources = { ...s.resources, wood: 0, stone: 0, food: 0, hides: 0, charcoal: 0, copper: 0, iron: 0 };
    const def = brought(s);
    const limit = Math.min(marketLeft(s, def, NOW), 400);
    // Дробление не даёт ни лишней штуки, ни скидки: цена считается поштучно.
    const lot = marketLot(s, def, limit, NOW).gold;
    const goldBefore = s.gold;
    for (let i = 0; i < limit; i++) expect(buyGoods(s, def.id, 1, NOW)).toBeNull();
    expect(goldBefore - s.gold).toBe(lot);

    // Весь запас привоза разом — не больше запаса.
    const t = city();
    t.gold = 10_000_000;
    t.resources = { ...s.resources };
    const all = marketLeft(t, def, NOW);
    expect(marketCheck(t, def.id, all + 1, NOW).blocked).toMatch(/На рынке только/);
    // Новый привоз — новый запас: счёт прежнего не считается.
    expect(marketLeft(s, def, NOW + SHIFT)).toBe(marketHas(s, def, NOW + SHIFT) ? marketSupply(s, def, NOW + SHIFT) : 0);
  });

  it('запаса привоза за игровой день не хватает, чтобы прокормить посёлок с рынка', () => {
    // Общее правило, а не частный случай: сколько бы ни был уровень рынка, его
    // запас еды на игровой день меньше того, что посёлок этого размера съедает за день.
    // Значит, рынком можно заткнуть дыру, но нельзя сесть на него вместо полей.
    for (const [pop, level] of [
      [120, 1],
      [350, 5],
      [700, MAX_BUILDING_LEVEL],
    ] as const) {
      const s = city(pop, level);
      s.time = (SEASONS.indexOf('winter') + SEASONS.length) * SEASON_SECONDS;
      const eat = foodConsumptionPerDay(s, seasonModsFor('winter', 2));
      const w = shiftOf(NOW);
      // Самый щедрый привоз суток.
      const perDay = Math.max(...[0, 1, 2, 3].map((i) => marketSupply(s, GOOD_BY_ID.food, NOW + i * SHIFT))) / shiftDays();
      expect(perDay, `рынок ${level} уровня (привоз ${w}) кормит посёлок на ${pop} человек`).toBeLessThan(eat);
    }
  });

  it('зимой еду не закупить в количестве, снимающем угрозу голода', () => {
    // Племя, которое зима действительно бьёт: поля стоят, кормится сбором и охотой.
    const s = hungryTribe();
    s.time = (SEASONS.indexOf('winter') + SEASONS.length) * SEASON_SECONDS;
    const mods = seasonModsFor('winter', 2);
    const need = foodConsumptionPerDay(s, mods) - productionPerDay(s, mods).food;
    expect(need, 'зимой это племя должно проедать больше, чем добывает').toBeGreaterThan(0);

    // Самый щедрый случай: весь запас каждого привоза всю зиму, деньги не в счёт.
    const perDay = marketSupply(s, GOOD_BY_ID.food, NOW) / shiftDays();
    expect(
      perDay * SEASON_DAYS,
      'рынок закрывает зиму целиком — зима перестала быть угрозой',
    ).toBeLessThan(need * SEASON_DAYS);

    // А деньги как раз в счёт: на запас одного игрового дня уходит больше, чем приносит
    // высокий налог за всю зиму.
    s.tax = 'high';
    expect(marketLot(s, GOOD_BY_ID.food, Math.floor(perDay), NOW).gold).toBeGreaterThan(taxIncomePerDay(s) * SEASON_DAYS);
  });
});

describe('караван', () => {
  it('в пути груз не числится ни на складе, ни в доступных ресурсах', () => {
    const s = city();
    s.gold = 50_000;
    const def = brought(s);
    const good = def.id;
    const r = def.resource!;
    s.resources[r] = 0;
    const before = s.resources[r];
    const goldBefore = s.gold;
    const check = marketCheck(s, good, 5, NOW);

    expect(buyGoods(s, good, 5, NOW)).toBeNull();
    expect(s.gold).toBe(goldBefore - check.cost);
    expect(s.caravans).toHaveLength(1);
    // Пока телега в пути, склад её груза не видит. Дорога телеги — настоящие секунды, шаг — игровые:
    // шаг короче дороги при любой шкале, и это утверждается.
    const step = caravanSeconds(s) / 4;
    expect(step, 'точка внутри области: шаг короче дороги').toBeLessThan(caravanSeconds(s));
    tick(s, step, { offline: true });
    expect(s.resources[r]).toBeLessThanOrEqual(before + productionPerDay(s)[r]);
    expect(s.caravans[0].count).toBe(5);

    catchUp(s, s.caravans[0].arriveAt - s.time + 1, 1);
    expect(s.caravans).toHaveLength(0);
  });

  it('доехавший караван кладёт груз на склад, снаряжение — в счётчик снаряжения', () => {
    const s = city();
    s.gold = 50_000;
    const def = marketOffer(s, NOW).find((g) => g.equipment)!;
    const before = s.equipment[def.equipment!] ?? 0;
    expect(buyGoods(s, def.id, 1, NOW)).toBeNull();
    catchUp(s, s.caravans[0].arriveAt - s.time + 1, 1);
    expect(s.equipment[def.equipment!]).toBe(before + 1);
  });
});
