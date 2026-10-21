// Генераторы листа тела набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): волосы прядями, кожа руки,
// кисть-«варежка» с бороздками пальцев, костяшками и ногтями, полоса орнамента. Свет и тень нарисованы в самом листе, как у
// моделей классического Warcraft III; чья ткань и какие пряди — решают меры облика (`consort/cloth.ts`, `herald/cloth.ts`).
import type { SheetBox } from './body';
import { Img, around, boxOf, circle, ellipse, mix, noise, poly, rng, spline, stroke, tone, type RGB } from './paint';

/** Пряди волос на листе: сколько, где начинаются и сужаются, где блики — меры облика. */
export interface StrandSpec {
  /** Сиды шума волокон и кости прядей. */
  seed: readonly [number, number];
  /** Прядей на половину листа (у зеркал — по оси, без изгиба). */
  n: number;
  /** Ширина пряди: от `w` до `w + wv` точек. */
  w: number;
  wv: number;
  /** Строка верха прядей; гладкая макушка — над `cap`, мягкий блик по кругу — на строке `crown`. */
  top: number;
  cap: number;
  crown: number;
  /** Изгиб прядей набирается со строки `wave[0]` за `wave[1]` строк. */
  wave: readonly [number, number];
  /** Пряди сужаются со строки `taper[0]` за `taper[1]` строк. */
  taper: readonly [number, number];
  /** Блики: строка длинного и короткого, их полудлина. */
  shine: readonly [number, number];
  shineLen: readonly [number, number];
}

/**
 * Волосы крупными прядями: основа — тень между прядями, пряди — ленты сверху вниз с изгибом (середина светлая, края тёмные,
 * к концам сужаются), каждая следующая ложится на соседние и даёт на них тень краем; на изгибе — длинный блик и короткий
 * ниже. Блик — тёплый, к меди (не бежевый).
 */
export function hairStrands(img: Img, box: SheetBox, hair: RGB, s: StrandSpec): void {
  const W = box.x1 - box.x0;
  const n = noise(s.seed[0]);
  const r = rng(s.seed[1]);
  const shine = mix(tone(hair, 0.55), [0.96, 0.7, 0.42], 0.42);
  img.fill(tone(hair, -0.55), box);
  img.shape((x, y) => y - s.cap, box, (x, y) => mix(tone(hair, -0.2), shine, 0.3 * Math.exp(-(((y - s.crown) / 6) ** 2))), { soft: 14 });
  const strands: { c: number; w: number; ph: number; amp: number; lift: number }[] = [];
  const N = s.n;
  for (let i = 0; i <= N; i++) {
    const edge = i === 0 || i === N;
    strands.push({ c: box.x0 + (i / N) * W + (edge ? 0 : (r() - 0.5) * 10), w: s.w + r() * s.wv, ph: r() * 6, amp: edge ? 0 : 5 + r() * 4, lift: (i % 2 ? 0.08 : -0.1) + (r() - 0.5) * 0.06 });
  }
  const order = strands.map((_, i) => i).sort((a, b) => (a % 2) - (b % 2));
  for (const i of order) {
    const st = strands[i];
    const cx = (y: number): number => st.c + Math.sin(y * 0.045 + st.ph) * st.amp * Math.min(1, Math.max(0, (y - s.wave[0]) / s.wave[1]));
    const half = (y: number): number => (st.w / 2) * (y < s.taper[0] ? 1 : Math.max(0.15, 1 - (y - s.taper[0]) / s.taper[1]));
    const top = s.top;
    img.shape(
      (x, y) => Math.max(Math.abs(x - cx(y)) - half(y), top - y),
      { x0: st.c - st.w - 12, y0: top - 4, x1: st.c + st.w + 12, y1: box.y1 },
      (x, y) => {
        const u = (x - cx(y)) / half(y);
        const fib = (n(x * 0.05, y * 0.02) - 0.5) * 0.08;
        // Внутри пряди — две тонкие тёмные бороздки (пряди помельче), края — в тени соседней.
        const c = tone(hair, st.lift - 0.26 + 0.52 * (1 - u * u) ** 2 - 1.0 * u ** 6 + fib);
        // Пряди на свету — теплее (к меди), в тени — холоднее.
        return st.lift > 0 ? mix(c, shine, 0.1 * (1 - u * u)) : mix(c, [0.16, 0.13, 0.16], 0.12);
      },
      { soft: 3, alpha: (x, y) => Math.min(1, (y - top + 4) / 18), clip: box },
    );
    // Блик — узкий длинный штрих вдоль пряди на её изгибе, и второй, короче, ниже (у прядей на осях — нет: штрих по оси
    // сузился бы к концам в линию шириной в точку).
    if (st.amp === 0) continue;
    const off = st.amp ? (r() - 0.5) * st.w * 0.16 : 0;
    const L = s.shineLen[0];
    const hy = s.shine[0] + (i % 3) * 7;
    const pts = [hy - L, hy - L / 3, hy + L / 3, hy + L].map((y) => [cx(y) + off, y] as [number, number]);
    img.shape(stroke(spline(pts, 4), (t) => 2 + 7 * Math.sin(Math.PI * t)), boxOf(pts, 12), shine, { soft: 4, alpha: 0.9, clip: box });
    const l = s.shineLen[1];
    const hy2 = s.shine[1] + (i % 2) * 6;
    const pts2 = [hy2 - l, hy2, hy2 + l].map((y) => [cx(y) - off * 0.5, y] as [number, number]);
    img.shape(stroke(spline(pts2, 4), (t) => 1.5 + 6 * Math.sin(Math.PI * t)), boxOf(pts2, 9), mix(shine, hair, 0.35), { soft: 3, alpha: 0.7, clip: box });
  }
}

/** Кожа руки трубкой: снаружи светлее, к телу — в тень; у края рукава (верх листа) — тень от него на `cuff` строк. */
export function skinTube(img: Img, b: SheetBox, skin: RGB, cuff = 16): void {
  img.shape((x, y) => -1, { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }, (x, y) => {
    const u = (x - b.x0) / (b.x1 - b.x0);
    const outer = Math.cos((u - 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const c = Math.max(0, 1 - (y - b.y0) / cuff);
    return tone(skin, 0.18 * outer - 0.3 * (1 - outer) - 0.4 * c);
  });
}

/**
 * Кисть-«варежка» (`body.mitten`): тыльная сторона светлее, ладонь розовее; пальцы — тёмными бороздками, костяшки —
 * бликами, ногти у кончиков; большой палец — свой лист с ногтем.
 */
export function paintMitten(img: Img, h: SheetBox, tb: SheetBox, skin: RGB): void {
  const hw = h.x1 - h.x0;
  const kx = (k: number): number => h.x0 + 1 + k * (hw - 2);
  img.shape((x, y) => -1, { x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1 }, (x, y) => {
    const k = (x - h.x0) / hw;
    const back = Math.cos((k - 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const tipShade = Math.max(0, (y - (h.y1 - 12)) / 12) * 0.2;
    return mix(tone(skin, 0.16 * back - 0.08 - tipShade), mix(skin, [0.9, 0.5, 0.48], 0.25), (1 - back) * 0.5);
  });
  for (const k of [0.44, 0.5, 0.56, 0.94, 0.06, 0.0, 1.0]) {
    const x = kx(k);
    img.shape((px, py) => Math.abs(px - x) - 0.8, { x0: x - 3, y0: h.y0 + 60, x1: x + 3, y1: h.y1 }, tone(skin, -0.55), { soft: 1.2, alpha: 0.7 });
  }
  for (const k of [0.41, 0.47, 0.53, 0.59]) {
    const x = kx(k);
    img.shape(ellipse(x, h.y0 + 58, 3, 2), around(x, h.y0 + 58, 5, 4), tone(skin, 0.35), { soft: 2, alpha: 0.6 });
    img.shape(ellipse(x, h.y1 - 7, 2.4, 3.4), around(x, h.y1 - 7, 4, 5), mix(tone(skin, 0.4), [0.95, 0.75, 0.75], 0.3), { soft: 1 });
  }
  img.shape((x, y) => -1, { x0: tb.x0, y0: tb.y0, x1: tb.x1, y1: tb.y1 }, (x, y) => tone(skin, 0.08 * Math.cos(((x - tb.x0) / (tb.x1 - tb.x0) - 0.5) * Math.PI * 2) - 0.04));
  img.shape(ellipse(tb.x0 + 16, tb.y1 - 7, 3, 4), around(tb.x0 + 16, tb.y1 - 7, 5, 6), mix(tone(skin, 0.4), [0.95, 0.75, 0.75], 0.3), { soft: 1 });
}

/**
 * Полоса орнамента по краю ткани (подол, кайма): тёмная полоса `b0…b1` между двумя светлыми линиями, в ней ромбы (полувысота
 * `half`) с трилистником на полушагах и точки на шагах — у осей зеркального листа (0 и π) ложится точка, а не тонкая вершина
 * ромба; `at` — угол → столбец листа.
 */
export function ornamentBand(img: Img, o: { b0: number; b1: number; x1: number; ground: RGB; line: RGB; steps: number; half: number; at: (a: number) => number }): void {
  const { b0, b1, x1, ground, line, steps, at } = o;
  img.shape((x, y) => Math.max(b0 - y, y - b1), { x0: 0, y0: b0 - 2, x1, y1: b1 + 2 }, ground, { soft: 1.2 });
  for (const y of [b0, b1]) img.shape((x, yy) => Math.abs(yy - y) - 1.2, { x0: 0, y0: y - 3, x1, y1: y + 3 }, tone(line, 0.05), { soft: 1 });
  const mid = (b0 + b1) / 2;
  const hh = o.half;
  for (let k = 0; k <= steps; k++) {
    const half = at((k * Math.PI) / steps);
    const c = at((Math.min(k + 0.5, steps - 0.5) * Math.PI) / steps);
    const d = [
      [c, mid - hh],
      [c + 9, mid],
      [c, mid + hh],
      [c - 9, mid],
    ] as [number, number][];
    img.shape((x, y) => Math.abs(poly(d)(x, y)) - 0.9, boxOf(d, 3), tone(line, 0.15), { soft: 1 });
    img.shape(circle(c, mid, 1.8), around(c, mid, 3), tone(line, 0.35), { soft: 0.9 });
    for (const dx of [-4.2, 4.2]) img.shape(circle(c + dx, mid, 1.1), around(c + dx, mid, 2.5), tone(line, 0.1), { soft: 0.8 });
    img.shape(circle(half, mid, 2.2), around(half, mid, 4), tone(line, 0.2), { soft: 1.2 });
  }
}
