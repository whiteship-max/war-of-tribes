import { describe, expect, it } from 'vitest';
import type { Season } from '@/game/types';
import { realMs } from '@/game/pace';
import { BLEND, SNOW_HOLD_DAYS, easeWeather, SNOW_MELT_DAYS, SPELL_DAYS, WEATHER_LOOKS, flashAt, flashGlow, flashes, lyingSnow, snowCover, weatherAt, weatherWords, windTo, zoneOf, type Weather } from './weather';

/** Миг середины полосы `i` в мс общих часов — внутри полосы, вдали от перехода. */
const mid = (i: number): number => realMs((i + 0.4) * SPELL_DAYS * 60);
/** Начало полос выборки: далеко от нуля, как настоящие часы сервера. */
const I0 = 4_000_000;
const N = 3000;

const share = (region: string, season: Season, pick: (w: Weather) => boolean): number => {
  let n = 0;
  for (let i = 0; i < N; i++) if (pick(weatherAt(region, mid(I0 + i), season, 0.25))) n++;
  return n / N;
};

describe('погода — функция региона и общих часов', () => {
  it('один регион в один миг — одна погода; другой регион — своя', () => {
    // Два игрока Сицилии в один миг: сезон у партий может быть общий, фаза суток — разная; небо одно.
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const ms = mid(I0 + i);
      const a = weatherAt('italy', ms, 'winter', 0.3);
      const b = weatherAt('italy', ms, 'winter', 0.6);
      expect({ ...a, fog: 0 }).toEqual({ ...b, fog: 0 });
      const c = weatherAt('britain', ms, 'winter', 0.3);
      if (Math.abs(c.cloud - a.cloud) > 0.05 || Math.abs(c.from - a.from) > 5) differ++;
    }
    expect(differ).toBeGreaterThan(150);
  });

  it('Сицилия: сухое лето, дожди зимой, снег редок; север — снег зимой', () => {
    expect(zoneOf('italy')).toBe('med');
    const summer = share('italy', 'summer', (w) => w.rain > 0.15);
    const winter = share('italy', 'winter', (w) => w.rain > 0.15);
    const snowSicily = share('italy', 'winter', (w) => w.snow > 0.15);
    expect(snowSicily, 'снег на Сицилии').toBeLessThan(0.05);
    expect(summer, 'дождь летом').toBeLessThan(0.08);
    expect(winter, 'дождь зимой').toBeGreaterThan(0.24);
    const snowNorth = share('norway', 'winter', (w) => w.snow > 0.15);
    const rainNorth = share('norway', 'winter', (w) => w.rain > 0.15);
    expect(snowNorth).toBeGreaterThan(0.3);
    expect(rainNorth).toBeLessThan(0.06);
    // Летом снега нет нигде.
    expect(share('norway', 'summer', (w) => w.snow > 0)).toBe(0);
  });

  it('гроза — только в дождь, летом в Средиземье чаще, зимой на севере нет', () => {
    for (let i = 0; i < N; i++) {
      const w = weatherAt('italy', mid(I0 + i), 'summer', 0.25);
      if (w.storm > 0) expect(w.rain).toBeGreaterThanOrEqual(w.storm - 1e-9);
    }
    expect(share('norway', 'winter', (w) => w.storm > 0)).toBe(0);
    expect(share('italy', 'autumn', (w) => w.storm > 0.25)).toBeGreaterThan(0.02);
  });

  it('туман — только утром партии', () => {
    let seen = 0;
    for (let i = 0; i < N; i++) {
      const ms = mid(I0 + i);
      expect(weatherAt('britain', ms, 'autumn', 0.3).fog).toBe(0);
      expect(weatherAt('britain', ms, 'autumn', 0.6).fog).toBe(0);
      if (weatherAt('britain', ms, 'autumn', 0.02).fog > 0.3) seen++;
    }
    expect(seen / N).toBeGreaterThan(0.2);
  });

  it('без скачков: за секунду погода сдвигается едва, и переход между полосами — внутри выборки', () => {
    // Граница области: переход — последняя доля `BLEND` полосы; выборка идёт секундами сквозь двадцать переходов.
    const spellMs = realMs(SPELL_DAYS * 60);
    let inBlend = 0;
    let moved = 0;
    for (let i = 0; i < 20; i++) {
      const start = realMs((I0 + i) * SPELL_DAYS * 60) + spellMs * (1 - BLEND) - 5000;
      let prev = weatherAt('britain', start, 'autumn', 0.25);
      for (let s = 1; s < spellMs * BLEND / 1000 + 10; s++) {
        const ms = start + s * 1000;
        const f = (ms / spellMs) % 1;
        if (f > 1 - BLEND) inBlend++;
        const w = weatherAt('britain', ms, 'autumn', 0.25);
        for (const k of ['cloud', 'rain', 'snow', 'storm', 'wind'] as const) {
          const d = Math.abs(w[k] - prev[k]);
          expect(d, `${k} за секунду`).toBeLessThan(0.012);
          if (d > 0.001) moved++;
        }
        const da = Math.abs(((w.from - prev.from + 540) % 360) - 180);
        expect(da, 'ветер за секунду').toBeLessThan(1.2);
        prev = w;
      }
    }
    expect(inBlend).toBeGreaterThan(20 * 150);
    expect(moved).toBeGreaterThan(100);
  });

  it('молния мягкая: свет за кадр меняется не больше чем на 0.12, и вспышки — только в грозу', () => {
    for (let k = 0; k < 400; k++) {
      const dt = k / 120;
      expect(Math.abs(flashGlow(dt + 1 / 60) - flashGlow(dt))).toBeLessThan(0.12);
    }
    expect(Math.max(...Array.from({ length: 300 }, (_, k) => flashGlow(k / 100)))).toBeGreaterThan(0.5);
    // Сутки общих часов: каждая вспышка — в грозу, и грозовые полосы вспышки дают.
    const from = mid(I0);
    const to = from + 24 * 3600 * 1000;
    const list = flashes('italy', 'autumn', from, to);
    for (const f of list) {
      expect(weatherAt('italy', f.at, 'autumn', 0.25).storm).toBeGreaterThan(0);
      expect(f.thunder - f.at).toBeGreaterThanOrEqual(1200);
    }
    expect(list.length).toBeGreaterThan(5);
    expect(flashes('egypt', 'summer', from, to).length).toBeLessThan(list.length);
    // Свет вспышки в её миг — от той же вспышки: у сильной — заметный, до неё — ничего.
    const f = list.reduce((a, b) => (b.power > a.power ? b : a));
    expect(f.power).toBeGreaterThan(0.5);
    expect(flashAt('italy', 'autumn', f.at + 150)).toBeGreaterThan(0.3);
    expect(flashAt('italy', 'autumn', f.at - 10)).toBeLessThan(flashAt('italy', 'autumn', f.at + 150));
  });

  it('снег на земле: на севере всю зиму, на Сицилии — только после редкого снегопада', () => {
    for (let i = 0; i < N; i += 7) expect(snowCover('norway', mid(I0 + i))).toBe(1);
    // Белый миг Сицилии — в пределах «снегопад + лежит + тает» после снегопада: ищем его назад шагом в десятую полосы.
    const back = realMs((SNOW_HOLD_DAYS + SNOW_MELT_DAYS + SPELL_DAYS) * 60);
    const tenth = realMs(SPELL_DAYS * 6);
    let white = 0;
    for (let i = 0; i < N; i++) {
      const ms = mid(I0 + i);
      if (snowCover('italy', ms) <= 0.5) continue;
      white++;
      let fell = false;
      for (let t = ms - back; t <= ms && !fell; t += tenth) fell = weatherAt('italy', t, 'winter', 0.25).snow > 0.15;
      expect(fell, 'бело без снегопада').toBe(true);
    }
    // Точка внутри области: белые миги есть, и их мало — снег на Сицилии редок.
    expect(white / N, 'доля белых мигов на Сицилии').toBeGreaterThan(0.005);
    expect(white / N, 'доля белых мигов на Сицилии').toBeLessThan(0.15);
    // Погода адресом: снегопад — бело сразу; ясно — как лежит в поясе.
    expect(lyingSnow('italy', 0, WEATHER_LOOKS.snow)).toBe(1);
    expect(lyingSnow('italy', 0, WEATHER_LOOKS.clear)).toBe(0);
    expect(lyingSnow('norway', 0, WEATHER_LOOKS.clear)).toBe(1);
  });

  it('снег ложится и тает без скачка: секундами сквозь снегопад Сицилии и его таяние', () => {
    // Граница области: от начала снежной полосы до конца таяния; точки — внутри (снег лёг и сошёл).
    let i = I0;
    while (weatherAt('italy', mid(i), 'winter', 0.25).snow < 0.3) i++;
    const start = realMs(i * SPELL_DAYS * 60);
    const span = realMs((SPELL_DAYS + SNOW_HOLD_DAYS + SNOW_MELT_DAYS) * 60) + 60_000;
    let prev = snowCover('italy', start);
    let top = 0;
    for (let ms = start + 1000; ms < start + span; ms += 1000) {
      const c = snowCover('italy', ms);
      expect(Math.abs(c - prev), 'снег за секунду').toBeLessThan(0.01);
      top = Math.max(top, c);
      prev = c;
    }
    expect(top).toBeGreaterThan(0.6);
    // Если следом не было нового снегопада — к концу сошёл.
    const later = Array.from({ length: 4 }, (_, k) => weatherAt('italy', mid(i + 1 + k), 'winter', 0.25).snow).every((x) => x < 0.15);
    if (later) expect(prev).toBeLessThan(0.05);
  });

  it('слова: небо и ветер, «с моря» — когда с той стороны море', () => {
    const w: Weather = { cloud: 0.9, rain: 0.6, snow: 0, storm: 0, fog: 0, wind: 0.5, from: 200 };
    expect(weatherWords(w, (from) => from > 135 && from < 225)).toBe('Дождь, ветер с моря');
    expect(weatherWords(w)).toBe('Дождь, ветер с юга');
    expect(weatherWords({ ...w, rain: 0, cloud: 0.1, wind: 0.1 })).toBe('Ясно, тихо');
    expect(weatherWords({ ...w, rain: 0, snow: 0.9, wind: 0.8 })).toBe('Метель, сильный ветер с юга');
    // Ветер с запада дует на восток.
    expect(windTo(270).x).toBeCloseTo(1);
    expect(windTo(0).z).toBeCloseTo(1);
  });
});

describe('перелив погоды кадра (П-3)', () => {
  it('доля 0 — прежняя погода, 1 — цель; посередине — середина, ветер — по короткой дуге через север', () => {
    const from: Weather = { cloud: 0, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.2, from: 350 };
    const to: Weather = { cloud: 1, rain: 0.8, snow: 0, storm: 0.4, fog: 0, wind: 0.6, from: 10 };
    expect(easeWeather(from, to, 0)).toEqual(from);
    expect(easeWeather(from, to, 1)).toEqual(to);
    const mid = easeWeather(from, to, 0.5);
    expect(mid.rain).toBeCloseTo(0.4, 9);
    expect(mid.cloud).toBeCloseTo(0.5, 9);
    expect(mid.wind).toBeCloseTo(0.4, 9);
    // С 350° на 10° — через север (0°), а не через юг (180°): поворот на двадцать градусов, а не на триста сорок.
    expect(Math.min(mid.from, 360 - mid.from)).toBeLessThan(1);
  });
});
