// Лист кота (ЛЦ-4, docs/characters.md): шерсть, полосы, светотень и глаза — кодом в массив точек набора (`kit/paint`), как
// листы людей: один и тот же лист в игре, на стенде и в тестах. Порядок — как у художника WC3: тон окраса по маскам
// (светлая грудь и морда, «носки»), светотень формы (свет по спине и на лбу, тень под брюхом и под подбородком), узор полос
// своим генератором (`tabby`), черты морды (обводка глаз, мочка носа, рот, «М» на лбу), потом мазки шерсти по течению
// (`kit/fur`) — тоном из-под себя, и последним — то, что поверх шерсти не пишется: глаза, веко, усы, клубок.
import { furStrokes } from '../kit/fur';
import { Img, boxOf, circle, ellipse, hex, mix, mul, noise, poly, rng, spline, stroke, tone, type Box, type RGB } from '../kit/paint';
import { chinOf, dirOf, eyeRimLonLat, headPt, headUv, PX, SHEET, EYE_PX } from './figure';
import type { CatLook } from './looks';

const DEG = Math.PI / 180;
const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, x));
const sm = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** Голова листа: точка → долгота и широта (обратное `figure.headUv`). */
const lonOf = (x: number): number => (x / PX) * Math.PI;
const latOf = (y: number): number => Math.asin(clamp(1 - y / (SHEET.head.y1 / 2), -1, 1));
/** Долгота и широта → точка листа. */
const at = (lonDeg: number, latDeg: number): [number, number] => {
  const [u, v] = headUv(lonDeg * DEG, latDeg * DEG);
  return [u * PX, v * PX];
};

/** Закрасить коробку функцией точки (null — не трогать). */
function paintBox(img: Img, b: Box, f: (x: number, y: number) => RGB | null): void {
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const c = f(x + 0.5, y + 0.5);
      if (c) img.set(x, y, c);
    }
}

/**
 * Светотень шерсти: тень — глубже и насыщенней того же тона (рыжий в тени — бурый, а не серый), лёгкая прохлада только в
 * самой глубине; свет — к тёплому.
 */
function pelt(base: RGB, k: number, light = 0.55): RGB {
  if (k >= 0) return tone(base, k * light);
  const s = Math.min(1, -k);
  const deep: RGB = [base[0] ** 1.5, base[1] ** 1.5, base[2] ** 1.5];
  return mix(mix(mul(base, 1 - 0.38 * s), mul(deep, 0.85), 0.45 * s), [0.16, 0.14, 0.2], 0.12 * s * s);
}

/** Свет по форме: нормаль → сдвиг тона (свет сверху и спереди, тень снизу). */
const lit = (n: readonly [number, number, number]): number => n[1] * 0.78 + n[2] * 0.3 - 0.12;

/**
 * Узор полос — свой генератор (ЛЦ-4): «макрель» — узкие полосы от хребта вниз по бокам, с изгибом к хвосту и
 * расщеплением книзу, тёмный ремень по хребту; на лапах и хвосте — кольца. Строки — в точках листа.
 */
export function tabby(img: Img, look: CatLook): void {
  const p = look.palette;
  const k = look.marks.tabby;
  if (k <= 0) return;
  const dark = hex(p.stripe);
  const r = rng(71);
  const t = SHEET.torso;
  const W = t.x1 - t.x0;
  const H = t.y1 - t.y0;
  const alpha = 0.78 * k;
  // Ремень по хребту.
  img.shape(stroke([[t.x0 - 4, t.y0], [t.x0 - 2, t.y1]], 26), { x0: t.x0, y0: t.y0, x1: t.x0 + 20, y1: t.y1 }, dark, { soft: 10, alpha: alpha * 0.9, clip: t });
  // Полосы: от хребта к брюху, с изгибом назад и расщеплением.
  for (let i = 0; i < 12; i++) {
    const y = t.y0 + 10 + (i + 0.3 + (r() - 0.5) * 0.4) * (H / 12);
    const len = W * (0.48 + r() * 0.16);
    const wave = (r() - 0.5) * 10;
    const pts = spline(
      [
        [t.x0 + 6, y - 2],
        [t.x0 + len * 0.35, y + 3 + wave],
        [t.x0 + len * 0.7, y + 9 - wave * 0.5],
        [t.x0 + len, y + 13 + wave],
      ],
      5,
    );
    const w0 = 11 + r() * 4;
    img.shape(stroke(pts, (s) => w0 * (1 - 0.6 * s)), boxOf(pts, w0), dark, { soft: 4.5, alpha, clip: t });
    if (r() < 0.55) {
      const j = Math.floor(pts.length * (0.45 + r() * 0.2));
      const br = [pts[j], [pts[j][0] + len * 0.25, pts[j][1] + 10 + r() * 6] as [number, number]];
      img.shape(stroke(br, (s) => w0 * 0.45 * (1 - 0.7 * s)), boxOf(br, w0), dark, { soft: 2.5, alpha: alpha * 0.85, clip: t });
    }
  }
  // Шея: «ожерелья».
  const n = SHEET.neck;
  for (let i = 0; i < 2; i++) {
    const y = n.y0 + 12 + i * 16;
    img.shape(stroke([[n.x0, y], [n.x0 + (n.x1 - n.x0) * 0.5, y + 2], [n.x1, y + 6]], (s) => 7 * (1 - 0.5 * s)), n, dark, { soft: 3, alpha: alpha * (i ? 0.7 : 0.9), clip: n });
  }
  // Лапы: поперечные кольца, сверху гуще.
  for (const b of [SHEET.fore, SHEET.hind])
    for (let i = 0; i < 4; i++) {
      const y = b.y0 + 18 + i * 22 + (b === SHEET.hind ? 6 : 0);
      img.shape(stroke([[b.x0 - 2, y], [b.x1 + 2, y + 4]], 7 - i), b, dark, { soft: 2.5, alpha: alpha * (0.85 - i * 0.12), clip: b });
    }
  // Хвост: кольца, к концу шире и чаще, кончик тёмный.
  const tl = SHEET.tail;
  for (let i = 0; i < 7; i++) {
    const y = tl.y0 + 22 + i * 30 + i * i * 0.6;
    if (y > tl.y1 - 30) break;
    img.shape(stroke([[tl.x0 - 2, y], [tl.x0 + (tl.x1 - tl.x0) * 0.5, y + 3], [tl.x1 + 2, y + 1]], 10 + i), tl, dark, { soft: 3, alpha: alpha * 0.9, clip: tl });
  }
  img.shape(poly([[tl.x0, tl.y1 - 34], [tl.x1, tl.y1 - 30], [tl.x1, tl.y1], [tl.x0, tl.y1]]), tl, dark, { soft: 8, alpha: alpha * 0.9, clip: tl });
  // Голова: «М» на лбу — линии вверх от бровей к макушке, по затылку — полосы к шее; от наружного угла глаза — к щеке.
  const h = SHEET.head;
  // Ширина — в миллиметрах шерсти: точек листа на миллиметр по долготе — 512/π на радиус головы и косинус широты.
  const headLine = (pts: [number, number][], mm: number, a = alpha): void => {
    const ln = spline(pts.map(([lo, la]) => at(lo, la)), 5);
    const lat = pts.map((q) => q[1] * DEG);
    const wAt = (s: number): number => {
      const la = lat[Math.min(lat.length - 1, Math.floor(s * (lat.length - 1) + 0.5))];
      return (mm / 1000) * (PX / Math.PI) / (0.046 * Math.max(0.35, Math.cos(la)));
    };
    const wMax = Math.max(...[0, 0.5, 1].map(wAt));
    img.shape(stroke(ln, (s) => wAt(s) * (1 - 0.6 * Math.abs(s - 0.4))), boxOf(ln, wMax), dark, { soft: 3, alpha: a, clip: h });
  };
  // «М»: сужающиеся штрихи над глазами, расходятся к макушке и там распадаются на полосы.
  headLine([[1.5, 22], [2.5, 34], [4, 50], [7, 66], [12, 80]], 2.6);
  headLine([[9, 19], [10.5, 30], [13, 44], [19, 58], [30, 72]], 2.3);
  headLine([[17, 18], [21, 28], [30, 42], [46, 56]], 2, alpha * 0.75);
  headLine([[24, 13], [21, 17.5], [16, 19], [12, 17]], 1.2, alpha * 0.55);
  for (const lo of [96, 124, 152]) headLine([[lo - 8, 78], [lo, 52], [lo + 3, 18], [lo - 2, -16]], 4.5, alpha * 0.8);
  headLine([[47, 2], [60, -2], [74, -8], [88, -10]], 2.2, alpha * 0.9);
  headLine([[44, -9], [58, -14], [72, -21], [86, -26]], 1.9, alpha * 0.8);
}

/** Светлое окраса по месту на голове (0…1): подбородок и горло, подушечки усов, у чёрно-белого — маска до лба. */
function paleHead(look: CatLook, lon: number, lat: number): number {
  const m = look.marks.muzzle;
  const L = Math.abs(lon) / DEG;
  const B = lat / DEG;
  const throat = sm(-26, -40, B) * (1 - sm(70, 110, L));
  const pads = sm(-4, -14, B) * (1 - sm(20, 34, L));
  // Маска чёрно-белого: «домик» между глаз — выше у носа, уже к лбу.
  const top = -8 + 44 * m * m;
  const blaze = m > 0.5 ? (1 - sm(top - 6, top, B + L * 1.6)) * (1 - sm(14, 30, L)) : 0;
  const cheekPale = m < 0.5 ? 0.35 * sm(-10, -22, B) * (1 - sm(54, 80, L)) : sm(-12, -24, B) * (1 - sm(56, 74, L));
  return clamp(Math.max(throat, pads, blaze, cheekPale));
}

export function paintCat(look: CatLook): Img {
  const p = look.palette;
  const fur = hex(p.fur);
  const pale = hex(p.pale);
  const stripe = hex(p.stripe);
  const img = new Img(PX, PX);
  img.fill(mix(fur, stripe, 0.4));
  const grain = noise(19);
  const n2 = (x: number, y: number): number => grain(x / 9, y / 9) - 0.5;
  const tux = look.marks.tabby === 0;

  // ---------- Голова ----------
  const H = SHEET.head;
  paintBox(img, H, (x, y) => {
    const lon = lonOf(x);
    const lat = latOf(y);
    const n = dirOf(lon, lat);
    const pk = paleHead(look, lon, lat);
    let c = mix(fur, pale, pk);
    // Лепка головы: лоб и спинка носа — к свету, бока головы за скулой и под глазами — в тень, щёки — круглее.
    const L = Math.abs(lon) / DEG;
    const B = lat / DEG;
    const g = (l0: number, b0: number, sl: number, sb: number): number => Math.exp(-(((L - l0) / sl) ** 2) - ((B - b0) / sb) ** 2);
    // Плоскости, как у лиц людей: свет — лоб, переносица, верх щёк над усами; тень — под скулой, у края морды, под глазом.
    const form = lit(n) * (tux ? 1.0 : 0.9) + 0.6 * g(0, 24, 20, 16) + 0.45 * g(0, -4, 7, 9) + 0.4 * g(22, -12, 10, 6) - 0.6 * sm(58, 100, L) * sm(25, -15, B) - 0.55 * g(38, -16, 12, 7) - 0.4 * g(30, -30, 14, 8) - 0.35 * g(30, 30, 18, 8);
    // Морда — с размахом, как лица людей набора: плоскости света и тени читаются издали.
    // У чёрного — свет лишь блеском: тёплый белый свет сделал бы его серым.
    c = pelt(c, form * 1.5 - 0.15 + n2(x, y) * 0.18, tux ? 0.3 * (1 - pk) + 0.9 * pk : 0.9);
    // Под подбородком и у шеи — тень.
    c = pelt(c, -0.5 * sm(-30, -70, lat / DEG));
    return c;
  });
  // ---------- Туловище ----------
  const T = SHEET.torso;
  paintBox(img, T, (x, y) => {
    const a = ((x - T.x0) / (T.x1 - T.x0)) * Math.PI;
    const z = 0.16 - ((y - T.y0 - 2) / (T.y1 - T.y0 - 4)) * 0.36;
    const n: [number, number, number] = [Math.sin(a), Math.cos(a), 0];
    const bib = look.marks.bib;
    // Манишка спереди и снизу, брюхо — светлое.
    const chest = sm(0.04, 0.1, z) * sm(70, 115, a / DEG) * bib;
    const belly = sm(125, 155, a / DEG) * (bib > 0.8 ? 1 : 0.75 * bib);
    let c = mix(fur, pale, clamp(Math.max(chest, belly)));
    // Тень под брюхом сильнее света: кот стоит на свету сверху.
    c = pelt(c, lit(n) * 0.95 - 0.45 * sm(115, 180, a / DEG) + n2(x, y) * 0.16, tux ? 0.35 : 0.55);
    return c;
  });
  // ---------- Шея ----------
  const N = SHEET.neck;
  paintBox(img, N, (x, y) => {
    // У шеи угол 0 листа — горло (кольца шеи смотрят вниз-вперёд), π — загривок; здесь `a` — от загривка, как у туловища.
    const a = Math.PI - ((x - N.x0) / (N.x1 - N.x0)) * Math.PI;
    const n: [number, number, number] = [Math.sin(a), Math.cos(a) * 0.8, 0.3];
    const c = mix(fur, pale, sm(look.marks.bib > 0.8 ? 75 : 110, look.marks.bib > 0.8 ? 105 : 150, a / DEG) * look.marks.bib);
    return pelt(c, lit(n) * 0.9 + n2(x, y) * 0.16, tux ? 0.35 : 0.55);
  });
  // ---------- Хвост ----------
  const TL = SHEET.tail;
  paintBox(img, TL, (x, y) => {
    const a = ((x - TL.x0) / (TL.x1 - TL.x0)) * Math.PI;
    return pelt(fur, Math.cos(a) * 0.55 - 0.1 + n2(x, y) * 0.2, tux ? 0.35 : 0.55);
  });
  // ---------- Лапы ----------
  for (const [b, socks] of [
    [SHEET.fore, look.marks.socks],
    [SHEET.hind, look.marks.socks * 0.8],
  ] as const)
    paintBox(img, b, (x, y) => {
      const a = ((x - b.x0) / (b.x1 - b.x0)) * Math.PI;
      const t = (y - b.y0) / (b.y1 - b.y0);
      const inner = look.marks.bib > 0.8 && b === SHEET.fore ? sm(0, 0.2, t) * sm(100, 160, a / DEG) * 0.6 : 0;
      const c = mix(fur, pale, clamp(Math.max(sm(1 - socks - 0.05, 1 - socks + 0.03, t) * (socks > 0 ? 1 : 0), inner)));
      return pelt(c, Math.cos(a) * 0.35 - t * 0.1 + 0.1 - 0.4 * sm(0, 0.15, -t + 0.12) + n2(x, y) * 0.16);
    });
  const P = SHEET.paw;
  paintBox(img, P, (x, y) => {
    const front = x < (P.x0 + P.x1) / 2;
    const socks = look.marks.socks > 0;
    const c = socks ? pale : fur;
    const t = (y - P.y0) / (P.y1 - P.y0);
    return tone(c, 0.25 - t * 0.6 + (front ? 0.05 : 0) + n2(x, y) * 0.12);
  });
  // Пальцы: тёмные бороздки спереди подушечек (перед стопы — левый край половины листа).
  for (const half of [0, 1]) {
    const x0 = P.x0 + half * 32;
    for (const dx of [5, 10])
      img.shape(stroke([[x0 + dx, P.y0 + 8], [x0 + dx, P.y0 + 20]], 1.5), { x0, y0: P.y0, x1: x0 + 32, y1: P.y1 }, mul(look.marks.socks > 0 ? pale : fur, 0.55), { soft: 1, alpha: 0.6 });
  }
  // Узор и черты — поверх тона всех частей.
  tabby(img, look);
  face(img, look);

  // ---------- Мазки шерсти ----------
  const seed = (look.palette.fur & 0xffff) + 3;
  const spread = tux ? 0.55 : 0.4;
  furStrokes(img, H, { flow: (x, y) => (latOf(y) < -0.35 ? 0.9 : latOf(y) > 0.7 ? -0.25 : 0.12), count: 2600, len: 9, width: 2.2, spread, seed, mask: (x, y) => !nearFeature(x, y) });
  furStrokes(img, T, { flow: () => 1.25, count: 2400, len: 14, width: 2.8, spread, seed: seed + 1 });
  furStrokes(img, N, { flow: () => 0.4, count: 500, len: 10, width: 2.4, spread, seed: seed + 2 });
  furStrokes(img, TL, { flow: () => Math.PI / 2, count: 1400, len: 16, width: 3, spread, seed: seed + 3 });
  for (const b of [SHEET.fore, SHEET.hind]) furStrokes(img, b, { flow: () => Math.PI / 2, count: 380, len: 9, width: 2, spread, seed: seed + 4 });
  // Черты морды — поверх мазков ещё раз чётко (нос, рот, обводка глаз).
  faceLines(img, look);
  eyes(img, look);
  lidCell(img, look);
  ears(img, look);
  whiskerCell(img, look);
  chinCell(img, look);
  yarnCell(img);
  return img;
}

/** Мазки шерсти не ложатся на нос, рот и обводку глаз. */
let featureBoxes: Box[] = [];
const nearFeature = (x: number, y: number): boolean => featureBoxes.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);

/** Обводка глаз, светлое кольцо, мочка носа, губы; нутро рта под подбородком. */
function face(img: Img, look: CatLook): void {
  const p = look.palette;
  const pale = hex(p.pale);
  const rimDark: RGB = [0.08, 0.06, 0.05];
  const h = SHEET.head;
  // Нутро рта: ровно там, где голову закрывает подбородок (открыт рот — оно видно, закрыт — нет).
  const { c: cc, r: cr } = chinOf(look.head);
  paintBox(img, { x0: 0, y0: h.y1 / 2, x1: 160, y1: h.y1 }, (x, y) => {
    const q = headPt(lonOf(x), latOf(y), look.head);
    const e = Math.hypot((q[0] - cc[0]) / cr[0], (q[1] - cc[1]) / cr[1], (q[2] - cc[2]) / cr[2]);
    if (e > 1.05) return null;
    const k = sm(1.05, 0.85, e);
    return mix(img.get(x | 0, y | 0), latOf(y) < -0.62 ? [0.6, 0.3, 0.32] : [0.2, 0.08, 0.08], k);
  });
  // Светлое кольцо вокруг глаза (у полосатых — «подводка» светлым).
  const ring = eyeRimLonLat(1, 1.3).map(([lo, la]) => at(lo / DEG, la / DEG));
  img.shape(poly(ring), boxOf(ring, 6), tone(mix(hex(p.fur), pale, 0.6), 0.12), { soft: 5, alpha: look.marks.tabby > 0 ? 0.6 : 0.2, clip: h });
  // Тёмная обводка: миндаль чуть шире чашечки глаза.
  const rim = eyeRimLonLat(1, 1.05).map(([lo, la]) => at(lo / DEG, la / DEG));
  img.shape(poly(rim), boxOf(rim, 4), rimDark, { soft: 1.6, clip: h });
  // Верхняя кромка глаза — толще и длиннее к наружному углу (у кошек «подводка» сверху сильнее).
  const upper = eyeRimLonLat(1, 1.12, 24)
    .filter(([, la], i, all) => la > all.reduce((s2, q) => s2 + q[1], 0) / all.length)
    .map(([lo, la]) => at(lo / DEG, la / DEG))
    .sort((p1, p2) => p1[0] - p2[0]);
  if (upper.length > 2) img.shape(stroke(spline(upper, 3), (t) => 2.5 + 2.5 * Math.sin(Math.PI * t) + 1.5 * t), boxOf(upper, 8), rimDark, { soft: 1.4, alpha: 0.9, clip: h });
  // Переносица: светлая полоса по спинке носа, по бокам — мягкая тень к внутренним углам глаз.
  const bridge = [at(0, 14), at(0, 2), at(0, -6)];
  img.shape(stroke(bridge, 9), boxOf(bridge, 10), tone(mix(hex(p.fur), pale, look.marks.muzzle > 0.5 ? 1 : 0.25), 0.35), { soft: 6, alpha: 0.35, clip: h });
  const side = spline([at(14, 4), at(10, -2), at(9, -7)], 3);
  img.shape(stroke(side, 5), boxOf(side, 7), mix(hex(p.fur), [0.1, 0.08, 0.07], 0.45), { soft: 4, alpha: 0.3, clip: h });
  // Складка у подушечек усов: тень полукругом от мочки к щеке.
  const crease = spline([at(9, -9), at(17, -12), at(24, -18), at(25, -26)], 4);
  img.shape(stroke(crease, (t) => 2.5 + 3 * Math.sin(Math.PI * t)), boxOf(crease, 6), mix(hex(p.fur), [0.1, 0.08, 0.07], 0.35), { soft: 3.5, alpha: 0.35, clip: h });
  // Слёзная дорожка от внутреннего угла к носу.
  const inner = rim.reduce((a, b) => (b[0] < a[0] ? b : a));
  const tear = [inner, [inner[0] - 6, inner[1] + 9], [inner[0] - 9, inner[1] + 17]] as [number, number][];
  img.shape(stroke(tear, (s) => 3.2 * (1 - 0.7 * s)), boxOf(tear, 4), rimDark, { soft: 1.6, alpha: 0.55, clip: h });
  featureBoxes = [boxOf(ring, 2), boxOf([at(0, -6), at(16, -30)], 2)];
  // Мочка носа и рот рисуются после мазков (`faceLines`).
}

function faceLines(img: Img, look: CatLook): void {
  const p = look.palette;
  const h = SHEET.head;
  const nose = hex(p.nose);
  const line: RGB = [0.1, 0.06, 0.05];
  // Мочка: треугольник с закруглёнными углами, свет на верхней грани, ноздри — тёмными запятыми.
  const tri = [at(0, -6), at(10.5, -7.2), at(8, -12.5), at(0, -17.5)];
  img.shape(poly(tri), boxOf(tri, 4), mul(nose, 0.45), { soft: 2.4, clip: h });
  img.shape(poly([at(0, -6.6), at(9.3, -7.6), at(7, -12), at(0, -16.5)]), boxOf(tri, 3), tone(nose, -0.1), { soft: 1.4, clip: h });
  img.shape(poly([at(0, -7), at(7, -8), at(0, -11)]), boxOf(tri, 2), tone(nose, 0.5), { soft: 2.2, alpha: 0.8, clip: h });
  img.shape(stroke([at(8, -11.2), at(4.6, -13.6)], 2.6), boxOf(tri, 2), mul(nose, 0.3), { soft: 1, alpha: 0.9, clip: h });
  // Желобок и рот: от мочки вниз и в стороны («якорь»).
  img.shape(stroke([at(0, -16.5), at(0, -21)], 1.8), boxOf([at(0, -16), at(2, -22)], 3), line, { soft: 1, alpha: 0.85, clip: h });
  const mouth = spline([at(0, -21), at(5, -23.5), at(10, -23.5), at(14, -21.5)], 4);
  img.shape(stroke(mouth, (s) => 2 * (1 - 0.5 * s)), boxOf(mouth, 3), line, { soft: 1, alpha: 0.85, clip: h });
  // Точки у корней усов (у полосатых).
  if (look.marks.tabby > 0) {
    const r = rng(5);
    for (let i = 0; i < 9; i++) {
      const [x, y] = at(9 + (i % 3) * 4.2 + r() * 1.5, -16 - Math.floor(i / 3) * 3.4);
      img.shape(circle(x, y, 1.1), { x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 }, mul(hex(p.stripe), 0.9), { soft: 0.8, alpha: 0.55 });
    }
  }
}

/**
 * Ячейки глаза: радужка с тёмным ободком и светлым кольцом у зрачка, волокна, тень века сверху, блик и отблеск снизу;
 * зрачок — щелью (день), вполовину и круглым (ночь). Вне края глаза — тёмная обводка: взгляд сдвигает лист, и край не
 * показывает соседнюю ячейку.
 */
function eyes(img: Img, look: CatLook): void {
  const iris = hex(look.palette.iris);
  const E = SHEET.eye;
  const pupils: [number, number][] = [
    [2.2, 17],
    [6.5, 17],
    [14, 15],
  ];
  E.cx.forEach((cx, i) => {
    const cy = E.cy;
    const cell: Box = { x0: cx - 32, y0: E.y0, x1: cx + 32, y1: E.y1 };
    const fib = noise(7 + i);
    paintBox(img, cell, (x, y) => {
      const dx = x - cx;
      const dy = (y - cy) / 0.8;
      const r = Math.hypot(dx, dy) / EYE_PX;
      if (r > 1.3) return [0.08, 0.06, 0.05];
      const ang = Math.atan2(dy, dx);
      // От зрачка к краю: светлее у зрачка, темнее к ободку; волокна — по лучам.
      let c = mix(tone(iris, 0.55), tone(iris, -0.35), sm(0.2, 1.05, r));
      c = tone(c, (fib(ang * 6 + 20, r * 3) - 0.5) * 0.5);
      c = mix(c, [0.1, 0.08, 0.05], sm(1.0, 1.18, r));
      // Тень верхнего века.
      c = tone(c, -0.9 * sm(-0.1, -0.95, dy / EYE_PX));
      return c;
    });
    const [rx, ry] = pupils[i];
    img.shape(ellipse(cx, cy + 1, rx, ry), cell, [0.03, 0.02, 0.02], { soft: 1.2 });
    // Блик окна — слева сверху, отблеск — справа снизу.
    img.shape(ellipse(cx - 7.5, cy - 7, 3, 2.3, -0.5), cell, [1, 0.98, 0.92], { soft: 0.9, alpha: 0.95 });
    img.shape(circle(cx - 3, cy - 10, 1.1), cell, [1, 1, 0.95], { soft: 0.7, alpha: 0.8 });
    img.shape(ellipse(cx + 7, cy + 9, 5, 2.2, 0.4), cell, tone(iris, 0.7), { soft: 2, alpha: 0.6 });
  });
}

/** Ячейка века: шерсть вокруг глаза со светом сверху, край века (передний при смыкании — низ ячейки) — тёмный. */
function lidCell(img: Img, look: CatLook): void {
  const b = SHEET.lid;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const tux = look.marks.tabby === 0;
  const base = look.marks.muzzle > 0.5 ? mix(hex(look.palette.fur), hex(look.palette.pale), 0.1) : mix(hex(look.palette.fur), hex(look.palette.pale), 0.35);
  paintBox(img, b, (x, y) => {
    const dy = (y - cy) / 28;
    return tone(base, -dy * (tux ? 0.55 : 0.35) + 0.05);
  });
  img.shape((x, y) => -(Math.hypot(x - cx, y - cy) - 22), b, [0.07, 0.05, 0.04], { soft: 2, clip: { x0: b.x0, y0: cy + 8, x1: b.x1, y1: b.y1 } });
}

/** Уши: спинка — шерсть с тёмным краем, перед — розовая кожа, светлые пучки шерсти снизу. */
function ears(img: Img, look: CatLook): void {
  const fur = hex(look.palette.fur);
  const B = SHEET.earBack;
  paintBox(img, B, (x, y) => {
    const t = (y - B.y0) / (B.y1 - B.y0);
    return tone(look.marks.tabby > 0 ? mix(fur, hex(look.palette.stripe), 0.25) : fur, 0.25 - t * 0.35);
  });
  const F = SHEET.earFront;
  const skin = hex(look.palette.ear);
  paintBox(img, F, (x, y) => {
    const t = (y - F.y0) / (F.y1 - F.y0);
    const edge = Math.abs(x - (F.x0 + F.x1) / 2) / ((F.x1 - F.x0) / 2);
    // Внутри уха темно к глубине (у основания), кожа светлее к кончику; край — шерстью.
    const c = mix(pelt(skin, -0.55 - t * 0.45), pelt(fur, 0.05), sm(0.45 - t * 0.2, 0.75 - t * 0.2, edge));
    return c;
  });
  furStrokes(img, F, { flow: () => -Math.PI / 2 + 0.15, count: 50, len: 12, width: 1.4, spread: 0.2, seed: 33, alpha: 0.45, mask: (x, y) => y > F.y0 + (F.y1 - F.y0) * 0.55 });
  const r = rng(9);
  for (let i = 0; i < 18; i++) {
    const x = F.x0 + 5 + r() * (F.x1 - F.x0 - 10);
    const y = F.y1 - 2 - r() * 16;
    img.shape(stroke([[x, y], [x + (r() - 0.5) * 5, y - 10 - r() * 9]], (t) => 1.3 * (1 - t)), F, pelt(hex(look.palette.pale), -0.3), { soft: 0.9, alpha: 0.3, clip: F });
  }
}

/** Подбородок: светлое окраса (или шерсть), свет сверху, тень снизу; по верхнему краю спереди — тёмная линия губы. */
function chinCell(img: Img, look: CatLook): void {
  const b = SHEET.chin;
  const pale = look.marks.muzzle > 0.2 || look.marks.bib > 0.5 ? hex(look.palette.pale) : hex(look.palette.fur);
  paintBox(img, b, (x, y) => {
    const t = (y - b.y0) / (b.y1 - b.y0);
    const a = (x - b.x0) / (b.x1 - b.x0);
    // Низ и бока подбородка уходят в тень того же тона, что горло: края не видно.
    const c = pelt(pale, 0.05 - t * 0.8 - a * 0.45);
    return mix(c, [0.12, 0.07, 0.06], (1 - sm(0, 0.14, t)) * (1 - sm(0.3, 0.55, a)) * 0.7);
  });
}

/** Усы — светлые; у тёмного кота тоже белые. */
function whiskerCell(img: Img, look: CatLook): void {
  const b = SHEET.whisker;
  img.fill(mix(hex(look.palette.pale), [1, 1, 1], 0.4), { x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 });
}

/** Клубок: красная шерсть нитками — пучки витков в разные стороны, светлые и тёмные. */
function yarnCell(img: Img): void {
  const b = SHEET.yarn;
  const red: RGB = [0.66, 0.2, 0.15];
  img.fill(tone(red, -0.2), b);
  const r = rng(12);
  for (let i = 0; i < 70; i++) {
    const x = b.x0 + r() * (b.x1 - b.x0);
    const y = b.y0 + r() * (b.y1 - b.y0);
    const a = r() * Math.PI;
    const l = 10 + r() * 16;
    const pts = spline([[x - Math.cos(a) * l, y - Math.sin(a) * l], [x + Math.sin(a) * 3, y - Math.cos(a) * 3], [x + Math.cos(a) * l, y + Math.sin(a) * l]], 4);
    img.shape(stroke(pts, 1.7), boxOf(pts, 2), tone(red, (r() - 0.4) * 0.9), { soft: 0.8, alpha: 0.85, clip: b });
  }
}
