/**
 * Сутки и погода.
 *
 * Проверяется здесь не арифметика — она на двадцать строк, — а **три обещания**,
 * и все три такого рода, что поведением их не поймать:
 *
 *   1. **круг суток укладывается в заход.** Игрок обязан застать и день, и
 *      ночь за три минуты, из каких бы минут ни начал. Это выведено из числа,
 *      а не подобрано, и потому проверяется прогоном по всем фазам;
 *   2. **всё считается на чтении и закрытой формулой.** Ни тика, ни таймера, ни
 *      догона; интегралы добавочны и обратимы, и ответ не зависит от того,
 *      сколько раз спросили и с какого места считали;
 *   3. **случайности нет ни одной.** Погода — данные, а не бросок; кольцо
 *      замыкается на целом числе кругов суток, иначе закрытой формы не было бы.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BURN_MEAN,
  CHILL_MEAN,
  DAY_SHARE,
  NIGHT_CHILL,
  OMEN_MS,
  RAIN_BURN,
  RING,
  RING_MS,
  RING_SPANS,
  SKY_MS,
  SNOW_CHILL,
  SPELL_MS,
  WEATHER_RING,
  burnUntil,
  burnedMs,
  chillUntil,
  chilledMs,
  darkness,
  gloom,
  isNight,
  nextWeather,
  skyPhase,
  spellLeftMs,
  sunAt,
  weatherAt,
  weatherWords,
} from './sky';

const MIN = 60_000;

describe('круг суток укладывается в заход', () => {
  it('и день, и ночь застаёт любой трёхминутный заход', () => {
    /*
     * ЭТО ГЛАВНОЕ ЧИСЛО ЧАСТИ, И ОНО ВЫВЕДЕНО, А НЕ ПОДОБРАНО.
     *
     * Пусть заход `S`, круг `C`, доля дня `d`. Самая длинная половина круга —
     * день, `d·C`; заход, который не короче её, обязан задеть и вторую половину,
     * с какой бы минуты ни начался. При `S` = 3 мин и `d` = 0.62 отсюда
     * `C ≤ 4 мин 50 с` — взято четыре.
     *
     * Проверяется прогоном, а не рассуждением: рассуждение можно испортить,
     * поправив `DAY_SHARE` и забыв про `SKY_MS`.
     */
    expect(DAY_SHARE * SKY_MS).toBeLessThan(3 * MIN);
    for (let t0 = 0; t0 < SKY_MS; t0 += 1000) {
      let day = false;
      let night = false;
      for (let t = t0; t <= t0 + 3 * MIN; t += 1000) {
        if (isNight(t)) night = true;
        else day = true;
      }
      expect(day && night, `с ${t0 / 1000} с`).toBe(true);
    }
  });

  it('день длиннее ночи, и оба заметно длиннее одного дела', () => {
    // Ночь — время, когда спит зверь и ходят волки, то есть когда игрок мало
    // что может. Ночь вполкруга превратила бы половину захода в ожидание.
    const day = DAY_SHARE * SKY_MS;
    const night = SKY_MS - day;
    expect(day).toBeGreaterThan(night);
    // Заход за дровами целиком — около шести секунд. И день, и ночь должны быть
    // на порядок длиннее: иначе небо мигает, а не сменяется.
    expect(night).toBeGreaterThan(60_000);
  });

  it('час поляны идёт по кругу: рассвет, полдень, закат, ночь', () => {
    expect(sunAt(0)).toBeCloseTo(0, 9);
    expect(sunAt(DAY_SHARE * SKY_MS * 0.5)).toBeCloseTo(0.25, 9);
    expect(sunAt(DAY_SHARE * SKY_MS)).toBeCloseTo(0.5, 9);
    expect(sunAt(SKY_MS - 1)).toBeGreaterThan(0.99);
    // Ночью темно, днём нет — своё число, по которому сцена поднимает костёр.
    expect(darkness(DAY_SHARE * SKY_MS * 0.5)).toBe(0);
    expect(darkness(DAY_SHARE * SKY_MS + (SKY_MS - DAY_SHARE * SKY_MS) / 2)).toBeCloseTo(1, 6);
  });

  it('фаза не ломается ни на отрицательном времени, ни на границе', () => {
    // Отрицательное «сейчас» бывает только в тестах, но выдать на нём NaN
    // означало бы уронить сцену на первом же кадре у того, у кого сбились часы.
    expect(skyPhase(-1)).toBeGreaterThan(0.99);
    expect(skyPhase(-SKY_MS)).toBeCloseTo(0, 9);
    expect(skyPhase(SKY_MS)).toBeCloseTo(0, 9);
    expect(weatherAt(-SPELL_MS)).toBe(RING[WEATHER_RING - 1]);
  });
});

describe('погода — данные, а не бросок', () => {
  it('кольцо замыкается на целом числе кругов суток', () => {
    // На этом стоит вся закрытая форма: общий период «сутки плюс погода» равен
    // кольцу, а не удвоенному кольцу и не их наименьшему общему кратному.
    expect(RING.length).toBe(WEATHER_RING);
    expect(RING_MS % SKY_MS).toBe(0);
    expect(SKY_MS % SPELL_MS).toBe(0);
    // И отрезков в кольце ровно столько, сколько границ двух родов: спеллы плюс
    // переходы дня в ночь.
    expect(RING_SPANS).toBe(WEATHER_RING + RING_MS / SKY_MS);
  });

  it('в кольце есть все три погоды, и ясная — большинство', () => {
    // Кольцо без дождя — это мир без дождя, и заметил бы это только тот, кто
    // сел считать. Ясная погода при этом обязана быть фоном, а не событием.
    const share = (kind: string): number => RING.filter((w) => w === kind).length / WEATHER_RING;
    expect(share('clear')).toBeGreaterThan(0.5);
    expect(share('rain')).toBeGreaterThan(0.1);
    expect(share('snow')).toBeGreaterThan(0.1);
  });

  it('непогода падает и на день, и на ночь', () => {
    // Непогода, живущая только ночью, читалась бы частью ночи, а не погодой.
    const wet = (night: boolean): boolean => {
      for (let t = 0; t < RING_MS; t += 1000) {
        if (isNight(t) === night && weatherAt(t) !== 'clear') return true;
      }
      return false;
    };
    expect(wet(false)).toBe(true);
    expect(wet(true)).toBe(true);
  });

  it('погода повторяется ровно кольцом и не зависит ни от чего другого', () => {
    for (let t = 0; t < RING_MS; t += 7777) {
      expect(weatherAt(t + RING_MS)).toBe(weatherAt(t));
      expect(weatherAt(t + RING_MS * 5)).toBe(weatherAt(t));
    }
  });

  it('небо хмурится заранее, а не задним числом', () => {
    /*
     * «Игрок должен видеть, что портится, а не узнавать постфактум» — это
     * требование, и держится оно вот этим числом: за `OMEN_MS` до первой капли
     * `gloom` уже растёт. Двадцать пять секунд — то, за что человек успевает
     * сходить за дровами и вернуться.
     */
    let found = 0;
    for (let i = 0; i < WEATHER_RING; i++) {
      const start = i * SPELL_MS;
      if (weatherAt(start) !== 'clear' || nextWeather(start) === 'clear') continue;
      found++;
      // За полспелла до непогоды ещё ясно, за десять секунд — уже нет.
      expect(gloom(start), `спелл ${i}`).toBe(0);
      expect(gloom(start + SPELL_MS - OMEN_MS - 1000), `спелл ${i}`).toBe(0);
      // И растёт, а не встаёт ступенькой: чем ближе, тем темнее. Порога числом
      // тут быть не должно — у снега хмурость своя, ниже дождевой.
      const half = gloom(start + SPELL_MS - OMEN_MS / 2);
      const edge = gloom(start + SPELL_MS - 1000);
      expect(half, `спелл ${i}`).toBeGreaterThan(0);
      expect(edge, `спелл ${i}`).toBeGreaterThan(half);
      expect(weatherWords(start + SPELL_MS - 10_000)).toBe('хмурится');
    }
    expect(found).toBeGreaterThan(0);
    // А в саму непогоду хмурость полная, и слово о ней своё.
    for (let i = 0; i < WEATHER_RING; i++) {
      const mid = i * SPELL_MS + SPELL_MS / 2;
      if (weatherAt(mid) === 'rain') {
        expect(gloom(mid)).toBe(1);
        expect(weatherWords(mid)).toBe('дождь');
      }
      if (weatherAt(mid) === 'snow') {
        expect(gloom(mid)).toBeGreaterThan(0);
        expect(weatherWords(mid)).toBe('снег');
      }
    }
  });

  it('сколько погоде осталось — считается, а не помнится', () => {
    expect(spellLeftMs(0)).toBe(SPELL_MS);
    expect(spellLeftMs(SPELL_MS - 1)).toBe(1);
    expect(weatherAt(SPELL_MS + spellLeftMs(SPELL_MS) + 1)).toBe(nextWeather(SPELL_MS));
  });
});

describe('интегралы: закрытая форма, добавочность, обратимость', () => {
  it('ставки те, что объявлены: дождь втрое жжёт, ночь и снег студят', () => {
    const rate = (from: number, ms: number, f: (a: number, b: number) => number): number =>
      f(from, from + ms) / ms;
    // Ясный день: обе ставки — единица. Отрезок заведомо ясный и заведомо дневной.
    expect(rate(0, 60_000, burnedMs)).toBeCloseTo(1, 9);
    expect(rate(0, 60_000, chilledMs)).toBeCloseTo(1, 9);
    // Ясная ночь: горение то же, холод — ночной множитель.
    const night = DAY_SHARE * SKY_MS + 1000;
    expect(rate(night, 60_000, burnedMs)).toBeCloseTo(1, 9);
    expect(rate(night, 60_000, chilledMs)).toBeCloseTo(NIGHT_CHILL, 9);
    // Дождливый день: горение втрое, холод обычный.
    const rain = RING.indexOf('rain') * SPELL_MS + 1000;
    expect(rate(rain, 60_000, burnedMs)).toBeCloseTo(RAIN_BURN, 9);
    // Снежный день: горение обычное, холод — снежный множитель.
    const snow = RING.lastIndexOf('snow') * SPELL_MS + 1000;
    expect(isNight(snow)).toBe(false);
    expect(rate(snow, 60_000, burnedMs)).toBeCloseTo(1, 9);
    expect(rate(snow, 60_000, chilledMs)).toBeCloseTo(SNOW_CHILL, 9);
  });

  it('промежуток по частям равен промежутку целиком', () => {
    // ЭТО И ЕСТЬ ОТЛИЧИЕ ЧТЕНИЯ ОТ ТИКА, и на нём стоит всё: отрезок очага и
    // отрезок холода закрываются в любую минуту, потому что от разбиения ответ
    // не меняется. Куски берутся и мелкие, и в несколько кольц.
    const a = 12_345;
    const c = 40 * 3_600_000;
    for (const b of [12_346, 240_000, RING_MS, RING_MS * 7 + 13, c - 1]) {
      expect(burnedMs(a, c)).toBeCloseTo(burnedMs(a, b) + burnedMs(b, c), 5);
      expect(chilledMs(a, c)).toBeCloseTo(chilledMs(a, b) + chilledMs(b, c), 5);
    }
    // И по мелкой сетке тоже: тысяча кусков дают то же, что один.
    let sum = 0;
    const step = (c - a) / 1000;
    for (let i = 0; i < 1000; i++) sum += chilledMs(a + i * step, a + (i + 1) * step);
    expect(sum).toBeCloseTo(chilledMs(a, c), 4);
  });

  it('назад время не идёт: промежуток из будущего в прошлое — ноль', () => {
    // Часы устройства переводят руками, и запись из будущего не должна выдавать
    // очагу дров, которых в нём не было.
    expect(burnedMs(10 * 3_600_000, 0)).toBe(0);
    expect(chilledMs(10 * 3_600_000, 0)).toBe(0);
  });

  it('обратная задача сходится с прямой', () => {
    // Полосы обещают срок, а срок — это ответ обратной задачи. Разойдись они —
    // и полоса называла бы одно, а случалось бы другое.
    for (let from = 0; from < RING_MS; from += 61_000) {
      for (const need of [1000, 60_000, 3_600_000, 20 * 3_600_000]) {
        expect(burnedMs(from, burnUntil(from, need)), `${from}/${need}`).toBeCloseTo(need, 3);
        expect(chilledMs(from, chillUntil(from, need)), `${from}/${need}`).toBeCloseTo(need, 3);
      }
    }
    // Ноль — это «уже», а не «никогда».
    expect(burnUntil(1234, 0)).toBe(1234);
    expect(chillUntil(1234, -5)).toBe(1234);
  });

  it('ответ не зависит от того, сколько раз спросили', () => {
    const once = chilledMs(0, 10 * 3_600_000);
    for (let i = 0; i < 500; i++) chilledMs(0, i * 60_000);
    expect(chilledMs(0, 10 * 3_600_000)).toBe(once);
  });

  it('средние ставки лежат между единицей и худшим случаем', () => {
    // По ним считаются сроки «в среднем», и они же печатаются отчётом. Уехали
    // за борта — значит кольцо перестало быть кольцом погоды и стало кольцом
    // одной погоды.
    expect(BURN_MEAN).toBeGreaterThan(1);
    expect(BURN_MEAN).toBeLessThan(RAIN_BURN);
    expect(CHILL_MEAN).toBeGreaterThan(1);
    expect(CHILL_MEAN).toBeLessThan(NIGHT_CHILL * SNOW_CHILL);
    // И считаются они из самого кольца, а не написаны рядом с ним.
    expect(BURN_MEAN).toBeCloseTo(burnedMs(0, RING_MS) / RING_MS, 12);
    expect(CHILL_MEAN).toBeCloseTo(chilledMs(0, RING_MS) / RING_MS, 12);
  });
});

// ---------- Обещания, которые проверяются только чтением исходников ----------

describe('ни сутки, ни погода не движутся от кадрового времени', () => {
  const src = readFileSync(join(__dirname, 'sky.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('ни тика, ни таймера, ни кадра, ни часов, ни броска', () => {
    // Круг суток — самое соблазнительное место для тика во всём режиме: «пусть
    // солнце едет по кадрам» выглядит естественно и ломает всё. Поэтому список
    // тот же, что у костра, и с двумя добавками: кадр и случайность.
    for (const word of [
      'setInterval',
      'setTimeout',
      'requestAnimationFrame',
      'performance.now',
      'Date',
      'catchUp',
      'Math.random',
    ]) {
      expect(src, `сутки начали тикать: ${word}`).not.toContain(word);
    }
  });

  it('состояния у неба нет: ни одной переменной, которую можно двигать', () => {
    // Кольцо и таблица отрезков считаются один раз и только читаются. Появись
    // здесь `let`, который правят снаружи, — и «чистая функция от времени»
    // стала бы пожеланием.
    expect(src).not.toMatch(/\bexport\s+let\b/);
    expect(src).not.toMatch(/\bexport\s+function\s+set/);
  });
});
