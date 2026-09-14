// Добыча: правило дележа и то, как оно живёт в мире.
//
// Первая половина не знает ни про мир, ни про часы — она проверяет договор
// `world/spoils.ts`: взято = склад минус тайник, но не больше грузоподъёмности,
// и ни одна единица не теряется по дороге. Вторая гоняет настоящий `LocalWorld`:
// склад чужого двора после набега пуст **по факту**, тайник у бота и у игрока
// разбирает один и тот же код, а разведка не выдаёт того, чего видеть нельзя.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { distance } from './geo';
import { FATES, FATE_NOW, fallSeed, fate, homeLoss, lead, plunder, asLoss, type FateInput } from './spoils';
import { stackEscort } from './data/units';
import { AI_STASH_SHARE, FALL_BUILDINGS, FALL_LEVELS, LOOT_PER_POP, LOOT_REFILL } from './data/tuning';
import { applyEffects, playerProfile } from './bridge';
import { FALL_SPARED, fallBuildings, fallPool, fallenText } from '@/game/sim/expedition';
import { BUILDINGS } from '@/game/data/buildings';
import { UPGRADE_GROWTH, RESOURCE_IDS } from '@/game/constants';
import { createInitialState } from '@/game/state';
import { hiddenStash, maxLevelFor, stashAt, storageCap, upgradeCost } from '@/game/derived';
import type { GenSettlement } from './gen';
import type { HomeEffect, Loot, PlayerProfile, SettlementView } from './types';
import type { WorldSave } from './local/state';

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

  it('дележ склада и увод людей зовутся только из двери участи', () => {
    // Не «похоже написано», а буквально одна дверь. Кто импортирует `plunder`
    // или `lead` из модуля дележа, тот и делит; таких мест два: сама дверь и
    // мятеж — у мятежа нет победителя, и участью он не является.
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
    expect(importers.plunder, 'делит склад кто-то кроме двери участи и мятежа').toEqual(['src/game/sim/mutiny.ts']);
    expect(importers.lead, 'уводит людей кто-то кроме двери участи').toEqual([]);

    // Внутри модуля дележа оба правила зовёт только сама дверь.
    const spoils = stripComments(readFileSync(path.resolve('src/world/spoils.ts'), 'utf8'));
    const door = spoils.slice(spoils.indexOf('export function fate('), spoils.indexOf('function pickFallen('));
    const calls = (code: string, fn: string): number => (code.match(new RegExp(`(?<!function )\\b${fn}\\(`, 'g')) ?? []).length;
    expect(calls(spoils, 'plunder'), '`plunder` зовут вне двери').toBe(calls(door, 'plunder'));
    expect(calls(spoils, 'lead'), '`lead` зовут вне двери').toBe(calls(door, 'lead'));
    expect(calls(door, 'plunder')).toBe(1);
    expect(calls(door, 'lead')).toBe(1);
  });

  it('все четыре места, где город взят, идут через дверь участи', () => {
    const code = stripComments(src);
    const method = (name: string): string => {
      const at = code.indexOf(`private ${name}(`);
      expect(at, `метод ${name}`).toBeGreaterThan(0);
      return code.slice(at, code.indexOf('\n  private ', at + 10));
    };
    // Наш город: прорвавшийся набег и голод — одной дверью и одними полями.
    for (const name of ['resolveIncoming', 'homeFalls']) {
      expect(method(name), `${name} идёт мимо двери`).toMatch(/this\.fateHome\(/);
      expect(method(name), `${name} собирает потерю сам`).toMatch(/homeLoss\(/);
    }
    // Чужой двор: наш набег и наш лагерь.
    for (const name of ['attackAt', 'siegeFalls']) {
      expect(method(name), `${name} идёт мимо двери`).toMatch(/this\.takeLoot\(/);
    }
    expect(method('takeLoot')).toMatch(/this\.fateOf\(/);
    expect(method('fateOf')).toMatch(/\bfate\(\{/);
    expect(method('fateHome')).toMatch(/\bfate\(\{/);
    // Вызовов самой двери в мире ровно два — чужой двор и наш город, и ступень
    // у обоих одна и та же, нынешняя.
    expect((code.match(/\bfate\(\{/g) ?? []).length).toBe(2);
    expect((code.match(/fate: FATE_NOW/g) ?? []).length).toBe(2);
  });

  it('чужой двор, павший под чужим же лагерем, нашу деревню не трогает', () => {
    // Раньше в падение нашего города вёл любой не наш лагерь — и война соседей
    // между собой рассеяла бы наш гарнизон, вычистила склад и увела невольников.
    // Проверка стоит на самом городе.
    const fall = src.slice(src.indexOf('private siegeFalls'), src.indexOf('private homeFalls'));
    expect(fall).toContain('if (id === HOME_ID) return this.homeFalls(w, at);');
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
  fate: FATE_NOW,
  stock: { food: 900, wood: 300 },
  gold: 0,
  stash: 0,
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
    const keeps = (Object.keys(FATES) as (keyof typeof FATES)[]).filter((f) => !FATES[f].bonded);
    expect(keeps, 'нынешняя ступень — без увода людей').toContain(FATE_NOW);
    for (const f of keeps) {
      for (const bonded of [1, 40, 400]) {
        for (const escort of [5, 400, 5000]) {
          // Граница области: `lead` увёл бы хоть кого-то.
          expect(lead(bonded, escort).taken).toBeGreaterThan(0);
          const r = fate(input({ fate: f, bonded, escort }));
          expect(r.led, `${f}: невольников ${bonded}, конвой ${escort}`).toEqual({ taken: 0, left: bonded });
          expect(homeLoss(r).bonded, 'в последствие увод не уезжает').toBeUndefined();
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
    expect((await w.world.attack({ setup: null })).won).toBe(true);
    const reading = await w.world.intel(target.id);
    expect(reading?.precision, 'снимок только что сделан').toBe('exact');
    // И даже он называет только открытую часть: подпол не считают ни разведкой,
    // ни боем — иначе чужой тайник был бы известен, а свой прятал бы от всех.
    expect(reading!.loot.value).toBe(open);
    expect(reading!.loot.value).toBeLessThan(full);
  }, 180_000);
});
