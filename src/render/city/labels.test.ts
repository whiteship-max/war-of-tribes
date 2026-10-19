// Подписи построек и полёт камеры (ОР-1, docs/ui_v2.md, 5.9): раскладка подписей — чистая функция (`labels.layLabels`),
// порог — одна видимость на все по доле приближения (`camera.labelsAlpha`, ЗН-4, 5.11), полёт — чистые числа
// (`camera.flyAt`, `showDist`). Каждый блок называет свою область и проверяет, что точки внутри неё (правило 11).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CityLabels, LABEL_GAP, LABEL_INSET, layLabels, overlaps, rectOf, type LabelCand } from './labels';
import { LABEL_ZOOM, SHOW_DIST, cityFraming, flyAt, labelsAlpha, showDist, zoomShare } from './camera';

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
  // Область: 24 подписи (построек в городе) в поле подписей, слой виден — спрашиваются все.
  it('на двадцати наборах ни одна показанная подпись не ложится на другую', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = lcg(seed);
      const cands = Array.from({ length: 24 }, () => cand(r, 100 + r() * 500, { mark: r() < 0.4 }));
      for (const c of cands) expect(inField(c), `набор ${seed}`).toBe(true);
      const shown = layLabels(cands, PHONE);
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
      const shown = new Set(layLabels(cands, PHONE));
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
    expect(layLabels([top, bottom, field], PHONE)).toEqual([2]);
  });
});

describe('порог подписей: все разом около середины приближения (ЗН-4)', () => {
  // Область: размах приближения города (`cityFraming().zoom`) — от дальнего края до ближнего и чуть за ними.
  const zoom = cityFraming(390 / 844).zoom;
  const at = (share: number): number => zoom.max - share * (zoom.max - zoom.min);

  it('полоса порога — около середины размаха и узкая', () => {
    expect(LABEL_ZOOM.from).toBeLessThan(0.5);
    expect(LABEL_ZOOM.to).toBeGreaterThan(0.5);
    expect(Math.abs((LABEL_ZOOM.from + LABEL_ZOOM.to) / 2 - 0.5)).toBeLessThanOrEqual(0.05);
    expect(LABEL_ZOOM.to - LABEL_ZOOM.from).toBeLessThanOrEqual(0.15);
  });

  it('издали — ни одной: от дальнего края до полосы видимость ноль, и на стартовом кадре тоже', () => {
    for (let k = 0; k < LABEL_ZOOM.from; k += 0.01) {
      expect(zoomShare(at(k), zoom), `доля ${k.toFixed(2)} в размахе`).toBeCloseTo(k, 6);
      expect(labelsAlpha(at(k), zoom, true), `доля ${k.toFixed(2)}`).toBe(0);
    }
    expect(labelsAlpha(at(LABEL_ZOOM.from), zoom, true), 'край полосы').toBeLessThan(1e-9);
    expect(labelsAlpha(zoom.max + 50, zoom, true), 'за дальним краем').toBe(0);
    const start = cityFraming(390 / 844).dist;
    expect(zoomShare(start, zoom), 'стартовый кадр — ниже полосы').toBeLessThan(LABEL_ZOOM.from);
    expect(labelsAlpha(start, zoom, true)).toBe(0);
  });

  it('за полосой — все видны целиком, до ближнего края', () => {
    for (let k = LABEL_ZOOM.to; k <= 1.0001; k += 0.01) expect(labelsAlpha(at(Math.min(1, k)), zoom, true), `доля ${k.toFixed(2)}`).toBe(1);
    expect(labelsAlpha(zoom.min - 5, zoom, true), 'за ближним краем').toBe(1);
    expect(labelsAlpha(at(0.5), zoom, true), 'на середине — уже проявляются').toBeGreaterThan(0);
  });

  it('в полосе — плавно: без скачков и без шагов назад при приближении', () => {
    let prev = 0;
    for (let k = LABEL_ZOOM.from; k <= LABEL_ZOOM.to + 1e-9; k += 0.005) {
      const a = labelsAlpha(at(k), zoom, true);
      expect(a, `доля ${k.toFixed(3)}`).toBeGreaterThanOrEqual(prev);
      expect(a - prev, `доля ${k.toFixed(3)}: скачок`).toBeLessThanOrEqual(0.08);
      prev = a;
    }
    expect(prev).toBeCloseTo(1, 6);
  });

  it('рычаг выключен — подписей нет нигде: ни издали, ни вблизи', () => {
    for (let k = 0; k <= 1.0001; k += 0.05) expect(labelsAlpha(at(Math.min(1, k)), zoom, false), `доля ${k.toFixed(2)}`).toBe(0);
  });

  it('показанная постройка («Показать в городе») — в зоне подписей: полёт кончается ближе полосы', () => {
    expect(zoomShare(SHOW_DIST.max, zoom)).toBeGreaterThan(LABEL_ZOOM.to);
  });
});

describe('слой подписей: одна видимость на все', () => {
  // Область: разметка поверх холста 390 × 844 (поддельный DOM), камера города над тремя постройками в середине кадра.
  /** Узел поддельной разметки: столько, сколько трогает `CityLabels`. */
  interface Node {
    style: Record<string, string>;
    dataset: Record<string, string>;
    className: string;
    textContent: string;
    kids: Node[];
    offsetWidth: number;
    offsetHeight: number;
    classList: { toggle: (c: string, on?: boolean) => void };
    appendChild: (n: Node) => void;
    append: (n: Node) => void;
    remove: () => void;
  }
  const node = (): Node => {
    const n: Node = {
      style: {},
      dataset: {},
      className: '',
      textContent: '',
      kids: [],
      offsetWidth: 60,
      offsetHeight: 20,
      classList: { toggle: () => undefined },
      appendChild: (k) => void n.kids.push(k),
      append: (k) => void n.kids.push(k),
      remove: () => undefined,
    };
    return n;
  };

  it('видимость ставится всему слою разом; невидимый слой подписи не раскладывает', () => {
    const g = globalThis as unknown as { document?: unknown };
    const had = g.document;
    g.document = { createElement: node };
    try {
      const host = node();
      const labels = new CityLabels(host as unknown as HTMLElement, new THREE.Vector3());
      const root = host.kids[0];
      expect(root.style.opacity, 'новый слой — невидим').toBe('0');
      labels.set([
        { type: 'farm', name: 'Ферма', mark: null, body: { x: -25, y: 5, z: 0 } },
        { type: 'storage', name: 'Склад', mark: 'upgrade', body: { x: 0, y: 5, z: 0 } },
        { type: 'tavern', name: 'Трактир', mark: null, body: { x: 25, y: 5, z: 0 } },
      ]);
      const cam = new THREE.PerspectiveCamera(36, 390 / 844, 1, 2000);
      cam.position.set(0, 250, 200);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      const labelOf = (i: number): Node => root.kids[i];
      // Точки — внутри кадра и поля подписей (граница области — утверждением).
      for (const x of [-25, 0, 25]) {
        const p = new THREE.Vector3(x, 5, 0).project(cam);
        const sx = ((p.x + 1) / 2) * 390;
        const sy = ((1 - p.y) / 2) * 844;
        expect(sx - 30 > 0 && sx + 30 < 390 && sy - 10 > LABEL_INSET.top && sy + 10 < 844 - LABEL_INSET.bottom, `точка ${x} в поле`).toBe(true);
      }
      labels.update(cam, 390, 844, 0);
      expect(root.style.opacity).toBe('0');
      for (let i = 0; i < 3; i++) expect(labelOf(i).style.visibility, `подпись ${i}: невидимый слой не раскладывается`).toBe('hidden');
      labels.update(cam, 390, 844, 1);
      expect(root.style.opacity).toBe('1');
      for (let i = 0; i < 3; i++) expect(labelOf(i).style.visibility, `подпись ${i}: все разом`).toBe('');
      labels.update(cam, 390, 844, 0.5);
      expect(root.style.opacity, 'гаснут вместе — одной прозрачностью слоя').toBe('0.5');
      for (let i = 0; i < 3; i++) expect(labelOf(i).style.opacity, `подпись ${i}: своей прозрачности нет`).toBeUndefined();
    } finally {
      g.document = had;
    }
  });
});

describe('кто первым: показанная, с меткой, ближняя', () => {
  // Область: две подписи в одной точке поля — показать можно только одну.
  const at = (d: number, extra: Partial<LabelCand> = {}): LabelCand => ({ x: PHONE.w / 2, y: PHONE.h / 2, w: 80, h: 20, d, lit: false, mark: false, ...extra });

  it('показанная побеждает ближнюю с меткой', () => {
    expect(layLabels([at(50, { mark: true }), at(200, { lit: true })], PHONE)).toEqual([1]);
  });

  it('с меткой побеждает ближнюю без метки', () => {
    expect(layLabels([at(50), at(200, { mark: true })], PHONE)).toEqual([1]);
  });

  it('из равных — ближняя', () => {
    expect(layLabels([at(200), at(50)], PHONE)).toEqual([1]);
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
});
