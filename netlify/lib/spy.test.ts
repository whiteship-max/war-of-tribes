import { describe, expect, it } from 'vitest';
import { readWarOrder, spySeenId, type CastleClaim, type RivalDeed, type RosterFile, type SpyWatch, type WarOrder, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, liveSheet, newsMap, spiesOf, spyCap, spyMenuOf, type SheetAt, type SpyRow, type WarFile } from './war.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';
import { energyAt, priceOf, roadCost } from '../../src/world/energy.js';
import { ENERGY_FILL, ENERGY_MAX } from '../../src/world/data/energy.js';
import { rivalFate, rivalGuard, rivalHarm, rivalRolls, theftCarry } from '../../src/world/rivalspy.js';
import { RIVAL_POWER } from '../../src/world/data/spy.js';

/**
 * Лазутчик против соседа (docs/spy_pvp.md). Тесты — там, где без них можно подделать исход, украсть из ничего или
 * списать энергию дважды: исход считает сервер, кража — переход (что ушло у соседа, ровно то пришло), алмазов нет,
 * энергия списывается при приказе один раз, охрана сильнее — ловят чаще.
 */
const A = 'tg-1001';
const B = 'tg-1002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const watch = (over: Partial<SpyWatch> = {}): SpyWatch => ({ keen: 1, veil: 1, stealth: 0, held: 1, home: false, ...over });

const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: {},
  power: 5000,
  locks: {},
  seen: [],
  watch: watch(),
  time: 0,
  ...over,
});

function setup(over: { a?: Partial<WarSheet>; b?: Partial<WarSheet> } = {}) {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(over.a), at: T0 }],
    [B, { sheet: sheet(over.b), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  return { roster, sheets, ctx, file: emptyWars() as WarFile, target: castleIdOf(B) };
}

/** Приказ по меню той же минуты — так его отдаёт клиент. */
function send(g: ReturnType<typeof setup>, deed: RivalDeed, now = T0, energy = { value: ENERGY_MAX, at: now, mode: 'fill' as const }): string | null {
  const menu = spyMenuOf(g.file, A, g.target, now, g.ctx);
  if (typeof menu === 'string') return menu;
  const opt = menu.options.find((o) => o.deed === deed)!;
  const order: WarOrder = { op: 'spy', target: g.target, deed, energy, shown: { chance: opt.chance, peril: opt.peril }, at: now };
  return applyOrder(g.file, A, order, now, g.ctx);
}

/** Строка дела с заданными костями — чтобы держать исход, а не надеяться на кость. */
function forced(g: ReturnType<typeof setup>, deed: RivalDeed, chance: number, peril = 0, now = T0): SpyRow {
  expect(send(g, deed, now)).toBeNull();
  const row = g.file.spies!.at(-1)!;
  row.chance = chance;
  row.peril = peril;
  return row;
}

describe('лазутчик против соседа: условия задачи', () => {
  it('замки теста в одном регионе и не под защитой слабого — точки внутри области правила', () => {
    const { roster } = setup();
    expect(inHomeTheatre(roster.rows[A], roster.rows[B])).toBe(true);
    expect(weakCity(sheet().pop, sheet().power)).toBe(false);
  });
});

describe('исход считает сервер', () => {
  it('в приказе нет исхода: разбор собирает новый объект и выбрасывает присланное', () => {
    const raw = {
      op: 'spy',
      target: 'c1',
      deed: 'theft',
      shown: { chance: 0.5, peril: 0.01 },
      at: T0,
      out: { ok: true, stolen: { gold: 99999 } },
      ok: true,
      chance: 1,
      stolen: { gold: 99999 },
    };
    const o = readWarOrder(raw) as Extract<WarOrder, { op: 'spy' }>;
    expect(Object.keys(o).sort()).toEqual(['at', 'deed', 'op', 'shown', 'target']);
    expect(Object.keys(o.shown).sort()).toEqual(['chance', 'peril']);
  });

  it('показанный шанс выше настоящего — отказ, а не дело по присланному числу', () => {
    const g = setup();
    const menu = spyMenuOf(g.file, A, g.target, T0, g.ctx);
    if (typeof menu === 'string') throw new Error(menu);
    const opt = menu.options.find((o) => o.deed === 'theft')!;
    expect(opt.chance).toBeLessThan(0.92);
    const err = applyOrder(g.file, A, { op: 'spy', target: g.target, deed: 'theft', shown: { chance: 0.92, peril: opt.peril }, at: T0 }, T0, g.ctx);
    expect(err).toMatch(/сменилась/);
    expect(g.file.spies ?? []).toHaveLength(0);
  });

  it('исход появляется только ходом сервера в минуту прихода и одинаков, кто бы ни спросил', () => {
    const g = setup();
    expect(send(g, 'fire')).toBeNull();
    const row = g.file.spies![0];
    expect(row.out).toBeUndefined();
    advance(g.file, row.arriveAt - 1, g.sheets);
    expect(row.out).toBeUndefined();
    const twin = JSON.parse(JSON.stringify(g.file)) as WarFile;
    advance(g.file, row.arriveAt, g.sheets);
    advance(twin, row.arriveAt + 3_600_000, g.sheets);
    expect(twin.spies![0].out).toEqual(row.out);
  });
});

describe('кража — переход, а не начисление; алмазов нет', () => {
  it('на наборе дел: у соседа ушло ровно то, что пришло к нападающему, не больше лежавшего на виду и поклажи', () => {
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      const g = setup({ b: { stock: { food: 3000 + i * 37, wood: 900, iron: 120, gems: 5000 }, gold: 500 + i, stash: 80 } });
      // Алмазов на «складе» больше тайника — точка внутри области правила: без запрета их было бы что унести.
      expect(g.sheets.get(B)!.sheet.stock.gems).toBeGreaterThan(g.sheets.get(B)!.sheet.stash);
      const row = forced(g, 'theft', 1);
      advance(g.file, row.arriveAt, g.sheets);
      const stolen = row.out?.stolen ?? {};
      expect(row.out?.ok).toBe(true);
      expect(stolen.gems, 'алмазы не крадут').toBeUndefined();
      const total = Object.values(stolen).reduce((n, v) => n + v, 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(theftCarry());
      const before = { b: g.sheets.get(B)!, a: g.sheets.get(A)! };
      const lost = liveSheet(g.file, B, before.b);
      const got = liveSheet(g.file, A, before.a);
      for (const [k, v] of Object.entries(stolen)) {
        if (k === 'gold') {
          expect(before.b.sheet.gold - lost.gold).toBe(v);
          expect(got.gold - before.a.sheet.gold).toBe(v);
        } else {
          expect(before.b.sheet.stock[k] - (lost.stock[k] ?? 0)).toBe(v);
          expect((got.stock[k] ?? 0) - (before.a.sheet.stock[k] ?? 0)).toBe(v);
          // Тайник не тронут: у соседа осталось не меньше спрятанного.
          expect(lost.stock[k] ?? 0).toBeGreaterThanOrEqual(Math.min(before.b.sheet.stock[k], before.b.sheet.stash));
        }
      }
      checked++;
    }
    expect(checked).toBe(40);
  });

  it('принятое не крадут второй раз: вторая кража до нового слепка идёт по складу без первой', () => {
    const g = setup({ b: { stock: { food: 600 }, gold: 0, stash: 0 } });
    let first = forced(g, 'theft', 1);
    advance(g.file, first.arriveAt, g.sheets);
    advance(g.file, first.backAt!, g.sheets);
    const took1 = first.out!.stolen!.food;
    // Второе дело — когда лазутчик дома и отдохнул: энергию сервер берёт не выше своей отметки (`war.spyCap`, ЗЩ-2).
    first = forced(g, 'theft', 1, 0, first.backAt! + ENERGY_FILL);
    advance(g.file, first.arriveAt, g.sheets);
    const took2 = first.out!.stolen!.food;
    expect(took2).toBe(Math.floor((600 - took1) * RIVAL_POWER.theftShare));
    // Сосед принял обе кражи — сервер больше ничего не вычитает.
    const s = g.sheets.get(B)!;
    const left = liveSheet(g.file, B, s).stock.food;
    expect(left).toBe(600 - took1 - took2);
    const seen = { sheet: { ...s.sheet, stock: { food: left }, seen: g.file.spies!.map((x) => spySeenId(x.id)) }, at: s.at };
    expect(liveSheet(g.file, B, seen).stock.food).toBe(left);
  });

  it('энергия лазутчика — не выше отметки сервера (ЗЩ-2): сразу после дела «полный» запас — отказ, отдохнувший — идёт', () => {
    const g = setup({ b: { stock: { food: 600 }, gold: 0, stash: 0 } });
    const first = forced(g, 'theft', 1);
    advance(g.file, first.arriveAt, g.sheets);
    advance(g.file, first.backAt!, g.sheets);
    const back = first.backAt! + 1;
    // Точка внутри области: по отметке обратного пути, которую сервер ведёт сам, лазутчик не отдохнул.
    expect(energyAt(first.energy, back), 'точка внутри области: лазутчик не отдохнул').toBeLessThan(ENERGY_MAX - priceOf('theft'));
    expect(send(g, 'theft', back)).toMatch(/^Не хватит энергии/);
    expect(g.file.spies!.length).toBe(1);
    expect(spyCap(g.file, A, back)).toBe(energyAt(first.energy, back));
    expect(spyCap(g.file, A, first.backAt! + ENERGY_FILL)).toBe(ENERGY_MAX);
  });

  it('пустой склад — красть нечего: ничего не приходит', () => {
    const h = rivalHarm('theft', { stock: { food: 50 }, gold: 30, stash: 100, pop: 10 });
    expect(h.stolen).toBeUndefined();
  });
});

describe('поджог и смута', () => {
  it('поджог: горит доля открытого склада, тайник и казна целы, нападающему не приходит ничего', () => {
    const g = setup({ b: { stock: { food: 1000, wood: 500 }, stash: 100, gold: 300 } });
    const row = forced(g, 'fire', 1);
    advance(g.file, row.arriveAt, g.sheets);
    const burned = row.out!.burned!;
    expect(burned.food + burned.wood).toBe(Math.floor((900 + 400) * RIVAL_POWER.fireShare));
    expect(row.out!.stolen).toBeUndefined();
    const a = liveSheet(g.file, A, g.sheets.get(A)!);
    expect(a.stock).toEqual(sheet().stock);
    expect(liveSheet(g.file, B, g.sheets.get(B)!).gold).toBe(300);
  });

  it('смута: ушедшие у соседа — пришедшие у нас, последний житель остаётся', () => {
    const g = setup();
    const row = forced(g, 'unrest', 1);
    advance(g.file, row.arriveAt, g.sheets);
    const lured = row.out!.lured!;
    expect(lured).toBe(Math.min(RIVAL_POWER.unrestCap, Math.floor(400 * RIVAL_POWER.unrestShare)));
    expect(liveSheet(g.file, B, g.sheets.get(B)!).pop).toBe(400 - lured);
    expect(liveSheet(g.file, A, g.sheets.get(A)!).pop).toBe(400 + lured);
    expect(rivalHarm('unrest', { stock: {}, gold: 0, stash: 0, pop: 1 }).lured).toBeUndefined();
  });
});

describe('энергия списывается один раз', () => {
  it('цена — при приказе, дорога — по дням пути; приход и возврат цену не берут второй раз; второй приказ — отказ', () => {
    const g = setup();
    expect(send(g, 'fire')).toBeNull();
    const row = g.file.spies![0];
    const walk = row.arriveAt - row.sentAt;
    expect(energyAt(row.energy, T0)).toBeCloseTo(ENERGY_MAX - priceOf('fire'), 9);
    expect(send(g, 'fire')).toMatch(/уже на деле/);
    expect(g.file.spies).toHaveLength(1);
    advance(g.file, row.arriveAt, g.sheets);
    const atTarget = ENERGY_MAX - priceOf('fire') - roadCost(walk);
    expect(energyAt(row.energy, row.arriveAt)).toBeCloseTo(atTarget, 9);
    if (row.phase === 'back') {
      advance(g.file, row.backAt!, g.sheets);
      expect(energyAt(row.energy, row.backAt!)).toBeCloseTo(Math.max(0, atTarget - roadCost(row.backAt! - row.arriveAt)), 9);
    }
  });

  it('не хватит к приходу — отказ, строки дела нет', () => {
    const g = setup();
    const err = send(g, 'theft', T0, { value: priceOf('theft'), at: T0, mode: 'fill' });
    expect(err).toMatch(/Не хватит энергии/);
    expect(g.file.spies ?? []).toHaveLength(0);
  });
});

describe('защита: чем сильнее охрана, тем чаще ловят', () => {
  it('стража дома, Дозор соседа и его лазутчик дома — каждый поднимает охрану', () => {
    const base = rivalGuard({ homePower: 100, keen: 1, spyHome: false });
    expect(rivalGuard({ homePower: 400, keen: 1, spyHome: false })).toBeGreaterThan(base);
    expect(rivalGuard({ homePower: 100, keen: 2, spyHome: false })).toBeGreaterThan(base);
    expect(rivalGuard({ homePower: 100, keen: 1, spyHome: true })).toBeGreaterThan(base);
  });

  it('на наборе из 400 дел: у сильной охраны лазутчика ловят чаще, чем у слабой', () => {
    const weak = setup({ b: { home: { spearman: 2 } } });
    const strong = setup({ b: { home: { spearman: 200, swordsman: 100 }, watch: watch({ keen: 2, home: true }) } });
    const chanceOf = (g: ReturnType<typeof setup>): number => {
      const m = spyMenuOf(g.file, A, g.target, T0, g.ctx);
      if (typeof m === 'string') throw new Error(m);
      return m.options.find((o) => o.deed === 'theft')!.chance;
    };
    const cw = chanceOf(weak);
    const cs = chanceOf(strong);
    expect(cs).toBeLessThan(cw);
    const caught = (chance: number): number => {
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const f = rivalFate(chance, 0, 0, rivalRolls(`set${i}`));
        if (f.held || f.dead) n++;
      }
      return n;
    };
    expect(caught(cs)).toBeGreaterThan(caught(cw));
  });

  it('свой лазутчик соседа в деле — дома его нет, и охрана ниже, чем по слепку', () => {
    const g = setup({ b: { watch: watch({ home: true }) } });
    const before = spyMenuOf(g.file, A, g.target, T0, g.ctx);
    // Сосед сам послал лазутчика — к нам.
    const back = spyMenuOf(g.file, B, castleIdOf(A), T0, g.ctx);
    if (typeof back === 'string' || typeof before === 'string') throw new Error('меню');
    const o = back.options.find((x) => x.deed === 'look')!;
    expect(applyOrder(g.file, B, { op: 'spy', target: castleIdOf(A), deed: 'look', shown: { chance: o.chance, peril: o.peril }, at: T0 }, T0, g.ctx)).toBeNull();
    const after = spyMenuOf(g.file, A, g.target, T0, g.ctx);
    if (typeof after === 'string') throw new Error(after);
    expect(after.options[0].chance).toBeGreaterThan(before.options[0].chance);
  });
});

describe('что видит сосед и о чём пишет бот', () => {
  it('удавшаяся разведка не оставляет следа: у соседа нет ни дела, ни новости', () => {
    const g = setup();
    const row = forced(g, 'look', 1);
    advance(g.file, row.arriveAt, g.sheets);
    expect(row.out?.intel?.home).toEqual(sheet().home);
    expect(spiesOf(g.file, B)).toEqual([]);
    expect([...newsMap(g.file).keys()].filter((k) => k.includes('war-spy'))).toEqual([]);
  });

  it('удавшийся поджог: сосед видит дело без имени нападающего, бот пишет только ему', () => {
    const g = setup();
    const row = forced(g, 'fire', 1);
    advance(g.file, row.arriveAt, g.sheets);
    const seen = spiesOf(g.file, B);
    expect(seen).toHaveLength(1);
    expect(seen[0].atkCity).toBe('');
    expect(seen[0].atkCastle).toBe('');
    expect(JSON.stringify(seen)).not.toContain(A);
    const news = [...newsMap(g.file).values()];
    expect(news.map((n) => [n.player, n.item.kind])).toEqual([[B, 'war-spy']]);
  });

  it('пойманный лазутчик: сосед знает чей, но это не нападение — бот молчит', () => {
    const g = setup();
    const row = forced(g, 'theft', 0, 0);
    advance(g.file, row.arriveAt, g.sheets);
    expect(row.out?.held).toBe(true);
    expect(row.phase).toBe('held');
    const seen = spiesOf(g.file, B);
    expect(seen[0].atkCity).toBe('Альфа');
    expect([...newsMap(g.file).keys()].filter((k) => k.includes('war-spy'))).toEqual([]);
    // Плен кончается — лазутчик идёт домой.
    advance(g.file, row.releaseAt!, g.sheets);
    expect(row.phase).toBe('back');
  });

  it('защита слабого: вредить нельзя, разведать можно', () => {
    const g = setup({ b: { pop: 10, power: 0 } });
    expect(weakCity(10, 0)).toBe(true);
    const m = spyMenuOf(g.file, A, g.target, T0, g.ctx);
    if (typeof m === 'string') throw new Error(m);
    expect(m.options.find((o) => o.deed === 'look')?.can).toBe(true);
    for (const d of ['fire', 'theft', 'unrest'] as const) expect(m.options.find((o) => o.deed === d)?.reason).toMatch(/защитой слабого/);
  });
});
