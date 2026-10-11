// Осадные машины и способ штурма между игроками (docs/siege_v2.md, 4.3–4.4; этап 2в): машины строит лагерь у сервера той же
// дверью, что у мира (`world/engines`), штурм собирает фронт стеной-проходом (`world/wall`), отбитый штурм лагерь не снимает.
import { afterEach, describe, expect, it } from 'vitest';
import { readWarOrder, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, type SiegeWindow } from '../../src/world/siege.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { enginesAt } from '../../src/world/engines.js';
import { ENGINE_WOOD, MOD_ENGINE } from '../../src/world/data/engines.js';
import { CAMP_WORKS_RIPE, PLAYER_CAMP_WOOD } from '../../src/world/data/tuning.js';
import { wallFront } from '../../src/world/wall.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 20000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

function camped(def: Partial<WarSheet> = {}) {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(def), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const army: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army }, T0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
  return { file, ctx, sheets, w, since: siegeSince(w.camp as SiegeWindow) };
}

describe('машины лагеря у сервера войны', () => {
  it('приказы разбираются из тела: доля леса из шагов, машина из списка, способ штурма без чужих имён', () => {
    expect(readWarOrder({ op: 'wood', id: 'x', engines: 0.5 })).toEqual({ op: 'wood', id: 'x', engines: 0.5 });
    expect(readWarOrder({ op: 'wood', id: 'x', engines: 0.3 })).toBeNull();
    expect(readWarOrder({ op: 'engine', id: 'x', engine: 'ram' })).toEqual({ op: 'engine', id: 'x', engine: 'ram' });
    expect(readWarOrder({ op: 'engine', id: 'x', engine: 'dragon' })).toBeNull();
    expect(readWarOrder({ op: 'storm', id: 'x', engines: ['ram', 'dragon', 'ram'] })).toEqual({ op: 'storm', id: 'x', engines: ['ram'] });
  });

  it('лес машинам и заказ — той же дверью, что у мира; вторую машину рода не заказать', () => {
    setPhaseDie(() => 7);
    const { file, ctx, w, since } = camped();
    expect(applyOrder(file, A, { op: 'wood', id: w.id, engines: 1 }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'wood', id: w.id, engines: 1 }, since + 2, ctx)).toMatch(/и так/);
    expect(applyOrder(file, A, { op: 'engine', id: w.id, engine: 'ram' }, since + 2, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'engine', id: w.id, engine: 'ram' }, since + 3, ctx)).toMatch(/строится/);
    // Защитник машин лагеря не заказывает.
    expect(applyOrder(file, B, { op: 'engine', id: w.id, engine: 'ladders' }, since + 3, ctx)).not.toBeNull();
    const ready = since + 1 + (ENGINE_WOOD.ram / PLAYER_CAMP_WOOD) * CAMP_WORKS_RIPE;
    expect(enginesAt(w.camp as SiegeWindow, ready + 10)[0].ready).toBe(true);
  });

  it('штурм машинами: фронт — стена-проход из пущенного, машина истрачена, проёмы в записи боя', () => {
    setPhaseDie(() => 7);
    // Гарнизон сильный — штурм отобьют, и лагерь останется: видно, что лестницы истрачены.
    const { file, ctx, sheets, w, since } = camped({ home: { spearman: 200, archer: 120, swordsman: 120 }, militia: 120, archers: 40 });
    applyOrder(file, A, { op: 'wood', id: w.id, engines: 1 }, since + 1, ctx);
    applyOrder(file, A, { op: 'engine', id: w.id, engine: 'ladders' }, since + 1, ctx);
    const at = since + 1 + (ENGINE_WOOD.ladders / PLAYER_CAMP_WOOD) * CAMP_WORKS_RIPE + 1;
    expect(at, 'точка внутри области: до голода').toBeLessThan(w.starvesAt ?? Infinity);
    advance(file, at, sheets);
    expect(applyOrder(file, A, { op: 'storm', id: w.id, engines: ['ladders'] }, at, ctx)).toBeNull();
    const b = w.battles[w.battles.length - 1];
    expect(b.site).toBe('wall');
    const front = wallFront({ breaches: 0, ladders: true });
    expect(b.input.width).toBeCloseTo(front.width, 9);
    expect(b.input.ground?.wall).toBe(front.wall);
    expect(b.openings?.map((o) => o.id)).toEqual(['ladders']);
    expect(b.won, 'точка внутри области: штурм отбит, лагерь стоит').toBe(false);
    expect(enginesAt(w.camp as SiegeWindow, at + 1).some((e) => e.ready), 'лестницы истрачены').toBe(false);
  });

  it('отбитый штурм лагерь не снимает: осада идёт дальше с теми, кто уцелел', () => {
    setPhaseDie(() => 7);
    // Гарнизон втрое сильнее похода — штурм отобьют; точка внутри области проверена ниже.
    const { file, ctx, sheets, w, since } = camped({ home: { spearman: 200, archer: 120, swordsman: 120 }, militia: 120, archers: 40 });
    const at = since + 10;
    advance(file, at, sheets);
    expect(applyOrder(file, A, { op: 'storm', id: w.id }, at, ctx)).toBeNull();
    const b = w.battles[w.battles.length - 1];
    expect(b.won, 'точка внутри области: штурм отбит').toBe(false);
    const left = Object.values(w.army.troops).reduce((n, x) => n + (x ?? 0), 0);
    expect(left, 'точка внутри области: уцелевшие есть').toBeGreaterThan(0);
    expect(w.phase).toBe('camp');
    expect(w.end).toBeUndefined();
  });

  it('камнемёт в лагере — +1 к кости фазы у сервера', () => {
    setPhaseDie(() => 7);
    const { file, ctx, sheets, w, since } = camped();
    applyOrder(file, A, { op: 'wood', id: w.id, engines: 1 }, since + 1, ctx);
    applyOrder(file, A, { op: 'engine', id: w.id, engine: 'catapult' }, since + 1, ctx);
    const ready = since + 1 + (ENGINE_WOOD.catapult / PLAYER_CAMP_WOOD) * CAMP_WORKS_RIPE;
    const k = Math.ceil((ready - since) / (phaseAt(since, 1) - since));
    expect(phaseAt(since, k), 'точка внутри области: фаза k после готовности, до голода').toBeLessThan(w.starvesAt ?? Infinity);
    advance(file, phaseAt(since, k) + 1, sheets);
    const rows = w.camp?.phases ?? [];
    expect(rows[k - 1]?.mods.engine).toBe(MOD_ENGINE);
    expect(rows[k - 2]?.mods.engine).toBeUndefined();
  });
});
