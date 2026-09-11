/**
 * Сытость, тепло, здоровье и смерть.
 *
 * Проверяется здесь то же, что у костра, и тем же способом: не арифметика, а
 * **обещание**. Обещаний пять:
 *
 *   1. полосы считаются на чтении, а не копятся: промежуток, посчитанный по
 *      частям, равен посчитанному целиком — на этом стоит право закрывать отрезок
 *      в любую минуту, а на нём вся запись на диск;
 *   2. числа ровно те, что сказаны: тепло за сутки, потом здоровье за полсуток;
 *      сытость за двое, потом здоровье за полсуток; шесть укусов; кусок мяса —
 *      укус обратно; заживление за двое суток покоя;
 *   3. полоса называет срок, который и случится;
 *   4. смерть не наступает раньше, чем игрок мог что-то сделать;
 *   5. ни одна величина не движется от кадрового времени — чтением исходников.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARRIVAL_COLD,
  COAT_CHILL,
  COLD_MS,
  HEALTH_MS,
  HEAL_MS,
  MEAT_FED_H,
  MEAT_HEAL,
  RAW_SHARE,
  STARVE_MS,
  WARM_MS,
  WOLF_BITES,
  anchor,
  bite,
  camp,
  causeOfDeath,
  coldAt,
  coldEmptyAt,
  deadAt,
  draining,
  eat,
  fedWords,
  fireOutAt,
  harmAt,
  healing,
  healthFill,
  healthWords,
  hungerAt,
  hungerEmptyAt,
  lifeLeftMs,
  newBody,
  setWarm,
  warming,
  warmthFill,
  warmthWords,
  type Body,
} from './body';
import { HEARTH_CAP, LOG_MS, spanWords, type Hearth } from './fire';
import { freshPrologue, loadPrologue, revive } from './save';
import { CHILL_MEAN, NIGHT_CHILL, RING_MS, SNOW_CHILL } from './sky';

/*
 * ЧИСТЫЕ ОТРЕЗКИ КОЛЬЦА — ТО, ЧЕМ ЗДЕСЬ МЕРЯЮТ ПОГОДУ.
 *
 * Ставка холода — ступенчатая функция от времени, поэтому хвататься надо за
 * отрезки, у которых погода и небо заведомо одни, и брать их из самого кольца.
 * Все четыре проверены отдельным тестом (`sky.test.ts`).
 *
 * Числа — миллисекунды от начала кольца. Круг суток 240 с, день до 148.8 с, спелл
 * 120 с; спеллы 0 и 1 погожие, 2 дождливый, 10 снежный.
 */
const CLEAR_DAY = { at: 0, until: 91_200 };
const CLEAR_NIGHT = { at: 148_800, until: 240_000 };
const SNOW_DAY = { at: 1_200_000, until: 1_291_200 };
const RAIN_DAY = { at: 240_000, until: 331_200 };

const H = 3_600_000;
const MIN = 60_000;
const OUT: Hearth = { fuel: 0, at: 0 };
const FULL: Hearth = { fuel: HEARTH_CAP, at: 0 };

/** Человек у огня (или на стоянке) — и то, что сверху скажет тест. */
const man = (at: number, over: Partial<Body> = {}): Body => ({ ...newBody(at), ...over });
/** Человек вдали от огня. */
const away = (at: number, over: Partial<Body> = {}): Body => man(at, { warm: false, ...over });

describe('числа названы и равны сказанному', () => {
  it('тепло — сутки, здоровье — полсуток, заживление — двое суток, отогрев — двадцать минут', () => {
    expect(COLD_MS).toBe(24 * H);
    expect(HEALTH_MS).toBe(12 * H);
    expect(HEAL_MS).toBe(48 * H);
    expect(WARM_MS).toBe(20 * MIN);
    expect(WOLF_BITES).toBe(6);
    expect(COAT_CHILL).toBe(0.6);
  });

  it('сытость — двое суток, как полный очаг', () => {
    // Числа сведены нарочно: игрок запоминает один срок, а не два.
    expect(STARVE_MS).toBe(48 * H);
    expect(STARVE_MS).toBe(HEARTH_CAP * LOG_MS);
  });
});

describe('сытость: двое суток, потом полсуток здоровья', () => {
  it('живот пустеет прямой', () => {
    const b = newBody(0);
    expect(hungerAt(b, 0)).toBe(0);
    expect(hungerAt(b, 24 * H)).toBeCloseTo(0.5, 9);
    expect(hungerAt(b, 48 * H)).toBe(1);
    expect(hungerEmptyAt(b)).toBe(48 * H);
  });

  it('пустой живот ещё не смерть: ровно двенадцать часов здоровья сверху', () => {
    // Дом, одежда и полный бережёный очаг: тепла хватает с запасом, и умереть
    // этот человек может только от голода.
    const b = man(0, { roof: true, coat: true });
    const h: Hearth = { fuel: HEARTH_CAP, at: 0, kept: true };
    expect(causeOfDeath(b, h, 48 * H)).toBe(null);
    expect(draining(b, h, 48 * H + MIN)).toBe(true);
    expect(deadAt(b, h)).toBeCloseTo(60 * H, 3);
    expect(causeOfDeath(b, h, 60 * H + MIN)).toBe('hunger');
  });

  it('ответ не зависит от того, сколько раз спросили', () => {
    const b = newBody(0);
    const once = hungerAt(b, 10 * H);
    for (let i = 0; i < 200; i++) hungerAt(b, i * H);
    expect(hungerAt(b, 10 * H)).toBe(once);
    expect(b).toEqual({ hunger: 0, cold: 0, harm: 0, coat: false, at: 0, warm: true, roof: false });
  });

  it('часы, переведённые назад, сытости не прибавляют', () => {
    const b = man(10 * H, { hunger: 0.5 });
    expect(hungerAt(b, 0)).toBe(0.5);
    expect(anchor(b, FULL, 0).at).toBe(10 * H);
  });

  it('полоса сытости называет срок до пустого живота теми же словами, что костёр', () => {
    const b = newBody(0);
    expect(fedWords(b, 0)).toBe('двое суток');
    expect(fedWords(b, 24 * H)).toBe('сутки');
    expect(fedWords(b, 48 * H)).toBe('голод');
  });
});

describe('тепло: сутки в среднем по погоде, потом полсуток здоровья — одна модель', () => {
  it('за целое кольцо погод тепло уходит ровно по настоящим часам', () => {
    // Средняя по погоде ставка — единица по построению (`HOUR_OF_COLD`), поэтому
    // на целых кольцах холодовой час равен настоящему.
    expect(coldAt(away(0), OUT, RING_MS)).toBeCloseTo(RING_MS / COLD_MS, 12);
    expect(coldAt(away(0), OUT, 7 * RING_MS)).toBeCloseTo((7 * RING_MS) / COLD_MS, 12);
  });

  it('полоса тепла пустеет за сутки с любой минуты кольца — разница меньше полутора минут', () => {
    let sum = 0;
    let n = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 7_000) {
      const left = coldEmptyAt(away(t0), OUT) - t0;
      expect(Math.abs(left - COLD_MS), `с ${t0 / 1000} с`).toBeLessThan(1.5 * MIN);
      sum += left;
      n++;
    }
    expect(sum / n / H).toBeCloseTo(24, 2);
  });

  it('после пустого тепла здоровье уходит ровно за двенадцать часов — в любую погоду', () => {
    for (let t0 = 0; t0 < RING_MS; t0 += 61_000) {
      const b = away(t0);
      expect(deadAt(b, OUT) - coldEmptyAt(b, OUT), `с ${t0 / 1000} с`).toBeCloseTo(HEALTH_MS, 3);
      expect(causeOfDeath(b, OUT, deadAt(b, OUT) + MIN)).toBe('cold');
    }
  });

  it('от полной беспечности до смерти — тридцать шесть часов', () => {
    for (let t0 = 0; t0 < RING_MS; t0 += 13_000) {
      const dead = deadAt(away(t0), OUT) - t0;
      expect(Math.abs(dead - 36 * H), `с ${t0 / 1000} с`).toBeLessThan(1.5 * MIN);
    }
  });

  it('ночь и снег студят ровно во столько раз, во сколько сказано', () => {
    const gain = (s: { at: number; until: number }): number => coldAt(away(s.at), OUT, s.until);
    const day = gain(CLEAR_DAY);
    expect(day).toBeCloseTo((CLEAR_DAY.until - CLEAR_DAY.at) / CHILL_MEAN / COLD_MS, 12);
    expect(gain(CLEAR_NIGHT) / day).toBeCloseTo(NIGHT_CHILL, 9);
    expect(gain(SNOW_DAY) / day).toBeCloseTo(SNOW_CHILL, 9);
  });

  it('одежда растягивает тепло, а здоровья не держит', () => {
    for (let t0 = 0; t0 < RING_MS; t0 += 97_000) {
      const b = away(t0, { coat: true });
      const out = coldEmptyAt(b, OUT);
      expect(Math.abs(out - t0 - COLD_MS / COAT_CHILL)).toBeLessThan(2.5 * MIN);
      // Сорок часов тепла кончаются раньше живота: сперва здоровье тает от холода
      // одного, а с пустым животом — вдвое быстрее. Одежда тут уже не держит ничего.
      const gap = t0 + STARVE_MS - out;
      expect(deadAt(b, OUT) - out).toBeCloseTo(gap / 2 + HEALTH_MS / 2, 3);
    }
  });

  it('отогреваются одной скоростью в любую погоду — и за двадцать минут', () => {
    const thaw = (s: { at: number; until: number }): number =>
      1 - coldAt(man(s.at, { cold: 1 - 1e-9 }), { fuel: HEARTH_CAP, at: s.at }, s.until);
    expect(thaw(RAIN_DAY)).toBeCloseTo(thaw(CLEAR_DAY), 9);
    expect(thaw(SNOW_DAY)).toBeCloseTo(thaw(CLEAR_DAY), 9);
    const cold = man(0, { cold: 0.999 });
    expect(coldAt(cold, FULL, WARM_MS)).toBe(0);
    expect(coldAt(cold, FULL, WARM_MS / 2)).toBeCloseTo(0.499, 6);
  });

  it('вдали от огня стынут так же, как у погасшего', () => {
    // Тринадцать метров от костра и погасшая стоянка греют одинаково — никак.
    expect(coldAt(away(0), FULL, 3 * H)).toBeCloseTo(coldAt(man(0), OUT, 3 * H), 9);
  });

  it('перелом у огня один — минута, в которую гаснет костёр', () => {
    const h: Hearth = { fuel: 2, at: 0 };
    const b = man(0);
    const out = fireOutAt(h);
    expect(out).toBeGreaterThan(4 * H);
    expect(out).toBeLessThan(12 * H);
    expect(coldAt(b, h, out)).toBe(0);
    expect(warming(b, h, out - MIN)).toBe(true);
    expect(warming(b, h, out + MIN)).toBe(false);
    expect(coldAt(b, h, out + H)).toBeGreaterThan(0);
  });

  it('пришедший к огню замёрзшим отогревается за двенадцать минут', () => {
    // Зима с первого кадра: полоса тепла встаёт на экран неполной.
    const s = freshPrologue(0);
    expect(warmthFill(s.body, s.hearth, 0)).toBeCloseTo(1 - ARRIVAL_COLD, 12);
    expect(warmthWords(s.body, s.hearth, 0)).toBe('греется');
    expect(warmthFill(s.body, s.hearth, ARRIVAL_COLD * WARM_MS)).toBe(1);
    expect(warmthWords(s.body, s.hearth, ARRIVAL_COLD * WARM_MS)).toBe('тепло');
    // Новое утро после смерти — такое же зимнее.
    expect(revive(s, 5 * H).body).toMatchObject({ cold: ARRIVAL_COLD, harm: 0, hunger: 0 });
  });

  it('слова тепла: вдали — срок до пустой полосы, пустая — «мёрзнет»', () => {
    const b = away(0);
    expect(warmthWords(b, OUT, 0)).toBe(spanWords(coldEmptyAt(b, OUT)));
    expect(warmthWords(b, OUT, coldEmptyAt(b, OUT) + MIN)).toBe('мёрзнет');
  });
});

describe('здоровье', () => {
  it('пять укусов не убивают, шестой — убивает', () => {
    let b = away(0);
    for (let i = 1; i <= 5; i++) {
      b = bite(b, OUT, i * 3000);
      // Ровно целое число, а не «почти»: шесть шестых в долях дали бы
      // 0.9999999999999999, и шестой укус не убил бы.
      expect(harmAt(b, OUT, i * 3000)).toBe(i);
    }
    expect(causeOfDeath(b, OUT, 15_500)).toBe(null);
    expect(healthFill(b, OUT, 15_500)).toBeCloseTo(1 / 6, 12);
    b = bite(b, OUT, 18_000);
    expect(harmAt(b, OUT, 18_000)).toBe(WOLF_BITES);
    expect(causeOfDeath(b, OUT, 18_000)).toBe('wolf');
    expect(causeOfDeath(b, FULL, 1000 * H)).toBe('wolf');
  });

  it('мясо возвращает здоровье ровно на сказанное: жареное — укус, сырое — треть', () => {
    const b = away(0, { harm: 3, hunger: 0.5 });
    const cooked = eat(b, OUT, 0, false);
    expect(cooked.harm).toBe(3 - MEAT_HEAL);
    expect(MEAT_HEAL).toBe(1);
    expect(0.5 - cooked.hunger).toBeCloseTo((MEAT_FED_H * H) / STARVE_MS, 12);
    const raw = eat(b, OUT, 0, true);
    expect(3 - raw.harm).toBeCloseTo(MEAT_HEAL * RAW_SHARE, 12);
    expect(0.5 - raw.hunger).toBeCloseTo((MEAT_FED_H * RAW_SHARE * H) / STARVE_MS, 12);
    // Олень целиком — всё здоровье: шесть кусков по укусу.
    let full = away(0, { harm: WOLF_BITES - 0.5 });
    for (let i = 0; i < 6; i++) full = eat(full, OUT, 0, false);
    expect(full.harm).toBe(0);
    // Сверх полного не набирается.
    expect(eat(away(0, { harm: 0.2 }), OUT, 0, false).harm).toBe(0);
  });

  it('само заживает у горящего огня — за двое суток от нуля до полного', () => {
    const b = man(0, { harm: 3 });
    const h: Hearth = { fuel: HEARTH_CAP, at: 0 };
    expect(healing(b, h, H)).toBe(true);
    expect(healthWords(b, h, H)).toBe('заживает');
    expect(harmAt(b, h, 8 * H)).toBeCloseTo(3 - (8 * WOLF_BITES) / 48, 9);
  });

  it('само заживает и под крышей без огня — пока не кончилось тепло', () => {
    const b = away(0, { harm: 3, roof: true });
    expect(harmAt(b, OUT, 12 * H)).toBeCloseTo(1.5, 9);
    expect(harmAt(b, OUT, 24 * H)).toBe(0);
  });

  it('вдали от огня и крыши не заживает — рана ждёт покоя', () => {
    const b = away(0, { harm: 3 });
    expect(healing(b, FULL, H)).toBe(false);
    expect(harmAt(b, FULL, 5 * H)).toBe(3);
    expect(healthWords(b, FULL, H)).toBe('');
  });

  it('голодный и замёрзший не заживает даже у огня — у него тает', () => {
    const starving = man(0, { harm: 3, hunger: 1 });
    expect(healing(starving, FULL, H)).toBe(false);
    expect(draining(starving, FULL, H)).toBe(true);
    expect(harmAt(starving, FULL, H)).toBeCloseTo(3 + WOLF_BITES / 12, 9);
    // Слово — срок до смерти: три укуса по пол-укуса в час — шесть часов.
    expect(healthWords(starving, FULL, 0)).toBe('6 ч');
    // Обе нужды пусты — вдвое быстрее.
    const both = away(0, { harm: 3, hunger: 1, cold: 1 });
    expect(deadAt(both, OUT)).toBeCloseTo(3 * H, 3);
  });

  it('полная полоса здоровья молчит', () => {
    expect(healthWords(man(0), FULL, H)).toBe('');
    expect(healthFill(man(0), FULL, H)).toBe(1);
  });
});

describe('промежуток по частям равен промежутку целиком', () => {
  it('для сытости, тепла и здоровья — у огня, вдали, под крышей, одетым, раненым', () => {
    // ЭТО И ЕСТЬ ОТЛИЧИЕ ЧТЕНИЯ ОТ ТИКА: закрыть отрезок можно в любую минуту,
    // потому что от разбиения ответ не меняется.
    const T = 70 * H;
    const h: Hearth = { fuel: 1.5, at: 0 };
    const cases: Partial<Body>[] = [{}, { warm: false }, { roof: true, warm: false }, { coat: true }, { harm: 2 }, { hunger: 0.8, cold: 0.5, harm: 1 }];
    for (const over of cases) {
      const start = man(0, over);
      const whole = anchor(start, h, T);
      let b = start;
      for (let t = 0; t <= T; t += 37 * MIN) b = anchor(b, h, t);
      b = anchor(b, h, T);
      const name = JSON.stringify(over);
      expect(b.cold, name).toBeCloseTo(whole.cold, 9);
      expect(b.harm, name).toBeCloseTo(whole.harm, 9);
      expect(b.hunger, name).toBeCloseTo(whole.hunger, 9);
      expect(b.at, name).toBeCloseTo(whole.at, 3);
      expect(causeOfDeath(b, h, T + H), name).toBe(causeOfDeath(start, h, T + H));
      // И то, что называет чтение без закрытия, — то же самое.
      expect(coldAt(start, h, T), name).toBeCloseTo(whole.cold, 9);
      expect(harmAt(start, h, T), name).toBeCloseTo(whole.harm, 9);
      // Смерть закрывает отрезок на себе: отметка — минута смерти.
      if (deadAt(start, h) <= T) expect(whole.at, name).toBeCloseTo(deadAt(start, h), 3);
    }
  });
});

describe('полоса обещает то, что случится', () => {
  it('за минуту до срока жив, через минуту после — мёртв, и срок назван заранее', () => {
    /*
     * ГЛАВНЫЙ ТЕСТ ЗДОРОВЬЯ. Срок зависит от того, какая ночь и какая погода
     * впереди, погаснет ли огонь и когда опустеет живот, — и вместо числа
     * проверяется обещание: полоса называет ту минуту, в которую и случится.
     */
    const kinds: Partial<Body>[] = [{}, { coat: true }, { roof: true }, { harm: 2 }, { hunger: 0.7 }];
    for (const over of kinds) {
      for (let t0 = 0; t0 < RING_MS; t0 += 97_000) {
        const h: Hearth = { fuel: 2, at: t0 };
        const b = man(t0, over);
        const dead = deadAt(b, h);
        const name = `${JSON.stringify(over)} с ${t0 / 1000} с`;
        expect(causeOfDeath(b, h, dead - MIN), name).toBe(null);
        expect(causeOfDeath(b, h, dead + MIN), name).not.toBe(null);
        expect(lifeLeftMs(b, h, t0) + t0, name).toBeCloseTo(dead, 6);
        expect(lifeLeftMs(b, h, t0 + H) + t0 + H, name).toBeCloseTo(dead, 6);
      }
    }
  });
});

describe('смерть не наступает, пока игрок не мог ничего сделать', () => {
  it('новая поляна не убивает ни в первые минуты, ни пока горит начальный очаг', () => {
    for (let t0 = 0; t0 < RING_MS; t0 += 137_000) {
      const s = freshPrologue(t0);
      for (let t = 0; t <= 5 * MIN; t += 20_000) {
        expect(causeOfDeath(s.body, s.hearth, t0 + t), `${t / MIN} мин`).toBe(null);
      }
      const out = fireOutAt(s.hearth);
      for (let t = t0; t <= out; t += 12 * MIN) {
        expect(causeOfDeath(s.body, s.hearth, t), `${(t - t0) / H} ч`).toBe(null);
      }
    }
  });

  it('самая ранняя смерть на новой поляне — на третьи сутки без малого, и это холод', () => {
    // Начальный очаг горит от восьми до двенадцати часов, дальше сутки тепла и
    // полсуток здоровья. Прогоном по всем фазам кольца, а не на бумаге.
    let earliest = Infinity;
    for (let t0 = 0; t0 < RING_MS; t0 += 10_000) {
      const s = freshPrologue(t0);
      earliest = Math.min(earliest, deadAt(s.body, s.hearth) - t0);
    }
    expect(earliest / H).toBeGreaterThan(40);
    expect(earliest / H).toBeLessThan(48);
    const s = freshPrologue(0);
    expect(causeOfDeath(s.body, s.hearth, deadAt(s.body, s.hearth) + MIN)).toBe('cold');
  });
});

describe('причина — то, что было пусто в минуту смерти', () => {
  it('тепло, потом живот, и если обе нужды закрыты — зубы', () => {
    const frozen = away(0, { harm: 5, cold: 1 });
    expect(causeOfDeath(frozen, OUT, 3 * H)).toBe('cold');
    // Замёрзшего, которого добил волк, игра называет замёрзшим: к зубам его привёл холод.
    expect(causeOfDeath(bite(frozen, OUT, MIN), OUT, MIN)).toBe('cold');
    const hungry = man(0, { harm: 5, hunger: 1, roof: true });
    expect(causeOfDeath(hungry, FULL, 3 * H)).toBe('hunger');
    expect(causeOfDeath(bite(away(0, { harm: 5 }), OUT, MIN), OUT, MIN)).toBe('wolf');
  });

  it('записанный труп причину не меняет: у огня он не оттаивает', () => {
    const b = away(0);
    const dead = deadAt(b, OUT);
    const late = anchor(b, OUT, dead + 5 * H);
    expect(late.at).toBeCloseTo(dead, 3);
    const lit: Hearth = { fuel: HEARTH_CAP, at: dead + 5 * H };
    const warmed = camp(late, lit, dead + 6 * H);
    expect(causeOfDeath(warmed, lit, dead + 30 * H)).toBe('cold');
    expect(harmAt(warmed, lit, dead + 30 * H)).toBe(WOLF_BITES);
  });
});

describe('уходя, человек возвращается к костру', () => {
  it('отметка на диск ложится стояночной, а пройденное вдали закрывается честно', () => {
    const out = camp(away(0), FULL, 3 * H);
    expect(out.warm).toBe(true);
    expect(out.at).toBe(3 * H);
    expect(out.cold).toBeCloseTo(coldAt(away(0), FULL, 3 * H), 12);
    // А дальше он на стоянке: у горящего огня отогревается, а не стынет.
    expect(coldAt(out, FULL, 3 * H + WARM_MS)).toBe(0);
  });

  it('без этого правила разряженный у дерева телефон убивал бы', () => {
    // Ровно тот случай, ради которого правило и написано: полтора дня вдали от огня —
    // смерть, те же полтора дня на стоянке у полного очага — нет.
    expect(causeOfDeath(away(0), FULL, 37 * H)).toBe('cold');
    expect(causeOfDeath(camp(away(0), FULL, 0), FULL, 37 * H)).toBe(null);
  });

  it('вход в круг у костра и выход из него закрывают отрезок', () => {
    const left = setWarm(man(0), FULL, 2 * H, false);
    expect(left.at).toBe(2 * H);
    expect(left.warm).toBe(false);
    expect(setWarm(left, FULL, 5 * H, false)).toBe(left);
  });
});

describe('старая запись: раны переезжают в здоровье долей до смерти', () => {
  const KEY = 'tribe.prologue.v1';
  const store = new Map<string, string>();
  const host = globalThis as unknown as { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> };

  beforeEach(() => {
    store.clear();
    host.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete host.localStorage;
  });

  it('две раны из трёх — четыре укуса из шести, а новое поле читается как есть', () => {
    store.set(KEY, JSON.stringify({ v: 1, body: { hunger: 0.1, cold: 0.2, hurt: 2, at: 5 } }));
    expect(loadPrologue(10).body.harm).toBe(4);
    store.set(KEY, JSON.stringify({ v: 1, body: { hunger: 0.1, cold: 0.2, harm: 2.5, at: 5 } }));
    expect(loadPrologue(10).body.harm).toBe(2.5);
    store.set(KEY, JSON.stringify({ v: 1, body: { harm: 99 } }));
    expect(loadPrologue(10).body.harm).toBe(WOLF_BITES);
  });
});

// ---------- Обещания, которые проверяются только чтением исходников ----------

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('ни одна полоса не движется от кадрового времени', () => {
  // Что `performance.now` живёт только в сцене, стережёт `fire.test.ts` — он
  // читает всю папку разом. Здесь — тик, таймер и часы устройства.
  it('у полос нет ни тика, ни таймера, ни догона', () => {
    for (const file of ['body.ts', 'hunt.ts', 'pack.ts']) {
      const src = strip(readFileSync(join(__dirname, file), 'utf8'));
      for (const word of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date', 'catchUp']) {
        expect(src, `${file} начал тикать: ${word}`).not.toContain(word);
      }
    }
  });

  it('второй модели холода в папке нет: прежние «восемь часов» не живут ни именем, ни числом', () => {
    for (const file of ['body.ts', 'act.ts', 'save.ts', 'craft.ts', 'wolves.ts', 'scene.ts', 'Prologue.tsx']) {
      const src = strip(readFileSync(join(__dirname, file), 'utf8'));
      expect(src, `${file}: старая шкала холода`).not.toMatch(/\bCHILL_(MS|H)\b|coldDeadAt|coldLeftMs|WOUNDS_FATAL|hurtFill|hurtWords/);
    }
  });
});
