// Погоня за отрядом, который идёт домой (MAP-9, решение владельца: docs/audit/OWNER-DECISIONS.md, п. 5). Прежде догонять
// можно было только идущих на цель (`chaseTarget` — фаза 'out'), а поворот домой срывал погоню со штрафом. Теперь:
//  · идущего домой догоняют, и победитель забирает его добычу и уведённых наших — добро ложится на склад дверью племени
//    (`addStock`, не выше вместимости), лишнее пропадает, и донесение называет, сколько не поместилось;
//  · цель повернула домой, и догнать её уже нельзя — погоня снимается словами «не догнали» без штрафа к морали.
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { storageCap } from '@/game/derived';
import { tribePulse, type PulseTribe } from './bridge';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { Coord, FigureView, Loot, MarchView, PlayerProfile } from './types';
import { distance } from './geo';

const START = 1_700_000_000_000;
const HOUR = 3_600_000;

type Inner = {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  alive(s: GenSettlement, now: number): boolean;
  turnHome(m: StoredMarch, at: number, loot: Loot | null): void;
  resolveIncoming(m: StoredMarch, at: number): void;
};

const profile = (o: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Т',
  pop: 60,
  defense: 30,
  units: { scout: 4 },
  army: { spearman: 150 },
  stock: { food: 600, wood: 400 },
  stash: 0,
  storeCap: 1000,
  ...o,
});

/** Полководец с отрядом стоит в поле у точки `at`. */
function field(w: Inner, at: Coord, now: number, troops = { spearman: 150 }): void {
  Object.assign(w.save.figures.general, {
    phase: 'field', from: { ...at }, to: { ...at }, departAt: now, arriveAt: now, downUntil: 0, busyUntil: 0, held: false,
    watching: false, energy: undefined, spent: undefined, troops, handover: undefined, chase: undefined,
  });
}

/** Чужой отряд с прорыва идёт от нашего города к своему логову с добычей и уведёнными. */
function homeward(w: Inner, now: number, loot: Loot): StoredMarch {
  const home = w.save.home;
  const lair = w.gen.settlements
    .filter((s) => w.alive(s, now))
    .sort((a, b) => distance(home, b) - distance(home, a))[0];
  const m: StoredMarch = {
    id: 'm-back',
    seed: 11,
    mission: 'raid',
    units: { warrior: 4 },
    own: false,
    fromId: lair.id,
    targetId: 'home',
    from: { ...home },
    to: { x: lair.x, y: lair.y },
    fromName: 'Наш город',
    toName: lair.name,
    departAt: now,
    arriveAt: now + 40 * HOUR,
    phase: 'back',
    power: 4,
    loot,
    held: 3,
    led: 2,
  };
  w.save.marches.push(m);
  return m;
}

/** Точка на пути отряда — доля `k` пути. */
const along = (m: StoredMarch, k: number): Coord => ({ x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k });

describe('погоня за отрядом на пути домой (MAP-9, п. 5)', () => {
  let now = START;
  afterEach(() => {
    now = START;
  });

  it('догоняет идущего домой и забирает добычу и уведённых', async () => {
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const w = world as unknown as Inner;
    await world.sync(profile());
    const m = homeward(w, now, { wood: 200, gold: 40 });
    field(w, along(m, 0.3), now);
    const plan = await world.interceptPlan(m.id);
    expect(plan.can, `точка внутри области: встреча есть (${plan.reason})`).toBe(true);
    expect(plan.targetName).toBe(m.toName);
    expect(await world.intercept(m.id)).toBeNull();
    now = w.save.figures.general.arriveAt + 1;
    const out = await world.sync(profile());
    const eff = out.effects.find((e) => e.id.startsWith('chase') && e.id.endsWith('-eff'));
    expect(eff?.battle).toBe('won');
    expect(eff?.resources).toEqual({ wood: 200, gold: 40 });
    expect(eff?.pop).toBe(5);
    expect(eff?.text).toMatch(/^Добычу отбили/);
    const rep = out.reports.find((r) => r.id.startsWith('chase'));
    expect(rep?.loot).toEqual({ wood: 200, gold: 40 });
    // Уцелевшие идут домой пустыми: ни добычи, ни пленных у их двора.
    const left = w.save.marches.find((x) => x.id === m.id);
    expect(left === undefined || (left.loot === null && !left.held && !left.led)).toBe(true);
  }, 60_000);

  it('отряд дома раньше встречи — погоня снята словами «не догнали», без штрафа к морали', async () => {
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const w = world as unknown as Inner;
    await world.sync(profile());
    // Отряд дошёл до цели и поворачивает домой: обратный путь короткий, полководец далеко.
    const m = homeward(w, now, { wood: 50 });
    Object.assign(m, { phase: 'out', departAt: now - 60_000, arriveAt: now, held: undefined, led: undefined, loot: null });
    field(w, along(m, -0.3), now);
    w.save.figures.general.chase = { marchId: m.id };
    w.turnHome(m, now, null);
    const g = w.save.figures.general;
    expect(g.chase).toBeUndefined();
    const out = await world.sync(profile());
    const lost = out.effects.find((e) => e.id.startsWith('chase-lost'));
    expect(lost?.text).toMatch(/^Не догнали/);
    expect(lost?.morale).toBe(0);
  }, 60_000);

  it('добыча больше вместимости — лишнее пропадает, донесение это называет', async () => {
    const s: GameState = createInitialState();
    const cap = storageCap(s);
    s.resources.wood = cap - 100;
    // Отряд полководца — часть войска партии: иначе учёт мира (`muster`) снимет его с полководца на первом пульсе.
    s.army.spearman = 150;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const w = world as unknown as Inner;
    const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
    let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
    let p = await tribePulse(world, tribe, last);
    last = { marches: p.marches, figures: p.figures };
    expect(w.save.profile?.storeCap, 'слепок деревни везёт вместимость').toBe(cap);
    const m = homeward(w, now, { wood: 400 });
    field(w, along(m, 0.3), now);
    expect(await world.intercept(m.id)).toBeNull();
    now = w.save.figures.general.arriveAt + 1;
    p = await tribePulse(world, tribe, last);
    const rep = p.reports.find((r) => r.id.startsWith('chase'));
    expect(rep?.won, 'точка внутри области: погоня победила').toBe(true);
    expect(rep?.text).toContain('Унесли бы ещё 300, но склад полон.');
    expect(s.resources.wood).toBe(cap);
  }, 60_000);

  it('прорвавшиеся уходят домой с добычей и уведёнными; пленные садятся в плен, когда отряд дошёл', async () => {
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const w = world as unknown as Inner;
    await world.sync(profile({ army: { spearman: 30 }, stock: { food: 600, wood: 400, stone: 300 } }));
    const home = w.save.home;
    const lair = w.gen.settlements.filter((x) => w.alive(x, now)).sort((a, b) => distance(home, a) - distance(home, b))[0];
    const m: StoredMarch = {
      id: 'raid-test', seed: 9, mission: 'raid', units: { warrior: 200 }, own: false, fromId: lair.id, targetId: 'home',
      from: { x: lair.x, y: lair.y }, to: { ...home }, fromName: lair.name, toName: 'Наш город',
      departAt: now - 60_000, arriveAt: now, phase: 'out', power: 5000, loot: null,
    };
    w.save.marches.push(m);
    w.resolveIncoming(m, now);
    expect(w.save.sieges.home, 'точка внутри области: бой у стены, а не осада').toBeUndefined();
    const back = w.save.marches.find((x) => x.id === m.id);
    expect(back?.phase).toBe('back');
    expect(back?.toName).toBe(lair.name);
    expect(Object.values(back?.loot ?? {}).reduce((a, b) => a + (b ?? 0), 0), 'несут добычу').toBeGreaterThan(0);
    const held = back?.held ?? 0;
    expect(held, 'точка внутри области: наших увели').toBeGreaterThan(0);
    expect(w.save.captives[lair.id] ?? 0, 'в плену ещё никого: отряд в пути').toBe(0);
    now = back!.arriveAt + 1;
    await world.sync(profile({ army: { spearman: 30 } }));
    expect(w.save.marches.some((x) => x.id === m.id)).toBe(false);
    expect(w.save.captives[lair.id]).toBe(held);
  }, 60_000);
});
