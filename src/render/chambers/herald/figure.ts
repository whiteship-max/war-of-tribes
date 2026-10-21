// Фигура гонца (ЛЦ-3, docs/characters.md): тот же набор персонажа, что у супруги (`kit/`), — сетка с кожей в два веса,
// мало костей, свет нарисован в листах, — но мужские пропорции, близко к живым: рост 1,76 м, голова — 1/7,5 роста, плечи
// — в 2,5 раза шире головы, шея плотная. Молодой, худой и быстрый: дорожный плащ с капюшоном, откинутым на плечи, короткая
// туника до середины бедра, пояс, сума через плечо с печатью, высокие сапоги в дорожной пыли.
//
// Тела под одеждой нет: туника — открытая труба от шеи до подола, плащ — открытая раковина за спиной, под капюшоном —
// ничего; ноги есть только ниже туники (чулок от подола до колена и сапог), кисть — «варежка» с отдельным большим пальцем.
//
// Скелет — 23 кости: таз, поясница, грудь, шея, голова, челюсть, веки; по руке — плечо, предплечье, кисть, большой палец; по
// ноге — бедро, голень, стопа; плащ и сума. Голова строится в чертёжных мерах маски (как у супруги — листы лица одной
// плотности) и ставится на шею масштабом `HEAD_SCALE`; тело — сразу в метрах.
//
// Лист тела 512 × 512 (y — вниз): шапка волос 0…80, туника с шеей 80…256, плащ 256…344, капюшон 344…392 — зеркальные
// половины (u = |угол| / π); ниже — рукав, кисть, палец, нога, стопа, сума и ремень (`SHEETS`).
import type { V3 } from '../../city/geom';
import type { Skeleton } from '../rig';
import { crs, mirrorRing, mirrorU, mitten, norm, place, ringPt, smooth, tube, uvB, type MittenSpec } from '../kit/body';
import type { Head } from '../kit/head';
import { upperSkeleton } from '../kit/skeleton';
import { SkinMesh, add, scale, sub, type Weights } from '../kit/skin';

/** Рост от пола до макушки, м. */
export const HEIGHT = 1.76;
/** Голова — 1/7,5 роста (решение владельца, ЛЦ-3). */
export const HEAD_PART = 7.5;

// ---------- Голова: чертёжные меры маски → на шею ----------

/** Подбородок чертежа маски (`head.chinY`) и ось головы (`head.hz`). */
const DRAW_CHIN = 1.284;
const DRAW_HZ = -0.012;
/** Купол черепа над линией волос и толщина волос, чертёжные метры. */
export const DOME = 0.062;
const HAIR_T = 0.005;

/** Голова на фигуре: масштаб, высота подбородка чертежа и ось головы по глубине — так, чтобы макушка была на `HEIGHT`. */
export function headFrame(head: Head): { k: number; chin: number; z: number; top: number; bottom: number } {
  const top = head.faceHeight(head.TOP_H + DOME) + HAIR_T;
  const bottom = head.faceHeight(0);
  const k = HEIGHT / HEAD_PART / (top - bottom);
  return { k, chin: HEIGHT - (top - DRAW_CHIN) * k, z: -0.018, top, bottom };
}

/** Точка чертежа головы → на фигуре. */
const toFigure =
  (f: ReturnType<typeof headFrame>) =>
  (p: V3): V3 => [p[0] * f.k, f.chin + (p[1] - DRAW_CHIN) * f.k, f.z + (p[2] - DRAW_HZ) * f.k];

// ---------- Скелет ----------

/** Суставы руки в покое (левая, +x): плечо, локоть, запястье — руки свободно вниз, локти чуть согнуты. */
const SHOULDER: V3 = [0.158, 1.43, -0.022];
const ELBOW: V3 = [0.19, 1.142, -0.042];
const WRIST: V3 = [0.212, 0.89, -0.012];
/** Суставы ноги (левая): бедро, колено, щиколотка. */
const HIP: V3 = [0.088, 0.9, 0];
const KNEE: V3 = [0.093, 0.5, 0.01];
const ANKLE: V3 = [0.097, 0.09, -0.01];

/** Начало большого пальца: у запястья со стороны ладони и вперёд (левая рука). */
function thumbBase(): V3 {
  const a = norm(sub([WRIST[0] + 0.035, WRIST[1] - 0.205, WRIST[2] + 0.012], WRIST));
  return add(add(WRIST, scale(a, 0.03)), [-0.011, 0, 0.018]);
}

export function heraldSkeleton(head: Head): Skeleton {
  const at = toFigure(headFrame(head));
  const eye = head.eyeCenter(1);
  const sk = upperSkeleton({
    hips: [0, 0.95, 0],
    spine: [0, 1.07, -0.006],
    chest: [0, 1.26, -0.012],
    neck: [0, 1.468, -0.024],
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
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const m = (p: V3): V3 => [p[0] * sx, p[1], p[2]];
    sk.add(`thigh${side}`, 'hips', m(HIP));
    sk.add(`shin${side}`, `thigh${side}`, m(KNEE));
    sk.add(`foot${side}`, `shin${side}`, m(ANKLE));
  }
  sk.add('cloak', 'chest', [0, 1.42, -0.1]);
  sk.add('bag', 'hips', [0.17, 1.0, 0.03]);
  return sk;
}

// ---------- Лист тела ----------

export const SHEETS = {
  cap: { y0: 0, y1: 80 },
  tunic: { y0: 80, y1: 256 },
  cloak: { y0: 256, y1: 344 },
  hood: { y0: 344, y1: 392 },
  sleeve: { x0: 0, x1: 160, y0: 392, y1: 512 },
  hand: { x0: 160, x1: 288, y0: 416, y1: 512 },
  thumb: { x0: 288, x1: 320, y0: 448, y1: 512 },
  leg: { x0: 320, x1: 416, y0: 392, y1: 512 },
  foot: { x0: 416, x1: 480, y0: 392, y1: 440 },
  strap: { x0: 480, x1: 512, y0: 392, y1: 440 },
  bag: { x0: 416, x1: 512, y0: 440, y1: 512 },
} as const;

// ---------- Шапка волос и уши ----------

/** Углы шапки: замкнутые кольца над линией волос (18 углов), ниже — открытые от виска к затылку (`CAP_OPEN`). */
export const CAP_A = mirrorRing([0, 0.35, 0.75, 1.15, 1.45, 1.78, 2.15, 2.55, 2.9, Math.PI]);
/** Передний край шапки ниже линии волос — чуть впереди края маски (заходит на висок, щели нет). */
export const CAP_OPEN = 1.45;

/** Кольца шапки: высота над подбородком (выше линии волос — купол), толщина волос спереди и сзади, строка листа. */
export const CAP: readonly { h: number; lift: readonly [number, number]; v: number; open: boolean }[] = [
  // Купол — ниже и круглее: волосы лежат у черепа, короткие на макушке.
  { h: 0.235 + 0.046, lift: [0.0045, 0.005], v: 10, open: false },
  { h: 0.235 + 0.024, lift: [0.0035, 0.0055], v: 22, open: false },
  // Линия волос — чуть ниже верха маски, поверх лба: край маски под ней, и чёлка ложится на лоб.
  { h: 0.23, lift: [0.0008, 0.005], v: 36, open: false },
  { h: 0.17, lift: [0.002, 0.0045], v: 50, open: true },
  { h: 0.105, lift: [0.002, 0.0042], v: 62, open: true },
  { h: 0.035, lift: [0.0015, 0.003], v: 72, open: true },
  // Затылок — к шее, внутрь её верхнего кольца.
  { h: -0.006, lift: [-0.002, -0.002], v: 79, open: true },
];

/** Точка шапки (чертёж головы): поверхность маски вокруг всей головы, затылок глубже, выше линии волос — купол. */
export function capPt(head: Head, th: number, h: number, lift: number): V3 {
  const top = head.TOP_H;
  const p = head.surf(th, Math.min(h, top));
  const back = 1 + 0.16 * smooth(1.6, 2.9, Math.abs(th));
  let dx = p[0];
  let dz = (p[2] - head.HZ) * (Math.cos(th) < 0 ? back : 1);
  let y = p[1];
  let up = 0;
  if (h > top) {
    const k = (h - top) / DOME;
    // Купол — круглый, не трапецией: к макушке сужается раньше, чем эллипс.
    const s = Math.cos((Math.min(1, k) * Math.PI) / 2) ** 0.8;
    dx *= s;
    dz = dz * s - 0.012 * k;
    y = head.faceHeight(top) + (h - top);
    // Толщина волос на куполе — к макушке вверх.
    up = lift * k;
  }
  const r = Math.hypot(dx, dz) || 1;
  const out = lift - up;
  return [dx + (dx / r) * out, y + up, head.HZ + dz + (dz / r) * out];
}

/** Толщина волос по углу: спереди — `lift[0]`, к затылку — `lift[1]`. */
const liftAt = (l: readonly [number, number], th: number): number => l[0] + (l[1] - l[0]) * smooth(0.6, 2.4, Math.abs(th));

function buildCap(m: SkinMesh, head: Head): void {
  const openA = CAP_A.slice(4, 15);
  // Край шапки над лбом — ниже посередине (чёлка) и выше к вискам (залысины): по нему же лист лица рисует линию волос.
  // Край над лбом — посередине ниже (мысок), к вискам выше: живую линию волос рисует лист лица под ним.
  const edgeH = (r: (typeof CAP)[number], a: number): number => (r.v === 36 ? r.h - 0.012 * Math.exp(-((a / 0.45) ** 2)) : r.h);
  const rows = CAP.map((r) => (r.open ? openA : CAP_A).map((a) => m.v(capPt(head, a, edgeH(r, a), liftAt(r.lift, a)), uvB(mirrorU(a), r.v), 0, r.h < 0.02 ? ['head', 'neck', 0.8] : 'head')));
  // Макушка — веер из одной точки, в ровном тоне волос середины листа.
  const crown = m.v(capPt(head, 0, head.TOP_H + DOME, HAIR_T), uvB(256, 2), 0, 'head');
  const first = rows[0];
  const inside = (p: V3): V3 => [0, p[1] - 0.04, head.HZ - 0.01];
  for (let k = 0; k < first.length; k++) m.quad(crown, first[k], first[(k + 1) % first.length], crown, [0, head.faceHeight(head.TOP_H), head.HZ - 0.01]);
  m.strip(rows.slice(0, 3), true, inside);
  // Ниже линии волос — от виска к затылку: подряд линии волос — те же углы, что у открытых колец.
  m.strip([rows[2].slice(4, 15), ...rows.slice(3)], false, inside);
}

/** Ухо: середина основания (угол, высота над подбородком), вынос края наружу и назад, чертёжные метры. */
export const EAR = { th: 1.66, h0: 0.094, h1: 0.178, out: 0.0115, back: 0.015 } as const;
/** Лист уха на листе лица (точки): справа под листом рта. */
export const EAR_SHEET = { x: 384, y: 264, w: 128, h: 96 } as const;

/**
 * Уши: лоскут в три столбца (основание на черепе, раковина, край) и четыре ряда — край отставлен наружу и назад, раковина
 * чуть вглубь. Лист — на листе лица (тот же тон кожи, что у висков).
 */
function buildEars(m: SkinMesh, head: Head): void {
  const hs = [EAR.h0, 0.12, 0.15, EAR.h1];
  for (const sx of [1, -1] as const) {
    const rows = hs.map((h, ri) => {
      const k = ri / (hs.length - 1);
      // Мочка и верх — уже, середина — шире: край по дуге.
      const bulge = Math.sin(Math.PI * (0.15 + 0.7 * k));
      return [0, 0.5, 1].map((c, ci) => {
        const base = capPt(head, sx * (EAR.th + (ci === 0 ? 0 : 0.03)), h, 0);
        const dx = base[0];
        const dz = base[2] - head.HZ;
        const r = Math.hypot(dx, dz) || 1;
        const out = EAR.out * c * (0.55 + 0.45 * bulge);
        const back = EAR.back * c * (0.5 + 0.5 * bulge);
        const dip = ci === 1 ? -0.005 : 0;
        const p: V3 = [base[0] + (dx / r) * (out + dip), base[1] + (ci === 2 ? 0.004 * (k - 0.5) : 0), base[2] + (dz / r) * (out + dip) - back];
        const u = EAR_SHEET.x + 4 + c * (EAR_SHEET.w - 8);
        const v = EAR_SHEET.y + EAR_SHEET.h - 4 - k * (EAR_SHEET.h - 8);
        return m.v(p, [u / 512, v / 512], 1, 'head');
      });
    });
    m.strip(rows, false, (p) => [p[0] - sx * 0.05, p[1], p[2]]);
  }
}

// ---------- Туника и шея ----------

const TUNIC_A = mirrorRing([0, 0.32, 0.7, 1.1, 1.5, 1.95, 2.5, Math.PI]);

/** Кость подола по углу: левая половина — за левым бедром, правая — за правым, середина — таз. */
function hemWeight(a: number, k: number): Weights {
  const side = Math.abs(Math.sin(a));
  if (side < 0.2) return 'hips';
  return [a > 0 ? 'thighL' : 'thighR', 'hips', k * Math.min(1, side * 1.4)];
}

/** Ряды туники сверху вниз: высота, полуоси, сдвиг середины, кости (функция угла). */
export const TUNIC: readonly { y: number; rx: number; rz: number; zc: number; w: (a: number) => Weights }[] = [
  // Шея — сверху внутри головы, выше угла челюсти (иначе под челюстью у ушей видна щель), плотная: шире половины головы.
  { y: 1.585, rx: 0.04, rz: 0.042, zc: -0.022, w: () => ['head', 'neck', 0.6] },
  { y: 1.476, rx: 0.05, rz: 0.05, zc: -0.024, w: () => ['neck', 'chest', 0.5] },
  // Трапеция — от шеи к плечам (под плащом и капюшоном).
  { y: 1.452, rx: 0.112, rz: 0.072, zc: -0.028, w: () => ['chest', 'neck', 0.82] },
  { y: 1.424, rx: 0.157, rz: 0.088, zc: -0.024, w: () => 'chest' },
  { y: 1.32, rx: 0.162, rz: 0.104, zc: -0.008, w: () => 'chest' },
  { y: 1.13, rx: 0.14, rz: 0.092, zc: 0, w: () => ['spine', 'chest', 0.6] },
  // Пояс — чуть выпуклый ряд (сам ремень нарисован на листе).
  { y: 1.056, rx: 0.149, rz: 0.099, zc: 0.002, w: () => ['spine', 'hips', 0.45] },
  { y: 0.935, rx: 0.16, rz: 0.112, zc: 0.004, w: () => 'hips' },
  { y: 0.82, rx: 0.17, rz: 0.125, zc: 0.008, w: (a) => hemWeight(a, 0.22) },
  { y: 0.7, rx: 0.182, rz: 0.138, zc: 0.01, w: (a) => hemWeight(a, 0.45) },
];

export function tunicPoint(a: number, r: (typeof TUNIC)[number]): V3 {
  return ringPt(a, r.y, r.rx, r.rz, r.zc);
}

/**
 * Строки туники на листе: по длине поверхности спереди (столбец 0,32 рад), шее — втрое гуще (на ней тень челюсти, кадык и
 * ворот: по длине ей досталось бы 16 строк на 8 см).
 */
const TUNIC_DENSE = [3, 1.6] as const;
export function tunicV(): number[] {
  const at = TUNIC.map((r) => tunicPoint(0.32, r));
  const d = [0];
  for (let i = 1; i < at.length; i++) d.push(d[i - 1] + Math.hypot(...sub(at[i], at[i - 1])) * (TUNIC_DENSE[i - 1] ?? 1));
  const all = d[d.length - 1];
  return d.map((x) => SHEETS.tunic.y0 + 1 + (x / all) * (SHEETS.tunic.y1 - SHEETS.tunic.y0 - 2));
}

function buildTunic(m: SkinMesh): void {
  const vs = tunicV();
  const rows = TUNIC.map((r, ri) => TUNIC_A.map((a) => m.v(tunicPoint(a, r), uvB(mirrorU(a), vs[ri]), 0, r.w(a))));
  m.strip(rows, true, (p) => [0, p[1], -0.012]);
}

// ---------- Плащ и капюшон ----------

/** Ряды плаща: высота, полуоси, середина, передний край (угол), кости, строка листа. */
export const CLOAK: readonly { y: number; rx: number; rz: number; zc: number; open: number; w: Weights; v: number }[] = [
  // Плащ лежит на плечах круглым скатом и со спины, передний край — на плече, не на груди.
  { y: 1.49, rx: 0.074, rz: 0.07, zc: -0.028, open: 1.5, w: ['chest', 'neck', 0.7], v: 257 },
  { y: 1.468, rx: 0.165, rz: 0.1, zc: -0.034, open: 1.72, w: 'chest', v: 266 },
  { y: 1.41, rx: 0.212, rz: 0.12, zc: -0.036, open: 1.8, w: 'chest', v: 276 },
  // Ниже плечей — за руками: руки свободны, плащ висит со спины.
  { y: 1.25, rx: 0.214, rz: 0.138, zc: -0.04, open: 1.86, w: ['chest', 'cloak', 0.55], v: 294 },
  { y: 1.0, rx: 0.21, rz: 0.154, zc: -0.046, open: 1.9, w: ['cloak', 'chest', 0.75], v: 318 },
  { y: 0.62, rx: 0.218, rz: 0.172, zc: -0.05, open: 1.92, w: 'cloak', v: 343 },
];
const CLOAK_K = 5;

/** Углы ряда раковины от переднего края `open` через спину к другому краю: по `n` на сторону. */
function shellAngles(open: number, n: number): number[] {
  const side = Array.from({ length: n + 1 }, (_, k) => open + ((Math.PI - open) * k) / n);
  return [...side, ...side.slice(0, -1).reverse().map((a) => -a)];
}

function buildCloak(m: SkinMesh): void {
  const rows = CLOAK.map((r, ri) =>
    shellAngles(r.open, CLOAK_K).map((a, k) => {
      // Складки к подолу: столбцы через один — наружу.
      const fold = ri >= 2 ? 1 + 0.03 * (ri - 1) * (k % 2 ? 1 : -0.4) : 1;
      return m.v(ringPt(a, r.y, r.rx * fold, r.rz * fold, r.zc), uvB(mirrorU(a), r.v), 0, r.w);
    }),
  );
  m.strip(rows, false, (p) => [0, p[1], -0.02]);
}

/** Капюшон, откинутый на плечи: край вокруг шеи, валик за шеей и мешок, лежащий на плаще между лопатками. */
export const HOOD: readonly { y: number; rx: number; rz: number; zc: number; open: number; w: Weights; v: number }[] = [
  // Края капюшона — за шеей по бокам, не спереди (спереди они торчали бы у шеи шипами).
  { y: 1.5, rx: 0.08, rz: 0.077, zc: -0.032, open: 1.42, w: ['neck', 'chest', 0.6], v: 345 },
  { y: 1.468, rx: 0.14, rz: 0.13, zc: -0.06, open: 1.6, w: 'chest', v: 362 },
  { y: 1.335, rx: 0.1, rz: 0.1, zc: -0.13, open: 2.05, w: ['cloak', 'chest', 0.5], v: 384 },
];
const HOOD_K = 4;

function buildHood(m: SkinMesh): void {
  const rows = HOOD.map((r) => shellAngles(r.open, HOOD_K).map((a) => m.v(ringPt(a, r.y, r.rx, r.rz, r.zc), uvB(mirrorU(a), r.v), 0, r.w)));
  m.strip(rows, false, (p) => [0, p[1] + 0.03, -0.06]);
  // Остриё капюшона — вниз по спине.
  const tip = m.v([0, 1.215, -0.17], uvB(511, 391), 0, ['cloak', 'chest', 0.6]);
  const last = rows[rows.length - 1];
  for (let k = 0; k + 1 < last.length; k++) m.quad(last[k], last[k + 1], tip, tip, [0, 1.3, -0.06]);
}

// ---------- Сума и ремень ----------

/** Сума на левом бедре: середина, полуразмеры (наружу, вверх, вдоль бока), печать на клапане. */
export const BAG = { c: [0.178, 0.968, 0.034] as V3, hx: 0.026, hy: 0.072, hz: 0.098, seal: 0.021 } as const;

function buildBag(m: SkinMesh): void {
  const b = SHEETS.bag;
  const { c, hx, hy, hz } = BAG;
  const P = (x: number, y: number, z: number): V3 => [c[0] + x * hx, c[1] + y * hy, c[2] + z * hz];
  const u = (x: number, y: number): [number, number] => uvB(b.x0 + x * (b.x1 - b.x0), b.y0 + y * (b.y1 - b.y0));
  const face = (pts: V3[], uvs: [number, number][], shade = 1): void => {
    const ids = pts.map((p, i) => m.v(p, uvs[i], 0, 'bag', shade));
    m.quad(ids[0], ids[1], ids[2], ids[3], c);
  };
  // Наружная сторона (+x), перед, зад, низ: кожа; верх — под клапаном.
  face([P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)], [u(0.02, 0.98), u(0.62, 0.98), u(0.62, 0.36), u(0.02, 0.36)]);
  face([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [u(0.64, 0.98), u(0.8, 0.98), u(0.8, 0.36), u(0.64, 0.36)], 0.85);
  face([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], [u(0.64, 0.98), u(0.8, 0.98), u(0.8, 0.36), u(0.64, 0.36)], 0.8);
  face([P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], [u(0.82, 0.98), u(0.98, 0.98), u(0.98, 0.4), u(0.82, 0.4)], 0.7);
  // Клапан: по верху и на половину наружной стороны, чуть снаружи.
  const f = 1.12;
  face([P(-1, 1.06, -f), P(-1, 1.06, f), P(f, 1.06, f), P(f, 1.06, -f)], [u(0.02, 0.02), u(0.62, 0.02), u(0.62, 0.16), u(0.02, 0.16)]);
  face([P(f, 1.06, -f), P(f, 1.06, f), P(f, 0.12, f * 0.9), P(f, 0.12, -f * 0.9)], [u(0.02, 0.16), u(0.62, 0.16), u(0.62, 0.34), u(0.02, 0.34)]);
  // Печать красного воска — на клапане посередине, шестигранником с бугорком.
  const s = BAG.seal;
  const sc: V3 = [c[0] + f * hx + 0.004, c[1] + 0.3 * hy, c[2]];
  const mid = m.v([sc[0] + 0.004, sc[1], sc[2]], u(0.82, 0.18), 0, 'bag', 1.05);
  const ring: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ring.push(m.v([sc[0], sc[1] + Math.sin(a) * s, sc[2] + Math.cos(a) * s], u(0.82 + Math.cos(a) * 0.14, 0.18 + Math.sin(a) * -0.16), 0, 'bag'));
  }
  for (let k = 0; k < 6; k++) m.quad(ring[k], ring[(k + 1) % 6], mid, mid, [sc[0] - 0.05, sc[1], sc[2]]);
}

/** Ремень сумы: от её верха наискось через грудь к правому плечу — под плащ (дальше его не видно). */
function buildStrap(m: SkinMesh): void {
  const st = SHEETS.strap;
  const n = 5;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = 1.42 - 1.95 * k;
    const y = 1.03 + (1.44 - 1.03) * k;
    // По поверхности туники в этой точке (ближние ряды) — на палец снаружи.
    const r = surfaceAt(a, y);
    const up: V3 = norm([-0.35 * Math.cos(a), 1, 0.35 * Math.sin(a)]);
    const w = 0.02;
    const vv = st.y0 + 1 + k * (st.y1 - st.y0 - 2);
    left.push(m.v(add(r, scale(up, w)), uvB(st.x0 + 2, vv), 0, k < 0.3 ? ['bag', 'chest', 0.6] : 'chest'));
    right.push(m.v(add(r, scale(up, -w)), uvB(st.x1 - 2, vv), 0, k < 0.3 ? ['bag', 'chest', 0.6] : 'chest'));
  }
  m.strip([left, right], false, (p) => [0, p[1], -0.02]);
}

/** Точка на тунике по углу и высоте (между рядами — прямо), на 6 мм снаружи. */
function surfaceAt(a: number, y: number): V3 {
  let i = 1;
  while (i < TUNIC.length - 1 && TUNIC[i].y > y) i++;
  const r0 = TUNIC[i - 1];
  const r1 = TUNIC[i];
  const k = (r0.y - y) / (r0.y - r1.y);
  const rx = r0.rx + (r1.rx - r0.rx) * k + 0.006;
  const rz = r0.rz + (r1.rz - r0.rz) * k + 0.006;
  const zc = r0.zc + (r1.zc - r0.zc) * k;
  return ringPt(a, y, rx, rz, zc);
}

// ---------- Руки ----------

const MITTEN: MittenSpec = {
  // Кисть мужская — на десятую крупнее, чем у супруги.
  rings: [
    [0, 0.023, 0.015, 0, SHEETS.hand.y0 + 2],
    [0.064, 0.033, 0.0176, 0.001, SHEETS.hand.y0 + 34],
    [0.117, 0.0322, 0.0155, 0.004, SHEETS.hand.y0 + 58],
    [0.161, 0.0262, 0.012, 0.01, SHEETS.hand.y0 + 78],
  ],
  tip: [0.187, 0.013],
  fan: [0.143, 0.01],
  bend: [0.132, 0.009],
  thumbDir: [0.62, 0.55, 0.42],
  thumbR: [
    [0.0132, 0.0115],
    [0.0108, 0.0096],
  ],
  thumbAt: [0.037, 0.064, 0.044],
  hand: SHEETS.hand,
  thumb: SHEETS.thumb,
};

/** Рукав туники — узкий, до запястья, с обшлагом: кольца по плечу и предплечью (сдвиг по оси, полуоси, строка листа). */
export const SLEEVE = {
  upper: [
    [-0.012, 0.043, 0.041, 393],
    [0.06, 0.044, 0.042, 412],
    [0.29, 0.036, 0.034, 452],
  ],
  fore: [
    [0.12, 0.035, 0.032, 482],
    [0.236, 0.031, 0.029, 510],
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
  const top = m.v(add(S, add(scale(d1, -0.03), scale(out1, 0.006))), uvB(sl.x0 + 80, sl.y0 + 1), 0, [arm, 'chest', 0.6]);
  const [u0, u1, u2] = SLEEVE.upper;
  const [f1, f2] = SLEEVE.fore;
  const rings = [
    tube(m, add(S, scale(d1, u0[0])), out1, fw, u0[1], u0[2], 8, uvS(u0[3]), [arm, 'chest', 0.65], inner),
    tube(m, add(S, scale(d1, u1[0])), out1, fw, u1[1], u1[2], 8, uvS(u1[3]), arm, inner),
    tube(m, add(S, scale(d1, u2[0])), out1, fw, u2[1], u2[2], 8, uvS(u2[3]), [arm, fore, 0.5], inner),
    tube(m, add(E, scale(d2, f1[0])), out2, fw, f1[1], f1[2], 8, uvS(f1[3]), fore, inner),
    tube(m, add(E, scale(d2, f2[0])), out2, fw, f2[1], f2[2], 8, uvS(f2[3]), [fore, hand, 0.85], inner),
  ];
  const first = rings[0];
  for (let k = 0; k < first.length - 1; k++) m.quad(top, first[k], first[k + 1], top, S);
  m.strip(rings, false, (p) => {
    // Ось руки: ближайшая точка на ломаной плечо — локоть — запястье.
    const t1 = (p[0] - S[0]) * d1[0] + (p[1] - S[1]) * d1[1] + (p[2] - S[2]) * d1[2];
    if (t1 < 0.29) return add(S, scale(d1, Math.max(-0.03, t1)));
    const t2 = (p[0] - E[0]) * d2[0] + (p[1] - E[1]) * d2[1] + (p[2] - E[2]) * d2[2];
    return add(E, scale(d2, t2));
  });
  mitten(m, sx, W, d2, thumbBase(), MITTEN);
}

// ---------- Ноги ----------

/** Нога ниже туники: чулок до колена, край сапога, икра, щиколотка (высота, радиус, кости, строка листа). */
export const LEG = {
  hose: [0.8, 0.064, 394],
  knee: [0.53, 0.049, 431],
  rim: [0.53, 0.061, 437],
  calf: [0.36, 0.054, 468],
  ankle: [0.105, 0.04, 510],
} as const;

function buildLeg(m: SkinMesh, sx: 1 | -1): void {
  const side = sx === 1 ? 'L' : 'R';
  const thigh = `thigh${side}`;
  const shin = `shin${side}`;
  const foot = `foot${side}`;
  const lg = SHEETS.leg;
  const uvL = (v: number) => (k: number): [number, number] => uvB(lg.x0 + 1 + k * (lg.x1 - lg.x0 - 2), v);
  // Ось ноги: от бедра через колено к щиколотке — по высоте.
  const axis = (y: number): V3 => {
    const [a, b] = y > KNEE[1] ? [HIP, KNEE] : [KNEE, ANKLE];
    const k = (a[1] - y) / (a[1] - b[1]);
    return [sx * (a[0] + (b[0] - a[0]) * k), y, a[2] + (b[2] - a[2]) * k];
  };
  const X: V3 = [1, 0, 0];
  const Z: V3 = [0, 0, 1];
  // Шов — сзади-внутри (к другой ноге).
  const phase = sx === 1 ? Math.PI * 0.75 : Math.PI * 0.25;
  const ring = (row: readonly [number, number, number], w: Weights, back = 0): number[] => {
    const c = axis(row[0]);
    return tube(m, [c[0], c[1], c[2] - back], X, Z, row[1], row[1] * 1.04, 8, uvL(row[2]), w, phase);
  };
  const hose = ring(LEG.hose, thigh);
  const knee = ring(LEG.knee, [shin, thigh, 0.5]);
  const rim = ring(LEG.rim, [shin, thigh, 0.65]);
  const calf = ring(LEG.calf, shin, 0.006);
  const ankle = ring(LEG.ankle, [shin, foot, 0.6]);
  m.strip([hose, knee], false, (p) => axis(p[1]));
  // Край сапога — кольцом наружу от колена (голенище открыто сверху).
  m.strip([knee, rim], false, (p) => [axis(p[1])[0], p[1] - 0.05, axis(p[1])[2]]);
  m.strip([rim, calf, ankle], false, (p) => axis(p[1]));
  // Стопа — труба вдоль +z: пятка, подъём, носок; концы — веером.
  const ft = SHEETS.foot;
  const uvF = (v: number) => (k: number): [number, number] => uvB(ft.x0 + 1 + k * (ft.x1 - ft.x0 - 2), v);
  const fx = sx * 0.099;
  const Y: V3 = [0, 1, 0];
  const fr = (z: number, y: number, rx: number, ry: number, v: number): number[] => tube(m, [fx, y, z], X, Y, rx, ry, 6, uvF(v), foot, Math.PI / 2);
  const heel = fr(-0.045, 0.056, 0.038, 0.053, ft.y0 + 6);
  const ball = fr(0.07, 0.041, 0.046, 0.039, ft.y0 + 24);
  const toe = fr(0.15, 0.029, 0.036, 0.026, ft.y0 + 40);
  m.strip([heel, ball, toe], false, (p) => [fx, p[1], p[2]]);
  const back = m.v([fx, 0.05, -0.078], uvB(ft.x0 + 32, ft.y0 + 1), 0, foot);
  const tip = m.v([fx, 0.025, 0.19], uvB(ft.x0 + 32, ft.y1 - 1), 0, foot);
  for (let k = 0; k < heel.length - 1; k++) m.quad(heel[k + 1], heel[k], back, back, [fx, 0.05, 0]);
  for (let k = 0; k < toe.length - 1; k++) m.quad(toe[k], toe[k + 1], tip, tip, [fx, 0.03, 0.12]);
}

/** Собрать фигуру: голова (маска, шапка, уши), шея и туника, плащ и капюшон, сума, руки, ноги. */
export function buildHeraldMesh(head: Head): SkinMesh {
  const m = new SkinMesh(heraldSkeleton(head));
  head.build(m);
  buildCap(m, head);
  buildEars(m, head);
  place(m, 0, toFigure(headFrame(head)));
  buildTunic(m);
  buildCloak(m);
  buildHood(m);
  buildBag(m);
  buildStrap(m);
  buildArm(m, 1);
  buildArm(m, -1);
  buildLeg(m, 1);
  buildLeg(m, -1);
  return m;
}
