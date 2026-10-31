// Вольные замки у бродяги (ПН-10, docs/gdd/path_of_sword.md, 3.11, 3.12, 5.4): окно замка — функциями правил (правило 18), поход —
// приказом серверу войны, итоги — одной дверью партии, каждый раз один раз; «Замок взят» с участью держится за отрядом; лорд вольных
// замков не видит. Сервер войны — в памяти (`advance`, `applyOrder`, `warsOf`), как в `pl1.test.ts`. Путь включён подменой модуля.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam, campGain, foodAfter, setMove, setTrip } from '@/game/sim/roam';
import { takeFight } from '@/game/sim/roamfight';
import { failDeal } from '@/game/sim/contracts';
import { takeSiege, type SiegeLook } from '@/game/sim/roamcastle';
import { roamStub } from '@/game/roamstubs';
import { troopTotal } from '@/game/battle/kinds';
import { advance, applyOrder, emptyWars, warsOf, type WarFile } from '../../netlify/lib/war';
import { emptyRoster, freeViews } from '../../netlify/lib/roster';
import type { RosterFile } from '../../netlify/lib/contract';
import { RoamWorld, type RoamPort } from './local/RoamWorld';
import { LocalWorld } from './local/LocalWorld';
import { SICILY } from './spawn';
import type { Spot } from './land';
import { roamSeat } from './roam';
import { castellanOf, freeId, freeName, freePrestige, freeTroops } from './freecastle';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const SEED = 20261030;
const T0 = Date.UTC(2026, 9, 30, 12);
const HOME: Spot = SICILY[0];
const KEY = 'tg-7001';
const FREE_AT = { x: HOME.x + 1, y: HOME.y };
const FREE = freeId(FREE_AT.x, FREE_AT.y);
const SYNC = {} as Parameters<RoamWorld['sync']>[0];
const STRONG = { knight: 400, legionary: 500, archer: 300 };

function party(band: Record<string, number> = STRONG, prestige = 1000): GameState {
  const s = createInitialState(SEED);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band, purse: 100, food: 2000 })).toBeNull();
  setMove(s, roamSeat(HOME, T0));
  s.prestige = prestige;
  return s;
}

/** Мир бродяги на сервере войны в памяти: реестр с отрядом и замком пула, запись войн, часы. */
function game(s: GameState) {
  let now = T0;
  const file: WarFile = emptyWars();
  const roster: RosterFile = {
    ...emptyRoster(),
    bands: { [KEY]: { way: roamSeat(HOME, T0).way, born: T0, name: 'Ратко', prestige: s.prestige, men: troopTotal(s.roam?.band ?? {}), seenAt: T0, book: { troops: { ...(s.roam?.band ?? {}) }, join: -1, drill: 0, fights: 0, grant: 0, keys: [] } } },
    free: { [FREE]: { ...FREE_AT, tier: 1, born: T0 } },
  };
  const ctx = { roster, sheet: () => null, roamOpen: true };
  const lines: string[] = [];
  const port: RoamPort = {
    band: () => s.roam ?? null,
    apply: (m) => void setMove(s, m),
    foodAfter: (ms, g) => foodAfter(s, ms, g),
    campGain: (k, open) => campGain(s, k, open),
    partyTime: () => s.time,
    prestige: () => s.prestige,
    setTrip: (t) => setTrip(s, t),
    fight: (f) => takeFight(s, f),
    failDeal: (id, why) => failDeal(s, id, why),
    free: () => freeViews(roster, KEY, file.free ?? {}, HOME, 200, now),
    wars: () => (advance(file, now, new Map()), warsOf(file, KEY)),
    warOrder: async (o) => (advance(file, now, new Map()), applyOrder(file, KEY, o, now, ctx)),
    siege: (look) => {
      const got = takeSiege(s, look);
      lines.push(...got);
      return got;
    },
  };
  const world = new RoamWorld({ seed: SEED, storage: null, now: () => now, home: HOME }, port);
  return { world, file, roster, lines, at: (t: number) => void (now = t), now: () => now };
}

describe('ПН-10: окно вольного замка — функциями правил', () => {
  it('гарнизон по сведениям, казна, кастелян и доступ — те же числа, что у сервера войны', async () => {
    const g = game(party());
    const v = await g.world.roamFree?.(FREE);
    if (!v || typeof v === 'string') throw new Error(`окна нет: ${v}`);
    const men = troopTotal(freeTroops(FREE, 1));
    // Отряд стоит у стен (точка внутри области: стоит и замок в круге обзора) — гарнизон точкой, правилом ступени (ПН-Э2б, `freeLook`).
    expect(v.garrison, 'видим стены — точкой').toMatchObject({ lo: men, hi: men, watching: true });
    expect(v.castellan).toBe(castellanOf(FREE_AT.x, FREE_AT.y));
    expect(v.name).toBe(freeName(FREE_AT.x, FREE_AT.y));
    expect(v.prestige.need).toBe(freePrestige(1));
    expect(v.near, 'точка внутри области: отряд у стен').toBe(true);
    expect(v.block).toBeNull();
    expect(v.fates.map((f) => f.id)).toEqual(['occupy', 'plunder', 'captives', 'burn']);
  });

  it('престижа мало — окно говорит словами правила, и поход не уходит', async () => {
    const g = game(party(STRONG, freePrestige(1) - 1));
    const v = await g.world.roamFree?.(FREE);
    if (!v || typeof v === 'string') throw new Error('окна нет');
    expect(v.block).toMatch(/нужен престиж/);
    expect(await g.world.roamSiege?.(FREE, 'storm', 'occupy')).toBe(v.block);
    expect(g.file.wars).toHaveLength(0);
  });
});

describe('ПН-10: штурм с ходу у бродяги — «Замок взят» одной дверью', () => {
  it('приказ → бой на сервере → итог в партии один раз: павшие с отряда, замок за отрядом, «Сесть в замке» — позже', async () => {
    const s = party();
    const g = game(s);
    expect(await g.world.roamSiege?.(FREE, 'storm', 'occupy')).toBeNull();
    const w = g.file.wars[0];
    g.at(w.arriveAt + 1);
    await g.world.sync(SYNC);
    expect(w.end, 'точка внутри области: замок взят штурмом').toBe('taken');
    const lost = troopTotal(w.battles[0].atkLost as never);
    expect(troopTotal(s.roam?.band ?? {}), 'павшие ушли из отряда').toBe(troopTotal(STRONG) - lost);
    expect(s.roam?.castle).toMatchObject({ id: FREE, fate: 'occupy', tier: 1, war: w.id });
    const band = { ...s.roam?.band };
    const said = g.lines.length;
    await g.world.sync(SYNC);
    expect(s.roam?.band, 'второй пульс итог не кладёт').toEqual(band);
    expect(g.lines.length).toBe(said);
    const chunk = await g.world.region({ x: FREE_AT.x - 2, y: FREE_AT.y - 2, w: 5, h: 5 });
    expect(chunk.free?.find((m) => m.id === FREE)?.held).toBe('mine');
    const src = readFileSync(join(__dirname, '../ui/map/roam/RoamCastle.tsx'), 'utf8');
    expect(src, '«Сесть в замке» погашена до перехода (ПН-11)').toMatch(/<button className="nx-go" disabled title=\{SEAT_LATER\}>\s*Сесть в замке/);
  });

  it('в осаде отряд не ходит: сперва отступить', async () => {
    const g = game(party());
    expect(await g.world.roamSiege?.(FREE, 'siege', 'occupy')).toBeNull();
    g.at(g.file.wars[0].arriveAt + 1);
    const said = await g.world.roamTo?.({ x: HOME.x + 5, y: HOME.y }, 'normal');
    expect(said).toMatch(/в осаде/);
    // Окно хода называет тот же отказ до приказа — одним правилом с приказом и сервером (ПН-Э1, `world/roam.siegeHoldBlock`).
    const plan = await g.world.roamPlan?.({ x: HOME.x + 5, y: HOME.y });
    expect(typeof plan === 'object' && plan ? plan.block : plan).toBe(said);
  });
});

describe('ПН-10: дверь партии осады — каждый итог один раз', () => {
  const look = (over: Partial<SiegeLook> = {}): SiegeLook => ({ war: 'w1', id: FREE, name: 'Рокка', tier: 1, went: { spearman: 10 }, army: { spearman: 10 }, battles: [], ...over });

  it('истощение лагеря — разница войска без павших в боях; сожжённый замок не взят; снята осада — престиж минус доля', () => {
    const s = party({ spearman: 10 }, 500);
    takeSiege(s, look({ army: { spearman: 8 } }));
    expect(s.roam?.band.spearman, 'двое ушли истощением').toBe(8);
    takeSiege(s, look({ army: { spearman: 8 } }));
    expect(s.roam?.band.spearman, 'повтор не снимает второй раз').toBe(8);
    takeSiege(s, look({ army: { spearman: 8 }, fall: { at: T0, fate: 'burn', taken: {}, led: 0 } }));
    expect(s.roam?.castle, 'сожжён — не взят').toBeUndefined();
    const before = s.prestige;
    takeSiege(s, look({ war: 'w2', army: { spearman: 8 }, went: { spearman: 8 }, end: { end: 'lifted', at: T0 } }));
    expect(s.prestige).toBeCloseTo(before * (1 - roamStub('defeatPrestige')), 6);
    takeSiege(s, look({ war: 'w3', army: { spearman: 8 }, went: { spearman: 8 }, end: { end: 'gone', at: T0 } }));
    expect(s.roam?.band.spearman, 'замок взял другой — лагерь снят без потерь').toBe(8);
  });
});

describe('ПН-10: лорд вольных замков не видит', () => {
  it('у мира лорда нет ни окна замка, ни строк пула на карте', async () => {
    const lord = new LocalWorld({ seed: SEED, storage: null, now: () => T0, home: HOME });
    expect('roamFree' in lord).toBe(false);
    expect('roamSiege' in lord).toBe(false);
    const chunk = await lord.region({ x: HOME.x - 3, y: HOME.y - 3, w: 7, h: 7 });
    expect(chunk.free).toBeUndefined();
  });
});
