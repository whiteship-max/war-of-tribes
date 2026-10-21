// Лист тела советника (ЛЦ-5, docs/characters.md): 512 × 512, кодом, теми же кистями, что у супруги и гонца (`kit/paint`,
// `kit/cloth`, `kit/fur`). Свет и тень нарисованы в листе: плечи и грудь мантии на свету, бока и подол — в тени, длинные
// складки сукна до пола; спереди — разрез с золотой каймой и подбоем; ворот — мех мазками по течению (у горностая — чёрные
// хвостики); волосы и борода — седыми прядями по течению (назад и вниз); цепь — звеньями, медальон — с гербовым ключом и
// камнем; на безымянном пальце — перстень.
//
// Волосы, борода, мантия и ворот — зеркальные половины (левый край — середина спереди, правый — середина сзади): узоры у
// краёв симметричны сами по себе, и край не повторяется, поэтому шва на линии зеркала нет (это держит тест).
import { mirrorU } from '../kit/body';
import { hairStrands, ornamentBand, paintMitten, type StrandSpec } from '../kit/cloth';
import { furStrokes } from '../kit/fur';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, poly, rng, stroke, tone, type RGB } from '../kit/paint';
import { CAP, CAP_OPEN, COLLAR_OPEN, EAR, ROBE, SHEETS, robeV } from './figure';
import type { AdvisorLook } from './looks';

const W = 512;
const aOf = (x: number): number => (x / W) * Math.PI;
const ax = (a: number): number => mirrorU(a);

/** Строка мантии по высоте над полом (ряды `figure.ROBE`) и обратно. */
const robeY = (() => {
  const vs = robeV();
  return (y: number): number => {
    if (y >= ROBE[0].y) return vs[0];
    for (let i = 1; i < ROBE.length; i++)
      if (y >= ROBE[i].y) {
        const k = (ROBE[i - 1].y - y) / (ROBE[i - 1].y - ROBE[i].y);
        return vs[i - 1] + (vs[i] - vs[i - 1]) * k;
      }
    return vs[vs.length - 1];
  };
})();
function yOfRobe(py: number): number {
  let lo = 0;
  let hi = 1.6;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (robeY(mid) > py) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Где шея уходит под ворот (по углу): спереди её прячет борода, к затылку — ворот у основания шеи. */
const NECK_LOW = 1.395;

export function paintAdvisorBody(look: AdvisorLook): Img {
  const img = new Img(W, W);
  const p = look.palette;
  const skin = hex(p.skin);
  const hair = hex(p.hair);
  const robe = hex(p.robe);
  const lining = hex(p.lining);
  const fur = hex(p.fur);
  const gold = hex(p.gold);
  const gem = hex(p.gem);
  paintCap(img, hair, skin, look.face.recede);
  paintBeard(img, hair, robe);
  paintRobe(img, skin, robe, lining, gold);
  paintCollar(img, fur, look.face.ermine);
  paintSleeve(img, robe, lining, fur);
  // Руки — старческие: кожа тоньше и бледнее лица, к костяшкам — розовее.
  paintMitten(img, SHEETS.hand, SHEETS.thumb, mix(flesh(skin, -0.12), [0.86, 0.6, 0.52], 0.1));
  paintRing(img, gold, gem);
  paintChain(img, gold, gem);
  return img;
}

// ---------- Волосы: седые назад, залысина, кожа за ухом ----------

/** Где кончаются волосы (строка листа) по столбцу: у лица — линия волос, над ухом — дуга, затылок — до ворота. */
function hairBottom(x: number): number {
  const a = aOf(x);
  const ear = EAR.th;
  if (a < CAP_OPEN) return CAP[2].v;
  if (a < ear - 0.08) return 50;
  if (a < ear + 0.22) return 44;
  if (a < 2.3) return 44 + (a - (ear + 0.22)) * 60;
  return 72;
}

/** Пряди — длиннее, чем у гонца, зачёсаны назад: лента от лба через макушку к затылку. */
const STRANDS: StrandSpec = { seed: [221, 223], n: 17, w: 26, wv: 16, top: 2, cap: 3, crown: 3, wave: [6, 20], taper: [54, 18], shine: [18, 46], shineLen: [10, 7] };
const STRANDS_OVER: StrandSpec = { seed: [227, 229], n: 12, w: 18, wv: 10, top: 8, cap: 3, crown: 3, wave: [10, 14], taper: [36, 22], shine: [24, 40], shineLen: [7, 5], over: true };

function paintCap(img: Img, hair: RGB, skin: RGB, recede: number): void {
  const box = { x0: 0, y0: 0, x1: W, y1: SHEETS.cap.y1 };
  const n = noise(231);
  hairStrands(img, box, hair, STRANDS);
  hairStrands(img, box, hair, STRANDS_OVER);
  // Седина — мягче тёмных: тени между прядями у седых волос неглубоки (иначе голова читается полосатой каской); холоднее в
  // тени, серебром на свету; виски темнее макушки.
  const mid = tone(hair, -0.12);
  img.shape((x, y) => -1, box, (x, y) => {
    const c = mix(img.get(Math.min(W - 1, x | 0), Math.min(W - 1, y | 0)), mid, 0.55);
    const k = 1 - 0.08 * Math.exp(-(((aOf(x) - 1.6) / 0.5) ** 2)) * Math.min(1, Math.max(0, (y - 24) / 14));
    return [c[0] * k * 0.98, c[1] * k, c[2] * k * 1.03];
  });
  // Залысина: спереди над висками кожа уходит под волосы мысом («М»); посередине — прядь, зачёсанная назад.
  const bald = (x: number): number => {
    const a = aOf(x);
    return CAP[2].v - recede * (22 * Math.exp(-(((a - 0.62) / 0.28) ** 2)) + 6 * Math.exp(-((a / 0.3) ** 2))) + (n(x * 0.15, 3) - 0.5) * 4;
  };
  img.shape(
    (x, y) => y - bald(x),
    { x0: 0, y0: 0, x1: ax(CAP_OPEN), y1: CAP[2].v + 4 },
    (x, y) => flesh(skin, -0.02 - 0.3 * smooth01((aOf(x) - 0.6) / 0.8) + 0.1 * Math.exp(-(((y - 26) / 6) ** 2)) + (n(x * 0.2, y * 0.2) - 0.5) * 0.04),
    { soft: 3 },
  );
  // Редкие волоски на залысине — тонкими штрихами назад.
  const r = rng(233);
  for (let i = 0; i < 70 * recede; i++) {
    const x = 6 + r() * (ax(CAP_OPEN) - 12);
    const y0 = bald(x) - r() * 10;
    const line: [number, number][] = [
      [x, y0 + 6],
      [x + (r() - 0.5) * 3, y0 - 4],
    ];
    img.shape(stroke(line, 0.8), boxOf(line, 2), tone(hair, 0.1), { soft: 0.6, alpha: 0.4 });
  }
  // Кожа ниже волос (за ухом и над ним) — тон бока лица, глубже за ухом.
  img.shape(
    (x, y) => hairBottom(x) - y,
    { ...box, x0: ax(CAP_OPEN) - 2 },
    (x, y) => {
      const a = aOf(x);
      const behind = Math.max(0, Math.min(1, (a - EAR.th) / 0.5));
      return flesh(skin, -0.56 - 0.14 * behind + (n(x * 0.2, y * 0.2) - 0.5) * 0.06);
    },
    { soft: 2.5 },
  );
  // Край волос — кончиками прядей вниз; у затылка их видно и в силуэте (`figure.RAGGED`).
  const tr = rng(237);
  for (let x = ax(CAP_OPEN) + 6; x < W - 12; x += 8 + tr() * 6) {
    const y = hairBottom(x);
    if (y >= 71) continue;
    const tip: [number, number][] = [
      [x - 5, y - 4],
      [x + 5, y - 4],
      [x + 1 + tr() * 2, y + 3 + tr() * 4],
    ];
    img.shape(poly(tip), boxOf(tip, 3), tone(hair, -0.25 + (tr() - 0.5) * 0.2), { soft: 1 });
  }
  img.shape((x, y) => Math.abs(y - hairBottom(x) - 3) - 2.5, box, flesh(skin, -0.9), { soft: 3, alpha: 0.45, clip: { x0: ax(CAP_OPEN), y0: 0, x1: W, y1: 70 } });
}

const smooth01 = (k: number): number => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

// ---------- Борода ----------

const BEARD: StrandSpec = { seed: [241, 243], n: 17, w: 30, wv: 18, top: 0, cap: -9, crown: -9, wave: [4, 30], taper: [40, 22], shine: [16, 34], shineLen: [9, 6] };
const BEARD_OVER: StrandSpec = { seed: [247, 251], n: 9, w: 28, wv: 14, top: 6, cap: -9, crown: -9, wave: [8, 24], taper: [30, 26], shine: [22, 38], shineLen: [7, 5], over: true };

function paintBeard(img: Img, hair: RGB, robe: RGB): void {
  const b = SHEETS.beard;
  const box = { x0: 0, y0: b.y0, x1: W, y1: b.y1 };
  const H = b.y1 - b.y0;
  // Пряди — вниз (ряды листа), сеяные; локальные строки — от верха бороды.
  const local = new Img(W, H);
  hairStrands(local, { x0: 0, y0: 0, x1: W, y1: H }, hair, BEARD);
  hairStrands(local, { x0: 0, y0: 0, x1: W, y1: H }, hair, BEARD_OVER);
  const n = noise(253);
  const mid = tone(hair, -0.1);
  img.shape((x, y) => -1, box, (x, y) => {
    const c = mix(local.get(Math.min(W - 1, x | 0), Math.min(H - 1, (y - b.y0) | 0)), mid, 0.35);
    const v = (y - b.y0) / H;
    const a = aOf(x);
    // Свет — на переде у подбородка и на кончике спереди; изнанка к шее и бока — в тени (к мантии под ней).
    const light = 0.12 * Math.exp(-(((v - 0.42) / 0.2) ** 2)) * (1 - a / 1.6) - 0.35 * Math.max(0, (v - 0.82) / 0.18) - 0.22 * Math.min(1, a / 1.4) - 0.12 * Math.max(0, (0.12 - v) / 0.12);
    const t = tone(c, light + (n(x * 0.1, y * 0.3) - 0.5) * 0.06);
    return v > 0.85 ? mix(t, tone(robe, -0.4), 0.25 * (v - 0.85) / 0.15) : t;
  });
}

// ---------- Мантия, шея, разрез ----------

function paintRobe(img: Img, skin: RGB, robe: RGB, lining: RGB, gold: RGB): void {
  const R = SHEETS.robe;
  const box = { x0: 0, y0: R.y0, x1: W, y1: R.y1 };
  const n = noise(261);
  img.shape(
    (x, y) => -1,
    box,
    (x, y) => {
      const a = aOf(x);
      const h = yOfRobe(y);
      const side = Math.min(1, Math.max(0, (Math.abs(a) - 0.9) / 1.4));
      // Стойка подрясника — высоко на шее спереди и с боков (под бородой голой шеи не видно), к затылку ниже — под ворот.
      const stand = NECK_LOW + 0.05 * (1 - smooth01((Math.abs(a) - 0.9) / 0.9));
      if (h > NECK_LOW && h < stand) return tone(lining, -0.1 - 0.4 * Math.min(1, Math.abs(a) / 1.5) - 0.35 * Math.max(0, (h - stand + 0.008) / 0.008) + (n(x * 0.3, y * 0.3) - 0.5) * 0.05);
      if (h > NECK_LOW) {
        // Шея: под бородой и подбородком — в тени, сзади и с боков — тоже; спереди её не видно (борода).
        const chin = -0.7 * Math.min(1, Math.max(0, (h - 1.43) / 0.03));
        const sideN = -0.55 * Math.min(1, Math.max(0, (Math.abs(a) - 0.4) / 1.1));
        const scm = Math.abs(a) - (0.3 + ((h - NECK_LOW) / 0.05) * 0.7);
        const v = -0.3 * Math.exp(-((scm / 0.16) ** 2));
        return flesh(skin, -0.1 + chin + sideN + v + (n(x * 0.2, y * 0.3) - 0.5) * 0.05);
      }
      // Сукно: грудь и плечи на свету, к бокам и к подолу — в тень; складки до пола (чаще у подола).
      const below = Math.max(0, (0.95 - h) / 0.95);
      const fold = Math.cos(7 * a + 0.4 * Math.sin(3 * a)) * (0.04 + 0.22 * below) + Math.cos(13 * a) * 0.05 * below;
      const light = 0.2 * Math.exp(-(((h - 1.28) / 0.1) ** 2)) - 0.42 * side - 0.3 * below ** 1.4 - 0.1 * Math.max(0, (1.12 - h) / 0.2) * (h > 0.95 ? 1 : 0);
      return tone(robe, light + fold + (n(x * 0.12, y * 0.35) - 0.5) * 0.06);
    },
  );
  // Тень бороды на груди — мягкой лопатой посередине.
  const bY = robeY(1.2);
  img.shape(ellipse(0, bY, 70, 22), { x0: 0, y0: bY - 30, x1: 80, y1: bY + 30 }, tone(robe, -0.7), { soft: 16, alpha: 0.45 });
  // Разрез спереди: полоса подбоя (подрясник) с золотой каймой по краям мантии — от ворота до подола.
  const top = robeY(1.16);
  const hem = R.y1;
  const slit = (y: number): number => 7 + 9 * smooth01((y - top) / (hem - top));
  img.shape((x, y) => x - slit(y), { x0: 0, y0: top, x1: 30, y1: hem }, (x, y) => tone(lining, -0.15 - 0.3 * ((y - top) / (hem - top)) + (n(x * 0.3, y * 0.3) - 0.5) * 0.05), { soft: 1.2 });
  img.shape((x, y) => Math.abs(x - slit(y) - 3.2) - 2.6, { x0: 0, y0: top, x1: 36, y1: hem }, (x, y) => tone(gold, -0.05 + 0.18 * Math.sin(y * 0.6)), { soft: 1 });
  img.shape((x, y) => Math.abs(x - slit(y) - 7.5) - 1.2, { x0: 0, y0: top, x1: 40, y1: hem }, tone(robe, -0.75), { soft: 1.5, alpha: 0.6 });
  // Подол: орнамент шитьём золотом по тёмной кайме, сам край темнее; у пола — тень.
  ornamentBand(img, { b0: hem - 22, b1: hem - 10, x1: W, ground: tone(robe, -0.55), line: tone(gold, -0.1), steps: 12, half: 4, at: ax, axisDots: false });
  img.shape((x, y) => hem - 7 - y, { x0: 0, y0: hem - 9, x1: W, y1: hem }, tone(robe, -0.8), { soft: 1.5 });
}

// ---------- Ворот: мех ----------

function paintCollar(img: Img, fur: RGB, ermine: number): void {
  const C = SHEETS.collar;
  const box = { x0: 0, y0: C.y0, x1: W, y1: C.y1 };
  const n = noise(271);
  const H = C.y1 - C.y0;
  // Валик меха: гребень на свету, внутренний край у шеи и нижний край — в тени; спереди (отвороты) — светлее, чем на спине.
  img.shape((x, y) => -1, box, (x, y) => {
    const t = (y - C.y0) / H;
    const a = aOf(x);
    const crest = Math.sin(Math.PI * Math.min(1, t * 1.08));
    const back = Math.min(1, Math.max(0, (Math.abs(a) - 1.2) / 1.6));
    return tone(fur, -0.42 + 0.55 * crest - 0.22 * back - 0.25 * Math.max(0, t - 0.85) / 0.15 + (n(x * 0.15, y * 0.2) - 0.5) * 0.12);
  });
  // Мазки меха: по течению — от гребня вниз и наружу.
  // У зеркальных краёв листа — без мазков: мазок, обрезанный краем, лёг бы в один крайний столбец (шов).
  const inner = (x: number): boolean => x > 16 && x < W - 16;
  furStrokes(img, box, { flow: (x) => Math.PI / 2 + 0.35 * Math.sin(x * 0.05), count: 1400, len: 9, width: 2.6, spread: 0.55, alpha: 0.5, seed: 273, mask: inner });
  furStrokes(img, box, { flow: () => Math.PI / 2 - 0.25, count: 600, len: 6, width: 1.6, spread: 0.7, alpha: 0.4, seed: 277, mask: inner });
  // Горностай: чёрные хвостики вразброс (у зеркальных краёв — мимо: шов).
  if (ermine > 0) {
    const r = rng(279);
    for (let i = 0; i < 46 * ermine; i++) {
      const x = 16 + r() * (W - 44);
      const y = C.y0 + 6 + r() * (H - 14);
      const tail: [number, number][] = [
        [x, y],
        [x + (r() - 0.5) * 2, y + 4 + r() * 3],
        [x + (r() - 0.5) * 3, y + 8 + r() * 4],
      ];
      img.shape(stroke(tail, (t) => 2.6 * (1 - t) + 0.6), boxOf(tail, 4), [0.06, 0.05, 0.05], { soft: 1, alpha: 0.9 });
    }
  }
  // Тень ворота на мантии у края — переход к сукну.
  img.shape((x, y) => C.y1 - 3 - y, { x0: 0, y0: C.y1 - 6, x1: W, y1: C.y1 }, tone(fur, -0.8), { soft: 2, alpha: 0.6 });
  void COLLAR_OPEN;
}

// ---------- Рукав, перстень, цепь ----------

function paintSleeve(img: Img, robe: RGB, lining: RGB, fur: RGB): void {
  const s = SHEETS.sleeve;
  const box = { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
  const n = noise(281);
  img.shape((x, y) => -1, box, (x, y) => {
    const u = (x - s.x0) / (s.x1 - s.x0);
    const v = (y - s.y0) / (s.y1 - s.y0);
    const outer = Math.cos((u - 0.5) * Math.PI * 2) * 0.5 + 0.5;
    // Складки раструба — вдоль, к обшлагу глубже; внутрь (к телу) — тень.
    const fold = Math.cos(u * Math.PI * 8) * 0.1 * v;
    return tone(robe, 0.1 * outer - 0.4 * (1 - outer) + fold - 0.12 * v + (n(x * 0.2, y * 0.3) - 0.5) * 0.05);
  });
  // Обшлаг — меховой полосой у края раструба (как ворот), изнанка — подбой в тени.
  const cuff = s.y1 - 14;
  img.shape((x, y) => cuff - y, { ...box, y0: cuff - 2 }, (x, y) => tone(fur, -0.1 + 0.3 * Math.sin(((y - cuff) / 14) * Math.PI) + (n(x * 0.3, y * 0.3) - 0.5) * 0.15), { soft: 1.5 });
  furStrokes(img, { x0: s.x0, y0: cuff - 2, x1: s.x1, y1: s.y1 }, { flow: () => Math.PI / 2, count: 120, len: 6, width: 1.8, spread: 0.6, alpha: 0.45, seed: 283 });
  img.shape((x, y) => Math.abs(y - (cuff - 3)) - 1.5, { ...box, y0: cuff - 6, y1: cuff }, tone(lining, -0.6), { soft: 1.5, alpha: 0.6 });
}

/** Перстень — на безымянном пальце левой и правой: золотое кольцо поперёк пальцев, камень сверху. */
function paintRing(img: Img, gold: RGB, gem: RGB): void {
  const h = SHEETS.hand;
  const hw = h.x1 - h.x0;
  // Безымянный — у мизинца (тыльная сторона — середина листа, пальцы — бороздками у 0,44…0,56).
  const x0 = h.x0 + 1 + 0.6 * (hw - 2);
  const y = h.y0 + 70;
  img.shape((x, yy) => Math.max(Math.abs(yy - y) - 2.2, Math.abs(x - x0) - 7), around(x0, y, 10, 5), (x) => tone(gold, 0.15 - 0.3 * Math.abs(x - x0) / 7), { soft: 1 });
  img.shape(circle(x0, y, 3), around(x0, y, 5), tone(gem, 0.1), { soft: 1 });
  img.shape(circle(x0 - 0.8, y - 0.8, 1), around(x0, y, 3), mix(gem, [1, 1, 1], 0.7), { soft: 0.7 });
}

function paintChain(img: Img, gold: RGB, gem: RGB): void {
  const c = SHEETS.chain;
  const box = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
  img.fill(tone(gold, -0.9), box);
  // Звенья — овалы через одно поперёк, на свету — блик.
  for (let x = c.x0 + 6; x < c.x1 - 4; x += 10) {
    const cy = (c.y0 + c.y1) / 2;
    const flat = ((x - c.x0) / 10) % 2 < 1;
    img.shape((px, py) => Math.abs(ellipse(x, cy, flat ? 6 : 3, flat ? 4 : 6)(px, py)) - 1.4, around(x, cy, 8, 8), tone(gold, flat ? 0.2 : -0.05), { soft: 1 });
    img.shape(circle(x - 2, cy - 2, 1), around(x, cy, 4), mix(gold, [1, 0.96, 0.85], 0.6), { soft: 0.8 });
  }
  // Медальон: золотой диск с ободом, на нём — ключ должности и камень посередине.
  const m = SHEETS.medal;
  const mx = (m.x0 + m.x1) / 2;
  const my = (m.y0 + m.y1) / 2;
  const r = (m.x1 - m.x0) / 2 - 2;
  img.shape(circle(mx, my, r), around(mx, my, r + 2), (x, y) => tone(gold, 0.18 - 0.4 * ((x - mx + y - my) / (2 * r))), { soft: 1 });
  img.shape((x, y) => Math.abs(circle(mx, my, r * 0.78)(x, y)) - 1.3, around(mx, my, r), tone(gold, -0.55), { soft: 1 });
  // Ключ — стержнем вниз, бородка вбок, кольцо вверху.
  img.shape(stroke([[mx, my - r * 0.55], [mx, my + r * 0.6]], 2.2), around(mx, my, r), tone(gold, -0.7), { soft: 1 });
  img.shape((x, y) => Math.abs(circle(mx, my - r * 0.48, r * 0.17)(x, y)) - 1.3, around(mx, my, r), tone(gold, -0.7), { soft: 1 });
  img.shape(poly([[mx, my + r * 0.36], [mx + r * 0.3, my + r * 0.36], [mx + r * 0.3, my + r * 0.52], [mx, my + r * 0.52]]), around(mx, my, r), tone(gold, -0.7), { soft: 1 });
  img.shape(circle(mx, my - r * 0.02, r * 0.16), around(mx, my, r * 0.3), tone(gem, 0.05), { soft: 1 });
  img.shape(circle(mx - r * 0.05, my - r * 0.08, r * 0.06), around(mx, my, r * 0.3), mix(gem, [1, 1, 1], 0.7), { soft: 0.8 });
}
