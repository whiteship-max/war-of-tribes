// Точки мира и встречи с НПС (ПН-5, docs/gdd/path_of_sword.md, 3.5.1, 3.6 и «Решения ПН-5»): вольные города общие, сёла и ватаги свои;
// сила НПС — от ступени престижа, а не от отряда; засада — шанс дверью видимости `world/sight`, заморожен при отправке и показан до
// приказа; бой — ядром мира, итог — одной дверью партии, один раз.
//
// Путь включён подменой модуля (`vi.mock`), как в `roamworld.test.ts`. Граница области — утверждениями: отряд правда в фазе бродяги и
// стоит на месте выхода, цель правда суша в своём регионе, ступени престижа правда разные, засада правда выпала.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam, campGain, foodAfter, setMove, setTrip } from '@/game/sim/roam';
import { takeFight } from '@/game/sim/roamfight';
import { roamStub } from '@/game/roamstubs';
import { LAIR_RUIN } from './data/tuning';
import { lairGold } from './lairs';
import { RoamWorld, type RoamPort } from './local/RoamWorld';
import { SICILY, inSicilyTheatre } from './spawn';
import { settleable, type Spot } from './land';
import { roamGo, roamSeat, type RoamMove } from './roam';
import { ruinAt } from './ruins';
import { pointAt, pointsIn, townAt, vatagaAt, villageAt, type RoamPoint } from './roampoints';
import { foePower, foeStage } from './roamfoes';
import { ambushChance, tripOf } from './encounter';
import type { RoamWay } from './roammove';
// Кусок пути (ПН-5, хвост а): у админа он докачан до мира бродяги (`game/roamlazy`).
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const SEED = 20261029;
const T0 = Date.UTC(2026, 9, 29, 12);
const HOME: Spot = SICILY[0];
const SYNC = {} as Parameters<RoamWorld['sync']>[0];

function party(band: Record<string, number> = { spearman: 8, clubman: 4 }, prestige = 0): GameState {
  const s = createInitialState(SEED);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band, purse: 100, food: 200 })).toBeNull();
  setMove(s, roamSeat(HOME, T0));
  s.prestige = prestige;
  return s;
}

function portOf(s: GameState): RoamPort {
  return {
    band: () => s.roam ?? null,
    apply: (m) => void setMove(s, m),
    foodAfter: (ms, g) => foodAfter(s, ms, g),
    campGain: (k, open) => campGain(s, k, open),
    partyTime: () => s.time,
    prestige: () => s.prestige,
    setTrip: (t) => setTrip(s, t),
    fight: (f) => takeFight(s, f),
  };
}

const world = (s: GameState, now: () => number): RoamWorld => new RoamWorld({ seed: SEED, storage: null, now, home: HOME }, portOf(s));

/** Ближайшая к месту выхода ватага, до которой отряд дойдёт посуху своим регионом. */
function nearVataga(s: GameState): RoamPoint {
  const all = pointsIn(SEED, HOME.x - 30, HOME.y - 30, HOME.x + 31, HOME.y + 31)
    .filter((p) => p.kind === 'vataga' && inSicilyTheatre(p) && typeof roamGo(s.roam as unknown as RoamMove, p, 'normal', T0) !== 'string')
    .sort((a, b) => Math.hypot(a.x - HOME.x, a.y - HOME.y) - Math.hypot(b.x - HOME.x, b.y - HOME.y));
  expect(all.length, 'граница: ватага в досягаемости есть').toBeGreaterThan(0);
  return all[0];
}

describe('точки мира: общие и свои (ГДД 3.5.1)', () => {
  const R = { x0: HOME.x - 40, y0: HOME.y - 40, x1: HOME.x + 41, y1: HOME.y + 41 };

  it('вольный город — общий: у любого мира те же; сёла и ватаги — свои: сид мира их двигает', () => {
    const a = pointsIn(1, R.x0, R.y0, R.x1, R.y1);
    const b = pointsIn(2, R.x0, R.y0, R.x1, R.y1);
    const towns = (ps: RoamPoint[]): string[] => ps.filter((p) => p.kind === 'town').map((p) => p.id).sort();
    expect(towns(a).length, 'граница: города в рамке есть').toBeGreaterThan(0);
    expect(towns(a)).toEqual(towns(b));
    const own = (ps: RoamPoint[], k: RoamPoint['kind']): string[] => ps.filter((p) => p.kind === k).map((p) => p.id).sort();
    expect(own(a, 'village').length).toBeGreaterThan(0);
    expect(own(a, 'village')).not.toEqual(own(b, 'village'));
    expect(own(a, 'vataga')).not.toEqual(own(b, 'vataga'));
  });

  it('каждая точка — на земле двора, не на руинах и не друг на друге; ступень города I–III; поиск по клетке — та же точка', () => {
    const ps = pointsIn(SEED, R.x0, R.y0, R.x1, R.y1);
    const cells = new Set<string>();
    for (const p of ps) {
      expect(settleable(p.x, p.y), p.id).toBe(true);
      expect(ruinAt(p.x, p.y), p.id).toBeNull();
      expect(cells.has(`${p.x}:${p.y}`), p.id).toBe(false);
      cells.add(`${p.x}:${p.y}`);
      expect(pointAt(SEED, p.x, p.y)?.id).toBe(p.id);
      if (p.kind === 'town') expect([1, 2, 3]).toContain(p.tier);
      else expect(p.tier).toBe(0);
    }
    const t = ps.find((p) => p.kind === 'town') as RoamPoint;
    expect(townAt(t.x, t.y)?.id).toBe(t.id);
    const v = ps.find((p) => p.kind === 'village') as RoamPoint;
    expect(villageAt(SEED, v.x, v.y)?.id).toBe(v.id);
    expect(vatagaAt(SEED + 1, v.x, v.y)).toBeNull();
  });

  it('двери точек, силы и встреч — без `@/`: их собирает сервер (города общие)', () => {
    for (const f of ['roampoints.ts', 'roamfoes.ts', 'data/roampoints.ts']) {
      expect(readFileSync(join(__dirname, f), 'utf8'), f).not.toMatch(/from '@\//);
    }
  });

  it('мир бродяги отдаёт точки только на разведанных клетках', async () => {
    const s = party();
    const w = world(s, () => T0);
    const c = await w.region({ x: HOME.x - 40, y: HOME.y - 40, w: 81, h: 81 });
    const pts = c.points ?? [];
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(c.explored[(p.y - c.rect.y) * c.rect.w + (p.x - c.rect.x)], p.id).toBe(1);
    const all = pointsIn(SEED, HOME.x - 40, HOME.y - 40, HOME.x + 41, HOME.y + 41);
    expect(pts.length, 'граница: часть точек в тумане').toBeLessThan(all.length);
  });
});

describe('сила НПС — от ступени престижа, а не от отряда (ГДД 3.6.2)', () => {
  it('отряд в 12 и в 120 человек при том же престиже видят ту же силу цели и засады; ступень выше — сильнее', async () => {
    const small = party({ spearman: 8, clubman: 4 }, 60);
    const big = party({ spearman: 80, clubman: 40 }, 60);
    const target = nearVataga(small);
    const plan = async (s: GameState) => {
      const p = await world(s, () => T0).roamPlan(target);
      if (typeof p === 'string') throw new Error(p);
      return p;
    };
    const a = await plan(small);
    const b = await plan(big);
    expect(a.aim?.kind).toBe('vataga');
    expect(a.aim?.strike?.power, 'сила цели — та же').toBe(b.aim?.strike?.power);
    for (const g of ['light', 'normal', 'train'] as const) {
      const la = a.legs.find((l) => l.gait === g)!;
      const lb = b.legs.find((l) => l.gait === g)!;
      expect(la.ambush.power, `${g}: сила засады — та же`).toBe(lb.ambush.power);
      expect(lb.ambush.p, `${g}: заметнее большой отряд — засада чаще`).toBeGreaterThan(la.ambush.p);
    }
    // Ступень выше — сила выше: точки внутри разных ступеней (утверждением).
    expect(foeStage(0)).toBeLessThan(foeStage(500));
    const strong = await plan(party({ spearman: 8, clubman: 4 }, 500));
    expect(strong.aim?.strike?.power).toBeGreaterThan(a.aim?.strike?.power ?? Infinity);
    expect(foePower(500, 'band', 1)).toBeGreaterThan(foePower(60, 'band', 1));
  });
});

describe('засада — дверью видимости, заморожена при отправке и показана до приказа (ГДД 3.6.3)', () => {
  const way = (g: 'light' | 'normal' | 'train', to: Spot): RoamWay => ({ from: HOME, to, at: T0, until: T0 + 3_600_000, ...(g === 'normal' ? {} : { gait: g }) });

  it('шанс читает заметность колонны: тише марш и меньше людей — реже засада; длиннее дорога — чаще', () => {
    const to = { x: HOME.x + 12, y: HOME.y };
    expect(ambushChance(way('light', to), 20, 0, T0)).toBeLessThan(ambushChance(way('normal', to), 20, 0, T0));
    expect(ambushChance(way('normal', to), 20, 0, T0)).toBeLessThan(ambushChance(way('train', to), 20, 0, T0));
    expect(ambushChance(way('normal', to), 5, 0, T0)).toBeLessThan(ambushChance(way('normal', to), 50, 0, T0));
    expect(ambushChance(way('normal', { x: HOME.x + 4, y: HOME.y }), 20, 0, T0)).toBeLessThan(ambushChance(way('normal', to), 20, 0, T0));
    expect(ambushChance(way('normal', to), 20, 0, T0)).toBeLessThanOrEqual(roamStub('ambushCap'));
  });

  it('встречи считает дверь видимости: своей формулы заметности у встреч нет', () => {
    const src = readFileSync(join(__dirname, 'encounter.ts'), 'utf8');
    expect(src).toMatch(/conspicuity\(bandLook\(/);
    expect(src).not.toMatch(/SIGHT\.|camouflage|night\s*\?/);
  });

  it('окно хода показывает те числа, что заморозит приказ; потом отряд вырос — замороженное не меняется', async () => {
    const s = party();
    const w = world(s, () => T0);
    const target = nearVataga(s);
    const plan = await w.roamPlan(target);
    if (typeof plan === 'string') throw new Error(plan);
    const leg = plan.legs.find((l) => l.gait === 'normal')!;
    expect(leg.ambush.words).toMatch(/^засада (<1|\d+) % · если засада — бой с ~\d+$/);
    expect(await w.roamTo(target, 'normal', leg.until)).toBeNull();
    const trip = s.roam?.trip;
    expect(trip, 'встреча заморожена').toBeDefined();
    expect(trip?.odds.p).toBeCloseTo(leg.ambush.p, 12);
    expect(trip?.odds.power).toBe(leg.ambush.power);
    s.roam!.band.spearman = 80;
    const again = await w.roamPlan(target);
    if (typeof again === 'string') throw new Error(again);
    expect(s.roam?.trip?.odds.p, 'замороженное — прежнее').toBeCloseTo(leg.ambush.p, 12);
  });

  it('кость — из сида пути и минуты прихода: та же дорога — та же засада; ход сменился — встреча прежнего снята', () => {
    const to = { x: HOME.x + 12, y: HOME.y };
    const a = tripOf(way('normal', to), 20, 0, T0, 0, SEED);
    const b = tripOf(way('normal', to), 20, 0, T0, 0, SEED);
    expect(a).toEqual(b);
    const s = party();
    const m = roamGo(s.roam as unknown as RoamMove, nearVataga(s), 'normal', T0);
    if (typeof m === 'string') throw new Error(m);
    setMove(s, m);
    setTrip(s, tripOf(m.way, 12, s.time, T0, 0, SEED));
    expect(s.roam?.trip).toBeDefined();
    setMove(s, roamSeat(HOME, T0 + 1000));
    expect(s.roam?.trip, 'новый ход — без встречи прежнего').toBeUndefined();
  });

  it('засада выпала — бой в минуту встречи (`pursuit`), итог один раз', async () => {
    // Дорога, где кость засады выпадает (поиск — утверждением: правда выпала).
    const s = party({ spearman: 30, swordsman: 10 }, 0);
    let to: Spot | null = null;
    let m: RoamMove | null = null;
    for (let dx = -25; dx <= 25 && !to; dx++)
      for (let dy = -25; dy <= 25 && !to; dy++) {
        const c = { x: HOME.x + dx, y: HOME.y + dy };
        if (Math.hypot(dx, dy) < 8 || !settleable(c.x, c.y) || !inSicilyTheatre(c)) continue;
        const g = roamGo(s.roam as unknown as RoamMove, c, 'normal', T0);
        if (typeof g === 'string') continue;
        if (tripOf(g.way, 40, s.time, T0, 0, SEED).ambush) {
          to = c;
          m = g;
        }
      }
    expect(to, 'граница: дорога с засадой нашлась').not.toBeNull();
    let now = T0;
    const w = world(s, () => now);
    expect(await w.roamTo(to as Spot, 'normal', (m as RoamMove).way.until)).toBeNull();
    const at = s.roam!.trip!.ambush!.at;
    expect(at).toBeGreaterThan(s.roam!.way!.at);
    expect(at).toBeLessThanOrEqual(s.roam!.way!.until);
    const logBefore = s.log.length;
    now = at - 1;
    await w.sync(SYNC);
    expect(s.log.length, 'до минуты встречи боя нет').toBe(logBefore);
    now = at + 1;
    await w.sync(SYNC);
    expect(s.log[0].text).toMatch(/^Засада: ватага \(~\d+\) — (победа|отход|отряд перебит)/);
    expect(s.roam?.trip?.ambush?.done).toBe(true);
    const after = s.log.length;
    await w.sync(SYNC);
    expect(s.log.length, 'второй раз бой не идёт').toBe(after);
  });
});

describe('удар по цели: бой в минуту прихода, добыча, престиж, пепелище (ГДД 3.6.1, 3.6.4)', () => {
  it('сильный отряд бьёт ватагу: престиж — мощь / S, золото логова по мощи, ватаги нет на карте до срока пепелища', async () => {
    const s = party({ swordsman: 40, spearman: 20 }, 0);
    const target = nearVataga(s);
    let now = T0;
    const w = world(s, () => now);
    const plan = await w.roamPlan(target);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.aim?.strike, 'у ватаги — удар').not.toBeNull();
    const power = plan.aim!.strike!.power;
    const leg = plan.legs.find((l) => l.gait === 'normal')!;
    expect(await w.roamTo(target, 'normal', leg.until, true)).toBeNull();
    expect(s.roam?.trip?.strike?.power).toBe(power);
    // Засада по пути, если выпала, — тоже бой: меряем удар после неё.
    now = leg.until + 1;
    const purse = s.roam!.purse;
    const prestige = s.prestige;
    await w.sync(SYNC);
    const line = s.log.find((l) => l.text.startsWith(`Бой: ${target.name}`));
    expect(line?.text, 'строка летописи о бое').toMatch(/— победа\./);
    expect(s.roam!.purse - purse).toBe(lairGold(power));
    expect(s.prestige - prestige).toBeCloseTo(power / roamStub('prestigeS'), 9);
    expect(s.roam?.beaten?.[0]).toEqual({ id: target.id, until: leg.until + LAIR_RUIN });
    const c = await w.region({ x: target.x - 1, y: target.y - 1, w: 3, h: 3 });
    expect((c.points ?? []).some((p) => p.id === target.id), 'пепелище — на карте нет').toBe(false);
    const n = s.log.length;
    await w.sync(SYNC);
    expect(s.log.length, 'один удар — один бой').toBe(n);
    now = leg.until + LAIR_RUIN + 1;
    const back = await w.region({ x: target.x - 1, y: target.y - 1, w: 3, h: 3 });
    expect((back.points ?? []).some((p) => p.id === target.id), 'срок пепелища прошёл — ватага снова стоит').toBe(true);
  });

  it('проигранный удар — тоже один бой: цель стоит, но второй раз в ту же минуту прихода отряд не бьётся', async () => {
    const s = party({ clubman: 40 }, 1000);
    const target = nearVataga(s);
    let now = T0;
    const w = world(s, () => now);
    const plan = await w.roamPlan(target);
    if (typeof plan === 'string') throw new Error(plan);
    const leg = plan.legs.find((l) => l.gait === 'normal')!;
    expect(await w.roamTo(target, 'normal', leg.until, true)).toBeNull();
    now = leg.until + 1;
    await w.sync(SYNC);
    const fights = (): number => s.log.filter((l) => l.text.startsWith(`Бой: ${target.name}`)).length;
    expect(fights(), 'граница: бой был').toBe(1);
    expect(s.log.find((l) => l.text.startsWith(`Бой: ${target.name}`))?.text, 'граница: проигран').toMatch(/— отход\./);
    expect(Object.values(s.roam!.band).reduce((a, b) => a + (b ?? 0), 0), 'граница: отряд жив — второй бой было бы кому вести').toBeGreaterThan(0);
    // Строки летописи одного боя склеиваются по минуте — второй бой мерят отметкой и отрядом, а не числом строк.
    expect(s.roam?.trip?.strike?.done).toBe(true);
    const band = JSON.stringify(s.roam!.band);
    await w.sync(SYNC);
    expect(fights()).toBe(1);
    expect(JSON.stringify(s.roam!.band), 'второго боя нет — отряд тот же').toBe(band);
  });

  it('герой ранен — в бой не ведёт: окно говорит, когда встанет, приказ «Напасть» — отказ теми же словами', async () => {
    const s = party();
    s.roam!.hero.hurt = s.time + 4 * 1800;
    const w = world(s, () => T0);
    const target = nearVataga(s);
    const plan = await w.roamPlan(target);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.aim?.block).toMatch(/^Герой ранен: в бой поведёт через /);
    expect(await w.roamTo(target, 'normal', undefined, true)).toBe(plan.aim?.block);
    expect(await w.roamTo(target, 'normal'), 'идти — можно').toBeNull();
  });

  it('вольный город и село — место и вход, удара у них нет; приказ «Напасть» на город — отказ словами', async () => {
    const s = party();
    const w = world(s, () => T0);
    const town = pointsIn(SEED, HOME.x - 40, HOME.y - 40, HOME.x + 41, HOME.y + 41).find(
      (p) => p.kind === 'town' && inSicilyTheatre(p) && typeof roamGo(s.roam as unknown as RoamMove, p, 'normal', T0) !== 'string',
    );
    expect(town, 'граница: город в досягаемости').toBeDefined();
    const plan = await w.roamPlan(town as RoamPoint);
    if (typeof plan === 'string') throw new Error(plan);
    expect(plan.aim?.kind).toBe('town');
    expect(plan.aim?.strike).toBeNull();
    expect(await w.roamTo(town as RoamPoint, 'normal', undefined, true)).toBe('Здесь не с кем биться.');
  });
});
