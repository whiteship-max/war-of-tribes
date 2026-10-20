import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { HomeEffect, PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, spiesOf, spyMenuOf, type SheetAt } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';
import { ENERGY_MAX } from './data/energy';
import { priceOf } from './energy';

/**
 * Лазутчик против соседа от приказа до итога на двух мирах и одном сервере в памяти (docs/spy_pvp.md). Сервер — настоящие
 * правила `netlify/lib/war.ts`, миры — настоящие `LocalWorld` со своими слепками. Держит то, что ломается молча: итог
 * доходит до обеих сторон ровно один раз, украденное у соседа — ровно пришедшее к нам, энергия списана один раз (сервером,
 * а не ещё и клиентом), лазутчик возвращается домой.
 */
const T0 = 1_900_000_000_000;
const A = 'tg-2001';
const B = 'tg-2002';

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: 400,
  defense: 300,
  militia: 20,
  militiaArchers: 6,
  units: { warrior: 120, scout: 4 },
  army: { spearman: 60, archer: 30, swordsman: 30 },
  stock: { food: 3000, wood: 800, stone: 300 },
  stash: 50,
  gold: 300,
  food: 3000,
  foodPerHour: 30,
  soldierFoodPerHour: 1,
});

function game() {
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
    wars: () => [],
    spies: () => {
      advance(file, now, sheets);
      return spiesOf(file, me);
    },
    warsKnown: () => true,
    warOrder: async (o: WarOrder) => {
      advance(file, now, sheets);
      return applyOrder(file, me, o, now, ctx);
    },
    spyLook: async (target: string) => spyMenuOf(file, me, target, now, ctx),
  });
  const world = (me: string): LocalWorld =>
    new LocalWorld({ seed: me === A ? 11 : 12, now: () => now, storage: null, home: roster.rows[me], castles: castlesFor(me), ...link(me) });
  const a = world(A);
  const b = world(B);
  const pulse = async () => {
    const pa = await a.sync(profile());
    const pb = await b.sync(profile());
    sheets.set(A, { sheet: a.warSheet()!, at: now });
    sheets.set(B, { sheet: b.warSheet()!, at: now });
    return { pa, pb };
  };
  return { a, b, file, pulse, now: () => now, step: (ms: number) => (now += ms), target: castleIdOf(B) };
}

/** Сумма добра в последствиях: склад и казна. */
const goods = (effects: HomeEffect[]): number =>
  effects.reduce((n, e) => n + Object.values(e.resources ?? {}).reduce((m: number, v) => m + (v ?? 0), 0), 0);

describe('лазутчик против соседа: путь от меню до итога у обеих сторон', () => {
  it('кража: меню с сервера, энергия списана один раз, добро перешло, итог у обоих один раз, лазутчик дома', async () => {
    const g = game();
    await g.pulse();
    const card = await g.a.settlement(g.target);
    expect(card?.spy?.reason ?? null).toBeNull();
    const menu = await g.a.spyMenu(g.target);
    expect(menu.error).toBeNull();
    expect(menu.options.map((o) => o.deed)).toEqual(['look', 'fire', 'theft', 'unrest']);
    const theft = menu.options.find((o) => o.deed === 'theft')!;
    expect(theft.can).toBe(true);
    expect(theft.energy.price).toBe(priceOf('theft'));

    expect(await g.a.spyRival(g.target, 'theft', menu.at)).toBeNull();
    expect(g.file.spies).toHaveLength(1);
    const row = g.file.spies![0];
    // Исход здесь назначен руками — тест держит путь итога, а не кость (её держит netlify/lib/spy.test.ts).
    row.chance = 1;
    row.peril = 0;

    // Энергию списал сервер; клиент взял его отметку и своей цены не списал.
    let { pa } = await g.pulse();
    const spy = pa.figures.find((f) => f.id === 'spy')!;
    expect(spy.phase).toBe('moving');
    expect(spy.energy?.value).toBe(ENERGY_MAX - priceOf('theft'));
    // Второго дела, пока первое идёт, нет.
    expect((await g.a.spyMenu(g.target)).error).toMatch(/на тайном деле/);

    g.step(row.arriveAt - g.now() + 1000);
    const { pa: pa2, pb: pb2 } = await g.pulse();
    expect(row.out?.ok).toBe(true);
    const stolen = Object.values(row.out?.stolen ?? {}).reduce((n, v) => n + v, 0);
    expect(stolen).toBeGreaterThan(0);
    // Переход: что пришло к нам — ровно ушедшее у соседа.
    const gotA = goods(pa2.effects.filter((e) => e.id === `spy-${row.id}-eff`));
    const lostB = goods(pb2.effects.filter((e) => e.id === `spy-${row.id}-eff`));
    expect(gotA).toBe(stolen);
    expect(lostB).toBe(-stolen);
    const ra = (await g.a.reports()).find((r) => r.id === `spy-${row.id}`);
    const rb = (await g.b.reports()).find((r) => r.id === `spy-${row.id}`);
    expect(ra?.won).toBe(true);
    expect(rb?.text).toMatch(/не узнали/);

    // Второй пульс тех же итогов не добавляет.
    const before = { a: (await g.a.reports()).length, b: (await g.b.reports()).length };
    const again = await g.pulse();
    expect(again.pa.effects.some((e) => e.id === `spy-${row.id}-eff`)).toBe(false);
    expect(again.pb.effects.some((e) => e.id === `spy-${row.id}-eff`)).toBe(false);
    expect((await g.a.reports()).length).toBe(before.a);
    expect((await g.b.reports()).length).toBe(before.b);

    // Домой — и снова свой человек: энергия копится, дела берёт.
    g.step((row.backAt ?? g.now()) - g.now() + 1000);
    ({ pa } = await g.pulse());
    expect(row.phase).toBe('done');
    const back = pa.figures.find((f) => f.id === 'spy')!;
    expect(back.phase).toBe('home');
    expect(g.a.warSheet()?.watch?.home).toBe(true);
  }, 60_000);

  it('пойманный лазутчик: сосед знает чей, у нас — задержан, потом идёт домой', async () => {
    const g = game();
    await g.pulse();
    const menu = await g.a.spyMenu(g.target);
    expect(await g.a.spyRival(g.target, 'fire', menu.at)).toBeNull();
    const row = g.file.spies![0];
    row.chance = 0;
    row.peril = 0;
    g.step(row.arriveAt - g.now() + 1000);
    const { pa } = await g.pulse();
    expect(row.phase).toBe('held');
    expect(pa.figures.find((f) => f.id === 'spy')?.held).toBe(true);
    const rb = (await g.b.reports()).find((r) => r.id === `spy-${row.id}`);
    expect(rb?.title).toMatch(/Альфа/);
    expect(await g.a.moveFigure('spy', { x: 0, y: 0 })).toMatch(/держат/);
    g.step((row.releaseAt ?? g.now()) - g.now() + 1000);
    await g.pulse();
    expect(row.phase).toBe('back');
    g.step((row.backAt ?? g.now()) - g.now() + 1000);
    const end = await g.pulse();
    expect(end.pa.figures.find((f) => f.id === 'spy')?.phase).toBe('home');
  }, 60_000);
});

describe('дело против соседа из «Походов» (Р-4) и подделка приказа серверу', () => {
  it('лазутчик идёт делом из меню дел: тот же приказ серверу, туда и домой ведёт сервер', async () => {
    const g = game();
    await g.pulse();
    const target = { kind: 'place', id: g.target } as const;
    const menu = await g.a.errands('spy', target);
    expect(menu.map((o) => o.id)).toEqual(['look', 'fire', 'theft', 'unrest']);
    const look = menu.find((o) => o.id === 'look')!;
    expect(look.reason).toBeNull();
    expect(look.walkMs, 'дорога до соседа — числом сервера').toBeGreaterThan(0);
    expect(await g.a.errand({ agent: 'spy', target, deed: 'look', shownAt: look.at })).toBeNull();
    expect(g.file.spies, 'приказ дошёл до сервера один раз').toHaveLength(1);
  });

  it('приказ мимо меню — не те шансы, войско сверх книги — сервер отказывает, войны и дела нет', async () => {
    const g = game();
    await g.pulse();
    const send = (g.b as unknown as { warOrderTo: (o: WarOrder) => Promise<string | null> }).warOrderTo;
    const theirs = castleIdOf(A);
    const forgedSpy = await send({ op: 'spy', target: theirs, deed: 'theft', shown: { chance: 1, peril: 0 }, at: g.now() });
    expect(forgedSpy, 'шанс «наверняка» и гибель ноль — не числа сервера').toBe('Обстановка у города сменилась. Посмотри дела заново.');
    const forgedMarch = await send({
      op: 'march',
      target: theirs,
      mode: 'storm',
      fate: 'plunder',
      army: { troops: { spearman: 99_999 }, resolve: 1, pips: {} },
    });
    expect(forgedMarch, 'войско сверх подтверждённого книгой').not.toBeNull();
    expect(g.file.spies ?? []).toHaveLength(0);
    expect(g.file.wars).toHaveLength(0);
  });
});
