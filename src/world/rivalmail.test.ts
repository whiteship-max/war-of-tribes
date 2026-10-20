import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { HomeEffect, PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, pacted, pactsOf, proposalsOf, warsOf, type SheetAt } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';
import { PROPOSALS } from './proposals';
import { proposalDispatch, mailGroups, rivalDispatches } from '@/ui/realm/dispatch';
import { dealFrom } from '@/ui/realm/golink';
import { refTopic } from '@/ui/realm/annals';

/**
 * Предложение соседа от приказа до «Вестей» и летописи (ДП-1) на трёх мирах и одном сервере войны в памяти: правила —
 * настоящие `netlify/lib/war.ts`, миры — настоящие `LocalWorld`. Держит то, что сломалось у игрока: весть пришла, а в игре
 * предложения нигде нет; ответить негде; что стало с предложением — непонятно.
 */
const T0 = 1_900_000_000_000;
const A = 'tg-2001';
const B = 'tg-2002';
const C = 'tg-2003';
const TTL = PROPOSALS.pact.ttlMs;

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
  roster = upsert(roster, C, claim('Гамма'), T0);
  const file = emptyWars();
  const sheets = new Map<string, SheetAt | null>();
  const flags: string[] = [];
  const castlesFor = (me: string): (() => PlayerCastle[]) => () =>
    Object.entries(roster.rows)
      .filter(([k]) => k !== me)
      .map(([k, r]) => ({ id: castleIdOf(k), x: r.x, y: r.y, name: r.name, city: r.city, power: r.power, pop: r.pop, seenAt: r.seenAt }));
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null, forged: (t: string) => void flags.push(t) };
  const link = (me: string) => ({
    wars: () => {
      advance(file, now, sheets);
      return warsOf(file, me);
    },
    proposals: () => {
      advance(file, now, sheets);
      return proposalsOf(file, me);
    },
    pacts: () => pactsOf(file, me),
    warsKnown: () => true,
    warOrder: async (o: WarOrder) => {
      advance(file, now, sheets);
      return applyOrder(file, me, o, now, ctx);
    },
  });
  const world = (me: string, seed: number): LocalWorld =>
    new LocalWorld({ seed, now: () => now, storage: null, home: roster.rows[me], castles: castlesFor(me), ...link(me) });
  const a = world(A, 11);
  const b = world(B, 12);
  const c = world(C, 13);
  const pulse = async () => ({ pa: await a.sync(profile()), pb: await b.sync(profile()), pc: await c.sync(profile()) });
  return { a, b, c, file, flags, pulse, now: () => now, step: (ms: number) => (now += ms) };
}

/** Строки летописи соседей в последствиях пульса: ключ `dip-…`. */
const lines = (effects: HomeEffect[]): string[] => effects.filter((e) => e.id.startsWith('dip-')).map((e) => e.text);

describe('ДП-1: предложение соседа в «Вестях» и летописи', () => {
  it('адресат видит предложение в «Соседях» — «Ждут ответа», кнопки в строке; у предложившего — «Ждём ответа»', async () => {
    const g = game();
    expect(await g.a.pact(castleIdOf(B), true)).toBeNull();
    const rb = await g.b.rivals();
    expect(rb.proposals).toHaveLength(1);
    const d = proposalDispatch(rb.proposals[0], g.now());
    expect(d).toMatchObject({ source: 'rival', title: 'Зовут в союз', from: 'Альфа', group: 'wait', quick: true, urgent: false });
    expect(d.text).toContain(PROPOSALS.pact.gives);
    expect(d.choices.map((x) => [x.label, x.block])).toEqual([
      ['Принять', null],
      ['Отклонить', null],
    ]);
    expect(d.left, 'срок ответа — сутки, секундами').toBe(TTL / 1000);
    expect(mailGroups([d]).map((x) => x.title)).toEqual(['Ждут ответа']);
    const da = proposalDispatch((await g.a.rivals()).proposals[0], g.now());
    expect(da).toMatchObject({ title: 'Союз: предложили', from: 'Бета', group: 'sent', quick: false });
    expect(da.choices.map((x) => x.label)).toEqual(['Отозвать']);
    expect((await g.c.rivals()).proposals, 'третьему — ничего').toEqual([]);
  });

  it('принять из «Вестей»: союз заключён, итог — «К сведению» и строка летописи обеим, один раз', async () => {
    const g = game();
    await g.a.pact(castleIdOf(B), true);
    const [p] = (await g.b.rivals()).proposals;
    g.step(60_000);
    expect(g.now(), 'точка внутри срока ответа').toBeLessThan(p.until);
    expect(await g.b.answerProposal(p.id, 'yes')).toBeNull();
    expect(pacted(g.file, A, B)).toBe(true);
    const { pa, pb } = await g.pulse();
    expect(lines(pa.effects)).toEqual(['Союз с «Бета» заключён. ' + PROPOSALS.pact.gives]);
    expect(lines(pb.effects)).toEqual(['Союз с «Альфа» заключён. ' + PROPOSALS.pact.gives]);
    const again = await g.pulse();
    expect(lines(again.pa.effects).concat(lines(again.pb.effects)), 'второй пульс строк не добавляет').toEqual([]);
    const d = proposalDispatch((await g.b.rivals()).proposals[0], g.now());
    expect(d).toMatchObject({ group: 'done', choices: [], left: null });
    // Карточка соседа на карте знает тот же союз.
    expect((await g.a.settlement(castleIdOf(B)))?.war?.pact).toBe('pact');
  });

  it('отклонённое уходит из «Ждут ответа» и попадает в летопись обеим своими словами', async () => {
    const g = game();
    await g.a.pact(castleIdOf(B), true);
    const [p] = (await g.b.rivals()).proposals;
    expect(await g.b.answerProposal(p.id, 'no')).toBeNull();
    const groups = mailGroups(rivalDispatches(await g.b.rivals(), g.now())).map((x) => x.id);
    expect(groups).toEqual(['done']);
    expect(mailGroups(rivalDispatches(await g.a.rivals(), g.now())).map((x) => x.id)).toEqual(['done']);
    const { pa, pb } = await g.pulse();
    expect(lines(pa.effects)).toEqual(['«Бета» отклонил наше предложение союза.']);
    expect(lines(pb.effects)).toEqual(['Мы отклонили предложение союза от «Альфа».']);
    expect(refTopic(pa.effects.find((e) => e.id.startsWith('dip-'))!.id), 'летопись — род «Соседи»').toBe('rival');
  });

  it('просроченное уходит из «Ждут ответа» и попадает в летопись обеим', async () => {
    const g = game();
    await g.a.pact(castleIdOf(B), true);
    const [p] = (await g.b.rivals()).proposals;
    g.step(TTL + 1000);
    expect(g.now(), 'точка за сроком').toBeGreaterThan(p.until);
    const { pa, pb } = await g.pulse();
    expect(lines(pa.effects)).toEqual(['«Бета» не ответил на предложение союза: срок вышел.']);
    expect(lines(pb.effects)).toEqual(['Предложение союза от «Альфа» осталось без ответа: срок вышел.']);
    const rb = await g.b.rivals();
    expect(rb.proposals.filter((x) => !x.end)).toEqual([]);
    expect(mailGroups(rivalDispatches(rb, g.now())).map((x) => x.id)).toEqual(['done']);
    expect(await g.b.answerProposal(p.id, 'yes')).toBe('Срок ответа вышел.');
  });

  it('чужой ответ — отказ: третий не принимает чужое предложение по номеру', async () => {
    const g = game();
    await g.a.pact(castleIdOf(B), true);
    const [p] = (await g.b.rivals()).proposals;
    expect(await g.c.answerProposal(p.id, 'yes')).toBe('Это предложение не вам.');
    expect(g.flags).toHaveLength(1);
    expect(pacted(g.file, A, C) || pacted(g.file, A, B)).toBe(false);
    expect((await g.b.rivals()).proposals[0].end).toBeUndefined();
  });

  it('весть ведёт к предложению: номер из адреса запуска — ключ того же предложения в «Вестях»', async () => {
    const g = game();
    await g.a.pact(castleIdOf(B), true);
    const [p] = (await g.b.rivals()).proposals;
    expect(dealFrom(`?go=deal-${encodeURIComponent(p.id)}`)).toBe(p.id);
    expect(dealFrom('?go=deal-')).toBeNull();
    expect(dealFrom('?fpscap=30')).toBeNull();
  });
});
