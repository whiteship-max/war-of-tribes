import { describe, expect, it, vi } from 'vitest';
import { readWarOrder, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, fallId, generalCap, liveSheet, newsDiff, newsMap, newsOf, viewOf, warsOf, type SheetAt, type WarFile } from './war.js';
import { FATE_SAME, GENERAL_MARCHES, SIEGE_BLOCK } from '../../src/world/siege.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';
import { energyAt, energyBlock, priceOf, roadCost, roadOf } from '../../src/world/energy.js';
import { fieldReach, fieldWalkFloorMs, fieldWalkSeconds, warWalkMs } from '../../src/world/pvp.js';
import { terrainFactor } from '../../src/world/geo.js';
import { realMs } from '../../src/game/pace.js';
import { ENERGY_CAMP, ENERGY_FILL, ENERGY_MAX } from '../../src/world/data/energy.js';
import { craftBlock, fortFaces } from '../../src/world/siegecraft.js';
import { wallFront } from '../../src/world/wall.js';
import { FRONT_WIDTH } from '../../src/battle/config.js';
import type { SiegeWindow } from '../../src/world/siege.js';

// ВРЕМЕННО ×3 ДЛЯ ТЕСТА: точки этого теста выведены при прежней скорости пути и при ×3 выходят из области правила —
// держим ×1; ×3 проверяет netlify/lib/warfast.test.ts. Снять вместе с возвратом `TEST_TRAVEL_SPEED` к 1.
vi.mock('../../src/world/data/tuning.js', async (actual) => ({ ...(await actual<object>()), TEST_TRAVEL_SPEED: 1 }));

/**
 * Война между игроками (docs/pvp.md). Тесты только там, где без них можно подделать исход боя, начислить
 * из ничего или открыть чужое: исход считает сервер и только он, добыча переходит, а не начисляется,
 * ключей игроков наружу нет. Остальное — сценарий на двух аккаунтах (docs/pvp.md, раздел «Проверка»).
 */
const A = 'tg-1001';
const B = 'tg-1002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

function world(): RosterFile {
  let r = emptyRoster();
  r = upsert(r, A, claim('Альфа'), T0);
  r = upsert(r, B, claim('Бета'), T0);
  return r;
}

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
  levels: { walls: 3, farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

const army = (troops: Record<string, number>): WarArmy => ({ troops, resolve: 0, pips: {} });

function setup(over: { a?: Partial<WarSheet>; b?: Partial<WarSheet> } = {}) {
  const roster = world();
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(over.a), at: T0 }],
    [B, { sheet: sheet(over.b), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  return { roster, sheets, ctx, file: emptyWars() as WarFile };
}

describe('война между игроками: условия задачи', () => {
  it('замки теста стоят в одном регионе и не под защитой слабого — точки внутри области правила', () => {
    const { roster } = setup();
    expect(inHomeTheatre(roster.rows[A], roster.rows[B])).toBe(true);
    expect(weakCity(sheet().pop, sheet().power)).toBe(false);
  });
});

describe('исход считает сервер, а не клиент', () => {
  it('в приказе нет поля исхода: разбор собирает новый объект и выбрасывает присланное', () => {
    const sent = {
      op: 'march',
      target: 'c1',
      mode: 'storm',
      fate: 'plunder',
      army: { troops: { spearman: 10 }, resolve: 0, pips: {} },
      won: true,
      battles: [{ won: true }],
      fall: { taken: { gold: 1e6 } },
      phase: 'done',
    };
    const order = readWarOrder(sent);
    expect(order).not.toBeNull();
    expect(Object.keys(order as object).sort()).toEqual(['army', 'fate', 'mode', 'op', 'target']);
  });

  it('штурм с ходу бьётся в минуту прихода, по слепку обороны, и одинаково у кого угодно', () => {
    const run = () => {
      const { ctx, file, sheets } = setup();
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 60, swordsman: 30 }) }, T0, ctx)).toBeNull();
      const w = file.wars[0];
      expect(w.phase).toBe('march');
      expect(w.arriveAt).toBeGreaterThan(T0);
      // До прихода боя нет, сколько ни спрашивай.
      expect(advance(file, w.arriveAt - 1, sheets)).toBe(false);
      expect(w.battles).toHaveLength(0);
      advance(file, w.arriveAt + 1, sheets);
      return w;
    };
    const one = run();
    const two = run();
    expect(one.battles).toHaveLength(1);
    expect(one.battles[0].at).toBe(one.arriveAt);
    expect(one.battles[0].site).toBe('wall');
    expect(one.battles[0].homeTroops).toEqual(sheet().home);
    expect(JSON.stringify(two.battles)).toBe(JSON.stringify(one.battles));
    expect(two.fall).toEqual(one.fall);
  });

  it('ключей игроков в виде войны нет ни у одной стороны', () => {
    const { ctx, file } = setup();
    applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx);
    for (const k of [A, B]) {
      const text = JSON.stringify(warsOf(file, k));
      expect(text).not.toMatch(/tg-\d/);
    }
    expect(viewOf(file.wars[0], A).role).toBe('atk');
    expect(viewOf(file.wars[0], B).role).toBe('def');
  });
});

describe('добыча переходит, а не начисляется', () => {
  /**
   * Набор: двенадцать штурмов — три участи, разные склады и казна, войско сильнее и слабее. Утверждение
   * держится на каждом взятом городе; городов, взятых в наборе, должно быть больше половины, иначе набор
   * мерил бы пустое.
   */
  it('победитель увозит не больше, чем потерял город, по каждому припасу и людям', () => {
    let taken = 0;
    const fates = ['plunder', 'captives', 'burn'] as const;
    for (let i = 0; i < 12; i++) {
      const { ctx, file, sheets } = setup({
        b: { stock: { food: 500 + i * 300, wood: 100 * i, iron: 40 * i }, gold: 50 * i, stash: 20 * i, home: { spearman: 2 + i, archer: i } },
      });
      const f = fates[i % 3];
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: f, army: army({ spearman: 60, swordsman: 30, archer: 30 }) }, T0 + i, ctx)).toBeNull();
      const w = file.wars[0];
      advance(file, w.arriveAt + 1, sheets);
      if (!w.fall) continue;
      taken++;
      for (const [k, v] of Object.entries(w.fall.taken)) {
        expect(v, `${f} ${k}`).toBeLessThanOrEqual(w.fall.lost[k] ?? 0);
      }
      expect(w.fall.led).toBeLessThanOrEqual(w.fall.bondedLost + w.fall.popLost);
      if (f === 'burn') expect(w.fall.taken).toEqual({});
    }
    expect(taken).toBeGreaterThan(6);
  });

  it('принятое городом не вычитается дважды, непринятое — вычитается', () => {
    const { ctx, file, sheets } = setup();
    applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 60, swordsman: 30, archer: 30 }) }, T0, ctx);
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.fall).toBeDefined();
    const s = sheets.get(B) as SheetAt;
    const fresh = liveSheet(file, B, s);
    expect(fresh.gold).toBe(s.sheet.gold - (w.fall?.lost.gold ?? 0));
    const seen = liveSheet(file, B, { ...s, sheet: { ...s.sheet, seen: [w.battles[0].id, fallId(w.id)] } });
    expect(seen.gold).toBe(s.sheet.gold);
    expect(seen.home).toEqual(s.sheet.home);
  });
});

describe('приказы: защита слабого, регион, чужое', () => {
  it('на слабый город не идут', () => {
    const { ctx, file } = setup({ b: { pop: 10, power: 5 } });
    expect(weakCity(10, 5)).toBe(true);
    const err = applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 10 }) }, T0, ctx);
    expect(err).toMatch(/защитой слабого/);
    expect(file.wars).toHaveLength(0);
  });

  it('тест с игроками (TRIBE_SPAWN=sicily): защиты слабого нет — тот же слабый город берут, прочие условия те же', () => {
    const { ctx, file } = setup({ b: { pop: 10, power: 5 } });
    // Точка внутри области правила: город слаб, и без режима отказ был бы ровно защитой (тест выше).
    expect(weakCity(10, 5)).toBe(true);
    const march = { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 10 }) } as const;
    expect(applyOrder(file, A, march, T0, { ...ctx, noShield: true })).toBeNull();
    expect(file.wars).toHaveLength(1);
    // Остальное — как обычно: второй поход того же полководца не уходит.
    expect(applyOrder(file, A, march, T0 + 1, { ...ctx, noShield: true })).toBe(GENERAL_MARCHES);
  });

  it('войска больше, чем в слепке, не уведёшь', () => {
    const { ctx, file } = setup();
    const err = applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ knight: 500 }) }, T0, ctx);
    expect(err).toMatch(/Столько бойцов/);
  });

  it('чужой войной не командуют: отзыв, штурм и вылазка — только своей стороной', () => {
    const { ctx, file } = setup();
    applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx);
    const id = file.wars[0].id;
    expect(applyOrder(file, B, { op: 'recall', id }, T0 + 1, ctx)).not.toBeNull();
    expect(applyOrder(file, A, { op: 'sortie', id, troops: { spearman: 1 } }, T0 + 1, ctx)).not.toBeNull();
    expect(file.wars[0].phase).toBe('march');
  });
});

describe('энергия полководца: поход, осада и удар спрашивают ту же дверь, что мир (docs/agent_energy.md)', () => {
  const withEnergy = (value: number, troops: Record<string, number> = { spearman: 30 }): WarArmy => ({
    ...army(troops),
    energy: { value, at: T0, mode: 'fill' },
  });

  it('поход с осадой: дорога по дням пути и дело у стен — проверкой двери; у стен энергия стоит, назад уходит, дома копится', () => {
    const { ctx, file, sheets } = setup();
    // Путь — та же формула, что у сервера (темпа войны в тесте нет).
    const walk = warWalkMs(ctx.roster.rows[A], ctx.roster.rows[B]);
    const road = roadCost(walk);
    expect(road, 'точка внутри области: дорога стоит энергию').toBeGreaterThan(1);
    const need = priceOf('siege') + road;
    const march = (value: number) =>
      applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: withEnergy(value) }, T0, ctx);
    expect(march(need - 1)).toBe(energyBlock(need - 1, priceOf('siege'), walk));
    expect(file.wars).toHaveLength(0);
    // Десять сверх цены похода: на штурм из лагеря уже не хватит.
    expect(march(need + 10)).toBeNull();
    const w = file.wars[0];
    expect(w.arriveAt - T0).toBe(walk);
    // Цена осады — при выходе; дорога уходит по дням пути: на полпути — половина дороги, у стен — десять.
    expect(energyAt(w.army.energy, T0)).toBeCloseTo(need + 10 - priceOf('siege'), 6);
    expect(energyAt(w.army.energy, T0 + walk / 2)).toBeCloseTo(10 + road / 2, 6);
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    // У стен — полудом: копится залп за фазу (ответ владельца 3, docs/siege_v2.md, 8.4), до полного запаса.
    expect(w.army.energy?.mode).toBe('camp');
    const wait = 10 * ENERGY_FILL;
    expect(energyAt(w.army.energy, w.arriveAt + wait)).toBeCloseTo(Math.min(ENERGY_MAX, 10 + (ENERGY_MAX * wait) / ENERGY_CAMP), 6);
    // Штурм из лагеря стоит свою цену — без неё отказ.
    const have = energyAt(w.army.energy, w.arriveAt + 2);
    expect(applyOrder(file, A, { op: 'storm', id: w.id }, w.arriveAt + 2, ctx)).toBe(energyBlock(have, priceOf('storm')));
    expect(w.phase).toBe('camp');
    // Снял осаду — домой: назад дорога уходит той же ценой, с минуты возврата энергия копится.
    const left = energyAt(w.army.energy, w.arriveAt + 3);
    expect(applyOrder(file, A, { op: 'retreat', id: w.id }, w.arriveAt + 3, ctx)).toBeNull();
    const back = w.backAt as number;
    expect(w.army.energy?.homeAt).toBe(back);
    expect(energyAt(w.army.energy, back)).toBeCloseTo(Math.max(0, left - roadCost(back - (w.arriveAt + 3))), 6);
    expect(energyAt(w.army.energy, back + ENERGY_FILL)).toBe(ENERGY_MAX);
  });

  it('удар полководца города по лагерю: энергии должно хватить к приходу, с дорогой по карте', () => {
    const { ctx, file, sheets } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    const strike = (value: number) =>
      applyOrder(file, B, { op: 'strike', id: w.id, army: { ...withEnergy(value, { spearman: 20 }), energy: { value, at: w.arriveAt + 2, mode: 'drain' } }, joint: false, walkMs: 0, from: w.to }, w.arriveAt + 2, ctx);
    expect(strike(priceOf('strike') - 1)).toBe(energyBlock(priceOf('strike') - 1, priceOf('strike')));
    expect(w.strike).toBeUndefined();
    expect(strike(priceOf('strike'))).toBeNull();
    expect(w.strike).toBeDefined();
  });
});

describe('дела в лагере: укрепить лагерь и обстрел города (world/siegecraft)', () => {
  /** Поход с осадой и запасом `extra` сверх дороги и лагеря: у стен у полководца ровно `extra`. */
  function camped(extra: number) {
    const { ctx, file, sheets } = setup();
    const walk = warWalkMs(ctx.roster.rows[A], ctx.roster.rows[B]);
    const value = priceOf('siege') + roadCost(walk) + extra;
    expect(value, 'точка внутри области: запас не выше полного').toBeLessThanOrEqual(ENERGY_MAX);
    const order = { ...army({ spearman: 30 }), energy: { value, at: T0, mode: 'fill' as const } };
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: order }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    return { ctx, file, sheets, w, at: w.arriveAt + 2 };
  }

  it('в приказе дела нет ни счётчика, ни исхода: разбор оставляет само дело, чужое дело — отказ разбора', () => {
    const order = readWarOrder({ op: 'craft', id: 'w1', act: 'bombard', craft: { shots: 3 }, won: true, energy: { value: 100 } });
    expect(Object.keys(order as object).sort()).toEqual(['act', 'id', 'op']);
    expect(readWarOrder({ op: 'craft', id: 'w1', act: 'storm' })).toBeNull();
  });

  it('энергия списывается один раз за дело; на пределе и без энергии — отказ без списания; защитник лагерем не правит', () => {
    const { ctx, file, w, at } = camped(priceOf('fortify') * 2 + 5);
    const have = () => energyAt(w.army.energy, at);
    // Защитник не укрепит чужой лагерь: приказ ищет войну по стороне нападающего.
    expect(applyOrder(file, B, { op: 'craft', id: w.id, act: 'fortify' }, at, ctx)).toBe('Лагеря уже нет.');
    expect(w.camp?.craft).toBeUndefined();
    const start = have();
    expect(applyOrder(file, A, { op: 'craft', id: w.id, act: 'fortify' }, at, ctx)).toBeNull();
    expect(have()).toBeCloseTo(start - priceOf('fortify'), 6);
    expect(applyOrder(file, A, { op: 'craft', id: w.id, act: 'fortify' }, at, ctx)).toBeNull();
    expect(have()).toBeCloseTo(start - 2 * priceOf('fortify'), 6);
    expect(w.camp?.craft?.fort).toBe(2);
    // Предел за осаду — отказ двери, энергия на месте.
    expect(applyOrder(file, A, { op: 'craft', id: w.id, act: 'fortify' }, at, ctx)).toBe(craftBlock(w.camp as unknown as SiegeWindow, 'fortify', at));
    expect(have()).toBeCloseTo(start - 2 * priceOf('fortify'), 6);
    // Пять энергии на залп в пятнадцать — отказ двери энергии, счётчик не тронут.
    expect(applyOrder(file, A, { op: 'craft', id: w.id, act: 'bombard' }, at, ctx)).toBe(energyBlock(have(), priceOf('bombard')));
    expect(w.camp?.craft?.shots).toBeUndefined();
  });

  it('сделанное в лагере доходит до боя на сервере: укрепления — в кости вылазки, пролом — в стене при штурме', () => {
    const { ctx, file, sheets, w, at } = camped(priceOf('fortify') * 2 + priceOf('bombard') + priceOf('storm'));
    applyOrder(file, A, { op: 'craft', id: w.id, act: 'fortify' }, at, ctx);
    applyOrder(file, A, { op: 'craft', id: w.id, act: 'fortify' }, at, ctx);
    expect(applyOrder(file, B, { op: 'sortie', id: w.id, troops: { spearman: 10 } }, at + 1, ctx)).toBeNull();
    const sortie = w.battles[w.battles.length - 1];
    expect(sortie.site).toBe('sortie');
    expect(sortie.input.ground?.works).toBe(fortFaces({ fort: 2 }));
    expect(sortie.craft?.fort).toBe(2);
    expect(w.phase, 'точка внутри области: лагерь устоял').toBe('camp');
    expect(applyOrder(file, A, { op: 'craft', id: w.id, act: 'bombard' }, at + 2, ctx)).toBeNull();
    // Пролом даёт исход фазы, а не залп (docs/siege_v2.md, 2.5): здесь он вложен строкой журнала фаз, как его записал бы
    // бросок, — тест держит путь пролома до стены при штурме, а не кость.
    w.camp!.phases = [{ at: at + 2, die: 13, mods: {}, out: 'breach', waste: 0 }];
    advance(file, at + 3, sheets);
    expect(applyOrder(file, A, { op: 'storm', id: w.id }, at + 3, ctx)).toBeNull();
    const storm = w.battles[w.battles.length - 1];
    expect(storm.site).toBe('wall');
    expect(storm.craft?.breach, 'в запись боя лёг пролом').toBe(1);
    // Стена-проход (docs/siege_v2.md, 4.1–4.2): пролом открывает треть фронта без штрафа, ополчение стоит на стене всё.
    const front = wallFront({ breaches: 1 });
    expect(front.width, 'точка внутри области: фронт уже полного').toBeLessThan(FRONT_WIDTH);
    expect(storm.input.width).toBe(front.width);
    expect(storm.input.ground?.wall).toBe(front.wall);
    expect(storm.militia).toEqual({ men: sheet().militia, archers: sheet().archers });
  });
});

describe('новости войны для бота: о двух вещах, обеим сторонам, по разу', () => {
  /**
   * Решение владельца (05.10.2026): на город идут — защитнику; бой был — обеим сторонам. Новости выводятся из записи,
   * поэтому «один раз» держит разница до и после хода: тот же ход второй раз новостей не даёт.
   */
  it('поход: защитнику «идут на город», нападающему — ничего; отзыв снимает новость', () => {
    const { file, ctx } = setup();
    const before = newsMap(file);
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx)).toBeNull();
    const diff = newsDiff(before, newsMap(file));
    expect([...diff.keys()]).toEqual([B]);
    expect(diff.get(B)?.add.map((i) => `${i.kind}:${i.p.from}:${i.p.mode}`)).toEqual(['war:Альфа:siege']);
    expect(diff.get(B)?.add[0].until).toBe(file.wars[0].arriveAt);
    const marched = newsMap(file);
    expect(applyOrder(file, A, { op: 'recall', id: file.wars[0].id }, T0 + 1000, ctx)).toBeNull();
    const recalled = newsDiff(marched, newsMap(file));
    expect(recalled.get(B)).toEqual({ add: [], drop: [`war:${file.wars[0].id}`] });
  });

  it('штурм в минуту прихода: «бой был» обеим, у каждой своя победа, взятие — одной новостью', () => {
    const { file, ctx, sheets } = setup();
    applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 60, swordsman: 30, archer: 30 }) }, T0, ctx);
    const w = file.wars[0];
    const before = newsMap(file);
    expect(advance(file, w.arriveAt, sheets)).toBe(true);
    const diff = newsDiff(before, newsMap(file));
    const atk = diff.get(A)!.add;
    const def = diff.get(B)!.add;
    expect(atk.map((i) => i.kind)).toEqual(['war-fight']);
    expect(def.map((i) => i.kind)).toEqual(['war-fight']);
    expect(atk[0].key).toBe(def[0].key);
    expect(atk[0].p.won).toBe(!def[0].p.won);
    expect(atk[0].p.won).toBe(w.battles[0].won);
    expect(Boolean(def[0].p.taken)).toBe(Boolean(w.fall));
    expect(atk[0].p.from).toBe('Бета');
    expect(def[0].p.from).toBe('Альфа');
    // Тот же ход ещё раз — новостей нет.
    const again = newsMap(file);
    advance(file, w.arriveAt + 1000, sheets);
    expect([...newsDiff(again, newsMap(file)).values()].every((d) => d.add.length === 0)).toBe(true);
  });

  it('падение голодом — «город взят» обеим сторонам', () => {
    const { file, ctx, sheets } = setup({ b: { food: 10 } });
    applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army: army({ spearman: 30 }) }, T0, ctx);
    const w = file.wars[0];
    advance(file, w.arriveAt, sheets);
    expect(w.phase).toBe('camp');
    const before = newsMap(file);
    advance(file, w.starvesAt!, sheets);
    expect(w.fall?.by).toBe('hunger');
    const diff = newsDiff(before, newsMap(file));
    for (const p of [A, B]) {
      expect(diff.get(p)?.add.map((i) => `${i.kind}:${i.p.role}`), p).toEqual([`war-fall:${p === A ? 'atk' : 'def'}`]);
    }
    expect(newsOf(w).filter((n) => n.item.kind === 'war-fall').every((n) => n.item.fireAt === w.fall!.at)).toBe(true);
  });
});

describe('раскладка: свой поход в слепке обороны', () => {
  /**
   * Слепок лёг, когда часть отряда полководца ещё шла в сбор (в гарнизоне её не было), а вышел он уже со всем отрядом:
   * вычесть ушедших сверх того, что слепок назвал стоящим дома (`WarSheet.retinue`), значило бы снять с гарнизона чужих.
   * Путь, слепок в походе и возврат — `src/world/pvp.test.ts` на настоящем мире.
   */
  it('ушедших вычитают не больше, чем отряда стояло дома в слепке', () => {
    const { ctx, file } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30, archer: 10 }) }, T0 + 5000, ctx)).toBeNull();
    const w = file.wars[0];
    expect(w.went).toEqual({ spearman: 30, archer: 10 });
    const at = T0 + 6000;
    expect(w.phase, 'точка внутри области: войско в пути').toBe('march');
    // Слепок до выхода: дома 40 копейщиков и 20 лучников, из них отряда полководца — 12 копейщиков.
    const stale: SheetAt = { sheet: sheet({ retinue: { spearman: 12 } }), at: T0 };
    expect(liveSheet(file, A, stale, at).home).toEqual({ spearman: 28, archer: 20 });
    // Слепок старого клиента без поля — ушедшие считаются стоявшими дома целиком.
    expect(liveSheet(file, A, { sheet: sheet(), at: T0 }, at).home).toEqual({ spearman: 10, archer: 10 });
    // Слепок новее выхода — его клиент уже знает, кто ушёл.
    expect(liveSheet(file, A, { sheet: sheet({ retinue: {} }), at: T0 + 5500 }, at).home).toEqual(sheet().home);
  });
});

describe('осада под городом игрока: находки отчёта (docs/siege_audit.md)', () => {
  /** Поход с осадой; лагерь встал. */
  function camp(over: { a?: Partial<WarSheet>; b?: Partial<WarSheet> } = {}) {
    const g = setup(over);
    expect(applyOrder(g.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 60, swordsman: 30 }) }, T0, g.ctx)).toBeNull();
    const w = g.file.wars[0];
    advance(g.file, w.arriveAt + 1, g.sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    return { ...g, w, at: w.arriveAt + 2 };
  }

  it('участь из лагеря: разбор оставляет её у штурма и у «Объявить», чужое слово — отказ разбора', () => {
    expect(readWarOrder({ op: 'storm', id: 'w1', fate: 'burn', won: true })).toEqual({ op: 'storm', id: 'w1', fate: 'burn' });
    expect(readWarOrder({ op: 'storm', id: 'w1' })).toEqual({ op: 'storm', id: 'w1' });
    expect(readWarOrder({ op: 'fate', id: 'w1', fate: 'captives', fall: { taken: { gold: 9 } } })).toEqual({ op: 'fate', id: 'w1', fate: 'captives' });
    expect(readWarOrder({ op: 'fate', id: 'w1', fate: 'raze' })).toBeNull();
  });

  it('«Объявить» в лагере меняет участь у обеих сторон и в окне; та же участь и замок гейта — отказ теми же словами, что у логова', () => {
    const { file, ctx, w, at } = camp({ a: { locks: { burn: 'Сжигать города учит ветвь войны.' } } });
    expect(applyOrder(file, A, { op: 'fate', id: w.id, fate: 'plunder' }, at, ctx)).toBe(FATE_SAME);
    expect(applyOrder(file, A, { op: 'fate', id: w.id, fate: 'burn' }, at, ctx)).toBe('Сжигать города учит ветвь войны.');
    expect(w.fate).toBe('plunder');
    // Защитник участью чужого лагеря не правит.
    expect(applyOrder(file, B, { op: 'fate', id: w.id, fate: 'captives' }, at, ctx)).toBe('Лагеря уже нет.');
    expect(applyOrder(file, A, { op: 'fate', id: w.id, fate: 'captives' }, at, ctx)).toBeNull();
    expect(w.fate).toBe('captives');
    expect(w.camp?.fate).toBe('captives');
    expect(warsOf(file, B)[0].fate, 'защитник видит новую участь').toBe('captives');
  });

  it('штурм из лагеря идёт с участью, выбранной в лагере, а не с той, что объявлена при выходе', () => {
    // Город без гарнизона и ополчения: штурм берёт его наверняка, и участь видна в падении.
    const weak = { b: { home: {}, militia: 0, archers: 0 } };
    const { file, ctx, w, at } = camp(weak);
    expect(applyOrder(file, A, { op: 'storm', id: w.id, fate: 'captives' }, at, ctx)).toBeNull();
    expect(w.fall, 'точка внутри области: город взят штурмом').toBeDefined();
    expect(w.fall?.by).toBe('storm');
    expect(w.fall?.fate).toBe('captives');
    // Без участи в приказе (старый клиент) — объявленная.
    const old = camp(weak);
    expect(applyOrder(old.file, A, { op: 'storm', id: old.w.id }, old.at, old.ctx)).toBeNull();
    expect(old.w.fall?.fate).toBe('plunder');
  });

  it('часы голода идут за гарнизоном: новый слепок с другим гарнизоном пересчитывает окно от остатка хлеба, тот же — нет', () => {
    const { file, sheets, w } = camp({ b: { food: 400 } });
    const first = w.starvesAt as number;
    expect(w.camp?.garrisonAtStart).toBe(60);
    // Тот же гарнизон в новом слепке — окно не трогается.
    const t1 = w.arriveAt + 60_000;
    expect(t1 + 200_000, 'точка внутри области: все слепки — до голода').toBeLessThan(first);
    sheets.set(B, { sheet: sheet({ food: 400 }), at: t1 });
    expect(advance(file, t1 + 1000, sheets)).toBe(false);
    expect(w.starvesAt).toBe(first);
    // Дружина вернулась домой: ртов больше — хлеб кончится раньше; пересчёт — на минуту слепка, от остатка.
    const t2 = t1 + 60_000;
    sheets.set(B, { sheet: sheet({ food: 400, home: { spearman: 40, archer: 20, swordsman: 30 } }), at: t2 });
    expect(advance(file, t2 + 1000, sheets)).toBe(true);
    expect(w.camp?.garrisonAtStart).toBe(90);
    expect(w.camp?.startedAt).toBe(t2);
    expect(w.starvesAt as number).toBeLessThan(first);
    // Отряд ушёл — ртов меньше, хлеба хватит дольше прежнего.
    const t3 = t2 + 60_000;
    sheets.set(B, { sheet: sheet({ food: 400, home: { spearman: 10 } }), at: t3 });
    advance(file, t3 + 1000, sheets);
    expect(w.camp?.garrisonAtStart).toBe(10);
    expect(w.starvesAt as number).toBeGreaterThan(first);
  });

  it('слепок, легший позже часа голода, окна не двигает: город падает в свой час', () => {
    const { file, sheets, w } = camp({ b: { food: 400 } });
    const hunger = w.starvesAt as number;
    sheets.set(B, { sheet: sheet({ food: 400, home: { spearman: 5 } }), at: hunger + 60_000 });
    advance(file, hunger + 120_000, sheets);
    expect(w.fall?.by).toBe('hunger');
    expect(w.fall?.at).toBe(hunger);
  });

  it('из осаждённого города не выходят ни поход, ни лазутчик: то же правило выхода, что у мира', () => {
    const { file, ctx, at } = camp();
    expect(applyOrder(file, B, { op: 'march', target: castleIdOf(A), mode: 'storm', fate: 'plunder', army: army({ spearman: 10 }) }, at, ctx)).toBe(SIEGE_BLOCK);
    expect(applyOrder(file, B, { op: 'spy', target: castleIdOf(A), deed: 'look', shown: { chance: 0, peril: 0 }, at }, at, ctx)).toBe(SIEGE_BLOCK);
  });

  it('энергия полководца: вернувшийся из похода не выходит в новый с полным запасом — сервер помнит свою отметку', () => {
    const { file, ctx, sheets, w, at } = camp();
    expect(applyOrder(file, A, { op: 'retreat', id: w.id }, at, ctx)).toBeNull();
    const home = w.backAt as number;
    advance(file, home + 1, sheets);
    expect(w.phase, 'точка внутри области: войско дома').toBe('done');
    // Отметка обратного пути, которую сервер сам записал в войну: дома копится с минуты возврата.
    const own = energyAt(w.army.energy, home + 1);
    expect(own, 'точка внутри области: дорога и лагерь стоили энергии').toBeLessThan(ENERGY_MAX - priceOf('siege'));
    expect(generalCap(file, A, home + 1), 'потолок — своя отметка сервера').toBeCloseTo(own, 6);
    // Клиент называет полный запас — сервер берёт не больше своего.
    const full: WarArmy = { ...army({ spearman: 30 }), energy: { value: ENERGY_MAX, at: home + 1, mode: 'fill' } };
    const told = applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: full }, home + 1, ctx);
    if (told === null) {
      expect(energyAt(file.wars[1].army.energy, home + 1)).toBeCloseTo(own - priceOf('storm'), 6);
    } else {
      expect(told).toBe(energyBlock(own, priceOf('storm'), warWalkMs(ctx.roster.rows[A], ctx.roster.rows[B])));
    }
    // Отдохнул дома — потолок снова полный.
    expect(generalCap(file, A, home + 1 + ENERGY_FILL)).toBe(ENERGY_MAX);
  });

  it('удар по лагерю: полководец, ведущий свой поход, по лагерю у своих стен не бьёт', () => {
    const C = 'tg-1003';
    const roster = upsert(world(), C, claim('Гамма'), T0);
    expect(inHomeTheatre(roster.rows[B], roster.rows[C]), 'точка внутри области: Гамма в краю Беты').toBe(true);
    const sheets = new Map<string, SheetAt>([A, B, C].map((k) => [k, { sheet: sheet(), at: T0 }]));
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars() as WarFile;
    expect(applyOrder(file, B, { op: 'march', target: castleIdOf(C), mode: 'siege', fate: 'plunder', army: army({ spearman: 20 }) }, T0, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx)).toBeNull();
    const w = file.wars[1];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь у стен Беты').toBe('camp');
    expect(['march', 'camp'], 'точка внутри области: Бета в походе').toContain(file.wars[0].phase);
    const strike = { op: 'strike' as const, id: w.id, army: army({ spearman: 10 }), joint: false, walkMs: 0, from: w.to };
    expect(applyOrder(file, B, strike, w.arriveAt + 2, ctx)).toBe('Полководец в походе на соседа.');
    expect(w.strike).toBeUndefined();
  });

  it('удар по лагерю: энергия — не выше своей отметки сервера, как у похода', () => {
    const C = 'tg-1003';
    const roster = upsert(world(), C, claim('Гамма'), T0);
    const sheets = new Map<string, SheetAt>([A, B, C].map((k) => [k, { sheet: sheet(), at: T0 }]));
    const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
    const file = emptyWars() as WarFile;
    // Бета сходила осадить Гамму и вернулась: её полководец дома с тем, что оставили дорога и лагерь.
    expect(applyOrder(file, B, { op: 'march', target: castleIdOf(C), mode: 'siege', fate: 'plunder', army: army({ spearman: 20 }) }, T0, ctx)).toBeNull();
    const out = file.wars[0];
    advance(file, out.arriveAt + 1, sheets);
    expect(applyOrder(file, B, { op: 'retreat', id: out.id }, out.arriveAt + 2, ctx)).toBeNull();
    const back = out.backAt as number;
    // Альфа выходит так, чтобы встать лагерем у Беты сразу после её возврата, пока та не отдохнула.
    const walkAB = warWalkMs(roster.rows[A], roster.rows[B]);
    const go = Math.max(out.arriveAt + 3, back + 1 - walkAB);
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, go, ctx)).toBeNull();
    const w = file.wars[1];
    advance(file, w.arriveAt + 1, sheets);
    expect(out.phase, 'точка внутри области: Бета дома').toBe('done');
    expect(w.phase, 'точка внутри области: лагерь у стен Беты').toBe('camp');
    const at = w.arriveAt + 2;
    const own = energyAt(out.army.energy, at);
    expect(own, 'точка внутри области: не отдохнула').toBeLessThan(ENERGY_MAX - priceOf('strike'));
    // Дорога до лагеря такая, что своей энергии на удар не хватит, а названной клиентом — хватило бы.
    const walkMs = roadOf(Math.max(0, own - priceOf('strike') / 2));
    expect(energyBlock(ENERGY_MAX, priceOf('strike'), walkMs), 'точка внутри области: полного хватило бы').toBeNull();
    const forged: WarArmy = { ...army({ spearman: 10 }), energy: { value: ENERGY_MAX, at, mode: 'fill' } };
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: forged, joint: false, walkMs, from: w.to }, at, ctx)).toBe(energyBlock(own, priceOf('strike'), walkMs));
    expect(w.strike).toBeUndefined();
  });
});

/**
 * Срок пути удара полководца (docs/security.md, ЗЩ-2): клиент называет, откуда идёт полководец и сколько идти; сервер берёт
 * срок не короче пути по самой быстрой клетке (`pvp.fieldWalkFloorMs`), а место — не дальше, чем полководец мог уйти со
 * своего места в слепке обороны (`WarSheet.gen`, `pvp.fieldReach`). Честный срок — ландшафтом личной карты — не короче.
 */
describe('срок пути удара: по расстоянию и скорости, а не со слов клиента', () => {
  function camp(gen?: { x: number; y: number }) {
    const g = setup({ b: gen ? { gen } : {} });
    expect(applyOrder(g.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, g.ctx)).toBeNull();
    const w = g.file.wars[0];
    advance(g.file, w.arriveAt + 1, g.sheets);
    expect(w.phase, 'точка внутри области: лагерь у стен Беты').toBe('camp');
    const warned: { text: string; kind?: string }[] = [];
    const ctx = { ...g.ctx, forged: (text: string, kind?: 'forged' | 'walk') => warned.push({ text, kind }) };
    return { ...g, w, ctx, warned, at: w.arriveAt + 2 };
  }
  const far = (to: { x: number; y: number }) => ({ x: to.x + 12, y: to.y + 5 });

  it('удар издалека «за ноль»: отказ и флаг «срок пути»; лагерь не тронут', () => {
    const { file, w, ctx, warned, at } = camp();
    const from = far(w.to);
    expect(fieldWalkFloorMs(from, w.to), 'точка внутри области: до цели не у ворот').toBeGreaterThan(60_000);
    const order = { op: 'strike' as const, id: w.id, army: army({ spearman: 10 }), joint: false, walkMs: 0, from };
    expect(applyOrder(file, B, order, at, ctx)).toBe('Так быстро полководцу не дойти. Обнови игру и попробуй снова.');
    expect(w.strike).toBeUndefined();
    expect(warned.map((x) => x.kind)).toEqual(['walk']);
  });

  it('честный срок — ландшафтом любой личной карты — не короче пола: удар принят, приходит в свой срок', () => {
    const from = far({ x: 0, y: 0 });
    const to = { x: 0, y: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const honest = Math.round(realMs(fieldWalkSeconds(from, to, terrainFactor(seed, from, to))));
      expect(honest, `сид ${seed}`).toBeGreaterThanOrEqual(fieldWalkFloorMs(from, to));
    }
    const { file, w, ctx, warned, at } = camp();
    const at0 = far(w.to);
    const walkMs = Math.round(realMs(fieldWalkSeconds(at0, w.to, terrainFactor(7, at0, w.to))));
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs, from: at0 }, at, ctx)).toBeNull();
    expect(w.strike?.at).toBe(at + walkMs);
    expect(warned).toEqual([]);
  });

  it('у ворот — сразу: ноль законен, когда полководец ближе полуклетки', () => {
    const { file, w, ctx, warned, at } = camp();
    const from = { x: w.to.x + 0.3, y: w.to.y };
    expect(fieldWalkFloorMs(from, w.to)).toBe(0);
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs: 0, from }, at, ctx)).toBeNull();
    expect(warned).toEqual([]);
  });

  it('место дальше, чем полководец мог уйти со слепка: отказ и флаг; ближе — принято', () => {
    const { file, sheets, w, ctx, warned, at } = camp({ x: 0, y: 0 });
    const s = sheets.get(B)!;
    const reach = fieldReach(at - s.at);
    const gen = s.sheet.gen!;
    const out = { x: w.to.x, y: w.to.y };
    expect(Math.hypot(out.x - gen.x, out.y - gen.y), 'точка внутри области: дальше, чем мог уйти').toBeGreaterThan(reach);
    const walkMs = fieldWalkFloorMs(out, w.to);
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs, from: out }, at, ctx)).toBe(
      'Полководец не мог оказаться там так быстро. Обнови игру и попробуй снова.',
    );
    expect(warned.map((x) => x.kind)).toEqual(['walk']);
    // Слепок свежий и полководец у своих ворот — то же место законно.
    sheets.set(B, { ...s, sheet: { ...s.sheet, gen: { ...w.to } }, at });
    expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs, from: out }, at, ctx)).toBeNull();
  });
});
