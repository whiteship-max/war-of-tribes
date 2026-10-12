import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { PlayerCastle, PlayerProfile } from './types';
import { advance, applyOrder, emptyWars, liveSheet, warsOf, type SheetAt } from '../../netlify/lib/war';
import { castleIdOf, emptyRoster, upsert } from '../../netlify/lib/roster';
import { type CastleClaim, type RosterFile, type WarOrder } from '../../netlify/lib/contract';
import { FATE_SAME, SIEGE_BLOCK, STRIKE_FROM_TOWN, WOOD_FIXED, type SiegeWindow } from './siege';
import { thinAt, type Fire } from './bombard';
import { garrisonWear } from './siegecraft';
import { worldDays } from '@/game/pace';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';

// Энергия агентов здесь не предмет проверки (docs/agent_energy.md): сценарии этого файла водят агентов по карте помногу
// — дорога здесь энергию не берёт. Цены дел и отдых дома остаются; энергию держат `energy.test.ts` и
// `energyworld.test.ts`.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

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

/** `b` — что сверх общего слепка у деревни Беты (башня с орудием и т. п.). */
function game(b: Partial<PlayerProfile> = {}) {
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
  const bw = world(B);
  const pulse = async () => {
    const pa = await a.sync(profile());
    const pb = await bw.sync({ ...profile(), ...b });
    // Слепки ложатся на сервер, как с записью партии.
    sheets.set(A, { sheet: a.warSheet()!, at: now });
    sheets.set(B, { sheet: bw.warSheet()!, at: now });
    return { pa, pb };
  };
  return { a, b: bw, file, pulse, now: () => now, step: (ms: number) => (now += ms), target: castleIdOf(B) };
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
      // Штурм из лагеря — тоже сервер. Взяли — войско идёт домой; отбили — осада идёт дальше с теми, кто уцелел
      // (docs/siege_v2.md, 4.4), а снимается лагерь, только если штурмовать стало некому.
      const storm = await g.a.attack({});
      expect(storm.error).toBeNull();
      ({ pa, pb } = await g.pulse());
      expect(war.battles.length).toBe(2);
      expect(war.battles[1].site).toBe('wall');
      const wallB = (await g.b.reports()).find((r) => r.id === `war-${war.battles[1].id}`);
      expect(wallB?.battle?.us).toBe('defender');
      if (war.end === 'taken') expect(war.phase).not.toBe('camp');
      else if (troopTotal(war.army.troops as TroopStack) > 0) expect(war.phase, 'отбитый штурм лагерь не снимает').toBe('camp');
      else expect(war.end).toBe('beaten');
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

  /**
   * Раскладка в слепке обороны (docs/retinue.md): отряд полководца стоит в гарнизоне, пока он дома, уходит с ним и с ним
   * возвращается — и сервер видит это, даже если игрок не заходил ни с выхода, ни с возврата. Область правила — свой
   * поход на игрока: слепок, лёгший до выхода, и слепок, лёгший в походе; что точки в ней, проверяется утверждением.
   */
  it('раскладка: ушедший отряд сервер дома не держит, вернувшийся — прибавляет, по любому слепку', async () => {
    const g = game();
    await g.pulse();
    expect(await g.a.setGarrison({ spearman: 40, swordsman: 30 })).toBeNull();
    for (let i = 0; i < 100 && (await g.a.figures()).find((f) => f.id === 'general')!.readyAt > g.now(); i++) {
      g.step(5 * 60_000);
      await g.pulse();
    }
    await g.pulse();
    const all = { spearman: 60, archer: 30, swordsman: 30 };
    const before = g.a.warSheet()!;
    expect(before.retinue, 'точка внутри области: отряд стоит дома').toEqual({ spearman: 40, swordsman: 30 });
    expect(before.out).toEqual([]);
    expect(before.home).toEqual(all);
    const stale: SheetAt = { sheet: before, at: g.now() };

    g.step(1000);
    expect(await g.a.warMarch(g.target, 'siege', 'plunder')).toBeNull();
    const war = g.file.wars[0];
    await g.pulse();
    const during = g.a.warSheet()!;
    expect(during.out, 'точка внутри области: войско в походе').toEqual([war.id]);
    expect(during.retinue).toEqual({});
    expect(during.home).toEqual({ spearman: 20, archer: 30 });
    // Слепок, лёгший до выхода, сервер приводит к тому же гарнизону, что видит сам клиент после выхода.
    expect(liveSheet(g.file, A, stale, g.now()).home, 'слепок до выхода').toEqual(during.home);
    expect(liveSheet(g.file, A, stale, g.now()).pips, 'отметки полководца ушли с отрядом').toEqual({});
    // До выхода — прежний гарнизон: прошлое слепок не переписывает.
    expect(liveSheet(g.file, A, stale, war.sentAt - 1).home).toEqual(all);

    // Отзыв на полпути: войско разворачивается и дома снова в гарнизоне, хоть игрок и не заходил.
    g.step(Math.round((war.arriveAt - g.now()) / 2));
    await g.pulse();
    expect(war.phase, 'точка внутри области: войско ещё идёт').toBe('march');
    expect(await g.a.recallFigure('general')).toBeNull();
    expect(war.phase).toBe('back');
    const backAt = war.backAt as number;
    const away: SheetAt = { sheet: during, at: g.now() };
    expect(liveSheet(g.file, A, away, backAt - 1).home, 'ещё в пути').toEqual(during.home);
    g.step(backAt - g.now() + 1000);
    advance(g.file, g.now(), new Map());
    expect(war.phase, 'точка внутри области: войско дома').toBe('done');
    expect(liveSheet(g.file, A, away, g.now()).home, 'слепок в походе').toEqual(all);
    expect(liveSheet(g.file, A, stale, g.now()).home, 'слепок до выхода').toEqual(all);
    // И клиент, зайдя, говорит то же о своём отряде: он снова дома и снова его. Гарнизон целиком здесь не сверяется:
    // за часы похода на город ходят логова, и их набег клиент знает, а сервер — нет.
    await g.pulse();
    expect(g.a.warSheet()!.retinue).toEqual({ spearman: 40, swordsman: 30 });
    expect(g.a.warSheet()!.out).toEqual([]);
  });
});

/**
 * Находки отчёта об осаде (docs/siege_audit.md) на двух настоящих мирах и сервере в памяти: что окно говорит, то и считает
 * мир и сервер. Область правил — лагерь игрока под городом игрока; что лагерь стоит, проверяется утверждением.
 */
describe('осада под городом игрока: окна обеих сторон говорят то, что считают мир и сервер', () => {
  /**
   * Дружина полководцу Альфы, поход с осадой, лагерь у стен Беты. `retinue` — у полководца Беты отряд (дома, в гарнизоне);
   * `outside` — он с отрядом в поле.
   */
  async function camped(opt: { retinue?: boolean; outside?: boolean; b?: Partial<PlayerProfile> } = {}) {
    const outside = Boolean(opt.outside);
    const g = game(opt.b);
    await g.pulse();
    expect(await g.a.setGarrison({ spearman: 60, swordsman: 30, archer: 30 })).toBeNull();
    if (outside || opt.retinue) expect(await g.b.setGarrison({ swordsman: 30, archer: 20 })).toBeNull();
    for (let i = 0; i < 30; i++) {
      g.step(5 * 60_000);
      await g.pulse();
    }
    expect(await g.a.warMarch(g.target, 'siege', 'plunder')).toBeNull();
    const war = g.file.wars[0];
    if (outside) {
      const home = (await g.b.info()).home;
      expect(await g.b.moveFigure('general', { x: home.x + 3, y: home.y })).toBeNull();
    }
    g.step(war.arriveAt - g.now() + 1000);
    const { pa, pb } = await g.pulse();
    expect(war.phase, 'точка внутри области: лагерь встал').toBe('camp');
    return { g, war, pa, pb };
  }

  it('одно правило выхода: из города под лагерем игрока не выйти, как из города под лагерем логова', async () => {
    const { g } = await camped({ retinue: true });
    const home = (await g.b.info()).home;
    const out = { x: home.x + 3, y: home.y };
    expect(await g.b.moveFigure('general', out)).toBe(SIEGE_BLOCK);
    expect(await g.b.moveFigure('scout', out)).toBe(SIEGE_BLOCK);
    expect((await g.b.send({ target: castleIdOf(A), mission: 'scout', units: { scout: 1 } })).error).toBe(SIEGE_BLOCK);
    expect(await g.b.assault(castleIdOf(A), 'plunder')).toBe(SIEGE_BLOCK);
    expect((await g.b.settlement(castleIdOf(A)))?.war?.reason).toBe(SIEGE_BLOCK);
    // Удар с тыла — только тем, кто в поле; полководец в городе выходит вылазкой (`fieldTroops`).
    expect((await g.b.strikePlan('home', true)).reason).toBe(STRIKE_FROM_TOWN);
  }, 120_000);

  it('участь в лагере: «Объявить» и штурм — с выбранной; защитник видит новую участь', async () => {
    const { g, war } = await camped();
    expect(await g.a.besiege('captives')).toBeNull();
    expect(war.fate).toBe('captives');
    const { pb } = await g.pulse();
    expect(pb.siege?.fate, 'окно осады у защитника').toBe('captives');
    expect((await g.a.camp())?.fate).toBe('captives');
    expect(await g.a.besiege('captives')).toBe(FATE_SAME);
    // Штурм с участью, выбранной в окне, — сервер штурмует с ней.
    expect((await g.a.attack({ fate: 'plunder' })).error).toBeNull();
    expect(war.fate).toBe('plunder');
    expect(war.battles.some((b) => b.site === 'wall'), 'точка внутри области: штурм был').toBe(true);
    if (war.fall) expect(war.fall.fate).toBe('plunder');
  }, 120_000);

  it('окно лагеря: древесину не делят — строка вместо кнопок; гарнизон — грубо, как мощь', async () => {
    const { g, war } = await camped();
    const camp = (await g.a.camp())!;
    expect(camp.woodFixed).toBe(WOOD_FIXED);
    expect(await g.a.setWood(0.5)).toBe(WOOD_FIXED);
    // Точного числа гарнизона нападающий не видит: оценка той же точности, что мощь, и вилка его держит.
    const real = war.camp!.garrisonAtStart;
    expect(real, 'точка внутри области: гарнизон есть').toBeGreaterThan(0);
    expect(camp.garrison.precision).toBe(camp.power.precision);
    expect(camp.garrison.precision).not.toBe('exact');
    expect(camp.garrison.min).toBeLessThanOrEqual(real);
    expect(camp.garrison.max).toBeGreaterThanOrEqual(real);
  }, 120_000);

  it('мораль защитника: износ осады и залпы — тем числом, с которым бьёт сервер; ложной «дрался недавно» нет', async () => {
    const { g, war } = await camped();
    g.step(worldDays(6));
    let { pb } = await g.pulse();
    expect(pb.siege?.garrisonRest, 'боя не было — усталости после боя нет').toBeUndefined();
    // Износ — той же дверью, что у сервера (`garrisonWear` по окну: дни осады к голоду и залпы журнала).
    const wear = () => Math.floor(garrisonWear(war.camp as unknown as SiegeWindow, g.now()) * 100) / 100;
    const before = wear();
    expect(before, 'точка внутри области: шесть дней осады').toBeLessThan(1);
    expect(pb.siege?.wear).toBe(before);
    expect(await g.a.campCraft('bombard')).toBeNull();
    ({ pb } = await g.pulse());
    expect(war.camp?.craft?.shots).toBe(1);
    expect(war.camp?.log?.length, 'залп лёг в журнал с минутой').toBe(1);
    expect(pb.siege?.wear).toBe(wear());
    expect(pb.siege!.wear!).toBeLessThan(before);
  }, 120_000);

  it('башня бьёт по лагерю соседа (осада 2г): обстрел считает сервер той же дверью, окно защитника его показывает', async () => {
    // Баллиста (`game/data/engines`: пятый уровень башни, расчёт 1) и лучники дома — башня бьёт в полную силу.
    const tower = { slow: 0, thin: 0.2, crew: 1, seats: 1 };
    const { g, war } = await camped({ b: { tower, levels: { tower: 5 } } });
    const fire = war.camp?.fire as Fire | undefined;
    expect(fire, 'обстрел лёг в лагерь сервера').toBeDefined();
    expect(fire?.thin).toBe(0.2);
    g.step(worldDays(8));
    const { pb } = await g.pulse();
    const thin = thinAt(war.camp?.fire as Fire, g.now());
    expect(thin, 'точка внутри области: башня успела выбить').toBeGreaterThan(0);
    expect(pb.siege?.fire?.thin).toBe(thin);
  }, 120_000);

  it('орудие, какого на башне этого уровня не бывает, сервер не принимает: обстрела нет', async () => {
    const tower = { slow: 0.3, thin: 0.2, crew: 4, seats: 6 };
    const { war, pb } = await camped({ b: { tower, levels: { tower: 5 } } });
    expect(war.camp?.fire).toBeUndefined();
    expect(pb.siege?.fire).toBeUndefined();
  }, 120_000);

  it('нападающий видит выручку: удар полководца города — кто, сколько, когда и с гарнизоном ли', async () => {
    const { g, war } = await camped({ outside: true });
    expect(await g.b.strikeCamp('home', true)).toBeNull();
    expect(war.strike, 'точка внутри области: удар назначен').toBeDefined();
    await g.pulse();
    const relief = (await g.a.camp())?.relief;
    expect(relief).toEqual({ from: 'Бета', men: troopTotal(war.strike!.army.troops as TroopStack), at: war.strike!.at, joint: true });
  }, 120_000);

  it('часы голода под игроком идут за гарнизоном: полководец вернул отряд домой — хлеб кончится раньше', async () => {
    const { g, war } = await camped({ outside: true });
    // Слепок Беты, где отряд уже в поле, доходит до сервера пульсом позже прихода — окно приходит к нему.
    await g.pulse();
    const first = war.starvesAt as number;
    const garrison = war.camp!.garrisonAtStart;
    expect(garrison, 'точка внутри области: отряд полководца не за стеной').toBeLessThan(troopTotal(profile().army as TroopStack));
    // Вернуться в осаждённый город можно: под запретом выход, а не вход.
    const home = (await g.b.info()).home;
    expect(await g.b.moveFigure('general', { ...home })).toBeNull();
    const walking = (await g.b.figures()).find((f) => f.id === 'general')!;
    g.step(Math.max(0, walking.arriveAt - g.now()) + 1000);
    await g.pulse();
    await g.pulse();
    expect(war.phase, 'точка внутри области: лагерь стоит').toBe('camp');
    expect(war.camp!.garrisonAtStart).toBeGreaterThan(garrison);
    expect(war.starvesAt as number).toBeLessThan(first);
  }, 120_000);
});
