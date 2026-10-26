// Режим марша в войне между игроками на двух мирах с сервером войны в памяти (ДР-2, docs/siege_v2.md, 25.1; харнесс — как
// `campmelt.test.ts`). Области правил — утверждением в самом тесте (правило 11):
// - налегке войско похода тает в пути у сервера, и вся убыль не в бою доходит до племени — разницей с прошлым пульсом
//   (`LocalWorld.warAttrition`), без двойного счёта с павшими в боях: дорога длиннее суток, бой был;
// - окно лагеря с обозом говорит тот же темп таяния, что у шага сервера: лагерь встал, амбар нападающего полон и пуст;
// - убыль лагеря за фазы (истощение) тоже доходит до племени — прежде она не доходила вовсе.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, warsOf, type SheetAt, type WarRow } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';
import { phaseAt, setPhaseDie, wasteOf } from './siegeroll';
import { siegeSince, type SiegeWindow } from './siege';
import { CAMP_WASTE } from './data/siegeroll';
import { lightShare } from './gait';
import { troopTotal } from '@/game/battle/kinds';

vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

afterEach(() => setPhaseDie(null));

const T0 = 1_900_000_000_000;
const A = 'tg-2001';
const B = 'tg-2002';
const SQUAD = { spearman: 60, swordsman: 30, archer: 30 };

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const profile = (army: Record<string, number>, food = 30000): PlayerProfile => ({
  name: 'Тест',
  pop: 400,
  defense: 300,
  militia: 20,
  militiaArchers: 6,
  units: { warrior: 120, scout: 4 },
  army,
  stock: { food, wood: 800, stone: 300 },
  stash: 50,
  gold: 300,
  food,
  foodPerHour: 30,
  soldierFoodPerHour: 1,
});

function game(def: Record<string, number>) {
  let now = T0;
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const file = emptyWars();
  const sheets = new Map<string, SheetAt | null>();
  const castlesFor = (me: string): (() => PlayerCastle[]) => () =>
    Object.entries(roster.rows)
      .filter(([k]) => k !== me)
      .map(([k, r]) => ({ id: castleIdOf(k), x: r.x, y: r.y, name: r.name, city: r.city, power: r.power, pop: r.pop, seenAt: r.seenAt }));
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const link = (me: string) => ({
    wars: () => {
      advance(file, now, sheets);
      return warsOf(file, me);
    },
    warsKnown: () => true,
    warOrder: async (o: WarOrder) => {
      advance(file, now, sheets);
      return applyOrder(file, me, o, now, ctx);
    },
  });
  const world = (me: string): LocalWorld =>
    new LocalWorld({ seed: me === A ? 11 : 12, now: () => now, storage: null, home: roster.rows[me], castles: castlesFor(me), ...link(me) });
  const a = world(A);
  const b = world(B);
  /** Пульс обоих; убыль войска похода Альфы из последствий войны — тем, что уходит в племя. */
  let lost = 0;
  const pulse = async (): Promise<void> => {
    const res = await a.sync(profile(SQUAD));
    // Только последствия войны (бой и убыль похода): набег логова на дом Альфы — своё дело.
    for (const e of res.effects) if (e.id.startsWith('war-')) lost += troopTotal(e.lostTroops ?? {});
    await b.sync(profile(def));
    sheets.set(A, { sheet: a.warSheet()!, at: now });
    sheets.set(B, { sheet: b.warSheet()!, at: now });
  };
  return { a, file, pulse, lost: () => lost, now: () => now, step: (ms: number) => (now += ms), target: castleIdOf(B) };
}

async function squad(g: ReturnType<typeof game>): Promise<void> {
  await g.pulse();
  expect(await g.a.setGarrison({ ...SQUAD })).toBeNull();
  for (let i = 0; i < 100 && (await g.a.figures()).find((f) => f.id === 'general')!.readyAt > g.now(); i++) {
    g.step(5 * 60_000);
    await g.pulse();
  }
  await g.pulse();
}

const general = async (g: ReturnType<typeof game>) => (await g.a.figures()).find((f) => f.id === 'general')!;

describe('режим марша в войне: убыль похода доходит до племени', () => {
  it('налегке штурм с ходу: у стены — дошедшие, а всё, что ушло в пути и в бою, — в племени ровно один раз', async () => {
    const g = game({ spearman: 30, archer: 10 });
    await squad(g);
    expect(await g.a.setGait('light')).toBeNull();
    expect(await g.a.warMarch(g.target, 'storm', 'plunder')).toBeNull();
    const war = g.file.wars[0] as WarRow;
    expect(war.gait).toBe('light');
    expect(lightShare('light', war.arriveAt - war.sentAt), 'точка внутри области: дорога больше суток').toBeGreaterThan(0.005);
    // Частые пульсы по дороге, бой у стены, возврат домой.
    while (g.now() < war.arriveAt + 1000) {
      g.step(Math.min(20 * 60_000, war.arriveAt + 1000 - g.now()));
      await g.pulse();
    }
    expect(war.battles.length, 'бой был').toBe(1);
    const fought = war.battles[0].atkTroops as Record<string, number>;
    expect(troopTotal(fought), 'к стене пришли не все').toBeLessThan(troopTotal(SQUAD));
    g.step((war.backAt ?? g.now()) - g.now() + 1000);
    await g.pulse();
    expect(war.phase).toBe('done');
    const home = troopTotal((await general(g)).troops);
    expect(g.lost(), 'убыль похода — в племени, ровно').toBe(troopTotal(SQUAD) - home);
  }, 120_000);

  it('с обозом: окно лагеря тает базой — тем же темпом, что шаг сервера; убыль лагеря за фазы — в племени', async () => {
    setPhaseDie(() => 7);
    const g = game({ spearman: 40, archer: 20, swordsman: 20 });
    await squad(g);
    expect(await g.a.setGait('train')).toBeNull();
    expect(await g.a.warMarch(g.target, 'siege', 'plunder')).toBeNull();
    const war = g.file.wars[0] as WarRow;
    g.step(war.arriveAt - g.now() + 1000);
    await g.pulse();
    expect(war.phase, 'точка внутри области: лагерь встал').toBe('camp');
    const camp = war.camp as SiegeWindow;
    expect(camp.gait).toBe('train');
    expect(camp.homeDays ?? 0, 'лагерь не у своих ворот').toBeGreaterThan(0);
    const view = (await g.a.camp())!;
    expect(view.melt?.waste).toBeCloseTo(CAMP_WASTE, 12);
    expect(view.melt?.waste).toBeLessThan(wasteOf('calm', camp.homeDays, false));
    const before = g.lost();
    for (let k = 1; k <= 3 && war.phase === 'camp'; k++) {
      g.step(phaseAt(siegeSince(war.camp as SiegeWindow), k) - g.now() + 1000);
      await g.pulse();
    }
    const gone = troopTotal(SQUAD) - troopTotal(war.army.troops as Record<string, number>);
    expect(war.battles.length, 'боёв не было — убыль только от фаз').toBe(0);
    expect(gone, 'лагерь таял').toBeGreaterThan(0);
    expect(g.lost() - before, 'истощение лагеря — в племени').toBe(gone);
  }, 120_000);
});
