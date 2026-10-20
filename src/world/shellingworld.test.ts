// Обстрел, требушет на стене и кольцо блокады в мире на клиенте (Р-5, docs/siege_v2.md, 21): логово у наших стен и наш
// лагерь под логовом — по тем же дверям, что сервер войны (`world/shelling`, `world/blockade`). Лагерь логова — бот: кольцо
// он замыкает сам, как только мощи вчетверо, и размыкает его та же мерка. Кость фаз тихая (`setPhaseDie`): правило не фазы.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyingWorld } from './local/NotifyingWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { PlayerProfile, WorldPulse } from './types';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { phaseAt, setPhaseDie } from './siegeroll';
import { BREAK_WORDS, blockadeAt } from './blockade';
import { gunReady } from './shelling';
import { GUN_SPAN } from './data/shelling';
import { BLOCKADE_RATIO } from './data/blockade';
import { SIEGE_PHASE } from './data/siegeroll';
import { wallRepairCost } from '@/game/build';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

afterEach(() => setPhaseDie(null));

const START = 1_700_000_000_000;

type Inner = { save: WorldSave; gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean };

function makeWorld(seed = 7) {
  let now = START;
  const world = new NotifyingWorld({ seed, now: () => now, storage: null });
  return { world, inner: world as unknown as Inner, now: () => now, advance: (ms: number) => void (now += ms) };
}
type W = ReturnType<typeof makeWorld>;

/** Деревня, которую логово не возьмёт с ходу и будет держать в осаде, со стеной и запасом на требушет. */
const holdout = (army = 10): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: army },
  stock: { food: 600, wood: 5000, stone: 2000 },
  stash: 0,
  food: 6000 * 12,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  levels: { palisade: 1, farm: 3, smithy: 2 },
});

async function besieged(w: W, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

/** «×12,5» → 12.5; «гарнизона нет» — бесконечность. */
const ratioOf = (text: string): number => (text.includes('нет') ? Infinity : Number(text.replace(/[^\d,.]/g, '').replace(',', '.')));

describe('логово у наших стен: кольцо по правилу бота', () => {
  it('лагерь вчетверо сильнее гарнизона — кольцо замкнуто с постановки; гарнизон вырос — в минуту фазы разомкнуто мощью', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    // Гарнизон — два копейщика: лагерь логова больше вчетверо (утверждается ниже).
    const p = holdout(2);
    const start = (await besieged(w, p)).siege!;
    const ring = start.blockade!;
    expect(ratioOf(ring.ratio), 'точка внутри области: лагерь вчетверо сильнее').toBeGreaterThanOrEqual(BLOCKADE_RATIO);
    expect(ring.on, 'бот замкнул кольцо в минуту постановки').toBe(true);
    expect(ring.since).toBe(start.since);
    expect(ring.can, 'осаждённый кольца не замыкает').toBe(false);
    // Гарнизон вырос в сотни раз: лагерю не держать кольцо — разомкнётся в минуту ближайшей фазы, а не раньше.
    const big = holdout(200_000);
    w.advance(60_000);
    let pulse = await w.world.sync(big);
    expect(pulse.siege?.blockade?.on, 'до фазы кольцо стоит: тика нет').toBe(true);
    w.advance(phaseAt(start.since, 1) - w.now() + 1000);
    pulse = await w.world.sync(big);
    expect(pulse.siege, 'точка внутри области: осада идёт').not.toBeNull();
    expect(pulse.siege?.blockade?.on).toBe(false);
    expect(pulse.siege?.blockade?.broke).toBe(BREAK_WORDS.ratio);
    const journal = pulse.siege?.phases?.journal ?? [];
    expect(journal[journal.length - 1], 'фаза 1 бросалась при кольце: +1').toMatch(/блокада/);
  });

  it('вылазка на пост: при кольце — бой, исход решает кольцо; без кольца — отказ строкой', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const p = holdout(2);
    await besieged(w, p);
    w.advance(60_000);
    const pulse = await w.world.sync(p);
    expect(pulse.siege?.answers?.breakout, 'точка внутри области: кольцо есть — вылазка на пост в ответах').toBeDefined();
    expect(pulse.siege!.answers!.breakout!.guard).toBeGreaterThan(0);
    const res = await w.world.breakout({ spearman: 2 });
    expect(res.error).toBeNull();
    const ringNow = blockadeAt(w.inner.save.sieges.home!, w.now());
    expect(ringNow, 'кольцо — обратное исходу боя').toBe(!res.won);
    if (!ringNow) expect((await w.world.breakout({ spearman: 1 })).error).toBe('Кольца нет — прорывать нечего.');
    expect((await w.world.breakout({ spearman: 10_000 })).error, 'бойцов больше, чем дома').toBe('Столько бойцов дома нет.');
  });
});

describe('требушет на стене у осаждённого: мир на клиенте', () => {
  it('цена — починки пролома, срок — требушета лагеря при всём лесе; встал — два выстрела за фазу по лагерю', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const p = holdout();
    const start = (await besieged(w, p)).siege!;
    const gun = start.answers!.gun!;
    expect(gun.state).toBe('none');
    expect(gun.cost).toEqual(wallRepairCost(1));
    expect(gun.span).toBe(GUN_SPAN);
    expect(gun.can, 'точка внутри области: дерево и камень есть').toBe(true);
    expect(await w.world.defend({ act: 'gun' })).toBeNull();
    let pulse = await w.world.sync(p);
    const pay = pulse.effects.find((e) => e.id.startsWith('siege-gun-'));
    expect(pay?.resources, 'со склада — цена починки').toEqual({ wood: -(wallRepairCost(1).wood ?? 0), stone: -(wallRepairCost(1).stone ?? 0) });
    expect(pulse.siege?.answers?.gun?.state).toBe('building');
    expect(await w.world.defend({ act: 'gun' })).toBe('Требушет на стене уже строят.');
    expect(await w.world.defend({ act: 'gunAim', aim: 'camp' })).toBe('Требушет и так бьёт туда.');
    // Первая фаза после готовности: два выстрела по лагерю.
    const ready = start.since + GUN_SPAN;
    const k = Math.ceil((ready - start.since) / SIEGE_PHASE);
    w.advance(phaseAt(start.since, k) - w.now() + 1000);
    pulse = await w.world.sync(p);
    expect(pulse.siege, 'точка внутри области: осада дожила до фазы').not.toBeNull();
    expect(gunReady(w.inner.save.sieges.home!, phaseAt(start.since, k)), 'точка внутри области: требушет стоит в минуту фазы').toBe(true);
    const rows = w.inner.save.sieges.home!.phases ?? [];
    expect(rows[k - 1].gun).toHaveLength(2);
    expect(rows.slice(0, k - 1).every((r) => !r.gun?.length), 'до готовности не стрелял').toBe(true);
  });
});

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

/** Наш лагерь под ближайшим живым логовом с войском `troops`. */
async function ourCamp(w: W, troops: Record<string, number>) {
  const p: PlayerProfile = { name: 'Тест', pop: shieldVillagers(0.1), defense: 30, units: { warrior: 10, scout: 4 }, army: { ...troops }, stock: { food: 600, wood: 400 }, stash: 0 };
  await w.world.sync(p);
  const home = w.inner.save.home;
  const lair = w.inner.gen.settlements.filter((s) => w.inner.alive(s, w.now())).sort((a, b) => distance(home, a) - distance(home, b))[0];
  standAt(w, lair, troops);
  expect(await w.world.besiege()).toBeNull();
  const win = w.inner.save.sieges[lair.id];
  win.sortied = true;
  win.relieved = true;
  return { p, lair, win };
}

describe('наш лагерь под логовом: кольцо и цель', () => {
  it('кольцо — только вчетверо; замкнутое видно в окне лагеря; разомкнуть приказом — замкнуть снова можно сразу', async () => {
    setPhaseDie(() => 7);
    const small = makeWorld();
    await ourCamp(small, { spearman: 2 });
    expect(await small.world.blockade(true)).toMatch(/вчетверо/);
    const w = makeWorld();
    const { win } = await ourCamp(w, { spearman: 40_000 });
    const view = (await w.world.camp())!;
    expect(ratioOf(view.blockade!.ratio), 'точка внутри области: лагерь вчетверо сильнее').toBeGreaterThanOrEqual(BLOCKADE_RATIO);
    expect(view.blockade!.can).toBe(true);
    expect(await w.world.blockade(true)).toBeNull();
    expect((await w.world.camp())!.blockade!.on).toBe(true);
    expect(await w.world.blockade(true)).toBe('Кольцо и так замкнуто.');
    expect(await w.world.blockade(false)).toBeNull();
    expect(await w.world.blockade(true), 'разомкнуто приказом — не прорвано').toBeNull();
    expect(blockadeAt(win, w.now())).toBe(true);
  });

  it('у логова нет ни построек, ни стены: по городу и по машинам — отказ строкой, окно говорит то же до нажатия', async () => {
    const w = makeWorld();
    await ourCamp(w, { spearman: 40 });
    const aim = (await w.world.camp())!.aim!;
    expect(aim.now).toBe('wall');
    const town = aim.options.find((o) => o.aim === 'town')!;
    expect(town.can).toBe(false);
    expect(await w.world.aimArtillery('town')).toBe(town.reason);
    const engines = aim.options.find((o) => o.aim === 'engines')!;
    expect(await w.world.aimArtillery('engines')).toBe(engines.reason);
    expect(engines.reason).toMatch(/Стены у них нет/);
  });
});
