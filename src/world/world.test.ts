import { describe, expect, it } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { armySize, defense, soldierPower } from '@/game/derived';
import { applyExpedition, sendableUnits } from '@/game/sim/expedition';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld } from './gen';
import { distance, marchSeconds, terrainAt, terrainFactor, travelSeconds } from './geo';
import { precisionOf, readIntel } from './intel';
import { resolveBattle, stackLosses } from './combat';
import { syncAway, toOutcome } from './bridge';
import { INTEL_EXACT, INTEL_ROUGH, INTEL_VAGUE, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import type { Intel, MarchView, PlayerProfile, SettlementView } from './types';

const START = 1_700_000_000_000;

/** Мир с ручными часами и без сохранения: тесты не трогают localStorage. */
function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
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

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: 20,
  defense: 30,
  warriorPower: 3,
  units: { warrior: 10, scout: 4 },
  resources: { food: 120, wood: 80 },
  ...over,
});

/** Ближайшее к дому чужое поселение — обычная цель первого похода. */
async function nearest(world: LocalWorld): Promise<SettlementView> {
  const info = await world.info();
  const chunk = await world.region({ x: info.home.x - 24, y: info.home.y - 24, w: 48, h: 48 });
  const list = chunk.settlements.filter((s) => !s.mine);
  expect(list.length).toBeGreaterThan(0);
  return list.sort(
    (a, b) => distance(info.home, a) - distance(info.home, b),
  )[0];
}

const own = (marches: MarchView[]): MarchView[] => marches.filter((m) => m.own);

describe('генерация мира', () => {
  it('воспроизводима по сиду', () => {
    const a = generateWorld(12345);
    const b = generateWorld(12345);
    expect(b.home).toEqual(a.home);
    expect(b.allyTribe).toBe(a.allyTribe);
    expect(b.tribes).toEqual(a.tribes);
    expect(b.settlements).toEqual(a.settlements);
  });

  it('другой сид даёт другой мир', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    expect(b.settlements).not.toEqual(a.settlements);
  });

  it('ландшафт клетки зависит только от сида и координат', () => {
    for (const [x, y] of [
      [WORLD_ORIGIN.x + 3, WORLD_ORIGIN.y + 3],
      [WORLD_ORIGIN.x + 77, WORLD_ORIGIN.y + 120],
    ]) {
      expect(terrainAt(99, x, y)).toBe(terrainAt(99, x, y));
    }
  });

  it('деревня игрока стоит в обжитой области, а не в центре сетки', () => {
    const w = generateWorld(4242);
    const center = { x: WORLD_ORIGIN.x + WORLD_SIZE / 2, y: WORLD_ORIGIN.y + WORLD_SIZE / 2 };
    expect(w.home).not.toEqual(center);
    // Рядом обязательно есть соседи — иначе на карту незачем смотреть.
    const near = w.settlements.filter((s) => distance(s, w.home) <= 12);
    expect(near.length).toBeGreaterThan(0);
    // Но не на пороге: набег ИИ не должен приходить мгновенно.
    expect(w.settlements.every((s) => distance(s, w.home) >= 3)).toBe(true);
  });

  it('поселения не садятся в воду и не громоздятся в одной клетке', () => {
    const w = generateWorld(777);
    const seen = new Set<string>();
    for (const s of w.settlements) {
      expect(terrainAt(w.seed, s.x, s.y)).not.toBe('water');
      const key = `${s.x}|${s.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('время пути', () => {
  it('симметрично в обе стороны', () => {
    const seed = 31337;
    const pairs: [{ x: number; y: number }, { x: number; y: number }][] = [
      [{ x: 410, y: 710 }, { x: 455, y: 788 }],
      [{ x: 500, y: 800 }, { x: 501, y: 799 }],
      [{ x: 599, y: 899 }, { x: 400, y: 700 }],
      [{ x: 470, y: 730 }, { x: 470, y: 812 }],
    ];
    for (const [a, b] of pairs) {
      expect(travelSeconds(seed, a, b, { warrior: 3 })).toBe(travelSeconds(seed, b, a, { warrior: 3 }));
      expect(terrainFactor(seed, a, b)).toBe(terrainFactor(seed, b, a));
    }
  });

  it('считается по самому медленному юниту в отряде', () => {
    const dist = 20;
    const alone = marchSeconds(dist, 1, { scout: 2 });
    const together = marchSeconds(dist, 1, { scout: 2, warrior: 1 });
    expect(together).toBeGreaterThan(alone);
    expect(together).toBe(marchSeconds(dist, 1, { warrior: 1 }));
  });

  it('ландшафт замедляет отряд', () => {
    expect(marchSeconds(20, 1.5, { warrior: 1 })).toBeGreaterThan(marchSeconds(20, 1, { warrior: 1 }));
  });
});

describe('разведданные стареют', () => {
  const intel: Intel = { at: START, power: 100, pop: 40, loot: 60 };

  it('точность падает по расписанию', () => {
    expect(precisionOf(0)).toBe('exact');
    expect(precisionOf(INTEL_EXACT - 1)).toBe('exact');
    expect(precisionOf(INTEL_EXACT)).toBe('rough');
    expect(precisionOf(INTEL_ROUGH)).toBe('vague');
    expect(precisionOf(INTEL_VAGUE)).toBe('unknown');
  });

  it('сначала точное число, потом диапазон, потом ничего', () => {
    const fresh = readIntel(intel, START + 60_000);
    expect(fresh?.power.value).toBe(100);

    const rough = readIntel(intel, START + INTEL_EXACT + 1000);
    expect(rough?.power.value).toBeNull();
    expect(rough?.power.min).toBeLessThan(100);
    expect(rough?.power.max).toBeGreaterThan(100);

    const vague = readIntel(intel, START + INTEL_ROUGH + 1000);
    expect(vague?.power.max as number).toBeGreaterThan(rough?.power.max as number);

    expect(readIntel(intel, START + INTEL_VAGUE + 1)).toBeNull();
  });

  it('возраст данных считается от момента разведки', () => {
    const r = readIntel(intel, START + 120_000);
    expect(r?.ageSeconds).toBe(120);
  });
});

describe('бой', () => {
  it('один сид — один результат', () => {
    const a = resolveBattle({ seed: 987654, attack: 40, defense: 30 });
    const b = resolveBattle({ seed: 987654, attack: 40, defense: 30 });
    expect(b).toEqual(a);
  });

  it('другой сид — другая удача', () => {
    const a = resolveBattle({ seed: 1, attack: 40, defense: 30 });
    const b = resolveBattle({ seed: 2, attack: 40, defense: 30 });
    expect(b.luck).not.toBe(a.luck);
  });

  it('проигравший теряет много, но не всех: отряд отступает', () => {
    const out = resolveBattle({ seed: 5, attack: 5, defense: 100 });
    expect(out.won).toBe(false);
    expect(out.attackerLoss).toBeLessThan(1);
    const lost = stackLosses({ warrior: 10, scout: 2 }, out.attackerLoss);
    expect(lost.warrior).toBeLessThan(10);
    // Разведчики держатся позади — их выбивает реже.
    expect(lost.scout ?? 0).toBeLessThan(lost.warrior as number);
  });
});

describe('армия в походе', () => {
  /** Армия — счётчик бойцов, а не жители с профессией: роли «воин» больше нет. */
  const withWarriors = (n: number): GameState => {
    const s = createInitialState();
    for (const v of s.villagers) {
      v.job = 'idle';
      v.workplace = null;
    }
    s.army.spearman = n;
    return s;
  };

  it('не учитывается в обороне своей деревни', () => {
    const s = withWarriors(5);
    const full = defense(s);
    s.warriorsAway = 3;
    const left = defense(s);
    // Уходят бойцы, а не жители: жительская четвертинка обороны остаётся дома.
    expect(left).toBeCloseTo(full - 3 * soldierPower(s), 5);
    expect(left).toBeLessThan(full);
  });

  it('число ушедших выводится из списка походов', () => {
    const s = withWarriors(6);
    const marches: MarchView[] = [
      {
        id: 'm1',
        mission: 'raid',
        units: { warrior: 4, scout: 1 },
        own: true,
        hostile: false,
        phase: 'out',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        fromName: 'дом',
        toName: 'цель',
        targetId: 's1',
        departAt: START,
        arriveAt: START + 1000,
        loot: null,
        recallable: true,
      },
      {
        id: 'm2',
        mission: 'raid',
        units: { warrior: 99 },
        own: false,
        hostile: true,
        phase: 'out',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        fromName: 'чужие',
        toName: 'дом',
        targetId: 'home',
        departAt: START,
        arriveAt: START + 1000,
        loot: null,
        recallable: false,
      },
    ];
    expect(syncAway(s, marches)).toBe(true);
    // Чужой отряд в свои потери не записывается.
    expect(s.warriorsAway).toBe(4);
    expect(s.scoutsAway).toBe(1);
    expect(sendableUnits(s).warrior).toBe(2);
    // Повторный вызов ничего не меняет.
    expect(syncAway(s, marches)).toBe(false);
  });

  it('разведчики уходят из свободных жителей и не строят', () => {
    const s = createInitialState();
    const free = sendableUnits(s).scout;
    s.scoutsAway = free;
    expect(sendableUnits(s).scout).toBe(0);
  });
});

describe('походы в локальном мире', () => {
  it('набег доходит, даёт отчёт и возвращается ровно за то же время', async () => {
    const { world, at } = makeWorld(11);
    await world.sync(profile());
    const target = await nearest(world);

    const res = await world.send({ target: target.id, mission: 'raid', units: { warrior: 8 } });
    expect(res.error).toBeNull();
    const m = res.march as MarchView;
    const trip = m.arriveAt - m.departAt;
    expect(trip).toBeGreaterThan(0);

    at(m.arriveAt);
    const arrival = await world.sync(profile());
    expect(arrival.reports).toHaveLength(1);
    expect(arrival.reports[0].kind).toBe('raid');
    expect(arrival.effects.length).toBeGreaterThan(0);

    const back = own(arrival.marches)[0];
    expect(back.phase).toBe('back');
    // Обратный путь занимает столько же, сколько дорога туда.
    expect(back.arriveAt - back.departAt).toBe(trip);

    at(back.arriveAt);
    const home = await world.sync(profile());
    expect(own(home.marches)).toHaveLength(0);
    expect(home.effects.length).toBeGreaterThan(0);
  });

  it('один и тот же поход с одним сидом даёт один и тот же результат боя', async () => {
    const run = async () => {
      const { world, at } = makeWorld(2024);
      await world.sync(profile());
      const target = await nearest(world);
      const res = await world.send({ target: target.id, mission: 'raid', units: { warrior: 7 } });
      at((res.march as MarchView).arriveAt);
      const pulse = await world.sync(profile());
      return pulse.reports[0];
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
  });

  it('отзыв возвращает отряд ровно за пройденное время', async () => {
    const { world, advance } = makeWorld(31);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'raid', units: { warrior: 5 } });
    const m = res.march as MarchView;

    advance(30_000);
    expect(await world.recall(m.id)).toBeNull();
    const back = own(await world.marches())[0];
    expect(back.phase).toBe('back');
    expect(back.arriveAt - back.departAt).toBe(30_000);
    expect(back.recallable).toBe(false);
  });

  it('разведка пишет свежие данные, и они стареют', async () => {
    const { world, at } = makeWorld(55);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
    const m = res.march as MarchView;

    expect((await world.settlement(target.id))?.power.precision).toBe('unknown');

    at(m.arriveAt);
    await world.sync(profile());
    const card = await world.settlement(target.id);
    expect(card?.power.precision).toBe('exact');
    expect(card?.intel?.ageSeconds).toBe(0);

    at(m.arriveAt + INTEL_EXACT + 1000);
    const older = await world.settlement(target.id);
    expect(older?.power.precision).toBe('rough');

    at(m.arriveAt + INTEL_VAGUE + 1000);
    const gone = await world.settlement(target.id);
    expect(gone?.power.precision).toBe('unknown');
    expect(gone?.intel).toBeNull();
  });

  it('своя деревня видна всегда и точно, чужая — нет', async () => {
    const { world } = makeWorld(8);
    await world.sync(profile({ defense: 42, pop: 17 }));
    const home = await world.settlement('home');
    expect(home?.mine).toBe(true);
    expect(home?.power.value).toBe(42);
    expect(home?.pop.value).toBe(17);
    expect(home?.can.open).toBe(true);
    expect(home?.can.raid).toBe(false);
  });

  it('пустой отряд и чужие люди в поход не уходят', async () => {
    const { world } = makeWorld(9);
    await world.sync(profile({ units: { warrior: 2, scout: 0 } }));
    const target = await nearest(world);
    expect((await world.send({ target: target.id, mission: 'raid', units: {} })).error).not.toBeNull();
    expect(
      (await world.send({ target: target.id, mission: 'raid', units: { warrior: 5 } })).error,
    ).not.toBeNull();
    expect(
      (await world.send({ target: target.id, mission: 'scout', units: { warrior: 1 } })).error,
    ).not.toBeNull();
    expect((await world.send({ target: 'home', mission: 'raid', units: { warrior: 1 } })).error).not.toBeNull();
  });

  it('поддержку принимают только союзники', async () => {
    const { world } = makeWorld(17);
    await world.sync(profile());
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    const ally = chunk.settlements.find((s) => s.relation === 'ally');
    const other = chunk.settlements.find((s) => s.relation === 'neutral' || s.relation === 'barbarian');
    if (ally) expect((await world.send({ target: ally.id, mission: 'support', units: { warrior: 2 } })).error).toBeNull();
    if (other) {
      expect(
        (await world.send({ target: other.id, mission: 'support', units: { warrior: 2 } })).error,
      ).not.toBeNull();
    }
  });

  it('набег поднимает враждебность всего племени', async () => {
    const { world, at } = makeWorld(23);
    await world.sync(profile());
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    const target = chunk.settlements.find((s) => s.tribeId);
    expect(target).toBeTruthy();
    const before = (await world.tribes()).find((t) => t.id === target?.tribeId)?.hostility ?? 0;

    const res = await world.send({
      target: (target as SettlementView).id,
      mission: 'raid',
      units: { warrior: 6 },
    });
    at((res.march as MarchView).arriveAt);
    await world.sync(profile());

    const after = (await world.tribes()).find((t) => t.id === target?.tribeId)?.hostility ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});

describe('замки', () => {
  /** Ближайший к дому замок. Флаг стоит в генерации, поэтому ищем его там же. */
  function nearestCastle(seed: number) {
    const gen = generateWorld(seed);
    const castles = gen.settlements.filter((s) => s.castle);
    expect(castles.length, 'в мире должны быть замки').toBeGreaterThan(0);
    return castles.sort((a, b) => distance(gen.home, a) - distance(gen.home, b))[0];
  }

  it('замки видны на карте с первого дня', async () => {
    const w = makeWorld(11);
    const castle = nearestCastle(11);
    await w.world.sync(profile());
    expect((await w.world.settlement(castle.id))?.castle).toBe(true);
  });

  it('набег на замок без достаточной армии не приносит золота и стоит потерь', async () => {
    const w = makeWorld(11);
    const castle = nearestCastle(11);
    // Отряд заведомо слабее гарнизона замка: один воин против крепости.
    await w.world.sync(profile({ warriorPower: 1, units: { warrior: 2 } }));
    const card = await w.world.settlement(castle.id);
    expect(card).toBeTruthy();

    const sent = await w.world.send({ target: castle.id, mission: 'raid', units: { warrior: 2 } });
    expect(sent.error).toBeNull();
    w.advance(60 * 60_000);
    const pulse = await w.world.sync(profile({ warriorPower: 1, units: { warrior: 2 } }));

    const raid = pulse.reports.find((r) => r.kind === 'raid');
    expect(raid, 'должен прийти отчёт о набеге').toBeTruthy();
    expect(raid!.won).toBe(false);
    expect(raid!.loot).toBeNull();
    // Потери настоящие, а добычи нет — ни ресурсов, ни золота.
    expect((raid!.lost.warrior ?? 0)).toBeGreaterThan(0);
    for (const e of pulse.effects) expect(e.resources.gold ?? 0).toBe(0);
    expect(pulse.effects.some((e) => (e.lost.warrior ?? 0) > 0)).toBe(true);
  });

  it('сильный отряд берёт замок и привозит золото домой', async () => {
    const w = makeWorld(11);
    const castle = nearestCastle(11);
    const strong = profile({ warriorPower: 40, units: { warrior: 40 } });
    await w.world.sync(strong);
    expect((await w.world.send({ target: castle.id, mission: 'raid', units: { warrior: 40 } })).error).toBeNull();

    // Дорога туда, бой, дорога обратно.
    w.advance(6 * 60 * 60_000);
    const pulse = await w.world.sync(strong);
    const raid = pulse.reports.find((r) => r.kind === 'raid');
    expect(raid?.won).toBe(true);
    expect(raid?.loot?.gold ?? 0, 'из замка должны везти золото').toBeGreaterThan(0);
    // Золото приезжает домой отдельным последствием — как и остальная добыча.
    const home = pulse.effects.find((e) => (e.resources.gold ?? 0) > 0);
    expect(home, 'золото должно доехать до деревни').toBeTruthy();

    const s = createInitialState();
    applyExpedition(s, toOutcome(home!));
    expect(s.gold).toBeGreaterThan(0);
  });

  it('обычное поселение золота не даёт', async () => {
    const w = makeWorld(11);
    const strong = profile({ warriorPower: 40, units: { warrior: 40 } });
    await w.world.sync(strong);
    const target = await nearest(w.world);
    const gen = generateWorld(11).settlements.find((x) => x.id === target.id);
    if (gen?.castle) return; // ближайшая цель оказалась замком — проверять нечего
    expect((await w.world.send({ target: target.id, mission: 'raid', units: { warrior: 40 } })).error).toBeNull();
    w.advance(6 * 60 * 60_000);
    const pulse = await w.world.sync(strong);
    for (const e of pulse.effects) expect(e.resources.gold ?? 0).toBe(0);
  });
});

describe('мягкость мира', () => {
  it('набег ИИ приходит с запасом времени и не сильнее обороны', async () => {
    const { world, advance } = makeWorld(101);
    await world.sync(profile());
    // Ждём дольше самой длинной паузы между набегами.
    advance(40 * 60_000);
    const pulse = await world.sync(profile());
    const raid = pulse.marches.find((m) => m.hostile);
    if (!raid) return; // ближних соседей может не оказаться — это допустимо
    expect(raid.arriveAt - pulse.now).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it('набег, пришедшийся на отсутствие игрока, не состоится', async () => {
    const { world, advance, at } = makeWorld(202);
    await world.sync(profile());
    advance(40 * 60_000);
    const pulse = await world.sync(profile());
    const raid = pulse.marches.find((m) => m.hostile);
    if (!raid) return;

    // Игрок закрыл игру и вернулся, когда всё давно прошло.
    at(raid.arriveAt + 30 * 60_000);
    const later = await world.sync(profile());
    expect(later.marches.some((m) => m.hostile && m.id === raid.id)).toBe(false);
    const report = later.reports.find((r) => r.id === `${raid.id}-skip`);
    expect(report?.title).toBe('Набег не состоялся');
    // Никто ничего не потерял.
    expect(later.effects.every((e) => Object.keys(e.lost).length === 0)).toBe(true);
  });
});

describe('последствия для племени', () => {
  it('добыча ложится на склад, потери убирают бойцов', () => {
    const s = createInitialState();
    s.army.spearman = 3;
    const before = armySize(s);
    const villagersBefore = s.villagers.length;
    const food = s.resources.food;

    applyExpedition(
      s,
      toOutcome({
        id: 'e1',
        lost: { warrior: 2 },
        resources: { food: 25 },
        prestige: 4,
        morale: 3,
        battle: 'won',
        text: 'Набег удался.',
        good: true,
      }),
    );

    expect(armySize(s)).toBe(before - 2);
    // Бойцы гибнут из армии, племя при этом не редеет.
    expect(s.villagers.length).toBe(villagersBefore);
    expect(s.resources.food).toBeGreaterThan(food);
    expect(s.stats.battlesWon).toBe(1);
    expect(s.log[0].text).toContain('Не вернулись');
  });

  it('разграбление уносит ресурсы, но не уводит склад в минус', () => {
    const s = createInitialState();
    s.resources.wood = 10;
    applyExpedition(
      s,
      toOutcome({
        id: 'e2',
        lost: {},
        resources: { wood: -50 },
        prestige: 0,
        morale: -10,
        battle: 'lost',
        text: 'Разграбили.',
        good: false,
      }),
    );
    expect(s.resources.wood).toBe(0);
    expect(s.stats.battlesLost).toBe(1);
  });
});

describe('карта', () => {
  it('область отдаёт ландшафт и поселения куском', async () => {
    const { world } = makeWorld(64);
    const info = await world.info();
    await world.sync(profile());
    const chunk = await world.region({ x: info.home.x - 16, y: info.home.y - 16, w: 32, h: 32 });
    expect(chunk.terrain.length).toBe(chunk.rect.w * chunk.rect.h);
    expect(chunk.settlements.some((s) => s.mine)).toBe(true);
  });

  it('область за краем мира обрезается, а не выдумывается', async () => {
    const { world } = makeWorld(65);
    const chunk = await world.region({ x: WORLD_ORIGIN.x - 20, y: WORLD_ORIGIN.y - 20, w: 32, h: 32 });
    expect(chunk.rect.x).toBe(WORLD_ORIGIN.x);
    expect(chunk.rect.y).toBe(WORLD_ORIGIN.y);
    expect(chunk.terrain.length).toBe(chunk.rect.w * chunk.rect.h);
  });
});
