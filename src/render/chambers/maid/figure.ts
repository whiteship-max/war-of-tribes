// Фигура служанки (ЛЦ-6, docs/characters.md): тот же набор персонажа, что у супруги, гонца, советника и кота (`kit/`), —
// сетка с кожей в два веса, мало костей, свет нарисован в листах, — а сложение молодой простой женщины, близко к живому:
// рост 1,60 м (чуть ниже супруги), голова с чепцом — 1/7 роста. Простое шерстяное платье до пола со скромным вырезом, под
// ним у шеи — край льняной сорочки; белый фартук от пояса почти до подола; льняной чепец закрывает волосы и уши, из-под
// него у лба видны волосы на пробор, а коса идёт из-под чепца через левое плечо на грудь; рукава закатаны до локтя.
// Поднос — в левой руке (своя сетка на кисти), кувшин — в правой: его кладёт жизнь покоев (`life.drawJug`), как прежде.
//
// Экономия: юбка — открытый конус от пояса до пола, ног нет ни в сетке, ни в костях (ходьба — скольжение, юбка толкается
// шагом спереди и отстаёт сзади); ушей нет — их закрывает чепец; кисть — «варежка» набора. 19 костей: таз, поясница, грудь,
// шея, голова, челюсть, веки; по руке — плечо, предплечье, кисть, большой палец; коса; юбка — перед, зад, бока.
//
// Лист тела 512 × 512 (y — вниз): чепец 0…56, коса 56…88, торс с шеей 88…248, юбка 248…384 — зеркальные половины
// (u = |угол| / π); ниже — фартук, поднос, рукав, предплечье, кисть, палец и лента (`SHEETS`).
import type { V3 } from '../../city/geom';
import type { Skeleton } from '../rig';
import { crs, mirrorRing, mirrorU, mitten, norm, place, ringPt, smooth, tube, uvB, type MittenSpec } from '../kit/body';
import type { Head } from '../kit/head';
import { upperSkeleton } from '../kit/skeleton';
import { SkinMesh, add, scale, sub, type Weights } from '../kit/skin';

/** Рост от пола до верха чепца, м: чуть ниже супруги (1,65). */
export const HEIGHT = 1.6;
/** Голова (с чепцом) — 1/7 роста (задание ЛЦ-6: пропорции близко к живым). */
export const HEAD_PART = 7;

// ---------- Голова: чертёжные меры маски → на шею ----------

const DRAW_CHIN = 1.284;
const DRAW_HZ = -0.012;
/** Купол чепца над верхом маски и толщина льна на макушке, чертёжные метры. */
export const DOME = 0.056;
const COIF_T = 0.006;

/** Голова на фигуре: масштаб, высота подбородка чертежа и ось головы по глубине — так, чтобы верх чепца был на `HEIGHT`. */
export function headFrame(head: Head): { k: number; chin: number; z: number; top: number; bottom: number } {
  const top = head.faceHeight(head.TOP_H + DOME) + COIF_T;
  const bottom = head.faceHeight(0);
  const k = HEIGHT / HEAD_PART / (top - bottom);
  return { k, chin: HEIGHT - (top - DRAW_CHIN) * k, z: -0.014, top, bottom };
}

/** Точка чертежа головы → на фигуре. */
export const toFigure =
  (f: ReturnType<typeof headFrame>) =>
  (p: V3): V3 => [p[0] * f.k, f.chin + (p[1] - DRAW_CHIN) * f.k, f.z + (p[2] - DRAW_HZ) * f.k];

// ---------- Скелет ----------

/** Суставы руки в покое (левая, +x): плечо, локоть, запястье — руки свободно вниз и чуть в стороны от юбки. */
const SHOULDER: V3 = [0.166, 1.284, -0.012];
const ELBOW: V3 = [0.205, 0.99, -0.02];
const WRIST: V3 = [0.23, 0.765, 0.0];
/** Коса: ось качания — спереди у левого плеча. */
const BRAID_ROOT: V3 = [0.088, 1.25, 0.07];

function thumbBase(): V3 {
  const a = norm(sub([WRIST[0] + 0.035, WRIST[1] - 0.205, WRIST[2] + 0.012], WRIST));
  return add(add(WRIST, scale(a, 0.027)), [-0.01, 0, 0.016]);
}

export function maidSkeleton(head: Head): Skeleton {
  const at = toFigure(headFrame(head));
  const eye = head.eyeCenter(1);
  const sk = upperSkeleton({
    hips: [0, 0.9, 0],
    spine: [0, 1.0, -0.004],
    chest: [0, 1.14, 0],
    neck: [0, 1.31, -0.016],
    head: at([0, 1.372, -0.024]),
    jaw: at([0, 1.388, -0.032]),
    lids: at([0, eye[1], eye[2]]),
    crown: [],
    shoulder: SHOULDER,
    elbow: ELBOW,
    wrist: WRIST,
    thumb: thumbBase(),
    arm: (p, sx) => [p[0] * sx, p[1], p[2]],
  });
  sk.add('braid', 'chest', BRAID_ROOT);
  sk.add('skirtF', 'hips', [0, 0.86, 0.04]);
  sk.add('skirtB', 'hips', [0, 0.86, -0.04]);
  sk.add('skirtS', 'hips', [0, 0.86, 0]);
  return sk;
}

// ---------- Лист тела ----------

export const SHEETS = {
  coif: { y0: 0, y1: 56 },
  braid: { x0: 0, x1: 512, y0: 56, y1: 88 },
  torso: { y0: 88, y1: 248 },
  skirt: { y0: 248, y1: 384 },
  apron: { x0: 0, x1: 192, y0: 384, y1: 448 },
  tray: { x0: 0, x1: 192, y0: 448, y1: 512 },
  sleeve: { x0: 192, x1: 320, y0: 384, y1: 512 },
  fore: { x0: 320, x1: 384, y0: 384, y1: 512 },
  ribbon: { x0: 384, x1: 512, y0: 384, y1: 416 },
  hand: { x0: 384, x1: 480, y0: 416, y1: 512 },
  thumb: { x0: 480, x1: 512, y0: 448, y1: 512 },
} as const;

// ---------- Чепец ----------

/**
 * Кольца чепца сверху вниз: высота над подбородком (чертёж), отступ льна от головы спереди и сзади (сзади под ним — узел
 * волос), строка листа и край проёма лица — угол от середины. Верхние три — сплошные (над лбом чепец закрывает верх маски),
 * ниже край идёт от лба по виску за щеку и под ухо, к затылку — нижний край у шеи.
 */
export const COIF: readonly { h: number; lift: readonly [number, number]; v: number; open: number }[] = [
  { h: 0.228 + 0.04, lift: [0.004, 0.012], v: 8, open: 0 },
  { h: 0.228 + 0.017, lift: [0.005, 0.016], v: 15, open: 0 },
  { h: 0.224, lift: [0.006, 0.018], v: 21, open: 0 },
  { h: 0.217, lift: [0.006, 0.019], v: 24, open: 0.42 },
  { h: 0.198, lift: [0.006, 0.02], v: 28, open: 0.8 },
  { h: 0.168, lift: [0.006, 0.021], v: 32, open: 1.02 },
  { h: 0.128, lift: [0.006, 0.02], v: 37, open: 1.18 },
  { h: 0.09, lift: [0.006, 0.018], v: 42, open: 1.3 },
  { h: 0.055, lift: [0.006, 0.016], v: 46, open: 1.4 },
  { h: 0.022, lift: [0.004, 0.013], v: 50, open: 1.44 },
  { h: -0.03, lift: [0.004, 0.009], v: 55, open: 1.9 },
];
const COIF_K = 6;

/** Край проёма лица в чепце (угол от середины) по высоте над подбородком; выше — сплошной чепец (0). */
export function coifOpen(h: number): number {
  for (let i = 1; i < COIF.length; i++) {
    const a = COIF[i - 1];
    const b = COIF[i];
    if (h <= a.h && h >= b.h) {
      if (a.open === 0 && b.open === 0) return 0;
      const k = (a.h - h) / (a.h - b.h);
      return a.open + (b.open - a.open) * k;
    }
  }
  return h > COIF[0].h ? 0 : COIF[COIF.length - 1].open;
}

/** Точка чепца (чертёж головы): лён поверх маски на `lift`, сзади — объём узла волос, выше маски — купол, ниже — к шее. */
export function coifPt(head: Head, th: number, h: number, lift: number): V3 {
  const top = head.TOP_H;
  const p = head.surf(th, Math.max(0, Math.min(h, top)));
  const a = Math.abs(th);
  // Под чепцом сзади — узел волос: затылок глубже; над ушами лён стоит свободнее.
  const back = 1 + 0.16 * smooth(1.7, 2.9, a);
  const wide = 1 + 0.05 * smooth(1.0, 1.9, a) * (1 - smooth(2.3, 3.0, a)) * smooth(0.06, 0.14, h);
  let dx = p[0] * wide;
  let dz = (p[2] - head.HZ) * (Math.cos(th) < 0 ? back : 1);
  let y = p[1];
  let up = 0;
  if (h > top) {
    const k = (h - top) / DOME;
    const s = Math.cos((Math.min(1, k) * Math.PI) / 2) ** 0.75;
    dx *= s;
    dz = dz * s - 0.016 * k;
    y = head.faceHeight(top) + (h - top);
    up = lift * k;
  }
  // Низ чепца у щёк и под затылком — к шее: изнанка у шеи не видна в проём лица.
  if (h < 0.05) {
    const k = smooth(0.05, -0.03, h) * smooth(1.2, 1.7, a);
    dx *= 1 - 0.3 * k;
  }
  if (h < 0) {
    const k = Math.min(1, -h / 0.06);
    dx *= 1 - 0.1 * k;
    dz *= 1 - 0.12 * k;
    y = Math.min(p[1], head.faceHeight(0)) + h;
  }
  const r = Math.hypot(dx, dz) || 1;
  const out = lift - up;
  return [dx + (dx / r) * out, y + up, head.HZ + dz + (dz / r) * out];
}

const liftAt = (l: readonly [number, number], th: number): number => l[0] + (l[1] - l[0]) * smooth(1.2, 2.7, Math.abs(th));

/** Углы кольца чепца: от края проёма к затылку по обе стороны (у сплошного кольца края совпадают посередине спереди). */
export function coifAngles(open: number): number[] {
  const side = Array.from({ length: COIF_K + 1 }, (_, k) => open + ((Math.PI - open) * k) / COIF_K);
  return [...side, ...side.slice(0, -1).reverse().map((a) => -a)];
}

/** Подворот края: лён у проёма лица — толще (сложен вдвое), отступ у первых столбцов. */
export const BRIM = 0.007;

function buildCoif(m: SkinMesh, head: Head): void {
  const last = COIF.length - 1;
  const rows = COIF.map((r, ri) =>
    coifAngles(r.open).map((a, k) => {
      const edge = r.open > 0 && (k === 0 || k === COIF_K * 2) ? 1 : r.open > 0 && (k === 1 || k === COIF_K * 2 - 1) ? 0.4 : 0;
      const w: Weights = r.h < 0.02 ? ['head', 'neck', ri === last ? 0.6 : 0.85] : 'head';
      return m.v(coifPt(head, a, r.h, liftAt(r.lift, a) + BRIM * edge), uvB(mirrorU(a), r.v), 0, w);
    }),
  );
  const inside = (p: V3): V3 => [0, p[1] - 0.03, head.HZ - 0.01];
  const crown = m.v(coifPt(head, 0, head.TOP_H + DOME, COIF_T), uvB(256, 2), 0, 'head');
  const first = rows[0];
  for (let k = 0; k + 1 < first.length; k++) m.quad(crown, first[k], first[k + 1], crown, [0, head.faceHeight(head.TOP_H), head.HZ - 0.01]);
  m.strip(rows, false, inside);
  // Над проёмом лица — клин до первого открытого кольца (без него у лба зиял бы треугольник изнанки).
  const shut = COIF.findIndex((r) => r.open > 0);
  const a0 = rows[shut - 1];
  const a1 = rows[shut];
  m.quad(a0[0], a1[a1.length - 1], a1[0], a0[0], [0, head.faceHeight(COIF[shut].h), head.HZ - 0.02]);
}

// ---------- Торс и шея ----------

const TORSO_A = mirrorRing([0, 0.25, 0.5, 0.85, 1.25, 1.75, 2.35, Math.PI]);

/** Ряды торса сверху вниз (оси фигуры): высота, полуоси, сдвиг середины, доля груди, кости. Верх шеи — внутри головы. */
export const TORSO: readonly { y: number; rx: number; rz: number; zc: number; bust: number; w: Weights }[] = [
  { y: 1.4, rx: 0.041, rz: 0.04, zc: -0.017, bust: 0, w: ['head', 'neck', 0.55] },
  { y: 1.345, rx: 0.042, rz: 0.04, zc: -0.016, bust: 0, w: ['neck', 'chest', 0.6] },
  { y: 1.334, rx: 0.064, rz: 0.05, zc: -0.016, bust: 0, w: ['neck', 'chest', 0.4] },
  { y: 1.318, rx: 0.112, rz: 0.066, zc: -0.018, bust: 0, w: ['chest', 'neck', 0.85] },
  { y: 1.298, rx: 0.16, rz: 0.08, zc: -0.018, bust: 0, w: 'chest' },
  { y: 1.255, rx: 0.165, rz: 0.091, zc: -0.01, bust: 0.2, w: 'chest' },
  { y: 1.198, rx: 0.16, rz: 0.097, zc: -0.005, bust: 0.8, w: 'chest' },
  { y: 1.14, rx: 0.153, rz: 0.099, zc: -0.002, bust: 1, w: 'chest' },
  { y: 1.095, rx: 0.144, rz: 0.096, zc: 0, bust: 0.65, w: 'chest' },
  { y: 1.05, rx: 0.134, rz: 0.091, zc: 0, bust: 0.05, w: ['chest', 'spine', 0.55] },
  { y: 0.94, rx: 0.124, rz: 0.088, zc: 0.002, bust: 0, w: ['spine', 'hips', 0.45] },
];
/** Грудь: скромнее, чем у супруги (0,05), — два холма у ±0,5 рад. */
export const BUST = { depth: 0.04, at: 0.5, width: 0.33 } as const;
const bustAt = (a: number): number => Math.exp(-(((Math.abs(a) - BUST.at) / BUST.width) ** 2));

function torsoPoint(a: number, r: (typeof TORSO)[number]): V3 {
  const p = ringPt(a, r.y, r.rx, r.rz, r.zc);
  const b = BUST.depth * r.bust * bustAt(a);
  return [p[0] + b * 0.32 * Math.sin(a), p[1] - b * 0.12, p[2] + b * Math.cos(a)];
}

/** Точка на торсе по углу и высоте (между рядами — прямо), снаружи на `out` по горизонтали. */
export function torsoAt(a: number, y: number, out = 0): V3 {
  let i = 1;
  while (i < TORSO.length - 1 && TORSO[i].y > y) i++;
  const r0 = TORSO[i - 1];
  const r1 = TORSO[i];
  const k = Math.max(0, Math.min(1, (r0.y - y) / (r0.y - r1.y)));
  const p0 = torsoPoint(a, r0);
  const p1 = torsoPoint(a, r1);
  const p: V3 = [p0[0] + (p1[0] - p0[0]) * k, y, p0[2] + (p1[2] - p0[2]) * k];
  const zc = r0.zc + (r1.zc - r0.zc) * k;
  const d = norm([p[0], 0, p[2] - zc]);
  return [p[0] + d[0] * out, y, p[2] + d[2] * out];
}

/** Ряды торса на листе: по длине поверхности у вершины груди (столбец 0,5 рад). */
export function torsoV(): number[] {
  const at = TORSO.map((r) => torsoPoint(BUST.at, r));
  const d = [0];
  for (let i = 1; i < at.length; i++) d.push(d[i - 1] + Math.hypot(...sub(at[i], at[i - 1])));
  const all = d[d.length - 1];
  return d.map((x) => SHEETS.torso.y0 + 1 + (x / all) * (SHEETS.torso.y1 - SHEETS.torso.y0 - 2));
}

function buildTorso(m: SkinMesh): void {
  const vs = torsoV();
  const rows = TORSO.map((r, ri) => TORSO_A.map((a) => m.v(torsoPoint(a, r), uvB(mirrorU(a), vs[ri]), 0, r.w)));
  m.strip(rows, true, (p) => [0, p[1], -0.01]);
}

// ---------- Юбка ----------

const SKIRT_A = mirrorRing(Array.from({ length: 9 }, (_, k) => (k * Math.PI) / 8));
export const SKIRT: readonly { y: number; rx: number; rz: number; zc: number; fold: number; v: number }[] = [
  { y: 0.95, rx: 0.12, rz: 0.086, zc: 0.002, fold: 0, v: 249 },
  { y: 0.84, rx: 0.215, rz: 0.178, zc: 0.006, fold: 0.008, v: 262 },
  { y: 0.57, rx: 0.268, rz: 0.24, zc: 0.016, fold: 0.02, v: 298 },
  { y: 0.3, rx: 0.305, rz: 0.282, zc: 0.024, fold: 0.028, v: 337 },
  { y: 0.006, rx: 0.338, rz: 0.318, zc: 0.028, fold: 0.032, v: 383 },
];

/** Кость юбки по углу: перед, бока, зад — два веса на вершину. */
function skirtWeight(a: number, row: number): Weights {
  const x = Math.abs(a);
  if (row === 0) return 'hips';
  if (row === 1) return ['hips', x < 0.8 ? 'skirtF' : x > 2.35 ? 'skirtB' : 'skirtS', 0.72];
  return x < Math.PI / 2 ? ['skirtF', 'skirtS', 1 - smooth(0.35, 1.35, x)] : ['skirtB', 'skirtS', smooth(1.8, 2.8, x)];
}

function buildSkirt(m: SkinMesh): void {
  const rows = SKIRT.map((r, ri) =>
    SKIRT_A.map((a) => {
      const k = 1 + r.fold * Math.cos(8 * a) * 1.6;
      return m.v(ringPt(a, r.y, r.rx * k, r.rz * k, r.zc), uvB(mirrorU(a), r.v), 0, skirtWeight(a, ri));
    }),
  );
  m.strip(rows, true, (p) => [0, p[1] + 0.1, 0]);
}

// ---------- Фартук ----------

/** Фартук: передняя половина юбки от пояса почти до подола, поверх складок; углы краёв — ±0,95 рад. */
export const APRON_A = [-0.95, -0.62, -0.3, 0, 0.3, 0.62, 0.95] as const;
export const APRON_Y = [0.955, 0.84, 0.57, 0.3, 0.17] as const;

/** Точка фартука: на юбке (над гребнями складок) или на торсе у пояса, снаружи на `out`. */
export function apronPt(a: number, y: number, out: number): V3 {
  let i = 1;
  while (i < SKIRT.length - 1 && SKIRT[i].y > y) i++;
  const r0 = SKIRT[i - 1];
  const r1 = SKIRT[i];
  const k = Math.max(0, Math.min(1, (r0.y - y) / (r0.y - r1.y)));
  const L = (p: number, q: number): number => p + (q - p) * k;
  const fold = 1 + L(r0.fold, r1.fold) * 1.6;
  const rx = Math.max(L(r0.rx, r1.rx) * fold, y > 0.9 ? 0.126 : 0);
  const rz = Math.max(L(r0.rz, r1.rz) * fold, y > 0.9 ? 0.09 : 0);
  // Лён висит прямее юбки: у подола чуть отходит от неё спереди.
  const hang = 0.012 * smooth(0.8, 0.2, y) * Math.cos(a);
  const p = ringPt(a, y, rx + out, rz + out + hang, L(r0.zc, r1.zc));
  return p;
}

function buildApron(m: SkinMesh): void {
  const b = SHEETS.apron;
  const rows = APRON_Y.map((y, ri) =>
    APRON_A.map((a) => {
      const u = b.x0 + 1 + (Math.abs(a) / 0.95) * (b.x1 - b.x0 - 2);
      const v = b.y0 + 1 + (ri / (APRON_Y.length - 1)) * (b.y1 - b.y0 - 2);
      return m.v(apronPt(a, y, ri === 0 ? 0.006 : 0.01), uvB(u, v), 0, skirtWeight(a, Math.min(ri, 2)));
    }),
  );
  m.strip(rows, false, (p) => [0, p[1], -0.02]);
}

// ---------- Коса ----------

/** Узлы косы (оси фигуры): из-под чепца у левого уха — через плечо — на грудь; толщина и вес. */
export function braidPath(head: Head): { at: V3; r: number; w: Weights }[] {
  const at = toFigure(headFrame(head));
  const root = at(coifPt(head, 1.95, -0.012, -0.004));
  return [
    { at: root, r: 0.019, w: ['head', 'neck', 0.6] },
    { at: torsoAt(1.75, 1.348, 0.024), r: 0.02, w: ['neck', 'chest', 0.5] },
    { at: torsoAt(1.12, 1.322, 0.02), r: 0.02, w: 'chest' },
    { at: torsoAt(0.62, 1.282, 0.019), r: 0.019, w: 'chest' },
    { at: torsoAt(0.5, 1.215, 0.018), r: 0.018, w: ['braid', 'chest', 0.5] },
    { at: torsoAt(0.46, 1.14, 0.019), r: 0.017, w: 'braid' },
    { at: torsoAt(0.44, 1.075, 0.018), r: 0.015, w: 'braid' },
  ];
}

/** Сечений на звено косы и столбцов кольца; лента — у кончика, ниже — кисточка. */
const BRAID_SEG = 2;
const BRAID_RING = 6;
/** Длина кисточки ниже ленты, м. */
export const TUFT = 0.045;

function buildBraid(m: SkinMesh, head: Head): void {
  const path = braidPath(head);
  const b = SHEETS.braid;
  // Сечения: по пути с вставками посередине звеньев (Катмулл — Ром), «звенья» косы — утолщения через одно.
  const pts: { at: V3; r: number; w: Weights; t: number }[] = [];
  const n = path.length;
  for (let i = 0; i < n - 1; i++)
    for (let s = 0; s < BRAID_SEG; s++) {
      const k = s / BRAID_SEG;
      const p0 = path[Math.max(0, i - 1)].at;
      const p1 = path[i].at;
      const p2 = path[i + 1].at;
      const p3 = path[Math.min(n - 1, i + 2)].at;
      const cr = (j: number): number => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * k + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * k * k + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * k * k * k);
      const r = path[i].r + (path[i + 1].r - path[i].r) * k;
      pts.push({ at: [cr(0), cr(1), cr(2)], r, w: k < 0.5 ? path[i].w : path[i + 1].w, t: (i + k) / (n - 1) });
    }
  pts.push({ ...path[n - 1], t: 1 });
  const rings: number[][] = [];
  pts.forEach((p, i) => {
    const prev = pts[Math.max(0, i - 1)].at;
    const next = pts[Math.min(pts.length - 1, i + 1)].at;
    const d = norm(sub(next, prev));
    const out = norm([p.at[0], 0, p.at[2] + 0.02]);
    const u1 = norm(crs(d, out));
    const u2 = norm(crs(u1, d));
    // Звенья: утолщение через сечение — коса в силуэте зубчатая, а не трубкой.
    const lobe = i % 2 === 0 ? 1 : 0.84;
    const u = b.x0 + 2 + p.t * (b.x1 - b.x0 - 60);
    rings.push(tube(m, p.at, u1, u2, p.r * lobe, p.r * 0.82 * lobe, BRAID_RING, (k) => uvB(u, b.y0 + 1 + k * (b.y1 - b.y0 - 2)), p.w));
  });
  m.strip(rings, false, (q) => {
    let best = pts[0].at;
    let bd = Infinity;
    for (const p of pts) {
      const dd = Math.hypot(...sub(q, p.at));
      if (dd < bd) {
        bd = dd;
        best = p.at;
      }
    }
    return best;
  });
  // Лента и кисточка: кольцо ленты у кончика, ниже — пучок волос в точку.
  const tip = pts[pts.length - 1].at;
  const dTip = norm(sub(tip, pts[pts.length - 2].at));
  const out = norm([tip[0], 0, tip[2] + 0.02]);
  const u1 = norm(crs(dTip, out));
  const u2 = norm(crs(u1, dTip));
  const rb = SHEETS.ribbon;
  const tie = tube(m, add(tip, scale(dTip, 0.006)), u1, u2, 0.013, 0.012, BRAID_RING, (k) => uvB(rb.x0 + 2 + k * 60, rb.y0 + 16), 'braid');
  m.strip([rings[rings.length - 1], tie], false, () => tip);
  const flare = tube(m, add(tip, scale(dTip, 0.024)), u1, u2, 0.017, 0.014, BRAID_RING, (k) => uvB(b.x1 - 50 + k * 46, b.y0 + 4 + k * 24), 'braid');
  m.strip([tie, flare], false, () => add(tip, scale(dTip, 0.012)));
  const end = m.v(add(tip, scale(dTip, TUFT)), uvB(b.x1 - 28, b.y1 - 4), 0, 'braid');
  for (let k = 0; k < flare.length - 1; k++) m.quad(flare[k], flare[k + 1], end, end, add(tip, scale(dTip, 0.03)));
}

// ---------- Руки ----------

/** Рукав платья до локтя и закатанный край (валик) на локте: сдвиг по плечу / предплечью, полуоси, строка листа. */
export const SLEEVE = {
  upper: [
    [0.01, 0.06, 0.056, 386],
    [0.08, 0.054, 0.052, 410],
    [0.17, 0.047, 0.046, 436],
    [0.238, 0.046, 0.045, 456],
  ],
  // Валик: на локте — шире и выше, потом заворачивается внутрь к предплечью.
  roll: [
    [0.262, 0.057, 0.055, 470],
    [0.02, 0.058, 0.055, 490],
    [0.042, 0.037, 0.035, 510],
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
  const hand = `hand${side}`;
  const top = m.v(add(S, add(scale(d1, -0.035), scale(out1, -0.008))), uvB(sl.x0 + 64, sl.y0 + 1), 0, [arm, 'chest', 0.6]);
  const [r0, r1, r2] = SLEEVE.roll;
  const rings = [
    ...SLEEVE.upper.map(([t, a, b, v], i) => tube(m, add(S, scale(d1, t)), out1, fw, a, b, 8, uvS(v), i === 0 ? [arm, 'chest', 0.7] : i === 3 ? [arm, fore, 0.7] : arm, inner)),
    tube(m, add(S, scale(d1, r0[0])), out1, fw, r0[1], r0[2], 8, uvS(r0[3]), [arm, fore, 0.5], inner),
    tube(m, add(E, scale(d2, r1[0])), out2, fw, r1[1], r1[2], 8, uvS(r1[3]), [fore, arm, 0.65], inner),
    tube(m, add(E, scale(d2, r2[0])), out2, fw, r2[1], r2[2], 8, uvS(r2[3]), fore, inner),
  ];
  const first = rings[0];
  for (let k = 0; k < first.length - 1; k++) m.quad(top, first[k], first[k + 1], top, S);
  m.strip(rings, false, (p) => {
    const t1 = (p[0] - S[0]) * d1[0] + (p[1] - S[1]) * d1[1] + (p[2] - S[2]) * d1[2];
    if (t1 < 0.25) return add(S, scale(d1, Math.max(-0.03, t1)));
    return E;
  });
  // Предплечье: кожа из-под валика до запястья.
  const fo = SHEETS.fore;
  const foreUv = (v: number) => (k: number): [number, number] => uvB(fo.x0 + 1 + k * (fo.x1 - fo.x0 - 2), v);
  const bt = (t: number): V3 => add(E, scale(d2, t));
  const forearm = [
    tube(m, bt(0.03), out2, fw, 0.033, 0.031, 7, foreUv(fo.y0 + 2), [fore, arm, 0.8], inner),
    tube(m, bt(0.11), out2, fw, 0.03, 0.028, 7, foreUv(fo.y0 + 60), fore, inner),
    tube(m, bt(0.205), out2, fw, 0.022, 0.02, 7, foreUv(fo.y1 - 2), [hand, fore, 0.5], inner),
  ];
  m.strip(forearm, false, (p) => add(E, scale(d2, (p[0] - E[0]) * d2[0] + (p[1] - E[1]) * d2[1] + (p[2] - E[2]) * d2[2])));
  mitten(m, sx, W, d2, thumbBase(), MITTEN);
}

/** Кисть — «варежка» набора: рабочая рука, чуть шире и короче, чем у супруги. */
const MITTEN: MittenSpec = {
  rings: [
    [0, 0.022, 0.0145, 0, SHEETS.hand.y0 + 2],
    [0.056, 0.031, 0.0165, 0.001, SHEETS.hand.y0 + 34],
    [0.102, 0.0305, 0.0145, 0.004, SHEETS.hand.y0 + 58],
    [0.14, 0.025, 0.0115, 0.009, SHEETS.hand.y0 + 78],
  ],
  tip: [0.163, 0.012],
  fan: [0.125, 0.009],
  bend: [0.115, 0.008],
  thumbDir: [0.62, 0.55, 0.42],
  thumbR: [
    [0.0125, 0.011],
    [0.0102, 0.0092],
  ],
  thumbAt: [0.033, 0.056, 0.039],
  hand: SHEETS.hand,
  thumb: SHEETS.thumb,
};

// ---------- Поднос ----------

/** Поднос: деревянный круг с бортиком на левой ладони — радиус, высота бортика, сегменты; середина — от запястья. */
export const TRAY = { r: 0.14, rim: 0.018, seg: 10, along: 0.07, lift: 0.02 } as const;

/**
 * Поднос лежит на ладони: в покое кисть висит ладонью к бедру, поэтому круг строится в плоскости пальцев и «вперёд», а
 * бортик поднимается от ладони. Ладонь вверх (поза «нести») — поднос ровно.
 */
function buildTray(m: SkinMesh): void {
  const W = WRIST;
  const d0 = norm(sub(WRIST, ELBOW));
  const palm: V3 = [-1, 0, 0];
  const across = norm(crs(palm, d0));
  const c = add(add(W, scale(d0, TRAY.along)), scale(palm, TRAY.lift));
  const t = SHEETS.tray;
  const cx = t.x0 + 32;
  const cy = (t.y0 + t.y1) / 2;
  const R = 29;
  const at = (rr: number, h: number, i: number): V3 => {
    const a = (i / TRAY.seg) * Math.PI * 2;
    return add(add(c, add(scale(d0, Math.cos(a) * rr), scale(across, Math.sin(a) * rr))), scale(palm, h));
  };
  const ring = (rr: number, h: number, uv: (i: number) => [number, number]): number[] => Array.from({ length: TRAY.seg }, (_, i) => m.v(at(rr, h, i), uv(i), 0, 'handL'));
  const disc = (k: number) => (i: number): [number, number] => {
    const a = (i / TRAY.seg) * Math.PI * 2;
    return uvB(cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k);
  };
  const strip = (v: number) => (i: number): [number, number] => uvB(t.x0 + 70 + (i / TRAY.seg) * 110, v);
  const under = ring(TRAY.r - 0.008, -0.006, strip(t.y1 - 4));
  const outer = ring(TRAY.r, TRAY.rim, strip(t.y0 + 20));
  const lip = ring(TRAY.r - 0.01, TRAY.rim, strip(t.y0 + 8));
  const floor = ring(TRAY.r - 0.012, 0.004, disc(1));
  const mid = m.v(add(c, scale(palm, 0.004)), uvB(cx, cy), 0, 'handL');
  const bot = m.v(add(c, scale(palm, -0.006)), uvB(t.x0 + 120, t.y1 - 6), 0, 'handL');
  const above = add(c, scale(palm, 0.1));
  const below = add(c, scale(palm, -0.1));
  for (let i = 0; i < TRAY.seg; i++) {
    const j = (i + 1) % TRAY.seg;
    m.quad(floor[i], floor[j], mid, mid, below);
    m.quad(under[i], under[j], bot, bot, above);
  }
  // Стенки: снаружи (от низа к верху бортика) — изнутри ось, внутри бортика — к середине ниже пола.
  m.strip([under, outer], true, () => c);
  m.strip([outer, lip], true, () => add(c, scale(palm, -0.05)));
  m.strip([lip, floor], true, (p) => add(add(c, scale(palm, 0.2)), scale(sub(p, c), 3)));
}

/** Собрать фигуру: голова (маска, чепец), шея и торс, коса, юбка и фартук, руки, поднос. Ног нет. */
export function buildMaidMesh(head: Head): SkinMesh {
  const m = new SkinMesh(maidSkeleton(head));
  head.build(m);
  buildCoif(m, head);
  place(m, 0, toFigure(headFrame(head)));
  buildTorso(m);
  buildBraid(m, head);
  buildSkirt(m);
  buildApron(m);
  buildArm(m, 1);
  buildArm(m, -1);
  buildTray(m);
  return m;
}
