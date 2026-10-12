// Переговоры у стен в мире на клиенте (docs/siege_v2.md, раздел 7; этап 2е): с логовом — правилом мира той же формулой, что
// у сервера войны (`world/parley`). Свойства: дань логову переходит — ушло со склада ровно то, что легло в обоз лагеря, и
// цена — справедливая из окна; лагерь снят, город неприкосновенен; логово под нашим лагерем выкупается только с половины
// пути и по справедливой цене, и выкуп — опыт осад полководца; условия логово принимает, только если они ему не дороже
// справедливой дани, и тогда падает сдачей с участью из условий. Кость фаз тихая (`setPhaseDie`): правило не фазы.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyingWorld } from './local/NotifyingWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { PlayerProfile, WorldPulse } from './types';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { phaseAt, setPhaseDie } from './siegeroll';
import { siegeShare } from './parley';
import { LAIR_RANSOM_SHARE } from './data/parley';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

afterEach(() => setPhaseDie(null));

const START = 1_700_000_000_000;

type Inner = { save: WorldSave; gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean };

function makeWorld(seed = 7) {
  let now = START;
  const world = new NotifyingWorld({ seed, now: () => now, storage: null });
  return {
    world,
    inner: world as unknown as Inner,
    now: () => now,
    at: (t: number) => {
      now = t;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
type W = ReturnType<typeof makeWorld>;

/** Деревня, которую логово не возьмёт с ходу и будет держать в осаде (как `siegephase.test.ts`). */
const holdout = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 600, wood: 400, stone: 300 },
  gold: 200,
  stash: 50,
  food: 6000 * 12,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
});

async function besieged(w: W, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

function standAt(w: W, s: { x: number; y: number }, troops: Record<string, number>): void {
  Object.assign(w.inner.save.figures.general, {
    phase: 'field',
    from: { x: s.x, y: s.y },
    to: { x: s.x, y: s.y },
    departAt: w.now(),
    arriveAt: w.now(),
    downUntil: 0,
    busyUntil: 0,
    held: false,
    watching: false,
    energy: undefined,
    spent: undefined,
    troops,
    handover: undefined,
  });
}

function nearestLair(w: W): GenSettlement {
  const home = w.inner.save.home;
  return w.inner.gen.settlements.filter((s) => w.inner.alive(s, w.now())).sort((a, b) => distance(home, a) - distance(home, b))[0];
}

async function ourCamp(w: W, fate?: 'plunder' | 'captives') {
  const p: PlayerProfile = {
    name: 'Тест',
    pop: shieldVillagers(0.1),
    defense: 30,
    units: { warrior: 10, scout: 4 },
    army: { spearman: 40 },
    stock: { food: 600, wood: 400 },
    stash: 0,
  };
  await w.world.sync(p);
  const lair = nearestLair(w);
  standAt(w, lair, { spearman: 40 });
  expect(await w.world.besiege(fate)).toBeNull();
  const win = w.inner.save.sieges[lair.id];
  win.sortied = true;
  win.relieved = true;
  return { p, lair, win };
}

describe('дань лагерю логова у наших стен', () => {
  it('переходит: со склада ушло ровно то, что легло в обоз лагеря, по справедливой цене окна; лагерь снят, город под защитой', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const p = holdout();
    const start = (await besieged(w, p)).siege!;
    const view = start.parley!;
    expect(view.side).toBe('def');
    expect(view.bot).toBe(true);
    expect(view.block, 'точка внутри области: дать есть чем').toBeNull();
    expect(view.fair!, 'точка внутри области: дань не пустая').toBeGreaterThan(0);
    const campId = w.inner.save.sieges.home!.campId;
    expect(await w.world.parley({ act: 'offer', kind: 'tribute' })).toBeNull();
    expect(w.inner.save.sieges.home, 'лагерь снят').toBeUndefined();
    expect(w.inner.save.siegeImmune.home ?? 0, 'город под защитой').toBeGreaterThan(w.now());
    const camp = w.inner.save.marches.find((m) => m.id === campId)!;
    const loot = camp.loot ?? {};
    const paid = Object.values(loot).reduce((n, v) => n + (v ?? 0), 0);
    expect(paid).toBe(view.fair);
    const pulse = await w.world.sync(p);
    const eff = pulse.effects.find((e) => e.id === `${campId}-tribute`)!;
    // Ушло со склада ровно то, что увёз лагерь: переход, а не начисление.
    for (const [k, v] of Object.entries(loot)) expect(eff.resources[k as keyof typeof eff.resources]).toBe(-(v ?? 0));
    expect(Object.keys(eff.resources).length).toBe(Object.keys(loot).length);
  }, 120_000);

  it('лагерь логова условий не предлагает: ответить нечего', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    await besieged(w, holdout());
    expect(await w.world.parley({ act: 'answer', kind: 'terms', yes: true })).toBe('Лагерь логова условий не предлагает.');
    expect(w.inner.save.sieges.home).toBeTruthy();
  }, 120_000);
});

describe('наш лагерь под логовом', () => {
  it('выкуп — только с половины пути, по справедливой цене; взятый выкуп — опыт осад, лагерь снят', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld(11);
    const { p, lair, win } = await ourCamp(w);
    const early = (await w.world.camp())!.parley!;
    expect(early.incoming, 'в начале осады выкупа нет').toBeUndefined();
    expect(await w.world.parley({ act: 'answer', kind: 'tribute', yes: true })).toBe('Выкупа не предлагают: осада не прошла и половины пути.');
    const since = win.sinceAt ?? win.startedAt;
    // Первая фаза, где доля пути — не меньше половины: точка внутри области выкупа.
    let k = 1;
    while (siegeShare(w.inner.save.sieges[lair.id] ?? win, phaseAt(since, k) + 1000) < LAIR_RANSOM_SHARE) k += 1;
    w.at(phaseAt(since, k) + 1000);
    await w.world.sync(p);
    expect(w.inner.save.sieges[lair.id], 'точка внутри области: лагерь ещё стоит').toBeTruthy();
    const view = (await w.world.camp())!.parley!;
    expect(view.incoming?.kind).toBe('tribute');
    const price = view.incoming!.price!;
    expect(await w.world.parley({ act: 'answer', kind: 'tribute', yes: true })).toBeNull();
    expect(w.inner.save.sieges[lair.id], 'лагерь снят').toBeUndefined();
    const pulse = await w.world.sync(p);
    const eff = pulse.effects.find((e) => e.id.startsWith(`ransom-${lair.id}`))!;
    expect(eff.siege, 'осада доведена — опыт осад').toBe(true);
    expect(Object.values(eff.resources).reduce((n, v) => n + (v ?? 0), 0)).toBeLessThanOrEqual(price);
  }, 120_000);

  it('условия: логово сдаётся, только если они ему не дороже справедливой дани; отказ занимает фазу', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld(11);
    const { lair } = await ourCamp(w, 'captives');
    const view = (await w.world.camp())!.parley!;
    expect(view.terms).toEqual(['plunder']);
    // Решает та же формула, что у сервера: добыча условий против справедливой дани на эту минуту (её считают методы мира,
    // которыми окно показывает цену).
    type Judge = { campBounty(s: GenSettlement, at: number, f: string): number; campFair(s: GenSettlement, win: unknown, at: number): number };
    const judge = w.world as unknown as Judge;
    const bounty = judge.campBounty(lair, w.now(), 'plunder');
    const fair = judge.campFair(lair, w.inner.save.sieges[lair.id], w.now());
    expect(fair, 'точка внутри области: у логова есть что дать').toBeGreaterThan(0);
    const said = await w.world.parley({ act: 'offer', kind: 'terms', fate: 'plunder' });
    if (bounty <= fair) {
      expect(said).toBeNull();
      expect(w.inner.save.sieges[lair.id], 'сдались — лагерь снят').toBeUndefined();
      expect(w.inner.save.falls[lair.id]?.fate, 'участь — из условий').toBe('plunder');
    } else {
      expect(said).toMatch(/не сдаётся/);
      expect(w.inner.save.sieges[lair.id]?.offers?.[0].answer).toBe('no');
      expect(await w.world.parley({ act: 'offer', kind: 'terms', fate: 'plunder' })).toBe('В эту фазу уже предлагали. Следующее — в новой фазе.');
    }
    expect(await w.world.parley({ act: 'offer', kind: 'tribute' }), 'дань предлагает осаждённый').toMatch(/Под стенами никого|Дань предлагает/);
  }, 120_000);
});
