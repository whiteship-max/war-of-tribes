// Этап 7 аудита, п. 8: отметки полководца в слепке города (`claimedSheet`, через `liveSheet`) — по войнам игрока в цикле.
// Подозрение: последняя война в цикле перезаписывает отметки. Полководец один (`generalBusy`, BTL-2), войны лежат в записи
// по порядку отправки, и последняя из них — самая свежая: ушёл — отметок дома нет, вернулся — отметки этого похода.
import { afterEach, describe, expect, it } from 'vitest';
import type { CastleClaim, WarArmy, WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, liveSheet, type SheetAt, type WarFile, type WarRow } from './war.js';
import { setPhaseDie } from '../../src/world/siegeroll.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';

const WEEK = 7 * 24 * 3600_000;

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 600 },
  home: { spearman: 600 },
  militia: 0,
  archers: 0,
  resolve: 0,
  pips: { melee: 1 },
  rest: 1,
  food: 2_000_000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 1000 },
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

describe('отметки полководца в слепке — по самой свежей войне (этап 7, п. 8)', () => {
  it('два похода подряд после слепка: в пути — отметок нет, вернулся — отметки последнего', () => {
    setPhaseDie(() => 7);
    let roster = emptyRoster();
    roster = upsert(roster, A, claim('Альфа'), T0);
    roster = upsert(roster, B, claim('Бета'), T0);
    const mine: SheetAt = { sheet: sheet(), at: T0 };
    const sheets = new Map<string, SheetAt>([
      [A, mine],
      [B, { sheet: sheet({ home: { spearman: 450 }, army: { spearman: 450 }, militia: 50 }), at: T0 }],
    ]);
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars() as WarFile;
    const go = (pips: Record<string, number>, at: number): WarRow => {
      const army: WarArmy = { troops: { spearman: 300 }, resolve: 0, pips, energy: { value: ENERGY_MAX, at, mode: 'home' } };
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army }, at, ctx)).toBeNull();
      return file.wars[file.wars.length - 1] as WarRow;
    };
    const first = go({ fire: 1 }, T0 + 1);
    advance(file, first.arriveAt + 1, sheets);
    expect(first.phase, 'точка внутри области: первый поход идёт домой').toBe('back');
    expect(liveSheet(file, A, mine, first.arriveAt + 1).pips, 'первый в пути — отметок дома нет').toEqual({});
    const home1 = first.backAt!;
    advance(file, home1 + 1, sheets);
    expect(liveSheet(file, A, mine, home1 + 1).pips, 'первый вернулся — его отметки').toEqual({ fire: 1 });

    const second = go({ shock: 2 }, home1 + WEEK);
    expect(file.wars.indexOf(second), 'точка внутри области: обе войны в записи').toBe(1);
    expect(liveSheet(file, A, mine, home1 + WEEK + 1).pips, 'второй в пути — отметок дома нет, хоть первый и дома').toEqual({});
    advance(file, second.arriveAt + 1, sheets);
    const home2 = second.backAt!;
    advance(file, home2 + 1, sheets);
    expect(second.phase === 'back' || second.phase === 'done', 'точка внутри области: второй вернулся').toBe(true);
    expect(liveSheet(file, A, mine, home2 + 1).pips, 'второй вернулся — его отметки, а не первого').toEqual({ shock: 2 });
  });
});
