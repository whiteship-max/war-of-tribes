// Навыки агентов в настоящем мире.
//
// Области правил, и каждая проверяется утверждением в самом тесте (правило 11):
// - натиск — бой, в котором ведёт полководец: удар по двору, наш лагерь, удар по
//   лагерю из поля. Вне области — оборона деревни и вылазка: их ведёт гарнизон, и
//   там утверждается обратное — натиска нет. Каждая точка утверждает, что бой
//   **состоялся** (ядро позвали), иначе «натиска нет» получалось бы даром;
// - потолок — роды, у которых стартовая мораль с натиском упирается в сотню;
// - скрытность — только провалы: у удачи она не спрашивается;
// - зоркость — только земля, которую разведчик открывает по пути;
// - первый уровень — все прибавки нулевые, и мир ведёт себя по-старому.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleInput, Stack } from '@/battle';

const H = vi.hoisted(() => ({ inputs: [] as BattleInput[] }));
vi.mock('@/battle', async (orig) => {
  const real = await orig<typeof import('@/battle')>();
  return {
    ...real,
    simulateBattle: (input: BattleInput) => {
      H.inputs.push(input);
      return real.simulateBattle(input);
    },
  };
});

import { DEFAULT_ORDERS, MORALE, PLAN_IDS, UNIT_KINDS, emptySectors, emptyStack, startMorale } from '@/battle';
import { createInitialState } from '@/game/state';
import { kindsOf, type TroopStack } from '@/game/battle/kinds';
import { onslaughtAt, onslaughtOf } from '@/game/sim/agents';
import { LEVEL_XP } from '@/game/data/agents';
import { seeded } from '@/game/sim/random';
import { onslaughtLines } from '@/ui/parts/agentLines';
import { HOME_ID, LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import { playerProfile } from './bridge';
import { FIGURE_BY_ID, FIGURE_IDS } from './data/figures';
import { SPY_BUSY, SPY_CAUGHT_ATTITUDE, SPY_HELD, SPY_SLIP_ATTITUDE } from './data/tuning';
import { generalResolve, onslaughtRows, ownGearOf, revealSight, slipShare, slipped } from './agents';
import { spyOutcome } from './spy';
import { distance } from './geo';
import { PLAYER_CAMP } from './siege';
import type { GenSettlement } from './gen';
import type { PlayerProfile } from './types';

const START = 1_700_000_000_000;
const MIN = 60_000;

type Inner = {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  fog: { count(): number };
  alive(s: GenSettlement, now: number): boolean;
  resolveIncoming(m: StoredMarch, at: number): void;
  openSiegeAt(id: string, byId: string, campId: string, at: number): unknown;
  campBattle(id: string, at: number, seed: number, attack: object): unknown;
  resolveStrike(id: string, at: number, withGarrison: boolean): { error: string | null };
  spyOrder(action: 'probe', s: GenSettlement, now: number, chance: number): { accepted: boolean };
};

function makeWorld(seed = 11) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    inner: world as unknown as Inner,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Слепок настоящего племени: полководец нужного уровня, обряд и конюшня — числом. */
function tribeProfile(level: number, over: Partial<PlayerProfile> = {}): PlayerProfile {
  const s = createInitialState();
  s.agents.general.xp = LEVEL_XP[level - 1];
  expect(onslaughtOf(s)).toBe(onslaughtAt(level));
  return { ...playerProfile(s), army: { spearman: 60, archer: 20, rider: 20 }, ...over };
}

const RETINUE: TroopStack = { spearman: 30, archer: 10, rider: 10 };

/** Ставит полководца с дружиной в поле на клетке. */
function stand(w: ReturnType<typeof makeWorld>, at: { x: number; y: number }, troops: TroopStack = RETINUE): void {
  const g = w.inner.save.figures.general;
  g.phase = 'field';
  g.from = { ...at };
  g.to = { ...at };
  g.departAt = w.now();
  g.arriveAt = w.now();
  g.troops = { ...troops };
  g.handover = undefined;
}

function nearestLair(w: ReturnType<typeof makeWorld>): GenSettlement {
  const home = w.inner.save.home;
  return w.inner.gen.settlements
    .filter((s) => w.inner.alive(s, w.now()))
    .sort((a, b) => distance(home, a) - distance(home, b))[0];
}

/** Последний бой, в который мир позвал ядро после `mark`. */
function battleSince(mark: number): BattleInput {
  expect(H.inputs.length, 'бой состоялся: ядро позвали').toBeGreaterThan(mark);
  return H.inputs[H.inputs.length - 1];
}

beforeEach(() => {
  H.inputs.length = 0;
});

describe('натиск ложится ровно в бои полководца', () => {
  const FERVOUR = 4;
  const LEVEL = 4;

  it('удар по логову: стойкость — обряд плюс натиск, снаряжение — то же, что у замера карточки', async () => {
    const w = makeWorld();
    const p = tribeProfile(LEVEL, { fervour: FERVOUR, mountGear: 1 });
    await w.world.sync(p);
    const lair = nearestLair(w);
    stand(w, lair);
    const mark = H.inputs.length;
    const res = await w.world.attack({ setup: null });
    expect(res.error).toBeNull();
    const input = battleSince(mark);
    expect(input.attacker.resolve).toBe(generalResolve(FERVOUR, onslaughtAt(LEVEL)));
    expect(input.attacker.resolve).toBe(FERVOUR + 9);
    expect(input.attacker.gear).toEqual(ownGearOf(RETINUE, 1));
  });

  it('наш лагерь, по которому бьют, держит дружина полководца — натиск есть', async () => {
    const w = makeWorld();
    const p = tribeProfile(LEVEL, { fervour: FERVOUR });
    await w.world.sync(p);
    const lair = nearestLair(w);
    stand(w, lair);
    w.inner.openSiegeAt(lair.id, HOME_ID, PLAYER_CAMP, w.now());
    const mark = H.inputs.length;
    const kinds: Stack = { ...emptyStack(), infantry: 40 };
    w.inner.campBattle(lair.id, w.now(), 5, { front: { kinds, gear: {} }, setup: null });
    expect(battleSince(mark).defender.resolve).toBe(FERVOUR + onslaughtAt(LEVEL));
  });

  /** Чужой лагерь под нашими стенами: отряд из логова, окно осады. */
  function campAtHome(w: ReturnType<typeof makeWorld>): void {
    const lair = nearestLair(w);
    const m: StoredMarch = {
      id: 'camp-test',
      seed: 3,
      mission: 'raid',
      units: { warrior: 30 },
      own: false,
      fromId: lair.id,
      targetId: HOME_ID,
      from: { x: lair.x, y: lair.y },
      to: { ...w.inner.save.home },
      fromName: lair.name,
      toName: 'дом',
      departAt: w.now() - MIN,
      arriveAt: w.now(),
      phase: 'stay',
      power: 60,
      loot: null,
    };
    w.inner.save.marches.push(m);
    w.inner.openSiegeAt(HOME_ID, lair.id, m.id, w.now());
  }

  it('удар полководца по лагерю из поля — натиск есть', async () => {
    const w = makeWorld();
    const p = tribeProfile(LEVEL, { fervour: FERVOUR });
    await w.world.sync(p);
    campAtHome(w);
    const home = w.inner.save.home;
    stand(w, { x: home.x + 6, y: home.y });
    const mark = H.inputs.length;
    expect(w.inner.resolveStrike(HOME_ID, w.now(), false).error).toBeNull();
    expect(battleSince(mark).attacker.resolve).toBe(FERVOUR + onslaughtAt(LEVEL));
  });

  it('вылазка гарнизона против того же лагеря — натиска нет, даже если полководец дома', async () => {
    const w = makeWorld();
    // Хлеба вдоволь: без него окно осады кончилось бы в ту же минуту, и выходить было бы не на кого.
    const p = tribeProfile(LEVEL, { fervour: FERVOUR, food: 100_000, foodPerHour: 10, soldierFoodPerHour: 1 });
    await w.world.sync(p);
    campAtHome(w);
    const mark = H.inputs.length;
    const res = await w.world.sortie({ spearman: 20 });
    expect(res.error).toBeNull();
    expect(battleSince(mark).attacker.resolve).toBe(FERVOUR);
  });

  it('оборона деревни — натиска нет, даже когда полководец пятого уровня', async () => {
    const w = makeWorld();
    const p = tribeProfile(5, { fervour: FERVOUR });
    await w.world.sync(p);
    const lair = nearestLair(w);
    const m: StoredMarch = {
      id: 'raid-test',
      seed: 9,
      mission: 'raid',
      units: { warrior: 200 },
      own: false,
      fromId: lair.id,
      targetId: HOME_ID,
      from: { x: lair.x, y: lair.y },
      to: { ...w.inner.save.home },
      fromName: lair.name,
      toName: 'дом',
      departAt: w.now() - MIN,
      arriveAt: w.now(),
      phase: 'out',
      power: 5000,
      loot: null,
    };
    w.inner.save.marches.push(m);
    const mark = H.inputs.length;
    w.inner.resolveIncoming(m, w.now());
    expect(w.inner.save.sieges[HOME_ID], 'не осада, а бой у стены').toBeUndefined();
    expect(battleSince(mark).defender.resolve).toBe(FERVOUR);
  });
});

describe('карточка и бой считают одно и то же', () => {
  it('прибавка по родам — минимум по планам той функцией ядра, с той стойкостью и тем снаряжением, что ушли в бой', async () => {
    const w = makeWorld();
    const level = 3;
    // Обряд подобран так, чтобы потолок морали кусал конницу: иначе карточка сошлась бы
    // с боем и при чужом снаряжении, и сравнение ничего бы не доказывало.
    const rite = 10;
    const p = tribeProfile(level, { fervour: rite, mountGear: 1 });
    await w.world.sync(p);
    stand(w, nearestLair(w));
    const mark = H.inputs.length;
    await w.world.attack({ setup: null });
    const input = battleSince(mark);
    const card = onslaughtRows(RETINUE, 1, rite, onslaughtAt(1), onslaughtAt(level));
    const kinds = kindsOf(RETINUE);
    const full = onslaughtAt(level) - onslaughtAt(1);
    expect(card.map((r) => r.kind)).toEqual(UNIT_KINDS.filter((k) => kinds[k] > 0));
    let bitten = 0;
    let given = 0;
    for (const row of card) {
      const pure: Stack = { ...emptyStack(), [row.kind]: kinds[row.kind] };
      // Прибавка по планам — самим ядром, со снаряжением и стойкостью из настоящего боя.
      const gains = PLAN_IDS.map(
        (plan) =>
          startMorale({ ...input.attacker, plan }, pure) -
          startMorale({ ...input.attacker, plan, resolve: generalResolve(rite, onslaughtAt(1)) }, pure),
      );
      const worst = Math.min(...gains);
      if (worst < full) bitten++;
      if (worst > 0) given++;
      expect(row.got, `${row.kind}: карточка против боя`).toBeCloseTo(worst, 1);
      // И в том плане, которым бой действительно пошёл, прибавка не меньше обещанной.
      const real =
        startMorale(input.attacker, pure) - startMorale({ ...input.attacker, resolve: generalResolve(rite, onslaughtAt(1)) }, pure);
      expect(real, `${row.kind}: план боя`).toBeGreaterThanOrEqual(row.got - 0.05);
    }
    // Точки внутри области, по бою, а не по карточке: потолок кусает хоть один род, и хоть
    // одному натиск прибавляет. Обряд подобран так, чтобы кусала конница.
    expect(bitten, 'точка внутри области: потолок кусает хоть один род').toBeGreaterThan(0);
    expect(given, 'и хоть одному роду натиск прибавляет').toBeGreaterThan(0);
  });

  it('когда потолок съедает натиск, карточка так и говорит: кружок ничего не прибавит', () => {
    // Всадники при конюшне на третьей ступени и строгом обряде: мораль рода с
    // планом «оборона» уже сотня. Точка внутри области — проверяется числом.
    const riders: TroopStack = { rider: 20 };
    const rite = 12;
    // Область — по ядру, а не по карточке: при плане «оборона» мораль всадников с
    // натиском второго уровня уже сотня, то есть третьему кружку расти некуда.
    const pure: Stack = { ...emptyStack(), cavalry: kindsOf(riders).cavalry };
    const setup = { sectors: emptySectors(), plan: 'defense' as const, orders: DEFAULT_ORDERS, reserve: { kind: 'morale' as const }, gear: ownGearOf(riders, 1) };
    expect(startMorale({ ...setup, resolve: generalResolve(rite, onslaughtAt(2)) }, pure), 'точка внутри области: мораль уже у потолка').toBe(MORALE.max);
    const rows = onslaughtRows(riders, 1, rite, onslaughtAt(2), onslaughtAt(3));
    expect(rows).toHaveLength(1);
    expect(rows[0].full, 'натиск что-то обещает').toBeGreaterThan(0);
    expect(rows[0].got, 'карточка: потолок съел всё').toBe(0);
    const lines = onslaughtLines(2, riders, 1, rite);
    expect(lines.next).toBe('Следующий кружок этой дружине ничего не прибавит: потолок морали.');
    expect(lines.troops).toMatch(/не прибавляет ничего/);
    // Смешанная дружина: копьям прибавит, коннице — нет, и названо поимённо.
    const mixed = onslaughtLines(2, { spearman: 20, rider: 20 }, 1, rite);
    expect(mixed.next).toMatch(/^Следующий кружок: копья \+3, конница ничего — дальше потолок морали\.$/);
    // Без обряда тем же всадникам прибавка целиком: потолок здесь не выдуман.
    expect(onslaughtRows(riders, 1, 0, onslaughtAt(2), onslaughtAt(3))[0].got).toBe(3);
  });
});

describe('скрытность решает, заметили ли провал, и не трогает шанса', () => {
  it('на трёх тысячах бросков: удачи те же при любой скрытности, тихих провалов — её доля', () => {
    for (const chance of [0.2, 0.5, 0.8]) {
      let fails = 0;
      const quiet = [0, 0.3, 0.6].map(() => 0);
      for (let seed = 1; seed <= 3000; seed++) {
        const out = spyOutcome(chance, seed, 'probe');
        if (out.success) {
          expect(out.miss).toBe(0);
          continue;
        }
        fails++;
        [0, 0.3, 0.6].forEach((st, i) => {
          if (slipped(out.miss, st)) quiet[i]++;
        });
      }
      expect(fails, 'провалы есть — область не пуста').toBeGreaterThan(300);
      expect(quiet[0]).toBe(0);
      expect(quiet[1] / fails).toBeCloseTo(0.3, 1);
      expect(quiet[2] / fails).toBeCloseTo(0.6, 1);
    }
    expect(slipShare(0.6)).toBeCloseTo(0.6, 3);
  });

  it('в мире тихий провал не держит лазутчика и не роняет мораль, замеченный — как прежде', async () => {
    const out: Record<string, { held: boolean; busy: number; attitude: number; morale: number }> = {};
    for (const stealth of [0, 1]) {
      const w = makeWorld();
      const p = tribeProfile(1, stealth > 0 ? { stealth } : {});
      await w.world.sync(p);
      const lair = nearestLair(w);
      // Шанс в пять процентов: провал почти наверняка — и это утверждается.
      const res = w.inner.spyOrder('probe', lair, w.now(), 0.05);
      expect(res.accepted, 'точка внутри области: дело провалилось').toBe(false);
      const f = w.inner.save.figures.spy;
      const pulse = await w.world.sync(p);
      const eff = pulse.effects.find((e) => e.id.startsWith(`spy-${lair.id}`))!;
      out[stealth] = {
        held: Boolean(f.held),
        busy: (f.busyUntil ?? 0) - w.now(),
        attitude: w.inner.save.diplomacy[lair.id]?.attitude ?? 0,
        morale: eff.morale,
      };
      expect(eff.deed).toEqual({ agent: 'spy', ok: false, at: w.now() });
    }
    expect(out[0]).toMatchObject({ held: true, busy: SPY_HELD, morale: -2 });
    expect(out[1]).toMatchObject({ held: false, busy: SPY_BUSY, morale: 0 });
    expect(out[0].attitude - out[1].attitude).toBe(SPY_CAUGHT_ATTITUDE - SPY_SLIP_ATTITUDE);
  });
});

describe('зоркость — только земля разведчика', () => {
  it('разведчик открывает шире ровно на прибавку, остальные и живой обзор — как были', async () => {
    const counts: number[] = [];
    for (const sightBonus of [0, 4]) {
      const w = makeWorld();
      const p = tribeProfile(1, sightBonus > 0 ? { sightBonus } : {});
      const pulse = await w.world.sync(p);
      for (const f of pulse.figures) {
        expect(f.sight, f.id).toBe(FIGURE_BY_ID[f.id].sight + (f.id === 'scout' ? sightBonus : 0));
        expect(f.watchSight, f.id).toBe(0);
      }
      const before = w.inner.fog.count();
      const home = w.inner.save.home;
      expect(await w.world.moveFigure('scout', { x: home.x + 40, y: home.y })).toBeNull();
      w.advance(30 * MIN);
      await w.world.sync(p);
      counts.push(w.inner.fog.count() - before);
    }
    expect(counts[0], 'путь открыл землю — область не пуста').toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(counts[0] * 1.3);
    for (const id of FIGURE_IDS) expect(revealSight(id, 0)).toBe(FIGURE_BY_ID[id].sight);
  });
});

describe('дела агентов едут из мира событием', () => {
  it('разведчик у логова — дело без строки летописи; попался — дело-неудача и гибель', async () => {
    const w = makeWorld();
    const p = tribeProfile(1);
    await w.world.sync(p);
    const lair = nearestLair(w);
    expect(await w.world.moveFigure('scout', { x: lair.x, y: lair.y })).toBeNull();
    let deed = null;
    for (let i = 0; i < 60 && !deed; i++) {
      w.advance(MIN);
      const pulse = await w.world.sync(p);
      deed = pulse.effects.find((e) => e.deed?.agent === 'scout') ?? null;
    }
    expect(deed, 'разведчик дошёл').not.toBeNull();
    expect(deed!.deed!.ok, 'молодое логово у порога часовых не держит').toBe(true);
    expect(deed!.text, 'строки в летописи нет').toBe('');
    expect(deed!.fell).toBeUndefined();
  });

  it('первый уровень: мир без прибавок ведёт себя, как без поля навыка вовсе', async () => {
    const rnd = seeded(5);
    const a = makeWorld(23);
    const b = makeWorld(23);
    const base = tribeProfile(1);
    const zero = { ...base, onslaught: 0, sightBonus: 0, stealth: 0 };
    for (let i = 0; i < 20; i++) {
      const step = Math.floor(rnd() * 5 * MIN);
      a.advance(step);
      b.advance(step);
      const pa = await a.world.sync(base);
      const pb = await b.world.sync(zero);
      expect(JSON.stringify({ ...pb, now: 0 })).toBe(JSON.stringify({ ...pa, now: 0 }));
    }
  });
});
