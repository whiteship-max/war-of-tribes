// Ответы осаждённого между игроками (docs/siege_v2.md, раздел 5; этап 2г): починка пролома, паёк, вылазка на машину, сдача,
// наказы осаждённого и выручка соседом с пактом — считает сервер войны той же дверью, что мир. Кость фаз подменяется
// (`setPhaseDie`), чтобы точка стояла внутри области правила: пролом есть, лагерь стоит, хлеба хватает.
import { afterEach, describe, expect, it } from 'vitest';
import { readWarOrder, warRepairId, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, newsOf, pacted, pactsOf, warsOf, type SheetAt, type WarFile, type WarRow } from './war.js';
import { breachesOf, breadLeft, phaseAt, setPhaseDie, softerFate } from '../../src/world/siegeroll.js';
import { siegeSince, starvesAt, type SiegeWindow } from '../../src/world/siege.js';
import { machinesAt } from '../../src/world/machines.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { wallRepairCost } from '../../src/game/build.js';
import { SIEGE_RATION } from '../../src/game/constants.js';

afterEach(() => setPhaseDie(null));

const A = 'tg-2001';
const B = 'tg-2002';
const C = 'tg-2003';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

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
  stock: { food: 2000, wood: 3000, stone: 1000 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  // Стены первого уровня: кости фазы они не убавляют (−1 за каждые два уровня), а починка — треть цены уровня
  // (`build.wallRepairCost`). Так кость 14 — пролом, и точка внутри области правила починки.
  levels: { farm: 4, palisade: 1 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

function setup(over: { b?: Partial<WarSheet> } = {}) {
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  roster = upsert(roster, C, claim('Гамма'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(over.b), at: T0 }],
    [C, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  return { sheets, ctx, file: emptyWars() as WarFile };
}

/** Альфа осадила Бету: лагерь стоит. */
function camped(over: { b?: Partial<WarSheet> } = {}) {
  const s = setup(over);
  const army: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  expect(applyOrder(s.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army }, T0, s.ctx)).toBeNull();
  const w = s.file.wars[0] as WarRow;
  advance(s.file, w.arriveAt + 1, s.sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
  return { ...s, w, since: siegeSince(w.camp as SiegeWindow) };
}

describe('починка пролома', () => {
  it('закрывает пролом к концу фазы, в которой начали: бросок этой фазы видит стену целой', () => {
    // Кость 14 у стены первого уровня — пролом в первой фазе, дальше «без перемен».
    const dice = [14, 7, 7];
    setPhaseDie((_seed, k) => dice[k - 1] ?? 7);
    const { file, sheets, ctx, w, since } = camped();
    advance(file, phaseAt(since, 1) + 1, sheets);
    expect(w.camp?.phases?.[0].out, 'точка внутри области: пролом был').toBe('breach');
    expect(breachesOf(w.camp as SiegeWindow)).toBe(1);
    const at = phaseAt(since, 1) + 60_000;
    expect(applyOrder(file, B, { op: 'repair', id: w.id }, at, ctx)).toBeNull();
    // Пока фаза идёт — пролом открыт; второй раз в ту же фазу — отказ.
    expect(breachesOf(w.camp as SiegeWindow)).toBe(1);
    expect(applyOrder(file, B, { op: 'repair', id: w.id }, at + 1, ctx)).toBe('Пролом этой фазы уже заделывают. Следующий — в новой фазе.');
    advance(file, phaseAt(since, 2) + 1, sheets);
    const row = w.camp!.phases![1];
    expect(row.mods.breach, 'бросок второй фазы — без пролома').toBeUndefined();
    expect(breachesOf(w.camp as SiegeWindow)).toBe(0);
    // Чинит только защитник.
    expect(applyOrder(file, A, { op: 'repair', id: w.id }, phaseAt(since, 2) + 2, ctx)).toBe('Лагеря под стенами уже нет.');
  });

  it('цена — со склада слепка, за вычетом неоплаченных починок; клиент отмечает оплату в `seen`', () => {
    setPhaseDie((_seed, k) => (k <= 2 ? 14 : 7));
    const cost = wallRepairCost(1);
    expect(cost.wood ?? 0, 'точка внутри области: у стен цена есть').toBeGreaterThan(0);
    // Склада — ровно на одну починку.
    const { file, sheets, ctx, w, since } = camped({ b: { stock: { ...cost, food: 2000 } as WarSheet['stock'] } });
    advance(file, phaseAt(since, 1) + 1, sheets);
    expect(applyOrder(file, B, { op: 'repair', id: w.id }, phaseAt(since, 1) + 10, ctx)).toBeNull();
    advance(file, phaseAt(since, 2) + 1, sheets);
    expect(w.camp?.phases?.[1].out, 'точка внутри области: второй пролом').toBe('breach');
    // Первая не оплачена — на вторую склада не хватает.
    expect(applyOrder(file, B, { op: 'repair', id: w.id }, phaseAt(since, 2) + 10, ctx)).toBe('На починку не хватает дерева и камня.');
    // Клиент оплатил первую — сервер видит отметку в слепке и не числит её.
    const first = (w.camp?.log ?? []).find((d) => d.act === 'repair')!;
    sheets.set(B, { sheet: sheet({ stock: { ...cost, food: 2000 } as WarSheet['stock'], seen: [warRepairId(w.id, first.at)] }), at: T0 });
    expect(applyOrder(file, B, { op: 'repair', id: w.id }, phaseAt(since, 2) + 11, ctx)).toBeNull();
  });
});

describe('осадный паёк', () => {
  it('×¾ с минуты приказа: остаток хлеба тот же, хватает его на треть дольше; вернуть — как было', () => {
    setPhaseDie(() => 7);
    const { file, ctx, w, since } = camped();
    const at = since + 3_600_000;
    const before = w.starvesAt as number;
    expect(before, 'точка внутри области: голод позже приказа').toBeGreaterThan(at);
    expect(applyOrder(file, B, { op: 'ration', id: w.id, on: true }, at, ctx)).toBeNull();
    expect(w.camp?.ration).toBe(true);
    expect((w.starvesAt as number) - at).toBeCloseTo((before - at) / SIEGE_RATION, -2);
    expect(applyOrder(file, B, { op: 'ration', id: w.id, on: true }, at + 1, ctx)).toBe('Паёк и так урезан.');
    expect(applyOrder(file, B, { op: 'ration', id: w.id, on: false }, at, ctx)).toBeNull();
    expect(Math.abs((w.starvesAt as number) - before)).toBeLessThan(1000);
    expect(starvesAt(w.camp as SiegeWindow)).toBe(w.starvesAt);
  });
});

describe('наказы осаждённого', () => {
  it('в минуту фазы: пролом — починка по наказу, хлеба меньше половины — паёк по наказу', () => {
    setPhaseDie(() => 14);
    // Хлеба мало: к первой фазе его меньше половины, голод — позже второй фазы.
    const { file, sheets, ctx, w, since } = camped({ b: { food: 300 } });
    expect(readWarOrder({ op: 'defend', id: w.id, defend: { repair: true, ration: true, x: 1 } })).toEqual({
      op: 'defend',
      id: w.id,
      defend: { repair: true, ration: true },
    });
    expect(applyOrder(file, B, { op: 'defend', id: w.id, defend: { repair: true, ration: true } }, since + 1, ctx)).toBeNull();
    expect(w.starvesAt ?? 0, 'точка внутри области: город доживёт до фазы').toBeGreaterThan(phaseAt(since, 1));
    expect(breadLeft(w.camp as SiegeWindow, phaseAt(since, 1)), 'точка внутри области: хлеба меньше половины').toBeLessThan(0.5);
    advance(file, phaseAt(since, 1) + 1, sheets);
    const row = w.camp!.phases![0];
    expect(row.out, 'точка внутри области: пролом').toBe('breach');
    expect(row.orders).toEqual(['repair', 'ration']);
    expect(w.camp?.ration).toBe(true);
    expect((w.camp?.log ?? []).filter((d) => d.act === 'repair')).toHaveLength(1);
    // Весть о сработавшем наказе — тому, чей он: осаждённому, а не лагерю.
    const news = newsOf(w).filter((n) => n.item.kind === 'war-phase' && n.item.p.k === 1);
    expect(news.find((n) => n.player === B)?.item.p.order).toBe('repair');
    expect(news.find((n) => n.player === A)?.item.p.order).toBeUndefined();
  });
});

describe('вылазка на машину', () => {
  it('бой с охраной машины; победа сжигает её вместе с древесиной, лагерь стоит', () => {
    setPhaseDie(() => 7);
    const { file, ctx, w, since } = camped({ b: { home: { spearman: 200, archer: 60 } } });
    // Лес — машинам, таран заказан и строится.
    expect(applyOrder(file, A, { op: 'wood', id: w.id, machines: 1 }, since + 1, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'machine', id: w.id, machine: 'ram' }, since + 2, ctx)).toBeNull();
    expect(applyOrder(file, B, { op: 'burn', id: w.id, machine: 'tower', troops: { spearman: 10 } }, since + 3, ctx)).toBe(
      'Осадная башня: у лагеря её нет.',
    );
    expect(applyOrder(file, B, { op: 'burn', id: w.id, machine: 'ram', troops: { spearman: 200, archer: 60 } }, since + 3, ctx)).toBeNull();
    const b = w.battles[w.battles.length - 1];
    expect(b.burn).toBe('ram');
    expect(b.won, 'точка внутри области: охрану смяли').toBe(true);
    expect(w.phase, 'лагерь стоит').toBe('camp');
    const ram = machinesAt(w.camp as SiegeWindow, since + 4).find((m) => m.id === 'ram');
    expect(ram?.burned).toBe(true);
    expect(ram?.ready).toBe(false);
    // Охрана — доля лагеря, а не весь лагерь.
    const fought = Object.values(b.input.defender.kinds).reduce((n, v) => n + v, 0);
    const camp = Object.values(b.atkTroops).reduce((n, v) => n + (v ?? 0), 0);
    expect(fought).toBeLessThan(camp / 2);
  });
});

describe('сдача', () => {
  it('ворота открывает город: участь на ступень мягче, гарнизон уходит живым', () => {
    setPhaseDie(() => 7);
    const { file, ctx, w, since } = camped();
    expect(applyOrder(file, A, { op: 'surrender', id: w.id }, since + 5, ctx)).toBe('Лагеря под стенами уже нет.');
    expect(applyOrder(file, B, { op: 'surrender', id: w.id }, since + 5, ctx)).toBeNull();
    expect(w.fall?.by).toBe('gates');
    expect(w.fall?.fate).toBe(softerFate('captives'));
    expect(w.fall?.routed).toEqual({});
    expect(w.end).toBe('taken');
  });
});

describe('пакт и выручка', () => {
  it('пакт — когда оба сказали «да»; на союзника походом не пойти; разорвать может любой', () => {
    const { file, ctx } = setup();
    expect(applyOrder(file, B, { op: 'pact', target: castleIdOf(C) }, T0, ctx)).toBeNull();
    expect(pacted(file, B, C)).toBe(false);
    expect(pactsOf(file, B)).toMatchObject([{ castle: castleIdOf(C), state: 'offered' }]);
    expect(pactsOf(file, C)).toMatchObject([{ castle: castleIdOf(B), state: 'asked' }]);
    expect(applyOrder(file, C, { op: 'pact', target: castleIdOf(B) }, T0 + 1, ctx)).toBeNull();
    expect(pacted(file, B, C)).toBe(true);
    expect(pactsOf(file, C)).toMatchObject([{ castle: castleIdOf(B), state: 'pact', city: 'Бета' }]);
    const army: WarArmy = { troops: { spearman: 10 }, resolve: 0, pips: {} };
    expect(applyOrder(file, C, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, T0 + 2, ctx)).toBe(
      'С этим городом у нас пакт. Сначала разорви его.',
    );
    expect(applyOrder(file, B, { op: 'unpact', target: castleIdOf(C) }, T0 + 3, ctx)).toBeNull();
    expect(pacted(file, B, C)).toBe(false);
  });

  it('союзник осаждённого бьёт лагерь с тыла в минуту прихода; его дружину город не списывает', () => {
    setPhaseDie(() => 7);
    const { file, sheets, ctx, w, since } = camped();
    const army: WarArmy = { troops: { spearman: 60, swordsman: 30 }, resolve: 0, pips: {}, energy: { value: ENERGY_MAX, at: since, mode: 'hold' } };
    // Без пакта — отказ.
    expect(applyOrder(file, C, { op: 'relief', id: w.id, army, walkMs: 3_600_000 }, since + 10, ctx)).toBe(
      'На выручку идут только к союзнику по пакту.',
    );
    expect(applyOrder(file, B, { op: 'pact', target: castleIdOf(C) }, since + 11, ctx)).toBeNull();
    expect(applyOrder(file, C, { op: 'pact', target: castleIdOf(B) }, since + 12, ctx)).toBeNull();
    // Союзник видит осаду: роль — союзник, свой замок назван.
    const seen = warsOf(file, C).find((x) => x.id === w.id);
    expect(seen?.role).toBe('ally');
    expect(seen?.me).toBe(castleIdOf(C));
    expect(applyOrder(file, C, { op: 'relief', id: w.id, army, walkMs: 3_600_000 }, since + 13, ctx)).toBeNull();
    expect(applyOrder(file, C, { op: 'relief', id: w.id, army, walkMs: 3_600_000 }, since + 14, ctx)).toBe('Наша дружина уже идёт на выручку.');
    const at = w.reliefs?.[0].at ?? 0;
    expect(at, 'точка внутри области: удар раньше фазы и голода').toBeLessThan(Math.min(phaseAt(since, 1), w.starvesAt ?? Infinity));
    advance(file, at + 1, sheets);
    const b = w.battles[w.battles.length - 1];
    expect(b.at).toBe(at);
    expect(b.ally).toBe(castleIdOf(C));
    expect(b.genTroops).toEqual(army.troops);
    expect(b.homeTroops, 'гарнизон города не выходил').toEqual({});
    expect(w.reliefs).toBeUndefined();
  });
});
