// Фигура супруги (ЛЦ-2, docs/characters.md): скелет и сетка в духе классического Warcraft III — голова около 1/4,6 роста,
// крупные наплечники сорочки и кисти, тонкая талия, широкие бёдра под юбкой-колоколом до пола. Тела под одеждой нет: юбка —
// открытый конус без ног (изнутри — тёмная заливка шейдера), под волосами нет затылка, под наплечниками — плеча.
//
// Скелет — 19 костей: таз, поясница, грудь, шея, голова, челюсть, веки, волосы; по руке — плечо, предплечье, кисть,
// большой палец; юбка — перед, зад, бока. Ног нет ни в сетке, ни в костях: ходьба — скольжение с покачиванием корпуса и юбки.
//
// Лист тела 512 × 512 (y — вниз): волосы 0…128, торс с шеей 128…288, юбка 288…416, руки 416…512. Волосы, торс и юбка —
// зеркальные половины: u = |угол| / π, середина спереди — левый край листа, середина сзади — правый; край листа не
// повторяется (`ClampToEdge`), поэтому на линии зеркала шва нет.
import type { V3 } from '../../city/geom';
import { Skeleton } from '../rig';
import { SkinMesh, add, scale, sub, type Weights } from './skin';
import { HZ, buildHead, eyeCenter } from './head';

/** Кости по порядку (родитель раньше ребёнка). */
export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'lids', 'hair', 'armL', 'foreL', 'handL', 'thumbL', 'armR', 'foreR', 'handR', 'thumbR', 'skirtF', 'skirtB', 'skirtS'] as const;
export type Bone = (typeof BONES)[number];

/**
 * Пропорции — как у образца, близко к живым (решение владельца, поправка к ЛЦ-2): голова — 1/7 роста. Сетка и кости
 * строятся в своих «чертёжных» мерах, а пропорции подгоняются масштабом: голова (лицо, волосы над шеей, обруч и суставы
 * головы, челюсти, век и волос) — от основания черепа (`HEAD_SCALE`, чуть ниже на `HEAD_DROP` — шея короче), потом вся
 * фигура — к росту `HEIGHT` (`BODY_SCALE`).
 */
export const HEAD_SCALE = 0.703;
const HEAD_PIVOT: V3 = [0, 1.3, -0.02];
const HEAD_DROP = 0.024;
/** Голова — выше шеи; между — плавно (волосы, спадающие на спину, остаются в мерах тела). */
const HEAD_FROM = 1.22;
const HEAD_TO = 1.3;
const headScaled = (p: V3): V3 => [HEAD_PIVOT[0] + (p[0] - HEAD_PIVOT[0]) * HEAD_SCALE, HEAD_PIVOT[1] + (p[1] - HEAD_PIVOT[1]) * HEAD_SCALE - HEAD_DROP, HEAD_PIVOT[2] + (p[2] - HEAD_PIVOT[2]) * HEAD_SCALE];
/** Макушка волос (чертёжная). */
const HAIR_TOP: V3 = [0, 1.581, -0.024];

/** Рост от пола до макушки волос, м (как у прежней супруги покоев: 0,96 от 1,72). */
export const HEIGHT = 1.65;
export const BODY_SCALE = HEIGHT / headScaled(HAIR_TOP)[1];
const grown = (p: V3): V3 => [p[0] * BODY_SCALE, p[1] * BODY_SCALE, p[2] * BODY_SCALE];
/** Точка головы (чертёжная) → на фигуре; точка тела → на фигуре. */
const atHead = (p: V3): V3 => grown(headScaled(p));
const atBody = (p: V3): V3 => {
  const k = smooth(HEAD_FROM, HEAD_TO, p[1]);
  if (k <= 0) return grown(p);
  const q = headScaled(p);
  return grown([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]);
};

/** Суставы руки в позе покоя (левая, +x): плечо, локоть, запястье — руки свободно вниз и чуть в стороны от юбки. */
const SHOULDER: V3 = [0.166, 1.19, -0.012];
const ELBOW: V3 = [0.212, 0.958, -0.014];
const WRIST: V3 = [0.243, 0.756, 0.0];

export function consortSkeleton(): Skeleton {
  const sk = new Skeleton();
  const eye = eyeCenter(1);
  sk.add('hips', null, grown([0, 0.84, 0]));
  sk.add('spine', 'hips', grown([0, 0.92, -0.004]));
  sk.add('chest', 'spine', grown([0, 1.06, 0]));
  sk.add('neck', 'chest', grown([0, 1.222, -0.014]));
  sk.add('head', 'neck', atHead([0, 1.372, -0.024]));
  sk.add('jaw', 'head', atHead([0, 1.388, -0.032]));
  sk.add('lids', 'head', atHead([0, eye[1], eye[2]]));
  sk.add('hair', 'head', atHead([0, 1.35, -0.09]));
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const m = (p: V3): V3 => grown([p[0] * sx, p[1], p[2]]);
    sk.add(`arm${side}`, 'chest', m(SHOULDER));
    sk.add(`fore${side}`, `arm${side}`, m(ELBOW));
    sk.add(`hand${side}`, `fore${side}`, m(WRIST));
    sk.add(`thumb${side}`, `hand${side}`, m(thumbBase()));
  }
  sk.add('skirtF', 'hips', grown([0, 0.8, 0.04]));
  sk.add('skirtB', 'hips', grown([0, 0.8, -0.04]));
  sk.add('skirtS', 'hips', grown([0, 0.8, 0]));
  return sk;
}

/** Лист тела в долях: точки (x, y — вниз) → UV. */
const BODY_PX = 512;
const uvB = (x: number, y: number): [number, number] => [x / BODY_PX, y / BODY_PX];
/** Зеркальные листы: середина спереди — левый край листа (0), сзади — правый (512); выборка у края его не переходит. */
export const mirrorU = (a: number): number => (Math.min(Math.PI, Math.abs(a)) / Math.PI) * BODY_PX;

export const SHEETS = {
  hair: { y0: 0, y1: 128 },
  torso: { y0: 128, y1: 288 },
  skirt: { y0: 288, y1: 416 },
  sleeve: { x0: 0, x1: 192, y0: 416, y1: 512 },
  fore: { x0: 192, x1: 320, y0: 416, y1: 512 },
  hand: { x0: 320, x1: 448, y0: 416, y1: 512 },
  thumb: { x0: 448, x1: 480, y0: 448, y1: 512 },
  gold: { x0: 480, x1: 512, y0: 416, y1: 512 },
} as const;

/** Кольцо вокруг вертикали по углам `angles` (0 — перед, + — к левому боку): полуоси, сдвиг середины вперёд. */
const ringPt = (a: number, y: number, rx: number, rz: number, zc: number): V3 => [rx * Math.sin(a), y, zc + rz * Math.cos(a)];

/** Углы кольца зеркальной половины: 0, правая сторона и левая — по одному набору (`half` — от 0 до π включительно). */
function mirrorRing(half: readonly number[]): number[] {
  const out = [...half];
  for (let i = half.length - 2; i >= 1; i--) out.push(-half[i]);
  return out;
}

// ---------- Торс и шея ----------

const TORSO_A = mirrorRing([0, 0.25, 0.5, 0.85, 1.25, 1.75, 2.35, Math.PI]);

/** Ряды торса сверху вниз: высота, полуоси, сдвиг середины, доля груди, кости. */
export const TORSO: readonly { y: number; rx: number; rz: number; zc: number; bust: number; w: Weights }[] = [
  // Шея — короткая и плотная, плавно уходит в трапецию и плечи.
  { y: 1.3, rx: 0.032, rz: 0.032, zc: -0.014, bust: 0, w: ['head', 'neck', 0.55] },
  { y: 1.25, rx: 0.034, rz: 0.034, zc: -0.012, bust: 0, w: ['neck', 'chest', 0.6] },
  { y: 1.233, rx: 0.056, rz: 0.046, zc: -0.013, bust: 0, w: ['neck', 'chest', 0.4] },
  { y: 1.214, rx: 0.1, rz: 0.062, zc: -0.016, bust: 0, w: ['chest', 'neck', 0.85] },
  { y: 1.196, rx: 0.15, rz: 0.076, zc: -0.016, bust: 0, w: 'chest' },
  { y: 1.16, rx: 0.157, rz: 0.088, zc: -0.008, bust: 0.22, w: 'chest' },
  { y: 1.112, rx: 0.152, rz: 0.093, zc: -0.004, bust: 0.82, w: 'chest' },
  { y: 1.07, rx: 0.145, rz: 0.094, zc: -0.002, bust: 1, w: 'chest' },
  { y: 1.03, rx: 0.135, rz: 0.091, zc: 0, bust: 0.72, w: 'chest' },
  { y: 0.99, rx: 0.123, rz: 0.086, zc: 0, bust: 0.06, w: ['chest', 'spine', 0.55] },
  { y: 0.85, rx: 0.103, rz: 0.079, zc: 0.002, bust: 0, w: ['spine', 'hips', 0.45] },
];
/** Грудь: выступ вперёд над рядом, по углу — два холма у ±0,5 рад с ложбинкой посередине. */
export const BUST = { depth: 0.05, at: 0.5, width: 0.33 } as const;
const bustAt = (a: number): number => Math.exp(-(((Math.abs(a) - BUST.at) / BUST.width) ** 2));

function torsoPoint(a: number, r: (typeof TORSO)[number]): V3 {
  const p = ringPt(a, r.y, r.rx, r.rz, r.zc);
  const b = BUST.depth * r.bust * bustAt(a);
  return [p[0] + b * 0.32 * Math.sin(a), p[1] - b * 0.12, p[2] + b * Math.cos(a)];
}

/** Ряды торса на листе: по длине поверхности у вершины груди (столбец 0,5 рад), 160 точек на всё. */
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
  { y: 0.878, rx: 0.098, rz: 0.077, zc: 0.002, fold: 0, v: 289 },
  { y: 0.77, rx: 0.206, rz: 0.17, zc: 0.006, fold: 0.008, v: 301 },
  { y: 0.52, rx: 0.262, rz: 0.236, zc: 0.016, fold: 0.022, v: 337 },
  { y: 0.27, rx: 0.31, rz: 0.286, zc: 0.025, fold: 0.032, v: 373 },
  { y: 0.006, rx: 0.354, rz: 0.332, zc: 0.03, fold: 0.038, v: 415 },
];

/** Кость юбки по углу: перед, бока, зад — два веса на вершину. */
function skirtWeight(a: number, row: number): Weights {
  const x = Math.abs(a);
  const pair: Weights = x < Math.PI / 2 ? ['skirtF', 'skirtS', 1 - smooth(0.35, 1.35, x)] : ['skirtB', 'skirtS', smooth(1.8, 2.8, x)];
  if (row === 0) return 'hips';
  if (row === 1) return ['hips', x < 0.8 ? 'skirtF' : x > 2.35 ? 'skirtB' : 'skirtS', 0.72];
  return pair;
}

function buildSkirt(m: SkinMesh): void {
  const rows = SKIRT.map((r, ri) =>
    SKIRT_A.map((a) => {
      // Складки: соседние столбцы — то наружу, то внутрь; к подолу глубже.
      const k = 1 + r.fold * Math.cos(8 * a) * 1.6;
      const p = ringPt(a, r.y, r.rx * k, r.rz * k, r.zc);
      return m.v(p, uvB(mirrorU(a), r.v), 0, skirtWeight(a, ri));
    }),
  );
  m.strip(rows, true, (p) => [0, p[1] + 0.1, 0]);
}

// ---------- Волосы и обруч ----------

/** Кольца волос сверху вниз: высота, полуоси, середина, проём лица (угол от середины), строка листа. */
export const HAIR: readonly { y: number; rx: number; rzF: number; rzB: number; zc: number; open: number; v: number; w: Weights }[] = [
  // Макушка — куполом, не шатром.
  { y: 1.576, rx: 0.078, rzF: 0.072, rzB: 0.082, zc: -0.022, open: 0, v: 8, w: 'head' },
  { y: 1.553, rx: 0.114, rzF: 0.106, rzB: 0.12, zc: -0.022, open: 0, v: 22, w: 'head' },
  // Линия волос над лбом — дугой: проём начинается уже под обручем (пробор над ним прячет лента).
  { y: 1.505, rx: 0.138, rzF: 0.114, rzB: 0.136, zc: -0.022, open: 0.26, v: 38, w: 'head' },
  // Объёмом обрамляют лицо: у висков и щёк — шире головы.
  { y: 1.462, rx: 0.16, rzF: 0.11, rzB: 0.142, zc: -0.024, open: 0.8, v: 54, w: 'head' },
  { y: 1.4, rx: 0.165, rzF: 0.1, rzB: 0.14, zc: -0.028, open: 1.12, v: 70, w: 'head' },
  { y: 1.31, rx: 0.158, rzF: 0.08, rzB: 0.132, zc: -0.034, open: 1.2, v: 88, w: ['head', 'hair', 0.75] },
  // Ниже — уже в мерах тела (не голова): волосы ложатся на плечи и спину.
  { y: 1.185, rx: 0.13, rzF: 0.05, rzB: 0.078, zc: -0.05, open: 2.0, v: 106, w: ['hair', 'head', 0.55] },
  { y: 1.05, rx: 0.112, rzF: 0.04, rzB: 0.064, zc: -0.06, open: 2.2, v: 126, w: 'hair' },
];
const HAIR_K = 6;

function hairPoint(a: number, r: (typeof HAIR)[number]): V3 {
  const rz = Math.cos(a) >= 0 ? r.rzF : r.rzB;
  return ringPt(a, r.y, r.rx, rz, r.zc);
}

/** Углы кольца волос: от края проёма к затылку по обе стороны (у сплошного кольца края совпадают посередине). */
function hairAngles(open: number): number[] {
  const side = Array.from({ length: HAIR_K + 1 }, (_, k) => open + ((Math.PI - open) * k) / HAIR_K);
  return [...side, ...side.slice(0, -1).reverse().map((a) => -a)];
}

function buildHair(m: SkinMesh): void {
  const rows = HAIR.map((r, ri) =>
    hairAngles(r.open).map((a, k) => {
      let p = hairPoint(a, r);
      // Концы прядей: нижний край зубцами — через столбец длиннее.
      if (ri === HAIR.length - 1) p = [p[0], p[1] - (k % 2 === 0 ? 0.05 : 0), p[2]];
      // Пряди у щёк — чуть к лицу, чтобы между волосами и щекой не было щели.
      const edge = k === 0 || k === HAIR_K * 2;
      // Пряди у щёк — за силуэтом лица (контур лица — овал, его рисует граница волос на листе лица).
      if (edge && r.open > 0.5 && ri < HAIR.length - 2) p = [p[0] * 0.93, p[1], p[2] - 0.004];
      return m.v(p, uvB(mirrorU(a), r.v), 0, r.w);
    }),
  );
  // Макушка — веер из одной точки.
  // Макушка — в ровном тоне волос середины листа (у края листа — пробор цвета кожи, ему на макушке не место).
  const top = m.v(HAIR_TOP, uvB(256, 3), 0, 'head');
  const first = rows[0];
  for (let k = 0; k + 1 < first.length; k++) m.quad(top, first[k], first[k + 1], top, [0, 1.5, -0.02]);
  m.strip(rows, false, (p) => [0, p[1] + (p[1] < 1.3 ? 0.05 : 0), p[1] < 1.3 ? -0.03 : HZ]);
}

/** Обруч: золотая лента по волосам над лбом и камень посередине. */
function buildCirclet(m: SkinMesh): void {
  const g = SHEETS.gold;
  const band = (k: number, a: number): V3 => {
    // Лента между вторым и третьим кольцом волос, чуть снаружи; спереди ниже, к затылку выше.
    const r0 = HAIR[1];
    const r1 = HAIR[2];
    // Спереди — на линии волос у лба, к затылку — выше: по голове наискось (спереди видно, что лента огибает голову).
    const f = 0.55 + 0.4 * Math.cos(a);
    const r = { y: r0.y + (r1.y - r0.y) * f, rx: r0.rx + (r1.rx - r0.rx) * f + 0.004, rzF: r0.rzF + (r1.rzF - r0.rzF) * f + 0.005, rzB: r0.rzB + (r1.rzB - r0.rzB) * f + 0.004, zc: r0.zc, open: 0, v: 0, w: 'head' as Weights };
    const p = hairPoint(a, r);
    return [p[0], p[1] + k * 0.011, p[2]];
  };
  const angles = mirrorRing(Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 7));
  const gy = (a: number): number => g.y0 + 1 + (Math.abs(a) / Math.PI) * (g.y1 - g.y0 - 2);
  const rows = [0, 1].map((k) => angles.map((a) => m.v(band(k, a), uvB(k === 0 ? g.x1 - 2 : g.x0 + 2, gy(a)), 0, 'head')));
  m.strip(rows, true, (p) => [0, p[1], -0.02]);
  // Камень: ромб на ленте спереди.
  const c = band(0.5, 0);
  const f: V3 = [c[0], c[1], c[2] + 0.005];
  const jx = g.x0 + 16;
  const jy = g.y0 + 4;
  const top = m.v([c[0], c[1] + 0.012, c[2] + 0.001], uvB(jx, jy - 3), 0, 'head');
  const bot = m.v([c[0], c[1] - 0.012, c[2] + 0.001], uvB(jx, jy + 3), 0, 'head');
  const l = m.v([c[0] - 0.009, c[1], c[2] + 0.001], uvB(jx - 3, jy), 0, 'head');
  const r = m.v([c[0] + 0.009, c[1], c[2] + 0.001], uvB(jx + 3, jy), 0, 'head');
  const mid = m.v(f, uvB(jx, jy), 0, 'head', 1.1);
  const inside: V3 = [c[0], c[1], c[2] - 0.05];
  m.quad(top, r, mid, top, inside);
  m.quad(r, bot, mid, r, inside);
  m.quad(bot, l, mid, bot, inside);
  m.quad(l, top, mid, l, inside);
}

// ---------- Руки ----------

/** Начало большого пальца: у запястья со стороны ладони и вперёд (левая рука). */
function thumbBase(): V3 {
  const a = norm(sub([WRIST[0] + 0.035, WRIST[1] - 0.205, WRIST[2] + 0.012], WRIST));
  return add(add(WRIST, scale(a, 0.028)), [-0.01, 0, 0.017]);
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Кольцо поперёк оси `d` с середины `c`: полуоси по `u` и `v`, `seg` углов + шов (последняя — копия первой с u = 1). */
function tube(m: SkinMesh, c: V3, u: V3, v: V3, ru: number, rv: number, seg: number, uv: (k: number) => [number, number], w: Weights, phase = 0): number[] {
  const out: number[] = [];
  for (let k = 0; k <= seg; k++) {
    const a = phase + (k / seg) * Math.PI * 2;
    const p = add(c, add(scale(u, Math.cos(a) * ru), scale(v, Math.sin(a) * rv)));
    out.push(m.v(p, uv(k / seg), 0, w));
  }
  return out;
}

function buildArm(m: SkinMesh, sx: 1 | -1): void {
  const side = sx === 1 ? 'L' : 'R';
  const mx = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
  const S = mx(SHOULDER);
  const E = mx(ELBOW);
  const W = mx(WRIST);
  const d1 = norm(sub(E, S));
  const d2 = norm(sub(W, E));
  // Поперёк руки: «вперёд» и «наружу». Шов кольца — с внутренней стороны руки (к телу), его не видно.
  const fw: V3 = [0, 0, 1];
  const out1 = scale(norm(crs(fw, d1)), sx);
  const out2 = scale(norm(crs(fw, d2)), sx);
  const inner = Math.PI;
  const sl = SHEETS.sleeve;
  const sleeveUv = (v: number) => (k: number): [number, number] => uvB(sl.x0 + 1 + k * (sl.x1 - sl.x0 - 2), v);
  const arm = `arm${side}`;
  const fore = `fore${side}`;
  const hand = `hand${side}`;
  const chestArm: Weights = [arm, 'chest', 0.6];
  // Наплечник сорочки: шар над плечом и под ним, ниже — рукав до локтя.
  const at = (t: number, o = 0): V3 => add(add(S, scale(d1, t)), scale(out1, o));
  const puffTop = m.v(at(-0.05, 0.012), uvB(sl.x0 + 96, sl.y0 + 1), 0, chestArm);
  const puff = [
    tube(m, at(-0.032, 0.014), out1, fw, 0.05, 0.05, 8, sleeveUv(sl.y0 + 14), chestArm, inner),
    tube(m, at(0.008, 0.018), out1, fw, 0.078, 0.074, 8, sleeveUv(sl.y0 + 34), arm, inner),
    tube(m, at(0.062, 0.012), out1, fw, 0.068, 0.064, 8, sleeveUv(sl.y0 + 56), arm, inner),
    tube(m, at(0.104, 0.004), out1, fw, 0.041, 0.04, 8, sleeveUv(sl.y0 + 70), arm, inner),
    tube(m, at(0.222, 0), out1, fw, 0.036, 0.035, 8, sleeveUv(sl.y1 - 8), [arm, fore, 0.55], inner),
  ];
  const first = puff[0];
  for (let k = 0; k < first.length - 1; k++) m.quad(puffTop, first[k], first[k + 1], puffTop, S);
  m.strip(puff, false, (p) => {
    // Ось руки: ближайшая точка на отрезке плечо — локоть.
    const t = Math.max(-0.05, Math.min(0.24, (p[0] - S[0]) * d1[0] + (p[1] - S[1]) * d1[1] + (p[2] - S[2]) * d1[2]));
    return add(S, scale(d1, t));
  });
  // Предплечье: кожа от сборки рукава до запястья.
  const fo = SHEETS.fore;
  const foreUv = (v: number) => (k: number): [number, number] => uvB(fo.x0 + 1 + k * (fo.x1 - fo.x0 - 2), v);
  const bt = (t: number): V3 => add(E, scale(d2, t));
  const forearm = [
    tube(m, bt(-0.004), out2, fw, 0.031, 0.03, 7, foreUv(fo.y0 + 2), [fore, arm, 0.7], inner),
    tube(m, bt(0.095), out2, fw, 0.029, 0.027, 7, foreUv(fo.y0 + 50), fore, inner),
    tube(m, bt(0.198), out2, fw, 0.022, 0.02, 7, foreUv(fo.y1 - 2), [hand, fore, 0.5], inner),
  ];
  m.strip(forearm, false, (p) => {
    const t = (p[0] - E[0]) * d2[0] + (p[1] - E[1]) * d2[1] + (p[2] - E[2]) * d2[2];
    return add(E, scale(d2, t));
  });
  buildHand(m, sx, W, d2);
}

/**
 * Кисть — «варежка»: ладонь с пальцами одним куском и отдельный большой палец. Покой — рука вниз, ладонь к бедру
 * (к телу), большой палец вперёд; пальцы чуть подогнуты к ладони.
 */
function buildHand(m: SkinMesh, sx: 1 | -1, W: V3, d: V3): void {
  const side = sx === 1 ? 'L' : 'R';
  const hand = `hand${side}`;
  const fore = `fore${side}`;
  const palm: V3 = [-sx, 0, 0];
  const across = scale(norm(crs(palm, d)), sx);
  const h = SHEETS.hand;
  const uvH = (v: number) => (k: number): [number, number] => uvB(h.x0 + 1 + k * (h.x1 - h.x0 - 2), v);
  // Сечения: ширина (поперёк, к большому пальцу), толщина (к ладони), сдвиг к ладони — подогнутые пальцы.
  const rings: [number, number, number, number, number][] = [
    [0, 0.021, 0.014, 0, h.y0 + 2],
    [0.058, 0.03, 0.016, 0.001, h.y0 + 34],
    [0.106, 0.0295, 0.014, 0.004, h.y0 + 58],
    [0.146, 0.024, 0.011, 0.009, h.y0 + 78],
  ];
  const inner = Math.PI / 2;
  const rows = rings.map(([t, w, th, curl, v], i) => tube(m, add(add(W, scale(d, t)), scale(palm, curl)), across, palm, w, th, 6, uvH(v), i === 0 ? [hand, fore, 0.5] : hand, inner));
  m.strip(rows, false, (p) => {
    const t = (p[0] - W[0]) * d[0] + (p[1] - W[1]) * d[1] + (p[2] - W[2]) * d[2];
    return add(add(W, scale(d, t)), scale(palm, t > 0.12 ? 0.008 : 0));
  });
  const tip = m.v(add(add(W, scale(d, 0.17)), scale(palm, 0.012)), uvB(h.x0 + 64, h.y1 - 2), 0, hand);
  const last = rows[rows.length - 1];
  for (let k = 0; k < last.length - 1; k++) m.quad(last[k], last[k + 1], tip, tip, add(add(W, scale(d, 0.13)), scale(palm, 0.009)));
  // Большой палец: от основания у запястья — вниз, вперёд и к ладони.
  const tb = SHEETS.thumb;
  const uvT = (v: number) => (k: number): [number, number] => uvB(tb.x0 + 1 + k * (tb.x1 - tb.x0 - 2), v);
  const base = [thumbBase()[0] * sx, thumbBase()[1], thumbBase()[2]] as V3;
  const td = norm(add(add(scale(d, 0.62), scale(across, 0.55)), scale(palm, 0.42)));
  const tu = norm(crs(td, palm));
  const tv = norm(crs(td, tu));
  const thumb = `thumb${side}`;
  const trs = [
    tube(m, base, tu, tv, 0.012, 0.0105, 5, uvT(tb.y0 + 2), [thumb, hand, 0.5]),
    tube(m, add(base, scale(td, 0.034)), tu, tv, 0.0098, 0.0088, 5, uvT(tb.y0 + 34), thumb),
  ];
  m.strip(trs, false, (p) => add(base, scale(td, (p[0] - base[0]) * td[0] + (p[1] - base[1]) * td[1] + (p[2] - base[2]) * td[2])));
  const ttip = m.v(add(base, scale(td, 0.058)), uvB(tb.x0 + 16, tb.y1 - 2), 0, thumb);
  const tl = trs[1];
  for (let k = 0; k < tl.length - 1; k++) m.quad(tl[k], tl[k + 1], ttip, ttip, add(base, scale(td, 0.04)));
}

const smooth = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Собрать всю фигуру: голова, волосы и обруч, торс с шеей, руки, юбка. */
export function buildConsortMesh(): SkinMesh {
  const m = new SkinMesh(consortSkeleton());
  const place = (from: number, to: (p: V3) => V3): void => {
    for (let i = from; i < m.vertexCount; i++) {
      const p = to(m.at(i));
      m.pos[i * 3] = p[0];
      m.pos[i * 3 + 1] = p[1];
      m.pos[i * 3 + 2] = p[2];
    }
  };
  buildHead(m);
  buildCirclet(m);
  place(0, atHead);
  const neck = m.vertexCount;
  buildHair(m);
  buildTorso(m);
  place(neck, atBody);
  const body = m.vertexCount;
  buildArm(m, 1);
  buildArm(m, -1);
  buildSkirt(m);
  place(body, grown);
  return m;
}

