// Энергия агентов в настоящем мире (docs/agent_energy.md). Области правил — и каждая проверяется утверждением в самом
// тесте (правило 11):
// - уходит — на карте: в пути и стоя в поле; копится — дома; стоит — пока полководец держит осадный лагерь;
// - кончилась на карте — агент идёт домой **с той минуты, когда кончилась**, дел не берёт, пока не дойдёт; онлайн и
//   офлайн дают одну дорогу; кончилась в пути — до цели он не доходит;
// - цена дела — при приказе; не хватает — строка меню гаснет той же причиной, что откажет приказ;
// - без энергии из своих ворот не выходят.
import { describe, expect, it } from 'vitest';
import { realMs, gameDaysOfMs } from '@/game/pace';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { Coord, FigureId, FigureView, PlayerProfile } from './types';
import { ENERGY_DRAIN, ENERGY_FILL, ENERGY_MAX, ENERGY_PRICE } from './data/energy';
import { energyBlock, idleBlock } from './energy';
import { distance } from './geo';
import { shieldVillagers } from './lairs';

const START = 1_700_000_000_000;

type Inner = {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  alive(s: GenSettlement, now: number): boolean;
};

function makeWorld(seed = 11) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
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

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 30,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 20 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  ...over,
});

const fig = async (w: W, id: FigureId): Promise<FigureView> => (await w.world.figures()).find((f) => f.id === id) as FigureView;

/** Пустая клетка от дома по прямой, до которой агенту идти от `days` до `most` игровых дней. */
async function emptyCell(w: W, id: FigureId, days: number, most = days + 1): Promise<Coord> {
  const home = w.inner.save.home;
  for (let dx = 2; dx < 80; dx++) {
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const to = { x: home.x + sx * dx, y: home.y + sy * dx };
      const plan = await w.world.leadPlan(id, to);
      const d = gameDaysOfMs(realMs(plan.seconds));
      if (plan.target === null && d >= days && d <= most) return to;
    }
  }
  throw new Error(`клетки в ${days}–${most} игр. дн. пути не нашлось`);
}

/** Ставит агента в поле у поселения — свежим, сразу, без дороги. */
function standAt(w: W, id: FigureId, s: { x: number; y: number }, troops?: Record<string, number>): void {
  const f = w.inner.save.figures[id];
  Object.assign(f, {
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
    ...(troops ? { troops, handover: undefined } : {}),
  });
}

function nearestLair(w: W): GenSettlement {
  const home = w.inner.save.home;
  return w.inner.gen.settlements.filter((s) => w.inner.alive(s, w.now())).sort((a, b) => distance(home, a) - distance(home, b))[0];
}

/** Запас энергии числом, как его видит игрок. */
const energyOf = async (w: W, id: FigureId): Promise<number> => (await fig(w, id)).energy?.value ?? -1;

describe('энергия агента в мире: где уходит и где копится', () => {
  it('на карте уходит за пять игровых дней, дома копится за два', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(ENERGY_MAX);
    const to = await emptyCell(w, 'scout', 1);
    expect(await w.world.moveFigure('scout', to)).toBeNull();
    const out = await fig(w, 'scout');
    const days = gameDaysOfMs(out.arriveAt - out.departAt);
    // Точка внутри области: туда и обратно — раньше, чем кончится.
    expect(2 * days).toBeLessThan(5);
    w.at(out.arriveAt);
    await w.world.sync(p);
    const there = await fig(w, 'scout');
    expect(there.phase).toBe('field');
    expect(there.energy?.value).toBe(Math.floor(ENERGY_MAX - (ENERGY_MAX * days) / 5 + 1e-9));
    expect(there.energy?.mode).toBe('drain');

    // Домой: дорога уходит, дома копится — половина запаса за игровой день.
    expect(await w.world.recallFigure('scout')).toBeNull();
    const back = await fig(w, 'scout');
    w.at(back.arriveAt);
    await w.world.sync(p);
    const home = await fig(w, 'scout');
    expect(home.phase).toBe('home');
    const atHome = ENERGY_MAX - (ENERGY_MAX * 2 * days) / 5;
    expect(home.energy?.value).toBe(Math.floor(atHome + 1e-9));
    w.advance(ENERGY_FILL / 4);
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(Math.floor(atHome + ENERGY_MAX / 4 + 1e-9));
    w.advance(ENERGY_FILL);
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(ENERGY_MAX);
  });
});

describe('энергия кончилась на карте: домой сам, с той минуты', () => {
  /** Разведчик идёт в поле на день и стоит там, пока не кончатся силы. `pulse` — шаг пульса мира. */
  async function strand(pulse: number) {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    const to = await emptyCell(w, 'scout', 1);
    expect(await w.world.moveFigure('scout', to)).toBeNull();
    const out = await fig(w, 'scout');
    const emptyAt = out.departAt + ENERGY_DRAIN;
    const notes: string[] = [];
    let refused: string | null = null;
    while (w.now() < emptyAt + 3 * (out.arriveAt - out.departAt)) {
      w.advance(pulse);
      const res = await w.world.sync(p);
      for (const e of res.effects) if (e.text.includes('выбился')) notes.push(e.text);
      const f = await fig(w, 'scout');
      if (f.spent && f.phase !== 'home' && refused === null) refused = await w.world.moveFigure('scout', to);
    }
    await w.world.sync(p);
    const f = await fig(w, 'scout');
    return { w, f, out, emptyAt, notes, refused };
  }

  it('кончилась в поле — идёт домой с минуты, когда кончилась; пока идёт, дел не берёт; онлайн и офлайн — одна дорога', async () => {
    const day = realMs(60);
    const online = await strand(day / 24);
    const offline = await strand(30 * day);
    for (const run of [online, offline]) {
      expect(run.f.phase).toBe('home');
      expect(run.f.spent).toBe(false);
      expect(run.notes.length, 'весть «выбился из сил» — одна').toBe(1);
    }
    // Дорога одна: вышел домой в минуту, когда кончилась, и пришёл в одну и ту же минуту.
    expect(online.f.departAt).toBe(offline.f.departAt);
    expect(online.f.energy?.value).toBe(offline.f.energy?.value);
    // Точка внутри области: пульс онлайн видел его выбившимся в пути и спросил приказ.
    expect(online.refused).toBe(`Разведчик выбился из сил и идёт домой. Пока не дойдёт, дел не берёт.`);
  });

  it('кончилась в пути — до цели не доходит и поворачивает домой', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    const to = await emptyCell(w, 'diplomat', 6);
    const plan = await w.world.leadPlan('diplomat', to);
    expect(plan.energy?.runsOut, 'план говорит до приказа: кончится в пути').toBe(true);
    expect(await w.world.moveFigure('diplomat', to)).toBeNull();
    const out = await fig(w, 'diplomat');
    const empty = out.departAt + ENERGY_DRAIN;
    // Точка внутри области: кончится раньше прихода.
    expect(empty).toBeLessThan(out.arriveAt);
    w.at(empty + 1000);
    await w.world.sync(p);
    const f = await fig(w, 'diplomat');
    expect(f.phase).toBe('moving');
    expect(f.to).toEqual(w.inner.save.home);
    expect(f.departAt).toBe(empty);
    expect(f.spent).toBe(true);
    expect(f.energy?.value).toBe(0);
  });
});

describe('цена дела: при приказе, и не хватает — та же причина в меню и в отказе', () => {
  it('лазутчик: проба стоит двадцать; без них строка погашена той же строкой, что откажет приказ', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    const lair = nearestLair(w);
    standAt(w, 'spy', lair);
    const opt = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
    expect(opt.energy).toEqual({ price: ENERGY_PRICE.probe.price, block: null });
    expect(opt.can, `точка внутри области: приказ открыт (${opt.reason})`).toBe(true);
    expect((await w.world.order('probe', lair.id, opt.at)).error).toBeNull();
    // Заплачено при приказе — чем бы ни кончилось дело.
    expect(w.inner.save.figures.spy.energy?.value).toBe(ENERGY_MAX - ENERGY_PRICE.probe.price);

    // Пятнадцать — меньше цены: погашено, и отказ — те же слова.
    standAt(w, 'spy', lair);
    w.inner.save.figures.spy.energy = { value: 15, at: w.now(), mode: 'drain' };
    const low = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
    const why = energyBlock(15, ENERGY_PRICE.probe.price);
    expect(why).toBe('Не хватает энергии: 15 из 20.');
    expect(low.can).toBe(false);
    expect(low.reason).toBe(why);
    expect((await w.world.order('probe', lair.id, low.at)).error).toBe(why);
  });

  it('разведка у ворот: цены должно хватить к приходу, с дорогой', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    const lair = nearestLair(w);
    const plan = await w.world.leadPlan('scout', lair);
    const road = realMs(plan.seconds);
    // Сил ровно на дорогу и половину цены: дойдёт, а пересчитать не сможет.
    const have = (ENERGY_MAX * road) / ENERGY_DRAIN + ENERGY_PRICE.recon.price / 2;
    expect(have, 'точка внутри области: запаса меньше полного').toBeLessThan(ENERGY_MAX);
    w.inner.save.figures.scout.energy = { value: have, at: w.now(), mode: 'fill' };
    const why = energyBlock(have, ENERGY_PRICE.recon.price, road);
    expect(why).toMatch(/^Не хватит энергии: на месте будет \d+, нужно 10\.$/);
    expect((await w.world.leadPlan('scout', lair)).energy?.block).toBe(why);
    expect(await w.world.moveFigure('scout', lair)).toBe(why);
  });

  it('без энергии из своих ворот не выходят', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    w.inner.save.figures.spy.energy = { value: 0.5, at: w.now(), mode: 'fill' };
    const to = await emptyCell(w, 'spy', 1);
    expect(await w.world.moveFigure('spy', to)).toBe(idleBlock(0.5));
  });
});

describe('осадный лагерь: десять энергии, и пока он стоит, она не тратится', () => {
  it('встал — минус десять; стоит — не убывает; снял — снова уходит', async () => {
    const w = makeWorld();
    const p = profile({ army: { spearman: 40 } });
    await w.world.sync(p);
    const lair = nearestLair(w);
    standAt(w, 'general', lair, { spearman: 40 });
    expect(await w.world.besiege()).toBeNull();
    const camp = await fig(w, 'general');
    // Точка внутри области: лагерь стоит.
    expect(camp.besieging).toBe(lair.id);
    expect(camp.energy?.value).toBe(ENERGY_MAX - ENERGY_PRICE.siege.price);
    expect(camp.energy?.mode).toBe('hold');
    // Два игровых дня — на карте это сорок энергии, в лагере — ничего.
    w.advance(realMs(2 * 60));
    await w.world.sync(p);
    const still = await fig(w, 'general');
    expect(still.besieging, 'точка внутри области: лагерь ещё стоит').toBe(lair.id);
    expect(still.energy?.value).toBe(ENERGY_MAX - ENERGY_PRICE.siege.price);
    // Снял осаду — стоит в поле, и энергия уходит с этой минуты.
    expect(await w.world.retreat()).toBeNull();
    w.advance(ENERGY_DRAIN / 10);
    await w.world.sync(p);
    expect(await energyOf(w, 'general')).toBe(ENERGY_MAX - ENERGY_PRICE.siege.price - ENERGY_MAX / 10);
  });

  it('без десяти энергии лагерем не встать — та же строка в карточке и в отказе', async () => {
    const w = makeWorld();
    const p = profile({ army: { spearman: 40 } });
    await w.world.sync(p);
    const lair = nearestLair(w);
    standAt(w, 'general', lair, { spearman: 40 });
    w.inner.save.figures.general.energy = { value: 9, at: w.now(), mode: 'drain' };
    const card = await w.world.settlement(lair.id);
    const why = energyBlock(9, ENERGY_PRICE.siege.price);
    expect(card?.can.besiege).toBe(false);
    expect(card?.energy?.besiege).toEqual({ price: ENERGY_PRICE.siege.price, block: why });
    expect(await w.world.besiege()).toBe(why);
  });
});
