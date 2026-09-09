// Добыча: правило дележа и то, как оно живёт в мире.
//
// Первая половина не знает ни про мир, ни про часы — она проверяет договор
// `world/spoils.ts`: взято = склад минус тайник, но не больше грузоподъёмности,
// и ни одна единица не теряется по дороге. Вторая гоняет настоящий `LocalWorld`:
// склад чужого двора после набега пуст **по факту**, тайник у бота и у игрока
// разбирает один и тот же код, а разведка не выдаёт того, чего видеть нельзя.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { distance } from './geo';
import { plunder, asLoss } from './spoils';
import { AI_STASH_SHARE, LOOT_PER_POP, LOOT_REFILL } from './data/tuning';
import { BUILDINGS } from '@/game/data/buildings';
import { UPGRADE_GROWTH, RESOURCE_IDS } from '@/game/constants';
import { createInitialState } from '@/game/state';
import { hiddenStash, maxLevelFor, stashAt, storageCap, upgradeCost } from '@/game/derived';
import type { GenSettlement } from './gen';
import type { Loot, PlayerProfile, SettlementView } from './types';
import type { WorldSave } from './local/state';

const MIN = 60_000;
const START = 1_700_000_000_000;

const sum = (loot: Loot): number => Object.values(loot).reduce((n, v) => n + Math.abs(v ?? 0), 0);

// ------------------------------------------------ правило дележа ---

describe('дележ склада — чистая функция', () => {
  const stock: Loot = { food: 1000, wood: 600, stone: 400 };

  it('одинаковый вход даёт одинаковый выход и не трогает вход', () => {
    const before = JSON.stringify(stock);
    expect(plunder(stock, 100, 500)).toEqual(plunder(stock, 100, 500));
    expect(JSON.stringify(stock)).toBe(before);
  });

  it('взято = склад минус спрятанное, когда обоз не мешает', () => {
    const s = plunder(stock, 100, Infinity);
    expect(s.takenTotal).toBe(2000 - 300);
    expect(s.hiddenTotal).toBe(300);
    expect(s.spilledTotal).toBe(0);
    // По каждому припасу тоже: тайник считается на каждый, а не на всё разом.
    expect(s.taken).toEqual({ food: 900, wood: 500, stone: 300 });
  });

  it('грузоподъёмность — верхний предел, и остаток остаётся хозяину', () => {
    const s = plunder(stock, 100, 500);
    expect(s.takenTotal).toBe(500);
    expect(s.hiddenTotal).toBe(300);
    // Непонятое — не спрятанное: оно лежало на виду, просто рук не хватило.
    expect(s.spilledTotal).toBe(1700 - 500);
    expect(s.takenTotal + s.hiddenTotal + s.spilledTotal).toBe(2000);
  });

  it('ни одна единица не теряется на округлении', () => {
    // Три припаса, делить на них семь единиц: без раздачи остатка по дробной
    // части взято было бы шесть, и «взято = склад − тайник» не сходилось бы.
    for (const carry of [1, 2, 7, 13, 999, 1699, 1700, 1701]) {
      const s = plunder(stock, 100, carry);
      expect(s.takenTotal, `carry=${carry}`).toBe(Math.min(carry, 1700));
      expect(sum(s.taken)).toBe(s.takenTotal);
    }
  });

  it('склад меньше тайника не отдаёт ничего, и это не ошибка', () => {
    const s = plunder({ food: 80, iron: 5 }, 100, Infinity);
    expect(s.takenTotal).toBe(0);
    expect(s.hiddenTotal).toBe(85);
    expect(s.taken).toEqual({});
  });

  it('без тайника уносят всё до последней единицы', () => {
    const s = plunder(stock, 0, Infinity);
    expect(s.takenTotal).toBe(2000);
    expect(s.hiddenTotal).toBe(0);
  });

  it('пустой склад, нулевой обоз и отрицательные числа не ломают дележа', () => {
    expect(plunder({}, 500, 500).takenTotal).toBe(0);
    expect(plunder(stock, 100, 0).takenTotal).toBe(0);
    expect(plunder(stock, -50, 100).hiddenTotal).toBe(0);
    expect(plunder({ food: -10 }, 0, 100).takenTotal).toBe(0);
  });

  it('потеря — то же взятое со знаком минус, и ничего больше', () => {
    const s = plunder(stock, 100, Infinity);
    expect(asLoss(s.taken)).toEqual({ food: -900, wood: -500, stone: -300 });
  });
});

// ------------------------------------------------ таблица тайника ---

describe('вместимость тайника по уровням', () => {
  const cache = BUILDINGS.find((b) => b.id === 'cache')!;

  it('прячет ровно то, что в таблице: база и множитель улучшений', () => {
    for (let level = 1; level <= maxLevelFor('cache'); level++) {
      expect(stashAt(level)).toBe(Math.round((cache.hidden ?? 0) * Math.pow(UPGRADE_GROWTH, level - 1)));
    }
    // Линейной прибавки у тайника нет и быть не должно: `perLevel` пустой,
    // иначе панель и делёж считали бы по разным таблицам.
    expect(cache.perLevel?.hidden).toBeUndefined();
  });

  it('на каждом уровне хватает на одно среднее улучшение того же уровня', () => {
    // Это и есть обещание таблицы, и оно обязано держаться на всех десяти
    // уровнях, а не на одном: улучшения дорожают в 1.4 раза за уровень, и
    // линейный тайник к десятому перестал бы покрывать даже среднее из них.
    for (let level = 1; level <= maxLevelFor('cache'); level++) {
      const items = BUILDINGS.map((d) => {
        const c = upgradeCost(d, level);
        return Math.max(...RESOURCE_IDS.map((r) => c[r] ?? 0));
      }).sort((a, b) => a - b);
      const median = items[Math.floor(items.length / 2)];
      expect(stashAt(level), `уровень ${level}`).toBeGreaterThan(median);
    }
  });

  it('первый уровень спасает мелочь, десятый — заметную часть, но не весь склад', () => {
    const capAt = (level: number): number => {
      const s = createInitialState();
      for (const b of s.buildings) if (b.type === 'storage') b.level = level;
      return storageCap(s);
    };
    const first = stashAt(1) / capAt(1);
    const last = stashAt(maxLevelFor('cache')) / capAt(maxLevelFor('cache'));
    expect(first).toBeLessThan(0.12);
    expect(last).toBeGreaterThan(first * 2);
    // Неуязвимый склад убил бы и риск копить, и смысл нападать.
    expect(last).toBeLessThan(0.5);
  });

  it('уровень Тайника доезжает до дележа целиком', () => {
    const s = createInitialState();
    const cacheB = s.buildings.find((b) => b.type === 'cache')!;
    cacheB.level = 6;
    expect(hiddenStash(s)).toBe(stashAt(6));
  });
});

// ------------------------------------------------ добыча в мире ---

function makeWorld(seed: number) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null, reveal: true });
  return {
    world,
    at: (t: number): void => {
      now = t;
    },
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

const saveOf = (w: LocalWorld): WorldSave => (w as unknown as { save: WorldSave }).save;
const listOf = (w: LocalWorld): GenSettlement[] =>
  (w as unknown as { gen: { settlements: GenSettlement[] } }).gen.settlements;
/** Внутренние счётчики склада двора: прибору положено видеть больше карточки. */
const peek = (w: LocalWorld) =>
  w as unknown as {
    lootCap(s: GenSettlement, now: number): number;
    lootStash(s: GenSettlement, now: number): number;
    lootAvailable(s: GenSettlement, now: number): number;
    lootOpen(s: GenSettlement, now: number): number;
    lootStock(s: GenSettlement, now: number): Loot;
  };

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile =>
  ({
    name: 'Тест',
    pop: 600,
    defense: 4000,
    warriorPower: 14,
    units: { warrior: 200, scout: 8 },
    army: { legionary: 120, spearman: 90, archer: 60 },
    command: 2000,
    warning: 120,
    stock: { food: 2000, wood: 1500 },
    stash: 0,
    food: 20000,
    foodPerHour: 9000,
    soldierFoodPerHour: 60,
    ...over,
  }) as PlayerProfile;

async function neighbours(world: LocalWorld): Promise<SettlementView[]> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 26, y: info.home.y - 26, w: 53, h: 53 });
  return chunk.settlements.filter((s) => !s.mine && s.relation !== 'barbarian' && !s.ruin);
}

async function bringGeneral(w: ReturnType<typeof makeWorld>, p: PlayerProfile) {
  await w.world.sync(p);
  expect(await w.world.setGarrison({ legionary: 120, spearman: 90, archer: 60 })).toBeNull();
  for (let i = 0; i < 200; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.readyAt === 0) break;
  }
  const info = await w.world.info();
  const near = await neighbours(w.world);
  expect(near.length).toBeGreaterThan(0);
  const target = near.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
  for (let i = 0; i < 600; i++) {
    w.advance(MIN);
    await w.world.sync(p);
    const g = (await w.world.figures()).find((f) => f.id === 'general');
    if (g && g.phase !== 'moving') break;
  }
  return target;
}

describe('склад чужого двора', () => {
  it('у двора есть склад и тайник, и тайник — объявленная доля склада', async () => {
    const w = makeWorld(11);
    await w.world.sync(profile());
    const s = listOf(w.world).find((x) => x.tribeId)!;
    const api = peek(w.world);
    const now = w.now();
    const cap = api.lootCap.call(w.world, s, now);
    // Склад считается от населения и ничего больше про двор не спрашивает.
    expect(cap).toBeGreaterThan(0);
    expect(api.lootStash.call(w.world, s, now) * s.lootMix.length).toBeCloseTo(
      Math.floor(cap * AI_STASH_SHARE) - (Math.floor(cap * AI_STASH_SHARE) % s.lootMix.length),
      -1,
    );
    expect(LOOT_PER_POP).toBeGreaterThan(0);
  });

  it('после набега склад пуст по факту: на виду не остаётся ничего', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);
    const s = listOf(w.world).find((x) => x.id === target.id)!;
    const api = peek(w.world);

    const before = api.lootOpen.call(w.world, s, w.now());
    expect(before, 'до набега брать есть что').toBeGreaterThan(0);

    const res = await w.world.attack({ setup: null });
    expect(res.won).toBe(true);
    const report = (await w.world.reports()).find((r) => r.id === res.reportId)!;
    const taken = sum(report.loot ?? {});
    expect(taken).toBe(before);
    // Тайник уцелел целиком, и отчёт называет его числом.
    expect(report.hidden).toBe(api.lootStash.call(w.world, s, w.now()) * s.lootMix.length);
    // И это главное: на виду не осталось ничего — не «коэффициент упал», а
    // склад вычищен. Разорение тут ещё ничего не сделало, оно только не даёт
    // складу наполниться заново.
    expect(api.lootOpen.call(w.world, s, w.now())).toBe(0);
  }, 180_000);

  it('пустой склад — следствие дележа, а не разорения: без окна он всё равно пуст', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);
    const s = listOf(w.world).find((x) => x.id === target.id)!;
    const api = peek(w.world);

    expect((await w.world.attack({ setup: null })).won).toBe(true);
    // Снимаем разорение руками и смотрим, что осталось от склада. Если бы
    // «второй набег даёт крохи» держалось на разорении, здесь бы всё вернулось.
    delete saveOf(w.world).sacks[target.id];
    expect(api.lootOpen.call(w.world, s, w.now()), 'склад пуст сам по себе').toBe(0);

    // Разорение отвечает за другое: пока оно держится, склад не наполняется.
    // Час без него — и брать снова есть что; час под ним — почти нечего.
    w.advance(LOOT_REFILL);
    const freeAgain = api.lootOpen.call(w.world, s, w.now());
    expect(freeAgain, 'без разорения двор отстраивается своим чередом').toBeGreaterThan(0);
  }, 180_000);

  it('второй набег подряд приносит крохи, и это видно по складу, а не по коэффициенту', async () => {
    const w = makeWorld(11);
    const p = profile();
    await bringGeneral(w, p);
    const first = await w.world.attack({ setup: null });
    const firstLoot = sum((await w.world.reports()).find((r) => r.id === first.reportId)?.loot ?? {});
    w.advance(MIN);
    await w.world.sync(p);
    const second = await w.world.attack({ setup: null });
    const secondLoot = sum((await w.world.reports()).find((r) => r.id === second.reportId)?.loot ?? {});
    expect(firstLoot).toBeGreaterThan(0);
    expect(secondLoot).toBe(0);
  }, 180_000);
});

describe('одно правило на обе стороны', () => {
  const src = readFileSync(path.resolve('src/world/local/LocalWorld.ts'), 'utf8');

  it('обе двери — чужой двор и наша деревня — ходят через общую функцию', () => {
    // Не «похоже написано», а буквально одна функция: своей арифметики дележа
    // ни у той, ни у другой стороны быть не должно. Одностороннее правило игрок
    // раскусит за день, а две копии одного правила разъедутся при первой правке.
    expect(src).toMatch(/private takeLoot[\s\S]{0,900}?plunder\(/);
    expect(src).toMatch(/private plunderHome[\s\S]{0,900}?plunder\(/);
    // И ни одного второго дележа: пропорция считается только в `spoils.ts`.
    const spoils = readFileSync(path.resolve('src/world/spoils.ts'), 'utf8');
    expect(spoils).toContain('export function plunder');
  });

  it('у слепка деревни нет заранее вычтенного склада', () => {
    // Поле `resources` (склад уже без тайника) убрано нарочно: пока оно лежало
    // рядом со `stock`, одно и то же число существовало в двух видах, и делить
    // добычу можно было по любому из них.
    const bridge = readFileSync(path.resolve('src/world/bridge.ts'), 'utf8');
    expect(bridge).not.toContain('const resources: Loot');
    expect(bridge).toContain('const stash = hiddenStash(s)');
  });
});

describe('разведка не выдаёт больше, чем положено', () => {
  it('без разведки про склад не известно ничего', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const near = await neighbours(w.world);
    const target = near.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    const card = await w.world.settlement(target.id);
    expect(card?.loot.precision, 'чужие амбары считает разведчик, а не карта').toBe('unknown');
  });

  it('разведка показывает только то, что лежит на виду, — тайника в снимке нет', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);
    const s = listOf(w.world).find((x) => x.id === target.id)!;
    const api = peek(w.world);
    // Что лежит у двора в эту самую минуту — до того, как его тронули.
    const open = api.lootOpen.call(w.world, s, w.now());
    const full = api.lootAvailable.call(w.world, s, w.now());
    expect(full, 'на складе лежит больше, чем на виду').toBeGreaterThan(open);
    expect(open, 'но на виду что-то есть').toBeGreaterThan(0);

    // Бой — та же разведка, и лучшая: снимок снят своими глазами и свеж.
    expect((await w.world.attack({ setup: null })).won).toBe(true);
    const reading = await w.world.intel(target.id);
    expect(reading?.precision, 'снимок только что сделан').toBe('exact');
    // И даже он называет только открытую часть: подпол не считают ни разведкой,
    // ни боем — иначе чужой тайник был бы известен, а свой прятал бы от всех.
    expect(reading!.loot.value).toBe(open);
    expect(reading!.loot.value).toBeLessThan(full);
  }, 180_000);
});
