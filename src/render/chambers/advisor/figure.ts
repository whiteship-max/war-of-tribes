// Фигура советника (ЛЦ-5, docs/characters.md): тот же набор персонажа, что у супруги, гонца и кота (`kit/`), — сетка с кожей
// в два веса, мало костей, свет нарисован в листах, — а сложение пожилого мужчины, близко к живому: рост 1,70 м, голова —
// 1/7 роста, плечи уже, чем у гонца, спина чуть сутулая (горбик под мантией, голова вперёд — позой). Длинная мантия до
// пола тёмного сукна, меховой ворот шалью от затылка к груди, цепь с медальоном должности, широкие рукава, седые волосы
// назад с залысиной, ухоженная седая борода.
//
// Экономия: мантия — открытый конус от шеи до пола, ног нет ни в сетке, ни в костях; ходьбу дают подол (кости `hemL`,
// `hemR` — подол спереди слева и справа идёт шагом) и скольжение таза; борода — один кусок на одной кости (`beard`, ребёнок
// челюсти — ходит со ртом); кисть — «варежка» набора. 18 костей: таз, поясница, грудь, шея, голова, челюсть, веки,
// борода; по руке — плечо, предплечье, кисть, большой палец; подол слева и справа.
//
// Лист тела 512 × 512 (y — вниз): волосы 0…72, борода 72…136, мантия с шеей 136…360, ворот 360…408 — зеркальные половины
// (u = |угол| / π); ниже — рукав, кисть, палец, цепь и медальон (`SHEETS`). Пряди за краем волос — на полосе волос.
import type { V3 } from '../../city/geom';
import type { Skeleton } from '../rig';
import { crs, mirrorRing, mirrorU, mitten, norm, place, smooth, tube, uvB, type MittenSpec } from '../kit/body';
import { EAR_COLS, buildEars, type EarSpec } from '../kit/ear';
import { hairLocks, raggedEdge, type Lock } from '../kit/hair';
import type { Head } from '../kit/head';
import { upperSkeleton } from '../kit/skeleton';
import { SkinMesh, add, scale, sub, type Weights } from '../kit/skin';

/** Рост от пола до макушки, м. */
export const HEIGHT = 1.7;
/** Голова — 1/7 роста (задание ЛЦ-5: пропорции близко к живым). */
export const HEAD_PART = 7;

// ---------- Голова: чертёжные меры маски → на шею ----------

const DRAW_CHIN = 1.284;
const DRAW_HZ = -0.012;
/** Купол черепа над линией волос и толщина волос на макушке, чертёжные метры: волосы редкие, купол ниже, чем у гонца. */
export const DOME = 0.05;
const HAIR_T = 0.004;

/** Голова на фигуре: масштаб, высота подбородка чертежа и ось головы по глубине — так, чтобы макушка была на `HEIGHT`. */
export function headFrame(head: Head): { k: number; chin: number; z: number; top: number; bottom: number } {
  const top = head.faceHeight(head.TOP_H + DOME) + HAIR_T;
  const bottom = head.faceHeight(0);
  const k = HEIGHT / HEAD_PART / (top - bottom);
  // Голова — вперёд над грудью (сутулость в покое): ось головы на 1,2 см перед осью тела.
  return { k, chin: HEIGHT - (top - DRAW_CHIN) * k, z: -0.006, top, bottom };
}

/** Точка чертежа головы → на фигуре. */
export const toFigure =
  (f: ReturnType<typeof headFrame>) =>
  (p: V3): V3 => [p[0] * f.k, f.chin + (p[1] - DRAW_CHIN) * f.k, f.z + (p[2] - DRAW_HZ) * f.k];

// ---------- Скелет ----------

/** Суставы руки в покое (левая, +x): плечо, локоть, запястье — плечи уже, чем у гонца (0,158), руки свободно вниз. */
const SHOULDER: V3 = [0.138, 1.362, -0.034];
const ELBOW: V3 = [0.17, 1.088, -0.052];
const WRIST: V3 = [0.19, 0.848, -0.022];
/** Подол спереди: ось поворота — у таза, слева и справа (`hemL`, `hemR`). */
const HEM: V3 = [0.085, 0.9, 0.02];

function thumbBase(): V3 {
  const a = norm(sub([WRIST[0] + 0.033, WRIST[1] - 0.2, WRIST[2] + 0.011], WRIST));
  return add(add(WRIST, scale(a, 0.028)), [-0.01, 0, 0.017]);
}

export function advisorSkeleton(head: Head): Skeleton {
  const at = toFigure(headFrame(head));
  const eye = head.eyeCenter(1);
  const sk = upperSkeleton({
    hips: [0, 0.9, 0],
    spine: [0, 1.03, -0.008],
    chest: [0, 1.2, -0.016],
    neck: [0, 1.405, -0.03],
    head: at([0, 1.36, -0.03]),
    jaw: at([0, 1.388, -0.032]),
    lids: at([0, eye[1], eye[2]]),
    crown: [],
    shoulder: SHOULDER,
    elbow: ELBOW,
    wrist: WRIST,
    thumb: thumbBase(),
    arm: (p, sx) => [p[0] * sx, p[1], p[2]],
  });
  // Борода — ребёнок челюсти: ходит со ртом; своя кость — гладить и покачивать её.
  sk.add('beard', 'jaw', at([0, 1.3, 0.05]));
  sk.add('hemL', 'hips', HEM);
  sk.add('hemR', 'hips', [-HEM[0], HEM[1], HEM[2]]);
  return sk;
}

// ---------- Лист тела ----------

export const SHEETS = {
  cap: { y0: 0, y1: 72 },
  beard: { y0: 72, y1: 136 },
  robe: { y0: 136, y1: 360 },
  collar: { y0: 360, y1: 408 },
  sleeve: { x0: 0, x1: 160, y0: 408, y1: 512 },
  hand: { x0: 160, x1: 288, y0: 416, y1: 512 },
  thumb: { x0: 288, x1: 320, y0: 448, y1: 512 },
  chain: { x0: 320, x1: 512, y0: 408, y1: 424 },
  medal: { x0: 320, x1: 384, y0: 428, y1: 492 },
} as const;

// ---------- Волосы назад, залысина, уши ----------

/** Углы волос: замкнутые кольца над линией волос (18 углов), ниже — открытые от виска к затылку. */
export const CAP_A = mirrorRing([0, 0.35, 0.75, 1.15, 1.45, 1.78, 2.15, 2.55, 2.9, Math.PI]);
export const CAP_OPEN = 1.45;

/**
 * Кольца волос: высота над подбородком, толщина спереди и сзади (зачёс назад — у лба тонко, к затылку объём), строка листа.
 * Нижний ряд — у ворота, рваным краем (`kit/hair.raggedEdge`).
 */
export const CAP: readonly { h: number; lift: readonly [number, number]; v: number; open: boolean }[] = [
  { h: 0.248 + 0.036, lift: [0.0025, 0.007], v: 8, open: false },
  { h: 0.248 + 0.016, lift: [0.002, 0.008], v: 20, open: false },
  // Линия волос — над краем маски; залысины рисует лист (лоб и виски — кожа).
  { h: 0.244, lift: [0.0008, 0.008], v: 32, open: false },
  { h: 0.18, lift: [0.0016, 0.009], v: 44, open: true },
  { h: 0.11, lift: [0.002, 0.009], v: 54, open: true },
  { h: 0.04, lift: [0.003, 0.009], v: 62, open: true },
  // Затылок — к вороту, ниже подбородка: седые волосы до воротника.
  { h: -0.058, lift: [0.002, 0.008], v: 68, open: true },
];

/** Точка волос (чертёж головы): поверхность маски вокруг головы, затылок глубже, выше линии волос — купол. */
export function capPt(head: Head, th: number, h: number, lift: number): V3 {
  const top = head.TOP_H;
  const p = head.surf(th, Math.max(0, Math.min(h, top)));
  // Зачёс назад: к затылку голова «глубже» — волосы лежат объёмом.
  const back = 1 + 0.12 * smooth(1.6, 2.9, Math.abs(th));
  let dx = p[0];
  let dz = (p[2] - head.HZ) * (Math.cos(th) < 0 ? back : 1);
  let y = p[1];
  let up = 0;
  if (h > top) {
    const k = (h - top) / DOME;
    const s = Math.cos((Math.min(1, k) * Math.PI) / 2) ** 0.8;
    dx *= s;
    dz = dz * s - 0.014 * k;
    y = head.faceHeight(top) + (h - top);
    up = lift * k;
  }
  // Ниже подбородка — к шее: волосы ложатся на ворот.
  if (h < 0) {
    // Ниже подбородка: у затылка — от линии подбородка (не от угла челюсти, он выше), к вороту.
    const k = Math.min(1, -h / 0.06);
    dx *= 1 - 0.12 * k;
    dz *= 1 - 0.06 * k;
    y = Math.min(p[1], head.faceHeight(0)) + h;
  }
  const r = Math.hypot(dx, dz) || 1;
  const out = lift - up;
  return [dx + (dx / r) * out, y + up, head.HZ + dz + (dz / r) * out];
}

/** Толщина волос по углу: у висков — тонко (зачёс), объём — к затылку. */
const liftAt = (l: readonly [number, number], th: number): number => l[0] + (l[1] - l[0]) * smooth(1.2, 2.7, Math.abs(th));

/** Зубцы нижнего ряда волос, чертёжные метры по высоте. */
const RAGGED = 0.007;

function buildCap(m: SkinMesh, head: Head): void {
  const openA = CAP_A.slice(4, 15);
  const jag = raggedEdge(openA.length, 211);
  const rows = CAP.map((r, ri) =>
    (r.open ? openA : CAP_A).map((a, k) => {
      const last = ri === CAP.length - 1;
      const h = last ? r.h + jag[k] * RAGGED : r.h;
      const w: Weights = r.h < 0.02 ? ['head', 'neck', last ? 0.55 : 0.8] : 'head';
      return m.v(capPt(head, a, h, liftAt(r.lift, a)), uvB(mirrorU(a), r.v + (last ? jag[k] * 2 : 0)), 0, w);
    }),
  );
  const crown = m.v(capPt(head, 0, head.TOP_H + DOME, HAIR_T), uvB(256, 2), 0, 'head');
  const first = rows[0];
  const inside = (p: V3): V3 => [0, p[1] - 0.04, head.HZ - 0.01];
  for (let k = 0; k < first.length; k++) m.quad(crown, first[k], first[(k + 1) % first.length], crown, [0, head.faceHeight(head.TOP_H), head.HZ - 0.01]);
  m.strip(rows.slice(0, 3), true, inside);
  m.strip([rows[2].slice(4, 15), ...rows.slice(3)], false, inside);
  // Пряди за краем у затылка: от нижнего ряда — вниз и наружу, на ворот (объём, а не срез).
  const last = CAP[CAP.length - 1];
  const locks: Lock[] = [];
  for (const a of [2.35, 2.75, Math.PI, -2.75, -2.35]) {
    const root = capPt(head, a, last.h + 0.012, liftAt(last.lift, a) + 0.001);
    const out = norm([Math.sin(a), 0, Math.cos(a)]);
    locks.push({ at: root, dir: norm([out[0] * 0.2, -1, out[2] * 0.2]), side: norm(crs([0, 1, 0], out)), len: 0.024, width: 0.012 });
  }
  hairLocks(
    m,
    locks,
    (i, t, s) => uvB(80 + i * 80 + s * 40, 44 + t * 26),
    (t) => ['head', 'neck', 0.6 - 0.2 * t],
    (p) => [0, p[1] + 0.02, head.HZ],
  );
}

/** Уши — крупнее, чем у гонца (с годами уши растут): основание, высоты, вынос, отвод (`kit/ear`). */
export const EAR: EarSpec = { th: 1.64, h0: 0.083, h1: 0.188, out: 0.0125, back: 0.016 };
/** Лист уха на листе лица: справа под листом рта (как у гонца). */
export const EAR_SHEET = { x0: 384, y0: 264, x1: 512, y1: 360 } as const;

// ---------- Борода ----------

/** Столбцы бороды (половина): от середины подбородка к бакенбарду; верхний край по ним — над чем начинается борода. */
export const BEARD_TH = [0, 0.22, 0.48, 0.78, 1.08, 1.34, 1.56] as const;
const BEARD_TOP = [0.047, 0.052, 0.07, 0.09, 0.106, 0.128, 0.158] as const;
/** Ряды бороды: доля строки листа (сверху вниз). */
const BEARD_V = [0, 0.16, 0.38, 0.6, 0.8, 0.92, 1] as const;

/** Точка бороды (чертёж головы): столбец, ряд 0…6. Верх — на коже, ниже — объём у подбородка, кончик, изнанка к шее. */
export function beardPt(head: Head, th: number, row: number): V3 {
  const a = Math.abs(th);
  const i = BEARD_TH.findIndex((t) => t >= a - 1e-9);
  const k = i <= 0 ? 0 : (a - BEARD_TH[i - 1]) / (BEARD_TH[i] - BEARD_TH[i - 1]);
  const top = i <= 0 ? BEARD_TOP[0] : BEARD_TOP[i - 1] + (BEARD_TOP[i] - BEARD_TOP[i - 1]) * k;
  // Перед — полнее и ниже, к бакенбарду — тонко и вплотную к щеке; низ — округлой лопатой (середина длиннее боков).
  const front = 1 - smooth(0.5, 1.34, a);
  const drop = 0.4 + 0.6 * (1 - smooth(0.4, 1.4, a));
  const len = 0.09 - 0.05 * Math.min(1, a / 1.34) ** 1.5;
  // Лопата: низ бороды шире подбородка — на сантиметр с каждой стороны.
  const wide = Math.sin(th) * 0.012 * (1 - smooth(1.2, 1.56, a));
  const lifted = (h: number, lift: number): V3 => {
    const p = head.surf(th, h);
    const dx = p[0];
    const dz = p[2] - head.HZ;
    const r = Math.hypot(dx, dz) || 1;
    return [p[0] + (dx / r) * lift, p[1], p[2] + (dz / r) * lift];
  };
  const c0 = head.surf(th, 0);
  const nk = head.spec.neck;
  switch (row) {
    case 0:
      return lifted(top, 0.0012);
    case 1:
      return lifted(top * 0.5 + 0.012, 0.006 + 0.004 * front);
    case 2:
      return lifted(0.006, 0.006 + 0.012 * front);
    case 3:
      return [c0[0] * 1.02 + wide, c0[1] - 0.042 * drop, c0[2] + 0.016 * front];
    case 4:
      // Низ — округлый: бока короче середины.
      return [c0[0] * 0.84 + wide, c0[1] - len * drop, c0[2] + 0.006 * front];
    case 5:
      return [c0[0] * 0.74 + wide * 0.8, c0[1] - (len - 0.016) * drop, c0[2] - 0.034 * drop];
    default:
      return [nk.r * 1.05 * Math.sin(th), c0[1] - 0.016, nk.zc + nk.r * 1.05 * Math.cos(th)];
  }
}

function buildBeard(m: SkinMesh, head: Head): void {
  const b = SHEETS.beard;
  const cols = [...[...BEARD_TH].reverse().map((t) => -t), ...BEARD_TH.slice(1)];
  const rows = BEARD_V.map((v, ri) => cols.map((th) => m.v(beardPt(head, th, ri), uvB(Math.min(511, (Math.abs(th) / BEARD_TH[BEARD_TH.length - 1]) * 511), b.y0 + 1 + v * (b.y1 - b.y0 - 2)), 0, 'beard')));
  m.strip(rows, false, (p) => [0, p[1] + 0.01, head.HZ - 0.02]);
}

// ---------- Мантия и шея ----------

/** Углы мантии: 16 по кругу. */
const ROBE_A = mirrorRing([0, 0.3, 0.65, 1.0, 1.35, 1.7, 2.1, 2.6, Math.PI]);

/** Кольцо с разной глубиной спереди и сзади (горбик сутулой спины — сзади глубже). */
export const ringPt2 = (a: number, y: number, rx: number, rzF: number, rzB: number, zc: number): V3 => {
  const c = Math.cos(a);
  return [rx * Math.sin(a), y, zc + (c > 0 ? rzF : rzB) * c];
};

type Ring = { y: number; rx: number; rzF: number; rzB: number; zc: number; w: (a: number) => Weights };

/** Кость подола по углу: перед слева — `hemL`, справа — `hemR`, бока и спина — таз; `k` — доля у этого ряда. */
function hemWeight(a: number, k: number): Weights {
  const front = Math.max(0, Math.cos(a)) ** 0.7;
  if (k * front < 0.02) return 'hips';
  return [a > 0 ? 'hemL' : 'hemR', 'hips', k * front];
}

/** Ряды мантии сверху вниз: шея (внутри головы), трапеция под воротом, плечи, грудь с горбиком, пояс, бёдра, колени, подол. */
export const ROBE: readonly Ring[] = [
  { y: 1.512, rx: 0.039, rzF: 0.041, rzB: 0.041, zc: -0.022, w: () => ['head', 'neck', 0.6] },
  { y: 1.41, rx: 0.046, rzF: 0.047, rzB: 0.047, zc: -0.028, w: () => ['neck', 'chest', 0.5] },
  { y: 1.388, rx: 0.1, rzF: 0.066, rzB: 0.074, zc: -0.034, w: () => ['chest', 'neck', 0.82] },
  { y: 1.356, rx: 0.134, rzF: 0.086, rzB: 0.1, zc: -0.034, w: () => 'chest' },
  { y: 1.24, rx: 0.148, rzF: 0.104, rzB: 0.126, zc: -0.026, w: () => 'chest' },
  { y: 1.05, rx: 0.148, rzF: 0.112, rzB: 0.112, zc: -0.008, w: () => ['spine', 'chest', 0.6] },
  { y: 0.88, rx: 0.17, rzF: 0.128, rzB: 0.13, zc: 0.0, w: () => 'hips' },
  { y: 0.48, rx: 0.205, rzF: 0.16, rzB: 0.16, zc: 0.01, w: (a) => hemWeight(a, 0.45) },
  { y: 0.012, rx: 0.248, rzF: 0.2, rzB: 0.196, zc: 0.016, w: (a) => hemWeight(a, 1) },
];

export const robePoint = (a: number, r: Ring): V3 => ringPt2(a, r.y, r.rx, r.rzF, r.rzB, r.zc);

/** Строки мантии на листе: по длине поверхности спереди, шея — втрое гуще (тень бороды и мышцы шеи). */
const ROBE_DENSE = [3, 1.6] as const;
export function robeV(): number[] {
  const at = ROBE.map((r) => robePoint(0.3, r));
  const d = [0];
  for (let i = 1; i < at.length; i++) d.push(d[i - 1] + Math.hypot(...sub(at[i], at[i - 1])) * (ROBE_DENSE[i - 1] ?? 1));
  const all = d[d.length - 1];
  return d.map((x) => SHEETS.robe.y0 + 1 + (x / all) * (SHEETS.robe.y1 - SHEETS.robe.y0 - 2));
}

/** Точка на мантии по углу и высоте (между рядами — прямо), снаружи на `out` по горизонтали. */
export function robeAt(a: number, y: number, out = 0): V3 {
  let i = 1;
  while (i < ROBE.length - 1 && ROBE[i].y > y) i++;
  const r0 = ROBE[i - 1];
  const r1 = ROBE[i];
  const k = Math.max(0, Math.min(1, (r0.y - y) / (r0.y - r1.y)));
  const L = (p: number, q: number): number => p + (q - p) * k;
  const p = ringPt2(a, y, L(r0.rx, r1.rx), L(r0.rzF, r1.rzF), L(r0.rzB, r1.rzB), L(r0.zc, r1.zc));
  const zc = L(r0.zc, r1.zc);
  const d = norm([p[0], 0, p[2] - zc]);
  return [p[0] + d[0] * out, y, p[2] + d[2] * out];
}

function buildRobe(m: SkinMesh): void {
  const vs = robeV();
  const rows = ROBE.map((r, ri) => ROBE_A.map((a) => m.v(robePoint(a, r), uvB(mirrorU(a), vs[ri]), 0, r.w(a))));
  m.strip(rows, true, (p) => [0, p[1], -0.01]);
}

// ---------- Меховой ворот ----------

/** Ворот шалью: передние края — у середины груди (угол `COLLAR_OPEN`), к затылку — выше, у шеи. */
export const COLLAR_OPEN = 0.24;
const COLLAR_K = 8;
/** Ряды поперёк ворота: доля ширины; толщина меха — валиком посередине. */
const COLLAR_T = [0, 0.3, 0.68, 1] as const;

/** Точка ворота: угол (вдоль ворота), доля поперёк; у шеи — внутренний край, снаружи — нижний. */
export function collarPt(a: number, t: number): V3 {
  const s = Math.min(1, Math.abs(a) / Math.PI);
  // Внутренний край: у груди — низко (1,17 м), к затылку — у основания шеи.
  const yIn = 1.165 + 0.252 * smooth(0, 0.42, s);
  const width = 0.09 + 0.035 * s;
  // Спереди ворот лежит отворотами вбок, сзади — шалью вниз по спине.
  const a1 = a + Math.sign(a) * 0.55 * (1 - smooth(0.1, 0.5, s)) * t;
  const y = yIn - width * t * (0.55 + 0.45 * smooth(0.1, 0.5, s));
  const bump = 0.004 + 0.042 * (0.75 + 0.25 * s) * Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.7;
  // На плечах ворот лежит поверх верха рукавов: наружу на их толщину.
  const over = 0.016 * Math.sin(a1) ** 2 * smooth(0.05, 0.6, t) * (1 - 0.25 * t);
  return robeAt(a1, y, bump + over);
}

function shellAngles(open: number, n: number): number[] {
  const side = Array.from({ length: n + 1 }, (_, k) => open + ((Math.PI - open) * k) / n);
  return [...side, ...side.slice(0, -1).reverse().map((a) => -a)];
}

function buildCollar(m: SkinMesh): void {
  const c = SHEETS.collar;
  const rows = COLLAR_T.map((t) => shellAngles(COLLAR_OPEN, COLLAR_K).map((a) => m.v(collarPt(a, t), uvB(mirrorU(a), c.y0 + 1 + t * (c.y1 - c.y0 - 2)), 0, t === 0 ? ['chest', 'neck', 0.85] : 'chest')));
  m.strip(rows, false, (p) => [0, p[1] - 0.05, -0.02]);
}

// ---------- Цепь и медальон ----------

/** Медальон должности: середина, радиус; цепь — от плеч по вороту к нему. */
export const MEDAL = { c: [0, 1.105, 0] as V3, r: 0.03 } as const;

/** Где лежит цепь: доля пути от плеча (0) к медальону (1), сторона. */
function chainPt(k: number, sx: 1 | -1): V3 {
  const a = sx * (1.0 - 0.86 * k);
  const y = 1.335 - 0.17 * smooth(0, 1, k);
  // По меху ворота — сверху на валике (он толще у плеч), к груди — на мантии под отворотом.
  return robeAt(a, y, 0.044 - 0.024 * k);
}

function medalCenter(): V3 {
  const p = robeAt(0, MEDAL.c[1], 0.02);
  return [0, MEDAL.c[1], p[2]];
}

function buildChain(m: SkinMesh): void {
  const ch = SHEETS.chain;
  const n = 7;
  for (const sx of [1, -1] as const) {
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const p = i === n ? add(medalCenter(), [0, MEDAL.r * 0.9, -0.002]) : chainPt(k, sx);
      const q = i === 0 ? chainPt(0.02, sx) : i === n ? chainPt(1 - 1 / n, sx) : chainPt(k + 0.02, sx);
      const along = norm(i === n ? sub(p, q) : sub(q, p));
      const outN = norm([p[0], 0, p[2] + 0.01]);
      const side = scale(norm(crs(along, outN)), 0.0075);
      const u = ch.x0 + 2 + k * (ch.x1 - ch.x0 - 4);
      left.push(m.v(add(p, side), uvB(u, ch.y0 + 1), 0, 'chest'));
      right.push(m.v(sub(p, side), uvB(u, ch.y1 - 1), 0, 'chest'));
    }
    m.strip([left, right], false, (p) => [0, p[1], p[2] - 0.05]);
  }
  // Медальон — диск с ободом: середина вперёд бугром.
  const md = SHEETS.medal;
  const c = medalCenter();
  const mc: [number, number] = [(md.x0 + md.x1) / 2, (md.y0 + md.y1) / 2];
  const R = (md.x1 - md.x0) / 2 - 2;
  const mid = m.v([c[0], c[1], c[2] + 0.009], uvB(mc[0], mc[1]), 0, 'chest');
  const ring = (rr: number, dz: number, k: number): number[] =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return m.v([c[0] + Math.sin(a) * rr, c[1] + Math.cos(a) * rr, c[2] + dz], uvB(mc[0] + Math.sin(a) * R * k, mc[1] - Math.cos(a) * R * k), 0, 'chest');
    });
  const inner = ring(MEDAL.r * 0.72, 0.006, 0.72);
  const outer = ring(MEDAL.r, 0.001, 1);
  for (let i = 0; i < 10; i++) m.quad(inner[i], inner[(i + 1) % 10], mid, mid, [c[0], c[1], c[2] - 0.05]);
  m.strip([outer, inner], true, () => [c[0], c[1], c[2] - 0.05]);
}

// ---------- Руки ----------

const MITTEN: MittenSpec = {
  // Кисть старческая — тоньше и костистей, чем у гонца.
  rings: [
    [0, 0.021, 0.0135, 0, SHEETS.hand.y0 + 2],
    [0.062, 0.0305, 0.0158, 0.001, SHEETS.hand.y0 + 34],
    [0.115, 0.0296, 0.014, 0.004, SHEETS.hand.y0 + 58],
    [0.158, 0.024, 0.0108, 0.01, SHEETS.hand.y0 + 78],
  ],
  tip: [0.184, 0.013],
  fan: [0.14, 0.01],
  bend: [0.13, 0.009],
  thumbDir: [0.62, 0.55, 0.42],
  thumbR: [
    [0.0122, 0.0105],
    [0.0098, 0.0088],
  ],
  thumbAt: [0.035, 0.061, 0.042],
  hand: SHEETS.hand,
  thumb: SHEETS.thumb,
};

/** Рукав мантии — широкий, раструбом к запястью: кольца по плечу и предплечью (сдвиг по оси, полуоси, строка листа). */
export const SLEEVE = {
  upper: [
    [0.03, 0.04, 0.042, 409],
    [0.1, 0.052, 0.05, 432],
    [0.27, 0.06, 0.058, 462],
  ],
  fore: [
    [0.12, 0.068, 0.066, 486],
    [0.262, 0.082, 0.078, 510],
  ],
} as const;

function buildArm(m: SkinMesh, sx: 1 | -1): void {
  const side = sx === 1 ? 'L' : 'R';
  const mx = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
  const S = mx(SHOULDER);
  const E = mx(ELBOW);
  const W = mx(WRIST);
  const d1 = norm(sub(E, S));
  const d2 = norm(sub(W, E));
  const fw: V3 = [0, 0, 1];
  const out1 = scale(norm(crs(fw, d1)), sx);
  const out2 = scale(norm(crs(fw, d2)), sx);
  const inner = Math.PI;
  const sl = SHEETS.sleeve;
  const uvS = (v: number) => (k: number): [number, number] => uvB(sl.x0 + 1 + k * (sl.x1 - sl.x0 - 2), v);
  const arm = `arm${side}`;
  const fore = `fore${side}`;
  const top = m.v(add(S, add(scale(d1, -0.02), scale(out1, -0.01))), uvB(sl.x0 + 80, sl.y0 + 1), 0, [arm, 'chest', 0.6]);
  const [u0, u1, u2] = SLEEVE.upper;
  const [f1, f2] = SLEEVE.fore;
  // Раструб висит ниже руки: середина колец рукава — к низу (к полу) на долю радиуса.
  const sag = (r: number): V3 => [0, -r * 0.25, 0];
  const rings = [
    tube(m, add(S, scale(d1, u0[0])), out1, fw, u0[1], u0[2], 8, uvS(u0[3]), [arm, 'chest', 0.65], inner),
    tube(m, add(S, scale(d1, u1[0])), out1, fw, u1[1], u1[2], 8, uvS(u1[3]), arm, inner),
    tube(m, add(S, scale(d1, u2[0])), out1, fw, u2[1], u2[2], 8, uvS(u2[3]), [arm, fore, 0.5], inner),
    tube(m, add(add(E, scale(d2, f1[0])), sag(f1[1])), out2, fw, f1[1], f1[2], 8, uvS(f1[3]), fore, inner),
    tube(m, add(add(E, scale(d2, f2[0])), sag(f2[1])), out2, fw, f2[1], f2[2], 8, uvS(f2[3]), fore, inner),
  ];
  const first = rings[0];
  for (let k = 0; k < first.length - 1; k++) m.quad(top, first[k], first[k + 1], top, S);
  m.strip(rings, false, (p) => {
    const t1 = (p[0] - S[0]) * d1[0] + (p[1] - S[1]) * d1[1] + (p[2] - S[2]) * d1[2];
    if (t1 < 0.27) return add(S, scale(d1, Math.max(-0.03, t1)));
    const t2 = (p[0] - E[0]) * d2[0] + (p[1] - E[1]) * d2[1] + (p[2] - E[2]) * d2[2];
    return add(E, scale(d2, t2));
  });
  mitten(m, sx, W, d2, thumbBase(), MITTEN);
}

/** Собрать фигуру: голова (маска, волосы, уши, борода), шея и мантия, ворот, цепь с медальоном, руки. Ног нет. */
export function buildAdvisorMesh(head: Head): SkinMesh {
  const m = new SkinMesh(advisorSkeleton(head));
  head.build(m);
  buildCap(m, head);
  buildEars(m, (th, h) => capPt(head, th, h, 0), head.HZ, EAR, EAR_SHEET, 1, 'head');
  buildBeard(m, head);
  place(m, 0, toFigure(headFrame(head)));
  buildRobe(m);
  buildCollar(m);
  buildChain(m);
  buildArm(m, 1);
  buildArm(m, -1);
  return m;
}

/** Ширина уха на листе по столбцам (для листа лица). */
export const EAR_U = EAR_COLS.map((c) => c.u);
