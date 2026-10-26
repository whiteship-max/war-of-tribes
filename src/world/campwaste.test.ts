// АУ-8, п. 3 (OWNER-DECISIONS п. 15, решение владельца 26.10.2026): истощение лагеря за фазу — доля потерь каждого вида,
// дробь округляется костью от сида осады и номера фазы (вероятностное округление). Малые роды тоже тают, и дробление войска
// на мелкие роды от истощения не спасает; в среднем лагерь теряет ровно свою долю — прогноз окна лагеря (`phasesToEven`) тот
// же. Одна дверь — `siegeroll.wasteLosses` у мира (`LocalWorld.wearCamp`) и у сервера войны (`war.phaseStep`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setPhaseDie, wasteLosses, wasteOf, phaseAt, rowsOf } from './siegeroll';
import { siegeSince, type SiegeWindow } from './siege';
import { shareLosses } from '@/game/battle/price';
import { TROOP_IDS } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { CAMP_WASTE } from './data/siegeroll';
import { advance, applyOrder, emptyWars, type SheetAt, type WarRow } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import type { CastleClaim, RosterFile, WarArmy, WarSheet } from '../../netlify/lib/contract';
import { ENERGY_MAX } from './data/energy';

afterEach(() => setPhaseDie(null));

const after = (t: TroopStack, lost: TroopStack): TroopStack => {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (t[id] ?? 0) - (lost[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
};

describe('АУ-8 п. 3: истощение — доля вида, дробь костью', () => {
  it('дробление на мелкие роды не спасает: по пять бойцов каждого вида тают в среднем ровно своей долей', () => {
    const split: TroopStack = Object.fromEntries(TROOP_IDS.map((id) => [id, 5]));
    const share = CAMP_WASTE;
    for (const id of TROOP_IDS) expect((split[id] ?? 0) * share, `точка внутри области: у ${id} доля меньше половины бойца`).toBeLessThan(0.5);
    let lost = 0;
    let had = 0;
    for (let s = 0; s < 200; s++) {
      for (let k = 1; k <= 20; k++) {
        const l = wasteLosses(split, share, `camp-${s}:0`, k);
        lost += troopTotal(l);
        had += troopTotal(split);
      }
    }
    // В среднем — ровно доля: 200 осад × 20 фаз × 45 бойцов, разброс доли — меньше десятой.
    expect(lost / had).toBeGreaterThan(share * 0.9);
    expect(lost / had).toBeLessThan(share * 1.1);
  });

  it('малый род тает: 20 латных всадников за 30 фаз теряют людей; кость — та же на тот же сид и фазу', () => {
    // Прежнее правило (доля рода к ближнему) не снимало у малого рода никого: 2,1 % от 20 всадников — меньше половины веса.
    expect(troopTotal(shareLosses({ knight: 20 }, CAMP_WASTE))).toBe(0);
    let t: TroopStack = { knight: 20, spearman: 200 };
    for (let k = 1; k <= 30; k++) t = after(t, wasteLosses(t, CAMP_WASTE, 'camp-1:0', k));
    expect(t.knight ?? 0).toBeLessThan(20);
    expect(wasteLosses({ knight: 20 }, CAMP_WASTE, 'camp-9:5', 3)).toEqual(wasteLosses({ knight: 20 }, CAMP_WASTE, 'camp-9:5', 3));
    // Целая часть доли снимается всегда: потерь не меньше пола и не больше потолка доли.
    const big: TroopStack = { spearman: 1000, knight: 300 };
    const l = wasteLosses(big, 0.1, 'camp-2:0', 1);
    expect(l.spearman).toBeGreaterThanOrEqual(100);
    expect(l.spearman).toBeLessThanOrEqual(100);
    expect(l.knight).toBe(30);
    expect(wasteLosses({ spearman: 3 }, 1, 'x', 1)).toEqual({ spearman: 3 });
  });

  it('одна дверь: мир и сервер войны снимают истощение фазы `wasteLosses`', () => {
    const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(src('../../netlify/lib/war.ts')).toMatch(/wasteLosses\(/);
    expect(src('./local/LocalWorld.ts')).toMatch(/wasteLosses\(/);
  });
});

// ------------------------------------------------ сервер войны в памяти ---

const T0 = 1_900_000_000_000;
const A = 'tg-2001';
const B = 'tg-2002';
const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const sheet = (): WarSheet => ({
  army: { spearman: 60, archer: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2_000_000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2_000_000, wood: 3000, stone: 1000 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { farm: 4, palisade: 1 },
  power: 5000,
  locks: {},
  seen: [],
});

describe('АУ-8 п. 3: сервер войны — малый род лагеря тает по фазам', () => {
  it('20 латных всадников в лагере — к 15-й фазе их меньше; прежде не уходил ни один', () => {
    setPhaseDie(() => 7);
    let roster: RosterFile = emptyRoster();
    roster = upsert(roster, A, claim('Альфа'), T0);
    roster = upsert(roster, B, claim('Бета'), T0);
    const sheets = new Map<string, SheetAt>([
      [A, { sheet: { ...sheet(), army: { spearman: 200, knight: 20 }, home: { spearman: 200, knight: 20 } }, at: T0 }],
      [B, { sheet: sheet(), at: T0 }],
    ]);
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars();
    const army: WarArmy = { troops: { spearman: 200, knight: 20 }, resolve: 0, pips: {} };
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, T0, ctx)).toBeNull();
    const w = file.wars[0] as WarRow;
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
    const since = siegeSince(w.camp as SiegeWindow);
    advance(file, phaseAt(since, 15) + 1, sheets);
    expect(w.phase, 'точка внутри области: осада идёт').toBe('camp');
    expect(rowsOf(w.camp as SiegeWindow).length).toBe(15);
    expect(rowsOf(w.camp as SiegeWindow).every((r) => r.waste >= wasteOf('calm', 0, false))).toBe(true);
    expect(w.army.troops.knight ?? 0).toBeLessThan(20);
  });
});
