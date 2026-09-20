import '@/game/pace.minute';
// Гибель агента: свойства, а не случаи.
//
// Области правил и их проверка в самих тестах (CLAUDE.md, правило 11):
// - «Дозор не трогает гибель» — только там, где Дозор вообще действует: у цели, где
//   шанс лазутчика не прижат потолком и полом (иначе Дозор 1 и 10 дают один шанс, и
//   «гибель та же» проходит даром), и среди минут прогона обязаны быть гибели;
// - «скрытность главнее» — точки, где гибель не прижата потолком `PERIL_MAX` (иначе
//   размах любого множителя сплющен), и каждый множитель проходит свой край до края;
// - «показанное = применённое» — точки, где гибель на минуте показа и на минуте приказа
//   **разная** (иначе совпадение даром), и точки, где агент погиб (иначе применённого
//   числа не видно);
// - память — отметки внутри окна и на его границе.
import { describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ forceDeath: false }));
vi.mock('./spy', async (orig) => {
  const real = await orig<typeof import('./spy')>();
  return { ...real, spyDeathRoll: (...args: Parameters<typeof real.spyDeathRoll>) => (H.forceDeath ? 0 : real.spyDeathRoll(...args)) };
});

import { readFileSync } from 'node:fs';
import { createInitialState } from '@/game/state';
import { MAX_AGENT_LEVEL, STEALTH_PERIL_SPAN } from '@/game/data/agents';
import { DAY_LENGTH } from '@/game/constants';
import { SEASON_SECONDS } from '@/game/data/seasons';
import { dayPartAt, seasonOf } from '@/game/derived';
import { seeded } from '@/game/sim/random';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import { playerProfile } from './bridge';
import { marchSeed } from './combat';
import { distance } from './geo';
import type { GenSettlement } from './gen';
import { LAIR_RIPE, PERIL_FAR, PERIL_MAX, PERIL_MEMORY, PERIL_SHARE, SPY_CHANCE_MAX, SPY_CHANCE_MIN } from './data/tuning';
import { perilOf, perilShare, routPeril, recentVisits, veilAt, type PerilCase } from './peril';
import type { PlayerProfile } from './types';

const START = 1_700_000_000_000;
const MIN = 60_000;

type Inner = {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  alive(s: GenSettlement, now: number): boolean;
  powerNow(s: GenSettlement, now: number): number;
};

function makeWorld(seed = 11) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return {
    world,
    inner: world as unknown as Inner,
    now: () => now,
    set: (ms: number) => {
      now = ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({ ...playerProfile(createInitialState()), ...over });

/** Ближайшее живое логово, сделанное спелым: у него часовые, и шанс лазутчика не у потолка. */
function ripeLair(w: ReturnType<typeof makeWorld>): GenSettlement {
  const save = w.inner.save;
  const lair = w.inner.gen.settlements
    .filter((s) => w.inner.alive(s, w.now()))
    .sort((a, b) => distance(save.home, a) - distance(save.home, b))[0];
  save.lairs[lair.id] = { bornAt: w.now() - LAIR_RIPE, burnedAt: 0 };
  return lair;
}

/** Поставить лазутчика вплотную к цели свободным: живым, не занятым, не задержанным. */
function spyAt(w: ReturnType<typeof makeWorld>, s: GenSettlement): void {
  const f = w.inner.save.figures.spy;
  Object.assign(f, { phase: 'field', from: { x: s.x, y: s.y }, to: { x: s.x, y: s.y }, departAt: w.now(), arriveAt: w.now(), downUntil: 0, busyUntil: 0, held: false, gone: undefined, watching: false });
  delete w.inner.save.diplomacy[s.id];
}

const SRC = (p: string): string =>
  readFileSync(new URL(p, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Тело метода мира по имени — до закрывающей скобки. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`private ${name}(`);
  expect(start, `метод ${name} есть`).toBeGreaterThan(0);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(name);
}

/** Слова Дозора: всё, чем уровень здания мог бы просочиться в гибель. */
const WATCH = /\b(?:keen\w*|intel\w*|spyChance|guardOf|warning\w*|survey\w*|chance)\b/;

describe('Дозор не трогает гибель — ни одним путём', () => {
  it('по исходнику: ни модуль гибели, ни двери мира, которые её считают, не читают Дозора и шанса дела', () => {
    const peril = SRC('./peril.ts');
    const hit = peril.split('\n').findIndex((line) => WATCH.test(line));
    expect(hit, `peril.ts:${hit + 1} ${peril.split('\n')[hit] ?? ''}`).toBe(-1);
    const world = SRC('./local/LocalWorld.ts');
    for (const name of ['perilCase', 'spyPeril', 'scoutPlan', 'defeatGeneral', 'villageTime', 'ripenessOf']) {
      expect(bodyOf(world, name), `LocalWorld.${name}`).not.toMatch(WATCH);
    }
    // Кость гибели лазутчика — без шанса дела в зерне.
    const spy = SRC('./spy.ts');
    const roll = spy.slice(spy.indexOf('export function spyDeathRoll'));
    expect(roll.slice(0, roll.indexOf('\n}')), 'зерно гибели без шанса').not.toMatch(/chance/);
  });

  it('в мире: Дозор 1 и 10 — разный шанс дела, одна и та же гибель в меню, и гибнут в одни и те же минуты', async () => {
    const runs = [];
    for (const intelKeen of [1.1, 2.0]) {
      const w = makeWorld();
      const p = profile({ intelKeen, time: 7 * DAY_LENGTH });
      await w.world.sync(p);
      const lair = ripeLair(w);
      const chances: number[] = [];
      const perils: number[] = [];
      const deaths: number[] = [];
      for (let i = 0; i < 240; i++) {
        spyAt(w, lair);
        const opt = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
        expect(opt.can, `приказ открыт: ${opt.reason}`).toBe(true);
        chances.push(opt.chance ?? 0);
        perils.push(opt.peril ?? -1);
        const eff = (await w.world.order('probe', lair.id, opt.at)) && (await w.world.sync(p)).effects;
        if (eff.some((e) => e.fell)) deaths.push(i);
        w.advance(MIN);
      }
      // Точки внутри области: шанс не прижат ни потолком, ни полом.
      for (const c of chances) {
        expect(c, 'шанс не у потолка').toBeLessThan(SPY_CHANCE_MAX);
        expect(c, 'шанс не у пола').toBeGreaterThan(SPY_CHANCE_MIN);
      }
      runs.push({ chances, perils, deaths });
    }
    const [low, high] = runs;
    expect(high.chances[0], 'Дозор вправду действует: шанс дела выше').toBeGreaterThan(low.chances[0]);
    expect(high.perils, 'гибель в меню — та же при любом Дозоре').toEqual(low.perils);
    expect(low.deaths.length, 'в прогоне есть гибели — правило спрашивалось').toBeGreaterThan(0);
    expect(high.deaths, 'и гибнут в те же минуты').toEqual(low.deaths);
  }, 60_000);

  it('разведчик и разгромленный полководец: гибель та же при любом Дозоре', async () => {
    const plans = [];
    for (const intelKeen of [1.1, 2.0]) {
      const w = makeWorld();
      await w.world.sync(profile({ intelKeen, time: 3 * DAY_LENGTH }));
      const lair = ripeLair(w);
      expect(w.inner.powerNow(lair, w.now() + 10 * MIN), 'точка внутри области: у логова часовые').toBeGreaterThan(45);
      const plan = await w.world.leadPlan('scout', { x: lair.x, y: lair.y });
      expect(plan.peril, 'гибель у ворот не нулевая').toBeGreaterThan(0);
      plans.push({ peril: plan.peril, caught: plan.caught, rout: (await w.world.strikePlan(lair.id, false)).rout });
    }
    expect(plans[1]).toEqual(plans[0]);
  });
});

describe('скрытность — главный вклад в выживание', () => {
  /** Обстановка посередине: каждый множитель у своей середины, гибель далеко от потолка. */
  const MIDDLE: PerilCase = { veil: 1, ripeness: 0.5, villageTime: 0, visits: 1, distance: PERIL_FAR / 2 };
  const at = (c: Partial<PerilCase>): number => perilOf({ ...MIDDLE, ...c });

  /** Время деревни, в которое стоит нужное время года и время суток. */
  function timeWhere(season: string, part: string): number {
    for (let t = 0; t < 4 * SEASON_SECONDS; t += 1) if (seasonOf(t) === season && dayPartAt(t) === part) return t;
    throw new Error(`${season} ${part}`);
  }

  it('замером: размах скрытности с первого кружка до пятого больше размаха любого множителя обстановки', () => {
    const middleTime = timeWhere('spring', 'morning');
    const probe = (c: Partial<PerilCase>): number => {
      const p = at({ villageTime: middleTime, ...c });
      expect(p, 'точка внутри области: гибель не прижата потолком').toBeLessThan(PERIL_MAX);
      expect(p).toBeGreaterThan(0);
      return p;
    };
    const span = (a: number, b: number): number => Math.max(a, b) / Math.min(a, b);
    const stealth = span(probe({ veil: veilAt(1) }), probe({ veil: veilAt(MAX_AGENT_LEVEL) }));
    const factors: Record<string, number> = {
      цель: span(probe({ ripeness: 0 }), probe({ ripeness: 1 })),
      час: span(probe({ villageTime: timeWhere('spring', 'night') }), probe({ villageTime: timeWhere('spring', 'day') })),
      'время года': span(probe({ villageTime: timeWhere('autumn', 'night') }), probe({ villageTime: timeWhere('winter', 'night') })),
      память: span(probe({ visits: 0 }), probe({ visits: 5 })),
      даль: span(probe({ distance: 0 }), probe({ distance: PERIL_FAR * 3 })),
    };
    for (const [name, value] of Object.entries(factors)) {
      expect(value, `${name}: множитель вправду двигает гибель`).toBeGreaterThan(1.05);
      expect(stealth, `скрытность (×${stealth.toFixed(2)}) главнее, чем ${name} (×${value.toFixed(2)})`).toBeGreaterThan(value);
    }
    // И Дозора среди множителей нет вовсе: его вклад — единица по построению.
    expect(Object.keys(PERIL_SHARE).sort()).toEqual(['hour', 'memory', 'reach', 'season', 'target']);
    expect(stealth).toBeCloseTo(STEALTH_PERIL_SPAN, 6);
  });

  it('скрытность режет гибель на каждом кружке, и ни один кружок не прибавляет', () => {
    let prev = Infinity;
    for (let level = 1; level <= MAX_AGENT_LEVEL; level++) {
      const p = at({ veil: veilAt(level) });
      expect(p, `кружок ${level}`).toBeLessThan(prev);
      prev = p;
    }
  });
});

describe('показанный риск — применённый', () => {
  it('лазутчик: приказ идёт по минуте меню, даже если между показом и нажатием сменилось время суток', async () => {
    H.forceDeath = true;
    try {
      const w = makeWorld();
      let checked = 0;
      let stale = 0;
      for (let t = 0; t < DAY_LENGTH * 2 && checked < 3; t += 2) {
        const p = profile({ time: t });
        w.set(START + 1000 * t);
        await w.world.sync(p);
        const lair = ripeLair(w);
        spyAt(w, lair);
        const shown = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
        // Игрок нажал через три секунды: время деревни ушло на три секунды вперёд.
        w.advance(3000);
        const now = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
        if (now.peril === shown.peril) continue;
        checked++;
        // Точка внутри области: на минуте нажатия гибель уже другая.
        expect(now.peril).not.toBe(shown.peril);
        const res = await w.world.order('probe', lair.id, shown.at);
        expect(res.error).toBeNull();
        const fell = (await w.world.sync(p)).effects.find((e) => e.fell)?.fell;
        expect(fell, 'точка внутри области: погиб — применённое число видно').toBeDefined();
        expect(fell!.peril, 'применена гибель из меню, а не с минуты нажатия').toBe(shown.peril);
        // Меню, которому больше десяти секунд, не в счёт: тогда — число на сейчас.
        spyAt(w, lair);
        const old = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
        w.advance(20_000);
        const fresh = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!;
        await w.world.order('probe', lair.id, old.at);
        const late = (await w.world.sync(p)).effects.find((e) => e.fell)?.fell;
        expect(late!.peril, 'устаревшее меню не применяется').toBe(fresh.peril);
        if (fresh.peril !== old.peril) stale++;
      }
      expect(checked, 'нашлись минуты, где время суток сменилось между показом и нажатием').toBe(3);
      expect(stale, 'и такие, где устаревшее меню разошлось бы с нынешним').toBeGreaterThan(0);
    } finally {
      H.forceDeath = false;
    }
  }, 60_000);

  it('разведчик: риск заморожен в минуту отправки и применён на приходе, даже когда игрока нет и часы деревни другие', async () => {
    const w = makeWorld();
    const p0 = profile({ time: 11 * DAY_LENGTH });
    await w.world.sync(p0);
    const lair = ripeLair(w);
    const save = w.inner.save;
    const cell = { x: lair.x, y: lair.y };
    // Минута отправки подбирается так, чтобы кость гибели на приходе легла ниже показанного:
    // иначе применённого числа не видно. Мир не подкручивается — ждём нужную секунду.
    let plan = await w.world.leadPlan('scout', cell);
    const second = (arrive: number): number => {
      const rng = seeded(marchSeed(save.seed, Math.floor(arrive / 1000)));
      rng();
      return rng();
    };
    for (let i = 0; i < 20_000; i++) {
      plan = await w.world.leadPlan('scout', cell);
      const arrive = w.now() + Math.round(plan.seconds * 1000);
      if (plan.peril > 0 && second(arrive) < plan.peril) break;
      w.advance(1000);
    }
    expect(plan.caught, 'точка внутри области: у логова часовые').toBeGreaterThan(0);
    expect(await w.world.moveFigure('scout', cell, plan.at)).toBeNull();
    const frozen = save.figures.scout.peril!;
    expect(frozen.peril, 'заморожено то, что показано').toBe(plan.peril);
    expect(frozen.caught).toBe(plan.caught);
    // Игрок ушёл: пульсов нет, а когда мир проснулся, слепок везёт другие часы деревни.
    const arrive = save.figures.scout.arriveAt;
    w.set(arrive + 45 * MIN);
    const p1 = profile({ time: 11 * DAY_LENGTH + 2 * SEASON_SECONDS + 17 });
    const pulse = await w.world.sync(p1);
    const fell = pulse.effects.find((e) => e.fell)?.fell;
    expect(fell, 'точка внутри области: погиб на приходе').toBeDefined();
    expect(fell!.peril, 'применено замороженное').toBe(plan.peril);
    // И это не совпадение: на минуте прихода по нынешним часам число было бы другим.
    const now = await w.world.leadPlan('scout', cell);
    expect(now.peril, 'по нынешним часам гибель другая').not.toBe(plan.peril);
  }, 60_000);
});

describe('память цели', () => {
  it('отметка живёт ровно окно памяти: на миллисекунду раньше — помнят, в срок — забыли', () => {
    const mark = START;
    expect(recentVisits([mark], mark)).toBe(1);
    expect(recentVisits([mark], mark + PERIL_MEMORY - 1)).toBe(1);
    expect(recentVisits([mark], mark + PERIL_MEMORY)).toBe(0);
    expect(recentVisits([mark], mark - 1), 'отметка из будущего не считается').toBe(0);
  });

  it('в мире: после поимки у логова гибель следующего выше, через окно памяти — снова прежняя', async () => {
    const w = makeWorld();
    const p = profile({ time: 9 * DAY_LENGTH });
    await w.world.sync(p);
    const lair = ripeLair(w);
    spyAt(w, lair);
    const before = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!.peril!;
    w.inner.save.visited = { [lair.id]: [w.now()] };
    spyAt(w, lair);
    const after = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!.peril!;
    expect(after, 'здесь уже замечали — опаснее').toBeGreaterThan(before);
    w.advance(PERIL_MEMORY);
    await w.world.sync({ ...p, time: (p.time ?? 0) });
    // Часы деревни в слепке те же — сравнивается только память.
    w.inner.save.profileAt = w.now();
    spyAt(w, lair);
    const forgotten = (await w.world.orders('spy', lair.id)).find((o) => o.id === 'probe')!.peril!;
    expect(forgotten, 'через окно памяти — как в первый раз').toBe(before);
  });
});

describe('гибель разгромленного полководца', () => {
  it('растёт с далью и только с ней, и у ворот — объявленная доля', () => {
    expect(perilShare(routPeril(0))).toBeCloseTo(0.25, 3);
    let prev = 0;
    for (let d = 0; d <= PERIL_FAR; d += 4) {
      const r = routPeril(d);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(routPeril(PERIL_FAR * 2), 'дальше края дали не растёт').toBe(routPeril(PERIL_FAR));
  });
});
