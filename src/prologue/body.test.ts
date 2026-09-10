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
  anchor,
  camp,
  causeOfDeath,
  coldAt,
  coldDeadAt,
  coldWords,
  eat,
  hungerAt,
  hungerWords,
  newBody,
  setWarm,
  warming,
} from './body';
import { HEARTH_CAP, LOG_MS, type Hearth } from './fire';
import { freshPrologue } from './save';

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
    expect(b).toEqual({ hunger: 0, cold: 0, at: 0, warm: true });
  });

  it('часы, переведённые назад, сытости не прибавляют', () => {
    const b = { hunger: 0.5, cold: 0, at: 10 * H, warm: true };
    expect(hungerAt(b, 0)).toBe(0.5);
    expect(anchor(b, FULL, 0).at).toBe(10 * H);
  });
});

describe('холод: две скорости и один перелом', () => {
  it('без огня стынут восемь часов', () => {
    const b = { hunger: 0, cold: 0, at: 0, warm: true };
    expect(coldAt(b, OUT, 4 * H)).toBeCloseTo(0.5, 9);
    expect(coldAt(b, OUT, 8 * H)).toBe(1);
  });

  it('вдали от огня стынут так же, как без огня вовсе', () => {
    // Тринадцать метров от костра и погасшая стоянка греют одинаково, то есть
    // никак. Двух скоростей у «стынет» быть не должно.
    const away = { hunger: 0, cold: 0, at: 0, warm: false };
    const cold = { hunger: 0, cold: 0, at: 0, warm: true };
    expect(coldAt(away, FULL, 3 * H)).toBeCloseTo(coldAt(cold, OUT, 3 * H), 9);
  });

  it('у горящего костра отогреваются за двадцать минут', () => {
    const b = { hunger: 0, cold: 1, at: 0, warm: true };
    // Мёртвый не отогревается — берём чуть живого.
    const alive = { ...b, cold: 0.999 };
    expect(coldAt(alive, FULL, WARM_MS)).toBe(0);
    expect(coldAt(alive, FULL, WARM_MS / 2)).toBeCloseTo(0.499, 6);
  });

  it('перелом один — минута, в которую гаснет костёр', () => {
    // Два полена: горит двенадцать часов, дальше человек стынет.
    const h: Hearth = { fuel: 2, at: 0 };
    const b = { hunger: 0, cold: 0, at: 0, warm: true };
    expect(coldAt(b, h, 12 * H)).toBe(0);
    expect(coldAt(b, h, 16 * H)).toBeCloseTo(4 / 8, 9);
    expect(coldAt(b, h, 20 * H)).toBe(1);
  });

  it('промежуток по частям равен промежутку целиком', () => {
    // ЭТО И ЕСТЬ ОТЛИЧИЕ ЧТЕНИЯ ОТ ТИКА, и на нём стоит всё остальное: закрыть
    // отрезок можно в любую минуту, потому что от разбиения ответ не меняется.
    const h: Hearth = { fuel: 1.5, at: 0 };
    for (const warm of [true, false]) {
      let b = { hunger: 0.1, cold: 0.4, at: 0, warm };
      const whole = coldAt(b, h, 14 * H);
      for (let t = 0; t <= 14 * H; t += 37 * 60_000) b = anchor(b, h, t);
      b = anchor(b, h, 14 * H);
      expect(b.cold, `warm=${warm}`).toBeCloseTo(whole, 9);
      expect(b.hunger).toBeCloseTo(hungerAt({ hunger: 0.1, cold: 0, at: 0, warm }, 14 * H), 9);
    }
  });

  it('мёртвый не отогревается', () => {
    // Единица — поглощающая: без этого труп, оставленный у костра, оживал бы.
    const dead = { hunger: 0, cold: 1, at: 0, warm: true };
    expect(coldAt(dead, FULL, 100 * H)).toBe(1);
    expect(causeOfDeath(dead, FULL, 100 * H)).toBe('cold');
  });

  it('«греется» — это про огонь и место разом', () => {
    expect(warming({ hunger: 0, cold: 0.5, at: 0, warm: true }, FULL, H)).toBe(true);
    expect(warming({ hunger: 0, cold: 0.5, at: 0, warm: false }, FULL, H)).toBe(false);
    expect(warming({ hunger: 0, cold: 0.5, at: 0, warm: true }, OUT, H)).toBe(false);
  });

  it('срок замерзания считается, а не прикидывается', () => {
    const h: Hearth = { fuel: 2, at: 0 };
    const b = { hunger: 0, cold: 0, at: 0, warm: true };
    expect(coldDeadAt(b, h)).toBeCloseTo(20 * H, 6);
    // И полоса называет ровно его же.
    expect(coldWords(b, h, 12 * H)).toBe('8 ч');
    expect(coldWords(b, h, 0)).toBe('тепло');
    expect(coldWords({ ...b, cold: 0.5 }, FULL, 0)).toBe('греется');
  });
});

describe('уходя, человек возвращается к костру', () => {
  it('отметка на диск ложится стояночной, а пройденное вдали закрывается честно', () => {
    // Человек три часа простоял у дерева: этот холод остаётся при нём.
    const away = { hunger: 0, cold: 0, at: 0, warm: false };
    const out = camp(away, FULL, 3 * H);
    expect(out.warm).toBe(true);
    expect(out.at).toBe(3 * H);
    expect(out.cold).toBeCloseTo(3 / 8, 9);
    // А дальше он на стоянке: у горящего огня отогревается, а не стынет.
    expect(coldAt(out, FULL, 3 * H + WARM_MS)).toBe(0);
  });

  it('без этого правила разряженный у дерева телефон убивал бы', () => {
    // Ровно тот случай, ради которого правило и написано: восемь часов вдали
    // от огня — смерть, восемь часов на стоянке с горящим костром — нет.
    const away = { hunger: 0, cold: 0, at: 0, warm: false };
    expect(causeOfDeath(away, FULL, 8 * H)).toBe('cold');
    expect(causeOfDeath(camp(away, FULL, 0), FULL, 8 * H)).toBe(null);
  });

  it('вход в круг у костра и выход из него закрывают отрезок', () => {
    const b = { hunger: 0, cold: 0, at: 0, warm: true };
    const left = setWarm(b, FULL, 2 * H, false);
    expect(left.at).toBe(2 * H);
    expect(left.warm).toBe(false);
    // Отметка, которая не менялась, возвращается той же: писать нечего.
    expect(setWarm(left, FULL, 5 * H, false)).toBe(left);
  });
});

describe('смерть не наступает, пока игрок не мог ничего сделать', () => {
  it('новая поляна не убивает ни в первые минуты, ни в первые полсуток', () => {
    const s = freshPrologue(0);
    // Заход — три минуты; за него не должно случаться вовсе ничего.
    for (let t = 0; t <= 20 * 60_000; t += 20_000) {
      expect(causeOfDeath(s.body, s.hearth, t), `${t / 60_000} мин`).toBe(null);
    }
    // И пока горит начальный очаг — тоже: полоса обещает двенадцать часов, и
    // раньше этого срока смерть была бы враньём полосы.
    for (let t = 0; t <= 12 * H; t += 12 * 60_000) {
      expect(causeOfDeath(s.body, s.hearth, t), `${t / H} ч`).toBe(null);
    }
  });

  it('самая ранняя смерть — через двадцать часов, и это холод', () => {
    // Двенадцать часов горит начальный очаг плюс восемь часов до замерзания.
    const s = freshPrologue(0);
    expect(causeOfDeath(s.body, s.hearth, 20 * H - 1000)).toBe(null);
    expect(causeOfDeath(s.body, s.hearth, 20 * H)).toBe('cold');
  });

  it('называется та причина, что случилась раньше', () => {
    // Сошлись обе: замёрз к утру, «доголодал» бы к вечеру.
    const b = { hunger: 0.9, cold: 0.9, at: 0, warm: true };
    const soon = causeOfDeath(b, OUT, 10 * H);
    expect(soon).toBe('cold');
    // А голодного у жаркого костра убивает голод, и ничто другое.
    expect(causeOfDeath({ hunger: 0.99, cold: 0, at: 0, warm: true }, FULL, 2 * H)).toBe('hunger');
  });
});

describe('еда', () => {
  it('жареное втрое сытнее сырого', () => {
    const b = { hunger: 0.9, cold: 0, at: 0, warm: true };
    const cooked = 0.9 - eat(b, FULL, 0, false).hunger;
    const raw = 0.9 - eat(b, FULL, 0, true).hunger;
    expect(cooked).toBeCloseTo((MEAT_FED_H * H) / STARVE_MS, 9);
    expect(raw).toBeCloseTo((MEAT_FED_H * RAW_SHARE * H) / STARVE_MS, 9);
    expect(cooked / raw).toBeCloseTo(3, 9);
    // Один олень — ровно полный живот: шесть кусков по восемь часов.
    expect(cooked * 6).toBeCloseTo(1, 9);
  });

  it('сверх сытости не наедаются', () => {
    const b = { hunger: 0.01, cold: 0, at: 0, warm: true };
    expect(eat(b, FULL, 0, false).hunger).toBe(0);
  });

  it('еда закрывает и холод: отметка одна на обе шкалы', () => {
    const b = { hunger: 0.5, cold: 0, at: 0, warm: false };
    const after = eat(b, FULL, 4 * H, false);
    expect(after.at).toBe(4 * H);
    expect(after.cold).toBeCloseTo(4 / 8, 9);
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
