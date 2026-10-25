// АУ-8, п. 4 (OWNER-DECISIONS п. 17, решение владельца 26.10.2026): победа в бою выручки — союзнику, который дрался: счёт
// побед рейтинга (`war.warTally` → `battleWinner`), слава и бой в его партии, донесение. Осаждённому — «осада снята»: его
// гарнизон не выходил, победы и славы ему нет. Правило — с версии правил боя `RELIEF_WIN_RULES` (BTL-0): бой, посчитанный
// раньше, засчитывается, как был.
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { BATTLE_RULES, FIRST_RULES, RELIEF_WIN_RULES } from '@/battle';
import { tribePulse, type PulseTribe } from './bridge';
import { LocalWorld } from './local/LocalWorld';
import type { FigureView, MarchView, PlayerCastle } from './types';
import { reliefCredit } from './pvp';
import { setPhaseDie, phaseAt } from './siegeroll';
import { siegeSince, type SiegeWindow } from './siege';
import { ENERGY_MAX } from './data/energy';
import { advance, applyOrder, battleWinner, emptyWars, warTally, warsOf, type SheetAt, type WarFile, type WarRow } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import type { CastleClaim, RosterFile, WarArmy, WarSheet, WarView } from '../../netlify/lib/contract';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const C = 'tg-2003';
const T0 = 1_900_000_000_000;
const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const sheet = (army: Record<string, number>): WarSheet => ({
  army,
  home: { ...army },
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
});

/** Альфа осадила Бету; Гамма, союзник Беты, бьёт лагерь с тыла — бой выручки на сервере войны в памяти. */
function relieved(): { file: WarFile; w: WarRow } {
  setPhaseDie(() => 7);
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  roster = upsert(roster, C, claim('Гамма'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet({ spearman: 60, archer: 30 }), at: T0 }],
    [B, { sheet: sheet({ spearman: 40, archer: 20 }), at: T0 }],
    [C, { sheet: sheet({ spearman: 400, swordsman: 200 }), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const siege: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: siege }, T0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  const since = siegeSince(w.camp as SiegeWindow);
  expect(applyOrder(file, B, { op: 'pact', target: castleIdOf(C) }, since + 1, ctx)).toBeNull();
  expect(applyOrder(file, C, { op: 'pact', target: castleIdOf(B) }, since + 2, ctx)).toBeNull();
  const army: WarArmy = { troops: { spearman: 400, swordsman: 200 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at: since, mode: 'hold' } };
  expect(applyOrder(file, C, { op: 'relief', id: w.id, army, walkMs: 3_600_000, from: w.to }, since + 3, ctx)).toBeNull();
  const at = w.reliefs?.[0].at ?? 0;
  expect(at, 'точка внутри области: удар раньше фазы').toBeLessThan(phaseAt(since, 1));
  advance(file, at + 1, sheets);
  return { file, w };
}

describe('АУ-8 п. 4: победа в бою выручки — союзнику', () => {
  it('рейтинг: бой выручки по нынешним правилам — победа союзника, а не осаждённого; прежний бой — как был', () => {
    expect(BATTLE_RULES, 'нынешняя версия знает правило').toBeGreaterThanOrEqual(RELIEF_WIN_RULES);
    const { file, w } = relieved();
    const b = w.battles[w.battles.length - 1];
    expect(b.ally).toBe(castleIdOf(C));
    expect(b.won, 'точка внутри области: выручка разбила лагерь').toBe(true);
    expect(reliefCredit(b)).toBe(true);
    expect(battleWinner(w, b)).toBe(C);
    expect(warTally(file)[C]).toEqual({ won: 1, taken: 0 });
    expect(warTally(file)[B], 'осаждённый не дрался').toBeUndefined();
    // Бой, посчитанный до версии правила, засчитывается, как был (BTL-0: старые бои не пересчитываются).
    const old = { ...b, input: { ...b.input, rules: RELIEF_WIN_RULES - 1 } };
    expect(reliefCredit(old)).toBe(false);
    expect(battleWinner(w, old)).toBe(B);
    expect(reliefCredit({ ...b, input: { ...b.input, rules: undefined } }), 'запись без версии — первая').toBe(FIRST_RULES >= RELIEF_WIN_RULES);
  });

  it('партии: союзнику — бой, слава и донесение; осаждённому — «осада снята» без победы и славы', async () => {
    const { file } = relieved();
    const run = async (key: string): Promise<{ s: GameState; world: LocalWorld }> => {
      const list: WarView[] = warsOf(file, key);
      const fights = file.wars[0].battles;
      let now = fights[fights.length - 1].at + 60_000;
      const s = createInitialState();
      // Соседи на карте — как их отдаёт реестр: имя города союзника карточка берёт отсюда.
      const castles = (): PlayerCastle[] => [{ id: castleIdOf(C), x: 0, y: 0, name: 'Гамма', city: 'Гамма', power: 5000, pop: 400, seenAt: T0 }];
      const world = new LocalWorld({ seed: 7, now: () => now, storage: null, castles, wars: () => list, spies: () => [], warsKnown: () => true });
      const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
      let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
      for (let k = 0; k < 3; k++) {
        const p = await tribePulse(world, tribe, last);
        last = { marches: p.marches, figures: p.figures };
        now += 60_000;
      }
      return { s, world };
    };
    const fresh = createInitialState();
    const ally = await run(C);
    expect(ally.s.stats.battlesWon - fresh.stats.battlesWon, 'союзнику — победа').toBe(1);
    expect(ally.s.prestige, 'и слава').toBeGreaterThan(fresh.prestige);
    expect((await ally.world.reports()).some((r) => r.title.startsWith('Выручка: лагерь под'))).toBe(true);
    const town = await run(B);
    expect(town.s.stats.battlesWon - fresh.stats.battlesWon, 'осаждённому победы нет').toBe(0);
    expect(town.s.prestige, 'и славы нет').toBe(fresh.prestige);
    const rep = (await town.world.reports()).find((r) => r.title.startsWith('Выручка из'));
    expect(rep?.title).toBe('Выручка из «Гамма»: осада снята');
    expect(rep?.text).toContain('Осада снята');
  });
});
