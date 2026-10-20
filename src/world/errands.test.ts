// Дела агентов у цели (Р-4, docs/AGENTS.md, раздел 16): свободной ходьбы нет, агент идёт к цели, делает дело и сам
// возвращается домой. Проверка — на настоящем мире: приказ идёт дверью `errand`, время двигается пульсами, и после каждого
// дела агент оказывается у своих ворот, а дело оставило след (донесение, сведения, наблюдение).
//
// Граница области: агент в строю и дома в минуту приказа, цель в регионе игрока и жива, энергия не мерка (дорога её не
// берёт, как в `chase.test.ts`). Каждая точка проверяется утверждением: дело есть в меню и доступно — иначе тест падает
// причиной из меню, а не молча проходит мимо.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import { shieldVillagers } from './lairs';
import { distance } from './geo';
import { ERRANDS } from './data/errands';
import type { TroopStack } from '@/game/battle/kinds';
import type { ErrandId, ErrandTarget, FigureId, FigureView, PlayerCastle, PlayerProfile } from './types';
import type { WarOrder } from '../../netlify/lib/contract';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const START = 1_700_000_000_000 + 14 * 3_600_000;
const HOUR = 3_600_000;
const HOST: TroopStack = { legionary: 60, spearman: 50, archer: 30 };

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

interface Bench {
  world: LocalWorld;
  p: PlayerProfile;
  clock: { now: number };
  sent: WarOrder[];
  fig: (id: FigureId) => Promise<FigureView>;
  pulse: () => Promise<string[]>;
  home: { x: number; y: number };
  rival: PlayerCastle;
}

async function bench(): Promise<Bench> {
  const clock = { now: START };
  const sent: WarOrder[] = [];
  let rival: PlayerCastle = { id: 'castle-x', x: 0, y: 0, name: 'Сосед', city: 'Соседград', power: 500, pop: 100, seenAt: START };
  const world = new LocalWorld({
    seed: 7,
    now: () => clock.now,
    storage: null,
    castles: () => [rival],
    wars: () => [],
    warsKnown: () => true,
    warOrder: async (o) => {
      sent.push(o);
      return null;
    },
  });
  const info = await world.info();
  // Замок соседа — в нескольких клетках от дома, на суше своего региона: туда ходит дипломат.
  rival = { ...rival, x: info.home.x + 4, y: info.home.y + 3 };
  const p = profile();
  const effects: string[] = [];
  const pulse = async (): Promise<string[]> => {
    const r = await world.sync(p);
    for (const e of r.effects) effects.push(e.text);
    return effects;
  };
  await pulse();
  const fig = async (id: FigureId): Promise<FigureView> => (await world.figures()).find((f) => f.id === id)!;
  expect(await world.setGarrison({ ...HOST })).toBeNull();
  clock.now = Math.max(clock.now, (await fig('general')).readyAt) + 1;
  await pulse();
  return { world, p, clock, sent, fig, pulse, home: info.home, rival };
}

/**
 * Живое логово в регионе, `n`-е от дома. Держав в мире нет (`gen.ts`: «Племён нет»), и дворов с державой — тоже: у логова
 * дипломату говорить не с кем, лазутчику — не против кого бунтовать.
 */
function placeNear(b: Bench, n = 0): GenSettlement {
  const w = b.world as unknown as { gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean; inRealm(c: { x: number; y: number }): boolean };
  const list = w.gen.settlements
    .filter((s) => w.alive(s, b.clock.now) && w.inRealm(s))
    .sort((a, c) => distance(a, b.home) - distance(c, b.home));
  expect(list.length, 'в регионе есть логова').toBeGreaterThan(n);
  return list[n];
}

/**
 * Дело туда и обратно: в меню и доступно, приказ принят, агент идёт к цели (или делает его на месте), пульсами — до
 * своих ворот. `after` — что сделать, пока агент у цели (снять осаду, позвать домой наблюдателя).
 */
async function roundTrip(b: Bench, agent: FigureId, target: ErrandTarget, deed: ErrandId, goal: { x: number; y: number }, after?: (f: FigureView) => Promise<void>) {
  const menu = await b.world.errands(agent, target);
  const o = menu.find((x) => x.id === deed);
  expect(o, `${agent} · ${deed}: дело есть в меню`).toBeDefined();
  expect(o!.reason, `${agent} · ${deed}: дело доступно`).toBeNull();
  expect(o!.backMs, `${agent} · ${deed}: дорога назад названа до приказа`).toBeGreaterThan(0);
  const before = (await b.world.reports()).length;
  expect(await b.world.errand({ agent, target, deed, shownAt: o!.at })).toBeNull();
  let f = await b.fig(agent);
  expect(f.phase, `${agent} · ${deed}: пошёл`).toBe('moving');
  expect(distance(f.to, goal), `${agent} · ${deed}: идёт к цели, а не куда-то`).toBeLessThan(3);
  let reached = false;
  let afterDone = false;
  for (let i = 0; i < 16; i++) {
    f = await b.fig(agent);
    if (f.phase === 'home' && reached) break;
    if (f.phase !== 'moving' && !f.atHome) {
      reached = true;
      if (after && !afterDone) {
        afterDone = true;
        await after(f);
      }
    }
    f = await b.fig(agent);
    const next = f.phase === 'moving' ? f.arriveAt : Math.max(f.busyUntil, f.downUntil, b.clock.now + HOUR);
    if (f.phase === 'moving' && distance(f.to, b.home) > 1) reached = reached || false;
    b.clock.now = Math.max(b.clock.now + 1, next + 1);
    await b.pulse();
    const g = await b.fig(agent);
    if (g.phase !== 'moving' && !g.atHome) reached = true;
    if (g.phase === 'moving' && distance(g.to, b.home) < 1 && distance(g.from, goal) < 3) reached = true;
  }
  f = await b.fig(agent);
  expect(reached, `${agent} · ${deed}: дошёл до цели`).toBe(true);
  expect(f.atHome || f.place === 'city', `${agent} · ${deed}: вернулся домой сам`).toBe(true);
  return { reports: (await b.world.reports()).slice(0, (await b.world.reports()).length - before), f };
}

describe('дело туда и обратно — у каждого агента', () => {
  it('полководец: ударить и осадить логово, перехватить набег — каждый раз домой сам', async () => {
    const b = await bench();
    const lair = placeNear(b);
    const at = { kind: 'place', id: lair.id } as const;
    const storm = await roundTrip(b, 'general', at, 'storm', lair);
    expect(storm.reports.some((r) => r.target?.id === lair.id), 'донесение о бое').toBe(true);

    // Второе логово: взятое ударом сутки не осаждают (`SIEGE_IMMUNE`).
    const camp = placeNear(b, 1);
    await roundTrip(b, 'general', { kind: 'place', id: camp.id }, 'siege', camp, async (f) => {
      expect(f.besieging, 'встал лагерем').toBe(camp.id);
      expect(await b.world.retreat()).toBeNull();
    });
  }, 120_000);

  it('перехват набега на пути — бой в поле, донесение и домой', async () => {
    const b = await bench();
    const raid: StoredMarch = {
      id: 'raid-r4',
      seed: 5,
      mission: 'raid',
      units: { warrior: 5 },
      own: false,
      fromId: 'lair-r4',
      targetId: 'home',
      from: { x: b.home.x + 30, y: b.home.y },
      to: { x: b.home.x, y: b.home.y },
      fromName: 'Логово',
      toName: 'дом',
      departAt: b.clock.now,
      arriveAt: b.clock.now + 6 * HOUR,
      phase: 'out',
      power: 15,
      loot: null,
    };
    (b.world as unknown as { save: WorldSave }).save.marches.push(raid);
    const menu = await b.world.errands('general', { kind: 'march', id: raid.id });
    expect(menu.map((o) => o.id)).toEqual(['intercept']);
    expect(await b.world.errand({ agent: 'general', target: { kind: 'march', id: raid.id }, deed: 'intercept' })).toBeNull();
    const meetAt = (await b.fig('general')).arriveAt;
    expect(meetAt, 'встреча раньше прихода набега').toBeLessThan(raid.arriveAt);
    b.clock.now = meetAt + 1;
    await b.pulse();
    const rep = await b.world.reports();
    expect(rep[0].title, 'донесение о бое в поле').toMatch(/^Перехват/);
    const g = await b.fig('general');
    expect(g.phase, 'после боя — домой').toBe('moving');
    expect(distance(g.to, b.home)).toBeLessThan(1);
    b.clock.now = g.arriveAt + 1;
    await b.pulse();
    expect((await b.fig('general')).atHome, 'дома').toBe(true);
  }, 120_000);

  it('разведчик: разведать логово и следить за войском — сведения, донесение и домой', async () => {
    const b = await bench();
    const lair = placeNear(b);
    await roundTrip(b, 'scout', { kind: 'place', id: lair.id }, 'recon', lair);
    expect(await b.world.intel(lair.id), 'сведения о гарнизоне').not.toBeNull();

    const raid: StoredMarch = {
      id: 'raid-shadow',
      seed: 6,
      mission: 'raid',
      units: { warrior: 7 },
      own: false,
      fromId: 'lair-s',
      targetId: 'home',
      from: { x: b.home.x + 25, y: b.home.y },
      to: { x: b.home.x, y: b.home.y },
      fromName: 'Падь',
      toName: 'дом',
      departAt: b.clock.now,
      arriveAt: b.clock.now + 12 * HOUR,
      phase: 'out',
      power: 20,
      loot: null,
    };
    (b.world as unknown as { save: WorldSave }).save.marches.push(raid);
    const meet = (await b.world.errands('scout', { kind: 'march', id: raid.id })).find((o) => o.id === 'shadow')!;
    expect(meet.reason).toBeNull();
    expect(await b.world.errand({ agent: 'scout', target: { kind: 'march', id: raid.id }, deed: 'shadow' })).toBeNull();
    const s = await b.fig('scout');
    b.clock.now = s.arriveAt + 1;
    await b.pulse();
    expect((await b.world.reports())[0].title, 'отряд сочтён').toBe('Отряд сочтён: Падь');
    const back = await b.fig('scout');
    expect(distance(back.to, b.home), 'домой').toBeLessThan(1);
  }, 120_000);

  it('дипломат: у логова дел нет; союз и разрыв с соседом-игроком — и домой', async () => {
    const b = await bench();
    const lair = placeNear(b);
    expect(await b.world.errands('diplomat', { kind: 'place', id: lair.id }), 'у логова говорить не с кем').toEqual([]);

    const rival = { kind: 'place', id: b.rival.id } as const;
    const pact = await roundTrip(b, 'diplomat', rival, 'pact', b.rival);
    expect(b.sent.filter((o) => o.op === 'pact'), 'предложение ушло серверу войны один раз').toHaveLength(1);
    expect(pact.reports.some((r) => r.title.startsWith('Союз')), 'донесение').toBe(true);
    await roundTrip(b, 'diplomat', rival, 'unpact', b.rival);
    expect(b.sent.map((o) => o.op)).toEqual(['pact', 'unpact']);
  }, 120_000);

  it('лазутчик: выведать, наблюдать — и домой; бунта в логове нет', async () => {
    const b = await bench();
    const court = placeNear(b);
    const place = { kind: 'place', id: court.id } as const;
    expect((await b.world.errands('spy', place)).map((o) => o.id), 'бунт — против державы').not.toContain('revolt');
    const probe = await roundTrip(b, 'spy', place, 'probe', court);
    expect(probe.reports.length, 'донесение о деле').toBeGreaterThan(0);
    let watched = false;
    await roundTrip(b, 'spy', place, 'watch', court, async (f) => {
      watched = f.watching;
      // Наблюдение держится, пока не позовут: «Домой».
      expect(await b.world.errand({ agent: 'spy', target: { kind: 'home' }, deed: 'home' })).toBeNull();
    });
    expect(watched, 'залёг и смотрел').toBe(true);
  }, 120_000);
});

describe('свободной ходьбы нет', () => {
  it('у мира нет приказа «идти в клетку», и интерфейс его не зовёт', () => {
    const api = readFileSync(join(__dirname, 'api.ts'), 'utf8');
    expect(api).not.toMatch(/\bmoveFigure\(/);
    expect(api).not.toMatch(/\bleadPlan\(/);
    for (const file of ['store.ts', '../ui/map/WorldMap.tsx', '../ui/map/ActionMenu.tsx', '../ui/next/WorldNew.tsx', '../ui/next/MarchesNew.tsx']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src, file).not.toMatch(/\.moveFigure\(|\.leadPlan\(/);
    }
  });

  it('цель — только город, двор, замок или отряд; пустой клетки среди целей нет', async () => {
    const b = await bench();
    const cell = { kind: 'cell', x: b.home.x + 3, y: b.home.y } as unknown as ErrandTarget;
    expect(await b.world.errands('scout', cell)).toEqual([]);
    expect(await b.world.errand({ agent: 'scout', target: cell, deed: 'recon' })).toBe('Цели на месте нет.');
    expect((await b.fig('scout')).atHome).toBe(true);
  });

  it('у каждого агента есть «домой», и каждое дело таблицы принадлежит одному агенту', () => {
    for (const id of ['general', 'scout', 'diplomat', 'spy'] as const) {
      expect(ERRANDS.some((e) => e.agent === id && e.id === 'home' && e.on.includes('home')), id).toBe(true);
    }
    const pairs = ERRANDS.map((e) => `${e.agent}:${e.id}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('подделка приказа — отказ', () => {
  it('чужое дело, не та цель, несуществующая участь — отказ словами, никто не вышел', async () => {
    const b = await bench();
    const lair = placeNear(b);
    const at = { kind: 'place', id: lair.id } as const;
    expect(await b.world.errand({ agent: 'scout', target: at, deed: 'storm' })).toBe('Такого дела у него нет.');
    expect(await b.world.errand({ agent: 'diplomat', target: { kind: 'home' }, deed: 'gift' })).toBe('Это дело не к этой цели.');
    expect(await b.world.errand({ agent: 'general', target: at, deed: 'storm', fate: 'raze' as never })).toBe('Такой участи нет.');
    expect(await b.world.errand({ agent: 'spy', target: at, deed: 'theft' })).toBe('Это дело не к этой цели.');
    for (const id of ['general', 'scout', 'diplomat', 'spy'] as const) expect((await b.fig(id)).atHome, id).toBe(true);
  });
});
