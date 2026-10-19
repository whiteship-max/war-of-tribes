// Звук живого города (docs/city_v3.md, ЖГ-1): распорядок и состояние города — теми же функциями, что у вида.
import { describe, expect, it } from 'vitest';
import { AMB_MIX, BELL_HOURS, LAYERS, bellBetween, mixOf, type Hearing } from './ambience';
import { CALM_MOOD, forcedMood } from '@/render/city/rhythm';

/** Город вблизи улиц, лето, ясно; фаза солнца и состояние — свои у каждого случая. */
const city = (solar: number, life = CALM_MOOD): Hearing => ({ view: 'city', solar, season: 'summer', near: 0.8, sea: 0, life });
const MORNING = 0.1;
const EVENING = 0.52;
const NIGHT = 0.8;

describe('звук живого города', () => {
  it('рынок шумит до полудня, вечером — трактир, ночью — оклик дозора', () => {
    // Граница области — вид «город» и фаза солнца 0..1.
    for (const s of [MORNING, EVENING, NIGHT]) expect(s >= 0 && s < 1).toBe(true);
    const m = mixOf(city(MORNING));
    const e = mixOf(city(EVENING));
    const n = mixOf(city(NIGHT));
    expect(m.market).toBeGreaterThan(0.5);
    expect(mixOf(city(0.36)).market, 'после полудня рынок стихает').toBeLessThan(m.market * 0.4);
    expect(e.market + n.market, 'вечером и ночью рынка нет').toBe(0);
    expect(e.tavern, 'вечер — трактир').toBeGreaterThan(0.5);
    expect(m.tavern, 'утром трактир молчит').toBe(0);
    expect(n.watch, 'ночью — дозор').toBeGreaterThan(0.5);
    expect(m.watch + e.watch, 'днём дозора не слышно').toBe(0);
    // На карте и на поляне жизни города не слышно.
    for (const view of ['map', 'glade'] as const) {
      const x = mixOf({ ...city(EVENING, forcedMood('?mood=siege')!), view });
      expect(x.tavern + x.watch + x.tocsin + x.feast, view).toBe(0);
    }
  });

  it('тревога — колокол тревоги и пустые улицы; праздник — бубен и дудка; голод и мор — рынок тише', () => {
    const calm = mixOf(city(MORNING));
    const alarm = mixOf(city(MORNING, forcedMood('?mood=siege')!));
    expect(alarm.tocsin).toBe(1);
    expect(calm.tocsin).toBe(0);
    expect(alarm.market + alarm.forge + alarm.tavern, 'улицы молчат').toBe(0);
    const feast = mixOf(city(EVENING, forcedMood('?mood=feast')!));
    expect(feast.feast).toBeGreaterThan(0.5);
    expect(mixOf(city(EVENING)).feast).toBe(0);
    expect(mixOf(city(MORNING, forcedMood('?mood=hunger')!)).market).toBeLessThan(calm.market * 0.5);
    expect(mixOf(city(MORNING, forcedMood('?mood=plague')!)).market).toBeLessThan(calm.market * 0.7);
    expect(mixOf(city(MORNING, forcedMood('?mood=gloom')!)).market).toBeLessThan(calm.market * 0.6);
  });

  it('у каждого слоя — уровень сведения; колокол бьёт и повечерие', () => {
    for (const l of LAYERS) expect(AMB_MIX[l], l).toBeGreaterThan(0);
    // Новые слои — не громче колокола (сведение П-3: события — у колокола и рога).
    for (const l of ['tavern', 'watch', 'tocsin', 'feast'] as const) expect(AMB_MIX[l], l).toBeLessThanOrEqual(AMB_MIX.bells);
    const compline = BELL_HOURS.find(([at]) => at > 0.5 && at < 0.56);
    expect(compline).toBeDefined();
    expect(bellBetween(0.53, 0.55)).toBe(compline![1]);
  });
});
