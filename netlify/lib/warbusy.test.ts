// Один полководец — одно действие (BTL-2, docs/audit/OWNER-DECISIONS.md, п. 9): свой поход, выручка союзника в пути и удар по
// лагерю у своих стен исключают друг друга у сервера войны — одной проверкой `generalBusy` во всех трёх приказах. Прежде
// полководец, ушедший на выручку, мог ещё и выйти в поход тем же отрядом (архив round2/prove-17-1), а выручка и удар по
// лагерю у своих стен шли разом (prove-18-1).
import { afterEach, describe, expect, it } from 'vitest';
import type { CastleClaim, RosterFile, WarArmy, WarOrder, WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, generalBusy, type SheetAt, type WarFile, type WarRow } from './war.js';
import { setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, GENERAL_RELIEVES, GENERAL_STRIKES, type SiegeWindow } from '../../src/world/siege.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';

afterEach(() => setPhaseDie(null));

const [A, B, C, D] = ['tg-2001', 'tg-2002', 'tg-2003', 'tg-2004'];
const T0 = 1_900_000_000_000;
const NAMES: Record<string, string> = { [A]: 'Альфа', [B]: 'Бета', [C]: 'Гамма', [D]: 'Дельта' };
const claim = (n: string): CastleClaim => ({ name: n, city: n, power: 5000, pop: 400 });
const sheet = (): WarSheet =>
  ({
    army: { spearman: 60, archer: 30, swordsman: 30 },
    home: { spearman: 40, archer: 20 },
    militia: 20,
    archers: 6,
    resolve: 0,
    pips: {},
    rest: 1,
    food: 2000,
    townPerHour: 20,
    perManPerHour: 1,
    stock: { food: 2000, wood: 3000, stone: 1000 },
    stash: 100,
    gold: 400,
    pop: 400,
    bonded: 20,
    levels: { farm: 4, palisade: 1 },
    power: 5000,
    locks: {},
    seen: [],
  }) as WarSheet;

/** Четыре города рядом: C и D осаждают A и B, A и B — союзники по пакту. Лагеря стоят. */
function world() {
  setPhaseDie(() => 7);
  let roster: RosterFile = emptyRoster();
  for (const k of [A, B, C, D]) roster = upsert(roster, k, claim(NAMES[k]), T0);
  const base = roster.rows[A];
  [B, C, D].forEach((k, i) => (roster.rows[k] = { ...roster.rows[k], x: base.x + 3 + i, y: base.y + 2 }));
  const sheets = new Map<string, SheetAt>([A, B, C, D].map((k) => [k, { sheet: sheet(), at: T0 }]));
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const camp: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  expect(applyOrder(file, C, { op: 'march', target: castleIdOf(A), mode: 'siege', fate: 'captives', army: camp }, T0, ctx)).toBeNull();
  expect(applyOrder(file, D, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army: camp }, T0, ctx)).toBeNull();
  const [onA, onB] = file.wars as WarRow[];
  const t = Math.max(onA.arriveAt, onB.arriveAt) + 1;
  advance(file, t, sheets);
  expect(onA.phase, 'точка внутри области: лагерь под A стоит').toBe('camp');
  expect(onB.phase, 'точка внутри области: лагерь под B стоит').toBe('camp');
  const since = Math.max(siegeSince(onA.camp as SiegeWindow), siegeSince(onB.camp as SiegeWindow));
  expect(applyOrder(file, A, { op: 'pact', target: castleIdOf(B) }, since + 1, ctx)).toBeNull();
  expect(applyOrder(file, B, { op: 'pact', target: castleIdOf(A) }, since + 2, ctx)).toBeNull();
  const army: WarArmy = { troops: { spearman: 10 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at: since, mode: 'hold' } };
  const relief = (w: WarRow): WarOrder => ({ op: 'relief', id: w.id, army, walkMs: 3_600_000, from: w.to });
  const strike = (w: WarRow): WarOrder => ({ op: 'strike', id: w.id, army, walkMs: 0, from: w.to, joint: false }) as WarOrder;
  return { file, ctx, onA, onB, at: since + 3, relief, strike };
}

describe('один полководец — одно действие', () => {
  it('выручка, потом удар по лагерю у своих стен — отказ (prove-18-1)', () => {
    const { file, ctx, onA, onB, at, relief, strike } = world();
    expect(applyOrder(file, A, relief(onB), at, ctx)).toBeNull();
    expect(onB.reliefs?.length).toBe(1);
    expect(generalBusy(file, A)).toBe(GENERAL_RELIEVES);
    expect(applyOrder(file, A, strike(onA), at + 1, ctx)).toBe(GENERAL_RELIEVES);
    expect(onA.strike).toBeUndefined();
  });

  it('удар по лагерю у своих стен, потом выручка — отказ (prove-18-1)', () => {
    const { file, ctx, onA, onB, at, relief, strike } = world();
    expect(applyOrder(file, A, strike(onA), at, ctx)).toBeNull();
    expect(onA.strike).toBeTruthy();
    expect(generalBusy(file, A)).toBe(GENERAL_STRIKES);
    expect(applyOrder(file, A, relief(onB), at + 1, ctx)).toBe(GENERAL_STRIKES);
    expect(onB.reliefs).toBeUndefined();
  });

  it('выручка, потом поход тем же отрядом — отказ (prove-17-1)', () => {
    // A осаждает B, B и C — союзники; C не в осаде и не в походе: идёт на выручку, а потом — походом на A.
    setPhaseDie(() => 7);
    let roster: RosterFile = emptyRoster();
    for (const k of [A, B, C]) roster = upsert(roster, k, claim(NAMES[k]), T0);
    roster.rows[C] = { ...roster.rows[C], x: roster.rows[B].x + 1, y: roster.rows[B].y };
    const sheets = new Map<string, SheetAt>([A, B, C].map((k) => [k, { sheet: sheet(), at: T0 }]));
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars() as WarFile;
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army: { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} } }, T0, ctx)).toBeNull();
    const w = file.wars[0] as WarRow;
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь под B стоит').toBe('camp');
    const since = siegeSince(w.camp as SiegeWindow);
    expect(applyOrder(file, B, { op: 'pact', target: castleIdOf(C) }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, C, { op: 'pact', target: castleIdOf(B) }, since + 2, ctx)).toBeNull();
    const army: WarArmy = { troops: { spearman: 60, swordsman: 30 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at: since, mode: 'hold' } };
    expect(applyOrder(file, C, { op: 'relief', id: w.id, army, walkMs: 3_600_000, from: w.to }, since + 3, ctx)).toBeNull();
    expect(generalBusy(file, C), 'точка внутри области: C не в походе и не в осаде — занят только выручкой').toBe(GENERAL_RELIEVES);
    const march: WarOrder = { op: 'march', target: castleIdOf(A), mode: 'siege', fate: 'captives', army };
    expect(applyOrder(file, C, march, since + 4, ctx)).toBe(GENERAL_RELIEVES);
    expect(file.wars.filter((x) => x.atk === C)).toEqual([]);
  });

  it('полководец свободен — проверка молчит; выручка прошла — снова свободен', () => {
    const { file, ctx, onB, at, relief } = world();
    expect(generalBusy(file, A)).toBeNull();
    expect(applyOrder(file, A, relief(onB), at, ctx)).toBeNull();
    expect(generalBusy(file, A)).toBe(GENERAL_RELIEVES);
    delete onB.reliefs;
    expect(generalBusy(file, A)).toBeNull();
  });
});
