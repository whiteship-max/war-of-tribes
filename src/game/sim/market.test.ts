// Золото, налог и рынок. Проверяется не то, что код что-то делает, а обещания,
// на которых держится баланс: рынок всегда дороже собственного труда, дневной
// лимит не обходится дроблением, а зима не покупается.
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState, GoodId } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { buyGoods, cancelCaravan, setTax } from './actions';
import { marketCheck } from './market';
import { assignWorker } from './workers';
import { seeded, setRandom } from './random';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { SEASONS, SEASON_DAYS, SEASON_SECONDS, YEAR_DAYS } from '../data/seasons';
import { GOODS, GOOD_BY_ID, MIN_MARKUP, batchCost, goodPrice, goodStock, offerFor } from '../data/market';
import { TAXES } from '../data/policy';
import {
  buildingOfType,
  buildingSlots,
  dayOf,
  foodConsumptionPerDay,
  marketLeft,
  marketOffer,
  marketStock,
  moraleTarget,
  productionPerDay,
  seasonModsFor,
  selfCost,
  taxIncomePerDay,
  workerCount,
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
    'hut',
    'storage',
    'gathering',
    'sawmill',
    'quarry',
    'hunter_hut',
    'mine',
    'workshop',
    'farm',
    'pen',
    'totem',
    'chief_house',
    'smithy',
    'barracks',
    'palisade',
    'tower',
  ] as const) {
    place(s, type, MAX_BUILDING_LEVEL);
  }
  place(s, 'market', marketLevel);
  staff(s);
  s.resources = { wood: 4000, stone: 4000, food: 4000, hides: 1000, bones: 1000, copper: 1000, iron: 1000 };
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
  for (const type of ['hut', 'storage', 'sawmill', 'quarry', 'mine', 'chief_house'] as const) {
    place(s, type, 5);
  }
  // Единственный источник еды — маленький навес собирателей: поле, загон и
  // охотничий домик стоят пустыми, люди ушли на лес, камень и руду.
  place(s, 'gathering', 2);
  place(s, 'market', 5);
  for (const type of ['sawmill', 'quarry', 'mine', 'gathering'] as const) {
    const b = buildingOfType(s, type)!;
    while (workerCount(s, b.id) < buildingSlots(b)) {
      if (assignWorker(s, b.id) !== null) break;
    }
  }
  s.resources = { wood: 2000, stone: 1000, food: 1200, hides: 200, bones: 200, copper: 0, iron: 0 };
  s.morale = moraleTarget(s);
  return s;
}

/** Уровень рынка в этом состоянии — тестам он нужен для цены партии. */
const marketLevelOf = (s: GameState): number => buildingOfType(s, 'market')?.level ?? 0;

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

  it('последствия налога написаны на кнопке и сходятся с числами', () => {
    for (const t of TAXES) {
      expect(t.effect.length).toBeGreaterThan(0);
      // Ноль сбора — ноль платы за него, и наоборот.
      expect(t.perPop > 0).toBe(t.moralePenalty > 0);
    }
  });
});

describe('рынок', () => {
  it('купить дешевле, чем произвести, нельзя ни при каком уровне рынка', () => {
    for (const def of GOODS) {
      const floor = selfCost(def) * MIN_MARKUP;
      for (let level = 1; level <= MAX_BUILDING_LEVEL; level++) {
        // Самая выгодная точка дня — первая покупка, дальше цена только растёт.
        const best = goodPrice(def, level, 0);
        expect(best, `${def.id} на ${level} уровне дешевле своего труда`).toBeGreaterThanOrEqual(
          floor,
        );
        expect(best).toBeGreaterThanOrEqual(def.price);
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
    expect(goodStock(food, 10)).toBeGreaterThan(goodStock(food, 1));
    expect(goodPrice(food, 10, 0)).toBe(goodPrice(food, 1, 0));
    const wide = offerFor(3, 10, GOODS);
    const narrow = offerFor(3, 1, GOODS);
    expect(wide.length).toBeGreaterThan(narrow.length);
    // Ассортимент выводится из номера дня: перезагрузка его не тасует.
    expect(offerFor(3, 10, GOODS).map((g) => g.id)).toEqual(wide.map((g) => g.id));
    expect(offerFor(4, 10, GOODS).map((g) => g.id)).not.toEqual(wide.map((g) => g.id));
  });

  it('цена растёт по мере скупки одного товара за день', () => {
    const s = city();
    const good = marketOffer(s)[0].id;
    const def = GOOD_BY_ID[good];
    const first = goodPrice(def, MAX_BUILDING_LEVEL, 0);
    const last = goodPrice(def, MAX_BUILDING_LEVEL, marketStock(s, def) - 1);
    expect(last).toBeGreaterThan(first);
  });

  it('дневной лимит соблюдается и не обходится дроблением покупок', () => {
    const s = city();
    s.gold = 100_000;
    const good = marketOffer(s).find((g) => g.resource === 'wood')?.id ?? marketOffer(s)[0].id;
    const def = GOOD_BY_ID[good];
    const limit = marketStock(s, def);

    // Дробление не даёт ни лишней единицы, ни скидки: цена считается поштучно.
    const goldBefore = s.gold;
    for (let i = 0; i < limit; i++) expect(buyGoods(s, good, 1)).toBeNull();
    const spentOneByOne = goldBefore - s.gold;
    expect(spentOneByOne).toBe(batchCost(def, MAX_BUILDING_LEVEL, 0, limit));
    expect(marketLeft(s, def)).toBe(0);
    expect(buyGoods(s, good, 1)).not.toBeNull();

    // Новый день — новый запас.
    catchUp(s, DAY_LENGTH, 1);
    expect(marketLeft(s, def)).toBe(limit);
    // И взять больше дневного запаса разом тоже нельзя.
    expect(buyGoods(s, good, limit + 1)).not.toBeNull();
    expect(buyGoods(s, good, limit)).toBeNull();
  });

  it('дневного запаса еды не хватает, чтобы прокормить посёлок с рынка', () => {
    // Общее правило, а не частный случай: сколько бы ни был уровень рынка, его
    // дневной запас еды меньше того, что посёлок этого размера съедает за день.
    // Значит, рынком можно заткнуть дыру, но нельзя сесть на него вместо полей.
    for (const [pop, level] of [
      [120, 1],
      [350, 5],
      [700, MAX_BUILDING_LEVEL],
    ] as const) {
      const s = city(pop, level);
      s.time = (SEASONS.indexOf('winter') + SEASONS.length) * SEASON_SECONDS;
      const eat = foodConsumptionPerDay(s, seasonModsFor('winter', 2));
      expect(
        marketStock(s, GOOD_BY_ID.food),
        `рынок ${level} уровня кормит посёлок на ${pop} человек`,
      ).toBeLessThan(eat);
    }
  });

  it('зимой еду не закупить в количестве, снимающем угрозу голода', () => {
    // Племя, которое зима действительно бьёт: поля стоят, кормится сбором и охотой.
    const s = hungryTribe();
    s.time = (SEASONS.indexOf('winter') + SEASONS.length) * SEASON_SECONDS;
    const mods = seasonModsFor('winter', 2);
    const need = foodConsumptionPerDay(s, mods) - productionPerDay(s, mods).food;
    expect(need, 'зимой это племя должно проедать больше, чем добывает').toBeGreaterThan(0);

    // Самый щедрый случай: весь дневной запас каждый день зимы, деньги не в счёт.
    const perDay = marketStock(s, GOOD_BY_ID.food);
    expect(
      perDay * SEASON_DAYS,
      'рынок закрывает зиму целиком — зима перестала быть угрозой',
    ).toBeLessThan(need * SEASON_DAYS);

    // А деньги как раз в счёт: на один дневной запас уходит больше, чем приносит
    // высокий налог за всю зиму.
    s.tax = 'high';
    expect(batchCost(GOOD_BY_ID.food, marketLevelOf(s), 0, perDay)).toBeGreaterThan(
      taxIncomePerDay(s) * SEASON_DAYS,
    );
  });
});

describe('караван', () => {
  it('в пути груз не числится ни на складе, ни в доступных ресурсах', () => {
    const s = city();
    s.gold = 500;
    const good: GoodId = 'wood';
    expect(marketOffer(s).some((g) => g.id === good)).toBe(true);
    const woodBefore = s.resources.wood;
    const goldBefore = s.gold;
    const check = marketCheck(s, good, 5);

    expect(buyGoods(s, good, 5)).toBeNull();
    expect(s.gold).toBe(goldBefore - check.cost);
    expect(s.caravans).toHaveLength(1);
    // Пока телега в пути, склад её груза не видит.
    tick(s, 1, { offline: true });
    expect(s.resources.wood).toBeLessThanOrEqual(woodBefore + productionPerDay(s).wood);
    const carried = s.caravans[0].count;
    expect(carried).toBe(5);

    catchUp(s, s.caravans[0].arriveAt - s.time + 1, 1);
    expect(s.caravans).toHaveLength(0);
  });

  it('отмена возвращает золото целиком и освобождает дневной запас', () => {
    const s = city();
    s.gold = 500;
    const goldBefore = s.gold;
    const woodBefore = s.resources.wood;
    expect(buyGoods(s, 'wood', 4)).toBeNull();
    const left = marketLeft(s, GOOD_BY_ID.wood);

    expect(cancelCaravan(s, s.caravans[0].id)).toBeNull();
    expect(s.gold).toBe(goldBefore);
    expect(s.caravans).toHaveLength(0);
    expect(s.resources.wood).toBe(woodBefore);
    expect(marketLeft(s, GOOD_BY_ID.wood)).toBe(left + 4);
  });

  it('доехавший караван кладёт груз на склад', () => {
    const s = city();
    s.gold = 500;
    s.resources.iron = 0;
    const good: GoodId = 'eq:spear';
    // Снаряжение попадает не в ресурсы, а в счётчики снаряжения.
    const spears = s.equipment.spear;
    s.market.bought = {};
    s.market.day = dayOf(s.time);
    if (marketOffer(s).some((g) => g.id === good)) {
      expect(buyGoods(s, good, 1)).toBeNull();
      catchUp(s, s.caravans[0].arriveAt - s.time + 1, 1);
      expect(s.equipment.spear).toBe(spears + 1);
    }
  });
});
