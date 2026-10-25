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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { realMs } from '@/game/pace';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { FigureView, PlayerProfile } from './types';
import type { TroopStack } from '@/game/battle/kinds';
import { troopTotal } from '@/game/battle/kinds';
import { distance, marchPosition } from './geo';
import { shieldVillagers } from './lairs';
import { ENERGY_PRICE } from './data/energy';
import { CAMP_WASTE, SIEGE_PHASE } from './data/siegeroll';
import { setPhaseDie, wasteOf } from './siegeroll';
import { LIGHT_NO_CAMP, gaitHaltMs, lightShare } from './gait';
import { MARCH_MIN_SECONDS } from './data/tuning';

// ВРЕМЕННО ×3 ДЛЯ ТЕСТА: механика проверяется при 1 (задание ДР-2); ×3 ложится сверху (`gait.test.ts`).
vi.mock('@/world/data/tuning', async (actual) => ({ ...(await actual<object>()), TEST_TRAVEL_SPEED: 1 }));

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

describe('режим марша в мире: выбор до приказа', () => {
  it('строки карточки — те же сроки, что исполнит приказ; налегке быстрее, обоз вдвое медленнее', async () => {
    const r = await ready();
    const rows = (await r.world.settlement(r.lair.id))?.assault?.gaits ?? [];
    const by = Object.fromEntries(rows.map((x) => [x.gait, x]));
    // Точка внутри области: и налегке дорога длиннее пола похода — множитель виден целиком.
    expect(by.light.walkMs).toBeGreaterThan(realMs(MARCH_MIN_SECONDS));
    expect(by.light.walkMs / by.normal.walkMs).toBeCloseTo(1 / 1.5, 2);
    expect(by.train.walkMs / by.normal.walkMs).toBeCloseTo(2, 2);
    expect(by.light.siege).toBe(LIGHT_NO_CAMP);
    expect(by.normal.siege).toBeNull();
    expect(by.light.lost).toBe(Math.round(troopTotal(HOST) * lightShare('light', by.light.walkMs)));
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
    const rows = (await r.world.settlement(r.lair.id))?.assault?.gaits ?? [];
    expect((await r.world.settlement(r.lair.id))?.assault?.walkMs).toBe(rows.find((x) => x.gait === 'normal')?.walkMs);
    expect(wasteOf('calm', 10, true)).toBeCloseTo(wasteOf('calm', 10, true, false), 12);
  });
});
