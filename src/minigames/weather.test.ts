/**
 * Погода промыслов (docs/polish.md, П-4): погода города на входе — в свет, тень и дымку сцены (`stage.gloomOf`,
 * `castsShadow`, `MIST_K`). Область: погоды адресом (`climate.WEATHER_LOOKS` — те, что снимает стенд), три ступени,
 * четыре часа промысла; дымка меряется на той дали, где охотник ещё стреляет (`hunt.FIELD_R`).
 */
import { describe, expect, it } from 'vitest';
import { WEATHER_LOOKS } from '@/render/climate';
import { mistAt, TIERS } from '@/prologue/look';
import { EYE } from '@/prologue/glade';
import { CALM, MIST_K, OVERCAST, castsShadow, gloomOf, snowOf, solarOf, wetOf } from './stage';
import { SHADOWS } from './tier';
import { FIELD_R } from './hunt';
import type { Hour } from './rules';
import { BerriesPlay } from './berriesPlay';
import { HerdPlay } from './herdPlay';
import { HuntPlay } from './huntPlay';
import { FishPlay } from './fishPlay';

const W = WEATHER_LOOKS;

describe('промыслы: погода города в сцене', () => {
  it('хмурость: ясно — ноль, дождь — до конца, снегопад — на ступень мягче, как у поляны', () => {
    expect(gloomOf(CALM)).toBe(0);
    expect(gloomOf(W.clear)).toBe(0);
    expect(gloomOf(W.rain)).toBe(1);
    expect(gloomOf(W.storm)).toBe(1);
    // Поляна в снег — 0.6 (`prologue/sky.gloom`); у снегопада погоды тучи гуще — не мягче поляны и не как ливень.
    expect(gloomOf(W.snow)).toBeGreaterThanOrEqual(0.6);
    expect(gloomOf(W.snow)).toBeLessThan(gloomOf(W.rain));
    expect(gloomOf(W.cloud)).toBeLessThan(OVERCAST);
    expect(gloomOf(W.overcast)).toBeGreaterThanOrEqual(OVERCAST);
  });

  it('тень солнца: у пола её нет вовсе, у остальных — нет под осадками и в сплошное ненастье', () => {
    for (const tier of TIERS) {
      for (const [name, w] of Object.entries(W)) {
        const falls = w.rain > 0.01 || w.snow > 0.01;
        const want = SHADOWS[tier] && !falls && gloomOf(w) < OVERCAST;
        expect(castsShadow(tier, w), `${tier}, ${name}`).toBe(want);
      }
    }
    // Точки внутри области: и тень, и её отсутствие на тенистой ступени встречаются.
    expect(castsShadow('lite', W.clear)).toBe(true);
    expect(castsShadow('lite', W.rain)).toBe(false);
    expect(castsShadow('full', W.snow)).toBe(false);
  });

  it('сырость: сухо — ноль, ливень — не мокрее берега рыбалки до П-4', () => {
    expect(wetOf(0)).toBe(0);
    expect(wetOf(W.rain.rain)).toBeCloseTo(0.48, 5);
    expect(wetOf(1)).toBe(0.5);
  });

  it('снег на ветках и земле — только зимой и тот, что лежит у города; снегопад прибавляет свежего', () => {
    for (const season of ['spring', 'summer', 'autumn'] as const) expect(snowOf(season, 1, 1), season).toBe(0);
    // Юг зимой без снегопада — голая земля (`climate.snowCover`: пояс без покрова), север — мера поляны.
    expect(snowOf('winter', 0, 0)).toBe(0);
    expect(snowOf('winter', 1, 0)).toBeCloseTo(0.6, 5);
    expect(snowOf('winter', 1, W.snow.snow)).toBeGreaterThan(snowOf('winter', 1, 0));
    expect(snowOf('winter', 1, 1)).toBeLessThanOrEqual(1);
  });

  it('дымка ненастья не прячет оленя: на дали выстрела видна больше трети в любой час', () => {
    // Путь взгляда вдоль земли — тот же счёт, что у конвейера (`post.ts`, `tau`): плотность × спад с высотой глаза × даль.
    const seen = (solar: number, gloom: number): number => {
      const m = mistAt(solar, gloom, { density: 0, height: 1 });
      return Math.exp(-m.density * Math.exp(-EYE / m.height) * FIELD_R);
    };
    const hours: Hour[] = ['dawn', 'day', 'dusk', 'night'];
    // Утро — свой час у каждой игры (`Play.solar`).
    const mornings = [
      new BerriesPlay(1).solar,
      new HerdPlay(1).solar,
      new HuntPlay(1).solar,
      new FishPlay(1, { shore: 'river', zone: 'land', season: 'summer', rain: 0 }).solar,
    ];
    for (const h of hours) {
      for (const morning of mornings) {
        const solar = solarOf(h, morning);
        const worst = MIST_K * Math.max(gloomOf(W.storm), W.fog.fog);
        expect(worst, 'точка внутри области: ненастье полное').toBeCloseTo(MIST_K, 5);
        expect(seen(solar, worst), `${h}, утро ${morning}`).toBeGreaterThan(1 / 3);
        // И дождь всё же виден: дымка гуще ясной.
        expect(seen(solar, worst)).toBeLessThan(seen(solar, 0));
      }
    }
  });
});
