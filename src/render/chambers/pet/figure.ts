// Фигура кота (ЛЦ-4, docs/characters.md): набор персонажа (`kit/`) — сетка в два веса, мало костей, свет нарисован в листе,
// — на звере. Домашний кот, слегка стилизованный, как живописный зверёк WC3: голова чуть крупнее живой, большие глаза,
// пушистые щёки (зубцы края по скулам), пышный хвост (кольца с поворотом через одно — рваный край шерсти).
//
// Скелет — `cat.catSkeleton` (25 костей; мозг кота водит его и без сетки). Голова — сфера с выпуклостями по направлениям
// (морда, подушечки усов, щёки, глазницы), глаза — свои чашечки на листе глаза (зрачок — ячейкой листа: щель днём, круглый
// ночью), веки — одна кость на оба глаза: чашка века поднята под лоб и опускается поворотом вокруг оси через оба глаза.
// Нижняя челюсть — подбородок своей костью: открыт рот — под ним тёмное нутро, нарисованное на голове. Усы — тонкие
// полоски с прозрачностью (`SkinMesh.fade`), их грани — последними.
//
// Лист — один, 512 × 512 (y — вниз; `SHEET`): голова сферой (долгота — от носа к затылку, широта — синусом: у экватора, где
// морда, точек больше — «морда повышенной плотности»), туловище, шея, хвост, лапы, ячейки глаза и века, уши, усы, клубок.
// Половины зеркальны: левый бок и правый — одни точки.
import type { V3 } from '../../city/geom';
import { CAT_EYE, LID_CLOSE, TAIL_BONES, catSkeleton } from '../cat';
import { mirrorRing, mirrorU, norm, crs, smooth } from '../kit/body';
import { SkinMesh, add, scale, sub, type Weights } from '../kit/skin';

/** Лист кота — 512 точек. */
export const PX = 512;
const uv = (x: number, y: number): [number, number] => [x / PX, y / PX];

/** Раскладка листа, точки. */
export const SHEET = {
  head: { x0: 0, x1: 512, y0: 0, y1: 208 },
  torso: { x0: 0, x1: 316, y0: 208, y1: 400 },
  neck: { x0: 320, x1: 508, y0: 208, y1: 252 },
  tail: { x0: 320, x1: 444, y0: 256, y1: 512 },
  fore: { x0: 448, x1: 478, y0: 256, y1: 396 },
  hind: { x0: 482, x1: 512, y0: 256, y1: 396 },
  paw: { x0: 448, x1: 512, y0: 400, y1: 444 },
  yarn: { x0: 448, x1: 512, y0: 448, y1: 512 },
  /** Ячейки глаза 64 × 64: зрачок щелью, вполовину, круглый; веко; уши (снаружи, внутри); усы. */
  eye: { y0: 408, y1: 472, cx: [32, 96, 160] as const, cy: 440 },
  lid: { x0: 192, x1: 256, y0: 408, y1: 472 },
  earBack: { x0: 256, x1: 286, y0: 404, y1: 470 },
  earFront: { x0: 288, x1: 318, y0: 404, y1: 470 },
  whisker: { x0: 196, x1: 252, y0: 480, y1: 500 },
  /** Подбородок спереди (зеркально: середина — x0), низ — y1. */
  chin: { x0: 0, x1: 92, y0: 476, y1: 512 },
} as const;
/** Радиус края глаза в ячейке, точки. */
export const EYE_PX = 22;

// ---------- Голова ----------

/** Середина головы (оси кота). */
export const HEAD_C: V3 = [0, 0.286, 0.197];
const DEG = Math.PI / 180;
/** Долготы половины головы (0 — нос, π — затылок) и широты рядов (вверх +). */
const LON = mirrorRing([0, 14, 30, 46, 64, 86, 112, 145, 180].map((d) => d * DEG));
const LAT = [62, 38, 18, 2, -14, -30, -48, -70].map((d) => d * DEG);

/** Направление от середины головы по долготе и широте. */
export const dirOf = (lon: number, lat: number): V3 => [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];

/** Выпуклость по направлению: гаусс по долготе (по модулю — зеркально) и широте, градусы. */
const bump = (lon: number, lat: number, l0: number, b0: number, sl: number, sb: number): number => Math.exp(-(((Math.abs(lon) / DEG - l0) / sl) ** 2) - ((lat / DEG - b0) / sb) ** 2);

/** Меры головы облика (рыжий шире в щеках, чёрно-белый — тоньше в морде). */
export interface HeadSpec {
  /** Пушистость щёк, м — выпуклость и зубцы края. */
  cheek: number;
  /** Морда вперёд, м. */
  muzzle: number;
}

/** Радиус головы по направлению, м: эллипсоид, морда, подушечки усов, глазницы, надбровье, щёки, подбородок. */
export function headRadius(lon: number, lat: number, s: HeadSpec): number {
  const d = dirOf(lon, lat);
  let r = 1 / Math.hypot(d[0] / 0.049, d[1] / 0.044, d[2] / 0.046);
  r += s.muzzle * bump(lon, lat, 0, -20, 20, 13);
  r += 0.005 * bump(lon, lat, 17, -21, 11, 9);
  r -= 0.0045 * bump(lon, lat, 32, 4, 12, 9);
  r += 0.0022 * bump(lon, lat, 28, 18, 16, 7);
  r += s.cheek * bump(lon, lat, 78, -16, 20, 12);
  r -= 0.004 * bump(lon, lat, 0, -50, 26, 12);
  r -= 0.004 * smooth(45, 80, lat / DEG);
  return r;
}

/** Точка головы по направлению. */
export const headPt = (lon: number, lat: number, s: HeadSpec, extra = 0): V3 => add(HEAD_C, scale(dirOf(lon, lat), headRadius(lon, lat, s) + extra));

/** Долгота и широта точки около головы — от середины головы (листу: подбородок, кромки). */
export function lonLatOf(p: V3): [number, number] {
  const d = sub(p, HEAD_C);
  return [Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
}

/** Голова в лист: x — долгота (зеркально), y — синус широты (у экватора плотнее). */
export const headUv = (lon: number, lat: number): [number, number] => uv(mirrorU(lon), (SHEET.head.y1 / 2) * (1 - Math.sin(lat)));

// ---------- Глаз ----------

/** Радиус глазного яблока и раствор видимой чашечки (от оси глаза), рад. */
export const EYE_R = 0.0135;
export const EYE_OPEN = 58 * DEG;
const LID_CUP = 66 * DEG;
/** Ось глаза: вперёд, на 22° наружу и на 3° вверх. */
export const eyeAxis = (sx: 1 | -1): V3 => norm([Math.sin(22 * DEG) * sx, Math.sin(3 * DEG), Math.cos(22 * DEG)]);
/** Середина глазного яблока стороны. */
export const eyeCenter = (sx: 1 | -1): V3 => [CAT_EYE[0] * sx, CAT_EYE[1], CAT_EYE[2]];
/** Сдвиг белка: доля листа на метр взгляда (край глаза — `EYE_PX` точек). */
export const GAZE_UV = EYE_PX / PX / (EYE_R * Math.sin(EYE_OPEN));

/** Оси глаза: `ax` — по горизонтали к +x у обоих глаз (взгляд сдвигает оба одинаково), `ay` — вверх. */
function eyeFrame(sx: 1 | -1): { n: V3; ax: V3; ay: V3 } {
  const n = eyeAxis(sx);
  const ax = norm(crs([0, 1, 0], n));
  return { n, ax, ay: crs(n, ax) };
}

/** Точка чашечки: угол по кругу `th` (0 — к +x), раствор `b` от оси, миндаль (выше — уже), наружный угол чуть вверх. */
function cupPt(sx: 1 | -1, th: number, b: number, r: number): V3 {
  const { n, ax, ay } = eyeFrame(sx);
  const outer = Math.cos(th) * sx;
  const tall = 0.8 + 0.08 * outer;
  const dir = add(scale(n, Math.cos(b)), scale(add(scale(ax, Math.cos(th)), scale(ay, Math.sin(th) * tall + 0.12 * Math.max(0, outer) * Math.cos(th) * sx)), Math.sin(b)));
  return add(eyeCenter(sx), scale(norm(dir), r));
}

/** Край глаза стороны `sx` в листе головы (долгота, широта): `k` — во сколько раз шире чашечки (обводка, светлое кольцо). */
export function eyeRimLonLat(sx: 1 | -1, k: number, n = 16): [number, number][] {
  return Array.from({ length: n }, (_, i) => lonLatOf(cupPt(sx, (i / n) * Math.PI * 2, Math.min(1.45, EYE_OPEN * k), EYE_R)));
}

/** Поворот вокруг оси x через точку (кость `lids`): плюс — вперёд и вниз, как `rig.rotYXZ`. */
function rotX(p: V3, c: V3, a: number): V3 {
  const y = p[1] - c[1];
  const z = p[2] - c[2];
  return [p[0], c[1] + y * Math.cos(a) - z * Math.sin(a), c[2] + y * Math.sin(a) + z * Math.cos(a)];
}

// ---------- Сборка ----------

/** Точки кольца: середина, оси, полуоси, углы (0 — верх по `v`), лист и кость каждой точки. */
function ring(m: SkinMesh, c: V3, u: V3, v: V3, ru: number, rv: number, angles: readonly number[], at: (a: number) => [number, number], w: Weights, fluff?: (k: number, a: number) => number): number[] {
  return angles.map((a, k) => {
    const f = 1 + (fluff?.(k, a) ?? 0);
    const p = add(c, add(scale(u, Math.sin(a) * ru * f), scale(v, Math.cos(a) * rv * f)));
    return m.v(p, at(a), 0, w);
  });
}

/** Конус от кольца к точке (концы лап и хвоста, торцы туловища). */
function fan(m: SkinMesh, rowIdx: readonly number[], tip: number, inside: V3): void {
  for (let k = 0; k < rowIdx.length; k++) m.quad(rowIdx[k], rowIdx[(k + 1) % rowIdx.length], tip, tip, inside);
}

/** Вес между костями по доле: до 0 — `a`, после 1 — `b`. */
const blendW = (a: string, b: string, k: number): Weights => (k <= 0.02 ? a : k >= 0.98 ? b : [a, b, 1 - k]);

export function buildCatMesh(s: HeadSpec): SkinMesh {
  const sk = catSkeleton();
  const m = new SkinMesh(sk);
  head(m, s);
  neck(m);
  torso(m);
  for (const sx of [1, -1] as const) {
    foreLeg(m, sx);
    hindLeg(m, sx);
  }
  tail(m);
  for (const sx of [1, -1] as const) {
    eye(m, sx);
    lid(m, sx);
    ear(m, sx);
  }
  chin(m, s);
  // Усы — последними: прозрачные грани рисуются поверх своей морды.
  for (const sx of [1, -1] as const) whiskers(m, sx, s);
  return m;
}

function head(m: SkinMesh, s: HeadSpec): void {
  const rows: number[][] = [];
  LAT.forEach((lat, i) => {
    rows.push(
      LON.map((lon, k) => {
        // Пушистые щёки: зубцы края по скулам — через одну точку ряда наружу.
        const tuft = Math.abs(lon) > 60 * DEG && Math.abs(lon) < 115 * DEG && lat < -8 * DEG && lat > -40 * DEG && (k + i) % 2 === 0 ? s.cheek * 0.35 : 0;
        const p = headPt(lon, lat, s, tuft);
        const back = lat < -40 * DEG && Math.abs(lon) > 100 * DEG;
        return m.v(p, headUv(lon, lat), 0, back ? ['head', 'neck', 0.6] : 'head');
      }),
    );
  });
  m.strip(rows, true, () => HEAD_C);
  // Макушка и низ — веером к полюсам: точка полюса своя у каждого сектора (лист не сходится в одну точку).
  for (const [row, lat] of [
    [rows[0], 90 * DEG],
    [rows[rows.length - 1], -90 * DEG],
  ] as const) {
    for (let k = 0; k < row.length; k++) {
      const k1 = (k + 1) % row.length;
      const lon = k1 === 0 ? LON[k] / 2 : (LON[k] + LON[k1]) / 2;
      const pole = m.v(headPt(lon, lat * 0.999, s), headUv(LON[k], lat), 0, lat < 0 ? ['head', 'neck', 0.6] : 'head');
      m.quad(row[k], row[k1], pole, pole, HEAD_C);
    }
  }
}

function neck(m: SkinMesh): void {
  const A = mirrorRing([0, 45, 90, 135, 180].map((d) => d * DEG));
  const at = (t: number) => (a: number): [number, number] => uv(SHEET.neck.x0 + (Math.abs(a) / Math.PI) * (SHEET.neck.x1 - SHEET.neck.x0), SHEET.neck.y0 + 4 + t * (SHEET.neck.y1 - SHEET.neck.y0 - 8));
  const c0: V3 = [0, 0.215, 0.105];
  const c1: V3 = [0, 0.248, 0.16];
  const c2: V3 = [0, 0.27, 0.19];
  const axis = norm(sub(c2, c0));
  const up = norm(crs(axis, [1, 0, 0]));
  const rows = [
    ring(m, c0, [1, 0, 0], scale(up, -1), 0.046, 0.054, A, at(0), 'chest'),
    // Грива на шее спереди и снизу — зубцами.
    ring(m, c1, [1, 0, 0], scale(up, -1), 0.04, 0.046, A, at(0.5), ['neck', 'chest', 0.7], (k, a) => (Math.cos(a) < 0 && k % 2 ? 0.12 : 0)),
    ring(m, c2, [1, 0, 0], scale(up, -1), 0.034, 0.036, A, at(1), ['head', 'neck', 0.6]),
  ];
  m.strip(rows, true, (p) => {
    const t = Math.max(0, Math.min(1, ((p[2] - c0[2]) * axis[2] + (p[1] - c0[1]) * axis[1]) / Math.hypot(c2[1] - c0[1], c2[2] - c0[2])));
    return add(c0, scale(sub(c2, c0), t));
  });
}

/** Сечения туловища вдоль z: середина по высоте, полуширина, полувысота. */
const TORSO: readonly (readonly [number, number, number, number])[] = [
  [0.13, 0.218, 0.044, 0.052],
  [0.1, 0.205, 0.058, 0.07],
  [0.05, 0.2, 0.066, 0.071],
  [-0.01, 0.199, 0.066, 0.067],
  [-0.07, 0.201, 0.063, 0.064],
  [-0.12, 0.204, 0.066, 0.064],
  [-0.16, 0.207, 0.055, 0.055],
];
/** Где туловище в листе по z, точки. */
const torsoV = (z: number): number => SHEET.torso.y0 + 2 + ((0.16 - z) / 0.36) * (SHEET.torso.y1 - SHEET.torso.y0 - 4);

function torso(m: SkinMesh): void {
  const A = mirrorRing([0, 36, 72, 108, 144, 180].map((d) => d * DEG));
  const at = (z: number) => (a: number): [number, number] => uv(SHEET.torso.x0 + (Math.abs(a) / Math.PI) * (SHEET.torso.x1 - SHEET.torso.x0), torsoV(z));
  const wOf = (z: number): Weights => (z >= 0.08 ? 'chest' : z >= 0 ? blendW('body', 'chest', z / 0.08) : z >= -0.085 ? blendW('body', 'pelvis', -z / 0.085) : 'pelvis');
  const rows = TORSO.map(([z, y, rx, ry], i) =>
    ring(m, [0, y, z], [1, 0, 0], [0, 1, 0], rx, ry, A, at(z), wOf(z), (k, a) => {
      // Спина ровнее, брюхо круглее и ниже; грудь — зубцами меха спереди.
      const belly = Math.cos(a) < 0 ? 0.13 * -Math.cos(a) : -0.03 * Math.cos(a);
      return belly + (i <= 1 && Math.cos(a) < -0.2 && k % 2 ? 0.08 : 0);
    }),
  );
  m.strip(rows, true, (p) => [0, 0.2, p[2]]);
  const front = m.v([0, 0.222, 0.152], uv(SHEET.torso.x0 + 160, torsoV(0.152)), 0, 'chest');
  fan(m, rows[0], front, [0, 0.21, 0.1]);
  const rump = m.v([0, 0.212, -0.184], uv(SHEET.torso.x0 + 60, torsoV(-0.184)), 0, 'pelvis');
  fan(m, rows[rows.length - 1], rump, [0, 0.207, -0.14]);
}

/** Лапа: кольца по суставам, лист — полоса лапы (перед — x0, зад — x1), подушечка — шаром. */
function leg(m: SkinMesh, sx: 1 | -1, box: { x0: number; x1: number; y0: number; y1: number }, pts: readonly (readonly [V3, number, number, Weights])[], paw: { c: V3; w: string; front: boolean }): void {
  const A = mirrorRing([0, 60, 120, 180].map((d) => d * DEG));
  const top = pts[0][0][1];
  const bottom = pts[pts.length - 1][0][1];
  // Перед лапы — угол 0 (кольцо поперёк вертикали: `u` — наружу, `v` — вперёд).
  const rows = pts.map(([c, ru, rv, w]) =>
    ring(m, [c[0] * sx, c[1], c[2]], [sx, 0, 0], [0, 0, 1], ru, rv, A, (a) => uv(box.x0 + (Math.abs(a) / Math.PI) * (box.x1 - box.x0), box.y0 + 2 + ((top - c[1]) / (top - bottom)) * (box.y1 - box.y0 - 4)), w),
  );
  m.strip(rows, true, (p) => {
    let best = pts[0][0];
    let d = Infinity;
    for (const [c] of pts) {
      const e = Math.abs(c[1] - p[1]);
      if (e < d) {
        d = e;
        best = c;
      }
    }
    return [best[0] * sx, p[1], best[2]];
  });
  // Стопа: приплюснутый шар, пальцы вперёд — лист подушечек (передние — левая половина, задние — правая).
  const P = mirrorRing([0, 60, 120, 180].map((d) => d * DEG));
  const c: V3 = [paw.c[0] * sx, paw.c[1], paw.c[2]];
  const pb = SHEET.paw;
  const half = (pb.x1 - pb.x0) / 2;
  const px = (a: number): number => pb.x0 + (paw.front ? 0 : half) + 2 + (Math.abs(a) / Math.PI) * (half - 4);
  const toe = paw.front ? 0.028 : 0.03;
  const rings = [0.75, 0.15, -0.6].map((h, i) =>
    P.map((a) => {
      const r = Math.sqrt(1 - h * h);
      const p: V3 = [c[0] + Math.sin(a) * 0.021 * r * sx, c[1] + h * 0.014, c[2] + Math.cos(a) * toe * r * (Math.cos(a) > 0 ? 1 : 0.7)];
      return m.v(p, uv(px(a), pb.y0 + 6 + i * 12), 0, paw.w);
    }),
  );
  m.strip(rings, true, () => c);
  const topP = m.v([c[0], c[1] + 0.016, c[2] - 0.004], uv(px(0), pb.y0 + 2), 0, paw.w);
  fan(m, rings[0], topP, c);
  const sole = m.v([c[0], c[1] - 0.014, c[2]], uv(px(Math.PI / 2), pb.y1 - 4), 0, paw.w);
  fan(m, rings[2], sole, c);
}

function foreLeg(m: SkinMesh, sx: 1 | -1): void {
  const s = sx > 0 ? 'L' : 'R';
  leg(
    m,
    sx,
    SHEET.fore,
    [
      [[0.044, 0.215, 0.1], 0.032, 0.04, ['chest', `arm${s}`, 0.5]],
      [[0.046, 0.15, 0.102], 0.028, 0.032, `arm${s}`],
      [[0.047, 0.1, 0.106], 0.022, 0.024, [`fore${s}`, `arm${s}`, 0.6]],
      [[0.047, 0.032, 0.112], 0.017, 0.018, [`fore${s}`, `paw${s}`, 0.6]],
    ],
    { c: [0.047, 0.016, 0.124], w: `paw${s}`, front: true },
  );
}

function hindLeg(m: SkinMesh, sx: 1 | -1): void {
  const s = sx > 0 ? 'L' : 'R';
  leg(
    m,
    sx,
    SHEET.hind,
    [
      [[0.048, 0.222, -0.1], 0.038, 0.056, ['pelvis', `thigh${s}`, 0.5]],
      [[0.052, 0.148, -0.118], 0.035, 0.047, `thigh${s}`],
      [[0.05, 0.092, -0.15], 0.02, 0.024, [`hock${s}`, `thigh${s}`, 0.6]],
      [[0.048, 0.032, -0.134], 0.016, 0.017, [`hock${s}`, `hpaw${s}`, 0.6]],
    ],
    { c: [0.048, 0.016, -0.118], w: `hpaw${s}`, front: false },
  );
}

/** Хвост: кольца вдоль −z; толщина пышная к середине, кончик — кисточкой; кольца через одно повёрнуты — рваный край. */
function tail(m: SkinMesh): void {
  const A = mirrorRing([0, 60, 120, 180].map((d) => d * DEG));
  const z0 = -0.15;
  const len = 0.345;
  const N = 9;
  const b = SHEET.tail;
  const rows: number[][] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = z0 - t * len;
    const r = (0.016 + 0.01 * Math.sin(Math.PI * Math.min(1, t * 1.25))) * (1 - 0.55 * smooth(0.75, 1, t));
    // Кость: по суставам хвоста (звено — 0,075 м); у суставов — вес пополам между соседями.
    const f = (-0.165 - z) / 0.075;
    const j = Math.min(TAIL_BONES, Math.floor(f) + 1);
    const k = f - Math.floor(f);
    const w: Weights = f < 0 ? ['tail1', 'pelvis', Math.min(1, 0.5 - f * 3)] : k < 0.25 && j > 1 ? blendW(`tail${j - 1}`, `tail${j}`, 0.5 + k * 2) : k > 0.75 && j < TAIL_BONES ? blendW(`tail${j}`, `tail${j + 1}`, (k - 0.75) * 2) : `tail${j}`;
    const rot = i % 2 ? Math.PI / 6 : 0;
    rows.push(
      A.map((a) => {
        const aa = a + rot;
        const p: V3 = [Math.sin(aa) * r, 0.212 + Math.cos(aa) * r, z];
        return m.v(p, uv(b.x0 + 2 + (Math.min(Math.PI, Math.abs(((aa + Math.PI) % (2 * Math.PI)) - Math.PI)) / Math.PI) * (b.x1 - b.x0 - 4), b.y0 + 2 + t * (b.y1 - b.y0 - 12)), 0, w);
      }),
    );
  }
  m.strip(rows, true, (p) => [0, 0.212, p[2]]);
  const tip = m.v([0, 0.212, z0 - len - 0.03], uv(b.x0 + 60, b.y1 - 4), 0, `tail${TAIL_BONES}`);
  fan(m, rows[N - 1], tip, [0, 0.212, z0 - len]);
}

function eye(m: SkinMesh, sx: 1 | -1): void {
  const N = 10;
  const cx = SHEET.eye.cx[0];
  const cy = SHEET.eye.cy;
  const at = (th: number, k: number): [number, number] => uv(cx + Math.cos(th) * EYE_PX * k, cy - Math.sin(th) * EYE_PX * k * 0.8);
  const ths = Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2);
  const rim = ths.map((th) => m.v(cupPt(sx, th, EYE_OPEN, EYE_R), at(th, 1), 0, 'head'));
  const mid = ths.map((th) => m.v(cupPt(sx, th, EYE_OPEN * 0.5, EYE_R), at(th, Math.sin(EYE_OPEN * 0.5) / Math.sin(EYE_OPEN)), 0, 'head'));
  const c = m.v(add(eyeCenter(sx), scale(eyeAxis(sx), EYE_R)), uv(cx, cy), 0, 'head');
  for (const i of [...rim, ...mid, c]) m.eye.push(i);
  const C = eyeCenter(sx);
  m.strip([rim, mid], true, () => C);
  fan(m, mid, c, C);
}

/** Веко: чашка чуть больше глаза, сомкнутая — на глазу; в покое поднята под лоб на `LID_CLOSE`. */
function lid(m: SkinMesh, sx: 1 | -1): void {
  const N = 10;
  const C = eyeCenter(sx);
  const pivot: V3 = [C[0], CAT_EYE[1], CAT_EYE[2]];
  const b = SHEET.lid;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const ths = Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2);
  const r = EYE_R + 0.0011;
  const open = (p: V3): V3 => rotX(p, pivot, -LID_CLOSE);
  const at = (th: number, k: number): [number, number] => uv(cx + Math.cos(th) * 28 * k, cy - Math.sin(th) * 28 * k);
  const rim = ths.map((th) => m.v(open(cupPt(sx, th, LID_CUP, r)), at(th, 1), 0, 'lids'));
  const mid = ths.map((th) => m.v(open(cupPt(sx, th, LID_CUP * 0.5, r)), at(th, 0.5), 0, 'lids'));
  const c = m.v(open(add(C, scale(eyeAxis(sx), r))), uv(cx, cy), 0, 'lids');
  m.strip([rim, mid], true, () => C);
  fan(m, mid, c, C);
}

/** Ухо: треугольник с чашей спереди, спинка, и пучок шерсти изнутри; основание — на голове, остальное — кость уха. */
function ear(m: SkinMesh, sx: 1 | -1): void {
  const s = sx > 0 ? 'L' : 'R';
  const X = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
  const A = X([0.012, 0.322, 0.206]);
  const B = X([0.05, 0.306, 0.198]);
  const Bk = X([0.033, 0.318, 0.174]);
  const T = X([0.043, 0.372, 0.19]);
  const M = X([0.033, 0.328, 0.193]);
  const fb = SHEET.earFront;
  const bb = SHEET.earBack;
  const ef = (p: V3, x: number, y: number, w: Weights): number => m.v(p, uv(fb.x0 + x * (fb.x1 - fb.x0), fb.y0 + y * (fb.y1 - fb.y0)), 0, w);
  const eb = (p: V3, x: number, y: number, w: Weights): number => m.v(p, uv(bb.x0 + x * (bb.x1 - bb.x0), bb.y0 + y * (bb.y1 - bb.y0)), 0, w);
  const ear = `ear${s}`;
  const inside = X([0.03, 0.31, 0.17]);
  // Перед: чаша (середина вглубь).
  const fa = ef(A, 0.08, 0.95, 'head');
  const fbI = ef(B, 0.92, 0.95, 'head');
  const ft = ef(T, 0.5, 0.04, ear);
  const fm = ef(M, 0.5, 0.62, [ear, 'head', 0.6]);
  m.quad(fa, fbI, fm, fm, inside);
  m.quad(fbI, ft, fm, fm, inside);
  m.quad(ft, fa, fm, fm, inside);
  // Спинка: от переднего края к точке позади.
  const ba = eb(A, 0.05, 0.95, 'head');
  const bbI = eb(B, 0.95, 0.95, 'head');
  const bt = eb(T, 0.5, 0.04, ear);
  const bk = eb(Bk, 0.5, 0.9, 'head');
  const front = X([0.032, 0.33, 0.215]);
  m.quad(ba, bk, bt, bt, front);
  m.quad(bk, bbI, bt, bt, front);
  // Пучок шерсти изнутри: тонкий клин от основания вверх-наружу.
  const t0 = ef(X([0.022, 0.316, 0.204]), 0.3, 0.85, 'head');
  const t1 = ef(X([0.03, 0.317, 0.203]), 0.45, 0.85, 'head');
  const t2 = ef(X([0.035, 0.352, 0.206]), 0.45, 0.25, ear);
  m.quad(t0, t1, t2, t2, X([0.03, 0.32, 0.18]));
}

/** Подбородок в лист: угол от переда (0…π) — по x, высота сечения (1 — верх, −1 — низ) — по y. */
const chinUv = (a: number, h: number): [number, number] => uv(SHEET.chin.x0 + 1 + (a / Math.PI) * (SHEET.chin.x1 - SHEET.chin.x0 - 2), SHEET.chin.y0 + 1 + ((1 - h) / 2) * (SHEET.chin.y1 - SHEET.chin.y0 - 2));

/** Подбородок облика: середина и полуоси (лист рисует нутро рта ровно там, где голову закрывает он). */
export const chinOf = (s: HeadSpec): { c: V3; r: V3 } => ({ c: [0, 0.257, 0.226 + s.muzzle * 0.3], r: [0.017, 0.0095, 0.021] });

/** Подбородок: полушарие под мордой своей костью; открытый рот — тёмное нутро, нарисованное на голове под ним. */
function chin(m: SkinMesh, s: HeadSpec): void {
  const A = mirrorRing([0, 45, 90, 135, 180].map((d) => d * DEG));
  const { c, r: R } = chinOf(s);
  const [rx, ry, rz] = R;
  const rows = [0.95, 0.5, -0.2, -0.75].map((h) =>
    A.map((a) => {
      const r = Math.sqrt(1 - h * h);
      const p: V3 = [c[0] + Math.sin(a) * rx * r, c[1] + h * ry, c[2] + Math.cos(a) * rz * r];
      return m.v(p, chinUv(Math.abs(a), h), 0, 'jaw');
    }),
  );
  m.strip(rows, true, () => c);
  const bottom = m.v([c[0], c[1] - ry, c[2]], chinUv(Math.PI / 2, -1), 0, 'jaw');
  fan(m, rows[rows.length - 1], bottom, c);
}

/** Усы: три полоски с подушечки, веером, чуть вниз; у корня — 0,55 непрозрачности, к концу — ноль. */
function whiskers(m: SkinMesh, sx: 1 | -1, s: HeadSpec): void {
  const b = SHEET.whisker;
  for (let i = 0; i < 3; i++) {
    const root = headPt(17 * DEG * sx, (-19 - i * 3.5) * DEG, s, -0.001);
    const out = norm([sx * (0.95 - i * 0.05), 0.12 - i * 0.12, 0.25 - i * 0.05]);
    const L = 0.07 - i * 0.006;
    const droop: V3 = [0, -0.012 - i * 0.004, 0];
    const pts: V3[] = [0, 0.5, 1].map((t) => add(add(root, scale(out, L * t)), scale(droop, t * t)));
    const wid = [0.0006, 0.00045, 0.00025];
    const rows = pts.map((p, k) => {
      const up: V3 = [0, wid[k], 0];
      const x = b.x0 + ((b.x1 - b.x0) * k) / 2;
      const a = m.v(add(p, up), uv(x, b.y0 + 2), 0, 'head');
      const c = m.v(sub(p, up), uv(x, b.y1 - 2), 0, 'head');
      const f = [0.55, 0.3, 0][k];
      m.fade.set(a, f);
      m.fade.set(c, f);
      return [a, c];
    });
    for (let k = 0; k < 2; k++) m.quad(rows[k][0], rows[k + 1][0], rows[k + 1][1], rows[k][1], add(pts[k], [0, 0, -0.05]));
  }
}
