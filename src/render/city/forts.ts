// Укрепления вида «город» (docs/city.md, разделы 2 и 4): стена с зубцами и боевым ходом по рельефу,
// крытый ход на части пролётов, башни квадратные и круглые, надвратные, Дозор, донжон с угловыми
// башенками. Всё — в построитель зданий: один меш с домами.
import { CITY } from './palette';
import { Builder, box, cone, cylinder, flat, pyramid, quadToward, tint, wall, type V3 } from './geom';
import { heightAt, type P, type Tower } from './layout';
import { L, TILE_M } from './tex';
import { rnd } from './noise';
import type { Detail } from './kit';

/** Высота стены до боевого хода над сглаженной землёй, толщина, парапет. */
export const WALL_H = 10;
const WALL_T = 2.4;
const PARAPET_T = 0.6;
const PARAPET_H = 1.05;
const MERLON_H = 0.95;
const MERLON_W = 0.85;
const MERLON_STEP = 1.55;

const stoneT = (k = 1): V3 => tint(CITY.stoneTints[0], k);

/**
 * След башни на плане — та фигура, которую рисует `tower`: круглая — вписанный многоугольник цилиндра (радиус
 * по середине грани), остальные — квадрат `size` по оси `out`. `pad` > 0 — с запасом наружу, < 0 — внутрь.
 */
export function inTowerShape(t: Tower, x: number, z: number, pad = 0): boolean {
  const dx = x - t.x;
  const dz = z - t.z;
  if (t.kind === 'round') return Math.hypot(dx, dz) < (t.size / 2) * Math.cos(Math.PI / 12) + pad;
  const fx = Math.cos(t.out);
  const fz = Math.sin(t.out);
  const h = t.size / 2 + pad;
  return Math.abs(dx * fx + dz * fz) < h && Math.abs(dx * fz - dz * fx) < h;
}

/** Внутри ли точка следа какой-нибудь башни. */
const inTower = (towers: readonly Tower[], x: number, z: number, pad = 0): boolean => towers.some((t) => inTowerShape(t, x, z, pad));

/**
 * Высота боевого хода в вершинах контура: земля, сглаженная по соседям (стена не повторяет каждую
 * кочку), плюс высота стены. Одна на стену и на стражу, что ходит по ней (`life.ts`).
 */
export function wallTops(pts: readonly P[]): number[] {
  const n = pts.length;
  const ground = pts.map((p) => heightAt(p.x, p.z));
  const top: number[] = [];
  for (let k = 0; k < n; k++) {
    let s = 0;
    let w = 0;
    for (let j = -6; j <= 6; j++) {
      const g = ground[(k + j + n) % n];
      const wt = 1 - Math.abs(j) / 7;
      s += g * wt;
      w += wt;
    }
    top.push(s / w + WALL_H);
  }
  return top;
}

/** Самое длинное звено стены, м: длиннее — режется, чтобы низ шёл по земле, а не прямой над ложбиной. */
export const WALL_PIECE = 8;
/** Звено у башни — не длиннее этого. */
const NEAR_PIECE = 1.2;
/**
 * Низ стены — на столько ниже земли куска: стена стоит в земле, а не на ней. 2.4, а не 1.6: на редкой сетке
 * «Низкого» у рва нарисованная земля опускается ниже рельефа на два метра (`seat.test.ts`).
 */
export const WALL_FOOT = 2.4;

/** Кусок стены, как его рисует `cityWall`: кромки, низ и верх концов, парапет, крыт ли ход. */
export interface WallPiece {
  /** Номер звена исходного контура. */
  k: number;
  p: P;
  q: P;
  /** Нормали наружу в концах — со скосом в вершинах контура (длина ≥ 1), и нормаль звена. */
  n0: [number, number];
  n1: [number, number];
  sn: [number, number];
  /** Наружная и внутренняя кромки в концах (план). */
  o0: [number, number];
  o1: [number, number];
  i0: [number, number];
  i1: [number, number];
  base0: number;
  base1: number;
  /** Боевой ход в концах. */
  t0: number;
  t1: number;
  /** Длина по контуру в начале и длина куска. */
  s0: number;
  len: number;
  parH: number;
  cov: boolean;
  /** Кусок целиком в башне — не рисуется. */
  hidden: boolean;
}

/** Зубец парапета: середина, нормаль наружу, низ. */
export interface Merlon {
  x: number;
  z: number;
  fx: number;
  fz: number;
  y: number;
}

/**
 * Раскладка стены по замкнутому контуру — одна на рисунок и на тест посадки (`seat.test.ts`). Звено длиннее
 * `WALL_PIECE` режется: верх идёт прямой между вершинами контура (как ходит стража, `wallTops`), низ — по
 * земле в каждой точке реза. Кусок, все четыре угла которого в башне, не рисуется — а стык стены и башни
 * без щели, потому что соседний кусок кончается в той же точке, внутри башни. Зубец стоит, только если весь
 * вне башен: наполовину в стене башни он торчал бы из неё, над пустым — висел бы.
 */
export function wallPlan(
  pts: readonly P[],
  center: P,
  towers: readonly Tower[],
  detail: Detail,
  covered: (s: number, p: P) => boolean,
  skip: (p: P, q: P) => boolean = () => false,
): { pieces: WallPiece[]; merlons: Merlon[] } {
  const n = pts.length;
  // Нормали наружу в вершинах.
  const nx: number[] = [];
  const nz: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[(k - 1 + n) % n];
    const c = pts[(k + 1) % n];
    let x = c.z - a.z;
    let z = -(c.x - a.x);
    const l = Math.hypot(x, z) || 1;
    x /= l;
    z /= l;
    if (x * (pts[k].x - center.x) + z * (pts[k].z - center.z) < 0) {
      x = -x;
      z = -z;
    }
    nx.push(x);
    nz.push(z);
  }
  const top = wallTops(pts);
  const half = WALL_T / 2;
  const pieces: WallPiece[] = [];
  // Нормали звеньев (наружу).
  const sn: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % n];
    let x = q.z - p.z;
    let z = -(q.x - p.x);
    const l = Math.hypot(x, z) || 1;
    x /= l;
    z /= l;
    if (x * nx[k] + z * nz[k] < 0) {
      x = -x;
      z = -z;
    }
    sn.push([x, z]);
  }
  // Вершина — со скосом (митрой): кромки обоих звеньев проходят на полтолщины от оси, и на остром углу стена
  // не сужается. Без скоса на изломе замковой стены парапет сходил на нет, и зубец у угла висел над пустым.
  const miter = (k: number): [number, number] => {
    const m = Math.max(0.5, nx[k] * sn[k][0] + nz[k] * sn[k][1]);
    return [nx[k] / m, nz[k] / m];
  };
  // Мелко режется только у ворот: у глухой башни кусок, зашедший внутрь, спрятан в её теле, а сквозь арку его видно.
  const nearTower = (x: number, z: number): boolean => towers.some((t) => (t.kind === 'gate' || t.kind === 'castleGate') && Math.hypot(t.x - x, t.z - z) < t.size * 0.75 + 3);
  let sAcc = 0;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const p = pts[k];
    const q = pts[k2];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const cov = detail > 0 && covered(sAcc + len / 2, { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
    const parH = cov ? 2.3 : PARAPET_H;
    // Режем по `WALL_PIECE`, у ворот — по `NEAR_PIECE`: кусок, начатый снаружи, заходит в башню не дальше него
    // и не показывается в проезде (арка уже башни на 1.25 м с каждой стороны).
    const cut: number[] = [0];
    const step = (f: number): number => (nearTower(p.x + (q.x - p.x) * f, p.z + (q.z - p.z) * f) ? NEAR_PIECE : WALL_PIECE);
    while (cut[cut.length - 1] < 1) {
      const f = cut[cut.length - 1];
      cut.push(Math.min(1, f + Math.min(step(f), step(Math.min(1, f + WALL_PIECE / len))) / len));
      if (1 - cut[cut.length - 1] < 0.2 / len) cut[cut.length - 1] = 1;
    }
    const at = (f: number): { pt: P; n: [number, number]; t: number } => {
      const pt = { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f };
      const nn: [number, number] = f === 0 ? miter(k) : f === 1 ? miter(k2) : sn[k];
      return { pt, n: nn, t: top[k] + (top[k2] - top[k]) * f };
    };
    for (let j = 0; j + 1 < cut.length; j++) {
      const A = at(cut[j]);
      const B = at(cut[j + 1]);
      const o0: [number, number] = [A.pt.x + A.n[0] * half, A.pt.z + A.n[1] * half];
      const o1: [number, number] = [B.pt.x + B.n[0] * half, B.pt.z + B.n[1] * half];
      const i0: [number, number] = [A.pt.x - A.n[0] * half, A.pt.z - A.n[1] * half];
      const i1: [number, number] = [B.pt.x - B.n[0] * half, B.pt.z - B.n[1] * half];
      // Звено, которого нет (`skip`: стену там рисует ролик, docs/polish.md, П-6), — как звено в башне: не рисуется.
      const hidden = skip(A.pt, B.pt) || towers.some((t) => [o0, o1, i0, i1].every(([x, z]) => inTowerShape(t, x, z, -0.05)));
      // Низ — ниже самой низкой земли куска по обеим кромкам и оси: между концами земля бывает ниже (ров).
      let lo = Infinity;
      for (let u = 0; u <= 4; u++) {
        const f = u / 4;
        for (const [a, e] of [
          [o0, o1],
          [i0, i1],
          [
            [A.pt.x, A.pt.z],
            [B.pt.x, B.pt.z],
          ],
        ]) {
          lo = Math.min(lo, heightAt(a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f));
        }
      }
      const pl = len * (cut[j + 1] - cut[j]);
      pieces.push({
        k,
        p: A.pt,
        q: B.pt,
        n0: A.n,
        n1: B.n,
        sn: sn[k],
        o0,
        o1,
        i0,
        i1,
        base0: lo - WALL_FOOT,
        base1: lo - WALL_FOOT,
        t0: A.t,
        t1: B.t,
        s0: sAcc + len * cut[j],
        len: pl,
        parH,
        cov,
        hidden,
      });
    }
    sAcc += len;
  }
  // Зубцы — через `MERLON_STEP` по контуру, на открытых кусках, целиком вне башен; сдвиг к парапету — по нормали
  // звена: полоса парапета идёт вдоль звена, а не вдоль нормалей вершин.
  const merlons: Merlon[] = [];
  let next = 0;
  // Подножие зубца — целиком на парапете: на изломе круче прямого угла парапет у вершины уже зубца, и зубец со
  // звена свисал бы за кромку.
  const onStone = (idx: number, m: Merlon): boolean =>
    merlonFootprint(m).every(([x, z]) => {
      for (let j = idx - 3; j <= idx + 3; j++) {
        const c = pieces[(j + pieces.length) % pieces.length];
        if (c.hidden) continue;
        const pi0: [number, number] = [c.p.x + c.n0[0] * PARAPET_IN, c.p.z + c.n0[1] * PARAPET_IN];
        const pi1: [number, number] = [c.q.x + c.n1[0] * PARAPET_IN, c.q.z + c.n1[1] * PARAPET_IN];
        if (inQuad([c.o0, c.o1, pi1, pi0], x, z)) return true;
      }
      return false;
    });
  for (const [idx, c] of pieces.entries()) {
    while (next < c.s0 + c.len) {
      if (next >= c.s0 && !c.hidden && !c.cov) {
        const f = (next - c.s0) / c.len;
        const m: Merlon = {
          x: c.p.x + (c.q.x - c.p.x) * f + c.sn[0] * (half - PARAPET_T / 2),
          z: c.p.z + (c.q.z - c.p.z) * f + c.sn[1] * (half - PARAPET_T / 2),
          fx: c.sn[0],
          fz: c.sn[1],
          y: c.t0 + (c.t1 - c.t0) * f + c.parH,
        };
        if (!merlonCorners(m).some(([x, z]) => inTower(towers, x, z, 0.15)) && onStone(idx, m)) merlons.push(m);
      }
      next += MERLON_STEP;
    }
  }
  return { pieces, merlons };
}

/** Подножие зубца на плане (без пояса верха), чуть внутрь: углы касаются кромок парапета. */
export function merlonFootprint(m: Merlon): [number, number][] {
  const w = MERLON_W / 2 - 0.03;
  const d = PARAPET_T / 2 - 0.03;
  return [
    [m.x + m.fx * d + m.fz * w, m.z + m.fz * d - m.fx * w],
    [m.x + m.fx * d - m.fz * w, m.z + m.fz * d + m.fx * w],
    [m.x - m.fx * d + m.fz * w, m.z - m.fz * d - m.fx * w],
    [m.x - m.fx * d - m.fz * w, m.z - m.fz * d + m.fx * w],
  ];
}

/** Точка внутри выпуклого четырёхугольника (обход любой). */
export function inQuad(q: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, az] = q[k];
    const [bx, bz] = q[(k + 1) % 4];
    const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (Math.abs(cr) < 1e-9) continue;
    const sg = Math.sign(cr);
    if (sign === 0) sign = sg;
    else if (sg !== sign) return false;
  }
  return true;
}

/** Углы зубца на плане (с поясом верха на высоком). */
export function merlonCorners(m: Merlon): [number, number][] {
  const w = (MERLON_W + 0.08) / 2;
  const d = (PARAPET_T + 0.08) / 2;
  const rx = m.fz;
  const rz = -m.fx;
  return [
    [m.x + m.fx * d + rx * w, m.z + m.fz * d + rz * w],
    [m.x + m.fx * d - rx * w, m.z + m.fz * d - rz * w],
    [m.x - m.fx * d + rx * w, m.z - m.fz * d + rz * w],
    [m.x - m.fx * d - rx * w, m.z - m.fz * d - rz * w],
  ];
}

export const MERLON_TOP = MERLON_H + 0.08;
/** Внутренняя кромка парапета — на столько от оси стены (наружу). */
export const PARAPET_IN = WALL_T / 2 - PARAPET_T;
/** Подножие зубца на плане: ширина вдоль стены и толщина. */
export const MERLON_FOOT = [MERLON_W, PARAPET_T] as const;

/**
 * Стена по замкнутому контуру. `center` — точка внутри (куда смотрит «внутрь»). `covered(s)` —
 * крыт ли ход на длине `s` по контуру. Раскладка — `wallPlan`.
 */
export function cityWall(
  b: Builder,
  pts: readonly P[],
  center: P,
  towers: readonly Tower[],
  detail: Detail,
  covered: (s: number, p: P) => boolean,
  skip?: (p: P, q: P) => boolean,
): void {
  const { pieces, merlons } = wallPlan(pts, center, towers, detail, covered, skip);
  const T = stoneT();
  const Tdark = stoneT(0.92);
  const up: V3 = [0, 1, 0];
  const [tw] = TILE_M.wood;
  pieces.forEach((c, idx) => {
    if (c.hidden) return;
    const { o0, o1, i0, i1, base0, base1, t0, t1, s0, len, parH, cov } = c;
    const out: V3 = [c.sn[0], 0, c.sn[1]];
    const inw: V3 = [-out[0], 0, -out[2]];
    // Наружная грань — до верха парапета; внутренняя — до боевого хода.
    quadWall(b, o0, o1, base0, base1, t0 + parH, t1 + parH, s0, s0 + len, T, 'ashlar', out);
    quadWall(b, i0, i1, base0, base1, t0, t1, s0, s0 + len, Tdark, 'ashlar', inw);
    // Боевой ход: полоса от внутренней кромки до парапета.
    const pi0: [number, number] = [c.p.x + c.n0[0] * (WALL_T / 2 - PARAPET_T), c.p.z + c.n0[1] * (WALL_T / 2 - PARAPET_T)];
    const pi1: [number, number] = [c.q.x + c.n1[0] * (WALL_T / 2 - PARAPET_T), c.q.z + c.n1[1] * (WALL_T / 2 - PARAPET_T)];
    quadToward(b, [i0[0], t0, i0[1]], [i1[0], t1, i1[1]], [pi1[0], t1, pi1[1]], [pi0[0], t0, pi0[1]], [s0 / tw, 0, (s0 + len) / tw, 0, (s0 + len) / tw, 0.6, s0 / tw, 0.6], L.wood, tint(CITY.timberGrey, 1.1), up, [0.9, 0.9, 0.8, 0.8]);
    // Парапет изнутри и его верх.
    quadWall(b, pi0, pi1, t0, t1, t0 + parH, t1 + parH, s0, s0 + len, Tdark, 'ashlar', inw, 0.8);
    quadToward(b, [pi0[0], t0 + parH, pi0[1]], [pi1[0], t1 + parH, pi1[1]], [o1[0], t1 + parH, o1[1]], [o0[0], t0 + parH, o0[1]], [s0 / 4, 0, (s0 + len) / 4, 0, (s0 + len) / 4, 0.15, s0 / 4, 0.15], L.ashlar, T, up);
    // Торец высокого парапета там, где крытый ход кончается у открытого: без него в стык видно пустоту.
    for (const [nb, end] of [
      [pieces[(idx - 1 + pieces.length) % pieces.length], 0],
      [pieces[(idx + 1) % pieces.length], 1],
    ] as const) {
      if (nb.hidden || nb.parH >= parH) continue;
      const o = end ? o1 : o0;
      const pi = end ? pi1 : pi0;
      const y = end ? t1 : t0;
      const away: V3 = end ? [c.q.x - c.p.x, 0, c.q.z - c.p.z] : [c.p.x - c.q.x, 0, c.p.z - c.q.z];
      quadToward(b, [o[0], y + nb.parH, o[1]], [pi[0], y + nb.parH, pi[1]], [pi[0], y + parH, pi[1]], [o[0], y + parH, o[1]], [0, 0, 0.15, 0, 0.15, 0.3, 0, 0.3], L.ashlar, Tdark, away, [0.9, 0.9, 1, 1]);
    }
    if (cov) {
      // Крытый ход: столбы у внутренней кромки и навес от парапета внутрь.
      const roofT = tint(CITY.roofTints[(c.k >> 3) % CITY.roofTints.length], 0.95);
      const [ax, az] = c.n0;
      const [bx, bz] = c.n1;
      const r0: V3 = [o0[0] - ax * 0.1, t0 + parH + 0.25, o0[1] - az * 0.1];
      const r1: V3 = [o1[0] - bx * 0.1, t1 + parH + 0.25, o1[1] - bz * 0.1];
      const e0: V3 = [i0[0] - ax * 0.5, t0 + 1.85, i0[1] - az * 0.5];
      const e1: V3 = [i1[0] - bx * 0.5, t1 + 1.85, i1[1] - bz * 0.5];
      const sl = Math.hypot(r0[0] - e0[0], r0[1] - e0[1], r0[2] - e0[2]);
      quadToward(b, e0, e1, r1, r0, [s0 / 4, 0, (s0 + len) / 4, 0, (s0 + len) / 4, sl / 4, s0 / 4, sl / 4], L.roofTile, roofT, [inw[0], 1.5, inw[2]], [0.9, 0.9, 1, 1]);
      // Исподка навеса — тёмное дерево, видна снизу и сбоку.
      quadToward(b, r0, r1, e1, e0, [0, 0, len / 2, 0, len / 2, 1, 0, 1], L.wood, tint(CITY.oak, 0.7), [-inw[0], -1.5, -inw[2]], [0.5, 0.5, 0.5, 0.5]);
      for (let s = Math.ceil(s0 / 3) * 3; s < s0 + len; s += 3) {
        const f = (s - s0) / len;
        const x = i0[0] + (i1[0] - i0[0]) * f - out[0] * 0.35;
        const z = i0[1] + (i1[1] - i0[1]) * f - out[2] * 0.35;
        const y = t0 + (t1 - t0) * f;
        box(b, x, z, out[0], out[2], 0.18, 0.18, y, y + 1.9, 'wood', tint(CITY.oak, 0.9), null);
      }
    }
  });
  for (const m of merlons) merlon(b, m.x, m.z, m.fx, m.fz, m.y, T, detail);
}

/** Грань стены по двум точкам плана с наклонными низом и верхом; u — длина по контуру. */
function quadWall(b: Builder, a: [number, number], e: [number, number], ya0: number, ye0: number, ya1: number, ye1: number, ua: number, ue: number, t: V3, layer: 'ashlar', want: V3, aoTop = 1): void {
  const [tw, th] = TILE_M[layer];
  quadToward(
    b,
    [a[0], ya0, a[1]],
    [e[0], ye0, e[1]],
    [e[0], ye1, e[1]],
    [a[0], ya1, a[1]],
    [ua / tw, ya0 / th, ue / tw, ye0 / th, ue / tw, ye1 / th, ua / tw, ya1 / th],
    L[layer],
    t,
    want,
    [0.72, 0.72, aoTop, aoTop],
    0,
    [0.9, 0.9, 0, 0],
  );
}

function merlon(b: Builder, x: number, z: number, fx: number, fz: number, y: number, t: V3, detail: Detail): void {
  box(b, x, z, fx, fz, MERLON_W, PARAPET_T, y, y + MERLON_H, 'ashlar', t, 'ashlar');
  if (detail > 1) box(b, x, z, fx, fz, MERLON_W + 0.08, PARAPET_T + 0.08, y + MERLON_H, y + MERLON_H + 0.08, 'ashlar', tint(CITY.stoneTints[2]), 'ashlar');
}

/** Зубцы по квадрату (верх башни): `half` — полусторона по оси, на высоте `y`. */
function crenelSquare(b: Builder, cx: number, cz: number, fx: number, fz: number, half: number, y: number, t: V3, detail: Detail): void {
  const rx = fz;
  const rz = -fx;
  const per = Math.max(2, Math.round((half * 2) / MERLON_STEP));
  for (const [ax, az, ox, oz] of [
    [fx, fz, rx, rz],
    [rx, rz, -fx, -fz],
    [-fx, -fz, -rx, -rz],
    [-rx, -rz, fx, fz],
  ]) {
    for (let k = 0; k < per; k++) {
      const s = -half + ((k + 0.5) / per) * half * 2;
      merlon(b, cx + ax * (half - PARAPET_T / 2) + ox * s, cz + az * (half - PARAPET_T / 2) + oz * s, ax, az, y, t, detail);
    }
  }
}

/** Башня по виду. */
export function tower(b: Builder, t: Tower, detail: Detail): V3[] {
  const fx = Math.cos(t.out);
  const fz = Math.sin(t.out);
  const T = stoneT(0.97 + rnd(t.seed, 1, 1) * 0.06);
  // Низ — ниже самой низкой земли всего следа (`Tower.foot`): у квадратной башни углы дальше круга
  // `layout.lowUnder`, и на склоне угол висел бы над землёй. Высота башни — от `t.base`, как прежде.
  const base = (t.foot ?? t.base) - 1.8;
  const topY = t.base + t.height;
  const roofHex = rnd(t.seed, 3, 1) < 0.55 ? CITY.roofTints[(t.seed >>> 3) % CITY.roofTints.length] : CITY.slateTint;
  const roofL = roofHex === CITY.slateTint ? 'roofSlate' : 'roofTile';
  const seg = detail === 0 ? 12 : 16;
  const lights: V3[] = [];
  if (t.kind === 'round') {
    const r = t.size / 2;
    cylinder(b, t.x, t.z, r, base, topY, seg, 'towerSlit', T, { aoBottom: 0.72, grimeBottom: 0.9, vBase: base });
    cylinder(b, t.x, t.z, r + 0.3, topY, topY + 0.7, seg, 'ashlar', T, { aoBottom: 0.6 });
    const roofTop = topY + 0.7 + (r + 0.6) * Math.tan((63 * Math.PI) / 180);
    cone(b, t.x, t.z, r + 0.6, topY + 0.55, roofTop, seg, roofL, tint(roofHex));
    if (detail > 0) cone(b, t.x, t.z, 0.18, roofTop - 0.2, roofTop + 1.4, 6, 'wood', tint(CITY.iron, 1.2), 1);
    lights.push([t.x - fx * (r + 0.2), topY - 3, t.z - fz * (r + 0.2)]);
    return lights;
  }
  const s = t.size;
  const gate = t.kind === 'gate' || t.kind === 'castleGate';
  if (gate) {
    // Проезд — арка по оси дороги: перед и зад — плитка ворот, бока — бойницы.
    const archH = 8;
    const floor = t.floor ?? t.base;
    box(b, t.x, t.z, fx, fz, s, s, base, floor, 'ashlar', T, null, { aoBottom: 0.7 });
    gateFaces(b, t.x, t.z, fx, fz, s, floor, floor + archH, T);
    box(b, t.x, t.z, fx, fz, s, s, floor + archH, topY, 'towerSlit', T, null, { vBase: floor + archH, aoBottom: 0.95 });
    lights.push([t.x + fx * (s / 2 + 0.4), floor + 4.8, t.z + fz * (s / 2 + 0.4)], [t.x - fx * (s / 2 + 0.4), floor + 4.8, t.z - fz * (s / 2 + 0.4)]);
  } else {
    box(b, t.x, t.z, fx, fz, s, s, base, topY, t.kind === 'keep' ? 'towerSlit' : 'towerSlit', T, null, { aoBottom: 0.72, grimeBottom: 0.9, vBase: base });
  }
  if (t.kind === 'keep') {
    // Верхний ярус с окнами, пояс-машикули, зубцы, кровля внутри и угловые башенки.
    box(b, t.x, t.z, fx, fz, s + 0.02, s + 0.02, topY - 3.2, topY, 'stoneWin', T, null, { vBase: topY - 3.2, vTile: 3.2, glow: 1 });
    box(b, t.x, t.z, fx, fz, s + 0.8, s + 0.8, topY, topY + 0.8, 'ashlar', T, 'ashlar', { aoBottom: 0.55 });
    crenelSquare(b, t.x, t.z, fx, fz, (s + 0.8) / 2, topY + 0.8, T, detail);
    const inner = s - 2.4;
    hipRoof(b, t.x, t.z, fx, fz, inner, inner, topY + 0.8, 58, 'roofSlate', tint(CITY.slateTint));
    for (const [a, c] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const rx = fz;
      const rz = -fx;
      const x = t.x + fx * (s / 2) * a + rx * (s / 2) * c;
      const z = t.z + fz * (s / 2) * a + rz * (s / 2) * c;
      cylinder(b, x, z, 1.35, topY - 4, topY + 2.2, 10, 'ashlar', T, { aoBottom: 0.6 });
      cone(b, x, z, 1.6, topY + 2.1, topY + 2.1 + 4.2, 10, 'roofSlate', tint(CITY.slateTint));
    }
    lights.push([t.x + fx * (s / 2 + 0.3), topY - 6, t.z + fz * (s / 2 + 0.3)]);
    return lights;
  }
  if (t.kind === 'watch') {
    // Дозор: площадка с зубцами и над ней фонарь-беседка на столбах под шатром.
    box(b, t.x, t.z, fx, fz, s + 0.7, s + 0.7, topY, topY + 0.7, 'ashlar', T, 'ashlar', { aoBottom: 0.55 });
    crenelSquare(b, t.x, t.z, fx, fz, (s + 0.7) / 2, topY + 0.7, T, detail);
    const ls = s * 0.55;
    const ly = topY + 0.7;
    const rx = fz;
    const rz = -fx;
    for (const [a, c] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      box(b, t.x + fx * (ls / 2) * a + rx * (ls / 2) * c, t.z + fz * (ls / 2) * a + rz * (ls / 2) * c, fx, fz, 0.35, 0.35, ly, ly + 3.2, 'wood', tint(CITY.oak), null);
    }
    box(b, t.x, t.z, fx, fz, ls + 0.4, ls + 0.4, ly + 3.2, ly + 3.6, 'wood', tint(CITY.oak, 0.9), null);
    hipRoof(b, t.x, t.z, fx, fz, ls + 1.2, ls + 1.2, ly + 3.55, 60, 'roofSlate', tint(CITY.slateTint));
    lights.push([t.x, ly + 1.6, t.z]);
    return lights;
  }
  // Квадратная и надвратная: пояс, затем шатёр (или зубцы с малым шатром).
  box(b, t.x, t.z, fx, fz, s + 0.5, s + 0.5, topY, topY + 0.6, 'ashlar', T, 'ashlar', { aoBottom: 0.55 });
  const open = !gate && rnd(t.seed, 9, 1) < 0.3;
  if (open) {
    crenelSquare(b, t.x, t.z, fx, fz, (s + 0.5) / 2, topY + 0.6, T, detail);
    flat(b, squarePts(t.x, t.z, fx, fz, s + 0.4), topY + 0.62, 'wood', tint(CITY.timberGrey));
  } else {
    hipRoof(b, t.x, t.z, fx, fz, s + 1.2, s + 1.2, topY + 0.55, gate ? 56 : 58 + rnd(t.seed, 11, 1) * 6, roofL, tint(roofHex));
    if (gate && detail > 0) {
      // Угловые эркеры-башенки по наружным углам надвратной.
      const rx = fz;
      const rz = -fx;
      for (const c of [1, -1]) {
        const x = t.x + fx * (s / 2) + rx * (s / 2) * c;
        const z = t.z + fz * (s / 2) + rz * (s / 2) * c;
        cylinder(b, x, z, 1.15, topY - 5, topY + 1.2, 10, 'ashlar', T, { aoBottom: 0.55 });
        cone(b, x, z, 1.4, topY + 1.1, topY + 1.1 + 3.6, 10, roofL, tint(roofHex));
      }
    }
  }
  lights.push([t.x - fx * (s / 2 + 0.3), t.base + 3.5, t.z - fz * (s / 2 + 0.3)]);
  return lights;
}

function squarePts(cx: number, cz: number, fx: number, fz: number, s: number): [number, number][] {
  const rx = fz;
  const rz = -fx;
  const h = s / 2;
  return [
    [cx + fx * h - rx * h, cz + fz * h - rz * h],
    [cx + fx * h + rx * h, cz + fz * h + rz * h],
    [cx - fx * h + rx * h, cz - fz * h + rz * h],
    [cx - fx * h - rx * h, cz - fz * h - rz * h],
  ];
}

/** Шатровая (вальмовая) кровля над прямоугольником: короткий конёк вдоль длинной стороны. */
export function hipRoof(b: Builder, cx: number, cz: number, fx: number, fz: number, w: number, d: number, y: number, pitchDeg: number, layer: 'roofTile' | 'roofSlate', t: V3): number {
  const tp = Math.tan((pitchDeg * Math.PI) / 180);
  const pts = squareRect(cx, cz, fx, fz, w, d);
  const rise = (Math.min(w, d) / 2) * tp;
  if (Math.abs(w - d) < 0.05) {
    pyramid(b, pts, y, [cx, y + rise, cz], layer, t);
    return y + rise;
  }
  // Прямоугольник: конёк вдоль большей стороны.
  const rx = fz;
  const rz = -fx;
  const along = w > d;
  const half = (Math.max(w, d) - Math.min(w, d)) / 2;
  const ax = along ? rx : fx;
  const az = along ? rz : fz;
  const k0: V3 = [cx - ax * half, y + rise, cz - az * half];
  const k1: V3 = [cx + ax * half, y + rise, cz + az * half];
  const [tw, th] = TILE_M[layer];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    // Ближняя к ребру точка конька — для треугольников и трапеций.
    const pick = (x: number, z: number): V3 => (Math.hypot(k0[0] - x, k0[2] - z) < Math.hypot(k1[0] - x, k1[2] - z) ? k0 : k1);
    const kp = pick(p[0], p[1]);
    const kq = pick(q[0], q[1]);
    const w2 = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const sl = rise / Math.sin(Math.atan(tp));
    if (kp === kq) b.tri([p[0], y, p[1]], [q[0], y, q[1]], kp, [0, 0, w2 / tw, 0, w2 / tw / 2, sl / th], L[layer], t, [0.8, 0.8, 1]);
    else b.quad([p[0], y, p[1]], [q[0], y, q[1]], kq, kp, [0, 0, w2 / tw, 0, (w2 - half) / tw, sl / th, half / tw, sl / th], L[layer], t, [0.8, 0.8, 1, 1]);
  }
  return y + rise;
}

function squareRect(cx: number, cz: number, fx: number, fz: number, w: number, d: number): [number, number][] {
  const rx = fz;
  const rz = -fx;
  const hw = w / 2;
  const hd = d / 2;
  return [
    [cx + fx * hd - rx * hw, cz + fz * hd - rz * hw],
    [cx + fx * hd + rx * hw, cz + fz * hd + rz * hw],
    [cx - fx * hd + rx * hw, cz - fz * hd + rz * hw],
    [cx - fx * hd - rx * hw, cz - fz * hd - rz * hw],
  ];
}

/**
 * Перед и зад надвратной башни: одна арка проезда посередине (плитка ворот, 6 м), по бокам — кладка;
 * бока башни — бойницы. Проезд один: плитка не повторяется по ширине.
 */
function gateFaces(b: Builder, cx: number, cz: number, fx: number, fz: number, s: number, y0: number, y1: number, t: V3): void {
  const rx = fz;
  const rz = -fx;
  const h = s / 2;
  const [tw, th] = TILE_M.gateArch;
  const v1 = (y1 - y0) / th;
  const half = tw / 2;
  for (const side of [1, -1]) {
    // Вдоль «вправо» снаружи: у переда — +r, у зада — −r.
    const dirx = rx * side;
    const dirz = rz * side;
    const ox = cx + fx * h * side;
    const oz = cz + fz * h * side;
    const at = (r: number, y: number): V3 => [ox + dirx * r, y, oz + dirz * r];
    const want: V3 = [fx * side, 0, fz * side];
    quadToward(b, at(-half, y0), at(half, y0), at(half, y1), at(-half, y1), [0, 0, 1, 0, 1, v1, 0, v1], L.gateArch, t, want, [0.75, 0.75, 1, 1], 0.6);
    const [aw, ah] = TILE_M.ashlar;
    for (const [r0, r1] of [
      [-h, -half],
      [half, h],
    ]) {
      quadToward(b, at(r0, y0), at(r1, y0), at(r1, y1), at(r0, y1), [r0 / aw, y0 / ah, r1 / aw, y0 / ah, r1 / aw, y1 / ah, r0 / aw, y1 / ah], L.ashlar, t, want, [0.75, 0.75, 1, 1]);
    }
  }
  // Бока.
  wall(b, { ax: cx + fx * h + rx * h, az: cz + fz * h + rz * h, bx: cx - fx * h + rx * h, bz: cz - fz * h + rz * h, y0, y1, layer: 'towerSlit', tint: t, aoBottom: 0.75 });
  wall(b, { ax: cx - fx * h - rx * h, az: cz - fz * h - rz * h, bx: cx + fx * h - rx * h, bz: cz + fz * h - rz * h, y0, y1, layer: 'towerSlit', tint: t, aoBottom: 0.75 });
}
