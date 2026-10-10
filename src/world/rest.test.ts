import '@/game/pace.minute';
// Мораль армии между боями (docs/battle_eu4.md, 14.30–14.31; слово владельца, как в EU4): после боя мораль армии просела,
// со временем восстанавливается, и армия, брошенная в новый бой сразу, слабее. Срок от нуля до полной — срок лазарета.
//
// Первая половина — чистая дверь `world/rest`; вторая — настоящий мир с ручными часами: вход ядра перехватывается без
// подмены (`vi.mock('@/battle')`), и видно, с какой долей морали сторона вышла в каждый бой.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BattleInput } from '@/battle';
import { WOUND_DAYS } from '@/game/constants';
import { worldDays } from '@/game/pace';
import { LocalWorld } from './local/LocalWorld';
import { parseWorldSave, type WorldSave } from './local/state';
import { shieldVillagers } from './lairs';
import { REST_FULL, carryRest, mixRest, rejoin, restAfter, restAt, restFullAt, type RestPair } from './rest';
import type { GateCall, PlayerProfile } from './types';

// Энергия агентов здесь не предмет проверки (docs/agent_energy.md): сценарии этого файла водят агентов по карте помногу
// — дорога здесь энергию не берёт. Цены дел и отдых дома остаются; энергию держат `energy.test.ts` и
// `energyworld.test.ts`.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const seen = vi.hoisted(() => [] as BattleInput[]);
vi.mock('@/battle', async (orig) => {
  const real = await orig<typeof import('@/battle')>();
  return {
    ...real,
    simulateBattle: vi.fn((input: BattleInput) => {
      seen.push(input);
      return real.simulateBattle(input);
    }),
  };
});

const START = 1_700_000_000_000;
const pair = (share: number, at = START, men = 100): RestPair => ({ share, at, men });

describe('мораль между боями — одна дверь', () => {
  it('срок от нуля до полной — срок лазарета, читается из того места, где он определён', () => {
    expect(REST_FULL).toBe(worldDays(WOUND_DAYS));
    // Граница области: шкала теста не единичная для срока — срок не ноль.
    expect(REST_FULL).toBeGreaterThan(0);
  });

  it('мораль на чтении — прямая до полной ровно за срок, в любой минуте та же формула', () => {
    const p = pair(0.2);
    for (const k of [0, 0.1, 0.4, 0.79]) expect(restAt(p, START + k * REST_FULL), `${k} срока`).toBeCloseTo(0.2 + k, 9);
    // Точки по обе стороны минуты полной морали: до неё — меньше полной, после — полная.
    const full = restFullAt(p, START);
    expect(full).toBe(START + 0.8 * REST_FULL);
    expect(full - 1, 'точка до срока').toBeLessThan(full);
    expect(restAt(p, full - 1), 'за миг до срока ещё не полная').toBeLessThan(1);
    expect(restAt(p, full), 'в срок — полная').toBe(1);
    expect(restAt(p, full + REST_FULL), 'и дальше полная').toBe(1);
    expect(restAt(undefined, START), 'нет пары — свежая').toBe(1);
  });

  it('пришедшие после боя свежие, ушедшие долю не меняют', () => {
    const p = pair(0.4, START, 100);
    expect(restAt(p, START, 50), 'ушла половина — доля та же').toBeCloseTo(0.4, 9);
    expect(restAt(p, START, 200), 'пришло столько же свежих — вдвое ближе к полной').toBeCloseTo(0.7, 9);
  });

  it('перекладка не переписывает прошлое: без пришедших она читается той же прямой', () => {
    const p = pair(0.3, START, 100);
    const now = START + 0.25 * REST_FULL;
    const moved = carryRest({ pair: p, men: 100, of: 100 }, { pair: undefined, men: 0, of: 0 }, now)!;
    for (const k of [0, 0.1, 0.3]) expect(restAt(moved, now + k * REST_FULL)).toBeCloseTo(restAt(p, now + k * REST_FULL), 9);
    // Дралась часть армии: не дравшиеся остались со своей долей, вернувшиеся — с долей боя.
    const back = rejoin(p, START, 100, 40, 30, 0.1)!;
    expect(back.share).toBeCloseTo((60 * 0.3 + 30 * 0.1) / 90, 9);
    expect(back.men).toBe(90);
    expect(restAfter(1, START, 50), 'вышли свежими — пары нет').toBeUndefined();
  });

  it('доля стороны из частей взвешена людьми', () => {
    expect(mixRest([{ rest: 0.2, men: 30 }, { rest: 1, men: 90 }])).toBeCloseTo((30 * 0.2 + 90) / 120, 9);
    expect(mixRest([]), 'никого — свежая').toBe(1);
  });
});

// ------------------------------------------------------------ в мире ---

const HOST = { legionary: 30, spearman: 24, archer: 16 };
const profileOf = (gate?: GateCall[]): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  militia: 40,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, charcoal: 4000, copper: 4000, iron: 4000 },
  stash: 0,
  ...(gate ? { gate } : {}),
});

function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    save: () => (world as unknown as { save: WorldSave }).save,
    advance: (ms: number): void => {
      now += ms;
    },
    now: (): number => now,
  };
}

/** Бой у ворот по вызову — вход ядра этого боя. */
async function gateFight(w: ReturnType<typeof makeWorld>, id: string): Promise<BattleInput> {
  seen.length = 0;
  const call: GateCall = { id, foe: 'raiders', power: 80, seed: 900 + id.length * 31 };
  await w.world.sync(profileOf([call]));
  const input = seen.find((i) => i.seed === call.seed);
  expect(input, `${id}: бой дошёл до ядра`).toBeDefined();
  return input!;
}

describe('мораль между боями в мире', () => {
  it('гарнизон устаёт: бой сразу после боя — с просевшей моралью, после срока — со свежей', async () => {
    const w = makeWorld();
    await w.world.sync(profileOf());
    const first = await gateFight(w, 'gate-a');
    expect(first.defender.rest, 'первый бой — свежими').toBeUndefined();
    const pair = w.save().homeRest;
    expect(pair, 'гарнизон вышел из боя с парой').toBeDefined();
    expect(pair!.share).toBeLessThan(1);

    const second = await gateFight(w, 'gate-bb');
    expect(second.defender.rest, 'сразу после боя — уставшими').toBeLessThan(1);

    // Граница области: срок отдыха — от последнего боя; за миг до него ещё не полная, после — свежая.
    const last = w.save().homeRest!;
    w.advance(restFullAt(last, w.now()) - w.now() + 1);
    const third = await gateFight(w, 'gate-ccc');
    expect(third.defender.rest, 'после срока — свежими').toBeUndefined();
  }, 60_000);

  it('сторона у ворот — гарнизон своей парой, ополчение свежее: доля взвешена людьми', async () => {
    const w = makeWorld();
    await w.world.sync(profileOf());
    await gateFight(w, 'gate-a');
    const garrison = w.save().homeRest!;
    const input = await gateFight(w, 'gate-bb');
    const r = restAt(garrison, w.now());
    // Граница области: гарнизон правда устал, а ополчение в бою есть — есть что взвешивать.
    expect(r).toBeLessThan(1);
    const militia = 40;
    const troops = Object.values(input.defender.sectors).reduce((n, s) => n + Object.values(s).reduce((a, b) => a + (b ?? 0), 0), 0) - militia;
    expect(troops, 'в бою есть и войско, и ополчение').toBeGreaterThan(0);
    expect(input.defender.rest!).toBeCloseTo((troops * r + militia) / (troops + militia), 2);
    expect(input.defender.rest!, 'свежее ополчение поднимает долю').toBeGreaterThan(r);
  }, 60_000);

  it('отряд, отбившийся от перехвата, идёт к стене уставшим', async () => {
    const w = makeWorld();
    await w.world.sync(profileOf());
    const save = w.save();
    const arrive = w.now() + 10_000;
    save.marches.push({
      id: 'raid-rest',
      seed: 4242,
      mission: 'raid',
      units: { warrior: 30 },
      own: false,
      fromId: 'lair-x',
      targetId: 'home',
      from: { x: save.home.x + 3, y: save.home.y },
      to: { ...save.home },
      fromName: 'Логово',
      toName: 'Дом',
      departAt: w.now(),
      arriveAt: arrive,
      phase: 'out',
      power: 60,
      loot: null,
      rest: { share: 0.2, at: w.now(), men: 1000 },
    });
    seen.length = 0;
    w.advance(10_001);
    await w.world.sync(profileOf());
    const wall = seen.find((i) => i.seed === 4242);
    expect(wall, 'бой у стены дошёл до ядра').toBeDefined();
    expect(wall!.attacker.rest!, 'отряд — уставший, отдохнувший за дорогу').toBeCloseTo(0.2 + 10_001 / REST_FULL, 2);
  }, 60_000);

  it('удар по логову — одно правило на обе стороны: дружина и гарнизон логова своими парами', async () => {
    const w = makeWorld(11);
    const p = profileOf();
    await w.world.sync(p);
    expect(await w.world.setGarrison({ ...HOST })).toBeNull();
    for (let i = 0; i < 120; i++) {
      w.advance(60_000);
      await w.world.sync(p);
      if ((await w.world.figures()).find((f) => f.id === 'general')?.readyAt === 0) break;
    }
    const save = w.save();
    const home = save.home;
    const gen = (w.world as unknown as { gen: { settlements: { id: string; x: number; y: number }[] } }).gen;
    const target = [...gen.settlements].sort(
      (a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y),
    )[0];
    expect(target, 'в округе есть логово').toBeDefined();
    expect(await w.world.moveFigure('general', { x: target.x, y: target.y })).toBeNull();
    for (let i = 0; i < 400; i++) {
      w.advance(60_000);
      await w.world.sync(p);
      if ((await w.world.figures()).find((f) => f.id === 'general')?.phase !== 'moving') break;
    }
    // Обе стороны недавно дрались: пары положены на минуту удара.
    save.figures.general.rest = { share: 0.4, at: w.now(), men: 1000 };
    save.lairRest = { [target.id]: { share: 0.3, at: w.now(), men: 1000 } };
    seen.length = 0;
    const res = await w.world.attack({});
    expect(res.error).toBeNull();
    const input = seen[seen.length - 1];
    expect(input.attacker.rest!, 'дружина — уставшей').toBeCloseTo(0.4, 2);
    expect(input.defender.rest!, 'гарнизон логова — уставшим').toBeCloseTo(0.3, 2);
    // После боя: дружина вышла с долей боя — не бодрее, чем вошла; сожжённое логово морали не помнит.
    const band = save.figures.general.rest;
    if (save.figures.general.troops) expect(band?.share ?? 1, 'дружина вышла не бодрее').toBeLessThanOrEqual(0.4 + 0.005);
    if (res.won) expect(save.lairRest?.[target.id], 'сгоревшее логово пары не держит').toBeUndefined();
    else expect(save.lairRest?.[target.id], 'отбившееся логово держит пару боя').toBeDefined();
  }, 120_000);

  it('старое сохранение мира — без пар: все свежие', async () => {
    const w = makeWorld();
    await w.world.sync(profileOf());
    await gateFight(w, 'gate-a');
    const json = JSON.stringify({ ...w.save(), homeRest: undefined, lairRest: undefined });
    const old = parseWorldSave(json)!;
    expect(old.homeRest, 'пары нет').toBeUndefined();
    const again = new LocalWorld({ seed: 7, now: w.now, storage: { read: () => json, write: () => {} } });
    await again.sync(profileOf());
    seen.length = 0;
    const call: GateCall = { id: 'gate-old', foe: 'raiders', power: 80, seed: 777 };
    await again.sync(profileOf([call]));
    const input = seen.find((i) => i.seed === 777);
    expect(input?.defender.rest, 'из старого сохранения — свежими').toBeUndefined();
  }, 60_000);
});

describe('одна дверь', () => {
  it('срок и формулу морали знает только `world/rest`: ни копии срока, ни своей прямой', () => {
    const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = strip(readFileSync(p, 'utf8'));
          const rel = path.relative(process.cwd(), p).split(path.sep).join('/');
          if (rel !== 'src/world/rest.ts' && /\bREST_FULL\b|\.share\s*\+/.test(src)) hits.push(rel);
        }
      }
    };
    walk(path.resolve('src'));
    expect(hits, 'формулу морали между боями считает одна дверь').toEqual([]);
    const rest = strip(readFileSync(path.resolve('src/world/rest.ts'), 'utf8'));
    expect(rest, 'срок — срок лазарета').toMatch(/export const REST_FULL = worldDays\(WOUND_DAYS\);/);
  });
});
