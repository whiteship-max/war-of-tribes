// Ход осады фазами в мире на клиенте (docs/siege_v2.md, разделы 2, 3, 8; этап 2б): фаза — событие очереди осады, офлайн
// так же; сдача — падение той же дверью, что голод, на ступень мягче и с живым гарнизоном; наказы нашего лагеря — те же
// приказы в минуту фазы; весть — черновик той же двери, что бросит фазу. Кость подменяется (`setPhaseDie`), чтобы точка
// стояла внутри области правила, а не ждала своего сида.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyingWorld } from './local/NotifyingWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { PlayerProfile, WorldPulse } from './types';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { phaseAt, setPhaseDie, softerFate } from './siegeroll';
import { SIEGE_PHASE } from './data/siegeroll';
import { ENERGY_PRICE } from './data/energy';
import { FATE_DEFAULT } from './spoils';

// Энергия дороги здесь не предмет проверки (как в `siege.test.ts`): отряды ходят помногу.
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

/** Деревня, которую штурмовать бессмысленно (как `siege.test.ts`): хлеба — почти на шесть фаз. */
const holdout = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  food: 6000 * 12,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
});

async function besiege(w: W, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

describe('фазы осады логова у наших стен', () => {
  it('пролом на 1-й фазе, ворота — на 2-й, не раньше: сдача мягче голода, гарнизон уходит живым, весть заранее', async () => {
    // Кость 14 без стены: фаза 1 — 14, пролом (сдаться нельзя: вести о проломе ещё не было); фаза 2 — 14 + 1 пролом + 1
    // ход = 16, ворота открыли.
    setPhaseDie(() => 14);
    const w = makeWorld();
    const p = holdout();
    const start = (await besiege(w, p)).siege!;
    const since = start.since;
    // Граница области: голод — позже второй фазы.
    expect(start.starvesAt, 'точка внутри области: хлеба больше чем на две фазы').toBeGreaterThan(phaseAt(since, 2));
    expect(start.phases?.journal).toEqual([]);
    expect(start.phases?.nextAt).toBe(phaseAt(since, 1));
    expect(start.phases?.nextK).toBe(1);

    // Весть составлена заранее той же дверью: пролом в минуту 1-й фазы, сдача — в минуту 2-й.
    const drafts = await w.world.notices();
    const breach = drafts.items.find((i) => i.kind === 'siege-phase');
    expect(breach?.fireAt).toBe(phaseAt(since, 1));
    expect(breach?.p).toMatchObject({ phase: 'breach', k: 1, breaches: 1 });
    const fall = drafts.items.find((i) => i.kind === 'siege-fall');
    expect(fall?.fireAt).toBe(phaseAt(since, 2));
    expect(fall?.p.gates).toBe(true);
    expect(fall?.p.fate).toBe(softerFate(start.fate));

    // После 1-й фазы: пролом, город стоит — ответ владельца 7.
    w.at(phaseAt(since, 1) + 1000);
    const mid = (await w.world.sync(p)).siege!;
    expect(mid, 'после пролома город стоит фазу').toBeTruthy();
    expect(mid.phases?.breaches).toBe(1);
    expect(mid.phases?.journal[0]).toMatch(/^Ф1 · кость 14 = 14 · пролом/);
    expect(mid.phases?.next).toBe('+1 пролом, +1 ход осады');

    // 2-я фаза: ворота открыли.
    w.at(phaseAt(since, 2) + 1000);
    const end = await w.world.sync(p);
    expect(end.siege, 'город сдался').toBeNull();
    const report = end.reports.find((r) => r.title === 'Ворота открыли');
    expect(report?.at).toBe(phaseAt(since, 2));
    const effect = end.effects.find((e) => e.text.startsWith('Ворота открыли'));
    expect(effect, 'последствие сдачи').toBeTruthy();
    expect(effect?.lost, 'гарнизон ушёл живым').toEqual({});
    expect(effect?.lostTroops).toBeUndefined();
    expect(start.fate, 'логово объявило участь по умолчанию').toBe(FATE_DEFAULT);
  }, 120_000);

  it('без перемен фаза за фазой: журнал растёт офлайн, лагерь тает, город падает голодом в свою минуту', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const p = holdout();
    const start = (await besiege(w, p)).siege!;
    const camp0 = start.campMen;
    // Офлайн — одним прыжком почти до голода.
    w.at(start.starvesAt - 1000);
    const late = (await w.world.sync(p)).siege!;
    const rolled = Math.floor((start.starvesAt - 1000 - start.since) / SIEGE_PHASE);
    expect(rolled, 'точка внутри области: фаз несколько').toBeGreaterThanOrEqual(4);
    expect(late.phases?.journal).toHaveLength(rolled);
    expect(late.phases?.journal.every((l) => l.includes('без перемен'))).toBe(true);
    expect(late.campMen, 'лагерь истощился').toBeLessThan(camp0);
    w.at(start.starvesAt + 1000);
    const end = await w.world.sync(p);
    expect(end.siege).toBeNull();
    expect(end.reports.some((r) => r.title === 'Хлеб кончился')).toBe(true);
  }, 120_000);
});

/** Ставит полководца в поле у логова — свежим, сразу, без дороги (как `energyworld.test.ts`). */
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

async function ourCamp(w: W, energy: number) {
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
  expect(await w.world.besiege()).toBeNull();
  const win = w.inner.save.sieges[lair.id];
  // Вылазка и выручка логова — свои события; тест держит наказы, а не бой у рогаток.
  win.sortied = true;
  win.relieved = true;
  w.inner.save.figures.general.energy = { value: energy, at: w.now(), mode: 'camp' };
  return { p, lair, win };
}

describe('наказы нашего лагеря (8.3)', () => {
  it('«залп каждую фазу»: в минуту фазы — залп следующей фазы, пока энергии хватает и на штурм после него', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld(11);
    const { p, lair, win } = await ourCamp(w, 100);
    expect(await w.world.setOrders({ volley: true })).toBeNull();
    expect(win.orders).toEqual({ volley: true });
    expect((await w.world.camp())?.phases?.orders).toEqual({ volley: true });
    const since = win.sinceAt ?? win.startedAt;
    w.at(phaseAt(since, 1) + 1000);
    await w.world.sync(p);
    const now = w.inner.save.sieges[lair.id];
    expect(now?.phases?.[0].orders, 'наказ сработал в минуту фазы').toEqual(['volley']);
    expect(now?.log).toEqual([{ at: phaseAt(since, 1), act: 'volley' }]);
    // Залп лёг в фазу 2 — её кость получит +2.
    w.at(phaseAt(since, 2) + 1000);
    await w.world.sync(p);
    expect(w.inner.save.sieges[lair.id]?.phases?.[1].mods.volley).toBe(2);
  }, 120_000);

  it('без запаса на штурм залпа по наказу нет: энергия остаётся на штурм', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld(11);
    // К минуте фазы накопится ещё залп: 5 + 15 = 20 — ровно штурм, залпу не хватает.
    const { p, lair, win } = await ourCamp(w, 5);
    expect(await w.world.setOrders({ volley: true })).toBeNull();
    const since = win.sinceAt ?? win.startedAt;
    w.at(phaseAt(since, 1) + 1000);
    await w.world.sync(p);
    const now = w.inner.save.sieges[lair.id];
    expect(now?.phases?.[0].orders).toBeUndefined();
    expect(now?.log).toEqual([]);
  }, 120_000);

  it('«штурм при N проломах»: пролом выпал — штурм той же дверью, что кнопка, лагерь снят', async () => {
    // Кость 14 у логова без стены: фаза 1 — пролом.
    setPhaseDie(() => 14);
    const w = makeWorld(11);
    const { p, lair, win } = await ourCamp(w, ENERGY_PRICE.storm.price + 1);
    expect(await w.world.setOrders({ storm: 1 })).toBeNull();
    const since = win.sinceAt ?? win.startedAt;
    w.at(phaseAt(since, 1) + 1000);
    const pulse = await w.world.sync(p);
    expect(w.inner.save.sieges[lair.id], 'штурм снял лагерь').toBeUndefined();
    expect(pulse.reports.some((r) => r.at === phaseAt(since, 1) && r.kind === 'raid'), 'бой был в минуту фазы').toBe(true);
  }, 120_000);
});
