// Режим марша в настоящем мире (ДР-2, docs/siege_v2.md, 25.1). Области правил — и каждая проверяется утверждением в самом
// тесте (правило 11):
// - выбор до приказа: строки карточки — те же сроки, что исполнит приказ, в каждом режиме;
// - налегке лагерь не встаёт — кнопка, приказ и минута прихода одной проверкой; обычный и обоз — встают;
// - налегке тает вне своих стен: на пути длиннее суток уход виден, и онлайн (частые пульсы) и офлайн (один заход) дают
//   тех же ушедших; обычный и обоз в пути не тают;
// - смена: дома — сразу и даром; в пути — стоянка в кратчайший поход и цена, путь после стоянки новой скоростью; в лагере
//   — нельзя;
// - лагерь с обозом — без подвоза из дома: при пустом амбаре обычный лагерь тает вдвое, обоз — базой;
// - старое сохранение (фигура без режима, окно без режима) — обычный.
import { afterEach, describe, expect, it } from 'vitest';
import { realMs, worldDays } from '@/game/pace';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { FigureView, PlayerProfile } from './types';
import type { TroopStack } from '@/game/battle/kinds';
import { troopTotal } from '@/game/battle/kinds';
import { distance, marchPosition } from './geo';
import { shieldVillagers } from './lairs';
import { routPeril } from './peril';
import { ENERGY_PRICE } from './data/energy';
import { CAMP_WASTE, SIEGE_PHASE } from './data/siegeroll';
import { setPhaseDie, wasteOf } from './siegeroll';
import { LIGHT_NO_CAMP, gaitHaltMs, lightShare, siegeBlockOf, strikeSeed, strikeWorn } from './gait';
import { gaitTake } from './gaitview';
import { MARCH_MIN_SECONDS } from './data/tuning';

const START = 1_700_000_000_000;
const HOST: TroopStack = { spearman: 140, archer: 50, legionary: 30 };

type Inner = { save: WorldSave; gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean };

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 4000, wood: 4000, stone: 4000 },
  stash: 0,
  ...over,
});

async function ready(seed = 7, over: Partial<PlayerProfile> = {}) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  const inner = world as unknown as Inner;
  const p = profile(over);
  await world.sync(p);
  expect(await world.setGarrison({ ...HOST })).toBeNull();
  const gen = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;
  now = Math.max(now, (await gen()).readyAt + 1);
  await world.sync(p);
  const home = inner.save.home;
  const lair = inner.gen.settlements.filter((s) => inner.alive(s, now)).sort((a, b) => distance(home, a) - distance(home, b))[0];
  return {
    world,
    inner,
    p,
    lair,
    gen,
    now: () => now,
    at: (t: number) => {
      now = t;
    },
  };
}

afterEach(() => setPhaseDie(null));

/** Дело «Ударить» по ближнему логову и его строки режима окна дела (ДР-7). */
const stormOf = async (r: Awaited<ReturnType<typeof ready>>) => (await r.world.errands('general', { kind: 'place', id: r.lair.id })).find((o) => o.id === 'storm');
const stormRows = async (r: Awaited<ReturnType<typeof ready>>) => (await stormOf(r))?.gaits ?? [];

describe('режим марша в мире: выбор до приказа', () => {
  it('строки окна дела — те же сроки, что исполнит приказ; налегке быстрее, обоз вдвое медленнее', async () => {
    const r = await ready();
    const rows = await stormRows(r);
    const by = Object.fromEntries(rows.map((x) => [x.gait, x]));
    // Точка внутри области: и налегке дорога длиннее пола похода — множитель виден целиком.
    expect(by.light.walkMs).toBeGreaterThan(realMs(MARCH_MIN_SECONDS));
    expect(by.light.walkMs / by.normal.walkMs).toBeCloseTo(1 / 1.5, 2);
    expect(by.train.walkMs / by.normal.walkMs).toBeCloseTo(2, 2);
    expect(siegeBlockOf(by.light.gait)).toBe(LIGHT_NO_CAMP);
    expect(siegeBlockOf(by.normal.gait)).toBeNull();
    expect(gaitTake(troopTotal(HOST), 'light', by.light.walkMs, 1).lost).toBe(Math.round(troopTotal(HOST) * lightShare('light', by.light.walkMs)));
    for (const g of ['light', 'normal', 'train'] as const) {
      const w = await ready();
      expect(await w.world.setGait(g)).toBeNull();
      expect(await w.world.assault(w.lair.id, 'plunder')).toBeNull();
      const out = await w.gen();
      expect(out.arriveAt - out.departAt, `${g}: срок приказа — срок строки`).toBe(by[g].walkMs);
    }
  });

  it('дома режим меняется сразу и даром: энергии не тратит, стоянки нет', async () => {
    const r = await ready();
    const before = (await r.gen()).energy?.value;
    expect(await r.world.setGait('train')).toBeNull();
    const g = await r.gen();
    expect(g.march?.gait).toBe('train');
    expect(g.march?.haltUntil).toBe(0);
    expect(g.energy?.value).toBe(before);
    expect(g.march?.change.free).toBe(true);
  });
});

describe('режим марша в мире: налегке осаду не ведёт', () => {
  it('кнопка, приказ и минута прихода — одной проверкой; обычный и обоз — встают', async () => {
    const r = await ready();
    expect(await r.world.setGait('light')).toBeNull();
    const card = await r.world.settlement(r.lair.id);
    expect(card?.invest?.can).toBe(false);
    expect(card?.invest?.reason).toBe(LIGHT_NO_CAMP);
    expect(await r.world.assault(r.lair.id, 'plunder', 'siege')).toBe(LIGHT_NO_CAMP);
    // Удар с ходу налегке открыт.
    expect(card?.assault?.can, `удар налегке открыт: ${card?.assault?.reason}`).toBe(true);
    // Граница области: обычным маршем тот же приказ принят.
    expect(await r.world.setGait('normal')).toBeNull();
    expect(await r.world.assault(r.lair.id, 'plunder', 'siege')).toBeNull();
    // В пути на осаду «налегке» не сменить: лагерь не встанет.
    expect(await r.world.setGait('light')).toBe(`${LIGHT_NO_CAMP} Отряд идёт осаждать.`);
    // Пришёл налегке с приказом осады (старое состояние, сменённое мимо двери) — лагеря нет, летопись говорит почему.
    r.inner.save.figures.general.gait = 'light';
    const out = await r.gen();
    r.at(out.arriveAt + 1000);
    const res = await r.world.sync(r.p);
    expect(r.inner.save.sieges[r.lair.id]).toBeUndefined();
    expect(res.effects.find((e) => e.id.startsWith('assault-miss-'))?.text).toContain('лагеря не поставил: налегке лагерь не ставят');
  });
});

describe('режим марша в мире: истощение в пути', () => {
  /** Полководец идёт к логову в режиме `g`; состав за минуту до прихода — частыми пульсами или одним заходом. */
  async function before(g: 'light' | 'normal' | 'train', pulses: number) {
    const r = await ready();
    expect(await r.world.setGait(g)).toBeNull();
    expect(await r.world.assault(r.lair.id, 'plunder')).toBeNull();
    const out = await r.gen();
    const end = out.arriveAt - 1000;
    let lost = 0;
    for (let k = 1; k <= pulses; k++) {
      r.at(out.departAt + Math.round(((end - out.departAt) * k) / pulses));
      const res = await r.world.sync(r.p);
      for (const e of res.effects) lost += troopTotal(e.lostTroops ?? {});
    }
    return { troops: (await r.gen()).troops, lost, walk: out.arriveAt - out.departAt };
  }

  it('налегке тает: уход — доля вида, онлайн и офлайн одинаково, и племя узнаёт ровно ушедших', async () => {
    const often = await before('light', 23);
    const once = await before('light', 1);
    const gone = troopTotal(HOST) - troopTotal(often.troops);
    // Точка внутри области: дорога больше суток — уход виден.
    expect(lightShare('light', often.walk)).toBeGreaterThan(0.01);
    expect(gone).toBeGreaterThan(0);
    expect(once.troops, 'один заход — те же ушедшие').toEqual(often.troops);
    expect(often.lost, 'последствия несут ровно ушедших').toBe(gone);
    expect(once.lost).toBe(gone);
    expect(Math.abs(gone - troopTotal(HOST) * lightShare('light', often.walk))).toBeLessThan(4);
  });

  it('обычный и обоз в пути не тают', async () => {
    for (const g of ['normal', 'train'] as const) {
      const b = await before(g, 5);
      expect(b.troops, g).toEqual(HOST);
      expect(b.lost).toBe(0);
    }
  });
});

describe('режим марша в мире: смена в пути', () => {
  it('стоянка в кратчайший поход и цена; путь после неё — новой скоростью; погоня — тем же уравнением', async () => {
    const r = await ready();
    expect(await r.world.assault(r.lair.id, 'plunder')).toBeNull();
    const out = await r.gen();
    const mid = out.departAt + Math.round((out.arriveAt - out.departAt) / 2);
    r.at(mid);
    await r.world.sync(r.p);
    const spot = marchPosition(out, mid);
    const e0 = (await r.gen()).energy?.value ?? 0;
    expect(await r.world.setGait('light')).toBeNull();
    const g = await r.gen();
    const halt = gaitHaltMs();
    expect(g.march?.gait).toBe('light');
    expect(g.march?.haltUntil).toBe(mid + halt);
    expect(e0 - (g.energy?.value ?? 0), 'цена смены').toBe(ENERGY_PRICE.gait.price);
    expect(g.departAt).toBe(mid + halt);
    // Остаток пути — новой скоростью: вторая половина обычного пути налегке — в полтора раза короче.
    const restNormal = out.arriveAt - mid;
    expect((g.arriveAt - g.departAt) / restNormal).toBeCloseTo(1 / 1.5, 1);
    // В стоянку отряд стоит на месте.
    r.at(mid + Math.round(halt / 2));
    await r.world.sync(r.p);
    const stand = (await r.gen()).at;
    expect(distance(stand, spot)).toBeLessThan(0.01);
    // Второй смены в стоянку нет.
    expect(await r.world.setGait('normal')).toContain('Отряд ещё стоит');
  });

  it('в лагере режим не меняют', async () => {
    const r = await ready();
    expect(await r.world.assault(r.lair.id, 'plunder', 'siege')).toBeNull();
    const out = await r.gen();
    r.at(out.arriveAt + 1000);
    await r.world.sync(r.p);
    expect(r.inner.save.sieges[r.lair.id]?.campId).toBe('general');
    expect(await r.world.setGait('train')).toContain('В лагере режим марша не меняют');
  });
});

describe('режим марша в мире: погоня (MAP-9)', () => {
  it('уходящий набег налегке догоняется, обычным маршем и с обозом — нет: темп погони — скорость режима', async () => {
    const plans: Record<string, { can: boolean; seconds: number }> = {};
    for (const g of ['light', 'normal', 'train'] as const) {
      const r = await ready();
      expect(await r.world.setGait(g)).toBeNull();
      const home = r.inner.save.home;
      // Набег уходит от наших ворот на восток, к себе домой, скоростью воина — ровно скоростью полководца.
      const to = { x: home.x + 40, y: home.y };
      const walk = (await r.world.leadPlan('general', to)).seconds;
      const speedWalk = realMs(walk) * (g === 'light' ? 1.5 : g === 'train' ? 0.5 : 1);
      r.inner.save.marches.push({
        id: 'raid-away',
        seed: 5,
        mission: 'raid',
        units: { warrior: 5 },
        own: false,
        fromId: 'x',
        targetId: r.lair.id,
        from: { x: home.x + 3, y: home.y },
        to,
        fromName: 'Набег',
        toName: 'логово',
        departAt: r.now(),
        arriveAt: r.now() + Math.round(speedWalk),
        phase: 'back',
        power: 15,
        loot: null,
      });
      const plan = await r.world.interceptPlan('raid-away');
      plans[g] = { can: plan.can, seconds: plan.seconds };
    }
    // Точка внутри области: набег вышел в трёх клетках от ворот и идёт сорок клеток — налегке встреча в пути.
    expect(plans.light.can, 'налегке догоняет').toBe(true);
    expect(plans.normal.can, 'обычный не догоняет').toBe(false);
    expect(plans.train.can, 'обоз не догоняет').toBe(false);
  });
});

describe('режим марша в мире: обоз — второй склад лагеря', () => {
  /** Лагерь в режиме `g` под логовом при пустом амбаре дома; истощение первой фазы «без перемен». */
  async function firstWaste(g: 'normal' | 'train') {
    const r = await ready(7, { food: 0 });
    expect(await r.world.setGait(g)).toBeNull();
    expect(await r.world.assault(r.lair.id, 'plunder', 'siege')).toBeNull();
    const out = await r.gen();
    r.at(out.arriveAt + 1000);
    await r.world.sync(r.p);
    const w = r.inner.save.sieges[r.lair.id];
    expect(w?.campId).toBe('general');
    // Кость фазы — «без перемен»: мор и пролом не мешают мерить истощение.
    setPhaseDie(() => 5);
    r.at((w!.sinceAt ?? w!.startedAt) + SIEGE_PHASE + 1000);
    await r.world.sync(r.p);
    const row = r.inner.save.sieges[r.lair.id]?.phases?.[0];
    return { row, w: w! };
  }

  it('при пустом амбаре обычный лагерь тает вдвое и от дали, лагерь с обозом — базой', async () => {
    const normal = await firstWaste('normal');
    const train = await firstWaste('train');
    expect(normal.row?.out).toBe('calm');
    expect(train.row?.out).toBe('calm');
    // Точка внутри области: обычный лагерь стоит не у своих ворот и при пустом амбаре.
    expect(normal.w.homeDays ?? 0).toBeGreaterThan(0);
    expect(normal.row?.waste).toBeCloseTo(wasteOf('calm', normal.w.homeDays, true), 12);
    expect(normal.row!.waste).toBeGreaterThan(2 * CAMP_WASTE);
    expect(train.w.gait).toBe('train');
    expect(train.row?.waste).toBeCloseTo(CAMP_WASTE, 12);
  });
});

describe('режим марша в мире: старое сохранение', () => {
  it('фигура и окно без режима — обычный марш и прежнее истощение лагеря', async () => {
    const r = await ready();
    delete r.inner.save.figures.general.gait;
    const g = await r.gen();
    expect(g.march?.gait).toBe('normal');
    const rows = await stormRows(r);
    expect((await r.world.settlement(r.lair.id))?.assault?.walkMs).toBe(rows.find((x) => x.gait === 'normal')?.walkMs);
    expect(wasteOf('calm', 10, true)).toBeCloseTo(wasteOf('calm', 10, true, false), 12);
  });
});

describe('режим марша в мире: вывоз добычи (ДР-5)', () => {
  type Hauling = { haul(units: { warrior?: number }, ours: boolean): { carry: number; escort: number } };
  it('поклажа отряда полководца — по режиму, чужой отряд — без него; пленных режим не касается', async () => {
    const r = await ready();
    const h = r.world as unknown as Hauling;
    const by: Record<string, { carry: number; escort: number }> = {};
    for (const g of ['light', 'normal', 'train'] as const) {
      if (g === 'normal') delete r.inner.save.figures.general.gait;
      else r.inner.save.figures.general.gait = g;
      by[g] = h.haul({ warrior: 40 }, true);
      // Чужой отряд (набег на наш город) обоза нашего полководца не несёт.
      expect(h.haul({ warrior: 40 }, false).carry).toBe(by.normal?.carry ?? h.haul({ warrior: 40 }, false).carry);
    }
    expect(by.normal.carry).toBeGreaterThan(0);
    expect(by.light.carry / by.normal.carry).toBeCloseTo(0.5, 12);
    expect(by.train.carry / by.normal.carry).toBeCloseTo(1.25, 12);
    expect(by.light.escort).toBe(by.normal.escort);
    expect(by.train.escort).toBe(by.normal.escort);
  });

  it('окно выбора показывает вывоз дошедших — той же дверью, что возьмёт добычу', async () => {
    const r = await ready();
    const h = r.world as unknown as Hauling;
    const rows = await stormRows(r);
    const men = troopTotal(r.inner.save.figures.general.troops ?? {});
    expect(men, 'точка внутри области: отряд есть').toBeGreaterThan(0);
    const haul = (await stormOf(r))?.haul ?? 0;
    const take = (row: (typeof rows)[number]) => gaitTake(men, row.gait, row.walkMs, haul);
    expect(take(rows.find((x) => x.gait === 'light')!).lost, 'точка внутри области: налегке к приходу уходят').toBeGreaterThan(0);
    for (const row of rows) {
      if (row.gait === 'normal') delete r.inner.save.figures.general.gait;
      else r.inner.save.figures.general.gait = row.gait;
      // Окно считает вывоз дверью `gaitTake` по составу окна — тем же числом, что возьмёт добычу мир.
      expect(take(row).carry).toBe(Math.floor(h.haul({ warrior: men - take(row).lost }, true).carry));
    }
    const by = Object.fromEntries(rows.map((x) => [x.gait, take(x).carry]));
    expect(by.light).toBeLessThan(by.normal);
    expect(by.train).toBeGreaterThan(by.normal);
  });
});

describe('режим марша в мире: дорога удара и выручки (ДР-5)', () => {
  type Leg = { strikeLeg(now: number, ms: number, seed: string): void; wearGeneral(t: number): void; wearSeed(since: number): string; wearDue(t: number): TroopStack };
  it('за дорогу уходят ровно ушедшие сервера (`strikeWorn` тем же сидом), после неё — обычный отрезок от её конца', async () => {
    const r = await ready();
    const legs = r.world as unknown as Leg;
    const f = r.inner.save.figures.general;
    const t0 = r.now();
    const troops: TroopStack = { spearman: 120, archer: 60, legionary: 40 };
    Object.assign(f, { phase: 'field', gait: 'light', troops: { ...troops }, wear: undefined, war: undefined });
    const ms = worldDays(6);
    expect(lightShare('light', ms), 'точка внутри области: дорога шесть игр. дн.').toBeGreaterThan(0.05);
    const seed = strikeSeed('strike', 'w1', { x: 5, y: 7 }, ms);
    legs.strikeLeg(t0, ms, seed);
    // Прочитать дорогу позже её конца (окно отряда до пульса) — не дальше её срока.
    expect(legs.wearDue(t0 + 3 * ms)).toEqual(strikeWorn(troops, 'light', ms, seed).lost);
    // Пульсы посреди дороги — частями; к концу дороги — ровно то, что сервер.
    legs.wearGeneral(t0 + ms / 3);
    legs.wearGeneral(t0 + ms);
    const { came } = strikeWorn(troops, 'light', ms, seed);
    expect(f.troops).toEqual(came);
    // Дальше — обычный отрезок от конца дороги, своим сидом мира.
    const extra = worldDays(4);
    legs.wearGeneral(t0 + ms + extra);
    const after = strikeWorn(came, 'light', extra, legs.wearSeed(t0 + ms)).came;
    expect(f.troops).toEqual(after);
    expect(troopTotal(after), 'точка внутри области: после дороги тоже тают').toBeLessThan(troopTotal(came));
  });
});

describe('командиры флангов в бою полководца (ДР-5)', () => {
  it('последствие боя несёт бой флангов: исход, кость боя и долю гибели — гибель разбитого у этой клетки × доля выбитых фланга', async () => {
    const r = await ready(7, { flanks: { A: 2, C: -1 } });
    expect(await r.world.assault(r.lair.id, 'plunder')).toBeNull();
    const out = await r.gen();
    r.at(out.arriveAt + 1000);
    const res = await r.world.sync(r.p);
    const eff = res.effects.find((e) => e.deed?.agent === 'general');
    expect(eff, 'точка внутри области: бой полководца был').toBeDefined();
    const fb = eff!.flanks;
    expect(fb, 'бой флангов в последствии').toBeDefined();
    expect(fb!.ok).toBe(eff!.deed!.ok);
    expect(fb!.at).toBe(eff!.deed!.at);
    const report = (await r.world.reports()).find((x) => x.battle?.result.seed === fb!.seed);
    expect(report, 'та же кость, что у боя').toBeDefined();
    const sides = report!.battle!.result.sides.attacker.sectors;
    const peril = routPeril(distance(r.inner.save.home, r.lair));
    const sum = (x: Record<string, number>): number => Object.values(x).reduce((a, b) => a + b, 0);
    for (const [f, sec] of [['left', 'A'], ['right', 'C']] as const) {
      expect(fb!.peril[f]).toBeCloseTo(peril * (1 - sum(sides[sec].final) / sum(sides[sec].initial)), 9);
    }
    expect(Math.max(fb!.peril.left ?? 0, fb!.peril.right ?? 0), 'точка внутри области: фланги теряли людей').toBeGreaterThan(0);
  });

  it('без командиров бой флангов в последствие не кладётся', async () => {
    const r = await ready();
    expect(await r.world.assault(r.lair.id, 'plunder')).toBeNull();
    r.at((await r.gen()).arriveAt + 1000);
    const res = await r.world.sync(r.p);
    const eff = res.effects.find((e) => e.deed?.agent === 'general');
    expect(eff, 'точка внутри области: бой полководца был').toBeDefined();
    expect(eff!.flanks).toBeUndefined();
  });
});
