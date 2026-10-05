import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, warsOf, type SheetAt } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';

// Энергия агентов здесь не предмет проверки (docs/agent_energy.md): сценарии этого файла держат агентов в поле и ведут их
// дальше, чем на пять игровых дней пути, — на карте она здесь не убывает. Цены дел и отдых дома остаются; энергию
// держат `energy.test.ts` и `energyworld.test.ts`.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_DRAIN: Infinity }));

/**
 * Война между игроками от начала до конца на двух мирах и одном сервере в памяти (docs/pvp.md). Сервер —
 * настоящие правила `netlify/lib/war.ts`, без сети; миры — настоящие `LocalWorld`, каждый со своим
 * слепком обороны. Тест держит то, что иначе ломается молча: обе стороны видят одну войну, итог боя
 * доходит до обеих один раз, полководец возвращается домой.
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
    // Город соседа в своём краю открыт местом сразу (`LocalWorld.revealNeighbours`) — разведчика не нужно.
    new LocalWorld({ seed: me === A ? 11 : 12, now: () => now, storage: null, home: roster.rows[me], castles: castlesFor(me), ...link(me) });
  const a = world(A);
  const b = world(B);
  const pulse = async () => {
    const pa = await a.sync(profile());
    const pb = await b.sync(profile());
    // Слепки ложатся на сервер, как с записью партии.
    sheets.set(A, { sheet: a.warSheet()!, at: now });
    sheets.set(B, { sheet: b.warSheet()!, at: now });
    return { pa, pb };
  };
  return { a, b, file, pulse, now: () => now, step: (ms: number) => (now += ms), target: castleIdOf(B) };
}

describe('война между игроками: путь от похода до итога у обеих сторон', () => {
  it('осада, вылазка, штурм из лагеря и возвращение — обе стороны видят одно и то же', async () => {
    const g = game();
    await g.pulse();
    // Дружина полководцу у ворот, и ждём, пока она соберётся.
    expect(await g.a.setGarrison({ spearman: 60, swordsman: 30, archer: 30 })).toBeNull();
    for (let i = 0; i < 100 && (await g.a.figures()).find((f) => f.id === 'general')!.readyAt > g.now(); i++) {
      g.step(5 * 60_000);
      await g.pulse();
    }
    await g.pulse();

    const card = await g.a.settlement(g.target);
    expect(card?.war?.reason ?? null).toBeNull();
    expect(card?.war?.can).toBe(true);
    expect(await g.a.warMarch(g.target, 'siege', 'plunder')).toBeNull();
    expect(g.file.wars).toHaveLength(1);
    const war = g.file.wars[0];

    // Защитник видит поход сразу — отрядом, идущим на его город, со сроком прихода.
    let { pa, pb } = await g.pulse();
    const incoming = pb.marches.find((m) => m.hostile && m.targetId === 'home' && m.phase === 'out');
    expect(incoming?.arriveAt).toBe(war.arriveAt);
    expect(pa.figures.find((f) => f.id === 'general')?.phase).toBe('moving');

    // Пришли — лагерь у обоих: окно осады у защитника, окно лагеря у нападающего.
    g.step(war.arriveAt - g.now() + 1000);
    ({ pa, pb } = await g.pulse());
    expect(war.phase).toBe('camp');
    expect(pb.siege?.byName).toBe('Альфа');
    expect(pa.figures.find((f) => f.id === 'general')?.besieging).toBe(g.target);
    expect((await g.a.camp())?.targetId).toBe(g.target);

    // Вылазка защитника — бой у сервера, отчёт у обоих.
    const sortie = await g.b.sortie({ spearman: 10 });
    expect(sortie.error).toBeNull();
    ({ pa, pb } = await g.pulse());
    expect(war.battles.length).toBe(1);
    const sortieReportA = (await g.a.reports()).find((r) => r.id === `war-${war.battles[0].id}`);
    expect(sortieReportA?.battle?.site).toBe('sortie');
    expect((await g.b.reports()).some((r) => r.id === `war-${war.battles[0].id}`)).toBe(true);

    if (war.phase === 'camp') {
      // Штурм из лагеря — тоже сервер; лагерь снимается, войско идёт домой.
      const storm = await g.a.attack({});
      expect(storm.error).toBeNull();
      ({ pa, pb } = await g.pulse());
      expect(war.battles.length).toBe(2);
      expect(war.battles[1].site).toBe('wall');
      const wallB = (await g.b.reports()).find((r) => r.id === `war-${war.battles[1].id}`);
      expect(wallB?.battle?.us).toBe('defender');
      expect(['taken', 'beaten']).toContain(war.end);
    }

    // Набор держит, что штурм из лагеря и правда случился: лагерь пережил вылазку.
    expect(war.battles.length).toBe(2);

    // Итог применён ровно один раз: второй пульс тех же отчётов не добавляет.
    const before = (await g.b.reports()).length;
    await g.pulse();
    expect((await g.b.reports()).length).toBe(before);

    // Войско дома, полководец свободен.
    for (let i = 0; i < 600 && war.phase !== 'done'; i++) {
      g.step(10 * 60_000);
      await g.pulse();
    }
    expect(war.phase).toBe('done');
    await g.pulse();
    const gen = (await g.a.figures()).find((f) => f.id === 'general');
    expect(gen?.besieging).toBeNull();
    expect(['home', 'down']).toContain(gen?.phase);
  }, 120_000);

  it('удар полководца города с тыла вместе с гарнизоном — совместный удар, и голод, если лагерь устоял', async () => {
    const g = game();
    await g.pulse();
    // Обе дружины у ворот.
    expect(await g.a.setGarrison({ spearman: 40, swordsman: 30 })).toBeNull();
    expect(await g.b.setGarrison({ swordsman: 30, archer: 20 })).toBeNull();
    for (let i = 0; i < 30; i++) {
      g.step(5 * 60_000);
      await g.pulse();
    }
    expect(await g.a.warMarch(g.target, 'siege', 'captives')).toBeNull();
    const war = g.file.wars[0];
    // Полководец города выходит в поле — бить лагерь из поля можно только оттуда.
    const home = (await g.b.info()).home;
    expect(await g.b.moveFigure('general', { x: home.x + 3, y: home.y })).toBeNull();
    g.step(war.arriveAt - g.now() + 1000);
    await g.pulse();
    expect(war.phase).toBe('camp');
    const gen = (await g.b.figures()).find((f) => f.id === 'general');
    expect(gen?.phase).toBe('field');

    const plan = await g.b.strikePlan('home', true);
    expect(plan.reason).toBeNull();
    expect(plan.front).not.toBeNull();
    expect(await g.b.strikeCamp('home', true)).toBeNull();
    expect(war.strike).toBeDefined();
    g.step((war.strike?.at ?? g.now()) - g.now() + 1000);
    await g.pulse();
    const joint = war.battles.find((b) => b.site === 'joint');
    expect(joint).toBeDefined();
    expect(joint?.genTroops).toBeDefined();
    const ra = (await g.a.reports()).find((r) => r.id === `war-${joint?.id}`);
    const rb = (await g.b.reports()).find((r) => r.id === `war-${joint?.id}`);
    expect(ra?.battle?.site).toBe('joint');
    expect(rb?.battle?.us).toBe('attacker');

    for (let i = 0; i < 600 && war.phase !== 'done'; i++) {
      g.step(10 * 60_000);
      await g.pulse();
    }
    expect(war.phase).toBe('done');
    // Город взят голодом или лагерь снят — итог есть у обеих сторон.
    expect(['taken', 'lifted']).toContain(war.end);
    if (war.fall) {
      expect((await g.a.reports()).some((r) => r.id === `war-${war.id}-fall`)).toBe(true);
      expect((await g.b.reports()).some((r) => r.id === `war-${war.id}-fell`)).toBe(true);
    }
  }, 120_000);
});
