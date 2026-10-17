// Рисунок герба: щиты, деления, фигуры — путями SVG в своих окнах, и слои герба одним списком (`armsLayers`).
//
// Один рисунок на все места: SVG интерфейса (`ui/parts/Arms.tsx`) и холст (`paint.ts` — знамёна города, метки карты,
// полотнища роликов) читают одни и те же слои, своей геометрии у них нет. Набор конечный, своих картинок нет.
//
// Окна: щит — 100 × 120 (верх — 0), фигура — 100 × 100, ставится в окно фигуры своего щита (`SHIELD_BOX.fig`). Фигуры
// нарисованы контуром по точкам (`curve` — гладко, точка с третьим числом — угол), зверь смотрит вправо от щита (влево
// для смотрящего), как велит геральдика.
import type { Arms, Charge, Division, Shield, Tincture } from './arms';
export type Pt = readonly [number, number] | readonly [number, number, 1];
export type Mat = readonly [number, number, number, number, number, number];
export interface Part {
  d: string;
  /** Обвод вместо заливки, ширина в единицах поля 100. */
  stroke?: number;
  m?: Mat;
  /** Вырез: рисуется краской поля, поверх фигуры (глаз, дверь). */
  hole?: boolean;
}

const f = (n: number): string => String(Math.round(n * 10) / 10);

/** Гладкий контур по точкам (Катмулл — Ром); точка с третьим числом 1 — угол. */
export function curve(pts: readonly Pt[], closed = true): string {
  const n = pts.length;
  const at = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const k1 = p1[2] ? 0 : 1 / 6;
    const k2 = p2[2] ? 0 : 1 / 6;
    const c1x = p1[0] + (p2[0] - p0[0]) * k1;
    const c1y = p1[1] + (p2[1] - p0[1]) * k1;
    const c2x = p2[0] - (p3[0] - p1[0]) * k2;
    const c2y = p2[1] - (p3[1] - p1[1]) * k2;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? d + ' Z' : d;
}

/** Ломаная. */
export const poly = (pts: readonly (readonly [number, number])[], closed = true): string =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join(' ') + (closed ? ' Z' : '');

/** Левая половина (от верха середины вниз по левому краю к низу середины) — и зеркальная правая. */
export function mirror(half: readonly Pt[], axis = 50): Pt[] {
  const back = half
    .slice(1, -1)
    .reverse()
    .map((p) => (p[2] ? ([2 * axis - p[0], p[1], 1] as const) : ([2 * axis - p[0], p[1]] as const)));
  return [...half, ...back];
}

export const circle = (x: number, y: number, r: number): string =>
  `M${f(x - r)} ${f(y)} A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)} A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)} Z`;

export const FLIP: Mat = [-1, 0, 0, 1, 100, 0];
export const rot = (deg: number, cx = 50, cy = 50): Mat => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};
export const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

// ---------- Щиты: окно 100 × 120 ----------

export const SHIELD_PATH: Record<Shield, string> = {
  heater: 'M4 4 H96 V50 C96 82 76 104 50 117 C24 104 4 82 4 50 Z',
  french: 'M4 4 H96 V94 C96 103 88 106 72 107 C61 108 54 111 50 117 C46 111 39 108 28 107 C12 106 4 103 4 94 Z',
  iberian: 'M4 4 H96 V68 C96 96 76 117 50 117 C24 117 4 96 4 68 Z',
  kite: 'M50 3 C78 3 95 9 95 24 C95 62 74 96 50 118 C26 96 5 62 5 24 C5 9 22 3 50 3 Z',
  swiss: 'M4 6 C20 12 36 12 50 4 C64 12 80 12 96 6 V58 C96 88 76 106 50 117 C24 106 4 88 4 58 Z',
};

/** Середина поля (точка пересечения делений) и окно главной фигуры для каждого щита. */
export const SHIELD_BOX: Record<Shield, { cy: number; fig: readonly [number, number, number, number] }> = {
  heater: { cy: 52, fig: [9, 8, 82, 82] },
  french: { cy: 56, fig: [8, 10, 84, 84] },
  iberian: { cy: 56, fig: [9, 9, 82, 82] },
  kite: { cy: 50, fig: [16, 8, 68, 68] },
  swiss: { cy: 56, fig: [10, 14, 80, 80] },
};

// ---------- Деления поля: вторая краска, многоугольник в окне 100 × 120 ----------

export const DIVISION_PATH = (cy: number): Record<Division, string> => ({
  plain: '',
  pale: 'M50 0 H100 V120 H50 Z',
  fess: `M0 ${cy} H100 V120 H0 Z`,
  quarterly: `M50 0 H100 V${cy} H50 Z M0 ${cy} H50 V120 H0 Z`,
  bend: `M0 ${cy - 50} L100 ${cy + 50} V120 H0 Z`,
  bendSinister: `M100 ${cy - 50} L0 ${cy + 50} V120 H100 Z`,
  saltire: `M0 ${cy - 60} L50 ${cy} L0 ${cy + 60} Z M100 ${cy - 60} L50 ${cy} L100 ${cy + 60} Z`,
  chevron: `M0 120 V${cy + 40} L50 ${cy - 16} L100 ${cy + 40} V120 Z`,
});

// ---------- Фигуры: окно 100 × 100 ----------

const lion: Part[] = [
  {
    d: curve([
      [20, 17, 1], [24, 10], [31, 6], [38, 3, 1], [40, 9], [47, 6, 1], [47, 13], [54, 13, 1], [52, 19], [58, 22, 1], [54, 27], [60, 32, 1],
      [61, 39], [65, 48], [69, 57], [73, 62], [77, 54], [80, 44], [80, 34], [78, 26], [80, 18], [86, 10, 1], [87, 16], [93, 15, 1], [90, 21],
      [93, 27, 1], [87, 26], [84, 34], [84, 46], [81, 58], [77, 68], [74, 76], [69, 84], [65, 90], [67, 95, 1], [59, 97], [52, 97, 1],
      [53, 94], [50, 92, 1], [56, 90], [58, 84], [59, 78], [56, 75], [51, 78], [44, 83], [37, 86], [32, 89, 1], [28, 87], [23, 88, 1],
      [25, 84], [23, 80, 1], [30, 80], [37, 77], [43, 72], [47, 66], [47, 60], [42, 57], [35, 58], [28, 60], [22, 62, 1], [18, 60],
      [13, 61, 1], [15, 57], [12, 53, 1], [19, 53], [27, 51], [35, 49], [39, 45], [39, 41], [33, 40], [26, 39], [19, 39, 1], [15, 37],
      [10, 36, 1], [13, 33], [11, 28, 1], [18, 30], [26, 30], [33, 30], [35, 27], [30, 26], [25, 27], [20, 27, 1], [22, 24], [27, 23],
      [24, 21], [21, 21, 1],
    ]),
  },
  { d: circle(29, 13, 1.8), hole: true },
];

const bear: Part[] = [
  {
    d: curve([
      [6, 52, 1], [8, 47], [13, 42], [17, 37], [19, 32, 1], [23, 31], [25, 34, 1], [31, 33], [40, 29], [52, 26], [64, 27], [76, 31], [86, 37],
      [91, 44], [94, 47, 1], [92, 51, 1], [91, 58], [90, 68], [90, 80], [93, 86, 1], [91, 89], [80, 89, 1], [80, 84], [78, 72], [73, 66],
      [64, 66], [56, 67], [49, 68], [44, 74], [42, 82], [44, 87, 1], [42, 90], [30, 90, 1], [30, 86], [29, 76], [27, 66], [21, 61],
      [15, 59], [10, 57], [6, 56, 1],
    ]),
  },
  { d: circle(16, 45, 1.6), hole: true },
];

const eagleHalf: Pt[] = [
  [50, 24, 1], [45, 27], [43, 31], [36, 30], [27, 24], [18, 16], [9, 8, 1], [8, 16], [11, 22, 1], [5, 22], [5, 29], [9, 33, 1], [4, 35],
  [5, 42], [10, 45, 1], [7, 49], [9, 54], [15, 56, 1], [16, 60], [22, 61], [29, 59], [36, 56], [41, 56], [42, 61], [39, 66],
  [32, 72], [28, 72, 1], [24, 76, 1], [28, 77], [27, 82, 1], [32, 80], [34, 83, 1], [37, 77], [43, 70], [45, 74], [41, 84], [40, 90, 1],
  [46, 88], [50, 95, 1],
];
const eagle: Part[] = [
  { d: curve(mirror(eagleHalf)) },
  // Голова повёрнута вправо от щита (влево для смотрящего), клюв загнут.
  {
    d: curve([
      [44, 28], [43, 22], [44, 16], [48, 12], [54, 12], [57, 16], [56, 22], [55, 28], [52, 31],
    ]),
  },
  {
    d: curve([
      [45, 15], [41, 15, 1], [36, 17], [35, 21], [37, 24, 1], [38, 21], [41, 20], [45, 21],
    ]),
  },
  { d: circle(49, 16.5, 1.5), hole: true },
];

const stag: Part[] = [
  {
    // Голова прямо (кабошон): морда, уши.
    d: curve(
      mirror([
        [50, 46, 1], [44, 47], [39, 50], [33, 49], [26, 46], [21, 47, 1], [25, 52], [31, 56], [37, 58], [39, 64], [40, 72], [42, 80],
        [45, 86], [50, 88, 1],
      ]),
    ),
  },
  { d: curve(mirror([[50, 74, 1], [46, 74], [45, 78], [47, 81], [50, 82, 1]])), hole: true },
  { d: circle(42, 61, 1.8), hole: true },
  { d: circle(58, 61, 1.8), hole: true },
  // Рога: ствол и отростки обводом.
  ...(
    [
      { d: curve([[42, 48], [36, 38], [30, 28], [28, 18], [30, 6]], false), stroke: 4.2 },
      { d: curve([[34, 35], [24, 34], [16, 28]], false), stroke: 3.4 },
      { d: curve([[29, 24], [20, 18], [16, 10]], false), stroke: 3.2 },
      { d: curve([[29, 15], [36, 10], [38, 3]], false), stroke: 3 },
    ] as Part[]
  ).flatMap((p) => [p, { ...p, m: FLIP }]),
];

const tower: Part[] = [
  {
    d: 'M22 94 H78 V88 H71 V42 H77 V20 H69 V11 H60 V20 H55 V11 H45 V20 H40 V11 H31 V20 H23 V42 H29 V88 H22 Z',
  },
  { d: 'M42 88 V74 C42 66 58 66 58 74 V88 Z', hole: true },
  { d: 'M46 48 C46 43 54 43 54 48 V58 H46 Z', hole: true },
];

const cross: Part[] = [
  {
    d:
      'M36 5 H64 C59 18 56 30 56 44 C70 44 82 41 95 36 V64 C82 59 70 56 56 56 C56 70 59 82 64 95 H36 C41 82 44 70 44 56 ' +
      'C30 56 18 59 5 64 V36 C18 41 30 44 44 44 C44 30 41 18 36 5 Z',
  },
];

const sword: Part[] = [
  { d: 'M50 2 L58 13 V65 H42 V13 Z' },
  { d: 'M22 66 C22 62 26 61 30 62 H70 C74 61 78 62 78 66 C78 70 74 71 70 70 H30 C26 71 22 70 22 66 Z' },
  { d: 'M45.5 70 H54.5 V86 H45.5 Z' },
  { d: circle(50, 91, 6.5) },
];

const keyOne: Part[] = [
  { d: `${circle(50, 17, 12)} ${circle(50, 17, 5.5)}` },
  { d: 'M46 28 H54 V92 H46 Z' },
  { d: 'M54 72 H66 V76 H62 V80 H66 V86 H54 Z' },
  { d: 'M42 34 H58 V38 H42 Z' },
];
const keys: Part[] = [
  ...keyOne.map((p) => ({ ...p, m: rot(-38) })),
  ...keyOne.map((p) => ({ ...p, m: mul(rot(38), FLIP) })),
];

const lilyHalf: Pt[] = [
  [50, 3, 1], [45, 12], [41, 22], [40, 32], [43, 42], [46, 50], [44, 55, 1],
  [40, 50], [36, 42], [28, 36], [19, 36], [12, 41], [10, 49], [13, 56], [19, 59, 1], [20, 53], [24, 49], [30, 49], [35, 53], [38, 58, 1],
  [32, 58, 1], [32, 66, 1], [41, 66, 1], [38, 74], [31, 80], [24, 82, 1], [32, 86], [41, 84], [47, 78], [50, 72, 1],
];
const lily: Part[] = [{ d: curve(mirror(lilyHalf)) }];

const crown: Part[] = [
  {
    d: poly([
      [18, 76], [14, 34], [28, 50], [33, 26], [42, 48], [50, 20], [58, 48], [67, 26], [72, 50], [86, 34], [82, 76],
    ]),
  },
  { d: 'M16 76 H84 V88 H16 Z' },
  { d: circle(14, 31, 4.2) },
  { d: circle(33, 23, 4.2) },
  { d: circle(50, 16, 4.6) },
  { d: circle(67, 23, 4.2) },
  { d: circle(86, 31, 4.2) },
  { d: circle(50, 82, 3), hole: true },
  { d: circle(32, 82, 2.4), hole: true },
  { d: circle(68, 82, 2.4), hole: true },
];

function starPath(cx: number, cy: number, r1: number, r2: number, n: number): string {
  const p: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? r2 : r1;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(p);
}
const star: Part[] = [{ d: starPath(50, 53, 46, 19, 5) }];

const horseshoe: Part[] = [
  {
    d: 'M19 18 H35 C33 30 32 44 34 56 C36 70 42 78 50 78 C58 78 64 70 66 56 C68 44 67 30 65 18 H81 C84 34 85 52 81 66 C76 84 64 94 50 94 C36 94 24 84 19 66 C15 52 16 34 19 18 Z',
  },
  { d: circle(25, 34, 2.3), hole: true },
  { d: circle(24, 50, 2.3), hole: true },
  { d: circle(29, 66, 2.3), hole: true },
  { d: circle(75, 34, 2.3), hole: true },
  { d: circle(76, 50, 2.3), hole: true },
  { d: circle(71, 66, 2.3), hole: true },
];

const axeOne: Part[] = [
  { d: 'M47.5 18 H52.5 V96 H47.5 Z' },
  { d: 'M52 22 C62 18 72 12 76 6 C82 18 82 36 76 48 C70 42 62 38 52 38 Z' },
];
const axes: Part[] = [...axeOne.map((p) => ({ ...p, m: mul(rot(-32), FLIP) })), ...axeOne.map((p) => ({ ...p, m: rot(32) }))];

const skull: Part[] = [
  {
    d: curve(
      mirror([
        [50, 10, 1], [36, 12], [26, 22], [24, 36], [27, 50], [33, 58], [34, 66], [41, 68], [44, 74, 1], [50, 74, 1],
      ]),
    ),
  },
  { d: curve([[46, 40], [42, 34], [35, 34], [32, 40], [35, 47], [42, 48]]), hole: true },
  { d: curve([[54, 40], [58, 34], [65, 34], [68, 40], [65, 47], [58, 48]]), hole: true },
  { d: 'M47 54 L50 47 L53 54 Z', hole: true },
  { d: 'M42 62 H45 V68 H42 Z M48.5 62 H51.5 V68 H48.5 Z M55 62 H58 V68 H55 Z', hole: true },
  // Кости накрест под черепом.
  { d: 'M14 72 L86 94', stroke: 6 },
  { d: 'M86 72 L14 94', stroke: 6 },
];

const wolf: Part[] = [
  {
    // Голова волка прямо.
    d: curve(
      mirror([
        [50, 30, 1], [42, 30], [36, 26], [30, 14], [26, 8, 1], [22, 20], [22, 34], [18, 44], [20, 54], [28, 62], [36, 70], [42, 82], [46, 90],
        [50, 92, 1],
      ]),
    ),
  },
  { d: 'M36 46 L44 50 L38 52 Z M64 46 L56 50 L62 52 Z', hole: true },
  { d: curve(mirror([[50, 80, 1], [46, 80], [45, 84], [50, 86, 1]])), hole: true },
];

export const CHARGE_PARTS: Record<Charge, readonly Part[]> = {
  lion,
  eagle,
  bear,
  stag,
  tower,
  cross,
  sword,
  keys,
  lily,
  crown,
  star,
  horseshoe,
  axes,
  skull,
  wolf,
};

// ---------- Краски и слои ----------

/** Краски финифти. Приглушены под свет и палитру игры, но остаются чистыми геральдическими. */
export const TINCTURE_HEX: Record<Tincture, string> = {
  or: '#d9a933',
  argent: '#ebe7dc',
  gules: '#b8302c',
  azure: '#2c5ea8',
  vert: '#2f7d43',
  sable: '#24201c',
  purpure: '#74407e',
};

/** Обвод щита и фигур — тёмный, как чернила гербовника. */
export const INK = '#1d1712';
/** Обвод фигуры поверх её краски (глаз, дверь) на чёрной фигуре — иначе чернила пропали бы. */
const INK_ON_SABLE = '#6b645b';
/** Толщина обвода фигуры в единицах окна фигуры. */
const CHARGE_EDGE = 2.6;
/** Толщина обвода щита в единицах окна щита. */
export const RIM = 3.2;

/** Слой герба: путь в окне щита, заливка или обвод, своё преобразование. */
export interface Layer {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  /** Преобразование пути (матрица SVG `a b c d e f`) — в окне щита. */
  m?: Mat;
}

/** Слои поля и фигуры в окне щита — всё, что лежит внутри щита (обрезается его контуром). */
export function armsLayers(a: Arms): Layer[] {
  const box = SHIELD_BOX[a.shield];
  const out: Layer[] = [{ d: 'M0 0 H100 V120 H0 Z', fill: TINCTURE_HEX[a.field[0]] }];
  if (a.division !== 'plain') out.push({ d: DIVISION_PATH(box.cy)[a.division], fill: TINCTURE_HEX[a.field[1]] });
  const [x, y, w] = box.fig;
  const k = w / 100;
  const at: Mat = [k, 0, 0, k, x, y];
  const parts = CHARGE_PARTS[a.charge];
  const place = (p: Part): Mat => (p.m ? mul(at, p.m) : at);
  const tint = TINCTURE_HEX[a.tint];
  // Обвод фигуры — под ней, вдвое шире: снаружи остаётся ровно `CHARGE_EDGE`.
  for (const p of parts)
    if (!p.hole) out.push({ d: p.d, m: place(p), stroke: INK, width: (p.stroke ?? 0) + CHARGE_EDGE * 2, ...(p.stroke ? {} : { fill: INK }) });
  for (const p of parts) if (!p.hole) out.push(p.stroke ? { d: p.d, m: place(p), stroke: tint, width: p.stroke } : { d: p.d, m: place(p), fill: tint });
  const hole = a.tint === 'sable' ? INK_ON_SABLE : INK;
  for (const p of parts) if (p.hole) out.push({ d: p.d, m: place(p), fill: hole });
  return out;
}
