/**
 * Вид поляны числами: ступени, сторож плавности, свет по толще воздуха, экспозиция,
 * дымка и огонь.
 *
 * Как кадр выглядит, решают снимки (`npm run prologue:stand`, `LOOK=`). Здесь — правила,
 * на которых снимки стоят и которые снимком не проверить: с какой ступени начинает
 * телефон, когда сторож её опускает, что утро темнее и теплее полудня, что огонь у лица
 * женщины светит так же, как светил до физического спада.
 */
import { describe, expect, it } from 'vitest';
import {
  AIR_FROM,
  AIR_GAP,
  AIR_TO,
  FIRE_ANCHOR,
  FIRE_DECAY,
  GAP_MS,
  LOOK_KEEP_MS,
  SLOW_MS,
  SLOW_SHARE,
  Steady,
  WARM_FRAMES,
  WINDOW_MS,
  airLit,
  airMass,
  exposure,
  fireGain,
  lower,
  mistAt,
  startTier,
  storeTier,
  storedTier,
  sunTransmit,
  tierOf,
  type Mist,
  type Tier,
} from './look';

const DEG = Math.PI / 180;

describe('с какой ступени начать', () => {
  it('без целей половинной точности ступень одна — пол, что бы ни просили', () => {
    expect(startTier({ hdr: false, coarse: false })).toBe('base');
    expect(startTier({ hdr: false, coarse: true }, 'full', 'full')).toBe('base');
  });

  it('палец — телефон, указатель — настольный', () => {
    expect(startTier({ hdr: true, coarse: true })).toBe('lite');
    expect(startTier({ hdr: true, coarse: false })).toBe('full');
  });

  it('запомненная ступень опускает, но не поднимает', () => {
    expect(startTier({ hdr: true, coarse: true }, 'base')).toBe('base');
    expect(startTier({ hdr: true, coarse: true }, 'full')).toBe('lite');
    expect(startTier({ hdr: true, coarse: false }, 'lite')).toBe('lite');
  });

  it('ступень из адреса сильнее памяти и указателя', () => {
    expect(startTier({ hdr: true, coarse: true }, 'base', 'full')).toBe('full');
    expect(startTier({ hdr: true, coarse: false }, null, 'base')).toBe('base');
  });

  it('чужое слово — не ступень', () => {
    expect(tierOf('full')).toBe('full');
    expect(tierOf('ultra')).toBeNull();
    expect(tierOf(null)).toBeNull();
  });
});

describe('память ступени на устройстве', () => {
  const now = 1_000_000_000_000;

  it('свежая запись читается', () => {
    expect(storedTier(storeTier('base', now - 60_000), now)).toBe('base');
  });

  it('через неделю устройство проверяется заново', () => {
    expect(storedTier(storeTier('base', now - LOOK_KEEP_MS - 1), now)).toBeNull();
    expect(storedTier(storeTier('base', now - LOOK_KEEP_MS + 1), now)).toBe('base');
  });

  it('запись из будущего и мусор — не память', () => {
    expect(storedTier(storeTier('base', now + 60_000), now)).toBeNull();
    expect(storedTier('{', now)).toBeNull();
    expect(storedTier(null, now)).toBeNull();
    expect(storedTier(JSON.stringify({ tier: 'ultra', at: now }), now)).toBeNull();
  });
});

/**
 * Прогнать сторожа по кадрам: сперва прогрев ровными кадрами, потом `frames` кадров
 * длительностью `ms(i)`. Вернёт, на какой ступени он остался, и сколько окон он
 * успел рассудить — чтобы тест видел, что проверял внутри области правила, а не до неё.
 */
function run(start: Tier, frames: number, ms: (i: number) => number): { tier: Tier; windows: number; steps: Tier[] } {
  const s = new Steady(start);
  for (let i = 0; i < WARM_FRAMES; i++) s.feed(16.7);
  let spent = 0;
  let windows = 0;
  const steps: Tier[] = [];
  for (let i = 0; i < frames; i++) {
    const d = ms(i);
    const next = s.feed(d);
    if (d <= GAP_MS) {
      spent += d;
      if (spent >= WINDOW_MS) {
        windows++;
        spent = 0;
      }
    }
    if (next) steps.push(next);
  }
  return { tier: s.tier, windows, steps };
}

describe('сторож плавности', () => {
  it('ровные тридцать кадров в секунду — не провал', () => {
    // Граница правила: телефон в режиме экономии держит ровно тридцать, и это цель,
    // а не повод опускать ступень. Точки — внутри области: окон рассужено много.
    const r = run('full', 400, () => 1000 / 30);
    expect(r.steps).toEqual([]);
    expect(r.tier).toBe('full');
    expect(r.windows, 'точки внутри области: окна рассужены').toBeGreaterThanOrEqual(5);
  });

  it('шестьдесят — не провал', () => {
    const r = run('lite', 600, () => 1000 / 60);
    expect(r.windows).toBeGreaterThanOrEqual(4);
    expect(r.tier).toBe('lite');
  });

  it('кадр под тридцатью в каждой четвёртой точке — вниз на одну ступень за окно, до пола', () => {
    // Доля медленных — четверть, выше порога `SLOW_SHARE`.
    const slow = (i: number): number => (i % 4 === 0 ? 50 : 16.7);
    const one = run('full', 90, slow);
    expect(one.steps).toEqual(['lite']);
    expect(one.windows, 'ровно одно окно').toBe(1);
    expect(50, 'медленный кадр медленный').toBeGreaterThan(SLOW_MS);
    expect(0.25, 'доля медленных выше порога').toBeGreaterThanOrEqual(SLOW_SHARE);
    // После смены — снова прогрев, потом следующее окно опускает ещё на одну, и на полу стоп.
    const all = run('full', 900, slow);
    expect(all.steps).toEqual(['lite', 'base']);
    expect(all.tier).toBe('base');
  });

  it('редкий медленный кадр — не провал', () => {
    // Один из двадцати: сборка мусора, а не ступень.
    const r = run('full', 600, (i) => (i % 20 === 0 ? 50 : 16.7));
    expect(r.windows).toBeGreaterThanOrEqual(4);
    expect(r.tier).toBe('full');
  });

  it('паузы не судятся: вкладка в фоне не опускает ступень', () => {
    const r = run('full', 400, (i) => (i % 2 === 0 ? 800 : 16.7));
    expect(r.tier).toBe('full');
  });

  it('прогрев после смены не в счёт', () => {
    const s = new Steady('full');
    for (let i = 0; i < WARM_FRAMES; i++) expect(s.feed(120)).toBeNull();
    expect(s.tier).toBe('full');
  });

  it('ниже пола опускаться некуда', () => {
    expect(lower('full')).toBe('lite');
    expect(lower('lite')).toBe('base');
    expect(lower('base')).toBeNull();
  });
});

describe('солнце сквозь толщу воздуха', () => {
  it('толща растёт к горизонту и в зените — одна', () => {
    expect(airMass(90 * DEG)).toBeCloseTo(1, 2);
    for (let e = 5; e < 90; e += 5) expect(airMass(e * DEG)).toBeGreaterThan(airMass((e + 5) * DEG));
  });

  it('в полдень свет тот, под который подобрана палитра; ниже — тусклее и теплее', () => {
    const noon = 44 * DEG;
    const t: [number, number, number] = [0, 0, 0];
    sunTransmit(noon, noon, t);
    for (const c of t) expect(c).toBeCloseTo(1, 6);
    sunTransmit(15 * DEG, noon, t);
    for (const c of t) expect(c).toBeLessThan(1);
    // Синее гаснет сильнее красного: низкое солнце тёплое.
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
  });
});

describe('воздух поляны в тени стены леса', () => {
  it('низкое солнце светит в просветы, над кромкой — во весь воздух, и доля не убывает с высотой', () => {
    expect(airLit(0)).toBeCloseTo(AIR_GAP, 9);
    expect(airLit(AIR_FROM)).toBeCloseTo(AIR_GAP, 9);
    expect(airLit(AIR_TO)).toBeCloseTo(1, 9);
    expect(airLit(80 * DEG)).toBeCloseTo(1, 9);
    let prev = 0;
    for (let e = -5; e <= 90; e += 1) {
      const k = airLit(e * DEG);
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k).toBeGreaterThanOrEqual(AIR_GAP);
      expect(k).toBeLessThanOrEqual(1);
      prev = k;
    }
  });
});

describe('экспозиция', () => {
  it('в полдень затвор — единица, в темноте открывается, но не выше потолка', () => {
    expect(exposure(2, 2)).toBe(1);
    expect(exposure(4, 2)).toBe(1);
    let prev = 1;
    for (let light = 2; light > 0.001; light /= 2) {
      const e = exposure(light, 2);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    // Вдвое темнее — открыть не вдвое: ночь обязана остаться ночью.
    expect(exposure(1, 2)).toBeLessThan(2);
  });
});

describe('дымка у земли по часу', () => {
  const m: Mist = { density: 0, height: 0 };
  const at = (solar: number, gloom = 0): Mist => ({ ...mistAt(solar, gloom, m) });

  it('утро туманнее полудня, сумерки — между ними', () => {
    const dawn = at(0.03);
    const noon = at(0.25);
    const dusk = at(0.5);
    expect(dawn.density).toBeGreaterThan(dusk.density);
    expect(dusk.density).toBeGreaterThan(noon.density);
    // Утром дымка ниже: лежит у земли, а не стоит стеной до крон.
    expect(dawn.height).toBeLessThan(noon.height);
  });

  it('круг замкнут: на стыке суток дымка не прыгает', () => {
    expect(at(0.9999).density).toBeCloseTo(at(0).density, 3);
    expect(at(1).density).toBeCloseTo(at(0).density, 9);
  });

  it('в ненастье видно хуже в любой час', () => {
    for (const s of [0.03, 0.25, 0.5, 0.75]) expect(at(s, 1).density).toBeGreaterThan(at(s, 0).density);
  });
});

describe('огонь по закону обратных квадратов', () => {
  /** Спад точечного света three: обратная степень расстояния и окно у дальности. */
  const fall = (d: number, decay: number, range: number): number =>
    Math.pow(d, -decay) * (range > 0 ? Math.pow(Math.max(0, 1 - Math.pow(d / range, 4)), 2) : 1);

  it('у лица женщины у очага свет тот же, что давал прежний спад', () => {
    const gain = fireGain(1.25, 18);
    expect(gain * fall(FIRE_ANCHOR, FIRE_DECAY, 0)).toBeCloseTo(fall(FIRE_ANCHOR, 1.25, 18), 9);
  });

  it('ближе огня — ярче прежнего, дальше — темнее: так и светит костёр', () => {
    const gain = fireGain(1.25, 18);
    expect(gain * fall(1.5, FIRE_DECAY, 0)).toBeGreaterThan(fall(1.5, 1.25, 18));
    expect(gain * fall(7.5, FIRE_DECAY, 0)).toBeLessThan(fall(7.5, 1.25, 18));
  });
});
