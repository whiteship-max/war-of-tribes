// Ответы осаждённого (docs/siege_v2.md, раздел 5; этап 2г): правила дверей и мир на клиенте под лагерем логова. Починка
// пролома закрывает его к концу фазы; паёк — ×¾ с минуты приказа, и деревня ест по нему тем же числом, мораль и порядок
// платят долей урезанного; вылазка на машину сжигает её вместе с древесиной; сдача — та же дверь, что «ворота открыли»;
// наказы осаждённого срабатывают в минуту фазы. Кость фаз подменяется (`setPhaseDie`): точка — внутри области правила.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyingWorld } from './local/NotifyingWorld';
import type { WorldSave } from './local/state';
import type { PlayerProfile, WorldPulse } from './types';
import { shieldVillagers } from './lairs';
import {
  breachesOf,
  modsOf,
  orderRations,
  phaseAt,
  progressOf,
  repairAfter,
  repairBlock,
  repairDoneAt,
  repairPending,
  rowsOf,
  setPhaseDie,
  softerFate,
  type PhaseRow,
} from './siegeroll';
import { consumptionPerHour, openSiege, starvesAt, starvesIfRation, type SiegeWindow } from './siege';
import { burnBlock, guardShare, machineAfter, machinesAt, machinesBurned } from './machines';
import { MACHINE_WOOD } from './data/machines';
import { guardKinds, machineFight } from './fights';
import { emptyStack } from '@/battle';
import { wallRepairCost } from '@/game/build';
import { upgradeCost, foodConsumptionPerDay, moraleBreakdown, orderBreakdown, rationMorale } from '@/game/derived';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { SIEGE_RATION, SIEGE_RATION_CUT, STARVING_MORALE, WALL_REPAIR_SHARE } from '@/game/constants';
import { createInitialState } from '@/game/state';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

afterEach(() => setPhaseDie(null));

const T0 = 1_700_000_000_000;

/** Окно осады на пустом месте: хлеба на сутки, стены уровня `wall`. */
function win(over: Partial<SiegeWindow> = {}): SiegeWindow {
  return {
    ...openSiege({ byId: 'lair', campId: 'm1', now: T0, food: 2400, garrison: 0, townPerHour: 100, perManPerHour: 1, wall: 1, log: [] }),
    ...over,
  };
}

const row = (at: number, out: PhaseRow['out']): PhaseRow => ({ at, die: 7, mods: {}, out, waste: 0 });

describe('починка пролома — правило двери', () => {
  it('закрывает пролом к минуте броска своей фазы: бросок видит стену целой, а до того пролом открыт', () => {
    const w0 = win();
    const since = T0;
    const w1 = { ...w0, phases: [row(phaseAt(since, 1), 'breach')] };
    expect(breachesOf(w1), 'точка внутри области: пролом есть').toBe(1);
    const at = phaseAt(since, 1) + 1000;
    expect(repairBlock(w1, at)).toBeNull();
    const w2 = { ...w1, ...repairAfter(w1, at) };
    expect(repairDoneAt(since, at)).toBe(phaseAt(since, 2));
    expect(repairPending(w2, at)).toBe(phaseAt(since, 2));
    // Пока фаза идёт — пролом открыт; поправка броска второй фазы — уже без него.
    expect(breachesOf(w2)).toBe(1);
    expect(modsOf(w2, 2).breach).toBeUndefined();
    expect(repairBlock(w2, at + 1)).toBe('Пролом этой фазы уже заделывают. Следующий — в новой фазе.');
    // После броска второй фазы — стена цела; ход осады починка не отнимает.
    const w3 = { ...w2, phases: [...rowsOf(w2), row(phaseAt(since, 2), 'calm')] };
    expect(breachesOf(w3)).toBe(0);
    expect(progressOf(w3)).toBe(progressOf(w1));
    expect(repairBlock(w3, phaseAt(since, 2) + 1)).toBe('Проломов нет, заделывать нечего.');
  });

  it('цена — треть цены уровня стен той же лестницей, что улучшение; стен нет — цены нет', () => {
    for (const level of [1, 4, 10]) {
      const full = upgradeCost(BUILDING_BY_ID.palisade, level);
      const third = wallRepairCost(level);
      for (const [r, v] of Object.entries(full)) expect(third[r as keyof typeof third]).toBe(Math.round((v as number) * WALL_REPAIR_SHARE));
    }
    expect(wallRepairCost(0)).toEqual({});
  });
});

describe('осадный паёк — правило двери и деревня', () => {
  it('окно: расход ×¾ — с того же остатка хлеба голод на треть дальше', () => {
    const w = win();
    const at = T0 + 3_600_000;
    expect(starvesAt(w), 'точка внутри области: голод позже минуты приказа').toBeGreaterThan(at);
    expect(consumptionPerHour({ ...w, ration: true })).toBeCloseTo(consumptionPerHour(w) * SIEGE_RATION, 9);
    expect(starvesIfRation(w, at, true) - at).toBeCloseTo((starvesAt(w) - at) / SIEGE_RATION, -1);
    expect(starvesIfRation(w, at, false)).toBeCloseTo(starvesAt(w), -1);
  });

  it('деревня: весь расход ×¾, мораль — кара пустых закромов в доле урезанного, надзор — той же долей', () => {
    const s = createInitialState();
    s.bonded = 30 as never;
    const eat = foodConsumptionPerDay(s);
    const hold = orderBreakdown(s).hold;
    s.siege = { byName: 'Логово', until: s.time + 1000, ration: true };
    expect(eat, 'точка внутри области: город ест').toBeGreaterThan(0);
    expect(foodConsumptionPerDay(s)).toBeCloseTo(eat * SIEGE_RATION, 9);
    expect(rationMorale()).toBe(STARVING_MORALE * SIEGE_RATION_CUT);
    expect(moraleBreakdown(s).lines.find((l) => l.id === 'ration')?.value).toBe(-rationMorale());
    const order = orderBreakdown(s);
    expect(hold, 'точка внутри области: надзор есть').toBeGreaterThan(0);
    expect(order.lines.find((l) => l.id === 'ration')?.value).toBeCloseTo(-(order.lines.filter((l) => l.id !== 'ration').reduce((n, l) => n + l.value, 0)) * SIEGE_RATION_CUT, 9);
  });

  it('наказ пайка — когда хлеба меньше половины, и только если паёк ещё обычный', () => {
    expect(orderRations({ ration: true }, false, 0.49)).toBe(true);
    expect(orderRations({ ration: true }, false, 0.5)).toBe(false);
    expect(orderRations({ ration: true }, true, 0.1)).toBe(false);
    expect(orderRations({}, false, 0.1)).toBe(false);
  });
});

describe('вылазка на машину — правило двери', () => {
  it('охрана — доля лагеря по древесине машины на две стороны; сожжённая не стоит и древесину не возвращает', () => {
    expect(guardShare('ram')).toBeCloseTo(MACHINE_WOOD.ram / 2, 9);
    const w0 = win({ wood: { front: 0, rear: 0, machines: 1 } });
    const ram0 = { ...w0, machines: machineAfter(w0, 'ram', T0) };
    const w1 = { ...w0, machines: machineAfter(ram0, 'ladders', T0) };
    const late = T0 + 30 * 24 * 3_600_000;
    const before = machinesAt(w1, late).find((m) => m.id === 'ladders')!.readyAt;
    expect(burnBlock(w1, 'tower', T0 + 1)).toBe('Осадная башня: у лагеря её нет.');
    expect(burnBlock(w1, 'ram', T0 + 1)).toBeNull();
    const w2 = { ...w1, machines: machinesBurned(w1, 'ram', T0 + 1) };
    const ram = machinesAt(w2, late).find((m) => m.id === 'ram')!;
    expect(ram.burned).toBe(true);
    expect(ram.ready).toBe(false);
    expect(burnBlock(w2, 'ram', T0 + 2)).toBe('Таран: у лагеря её нет.');
    // Очередь: лестницы готовы не раньше, чем были, — лес тарана сгорел вместе с ним.
    expect(machinesAt(w2, late).find((m) => m.id === 'ladders')!.readyAt).toBe(before);
  });

  it('бой — с охраной в поле, без рогаток: больший отряд берёт верх над той же охраной', () => {
    const camp = { ...emptyStack(), infantry: 300, archer: 60 };
    const guard = guardKinds(camp, guardShare('ram'));
    expect(guard.infantry).toBe(Math.floor(300 * guardShare('ram')));
    const fight = (men: number) =>
      machineFight({ seed: 5, guard: { kinds: guard, rest: 1 }, sortie: { kinds: { ...emptyStack(), infantry: men } } }).field.won;
    expect(fight(guard.infantry * 4)).toBe(true);
    expect(fight(Math.max(1, Math.floor(guard.infantry / 4)))).toBe(false);
  });
});

// ---------- мир на клиенте: осада логовом у наших стен ----------

type Inner = { save: WorldSave };

function makeWorld(seed = 7) {
  let now = T0;
  const world = new NotifyingWorld({ seed, now: () => now, storage: null });
  return { world, inner: world as unknown as Inner, now: () => now, advance: (ms: number) => (now += ms) };
}

/** Деревня, которую штурмовать бессмысленно (как `siegephase.test.ts`), со стенами первого уровня и запасом на починку. */
const holdout = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 600, wood: 5000, stone: 2000 },
  stash: 0,
  food: 6000 * 12,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  levels: { palisade: 1 },
});

async function besiege(w: ReturnType<typeof makeWorld>, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

describe('ответы осаждённого под лагерем логова', () => {
  it('починка: окно говорит цену и минуту; дерево и камень уходят со склада; к концу фазы пролома нет', async () => {
    // Кость 14 у стены первого уровня — пролом в первой фазе; дальше «без перемен».
    setPhaseDie((_s, k) => (k === 1 ? 14 : 7));
    const w = makeWorld();
    const p = holdout();
    const start = (await besiege(w, p)).siege!;
    const since = start.since;
    expect(start.starvesAt, 'точка внутри области: голод позже второй фазы').toBeGreaterThan(phaseAt(since, 2));
    w.advance(phaseAt(since, 1) - w.now() + 1000);
    let pulse = await w.world.sync(p);
    expect(pulse.siege?.phases?.breaches, 'точка внутри области: пролом').toBe(1);
    const a = pulse.siege!.answers!;
    expect(a.repair.cost).toEqual(wallRepairCost(1));
    expect(a.repair.reason).toBeNull();
    expect(await w.world.defend({ act: 'repair' })).toBeNull();
    pulse = await w.world.sync(p);
    expect(pulse.siege?.answers?.repair.doneAt).toBe(phaseAt(since, 2));
    const pay = pulse.effects.find((e) => e.id.startsWith('repair-'));
    expect(pay?.resources).toEqual({ wood: -(wallRepairCost(1).wood ?? 0), stone: -(wallRepairCost(1).stone ?? 0) });
    w.advance(phaseAt(since, 2) - w.now() + 1000);
    pulse = await w.world.sync(p);
    expect(pulse.siege?.phases?.breaches).toBe(0);
  });

  it('паёк: голод на треть дальше от остатка, окно говорит это до нажатия; племя видит паёк', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const p = holdout();
    await besiege(w, p);
    w.advance(60_000);
    let pulse = await w.world.sync(p);
    const promised = pulse.siege!.answers!.ration.starvesAt;
    expect(promised, 'точка внутри области: паёк отодвигает голод').toBeGreaterThan(pulse.siege!.starvesAt);
    expect(await w.world.defend({ act: 'ration', on: true })).toBeNull();
    pulse = await w.world.sync(p);
    expect(pulse.siege?.ration).toBe(true);
    expect(Math.abs(pulse.siege!.starvesAt - promised)).toBeLessThan(1000);
    expect(await w.world.defend({ act: 'ration', on: true })).toBe('Паёк и так урезан.');
  });

  it('наказы: пролом в минуту фазы — починка по наказу, строка журнала её называет', async () => {
    setPhaseDie((_s, k) => (k === 1 ? 14 : 7));
    const w = makeWorld();
    const p = holdout();
    const start = (await besiege(w, p)).siege!;
    expect(await w.world.defend({ act: 'orders', defend: { repair: true } })).toBeNull();
    w.advance(phaseAt(start.since, 1) - w.now() + 1000);
    const pulse = await w.world.sync(p);
    expect(pulse.siege?.answers?.defend).toEqual({ repair: true });
    expect(pulse.siege?.answers?.repair.doneAt).toBe(phaseAt(start.since, 2));
    expect(pulse.siege?.phases?.journal[0]).toContain('починка по наказу');
  });

  it('сдача: участь на ступень мягче объявленной, гарнизон уходит живым', async () => {
    setPhaseDie(() => 7);
    const w = makeWorld();
    const p = holdout();
    const start = (await besiege(w, p)).siege!;
    expect(start.answers?.surrender).toBe(softerFate(start.fate));
    expect(await w.world.defend({ act: 'surrender' })).toBeNull();
    const pulse = await w.world.sync(p);
    expect(pulse.siege).toBeNull();
    const fell = pulse.effects.find((e) => e.routed);
    expect(fell, 'точка внутри области: город пал').toBeDefined();
    expect(fell?.lostTroops, 'гарнизон не рассеян').toBeUndefined();
    expect(fell?.lost).toEqual({});
    expect(Object.keys(w.inner.save.sieges)).not.toContain('home');
  });
});
