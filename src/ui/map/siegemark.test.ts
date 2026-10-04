// Осада и падение города на карте: рогатки, знак участи, подписи. Цена всего этого для прежней земли (счётчик
// выпечек на прежнем кадре) ушла вместе с прежней картой (docs/ui_audit.md, 16): у карты по регионам в кадре не
// печётся ничего (`tw/prebake.test.ts`).
import { describe, expect, it } from 'vitest';
import { FALL_MARK } from '@/world/data/tuning';
import type { Fate } from '@/world/types';
import { TREE_FREE_R } from './const';
import {
  FELL_WORDS,
  FRONT_R,
  FRONT_STAKES,
  LABEL_MAX_PX,
  REAR_R,
  REAR_STAKES,
  WORKS_STEPS,
  fellShown,
  fitLabel,
  stakeOrder,
  stakesAt,
  worksKey,
  worksStand,
  worksStep,
} from './siegemark';

// ---------- Чистая часть ----------

describe('рогатки: ступени готовности', () => {
  it('ступень монотонна по готовности и доходит до конца ровно на дозревших рогатках', () => {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const step = worksStep(i / 1000);
      expect(step).toBeGreaterThanOrEqual(prev);
      prev = step;
    }
    expect(worksStep(0)).toBe(0);
    expect(worksStep(1)).toBe(WORKS_STEPS);
    expect(worksStep(0.999)).toBe(WORKS_STEPS - 1);
  });

  it('недостроенный ряд редеет по всему кругу, а не пустеет с одной стороны', () => {
    // На любой ступени от четверти колья стоят в каждой четверти круга: иначе
    // «достроено наполовину» читалось бы «укреплена одна сторона города».
    for (const n of [FRONT_STAKES, REAR_STAKES]) {
      const order = stakeOrder(n);
      expect(new Set(order).size, 'порядок — перестановка').toBe(n);
      for (let step = WORKS_STEPS / 4; step <= WORKS_STEPS; step++) {
        const shown = stakesAt(n, step);
        for (let q = 0; q < 4; q++) {
          const inQuarter = order.filter((rank, i) => rank < shown && Math.floor((i / n) * 4) === q).length;
          expect(inQuarter, `${n} кольев, ступень ${step}, четверть ${q}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('ряды лежат внутри вырубки: рогатки не просят земли под собой', () => {
    expect(FRONT_R).toBeLessThan(REAR_R);
    expect(REAR_R).toBeLessThan(TREE_FREE_R);
  });

  it('ключ спрайта различает всё, от чего зависит картинка', () => {
    const keys = new Set<string>();
    for (const f of [0, 3, WORKS_STEPS]) {
      for (const r of [0, 5, WORKS_STEPS]) {
        for (const half of ['back', 'front'] as const) {
          for (const bucket of [22, 64]) for (const dpr of [1, 2]) keys.add(worksKey(f, r, half, bucket, dpr));
        }
      }
    }
    expect(keys.size).toBe(3 * 3 * 2 * 2 * 2);
  });

  it('рогатки сходят с карты в минуту голода, а у постороннего — ждут куска карты', () => {
    expect(worksStand(1000, 999)).toBe(true);
    expect(worksStand(1000, 1000)).toBe(false);
    expect(worksStand(undefined, 1e15)).toBe(true);
  });
});

describe('знак участи', () => {
  it('держится ровно `FALL_MARK` и ни минутой дольше', () => {
    const at = 5_000_000;
    for (const fate of Object.keys(FELL_WORDS) as Fate[]) {
      expect(fellShown({ fate, at }, at)).toBe(true);
      expect(fellShown({ fate, at }, at + FALL_MARK - 1)).toBe(true);
      expect(fellShown({ fate, at }, at + FALL_MARK)).toBe(false);
      expect(fellShown({ fate, at }, at - 1), 'до падения знака нет').toBe(false);
    }
    expect(fellShown(null, at)).toBe(false);
  });

  it('у каждой участи своё слово, и слова не повторяются', () => {
    const words = Object.values(FELL_WORDS);
    expect(new Set(words).size).toBe(words.length);
    expect(Object.keys(FELL_WORDS).sort()).toEqual(['burn', 'captives', 'plunder']);
  });
});

// ---------- Подписи ----------

describe('подпись поселения вписывается, а не разъезжается', () => {
  /** Мерка без холста: широкие буквы шире узких, как у настоящего шрифта. */
  const measure = (s: string): number =>
    Array.from(s).reduce((w, ch) => w + (/[ШЩЖМЮФWM@…]/.test(ch) ? 11 : /[ijl.,:;'!| ]/.test(ch) ? 3 : 7), 0);

  const NAMES = [
    '',
    'Ольховец',
    'Ш'.repeat(40),
    'i'.repeat(40),
    'Логово разбойников',
    'Большой Новый Город У Самой Реки Где Ивы',
    `${'Щ'.repeat(20)} ${'l'.repeat(19)}`,
  ];

  it('ширина вписанной подписи не больше потолка при любом имени до сорока знаков', () => {
    for (const name of NAMES) {
      const fit = fitLabel(name, LABEL_MAX_PX, measure);
      expect(measure(fit), name).toBeLessThanOrEqual(LABEL_MAX_PX);
      // Короткое имя не трогается, длинное — начало имени с многоточием.
      if (measure(name) <= LABEL_MAX_PX) expect(fit).toBe(name);
      else {
        expect(fit.endsWith('…')).toBe(true);
        expect(name.startsWith(fit.slice(0, -1).trimEnd())).toBe(true);
      }
    }
    // Проверка не пустая: хотя бы одно имя действительно пришлось резать.
    expect(NAMES.some((n) => measure(n) > LABEL_MAX_PX)).toBe(true);
  });
});
