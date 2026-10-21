// Лист тела служанки (ЛЦ-6, docs/characters.md): 512 × 512, кодом, в манере супруги, гонца и советника — свет и тень
// нарисованы в самом листе, мазок, а не аэрограф. Платье — простое сукно приглушённого цвета без золота и орнамента: свет на
// груди и плечах, тень под грудью и к бокам, крупные складки юбки и тень к подолу. Лён (чепец, фартук, сорочка у выреза и
// подкладка закатанных рукавов) — тёплый белый с серо-голубыми тенями складок. Коса — звеньями: каждое звено — пучок прядей
// наискось, блик посередине, тень в стыках; лента у кончика. Поднос — дерево с годовыми кольцами и светлым бортиком.
//
// Чепец, торс и юбка — зеркальные половины (левый край — середина спереди, правый — сзади): узоры у краёв симметричны сами
// по себе, и край не повторяется, поэтому шва на линии зеркала нет (это держит тест).
import { mirrorU } from '../kit/body';
import { paintMitten, skinTube } from '../kit/cloth';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, rng, stroke, tone, type RGB } from '../kit/paint';
import { COIF, SHEETS, SKIRT, TORSO, torsoV } from './figure';
import type { MaidLook } from './looks';

const W = 512;
const ax = (a: number): number => mirrorU(a);
const aOf = (x: number): number => (x / W) * Math.PI;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Строка листа торса по высоте над полом (ряды `figure.TORSO`) и обратно. */
const torsoY = (() => {
  const vs = torsoV();
  return (y: number): number => {
    if (y >= TORSO[0].y) return vs[0];
    for (let i = 1; i < TORSO.length; i++)
      if (y >= TORSO[i].y) {
        const k = (TORSO[i - 1].y - y) / (TORSO[i - 1].y - TORSO[i].y);
        return vs[i - 1] + (vs[i] - vs[i - 1]) * k;
      }
    return vs[vs.length - 1];
  };
})();
function yOfTorso(py: number): number {
  let lo = 0.9;
  let hi = 1.42;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (torsoY(mid) > py) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Вырез платья по углу: высота над полом — скромный круглый, спереди ниже ключиц, к плечам и сзади — выше. */
export const neckline = (a: number): number => {
  const x = clamp01(Math.abs(a) / 1.15);
  return 1.276 + 0.042 * x * x * (3 - 2 * x) + 0.012 * clamp01((Math.abs(a) - 1.6) / 1.2);
};
/** Край сорочки над вырезом платья (полоска льна), м. */
const CHEMISE = 0.011;
/** Пояс фартука: высота завязки над полом. */
const BAND = { y0: 0.94, y1: 0.962 } as const;

export function paintMaidBody(look: MaidLook): Img {
  const img = new Img(W, W);
  const p = look.palette;
  const skin = hex(p.skin);
  const hair = hex(p.hair);
  const dress = hex(p.dress);
  const linen = hex(p.linen);
  const wood = hex(p.wood);
  const ribbon = hex(p.ribbon);
  paintCoif(img, linen);
  paintBraid(img, hair, ribbon);
  paintTorso(img, skin, dress, linen, ribbon);
  paintSkirt(img, dress, linen);
  paintApron(img, linen);
  paintTray(img, wood);
  paintArms(img, skin, dress, linen);
  const rb = SHEETS.ribbon;
  img.shape(() => -1, { x0: rb.x0, y0: rb.y0, x1: rb.x1, y1: rb.y1 }, (x, y) => tone(ribbon, 0.15 - 0.5 * Math.abs((y - rb.y0) / (rb.y1 - rb.y0) - 0.45) + 0.08 * Math.sin(x * 0.4)));
  return img;
}

/** Лён: тёплый белый в свету, серо-голубая тень складок (`k` — свет от −1 до 1). */
function linenAt(linen: RGB, k: number): RGB {
  return k >= 0 ? tone(linen, 0.12 + 0.3 * k) : mix(tone(linen, 0.1 + 0.55 * k), [0.42, 0.46, 0.56], -k * 0.28);
}

// ---------- Чепец ----------

/** Край проёма лица на листе чепца: строка → точка листа, где кончается лён у лица. */
function coifEdgeX(v: number): number {
  for (let i = 1; i < COIF.length; i++) {
    const a = COIF[i - 1];
    const b = COIF[i];
    if (v >= a.v && v <= b.v) {
      const k = (v - a.v) / (b.v - a.v || 1);
      return ax(a.open + (b.open - a.open) * k);
    }
  }
  return v < COIF[0].v ? 0 : ax(COIF[COIF.length - 1].open);
}

function paintCoif(img: Img, linen: RGB): void {
  const C = SHEETS.coif;
  const box = { x0: 0, y0: C.y0, x1: W, y1: C.y1 };
  const n = noise(91);
  // Купол на свету, к затылку и к нижнему краю — в тень; сборки сзади — к кулиске у шеи (веером от макушки).
  img.shape(() => -1, box, (x, y) => {
    const a = aOf(x);
    const v = (y - C.y0) / (C.y1 - C.y0);
    const back = clamp01((a - 1.6) / 1.4);
    const gather = Math.sin(a * 22 + v * 3) * 0.32 * back * v;
    const light = 0.5 - 0.45 * v * v - 0.3 * back * v + (n(x * 0.05, y * 0.2) - 0.5) * 0.12;
    return linenAt(linen, Math.max(-1, Math.min(1, light + gather)));
  });
  // Подворот у лица: светлая полоса вдоль края, шов и тень за подворотом.
  const fold = (x: number, y: number): number => x - coifEdgeX(y);
  img.shape((x, y) => {
    const e = coifEdgeX(y);
    return e > 0 ? fold(x, y) - 24 : 1;
  }, box, (x, y) => linenAt(linen, 0.85 - 0.02 * fold(x, y)), { soft: 3 });
  img.shape((x, y) => (coifEdgeX(y) > 0 ? Math.abs(fold(x, y) - 26) - 1.4 : 1), box, linenAt(linen, -0.75), { soft: 2, alpha: 0.6 });
  img.shape((x, y) => (coifEdgeX(y) > 0 ? Math.abs(fold(x, y) - 21) - 0.6 : 1), box, (x, y) => linenAt(linen, Math.sin(y * 1.3) > 0.2 ? -0.5 : 0.3), { soft: 0.8, alpha: 0.7 });
  // Нижний край у шеи — кулиска: тёмная складка и шнурок.
  // Кулиска — только сзади, под узлом волос; у лица нижний край чепца — подворотом, светлый.
  img.shape((x, y) => Math.max(C.y1 - 4 - y, ax(2.1) - x), { x0: 0, y0: C.y1 - 6, x1: W, y1: C.y1 }, (x) => linenAt(linen, -0.45 + 0.3 * Math.sin(x * 0.35)), { soft: 2 });
}

// ---------- Коса ----------

function paintBraid(img: Img, hair: RGB, ribbon: RGB): void {
  const B = SHEETS.braid;
  const h = B.y1 - B.y0;
  const tail = B.x1 - 58;
  const r = rng(43);
  // Звенья: на сечение — по звену (`figure.BRAID_SEG` × узлы), пряди наискось, чередуясь, блик в середине звена.
  const links = 14;
  img.shape(() => -1, { x0: B.x0, y0: B.y0, x1: tail, y1: B.y1 }, (x, y) => {
    const t = (x - B.x0) / (tail - B.x0);
    const k = t * links;
    const ph = k - Math.floor(k);
    const v = (y - B.y0) / h;
    // Звено — выпуклое: свет у середины по длине и по кругу (верх кольца — к свету), стыки — тёмные.
    const round = Math.cos((v - 0.25) * Math.PI * 2) * 0.35;
    const lobe = Math.sin(ph * Math.PI) ** 0.6;
    const dir = Math.floor(k) % 2 ? 1 : -1;
    const strands = Math.sin((v * 7 + dir * ph * 3.2) * Math.PI) * 0.12;
    return tone(hair, -0.75 + 1.0 * lobe + round * lobe + strands);
  });
  for (let i = 0; i < 160; i++) {
    const x0 = B.x0 + r() * (tail - B.x0);
    const y0 = B.y0 + r() * h;
    const k = Math.floor(((x0 - B.x0) / (tail - B.x0)) * links);
    const dir = k % 2 ? 1 : -1;
    const pts: [number, number][] = [
      [x0, y0],
      [x0 + 8, y0 + dir * 6],
    ];
    img.shape(stroke(pts, 0.7), boxOf(pts, 2), tone(hair, r() > 0.5 ? 0.5 : -0.5), { soft: 0.8, alpha: 0.35 });
  }
  // Кисточка ниже ленты: пряди вдоль, кончики светлее.
  img.shape(() => -1, { x0: tail, y0: B.y0, x1: B.x1, y1: B.y1 }, (x, y) => tone(hair, -0.3 + 0.35 * Math.sin(y * 0.9) + 0.2 * ((x - tail) / 58)));
  // Лента-кольцо (у кончика) — на листе ленты; здесь — тень у кольца.
  img.shape((x) => Math.abs(x - tail) - 2, { x0: tail - 4, y0: B.y0, x1: tail + 4, y1: B.y1 }, tone(mix(hair, ribbon, 0.3), -0.8), { soft: 2, alpha: 0.6 });
}

// ---------- Торс ----------

function paintTorso(img: Img, skin: RGB, dress: RGB, linen: RGB, ribbon: RGB): void {
  const T = SHEETS.torso;
  const box = { x0: 0, y0: T.y0, x1: W, y1: T.y1 };
  const n = noise(57);
  const P = (a: number, h: number): [number, number] => [ax(a), torsoY(h)];
  img.shape(() => -1, box, (x, y) => {
    const a = aOf(x);
    const h = yOfTorso(y);
    const side = clamp01((Math.abs(a) - 0.9) / 1.2);
    const nl = neckline(a);
    if (h > nl + CHEMISE) {
      // Кожа: шея под подбородком в тени, к ключицам светлеет, бока шеи — в тень.
      const up = clamp01((h - 1.312) / 0.032);
      const c = flesh(skin, 0.1 - 1.05 * up - 0.4 * side - 0.3 * clamp01((Math.abs(a) - 0.4) / 1.1) * up);
      return up > 0.3 ? mix(c, [0.42, 0.2, 0.12], 0.42 * up) : c;
    }
    if (h > nl) return linenAt(linen, 0.3 - 0.6 * side);
    // Платье: верх груди и плечи на свету, к поясу и к бокам — в тень; сукно — зерном.
    const down = clamp01((nl - h) / 0.3);
    const wool = (n(x * 0.2, y * 0.5) - 0.5) * 0.1;
    return tone(dress, 0.18 - 0.38 * down - 0.45 * side + wool);
  });
  // Ключицы и ложбинка шеи — лёгкой тенью и светом.
  const cb = P(0.42, 1.284);
  img.shape(ellipse(cb[0], cb[1], 30, 2, 0.1), around(cb[0], cb[1], 36, 6), flesh(skin, 0.35), { soft: 3, alpha: 0.55 });
  img.shape(ellipse(cb[0], cb[1] + 3, 26, 1.8, 0.1), around(cb[0], cb[1] + 3, 32, 6), flesh(skin, -0.3), { soft: 3, alpha: 0.35 });
  // Сорочка у выреза: сборки мелкими складками и тень от края платья.
  for (let i = 1; i < 48; i++) {
    const x = ax((i * Math.PI) / 48);
    const top = torsoY(neckline(aOf(x)) + CHEMISE) + 1;
    const bot = torsoY(neckline(aOf(x)));
    img.shape((px) => Math.abs(px - x) - 1.1, { x0: x - 3, y0: top, x1: x + 3, y1: bot + 1 }, linenAt(linen, i % 2 ? -0.35 : 0.35), { soft: 2, alpha: 0.28 });
  }
  img.shape((x, y) => Math.abs(y - torsoY(neckline(aOf(x))) + 1.2) - 1.3, box, tone(dress, -0.75), { soft: 1.6, alpha: 0.7 });
  // Грудь под сукном: свет на верхней дуге, тень под ней.
  const bust = P(0.5, 1.165);
  img.shape(ellipse(bust[0], bust[1], 30, 9), around(bust[0], bust[1], 42, 16), tone(dress, 0.32), { soft: 10, alpha: 0.55 });
  const under = P(0.5, 1.095);
  img.shape(ellipse(under[0], under[1], 38, 6), around(under[0], under[1], 48, 14), tone(dress, -0.7), { soft: 9, alpha: 0.5 });
  // Шнуровка спереди: щель с сорочкой, шнур крест-накрест, люверсы — по оси (зеркало ничего не ломает).
  const lace0 = torsoY(neckline(0)) + 3;
  const lace1 = torsoY(0.97);
  img.shape((x) => x - 2.4, { x0: 0, y0: lace0, x1: 5, y1: lace1 }, linenAt(linen, -0.35), { soft: 1 });
  for (let y = lace0 + 2; y < lace1 - 6; y += 11) {
    for (const [a0, a1] of [
      [y, y + 10],
      [y + 10, y],
    ])
      img.shape(stroke([[-8, a0], [8, a1]], 1.6), { x0: 0, y0: y - 2, x1: 11, y1: y + 12 }, tone(ribbon, -0.1), { soft: 1 });
    img.shape(circle(8.5, y + 0.5, 1.7), around(8.5, y + 0.5, 3.4), tone(dress, -0.85), { soft: 0.8 });
  }
  // Боковой шов и вытачка — тонкой тенью со светом рядом.
  for (const a of [1.55]) {
    const x = ax(a);
    img.shape((px, py) => Math.max(Math.abs(px - x) - 0.9, torsoY(neckline(aOf(px))) + 2 - py), { x0: x - 3, y0: T.y0, x1: x + 3, y1: T.y1 }, tone(dress, -0.7), { soft: 1.3, alpha: 0.6 });
  }
  // Пояс фартука по талии: льняная лента вокруг, сзади — бант.
  const b0 = torsoY(BAND.y1);
  img.shape((x, y) => b0 - y, { x0: 0, y0: b0 - 4, x1: W, y1: T.y1 }, (x, y) => linenAt(linen, 0.5 - 0.6 * clamp01((aOf(x) - 1) / 2) - 0.25 * ((y - b0) / 6)), { soft: 1.2 });
  img.shape((x, y) => Math.abs(y - b0 - 0.5) - 0.8, { x0: 0, y0: b0 - 3, x1: W, y1: b0 + 4 }, tone(dress, -0.8), { soft: 1.4, alpha: 0.55 });
  // Бант — на середине спины, на линии зеркала: петля на половине листа, вторая — её отражение.
  const bow: [number, number] = [W, b0 - 9];
  const loop = ellipse(bow[0] - 9, bow[1], 10, 6, 0.3);
  img.shape(loop, around(bow[0] - 9, bow[1], 12, 8), linenAt(linen, 0.4), { soft: 1.2 });
  img.shape((x, y) => Math.abs(loop(x, y) + 2.5) - 0.8, around(bow[0] - 9, bow[1], 12, 8), linenAt(linen, -0.6), { soft: 1, alpha: 0.6 });
  img.shape(ellipse(bow[0], bow[1], 4, 4), around(bow[0], bow[1], 6, 6), linenAt(linen, 0.1), { soft: 1 });
}

// ---------- Юбка ----------

function paintSkirt(img: Img, dress: RGB, linen: RGB): void {
  const S = SHEETS.skirt;
  const box = { x0: 0, y0: S.y0, x1: W, y1: S.y1 };
  const r = rng(73);
  const n = noise(79);
  const hem0 = SKIRT[SKIRT.length - 1].v;
  img.shape(() => -1, box, (x, y) => {
    const a = aOf(x);
    const k = (y - S.y0) / (S.y1 - S.y0);
    const fold = Math.cos(8 * a);
    const amp = 0.12 + 0.3 * k;
    const wool = (n(x * 0.08, y * 0.02) - 0.5) * 0.18 * (0.4 + k);
    const light = 0.12 * Math.exp(-(((y - (S.y0 + 26)) / 22) ** 2)) - 0.3 * k ** 1.4 - 0.18 * clamp01((Math.abs(a) - 1.2) / 1.5);
    return tone(dress, light + fold * amp + wool);
  });
  for (let i = 0; i < 34; i++) {
    const x = 12 + r() * (W - 24);
    const y0 = S.y0 + 18 + r() * 40;
    const pts: [number, number][] = [0, 0.5, 1].map((t) => [x + Math.sin(t * 3 + i) * 4 * t, y0 + (hem0 - y0 - 8) * t]);
    img.shape(stroke(pts, (t) => 1 + 2.4 * t), boxOf(pts, 4), r() > 0.5 ? tone(dress, 0.25) : tone(dress, -0.45), { soft: 2, alpha: 0.32 });
  }
  // Пояс фартука и над ним — лента по талии (продолжение торса), под ней — тень.
  img.shape((x, y) => y - (S.y0 + 4), { x0: 0, y0: S.y0, x1: W, y1: S.y0 + 6 }, (x) => linenAt(linen, 0.35 - 0.6 * clamp01((aOf(x) - 1) / 2)), { soft: 1 });
  img.shape((x, y) => Math.abs(y - (S.y0 + 7)) - 1.5, { x0: 0, y0: S.y0 + 4, x1: W, y1: S.y0 + 12 }, tone(dress, -0.65), { soft: 2, alpha: 0.5 });
  // Концы завязок фартука сзади — по юбке вниз от банта.
  {
    // Концы завязок — от банта на середине спины вниз и в стороны (вторая — отражение).
    const pts: [number, number][] = [
      [W - 2, S.y0 + 2],
      [W - 8, S.y0 + 22],
      [W - 11, S.y0 + 40],
    ];
    img.shape(stroke(pts, (t) => 3.4 - 0.8 * t), boxOf(pts, 5), linenAt(linen, 0.2), { soft: 1.1 });
  }
  // Подол: подшивка темнее, край — пыль у пола.
  img.shape((x, y) => Math.abs(y - (hem0 - 9)) - 0.7, { x0: 0, y0: hem0 - 12, x1: W, y1: hem0 - 6 }, tone(dress, -0.6), { soft: 1, alpha: 0.6 });
  img.shape((x, y) => hem0 - 4 - y, { x0: 0, y0: hem0 - 6, x1: W, y1: S.y1 }, tone(dress, -0.75), { soft: 2 });
}

// ---------- Фартук ----------

function paintApron(img: Img, linen: RGB): void {
  const A = SHEETS.apron;
  const box = { x0: A.x0, y0: A.y0, x1: A.x1, y1: A.y1 };
  const n = noise(97);
  img.shape(() => -1, box, (x, y) => {
    const u = (x - A.x0) / (A.x1 - A.x0);
    const v = (y - A.y0) / (A.y1 - A.y0);
    // Складки от пояса вниз: у пояса — частые сборки, ниже — крупные мягкие; к краям и к низу — в тень.
    const gather = Math.sin(u * Math.PI * 9) * (0.5 - 0.3 * v) * (v < 0.25 ? 1 : 0.5);
    const big = Math.sin(u * Math.PI * 3.2 + 0.4) * 0.25 * v;
    return linenAt(linen, 0.45 - 0.35 * u * u - 0.35 * v + gather * 0.6 + big + (n(x * 0.1, y * 0.2) - 0.5) * 0.12);
  });
  // Подшивка по низу и по краю, пояс сверху.
  img.shape((x, y) => Math.abs(y - (A.y1 - 4)) - 0.6, box, linenAt(linen, -0.5), { soft: 0.8, alpha: 0.7 });
  img.shape((x) => Math.abs(x - (A.x1 - 5)) - 0.6, box, linenAt(linen, -0.5), { soft: 0.8, alpha: 0.6 });
  img.shape((x, y) => y - (A.y0 + 4), { x0: A.x0, y0: A.y0, x1: A.x1, y1: A.y0 + 6 }, linenAt(linen, 0.6), { soft: 1 });
  img.shape((x, y) => Math.abs(y - (A.y0 + 5)) - 0.7, { x0: A.x0, y0: A.y0 + 3, x1: A.x1, y1: A.y0 + 8 }, linenAt(linen, -0.7), { soft: 1, alpha: 0.6 });
}

// ---------- Поднос ----------

function paintTray(img: Img, wood: RGB): void {
  const T = SHEETS.tray;
  const cx = T.x0 + 32;
  const cy = (T.y0 + T.y1) / 2;
  img.shape(() => -1, { x0: T.x0, y0: T.y0, x1: T.x1, y1: T.y1 }, (x, y) => tone(wood, 0.05 + 0.15 * Math.sin(y * 0.6 + x * 0.05)));
  // Дно: годовые кольца, свет сверху, тень у бортика.
  img.shape(circle(cx, cy, 30), around(cx, cy, 31), (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return tone(wood, 0.18 + 0.12 * Math.sin(d * 1.1 + (x - cx) * 0.08) - 0.5 * clamp01((d - 22) / 8));
  });
  img.shape(ellipse(cx - 6, cy - 8, 12, 6, -0.4), around(cx - 6, cy - 8, 16, 10), tone(wood, 0.6), { soft: 8, alpha: 0.4 });
  // Бортик: верх светлый (кромка), бок — тёмнее, низ — в тень.
  img.shape((x, y) => y - (T.y0 + 12), { x0: T.x0 + 66, y0: T.y0, x1: T.x1, y1: T.y0 + 14 }, tone(wood, 0.45), { soft: 2 });
  img.shape((x, y) => (T.y0 + 30) - y, { x0: T.x0 + 66, y0: T.y0 + 28, x1: T.x1, y1: T.y1 }, tone(wood, -0.55), { soft: 3 });
}

// ---------- Руки ----------

function paintArms(img: Img, skin: RGB, dress: RGB, linen: RGB): void {
  const sl = SHEETS.sleeve;
  const sw = sl.x1 - sl.x0;
  // Рукав: верх на свету, к локтю — в тень; валик закатанного рукава — подкладка льном наружу, по краям — тень.
  img.shape(() => -1, { x0: sl.x0, y0: sl.y0, x1: sl.x1, y1: sl.y1 }, (x, y) => {
    const u = (x - sl.x0) / sw;
    const outer = Math.cos((u - 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const v = y - sl.y0;
    if (v >= 82) {
      const roll = Math.sin(((v - 82) / 46) * Math.PI);
      return linenAt(linen, -0.5 + 0.95 * roll - 0.35 * (1 - outer) + 0.15 * Math.sin(u * 40));
    }
    return tone(dress, 0.18 * Math.exp(-(((v - 8) / 16) ** 2)) - 0.32 * (v / 82) - 0.3 * (1 - outer) + 0.1 * Math.sin(u * Math.PI * 10 + v * 0.05));
  });
  img.shape((x, y) => Math.abs(y - (sl.y0 + 82)) - 1.4, { x0: sl.x0, y0: sl.y0 + 78, x1: sl.x1, y1: sl.y0 + 86 }, tone(dress, -0.8), { soft: 1.5, alpha: 0.7 });
  skinTube(img, SHEETS.fore, skin);
  paintMitten(img, SHEETS.hand, SHEETS.thumb, skin);
}
