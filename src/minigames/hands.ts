/**
 * Руки промыслов: кисти в кожаных перчатках, рукава и наруч — лепка гладкими трубками (docs/minigames.md, 16.1 и 16.3).
 *
 * Одни руки на три игры: лучник «Охоты» держит ими лук и тетиву (`archer.ts`), в «Скоте» они несут охапку, в «Ягодах»
 * левая держит корзину. Модуль — в куске промыслов: «Охота» берёт его отсюда, а лук и стрела остаются её куском.
 *
 * ГЛАДКАЯ ТЕНЬ, А НЕ ГРАНИ. Мир промыслов — гранёный (`KIT.body`, `flatShading`), а кисть с гранями у самого глаза
 * читалась бы ящиком (вопрос 13). У рук свой материал — Ламберт с цветом в вершинах и гладкой нормалью (`viewMaterial`);
 * имени `three` нового нет (`prologue/post.test.ts`).
 */
import * as THREE from 'three';

/** Материал вещей у глаза: Ламберт с цветом в вершинах, гладкий. Один на вещь взгляда — разбирает её хозяин. */
export const viewMaterial = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ vertexColors: true });

/** Перчатка: дублёная кожа и тёмная — у швов и на подушечках пальцев правой (там стирается о тетиву). */
export const GLOVE = 0x7b5434;
export const GLOVE_DARK = 0x4e3220;
/** Рукав: сукно лесной зелени — цвет охотника; отворот светлее. */
export const SLEEVE = 0x4f5a34;
export const SLEEVE_TURN = 0x66704a;
/** Наруч: тёмная кожа на шнуре из сыромятины. */
export const BRACER = 0x3a2618;
export const LACE = 0xc9b28a;

// ---------- Лепка ----------

/** Цвет вершины трубки: по доле длины `u` и стороне кольца `d` (единичный вектор от оси). */
export type Tint = number | ((u: number, d: THREE.Vector3) => number);

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Лепка гладких вещей: трубки по ломаной с закруглёнными концами и эллипсоиды. Вершины кольца общие, нормали — по
 * склеенной сетке (`computeVertexNormals`): тень гладкая, швов по кольцу нет.
 */
export class Mesher {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  private vert(p: THREE.Vector3, hex: number): number {
    _c.setHex(hex);
    this.pos.push(p.x, p.y, p.z);
    this.col.push(_c.r, _c.g, _c.b);
    return this.pos.length / 3 - 1;
  }

  /**
   * Трубка по точкам `path` с радиусом `radii[i]` в каждой; кольцо — `seg` вершин, рамка — переносом без кручения.
   * `squash` — сплющенность сечения по второй оси рамки (1 — круг). Концы закрыты куполком.
   */
  tube(path: readonly THREE.Vector3[], radii: readonly number[], tint: Tint, seg = 7, squash = 1): this {
    const n = path.length;
    const rings: number[] = [];
    const color = (u: number, d: THREE.Vector3): number => (typeof tint === 'number' ? tint : tint(u, d));
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
    }
    // Первая нормаль — что угодно поперёк касательной; дальше она переносится, а не строится заново: трубка не крутится.
    _n.set(0, 1, 0);
    if (Math.abs(_n.dot(tangents[0])) > 0.9) _n.set(1, 0, 0);
    _n.addScaledVector(tangents[0], -_n.dot(tangents[0])).normalize();
    for (let i = 0; i < n; i++) {
      const tg = tangents[i];
      _n.addScaledVector(tg, -_n.dot(tg)).normalize();
      _b.crossVectors(tg, _n);
      const r = radii[i];
      const start = this.pos.length / 3;
      for (let j = 0; j < seg; j++) {
        const f = (j / seg) * Math.PI * 2;
        _d.copy(_n).multiplyScalar(Math.cos(f)).addScaledVector(_b, Math.sin(f) * squash);
        _p.copy(path[i]).addScaledVector(_d, r);
        this.vert(_p, color(i / (n - 1), _d.normalize()));
      }
      rings.push(start);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = rings[i] + j;
        const d = rings[i] + ((j + 1) % seg);
        const b = rings[i + 1] + j;
        const c = rings[i + 1] + ((j + 1) % seg);
        // Обход — наружу: у треугольника (a, b, d) нормаль смотрела бы внутрь трубки (кольцо идёт от N к B = T × N).
        this.idx.push(a, d, b, b, d, c);
      }
    }
    // Куполки: вершина на оси чуть дальше конца — закругление пальца, а не срез.
    const cap = (i: number, out: number): void => {
      _p.copy(path[i]).addScaledVector(tangents[i], out * radii[i] * 0.75);
      const tip = this.vert(_p, color(i / (n - 1), tangents[i]));
      for (let j = 0; j < seg; j++) {
        const a = rings[i] + j;
        const b = rings[i] + ((j + 1) % seg);
        if (out < 0) this.idx.push(tip, b, a);
        else this.idx.push(tip, a, b);
      }
    };
    cap(0, -1);
    cap(n - 1, 1);
    return this;
  }

  /** Эллипсоид: середина, полуоси, поворот, цвет. */
  blob(at: THREE.Vector3, radii: THREE.Vector3, rot: THREE.Euler, hex: number, w = 9, h = 6): this {
    const g = new THREE.SphereGeometry(1, w, h);
    g.scale(radii.x, radii.y, radii.z);
    g.applyMatrix4(_m.makeRotationFromEuler(rot).setPosition(at));
    const base = this.pos.length / 3;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) this.vert(_p.fromBufferAttribute(p, i), hex);
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    g.dispose();
    return this;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** Точки по дуге вокруг оси Y: радиус `r`, углы от `a0` до `a1` (0 — к запястью, +Z; π/2 — наружу, `side`·X). */
export function arc(side: number, r0: number, r1: number, y0: number, y1: number, a0: number, a1: number, n: number, z = 0): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const a = a0 + (a1 - a0) * k;
    const r = r0 + (r1 - r0) * k;
    out.push(new THREE.Vector3(side * Math.sin(a) * r, y0 + (y1 - y0) * k, Math.cos(a) * r + z));
  }
  return out;
}

export const DEG = Math.PI / 180;
export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Палец кисти: где лежит по оси хвата, его толщина и обхват — от костяшки до кончика, градусы. */
export interface Finger {
  y: number;
  r: number;
  from: number;
  to: number;
  /** Насколько кончик темнее (накладка на подушечках у тетивы). */
  tip?: boolean;
  /** Ось обхвата сдвинута к ладони — палец поджат, а не на рукояти. */
  tuck?: number;
  /** Радиус обхвата вместо `grip + r`. */
  around?: number;
}

export interface FistSpec {
  /** Наружу — в какую сторону X: левая −1, правая +1. */
  side: number;
  /** Толщина того, что держат: рукоять или тетива. */
  grip: number;
  fingers: Finger[];
  /** Большой палец — ломаная и толщины. */
  thumb: { path: THREE.Vector3[]; r: number[] };
  /** Наруч на предплечье. */
  bracer: boolean;
}

/**
 * Кисть в перчатке и предплечье в рукаве. Хват — по оси Y через начало, предплечье — по +Z к локтю. Пальцы обхватывают
 * ось дугами от костяшек снаружи через перед к ладони; пясть — эллипсоид от запястья к костяшкам.
 */
export function fist(spec: FistSpec): THREE.BufferGeometry {
  const s = spec.side;
  const m = new Mesher();
  // Пясть: от запястья к линии костяшек, тыльной стороной наружу.
  m.blob(V(s * 0.019, 0, 0.034), V(0.017, 0.042, 0.043), new THREE.Euler(0, s * 0.42, 0), GLOVE, 10, 7);
  for (const f of spec.fingers) {
    const R = f.around ?? spec.grip + f.r;
    const z = f.tuck ?? 0;
    const pts = arc(s, R + 0.006, R, f.y, f.y - 0.002, f.from * DEG, f.to * DEG, 7, z);
    const radii = pts.map((_, i) => f.r * (1 - 0.18 * (i / (pts.length - 1))));
    // Подушечки правой — темнее: там тетива стирает кожу.
    const tint: Tint = f.tip ? (u) => (u > 0.62 ? GLOVE_DARK : GLOVE) : GLOVE;
    m.tube(pts, radii, tint, 7);
  }
  m.tube(spec.thumb.path, spec.thumb.r, GLOVE, 7);
  // Запястье и раструб перчатки.
  m.tube([V(s * 0.016, 0, 0.055), V(s * 0.008, 0, 0.09), V(0, 0, 0.115)], [0.025, 0.026, 0.028], GLOVE, 9, 0.82);
  m.tube([V(0, 0, 0.105), V(0, 0, 0.13), V(0, 0, 0.152)], [0.031, 0.036, 0.04], (u) => (u > 0.7 ? GLOVE_DARK : GLOVE), 10);
  // Рукав: отворот у раструба и сукно до локтя — за край кадра.
  m.tube([V(0, 0, 0.142), V(0, 0, 0.165)], [0.043, 0.045], SLEEVE_TURN, 10);
  m.tube([V(0, 0, 0.16), V(0, 0, 0.32), V(0, 0, 0.58)], [0.042, 0.047, 0.054], SLEEVE, 10);
  if (spec.bracer) {
    // Наруч поверх рукава: кожаная накладка и три витка шнура.
    m.tube([V(0, 0, 0.175), V(0, 0, 0.25), V(0, 0, 0.33)], [0.0455, 0.0485, 0.052], BRACER, 10);
    for (const z of [0.2, 0.25, 0.3]) m.tube([V(0, 0, z - 0.003), V(0, 0, z + 0.003)], [0.049 + (z - 0.2) * 0.04, 0.049 + (z - 0.2) * 0.04], LACE, 10);
  }
  return m.geometry();
}

/**
 * Посадить кисть: ось хвата (`along` — ось рукояти, тетивы, охапки) — её +Y, предплечье (`elbow`) — её +Z, насколько они
 * перпендикулярны. Тот же разворот, что у руки предыстории (`scene.armPose`), без промежуточной вещи.
 */
export function handBasis(along: THREE.Vector3, elbow: readonly number[], out = new THREE.Quaternion()): THREE.Quaternion {
  const y = new THREE.Vector3().copy(along).normalize();
  const z = new THREE.Vector3(elbow[0], elbow[1], elbow[2]);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Кисть, поставленная на место: геометрия, сдвинутая и повёрнутая в оси хозяина. */
function placed(g: THREE.BufferGeometry, at: THREE.Vector3, q: THREE.Quaternion): THREE.BufferGeometry {
  return g.applyMatrix4(new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1)));
}

/** Кисть, держащая толстое снизу: пальцы обхватывают охапку или ручку корзины на полкруга. */
function under(side: number, grip: number): THREE.BufferGeometry {
  return fist({
    side,
    grip,
    fingers: [
      { y: 0.027, r: 0.0094, from: 100, to: 225 },
      { y: 0.0085, r: 0.0098, from: 98, to: 230 },
      { y: -0.0098, r: 0.0094, from: 100, to: 226 },
      { y: -0.0272, r: 0.0081, from: 104, to: 218 },
    ],
    thumb: {
      path: [V(-side * 0.012, 0.016, 0.05), V(-side * 0.022, 0.032, 0.03), V(-side * 0.026, 0.04, 0.008)],
      r: [0.0125, 0.011, 0.0095],
    },
    bracer: false,
  });
}

/**
 * Руки с охапкой: обе снизу у краёв охапки, ладонями вверх, предплечья — к нижним углам кадра. Оси — охапки (`armful`,
 * до её уменьшения): ширина охапки по X, середина — в нуле.
 */
export function armfulArms(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const q = handBasis(new THREE.Vector3(1, 0, 0), [side * 0.45, -0.62, 0.64]);
    parts.push(placed(under(1, 0.055), new THREE.Vector3(side * 0.17, -0.07, 0.03), q));
  }
  return merge(parts);
}

/** Склеить кисти в один меш — один вызов отрисовки. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    pos.push(...(g.attributes.position.array as Float32Array));
    col.push(...(g.attributes.color.array as Float32Array));
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** Корзина: лыко плетёнкой — светлые и тёмные ряды, обод и дужка. Дно в нуле, дужка — по X над корзиной. */
export const BASKET = { bottom: 0.085, top: 0.115, h: 0.12, handle: 0.11 } as const;
const BAST = 0xb48a52;
const BAST_DARK = 0x8a6436;

export function basketGeometry(): THREE.BufferGeometry {
  const m = new Mesher();
  const rows = 6;
  for (let k = 0; k < rows; k++) {
    const y0 = (k / rows) * BASKET.h;
    const y1 = ((k + 1) / rows) * BASKET.h;
    const r = (y: number): number => BASKET.bottom + (BASKET.top - BASKET.bottom) * (y / BASKET.h);
    // Ряд плетёнки: кольцо-трубка по кругу — светлый и тёмный через один.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const y = (y0 + y1) / 2;
      pts.push(V(Math.cos(a) * r(y), y, Math.sin(a) * r(y)));
    }
    m.tube(pts, pts.map(() => (y1 - y0) * 0.62), k % 2 ? BAST_DARK : BAST, 5);
  }
  // Дно и обод.
  m.blob(V(0, 0.006, 0), V(BASKET.bottom, 0.008, BASKET.bottom), new THREE.Euler(), BAST_DARK, 12, 3);
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    rim.push(V(Math.cos(a) * BASKET.top, BASKET.h, Math.sin(a) * BASKET.top));
  }
  m.tube(rim, rim.map(() => 0.009), BAST_DARK, 6);
  // Дужка — дугой над корзиной по X.
  const arcPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    arcPts.push(V(Math.cos(a) * BASKET.top * 0.95, BASKET.h + Math.sin(a) * BASKET.handle, 0));
  }
  m.tube(arcPts, arcPts.map(() => 0.0085), BAST, 6);
  return m.geometry();
}

/**
 * Левая на дужке корзины — у её левого края, над ободом: середина корзины открыта, видно, сколько в ней. Предплечье —
 * к левому нижнему углу. Оси — корзины.
 */
export function basketHand(): THREE.BufferGeometry {
  const a = Math.PI * 0.8;
  const at = new THREE.Vector3(Math.cos(a) * BASKET.top * 0.95, BASKET.h + Math.sin(a) * BASKET.handle, 0);
  // Ось хвата — касательная к дужке в этом месте.
  const along = new THREE.Vector3(-Math.sin(a), Math.cos(a) * (BASKET.handle / BASKET.top), 0);
  const q = handBasis(along, [-0.7, -0.45, 0.55]);
  return placed(under(-1, 0.0095), at, q);
}

/** Сколько ягод в полной горке корзины: копии одного меша — один вызов отрисовки. */
export const HEAP = 54;

/**
 * Горка ягод в корзине: места ягод слоями от дна — нижний слой во всю ширину, выше — уже, к макушке. Ягода `i` ложится
 * `i`-й: со счётом корзина наполняется снизу вверх. Без случая — золотой угол по кругу.
 */
export function heapSpots(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < HEAP; i++) {
    const k = i / HEAP;
    const y = BASKET.h * (0.2 + 0.85 * k);
    const room = (BASKET.bottom + (BASKET.top - BASKET.bottom) * Math.min(1, y / BASKET.h)) * (0.85 - 0.75 * k * k);
    const r = room * Math.sqrt(((i * 7) % 11) / 11 + 0.08);
    out.push(V(Math.cos(i * golden) * r, y, Math.sin(i * golden) * r));
  }
  return out;
}
