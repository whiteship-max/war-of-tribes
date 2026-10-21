// Лист тела гонца (ЛЦ-3, docs/characters.md): 512 × 512, кодом, теми же кистями, что у супруги (`kit/paint`, `kit/cloth`).
// Свет и тень нарисованы в листе: плечи и верх груди на свету, бока и низ — в тени; туника собрана поясом — над ним
// напуск, под ним складки; плащ и капюшон — грубая шерсть с ворсом; сапоги и подол плаща — в дорожной пыли.
//
// Шапка, туника, плащ и капюшон — зеркальные половины (левый край — середина спереди, правый — середина сзади): узоры у
// краёв симметричны сами по себе, и край не повторяется, поэтому шва на линии зеркала нет (это держит тест).
import { mirrorU } from '../kit/body';
import { hairStrands, ornamentBand, paintMitten, type StrandSpec } from '../kit/cloth';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, poly, rng, stroke, tone, type RGB } from '../kit/paint';
import { CAP, CAP_OPEN, CLOAK, EAR, HOOD, SHEETS, TUNIC, tunicV } from './figure';
import type { HeraldLook } from './looks';

const W = 512;
const aOf = (x: number): number => (x / W) * Math.PI;
const ax = (a: number): number => mirrorU(a);

/** Воск печати — не цвет облика, а сам сургуч: тёмно-красный. */
const WAX: RGB = [0.52, 0.09, 0.07];
/** Дорожная пыль — серо-бурая, светлее кожи сапог. */
const DUST: RGB = [0.62, 0.55, 0.45];

/** Строка туники по высоте над полом (ряды `figure.TUNIC`) и обратно. */
const tunicY = (() => {
  const vs = tunicV();
  return (y: number): number => {
    if (y >= TUNIC[0].y) return vs[0];
    for (let i = 1; i < TUNIC.length; i++)
      if (y >= TUNIC[i].y) {
        const k = (TUNIC[i - 1].y - y) / (TUNIC[i - 1].y - TUNIC[i].y);
        return vs[i - 1] + (vs[i] - vs[i - 1]) * k;
      }
    return vs[vs.length - 1];
  };
})();
function yOfTunic(py: number): number {
  let lo = 0.6;
  let hi = 1.6;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (tunicY(mid) > py) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Ворот туники по углу: спереди ниже, к затылку выше. */
// Ворот — на шее, выше ряда её основания (`figure.TUNIC[1]`): на почти отвесной шее кайма не растягивается по скату плеча.
export const collar = (a: number): number => 1.484 + 0.016 * Math.min(1, Math.abs(a) / 1.6) ** 1.5;
/** Пояс: верх и низ ремня. */
export const BELT = { top: 1.071, bottom: 1.04 } as const;

export function paintHeraldBody(look: HeraldLook, livery?: { body: number; trim: number }): Img {
  const img = new Img(W, W);
  const p = look.palette;
  const skin = hex(p.skin);
  const hair = hex(p.hair);
  const tunic = hex(livery?.body ?? p.tunic);
  const trim = hex(livery?.trim ?? p.trim);
  const cloak = hex(p.cloak);
  const leather = hex(p.leather);
  // Чулки — шерсть плаща с долей кожи сапог, чуть темнее плаща.
  const hose = tone(mix(cloak, leather, 0.3), -0.18);
  paintCap(img, hair, skin);
  paintTunic(img, skin, tunic, trim, leather);
  paintCloak(img, cloak);
  paintHood(img, cloak);
  paintSleeve(img, tunic, trim);
  // Руки — обветренные, темнее лица: кожа в тень и к красному.
  paintMitten(img, SHEETS.hand, SHEETS.thumb, mix(flesh(skin, -0.22), [0.8, 0.42, 0.34], 0.12));
  paintLeg(img, hose, leather);
  paintFoot(img, leather);
  paintStrap(img, leather);
  paintBag(img, leather, trim);
  return img;
}

// ---------- Шапка: короткие волосы, виски, кожа за ухом ----------

/** Где на шапке кончаются волосы (строка листа) по столбцу: бакенбард перед ухом, дуга над ухом, затылок. */
function hairBottom(x: number): number {
  const a = aOf(x);
  const ear = EAR.th;
  if (a < CAP_OPEN) return CAP[2].v;
  if (a < ear - 0.06) return 58;
  if (a < ear + 0.2) return 48;
  if (a < 2.3) return 48 + (a - (ear + 0.2)) * 55;
  return 72 + (a - 2.3) * 2.4;
}

/**
 * Короткие волосы — тем же генератором прядей, что у супруги (`kit/cloth.hairStrands`): крупные ленты с изгибом, светлые
 * посередине и тёмные по краю, длинный блик и короткий; только короче и уже, и к концам — острыми кончиками.
 */
const STRANDS: StrandSpec = { seed: [131, 137], n: 9, w: 50, wv: 26, top: 2, cap: 3, crown: 3, wave: [4, 14], taper: [48, 26], shine: [14, 40], shineLen: [9, 6] };
/** Второй слой — короче и уже, другими сидами: пряди разной длины, не «рубчик». */
const STRANDS_OVER: StrandSpec = { seed: [149, 157], n: 7, w: 34, wv: 18, top: 10, cap: 3, crown: 3, wave: [12, 12], taper: [26, 16], shine: [20, 34], shineLen: [6, 4], over: true };

function paintCap(img: Img, hair: RGB, skin: RGB): void {
  const box = { x0: 0, y0: 0, x1: W, y1: SHEETS.cap.y1 };
  const n = noise(141);
  hairStrands(img, box, hair, STRANDS);
  hairStrands(img, box, hair, STRANDS_OVER);
  // Виски — темнее макушки: волосы там короче и в тени.
  img.shape((x, y) => -1, box, (x, y) => {
    const c = img.get(Math.min(W - 1, x | 0), Math.min(W - 1, y | 0));
    const k = 1 - 0.3 * Math.exp(-(((aOf(x) - 1.6) / 0.5) ** 2)) * Math.min(1, Math.max(0, (y - 22) / 14));
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  // Кожа ниже волос — тон бока лица (`face.skinBase`: −0,63 у виска), за ухом — глубже, к шее светлее.
  img.shape(
    (x, y) => hairBottom(x) - y,
    box,
    (x, y) => {
      const a = aOf(x);
      const behind = Math.max(0, Math.min(1, (a - EAR.th) / 0.5));
      return flesh(skin, -0.58 - 0.12 * behind + 0.1 * Math.max(0, (y - 66) / 14) + (n(x * 0.2, y * 0.2) - 0.5) * 0.06);
    },
    { soft: 2.5 },
  );
  // Край волос — острыми кончиками прядей вниз, а не ровным срезом.
  const tr = rng(147);
  // У оси листа (затылок) — без кончиков: остриё на оси легло бы в один крайний столбец (шов зеркала).
  for (let x = ax(CAP_OPEN) + 6; x < W - 14; x += 9 + tr() * 6) {
    const y = hairBottom(x);
    const tip: [number, number][] = [
      [x - 5, y - 4],
      [x + 5, y - 4],
      [x + 1 + tr() * 2, y + 3 + tr() * 4],
    ];
    img.shape(poly(tip), boxOf(tip, 3), tone(hair, -0.3 + (tr() - 0.5) * 0.2), { soft: 1 });
  }
  // Тень от волос на коже — полосой под краем; за ухом — тень самого уха.
  img.shape((x, y) => Math.abs(y - hairBottom(x) - 3) - 2.5, box, flesh(skin, -0.9), { soft: 3, alpha: 0.5, clip: { x0: ax(CAP_OPEN), y0: 0, x1: W, y1: box.y1 } });
  const earX = ax(EAR.th + 0.08);
  img.shape(ellipse(earX + 8, 57, 9, 9), around(earX + 8, 57, 16, 16), flesh(skin, -1), { soft: 6, alpha: 0.45 });
}

// ---------- Туника, шея, пояс ----------

function paintTunic(img: Img, skin: RGB, tunic: RGB, trim: RGB, leather: RGB): void {
  const T = SHEETS.tunic;
  const box = { x0: 0, y0: T.y0, x1: W, y1: T.y1 };
  const n = noise(171);
  const r = rng(173);
  const at = (x: number, y: number): { a: number; h: number } => ({ a: aOf(x), h: yOfTunic(y) });
  img.shape(
    (x, y) => -1,
    box,
    (x, y) => {
      const { a, h } = at(x, y);
      const side = Math.min(1, Math.max(0, (Math.abs(a) - 0.9) / 1.3));
      if (h > collar(a)) {
        // Шея: под подбородком — тень по его форме, перед — на свету, бока и затылок — в тени.
        // Тень под челюстью — по её линии (у ушей выше), глубокая и с чётким краем снизу.
        const edge = 1.524 + 0.034 * Math.min(1, Math.abs(a) / 1.4) ** 2;
        const chin = h > edge - 0.02 ? -0.95 * Math.min(1, (h - edge + 0.02) / 0.016) ** 1.2 : 0;
        const sideN = -0.7 * Math.min(1, Math.max(0, (Math.abs(a) - 0.35) / 1.0)) ** 1.1;
        // Мышцы шеи — от-за уха к ямке над грудиной: тёмная полоса по бокам знаком «V».
        const scm = Math.abs(a) - (0.25 + ((h - 1.484) / 0.05) * 0.75);
        const v = -0.35 * Math.exp(-((scm / 0.16) ** 2)) * Math.min(1, Math.max(0, (1.535 - h) / 0.02));
        const c = flesh(skin, 0.04 + chin + sideN + v + (n(x * 0.2, y * 0.3) - 0.5) * 0.05);
        return chin < -0.2 ? mix(c, [0.38, 0.17, 0.1], 0.4 * Math.min(1, -chin)) : c;
      }
      // Туника: верх груди на свету, к бокам и к поясу — в тень; ниже пояса — складки и к подолу темнее.
      const below = h < BELT.bottom;
      const fold = below ? Math.cos(9 * a) * (0.1 + 0.25 * Math.min(1, (BELT.bottom - h) / 0.3)) : Math.cos(14 * a) * 0.05 * Math.max(0, 1 - (h - 1.07) / 0.08);
      const light = 0.16 * Math.exp(-(((h - 1.33) / 0.08) ** 2)) - 0.35 * side - (below ? 0.12 + 0.3 * Math.max(0, (0.93 - h) / 0.23) : 0) - 0.18 * Math.max(0, (1.2 - h) / 0.13) * (below ? 0 : 1);
      return tone(tunic, light + fold + (n(x * 0.12, y * 0.35) - 0.5) * 0.08);
    },
  );
  // Кадык и ямка у ключиц — светом и тенью.
  // Кадык — бугор полтора на полтора сантиметра: на шее столбец листа — 0,3 мм, строка — около 2 мм.
  const adam = [ax(0), tunicY(1.505)] as const;
  const ry = Math.abs(tunicY(1.498) - tunicY(1.505));
  img.shape(ellipse(adam[0], adam[1], 26, ry * 1.2), { x0: 0, y0: adam[1] - ry * 3, x1: 40, y1: adam[1] + ry * 3 }, flesh(skin, 0.3), { soft: 6, alpha: 0.45 });
  img.shape(ellipse(adam[0], adam[1] + ry * 1.1, 22, ry * 0.6), { x0: 0, y0: adam[1], x1: 36, y1: adam[1] + ry * 3 }, flesh(skin, -0.45), { soft: 4, alpha: 0.4 });
  // Ворот: кайма цвета металла герба, под ней — тень на шее и на тунике.
  img.shape((x, y) => Math.abs(y - (tunicY(collar(aOf(x))) + 2)) - 1.6, box, (x, y) => tone(trim, -0.12 + 0.12 * Math.cos(aOf(x) * 60)), { soft: 1.1 });
  img.shape((x, y) => Math.abs(y - (tunicY(collar(aOf(x))) - 1.2)) - 1.2, box, flesh(skin, -0.85), { soft: 2, alpha: 0.6 });
  img.shape((x, y) => Math.abs(y - (tunicY(collar(aOf(x))) + 6)) - 1.2, box, tone(tunic, -0.6), { soft: 2, alpha: 0.5 });
  // Разрез ворота спереди со шнурком.
  const slit0 = tunicY(collar(0)) + 4;
  const slit1 = tunicY(1.39);
  img.shape((x, y) => x - 2.2, { x0: 0, y0: slit0, x1: 6, y1: slit1 }, tone(tunic, -0.85), { soft: 1.2 });
  for (let y = slit0 + 4; y < slit1 - 2; y += 6) img.shape(stroke([[-6, y], [6, y + 4]], 1.6), { x0: 0, y0: y - 2, x1: 8, y1: y + 6 }, tone(leather, 0.2), { soft: 1 });
  // Напуск над поясом: ткань ложится на ремень валиком — свет сверху, тень снизу.
  const bt = tunicY(BELT.top);
  img.shape((x, y) => Math.abs(y - (bt - 5)) - 3.5, box, (x, y) => tone(tunic, 0.25 + 0.1 * Math.cos(aOf(x) * 18)), { soft: 3, alpha: 0.45 });
  img.shape((x, y) => Math.abs(y - (bt - 1)) - 1.5, box, tone(tunic, -0.8), { soft: 2, alpha: 0.7 });
  // Складки от пояса вниз.
  for (let i = 0; i < 26; i++) {
    const x = 8 + r() * (W - 16);
    const y0 = tunicY(BELT.bottom) + 2;
    const y1 = tunicY(0.72);
    const pts: [number, number][] = [0, 0.5, 1].map((t) => [x + Math.sin(t * 2.5 + i) * 3 * t, y0 + (y1 - y0) * t]);
    img.shape(stroke(pts, (t) => 1.2 + 2.6 * t), boxOf(pts, 4), r() > 0.5 ? tone(tunic, 0.22) : tone(tunic, -0.45), { soft: 2, alpha: 0.4 });
  }
  // Ремень: кожа с тиснёной кромкой, пряжка спереди чуть сбоку, конец ремня вниз.
  const b0 = tunicY(BELT.top);
  const b1 = tunicY(BELT.bottom);
  img.shape((x, y) => Math.max(b0 - y, y - b1), { x0: 0, y0: b0 - 2, x1: W, y1: b1 + 2 }, (x, y) => tone(leather, 0.05 - 0.35 * Math.abs((y - (b0 + b1) / 2) / (b1 - b0)) - 0.25 * Math.min(1, Math.max(0, (Math.abs(aOf(x)) - 1) / 1.4)) + (n(x * 0.4, y) - 0.5) * 0.1), { soft: 1 });
  for (const yy of [b0 + 1.6, b1 - 1.6]) img.shape((x, y) => Math.abs(y - yy) - 0.5, { x0: 0, y0: yy - 2, x1: W, y1: yy + 2 }, tone(leather, -0.6), { soft: 0.8, alpha: 0.7 });
  const bx = ax(0.32);
  const bm = (b0 + b1) / 2;
  img.shape((x, y) => Math.max(Math.abs(x - bx) - 6, Math.abs(y - bm) - (b1 - b0) / 2 - 1.2), around(bx, bm, 10, 12), tone(trim, 0.2), { soft: 1 });
  img.shape((x, y) => Math.max(Math.abs(x - bx) - 3.6, Math.abs(y - bm) - (b1 - b0) / 2 + 2), around(bx, bm, 6, 8), tone(leather, -0.4), { soft: 0.8 });
  img.shape(stroke([[bx - 2, bm], [bx + 5, bm]], 1.5), around(bx, bm, 7, 3), tone(trim, 0.55), { soft: 0.8 });
  const tail: [number, number][] = [
    [bx - 9, b1 - 2],
    [bx - 11, b1 + 16],
  ];
  img.shape(stroke(tail, (t) => 7 - 2 * t), boxOf(tail, 6), (x, y) => tone(leather, -0.05 - 0.02 * (y - b1)), { soft: 1 });
  // Подол: кайма с орнаментом цвета металла, край — темнее; пыль с дороги снизу.
  const hem = tunicY(0.7);
  ornamentBand(img, { b0: hem - 13, b1: hem - 3, x1: W, ground: tone(tunic, -0.5), line: trim, steps: 14, half: 3.6, at: ax, axisDots: false });
  img.shape((x, y) => hem - 2 - y, { x0: 0, y0: hem - 4, x1: W, y1: T.y1 }, tone(tunic, -0.75), { soft: 1.5 });
  img.shape((x, y) => tunicY(0.79) - y, { x0: 0, y0: tunicY(0.79) - 6, x1: W, y1: T.y1 }, DUST, { soft: 14, alpha: (x, y) => 0.18 * Math.min(1, (y - tunicY(0.79)) / 24) });
}

// ---------- Плащ и капюшон ----------

/** Шерсть: ворс мелким шумом и редкими светлыми волосками. */
function wool(img: Img, box: { x0: number; y0: number; x1: number; y1: number }, seed: number, strength = 0.07): void {
  const n = noise(seed);
  img.shape((x, y) => -1, box, (x, y) => {
    const c = img.get(Math.min(W - 1, x | 0), Math.min(W - 1, y | 0));
    const k = 1 + (n(x * 0.5, y * 0.5) - 0.5) * strength + (n(x * 0.08 + 9, y * 0.06) - 0.5) * strength;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
}

/** Передний край раковины на строке листа (по рядам `CLOAK` и `HOOD`): столбец листа. */
function edgeAt(rows: readonly { open: number; v: number }[], y: number): number {
  if (y <= rows[0].v) return ax(rows[0].open);
  for (let i = 1; i < rows.length; i++)
    if (y <= rows[i].v) {
      const k = (y - rows[i - 1].v) / (rows[i].v - rows[i - 1].v);
      return ax(rows[i - 1].open + (rows[i].open - rows[i - 1].open) * k);
    }
  return ax(rows[rows.length - 1].open);
}

function paintCloak(img: Img, cloak: RGB): void {
  const C = SHEETS.cloak;
  const box = { x0: 0, y0: C.y0, x1: W, y1: C.y1 };
  const n = noise(181);
  img.shape((x, y) => -1, box, (x, y) => {
    const a = aOf(x);
    const k = (y - C.y0) / (C.y1 - C.y0);
    // Складки — по геометрии: столбцы раковины через один наружу.
    const fold = Math.cos(((a - 1.3) / (Math.PI - 1.3)) * 5 * Math.PI) * (0.06 + 0.26 * k);
    const light = 0.22 * Math.exp(-(((y - (C.y0 + 14)) / 10) ** 2)) - 0.32 * k ** 1.2 - 0.1;
    return tone(cloak, light + fold + (n(x * 0.05, y * 0.03) - 0.5) * 0.12);
  });
  // Край плаща — подшитый, темнее; по нему — светлая нитка шва.
  img.shape((x, y) => Math.abs(x - edgeAt(CLOAK, y) - 4) - 3.5, box, tone(cloak, -0.5), { soft: 1.5, alpha: 0.85 });
  img.shape((x, y) => Math.abs(x - edgeAt(CLOAK, y) - 9) - 0.5, box, tone(cloak, 0.35), { soft: 0.8, alpha: 0.5 });
  // Подол: подшивка, пыль и брызги дорожной грязи.
  img.shape((x, y) => C.y1 - 5 - y, { x0: 0, y0: C.y1 - 7, x1: W, y1: C.y1 }, tone(cloak, -0.6), { soft: 1.5 });
  img.shape((x, y) => C.y1 - 22 - y, { x0: 0, y0: C.y1 - 26, x1: W, y1: C.y1 }, DUST, { soft: 10, alpha: (x, y) => 0.32 * Math.min(1, (y - (C.y1 - 22)) / 18) });
  const r = rng(191);
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = C.y1 - 3 - r() ** 2 * 24;
    img.shape(ellipse(x, y, 2 + r() * 4, 1 + r() * 2), around(x, y, 7, 4), mix(DUST, tone(cloak, -0.6), r() * 0.5), { soft: 2, alpha: 0.2 + r() * 0.15 });
  }
  wool(img, box, 193);
}

function paintHood(img: Img, cloak: RGB): void {
  const H = SHEETS.hood;
  const box = { x0: 0, y0: H.y0, x1: W, y1: H.y1 };
  const n = noise(197);
  img.shape((x, y) => -1, box, (x, y) => {
    const v = y - H.y0;
    // Край у шеи — подвёрнутый, светлее; валик — свет сверху, мешок на спине — в тени.
    const light = v < 6 ? 0.2 : 0.18 * Math.exp(-(((v - 16) / 7) ** 2)) - 0.4 * Math.max(0, (v - 22) / 26);
    return tone(cloak, light + Math.cos(aOf(x) * 9) * 0.08 + (n(x * 0.05, y * 0.05) - 0.5) * 0.1);
  });
  img.shape((x, y) => Math.abs(y - (H.y0 + 6)) - 1, box, tone(cloak, -0.55), { soft: 1.5, alpha: 0.7 });
  img.shape((x, y) => Math.abs(x - edgeAt(HOOD, y) - 3) - 3, box, tone(cloak, -0.45), { soft: 1.5, alpha: 0.7 });
  wool(img, box, 199);
}

// ---------- Рукав, ноги, ремень, сума ----------

function paintSleeve(img: Img, tunic: RGB, trim: RGB): void {
  const s = SHEETS.sleeve;
  const sw = s.x1 - s.x0;
  const n = noise(211);
  img.shape((x, y) => -1, { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }, (x, y) => {
    const u = (x - s.x0) / sw;
    const outer = Math.cos((u - 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const v = y - s.y0;
    // Плечо на свету, к локтю — складки сгиба, к обшлагу — в тень.
    const elbow = Math.exp(-(((v - 60) / 6) ** 2)) * Math.sin(u * Math.PI * 6) * 0.25;
    const light = 0.18 * Math.exp(-(((v - 14) / 14) ** 2)) - 0.12 * (v / 120);
    return tone(tunic, light - 0.36 * (1 - outer) + elbow + (n(x * 0.15, y * 0.3) - 0.5) * 0.08);
  });
  // Обшлаг: кайма цвета металла, под ней тень.
  img.shape((x, y) => Math.abs(y - (s.y1 - 6)) - 2.4, { x0: s.x0, y0: s.y1 - 11, x1: s.x1, y1: s.y1 - 1 }, (x, y) => tone(trim, 0.08 + 0.12 * Math.sin(x * 0.4)), { soft: 1.1 });
  img.shape((x, y) => Math.abs(y - (s.y1 - 10.5)) - 0.9, { x0: s.x0, y0: s.y1 - 14, x1: s.x1, y1: s.y1 - 8 }, tone(tunic, -0.7), { soft: 1.2, alpha: 0.6 });
}

function paintLeg(img: Img, hose: RGB, leather: RGB): void {
  const l = SHEETS.leg;
  const lw = l.x1 - l.x0;
  const n = noise(221);
  const r = rng(223);
  // Шов ноги — сзади-внутри; спереди-снаружи — на свету.
  const lit = (x: number): number => {
    const u = (x - l.x0) / lw;
    return Math.cos((u - 0.5) * Math.PI * 2) * 0.5 + 0.5;
  };
  img.shape((x, y) => -1, { x0: l.x0, y0: l.y0, x1: l.x1, y1: 431 }, (x, y) => tone(hose, 0.12 * lit(x) - 0.3 * (1 - lit(x)) - 0.25 * Math.max(0, (y - 420) / 11) + (n(x * 0.3, y * 0.3) - 0.5) * 0.08));
  // Край голенища (кольцо сверху): внутри — тёмное нутро, снаружи — толщина кожи.
  img.shape((x, y) => -1, { x0: l.x0, y0: 431, x1: l.x1, y1: 437 }, (x, y) => tone(leather, -0.9 + 0.5 * ((y - 431) / 6)));
  // Голенище: кожа, отворот сверху светлее, к щиколотке — складки гармошкой; пыль густеет книзу.
  img.shape((x, y) => -1, { x0: l.x0, y0: 437, x1: l.x1, y1: l.y1 }, (x, y) => {
    const v = (y - 437) / (l.y1 - 437);
    const cuff = y < 449 ? 0.22 - 0.3 * Math.max(0, (y - 445) / 4) : 0;
    const crease = v > 0.72 ? Math.sin(y * 1.1 + Math.sin(x * 0.2) * 2) * 0.12 : 0;
    return tone(leather, cuff + 0.2 * lit(x) - 0.38 * (1 - lit(x)) - 0.08 * v + crease + (n(x * 0.25, y * 0.25) - 0.5) * 0.1);
  });
  img.shape((x, y) => Math.abs(y - 449) - 1, { x0: l.x0, y0: 446, x1: l.x1, y1: 452 }, tone(leather, -0.75), { soft: 1.2, alpha: 0.75 });
  img.shape((x, y) => 470 - y, { x0: l.x0, y0: 466, x1: l.x1, y1: l.y1 }, DUST, { soft: 16, alpha: (x, y) => 0.45 * Math.min(1, (y - 470) / 40) * (0.7 + 0.3 * n(x * 0.2, y * 0.2)) });
  // Пыль — пятнами и разводами, не точками: сверху реже, к щиколотке гуще.
  for (let i = 0; i < 26; i++) {
    const x = l.x0 + r() * lw;
    const y = 466 + r() ** 0.7 * 44;
    img.shape(ellipse(x, y, 3 + r() * 5, 1.5 + r() * 2.5, (r() - 0.5) * 0.6), around(x, y, 9, 6), mix(DUST, [0.74, 0.68, 0.58], r() * 0.5), { soft: 3, alpha: 0.18 + r() * 0.12 });
  }
}

function paintFoot(img: Img, leather: RGB): void {
  const f = SHEETS.foot;
  const fw = f.x1 - f.x0;
  const n = noise(231);
  img.shape((x, y) => -1, { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 }, (x, y) => {
    const u = (x - f.x0) / fw;
    // Верх стопы (u 0 и 1) — на свету, подошва (u 0,5) — тёмная кромка.
    const top = Math.cos(u * Math.PI * 2) * 0.5 + 0.5;
    const sole = Math.exp(-(((u - 0.5) / 0.1) ** 2));
    return mix(tone(leather, 0.15 * top - 0.25 + (n(x * 0.3, y * 0.3) - 0.5) * 0.1 - 0.6 * sole), DUST, 0.35 * (1 - sole) * (0.6 + 0.4 * n(x * 0.15, y * 0.2)));
  });
}

function paintStrap(img: Img, leather: RGB): void {
  const s = SHEETS.strap;
  img.shape((x, y) => -1, { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }, (x, y) => tone(leather, 0.12 - 0.5 * Math.abs((x - (s.x0 + s.x1) / 2) / (s.x1 - s.x0)) ** 2));
  for (const xx of [s.x0 + 4, s.x1 - 4]) for (let y = s.y0 + 2; y < s.y1; y += 4) img.shape(stroke([[xx, y], [xx, y + 2]], 0.9), { x0: xx - 2, y0: y - 1, x1: xx + 2, y1: y + 3 }, tone(leather, 0.45), { soft: 0.7, alpha: 0.6 });
}

function paintBag(img: Img, leather: RGB, trim: RGB): void {
  const b = SHEETS.bag;
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const X = (u: number): number => b.x0 + u * bw;
  const Y = (v: number): number => b.y0 + v * bh;
  const n = noise(241);
  const bag = tone(leather, 0.08);
  img.shape((x, y) => -1, { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }, (x, y) => tone(bag, (n(x * 0.3, y * 0.3) - 0.5) * 0.14 - 0.2 * ((y - b.y0) / bh)));
  // Клапан (верх и наружная половина) — светлее, по краю — шов и тень на суме под ним.
  img.shape((x, y) => -1, { x0: X(0), y0: Y(0), x1: X(0.62), y1: Y(0.34) }, (x, y) => tone(bag, 0.22 - 0.25 * ((y - Y(0)) / (Y(0.34) - Y(0))) + (n(x * 0.35, y * 0.35) - 0.5) * 0.12));
  img.shape((x, y) => Math.abs(y - Y(0.3)) - 0.6, { x0: X(0), y0: Y(0.28), x1: X(0.62), y1: Y(0.32) }, tone(bag, 0.5), { soft: 0.7, alpha: 0.6 });
  img.shape((x, y) => y - Y(0.36), { x0: X(0), y0: Y(0.34), x1: X(0.62), y1: Y(0.48) }, tone(bag, -0.7), { soft: 5, alpha: (x, y) => 0.6 * Math.max(0, 1 - (y - Y(0.36)) / 10) });
  for (let x = X(0.04); x < X(0.6); x += 4) img.shape(stroke([[x, Y(0.93)], [x + 2, Y(0.93)]], 0.9), { x0: x - 1, y0: Y(0.9), x1: x + 3, y1: Y(0.96) }, tone(bag, 0.4), { soft: 0.7, alpha: 0.5 });
  // Пряжка застёжки под печатью и пыль по низу.
  img.shape((x, y) => Math.max(Math.abs(x - X(0.32)) - 3, Math.abs(y - Y(0.4)) - 2.5), around(X(0.32), Y(0.4), 6, 5), tone(trim, 0.2), { soft: 0.8 });
  img.shape((x, y) => Y(0.75) - y, { x0: X(0), y0: Y(0.7), x1: X(0.62), y1: Y(0.98) }, DUST, { soft: 6, alpha: 0.25 });
  // Печать красного воска: диск с наплывами по краю, оттиск — крест с точками, блик сверху.
  const cx = X(0.82);
  const cy = Y(0.18);
  const rx = 0.14 * bw;
  const ry = 0.16 * bh;
  img.shape((x, y) => -1, { x0: X(0.64), y0: Y(0), x1: X(1), y1: Y(0.36) }, tone(bag, 0.1));
  img.shape(ellipse(cx, cy, rx, ry), around(cx, cy, rx + 3, ry + 3), (x, y) => mix(tone(WAX, 0.15), tone(WAX, -0.5), Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry))), { soft: 1.2 });
  const cross: [number, number][][] = [
    [
      [cx - rx * 0.5, cy],
      [cx + rx * 0.5, cy],
    ],
    [
      [cx, cy - ry * 0.5],
      [cx, cy + ry * 0.5],
    ],
  ];
  for (const l of cross) img.shape(stroke(l, 2.2), boxOf(l, 3), tone(WAX, -0.65), { soft: 0.9 });
  for (const [dx, dy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ])
    img.shape(circle(cx + dx * rx * 0.33, cy + dy * ry * 0.33, 1.3), around(cx + dx * rx * 0.33, cy + dy * ry * 0.33, 2.5), tone(WAX, -0.6), { soft: 0.8 });
  img.shape(ellipse(cx - rx * 0.3, cy - ry * 0.4, rx * 0.35, ry * 0.15, -0.4), around(cx - rx * 0.3, cy - ry * 0.4, rx * 0.5, ry * 0.3), tone(WAX, 0.8), { soft: 1.5, alpha: 0.6 });
  const drip = poly([
    [cx + rx * 0.6, cy + ry * 0.6],
    [cx + rx * 0.95, cy + ry * 0.9],
    [cx + rx * 0.5, cy + ry * 0.95],
  ]);
  img.shape(drip, around(cx + rx * 0.7, cy + ry * 0.8, rx * 0.5, ry * 0.4), tone(WAX, -0.2), { soft: 1 });
}
