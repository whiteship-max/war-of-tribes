// Голод между игроками (Р-5, docs/siege_v2.md, раздел 21): город берут голодом, только когда хлеб окна осады кончился, и
// хлеба, съеденного за осаду, в добыче нет. Случай из донесения: «Город доели голодом» на третьей фазе, а из склада вынесли
// весь довоенный хлеб — слепок обороны лёг до осады, и падение грабило его, а не то, что осталось в окне.
import { afterEach, describe, expect, it } from 'vitest';
import { type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { foodLeft, siegeSince, starvesAt, type SiegeWindow } from '../../src/world/siege.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;
const FULL = 10_400;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

/** Город из донесения: склад полон всем, гарнизон большой — хлеба в окне на две с половиной фазы. */
const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 400, archer: 200 },
  home: { spearman: 400, archer: 200 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: FULL,
  townPerHour: 1500,
  perManPerHour: 1,
  stock: { food: FULL, wood: FULL, stone: FULL, iron: FULL },
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

function camped() {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const army: WarArmy = { troops: { spearman: 300, archer: 100 }, resolve: 0, pips: {} };
  expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, T0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  return { file, sheets, w };
}

describe('голод между игроками — по хлебу окна осады', () => {
  it('случай из донесения: доели на третьей фазе — хлеба в добыче нет, прочее добро — есть', () => {
    setPhaseDie(() => 7);
    const { file, sheets, w } = camped();
    const camp = w.camp as SiegeWindow;
    const since = siegeSince(camp);
    const end = starvesAt(camp);
    expect(end, 'точка внутри области: голод после второй фазы').toBeGreaterThan(phaseAt(since, 2));
    expect(end, 'и до третьей').toBeLessThan(phaseAt(since, 3));
    advance(file, end + 1, sheets);
    expect(w.fall?.by).toBe('hunger');
    expect(w.fall?.taken.food ?? 0, 'хлеб съеден за осаду — в обоз его не положить').toBe(0);
    expect(w.fall?.lost.food ?? 0, 'и у города его не отнять второй раз').toBe(0);
    expect(w.fall?.taken.wood ?? 0, 'дерево лежит, где лежало').toBeGreaterThan(0);
  });

  it('сдача посреди осады — хлеба в добыче не больше остатка окна в минуту сдачи', () => {
    // Кость 14, стены нет: фаза 1 — пролом, фаза 2 — ворота открыли.
    setPhaseDie(() => 14);
    const { file, sheets, w } = camped();
    const camp = w.camp as SiegeWindow;
    const at = phaseAt(siegeSince(camp), 2);
    const left = Math.floor(foodLeft(camp, at));
    expect(left, 'точка внутри области: хлеб в окне ещё есть, и меньше довоенного').toBeGreaterThan(0);
    expect(left).toBeLessThan(FULL);
    advance(file, at + 1, sheets);
    expect(w.fall?.by).toBe('gates');
    expect(w.fall?.taken.food ?? 0, 'в обозе — остаток окна, а не довоенный склад').toBeLessThanOrEqual(left);
    expect(w.fall?.taken.food ?? 0, 'и он есть: хлеб, что не съели, уносят').toBeGreaterThan(0);
  });
});
