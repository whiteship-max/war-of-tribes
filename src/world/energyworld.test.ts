// Энергия агентов в настоящем мире (docs/agent_energy.md). Области правил — и каждая проверяется утверждением в самом
// тесте (правило 11):
// - уходит — в дороге, по дням пути; стоит — у цели, в поле, в осадном лагере (ожидание даром, решение владельца
//   06.10.2026); копится — дома;
// - кончилась на карте — агент идёт домой **с той минуты, когда кончилась**, дел не берёт, пока не дойдёт; онлайн и
//   офлайн дают одну дорогу; кончилась в пути — до цели он не доходит; стоит у цели без сил — не хватает ни на одно его
//   дело (решение владельца 06.10.2026), — домой с минуты прихода, а хватает хоть на одно — стоит;
// - «дойти и ударить» — бой в минуту прихода, онлайн и офлайн, цена штурма — при приказе;
// - цена дела — при приказе; не хватает — строка меню гаснет той же причиной, что откажет приказ;
// - без сил на своё дело из своих ворот не выходят — та же мерка, что у цели.
import { describe, expect, it } from 'vitest';
import { realMs, gameDaysOfMs } from '@/game/pace';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { Coord, FigureId, FigureView, PlayerProfile } from './types';
import { ENERGY_ROAD, ENERGY_FILL, ENERGY_MAX, ENERGY_PRICE } from './data/energy';
import { energyBlock, idleBlock, leastPrice, roadCost, roadOf } from './energy';
import { craftNote } from './siegecraft';
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
  it('в дороге уходит по дням пути, у цели стоит, дома копится за два игровых дня', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(ENERGY_MAX);
    const to = await emptyCell(w, 'scout', 1);
    expect(await w.world.moveFigure('scout', to)).toBeNull();
    const out = await fig(w, 'scout');
    const road = roadCost(out.arriveAt - out.departAt);
    // Точка внутри области: дорога стоит энергию, туда и обратно — раньше, чем кончится.
    expect(road).toBeGreaterThan(1);
    expect(2 * road).toBeLessThan(ENERGY_MAX);
    w.at(out.arriveAt);
    await w.world.sync(p);
    const there = await fig(w, 'scout');
    expect(there.phase).toBe('field');
    expect(there.energy?.value).toBe(Math.floor(ENERGY_MAX - road + 1e-9));
    expect(there.energy?.mode).toBe('hold');
    // Стоит у цели десять игровых дней — не убывает: ожидание даром.
    w.advance(realMs(10 * 60));
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(Math.floor(ENERGY_MAX - road + 1e-9));

    // Домой: дорога уходит, дома копится — половина запаса за игровой день.
    expect(await w.world.recallFigure('scout')).toBeNull();
    const back = await fig(w, 'scout');
    w.at(back.arriveAt);
    await w.world.sync(p);
    const home = await fig(w, 'scout');
    expect(home.phase).toBe('home');
    const atHome = ENERGY_MAX - road - roadCost(back.arriveAt - back.departAt);
    expect(home.energy?.value).toBe(Math.floor(atHome + 1e-9));
    // Копится ровно: за долю срока — та же доля запаса.
    const gap = (ENERGY_MAX - atHome) / 2;
    w.advance((ENERGY_FILL * gap) / ENERGY_MAX);
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(Math.floor(atHome + gap + 1e-9));
    w.advance(ENERGY_FILL);
    await w.world.sync(p);
    expect(await energyOf(w, 'scout')).toBe(ENERGY_MAX);
  });
});

describe('энергия кончилась на карте: домой сам, с той минуты', () => {
  /**
   * Разведчик идёт в поле на день с запасом на дорогу и `extra` сверху — столько у него у цели. `pulse` — шаг пульса мира.
   */
  async function strand(pulse: number, extra = leastPrice('scout') - 0.5) {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    const to = await emptyCell(w, 'scout', 1);
    const plan = await w.world.leadPlan('scout', to);
    w.inner.save.figures.scout.energy = { value: roadCost(realMs(plan.seconds)) + extra, at: w.now(), mode: 'fill' };
    expect(await w.world.moveFigure('scout', to)).toBeNull();
    const out = await fig(w, 'scout');
    const notes: string[] = [];
    let refused: string | null = null;
    while (w.now() < out.arriveAt + 3 * (out.arriveAt - out.departAt)) {
      w.advance(pulse);
      const res = await w.world.sync(p);
      for (const e of res.effects) if (e.text.includes('выбился')) notes.push(e.text);
      const f = await fig(w, 'scout');
      if (f.spent && f.phase !== 'home' && refused === null) refused = await w.world.moveFigure('scout', to);
    }
    await w.world.sync(p);
    const f = await fig(w, 'scout');
    return { w, f, out, notes, refused };
  }

  /**
   * «Без сил» у цели — не хватает ни на одно его дело (решение владельца 06.10.2026): у разведчика дело одно — разведка у
   * ворот, и у цели у него на полединицы меньше её цены. Точка внутри новой области: на экране не ноль (прежняя мерка —
   * меньше единицы — оставила бы его стоять), а дела по карману нет.
   */
  it('стоит у цели без сил на своё дело — идёт домой с минуты прихода; пока идёт, дел не берёт; онлайн и офлайн — одна дорога', async () => {
    expect(leastPrice('scout') - 0.5, 'у цели больше прежней мерки (единицы)').toBeGreaterThan(1);
    expect(leastPrice('scout'), 'мерка разведчика — цена разведки у ворот').toBe(ENERGY_PRICE.recon.price);
    const day = realMs(60);
    const online = await strand(day / 24);
    const offline = await strand(30 * day);
    for (const run of [online, offline]) {
      expect(run.f.phase).toBe('home');
      expect(run.f.spent).toBe(false);
      expect(run.notes.length, 'весть «выбился из сил» — одна').toBe(1);
    }
    // Дорога одна: вышел домой в минуту прихода к цели и пришёл в одну и ту же минуту.
    expect(online.f.departAt).toBe(offline.f.departAt);
    expect(online.f.energy?.value).toBe(offline.f.energy?.value);
    // Дома он с минуты прихода к цели плюс дорога назад — ни минутой стоянки больше.
    const walk = online.out.arriveAt - online.out.departAt;
    expect(Math.abs(online.f.departAt - online.out.arriveAt - walk), 'домой — с минуты прихода').toBeLessThan(1000);
    // Точка внутри области: пульс онлайн видел его выбившимся в пути и спросил приказ.
    expect(online.refused).toBe(`Разведчик выбился из сил и идёт домой. Пока не дойдёт, дел не берёт.`);
  });

  it('у цели хватает хоть на одно его дело — стоит: ожидание даром, домой не идёт', async () => {
    // Граница области с другой стороны: на полединицы больше цены разведки — дело по карману.
    const run = await strand(realMs(60) / 24, leastPrice('scout') + 0.5);
    expect(run.f.phase, 'стоит в поле').toBe('field');
    expect(run.f.spent).toBe(false);
    expect(run.notes, 'вести «выбился из сил» нет').toEqual([]);
    expect(run.f.energy?.value).toBe(leastPrice('scout'));
  });

  it('кончилась в пути — до цели не доходит и поворачивает домой', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    // В дороге мерка — ноль, а не цена дела: путь несёт оплаченное дело, и повернуть раньше значило бы отнять его.
    // Сил чуть больше самого дешёвого дела — из ворот выйти можно, — а дороги больше, чем сил.
    const to = await emptyCell(w, 'diplomat', 4);
    const walk = realMs((await w.world.leadPlan('diplomat', to)).seconds);
    const have = leastPrice('diplomat') + 0.5;
    expect(roadCost(walk), 'точка внутри области: дороги больше, чем сил').toBeGreaterThan(have);
    w.inner.save.figures.diplomat.energy = { value: have, at: w.now(), mode: 'fill' };
    const plan = await w.world.leadPlan('diplomat', to);
    expect(plan.energy?.runsOut, 'план говорит до приказа: кончится в пути').toBe(true);
    expect(await w.world.moveFigure('diplomat', to)).toBeNull();
    const out = await fig(w, 'diplomat');
    const empty = out.departAt + roadOf(have);
    // Точка внутри области: кончится раньше прихода.
    expect(empty).toBeLessThan(out.arriveAt);
    w.at(empty + 1000);
    await w.world.sync(p);
    const f = await fig(w, 'diplomat');
    expect(f.phase).toBe('moving');
    expect(f.to).toEqual(w.inner.save.home);
    expect(f.departAt).toBe(Math.ceil(empty));
    expect(f.spent).toBe(true);
    expect(f.energy?.value).toBe(0);
  });
});

describe('«дойти и ударить»: бой в минуту прихода, игрока не ждёт (решение владельца 06.10.2026)', () => {
  it('приказ из дома: цена штурма при приказе, бой — в минуту прихода и офлайн; карточка и отказ — одной проверкой', async () => {
    const w = makeWorld();
    const p = profile({ army: { spearman: 40 } });
    await w.world.sync(p);
    expect(await w.world.setGarrison({ spearman: 40 })).toBeNull();
    const ready = (await fig(w, 'general')).readyAt;
    if (ready > w.now()) w.at(ready + 1);
    await w.world.sync(p);
    const lair = nearestLair(w);
    const card = await w.world.settlement(lair.id);
    const plan = card?.assault;
    expect(plan?.can, `точка внутри области: приказ открыт (${plan?.reason})`).toBe(true);
    expect(plan?.walkMs).toBeGreaterThan(0);
    // Сил меньше, чем на дорогу и штурм: строка карточки и отказ — одни слова.
    w.inner.save.figures.general.energy = { value: roadCost(plan!.walkMs) + ENERGY_PRICE.storm.price - 1, at: w.now(), mode: 'fill' };
    const low = (await w.world.settlement(lair.id))?.assault;
    expect(low?.can).toBe(false);
    expect(await w.world.assault(lair.id, 'plunder')).toBe(low?.reason);
    w.inner.save.figures.general.energy = undefined;
    expect(await w.world.assault(lair.id, 'plunder')).toBeNull();
    const out = await fig(w, 'general');
    expect(out.phase).toBe('moving');
    expect(out.energy?.value).toBe(ENERGY_MAX - ENERGY_PRICE.storm.price);
    // Игрок не в игре: один заход сутки спустя — бой уже был, в минуту прихода.
    w.at(out.arriveAt + realMs(30 * 60));
    const res = await w.world.sync(p);
    const fight = res.effects.find((e) => e.battle !== null && e.deed?.agent === 'general');
    expect(fight, 'бой был').toBeDefined();
    expect(fight?.deed?.at).toBe(out.arriveAt);
  });
});

describe('«дойти и осадить»: лагерь в минуту прихода (docs/siege_v2.md, 1.3)', () => {
  const ready = async () => {
    const w = makeWorld();
    const p = profile({ army: { spearman: 40 } });
    await w.world.sync(p);
    expect(await w.world.setGarrison({ spearman: 40 })).toBeNull();
    const at = (await fig(w, 'general')).readyAt;
    if (at > w.now()) w.at(at + 1);
    await w.world.sync(p);
    return { w, p, lair: nearestLair(w) };
  };

  it('цена осады при приказе, лагерь встаёт в минуту прихода и офлайн; карточка и отказ — одной проверкой', async () => {
    const { w, p, lair } = await ready();
    const plan = (await w.world.settlement(lair.id))?.invest;
    expect(plan?.can, `точка внутри области: приказ открыт (${plan?.reason})`).toBe(true);
    expect(plan?.walkMs).toBeGreaterThan(0);
    expect(plan?.energy.price).toBe(ENERGY_PRICE.siege.price);
    // Сил меньше, чем на дорогу и осаду: строка карточки и отказ — одни слова.
    w.inner.save.figures.general.energy = { value: roadCost(plan!.walkMs) + ENERGY_PRICE.siege.price - 1, at: w.now(), mode: 'fill' };
    const low = (await w.world.settlement(lair.id))?.invest;
    expect(low?.can).toBe(false);
    expect(await w.world.assault(lair.id, 'plunder', 'siege')).toBe(low?.reason);
    w.inner.save.figures.general.energy = undefined;
    expect(await w.world.assault(lair.id, 'plunder', 'siege')).toBeNull();
    const out = await fig(w, 'general');
    expect(out.phase).toBe('moving');
    expect(out.energy?.value, 'заплачена цена осады, а не штурма').toBe(ENERGY_MAX - ENERGY_PRICE.siege.price);
    expect(w.inner.save.sieges[lair.id], 'лагеря до прихода нет').toBeUndefined();
    // Игрок не в игре: первый заход после прихода — лагерь уже стоит, с минуты прихода.
    w.at(out.arriveAt + 1000);
    await w.world.sync(p);
    const camp = w.inner.save.sieges[lair.id];
    expect(camp?.campId, 'лагерь — наш').toBe('general');
    expect(camp?.sinceAt, 'встал в минуту прихода').toBe(out.arriveAt);
    expect(camp?.fate, 'с объявленной участью').toBe('plunder');
    // Боя не было: «дойти и осадить» — не удар.
    expect((await w.world.reports()).some((r) => r.kind === 'raid' && r.target.id === lair.id)).toBe(false);
  });

  it('к приходу осадить нельзя — лагеря нет, и летопись говорит почему той же проверкой, что у «Осадить»', async () => {
    const { w, p, lair } = await ready();
    expect(await w.world.assault(lair.id, 'plunder', 'siege')).toBeNull();
    const out = await fig(w, 'general');
    // Пока полководец в пути, город успели доесть: неприкосновенность до после прихода.
    w.inner.save.siegeImmune[lair.id] = out.arriveAt + realMs(60 * 60);
    w.at(out.arriveAt + 1000);
    const res = await w.world.sync(p);
    expect(w.inner.save.sieges[lair.id]).toBeUndefined();
    const miss = res.effects.find((e) => e.id.startsWith('assault-miss-'));
    expect(miss?.text).toContain('лагеря не поставил: город недавно доели');
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

    // Пятнадцать — меньше цены пробы, самого дешёвого его дела: сил нет ни на одно дело (решение владельца 06.10.2026), и
    // лазутчик выбился из сил — погашено, и отказ — те же слова. Прежде здесь стояло «Не хватает энергии: 15 из 20.»:
    // дешевле пробы у лазутчика дела нет, и между «хватает на дело» и «выбился» места не осталось.
    standAt(w, 'spy', lair);
    w.inner.save.figures.spy.energy = { value: 15, at: w.now(), mode: 'drain' };
    expect(15, 'точка внутри области: меньше самого дешёвого дела').toBeLessThan(leastPrice('spy'));
    const low = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
    const why = 'Лазутчик выбился из сил и идёт домой. Пока не дойдёт, дел не берёт.';
    expect(low.can).toBe(false);
    expect(low.reason).toBe(why);
    expect((await w.world.order('probe', lair.id, low.at)).error).toBe(why);
    // Ровно на пробу — отказа нет, и цена та же, что в меню.
    standAt(w, 'spy', lair);
    w.inner.save.figures.spy.energy = { value: ENERGY_PRICE.probe.price, at: w.now(), mode: 'hold' };
    const even = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
    expect(even.energy).toEqual({ price: ENERGY_PRICE.probe.price, block: null });
  });

  it('разведка у ворот: цены должно хватить к приходу, с дорогой', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    const lair = nearestLair(w);
    const plan = await w.world.leadPlan('scout', lair);
    const road = realMs(plan.seconds);
    // Сил ровно на дорогу и половину цены: дойдёт, а пересчитать не сможет.
    const have = (ENERGY_MAX * road) / ENERGY_ROAD + ENERGY_PRICE.recon.price / 2;
    expect(have, 'точка внутри области: запаса меньше полного').toBeLessThan(ENERGY_MAX);
    w.inner.save.figures.scout.energy = { value: have, at: w.now(), mode: 'fill' };
    const why = energyBlock(have, ENERGY_PRICE.recon.price, road);
    expect(why).toMatch(/^Не хватит энергии: на месте будет \d+, нужно 10\.$/);
    expect((await w.world.leadPlan('scout', lair)).energy?.block).toBe(why);
    expect(await w.world.moveFigure('scout', lair)).toBe(why);
  });

  it('без сил на своё дело из своих ворот не выходят — та же мерка, что у цели', async () => {
    const w = makeWorld();
    const p = profile();
    await w.world.sync(p);
    // Больше прежней мерки (единицы), меньше пробы: выйти можно было бы только затем, чтобы, придя, повернуть.
    const have = leastPrice('spy') - 5;
    expect(have, 'точка внутри области').toBeGreaterThan(1);
    w.inner.save.figures.spy.energy = { value: have, at: w.now(), mode: 'fill' };
    const to = await emptyCell(w, 'spy', 1);
    expect(await w.world.moveFigure('spy', to)).toBe(idleBlock(have, 'spy'));
    expect(idleBlock(have, 'spy')).toBe(`Не хватает энергии ни на одно дело: ${have} из ${leastPrice('spy')}. Дома она вернётся.`);
    expect((await w.world.leadPlan('spy', to)).energy?.block, 'план до приказа — та же строка').toBe(idleBlock(have, 'spy'));
    // Ровно на дело — выйти можно.
    w.inner.save.figures.spy.energy = { value: leastPrice('spy'), at: w.now(), mode: 'fill' };
    expect(await w.world.moveFigure('spy', to)).toBeNull();
  });
});

describe('осадный лагерь: десять энергии, и пока он стоит, она не тратится', () => {
  it('встал — минус десять; стоит — не убывает; снял — стоит в поле даром; пошёл — уходит в дороге', async () => {
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
    // Снял осаду — стоит в поле, и энергия не уходит: ожидание даром.
    expect(await w.world.retreat()).toBeNull();
    w.advance(ENERGY_ROAD / 10);
    await w.world.sync(p);
    expect(await energyOf(w, 'general')).toBe(ENERGY_MAX - ENERGY_PRICE.siege.price);
    // Пошёл — уходит в дороге.
    expect(await w.world.recallFigure('general')).toBeNull();
    const back = await fig(w, 'general');
    w.at(back.departAt + (back.arriveAt - back.departAt) / 2);
    await w.world.sync(p);
    expect(await energyOf(w, 'general')).toBe(Math.floor(ENERGY_MAX - ENERGY_PRICE.siege.price - roadCost((back.arriveAt - back.departAt) / 2) + 1e-9));
  });

  /**
   * Осадный лагерь — самое дешёвое дело полководца, и без десяти у него сил нет ни на одно дело (решение владельца
   * 06.10.2026): он выбился из сил, и карточка гасит кнопку той же строкой, что откажет приказ. Прежде тест ждал здесь
   * «Не хватает энергии: 9 из 10.» — при мерке «меньше единицы» полководец с девятью ещё стоял в поле. Граница области —
   * цена лагеря: девять — нет, десять — лагерем встать можно.
   */
  it('без десяти энергии лагерем не встать — сил нет ни на одно дело: та же строка в карточке и в отказе', async () => {
    const w = makeWorld();
    const p = profile({ army: { spearman: 40 } });
    await w.world.sync(p);
    const lair = nearestLair(w);
    expect(leastPrice('general'), 'лагерь — самое дешёвое дело полководца').toBe(ENERGY_PRICE.siege.price);
    standAt(w, 'general', lair, { spearman: 40 });
    w.inner.save.figures.general.energy = { value: ENERGY_PRICE.siege.price - 1, at: w.now(), mode: 'drain' };
    const card = await w.world.settlement(lair.id);
    const why = 'Полководец выбился из сил и идёт домой. Пока не дойдёт, дел не берёт.';
    expect(card?.can.besiege).toBe(false);
    expect(card?.energy?.besiege).toEqual({ price: ENERGY_PRICE.siege.price, block: why });
    expect(await w.world.besiege()).toBe(why);
    // Ровно на лагерь — карточка открыта, приказ принят.
    standAt(w, 'general', lair, { spearman: 40 });
    w.inner.save.figures.general.energy = { value: ENERGY_PRICE.siege.price, at: w.now(), mode: 'hold' };
    expect((await w.world.settlement(lair.id))?.energy?.besiege).toEqual({ price: ENERGY_PRICE.siege.price, block: null });
    expect(await w.world.besiege()).toBeNull();
  });
});

describe('осада у ворот: до приказа сказано, хватит ли у стен на штурм из лагеря (docs/siege_audit.md, решение 9)', () => {
  /**
   * В лагере энергия стоит: что останется после цены лагеря, то и будет на штурм. Граница области — цена лагеря плюс цена
   * штурма: на ней и выше строка говорит «хватит», ниже — «не хватит», и кнопка штурма в лагере говорит то же самое. Ниже
   * цены лагеря строки нет: осада сама не по карману (об этом — её отказ).
   */
  it('строка карточки и кнопка штурма в лагере — одна правда', async () => {
    const siege = ENERGY_PRICE.siege.price;
    const storm = ENERGY_PRICE.storm.price;
    for (const value of [siege + storm, siege + storm - 1, siege - 1]) {
      const w = makeWorld();
      const p = profile({ army: { spearman: 40 } });
      await w.world.sync(p);
      const lair = nearestLair(w);
      standAt(w, 'general', lair, { spearman: 40 });
      w.inner.save.figures.general.energy = { value, at: w.now(), mode: 'hold' };
      const card = await w.world.settlement(lair.id);
      if (value < siege) {
        expect(card?.campStorm, `${value}: осада не по карману — строки нет`).toBeUndefined();
        continue;
      }
      expect(card?.can.besiege, `${value}: точка внутри области — осадить можно`).toBe(true);
      const enough = value >= siege + storm;
      expect(card?.campStorm).toContain(`останется ${value - siege} энергии`);
      expect(card?.campStorm).toContain(enough ? 'хватит и на штурм' : 'не хватит');
      // Встали лагерем — и кнопка штурма говорит то же, что карточка до приказа.
      expect(await w.world.besiege()).toBeNull();
      expect((await w.world.camp())?.storm?.block ?? null, `${value}`).toBe(enough ? null : energyBlock(value - siege, storm));
    }
  });
});

describe('дела в лагере: цена при приказе, один раз за дело, и меню гасит той же строкой, что откажет приказ', () => {
  it('обстрел логова: пятнадцать за залп, на пределе — отказ без списания; без энергии — та же строка в меню и в отказе', async () => {
    const w = makeWorld();
    const p = profile({ army: { spearman: 40 } });
    await w.world.sync(p);
    const lair = nearestLair(w);
    standAt(w, 'general', lair, { spearman: 40 });
    expect(await w.world.besiege()).toBeNull();
    expect((await fig(w, 'general')).besieging, 'точка внутри области: лагерь стоит').toBe(lair.id);
    const start = await energyOf(w, 'general');
    const shot = ENERGY_PRICE.bombard.price;
    for (let n = 1; n <= 3; n++) {
      expect(await w.world.campCraft('bombard')).toBeNull();
      expect(await energyOf(w, 'general')).toBe(start - n * shot);
    }
    // Предел за осаду: меню и приказ — одна строка, энергия на месте.
    const menu = (await w.world.camp())?.crafts?.find((c) => c.act === 'bombard');
    expect(menu?.can).toBe(false);
    expect(await w.world.campCraft('bombard')).toBe(menu?.reason);
    expect(await energyOf(w, 'general')).toBe(start - 3 * shot);
    // Без энергии на укрепление — та же строка двери энергии в меню и в отказе, счётчик не тронут.
    w.inner.save.figures.general.energy = { value: ENERGY_PRICE.fortify.price - 1, at: w.now(), mode: 'hold' };
    const fort = (await w.world.camp())?.crafts?.find((c) => c.act === 'fortify');
    expect(fort?.reason).toBe(energyBlock(ENERGY_PRICE.fortify.price - 1, ENERGY_PRICE.fortify.price));
    expect(await w.world.campCraft('fortify')).toBe(fort?.reason);
    expect(w.inner.save.sieges[lair.id]?.craft?.fort).toBeUndefined();
    // Стены у логова нет: строка «что сделано» не обещает пролома — как и меню (docs/siege_audit.md, решение 7).
    const note = (await w.world.camp())?.craftNote ?? '';
    expect(note, 'точка внутри области: залпы были').toContain('Город обстреляли 3 из 3 раз');
    expect(note).not.toContain('Пролом');
    expect(note).toBe(craftNote({ shots: 3 }, false));
  });

  it('штурм логова после обстрела: запись боя несёт залпы для ролика (`BattleRecord.shots`), без обстрела — нет', async () => {
    for (const shots of [0, 2]) {
      const w = makeWorld();
      await w.world.sync(profile({ army: { spearman: 40 } }));
      const lair = nearestLair(w);
      standAt(w, 'general', lair, { spearman: 40 });
      expect(await w.world.besiege()).toBeNull();
      for (let n = 0; n < shots; n++) expect(await w.world.campCraft('bombard')).toBeNull();
      w.inner.save.figures.general.energy = { value: ENERGY_MAX, at: w.now(), mode: 'hold' };
      const res = await w.world.attack({});
      expect(res.error).toBeNull();
      const rec = w.inner.save.reports.find((r) => r.id === res.reportId)?.battle;
      // Точка внутри области: бой был, и шёл он у логова.
      expect(rec?.site).toBe('lair');
      expect(rec?.shots).toBe(shots > 0 ? shots : undefined);
      // Донесение о штурме логова — тоже без пролома: стены нет.
      expect(w.inner.save.reports.find((r) => r.id === res.reportId)?.text ?? '').not.toContain('Пролом');
    }
  });
});
