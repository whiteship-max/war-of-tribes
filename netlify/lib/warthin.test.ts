// Этап 7 аудита, п. 7: выбитые башней в штурме у сервера войны. Обстрел с башни выводится при чтении (`bombard.thinAt`) и
// списывается с войска одним разом, когда лагерь снят (`turnBack`), — как у лагеря под логовом (`LocalWorld.liftSiege`). Падение
// считается раньше снятия, и обоз у падения — те, кто жив: выбитые башней добычу не несут (у мира — `homeFalls` после
// `liftSiege`).
import { afterEach, describe, expect, it } from 'vitest';
import type { CastleClaim, WarArmy, WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, type SheetAt, type WarFile, type WarRow } from './war.js';
import { setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, type SiegeWindow } from '../../src/world/siege.js';
import { thinAt } from '../../src/world/bombard.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { stackCarry } from '../../src/world/data/units.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;
const THIN = 0.5;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const total = (c: Record<string, number | undefined>): number => Object.values(c).reduce<number>((n, x) => n + (x ?? 0), 0);

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 600 },
  home: { spearman: 2 },
  militia: 0,
  archers: 0,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2_000_000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 1_000_000, wood: 1_000_000, stone: 1_000_000 },
  stash: 0,
  gold: 0,
  pop: 400,
  bonded: 0,
  levels: { farm: 4 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

describe('штурм у сервера войны: выбитые башней не несут добычу (этап 7, п. 7)', () => {
  it('город взят штурмом под обстрелом: добыча — по обозу живых, войско домой — без выбитых', () => {
    setPhaseDie(() => 7);
    let roster = emptyRoster();
    roster = upsert(roster, A, claim('Альфа'), T0);
    roster = upsert(roster, B, claim('Бета'), T0);
    const sheets = new Map<string, SheetAt>([
      [A, { sheet: sheet(), at: T0 }],
      [B, { sheet: sheet(), at: T0 }],
    ]);
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars() as WarFile;
    const army: WarArmy = { troops: { spearman: 600 }, resolve: 0, pips: {} };
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, T0, ctx)).toBeNull();
    const w = file.wars[0] as WarRow;
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
    const since = siegeSince(w.camp as SiegeWindow);
    w.camp = { ...w.camp!, fire: { slow: 0, thin: THIN, at: since, base: THIN } };
    const at = since + 10;
    expect(thinAt(w.camp.fire as never, at), 'точка внутри области: башня выбила половину').toBeCloseTo(THIN, 9);
    advance(file, at, sheets);
    expect(applyOrder(file, A, { op: 'storm', id: w.id }, at, ctx)).toBeNull();
    expect(w.fall?.by, 'точка внутри области: город взят штурмом').toBe('storm');
    const home = total(w.army.troops);
    expect(home, 'выбитые башней списаны, когда лагерь снят').toBeLessThanOrEqual(Math.round(600 * (1 - THIN)));
    const carry = stackCarry({ warrior: home });
    const taken = total(w.fall!.taken);
    expect(taken, 'точка внутри области: добычи больше, чем унести').toBeGreaterThan(0);
    expect(taken, 'добыча — по обозу тех, кто жив').toBeLessThanOrEqual(carry);
  });
});
