// Лагерь тает (ОС-1б, docs/siege_v2.md, 23.9): окно лагеря под городом игрока говорит, во сколько лагерь сильнее гарнизона, сколько
// он теряет за фазу и через сколько фаз штраф к полям города упадёт к среднему. Числа — дверью хлеба (`siegefood.ratioOfCut`,
// `phasesToEven`) и хода осады (`siegeroll.wasteOf`); прогноз сверяется с тем, когда сервер войны на самом деле опускает штраф.
// Кольцо (ОС-1в, 23.12): гарнизон соседа не виден, соотношение — вилкой из штрафа сервера и разведки лазутчика, и исход кнопки
// «Замкнуть кольцо» по ней не противоречит решению сервера.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, liveSheet, warsOf, type SheetAt, type WarRow } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type SpyView, type WarOrder } from '../../netlify/lib/contract';
import { phasesToEven, ratioOfCut, ratioRangeOfCut, siegeCut } from './siegefood';
import { CUT_MAX, CUT_MID, CUT_MIN, CUT_RATIO_EVEN, CUT_RATIO_STRONG, CUT_RATIO_WEAK } from './data/siegefood';
import { phaseAt, rowsOf, setPhaseDie, wasteOf } from './siegeroll';
import { siegeSince, type SiegeWindow } from './siege';
import { precisionOf } from './intel';
import { INTEL_EXACT, INTEL_ROUGH_SPREAD } from './data/tuning';
import { BLOCKADE_RATIO } from './data/blockade';
import { troopPower } from '@/game/battle/price';
import type { TroopStack } from '@/game/battle/kinds';

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

/**
 * Два мира и сервер войны в памяти (как `pvp.test.ts`): Альфа осаждает Бету, у Беты гарнизон `def`. `spies` — дела лазутчиков
 * Альфы, как их отдаёт сервер (`SpyView`).
 */
function game(def: Record<string, number>, spies: SpyView[] = []) {
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
    new LocalWorld({
      seed: me === A ? 11 : 12,
      now: () => now,
      storage: null,
      home: roster.rows[me],
      castles: castlesFor(me),
      ...link(me),
      ...(me === A ? { spies: () => spies } : {}),
    });
  const a = world(A);
  const b = world(B);
  const pulse = async (): Promise<void> => {
    await a.sync(profile({ spearman: 60, archer: 30, swordsman: 30 }));
    await b.sync(profile(def));
    sheets.set(A, { sheet: a.warSheet()!, at: now });
    sheets.set(B, { sheet: b.warSheet()!, at: now });
  };
  return { a, file, ctx, sheets, pulse, now: () => now, step: (ms: number) => (now += ms), target: castleIdOf(B) };
}

/** Альфа приводит дружину под стены Беты и садится лагерем; война и её окно. */
async function camped(g: ReturnType<typeof game>): Promise<WarRow> {
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
  return war;
}

describe('ОС-1б: окно лагеря под городом игрока — лагерь тает', () => {
  it('числа окна — дверью хлеба и хода осады; штраф становится средним в названном шаге (до фазы: дробь бойцов)', async () => {
    // Кость «без перемен»: фазы только истощают лагерь, исход их не кончает.
    setPhaseDie(() => 7);
    // Гарнизон того же состава, что лагерь, на пятую часть меньше: ×1,25 — внутри кривой.
    const g = game({ spearman: 48, archer: 24, swordsman: 24 });
    const war = await camped(g);

    const camp = war.camp as SiegeWindow;
    const view = (await g.a.camp())!;
    const m = view.melt!;
    expect(m, 'под городом игрока окно лагеря знает, что лагерь тает').toBeDefined();
    // Числа — функциями двери, по штрафу сервера.
    expect(m.cut).toBe(camp.cut);
    // Разведки нет — вилка из одного штрафа; та же вилка у кольца (одна дверь, ОС-1в).
    expect(m.range).toEqual(ratioRangeOfCut(camp.cut!));
    expect(view.blockade!.range).toEqual(m.range);
    expect(m.range.lo, 'точка внутри области: соотношение внутри кривой — точка, не граница').toBe(m.range.hi);
    expect(m.waste).toBe(wasteOf('calm', camp.homeDays, false));
    expect(m.soon).toBe(phasesToEven(m.range.lo, m.waste));
    expect(m.late).toBe(m.soon);
    expect(m.soon!, 'точка внутри области: лагерь сильнее гарнизона, штраф выше среднего').toBeGreaterThan(0);
    expect(m.soonAt).toBe(phaseAt(siegeSince(camp), rowsOf(camp).length + m.soon!));

    // Правда — сервер: в каком шаге он сам опустит штраф к среднему.
    let fell: number | null = null;
    for (let k = 1; k <= m.soon! + 3 && war.phase === 'camp'; k++) {
      g.step(phaseAt(siegeSince(war.camp as SiegeWindow), k) - g.now() + 1000);
      await g.pulse();
      if (fell === null && (war.camp as SiegeWindow).cut! <= CUT_MID + 1e-9) fell = k;
    }
    expect(war.phase, 'осаду кончает не исход фазы').toBe('camp');
    expect(fell, 'штраф стал средним').not.toBeNull();
    // Истощение у сервера — целыми бойцами по родам: шаг может сдвинуться на одну фазу.
    expect(Math.abs(fell! - m.soon!), `прогноз ${m.soon}, сервер — ${fell}`).toBeLessThanOrEqual(1);
  }, 120_000);
});

// ------------------------------------------------------------------ кольцо: вилка против решения сервера ---

/** Удачная разведка лазутчика Альфы у Беты в минуту `at` — как её кладёт сервер: гарнизон слепка Беты на эту минуту. */
function look(g: ReturnType<typeof game>, war: WarRow, at: number): SpyView {
  const sheet = liveSheet(g.file, B, g.sheets.get(B)!, at);
  return {
    id: 'spy-1',
    role: 'atk',
    deed: 'look',
    atkCastle: castleIdOf(A),
    atkCity: 'Альфа',
    defCastle: war.defCastle,
    defCity: 'Бета',
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    sentAt: at,
    arriveAt: at,
    chance: 1,
    peril: 0,
    phase: 'done',
    out: { at, ok: true, slipped: false, held: false, dead: false, intel: { home: { ...sheet.home }, army: { ...sheet.army }, militia: sheet.militia, archers: sheet.archers, pop: sheet.pop, power: sheet.power } },
  };
}

describe('ОС-1в: кольцо под городом игрока — гарнизон не нуль, исход кнопки не противоречит серверу', () => {
  it('на наборе гарнизонов, с разведкой и без: «удастся» — сервер замыкает, «не удастся» — отказывает', async () => {
    setPhaseDie(() => 7);
    // Гарнизон Беты — того же состава, что лагерь Альфы, долей `share`: лагерь сильнее в 1 / share раз.
    const seen: string[] = [];
    for (const share of [0.8, 0.4, 0.2, 0.1]) {
      for (const scouted of [false, true]) {
        const spies: SpyView[] = [];
        const def = { spearman: Math.round(60 * share), archer: Math.round(30 * share), swordsman: Math.round(30 * share) };
        const g = game(def, spies);
        const war = await camped(g);
        if (scouted) spies.push(look(g, war, g.now()));
        const ring = (await g.a.camp())!.blockade!;
        expect(ring.range, 'под городом игрока — вилка, а не число от нулевого гарнизона').toBeDefined();
        expect(ring.ratio, 'числа от нулевого гарнизона нет').toBeUndefined();
        const server = applyOrder(g.file, A, { op: 'blockade', id: war.id, on: true }, g.now(), g.ctx);
        const tag = `×${(1 / share).toFixed(2)}${scouted ? ' с разведкой' : ''}: окно «${ring.odds}», сервер «${server ?? 'замкнул'}»`;
        if (ring.odds === 'yes') expect(server, tag).toBeNull();
        if (ring.odds === 'no') expect(server, tag).toMatch(/вчетверо/);
        // Кнопка гаснет только там, где сервер откажет.
        expect(ring.can, tag).toBe(ring.odds !== 'no');
        seen.push(ring.odds!);
      }
    }
    // Точки внутри области: в наборе есть все три исхода — правило спрошено на каждом.
    expect(new Set(seen), seen.join(', ')).toEqual(new Set(['yes', 'no', 'maybe']));
  }, 240_000);

  it('разведка стареет — вилка ширится правилом разведки и накрывает порог: «зависит от гарнизона», правда внутри вилки', async () => {
    setPhaseDie(() => 7);
    const spies: SpyView[] = [];
    // Лагерь сильнее в ~4,4 раза: старая разведка (±15 %) не может сказать, выше ли порога ×4.
    const g = game({ spearman: 14, archer: 7, swordsman: 7 }, spies);
    const war = await camped(g);
    const at = g.now() - INTEL_EXACT - 60_000;
    expect(precisionOf(g.now() - at), 'точка внутри области: разведка уже не точная, ещё не смутная').toBe('rough');
    spies.push(look(g, war, at));
    const ring = (await g.a.camp())!.blockade!;
    const truth = troopPower(war.army.troops as TroopStack) / troopPower(liveSheet(g.file, B, g.sheets.get(B)!, g.now()).home as TroopStack);
    expect(ring.range!.lo / truth).toBeCloseTo(1 / (1 + INTEL_ROUGH_SPREAD), 9);
    expect(ring.range!.hi / truth).toBeCloseTo(1 / (1 - INTEL_ROUGH_SPREAD), 9);
    expect(ring.range!.lo, 'вилка накрывает порог').toBeLessThan(BLOCKADE_RATIO);
    expect(ring.range!.hi).toBeGreaterThan(BLOCKADE_RATIO);
    expect(ring.odds).toBe('maybe');
    expect(ring.can, 'кнопка открыта: решит сервер').toBe(true);
  }, 120_000);
});
