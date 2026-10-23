// Лагерь тает (ОС-1б, docs/siege_v2.md, 23.9): окно лагеря под городом игрока говорит, во сколько лагерь сильнее гарнизона, сколько
// он теряет за фазу и через сколько фаз штраф к полям города упадёт к среднему. Числа — дверью хлеба (`siegefood.ratioOfCut`,
// `phasesToEven`) и хода осады (`siegeroll.wasteOf`); прогноз сверяется с тем, когда сервер войны на самом деле опускает штраф.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, warsOf, type SheetAt, type WarRow } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';
import { phasesToEven, ratioOfCut, siegeCut } from './siegefood';
import { CUT_MAX, CUT_MID, CUT_MIN, CUT_RATIO_EVEN, CUT_RATIO_STRONG, CUT_RATIO_WEAK } from './data/siegefood';
import { phaseAt, rowsOf, setPhaseDie, wasteOf } from './siegeroll';
import { siegeSince, type SiegeWindow } from './siege';

// Энергия агентов здесь не предмет проверки (как в `pvp.test.ts`): дорога её не берёт.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

afterEach(() => setPhaseDie(null));

describe('ОС-1б: соотношение по штрафу — обратная кривая', () => {
  it('внутри кривой — точное число: штраф от него тот же; за краями — граница', () => {
    for (let i = 1; i < 40; i++) {
      const cut = CUT_MIN + ((CUT_MAX - CUT_MIN) * i) / 40;
      expect(cut, 'точка внутри области: между краями кривой').toBeGreaterThan(CUT_MIN);
      expect(cut).toBeLessThan(CUT_MAX);
      const r = ratioOfCut(cut);
      expect(r.bound, `штраф ${cut}: не граница`).toBeUndefined();
      expect(siegeCut(r.ratio)).toBeCloseTo(cut, 9);
      expect(r.ratio).toBeGreaterThan(CUT_RATIO_WEAK);
      expect(r.ratio).toBeLessThan(CUT_RATIO_STRONG);
    }
    expect(ratioOfCut(CUT_MID).ratio).toBeCloseTo(CUT_RATIO_EVEN, 9);
    expect(ratioOfCut(CUT_MAX)).toEqual({ ratio: CUT_RATIO_STRONG, bound: 'min' });
    expect(ratioOfCut(CUT_MIN)).toEqual({ ratio: CUT_RATIO_WEAK, bound: 'max' });
  });
});

describe('ОС-1б: через сколько фаз штраф упадёт к среднему', () => {
  it('ровно столько фаз: после них лагерь не сильнее гарнизона, на фазу раньше — ещё сильнее', () => {
    for (const ratio of [1.01, 1.1, 1.25, 1.49, 1.5, 2, 3.7]) {
      for (const waste of [0.01, 0.028, 0.04, 0.056, 0.2]) {
        const k = phasesToEven(ratio, waste)!;
        expect(ratio, 'точка внутри области: лагерь сильнее гарнизона').toBeGreaterThan(CUT_RATIO_EVEN);
        expect(k).toBeGreaterThanOrEqual(1);
        expect(ratio * (1 - waste) ** k, `×${ratio}, ${waste}: после ${k} фаз`).toBeLessThanOrEqual(CUT_RATIO_EVEN);
        expect(ratio * (1 - waste) ** (k - 1), `×${ratio}, ${waste}: за фазу до`).toBeGreaterThan(CUT_RATIO_EVEN);
      }
    }
  });

  it('уже не сильнее — ноль; гарнизона нет или лагерь не тает — не упадёт', () => {
    expect(phasesToEven(1, 0.04)).toBe(0);
    expect(phasesToEven(0.7, 0.04)).toBe(0);
    expect(phasesToEven(Infinity, 0.04)).toBeNull();
    expect(phasesToEven(1.3, 0)).toBeNull();
    expect(phasesToEven(Number.NaN, 0.04)).toBeNull();
  });
});

// ------------------------------------------------------------------ настоящая война ---

const T0 = 1_900_000_000_000;
const A = 'tg-2001';
const B = 'tg-2002';

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const profile = (army: Record<string, number>): PlayerProfile => ({
  name: 'Тест',
  pop: 400,
  defense: 300,
  militia: 20,
  militiaArchers: 6,
  units: { warrior: 120, scout: 4 },
  army,
  stock: { food: 30000, wood: 800, stone: 300 },
  stash: 50,
  gold: 300,
  food: 30000,
  foodPerHour: 30,
  soldierFoodPerHour: 1,
});

/** Два мира и сервер войны в памяти (как `pvp.test.ts`): Альфа осаждает Бету, у Беты гарнизон `def`. */
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
  const pulse = async (): Promise<void> => {
    await a.sync(profile({ spearman: 60, archer: 30, swordsman: 30 }));
    await b.sync(profile(def));
    sheets.set(A, { sheet: a.warSheet()!, at: now });
    sheets.set(B, { sheet: b.warSheet()!, at: now });
  };
  return { a, file, pulse, now: () => now, step: (ms: number) => (now += ms), target: castleIdOf(B) };
}

describe('ОС-1б: окно лагеря под городом игрока — лагерь тает', () => {
  it('числа окна — дверью хлеба и хода осады; штраф становится средним в названном шаге (до фазы: дробь бойцов)', async () => {
    // Кость «без перемен»: фазы только истощают лагерь, исход их не кончает.
    setPhaseDie(() => 7);
    // Гарнизон того же состава, что лагерь, на пятую часть меньше: ×1,25 — внутри кривой.
    const g = game({ spearman: 48, archer: 24, swordsman: 24 });
    await g.pulse();
    expect(await g.a.setGarrison({ spearman: 60, swordsman: 30, archer: 30 })).toBeNull();
    for (let i = 0; i < 100 && (await g.a.figures()).find((f) => f.id === 'general')!.readyAt > g.now(); i++) {
      g.step(5 * 60_000);
      await g.pulse();
    }
    await g.pulse();
    expect(await g.a.warMarch(g.target, 'siege', 'plunder')).toBeNull();
    const war = g.file.wars[0] as WarRow;
    g.step(war.arriveAt - g.now() + 1000);
    await g.pulse();
    expect(war.phase, 'точка внутри области: лагерь встал').toBe('camp');

    const camp = war.camp as SiegeWindow;
    const view = (await g.a.camp())!;
    const m = view.melt!;
    expect(m, 'под городом игрока окно лагеря знает, что лагерь тает').toBeDefined();
    // Числа — функциями двери, по штрафу сервера.
    expect(m.cut).toBe(camp.cut);
    expect(m.ratio).toBe(ratioOfCut(camp.cut!).ratio);
    expect(m.waste).toBe(wasteOf('calm', camp.homeDays, false));
    expect(m.toEven).toBe(phasesToEven(m.ratio, m.waste));
    expect(m.toEven!, 'точка внутри области: лагерь сильнее гарнизона, штраф выше среднего').toBeGreaterThan(0);
    expect(m.bound, 'точка внутри области: соотношение внутри кривой — прогноз точный, не граница').toBeUndefined();
    expect(m.evenAt).toBe(phaseAt(siegeSince(camp), rowsOf(camp).length + m.toEven!));

    // Правда — сервер: в каком шаге он сам опустит штраф к среднему.
    let fell: number | null = null;
    for (let k = 1; k <= m.toEven! + 3 && war.phase === 'camp'; k++) {
      g.step(phaseAt(siegeSince(war.camp as SiegeWindow), k) - g.now() + 1000);
      await g.pulse();
      if (fell === null && (war.camp as SiegeWindow).cut! <= CUT_MID + 1e-9) fell = k;
    }
    expect(war.phase, 'осаду кончает не исход фазы').toBe('camp');
    expect(fell, 'штраф стал средним').not.toBeNull();
    // Истощение у сервера — целыми бойцами по родам: шаг может сдвинуться на одну фазу.
    expect(Math.abs(fell! - m.toEven!), `прогноз ${m.toEven}, сервер — ${fell}`).toBeLessThanOrEqual(1);
  }, 120_000);
});
