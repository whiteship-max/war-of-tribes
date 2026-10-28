// Перехват похода игрока в поле (ПЛ-1, docs/siege_v2.md, «Решения ПЛ-1») на трёх мирах с сервером войны в памяти: НиСы (A)
// идёт на Манчестер (B), Ливерпуль (C) — союзник Манчестера по пакту. Харнесс — как `gaitwar.test.ts`. Области правил —
// утверждением в самом тесте (правило 11): поход в пути (фаза `march`, минута до прихода), встреча раньше прихода, бой был.
//
// Баг владельца: касание чужого похода на карте давало «Полководец: сейчас нельзя — у полководца здесь дел нет» при любом виде
// похода и режиме марша — мир искал цель перехвата только среди своих набегов (`LocalWorld.chaseTarget`), а поход игрока
// лежит в записи войн. Здесь — каждый вид (удар, осада, блокада) в каждом допустимом режиме марша.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { ErrandTarget, PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, warsOf, type SheetAt, type WarRow } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';
import { ringSlots } from '@/ui/map/ring';
import { warWalkMs } from './pvp';
import { warMoving, warSpotAt, MEET_CAMP, MEET_FAR, MEET_STALE } from './pvpmeet';
import { positionAt } from './pursuit';
import { setPhaseDie } from './siegeroll';
import { GENERAL_INTERCEPTS } from './siege';
import { troopTotal } from '@/game/battle/kinds';
import { warRegainId } from '../../netlify/lib/contract';
import { windfallKnown } from '../../netlify/lib/watch';
import { warLosses } from '../../netlify/lib/book';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));
// Временная ×3 скорость пути (`TEST_TRAVEL_SPEED`): встреча верна и при 1 — число читается живьём, тест ставит его сам.
const travel = vi.hoisted(() => ({ k: 3 }));
vi.mock('./data/tuning', async (actual) => {
  const real = await actual<Record<string, unknown>>();
  return Object.defineProperty({ ...real }, 'TEST_TRAVEL_SPEED', { get: () => travel.k, enumerable: true });
});

afterEach(() => {
  setPhaseDie(null);
  travel.k = 3;
});

const T0 = 1_900_000_000_000;
const A = 'tg-2001';
const B = 'tg-2002';
const C = 'tg-2003';
const KEYS = [A, B, C] as const;
/** Сиды миров: у мира союзника за долгий поход не встаёт свой лагерь логова под стенами — иначе выход из города закрыт честно. */
const SEEDS = [11, 12, 41];
const NAMES: Record<string, string> = { [A]: 'НиСы', [B]: 'Манчестер', [C]: 'Ливерпуль' };
const SQUAD = { spearman: 60, swordsman: 30, archer: 30 };
const STRONG = { spearman: 200, swordsman: 120, archer: 80 };

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const profile = (army: Record<string, number>, food = 30000): PlayerProfile => ({
  name: 'Тест',
  pop: 400,
  defense: 300,
  militia: 20,
  militiaArchers: 6,
  units: { warrior: 120, scout: 4 },
  army,
  stock: { food, wood: 800, stone: 300 },
  stash: 50,
  gold: 300,
  food,
  foodPerHour: 30,
  soldierFoodPerHour: 1,
});

type Armies = Partial<Record<string, Record<string, number>>>;

function game(armies: Armies = {}) {
  let now = T0;
  let roster: RosterFile = emptyRoster();
  for (const k of KEYS) roster = upsert(roster, k, claim(NAMES[k]), T0);
  const file = emptyWars();
  const sheets = new Map<string, SheetAt | null>();
  const flags: string[] = [];
  const castlesFor = (me: string): (() => PlayerCastle[]) => () =>
    Object.entries(roster.rows)
      .filter(([k]) => k !== me)
      .map(([k, r]) => ({ id: castleIdOf(k), x: r.x, y: r.y, name: r.name, city: r.city, power: r.power, pop: r.pop, seenAt: r.seenAt }));
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null, forged: (t: string) => void flags.push(t) };
  const link = (me: string) => ({
    wars: () => {
      advance(file, now, sheets);
      return warsOf(file, me);
    },
    warsKnown: () => true,
    warOrder: async (o: WarOrder) => {
      advance(file, now, sheets);
      return applyOrder(file, me, o, now, ctx);
    },
  });
  const worlds = Object.fromEntries(
    KEYS.map((k, i) => [k, new LocalWorld({ seed: SEEDS[i], now: () => now, storage: null, home: roster.rows[k], castles: castlesFor(k), ...link(k) })]),
  ) as Record<string, LocalWorld>;
  const said: Record<string, { id: string; text: string; resources: Record<string, number | undefined> }[]> = { [A]: [], [B]: [], [C]: [] };
  const pulse = async (): Promise<void> => {
    for (const k of KEYS) {
      const res = await worlds[k].sync(profile(armies[k] ?? SQUAD));
      for (const e of res.effects) said[k].push({ id: e.id, text: e.text, resources: { ...e.resources } });
      sheets.set(k, { sheet: worlds[k].warSheet()!, at: now });
    }
  };
  const order = (k: string, o: WarOrder): string | null => {
    advance(file, now, sheets);
    return applyOrder(file, k, o, now, ctx);
  };
  return { a: worlds[A], b: worlds[B], c: worlds[C], file, flags, said, pulse, order, ctx, now: () => now, step: (ms: number) => (now += ms) };
}
type Game = ReturnType<typeof game>;

const general = async (w: LocalWorld) => (await w.figures()).find((f) => f.id === 'general')!;

/** Поход A на B: отряд при полководце, режим и вид. */
async function march(g: Game, mode: 'storm' | 'siege' | 'blockade', gait: 'light' | 'normal' | 'train'): Promise<WarRow> {
  await g.pulse();
  expect(await g.a.setGarrison({ ...SQUAD })).toBeNull();
  for (let i = 0; i < 100 && (await general(g.a)).readyAt > g.now(); i++) {
    g.step(5 * 60_000);
    await g.pulse();
  }
  if (gait !== 'normal') expect(await g.a.setGait(gait)).toBeNull();
  expect(await g.a.warMarch(castleIdOf(B), mode === 'storm' ? 'storm' : 'siege', 'plunder', mode === 'blockade')).toBeNull();
  g.step(60_000);
  await g.pulse();
  return g.file.wars[0] as WarRow;
}

/** Отряд похода на карте мира `w` — цель кольца. */
async function target(w: LocalWorld): Promise<ErrandTarget & { kind: 'march' }> {
  const m = (await w.marches()).find((x) => x.id.startsWith('war-'));
  expect(m, 'поход виден на карте').toBeTruthy();
  return { kind: 'march', id: m!.id };
}

/** Меч кольца над отрядом и строка «Перехватить». */
async function sword(w: LocalWorld, goal: ErrandTarget, muster = true) {
  const deeds = await w.errands('general', goal);
  const slot = ringSlots(goal, { general: deeds }, await w.figures(), () => 'в Ратуше', false, muster).find((s) => s.id === 'general')!;
  return { slot, row: deeds.find((d) => d.id === 'intercept') };
}

/** Дойти до минуты `at` пульсами по `stepMs`. */
async function until(g: Game, at: number, stepMs = 20 * 60_000): Promise<void> {
  while (g.now() < at) {
    g.step(Math.min(stepMs, at - g.now()));
    await g.pulse();
  }
}

const CASES = [
  ['storm', 'light'],
  ['storm', 'normal'],
  ['storm', 'train'],
  ['siege', 'normal'],
  ['siege', 'train'],
  ['blockade', 'normal'],
  ['blockade', 'train'],
] as const;

describe('ПЛ-1: перехват похода игрока — каждый вид и режим, на двух мирах с сервером', () => {
  for (const [mode, gait] of CASES) {
    it(`${mode}, ${gait}: меч горит, сервер считает встречу, бой в поле, разбитый поход идёт домой`, async () => {
      const g = game({ [B]: STRONG });
      const war = await march(g, mode, gait);
      expect(war.phase, 'точка внутри области: поход в пути').toBe('march');
      const goal = await target(g.b);
      const { slot, row } = await sword(g.b, goal);
      expect(slot.on, `меч горит: ${slot.why}`).toBe(true);
      expect(row?.walkMs ?? 0, 'окно показывает срок встречи').toBeGreaterThan(0);
      const plan = await g.b.interceptPlan(goal.id);
      expect(plan.at, 'окно показывает точку встречи').not.toBeNull();
      expect(await g.b.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { ...STRONG } })).toBeNull();
      const meet = war.meets?.[0];
      expect(meet, 'перехват лёг в запись войны').toBeTruthy();
      // Точка встречи — та, что видел игрок, и лежит на пути похода раньше прихода.
      expect(Math.abs(meet!.at - (row!.at + row!.walkMs))).toBeLessThan(90_000);
      expect(meet!.at).toBeLessThan(war.arriveAt);
      const there = positionAt(warMoving(war)!, meet!.at);
      expect(Math.hypot(there.x - meet!.spot.x, there.y - meet!.spot.y)).toBeLessThan(1e-6);
      // Нападающему перехват не виден.
      expect(warsOf(g.file, A)[0].meets).toBeUndefined();
      await until(g, meet!.at + 1000);
      const b = war.battles.find((x) => x.site === 'field');
      expect(b, 'бой в поле был').toBeTruthy();
      expect(b!.by).toBe('def');
      expect(b!.genTroops).toEqual(STRONG);
      expect(b!.won, 'сильная дружина разбила поход').toBe(true);
      expect(war.phase === 'back' || war.phase === 'done', 'разбитый поход отходит домой').toBe(true);
      expect(war.end).toBe('beaten');
      expect(war.camp, 'до стен не дошёл').toBeUndefined();
      // Донесение обеим сторонам.
      const rb = (await g.b.reports()).find((r) => r.id === `war-${b!.id}`);
      const ra = (await g.a.reports()).find((r) => r.id === `war-${b!.id}`);
      expect(rb?.title).toMatch(/^Перехват в поле/);
      expect(ra?.title).toMatch(/^Перехват из/);
      expect(rb?.battle, 'ролик боя у защитника').toBeTruthy();
      // Полководец защитника после боя идёт домой.
      await until(g, g.now() + 12 * 3600_000, 30 * 60_000);
      expect((await general(g.b)).atHome, 'полководец вернулся').toBe(true);
    }, 180_000);
  }
});

/** Пакт Манчестера и Ливерпуля (раздел 5): предложение и встречное. */
function pactBC(g: Game): void {
  expect(g.order(B, { op: 'pact', target: castleIdOf(C) })).toBeNull();
  expect(g.order(C, { op: 'pact', target: castleIdOf(B) })).toBeNull();
}

describe('ПЛ-1: честные отказы', () => {
  it('без бойцов в городе меч погашен словами «нет отряда»; занят перехватом — «уже идёт на перехват»', async () => {
    const g = game({ [B]: {} });
    await march(g, 'storm', 'normal');
    const goal = await target(g.b);
    const empty = await sword(g.b, goal, false);
    expect(empty.slot.on).toBe(false);
    expect(empty.slot.why).toMatch(/нет отряда|Дай ему бойцов|отряда/);
  }, 120_000);

  it('второй перехват тем же полководцем — отказ сервера и мира одними словами', async () => {
    const g = game({ [B]: STRONG });
    await march(g, 'storm', 'normal');
    const goal = await target(g.b);
    expect(await g.b.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { spearman: 100 } })).toBeNull();
    const again = await sword(g.b, goal);
    expect(again.slot.on).toBe(false);
    expect(again.slot.why).toBe(GENERAL_INTERCEPTS);
    const w = g.file.wars[0];
    const m = w.meets![0];
    expect(g.order(B, { op: 'intercept', id: w.id, army: m.army, from: m.from })).toBe(GENERAL_INTERCEPTS);
  }, 120_000);

  it('союзник далеко, а отряд у самых стен — «не догнать», с честным сроком', async () => {
    const g = game({ [C]: STRONG });
    pactBC(g);
    const war = await march(g, 'storm', 'normal');
    await until(g, war.arriveAt - 60_000, 60 * 60_000);
    expect(war.phase, 'точка внутри области: поход ещё в пути').toBe('march');
    const { slot } = await sword(g.c, await target(g.c));
    expect(slot.on).toBe(false);
    expect(slot.why).toMatch(/^Не догнать: отряд дойдёт раньше: им идти/);
    void MEET_FAR;
  }, 120_000);
});

describe('ПЛ-1: соседние случаи', () => {
  it('поход встал лагерем — у его отряда меч ведёт к удару по лагерю, а не к перехвату', async () => {
    setPhaseDie(() => 7);
    const g = game({ [B]: STRONG });
    const war = await march(g, 'siege', 'normal');
    await until(g, war.arriveAt + 1000, 60 * 60_000);
    expect(war.phase, 'точка внутри области: лагерь встал').toBe('camp');
    const goal = await target(g.b);
    const deeds = await g.b.errands('general', goal);
    expect(deeds.map((d) => d.id)).toContain('strike');
    expect(deeds.map((d) => d.id)).not.toContain('intercept');
    // Полководец дома — из города лагерь бьют вылазкой: честный отказ, а не «дел нет».
    expect(deeds.find((d) => d.id === 'strike')?.reason).toMatch(/вылазк/);
  }, 120_000);

  it('перехватчик отбит — поход идёт дальше с потерями и бьёт у стен; полководец перехвата дома', async () => {
    const g = game({ [B]: { spearman: 300 } });
    const war = await march(g, 'storm', 'normal');
    const goal = await target(g.b);
    expect(await g.b.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { spearman: 4 } })).toBeNull();
    const meet = war.meets![0];
    await until(g, meet.at + 1000);
    const b = war.battles.find((x) => x.site === 'field')!;
    expect(b.won, 'горстка не остановила поход').toBe(false);
    expect(war.phase, 'поход идёт дальше').toBe('march');
    await until(g, war.arriveAt + 1000);
    expect(war.battles.some((x) => x.site === 'wall'), 'поход дошёл и бил у стен').toBe(true);
  }, 120_000);

  it('смена режима похода после приказа — встреча посчитана заново, полководец идёт к новой точке', async () => {
    const g = game({ [B]: STRONG });
    const war = await march(g, 'storm', 'normal');
    const goal = await target(g.b);
    expect(await g.b.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { ...STRONG } })).toBeNull();
    const before = { ...war.meets![0] };
    g.step(10 * 60_000);
    await g.pulse();
    expect(await g.a.setGait('light')).toBeNull();
    await g.pulse();
    const after = war.meets?.[0];
    expect(after, 'перехват не сорвался').toBeTruthy();
    expect(after!.at, 'налегке отряд быстрее — встреча раньше').not.toBe(before.at);
    const f = (await g.b.figures()).find((x) => x.id === 'general')!;
    expect(f.arriveAt).toBe(after!.at);
    await until(g, after!.at + 1000);
    expect(war.battles.some((x) => x.site === 'field')).toBe(true);
  }, 120_000);

  it('отозванный поход — перехват идёт за ним домой или срывается честным донесением', async () => {
    const g = game({ [B]: STRONG });
    const war = await march(g, 'storm', 'train');
    const goal = await target(g.b);
    expect(await g.b.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { ...STRONG } })).toBeNull();
    g.step(20 * 60_000);
    await g.pulse();
    expect(g.order(A, { op: 'recall', id: war.id })).toBeNull();
    await g.pulse();
    expect(war.phase).toBe('back');
    // Отозван в двадцати минутах от дома: домой он дойдёт раньше, чем полководец Манчестера его догонит, — перехват срывается.
    const met = Boolean(war.meets?.length);
    const missed = Boolean(war.missed?.length);
    expect(missed, 'встреча пересчитана сервером: не догнать — сорвалась').toBe(true);
    await until(g, (war.backAt ?? g.now()) + 1000);
    if (missed) {
      expect(g.said[B].filter((e) => e.text.startsWith('Перехват сорвался')).length, 'донесение о срыве — один раз').toBe(1);
      expect((await general(g.b)).atHome || (await general(g.b)).place !== 'vacant').toBe(true);
    }
    if (met) expect(war.battles.some((x) => x.site === 'field')).toBe(true);
  }, 120_000);

  it('союзник перехватывает обратный путь и отбивает добычу; потери — с его войска; два перехвата одного похода', async () => {
    const g = game({ [B]: { spearman: 4 }, [C]: STRONG });
    pactBC(g);
    const war = await march(g, 'storm', 'train');
    // Защитник тоже выходит навстречу — горсткой: два перехвата одного похода, бой за боем по минутам.
    const goalB = await target(g.b);
    expect(await g.b.errand({ agent: 'general', target: goalB, deed: 'intercept', troops: { spearman: 4 } })).toBeNull();
    await until(g, war.arriveAt + 1000);
    expect(war.battles.filter((x) => x.site === 'field').length, 'горстка защитника дралась в поле').toBe(1);
    expect(war.fall, 'точка внутри области: город взят штурмом').toBeTruthy();
    expect(war.phase).toBe('back');
    await g.pulse();
    const goal = await target(g.c);
    const { slot } = await sword(g.c, goal);
    expect(slot.on, `меч союзника горит: ${slot.why}`).toBe(true);
    expect(await g.c.setGait('light')).toBeNull();
    expect(await g.c.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { ...STRONG } })).toBeNull();
    const meet = war.meets![0];
    expect(meet.ally).toBe(true);
    await until(g, meet.at + 1000);
    const fought = war.battles.filter((x) => x.site === 'field');
    const b = fought[fought.length - 1];
    expect(b.ally).toBe(castleIdOf(C));
    expect(b.won).toBe(true);
    expect(b.regain, 'добычу отбили').toBeTruthy();
    const rc = (await g.c.reports()).find((r) => r.id === `war-${b.id}`);
    expect(rc?.title).toMatch(/^Перехват в поле/);
    // У города бой союзника — его, а не выручка у лагеря: «осада снята» тут неправда; нападающему — кто перехватил.
    const rb = (await g.b.reports()).find((r) => r.id === `war-${b.id}`);
    expect(rb?.title).toBe('Перехват в поле: «Ливерпуль» разбил отряд НиСы');
    expect(rb?.text).toMatch(/Наш гарнизон в бой не выходил/);
    const ra = (await g.a.reports()).find((r) => r.id === `war-${b.id}`);
    expect(ra?.title).toBe('Перехват из Ливерпуль: отряд разбит в поле');
    // Добыча: союзнику — на склад, походу — убыль, по разу; сервер знает её добром без дела у союзника.
    await g.pulse();
    await g.pulse();
    const got = g.said[C].filter((e) => e.id === warRegainId(b.id));
    const gave = g.said[A].filter((e) => e.id === warRegainId(b.id));
    expect(got.length).toBe(1);
    expect(gave.length).toBe(1);
    for (const [k, v] of Object.entries(b.regain!)) {
      expect(got[0].resources[k]).toBe(v);
      expect(gave[0].resources[k]).toBe(-(v ?? 0));
    }
    const seen = g.c.warSheet()!.seen ?? [];
    expect(windfallKnown(g.file, C, seen, []).known.items, 'добро без дела у союзника — отбитая добыча').toBe(1);
    // Потери в поле — с войска союзника (книга войска), а не с города, чей гарнизон в этом бою не выходил.
    expect(warLosses(g.file, C).some((l) => l.id === b.id)).toBe(true);
    expect(warLosses(g.file, B).find((l) => l.id === b.id)?.lost).toEqual({});
    // Два перехвата одного похода: бои по минутам встречи, каждый — своему перехватчику.
    const fields = war.battles.filter((x) => x.site === 'field');
    expect(fields.map((x) => x.ally ?? 'def')).toEqual(['def', castleIdOf(C)]);
    void warSpotAt;
    void troopTotal;
  }, 180_000);
});

describe('ПЛ-1: сервер не верит клиенту', () => {
  /** Честный приказ перехвата Манчестера, как его шлёт мир: встреча — из окна. */
  async function honest(g: Game) {
    const war = await march(g, 'storm', 'normal');
    const goal = await target(g.b);
    const plan = await g.b.interceptPlan(goal.id);
    const f = await general(g.b);
    const order = {
      op: 'intercept' as const,
      id: war.id,
      from: { x: f.at.x, y: f.at.y },
      meet: { x: plan.at!.x, y: plan.at!.y, at: g.now() + Math.round(plan.seconds * 1000) },
      shown: g.now(),
      army: { troops: { spearman: 100 }, resolve: 0, pips: {}, energy: { value: 100, at: g.now(), mode: 'hold' as const } },
    };
    return { war, order };
  }

  it('честный приказ принят; встречу ставит сервер, а не клиент', async () => {
    const g = game({ [B]: STRONG });
    const { war, order } = await honest(g);
    expect(g.order(B, order)).toBeNull();
    expect(g.flags).toEqual([]);
    expect(Math.abs(war.meets![0].at - order.meet.at)).toBeLessThan(90_000);
  }, 120_000);

  it('не тот состав — больше, чем есть, или сверх книги войска сервера: отказ, сверх книги — и флаг', async () => {
    const g = game({ [B]: STRONG });
    const { order } = await honest(g);
    expect(g.order(B, { ...order, army: { ...order.army, troops: { spearman: 5000 } } })).toBe('Столько бойцов в отряде нет.');
    // Слепок называет 200 копейщиков, книга сервера подтверждает 50: приказ на 100 — подделка состава.
    const s = g.ctx.sheet(B)!;
    s.book = { since: 0, at: s.at, bodies: { ...STRONG, spearman: 50 }, credit: {}, grant: 0, lost: [] } as unknown as typeof s.book;
    expect(g.order(B, order)).toMatch(/К войне готовы в отряде только 50 из 100/);
    expect(g.flags.length).toBe(1);
  }, 120_000);

  it('невозможная точка — не на пути похода: отказ и флаг', async () => {
    const g = game({ [B]: STRONG });
    const { order } = await honest(g);
    const err = g.order(B, { ...order, meet: { ...order.meet, x: order.meet.x + 30, y: order.meet.y - 30 } });
    expect(err).toBe('Такой встречи быть не может. Обнови игру и попробуй снова.');
    expect(g.flags.length).toBe(1);
    expect(g.file.wars[0].meets).toBeUndefined();
  }, 120_000);

  it('невозможный срок — раньше, чем дойти самой быстрой землёй налегке: отказ и флаг', async () => {
    const g = game({ [B]: STRONG });
    const { order } = await honest(g);
    const err = g.order(B, { ...order, meet: { ...order.meet, at: g.now() + 1000 } });
    expect(err).toBe('Такой встречи быть не может. Обнови игру и попробуй снова.');
    expect(g.flags.length).toBe(1);
  }, 120_000);

  it('устаревшая встреча (поход сменил путь после меню) — отказ без флага', async () => {
    const g = game({ [B]: STRONG });
    const { order } = await honest(g);
    expect(await g.a.setGait('light')).toBeNull();
    const err = g.order(B, order);
    expect(err).toBe(MEET_STALE);
    expect(g.flags).toEqual([]);
  }, 120_000);

  it('место выхода дальше, чем полководец мог уйти со слепка: отказ и флаг', async () => {
    const g = game({ [B]: STRONG });
    const { order } = await honest(g);
    const err = g.order(B, { ...order, from: { x: order.from.x + 40, y: order.from.y }, meet: undefined });
    expect(err).toMatch(/не мог оказаться там так быстро/);
    expect(g.flags.length).toBe(1);
  }, 120_000);

  it('без энергии, чужой поход без пакта, свой поход, лагерь — отказы словами', async () => {
    const g = game({ [B]: STRONG, [C]: STRONG });
    const { war, order } = await honest(g);
    expect(g.order(B, { ...order, army: { ...order.army, energy: { value: 0, at: g.now(), mode: 'hold' } } })).toMatch(/сил|энерги/i);
    expect(g.order(C, { ...order, meet: undefined })).toMatch(/союзника по пакту/);
    expect(g.order(A, { ...order, meet: undefined })).toBe('Это наш отряд.');
    war.phase = 'camp';
    expect(g.order(B, { ...order, meet: undefined })).toBe(MEET_CAMP);
  }, 120_000);

  it('встреча в ту же минуту, что приход: сперва бой в поле, у стены — только если поход устоял', async () => {
    const g = game({ [B]: STRONG });
    const { war, order } = await honest(g);
    expect(g.order(B, { ...order, army: { ...order.army, troops: { ...STRONG } } })).toBeNull();
    const meet = war.meets![0];
    // Гонка: отряд приходит ровно в минуту встречи (`pursuit.intercept` пускает встречу и в минуту прихода).
    war.arriveAt = meet.at;
    g.step(meet.at - g.now() + 1);
    advance(g.file, g.now(), new Map(KEYS.map((k) => [k, g.ctx.sheet(k)])));
    expect(war.battles[0]?.site, 'первым — бой в поле').toBe('field');
    expect(war.battles[0].won).toBe(true);
    expect(war.battles.some((b) => b.site === 'wall'), 'разбитый в поле до стены не дошёл').toBe(false);
  }, 120_000);
});

describe('ПЛ-1: механика верна и без временной скорости пути', () => {
  it('TEST_TRAVEL_SPEED = 1: встреча сервера и окна совпадают, бой в поле до прихода', async () => {
    travel.k = 1;
    const g = game({ [B]: STRONG });
    const war = await march(g, 'siege', 'train');
    const span = war.arriveAt - war.sentAt;
    travel.k = 3;
    const fast = warWalkMs(war.from, war.to, 'train');
    travel.k = 1;
    expect(span / fast, 'точка внутри области: путь втрое длиннее, чем при ×3').toBeCloseTo(3, 1);
    const goal = await target(g.b);
    const { slot, row } = await sword(g.b, goal);
    expect(slot.on, `меч горит: ${slot.why}`).toBe(true);
    expect(await g.b.errand({ agent: 'general', target: goal, deed: 'intercept', troops: { ...STRONG } })).toBeNull();
    const meet = war.meets![0];
    expect(Math.abs(meet.at - (row!.at + row!.walkMs))).toBeLessThan(90_000);
    await until(g, meet.at + 1000, 60 * 60_000);
    expect(war.battles[0]?.site).toBe('field');
    expect(war.camp).toBeUndefined();
  }, 180_000);
});
