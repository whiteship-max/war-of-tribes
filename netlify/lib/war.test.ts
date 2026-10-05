import { describe, expect, it } from 'vitest';
import { readWarOrder, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, fallId, liveSheet, newsDiff, newsMap, newsOf, viewOf, warsOf, type SheetAt, type WarFile } from './war.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';
import { energyAt, energyBlock, priceOf } from '../../src/world/energy.js';
import { ENERGY_FILL, ENERGY_MAX } from '../../src/world/data/energy.js';

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

  it('поход с осадой: не хватает — отказ словами двери; хватает — цена списана, и пока идёт война, энергия стоит', () => {
    const { ctx, file, sheets } = setup();
    const need = priceOf('march') + priceOf('siege');
    const march = (value: number) =>
      applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: withEnergy(value) }, T0, ctx);
    expect(march(need - 1)).toBe(energyBlock(need - 1, need));
    expect(file.wars).toHaveLength(0);
    // Десять сверх цены похода: на штурм из лагеря уже не хватит.
    expect(march(need + 10)).toBeNull();
    const w = file.wars[0];
    expect(w.army.energy).toEqual({ value: 10, at: T0, mode: 'hold' });
    // Путь сервер по часам не жжёт: в лагере столько же, сколько при выходе.
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    expect(energyAt(w.army.energy, w.arriveAt + 1)).toBe(10);
    // Штурм из лагеря стоит свою цену — без неё отказ.
    expect(applyOrder(file, A, { op: 'storm', id: w.id }, w.arriveAt + 2, ctx)).toBe(energyBlock(10, priceOf('storm')));
    expect(w.phase).toBe('camp');
    // Снял осаду — домой: дорогу назад сервер тоже не жжёт, с минуты возврата энергия копится.
    expect(applyOrder(file, A, { op: 'retreat', id: w.id }, w.arriveAt + 3, ctx)).toBeNull();
    expect(w.army.energy?.homeAt).toBe(w.backAt);
    expect(energyAt(w.army.energy, w.backAt as number)).toBe(10);
    expect(energyAt(w.army.energy, (w.backAt as number) + ENERGY_FILL)).toBe(ENERGY_MAX);
  });

  it('удар полководца города по лагерю: энергии должно хватить к приходу, с дорогой по карте', () => {
    const { ctx, file, sheets } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    advance(file, w.arriveAt + 1, sheets);
    expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
    const strike = (value: number) =>
      applyOrder(file, B, { op: 'strike', id: w.id, army: { ...withEnergy(value, { spearman: 20 }), energy: { value, at: w.arriveAt + 2, mode: 'drain' } }, joint: false, walkMs: 0 }, w.arriveAt + 2, ctx);
    expect(strike(priceOf('strike') - 1)).toBe(energyBlock(priceOf('strike') - 1, priceOf('strike')));
    expect(w.strike).toBeUndefined();
    expect(strike(priceOf('strike'))).toBeNull();
    expect(w.strike).toBeDefined();
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
