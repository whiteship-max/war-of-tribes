/**
 * Этап 6 (docs/minigames.md, 18): час, редкая добыча и серия удач. Что держит тест: новое кладётся поверх прежнего, не
 * сдвигая ни одного прежнего зерна; прибавка лежит в знаменателе целиком, и полный счёт — по-прежнему единица; час
 * только отнимает (зорька — прежние числа); серия рыбалки на одном и том же улове не поднимает долю ни одного выхода.
 *
 * Области (правило 11): раскладки — на двухстах зёрнах; доли редкого — с границей, внутри которой лежит заданная
 * вероятность; слух — в окне дали между прежней слышимостью и дневной; серия — на играх рук щупа (`bots.ts`).
 */
import { describe, expect, it } from 'vitest';
import { mixSeed } from '@/game/sim/random';
import { BERRY_STREAK, Basket, STRAWBERRY_P, STRAWBERRY_WORTH, berryBonusMax, layBerries } from './berries';
import { BEASTS, Feed, HERD, LAMB_P, LAMB_WORTH, PEN_R, ROAM_IN, ROAM_OUT, herdBonusMax, herdOf, roamAt, roamSpeed } from './herd';
import { DEER, HEAR, HOUR_EAR, HUNT_CLASSIC, Hunt, START, WHITE_EAR, WHITE_P, WHITE_WORTH, layHunt } from './hunt';
import { FISH_STREAK, Fishing, HOUR_BITE } from './fishing';
import { HOURS, Streak, hourOf, shareOf, streakMax } from './rules';
import { CLASSIC, FISH_PLACES, HANDS, playFish } from './bots';
import { WALK_SPEED } from '@/prologue/glade';
import { GAME_SECONDS } from './rules';

const SEEDS = Array.from({ length: 200 }, (_, i) => mixSeed(0x7157, i) >>> 0);

/** Доля зёрен, у которых есть редкое, — внутри трёх стандартных отклонений от заданной вероятности. */
const near = (hits: number, n: number, p: number): void => {
  const sd = Math.sqrt((p * (1 - p)) / n);
  expect(hits / n).toBeGreaterThan(p - 3 * sd);
  expect(hits / n).toBeLessThan(p + 3 * sd);
};

describe('счёт с прибавкой', () => {
  it('прибавка лежит в знаменателе: всё взято — единица, ничего сверху — меньше прежнего, больше единицы — никогда', () => {
    expect(shareOf({ got: 10, total: 10, bonus: 4, bonusMax: 4 })).toBe(1);
    expect(shareOf({ got: 10, total: 10, bonus: 0, bonusMax: 4 })).toBeLessThan(shareOf({ got: 10, total: 10 }));
    expect(shareOf({ got: 10, total: 10, bonus: 9, bonusMax: 4 })).toBe(1);
    expect(shareOf({ got: 6, total: 10 })).toBe(0.6);
  });

  it('серия: с `from`-й удачи подряд — по `step`, неудача рвёт; предел — все дела подряд', () => {
    const s = new Streak(3, 2);
    expect([s.hit(), s.hit(), s.hit(), s.hit()]).toEqual([0, 0, 2, 2]);
    s.miss();
    expect(s.hit()).toBe(0);
    expect(s.best).toBe(4);
    expect(s.bonus).toBe(4);
    const all = new Streak(3, 2);
    for (let i = 0; i < 10; i++) all.hit();
    expect(all.bonus).toBe(streakMax(10, 3, 2));
  });
});

describe('час промысла', () => {
  it('утро и вечер — зорька, день и ночь — свои; зорька — прежние числа, другие часы только отнимают', () => {
    expect(hourOf('morning')).toBe('dawn');
    expect(hourOf('evening')).toBe('dusk');
    expect(hourOf('day')).toBe('day');
    expect(hourOf('night')).toBe('night');
    expect(HOUR_EAR.dawn).toBe(1);
    expect(HOUR_BITE.dawn).toBe(1);
    for (const h of HOURS) {
      expect(HOUR_EAR[h], h).toBeGreaterThanOrEqual(1);
      expect(HOUR_BITE[h], h).toBeGreaterThanOrEqual(1);
    }
    // Область: хотя бы один час правда отнимает — иначе часу нечего значить.
    expect(HOURS.some((h) => HOUR_EAR[h] > 1)).toBe(true);
    expect(HOURS.some((h) => HOUR_BITE[h] > 1)).toBe(true);
  });

  it('днём поклёвки ждать дольше, чем на зорьке, ровно во столько, во сколько велит час', () => {
    const place = { shore: 'river', zone: 'land', season: 'summer' } as const;
    for (const seed of SEEDS.slice(0, 40)) {
      const dawn = new Fishing(seed, { ...place, hour: 'dawn' }).planAt({ hang: false, deep: false, weeds: false, snag: false, near: false });
      const day = new Fishing(seed, { ...place, hour: 'day' }).planAt({ hang: false, deep: false, weeds: false, snag: false, near: false });
      expect(day.fish).toEqual(dawn.fish);
      expect(day.bite / dawn.bite).toBeCloseTo(HOUR_BITE.day, 9);
    }
  });

  it('днём олень слышит тетиву дальше: в окне между прежней слышимостью и дневной он настораживается только днём', () => {
    const d = (HEAR.twang.alert * (1 + HOUR_EAR.day)) / 2;
    // Область: точка — внутри окна, где правило дня и правило зорьки расходятся.
    expect(d).toBeGreaterThan(HEAR.twang.alert);
    expect(d).toBeLessThan(HEAR.twang.alert * HOUR_EAR.day);
    for (const hour of ['dawn', 'day'] as const) {
      const h = new Hunt(SEEDS[0], { hour, rare: false });
      const p = h.pose(0, 1);
      h.hear({ t: 1, kind: 'twang', x: p.x, z: p.z + d, loud: 1, hx: START.x, hz: START.z });
      expect(h.pose(0, 1.1).kind, hour).toBe(hour === 'day' ? 'alert' : 'graze');
    }
  });
});

describe('редкая добыча: поверх прежнего поля, не сдвигая его', () => {
  it('земляника — раз в три выхода, на месте одного низкого куста; места, сроки и число ягод прежние', () => {
    let hits = 0;
    for (const seed of SEEDS) {
      const old = layBerries(seed);
      const f = layBerries(seed, { rare: true });
      const straw = f.bushes.filter((b) => b.kind === 'strawberry');
      expect(straw.length).toBeLessThanOrEqual(1);
      if (straw.length) hits++;
      expect(f.total).toBe(old.total);
      f.bushes.forEach((b, i) => {
        const o = old.bushes[i];
        expect([b.x, b.z, b.berries.map((x) => x.ripeAt)]).toEqual([o.x, o.z, o.berries.map((x) => x.ripeAt)]);
        if (b.kind === 'strawberry') expect(o.kind).not.toBe('raspberry');
        else expect(b.kind).toBe(o.kind);
      });
    }
    near(hits, SEEDS.length, STRAWBERRY_P);
  });

  it('спелая земляника — вдвойне; серия — с `from`-го чистого куста подряд; всё взято чисто и подряд — единица', () => {
    const seed = SEEDS.find((s) => layBerries(s, { rare: true }).bushes.some((b) => b.kind === 'strawberry'))!;
    const f = layBerries(seed, { rare: true });
    const basket = new Basket(true);
    // Каждый куст — после последней своей ягоды: все чистые, серия идёт с первого.
    const order = [...f.bushes].sort((a, b) => Math.max(...a.berries.map((x) => x.ripeAt)) - Math.max(...b.berries.map((x) => x.ripeAt)));
    let streakBonus = 0;
    order.forEach((b, i) => {
      const y = basket.pick(b, Math.max(...b.berries.map((x) => x.ripeAt)))!;
      const straw = b.kind === 'strawberry' ? b.berries.length * (STRAWBERRY_WORTH - 1) : 0;
      const run = i + 1 >= BERRY_STREAK.from ? BERRY_STREAK.step : 0;
      streakBonus += run;
      expect(y.extra, b.kind).toBe(straw + run);
    });
    expect(basket.streak.bonus).toBe(streakBonus);
    expect(shareOf({ got: basket.got, total: f.total, bonus: basket.bonus, bonusMax: berryBonusMax(f, true) })).toBe(1);
    // Зелёный куст рвёт серию: два чистых подряд, третий — с зелёными, четвёртый — серия с единицы.
    const b2 = new Basket(true);
    const [a, b, c, d] = order;
    const late = (x: typeof a): number => Math.max(...x.berries.map((q) => q.ripeAt));
    b2.pick(a, late(a));
    b2.pick(b, late(b));
    // Область: серия набрана — рвать есть что.
    expect(b2.streak.run).toBe(2);
    expect(b2.pick(c, Math.min(...c.berries.map((q) => q.ripeAt)) - 1)!.green).toBeGreaterThan(0);
    expect(b2.streak.run).toBe(0);
    b2.pick(d, late(d));
    expect(b2.streak.run).toBe(1);
  });

  it('ягнёнок — раз в три выхода; остальное стадо прежнее; весь ход в загоне и не быстрее человека; сытый — сверху', () => {
    let hits = 0;
    for (const seed of SEEDS) {
      const old = herdOf(seed);
      const h = herdOf(seed, { rare: true });
      expect(h.beasts.slice(0, HERD.length)).toEqual(old.beasts);
      expect(h.total).toBe(old.total);
      const lamb = h.beasts.find((b) => b.kind === 'lamb');
      if (!lamb) continue;
      hits++;
      for (let t = 0; t <= GAME_SECONDS.herd; t += 0.25) {
        const p = roamAt(h, lamb, t);
        const r = Math.hypot(p.x, p.z);
        expect(r).toBeGreaterThanOrEqual(ROAM_IN + BEASTS.lamb.r - 1e-9);
        expect(r).toBeLessThanOrEqual(ROAM_OUT - BEASTS.lamb.r + 1e-9);
        expect(r).toBeLessThan(PEN_R);
        expect(roamSpeed(h, lamb, t)).toBeLessThan(WALK_SPEED);
      }
    }
    near(hits, SEEDS.length, LAMB_P);
    const seed = SEEDS.find((s) => herdOf(s, { rare: true }).beasts.some((b) => b.kind === 'lamb'))!;
    const h = herdOf(seed, { rare: true });
    const feed = new Feed(h);
    const id = h.beasts.findIndex((b) => b.kind === 'lamb');
    feed.take();
    expect(feed.feed(id, 1)).toBe(true);
    expect(feed.got).toBe(0);
    expect(feed.bonus).toBe(LAMB_WORTH);
    expect(herdBonusMax(h)).toBe(LAMB_WORTH);
    expect(feed.sated(id)).toBe(true);
  });

  it('белый олень — раз в четыре выхода, рогач дальней кучки; поле прежнее; чуток; лёг — вдвойне', () => {
    let hits = 0;
    for (const seed of SEEDS) {
      const old = layHunt(seed);
      const f = layHunt(seed, true);
      expect(f.cover).toEqual(old.cover);
      expect(f.deer.map(({ white: _, ...d }) => d)).toEqual(old.deer);
      const white = f.deer.filter((d) => d.white);
      expect(white.length).toBeLessThanOrEqual(1);
      if (!white.length) continue;
      hits++;
      expect(white[0].doe).toBe(false);
      expect(white[0].group).toBe(Math.max(...f.deer.map((d) => d.group)));
    }
    near(hits, SEEDS.length, WHITE_P);
    expect(WHITE_EAR).toBeGreaterThan(1);
    const seed = SEEDS.find((s) => layHunt(s, true).deer.some((d) => d.white))!;
    const h = new Hunt(seed, { hour: 'dawn', rare: true });
    expect(h.tally()).toEqual({ got: 0, total: DEER, bonus: 0, bonusMax: WHITE_WORTH - 1 });
    // Прежняя охота без белого — прежний счёт.
    expect(new Hunt(seed, HUNT_CLASSIC).tally()).toEqual({ got: 0, total: DEER, bonus: 0, bonusMax: 0 });
  });
});

describe('серия рыбалки не поднимает выход', () => {
  it('на одном и том же улове доля с серией не больше доли без неё — у каждой руки, на каждом берегу и зерне', () => {
    expect(FISH_STREAK.k).toBe(FISH_STREAK.max);
    let streaks = 0;
    for (const hand of HANDS) {
      for (const place of FISH_PLACES) {
        for (const seed of SEEDS.slice(0, 12)) {
          const plain = playFish(seed, hand, { ...CLASSIC }, place);
          const twisted = playFish(seed, hand, { ...CLASSIC, streaks: true }, place);
          expect(twisted, `${hand.name} ${place.shore} ${seed}`).toBeLessThanOrEqual(plain + 1e-12);
          if (twisted < plain - 1e-12) streaks++;
        }
      }
    }
    // Область: серия правда меняла долю — иначе сравнивать было нечего.
    expect(streaks).toBeGreaterThan(0);
  });
});
