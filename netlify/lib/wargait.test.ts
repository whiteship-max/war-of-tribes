// Режим марша у сервера войны (ДР-2, docs/siege_v2.md, 25.1, М9): срок похода, обратный путь, пол удара из поля и истощение
// налегке считает сервер сам по режиму приказа; осада налегке — отказ и флаг; смена в пути — приказ `gait` той же
// стоянкой и ценой, что у мира; лагерь с обозом — без подвоза из дома; поход без поля — обычный.
// Области правил — утверждением в самом тесте (правило 11): замки не у ворот друг друга (дорога длиннее пола похода),
// лагерь у стен стоит, амбар нападающего пуст там, где проверяется подвоз.
import { afterEach, describe, expect, it } from 'vitest';
import type { CastleClaim, RosterFile, WarArmy, WarSheet } from './contract.js';
import { readWarOrder } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, type SheetAt, type WarFile, type WarRow } from './war.js';
import { distance, terrainFactor, travelTimeAt } from '../../src/world/geo.js';
import { fieldWalkFloorMs, warWalkMs } from '../../src/world/pvp.js';
import { gaitHaltMs, gaitHaul, lightShare, LIGHT_NO_CAMP, roadLosses, strikeSeed, strikeWorn } from '../../src/world/gait.js';
import { bookLive, seedBook, warLosses } from './book.js';
import { UNIT_BY_ID } from '../../src/world/data/units.js';
import { FIGURE_BY_ID } from '../../src/world/data/figures.js';
import { MARCH_MIN_SECONDS } from '../../src/world/data/tuning.js';
import { ENERGY_PRICE } from '../../src/world/data/energy.js';
import { CAMP_WASTE, SIEGE_PHASE } from '../../src/world/data/siegeroll.js';
import { energyAt } from '../../src/world/energy.js';
import { setPhaseDie, wasteOf } from '../../src/world/siegeroll.js';
import { realMs } from '../../src/game/pace.js';

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
function world(): RosterFile {
  let r = emptyRoster();
  r = upsert(r, A, claim('Альфа'), T0);
  r = upsert(r, B, claim('Бета'), T0);
  return r;
}
const sheet = (food = 2000): WarSheet => ({
  army: { spearman: 260, archer: 60, swordsman: 60 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { walls: 3, farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
});
const army = (troops: Record<string, number>): WarArmy => ({ troops, resolve: 0, pips: {} });
const HOST = { spearman: 200, swordsman: 40 };

function setup(atkFood = 2000) {
  const roster = world();
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(atkFood), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
  ]);
  const warned: string[] = [];
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null, forged: (text: string) => warned.push(text) };
  return { roster, sheets, ctx, warned, file: emptyWars() as WarFile };
}

afterEach(() => setPhaseDie(null));

describe('сервер войны: срок похода по режиму марша', () => {
  it('налегке ×1,5, обычный, с обозом вдвое дольше; поход без поля — обычный, как до ДР-2', () => {
    const walks: Record<string, number> = {};
    for (const g of [undefined, 'light', 'train'] as const) {
      const { ctx, file, roster, warned } = setup();
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army(HOST), ...(g ? { gait: g } : {}) }, T0, ctx)).toBeNull();
      const w = file.wars[0];
      walks[g ?? 'normal'] = w.arriveAt - T0;
      expect(w.gait).toBe(g);
      expect(w.arriveAt - T0).toBe(warWalkMs(roster.rows[A], roster.rows[B], g));
      expect(warned).toEqual([]);
    }
    // Точка внутри области: замки не у ворот друг друга, и налегке дорога длиннее пола.
    expect(walks.light).toBeGreaterThan(realMs(MARCH_MIN_SECONDS));
    expect(walks.light / walks.normal).toBeCloseTo(1 / 1.5, 2);
    expect(walks.train / walks.normal).toBeCloseTo(2, 2);
  });

  it('энергия дороги — по пути: та же отметка к приходу в любом режиме', () => {
    const left: number[] = [];
    for (const g of ['light', undefined, 'train'] as const) {
      const { ctx, file } = setup();
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army(HOST), ...(g ? { gait: g } : {}) }, T0, ctx)).toBeNull();
      const w = file.wars[0];
      left.push(energyAt(w.army.energy, w.arriveAt));
    }
    expect(left[1]).toBeLessThan(100 - ENERGY_PRICE.storm.price);
    for (const v of left) expect(v).toBeCloseTo(left[1], 1);
  });
});

describe('сервер войны: налегке', () => {
  it('осада налегке — отказ словами двери и флаг: интерфейс такой приказ не шлёт', () => {
    const { ctx, file, warned } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army(HOST), gait: 'light' }, T0, ctx)).toBe(LIGHT_NO_CAMP);
    expect(file.wars).toHaveLength(0);
    expect(warned.some((t) => t.includes('налегке'))).toBe(true);
    // Договор режим не стирает: иначе подделку нечем было бы поймать.
    expect(readWarOrder({ op: 'march', target: 'x', mode: 'siege', fate: 'plunder', army: army(HOST), gait: 'light' })).toMatchObject({ gait: 'light' });
    expect(readWarOrder({ op: 'march', target: 'x', mode: 'siege', fate: 'plunder', army: army(HOST), gait: 'fast' })).not.toHaveProperty('gait');
  });

  it('налегке войско тает в пути: к стене приходят те, кто дошёл, домой — те, кто вернулся', () => {
    const { ctx, file, sheets } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army(HOST), gait: 'light' }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    const walk = w.arriveAt - T0;
    expect(lightShare('light', walk), 'точка внутри области: дорога больше суток').toBeGreaterThan(0.005);
    advance(file, w.arriveAt + 1, sheets);
    const fought = w.battles[0];
    const lost = roadLosses(HOST, 'light', walk, `${w.id}:${T0}`);
    expect(Object.values(lost).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0);
    // В бой пошли дошедшие.
    const went = Object.fromEntries(Object.entries(HOST).map(([k, n]) => [k, n - (lost[k as keyof typeof lost] ?? 0)]));
    expect(fought.atkTroops).toEqual(went);
  });

  it('пол удара из поля — в режиме приказа: налегке короче, срок короче своего пола — флаг', () => {
    const { ctx, file, sheets, warned } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 60 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase).toBe('camp');
    const from = { x: w.to.x + 12, y: w.to.y + 5 };
    const lightFloor = fieldWalkFloorMs(from, w.to, 'light');
    expect(lightFloor).toBeLessThan(fieldWalkFloorMs(from, w.to));
    const at = w.arriveAt + 2;
    // Честный срок налегке — не короче пола налегке: принят без флага.
    const honest = Math.round(realMs(travelTimeAt(distance(from, w.to), terrainFactor(7, from, w.to), FIGURE_BY_ID.general.speed * 1.5, 1)));
    expect(honest).toBeGreaterThanOrEqual(lightFloor);
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs: honest, from, gait: 'light' }, at, ctx)).toBeNull();
    expect(w.strike?.gait).toBe('light');
    expect(warned).toEqual([]);
    delete w.strike;
    // Тот же срок без режима — короче обычного пола: флаг «срок пути».
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs: lightFloor, from }, at, ctx)).toContain('Так быстро');
    expect(warned.length).toBe(1);
  });
});

describe('сервер войны: смена режима в пути', () => {
  it('стоянка и цена, путь после неё — новой скоростью; на осаду «налегке» нельзя; в лагере — нельзя', () => {
    const { ctx, file, sheets, roster } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army(HOST) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    const mid = T0 + Math.round((w.arriveAt - T0) / 2);
    const e0 = energyAt(w.army.energy, mid);
    expect(applyOrder(file, A, { op: 'gait', id: w.id, gait: 'train' }, mid, ctx)).toBeNull();
    expect(w.gait).toBe('train');
    expect(w.legAt).toBe(mid + gaitHaltMs());
    expect(e0 - energyAt(w.army.energy, mid)).toBeCloseTo(ENERGY_PRICE.gait.price, 6);
    // Остаток пути с обозом — вдвое дольше обычного остатка (пол и округление клеток — в допуске).
    const rest = warWalkMs(w.legFrom!, roster.rows[B], 'train');
    expect(w.arriveAt).toBe(w.legAt! + rest);
    // Тот же остаток с того же места обычным маршем — вдвое короче (земля отрезка своя, поэтому мерка — от места смены).
    expect(rest / warWalkMs(w.legFrom!, roster.rows[B])).toBeCloseTo(2, 2);
    // В стоянку второй смены нет.
    expect(applyOrder(file, A, { op: 'gait', id: w.id, gait: 'light' }, mid + 1, ctx)).toContain('стоит');
    // Поход на осаду — «налегке» не сменить.
    const s2 = setup();
    expect(applyOrder(s2.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army(HOST) }, T0, s2.ctx)).toBeNull();
    const w2 = s2.file.wars[0];
    expect(applyOrder(s2.file, A, { op: 'gait', id: w2.id, gait: 'light' }, T0 + 1000, s2.ctx)).toContain(LIGHT_NO_CAMP);
    advance(s2.file, w2.arriveAt + 1, s2.sheets);
    expect(w2.phase).toBe('camp');
    expect(applyOrder(s2.file, A, { op: 'gait', id: w2.id, gait: 'train' }, w2.arriveAt + 2, s2.ctx)).toContain('В лагере');
    void sheets;
  });
});

describe('сервер войны: обоз — второй склад лагеря', () => {
  it('при пустом амбаре нападающего обычный лагерь тает сильнее, лагерь с обозом — базой', () => {
    const waste: Record<string, number> = {};
    for (const g of [undefined, 'train'] as const) {
      const { ctx, file, sheets } = setup(0);
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army(HOST), ...(g ? { gait: g } : {}) }, T0, ctx)).toBeNull();
      const w = file.wars[0];
      advance(file, w.arriveAt + 1, sheets);
      expect(w.phase).toBe('camp');
      expect(w.camp?.gait).toBe(g);
      setPhaseDie(() => 5);
      advance(file, w.arriveAt + SIEGE_PHASE + 1000, sheets);
      const row = w.camp?.phases?.[0];
      expect(row?.out).toBe('calm');
      waste[g ?? 'normal'] = row!.waste;
      if (!g) expect(row!.waste).toBeCloseTo(wasteOf('calm', w.camp!.homeDays, true), 12);
    }
    expect(waste.normal, 'точка внутри области: амбар пуст — обычный лагерь тает вдвое').toBeGreaterThan(2 * CAMP_WASTE);
    expect(waste.train).toBeCloseTo(CAMP_WASTE, 12);
  });
});

describe('сервер войны: вывоз добычи по режиму (ДР-5)', () => {
  // Город без войска и с большим складом: штурм берёт его, и поклажа упирается в обоз, а не в склад.
  const rich = (): WarSheet => ({ ...sheet(), army: {}, home: {}, militia: 0, archers: 0, stock: { food: 900_000, wood: 900_000, stone: 900_000 }, gold: 0, stash: 0 });
  const total = (c: Record<string, number | undefined>): number => Object.values(c).reduce<number>((a, b) => a + (b ?? 0), 0);
  it('налегке увозит половину того, что увёз бы обычный, с обозом — на четверть больше; той же дверью, что мир', () => {
    const took: Record<string, { taken: number; men: number }> = {};
    for (const g of ['light', undefined, 'train'] as const) {
      const { ctx, file, sheets } = setup();
      sheets.set(B, { sheet: rich(), at: T0 });
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army(HOST), ...(g ? { gait: g } : {}) }, T0, ctx)).toBeNull();
      const w = file.wars[0];
      advance(file, w.arriveAt + 1, sheets);
      expect(w.fall, `город взят (${g ?? 'normal'})`).toBeDefined();
      const taken = total(w.fall!.taken);
      // Точка внутри области: обоз меньше открытого склада — вывоз упирается в поклажу.
      expect(taken).toBeLessThan(900_000);
      took[g ?? 'normal'] = { taken, men: total(w.battles[0]?.atkTroops ?? HOST) - total(w.battles[0]?.atkLost ?? {}) };
    }
    const per = (k: string): number => took[k].taken / took[k].men;
    expect(per('normal')).toBeCloseTo(UNIT_BY_ID.warrior.carry, 0);
    expect(per('light') / per('normal')).toBeCloseTo(gaitHaul('light'), 2);
    expect(per('train') / per('normal')).toBeCloseTo(gaitHaul('train'), 2);
  });
});

describe('сервер войны: убыль налегке у удара по лагерю (ДР-5)', () => {
  it('уход в пути считает сервер сам от состава на выходе; ушедших вычитает книга войска; обычный марш — все дошли', () => {
    const { ctx, file, sheets, warned } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 60 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь стоит').toBe('camp');
    const from = { x: w.to.x + 60, y: w.to.y + 20 };
    const walkMs = fieldWalkFloorMs(from, w.to, 'light') * 3;
    expect(lightShare('light', walkMs), 'точка внутри области: дорога удара больше суток').toBeGreaterThan(0.005);
    const went = { spearman: 200, swordsman: 40 };
    const at = w.arriveAt + 2;
    // Обычный марш: в бой идут все, ушедших нет.
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army(went), joint: false, walkMs, from }, at, ctx)).toBeNull();
    expect(w.strike?.army.troops).toEqual(went);
    expect(w.worn).toBeUndefined();
    delete w.strike;
    // Налегке: дошедшие — той же дверью, что у мира, сидом из приказа.
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army(went), joint: false, walkMs, from, gait: 'light' }, at, ctx)).toBeNull();
    const { came, lost } = strikeWorn(went, 'light', walkMs, strikeSeed('strike', w.id, from, walkMs));
    expect(Object.values(lost).reduce((a, b) => a + (b ?? 0), 0), 'ушли').toBeGreaterThan(0);
    expect((w as WarRow).strike?.army.troops).toEqual(came);
    expect(w.worn?.map((r) => r.lost)).toEqual([lost]);
    expect(warned).toEqual([]);
    // Книга войска Беты: ушедшие — как павшие, без раненых.
    const losses = warLosses(file, B);
    expect(losses.find((l) => l.id === w.worn![0].id)).toMatchObject({ lost, wounds: false });
    const book = { ...seedBook(T0), bodies: { spearman: 300, swordsman: 60 } };
    expect(bookLive(book, file, B).spearman).toBe(300 - (lost.spearman ?? 0));
    // Ушедшие — не Альфы.
    expect(warLosses(file, A).some((l) => l.id === w.worn![0].id)).toBe(false);
  });

  it('выручка союзника налегке — тем же правилом, ушедшие за замком союзника', () => {
    const { ctx, file, sheets } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 60 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    const C = 'tg-2003';
    ctx.roster.rows[C] = { ...ctx.roster.rows[B], x: ctx.roster.rows[B].x + 30, name: 'Гамма', city: 'Гамма' };
    sheets.set(C, { sheet: sheet(), at: T0 });
    file.pacts = [{ a: B, b: C, at: T0, cities: {} }];
    const from = { x: w.to.x + 60, y: w.to.y + 20 };
    const walkMs = fieldWalkFloorMs(from, w.to, 'light') * 3;
    const went = { spearman: 200, swordsman: 40 };
    expect(applyOrder(file, C, { op: 'relief', id: w.id, army: army(went), walkMs, from, gait: 'light' }, w.arriveAt + 2, ctx)).toBeNull();
    const { came, lost } = strikeWorn(went, 'light', walkMs, strikeSeed('relief', w.id, from, walkMs));
    expect(w.reliefs?.[0].army.troops).toEqual(came);
    expect(warLosses(file, C).find((l) => l.id === w.worn![0].id)).toMatchObject({ lost, wounds: false });
  });
});
