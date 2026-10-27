// Кольцо значков над целью и окно войска полководца (К-2, docs/AGENTS.md, раздел 18).
//
// Дела — на настоящем мире (`LocalWorld.errands`, та же дверь, что меню и приказ), кольцо и меню рисуются в строку с
// подменёнными сторами — тем же приёмом, что меню дел (`feedback.test.ts`).
//
// Граница области: человек жив, в строю и дома в минуту касания; цель в регионе игрока и жива (логово, город соседа,
// отряд в пути, свой город); энергия не мерка — дорога её не берёт (`ENERGY_ROAD`, как в `errands.test.ts`). Каждая точка
// проверяется утверждением: у цели есть хоть одно доступное дело — иначе тест падает словами, а не проходит мимо.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from '@/world/local/LocalWorld';
import type { StoredMarch, WorldSave } from '@/world/local/state';
import type { GenSettlement } from '@/world/gen';
import { shieldVillagers } from '@/world/lairs';
import { distance } from '@/world/geo';
import { createInitialState } from '@/game/state';
import { hireWhere } from '@/game/sim/hire';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { ErrandOption, ErrandTarget, FigureId, FigureView, MarchView, PlayerCastle, PlayerProfile } from '@/world/types';
import type { RingState } from '@/world/store';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const { stores, fake, tips } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
  tips: [] as { title: string; body?: string }[],
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
vi.mock('@/world/store', async (orig) => {
  const real = await orig<{ useWorld: object }>();
  return { ...real, useWorld: fake(real.useWorld, () => stores.world) };
});
vi.mock('@/ui/map/twslot', async (orig) => ({ ...(await orig<object>()), reachable: () => true }));
vi.mock('@/ui/next/tip', async (orig) => ({ ...(await orig<object>()), tipAt: (_el: unknown, t: { title: string; body?: string }) => tips.push(t) }));

import { RING_ORDER, agentState, emptyRetinue, musterable, ringSlots } from './ring';
import { RingLayer, ringTap } from './RingLayer';
import { ActionMenu } from './ActionMenu';
import { ArmySend } from './ArmySend';
import { departWith } from '@/ui/parts/Muster';

const START = 1_700_000_000_000 + 14 * 3_600_000;
const HOUR = 3_600_000;
const HOST: TroopStack = { legionary: 60, spearman: 50, archer: 30 };
const AGENTS: FigureId[] = ['diplomat', 'general', 'scout', 'spy'];
const s = createInitialState(7);
const hire = (a: FigureId): string => hireWhere(s, a);

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 40000, wood: 40000, stone: 40000, hides: 40000, charcoal: 40000, copper: 40000, iron: 40000 },
  stash: 0,
  gold: 40000,
});

async function bench() {
  const clock = { now: START };
  let rival: PlayerCastle = { id: 'castle-x', x: 0, y: 0, name: 'Сосед', city: 'Соседград', power: 500, pop: 100, seenAt: START };
  const world = new LocalWorld({
    seed: 7,
    now: () => clock.now,
    storage: null,
    castles: () => [rival],
    wars: () => [],
    warsKnown: () => true,
    warOrder: async () => null,
  });
  const info = await world.info();
  rival = { ...rival, x: info.home.x + 4, y: info.home.y + 3 };
  const p = profile();
  const pulse = async (): Promise<void> => void (await world.sync(p));
  await pulse();
  const fig = async (id: FigureId): Promise<FigureView> => (await world.figures()).find((f) => f.id === id)!;
  const w = world as unknown as { gen: { settlements: GenSettlement[] }; alive(x: GenSettlement, now: number): boolean; inRealm(c: { x: number; y: number }): boolean; save: WorldSave };
  const lair = w.gen.settlements.filter((x) => w.alive(x, clock.now) && w.inRealm(x)).sort((a, c) => distance(a, info.home) - distance(c, info.home))[0];
  expect(lair, 'в регионе есть логово').toBeDefined();
  const raid: StoredMarch = {
    id: 'raid-k2',
    seed: 5,
    mission: 'raid',
    units: { warrior: 5 },
    own: false,
    fromId: lair.id,
    targetId: 'home',
    from: { x: info.home.x + 30, y: info.home.y },
    to: { x: info.home.x, y: info.home.y },
    fromName: 'Логово',
    toName: 'дом',
    departAt: clock.now,
    arriveAt: clock.now + 6 * HOUR,
    phase: 'out',
    power: 15,
    loot: null,
  };
  w.save.marches.push(raid);
  // Вид отряда для касания: кольцу и меню нужен только он сам (кого догонять), числа дел — у мира.
  const march = { id: raid.id, fromName: raid.fromName, toName: raid.toName, arriveAt: raid.arriveAt } as MarchView;
  // Четыре вида цели кольца: логово, город соседа, отряд в пути, свой город — последним: у своего города дело есть,
  // когда человек не дома (`away`).
  const targets: { kind: string; goal: ErrandTarget; cell: { x: number; y: number }; rival: boolean }[] = [
    { kind: 'логово', goal: { kind: 'place', id: lair.id }, cell: lair, rival: false },
    { kind: 'город соседа', goal: { kind: 'place', id: rival.id }, cell: rival, rival: true },
    { kind: 'отряд в пути', goal: { kind: 'march', id: raid.id }, cell: { x: raid.from.x, y: raid.from.y }, rival: false },
    { kind: 'свой город', goal: { kind: 'home' }, cell: info.home, rival: false },
  ];
  /** Перед своим городом — разведчик уходит к логову: дома людям дел нет, кроме «домой» вне дома. */
  const away = async (): Promise<void> => {
    expect(await world.errand({ agent: 'scout', target: { kind: 'place', id: lair.id }, deed: 'recon' })).toBeNull();
    expect((await fig('scout')).phase, 'область: разведчик не дома').toBe('moving');
  };
  return { world, clock, fig, pulse, home: info.home, lair, rival, march, targets, away };
}

type Bench = Awaited<ReturnType<typeof bench>>;

async function deedsAt(b: Bench, goal: ErrandTarget): Promise<Record<FigureId, ErrandOption[]>> {
  const out = {} as Record<FigureId, ErrandOption[]>;
  for (const a of AGENTS) out[a] = await b.world.errands(a, goal);
  return out;
}

function ringOf(b: Bench, t: Bench['targets'][number], deeds: Record<FigureId, ErrandOption[]>): RingState {
  return { cell: t.cell, goal: t.goal, name: t.kind, march: t.goal.kind === 'march' ? b.march : null, card: null, deeds, info: false };
}

function renderRing(ring: RingState, figures: FigureView[]): string {
  stores.game = { s };
  stores.world = { ring, figures };
  return renderToStaticMarkup(h(RingLayer, { at: { x: 195, y: 420 }, vp: { w: 390, h: 844 } }));
}

function renderMenu(agent: FigureId, t: Bench['targets'][number], errands: ErrandOption[], figures: FigureView[], march: Bench['march']): string {
  const noop = () => undefined;
  stores.game = { s, showToast: noop, openSiege: noop, openCamp: noop };
  stores.world = {
    menu: { agent, cell: t.cell, target: t.goal.kind === 'place' ? t.goal.id : null, name: t.kind, card: null, march: t.goal.kind === 'march' ? march : null, plan: null, goal: t.goal, errands },
    figures,
    closeMenu: noop,
    errand: noop,
    watch: noop,
    shelter: noop,
  };
  return renderToStaticMarkup(h(ActionMenu));
}

/** Заглушка стора для касания гнезда: кого и куда открыло касание. */
function tapper() {
  const opened: { agent: FigureId; how: 'menu' | 'chase' }[] = [];
  let info = false;
  let closed = false;
  const g = {
    ringInfo: (on: boolean) => void (info = on),
    closeRing: () => void (closed = true),
    openMenu: async (agent: FigureId) => void opened.push({ agent, how: 'menu' }),
    openChase: async (_m: unknown, agent?: FigureId) => void opened.push({ agent: agent ?? 'general', how: 'chase' }),
  };
  return { g, opened, info: () => info, closed: () => closed };
}

const EL = {} as Element;

describe('кольцо над целью (К-2)', () => {
  it('над каждым видом цели — письмо, меч, глаз и «i»; хоть один человек может дело', async () => {
    const b = await bench();
    for (const t of b.targets) {
      if (t.goal.kind === 'home') await b.away();
      const figures = await b.world.figures();
      const deeds = await deedsAt(b, t.goal);
      const slots = ringSlots(t.goal, deeds, figures, hire, t.rival);
      expect(slots.map((x) => x.id), t.kind).toEqual([...RING_ORDER]);
      expect(slots.map((x) => x.icon), t.kind).toEqual(['ui-mail', 'gear-sword', 'ui-eye', 'ui-info']);
      // Область: у цели есть доступное дело — иначе «горит» нечему.
      expect(slots.some((x) => x.on && x.agent), `${t.kind}: хоть одно доступное дело`).toBe(true);
      const html = renderRing(ringOf(b, t, deeds), figures);
      for (const id of RING_ORDER) expect(html, `${t.kind}: значок ${id}`).toContain(`data-slot="${id}"`);
      expect(html.match(/class="rg-btn/g)?.length, t.kind).toBe(4);
      // «i» — сведения, а не дела: касание открывает короткую карточку.
      const tap = tapper();
      ringTap(slots[3], ringOf(b, t, deeds), EL, tap.g);
      expect(tap.info(), `${t.kind}: «i» — сведения`).toBe(true);
      expect(tap.opened).toEqual([]);
    }
  }, 120_000);

  it('каждое дело каждого человека открывается из кольца: значок → меню этого человека → строка дела', async () => {
    const b = await bench();
    let checked = 0;
    for (const t of b.targets) {
      if (t.goal.kind === 'home') await b.away();
      const figures = await b.world.figures();
      const deeds = await deedsAt(b, t.goal);
      const ring = ringOf(b, t, deeds);
      const slots = ringSlots(t.goal, deeds, figures, hire, t.rival);
      for (const agent of AGENTS) {
        const list = deeds[agent].filter((o) => t.goal.kind === 'home' || o.id !== 'home');
        if (list.length === 0) continue;
        const slot = slots.find((x) => x.agent === agent) ?? slots.find((x) => x.id === 'eye')!;
        // Значок горит, если у человека есть доступное дело — и касание открывает его меню у этой цели.
        if (list.some((o) => o.can)) {
          expect(slot.on, `${t.kind} · ${agent}: значок горит`).toBe(true);
          const tap = tapper();
          ringTap(slot, ring, EL, tap.g);
          expect(tap.closed()).toBe(true);
          expect(tap.opened[0], `${t.kind} · ${agent}: касание открывает дела`).toEqual({ agent: slot.agent, how: t.goal.kind === 'march' ? 'chase' : 'menu' });
        }
        // Глаз ведёт к одному из двоих; второй — вкладкой в шапке того же меню.
        const from = slot.agent ?? agent;
        const head = renderMenu(from, t, deeds[from], figures, b.march);
        expect(head, `${t.kind} · ${agent}: вкладка человека в меню`).toMatch(new RegExp(`role="tab"[^>]*aria-label="[^"]+"`));
        const menu = renderMenu(agent, t, deeds[agent], figures, b.march);
        for (const o of list) {
          expect(menu, `${t.kind} · ${agent} · ${o.id}: строка дела в меню`).toContain(`<b>${o.name}</b>`);
          checked++;
        }
      }
    }
    // Область: дел проверено не меньше, чем видов цели, — у каждого вида свои.
    expect(checked).toBeGreaterThanOrEqual(b.targets.length + 4);
  }, 120_000);

  it('полководец уходит именно с выбранным войском — не с тем, что был при нём', async () => {
    const b = await bench();
    const target: ErrandTarget = { kind: 'place', id: b.lair.id };
    // Отряд при полководце — весь HOST (приказ раскладки старого клиента, ДР-6: принимается как раньше), выбрано меньше и
    // другого состава.
    expect(await b.world.setGarrison({ ...HOST })).toBeNull();
    const held = (await b.fig('general')).troops ?? {};
    expect(troopTotal(held), 'до приказа при полководце весь отряд').toBe(troopTotal(HOST));
    const g0 = await b.fig('general');
    expect(g0.atHome && g0.regroup?.instant, 'область: полководец дома, перевод мгновенный').toBe(true);
    const storm = (await b.world.errands('general', target)).find((o) => o.id === 'storm');
    expect(storm?.reason, 'удар доступен').toBeNull();
    const want: TroopStack = { legionary: 20, archer: 10 };
    expect(await departWith(b.world, want, { agent: 'general', target, deed: 'storm', fate: 'plunder', shownAt: storm!.at })).toBeNull();
    const g = await b.fig('general');
    expect(g.phase, 'пошёл').toBe('moving');
    expect(g.troops, 'ушёл ровно с выбранными').toEqual(want);

    // Окно войска: обе колонки, итог мощи и обороны, участь удара, «Отправить» — одним окном.
    stores.game = { s, showToast: () => undefined, openBuilding: () => undefined, openTownHall: () => undefined };
    stores.world = { figures: await b.world.figures(), marches: [], closeMenu: () => undefined };
    const fates = [{ id: 'plunder' as const, can: true, reason: null, loot: {}, slaves: 0, levels: 0, pop: 0 }];
    const html = renderToStaticMarkup(
      h(ArmySend, { where: 'Логово', goal: target, o: storm!, fates: fates as never, gait: 'normal', free: true, onGait: () => undefined, onBack: () => undefined }),
    );
    for (const want of ['Остаётся', 'Уходит с полководцем', 'Оборона города', 'Мощь', 'Куда', 'Дорога', 'Риск', '>Отправить<', 'class="fate-pick"', 'Режим марша']) {
      expect(html, want).toContain(want);
    }
  }, 120_000);

  it('пустой отряд полководца не гасит меч, пока бойцы в гарнизоне: окно войска даёт их, и он уходит с ними', async () => {
    const b = await bench();
    const target: ErrandTarget = { kind: 'place', id: b.lair.id };
    const g0 = await b.fig('general');
    // Область: полководец дома, перевод мгновенный, отряда при нём нет, в гарнизоне бойцы есть.
    expect(troopTotal(g0.troops ?? {}), 'отряда при полководце нет').toBe(0);
    expect(g0.atHome && g0.regroup?.instant, 'дома, перевод мгновенный').toBe(true);
    const deeds = await deedsAt(b, target);
    const storm = deeds.general.find((o) => o.id === 'storm')!;
    expect(storm.can, 'мир гасит удар пустым отрядом').toBe(false);
    expect(emptyRetinue(storm), storm.reason ?? '').toBe(true);
    const figures = await b.world.figures();
    expect(ringSlots(target, deeds, figures, hire, false, false)[1].on, 'без бойцов в гарнизоне меч погашен').toBe(false);
    expect(ringSlots(target, deeds, figures, hire, false, musterable(g0, HOST))[1].on, 'с бойцами в гарнизоне меч горит').toBe(true);
    const want: TroopStack = { spearman: 30, archer: 12 };
    expect(await departWith(b.world, want, { agent: 'general', target, deed: 'storm', fate: 'plunder', shownAt: storm.at })).toBeNull();
    const g = await b.fig('general');
    expect(g.phase, 'пошёл').toBe('moving');
    expect(g.troops, 'ушёл ровно с выбранными').toEqual(want);
  }, 120_000);

  it('погашенный человек объясняет причину словами мира, касание не открывает дел', async () => {
    const b = await bench();
    const figures = await b.world.figures();
    const lair = b.targets[0];
    const deeds = await deedsAt(b, lair.goal);
    const slots = ringSlots(lair.goal, deeds, figures, hire, false);
    // Дипломату у логова говорить не с кем.
    const dip = slots[0];
    expect(dip.on, 'дипломат у логова погашен').toBe(false);
    expect(dip.why).toMatch(/логовом не договариваются|здесь дел нет|\S/);
    const tap = tapper();
    tips.length = 0;
    ringTap(dip, ringOf(b, lair, deeds), EL, tap.g);
    expect(tap.opened, 'погашенный не открывает дел').toEqual([]);
    expect(tips[0]?.body, 'касание говорит почему').toBe(dip.why);
    expect(renderRing(ringOf(b, lair, deeds), figures), 'причина — и в подписи значка').toContain(`aria-label="Дипломат: ${dip.why}"`);

    // Место пустует — погиб, нанять там-то.
    const dead = figures.map((f) => (f.id === 'general' ? ({ ...f, place: 'vacant', gone: 'died' } as unknown as FigureView) : f));
    const gone = ringSlots(lair.goal, deeds, dead, hire, false)[1];
    expect(gone.on).toBe(false);
    expect(gone.why).toBe(`Полководец погиб. Найми нового ${hire('general')}.`);

    // Все дела человека погашены — причина первая, что назвал мир (занят, в походе, нет сил).
    const tired = deeds.scout.map((o) => ({ ...o, can: false, reason: 'Разведчик выбился из сил: отдых ещё 3 ч.' }));
    expect(agentState('scout', lair.goal, tired, figures.find((f) => f.id === 'scout'), hire('scout'))).toEqual({
      on: false,
      why: 'Разведчик выбился из сил: отдых ещё 3 ч.',
    });
    // Глаз: погашены оба — причина обоих.
    const blind = ringSlots(lair.goal, { ...deeds, scout: tired, spy: deeds.spy.map((o) => ({ ...o, can: false, reason: 'Лазутчик в походе.' })) }, figures, hire, false)[2];
    expect(blind.on).toBe(false);
    expect(blind.why).toContain('Разведчик выбился из сил');
    expect(blind.why).toContain('Лазутчик в походе.');
  }, 120_000);
});
