import { describe, expect, it } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { armySize, defense, soldierPower } from '@/game/derived';
import { applyExpedition, sendableUnits } from '@/game/sim/expedition';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld } from './gen';
import { distance, marchSeconds, terrainAt, terrainFactor, travelSeconds } from './geo';
import { precisionOf, readIntel } from './intel';
import { stackLosses } from './combat';
import { resolveField } from './battle';
import { defenseLock } from './store';
import { presetFormation, toArmySetup } from '@/game/battle/formation';
import type { ArmySetup, Stack } from '@/battle';
import { awayTroops, homeTroops, playerProfile, syncAway, toOutcome } from './bridge';
import { FogMap, fogSaveBytes } from './fog';
import { troopTotal } from '@/game/battle/kinds';
import {
  AI_WARNING_BASE,
  DEFENSE_FREEZE,
  HOME_SIGHT,
  INTEL_EXACT,
  INTEL_ROUGH,
  INTEL_VAGUE,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from './data/tuning';
import type { FigureView, Intel, MarchView, PlayerProfile, SettlementView } from './types';

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
  // Выше AI_MIN_POP: посёлок нового масштаба, набеги ИИ по нему идут.
  pop: 120,
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

/**
 * Единственный способ ударить: довести полководца до цели и напасть. Отправки
 * набега «гонцом» в игре больше нет, поэтому и в тестах её быть не должно —
 * иначе они проверяли бы путь, которым игрок пройти не может.
 */
async function raidWith(
  w: ReturnType<typeof makeWorld>,
  target: { id: string; x: number; y: number },
  p: PlayerProfile,
  setup: ArmySetup | null = null,
) {
  await w.world.sync(p);
  expect(await w.world.setGarrison(p.army ?? {})).toBeNull();
  expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
  const walking = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
  w.at(walking.arriveAt);
  await w.world.sync(p);
  const res = await w.world.attack({ setup });
  const pulse = await w.world.sync(p);
  return { res, pulse, walk: walking.arriveAt - walking.departAt };
}

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
  const side = (kinds: Partial<Stack>) => ({
    kinds: { spear: 0, infantry: 0, archer: 0, cavalry: 0, ...kinds },
    setup: null,
  });

  it('один сид — один результат и один журнал', () => {
    const input = { seed: 987654, attacker: side({ infantry: 40 }), defender: side({ infantry: 30 }) };
    const a = resolveField(input);
    const b = resolveField(input);
    expect(b.result?.log).toEqual(a.result?.log);
    expect(b.won).toBe(a.won);
  });

  it('другой сид — другая расстановка быстрой атаки', () => {
    const army = side({ spear: 100, infantry: 100, archer: 60, cavalry: 40 });
    const presets = new Set<string | null>();
    for (let seed = 1; seed <= 40; seed++) {
      presets.add(resolveField({ seed, attacker: army, defender: side({ infantry: 200 }) }).preset.attacker);
    }
    expect(presets.size).toBeGreaterThan(1);
  });

  it('проигравший теряет много, но не всех: отряд отступает', () => {
    const out = resolveField({ seed: 5, attacker: side({ infantry: 5 }), defender: side({ infantry: 100 }) });
    expect(out.won).toBe(false);
    expect(out.attackerLoss).toBeLessThanOrEqual(1);
    const lost = stackLosses({ warrior: 10, scout: 2 }, Math.min(0.9, out.attackerLoss));
    expect(lost.warrior).toBeLessThan(10);
    // Разведчики держатся позади — их выбивает реже.
    expect(lost.scout ?? 0).toBeLessThan(lost.warrior as number);
  });

  it('пустая сторона в ядро не идёт: пришедший никем проигрывает', () => {
    const out = resolveField({ seed: 3, attacker: side({}), defender: side({ infantry: 10 }) });
    expect(out.won).toBe(false);
    expect(out.result).toBeNull();
  });
});

describe('армия в походе', () => {
  /** Армия — счётчик бойцов, а не жители с профессией: роли «воин» больше нет. */
  const withWarriors = (n: number): GameState => {
    const s = createInitialState();
    s.workers = {};
    s.freeJobs = {};
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
  it('полководец доводит армию до цели, бьёт и остаётся в поле', async () => {
    const w = makeWorld(11);
    const p = profile({ warriorPower: 4, army: { clubman: 8, spearman: 6 } });
    await w.world.sync(p);
    const target = await nearest(w.world);

    const { res, pulse, walk } = await raidWith(w, target, p);
    expect(walk).toBeGreaterThan(0);
    expect(res.error).toBeNull();
    expect(pulse.reports.some((r) => r.kind === 'raid')).toBe(true);
    expect(pulse.effects.length).toBeGreaterThan(0);

    // Уцелевшие остаются при полководце: в поле состав войска не меняется.
    const general = pulse.figures.find((f) => f.id === 'general') as FigureView;
    expect(general.phase === 'field' || general.phase === 'down').toBe(true);
    if (general.phase === 'field') expect(general.atId).toBe(target.id);
  });

  it('набег гонцом отправить нельзя: армию водит только полководец', async () => {
    const { world } = makeWorld(11);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'raid', units: { warrior: 8 } });
    expect(res.error).toBeTruthy();
    expect(res.march).toBeNull();
  });

  it('один и тот же поход с одним сидом даёт один и тот же результат боя', async () => {
    const run = async () => {
      const w = makeWorld(2024);
      const p = profile({ warriorPower: 4, army: { clubman: 7 } });
      const target = await nearest(w.world);
      const { pulse } = await raidWith(w, target, p);
      return pulse.reports.find((r) => r.kind === 'raid');
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
  });

  it('отзыв возвращает отряд ровно за пройденное время', async () => {
    const { world, advance } = makeWorld(31);
    await world.sync(profile());
    const target = await nearest(world);
    const res = await world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
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
    const w = makeWorld(23);
    const world = w.world;
    const p = profile({ warriorPower: 4, army: { clubman: 6 } });
    await world.sync(p);
    const info = await world.info();
    const chunk = await world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
    // Ищем среди того, что уже разведано: неоткрытых клеток карта не отдаёт.
    const target = chunk.settlements.find((s) => s.tribeId);
    expect(target).toBeTruthy();
    const before = (await world.tribes()).find((t) => t.id === target?.tribeId)?.hostility ?? 0;

    await raidWith(w, target as SettlementView, p);

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
    // Отряд заведомо слабее гарнизона замка: пара дубинщиков против крепости.
    const weak = profile({ warriorPower: 1, units: { warrior: 2 }, army: { clubman: 2 } });
    const { pulse } = await raidWith(w, castle, weak);

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
    const strong = profile({
      warriorPower: 40,
      units: { warrior: 40 },
      army: { legionary: 30, archer: 20, rider: 10, spearman: 20 },
    });
    const { pulse } = await raidWith(w, castle, strong);
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
    const strong = profile({
      warriorPower: 40,
      units: { warrior: 40 },
      army: { legionary: 30, archer: 20, rider: 10, spearman: 20 },
    });
    await w.world.sync(strong);
    const target = await nearest(w.world);
    const gen = generateWorld(11).settlements.find((x) => x.id === target.id);
    if (gen?.castle) return; // ближайшая цель оказалась замком — проверять нечего
    const { pulse } = await raidWith(w, target, strong);
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
    const villagersBefore = s.pop;
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
    expect(s.pop).toBe(villagersBefore);
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

describe('состав отряда и отчёт о бое', () => {
  it('поход несёт состав, и потери списываются теми же видами', async () => {
    const w = makeWorld(77);
    const army = { spearman: 6, archer: 4, clubman: 4 };
    const p = profile({ warriorPower: 4, units: { warrior: 14, scout: 4 }, army, militia: 10 });
    await w.world.sync(p);
    const target = await nearest(w.world);

    const { res, pulse } = await raidWith(w, target, p);
    expect(res.error).toBeNull();
    const raid = pulse.reports.find((r) => r.kind === 'raid');
    expect(raid, 'должен прийти отчёт о набеге').toBeTruthy();

    // Отчёт строится из журнала: он есть, он именованный и он про эти же числа.
    const battle = raid!.battle;
    expect(battle, 'у набега должен быть журнал боя').toBeTruthy();
    expect(battle!.us).toBe('attacker');
    expect(battle!.result.log.length).toBeGreaterThan(3);
    expect(battle!.result.ticks).toBeGreaterThanOrEqual(50);
    expect(battle!.result.ticks).toBeLessThanOrEqual(100);

    const effect = pulse.effects.find((e) => e.lostTroops);
    expect(effect, 'потери должны прийти по видам бойцов').toBeTruthy();
    for (const [id, n] of Object.entries(effect!.lostTroops ?? {})) {
      expect(n).toBeLessThanOrEqual((army as Record<string, number>)[id] ?? 0);
    }
  });

  it('быстрая атака и настроенная расстановка — разные бои с одного сида', async () => {
    const army = { spearman: 8, archer: 6 };
    const run = async (setup: ArmySetup | null) => {
      const w = makeWorld(4242);
      const p = profile({ warriorPower: 4, units: { warrior: 14, scout: 0 }, army });
      await w.world.sync(p);
      const target = await nearest(w.world);
      const { pulse } = await raidWith(w, target, p, setup);
      return pulse.reports.find((r) => r.kind === 'raid')!.battle!;
    };
    const quick = await run(null);
    const tuned = await run(toArmySetup(presetFormation(army, 'anti-cavalry')));
    // У быстрой атаки пресет назван, у настроенной — нет: расстановку задали руками.
    expect(quick.preset).not.toBeNull();
    expect(tuned.preset).toBeNull();
  });

  it('разведка показывает состав и построение, а с возрастом — только порядок величины', async () => {
    const w = makeWorld(88);
    const p = profile();
    await w.world.sync(p);
    const target = await nearest(w.world);
    const sent = await w.world.send({ target: target.id, mission: 'scout', units: { scout: 3 } });
    w.at((sent.march as MarchView).arriveAt);
    await w.world.sync(p);

    const fresh = await w.world.intel(target.id);
    expect(fresh?.kinds, 'свежая разведка знает состав').toBeTruthy();
    expect(fresh?.formation, 'и построение').toBeTruthy();
    expect(fresh?.style).toBeTruthy();
    expect(Object.keys(fresh!.formation!).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    // Резерв и план разведка не даёт: на этом держится вся неопределённость.
    expect(Object.keys(fresh!.formation!)).not.toContain('R');

    w.advance(INTEL_VAGUE - INTEL_ROUGH + 1000);
    const old = await w.world.intel(target.id);
    expect(old?.precision).toBe('vague');
    expect(old?.formation, 'старое построение не показывают как нынешнее').toBeNull();
  });
});

describe('заморозка обороны', () => {
  const incoming = (arriveAt: number): MarchView => ({
    id: 'x',
    mission: 'raid',
    units: { warrior: 5 },
    own: false,
    hostile: true,
    phase: 'out',
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
    fromName: 'Чужие',
    toName: 'Наша деревня',
    targetId: 'home',
    departAt: 0,
    arriveAt,
    loot: null,
    recallable: false,
  });

  it('срабатывает ровно за пять минут', () => {
    const now = START;
    expect(defenseLock([incoming(now + DEFENSE_FREEZE + 1000)], now).frozen).toBe(false);
    expect(defenseLock([incoming(now + DEFENSE_FREEZE)], now).frozen).toBe(true);
    expect(defenseLock([incoming(now + 1000)], now).frozen).toBe(true);
    expect(DEFENSE_FREEZE).toBe(5 * 60_000);
  });

  it('окно на перестройку есть: предупреждение длиннее заморозки', () => {
    // Иначе набег появляется уже запертым, и панель обороны — замок на двери.
    // Проверяется база — то, что видно вообще без Дозора: он время только
    // прибавляет, укоротить предупреждение он не может.
    expect(AI_WARNING_BASE).toBeGreaterThan(DEFENSE_FREEZE);
    const now = START;
    const arriveAt = now + AI_WARNING_BASE;
    expect(defenseLock([incoming(arriveAt)], now).frozen).toBe(false);
    expect(defenseLock([incoming(arriveAt)], now).seconds).toBeGreaterThan(DEFENSE_FREEZE / 1000);
  });

  it('без чужих отрядов оборона открыта', () => {
    expect(defenseLock([], START).frozen).toBe(false);
    expect(defenseLock([], START).march).toBeNull();
  });

  /**
   * Прогон набега ИИ на деревню с заданной обороной. `switchAt` — момент, в
   * который игрок присылает другую расстановку: до отметки её обязаны принять,
   * после — нет. Пульсы идут часто: набег, пришедшийся на отсутствие игрока,
   * не состоится, и редким опросом до боя не дойти.
   */
  async function defendWith(early: ArmySetup, late: ArmySetup, switchBeforeMs: number) {
    const w = makeWorld(303);
    const army = { spearman: 10, archer: 6 };
    const p = (setup: ArmySetup): PlayerProfile =>
      profile({ army, militia: 10, defenseSetup: setup, units: { warrior: 16, scout: 2 } });

    await w.world.sync(p(early));
    for (let i = 0; i < 200; i++) {
      w.advance(15_000);
      const pulse = await w.world.sync(p(early));
      const raid = pulse.marches.find((m) => m.hostile);
      if (!raid) continue;

      // Доводим до боя короткими шагами, меняя оборону в назначенный момент.
      while (w.now() < raid.arriveAt) {
        w.advance(15_000);
        const at = w.now();
        const setup = raid.arriveAt - at <= switchBeforeMs ? late : early;
        const pulse2 = await w.world.sync(p(setup));
        const report = pulse2.reports.find((r) => r.kind === 'defense' && r.battle);
        if (report) return report.battle!;
      }
      const last = await w.world.sync(p(late));
      const report = last.reports.find((r) => r.kind === 'defense' && r.battle);
      if (report) return report.battle!;
      return null;
    }
    return null;
  }

  it('расстановка, присланная после отметки, в бой не идёт', async () => {
    const army = { spearman: 10, archer: 6 };
    const early = toArmySetup(presetFormation(army, 'defense'), 10);
    const late = toArmySetup(presetFormation(army, 'center-punch'), 10);

    const held = await defendWith(early, late, DEFENSE_FREEZE - 30_000);
    const never = await defendWith(early, early, 0);
    const always = await defendWith(late, late, 0);
    expect(held, 'набег ИИ должен дойти до боя').toBeTruthy();
    expect(never).toBeTruthy();
    expect(always).toBeTruthy();
    if (!held || !never || !always) return;

    expect(held.us).toBe('defender');
    // Смена внутри пяти минут ничего не изменила: бой тот же, что без неё.
    expect(held.result.log).toEqual(never.result.log);
    // А если бы расстановка не значила ничего, проверять было бы нечего.
    expect(always.result.log).not.toEqual(never.result.log);
  });
});

describe('туман войны', () => {
  it('на старте видно своё поселение и минимум двух соседей', async () => {
    // Не на одном сиде: чёрный экран на входе недопустим в любом мире.
    for (const seed of [1, 7, 11, 23, 31, 42, 55, 88, 2024, 4242]) {
      const w = makeWorld(seed);
      await w.world.sync(profile());
      const info = await w.world.info();
      const chunk = await w.world.region({ x: info.home.x - 40, y: info.home.y - 40, w: 80, h: 80 });
      expect(chunk.settlements.some((s) => s.mine), `сид ${seed}: своё поселение`).toBe(true);
      const neighbours = chunk.settlements.filter((s) => !s.mine);
      expect(neighbours.length, `сид ${seed}: соседей на старте`).toBeGreaterThanOrEqual(2);
      // И они не «где-то там»: до них видно, куда идти.
      for (const n of neighbours) expect(distance(info.home, n)).toBeLessThanOrEqual(HOME_SIGHT);
    }
  });

  it('неразведанного поселения на карте нет вовсе — ни точки, ни карточки', async () => {
    const w = makeWorld(11);
    await w.world.sync(profile());
    const info = await w.world.info();
    const far = generateWorld(11).settlements
      .filter((s) => distance(info.home, s) > HOME_SIGHT + 6)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
    expect(far, 'в мире должно быть что-то за пределами стартового обзора').toBeTruthy();
    const chunk = await w.world.region({ x: far.x - 2, y: far.y - 2, w: 5, h: 5 });
    expect(chunk.settlements.some((s) => s.id === far.id)).toBe(false);
    expect(await w.world.settlement(far.id)).toBeNull();
  });

  it('разведанная местность не затягивается обратно, а живые данные — да', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const info = await w.world.info();
    const far = generateWorld(11).settlements
      .filter((s) => distance(info.home, s) > HOME_SIGHT + 4)
      .sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];

    // Разведчик встаёт в трёх клетках: вплотную к сильному поселению его могут
    // взять часовые, а обзора в восемь клеток хватает и отсюда.
    expect(await w.world.moveFigure('scout', { x: far.x + 3, y: far.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'scout') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);

    const near = async () => (await w.world.region({ x: far.x - 1, y: far.y - 1, w: 3, h: 3 })).settlements
      .find((s) => s.id === far.id);
    const seen = await near();
    expect(seen, 'пришли — увидели').toBeTruthy();
    expect(seen!.visible).toBe(true);
    expect(seen!.stale).toBe(false);
    expect(seen!.seenPop).toBeGreaterThan(0);

    // Уводим разведчика домой и ждём. Местность остаётся открытой навсегда.
    expect(await w.world.recallFigure('scout')).toBeNull();
    const back = (await w.world.figures()).find((f) => f.id === 'scout') as FigureView;
    w.at(back.arriveAt + 60_000);
    await w.world.sync(p);

    const later = await near();
    expect(later, 'поселение с карты не пропадает').toBeTruthy();
    expect(later!.visible).toBe(false);
    expect(later!.stale, 'живые данные помечены устаревшими').toBe(true);
    expect(later!.seenAt).toBe(seen!.seenAt);
    expect(later!.seenPop).toBe(seen!.seenPop);
    // И давность видна: карточке есть что сказать про возраст данных.
    expect(w.now() - (later!.seenAt as number)).toBeGreaterThan(60_000);

    const chunk = await w.world.region({ x: far.x - 1, y: far.y - 1, w: 3, h: 3 });
    const ix = far.x - chunk.rect.x;
    const iy = far.y - chunk.rect.y;
    expect(chunk.explored[iy * chunk.rect.w + ix]).toBe(1);
  });

  it('размер сохранения: половина карты в маске — единицы килобайт', () => {
    const w = makeWorld(11);
    const fog = new FogMap();
    // Открываем ровно половину сетки — верхнюю.
    for (let y = 0; y < WORLD_SIZE / 2; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) fog.reveal(WORLD_ORIGIN.x + x, WORLD_ORIGIN.y + y);
    }
    expect(fog.count()).toBe((WORLD_SIZE * WORLD_SIZE) / 2);
    const bytes = fogSaveBytes(fog.toJSON());
    // Двадцать тысяч клеток списком строк вида «541|822» — это 195 КБ в JSON.
    // Маска даёт 5.0 КБ, и потолок стоит рядом: если она вдруг вырастет вчетверо,
    // тест обязан упасть, а не молча раздуть сохранение мира.
    expect(bytes).toBeGreaterThan(4000);
    expect(bytes).toBeLessThan(6000);
    expect(w.world.exploredCells()).toBeGreaterThan(0);
  });
});

describe('фигуры на карте', () => {
  const far = (seed: number, home: { x: number; y: number }) =>
    generateWorld(seed).settlements
      .filter((s) => distance(home, s) > HOME_SIGHT + 4)
      .sort((a, b) => distance(home, a) - distance(home, b))[0];

  it('дошедшая за офлайн фигура оказывается там же, где и при непрерывной игре', async () => {
    const info = await makeWorld(11).world.info();
    const target = far(11, info.home);

    // Непрерывная игра: пульс каждые полминуты всю дорогу.
    const live = makeWorld(11);
    await live.world.sync(profile());
    expect(await live.world.moveFigure('scout', { x: target.x + 3, y: target.y })).toBeNull();
    const trip = (await live.world.figures()).find((f) => f.id === 'scout') as FigureView;
    const end = trip.arriveAt + 5_000;
    for (let t = START; t < end; t += 30_000) {
      live.at(Math.min(t, end));
      await live.world.sync(profile());
    }
    live.at(end);
    const a = (await live.world.sync(profile())).figures.find((f) => f.id === 'scout') as FigureView;

    // Офлайн: один пульс в самом конце.
    const away = makeWorld(11);
    await away.world.sync(profile());
    expect(await away.world.moveFigure('scout', { x: target.x + 3, y: target.y })).toBeNull();
    away.at(end);
    const b = (await away.world.sync(profile())).figures.find((f) => f.id === 'scout') as FigureView;

    expect(b.at).toEqual(a.at);
    expect(b.phase).toBe(a.phase);
    expect(b.atId).toBe(a.atId);
    // И след в тумане тот же: коридор по дороге открыт в обоих случаях.
    const mid = { x: Math.round((info.home.x + target.x) / 2), y: Math.round((info.home.y + target.y) / 2) };
    const cell = async (world: LocalWorld) => {
      const c = await world.region({ x: mid.x, y: mid.y, w: 1, h: 1 });
      return c.explored[0];
    };
    expect(await cell(away.world)).toBe(1);
    expect(await cell(away.world)).toBe(await cell(live.world));
  });

  it('погибшая фигура не теряется насовсем, а возвращается через положенное время', async () => {
    const w = makeWorld(11);
    const p = profile({ warriorPower: 1, units: { warrior: 1 }, army: { clubman: 1 } });
    const castle = generateWorld(11).settlements.filter((s) => s.castle)[0];
    // Один дубинщик против замка — полководца там и оставят.
    const { pulse } = await raidWith(w, castle, p);
    const down = pulse.figures.find((f) => f.id === 'general') as FigureView;
    expect(down.phase).toBe('down');
    expect(down.downUntil).toBeGreaterThan(w.now());

    w.at(down.downUntil + 1000);
    const back = (await w.world.sync(p)).figures.find((f) => f.id === 'general') as FigureView;
    expect(back.phase).toBe('home');
    expect(back.atHome).toBe(true);
    expect(back.downUntil).toBe(0);
  });

  it('полководец берёт и возвращает гарнизон только вплотную к своей деревне', async () => {
    const w = makeWorld(11);
    const p = profile({ warriorPower: 4, army: { clubman: 6, archer: 4 } });
    await w.world.sync(p);

    // Дома — можно.
    expect(await w.world.setGarrison({ clubman: 6, archer: 4 })).toBeNull();
    let general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    expect(general.troops).toEqual({ clubman: 6, archer: 4 });
    expect(general.power).toBeGreaterThan(0);

    // Больше, чем стоит дома, взять нельзя.
    expect(await w.world.setGarrison({ clubman: 99 })).toBeTruthy();

    // В поле — нельзя ни забрать, ни вернуть.
    const target = await nearest(w.world);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(general.arriveAt);
    await w.world.sync(p);
    expect(await w.world.setGarrison({})).toBeTruthy();

    // Вернулся домой — снова можно, и войско уходит обратно в деревню.
    expect(await w.world.recallFigure('general')).toBeNull();
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    w.at(general.arriveAt);
    await w.world.sync(p);
    expect(await w.world.setGarrison(null)).toBeNull();
    general = (await w.world.figures()).find((f) => f.id === 'general') as FigureView;
    expect(troopTotal(general.troops)).toBe(0);
  });

  it('пока армия при полководце в поле, дома её нет', async () => {
    const w = makeWorld(11);
    const s = createInitialState();
    s.army = { ...s.army, clubman: 10, spearman: 6 };
    const before = defense(s);

    await w.world.sync(playerProfile(s));
    expect(await w.world.setGarrison({ clubman: 10, spearman: 6 })).toBeNull();
    const target = await nearest(w.world);
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    const pulse = await w.world.sync(playerProfile(s));

    // Число ушедших выводится из фигур и походов, как и раньше — из походов.
    syncAway(s, pulse.marches, pulse.figures);
    expect(s.warriorsAway).toBe(16);
    expect(defense(s)).toBeLessThan(before);
    // Дома остаётся ополчение: частокол, башня и сами жители.
    expect(defense(s)).toBeGreaterThan(0);
    expect(troopTotal(homeTroops(s, awayTroops(pulse.marches, pulse.figures)))).toBe(0);
  });

  it('дипломат подписывает договор, и племя перестаёт ходить в набеги', async () => {
    const w = makeWorld(11);
    const p = profile();
    await w.world.sync(p);
    const target = (await nearest(w.world));
    const card = await w.world.settlement(target.id);
    if (!card?.tribeId) return; // ближайшие оказались варварами — договариваться не с кем

    expect(await w.world.negotiate('truce'), 'до цели ещё надо дойти').toBeTruthy();
    expect(await w.world.moveFigure('diplomat', { x: target.x, y: target.y })).toBeNull();
    const walk = (await w.world.figures()).find((f) => f.id === 'diplomat') as FigureView;
    w.at(walk.arriveAt);
    await w.world.sync(p);

    expect(await w.world.negotiate('truce')).toBeNull();
    const deals = await w.world.deals();
    expect(deals.some((d) => d.id === 'truce' && d.tribeId === card.tribeId)).toBe(true);
    const again = await w.world.settlement(target.id);
    expect(again?.deals.some((d) => d.id === 'truce')).toBe(true);
  });
});
