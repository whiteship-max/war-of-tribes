// Мир бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.2–3.5.3, 5.2; «Решения ПН-3»): ход только у отряда, приказ — дверью хода,
// запись — в партию одной дверью, без сервера — правилом мира, с сервером — его строкой; своего города нет, руины — на разведанном.
//
// Путь включён подменой модуля (`vi.mock`): что он выключен у игроков, держит `roamflag.test.ts`; что мир лорда прежний —
// `lordmap.test.ts`. Граница области — утверждениями: отряд правда в фазе бродяги и стоит на месте выхода, клетка правда суша.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import type { BandOrder, BandRow } from '../../netlify/lib/contract';
import { createInitialState } from '@/game/state';
import { beginRoam, campGain, foodAfter, setMove } from '@/game/sim/roam';
import { addStock } from '@/game/sim/stock';
import { cargoCap } from '@/game/sim/roam';
import { HOME_ID, LocalWorld } from './local/LocalWorld';
import { AMBUSH_STUB, NO_SEAT, RoamWorld, type RoamPort } from './local/RoamWorld';
import { SICILY, inSicilyTheatre } from './spawn';
import { settleable, type Spot } from './land';
import { roamCell, roamGo, roamSeat, roamWhere, type RoamMove } from './roam';
import { ruinAt, ruinsIn } from './ruins';
import { distance } from './geo';
import { GAIT_HAUL } from './data/gait';
import { UNIT_BY_ID } from './data/units';
// Кусок пути (ПН-5, хвост а): у админа он докачан до мира бродяги (`game/roamlazy`).
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const T0 = Date.UTC(2026, 9, 29, 12);
const HOME: Spot = SICILY[0];

/** Партия бродяги, стоящая на месте выхода `at`. */
function party(at: Spot = HOME): GameState {
  const s = createInitialState(20261029);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 8, clubman: 4 }, purse: 100, food: 200 })).toBeNull();
  setMove(s, roamSeat(at, T0));
  return s;
}

function portOf(s: GameState, order?: RoamPort['order']): RoamPort {
  return {
    band: () => s.roam ?? null,
    apply: (m) => void setMove(s, m),
    foodAfter: (ms, g) => foodAfter(s, ms, g),
    campGain: (k) => campGain(s, k),
    partyTime: () => s.time,
    ...(order ? { order } : {}),
  };
}

const world = (s: GameState, now: () => number, order?: RoamPort['order']): RoamWorld =>
  new RoamWorld({ seed: 20261029, storage: null, now, home: HOME }, portOf(s, order));

const FAR = (() => {
  for (let d = 12; d < 30; d++) for (const c of [{ x: HOME.x + d, y: HOME.y }, { x: HOME.x - d, y: HOME.y }, { x: HOME.x, y: HOME.y + d }])
    if (settleable(c.x, c.y)) return c;
  throw new Error('нет суши');
})();

describe('ход — только у отряда бродяги', () => {
  it('у мира лорда методов хода нет вовсе', () => {
    const lord = new LocalWorld({ seed: 1, storage: null, now: () => T0, home: HOME });
    for (const m of ['roamTo', 'roamPlan', 'roamCamp', 'roamCampView']) expect(m in lord, m).toBe(false);
  });

  it('интерфейс лорда их не зовёт: в src зовут их только карта бродяги и сам мир бродяги', () => {
    const ROOT = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(ROOT);
    const callers = new Set<string>();
    for (const p of files) {
      const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\.roam(To|Plan|Camp|CampView)\?*\.?\(/.test(code)) callers.add(relative(ROOT, p).split(sep).join('/'));
    }
    // Граница области: зовущие правда есть — карта бродяги; лорд среди них не появляется.
    expect(callers.size).toBeGreaterThan(0);
    for (const c of callers) expect(c, 'зовёт ход отряда').toMatch(/^ui\/map\/roam\//);
  });

  it('мира без места выхода нет: приказ — отказ словами', async () => {
    const s = createInitialState(1);
    expect(beginRoam(s, { origin: 'warrior', hero: { name: 'x', war: 1 }, band: { spearman: 2 }, purse: 0, food: 0 })).toBeNull();
    expect(s.roam?.way).toBeUndefined();
    const w = new RoamWorld({ seed: 1, storage: null, now: () => T0, home: HOME }, portOf(s));
    expect(await w.roamTo(FAR, 'normal')).toBe(NO_SEAT);
    expect(await w.roamPlan(FAR)).toBe(NO_SEAT);
  });
});

describe('приказ «Идти сюда» в мире бродяги', () => {
  it('без сервера — правилом мира: запись хода в партии, положение — функцией записи', async () => {
    const s = party();
    let now = T0;
    const w = world(s, () => now);
    const plan = await w.roamPlan(FAR);
    expect(typeof plan).toBe('object');
    if (typeof plan === 'string') return;
    expect(plan.block).toBeNull();
    expect(plan.ambush).toBe(AMBUSH_STUB);
    const leg = plan.legs.find((l) => l.gait === 'normal')!;
    expect(leg.food.now).toBe(200);
    expect(leg.food.at).toBeLessThan(200);
    expect(await w.roamTo(FAR, 'normal', leg.until)).toBeNull();
    expect(s.roam?.way?.to).toEqual(FAR);
    expect(s.roam?.way?.until).toBe(leg.until);
    now = (T0 + leg.until) / 2;
    expect(roamWhere(s.roam!.way!, now).x).toBeCloseTo((HOME.x + FAR.x) / 2, 9);
    expect(await w.roamTo({ x: 0, y: 0 }, 'normal')).toBe('За краем мира земли нет.');
  });

  it('режим марша — в ходе: налегке обоз меньше, лишнее брошено строкой летописи той же дверью записи', async () => {
    const s = party();
    addStock(s, 'wood', 1e6, cargoCap(s.roam!), 'cargo');
    const full = cargoCap(s.roam!);
    expect(full).toBe(12 * UNIT_BY_ID.warrior.carry * GAIT_HAUL.normal);
    const w = world(s, () => T0);
    expect(await w.roamTo(FAR, 'light')).toBeNull();
    expect(s.roam?.way?.gait).toBe('light');
    expect(Object.keys(s.roam!)).not.toContain('gait');
    expect(cargoCap(s.roam!)).toBe(12 * UNIT_BY_ID.warrior.carry * GAIT_HAUL.light);
    expect(s.log.some((e) => e.text.startsWith('Обоз не поднять'))).toBe(true);
  });

  it('с сервером — приказ уходит серверу, срок — тот, что видел игрок; отказ сервера — его словами, партия не тронута', async () => {
    const s = party();
    const sent: BandOrder[] = [];
    const order = async (o: BandOrder): Promise<BandRow | string> => {
      sent.push(o);
      return 'Сервер сказал нет.';
    };
    const w = world(s, () => T0, order);
    const plan = await w.roamPlan(FAR);
    if (typeof plan === 'string') throw new Error(plan);
    const leg = plan.legs.find((l) => l.gait === 'train')!;
    expect(await w.roamTo(FAR, 'train', leg.until)).toBe('Сервер сказал нет.');
    expect(sent).toEqual([{ op: 'go', to: FAR, gait: 'train', until: leg.until }]);
    expect(s.roam?.way?.to, 'партия ждёт строку сервера').toEqual(HOME);
    // Отказ клетки — словами двери, до сервера.
    expect(await w.roamTo(HOME, 'normal')).toBe('Отряд уже здесь.');
    expect(sent).toHaveLength(1);
  });
});

describe('лагерь в мире бродяги', () => {
  it('окно: три вида с отказами и пользой дверей партии; встать — запись в партии', async () => {
    const ruin = ruinsIn(HOME.x - 30, HOME.y - 30, HOME.x + 30, HOME.y + 30).find((r) => distance(r, HOME) > 0)!;
    expect(ruinAt(ruin.x, ruin.y)).not.toBeNull();
    const s = party(ruin);
    const w = world(s, () => T0);
    const view = await w.roamCampView();
    if (typeof view === 'string') throw new Error(view);
    expect(view.ruin).not.toBeNull();
    expect(view.rows.map((r) => r.kind)).toEqual(['open', 'hidden', 'ruin']);
    expect(view.rows.every((r) => r.block === null)).toBe(true);
    const open = view.rows.find((r) => r.kind === 'open')!;
    const hidden = view.rows.find((r) => r.kind === 'hidden')!;
    expect(open.forage).toBeGreaterThan(hidden.forage);
    expect(open.morale).toBeGreaterThan(0);
    expect(open.heal).toBeGreaterThan(1);
    expect(await w.roamCamp('ruin')).toBeNull();
    expect(s.roam?.camp).toEqual({ kind: 'ruin', since: T0, builders: 12 });
    const again = await w.roamCampView();
    if (typeof again === 'string') throw new Error(again);
    expect(again.camp).toBe('ruin');
    expect(again.rows.find((r) => r.kind === 'ruin')?.block).toBe('Отряд уже стоит этим лагерем.');
  });
});

describe('карта бродяги: своего города нет, руины — на разведанной земле, мир за город не шагает', () => {
  it('кусок карты без своего города и с руинами только на открытых клетках', async () => {
    const s = party();
    const w = world(s, () => T0);
    const c = await w.region({ x: HOME.x - 24, y: HOME.y - 24, w: 48, h: 48 });
    expect(c.settlements.some((x) => x.id === HOME_ID)).toBe(false);
    const all = ruinsIn(HOME.x - 24, HOME.y - 24, HOME.x + 24, HOME.y + 24);
    // Граница: руины вокруг правда есть, и часть их — в тумане.
    expect(all.length).toBeGreaterThan((c.ruins ?? []).length);
    expect((c.ruins ?? []).length).toBeGreaterThan(0);
    for (const r of c.ruins ?? []) expect(c.explored[(r.y - c.rect.y) * c.rect.w + (r.x - c.rect.x)]).toBe(1);
    expect(await w.figures()).toEqual([]);
  });

  it('путь отряда открывает землю обзором полководца', async () => {
    const s = party();
    let now = T0;
    const w = world(s, () => now);
    // Клетка за кругом у места выхода (`SICILY_SIGHT`) — туман до прихода.
    let FAR = HOME;
    for (let dy = -45; dy <= 45 && FAR === HOME; dy += 3)
      for (let dx = -45; dx <= 45 && FAR === HOME; dx += 3) {
        const c = { x: HOME.x + dx, y: HOME.y + dy };
        // Посуху: через пролив сил на дорогу не хватит (вода — тяжёлая клетка), и это тоже правило двери.
        if (Math.hypot(dx, dy) > 24 && settleable(c.x, c.y) && inSicilyTheatre(c) && typeof roamGo(s.roam as unknown as RoamMove, c, 'normal', T0) !== 'string') FAR = c;
      }
    expect(FAR).not.toEqual(HOME);
    const m = roamGo(s.roam as unknown as RoamMove, FAR, 'normal', T0);
    if (typeof m === 'string') throw new Error(m);
    setMove(s, m);
    const before = (await w.region({ x: FAR.x - 1, y: FAR.y - 1, w: 3, h: 3 })).explored.reduce((n, v) => n + v, 0);
    now = m.way.until + 1;
    await w.sync({} as Parameters<RoamWorld['sync']>[0]);
    const after = (await w.region({ x: FAR.x - 1, y: FAR.y - 1, w: 3, h: 3 })).explored.reduce((n, v) => n + v, 0);
    expect(after).toBe(9);
    expect(before).toBeLessThan(9);
    expect(roamCell(m.way, now)).toEqual(FAR);
  });

  it('пульс тихий: ни набегов, ни вестей, ни отчётов', async () => {
    const s = party();
    const w = world(s, () => T0 + 86_400_000 * 3);
    const p = await w.sync({} as Parameters<RoamWorld['sync']>[0]);
    expect(p.effects).toEqual([]);
    expect(p.marches).toEqual([]);
    expect(p.reports).toEqual([]);
    expect(p.siege).toBeNull();
  });
});
