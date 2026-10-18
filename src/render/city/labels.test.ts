// Подписи построек и полёт камеры (ОР-1, docs/ui_v2.md, 5.9): раскладка подписей — чистая функция (`labels.layLabels`),
// полёт — чистые числа (`camera.flyAt`, `showDist`, `awayFrom`). Каждый блок называет свою область и проверяет, что точки
// внутри неё (правило 11).
import { describe, expect, it } from 'vitest';
import { LABEL_GAP, LABEL_INSET, LABEL_NEAR, layLabels, overlaps, rectOf, type LabelCand } from './labels';
import { SHOW_DIST, awayFrom, cityFraming, flyAt, showDist } from './camera';

const PHONE = { w: 390, h: 844 };
/** Где подписи вообще ставятся: экран без полос верха и низа интерфейса. */
const FIELD = { x0: 0, x1: PHONE.w, y0: LABEL_INSET.top, y1: PHONE.h - LABEL_INSET.bottom };

/** Сеяная последовательность (линейный конгруэнтный): тест повторяется буква в букву. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** Кандидат, целиком лежащий в поле подписей: середина отступает от края на полразмера. */
function cand(r: () => number, d: number, extra: Partial<LabelCand> = {}): LabelCand {
  const w = 50 + r() * 80;
  const h = 20;
  return {
    x: FIELD.x0 + w / 2 + r() * (FIELD.x1 - FIELD.x0 - w),
    y: FIELD.y0 + h / 2 + r() * (FIELD.y1 - FIELD.y0 - h),
    w,
    h,
    d,
    lit: false,
    mark: false,
    ...extra,
  };
}

const inField = (c: LabelCand): boolean => {
  const r = rectOf(c);
  return r.x >= FIELD.x0 && r.y >= FIELD.y0 && r.x + r.w <= FIELD.x1 && r.y + r.h <= FIELD.y1;
};

describe('подписи не налезают друг на друга', () => {
  // Область: 24 подписи (построек в городе) в поле подписей, рычаг включён — спрашиваются все.
  it('на двадцати наборах ни одна показанная подпись не ложится на другую', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = lcg(seed);
      const cands = Array.from({ length: 24 }, () => cand(r, 100 + r() * 500, { mark: r() < 0.4 }));
      for (const c of cands) expect(inField(c), `набор ${seed}`).toBe(true);
      const shown = layLabels(cands, PHONE, true);
      expect(shown.length, `набор ${seed}: хоть одна видна`).toBeGreaterThan(0);
      for (let a = 0; a < shown.length; a++)
        for (let b = a + 1; b < shown.length; b++) {
          expect(overlaps(rectOf(cands[shown[a]]), rectOf(cands[shown[b]]), LABEL_GAP), `набор ${seed}: ${shown[a]} и ${shown[b]}`).toBe(false);
        }
    }
  });

  it('подпись, которой не на кого лечь, видна — молчат только налезающие', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = lcg(seed);
      const cands = Array.from({ length: 24 }, () => cand(r, 100 + r() * 500));
      const shown = new Set(layLabels(cands, PHONE, true));
      cands.forEach((c, i) => {
        if (shown.has(i)) return;
        const blocked = [...shown].some((j) => overlaps(rectOf(cands[j]), rectOf(c), LABEL_GAP));
        expect(blocked, `набор ${seed}: подпись ${i} молчит без причины`).toBe(true);
      });
    }
  });

  it('под полосами верха и низа интерфейса подписи нет', () => {
    const mid = { x: PHONE.w / 2, w: 60, h: 20, d: 100, lit: false, mark: false };
    const top = { ...mid, y: LABEL_INSET.top - 5 };
    const bottom = { ...mid, y: PHONE.h - LABEL_INSET.bottom + 5 };
    const field = { ...mid, y: PHONE.h / 2 };
    expect(inField(field)).toBe(true);
    expect(layLabels([top, bottom, field], PHONE, true)).toEqual([2]);
  });
});

describe('без рычага видны ближние и показанная', () => {
  // Область: подписи по одной в середине поля — налезать им не на кого, решает только дальность.
  const at = (d: number, extra: Partial<LabelCand> = {}): LabelCand => ({ x: PHONE.w / 2, y: PHONE.h / 2, w: 80, h: 20, d, lit: false, mark: false, ...extra });

  it('ближе LABEL_NEAR — видна, дальше — нет; с рычагом видна любая', () => {
    expect(inField(at(0))).toBe(true);
    expect(layLabels([at(LABEL_NEAR)], PHONE, false)).toEqual([0]);
    expect(layLabels([at(LABEL_NEAR + 1)], PHONE, false)).toEqual([]);
    expect(layLabels([at(LABEL_NEAR + 1)], PHONE, true)).toEqual([0]);
  });

  it('стартовый кадр (камера в 520 м) без рычага подписей не даёт', () => {
    expect(cityFraming(390 / 844).dist).toBeGreaterThan(LABEL_NEAR);
  });

  it('показанная постройка подписана и вдали', () => {
    expect(layLabels([at(LABEL_NEAR * 3, { lit: true })], PHONE, false)).toEqual([0]);
  });
});

describe('кто первым: показанная, с меткой, ближняя', () => {
  // Область: две подписи в одной точке поля — показать можно только одну.
  const at = (d: number, extra: Partial<LabelCand> = {}): LabelCand => ({ x: PHONE.w / 2, y: PHONE.h / 2, w: 80, h: 20, d, lit: false, mark: false, ...extra });

  it('показанная побеждает ближнюю с меткой', () => {
    expect(layLabels([at(50, { mark: true }), at(200, { lit: true })], PHONE, true)).toEqual([1]);
  });

  it('с меткой побеждает ближнюю без метки', () => {
    expect(layLabels([at(50), at(200, { mark: true })], PHONE, true)).toEqual([1]);
  });

  it('из равных — ближняя', () => {
    expect(layLabels([at(200), at(50)], PHONE, true)).toEqual([1]);
  });
});

describe('полёт камеры', () => {
  // Область: доля полёта 0..1 и за её краями; постройки от будки до донжона.
  const a = { x: 0, z: -16, dist: 520 };
  const b = { x: 120, z: 80, dist: 150 };

  it('начинается с места, кончается на цели и дальше цели не уходит', () => {
    expect(flyAt(a, b, 0)).toEqual(a);
    expect(flyAt(a, b, 1)).toEqual(b);
    expect(flyAt(a, b, 1.7)).toEqual(b);
    expect(flyAt(a, b, -0.3)).toEqual(a);
  });

  it('идёт без рывков назад: каждый шаг ближе к цели', () => {
    let prev = Infinity;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const p = flyAt(a, b, k);
      const left = Math.hypot(b.x - p.x, b.z - p.z) + Math.abs(b.dist - p.dist);
      expect(left, `доля ${k.toFixed(2)}`).toBeLessThanOrEqual(prev);
      prev = left;
    }
  });

  it('расстояние до показанной постройки — в своих пределах и растёт с постройкой', () => {
    const small = showDist({ hf: 3, hr: 3, y0: 0, y1: 6 });
    const mid = showDist({ hf: 12, hr: 20, y0: 0, y1: 30 });
    const huge = showDist({ hf: 60, hr: 60, y0: 0, y1: 90 });
    expect(small).toBe(SHOW_DIST.min);
    expect(huge).toBe(SHOW_DIST.max);
    expect(mid).toBeGreaterThan(SHOW_DIST.min);
    expect(mid).toBeLessThan(SHOW_DIST.max);
    const zoom = cityFraming(390 / 844).zoom;
    expect(SHOW_DIST.min).toBeGreaterThanOrEqual(zoom.min);
    expect(SHOW_DIST.max).toBeLessThanOrEqual(zoom.max);
  });

  it('«ушла с дома» — на метры, а не на дробь', () => {
    const home = { x: 0, z: -16, dist: 520 };
    expect(awayFrom({ ...home, x: 0.5 }, home)).toBe(false);
    expect(awayFrom({ ...home, x: 10 }, home)).toBe(true);
    expect(awayFrom({ ...home, dist: 400 }, home)).toBe(true);
  });
});
