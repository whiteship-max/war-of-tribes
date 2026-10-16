import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { buildForecast } from './buildEta';
import { buildRate, currentSite, housingCapacity, moraleTarget, seasonOf } from './derived';
import { catchUp, CATCHUP_STEP } from './sim/tick';
import { SEASON_SECONDS } from './data/seasons';
import { gameSeconds } from './pace';
import type { GameState } from './types';

/**
 * Весть «достроили» (ВС-1, docs/NOTIFY.md, раздел 13) приходит по прогнозу партии: игрока нет, и стройку мир не
 * считает — её посчитает догон, когда игрок вернётся. Обещание одно: **весть не приходит раньше конца стройки**; позже
 * — не вдвое. Проверка — тем же шагом догона (`catchUp`), которым партия проживёт отлучку. Опоздание растёт со сроком:
 * прогноз не знает прироста, а у молодого города рук на стройке к концу больше.
 *
 * Область правила: стройка идёт, игрок ничего не делает, срок — внутри потолка вести (`NOTICE_LIMITS.ahead`, 12
 * настоящих часов). Набор (правило 17): старт в каждом из четырёх сезонов первого и второго года, срок от трети сезона
 * до трёх сезонов, с усилителем стройки и без — точки, где скорость меняется посреди стройки.
 */
const AHEAD_GAME_SEC = gameSeconds(12 * 3600);

function siteAt(start: number, seasons: number, boon: 'mercs' | 'timber' | null, seed: number, mature = false): GameState {
  const s = createInitialState(seed);
  s.time = start;
  if (mature) {
    // Зрелый город: жильё полно — прироста нет, амбары и дровяник полны — ни голода, ни холода, мораль на своей цели.
    s.pop = housingCapacity(s);
    for (const r of Object.keys(s.resources) as (keyof GameState['resources'])[]) s.resources[r] = 1e6;
    s.morale = moraleTarget(s);
  }
  // Усилитель кончается вскоре после начала стройки: его конец — смена скорости посреди стройки.
  if (boon) s.boons = [{ id: boon, until: start + SEASON_SECONDS / 10 }];
  const smithy = s.buildings.find((b) => b.type === 'smithy') ?? s.buildings[1];
  // Работа — на заданное число сезонов при нынешней скорости.
  smithy.work = 0;
  smithy.workRequired = 1;
  smithy.workRequired = Math.max(1, buildRate(s) * SEASON_SECONDS * seasons);
  return s;
}

/** Сколько игровых секунд до конца стройки догоном отлучки — шагом `CATCHUP_STEP`. */
function actual(s0: GameState): number {
  const s = structuredClone(s0);
  const site = currentSite(s);
  if (!site) throw new Error('стройки нет');
  const id = site.id;
  const level = site.level;
  let t = 0;
  while (t < AHEAD_GAME_SEC * 2) {
    catchUp(s, CATCHUP_STEP, CATCHUP_STEP);
    t += CATCHUP_STEP;
    if (s.buildings.find((b) => b.id === id)!.level > level) return t;
  }
  return Number.POSITIVE_INFINITY;
}

describe('прогноз стройки для вести «достроили»', () => {
  it('молодой город: весть не раньше конца стройки и не позже двойного срока — на всех сезонах, с усилителями и без', () => {
    let cases = 0;
    let crossed = 0;
    for (const year of [0, 1]) {
      for (let season = 0; season < 4; season++) {
        for (const seasons of [0.35, 1.2, 2.6]) {
          for (const boon of [null, 'mercs', 'timber'] as const) {
            const start = (year * 4 + season) * SEASON_SECONDS + SEASON_SECONDS * 0.4;
            const s = siteAt(start, seasons, boon, 1000 + cases);
            const f = buildForecast(s);
            expect(f, `${year}/${season}/${seasons}/${boon}`).not.toBeNull();
            const real = actual(s);
            // Точка внутри области: стройка кончается в пределах потолка вести.
            expect(real, 'внутри потолка вести').toBeLessThan(AHEAD_GAME_SEC);
            const label = `год ${year + 1}, ${seasonOf(start)}, ${seasons} сез., ${boon ?? 'без усилителя'}: прогноз ${f!.sec.toFixed(1)}, на деле ${real}`;
            expect(f!.sec, label).toBeGreaterThanOrEqual(real);
            // Позже — не вдвое: молодой город растёт, и рук на стройке к концу больше, чем в минуту прогноза.
            expect(f!.sec, label).toBeLessThanOrEqual(2 * real);
            if (seasonOf(start) !== seasonOf(start + real)) crossed++;
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(72);
    // Набор и правда проходит через смену сезона — иначе прогноз по отрезкам не спрашивался бы.
    expect(crossed).toBeGreaterThan(30);
  });

  /**
   * Зрелый город — прироста нет, и скорость стройки двигают только сезон и усилители: здесь прогноз по отрезкам и
   * решает, не придёт ли весть раньше. Стройка, начатая осенью и кончающаяся зимой, при прогнозе одной скоростью
   * пришла бы раньше конца.
   */
  it('зрелый город: смена сезона и конец усилителя посреди стройки — весть не раньше конца', () => {
    let cases = 0;
    for (const year of [0, 1]) {
      for (let season = 0; season < 4; season++) {
        for (const seasons of [0.35, 1.2, 2.6]) {
          for (const boon of [null, 'mercs', 'timber'] as const) {
            const start = (year * 4 + season) * SEASON_SECONDS + SEASON_SECONDS * 0.4;
            const s = siteAt(start, seasons, boon, 2000 + cases, true);
            const f = buildForecast(s);
            const real = actual(s);
            expect(real, 'внутри потолка вести').toBeLessThan(AHEAD_GAME_SEC);
            const label = `год ${year + 1}, ${seasonOf(start)}, ${seasons} сез., ${boon ?? 'без усилителя'}: прогноз ${f!.sec.toFixed(1)}, на деле ${real}`;
            expect(f!.sec, label).toBeGreaterThanOrEqual(real);
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(72);
  });

  it('стройки нет или некому строить — прогноза нет', () => {
    const s = createInitialState(7);
    expect(buildForecast(s)).toBeNull();
  });
});
