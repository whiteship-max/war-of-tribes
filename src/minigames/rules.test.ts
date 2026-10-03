/**
 * Правила промыслов: раскладка и поведение — от зерна и времени сцены, счёт — из правила (docs/minigames.md, 5–6).
 *
 * Область каждого правила названа (правило 11): раскладка — на двухстах зёрнах; ход скота — на всём времени игры
 * «Скот» (0…75 с) с шагом в десятую секунды; созревание — внутри минуты «Ягод».
 */
import { describe, expect, it } from 'vitest';
import { REACH as GLADE_REACH } from '@/prologue/glade';
import { BUSHES, BUSH_GAP, BUSH_KINDS, Basket, FIELD_R, START_CLEAR, blush, layBerries, ripe, yieldOf } from './berries';
import { BEASTS, Feed, HAY, HERD, PEN_R, ROAM_IN, ROAM_OUT, herdOf, roamAt, roamSpeed } from './herd';
import { GAME_SECONDS, REACH, nearestTarget, shareOf } from './rules';

const SEEDS = Array.from({ length: 200 }, (_, i) => (i * 2654435761) >>> 0);

describe('ягоды: раскладка от зерна', () => {
  it('одно зерно — одна поляна, другое — другая', () => {
    expect(layBerries(12345)).toEqual(layBerries(12345));
    expect(layBerries(12345)).not.toEqual(layBerries(12346));
  });

  it('кусты на поляне, не у ног и не вплотную; виды поровну', () => {
    for (const seed of SEEDS) {
      const f = layBerries(seed);
      expect(f.bushes.length).toBe(BUSHES);
      for (const b of f.bushes) {
        const r = Math.hypot(b.x, b.z);
        expect(r).toBeLessThanOrEqual(FIELD_R + 1e-9);
        expect(r).toBeGreaterThanOrEqual(START_CLEAR);
      }
      for (let i = 0; i < f.bushes.length; i++)
        for (let j = i + 1; j < f.bushes.length; j++) {
          const a = f.bushes[i];
          const b = f.bushes[j];
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(BUSH_GAP * 0.9 ** 3);
        }
      const count = (k: string): number => f.bushes.filter((b) => b.kind === k).length;
      for (const k of Object.keys(BUSH_KINDS)) expect([3, 4]).toContain(count(k));
      expect(f.total).toBe(f.bushes.reduce((n, b) => n + b.berries.length, 0));
    }
  });

  it('порядок решает: на каждой поляне есть спелый на старте и зреющий после полуминуты, и всё спеет до конца', () => {
    const end = GAME_SECONDS.berries;
    for (const seed of SEEDS) {
      const f = layBerries(seed);
      const full = f.bushes.map((b) => Math.max(...b.berries.map((x) => x.ripeAt)));
      const first = f.bushes.map((b) => Math.min(...b.berries.map((x) => x.ripeAt)));
      expect(full.some((t) => t <= 0)).toBe(true);
      expect(first.some((t) => t > end / 2)).toBe(true);
      // Область: последняя ягода спеет внутри игры — потолок счёта достижим.
      for (const t of full) expect(t).toBeLessThan(end);
    }
  });

  it('тап обирает куст целиком: спелые — в корзину, зелёные пропали, второй раз — пусто', () => {
    const f = layBerries(777);
    // Куст, у которого посреди созревания часть спела, часть нет.
    const bush = f.bushes.find((b) => {
      const ts = b.berries.map((x) => x.ripeAt);
      return Math.max(...ts) - Math.min(...ts) > 1 && Math.min(...ts) > 0;
    })!;
    expect(bush).toBeDefined();
    const ts = bush.berries.map((x) => x.ripeAt).sort((a, b) => a - b);
    const mid = (ts[0] + ts[ts.length - 1]) / 2;
    const y = yieldOf(bush, mid);
    // Область: в эту секунду есть и спелые, и зелёные.
    expect(y.ripe).toBeGreaterThan(0);
    expect(y.green).toBeGreaterThan(0);
    const basket = new Basket();
    expect(basket.pick(bush, mid)).toEqual(y);
    expect(basket.got).toBe(y.ripe);
    expect(basket.lost).toBe(y.green);
    expect(basket.pick(bush, ts[ts.length - 1] + 1)).toBeNull();
    expect(basket.got).toBe(y.ripe);
  });

  it('обобрать каждый куст после его последней ягоды — весь счёт', () => {
    const f = layBerries(4242);
    const basket = new Basket();
    for (const b of f.bushes) basket.pick(b, Math.max(...b.berries.map((x) => x.ripeAt)));
    expect(shareOf({ got: basket.got, total: f.total })).toBe(1);
  });

  it('цвет меняется до спелости и только до неё', () => {
    const b = layBerries(1).bushes[0].berries[0];
    expect(blush(b, b.ripeAt - 10)).toBe(0);
    expect(blush(b, b.ripeAt - 1)).toBeGreaterThan(0);
    expect(ripe(b, b.ripeAt - 1e-6)).toBe(false);
    expect(blush(b, b.ripeAt)).toBe(1);
    expect(ripe(b, b.ripeAt)).toBe(true);
  });
});

describe('скот: ход от зерна и времени', () => {
  const end = GAME_SECONDS.herd;
  const steps = Array.from({ length: end * 10 + 1 }, (_, i) => i / 10);

  it('одно зерно и одна секунда — одно место', () => {
    const a = herdOf(99);
    const b = herdOf(99);
    for (const t of [0, 7.3, 41]) for (const x of a.beasts) expect(roamAt(a, x, t)).toEqual(roamAt(b, b.beasts[x.id], t));
    expect(herdOf(99)).not.toEqual(herdOf(100));
  });

  it('стадо — четыре овцы, три козы и корова, десять охапок', () => {
    const h = herdOf(5);
    expect(h.beasts.map((b) => b.kind)).toEqual([...HERD]);
    expect(h.total).toBe(10);
    expect(BEASTS.cow.need).toBe(3);
  });

  it('всю игру скот в загоне: не у стога и не за жердями', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const h = herdOf(seed);
      for (const b of h.beasts)
        for (const t of steps) {
          const p = roamAt(h, b, t);
          const r = Math.hypot(p.x - HAY.x, p.z - HAY.z);
          expect(r).toBeGreaterThanOrEqual(ROAM_IN - 1e-9);
          expect(r).toBeLessThanOrEqual(ROAM_OUT + 1e-9);
          expect(r).toBeLessThan(PEN_R);
        }
    }
  });

  it('козы бегают, корова еле идёт, овцы держатся кучей', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const h = herdOf(seed);
      const mean = (kind: string): number => {
        const bs = h.beasts.filter((b) => b.kind === kind);
        let n = 0;
        for (const b of bs) for (const t of steps) n += roamSpeed(h, b, t);
        return n / (bs.length * steps.length);
      };
      expect(mean('goat')).toBeGreaterThan(mean('cow') * 2);
      expect(mean('goat')).toBeGreaterThan(mean('sheep'));
      // Ни одно не быстрее человека (`glade.WALK_SPEED` 2.6 м/с): догнать можно всегда.
      for (const b of h.beasts) for (const t of steps) expect(roamSpeed(h, b, t)).toBeLessThan(2.6);
      const sheep = h.beasts.filter((b) => b.kind === 'sheep');
      for (const t of steps.filter((_, i) => i % 50 === 0)) {
        const ps = sheep.map((b) => roamAt(h, b, t));
        for (const p of ps) for (const q of ps) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(5);
      }
    }
  });

  it('охапка — одна в руках; без неё не кормят; сытое ложится там, где наелось', () => {
    const h = herdOf(31);
    const feed = new Feed(h);
    const cow = h.beasts.findIndex((b) => b.kind === 'cow');
    expect(feed.feed(cow, 1)).toBe(false);
    expect(feed.take()).toBe(true);
    expect(feed.take()).toBe(false);
    for (let i = 0; i < 3; i++) {
      if (i > 0) feed.take();
      expect(feed.feed(cow, 10 + i)).toBe(true);
    }
    expect(feed.sated(cow)).toBe(true);
    feed.take();
    expect(feed.feed(cow, 20)).toBe(false);
    expect(feed.got).toBe(3);
    expect(feed.at(cow, 60)).toEqual(roamAt(h, h.beasts[cow], 12));
  });
});

describe('тап — по ближайшему в досягаемости', () => {
  it('досягаемость — та же, что у поляны предыстории', () => {
    expect(REACH).toBe(GLADE_REACH);
  });

  it('дальше руки — ничего; из двух — ближний по краю', () => {
    const a = { id: 1, x: 0, z: REACH + 0.5 + 0.01, r: 0.5, verb: '' };
    expect(nearestTarget(0, 0, [a])).toBeNull();
    const b = { id: 2, x: 0, z: 1.8, r: 0.1, verb: '' };
    const c = { id: 3, x: 0, z: 2.2, r: 0.9, verb: '' };
    expect(nearestTarget(0, 0, [b, c])?.id).toBe(3);
  });
});
