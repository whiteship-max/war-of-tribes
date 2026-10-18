// Покои правителя (docs/city_v3.md, Г-5): тело правителя от первого лица — руки в рукавах с горностаевой опушкой, кисти с
// пальцами и перстнем, ноги сидя (колени под столом). Одна сетка с неизменной раскладкой вершин: каждый кадр, когда тело
// движется, пересчитываются только места вершин, — ни новых буферов, ни новых вызовов отрисовки.
//
// Руки ставятся двухзвенной обратной кинематикой: плечо — у тела под глазом, кисть — куда велит дело (`acts.ts`:
// подлокотники, подоконник, у огня) или где лежит предмет в руке; локоть уходит вниз и наружу. Пальцы гнутся долей
// `curl` по трём суставам. Свет — шейдер покоев (`material.ts`): огонь, свечи и окна ложатся на кожу, как на всё в комнате.
import * as THREE from 'three';
import { tint, type V3 } from '../city/geom';
import { PLAIN_LAYER } from './geo';

/** Кисть: запястье, куда смотрят пальцы (`f`), тыльная сторона (`u`), согнутость пальцев 0…1, разведённость. */
export interface HandPose {
  w: V3;
  f: V3;
  u: V3;
  curl: number;
  spread?: number;
}

/** Что рисует тело в этот кадр — в осях комнаты. */
export interface BodyPose {
  /** Глаз и куда обращено тело (не голова: голова крутится сама, плечи — нет). */
  eye: V3;
  yaw: number;
  left: HandPose | null;
  right: HandPose | null;
  /** Ноги сидя: доля посадки (0 — стоит, ног не видно) и где сиденье. */
  sit: number;
  seat: { x: number; z: number; y: number };
}

/** Тон кожи, бархата, опушки, чулок, сапог и золота перстня (sRGB → линейный — `tint`). */
const SKIN = tint(0xc89a7e);
const ROBE = tint(0x5c1418);
const TRIM = tint(0xece4d4);
const HOSE = tint(0x2a2230);
const SHOE = tint(0x3a2416);
const GOLD = tint(0xd8ac52);
const TRIM_GOLD = tint(0xb8913c);
const ROBE_DARK = tint(0x4a1014);

/** Длины руки, м: плечо и предплечье; ладонь до костяшек; пальцы — указательный, средний, безымянный, мизинец. */
const UPPER = 0.29;
const FORE = 0.27;
const PALM = 0.088;
const FINGERS = [
  { off: -0.025, len: 0.07, r: 0.0086, back: 0 },
  { off: -0.0075, len: 0.078, r: 0.0089, back: 0.002 },
  { off: 0.0095, len: 0.073, r: 0.0085, back: 0.004 },
  { off: 0.0255, len: 0.058, r: 0.0075, back: 0.012 },
] as const;
const SIDES = 8;

type P = [number, number, number];
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P, b: P): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: P): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: P): P => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a: P, k: number): P => [a[0] * k, a[1] * k, a[2] * k];

/** Ортонормальная пара к оси `d`: `a` — по возможности вдоль `hint`. */
function frame(d: P, hint: P): [P, P] {
  let a = sub(hint, scale(d, dot(hint, d)));
  if (len(a) < 1e-4) a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  a = norm(sub(a, scale(d, dot(a, d))));
  return [a, cross(d, a)];
}

/** Писец сетки: вершины и треугольники копятся в массивы, раскладка — одна на все кадры. */
class Emit {
  pos: number[] = [];
  col: number[] = [];
  shine: number[] = [];
  idx: number[] = [];
  private n = 0;

  /** Кольцо из `sides` вершин вокруг точки `c` в плоскости (`a`, `b`), радиусы по `a` и по `b`. */
  ring(c: P, a: P, b: P, ra: number, rb: number, col: V3, shine: number, sides = SIDES): number {
    const base = this.n;
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      const ca = Math.cos(t) * ra;
      const sb = Math.sin(t) * rb;
      this.pos.push(c[0] + a[0] * ca + b[0] * sb, c[1] + a[1] * ca + b[1] * sb, c[2] + a[2] * ca + b[2] * sb);
      this.col.push(col[0], col[1], col[2]);
      this.shine.push(shine);
    }
    this.n += sides;
    return base;
  }

  point(c: P, col: V3, shine: number): number {
    this.pos.push(c[0], c[1], c[2]);
    this.col.push(col[0], col[1], col[2]);
    this.shine.push(shine);
    return this.n++;
  }

  /** Полотно по сетке точек (ряды одной длины): подол кафтана на коленях. */
  grid(rows: readonly (readonly P[])[], col: V3, shine: number): void {
    const base = this.n;
    const w = rows[0].length;
    for (const r of rows) for (const p of r) this.point(p, col, shine);
    for (let i = 0; i + 1 < rows.length; i++)
      for (let j = 0; j + 1 < w; j++) {
        const a = base + i * w + j;
        this.idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
      }
  }

  /** Бок трубы между двумя кольцами. */
  band(r0: number, r1: number, sides = SIDES): void {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.idx.push(r0 + i, r0 + j, r1 + j, r0 + i, r1 + j, r1 + i);
    }
  }

  /** Крышка кольца в точку (кончик пальца, торец). */
  fan(r: number, tip: number, sides = SIDES, flip = false): void {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (flip) this.idx.push(r + j, r + i, tip);
      else this.idx.push(r + i, r + j, tip);
    }
  }

  /** Труба по точкам с радиусами; концы — крышками. */
  tube(pts: readonly P[], radii: readonly number[], hint: P, col: V3 | readonly V3[], shine: number, sides = SIDES, caps: [boolean, boolean] = [true, true], flat = 1): void {
    const rings: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const d = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      const [a, b] = frame(d, hint);
      const c = Array.isArray(col[0]) ? (col as readonly V3[])[i] : (col as V3);
      rings.push(this.ring(pts[i], a, b, radii[i] * flat, radii[i], c, shine, sides));
    }
    for (let i = 0; i + 1 < rings.length; i++) this.band(rings[i], rings[i + 1], sides);
    const c0 = Array.isArray(col[0]) ? (col as readonly V3[])[0] : (col as V3);
    const c1 = Array.isArray(col[0]) ? (col as readonly V3[])[pts.length - 1] : (col as V3);
    if (caps[0]) {
      const d = norm(sub(pts[0], pts[1]));
      this.fan(rings[0], this.point(add(pts[0], d, radii[0] * 0.5), c0, shine), sides, true);
    }
    if (caps[1]) {
      const n = pts.length - 1;
      const d = norm(sub(pts[n], pts[n - 1]));
      this.fan(rings[n], this.point(add(pts[n], d, radii[n] * 0.6), c1, shine), sides);
    }
  }
}

/** Двухзвенная рука: где локоть при плече `s` и запястье `w`; `pole` — куда уходит локоть. */
export function elbowOf(s: P, w: P, pole: P): P {
  const d = sub(w, s);
  const dist = Math.min(UPPER + FORE - 1e-3, Math.max(0.05, len(d)));
  const dir = norm(d);
  // Расстояние от плеча до проекции локтя на ось плечо — запястье и высота локтя над осью.
  const a = (UPPER * UPPER - FORE * FORE + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  const [side] = frame(dir, pole);
  return add(add(s, dir, a), side, h);
}

/** Кисть: ладонь, четыре пальца по три сустава, большой палец; на безымянном правой — перстень. */
function hand(e: Emit, h: HandPose, right: boolean): void {
  const f = norm(h.f as P);
  const u = norm(sub(h.u as P, scale(f, dot(h.u as P, f))));
  // К мизинцу: у правой кисти тыльной стороной вверх и пальцами вперёд большой палец смотрит внутрь, мизинец — наружу.
  const toLittle = scale(cross(f, u), right ? 1 : -1);
  const w = h.w as P;
  const curl = Math.min(1, Math.max(0, h.curl));
  const spread = h.spread ?? 0.08;
  // Ладонь: от запястья к костяшкам шире, тыльная сторона чуть выгнута.
  const palm: P[] = [w, add(w, f, PALM * 0.5), add(w, f, PALM)];
  const pr = [0.026, 0.037, 0.039];
  const rings: number[] = [];
  for (let i = 0; i < 3; i++) rings.push(e.ring(add(palm[i], toLittle, 0.003), toLittle, u, pr[i], 0.0135, SKIN, 0.12, 9));
  for (let i = 0; i < 2; i++) e.band(rings[i], rings[i + 1], 9);
  e.fan(rings[0], e.point(add(w, f, -0.008), SKIN, 0.12), 9, true);
  e.fan(rings[2], e.point(add(palm[2], f, 0.01), SKIN, 0.12), 9);
  FINGERS.forEach((g, i) => {
    // Сгиб: пястно-фаланговый, средний и ногтевой — к ладони (против тыльной стороны).
    const fan = (i - 1.5) * spread * (1 - curl * 0.6);
    const fd = norm(add(f, toLittle, fan));
    const fu = norm(sub(u, scale(fd, dot(u, fd))));
    const root = add(add(add(w, f, PALM - g.back), toLittle, g.off), u, 0.004);
    // Пальцы в покое слегка согнуты; сгиб — больше в средних суставах, чем у основания (не «когти»).
    const angles = [0.12 + curl * 0.95, 0.18 + curl * 1.35, 0.1 + curl * 0.85];
    const parts = [0.45, 0.3, 0.25];
    const pts: P[] = [root];
    let th = 0;
    for (let j = 0; j < 3; j++) {
      th += angles[j];
      const d = add(scale(fd, Math.cos(th)), fu, -Math.sin(th));
      pts.push(add(pts[j], d, g.len * parts[j]));
    }
    const radii = [g.r * 1.05, g.r, g.r * 0.88, g.r * 0.78];
    e.tube(pts, radii, fu, SKIN, 0.12, 7, [false, true], 0.9);
    if (right && i === 2) {
      // Перстень державы: золотой обод на основной фаланге безымянного.
      const c = add(pts[0], sub(pts[1], pts[0]), 0.55);
      const d = norm(sub(pts[1], pts[0]));
      e.tube([add(c, d, -0.005), add(c, d, 0.005)], [g.r * 1.32, g.r * 1.32], fu, GOLD, 0.95, 8, [false, false]);
    }
  });
  // Большой палец: от основания ладони к указательному, сгиб — тот же доли.
  const thumbSide = scale(toLittle, -1);
  const base = add(add(w, f, 0.022), thumbSide, 0.026);
  const td = norm(add(add(f, thumbSide, 0.55 - curl * 0.25), u, -0.35 - curl * 0.4));
  const tu = norm(sub(u, scale(td, dot(u, td))));
  const tp: P[] = [base];
  let th = 0;
  for (const [a, l] of [
    [0.1 + curl * 0.5, 0.034],
    [curl * 0.7, 0.03],
  ] as const) {
    th += a;
    const d = add(scale(td, Math.cos(th)), tu, -Math.sin(th));
    tp.push(add(tp[tp.length - 1], d, l));
  }
  e.tube(tp, [0.0125, 0.0108, 0.0092], tu, SKIN, 0.12, 7, [false, true], 0.92);
}

/** Рука: рукав от плеча до локтя и до запястья, опушка, запястье кожей и кисть. */
function arm(e: Emit, s: P, h: HandPose, right: boolean, out: P): void {
  const w = h.w as P;
  const el = elbowOf(s, w, add(out, [0, -1, 0], 1.2));
  const fore = norm(sub(w, el));
  // Рукав кончается опушкой на ладонь от запястья: из-под неё — кожа запястья.
  const cuffEnd = add(w, fore, -0.035);
  const cuffStart = add(w, fore, -0.075);
  e.tube([add(s, norm(sub(el, s)), 0.04), el, cuffStart], [0.062, 0.058, 0.05], out, ROBE, 0.04, 10, [true, false]);
  e.tube([cuffStart, add(cuffStart, fore, 0.006), add(cuffEnd, fore, -0.006), cuffEnd], [0.05, 0.06, 0.06, 0.05], out, TRIM, 0.02, 10, [false, true]);
  e.tube([add(cuffStart, fore, 0.01), add(w, fore, 0.004)], [0.028, 0.026], out, SKIN, 0.12, 8, [false, false]);
  hand(e, h, right);
}

/** Нога сидя: бедро в полах кафтана, колено, голень в чулке, сапог. */
function leg(e: Emit, hip: P, knee: P, ankle: P, toe: P, side: P): void {
  e.tube([hip, add(hip, sub(knee, hip), 0.5), add(knee, sub(hip, knee), 0.08), knee], [0.072, 0.07, 0.062, 0.055], side, ROBE, 0.04, 10, [false, true]);
  e.tube([add(knee, [0, -0.02, 0]), add(knee, sub(ankle, knee), 0.45), ankle], [0.05, 0.046, 0.036], side, HOSE, 0.08, 9, [true, false]);
  e.tube([add(ankle, [0, 0.01, -0.02]), add(ankle, sub(toe, ankle), 0.5), toe], [0.042, 0.04, 0.028], side, SHOE, 0.35, 9, [true, true], 0.75);
}

/** Подол кафтана на коленях: полотно между бёдрами, провисает посередине и спадает за колени. */
function lap(e: Emit, hips: [P, P], knees: [P, P]): void {
  const rows: P[][] = [];
  for (const t of [0, 0.35, 0.7, 1]) {
    const a = add(hips[0], sub(knees[0], hips[0]), t);
    const b = add(hips[1], sub(knees[1], hips[1]), t);
    const row: P[] = [];
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const p = add(a, sub(b, a), u);
      const sag = Math.sin(u * Math.PI) * 0.035 * (0.4 + t);
      const edge = u === 0 || u === 1 ? 0.06 : 0.068;
      row.push([p[0], p[1] + edge - sag, p[2]]);
    }
    rows.push(row);
  }
  // За коленями подол спадает вниз; по краю — золотая кайма.
  const last = rows[rows.length - 1];
  const hem = last.map((p) => [p[0], p[1] - 0.03, p[2] + 0.035] as P);
  const fall = last.map((p) => [p[0], p[1] - 0.17, p[2] + 0.07] as P);
  e.grid(rows, ROBE, 0.04);
  e.grid([last, hem], TRIM_GOLD, 0.7);
  e.grid([hem, fall], ROBE_DARK, 0.04);
}

/** Рука убрана: все её вершины — в одну точку под ногами (раскладка та же, треугольники пустые). */
const HIDDEN: HandPose = { w: [0, -50, 0.3], f: [0, 0, 1], u: [0, 1, 0], curl: 0 };

/** Тело правителя: одна сетка на руки и ноги. */
export class Body {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array | null = null;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.name = 'chambers-body';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Поставить тело в позу; `null` — тела не видно (ходьба: руки висят вдоль тела, ниже кадра). */
  update(p: BodyPose | null, origin: THREE.Vector3): void {
    if (!p || (!p.left && !p.right && p.sit < 0.02)) {
      this.mesh.visible = false;
      return;
    }
    const e = new Emit();
    const fwd: P = [Math.sin(p.yaw), 0, Math.cos(p.yaw)];
    const rightV: P = [-Math.cos(p.yaw), 0, Math.sin(p.yaw)];
    const eye = p.eye as P;
    const chest = add(add(eye, [0, -0.27, 0]), fwd, -0.06);
    for (const right of [true, false]) {
      const h = (right ? p.right : p.left) ?? null;
      const out = scale(rightV, right ? 1 : -1);
      const s = add(chest, out, 0.19);
      // Руки нет в деле — вся её раскладка сжата под пол, ниже любого взгляда.
      if (h) arm(e, s, h, right, out);
      else arm(e, [0, -50, 0], HIDDEN, right, out);
    }
    // Ноги: стоя — под телом, сидя — бёдра вперёд над сиденьем, колени под столом.
    const k = Math.min(1, Math.max(0, p.sit));
    const seat = p.seat;
    const hips: P[] = [];
    const knees: P[] = [];
    for (const sgn of [1, -1]) {
      const o = scale(rightV, sgn * 0.1);
      const standHip = add([eye[0], 0.92, eye[2]], o);
      const sitHip = add([seat.x, seat.y + 0.08, seat.z + 0.02], o);
      const hip = mix(standHip, sitHip, k);
      const knee = mix(add(add([eye[0], 0.5, eye[2]], o), fwd, 0.03), add(add([seat.x, seat.y + 0.07, seat.z + 0.44], o, 1.12), [0, 0, 0]), k);
      const ankle = mix(add([eye[0], 0.09, eye[2]], o), add([seat.x, 0.1, seat.z + 0.5], o, 1.25), k);
      const toe = add(ankle, fwd, 0.15);
      if (k > 0.02) {
        leg(e, hip, knee, ankle, add(toe, [0, -0.05, 0], 1), rightV);
        hips.push(hip);
        knees.push(knee);
      } else {
        leg(e, [0, -50, 0], [0, -50, 0.1], [0, -50, 0.2], [0, -50, 0.3], rightV);
        hips.push([0, -50, 0]);
        knees.push([0, -50, 0.1]);
      }
    }
    lap(e, [hips[0], hips[1]], [knees[0], knees[1]]);
    this.write(e, origin);
    this.mesh.visible = true;
  }

  private write(e: Emit, origin: THREE.Vector3): void {
    const n = e.pos.length / 3;
    if (!this.pos || this.pos.length !== e.pos.length) {
      this.pos = new Float32Array(e.pos);
      const col = new Float32Array(e.col);
      const cfg = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) cfg.set([PLAIN_LAYER, 0, Math.round(e.shine[i] * 255), 0], i * 4);
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.geo.setAttribute('cuv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.geo.setAttribute('cfg', new THREE.BufferAttribute(cfg, 4));
      this.geo.setIndex(e.idx);
    } else {
      this.pos.set(e.pos);
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.geo.computeVertexNormals();
    this.mesh.position.copy(origin);
  }

  /** Треугольники тела — бюджету покоев. */
  get triangles(): number {
    return (this.geo.index?.count ?? 0) / 3;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

const mix = (a: P, b: P, k: number): P => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
