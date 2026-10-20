// Переговоры у стен между игроками (docs/siege_v2.md, раздел 7; этап 2е): сдача на условиях и дань за снятие осады — считает
// сервер войны дверью `world/parley`. Свойства: дань переходит, а не начисляется (сколько ушло у города — столько пришло
// походу, не больше открытого склада); переговоры не обходят правила войны (предлагает и отвечает только своя сторона,
// условия — только мягче объявленной, одно предложение на сторону в фазу, цену назначает сервер, город после дани
// неприкосновенен, как после падения). Кость фаз подменяется тихой (`setPhaseDie`): правило переговоров — не фазы.
import { afterEach, describe, expect, it } from 'vitest';
import { readWarOrder, warTributeId, type CastleClaim, type RosterFile, type WarArmy, type WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, fairOf, liveSheet, newsOf, type SheetAt, type WarFile, type WarRow } from './war.js';
import { phaseAt, setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, starvesAt, type SiegeWindow } from '../../src/world/siege.js';
import { siegeShare } from '../../src/world/parley.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { SIEGE_IMMUNE } from '../../src/world/data/tuning.js';

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
  levels: { farm: 4, palisade: 1 },
  power: 5000,
  locks: {},
  seen: [],
  ...over,
});

/** Альфа осадила Бету с участью «увести людей»: лагерь стоит. */
function camped() {
  setPhaseDie(() => 7);
  let roster: RosterFile = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  roster = upsert(roster, C, claim('Гамма'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
    [C, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars() as WarFile;
  const army: WarArmy = { troops: { spearman: 60, archer: 30 }, resolve: 0, pips: {} };
  expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'captives', army }, T0, ctx)).toBeNull();
  const w = file.wars[0] as WarRow;
  advance(file, w.arriveAt + 1, sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  w.army = { ...w.army, energy: { value: ENERGY_MAX, at: w.arriveAt, mode: 'camp' } };
  const since = siegeSince(w.camp as SiegeWindow);
  // Середина второй фазы: лагерь стоит, хлеба ещё много — точка внутри области переговоров (до голода и до сдачи).
  const at = phaseAt(since, 1) + 3_600_000;
  advance(file, at, sheets);
  expect(w.phase).toBe('camp');
  expect(at < starvesAt(w.camp as SiegeWindow), 'точка внутри области: город ещё не доеден').toBe(true);
  return { file, sheets, ctx, w, since, at };
}

describe('дань за снятие осады', () => {
  it('переходит, а не начисляется: ушло у города столько же, сколько пришло походу, и не больше открытого склада', () => {
    const { file, sheets, ctx, w, at } = camped();
    const before = liveSheet(file, B, sheets.get(B)!, at);
    expect(applyOrder(file, B, { op: 'offer', id: w.id, kind: 'tribute' }, at, ctx)).toBeNull();
    const offer = w.camp!.offers![0];
    // Цену назначает сервер — справедливую на минуту предложения (добыча объявленной участи × доля пути).
    expect(offer.price).toBe(fairOf(w, at, before));
    expect(offer.price!, 'точка внутри области: дань не пустая').toBeGreaterThan(0);
    expect(applyOrder(file, A, { op: 'answer', id: w.id, kind: 'tribute', yes: true }, at + 1, ctx)).toBeNull();
    const t = w.tribute!;
    const total = Object.values(t.taken).reduce((n, v) => n + v, 0);
    expect(total).toBe(offer.price);
    // Каждого припаса ушло не больше, чем лежало на виду сверх тайника.
    for (const [k, v] of Object.entries(t.taken)) {
      const had = k === 'gold' ? before.gold : (before.stock[k] ?? 0);
      expect(v).toBeLessThanOrEqual(Math.max(0, had - before.stash));
    }
    // Город, ещё не принявший дань, видится серверу без неё (переход), а принявший — нет (один раз). Лагерь снят — хлеба
    // окна больше нет (docs/siege_v2.md, 21.1), и склад — слепка за вычетом дани.
    const after = liveSheet(file, B, sheets.get(B)!, at + 2);
    for (const [k, v] of Object.entries(t.taken)) {
      if (k === 'gold') expect(after.gold).toBe(before.gold - v);
      else expect(after.stock[k]).toBe((sheet().stock[k] ?? 0) - v);
    }
    sheets.set(B, { sheet: { ...sheets.get(B)!.sheet, seen: [warTributeId(w.id)] }, at: at + 3 });
    expect(liveSheet(file, B, sheets.get(B)!, at + 3).gold).toBe(sheet().gold);
    // Лагерь снят, война кончилась данью.
    expect(w.phase).toBe('back');
    expect(w.end).toBe('paid');
    expect(w.camp).toBeUndefined();
  });

  it('город после дани неприкосновенен, как после падения', () => {
    const { file, sheets, ctx, w, at } = camped();
    expect(applyOrder(file, B, { op: 'offer', id: w.id, kind: 'tribute' }, at, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'answer', id: w.id, kind: 'tribute', yes: true }, at + 1, ctx)).toBeNull();
    // Поход вернулся — и снова идёт на тот же город, пока защита не кончилась: тот же отказ, что после падения.
    advance(file, w.backAt! + 1, sheets);
    expect(w.phase).toBe('done');
    const army: WarArmy = { troops: { spearman: 10 }, resolve: 0, pips: {} };
    const soon = w.backAt! + 2;
    expect(soon < at + 1 + SIEGE_IMMUNE, 'точка внутри области: защита не кончилась').toBe(true);
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army }, soon, ctx)).toBe(
      'Город недавно пал. Пока его не трогают.',
    );
  });

  it('цену в приказе не назвать: разбор приказа её не берёт', () => {
    expect(readWarOrder({ op: 'offer', id: 'w1', kind: 'tribute', price: 1 })).toEqual({ op: 'offer', id: 'w1', kind: 'tribute' });
    expect(readWarOrder({ op: 'offer', id: 'w1', kind: 'tribute', fate: 'plunder' })).toEqual({ op: 'offer', id: 'w1', kind: 'tribute' });
  });

  it('растёт с ходом осады: позже — дороже', () => {
    const { file, sheets, w, since, at } = camped();
    const s = liveSheet(file, B, sheets.get(B)!, at);
    const later = phaseAt(since, 3) + 60_000;
    expect(later < starvesAt(w.camp as SiegeWindow), 'точка внутри области').toBe(true);
    expect(siegeShare(w.camp as SiegeWindow, later)).toBeGreaterThan(siegeShare(w.camp as SiegeWindow, at));
    expect(fairOf(w, later, s)).toBeGreaterThan(fairOf(w, at, s));
  });
});

describe('сдача на условиях', () => {
  it('принятые условия — падение сдачей с участью из условий, гарнизон уходит живым', () => {
    const { file, ctx, w, at } = camped();
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'terms', fate: 'plunder' }, at, ctx)).toBeNull();
    expect(applyOrder(file, B, { op: 'answer', id: w.id, kind: 'terms', yes: true }, at + 1, ctx)).toBeNull();
    expect(w.fall?.by).toBe('gates');
    expect(w.fall?.terms).toBe(true);
    expect(w.fall?.fate).toBe('plunder');
    expect(w.fall?.routed).toEqual({});
    expect(w.end).toBe('taken');
  });

  it('отказ — осада идёт; весть об отказе уходит предложившему', () => {
    const { file, ctx, w, at } = camped();
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'terms', fate: 'plunder' }, at, ctx)).toBeNull();
    expect(applyOrder(file, B, { op: 'answer', id: w.id, kind: 'terms', yes: false }, at + 1, ctx)).toBeNull();
    expect(w.phase).toBe('camp');
    expect(w.fall).toBeUndefined();
    const news = newsOf(w).filter((n) => n.item.kind === 'war-parley');
    expect(news.find((n) => n.player === B && !n.item.p.answer)?.item.p.offer, 'предложение — защитнику').toBe('terms');
    expect(news.find((n) => n.player === A && n.item.p.answer === 'no')?.item.p.offer, 'отказ — нападающему').toBe('terms');
  });

  it('наказ осаждённого принимает условия не хуже названной участи — и только их', () => {
    const { file, ctx, w, at } = camped();
    expect(applyOrder(file, B, { op: 'defend', id: w.id, defend: { terms: 'plunder' } }, at - 10, ctx)).toBeNull();
    // Предлагать хуже названного нельзя и без наказа: условия — только мягче объявленной («увести людей»).
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'terms', fate: 'captives' }, at, ctx)).toBe('Условия сдачи — участь мягче объявленной.');
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'terms', fate: 'plunder' }, at, ctx)).toBeNull();
    expect(w.fall?.terms, 'наказ открыл ворота в минуту предложения').toBe(true);
  });
});

describe('переговоры не обходят правила войны', () => {
  it('предлагает и отвечает только своя сторона', () => {
    const { file, ctx, w, at } = camped();
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'tribute' }, at, ctx)).toBe('Лагеря под стенами уже нет.');
    expect(applyOrder(file, B, { op: 'offer', id: w.id, kind: 'terms', fate: 'plunder' }, at, ctx)).toBe('Лагеря уже нет.');
    expect(applyOrder(file, B, { op: 'offer', id: w.id, kind: 'tribute' }, at, ctx)).toBeNull();
    // На свою же дань не ответить: отвечает лагерь.
    expect(applyOrder(file, B, { op: 'answer', id: w.id, kind: 'tribute', yes: true }, at + 1, ctx)).toBe('Лагеря уже нет.');
    expect(w.tribute).toBeUndefined();
  });

  it('одно предложение на сторону в фазу; истёкшее принять нельзя', () => {
    const { file, ctx, w, since, at } = camped();
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'terms', fate: 'plunder' }, at, ctx)).toBeNull();
    expect(applyOrder(file, A, { op: 'offer', id: w.id, kind: 'terms', fate: 'plunder' }, at + 1, ctx)).toBe(
      'В эту фазу уже предлагали. Следующее — в новой фазе.',
    );
    const until = w.camp!.offers![0].until;
    // Стоит до конца следующей фазы.
    expect(until).toBe(phaseAt(since, 3));
    expect(applyOrder(file, B, { op: 'answer', id: w.id, kind: 'terms', yes: true }, until, ctx)).toBe('Предложение уже не в силе.');
    expect(w.fall).toBeUndefined();
  });
});
