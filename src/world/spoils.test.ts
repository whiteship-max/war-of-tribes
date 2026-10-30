// Добыча: правило дележа и то, как оно живёт в мире.
//
// Первая половина не знает ни про мир, ни про часы — она проверяет договор
// `world/spoils.ts`: взято = склад минус тайник, но не больше грузоподъёмности,
// и ни одна единица не теряется по дороге. Вторая гоняет настоящий `LocalWorld`:
// склад чужого двора после набега пуст **по факту**, тайник у бота и у игрока
// разбирает один и тот же код, а разведка не выдаёт того, чего видеть нельзя.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { distance } from './geo';
import {
  FATES,
  FATE_DEFAULT,
  FATE_IDS,
  HEAD_CARRY,
  burnImmune,
  burnImmuneUntil,
  fallSeed,
  fate,
  fateAt,
  fateBlock,
  homeLoss,
  lead,
  plunder,
  asLoss,
  winnerGain,
  type FateInput,
  type FateResult,
} from './spoils';
import { UNIT_BY_ID, stackEscort } from './data/units';
import {
  AI_STASH_SHARE,
  BURN_IMMUNE,
  SIEGE_IMMUNE,
  BURN_LEVELS,
  BURN_POP_SHARE,
  FALL_BUILDINGS,
  FALL_LEVELS,
  LED_POP_SHARE,
  LOOT_PER_POP,
  LOOT_REFILL,
} from './data/tuning';
import { applyEffects, playerProfile } from './bridge';
import { FALL_SPARED, fallBuildings, fallPool, fallenText } from '@/game/sim/expedition';
import { BUILDINGS } from '@/game/data/buildings';
import { UPGRADE_GROWTH, RESOURCE_IDS } from '@/game/constants';
import { createInitialState } from '@/game/state';
import { bondedTotal, hiddenStash, maxLevelFor, stashAt, storageCap, upgradeCost } from '@/game/derived';
import type { GameState } from '@/game/types';
import type { GenSettlement } from './gen';
import type { Fate, HomeEffect, Loot, PlayerProfile, SettlementView } from './types';
import type { WorldSave } from './local/state';

// Энергия агентов здесь не предмет проверки (docs/agent_energy.md): сценарии этого файла водят агентов по карте помногу
// — дорога здесь энергию не берёт. Цены дел и отдых дома остаются; энергию держат `energy.test.ts` и
// `energyworld.test.ts`.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

/**
 * Спящие случаи. Чужих дворов на карте не осталось ни одного: мир стал общим, а
 * замки на нём появятся при регистрации живых игроков. Механика цела — участников
 * у неё пока нет, и притворяться, что случай проверен, нельзя. Полный список:
 * `grep -rn waitsForPlayers src`.
 */
const waitsForPlayers = it.skip;

const MIN = 60_000;
const START = 1_700_000_000_000;

const sum = (loot: Loot): number => Object.values(loot).reduce((n, v) => n + Math.abs(v ?? 0), 0);

/** Код без комментариев: тест по исходнику спрашивает то, что исполняется, а не то, что о нём сказано. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

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

// ------------------------------------------------ невольники павшего города ---

describe('кого уводит победитель — чистая функция', () => {
  it('уводят невольников, скольких устережёт отряд, и остаток остаётся хозяину', () => {
    expect(lead(40, 100)).toEqual({ taken: 40, left: 0 });
    expect(lead(400, stackEscort({ warrior: 30 }))).toEqual({
      taken: stackEscort({ warrior: 30 }),
      left: 400 - stackEscort({ warrior: 30 }),
    });
    // Одинаковый вход — одинаковый выход: ни часов, ни кости.
    expect(lead(123, 77)).toEqual(lead(123, 77));
  });

  it('пустой город, пустой отряд и дробные числа дележа не ломают', () => {
    expect(lead(0, 500)).toEqual({ taken: 0, left: 0 });
    expect(lead(50, 0)).toEqual({ taken: 0, left: 50 });
    expect(lead(-5, 10)).toEqual({ taken: 0, left: 0 });
    expect(lead(10.9, 4.7)).toEqual({ taken: 4, left: 6 });
    // Разведчик невольников не ведёт: он в драку не лезет и обоза не держит.
    expect(stackEscort({ scout: 20 })).toBe(0);
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
    units: { warrior: 200, scout: 8 },
    army: { legionary: 120, spearman: 90, archer: 60 },
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
  waitsForPlayers('у двора есть склад и тайник, и тайник — объявленная доля склада', async () => {
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

  waitsForPlayers('после набега склад пуст по факту: на виду не остаётся ничего', async () => {
    const w = makeWorld(11);
    const p = profile();
    const target = await bringGeneral(w, p);
    const s = listOf(w.world).find((x) => x.id === target.id)!;
    const api = peek(w.world);

    const before = api.lootOpen.call(w.world, s, w.now());
    expect(before, 'до набега брать есть что').toBeGreaterThan(0);

    const res = await w.world.attack({});
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

    expect((await w.world.attack({})).won).toBe(true);
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
    const first = await w.world.attack({});
    const firstLoot = sum((await w.world.reports()).find((r) => r.id === first.reportId)?.loot ?? {});
    w.advance(MIN);
    await w.world.sync(p);
    const second = await w.world.attack({});
    const secondLoot = sum((await w.world.reports()).find((r) => r.id === second.reportId)?.loot ?? {});
    expect(firstLoot).toBeGreaterThan(0);
    expect(secondLoot).toBe(0);
  }, 180_000);
});

describe('одно правило на обе стороны', () => {
  const src = readFileSync(path.resolve('src/world/local/LocalWorld.ts'), 'utf8');

  it('дележ склада и увод людей зовутся только из двери участи', () => {
    // Не «похоже написано», а буквально одна дверь. Кто импортирует `plunder`
    // или `lead` из модуля дележа, тот и делит; таких мест четыре (дань — ниже): сама дверь,
    // мятеж — у мятежа нет победителя, и участью он не является, — и бой
    // разбойников у ворот: прорвавшись, они уносят со склада, сколько поднимут,
    // тем же правилом, а город не берут (слово владельца, docs/battle_eu4.md, 14.28).
    const importers: Record<'plunder' | 'lead', string[]> = { plunder: [], lead: [] };
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const code = stripComments(readFileSync(p, 'utf8'));
          const rel = path.relative(process.cwd(), p).split(path.sep).join('/');
          for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*spoils['"]/g)) {
            for (const fn of ['plunder', 'lead'] as const) if (new RegExp(`\\b${fn}\\b`).test(m[1])) importers[fn].push(rel);
          }
        }
      }
    };
    walk(path.resolve('src'));
    // Четвёртое место — дань за снятие осады (`world/parley.tributeGoods`, docs/siege_v2.md, 7.1): город не взят, участи
    // нет, но добро уходит тем же правилом — что в тайнике, остаётся; одна дверь на мир и сервер войны. Пятое — отход отряда
    // бродяги (ПН-5, `sim/roamfight`, ГДД 3.6.4): обоз теряет то, что унесут уцелевшие враги, тем же правилом (тайника у обоза нет).
    expect(importers.plunder, 'делит склад кто-то кроме двери участи, мятежа, боя у ворот, дани и отхода отряда').toEqual([
      'src/game/sim/mutiny.ts',
      'src/game/sim/roamfight.ts',
      'src/world/local/LocalWorld.ts',
      'src/world/parley.ts',
    ]);
    // В мире склад делит только бой события у ворот, и один раз.
    const world = stripComments(readFileSync(path.resolve('src/world/local/LocalWorld.ts'), 'utf8'));
    const from = world.indexOf('private gateFight(');
    const end = world.indexOf('\n  }\n', from);
    expect(from > 0 && end > from, 'тело боя у ворот найдено').toBe(true);
    const gate = world.slice(from, end);
    const plunders = (code: string): number => (code.match(/(?<!function )\bplunder\(/g) ?? []).length;
    expect(plunders(world), 'мир делит склад вне боя у ворот').toBe(1);
    expect(plunders(gate), 'бой у ворот делит склад один раз').toBe(1);
    expect(importers.lead, 'уводит людей кто-то кроме двери участи').toEqual([]);

    // Внутри модуля дележа оба правила зовёт только сама дверь — на всех трёх ступенях.
    const spoils = stripComments(readFileSync(path.resolve('src/world/spoils.ts'), 'utf8'));
    const door = spoils.slice(spoils.indexOf('export function fate('), spoils.indexOf('function pickFallen('));
    const calls = (code: string, fn: string): number => (code.match(new RegExp(`(?<!function )\\b${fn}\\(`, 'g')) ?? []).length;
    expect(calls(spoils, 'plunder'), '`plunder` зовут вне двери').toBe(calls(door, 'plunder'));
    expect(calls(spoils, 'lead'), '`lead` зовут вне двери').toBe(calls(door, 'lead'));
    // Добро делится один раз на любой ступени — и грабёж, и пожар одним дележом.
    expect(calls(door, 'plunder')).toBe(1);
    // Людей уводят дважды — невольников города и горожан, — и оба раза тем же `lead`.
    expect(calls(door, 'lead')).toBe(2);
    // Ступени три у лорда («Занять» вольного замка кладёт в таблицу `world/freecastle`, ПН-10), и что делает каждая, дверь читает из
    // таблицы один раз, а не ветками по имени ступени.
    expect(Object.keys(FATES).sort()).toEqual(['burn', 'captives', 'plunder']);
    expect((door.match(/FATES\[/g) ?? []).length, 'правило ступени читается в двери один раз').toBe(1);
    expect(door, 'дверь ветвится по имени ступени').not.toMatch(/'(plunder|captives|burn|occupy)'/);
  });

  it('все четыре места, где город взят, идут через дверь участи и через одну проверку ступени', () => {
    const code = stripComments(src);
    // Метод ищется по имени, а не по видимости: часть читающих методов мира открыта
    // наследнику (`NotifyingWorld`) как `protected`.
    const method = (name: string): string => {
      const at = code.search(new RegExp(`(private|protected) ${name}\\(`));
      expect(at, `метод ${name}`).toBeGreaterThan(0);
      const rest = code.slice(at + 10).search(/\n {2}(private|protected) /);
      return code.slice(at, rest < 0 ? undefined : at + 10 + rest);
    };
    // Наш город: прорвавшийся набег и голод — одной дверью и одними полями.
    for (const name of ['resolveIncoming', 'homeFalls']) {
      expect(method(name), `${name} идёт мимо двери`).toMatch(/this\.fateHome\(/);
      expect(method(name), `${name} собирает потерю сам`).toMatch(/homeLoss\(/);
    }
    // Чужой двор: наш набег и наш лагерь — и победителю достаётся одной функцией.
    for (const name of ['attackAt', 'siegeFalls']) {
      expect(method(name), `${name} идёт мимо двери`).toMatch(/this\.takeLoot\(/);
      expect(method(name), `${name} собирает добычу сам`).toMatch(/winnerGain\(/);
    }
    // Ступень у всех четырёх — объявленная, пропущенная через одну проверку.
    for (const name of ['resolveIncoming', 'homeFalls', 'attackAt', 'siegeFalls']) {
      expect(method(name), `${name} берёт ступень мимо проверки`).toMatch(/this\.fateFor\(/);
    }
    expect(method('fateFor')).toMatch(/\bfateAt\(/);
    expect(method('takeLoot')).toMatch(/this\.fateOf\(/);
    expect(method('fateOf')).toMatch(/\bfate\(\{/);
    expect(method('fateHome')).toMatch(/\bfate\(\{/);
    // Вызовов самой двери в мире ровно два — чужой двор и наш город, и ступень у
    // обоих приходит аргументом, а не написана на месте.
    expect((code.match(/\bfate\(\{/g) ?? []).length).toBe(2);
    expect((code.match(/fate: declared,/g) ?? []).length).toBe(2);
    // Ступеней мир по имени не знает: что делает каждая, читается из таблицы двери.
    expect(code, 'мир ветвится по имени ступени').not.toMatch(/'(plunder|captives|burn)'/);
  });

  it('чужой двор, павший под чужим же лагерем, нашу деревню не трогает', () => {
    // Раньше в падение нашего города вёл любой не наш лагерь — и война соседей
    // между собой рассеяла бы наш гарнизон, вычистила склад и увела невольников.
    // Проверка стоит на самом городе.
    const fall = src.slice(src.indexOf('private siegeFalls'), src.indexOf('private homeFalls'));
    expect(fall).toContain('if (id === HOME_ID) return this.homeFalls(w, at, by);');
    expect(fall).not.toMatch(/if \(!ours\) return this\.homeFalls/);
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

// ------------------------------------------------ участь взятого города ---

const input = (over: Partial<FateInput> = {}): FateInput => ({
  fate: FATE_DEFAULT,
  stock: { food: 900, wood: 300 },
  gold: 0,
  stash: 0,
  pop: 0,
  bonded: 0,
  carry: Infinity,
  escort: 0,
  seed: 1,
  ...over,
});

/** Уровни всех построек, кроме тайника: каждая выше первого, иначе падать нечему. */
const tall = (): Record<string, number> =>
  Object.fromEntries(
    BUILDINGS.filter((b) => !FALL_SPARED.includes(b.id)).map((b, i) => [b.id, 2 + (i % 8)]),
  );

describe('казна делится тем же правилом, что склад', () => {
  const STOCKS: Loot[] = [{ food: 900, wood: 300 }, { stone: 50 }, { food: 4000, iron: 1200, hides: 7 }];
  const GOLDS = [300, 1000, 7777];
  const STASHES = [0, 100, 250];

  it('золото — восьмой припас: делится так же, как делился бы припас того же размера', () => {
    let points = 0;
    for (const stock of STOCKS) {
      for (const gold of GOLDS) {
        for (const stash of STASHES) {
          for (const carry of [Infinity, 200, 900]) {
            const r = fate(input({ stock, gold, stash, carry }));
            // Тот же склад, где вместо казны лежит столько же воска: припаса,
            // которого на складе нет. Дверь обязана поделить казну так же.
            const same = plunder({ ...stock, wax: gold } as Loot, stash, carry);
            const wax = (same.taken as Record<string, number>).wax ?? 0;
            expect(r.taken.gold ?? 0, `казна ${gold}, тайник ${stash}, обоз ${carry}`).toBe(wax);
            expect(r.takenTotal).toBe(same.takenTotal);
            points++;
          }
        }
      }
    }
    expect(points).toBe(81);
  });

  it('тайник прячет столько же золота, сколько зерна', () => {
    for (const gold of GOLDS) {
      for (const stash of STASHES.filter((n) => n > 0)) {
        // Граница области: казна больше тайника, иначе прятать нечего и брать тоже.
        expect(gold).toBeGreaterThan(stash);
        const r = fate(input({ stock: { food: gold }, gold, stash }));
        expect(r.taken.gold, `казна ${gold}, тайник ${stash}`).toBe(gold - stash);
        expect(r.taken.food, 'зерна того же размера уносят столько же').toBe(gold - stash);
        expect(r.hiddenTotal).toBe(stash * 2);
      }
    }
  });

  it('обоз поднимает золото наравне с добром и не больше, чем поднимает', () => {
    for (const gold of GOLDS) {
      for (const carry of [200, 900]) {
        const open = 1200 + gold;
        // Граница области: обоз меньше открытого — только тогда он что-то режет.
        expect(carry).toBeLessThan(open);
        const r = fate(input({ gold, carry }));
        expect(r.takenTotal, `обоз ${carry}, казна ${gold}`).toBe(carry);
        expect(r.taken.gold ?? 0, 'золото не выносят сверх доли обоза').toBeLessThan(gold);
        expect(r.taken.gold ?? 0, 'и не оставляют целиком').toBeGreaterThan(0);
      }
    }
  });

  it('потеря казны доезжает до племени минусом, и казна убывает ровно на взятое', () => {
    const s = createInitialState();
    s.gold = 5000;
    for (const b of s.buildings) if (b.type === 'cache') b.level = 3;
    const p = playerProfile(s);
    expect(p.gold).toBe(5000);
    const r = fate(input({ stock: p.stock, gold: p.gold ?? 0, stash: p.stash, carry: 2000 }));
    // Граница области: казна больше тайника, и обоз её частично берёт.
    expect(r.taken.gold ?? 0).toBeGreaterThan(0);
    const effect: HomeEffect = { id: 't', lost: {}, prestige: 0, morale: 0, battle: null, text: 'т', good: false, ...homeLoss(r) };
    expect(effect.resources.gold).toBe(-(r.taken.gold ?? 0));
    applyEffects(s, [effect]);
    expect(s.gold).toBe(5000 - (r.taken.gold ?? 0));
  });
});

describe('невольники при ступени «ограбить» остаются', () => {
  it('ни одна ступень без увода людей невольников не берёт, сколько бы их ни было и чем бы ни стерегли', () => {
    const keeps = FATE_IDS.filter((f) => !FATES[f].bonded && !FATES[f].scatterBonded);
    expect(keeps, 'ограбить — без увода людей').toEqual(['plunder']);
    for (const f of keeps) {
      for (const bonded of [1, 40, 400]) {
        for (const escort of [5, 400, 5000]) {
          // Граница области: `lead` увёл бы хоть кого-то.
          expect(lead(bonded, escort).taken).toBeGreaterThan(0);
          const r = fate(input({ fate: f, bonded, escort, pop: 200 }));
          expect(r.ledBonded, `${f}: невольников ${bonded}, конвой ${escort}`).toEqual({ taken: 0, left: bonded });
          expect(r.ledPop.taken, `${f}: горожан не уводят`).toBe(0);
          expect(homeLoss(r).bonded, 'в последствие увод не уезжает').toBeUndefined();
          expect(homeLoss(r).popLost, 'и горожане не уходят').toBeUndefined();
        }
      }
    }
  });
});

describe('пять построек — выбор из данных события', () => {
  it('тот же вход — тот же список, и порядок, в каком собран список уровней, не важен', () => {
    const levels = tall();
    const reversed = Object.fromEntries(Object.entries(levels).reverse());
    for (let seed = 0; seed < 60; seed++) {
      const a = fate(input({ levels, seed }));
      expect(a.fallen, `соль ${seed}`).toEqual(fate(input({ levels, seed })).fallen);
      expect(a.fallen, `соль ${seed}, ключи в обратном порядке`).toEqual(fate(input({ levels: reversed, seed })).fallen);
      expect(a.fallen.length).toBe(FALL_BUILDINGS);
      expect(new Set(a.fallen.map((f) => f.id)).size, 'одна постройка дважды').toBe(FALL_BUILDINGS);
    }
  });

  it('список выводится из соли, а не стоит один на всех', () => {
    const levels = tall();
    const lists = new Set<string>();
    for (let seed = 0; seed < 60; seed++) lists.add(fate(input({ levels, seed })).fallen.map((f) => f.id).join());
    expect(lists.size).toBeGreaterThan(40);
    // И каждая постройка из списка хоть раз под удар попадает: перестановка, а не срез.
    const hit = new Set<string>();
    for (let seed = 0; seed < 400; seed++) for (const f of fate(input({ levels, seed })).fallen) hit.add(f.id);
    expect([...hit].sort()).toEqual(Object.keys(levels).sort());
  });

  it('соль — из сида мира и минуты события', () => {
    const at = START + 3 * 3_600_000;
    expect(fallSeed(7, at)).toBe(fallSeed(7, at));
    expect(fallSeed(7, at + 999), 'та же секунда').toBe(fallSeed(7, at));
    expect(fallSeed(7, at + 60_000)).not.toBe(fallSeed(7, at));
    expect(fallSeed(8, at)).not.toBe(fallSeed(7, at));
  });

  it('в выборе ни одна постройка не падает ниже первого уровня', () => {
    let floor = 0;
    let fell = 0;
    for (let seed = 0; seed < 60; seed++) {
      // Половина построек на первом уровне: удар на них приходится — и ниже не роняет.
      const levels = Object.fromEntries(Object.entries(tall()).map(([id, n], i) => [id, i % 2 ? 1 : n]));
      for (const f of fate(input({ levels, seed })).fallen) {
        expect(f.to, `${f.id} с ${f.from}`).toBe(Math.max(1, f.from - FALL_LEVELS));
        expect(f.to).toBeGreaterThanOrEqual(1);
        if (f.from === 1) floor++;
        else fell++;
      }
    }
    // Граница области: удары пришлись и на первый уровень, и выше.
    expect(floor).toBeGreaterThan(0);
    expect(fell).toBeGreaterThan(0);
  });
});

describe('падение уровней у племени', () => {
  /** Посёлок, где каждая постройка выше первого уровня, а тайник — пятого. */
  const town = () => {
    const s = createInitialState();
    s.buildings.forEach((b, i) => {
      b.level = b.type === 'cache' ? 5 : 2 + (i % 8);
    });
    return s;
  };

  it('тайника в списке для мира нет', () => {
    const s = town();
    expect(Object.keys(fallPool(s)).length).toBe(s.buildings.length - FALL_SPARED.length);
    for (const id of FALL_SPARED) expect(fallPool(s), `${id} в списке`).not.toHaveProperty(id);
  });

  it('племя не роняет тайник, даже если старый список мира его назвал', () => {
    const s = town();
    const smithy = s.buildings.find((b) => b.type === 'smithy')!;
    smithy.level = 2;
    const lost = fallBuildings(s, [
      { id: 'cache', from: 5, to: 4 },
      { id: 'smithy', from: 2, to: -3 },
    ]);
    expect(s.buildings.find((b) => b.type === 'cache')!.level, 'тайник').toBe(5);
    expect(smithy.level, 'ниже первого не роняет и кривой список').toBe(1);
    expect(lost).toEqual([{ type: 'smithy', from: 2, to: 1 }]);
  });

  it('через настоящий путь: тайник цел, ниже первого никто, и снято ровно то, что названо', () => {
    let cacheWouldFall = 0;
    let drops = 0;
    for (let seed = 0; seed < 80; seed++) {
      const s = town();
      if (seed % 3 === 0) for (const b of s.buildings) if (b.type !== 'cache' && b.level % 2) b.level = 1;
      const before = new Map(s.buildings.map((b) => [b.type, b.level]));
      const p = playerProfile(s);
      // Граница области: не будь тайник вынут из списка, на этой соли удар пришёлся бы и на него.
      const all = Object.fromEntries(s.buildings.map((b) => [b.type, b.level]));
      if (fate(input({ levels: all, seed })).fallen.some((f) => f.id === 'cache')) cacheWouldFall++;

      const r = fate(input({ stock: p.stock, gold: p.gold ?? 0, stash: p.stash, levels: p.levels, seed }));
      const effect: HomeEffect = { id: 't', lost: {}, prestige: 0, morale: 0, battle: null, text: 'т', good: false, ...homeLoss(r) };
      applyEffects(s, [effect]);

      const measured = s.buildings
        .filter((b) => b.level !== before.get(b.type))
        .map((b) => ({ id: b.type as string, from: before.get(b.type)!, to: b.level }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const named = r.fallen.filter((f) => f.to < f.from).sort((a, b) => a.id.localeCompare(b.id));
      expect(measured, `соль ${seed}`).toEqual(named);
      for (const b of s.buildings) expect(b.level, `${b.type}, соль ${seed}`).toBeGreaterThanOrEqual(1);
      expect(s.buildings.find((b) => b.type === 'cache')!.level, `тайник, соль ${seed}`).toBe(5);
      // И летопись называет те же постройки теми же числами.
      const line = s.log.find((l) => l.text.startsWith('Постройки потеряли уровни'));
      expect(line?.text, `соль ${seed}`).toBe(`Постройки потеряли уровни: ${fallenText(s, r.fallen)}.`);
      drops += measured.length;
    }
    expect(cacheWouldFall, 'без исключения тайник попадал бы под удар').toBeGreaterThan(0);
    expect(drops).toBeGreaterThan(0);
  });
});

// ------------------------------------------------ лестница целиком ---

/**
 * Посёлки, на которых проверяется лестница: разный размер, у каждой постройки свой
 * уровень (часть — на первом, чтобы дно было где задеть), тайник выше первого и со
 * своей стройкой, ещё одна стройка в работе, невольники и казна.
 */
function ladderTown(k: number): GameState {
  const s = createInitialState();
  s.buildings.forEach((b, i) => {
    if (b.type === 'cache') b.level = 3 + (k % 3);
    else if (b.type === 'storage') b.level = 10;
    else b.level = (i + k) % 5 === 0 ? 1 : 2 + ((i + k) % 7);
  });
  const cache = s.buildings.find((b) => b.type === 'cache')!;
  cache.work = 40;
  cache.workRequired = 400;
  const smithy = s.buildings.find((b) => b.type === 'smithy')!;
  smithy.work = 10;
  smithy.workRequired = 900;
  s.pop = 40 + 170 * k;
  s.bonded = 12 + 25 * k;
  s.gold = 800 + 2500 * k;
  const cap = storageCap(s);
  RESOURCE_IDS.forEach((r, i) => {
    s.resources[r] = Math.min(cap, 700 + (i + 1) * 900 * (k + 1));
  });
  return s;
}

interface Loss {
  goods: number;
  pop: number;
  bonded: number;
  levels: number;
  works: number;
}

const measure = (s: GameState): Loss => ({
  goods: RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0) + s.gold,
  pop: s.pop,
  bonded: bondedTotal(s),
  levels: s.buildings.reduce((n, b) => n + b.level, 0),
  works: s.buildings.filter((b) => b.workRequired > 0).length,
});

/**
 * Участь настоящим путём: слепок деревни, дверь участи, поля последствия, применение
 * к племени — и потеря, **замеренная на посёлке**, а не прочитанная из результата двери.
 */
function strikeTown(s0: GameState, f: Fate, carry: number, escort: number, seed: number): { r: FateResult; loss: Loss; after: GameState } {
  const s = structuredClone(s0);
  const p = playerProfile(s);
  const r = fate({
    fate: f,
    stock: p.stock,
    gold: p.gold ?? 0,
    stash: p.stash,
    pop: p.pop,
    bonded: p.bonded ?? 0,
    carry,
    escort,
    levels: p.levels,
    seed,
  });
  const before = measure(s);
  const effect: HomeEffect = { id: 't', lost: {}, prestige: 0, morale: 0, battle: null, text: 'т', good: false, ...homeLoss(r) };
  applyEffects(s, [effect]);
  const after = measure(s);
  return {
    r,
    after: s,
    loss: {
      goods: before.goods - after.goods,
      pop: before.pop - after.pop,
      bonded: before.bonded - after.bonded,
      levels: before.levels - after.levels,
      works: before.works - after.works,
    },
  };
}

/** Конвои, которыми берут город: обоз не мешает; мешает людям; мешает и добру. */
const CONVOYS: [number, number][] = [
  [Infinity, Infinity],
  [60_000, 40],
  [3_000, 6],
];

describe('лестница монотонна: каждая следующая ступень стоит городу не меньше предыдущей', () => {
  it('на одном и том же входе — замером на посёлке, по людям, невольникам, уровням, стройке и добру', () => {
    let points = 0;
    const strict = { people: 0, levels: 0, works: 0, goods: 0 };
    for (let k = 0; k < 4; k++) {
      const town = ladderTown(k);
      for (const [carry, escort] of CONVOYS) {
        for (let seed = 1; seed <= 4; seed++) {
          const [a, b, c] = FATE_IDS.map((f) => strikeTown(town, f, carry, escort, seed));
          const [l1, l2, l3] = [a.loss, b.loss, c.loss];
          const label = `посёлок ${k}, обоз ${carry}, конвой ${escort}, соль ${seed}`;
          // Граница области: у города есть что брать, кого уводить и что жечь.
          expect(a.r.lostTotal, `${label}: открытого склада нет`).toBeGreaterThan(0);
          expect(b.r.ledBonded.taken + b.r.ledPop.taken, `${label}: вторая ступень не уводит никого`).toBeGreaterThan(0);
          expect(c.r.fallen.some((x) => x.to < x.from), `${label}: третьей нечего ронять`).toBe(true);

          // Вторая против первой: людей и невольников не меньше, уровни и стройка те же. Добра
          // уносят меньше — но ровно на место людей в обозе, и в мере лестницы (человек —
          // `HEAD_CARRY` добра) город теряет не меньше.
          expect(l2.pop, `${label}: горожане`).toBeGreaterThanOrEqual(l1.pop);
          expect(l2.bonded, `${label}: невольники`).toBeGreaterThanOrEqual(l1.bonded);
          expect(l2.levels, `${label}: уровни`).toBeGreaterThanOrEqual(l1.levels);
          expect(l2.works, `${label}: стройка`).toBeGreaterThanOrEqual(l1.works);
          expect(l2.goods + HEAD_CARRY * (l2.pop + l2.bonded), `${label}: добро в мере лестницы`).toBeGreaterThanOrEqual(l1.goods);
          // Третья против второй: не меньше ни в чём — и в добре тоже, без всякого курса.
          expect(l3.pop, `${label}: сожжение — горожане`).toBeGreaterThanOrEqual(l2.pop);
          expect(l3.bonded, `${label}: сожжение — невольники`).toBeGreaterThanOrEqual(l2.bonded);
          expect(l3.levels, `${label}: сожжение — уровни`).toBeGreaterThanOrEqual(l2.levels);
          expect(l3.works, `${label}: сожжение — стройка`).toBeGreaterThanOrEqual(l2.works);
          expect(l3.goods, `${label}: сожжение — добро`).toBeGreaterThanOrEqual(l2.goods);

          if (l2.pop + l2.bonded > l1.pop + l1.bonded) strict.people++;
          if (l3.levels > l2.levels) strict.levels++;
          if (l3.works > l2.works) strict.works++;
          if (l3.goods > l2.goods) strict.goods++;
          points++;
        }
      }
    }
    expect(points).toBe(48);
    // Лестница — не три одинаковые ступени: разница есть, и она там, где её обещали.
    expect(strict.people, 'вторая уводит людей').toBe(points);
    expect(strict.levels, 'третья роняет больше уровней').toBe(points);
    expect(strict.works, 'третья жжёт стройку').toBe(points);
    expect(strict.goods, 'третья сжигает больше, чем уносит обоз второй').toBeGreaterThan(0);
  });
});

describe('постройки: ниже первого не падает ничто, тайник не падает ни на одной ступени', () => {
  it('на всех трёх ступенях, всех солях и посёлках — замером', () => {
    let floorHit = 0;
    let cacheWouldFall = 0;
    for (let k = 0; k < 4; k++) {
      const town = ladderTown(k);
      const cache = town.buildings.find((b) => b.type === 'cache')!;
      for (const f of FATE_IDS) {
        for (let seed = 1; seed <= 12; seed++) {
          const { after } = strikeTown(town, f, Infinity, Infinity, seed);
          const label = `${f}, посёлок ${k}, соль ${seed}`;
          for (const b of after.buildings) expect(b.level, `${label}: ${b.type}`).toBeGreaterThanOrEqual(1);
          const kept = after.buildings.find((b) => b.type === 'cache')!;
          expect(kept.level, `${label}: уровень тайника`).toBe(cache.level);
          expect([kept.work, kept.workRequired], `${label}: стройка тайника`).toEqual([cache.work, cache.workRequired]);
          // Граница области: удар пришёлся на постройку, которой ниже некуда.
          for (const b of town.buildings) {
            if (b.type === 'cache') continue;
            const now = after.buildings.find((x) => x.id === b.id)!;
            if (now.level === 1 && b.level - FATES[f].levels < 1 && b.level !== now.level) floorHit++;
          }
          // Граница области: не будь тайник вынут из списка, удар пришёлся бы и на него.
          const all = Object.fromEntries(town.buildings.map((b) => [b.type, b.level]));
          if (fate(input({ fate: f, levels: all, seed })).fallen.some((x) => x.id === 'cache')) cacheWouldFall++;
        }
      }
    }
    expect(floorHit, 'дно задевали').toBeGreaterThan(0);
    expect(cacheWouldFall, 'без исключения тайник попадал бы под удар').toBeGreaterThan(0);
  });

  it('сожжение: все постройки по два уровня вместо пяти по одному, недостроенное сгорает, кроме тайника', () => {
    const town = ladderTown(2);
    const { r, after } = strikeTown(town, 'burn', Infinity, Infinity, 5);
    const pool = Object.keys(playerProfile(town).levels ?? {});
    expect(r.fallen.map((x) => x.id).sort(), 'удар на всех, а не на пяти').toEqual([...pool].sort());
    for (const x of r.fallen) expect(x.to).toBe(Math.max(1, x.from - BURN_LEVELS));
    expect(after.buildings.find((b) => b.type === 'smithy')!.workRequired, 'стройка кузницы сгорела').toBe(0);
    // Возврата нет: склад после пожара — ровно тайник, без половины заплаченного.
    const p = playerProfile(town);
    for (const res of RESOURCE_IDS) expect(Math.floor(after.resources[res]), res).toBe(Math.min(p.stock[res] ?? 0, p.stash));
  });
});

describe('уведённые вычитаются из добычи ровно один раз, по курсу обоза', () => {
  it('курс — не новое число: воин везёт `carry` добра или ведёт `escort` людей', () => {
    expect(HEAD_CARRY).toBe(UNIT_BY_ID.warrior.carry / UNIT_BY_ID.warrior.escort);
    expect(HEAD_CARRY).toBe(150);
  });

  it('добыча второй ступени — обоз, но не больше открытого склада минус место людей; город теряет ровно взятое', () => {
    let points = 0;
    const region = { convoyFree: 0, partial: 0, convoyBinds: 0 };
    const STOCKS: Loot[] = [{ food: 900, wood: 300 }, { food: 5000, iron: 2200, stone: 1300 }, { wood: 40_000, food: 30_000 }];
    for (const stock of STOCKS) {
      for (const gold of [0, 1200]) {
        for (const stash of [0, 150]) {
          for (const carry of [Infinity, 2500, 30_000]) {
            for (const escort of [3, 20, 400]) {
              for (const [pop, bonded] of [[30, 2], [400, 40], [2000, 300]] as const) {
                const base = input({ stock, gold, stash, carry, escort, pop, bonded });
                const open = fate({ ...base, fate: 'plunder', carry: Infinity }).takenTotal;
                const r = fate({ ...base, fate: 'captives' });
                const led = r.ledBonded.taken + r.ledPop.taken;
                const label = `склад ${JSON.stringify(stock)}, казна ${gold}, тайник ${stash}, обоз ${carry}, конвой ${escort}, люди ${pop}/${bonded}`;
                // Граница области: уводят хоть кого-то — иначе вычитать нечего.
                expect(led, label).toBeGreaterThan(0);
                expect(r.lessGoods, `${label}: курс`).toBe(HEAD_CARRY * led);
                expect(r.takenTotal, `${label}: взято`).toBe(Math.min(carry, Math.max(0, open - HEAD_CARRY * led)));
                // Ровно один раз и на обе стороны: что взял победитель, то и потерял город.
                expect(winnerGain(r).resources).toEqual(r.taken);
                expect(sum(homeLoss(r).resources), `${label}: город потерял не то, что взяли`).toBe(r.takenTotal);
                expect(winnerGain(r).bonded).toBe(led);
                if (carry >= open) region.convoyFree++;
                if (HEAD_CARRY * led > 0 && HEAD_CARRY * led < open) region.partial++;
                if (carry < open - HEAD_CARRY * led) region.convoyBinds++;
                points++;
              }
            }
          }
        }
      }
    }
    expect(points).toBe(324);
    // Граница области: и там, где обоз не мешает (вычитание из обоза дало бы другое
    // число), и там, где место людей съедает часть склада, и там, где режет сам обоз.
    expect(region.convoyFree).toBeGreaterThan(0);
    expect(region.partial).toBeGreaterThan(0);
    expect(region.convoyBinds).toBeGreaterThan(0);
  });

  it('невольники уходят первыми, горожане — тем конвоем, что остался, и не больше доли', () => {
    for (const escort of [5, 30, 90, 1000]) {
      const r = fate(input({ fate: 'captives', pop: 200, bonded: 40, escort }));
      expect(r.ledBonded.taken, `конвой ${escort}`).toBe(Math.min(40, escort));
      expect(r.ledPop.taken, `конвой ${escort}`).toBe(Math.min(Math.floor(200 * LED_POP_SHARE), Math.max(0, escort - 40)));
    }
  });
});

describe('сожжение: горожане, невольники и победитель', () => {
  it('победителю ничего; горожан расходится объявленная доля, последний остаётся; невольники — все', () => {
    for (const pop of [1, 2, 5, 37, 800]) {
      for (const bonded of [0, 9, 300]) {
        const r = fate(input({ fate: 'burn', pop, bonded, gold: 500, stash: 10, carry: 100, escort: 100 }));
        const label = `люди ${pop}, невольники ${bonded}`;
        expect(r.taken, label).toEqual({});
        expect(r.takenTotal).toBe(0);
        expect(winnerGain(r), label).toEqual({ resources: {} });
        // Огню обоз не нужен: сгорает всё сверх тайника, а не столько, сколько поднял бы отряд.
        expect(r.lostTotal, label).toBe(fate(input({ pop, bonded, gold: 500, stash: 10, carry: Infinity })).takenTotal);
        expect(r.scattered.pop, label).toBe(Math.min(Math.max(0, pop - 1), Math.floor(pop * BURN_POP_SHARE)));
        expect(r.scattered.bonded, label).toBe(bonded);
        expect(r.ledBonded.taken + r.ledPop.taken, label).toBe(0);
      }
    }
  });
});

describe('защита от цепочки: сожжённый город трое суток не сжечь, а ограбить можно', () => {
  const AT = START + 5 * 3_600_000;

  it('срок — ровно окно после сожжения, и держится он до последней секунды', () => {
    const until = burnImmuneUntil(AT);
    expect(until - AT).toBe(BURN_IMMUNE);
    // Число окна выведено отчётом и живёт у объявления; здесь — то, что оно длиннее окна
    // после любого падения: иначе защита от цепочки накрыта им и не значит ничего.
    expect(BURN_IMMUNE, 'защита после сожжения длиннее защиты после падения').toBeGreaterThan(SIEGE_IMMUNE);
    const inside = [AT, AT + 1, AT + 3_600_000, AT + 12 * 3_600_000, AT + SIEGE_IMMUNE, until - 1000, until - 1];
    for (const t of inside) {
      // Граница области: минута внутри окна после сожжения.
      expect(burnImmune(until, t), `${(t - AT) / 1000} с`).toBe(true);
      expect(fateBlock('burn', 'player', until, t), `${(t - AT) / 1000} с: жечь`).not.toBeNull();
      expect(fateAt('burn', 'player', until, t), `${(t - AT) / 1000} с: падение`).toBe(FATE_DEFAULT);
      expect(fateBlock('plunder', 'player', until, t)).toBeNull();
      expect(fateBlock('captives', 'player', until, t)).toBeNull();
      expect(fateAt('captives', 'player', until, t)).toBe('captives');
    }
    expect(fateBlock('burn', 'player', until, until)).toBeNull();
    expect(fateAt('burn', 'player', until, until)).toBe('burn');
    expect(fateBlock('burn', 'player', undefined, AT), 'не жгли — не защищено').toBeNull();
  });
});

describe('сожжение не предлагается логову и двору мира', () => {
  it('ни в какую минуту и ни при какой защите, а грабёж и увод людей — да', () => {
    for (const until of [undefined, START, START + BURN_IMMUNE]) {
      expect(fateBlock('burn', 'world', until, START), `защита ${until}`).not.toBeNull();
      expect(fateAt('burn', 'world', until, START)).toBe(FATE_DEFAULT);
      expect(fateBlock('plunder', 'world', until, START)).toBeNull();
      expect(fateBlock('captives', 'world', until, START)).toBeNull();
    }
    expect(FATE_IDS.filter((f) => !FATES[f].vsWorld)).toEqual(['burn']);
  });
});

describe('разведка не выдаёт больше, чем положено', () => {
  waitsForPlayers('без разведки про склад не известно ничего', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const near = await neighbours(w.world);
    const target = near.sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    const card = await w.world.settlement(target.id);
    expect(card?.loot.precision, 'чужие амбары считает разведчик, а не карта').toBe('unknown');
  });

  waitsForPlayers('разведка показывает только то, что лежит на виду, — тайника в снимке нет', async () => {
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
    expect((await w.world.attack({})).won).toBe(true);
    const reading = await w.world.intel(target.id);
    expect(reading?.precision, 'снимок только что сделан').toBe('exact');
    // И даже он называет только открытую часть: подпол не считают ни разведкой,
    // ни боем — иначе чужой тайник был бы известен, а свой прятал бы от всех.
    expect(reading!.loot.value).toBe(open);
    expect(reading!.loot.value).toBeLessThan(full);
  }, 180_000);
});
