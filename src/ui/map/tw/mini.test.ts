// Миниатюры карты нового вида (docs/map_tw.md, раздел 4): ключ спрайта называет всё, от чего зависит
// картинка; холст места растёт со стадией; тело (цель пальца) и всё нарисованное лежат внутри холста;
// выпечка детерминирована. Холст — записывающая заглушка: каждый вызов кисти ложится в журнал вместе с
// точками пути, пересчитанными через текущее преобразование, — так картинку можно сравнить без браузера,
// а «обрезано краем» — проверить числом.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fate, Stage } from '@/world/types';
import { fakeCanvasEnv } from '../fakecanvas';
import {
  BADGE_PX,
  MINI_BUCKETS,
  PIN_PX,
  type FlagLook,
  type HostLook,
  type Mini,
  type PinLook,
  type PlaceKind,
  type PlaceLook,
  badgeSprite,
  dropMinis,
  fellSprite,
  flagKey,
  flagSprite,
  hostBody,
  hostKey,
  hostSprite,
  pinKey,
  pinSprite,
  placeBody,
  placeKey,
  placeSprite,
  worksKey,
  worksSprite,
} from './mini';

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

const STAGES: Stage[] = ['camp', 'village', 'stronghold', 'town'];
const KINDS: PlaceKind[] = ['city', 'castle', 'lair', 'ruin'];
const COLORS = ['#e8a43c', '#e06b5a'];
const SIZES = [0, 1, 2, 3, 4] as const;

const PLACES: PlaceLook[] = [];
for (const kind of KINDS)
  for (const stage of STAGES)
    for (const color of COLORS)
      for (const own of [false, true])
        for (const variant of [0, 1, 2]) for (const sacked of [false, true]) PLACES.push({ kind, stage, color, own, variant, sacked });

const HOSTS: HostLook[] = [];
for (const color of COLORS) for (const size of SIZES) for (const west of [false, true]) for (const camp of [false, true]) HOSTS.push({ color, size, west, camp });

const PINS: PinLook[] = [];
for (const kind of KINDS) for (const color of COLORS) for (const own of [false, true]) PINS.push({ kind, color, own });

const FLAGS: FlagLook[] = [];
for (const color of COLORS) for (const size of SIZES) for (const camp of [false, true]) FLAGS.push({ color, size, camp });

const B = 40;

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

describe('миниатюры: ключ спрайта', () => {
  it('у мест — свой ключ на каждое сочетание полей, корзину и плотность', () => {
    const keys = new Set<string>();
    for (const l of PLACES) for (const b of [16, 80]) for (const dpr of [1, 2]) keys.add(placeKey(l, b, dpr));
    expect(keys.size).toBe(PLACES.length * 4);
  });

  it('у мест одинаковый ключ — одинаковая картинка', () => {
    sameKeySamePicture(PLACES, (l) => placeKey(l, B, 1), (l) => placeSprite(l, B, 1));
  });

  it('у войска ключ различает всё, кроме стороны лагеря: лагерь не смотрит никуда', () => {
    const keys = new Set(HOSTS.map((l) => hostKey(l, B, 1)));
    // Поход: цвет × размер × сторона; лагерь: цвет × размер.
    expect(keys.size).toBe(COLORS.length * SIZES.length * 2 + COLORS.length * SIZES.length);
    sameKeySamePicture(HOSTS, (l) => hostKey(l, B, 1), (l) => hostSprite(l, B, 1));
    // Сторона похода картинку меняет: без неё в ключе запад и восток склеились бы.
    dropMinis();
    const east = pictureOf(hostSprite({ color: COLORS[0], size: 2, west: false, camp: false }, B, 1));
    dropMinis();
    const west = pictureOf(hostSprite({ color: COLORS[0], size: 2, west: true, camp: false }, B, 1));
    expect(east === west).toBe(false);
  });

  it('у осадных работ — по ступени каждой стороны, половине, корзине и плотности', () => {
    const keys = new Set<string>();
    for (let f = 0; f <= 8; f++)
      for (let r = 0; r <= 8; r++) for (const half of ['back', 'front'] as const) for (const b of [16, 80]) for (const dpr of [1, 2]) keys.add(worksKey(f, r, half, b, dpr));
    expect(keys.size).toBe(9 * 9 * 2 * 2 * 2);
    const looks: [number, number, 'back' | 'front'][] = [];
    for (const f of [0, 3, 8]) for (const r of [0, 5, 8]) for (const half of ['back', 'front'] as const) looks.push([f, r, half]);
    sameKeySamePicture(looks, ([f, r, h]) => worksKey(f, r, h, B, 1), ([f, r, h]) => worksSprite(f, r, h, B, 1));
  });

  it('у значков мест и стягов — по каждому полю и плотности', () => {
    expect(new Set(PINS.flatMap((l) => [pinKey(l, 1), pinKey(l, 2)])).size).toBe(PINS.length * 2);
    expect(new Set(FLAGS.flatMap((l) => [flagKey(l, 1), flagKey(l, 2)])).size).toBe(FLAGS.length * 2);
    sameKeySamePicture(PINS, (l) => pinKey(l, 1), (l) => pinSprite(l, 1));
    sameKeySamePicture(FLAGS, (l) => flagKey(l, 1), (l) => flagSprite(l, 1));
  });
});

// ---------- Холст ----------

describe('миниатюры: холст', () => {
  it('холст места растёт со стадией — у города, замка и логова', () => {
    for (const kind of ['city', 'castle', 'lair'] as PlaceKind[]) {
      const sizes = STAGES.map((stage) => placeSprite({ kind, stage, color: COLORS[0], own: false, variant: 0, sacked: false }, B, 1));
      for (let i = 1; i < sizes.length; i++) {
        const [a, b] = [sizes[i - 1], sizes[i]];
        const at = `${kind}: ${STAGES[i - 1]} → ${STAGES[i]}`;
        expect(b.w, `${at}, ширина`).toBeGreaterThan(a.w);
        expect(b.h, `${at}, высота`).toBeGreaterThanOrEqual(a.h);
      }
    }
  });

  it('холст места не зависит от раскладки, знамени и разорения: точка места на нём одна на стадию', () => {
    for (const kind of KINDS) {
      for (const stage of STAGES) {
        const all = PLACES.filter((l) => l.kind === kind && l.stage === stage).map((l) => placeSprite(l, B, 1));
        for (const m of all) expect([m.w, m.h, m.ax, m.ay], `${kind} ${stage}`).toEqual([all[0].w, all[0].h, all[0].ax, all[0].ay]);
      }
    }
  });

  it('тело места и войска лежит внутри холста — при любом виде', () => {
    const inside = (m: Mini, b: { rx: number; up: number; down: number }, at: string): void => {
      expect(b.rx, `${at}: тело есть`).toBeGreaterThan(0.1);
      expect(b.up, `${at}: тело есть`).toBeGreaterThan(0.1);
      expect(b.rx * B, `${at}: левый край`).toBeLessThanOrEqual(m.ax + 1e-6);
      expect(b.rx * B, `${at}: правый край`).toBeLessThanOrEqual(m.w - m.ax + 1e-6);
      expect(b.up * B, `${at}: верх`).toBeLessThanOrEqual(m.ay + 1e-6);
      expect(b.down * B, `${at}: низ`).toBeLessThanOrEqual(m.h - m.ay + 1e-6);
    };
    for (const l of PLACES) inside(placeSprite(l, B, 1), placeBody(l), JSON.stringify(l));
    for (const l of HOSTS) inside(hostSprite(l, B, 1), hostBody(l), JSON.stringify(l));
  });

  it('нарисованное не режется краем холста — места, войска, работы, значки, стяги, бейджи, знак участи', () => {
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
      for (const l of PLACES) within(fresh(() => placeSprite(l, b, 1)), `${JSON.stringify(l)} @${b}`);
      for (const l of HOSTS) within(fresh(() => hostSprite(l, b, 1)), `${JSON.stringify(l)} @${b}`);
      for (const f of [0, 4, 8]) {
        for (const half of ['back', 'front'] as const) within(fresh(() => worksSprite(f, f, half, b, 1)), `работы ${f} ${half} @${b}`, f === 0 && half === 'front');
      }
    }
    for (const l of PINS) within(fresh(() => pinSprite(l, 2)), `значок ${JSON.stringify(l)}`);
    for (const l of FLAGS) within(fresh(() => flagSprite(l, 2)), `стяг ${JSON.stringify(l)}`);
    for (const k of ['attack', 'troops', 'siege'] as const) within(fresh(() => badgeSprite(k, 2)), `бейдж ${k}`);
    for (const f of ['burn', 'captives', 'plunder'] as Fate[]) within(fresh(() => fellSprite(f, 'уведены люди', 2)), `участь ${f}`);
  });

  it('значки и бейджи — постоянного размера в пикселях экрана, точка места на значке', () => {
    for (const l of PINS) {
      const m = pinSprite(l, 2);
      expect(m.h).toBeGreaterThanOrEqual(PIN_PX);
      expect(m.ay).toBeGreaterThan(m.h / 2);
    }
    const badge = badgeSprite('attack', 1);
    expect([badge.w, badge.h]).toEqual([BADGE_PX, BADGE_PX]);
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

describe('миниатюры: кэш и детерминизм', () => {
  it('один ключ — один спрайт; сброс кэша печёт заново ту же картинку', () => {
    dropMinis();
    const l: PlaceLook = { kind: 'city', stage: 'town', color: COLORS[0], own: true, variant: 1, sacked: true };
    const a = placeSprite(l, 44, 2);
    // Корзина: 44 и 50 px на клетку — одна корзина (52), тот же спрайт.
    expect(placeSprite({ ...l }, 50, 2)).toBe(a);
    const h = hostSprite({ color: COLORS[1], size: 4, west: true, camp: false }, 30, 1);
    expect(hostSprite({ color: COLORS[1], size: 4, west: true, camp: false }, 30, 1)).toBe(h);
    const before = pictureOf(a);
    dropMinis();
    const b = placeSprite(l, 44, 2);
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
      for (const l of PLACES.filter((p) => p.variant === 0 && p.color === COLORS[0])) expect(placeSprite(l, 22, 2).w).toBeGreaterThan(0);
      for (const l of HOSTS) expect(hostSprite(l, 22, 2).w).toBeGreaterThan(0);
    } finally {
      dropMinis();
      plain.restore();
      env = recordingEnv();
    }
  });
});
