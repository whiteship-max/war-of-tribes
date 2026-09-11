/**
 * Голод, холод и смерть.
 *
 * Проверяется здесь то же, что у костра, и тем же способом: не арифметика —
 * она на десять строк, — а **обещание**. Обещаний три:
 *
 *   1. обе шкалы считаются на чтении, а не копятся: час игры и час без игры
 *      стоят человеку одинаково, и ответ не зависит от того, сколько раз
 *      спросили. Проверяется тем, что промежуток, посчитанный по частям, равен
 *      посчитанному целиком, — на этом стоит право закрывать отрезок в любую
 *      минуту, а на нём вся запись на диск;
 *   2. смерть не наступает раньше, чем игрок мог что-то сделать;
 *   3. ни одна величина не движется от кадрового времени. Это, как и у костра,
 *      проверяется чтением исходников: «тик появился» выглядит как обычная
 *      правка и ничем себя не выдаёт.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHILL_MS,
  MEAT_FED_H,
  RAW_SHARE,
  STARVE_MS,
  WARM_MS,
  WOUNDS_FATAL,
  WOUND_MS,
  anchor,
  bite,
  camp,
  causeOfDeath,
  coldAt,
  coldDeadAt,
  coldLeftMs,
  coldWords,
  eat,
  fireOutAt,
  hungerAt,
  hungerWords,
  hurtAt,
  newBody,
  setWarm,
  warming,
} from './body';
import { HEARTH_CAP, LOG_MS, type Hearth } from './fire';
import { CHILL_MEAN, NIGHT_CHILL, RING_MS, SNOW_CHILL, chilledMs } from './sky';
import { freshPrologue } from './save';

/*
 * ЧИСТЫЕ ОТРЕЗКИ КОЛЬЦА — ТО, ЧЕМ ЗДЕСЬ МЕРЯЮТ ПОГОДУ.
 *
 * Ставка холода теперь ступенчатая функция от времени, и «четыре часа дают
 * половину» верно только в погожий день. Значит хвататься надо не за часы, а за
 * отрезки, у которых погода и небо заведомо одни, — и брать их из самого
 * кольца, а не подбирать наугад. Все три ниже проверены отдельным тестом
 * (`sky.test.ts`), поэтому здесь на них можно опираться как на факт.
 *
 * Числа — секунды от начала кольца. Круг суток 240 с, день до 148.8 с, спелл
 * 120 с; спеллы 0 и 1 погожие, 2 дождливый, 10 снежный.
 */
const CLEAR_DAY = { at: 0, until: 91_200 };
const CLEAR_NIGHT = { at: 148_800, until: 240_000 };
const SNOW_DAY = { at: 1_200_000, until: 1_291_200 };
const RAIN_DAY = { at: 240_000, until: 331_200 };

const H = 3_600_000;
const OUT: Hearth = { fuel: 0, at: 0 };
const FULL: Hearth = { fuel: HEARTH_CAP, at: 0 };

describe('голод — прямая от времени', () => {
  it('от сытости до смерти ровно двое суток, как у полного очага', () => {
    // Числа сведены нарочно: игрок запоминает один срок, а не два.
    expect(STARVE_MS).toBe(48 * H);
    expect(STARVE_MS).toBe(HEARTH_CAP * LOG_MS);
    const b = newBody(0);
    expect(hungerAt(b, 0)).toBe(0);
    expect(hungerAt(b, 24 * H)).toBeCloseTo(0.5, 9);
    expect(hungerAt(b, 48 * H)).toBe(1);
    expect(hungerAt(b, 100 * H)).toBe(1);
  });

  it('ответ не зависит от того, сколько раз спросили', () => {
    const b = newBody(0);
    const once = hungerAt(b, 10 * H);
    for (let i = 0; i < 200; i++) hungerAt(b, i * H);
    expect(hungerAt(b, 10 * H)).toBe(once);
    expect(b).toEqual({ hunger: 0, cold: 0, hurt: 0, coat: false, at: 0, warm: true, roof: false });
  });

  it('часы, переведённые назад, сытости не прибавляют', () => {
    const b = { hunger: 0.5, cold: 0, hurt: 0, coat: false, roof: false, at: 10 * H, warm: true };
    expect(hungerAt(b, 0)).toBe(0.5);
    expect(anchor(b, FULL, 0).at).toBe(10 * H);
  });
});

describe('холод: две скорости и один перелом', () => {
  it('без огня стынут восемь **холодовых** часов', () => {
    // Слово «холодовых» появилось вместе с погодой, и разница в нём вся: ставка
    // одна, а время по ней идёт неровно — ночь за 1.8, снег за 1.6.
    const b = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    // В погожий день холодовой час равен настоящему, и восемь часов дают ровно
    // единицу — это по-прежнему правило, а не приближение.
    const clear = (CLEAR_DAY.until - CLEAR_DAY.at) / CHILL_MS;
    expect(coldAt({ ...b, at: CLEAR_DAY.at }, OUT, CLEAR_DAY.until)).toBeCloseTo(clear, 12);
    // А вообще холод идёт по интегралу — и полоса, и срок считаются им одним.
    expect(coldAt(b, OUT, 5 * H)).toBeCloseTo(chilledMs(0, 5 * H) / CHILL_MS, 12);
    expect(coldAt(b, OUT, 8 * H)).toBe(1);
  });

  it('ночь и снег студят ровно во столько раз, во сколько сказано', () => {
    // Отрезки взяты равной длины и с заведомо одной погодой: разница между ними
    // — это и есть множитель, и он обязан быть ровно тем, что в `sky.ts`.
    const gain = (from: number, to: number): number =>
      coldAt({ hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: from, warm: false }, OUT, to);
    const day = gain(CLEAR_DAY.at, CLEAR_DAY.until);
    expect(gain(CLEAR_NIGHT.at, CLEAR_NIGHT.until) / day).toBeCloseTo(NIGHT_CHILL, 9);
    expect(gain(SNOW_DAY.at, SNOW_DAY.until) / day).toBeCloseTo(SNOW_CHILL, 9);
  });

  it('отогреваются одной скоростью в любую погоду', () => {
    // У огня греет огонь, а не небо. Двух скоростей у отогрева быть не должно:
    // иначе «встал у костра» перестало бы значить одно и то же.
    const thaw = (from: number, to: number): number =>
      1 - coldAt({ hunger: 0, cold: 1 - 1e-9, hurt: 0, coat: false, roof: false, at: from, warm: true }, { fuel: HEARTH_CAP, at: from }, to);
    expect(thaw(RAIN_DAY.at, RAIN_DAY.until)).toBeCloseTo(thaw(CLEAR_DAY.at, CLEAR_DAY.until), 9);
    expect(thaw(SNOW_DAY.at, SNOW_DAY.until)).toBeCloseTo(thaw(CLEAR_DAY.at, CLEAR_DAY.until), 9);
  });

  it('в среднем по погоде без огня живут около шести часов, а не восьми', () => {
    // Это и есть цена части про ночь и непогоду, названная числом. Разброс по
    // фазе почти нулевой: за шесть часов проходит полтора кольца, и средняя
    // ставка съедает разницу.
    let lo = Infinity;
    let hi = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 20_000) {
      const dead = coldDeadAt({ hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: t0, warm: false }, { fuel: 0, at: t0 }) - t0;
      lo = Math.min(lo, dead);
      hi = Math.max(hi, dead);
    }
    expect(lo / H).toBeGreaterThan(5.4);
    expect(hi / H).toBeLessThan(6);
    expect(((lo + hi) / 2 / H) * CHILL_MEAN).toBeCloseTo(CHILL_MS / H, 1);
  });

  it('вдали от огня стынут так же, как без огня вовсе', () => {
    // Тринадцать метров от костра и погасшая стоянка греют одинаково, то есть
    // никак. Двух скоростей у «стынет» быть не должно.
    const away = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: false };
    const cold = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    expect(coldAt(away, FULL, 3 * H)).toBeCloseTo(coldAt(cold, OUT, 3 * H), 9);
  });

  it('у горящего костра отогреваются за двадцать минут', () => {
    const b = { hunger: 0, cold: 1, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    // Мёртвый не отогревается — берём чуть живого.
    const alive = { ...b, cold: 0.999 };
    expect(coldAt(alive, FULL, WARM_MS)).toBe(0);
    expect(coldAt(alive, FULL, WARM_MS / 2)).toBeCloseTo(0.499, 6);
  });

  it('перелом один — минута, в которую гаснет костёр', () => {
    // Два полена: горят двенадцать погожих часов, а настоящих — сколько отпустит
    // погода. Минуту гашения считает `fireOutAt`, и другого перелома у холода
    // нет: до неё человек у огня, после — стынет.
    const h: Hearth = { fuel: 2, at: 0 };
    const b = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    const out = fireOutAt(h);
    expect(out).toBeGreaterThan(4 * H);
    expect(out).toBeLessThan(12 * H);
    expect(coldAt(b, h, out)).toBe(0);
    expect(coldAt(b, h, out + H)).toBeCloseTo(chilledMs(out, out + H) / CHILL_MS, 12);
    expect(coldAt(b, h, out + CHILL_MS)).toBe(1);
  });

  it('промежуток по частям равен промежутку целиком', () => {
    // ЭТО И ЕСТЬ ОТЛИЧИЕ ЧТЕНИЯ ОТ ТИКА, и на нём стоит всё остальное: закрыть
    // отрезок можно в любую минуту, потому что от разбиения ответ не меняется.
    const h: Hearth = { fuel: 1.5, at: 0 };
    for (const warm of [true, false]) {
      let b = { hunger: 0.1, cold: 0.4, hurt: 0, coat: false, roof: false, at: 0, warm };
      const whole = coldAt(b, h, 14 * H);
      for (let t = 0; t <= 14 * H; t += 37 * 60_000) b = anchor(b, h, t);
      b = anchor(b, h, 14 * H);
      expect(b.cold, `warm=${warm}`).toBeCloseTo(whole, 9);
      expect(b.hunger).toBeCloseTo(hungerAt({ hunger: 0.1, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm }, 14 * H), 9);
    }
  });

  it('мёртвый не отогревается', () => {
    // Единица — поглощающая: без этого труп, оставленный у костра, оживал бы.
    const dead = { hunger: 0, cold: 1, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    expect(coldAt(dead, FULL, 100 * H)).toBe(1);
    expect(causeOfDeath(dead, FULL, 100 * H)).toBe('cold');
  });

  it('«греется» — это про огонь и место разом', () => {
    expect(warming({ hunger: 0, cold: 0.5, hurt: 0, coat: false, roof: false, at: 0, warm: true }, FULL, H)).toBe(true);
    expect(warming({ hunger: 0, cold: 0.5, hurt: 0, coat: false, roof: false, at: 0, warm: false }, FULL, H)).toBe(false);
    expect(warming({ hunger: 0, cold: 0.5, hurt: 0, coat: false, roof: false, at: 0, warm: true }, OUT, H)).toBe(false);
  });

  it('полоса обещает ровно то, что и случится', () => {
    /*
     * ЭТО ГЛАВНЫЙ ТЕСТ ХОЛОДА, И ОН СИЛЬНЕЕ ЛЮБОГО ЗАПИСАННОГО ЧИСЛА.
     *
     * Раньше здесь стояло «двадцать часов»: срок был линеен и его можно было
     * посчитать в голове. Теперь он зависит от того, какая ночь и какая погода
     * впереди, — и вместо числа проверяется **обещание**: за минуту до срока
     * человек жив, через минуту после — мёртв, а полоса называет тот же срок и
     * называет его заранее. Такой тест переживает любую правку кольца, а
     * записанное число пришлось бы править вместе с ним — и однажды не
     * поправили бы.
     */
    for (let t0 = 0; t0 < RING_MS; t0 += 97_000) {
      const h: Hearth = { fuel: 2, at: t0 };
      const b = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: t0, warm: true };
      const dead = coldDeadAt(b, h);
      expect(causeOfDeath(b, h, dead - 60_000), `${t0}`).toBe(null);
      expect(causeOfDeath(b, h, dead + 60_000), `${t0}`).toBe('cold');
      // Полоса называет тот же срок, и в любую минуту до него.
      expect(coldLeftMs(b, h, t0) + t0).toBeCloseTo(dead, 6);
      expect(coldLeftMs(b, h, t0 + H) + t0 + H).toBeCloseTo(dead, 6);
    }
    const h: Hearth = { fuel: 2, at: 0 };
    const b = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    expect(coldWords(b, h, 0)).toBe('тепло');
    expect(coldWords({ ...b, cold: 0.5 }, FULL, 0)).toBe('греется');
  });
});

describe('уходя, человек возвращается к костру', () => {
  it('отметка на диск ложится стояночной, а пройденное вдали закрывается честно', () => {
    // Человек три часа простоял у дерева: этот холод остаётся при нём.
    const away = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: false };
    const out = camp(away, FULL, 3 * H);
    expect(out.warm).toBe(true);
    expect(out.at).toBe(3 * H);
    expect(out.cold).toBeCloseTo(chilledMs(0, 3 * H) / CHILL_MS, 12);
    // А дальше он на стоянке: у горящего огня отогревается, а не стынет.
    expect(coldAt(out, FULL, 3 * H + WARM_MS)).toBe(0);
  });

  it('без этого правила разряженный у дерева телефон убивал бы', () => {
    // Ровно тот случай, ради которого правило и написано: восемь часов вдали
    // от огня — смерть, восемь часов на стоянке с горящим костром — нет.
    const away = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: false };
    expect(causeOfDeath(away, FULL, CHILL_MS)).toBe('cold');
    expect(causeOfDeath(camp(away, FULL, 0), FULL, CHILL_MS)).toBe(null);
  });

  it('вход в круг у костра и выход из него закрывают отрезок', () => {
    const b = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    const left = setWarm(b, FULL, 2 * H, false);
    expect(left.at).toBe(2 * H);
    expect(left.warm).toBe(false);
    // Отметка, которая не менялась, возвращается той же: писать нечего.
    expect(setWarm(left, FULL, 5 * H, false)).toBe(left);
  });
});

describe('смерть не наступает, пока игрок не мог ничего сделать', () => {
  it('новая поляна не убивает ни в первые минуты, ни в первые полсуток', () => {
    // Проверяется на всех фазах кольца, а не на одной: погода теперь входит в
    // срок, и «на нулевой минуте всё хорошо» ничего не сказало бы о том, кто
    // зашёл в дождь.
    for (let t0 = 0; t0 < RING_MS; t0 += 137_000) {
      const s = freshPrologue(t0);
      // Заход — три минуты; за него не должно случаться вовсе ничего.
      for (let t = 0; t <= 5 * 60_000; t += 20_000) {
        expect(causeOfDeath(s.body, s.hearth, t0 + t), `${t / 60_000} мин`).toBe(null);
      }
      // И пока горит начальный очаг — тоже: полоса обещает срок, и смерть
      // раньше него была бы враньём полосы.
      const out = fireOutAt(s.hearth);
      for (let t = t0; t <= out; t += 12 * 60_000) {
        expect(causeOfDeath(s.body, s.hearth, t), `${(t - t0) / H} ч`).toBe(null);
      }
    }
  });

  it('самая ранняя смерть — около четырнадцатого часа, и это холод', () => {
    /*
     * Раньше здесь стояло двадцать часов: двенадцать горел начальный очаг плюс
     * восемь до замерзания. Погода укоротила оба слагаемых — дождь жжёт втрое,
     * ночь и снег студят, — и вышло 8.4 + 5.6 ≈ 14. Число измерено прогоном по
     * всем фазам кольца, а не выведено на бумаге, и проверяется бортами: ниже
     * двенадцати часов оно опускаться не должно (это уже похоже на «умер, пока
     * спал»), выше шестнадцати — тоже, иначе непогода перестала бы значить
     * хоть что-то.
     */
    let earliest = Infinity;
    for (let t0 = 0; t0 < RING_MS; t0 += 10_000) {
      const s = freshPrologue(t0);
      earliest = Math.min(earliest, coldDeadAt(s.body, s.hearth) - t0);
    }
    expect(earliest / H).toBeGreaterThan(12);
    expect(earliest / H).toBeLessThan(16);
    const s = freshPrologue(0);
    const dead = coldDeadAt(s.body, s.hearth);
    expect(causeOfDeath(s.body, s.hearth, dead - 1000)).toBe(null);
    expect(causeOfDeath(s.body, s.hearth, dead)).toBe('cold');
  });

  it('раны: три укуса — смерть, и мёртвый не заживает', () => {
    // Рана — не третья шкала того же рода: она случается от чужого зуба и
    // заживает сама. Но смертельная — поглощающая, ровно как единица холода:
    // иначе загрызенный оживал бы через шесть часов.
    let b = { hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    for (let i = 1; i <= WOUNDS_FATAL; i++) {
      b = bite(b, FULL, i * 1000);
      // Ровно целое число, а не «почти»: за секунду между укусами успевает
      // зажить одна десятитысячная, и на этом три укуса однажды перестали
      // убивать (см. `body.bite`).
      expect(hurtAt(b, i * 1000)).toBe(i);
    }
    expect(causeOfDeath(b, FULL, WOUNDS_FATAL * 1000)).toBe('wolf');
    expect(causeOfDeath(b, FULL, 1000 * H)).toBe('wolf');
    expect(hurtAt(b, 1000 * H)).toBe(WOUNDS_FATAL);
  });

  it('раны заживают сами, за шесть часов каждая', () => {
    const one = bite({ hunger: 0, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true }, FULL, 0);
    expect(hurtAt(one, 0)).toBe(1);
    expect(hurtAt(one, WOUND_MS / 2)).toBeCloseTo(0.5, 9);
    expect(hurtAt(one, WOUND_MS)).toBe(0);
    expect(causeOfDeath(one, FULL, WOUND_MS)).toBe(null);
    // Полузаживший укус плюс новый — это **две** раны, а не полторы: недожившая
    // доля идёт в счёт целой. Иначе три укуса подряд не убивали бы никогда — за
    // секунды между ними заживает одна десятитысячная, и `2.9999` не смерть.
    const two = bite(one, FULL, WOUND_MS / 2);
    expect(hurtAt(two, WOUND_MS / 2)).toBe(2);
    // А заживший укус в счёт уже не идёт: с нуля счёт начинается заново.
    const again = bite(one, FULL, WOUND_MS);
    expect(hurtAt(again, WOUND_MS)).toBe(1);
  });

  it('называется та причина, что случилась раньше', () => {
    // Сошлись обе: замёрз к утру, «доголодал» бы к вечеру.
    const b = { hunger: 0.9, cold: 0.9, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    const soon = causeOfDeath(b, OUT, 10 * H);
    expect(soon).toBe('cold');
    // А голодного у жаркого костра убивает голод, и ничто другое.
    expect(causeOfDeath({ hunger: 0.99, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true }, FULL, 2 * H)).toBe('hunger');
    // Волк успевает раньше обоих: он случился сейчас, а те только собирались.
    const bitten = { hunger: 0.99, cold: 0.99, hurt: WOUNDS_FATAL, coat: false, roof: false, at: 0, warm: true };
    expect(causeOfDeath(bitten, OUT, 0)).toBe('wolf');
  });
});

describe('еда', () => {
  it('жареное втрое сытнее сырого', () => {
    const b = { hunger: 0.9, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    const cooked = 0.9 - eat(b, FULL, 0, false).hunger;
    const raw = 0.9 - eat(b, FULL, 0, true).hunger;
    expect(cooked).toBeCloseTo((MEAT_FED_H * H) / STARVE_MS, 9);
    expect(raw).toBeCloseTo((MEAT_FED_H * RAW_SHARE * H) / STARVE_MS, 9);
    expect(cooked / raw).toBeCloseTo(3, 9);
    // Один олень — ровно полный живот: шесть кусков по восемь часов.
    expect(cooked * 6).toBeCloseTo(1, 9);
  });

  it('сверх сытости не наедаются', () => {
    const b = { hunger: 0.01, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: true };
    expect(eat(b, FULL, 0, false).hunger).toBe(0);
  });

  it('еда закрывает и холод, и раны: отметка одна на все три шкалы', () => {
    const b = { hunger: 0.5, cold: 0, hurt: 0, coat: false, roof: false, at: 0, warm: false };
    const after = eat(b, FULL, 4 * H, false);
    expect(after.at).toBe(4 * H);
    expect(after.cold).toBeCloseTo(chilledMs(0, 4 * H) / CHILL_MS, 12);
    const hurt = eat({ ...b, hurt: 2 }, FULL, WOUND_MS, false);
    expect(hurt.hurt).toBeCloseTo(1, 9);
  });

  it('полоса сытости называет срок теми же словами, что костёр', () => {
    const b = newBody(0);
    expect(hungerWords(b, 0)).toBe('двое суток');
    expect(hungerWords(b, 24 * H)).toBe('сутки');
    expect(hungerWords(b, 48 * H)).toBe('голод');
  });
});

// ---------- Обещания, которые проверяются только чтением исходников ----------

const DIR = __dirname;

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('ни голод, ни холод, ни охота не движутся от кадрового времени', () => {
  // Что `performance.now` живёт только в сцене, стережёт `fire.test.ts` — он
  // читает всю папку разом, и новые файлы попали под него сами. Здесь —
  // остальное: тик, таймер и часы устройства.

  it('у шкал нет ни тика, ни таймера, ни догона', () => {
    for (const file of ['body.ts', 'hunt.ts']) {
      const src = strip(readFileSync(join(DIR, file), 'utf8'));
      for (const word of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date', 'catchUp']) {
        expect(src, `${file} начал тикать: ${word}`).not.toContain(word);
      }
    }
  });

  it('CHILL_MS и WARM_MS — разные скорости одной шкалы, и обе объявлены числом', () => {
    // Не проверка арифметики, а проверка того, что скорости названы, а не
    // спрятаны в выражении: их читает и отчёт, и документ.
    expect(CHILL_MS).toBe(8 * H);
    expect(WARM_MS).toBe(20 * 60_000);
    expect(CHILL_MS / WARM_MS).toBe(24);
  });
});
