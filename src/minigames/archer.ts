/**
 * Лучник от первого лица: лук, руки в перчатках, рукава и стрела на тетиве (docs/minigames.md, раздел 16).
 *
 * ВСЁ ЗДЕСЬ — ВЕЩЬ ВЗГЛЯДА, А НЕ МИРА. Риг висит на камере и считается в её осях: лук — где держит левая, тетива — где
 * тянет правая, рука — куда уходит предплечье. Правило охоты (`hunt.ts`) о руках не знает ничего: оно говорит, тянут ли
 * тетиву, насколько натянута, когда пущена последняя стрела и есть ли следующая, — а риг из этого рисует жест.
 *
 * ЖЕСТ ИГРОКА — БЕЗ ЗАДЕРЖКИ. Палец лёг — лук вскидывается и тетива идёт за правой рукой; держишь долго — руки начинают
 * дрожать, и прицел гуляет вместе с ними (`Archer.sway`: камера, а значит и стрела); отпустил — тетива бьёт вперёд и
 * дрожит, лук кивает, правая уходит назад за ухо, тянется к колчану у бедра, приносит новую стрелу и накладывает её
 * ровно за то время, что правило даёт на наложение (`hunt.NOCK_S`).
 *
 * ПОЧЕМУ НЕ РУКИ ПРЕДЫСТОРИИ. Её рука (`prologue/people.arm`) — кулак призмой на атласе рукава, испечённом сценой поляны;
 * у костра она с полуметра, здесь — на вытянутой руке поперёк кадра, и призма читалась бы культёй. Здесь кисть лепится
 * пальцами: четыре пальца обхватывают рукоять, большой лежит поверх, три пальца правой крюком держат тетиву — средиземный
 * хват, как стреляли в позднее средневековье. Перчатки кожаные, на левом предплечье — наруч на шнуровке поверх рукава.
 *
 * ГЛАДКАЯ ТЕНЬ, А НЕ ГРАНИ. Мир промыслов — гранёный (`KIT.body`, `flatShading`), а кисть с гранями у самого глаза
 * читалась бы ящиком (вопрос 13). У рига свой материал — тот же Ламберт с цветом в вершинах, но с гладкой нормалью;
 * имени `three` нового нет (`prologue/post.test.ts`).
 *
 * ЦЕНА. Лук, обе руки и стрела на тетиве — один меш на вещь и один материал: четыре вызова, тетива — пятый (она
 * движется и перекладывается каждый кадр — шестнадцать вершин). Тени риг не отбрасывает: тень руки у глаза на траве за
 * десять метров — неправда.
 */
import * as THREE from 'three';

// ---------- Цвета: кожа, сукно, тис ----------

/** Перчатка: дублёная кожа и тёмная — у швов и на подушечках пальцев правой (там стирается о тетиву). */
const GLOVE = 0x7b5434;
const GLOVE_DARK = 0x4e3220;
/** Рукав: сукно лесной зелени — цвет охотника; отворот светлее. */
const SLEEVE = 0x4f5a34;
const SLEEVE_TURN = 0x66704a;
/** Наруч: тёмная кожа на шнуре из сыромятины. */
const BRACER = 0x3a2618;
const LACE = 0xc9b28a;
/** Тис: заболонь светлая — на спинке лука, ядро красное — на брюшке к стрелку. Рукоять — в коже. */
const SAPWOOD = 0xd9bb8a;
const HEARTWOOD = 0x8a4524;
const GRIP = 0x3f2a1c;
const HORN = 0xe0d4ba;
/** Тетива — льняная, вощёная. */
const STRING = 0xe6dcc0;
/** Стрела: ясень, наконечник железный, перья серые и одно — красное, «петушиное»: по нему кладут стрелу на тетиву. */
const SHAFT = 0xb48c55;
const IRON = 0x55595c;
const FEATHER = 0x9c968c;
const COCK = 0xa3352a;
const NOCK_BAND = 0x2b2420;

// ---------- Лук ----------

/** Радиус дуги и раствор лука, м и рад: тетива — хорда, концы плеч — `BOW_TIP`. */
export const BOW_R = 0.31;
export const BOW_SPAN = 2.1;
/** Концы плеч в осях лука: плечи в плоскости YZ, тетива — к стрелку (+Z). */
export const BOW_TIP = { y: Math.sin(BOW_SPAN / 2) * BOW_R, z: BOW_R * (1 - Math.cos(BOW_SPAN / 2)) };
/** На сколько тетива уходит к стрелку в полную натяжку, м: хвост стрелы — у скулы. */
export const PULL = 0.27;
/** Стрела: длина от хвоста до острия, м. */
export const ARROW_LEN = 0.62;
/** Рукоять — полуширина обмотки по дуге, рад, и толщина. */
const GRIP_HALF = 0.16;
const GRIP_R = 0.0135;

// ---------- Позы ----------

/** Поза лука в осях камеры: где рукоять (`at`), куда смотрит его +Z (к стрелку) и наклон верхнего плеча влево. */
export interface BowPose {
  at: readonly [number, number, number];
  back: readonly [number, number, number];
  cant: number;
}

/**
 * Вскинутый: рукоять чуть левее и ниже прицела, стрела идёт от скулы справа снизу к луку и смотрит в середину. Верхнее
 * плечо завалено влево — цель справа от него открыта.
 */
export const BOW_AIM: BowPose = { at: [-0.07, -0.085, -0.66], back: [0.36, -0.2, 0.91], cant: 0.22 };
/** Опущенный: в левой у бедра, наискось через низ кадра — верхнее плечо влево, тетива со стрелой смотрят вверх, к глазу. */
export const BOW_REST: BowPose = { at: [-0.13, -0.35, -0.6], back: [0.22, 0.62, 0.75], cant: 1.05 };

/** Правая в покое — отпустила тетиву и опущена у правого бедра: из кадра виден край перчатки. */
export const HAND_REST = [0.2, -0.47, -0.36] as const;

/** Куда от кисти уходит предплечье, в осях камеры: левая — к левому нижнему краю, правая — к правому, локоть поднят. */
export const ELBOW = {
  bowAim: [-0.36, -0.52, 0.78],
  bowRest: [-0.55, -0.7, 0.45],
  drawAim: [0.8, -0.12, 0.6],
  drawRest: [0.5, -0.66, 0.56],
} as const;

/** Колчан у правого бедра: туда тянется рука за стрелой — за краем кадра, в осях камеры. */
export const QUIVER = [0.34, -0.66, -0.06] as const;

/**
 * Наложение после выстрела, доли `NOCK_S` правила: проводка, рука у колчана, стрела у тетивы. В сумме — ровно столько,
 * сколько правило даёт на наложение: новая стрела ложится на тетиву тогда же, когда её можно тянуть.
 */
export const RELOAD = { follow: 0.16, reach: 0.48, back: 0.84 } as const;

/** Дрожь: сколько держится полная натяжка без неё, с; за сколько дрожь набирает силу; размах взгляда и рук. */
export const HOLD_CALM = 2.5;
export const HOLD_RAMP = 3;
/** Размах прицела в полную дрожь, рад: 0.35° — на тридцати метрах стрела гуляет на корпус оленя. */
export const SWAY = 0.006;
/** Размах дрожи рук, м. */
const SHAKE = 0.0028;
/** Отдача: на сколько кивает лук и как быстро гаснет; толчок взгляда. */
const KICK = 0.17;
const KICK_S = 0.14;
const BUMP = 0.008;
/** Тетива после выстрела: размах, частота и затухание. */
const TWANG = 0.022;
const TWANG_HZ = 21;
const TWANG_S = 0.09;

const smooth = (k: number): number => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

/** Плавная ступенька: 0 до `a`, 1 после `b`. */
export const stepIn = (x: number, a: number, b: number): number => smooth((x - a) / (b - a));

/** Сила дрожи после стольких секунд в полной натяжке, 0..1: до `HOLD_CALM` — ноль. */
export const tremorOf = (hold: number): number => stepIn(hold, HOLD_CALM, HOLD_CALM + HOLD_RAMP);

/**
 * Гуляние прицела: сумма синусов несоизмеримых частот — медленный увод, дыхание и мелкая дрожь мышцы. Без случая:
 * у дрожи нет зерна, она — функция времени (`Math.random` в игре нет нигде). Размах — не больше единицы.
 */
export function wander(t: number, k: number): number {
  return 0.55 * Math.sin(t * 2.1 + k) + 0.3 * Math.sin(t * 5.3 + 2 * k + 1) + 0.15 * Math.sin(t * 11.7 + 3 * k + 2);
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Поворот из «куда к стрелку» и наклона: верх лука — вверх кадра, повёрнутый вокруг +Z на `cant`. */
export function bowQuat(back: readonly number[], cant: number, out = new THREE.Quaternion()): THREE.Quaternion {
  _z.set(back[0], back[1], back[2]).normalize();
  _y.set(-Math.sin(cant), Math.cos(cant), 0);
  _y.addScaledVector(_z, -_y.dot(_z)).normalize();
  _x.crossVectors(_y, _z).normalize();
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/**
 * Посадить кисть: ось хвата (`along` — ось рукояти или тетивы) — её +Y, предплечье (`elbow`, к краю кадра) — её +Z,
 * насколько они перпендикулярны. Тот же разворот, что у руки предыстории (`scene.armPose`), без промежуточной вещи.
 */
export function handQuat(along: THREE.Vector3, elbow: readonly number[], out = new THREE.Quaternion()): THREE.Quaternion {
  _y.copy(along).normalize();
  _z.set(elbow[0], elbow[1], elbow[2]);
  _z.addScaledVector(_y, -_z.dot(_y)).normalize();
  _x.crossVectors(_y, _z).normalize();
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

// ---------- Лепка ----------

/** Цвет вершины трубки: по доле длины `u` и стороне кольца `d` (единичный вектор от оси). */
type Tint = number | ((u: number, d: THREE.Vector3) => number);

const _c = new THREE.Color();
const _t = new THREE.Vector3();
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
function arc(side: number, r0: number, r1: number, y0: number, y1: number, a0: number, a1: number, n: number, z = 0): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const a = a0 + (a1 - a0) * k;
    const r = r0 + (r1 - r0) * k;
    out.push(new THREE.Vector3(side * Math.sin(a) * r, y0 + (y1 - y0) * k, Math.cos(a) * r + z));
  }
  return out;
}

const DEG = Math.PI / 180;
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Палец кисти: где лежит по оси хвата, его толщина и обхват — от костяшки до кончика, градусы. */
interface Finger {
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

interface FistSpec {
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
function fist(spec: FistSpec): THREE.BufferGeometry {
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

/** Левая на рукояти: четыре пальца обхватывают её почти кругом, большой — поверх указательного. */
export function bowHand(): THREE.BufferGeometry {
  const s = -1;
  return fist({
    side: s,
    grip: GRIP_R + 0.001,
    fingers: [
      { y: 0.027, r: 0.0094, from: 112, to: 318 },
      { y: 0.0085, r: 0.0098, from: 108, to: 322 },
      { y: -0.0098, r: 0.0094, from: 110, to: 318 },
      { y: -0.0272, r: 0.0081, from: 116, to: 306 },
    ],
    thumb: {
      path: [V(-s * 0.012, 0.016, 0.05), V(-s * 0.02, 0.03, 0.026), V(-s * 0.021, 0.037, 0.002), V(-s * 0.012, 0.039, -0.018), V(s * 0.002, 0.038, -0.026)],
      r: [0.0125, 0.011, 0.0102, 0.0094, 0.0085],
    },
    bracer: true,
  });
}

/**
 * Правая на тетиве — средиземный хват: указательный над стрелой, средний и безымянный под ней крюком, мизинец поджат,
 * большой вдоль ладони вниз. Тетива — ось Y через начало, стрела выходит вперёд (−Z) между указательным и средним.
 */
export function drawHand(): THREE.BufferGeometry {
  const s = 1;
  return fist({
    side: s,
    grip: 0.003,
    fingers: [
      { y: 0.0135, r: 0.0092, from: 96, to: 262, tip: true },
      { y: -0.0085, r: 0.0096, from: 96, to: 266, tip: true },
      { y: -0.0265, r: 0.0091, from: 100, to: 262, tip: true },
      { y: -0.0425, r: 0.0078, from: 108, to: 300, tuck: 0.014, around: 0.011 },
    ],
    thumb: {
      path: [V(-s * 0.01, -0.012, 0.055), V(-s * 0.018, -0.026, 0.034), V(-s * 0.017, -0.036, 0.014), V(-s * 0.01, -0.041, 0.0)],
      r: [0.012, 0.0105, 0.0095, 0.0086],
    },
    bracer: false,
  });
}

/**
 * Лук: тисовая дуга с плечами на конус, рукоять в коже и роговые наконечники. Плечи — в плоскости YZ, концы — к
 * стрелку; спинка (от стрелка) — светлая заболонь, брюшко — красное ядро: так выглядит настоящий тисовый лук.
 */
export function bowGeometry(): THREE.BufferGeometry {
  const m = new Mesher();
  const n = 25;
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = -BOW_SPAN / 2 + (BOW_SPAN * i) / (n - 1);
    path.push(V(0, Math.sin(a) * BOW_R, BOW_R * (1 - Math.cos(a))));
    const off = Math.abs(a) / (BOW_SPAN / 2);
    radii.push(Math.abs(a) < GRIP_HALF ? GRIP_R : 0.0112 * (1 - 0.5 * off * off));
  }
  const tint = (u: number, d: THREE.Vector3): number => {
    const a = Math.abs(-BOW_SPAN / 2 + BOW_SPAN * u);
    if (a < GRIP_HALF) return a > GRIP_HALF - 0.02 ? HORN : GRIP;
    // Брюшко смотрит к стрелку: в осях лука это +Z — и вглубь дуги.
    return d.z > 0.2 ? HEARTWOOD : SAPWOOD;
  };
  m.tube(path, radii, tint, 7, 0.85);
  // Роговые наконечники с зарубкой под тетиву.
  for (const k of [-1, 1]) {
    const a = k * BOW_SPAN * 0.5;
    const tip = V(0, Math.sin(a) * BOW_R, BOW_R * (1 - Math.cos(a)));
    const dir = V(0, Math.cos(a) * k, Math.sin(a) * k);
    m.tube([tip.clone().addScaledVector(dir, -0.018), tip.clone().addScaledVector(dir, 0.012)], [0.0068, 0.004], HORN, 6);
  }
  // Полочка для стрелы — бугорок слева над кулаком.
  m.blob(V(-0.012, GRIP_HALF * BOW_R + 0.004, 0.0), V(0.006, 0.005, 0.009), new THREE.Euler(), GRIP, 6, 4);
  return m.geometry();
}

/** Стрела у глаза: древко, гранёный бронебойный наконечник, три пера и тёмный хвост. Лежит вдоль −Z, хвост — в нуле. */
export function arrowGeometry(): THREE.BufferGeometry {
  const m = new Mesher();
  m.tube([V(0, 0, -0.004), V(0, 0, -ARROW_LEN + 0.03)], [0.0042, 0.0042], (u) => (u < 0.03 ? NOCK_BAND : SHAFT), 6);
  m.tube([V(0, 0, -ARROW_LEN + 0.04), V(0, 0, -ARROW_LEN + 0.012), V(0, 0, -ARROW_LEN - 0.03)], [0.0052, 0.0068, 0.0006], IRON, 4);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    // Перо — плоский клин по древку: широкое у хвоста, на нет к древку.
    const path = [V(ox * 0.006, oy * 0.006, -0.024), V(ox * 0.011, oy * 0.011, -0.05), V(ox * 0.01, oy * 0.01, -0.09), V(ox * 0.005, oy * 0.005, -0.12)];
    m.tube(path, [0.002, 0.0052, 0.0048, 0.0012], k === 0 ? COCK : FEATHER, 4, 0.22);
  }
  return m.geometry();
}

/** Тетива двумя плечами: шестнадцать вершин, которые риг перекладывает каждый кадр (`Archer.string`). */
function stringGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(16 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new Float32Array(16 * 3);
  _c.setHex(STRING);
  for (let i = 0; i < 16; i++) col.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('position', pos);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx: number[] = [];
  for (const base of [0, 8]) {
    for (let j = 0; j < 4; j++) {
      const a = base + j;
      const d = base + ((j + 1) % 4);
      const b = base + 4 + j;
      const c = base + 4 + ((j + 1) % 4);
      idx.push(a, d, b, b, d, c);
    }
  }
  g.setIndex(idx);
  return g;
}

// ---------- Риг ----------

/** Что риг знает о луке в этот кадр — из правила охоты и жеста. */
export interface ArcherInput {
  /** Секунды сцены: часы дрожи и дыхания. */
  now: number;
  dt: number;
  /** Тянут ли тетиву. */
  pulling: boolean;
  /** Насколько натянута по правилу, 0..1. */
  drawn: number;
  /** Сколько стрел в колчане. */
  quiver: number;
  /** Сколько секунд игры с последнего выстрела; выстрела не было — `null`. */
  sinceLoose: number | null;
  /** Сколько длится наложение по правилу, с. */
  nockS: number;
  /** Идёт ли человек, 0..1. */
  walking: number;
  /** На сколько повернулся взгляд за кадр, рад: риг отстаёт от него — вещь в руке весит. */
  turn: { yaw: number; pitch: number };
}

/** Где правая рука и что в ней в этот кадр — тесту и сцене. */
export interface ArcherState {
  /** Правая: на тетиве (`string`), уходит после выстрела (`follow`), у колчана (`quiver`), несёт стрелу (`return`). */
  hand: 'string' | 'follow' | 'quiver' | 'return' | 'low';
  /** Стрела видна и где: на тетиве, в руке или нет её. */
  arrow: 'nocked' | 'held' | 'none';
  /** Сила дрожи, 0..1. */
  tremor: number;
}

const _g = new THREE.Vector3();
const _a = new THREE.Vector3();
const _h = new THREE.Vector3();
const _k = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _kq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _e = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _ar = new THREE.Vector3();

const lerp3 = (a: readonly number[], b: readonly number[], k: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);

/**
 * Риг лучника: лук, две руки, тетива и стрела на ней — в осях камеры. Каждый кадр — `update` по правилу и жесту; отдаёт
 * поправку взгляда (`sway`): дрожь натянутого лука и толчок отдачи. Её прибавляет к камере сцена — стрела летит туда,
 * куда смотрит камера, и прицел гуляет по-настоящему, а не на картинке.
 */
export class Archer {
  readonly root = new THREE.Group();
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private bow: THREE.Mesh;
  private left: THREE.Mesh;
  private right: THREE.Mesh;
  private arrow: THREE.Mesh;
  private cord: THREE.Mesh;
  private raise = 0;
  private drawShown = 0;
  private hold = 0;
  private lastSince: number | null = null;
  /** Миг выстрела по часам рига и с какой натяжкой. */
  private looseAt = -1;
  private looseDraw = 0;
  /** Где была правая в миг выстрела — от неё проводка. */
  private looseHand = new THREE.Vector3();
  private stride = 0;
  private lag = { x: 0, y: 0 };
  /** Насколько правая отпустила тетиву и ушла к бедру, 0..1: тянут — сразу к тетиве, не тянут — не спеша вниз. */
  private relax = 1;
  readonly sway = { yaw: 0, pitch: 0 };
  readonly state: ArcherState = { hand: 'string', arrow: 'nocked', tremor: 0 };
  /** Где правая рука сейчас, в осях камеры — тесту. */
  readonly hand = new THREE.Vector3();
  /** Где хвост стрелы на тетиве сейчас, в осях камеры — тесту. */
  readonly nock = new THREE.Vector3();

  constructor() {
    const mesh = (g: THREE.BufferGeometry, name: string): THREE.Mesh => {
      const m = new THREE.Mesh(g, this.material);
      m.name = name;
      m.castShadow = false;
      m.receiveShadow = true;
      // Вещь взгляда: у глаза, всегда в кадре — отсекать по взгляду нечего.
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.root.add(m);
      return m;
    };
    this.bow = mesh(bowGeometry(), 'bow');
    this.left = mesh(bowHand(), 'bowHand');
    this.right = mesh(drawHand(), 'drawHand');
    this.arrow = mesh(arrowGeometry(), 'nockArrow');
    this.cord = mesh(stringGeometry(), 'string');
    this.cord.receiveShadow = false;
    this.root.name = 'archer';
  }

  /** Насколько натянут лук на картинке, 0..1: приближение взгляда идёт за ним, а не за правилом рывком. */
  get shown(): number {
    return this.drawShown;
  }

  update(i: ArcherInput): void {
    const dt = Math.min(0.05, Math.max(0, i.dt));
    // Новый выстрел — «с последнего выстрела» стало меньше, чем было: тетива бьёт вперёд, правая уходит за ухо.
    if (i.sinceLoose !== null && (this.lastSince === null || i.sinceLoose < this.lastSince)) {
      this.looseAt = i.now - i.sinceLoose;
      this.looseDraw = Math.max(this.drawShown, 0.25);
      this.looseHand.copy(this.hand);
      this.drawShown = 0;
      this.hold = 0;
    }
    this.lastSince = i.sinceLoose;
    const reloading = i.sinceLoose !== null && i.sinceLoose < i.nockS;
    const loaded = i.quiver > 0;
    // Лук вскидывается быстро, опускается не спеша; пока накладывают стрелу с прижатым пальцем — остаётся вскинутым.
    const up = i.pulling ? 1 : 0;
    this.raise += (up - this.raise) * Math.min(1, dt * (i.pulling ? 11 : 4.5));
    // Тетива идёт за правилом без запаздывания: жест — сразу в руке.
    this.drawShown += (i.drawn - this.drawShown) * Math.min(1, dt * 22);
    // Дрожь: копится, пока натянуто до конца; ослабил — прошла.
    this.hold = i.pulling && i.drawn >= 0.999 ? this.hold + dt : 0;
    const tremor = tremorOf(this.hold);
    this.state.tremor = tremor;
    const since = i.now - this.looseAt;
    // Отдача: лук кивает верхним плечом вперёд и отскакивает к себе — экспонента после короткого толчка.
    const kickK = this.looseAt >= 0 ? this.looseDraw * (1 - Math.exp(-since / 0.018)) * Math.exp(-since / KICK_S) : 0;
    this.sway.yaw = tremor * SWAY * wander(i.now, 0);
    this.sway.pitch = tremor * SWAY * wander(i.now * 0.87, 1.7) + BUMP * kickK;

    // Поза лука: между опущенным и вскинутым.
    const k = smooth(this.raise);
    lerp3(BOW_REST.at, BOW_AIM.at, k, _g);
    bowQuat(BOW_REST.back, BOW_REST.cant, _bq);
    bowQuat(BOW_AIM.back, BOW_AIM.cant, _rq);
    _bq.slerp(_rq, k);
    // Шаг и дыхание — вещь качается в руках; взгляд повернулся — риг на миг отстаёт.
    this.stride += dt * 9 * i.walking;
    const breathe = Math.sin(i.now * 1.7) * 0.0018 * (1 - 0.7 * k);
    this.lag.x += (-i.turn.yaw * 0.9 - this.lag.x) * Math.min(1, dt * 10);
    this.lag.y += (i.turn.pitch * 0.9 - this.lag.y) * Math.min(1, dt * 10);
    const lagX = THREE.MathUtils.clamp(this.lag.x, -0.03, 0.03);
    const lagY = THREE.MathUtils.clamp(this.lag.y, -0.03, 0.03);
    _g.x += Math.sin(this.stride * 0.5) * 0.008 * i.walking + lagX;
    _g.y += -Math.abs(Math.sin(this.stride * 0.5)) * 0.012 * i.walking + breathe + lagY;
    // Дрожь мышцы — мелко и часто.
    _g.x += tremor * SHAKE * Math.sin(i.now * 61 + 0.4);
    _g.y += tremor * SHAKE * Math.sin(i.now * 53 + 1.9);
    // Кивок отдачи: вокруг оси X лука, верх — вперёд.
    _axis.set(1, 0, 0).applyQuaternion(_bq);
    _kq.setFromAxisAngle(_axis, -KICK * kickK);
    _bq.premultiply(_kq);
    _bx.set(1, 0, 0).applyQuaternion(_bq);
    _by.set(0, 1, 0).applyQuaternion(_bq);
    _bz.set(0, 0, 1).applyQuaternion(_bq);
    _g.addScaledVector(_bz, 0.012 * kickK);
    this.bow.position.copy(_g);
    this.bow.quaternion.copy(_bq);

    // Левая — на рукояти, предплечье к левому краю.
    lerp3(ELBOW.bowRest, ELBOW.bowAim, k, _e);
    this.left.position.copy(_g);
    this.left.quaternion.copy(handQuat(_by, [_e.x, _e.y, _e.z], _hq));

    // Тетива: хвост стрелы — на оси лука позади рукояти, на сколько натянута; после выстрела дрожит.
    const twang = since >= 0 && since < 0.5 ? this.looseDraw * TWANG * Math.exp(-since / TWANG_S) * Math.sin(since * TWANG_HZ * Math.PI * 2) : 0;
    const back = BOW_TIP.z + PULL * this.drawShown + twang;
    this.nock.copy(_g).addScaledVector(_bz, back);

    // Правая: на тетиве — или проводка, колчан и возврат со стрелой.
    lerp3(ELBOW.drawRest, ELBOW.drawAim, k, _e);
    let hand: ArcherState['hand'] = 'string';
    let arrow: ArcherState['arrow'] = loaded ? 'nocked' : 'none';
    // Тянут или накладывают — правая на тетиве; иначе отпускает её и опускается к бедру.
    const hold = i.pulling || reloading;
    this.relax = hold ? Math.max(0, this.relax - dt * 14) : Math.min(1, this.relax + dt * 2.2);
    _h.copy(this.nock).lerp(_a.set(HAND_REST[0], HAND_REST[1], HAND_REST[2]), smooth(this.relax));
    if (this.relax > 0.5 && !reloading) hand = 'low';
    if (reloading || !loaded) {
      const u = reloading ? (i.sinceLoose ?? 0) / i.nockS : 1;
      // Проводка: от тетивы назад и вправо — к уху.
      _k.copy(this.looseHand).addScaledVector(_bz, 0.05).addScaledVector(_bx, 0.03);
      _a.set(QUIVER[0], QUIVER[1], QUIVER[2]);
      if (u < RELOAD.follow) {
        hand = 'follow';
        _h.copy(this.looseHand).lerp(_k, smooth(u / RELOAD.follow));
        arrow = 'none';
      } else if (u < RELOAD.reach || !loaded) {
        hand = loaded ? 'quiver' : 'low';
        _h.copy(_k).lerp(_a, smooth((u - RELOAD.follow) / (RELOAD.reach - RELOAD.follow)));
        arrow = 'none';
      } else if (u < RELOAD.back) {
        hand = 'return';
        _h.copy(_a).lerp(this.nock, smooth((u - RELOAD.reach) / (RELOAD.back - RELOAD.reach)));
        arrow = 'held';
      } else {
        hand = 'string';
        arrow = 'nocked';
      }
    }
    _h.x += tremor * SHAKE * 1.4 * Math.sin(i.now * 47 + 2.3);
    _h.y += tremor * SHAKE * 1.4 * Math.sin(i.now * 57 + 0.7);
    this.hand.copy(_h);
    this.right.position.copy(_h);
    this.right.quaternion.copy(handQuat(_by, [_e.x, _e.y, _e.z], _hq));
    this.state.hand = hand;
    this.state.arrow = arrow;

    // Стрела: на тетиве — хвостом в зарубке, остриём вдоль лука; в руке — хвостом в пальцах.
    this.arrow.visible = arrow !== 'none';
    if (arrow !== 'none') {
      _ar.copy(arrow === 'held' ? _h : this.nock);
      this.arrow.position.copy(_ar);
      this.arrow.quaternion.copy(_bq);
    }
    this.string(_g, _by, _bz);
  }

  /** Тетива: от концов плеч к хвосту стрелы — две призмы, переложенные по месту. */
  private string(at: THREE.Vector3, by: THREE.Vector3, bz: THREE.Vector3): void {
    const pos = this.cord.geometry.attributes.position as THREE.BufferAttribute;
    const top = _a.copy(at).addScaledVector(by, BOW_TIP.y).addScaledVector(bz, BOW_TIP.z);
    const bot = _k.copy(at).addScaledVector(by, -BOW_TIP.y).addScaledVector(bz, BOW_TIP.z);
    // Тетива — в осях камеры, а риг висит на ней же: прибавлять позу лука не нужно.
    const r = 0.0022;
    const put = (base: number, a: THREE.Vector3, b: THREE.Vector3): void => {
      _t.subVectors(b, a).normalize();
      _n.crossVectors(_t, bz).normalize();
      _b.crossVectors(_t, _n);
      for (let j = 0; j < 4; j++) {
        const f = (j / 4) * Math.PI * 2;
        _d.copy(_n).multiplyScalar(Math.cos(f) * r).addScaledVector(_b, Math.sin(f) * r);
        pos.setXYZ(base + j, a.x + _d.x, a.y + _d.y, a.z + _d.z);
        pos.setXYZ(base + 4 + j, b.x + _d.x, b.y + _d.y, b.z + _d.z);
      }
    };
    put(0, top, this.nock);
    put(8, this.nock, bot);
    pos.needsUpdate = true;
    this.cord.geometry.computeVertexNormals();
  }

  dispose(): void {
    for (const m of [this.bow, this.left, this.right, this.arrow, this.cord]) m.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
