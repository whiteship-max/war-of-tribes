// Спрайты карты нового вида, что лежат на земле (`tw/mini.ts`; docs/map_tw.md, разделы 4 и 14): осадные работы и знак
// участи. Ключ спрайта называет всё, от чего зависит картинка; нарисованное лежит внутри холста; выпечка
// детерминирована. Холст — записывающая заглушка: каждый вызов кисти ложится в журнал вместе с точками пути,
// пересчитанными через текущее преобразование, — так картинку можно сравнить без браузера, а «обрезано краем» —
// проверить числом. Значки мест и отрядов — `marks.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fate } from '@/world/types';
import { fakeCanvasEnv } from '../fakecanvas';
import { MINI_BUCKETS, type Mini, dropMinis, fellSprite, worksKey, worksSprite } from './mini';

// ---------- Записывающий холст ----------

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

interface Rec {
  /** Журнал кисти: вызовы и присваивания, числа округлены — сравнивается картинка, а не шум плавающей точки. */
  log: string[];
  /** Крайние точки нарисованного в пикселях холста. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

const r4 = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);

function recordingCtx(rec: Rec): CanvasRenderingContext2D {
  let m: Mat = [...ID];
  const stack: Mat[] = [];
  const pt = (x: number, y: number): void => {
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    rec.box.x0 = Math.min(rec.box.x0, px);
    rec.box.y0 = Math.min(rec.box.y0, py);
    rec.box.x1 = Math.max(rec.box.x1, px);
    rec.box.y1 = Math.max(rec.box.y1, py);
  };
  const disc = (x: number, y: number, rx: number, ry: number): void => {
    pt(x - rx, y - ry);
    pt(x + rx, y - ry);
    pt(x - rx, y + ry);
    pt(x + rx, y + ry);
  };
  const gradient = (kind: string) => ({ addColorStop: (o: number, c: string) => rec.log.push(`${kind}.stop ${r4(o)} ${c}`) });
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => stack.push([...m]),
    restore: () => {
      m = stack.pop() ?? [...ID];
    },
    setTransform: (a, b, c, d, e, f) => {
      m = [a, b, c, d, e, f];
    },
    translate: (x, y) => {
      m = mul(m, [1, 0, 0, 1, x, y]);
    },
    scale: (x, y) => {
      m = mul(m, [x, 0, 0, y, 0, 0]);
    },
    rotate: (a) => {
      m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    },
    moveTo: (x, y) => pt(x, y),
    lineTo: (x, y) => pt(x, y),
    quadraticCurveTo: (cx, cy, x, y) => {
      pt(cx, cy);
      pt(x, y);
    },
    rect: (x, y, w, h) => disc(x + w / 2, y + h / 2, w / 2, h / 2),
    fillRect: (x, y, w, h) => disc(x + w / 2, y + h / 2, w / 2, h / 2),
    strokeRect: (x, y, w, h) => disc(x + w / 2, y + h / 2, w / 2, h / 2),
    arc: (x, y, r) => disc(x, y, r, r),
    ellipse: (x, y, rx, ry, rot) => (rot ? disc(x, y, Math.max(rx, ry), Math.max(rx, ry)) : disc(x, y, rx, ry)),
    createLinearGradient: () => gradient('lin'),
    createRadialGradient: () => gradient('rad'),
    measureText: (s: unknown) => ({ width: String(s).length * 6 }),
  };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (t, k) => {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      return (...a: number[]) => {
        rec.log.push(`${k}(${a.map(r4).join(',')})`);
        return methods[k]?.(...a);
      };
    },
    set: (t, k, v) => {
      if (typeof k === 'string') rec.log.push(`${k}=${typeof v === 'object' ? 'grad' : String(r4(v))}`);
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Документ, чьи холсты пишут журнал. Журнал холста спрайта — `recOf(mini)`. */
function recordingEnv(): { restore: () => void } {
  const had = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const rec: Rec = { log: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
      const ctx = recordingCtx(rec);
      return { width: 1, height: 1, rec, getContext: () => ctx, toDataURL: () => 'data:' };
    },
  };
  return {
    restore: () => {
      (globalThis as { document?: unknown }).document = had;
    },
  };
}

const recOf = (m: Mini): Rec => (m.canvas as unknown as { rec: Rec }).rec;
/** Картинка спрайта одной строкой: по ней сравниваются выпечки. */
const pictureOf = (m: Mini): string => recOf(m).log.join('\n');

// ---------- Наборы видов ----------

const B = 40;
const FATES: Fate[] = ['burn', 'captives', 'plunder'];

let env: { restore: () => void };
beforeAll(() => {
  env = recordingEnv();
});
afterAll(() => {
  dropMinis();
  env.restore();
});

// ---------- Ключи ----------

/**
 * Свойство ключа: одинаковый ключ — одинаковая картинка. Проверяется выпечкой каждого вида начисто (кэш
 * сброшен): виды группируются по ключу, и внутри группы журналы кисти обязаны совпасть. Выброшенное из
 * ключа поле, меняющее картинку, склеит в одну группу два разных рисунка — и упадёт именно здесь.
 */
function sameKeySamePicture<L>(looks: L[], key: (l: L) => string, bake: (l: L) => Mini): void {
  const seen = new Map<string, { look: L; picture: string }>();
  for (const l of looks) {
    dropMinis();
    const picture = pictureOf(bake(l));
    const k = key(l);
    const had = seen.get(k);
    if (had) expect(picture === had.picture, `ключ ${k} склеил разные картинки: ${JSON.stringify(had.look)} и ${JSON.stringify(l)}`).toBe(true);
    else seen.set(k, { look: l, picture });
  }
}

describe('спрайты на земле: ключ', () => {
  it('у осадных работ — по ступени каждой стороны, половине, корзине и плотности', () => {
    const keys = new Set<string>();
    for (let f = 0; f <= 8; f++)
      for (let r = 0; r <= 8; r++) for (const half of ['back', 'front'] as const) for (const b of [16, 80]) for (const dpr of [1, 2]) keys.add(worksKey(f, r, half, b, dpr));
    expect(keys.size).toBe(9 * 9 * 2 * 2 * 2);
    const looks: [number, number, 'back' | 'front'][] = [];
    for (const f of [0, 3, 8]) for (const r of [0, 5, 8]) for (const half of ['back', 'front'] as const) looks.push([f, r, half]);
    sameKeySamePicture(looks, ([f, r, h]) => worksKey(f, r, h, B, 1), ([f, r, h]) => worksSprite(f, r, h, B, 1));
  });
});

// ---------- Холст ----------

describe('спрайты на земле: холст', () => {
  it('нарисованное не режется краем холста — работы и знак участи', () => {
    // Граница области: весь холст спрайта, в пикселях холста; запас — полпикселя корзины на сглаживание.
    const within = (m: Mini, at: string, empty = false): void => {
      const { box } = recOf(m);
      const W = m.canvas.width;
      const H = m.canvas.height;
      // Пустой рисунок законен только у передней половины работ на нулевой ступени: рогаток ещё нет.
      expect(Number.isFinite(box.x0), `${at}: рисунок есть`).toBe(!empty);
      if (empty) return;
      expect.soft(box.x0, `${at}: слева`).toBeGreaterThanOrEqual(-0.5);
      expect.soft(box.y0, `${at}: сверху`).toBeGreaterThanOrEqual(-0.5);
      expect.soft(box.x1, `${at}: справа`).toBeLessThanOrEqual(W + 0.5);
      expect.soft(box.y1, `${at}: снизу`).toBeLessThanOrEqual(H + 0.5);
    };
    const fresh = (make: () => Mini): Mini => {
      dropMinis();
      return make();
    };
    for (const b of [MINI_BUCKETS[0], MINI_BUCKETS[MINI_BUCKETS.length - 1]]) {
      for (const f of [0, 4, 8]) {
        for (const half of ['back', 'front'] as const) within(fresh(() => worksSprite(f, f, half, b, 1)), `работы ${f} ${half} @${b}`, f === 0 && half === 'front');
      }
    }
    for (const f of FATES) within(fresh(() => fellSprite(f, 'уведены люди', 2)), `участь ${f}`);
  });

  it('плашка участи — по длине слова, точка сверху посередине', () => {
    const short = fellSprite('burn', 'сожжён', 1);
    const long = fellSprite('captives', 'уведены люди', 1);
    expect(long.w).toBeGreaterThan(short.w);
    // Середина плашки; холст на два пикселя шире её — под тень справа.
    expect(Math.abs(short.ax - short.w / 2)).toBeLessThanOrEqual(1.5);
    expect(short.ay).toBe(0);
  });
});

// ---------- Кэш ----------

describe('спрайты на земле: кэш и детерминизм', () => {
  it('один ключ — один спрайт; сброс кэша печёт заново ту же картинку', () => {
    dropMinis();
    const a = worksSprite(8, 5, 'back', 44, 2);
    // Корзина: 44 и 50 px на клетку — одна корзина (52), тот же спрайт.
    expect(worksSprite(8, 5, 'back', 50, 2)).toBe(a);
    const f = fellSprite('plunder', 'разграблен', 1);
    expect(fellSprite('plunder', 'разграблен', 1)).toBe(f);
    const before = pictureOf(a);
    dropMinis();
    const b = worksSprite(8, 5, 'back', 44, 2);
    expect(b).not.toBe(a);
    expect(pictureOf(b)).toBe(before);
  });

  it('холсты в тесте настоящие для кода: заглушка без журнала тоже печёт без ошибок', () => {
    // Та же выпечка на общей заглушке карты (`fakecanvas.ts`) — без записи: код спрайтов не опирается на
    // особенности записывающего холста.
    env.restore();
    const plain = fakeCanvasEnv();
    try {
      dropMinis();
      for (const half of ['back', 'front'] as const) expect(worksSprite(8, 8, half, 22, 2).w).toBeGreaterThan(0);
      for (const f of FATES) expect(fellSprite(f, 'слово', 2).w).toBeGreaterThan(0);
    } finally {
      dropMinis();
      plain.restore();
      env = recordingEnv();
    }
  });
});
