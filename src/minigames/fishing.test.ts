/**
 * «Рыбалка» — правило (docs/minigames.md, раздел 17): заброс, места, рыбы по берегу, поясу и сезону, план поклёвок,
 * подсечка, вываживание и счёт. Награда и энергия — общей дверью (`sim/minigames.test.ts`, «рыбалка: энергия…»).
 *
 * Обещания об исходе вываживания проверяются на наборе (правило 17): каждая рыба таблицы, три веса и трофей, несколько
 * зёрен рывков. Область — фаза `fight`: каждое утверждение об исходе стоит после проверки, что рыба была на крючке.
 */
import { describe, expect, it } from 'vitest';
import { mixSeed } from '@/game/sim/random';
import type { Season } from '@/game/types';
import type { Zone } from '@/render/climate';
import {
  BANK_Z,
  CAST_ARC,
  CAST_MAX,
  CAST_MIN,
  CAST_WEAK,
  EDGE,
  FAR_BANK_Z,
  FISH,
  Fishing,
  GOAL_FISH,
  HOOK_PAUSE,
  LAND_D,
  SNAP_S,
  STEP,
  baseRate,
  castPoint,
  goalGrams,
  hookedOf,
  layField,
  meanWeight,
  poolOf,
  spotAt,
  surgesOf,
  type FishDef,
  type FishEvent,
  type Setting,
  type Shore,
} from './fishing';

const ZONES: Zone[] = ['med', 'dry', 'ocean', 'land', 'north'];
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const SHORES: Shore[] = ['river', 'sea'];

/** Игра, где рыба уже на крючке на дали `d`: заброс прямо, поклёвка подменена планом с этой рыбой и мгновенной. */
function hooked(def: FishDef, u: number, trophy: boolean, seed: number, d = 14): Fishing {
  const g = new Fishing(seed, { shore: def.shore, zone: 'land', season: 'summer' });
  g.press(0);
  g.release(STEP, 1, 0);
  // Подменить план: эта рыба, клюёт сразу, окно долгое — подсечка гарантирована.
  const land = { x: 0, z: BANK_Z - d, d };
  g.land = land;
  const fish = hookedOf(def, u, trophy ? 0 : 1);
  (g as unknown as { splash: (t: number) => void }).splash = () => undefined;
  g.phase = 'wait';
  g.since = 0;
  g.plan = { fish, nibbles: [], bite: 0, window: 99 };
  g.press(0.05);
  return g;
}

/** Как ведёт рыбак: держит, отпускает, уводит удилище — по нынешней леске. */
type Hand = (g: Fishing) => { hold: boolean; rod: number };
const MASTER: Hand = (g) => ({ hold: (g.line?.tension ?? 0) < 0.72, rod: g.line?.surge ? -g.line.surge.side : 0 });
const ALWAYS: Hand = () => ({ hold: true, rod: 0 });
const NEVER: Hand = () => ({ hold: false, rod: 0 });

/** Довести вываживание до конца рукой `hand` кадрами `dt`: чем кончилось и за сколько. */
function fight(g: Fishing, hand: Hand, dt = 1 / 60, limit = 60): { end: FishEvent['kind'] | 'time'; t: number; fought: boolean } {
  let t = 0.05;
  let fought = false;
  while (t < limit) {
    t += dt;
    const L = g.line;
    if (L) {
      fought = true;
      const want = hand(g);
      if (want.hold !== L.reeling) {
        if (want.hold) g.press(t);
        else g.release(t, 0, 0);
      }
      if (Math.abs(want.rod - L.rod) > 0.01) g.steer(t, want.rod);
    }
    g.advance(t);
    const end = g.takeEvents().find((e) => e.kind === 'caught' || e.kind === 'snap' || e.kind === 'slack');
    if (end) return { end: end.kind, t, fought };
  }
  return { end: 'time', t, fought };
}

describe('рыбалка: заброс и места', () => {
  it('сила — дальность от CAST_MIN до CAST_MAX, растёт с силой; у реки — не за дальний берег; угол — в пределах', () => {
    let was = 0;
    for (let p = CAST_WEAK; p <= 1.0001; p += 0.05) {
      const c = castPoint(p, 0);
      expect(c.d).toBeGreaterThanOrEqual(was);
      expect(c.d).toBeGreaterThanOrEqual(CAST_MIN);
      expect(c.d).toBeLessThanOrEqual(CAST_MAX + 1e-9);
      was = c.d;
    }
    for (const yaw of [-2, -CAST_ARC, -0.3, 0, 0.3, CAST_ARC, 2]) {
      const c = castPoint(1, yaw);
      expect(c.z).toBeGreaterThan(FAR_BANK_Z);
      expect(c.z).toBeLessThan(BANK_Z);
      expect(Math.abs(Math.atan2(-c.x, -(c.z - BANK_Z)))).toBeLessThanOrEqual(CAST_ARC + 1e-9);
    }
  });

  it('слабый замах — не заброс: грузило у ног, энергии и времени правило не берёт', () => {
    const g = new Fishing(1, { shore: 'river', zone: 'land', season: 'summer' });
    g.press(0);
    g.release(0.5, CAST_WEAK * 0.5, 0);
    expect(g.takeEvents().map((e) => e.kind)).toEqual(['weak']);
    expect(g.phase).toBe('idle');
    expect(g.casts).toBe(0);
  });

  it('места от зерна на двухстах зёрнах: трава у берега сбоку, коряга посередине с другой стороны, омут вдали; всё в воде', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const f = layField(mixSeed(seed, 7));
      const d = (s: { x: number; z: number }): number => Math.hypot(s.x, s.z - BANK_Z);
      expect(d(f.weeds)).toBeGreaterThan(5);
      expect(d(f.weeds)).toBeLessThan(8.5);
      expect(d(f.snag)).toBeGreaterThan(10);
      expect(d(f.snag)).toBeLessThan(14.5);
      expect(d(f.deep)).toBeGreaterThan(16);
      expect(Math.sign(f.weeds.x)).not.toBe(Math.sign(f.snag.x));
      for (const s of [f.weeds, f.snag, f.deep]) expect(s.z + s.r).toBeLessThan(BANK_Z);
      for (const s of [f.weeds, f.snag, f.deep]) expect(s.z - s.r).toBeGreaterThan(FAR_BANK_Z);
      // Зацеп — только в ядре; край ядра — засада, а не зацеп.
      expect(spotAt(f, f.weeds.x, f.weeds.z).hang).toBe(true);
      const edge = spotAt(f, f.snag.x + f.snag.r + EDGE / 2, f.snag.z);
      expect(edge.hang).toBe(false);
      expect(edge.snag).toBe(true);
    }
  });

  it('заброс в траву или корягу — зацеп, а не поклёвка', () => {
    const g = new Fishing(5, { shore: 'river', zone: 'land', season: 'summer' });
    const w = g.field.weeds;
    const yaw = Math.atan2(-w.x, -(w.z - BANK_Z));
    const d = Math.hypot(w.x, w.z - BANK_Z);
    const power = (d - CAST_MIN) / (CAST_MAX - CAST_MIN);
    g.press(0);
    g.release(0.1, power, yaw);
    g.advance(3);
    const kinds = g.takeEvents().map((e) => e.kind);
    expect(kinds).toContain('hang');
    expect(kinds).not.toContain('land');
    expect(g.plan).toBeNull();
  });
});

describe('рыбалка: рыбы по берегу, поясу и сезону', () => {
  it('у каждого берега, пояса и сезона есть кого ловить; рыбы реки и моря не смешиваются', () => {
    for (const shore of SHORES) {
      for (const zone of ZONES) {
        for (const season of SEASONS) {
          const s: Setting = { shore, zone, season };
          const pool = poolOf(s);
          expect(pool.length, `${shore} ${zone} ${season}`).toBeGreaterThanOrEqual(2);
          for (const f of pool) expect(f.shore).toBe(shore);
          expect(goalGrams(s)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('налим — только в холод; карп — не в холодных поясах; тёплое море и холодное — разные рыбы', () => {
    const burbot = FISH.find((f) => f.id === 'burbot')!;
    expect(baseRate(burbot, { shore: 'river', zone: 'north', season: 'summer' })).toBe(0);
    expect(baseRate(burbot, { shore: 'river', zone: 'north', season: 'winter' })).toBeGreaterThan(0);
    const carp = FISH.find((f) => f.id === 'carp')!;
    expect(baseRate(carp, { shore: 'river', zone: 'north', season: 'summer' })).toBe(0);
    const warm = poolOf({ shore: 'sea', zone: 'med', season: 'summer' }).map((f) => f.id);
    const cold = poolOf({ shore: 'sea', zone: 'north', season: 'summer' }).map((f) => f.id);
    expect(warm).toContain('mullet');
    expect(cold).toContain('cod');
    expect(warm.filter((id) => cold.includes(id))).toEqual([]);
  });

  it('цель — четыре средние рыбы берега; у моря тяжелее, чем у реки того же пояса', () => {
    for (const zone of ['ocean', 'land'] as const) {
      const s: Setting = { shore: 'river', zone, season: 'summer' };
      const pool = poolOf(s);
      const total = pool.reduce((n, f) => n + baseRate(f, s), 0);
      const mean = pool.reduce((n, f) => n + (baseRate(f, s) / total) * meanWeight(f), 0);
      expect(Math.abs(goalGrams(s) - GOAL_FISH * mean * 1000)).toBeLessThanOrEqual(50);
    }
    expect(goalGrams({ shore: 'sea', zone: 'north', season: 'summer' })).toBeGreaterThan(goalGrams({ shore: 'river', zone: 'north', season: 'summer' }));
  });

  it('трофей — редко и тяжелее верхнего обычного веса; обычная рыба — в своих пределах', () => {
    for (const f of FISH) {
      for (const u of [0, 0.3, 0.7, 1]) {
        const usual = hookedOf(f, u, 1);
        expect(usual.trophy).toBe(false);
        expect(usual.grams).toBeGreaterThanOrEqual(Math.round(f.min * 1000));
        expect(usual.grams).toBeLessThanOrEqual(Math.round(f.max * 1000));
        const big = hookedOf(f, u, 0);
        expect(big.trophy).toBe(true);
        expect(big.grams).toBeGreaterThan(f.max * 1000);
      }
    }
    // Доля трофеев на жребии заброса: на тысяче забросов — около двадцатой.
    const g = new Fishing(11, { shore: 'river', zone: 'land', season: 'summer' });
    const tags = spotAt(g.field, 0, BANK_Z - 12);
    let trophies = 0;
    for (let i = 0; i < 1000; i++) {
      g.casts = i;
      if (g.planAt(tags).fish.trophy) trophies++;
    }
    expect(trophies).toBeGreaterThan(25);
    expect(trophies).toBeLessThan(80);
  });

  it('место решает: у травы чаще щука, в омуте — лещ; у берега — мелочь', () => {
    const g = new Fishing(3, { shore: 'river', zone: 'land', season: 'summer' });
    const count = (x: number, z: number): Record<string, number> => {
      const tags = spotAt(g.field, x, z);
      const out: Record<string, number> = {};
      for (let i = 0; i < 600; i++) {
        g.casts = i;
        const id = g.planAt(tags).fish.def.id;
        out[id] = (out[id] ?? 0) + 1;
      }
      return out;
    };
    const w = g.field.weeds;
    const atWeeds = count(w.x + (w.r + EDGE / 2) * Math.sign(w.x), w.z);
    const atDeep = count(g.field.deep.x, g.field.deep.z);
    expect(spotAt(g.field, g.field.deep.x, g.field.deep.z).deep).toBe(true);
    expect(atWeeds.pike ?? 0).toBeGreaterThan(atDeep.pike ?? 0);
    expect(atDeep.bream ?? 0).toBeGreaterThan(atWeeds.bream ?? 0);
  });
});

describe('рыбалка: поклёвка и подсечка', () => {
  it('план заброса — от зерна и номера заброса: ложные дрожат раньше поклёвки и не вплотную к ней', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const g = new Fishing(seed, { shore: 'river', zone: 'land', season: 'summer' });
      const tags = spotAt(g.field, 0, BANK_Z - 12);
      g.casts = seed % 7;
      const a = g.planAt(tags);
      const b = g.planAt(tags);
      expect(b).toEqual(a);
      for (const n of a.nibbles) {
        expect(n).toBeGreaterThan(0.6);
        expect(n).toBeLessThan(a.bite - 0.7 + 1e-9);
      }
      expect(a.bite).toBeGreaterThanOrEqual(a.fish.def.wait[0] - 1e-9);
      expect(a.bite).toBeLessThanOrEqual(a.fish.def.wait[1] * 1.12 + 1e-9);
    }
  });

  /** Заброс прямо на двенадцать метров и ожидание до падения поплавка. */
  const castAndWait = (seed: number): Fishing => {
    const g = new Fishing(seed, { shore: 'river', zone: 'land', season: 'summer' });
    g.press(0);
    // Прямо на двенадцать метров — мимо травы и коряги этого зерна? Если нет — правее.
    let yaw = 0;
    const power = (12 - CAST_MIN) / (CAST_MAX - CAST_MIN);
    while (spotAt(g.field, castPoint(power, yaw).x, castPoint(power, yaw).z).hang) yaw += 0.1;
    g.release(0.1, power, yaw);
    g.advance(2);
    expect(g.phase).toBe('wait');
    return g;
  };

  it('подсечка раньше поклёвки — впустую; в окне — рыба на крючке; не успел — объела насадку', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const early = castAndWait(seed);
      const plan = early.plan!;
      early.takeEvents();
      early.press(early.since + plan.bite * 0.5);
      expect(early.takeEvents().map((e) => e.kind)).toContain('early');
      expect(early.phase).toBe('back');

      const good = castAndWait(seed);
      good.press(good.since + good.plan!.bite + good.plan!.window * 0.5);
      expect(good.phase).toBe('fight');
      expect(good.takeEvents().map((e) => e.kind)).toContain('hooked');

      const late = castAndWait(seed);
      late.advance(late.since + late.plan!.bite + late.plan!.window + 0.05);
      const kinds = late.takeEvents().map((e) => e.kind);
      expect(kinds).toContain('bite');
      expect(kinds).toContain('missed');
      expect(late.phase).toBe('back');
    }
  });
});

describe('рыбалка: вываживание', () => {
  it('тот, кто держит в меру и ведёт удилище против рывка, вытаскивает любую рыбу таблицы — от мелкой до трофея', () => {
    for (const def of FISH) {
      for (const [u, trophy] of [
        [0.05, false],
        [0.5, false],
        [1, false],
        [1, true],
      ] as const) {
        for (const seed of [3, 17, 101]) {
          const r = fight(hooked(def, u, trophy, seed), MASTER);
          expect(r.fought, `${def.id}: рыба на крючке`).toBe(true);
          expect(r.end, `${def.id} ${u} ${trophy} ${seed}`).toBe('caught');
          expect(r.t).toBeLessThan(40);
        }
      }
    }
  });

  /**
   * Граница области: рывок слабее всего — 0.85 силы рыбы (`surgesOf`), и держащий катушку добавляет к нему `REEL_LOAD`.
   * Натяжение выше единицы на любом рывке — у рыбы с силой не меньше 0.95: она и есть «сильная». Между 0.45 и 0.95 —
   * как повезёт с рывками; там тест не спрашивает ничего.
   */
  it('кто тянет не отпуская, рвёт леску на сильной рыбе; мелкую вытаскивает и так', () => {
    let strong = 0;
    for (const def of FISH) {
      const big = hookedOf(def, 1, 1);
      const r = fight(hooked(def, 1, false, 5), ALWAYS);
      expect(r.fought).toBe(true);
      if (big.pull >= 0.95) {
        strong++;
        expect(r.end, `${def.id}: ${big.pull.toFixed(2)}`).toBe('snap');
      }
      if (big.pull < 0.45) expect(r.end, `${def.id}`).toBe('caught');
    }
    // Область: в таблице есть и сильные, и слабые.
    expect(strong).toBeGreaterThanOrEqual(4);
  });

  it('кто не тянет вовсе, не вытаскивает никого: рыба сходит со слабины или рвёт леску до конца катушки', () => {
    for (const def of FISH) {
      const r = fight(hooked(def, 0.5, false, 9), NEVER, 1 / 60, 120);
      expect(r.fought).toBe(true);
      expect(r.end, def.id).not.toBe('caught');
      expect(r.end, def.id).not.toBe('time');
    }
  });

  it('удилище против рывка помогает: та же рыба вытаскивается быстрее, чем без него', () => {
    const noRod: Hand = (g) => ({ hold: MASTER(g).hold, rod: 0 });
    let faster = 0;
    let all = 0;
    for (const def of FISH.filter((f) => f.pull >= 0.6)) {
      const a = fight(hooked(def, 0.8, false, 21), MASTER);
      const b = fight(hooked(def, 0.8, false, 21), noRod);
      expect(a.end).toBe('caught');
      all++;
      if (b.end !== 'caught' || a.t < b.t) faster++;
    }
    expect(all).toBeGreaterThan(4);
    expect(faster).toBe(all);
  });

  it('леска рвётся не от одного кадра: натяжение выше предела держится SNAP_S, прежде чем лопнуть', () => {
    const pike = FISH.find((f) => f.id === 'pike')!;
    const g = hooked(pike, 1, true, 4);
    // Держать с первого мига: рывок начинается после замешательства.
    let t = 0.05;
    let over = -1;
    while (t < 5 && g.phase === 'fight') {
      t += STEP;
      g.advance(t);
      if (over < 0 && (g.line?.tension ?? 0) >= 1) over = t;
    }
    const snap = g.takeEvents().find((e) => e.kind === 'snap');
    expect(over, 'точка внутри области: натяжение дошло до предела').toBeGreaterThan(HOOK_PAUSE);
    expect(snap).toBeDefined();
    expect(snap!.t - over).toBeGreaterThanOrEqual(SNAP_S - STEP * 2);
  });

  it('рыба у берега — вытащена: столько лески, сколько LAND_D, и счёт растёт её весом', () => {
    const roach = FISH.find((f) => f.id === 'roach')!;
    const g = hooked(roach, 0.5, false, 2, 6);
    const grams = g.fish!.grams;
    const r = fight(g, MASTER);
    expect(r.end).toBe('caught');
    expect(g.catches.map((c) => c.grams)).toEqual([grams]);
    expect(g.tally().got).toBe(Math.min(grams, g.goal));
    expect(g.phase).toBe('show');
    expect(LAND_D).toBeGreaterThan(0);
  });

  it('счёт — не выше цели: трофей больше цели засчитывается целью', () => {
    const g = new Fishing(1, { shore: 'river', zone: 'land', season: 'summer' });
    g.catches.push({ def: FISH[3], grams: g.goal * 3, trophy: true });
    expect(g.tally()).toEqual({ got: g.goal, total: g.goal });
  });

  it('тот же ряд вестей — та же рыба при кадре 1/60, 1/30, 1/45 и 1/144', () => {
    const carp = FISH.find((f) => f.id === 'carp')!;
    // Ряд вестей: держит, отпускает, уводит удилище — по своим секундам, а не по кадрам.
    const series: { t: number; hold?: boolean; rod?: number }[] = [];
    for (let k = 0; k < 40; k++) series.push({ t: 0.3 + k * 0.45, hold: k % 3 !== 2, rod: k % 4 === 1 ? 0.8 : k % 4 === 3 ? -0.8 : undefined });
    const run = (dt: number): string => {
      const g = hooked(carp, 0.6, false, 33);
      let t = 0.05;
      let i = 0;
      const log: string[] = [];
      while (t < 25 && g.line) {
        t += dt;
        while (i < series.length && series[i].t <= t) {
          const e = series[i++];
          if (e.hold === true) g.press(e.t);
          if (e.hold === false) g.release(e.t, 0, 0);
          if (e.rod !== undefined) g.steer(e.t, e.rod);
        }
        g.advance(t);
        for (const ev of g.takeEvents()) log.push(`${ev.kind}@${ev.t.toFixed(4)}`);
      }
      return `${log.join(' ')} | ${g.catches.map((c) => c.grams).join(',')}`;
    };
    const base = run(1 / 60);
    expect(base, 'точка внутри области: в ряду были рывки и конец').toMatch(/surge@.*(caught|snap|slack)@/);
    for (const dt of [1 / 30, 1 / 45, 1 / 144]) expect(run(dt)).toBe(base);
  });

  it('поведение на крючке — от зерна: миг замешательства, потом рывок; передышки и рывки чередуются', () => {
    const pike = hookedOf(FISH.find((f) => f.id === 'pike')!, 0.5, 1);
    for (let seed = 1; seed <= 50; seed++) {
      const s = surgesOf(seed, pike, 2);
      expect(s[0].t0).toBe(2);
      expect(s[0].t1).toBeCloseTo(2 + HOOK_PAUSE, 9);
      expect(s[0].k).toBeLessThan(0.5);
      expect(s[1].k).toBeGreaterThan(0.8);
      for (let i = 1; i < s.length; i++) expect(s[i].t0).toBeCloseTo(s[i - 1].t1, 9);
      expect(surgesOf(seed, pike, 2)).toEqual(s);
    }
  });
});
