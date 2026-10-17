/**
 * Звери промыслов по породам: овца, ягнёнок, коза, корова, олень и оленуха (docs/polish.md, П-4).
 *
 * Лепка — `fauna.Sculpt`: тело, шея и голова — трубки сечений, ноги — трубки с суставами, уши, рога и хвост —
 * свои. Силуэт у каждой породы свой и читается с края загона: овца — облако руна на чёрных ножках с чёрной мордой;
 * коза — поджарая, рога назад, борода и хвост торчком; корова — тяжёлый короб с подгрудком, пятнами и кистью хвоста;
 * олень — высокие тонкие ноги, длинная шея, большие уши, белое зеркало под хвостом и рога у рогача.
 *
 * Кости у всех одни (`BONES`): тело, шея, голова, челюсть, уши, хвост и по две на ногу. Позы — ходьба кругом из шести,
 * бег (рысь у скота, скачок у оленя и ягнёнка), лёжка двумя ступенями передом и задом, падение — запекаются в морфы
 * (`fauna.bake`); голова, шея и хвост поворачиваются точными поворотами.
 *
 * ЧИСЛА ОЛЕНЯ — ОТ ПРАВИЛА ОХОТЫ, А НЕ НАОБОРОТ. Туловище лежит в эллипсоиде попадания (`hunt.DEER_BODY`), шея
 * ходит вокруг оси правила (`hunt.DEER_NECK`), голова — там, где шары попадания (`hunt.DEER_HEAD`). Держит это тест.
 */
import * as THREE from 'three';
import { DEER_BODY, DEER_NECK } from './hunt';
import { Rig, Sculpt, bake, blend, morphed, placeBeast, rigid, smooth, smoothRings, type Baked, type BoneDef, type Channel, type Moves, type Pose, type Ring, type Skin } from './fauna';

export type Kind = 'sheep' | 'lamb' | 'goat' | 'cow' | 'stag' | 'doe';
/** Подробность лепки: `hi` — вблизи и на настольном, `lo` — олени вдали и пол телефона. */
export type Detail = 'hi' | 'lo';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Кости четвероногого: номера одни у всех пород. Левая сторона — +X (зверь смотрит вдоль +Z). */
export const BONE = { body: 0, neck: 1, head: 2, jaw: 3, earL: 4, earR: 5, tail: 6, fl: 7, flk: 8, fr: 9, frk: 10, bl: 11, blk: 12, br: 13, brk: 14 } as const;

// ---------- Шум и цвет ----------

const h3 = (x: number, y: number, z: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Плавный шум 0..1 в точке — клоки руна, пятна коровы. Чистая функция: без случая. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), u), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), u), v),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), u), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

/** Смесь двух цветов sRGB долей `t`. */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Цвет по стороне кольца: спина (`a` = 0), бока, брюхо (`a` = π). */
const byAngle = (back: number, flank: number, belly: number) => (a: number): number => {
  const c = Math.cos(a);
  return c > 0 ? mix(flank, back, smooth(0.2, 0.9, c)) : mix(flank, belly, smooth(0.25, 0.85, -c));
};

// ---------- Ноги ----------

/** Нога сверху вниз: точки [y, z, радиус] в осях модели; `joint` — номер точки сустава (колено, скакательный). */
interface Leg {
  pts: readonly (readonly [number, number, number])[];
  joint: number;
}

/** Нога трубкой: выше сустава — верхняя кость, ниже — нижняя, у сустава — обе. Цвет — по высоте. */
function leg(s: Sculpt, x: number, l: Leg, upper: number, lower: number, color: (y: number) => number, seg: number, flat = 1): void {
  const path = l.pts.map(([y, z]) => V(x, y, z));
  const radii = l.pts.map(([, , r]) => r);
  const jy = l.pts[l.joint][0];
  // Сустав гнётся на длине в полтора радиуса: выше — бедро, ниже — голень.
  const span = l.pts[l.joint][2] * 1.5;
  s.tube(path, radii, {
    seg,
    up: V(0, 0, 1),
    color: (_u, _a, p) => color(p.y),
    skin: (_u, _a, p) => blend(upper, lower, smooth(jy + span, jy - span, p.y)),
    caps: [0.3, 0.25],
  }, flat);
}

// ---------- Позы ----------

/** Размах шага: бедро вперёд-назад (`A` перед, `Ah` зад) и сгиб в суставе на переносе (`B`, `Bh`), рад. */
interface Stride {
  A: number;
  B: number;
  Ah: number;
  Bh: number;
}

/** Порядок ног в круге: левая задняя, левая передняя, правая задняя, правая передняя (шаг) или диагонали (рысь). */
const WALK_ORDER = { bl: 0, fl: 0.25, br: 0.5, fr: 0.75 } as const;
const TROT_ORDER = { fl: 0, br: 0.04, fr: 0.5, bl: 0.54 } as const;

const TAU = Math.PI * 2;

/** Шаг или рысь в фазе `ph`: бедро идёт синусом, на переносе нога сгибается в суставе. */
function stepPose(ph: number, g: Stride, order: Record<'fl' | 'fr' | 'bl' | 'br', number>): Pose {
  const out: Record<string, [number, number, number]> = {};
  for (const leg of ['fl', 'fr', 'bl', 'br'] as const) {
    const psi = ph + order[leg];
    const front = leg[0] === 'f';
    const A = front ? g.A : g.Ah;
    const B = front ? g.B : g.Bh;
    // Вперёд — минус: поворот вокруг X кладёт ногу (−Y) назад при плюсе.
    out[leg] = [-A * Math.cos(TAU * psi), 0, 0];
    const flex = B * Math.max(0, -Math.sin(TAU * psi));
    // Перед гнётся в запястье назад (+), зад в скакательном — вперёд (−).
    out[`${leg}k`] = [front ? flex : -flex, 0, 0];
  }
  return out;
}

/** Скачок оленя и ягнёнка: в полёте ноги вытянуты (перед — вперёд, зад — назад), на земле собраны под телом. */
function boundPose(ph: number, g: Stride): Pose {
  const e = -Math.cos(TAU * ph);
  const gather = Math.max(0, -e);
  const fly = Math.max(0, e);
  const lag = 0.18 * Math.sin(TAU * ph);
  return {
    fl: [-g.A * e, 0, 0],
    fr: [-g.A * e + lag, 0, 0],
    flk: [g.B * (gather + 0.55 * fly), 0, 0],
    frk: [g.B * (gather + 0.55 * fly) + 0.1, 0, 0],
    bl: [g.Ah * e, 0, 0],
    br: [g.Ah * e - lag, 0, 0],
    blk: [-g.Bh * gather + 0.25 * fly, 0, 0],
    brk: [-g.Bh * gather + 0.25 * fly, 0, 0],
  };
}

/**
 * Лёжка: тело опущено до брюха (`lieOf`), и ноги ложатся под ним: плечо и бедро — назад, колено у земли; пясть подогнута
 * в запястье под грудь, плюсна — вперёд под брюхо. Две ступени каждой пары.
 */
interface Fold {
  F1: Pose;
  F2: Pose;
  H1: Pose;
  H2: Pose;
}

const both = (l: string, r: string, v: readonly [number, number, number], mirror = true): Record<string, readonly [number, number, number]> => ({
  [l]: v,
  [r]: mirror ? [v[0], -v[1], -v[2]] : v,
});

function folds(f: { up: number; knee: number; hip: number; hock: number }): Fold {
  return {
    F1: { ...both('fl', 'fr', [f.up * 0.45, 0, 0.04]), ...both('flk', 'frk', [f.knee * 0.5, 0, 0]) },
    F2: { ...both('fl', 'fr', [f.up, 0, 0.08]), ...both('flk', 'frk', [f.knee, 0, 0]) },
    H1: { ...both('bl', 'br', [f.hip * 0.5, 0, 0.06]), ...both('blk', 'brk', [f.hock * 0.5, 0, 0]) },
    H2: { ...both('bl', 'br', [f.hip, 0, 0.14]), ...both('blk', 'brk', [f.hock, 0, 0]) },
  };
}

/** Каналы породы: круг шага, бег, лёжка, поворот шеи, головы и хвоста, уши, жевание, дыхание. */
interface Moveset {
  walk: Stride;
  run?: { stride: Stride; kind: 'trot' | 'bound' };
  fold: Fold;
  dead?: Pose;
  ears: Pose;
  chew: Pose;
  /** Где грудь дышит: середина и полуоси по длине и высоте. */
  chest: { z: number; y: number; len: number };
}

const WALK_KEYS = 6;
export const RUN_KEYS = 6;
export { WALK_KEYS };

function channels(m: Moveset): Record<string, Channel> {
  const out: Record<string, Channel> = {};
  for (let i = 0; i < WALK_KEYS; i++) out[`walk${i}`] = { pose: stepPose(i / WALK_KEYS, m.walk, WALK_ORDER) };
  if (m.run) {
    const r = m.run;
    for (let i = 0; i < RUN_KEYS; i++) out[`run${i}`] = { pose: r.kind === 'trot' ? stepPose(i / RUN_KEYS, r.stride, TROT_ORDER) : boundPose(i / RUN_KEYS, r.stride) };
  }
  out.foldF1 = { pose: m.fold.F1 };
  out.foldF2 = { pose: m.fold.F2 };
  out.foldH1 = { pose: m.fold.H1 };
  out.foldH2 = { pose: m.fold.H2 };
  if (m.dead) out.dead = { pose: m.dead };
  out.neckX = { turn: 'neck', axis: 'x' };
  out.neckY = { turn: 'neck', axis: 'y' };
  out.headX = { turn: 'head', axis: 'x' };
  out.tailX = { turn: 'tail', axis: 'x' };
  out.tailY = { turn: 'tail', axis: 'y' };
  out.ears = { pose: m.ears };
  out.chew = { pose: m.chew };
  const c = m.chest;
  out.breathe = {
    push: (p, _n, s) => (s.a === BONE.body && s.w === 0 ? 0.014 * smooth(c.len, 0, Math.abs(p.z - c.z)) * smooth(c.y + 0.3, c.y - 0.1, p.y) : 0),
  };
  return out;
}

// ---------- Порода ----------

/** Готовая порода: запечённая сетка, где её кости и сколько стоит она у земли. */
export interface Model extends Baked {
  kind: Kind;
  /** Высота спины, м: над ней — значок «сколько ещё». */
  back: number;
  /** На сколько опускается тело в лёжке, м: длина подогнутых ног. */
  lie: number;
  /** На сколько тело лежащего на боку над землёй: полутолщина туловища, м. */
  side: number;
  /** Где середина туловища (ось, вокруг которой зверь валится на бок). */
  core: THREE.Vector3;
}

function bones(p: {
  body: THREE.Vector3;
  neck: THREE.Vector3;
  head: THREE.Vector3;
  jaw: THREE.Vector3;
  ear: THREE.Vector3;
  tail: THREE.Vector3;
  fore: THREE.Vector3;
  knee: THREE.Vector3;
  hip: THREE.Vector3;
  hock: THREE.Vector3;
}): BoneDef[] {
  const t = (v: THREE.Vector3, sx = 1): [number, number, number] => [v.x * sx, v.y, v.z];
  return [
    { name: 'body', parent: -1, at: t(p.body) },
    { name: 'neck', parent: 0, at: t(p.neck) },
    { name: 'head', parent: 1, at: t(p.head) },
    { name: 'jaw', parent: 2, at: t(p.jaw) },
    { name: 'earL', parent: 2, at: t(p.ear) },
    { name: 'earR', parent: 2, at: t(p.ear, -1) },
    { name: 'tail', parent: 0, at: t(p.tail) },
    { name: 'fl', parent: 0, at: t(p.fore) },
    { name: 'flk', parent: 7, at: t(p.knee) },
    { name: 'fr', parent: 0, at: t(p.fore, -1) },
    { name: 'frk', parent: 9, at: t(p.knee, -1) },
    { name: 'bl', parent: 0, at: t(p.hip) },
    { name: 'blk', parent: 11, at: t(p.hock) },
    { name: 'br', parent: 0, at: t(p.hip, -1) },
    { name: 'brk', parent: 13, at: t(p.hock, -1) },
  ];
}

/** Шея: доля кости шеи — от нуля в груди до единицы к середине шеи. */
const neckSkin = (u: number, from: number, to: number): Skin => blend(BONE.body, BONE.neck, smooth(from, to, u));

/** Глаз: тёмный шар с бликом-ободком; смотрит вбок. */
function eye(s: Sculpt, at: THREE.Vector3, r: number, iris: number, side: number, detail: Detail): void {
  const seg = detail === 'hi' ? 7 : 5;
  s.blob(at, V(r * 0.55, r, r), new THREE.Euler(0, 0, 0), iris, rigid(BONE.head), seg, 4);
  // Блик — светлая точка у переднего верхнего края: глаз живой, а не дырка.
  s.blob(V(at.x + side * r * 0.42, at.y + r * 0.35, at.z + r * 0.3), V(r * 0.2, r * 0.22, r * 0.22), new THREE.Euler(), 0xe8e2d0, rigid(BONE.head), 4, 3);
}

// ---------- Овца и ягнёнок ----------

const SHEEP = { wool: 0xe6dfcf, woolDeep: 0xc9bfa9, face: 0x2b2627, faceLight: 0x3d3536, hoof: 0x1d1a1a, eye: 0xa07a2a, inner: 0x6a4a48 };

/**
 * Овца: облако руна на тонких чёрных ногах, чёрная морда с ушами вбок, шапка руна на лбу. Ягнёнок — та же лепка в
 * других мерах: голова крупнее, ноги длиннее, руно светлее и мельче (`young`).
 */
function sheep(detail: Detail, young: boolean): Model {
  const hi = detail === 'hi';
  const s = new Sculpt();
  // Ягнёнок лепится в мерах взрослой и сжимается в конце: пропорции свои, рост — две трети.
  const K = young ? 0.64 : 1;
  const legK = young ? 1.4 : 1;
  const headK = young ? 1.3 : 1;
  const wool = young ? 0xf4f0e6 : SHEEP.wool;
  const deep = young ? 0xdcd4c4 : SHEEP.woolDeep;
  // Ноги — от земли до туловища: ягнёнок на длинных ногах, тело выше на их длину.
  const L = 0.42 * legK;
  const top = L * 0.97;
  const by = top + 0.06;
  const lift = by - 0.467;
  // Туловище — руно: кольца от крупа к груди, клоки — шумом по нормали.
  const rings: Ring[] = [
    [-0.52, 0.03, 0.03],
    [-0.47, 0.17, 0.17],
    [-0.38, 0.26, 0.25],
    [-0.22, 0.31, 0.28],
    [-0.02, 0.32, 0.29],
    [0.16, 0.31, 0.28],
    [0.3, 0.27, 0.27],
    [0.41, 0.19, 0.22],
    [0.47, 0.05, 0.08],
  ].map(([z, rx, ry]) => ({ c: V(0, by + (z > 0.25 ? (z - 0.25) * 0.35 : 0), z), rx, ry }));
  const lump = young ? 0.03 : 0.05;
  // Клоки: крупные округлые бугры (порог шума) и мелкая кудря поверх — облако, а не штукатурка.
  const woolBump = (p: THREE.Vector3): number => {
    const a = noise3(p.x * 8 + 3, p.y * 8, p.z * 8);
    const b = noise3(p.x * 17, p.y * 17 + 5, p.z * 17);
    return lump * (smooth(0.2, 0.75, a) * 0.85 + b * 0.3 - 0.25);
  };
  s.loft(hi ? smoothRings(rings, 2) : rings, {
    seg: hi ? 18 : 12,
    color: (_u, a, p) => mix(deep, wool, 0.35 + 0.65 * smooth(-0.6, 0.5, Math.cos(a)) * (0.7 + 0.3 * noise3(p.x * 9, p.y * 9, p.z * 9))),
    skin: rigid(BONE.body),
    bump: (_u, _a, p) => woolBump(p),
    caps: [0.4, 0.4],
  });
  // Шея — в руне: короткая трубка вперёд-вверх; кость шеи у груди.
  const neck = V(0, by + 0.12, 0.3);
  const poll = V(0, by + 0.25 + lift * 0.5, 0.47);
  // Шея в руне — того же руна, что тело, и толще головы: шарфом не читается, тело переходит в голову.
  s.tube([V(0, by + 0.02, 0.2), V(0, by + 0.1, 0.32), V(0, by + 0.18, 0.41), V(0, by + 0.23, 0.46)], [0.2, 0.18, 0.14, 0.1], {
    seg: hi ? 16 : 9,
    color: (_u, a) => mix(deep, wool, 0.45 + 0.55 * smooth(-0.6, 0.5, Math.cos(a))),
    skin: (u) => neckSkin(u, 0.15, 0.6),
    bump: (_u, _a, p) => woolBump(p) * 0.8,
    caps: [null, 0.3],
  });
  // Голова — чёрная морда: от темени вперёд и вниз к носу.
  const hk = headK;
  // Морда ягнёнка короче: большой лоб и маленький нос — детёныш, а не овца поменьше.
  const sn = young ? 0.72 : 1;
  const muzzle = V(0, poll.y - 0.17 * hk * sn, poll.z + 0.24 * hk * sn);
  s.loft(
    [
      { c: V(0, poll.y + 0.01 * hk, poll.z - 0.04 * hk), rx: 0.06 * hk, ry: 0.06 * hk },
      { c: V(0, poll.y - 0.02 * hk, poll.z + 0.04 * hk), rx: 0.085 * hk, ry: 0.088 * hk },
      { c: V(0, poll.y - 0.08 * hk * sn, poll.z + 0.13 * hk * sn), rx: 0.075 * hk, ry: 0.08 * hk },
      { c: V(0, poll.y - 0.13 * hk * sn, poll.z + 0.2 * hk * sn), rx: 0.058 * hk, ry: 0.062 * hk },
      { c: muzzle, rx: 0.045 * hk, ry: 0.048 * hk },
    ],
    {
      seg: hi ? 12 : 8,
      color: (u, a) => mix(SHEEP.faceLight, SHEEP.face, u * 0.7 + 0.3 * Math.max(0, -Math.cos(a))),
      skin: (u, a) => (u > 0.62 && Math.cos(a) < -0.35 ? blend(BONE.head, BONE.jaw, 1) : rigid(BONE.head)),
      caps: [0.5, 0.7],
    },
  );
  // Нос — чуть светлее, ноздри — тёмные точки.
  for (const sx of [-1, 1]) s.blob(V(sx * 0.02 * hk, muzzle.y + 0.012 * hk, muzzle.z + 0.035 * hk), V(0.011, 0.008, 0.008).multiplyScalar(hk), new THREE.Euler(), 0x121010, rigid(BONE.head), 5, 4);
  // Шапка руна на лбу.
  s.blob(V(0, poll.y + 0.045 * hk, poll.z - 0.01 * hk), V(0.085, 0.055, 0.085).multiplyScalar(hk), new THREE.Euler(-0.3, 0, 0), wool, rigid(BONE.head), hi ? 8 : 6, hi ? 5 : 4, (p) => woolBump(p) * 0.6);
  // Уши — вбок и чуть вниз, тёмные, с розоватым исподом.
  const ear = V(0.075 * hk, poll.y + 0.005 * hk, poll.z + 0.01 * hk);
  for (const sx of [-1, 1]) {
    const at = V(sx * 0.13 * hk, poll.y - 0.005 * hk, poll.z + 0.02 * hk);
    s.blob(at, V(0.075, 0.02, 0.034).multiplyScalar(hk), new THREE.Euler(0, sx * 0.25, sx * -0.45), (p) => (p.y < at.y ? SHEEP.inner : SHEEP.face), rigid(sx > 0 ? BONE.earL : BONE.earR), hi ? 8 : 6, 4);
    eye(s, V(sx * 0.072 * hk, poll.y - 0.04 * hk, poll.z + 0.09 * hk * sn), (young ? 0.021 : 0.017) * hk, SHEEP.eye, sx, detail);
  }
  // Ноги: чёрные, тонкие; сверху — штаны руна.
  const fz = 0.24;
  const hz = -0.3;
  const legSeg = hi ? 6 : 5;
  const legColor = (y: number): number => (y < 0.045 * legK ? SHEEP.hoof : SHEEP.face);
  for (const sx of [-1, 1]) {
    const x = sx * 0.13;
    const fore: Leg = {
      pts: [
        [top, fz, 0.05],
        [top - L * 0.35, fz + 0.01, 0.042],
        [top - L * 0.6, fz, 0.034],
        [top - L * 0.88, fz + 0.005, 0.028],
        [0.025, fz + 0.012, 0.032],
        [0.0, fz + 0.018, 0.03],
      ],
      joint: 2,
    };
    const hind: Leg = {
      pts: [
        [top, hz, 0.06],
        [top - L * 0.33, hz + 0.03, 0.05],
        [top - L * 0.6, hz - 0.03, 0.034],
        [top - L * 0.88, hz - 0.01, 0.028],
        [0.025, hz, 0.032],
        [0.0, hz + 0.006, 0.03],
      ],
      joint: 2,
    };
    leg(s, x, fore, sx > 0 ? BONE.fl : BONE.fr, sx > 0 ? BONE.flk : BONE.frk, legColor, legSeg);
    leg(s, x, hind, sx > 0 ? BONE.bl : BONE.br, sx > 0 ? BONE.blk : BONE.brk, legColor, legSeg);
    // Штаны руна: клок на бедре и плече — нога уходит в руно, а не торчит из него.
    for (const [z, k] of [
      [fz, 0.9],
      [hz, 1.1],
    ] as const)
      s.blob(V(x * 1.05, top - L * 0.16, z), V(0.085 * k, 0.11, 0.09 * k), new THREE.Euler(), wool, rigid(z > 0 ? (sx > 0 ? BONE.fl : BONE.fr) : sx > 0 ? BONE.bl : BONE.br), hi ? 7 : 5, hi ? 5 : 4, (p) => woolBump(p) * 0.7);
  }
  // Хвост — короткий клок руна.
  const tail = V(0, by + 0.08, -0.47);
  s.tube([V(0, by + 0.06, -0.47), V(0, by - 0.04, -0.53), V(0, by - 0.13, -0.55)], [0.065, 0.06, 0.04], {
    seg: hi ? 9 : 6,
    color: wool,
    up: V(0, 0, -1),
    skin: (u) => blend(BONE.body, BONE.tail, smooth(0, 0.35, u)),
    bump: (_u, _a, p) => woolBump(p) * 0.5,
    caps: [0.3, 0.6],
  });
  const rig = new Rig(
    bones({
      body: V(0, by, 0),
      neck,
      head: V(poll.x, poll.y - 0.02, poll.z - 0.02),
      jaw: V(0, poll.y - 0.08 * hk, poll.z + 0.08 * hk),
      ear,
      tail,
      fore: V(0.13, top - 0.02, fz),
      knee: V(0.13, top - L * 0.6, fz),
      hip: V(0.13, top - 0.02, hz),
      hock: V(0.13, top - L * 0.6, hz - 0.03),
    }),
  );
  const ms: Moveset = {
    walk: { A: 0.3, B: 0.7, Ah: 0.28, Bh: 0.6 },
    run: young ? { kind: 'bound', stride: { A: 0.5, B: 0.9, Ah: 0.5, Bh: 0.8 } } : undefined,
    fold: folds({ up: 1.0, knee: 2.6, hip: 0.95, hock: -2.45 }),
    ears: { earL: [0, 0, 0.5], earR: [0, 0, -0.5] },
    chew: { jaw: [0.16, 0, 0] },
    chest: { z: 0.12, y: by, len: 0.3 },
  };
  const b = bake(s, rig, channels(ms));
  if (K !== 1) scaleModel(b, K);
  return {
    ...b,
    kind: young ? 'lamb' : 'sheep',
    back: (by + 0.3) * K,
    lie: lieOf(b),
    side: 0.3 * K,
    core: V(0, by * K, -0.02 * K),
  };
}

/** На сколько опустить лежащее: до земли низом туловища — брюхо на траве, а не в земле и не над ней. */
function lieOf(b: Baked): number {
  const p = b.geometry.attributes.position;
  let low = Infinity;
  b.skins.forEach((s, i) => {
    if (s.a === BONE.body && s.w === 0) low = Math.min(low, p.getY(i));
  });
  return Math.max(0, low - 0.02);
}

/** Сжать запечённую породу целиком: сетку, морфы и шарниры. */
function scaleModel(b: Baked, k: number): void {
  const g = b.geometry;
  g.scale(k, k, k);
  for (const m of g.morphAttributes.position) {
    for (let i = 0; i < m.count; i++) m.setXYZ(i, m.getX(i) * k, m.getY(i) * k, m.getZ(i) * k);
  }
  for (const bone of b.rig.bones) (bone.at as unknown as number[]).splice(0, 3, bone.at[0] * k, bone.at[1] * k, bone.at[2] * k);
}

// ---------- Коза ----------

const GOAT = { back: 0x5e4630, flank: 0x8b6a4c, belly: 0xd4c6ae, stripe: 0x3e2e22, face: 0x7a5a40, muzzle: 0xc9b9a0, hoof: 0x2a221c, horn: 0x8a7a62, hornTip: 0x4a4034, eye: 0xb88a2a };

/** Коза: поджарая, спина прямая с тёмным ремнём, рога назад дугой, борода, уши вбок, хвост торчком. */
function goat(detail: Detail): Model {
  const hi = detail === 'hi';
  const s = new Sculpt();
  const by = 0.56;
  const shag = (p: THREE.Vector3, a: number): number => {
    // Космы по низу боков: длинная шерсть висит бахромой.
    const low = smooth(-0.1, -0.75, Math.cos(a));
    return 0.022 * low * (noise3(p.x * 18, p.y * 4, p.z * 18) - 0.25);
  };
  const rings: Ring[] = [
    [-0.46, 0.04, 0.05, 0.02],
    [-0.42, 0.13, 0.15, 0.02],
    [-0.32, 0.17, 0.19, 0.0],
    [-0.15, 0.17, 0.19, -0.02],
    [0.03, 0.17, 0.2, -0.02],
    [0.2, 0.17, 0.21, 0.0],
    [0.33, 0.14, 0.19, 0.03],
    [0.41, 0.06, 0.1, 0.06],
  ].map(([z, rx, ry, dy]) => ({ c: V(0, by + dy, z), rx, ry }));
  const coat = byAngle(GOAT.back, GOAT.flank, GOAT.belly);
  s.loft(hi ? smoothRings(rings, 2) : rings, {
    seg: hi ? 16 : 10,
    box: 2.6,
    color: (_u, a, p) => (Math.cos(a) > 0.93 ? GOAT.stripe : mix(coat(a), GOAT.back, 0.25 * noise3(p.x * 7, p.y * 7, p.z * 7))),
    skin: rigid(BONE.body),
    bump: (_u, a, p) => shag(p, a),
    caps: [0.45, 0.3],
  });
  // Шея — вверх и вперёд: коза держит голову высоко.
  const neck = V(0, by + 0.08, 0.3);
  const poll = V(0, by + 0.44, 0.5);
  s.loft(
    [
      { c: V(0, by + 0.02, 0.26), rx: 0.11, ry: 0.14 },
      { c: V(0, by + 0.16, 0.37), rx: 0.085, ry: 0.11 },
      { c: V(0, by + 0.3, 0.44), rx: 0.07, ry: 0.085 },
      { c: V(0, by + 0.41, 0.48), rx: 0.065, ry: 0.07 },
    ],
    {
      seg: hi ? 12 : 8,
      color: (_u, a) => (Math.cos(a) > 0.9 ? GOAT.stripe : coat(a)),
      skin: (u) => neckSkin(u, 0.05, 0.45),
      caps: [null, 0.3],
    },
  );
  // Голова: прямой профиль, узкая морда, светлая к носу.
  const muzzle = V(0, poll.y - 0.13, poll.z + 0.22);
  s.loft(
    [
      { c: V(0, poll.y + 0.02, poll.z - 0.04), rx: 0.06, ry: 0.06 },
      { c: V(0, poll.y, poll.z + 0.03), rx: 0.075, ry: 0.075 },
      { c: V(0, poll.y - 0.05, poll.z + 0.11), rx: 0.062, ry: 0.07 },
      { c: V(0, poll.y - 0.1, poll.z + 0.18), rx: 0.045, ry: 0.055 },
      { c: muzzle, rx: 0.036, ry: 0.042 },
    ],
    {
      seg: hi ? 12 : 8,
      box: 2.3,
      color: (u) => mix(GOAT.face, GOAT.muzzle, smooth(0.55, 1, u)),
      skin: (u, a) => (u > 0.6 && Math.cos(a) < -0.35 ? rigid(BONE.jaw) : rigid(BONE.head)),
      caps: [0.5, 0.7],
    },
  );
  for (const sx of [-1, 1]) s.blob(V(sx * 0.016, muzzle.y + 0.01, muzzle.z + 0.03), V(0.008, 0.007, 0.007), new THREE.Euler(), 0x1a1410, rigid(BONE.head), 5, 4);
  // Борода — клин вниз от подбородка.
  s.tube([V(0, muzzle.y - 0.03, muzzle.z - 0.06), V(0, muzzle.y - 0.1, muzzle.z - 0.08), V(0, muzzle.y - 0.15, muzzle.z - 0.07)], [0.025, 0.018, 0.005], {
    seg: 6,
    color: GOAT.stripe,
    skin: rigid(BONE.jaw),
    caps: [0.2, 0.3],
  });
  // Рога — дугой назад и в стороны, кольцами темнее к концу.
  const ear = V(0.06, poll.y, poll.z);
  for (const sx of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    const rad: number[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const ang = 0.6 + t * 1.9;
      pts.push(V(sx * (0.035 + t * 0.07), poll.y + 0.03 + Math.sin(ang) * 0.12 * t + t * 0.04, poll.z + 0.01 - (1 - Math.cos(ang)) * 0.11 * t));
      rad.push(0.022 * (1 - t) + 0.004);
    }
    s.tube(pts, rad, { seg: hi ? 7 : 5, color: (u) => mix(GOAT.horn, GOAT.hornTip, u), skin: rigid(BONE.head), caps: [0.2, 0.6] });
    // Уши — вбок, длинные.
    const at = V(sx * 0.11, poll.y - 0.01, poll.z + 0.02);
    s.blob(at, V(0.075, 0.018, 0.03), new THREE.Euler(0, sx * 0.4, sx * -0.2), (p) => (p.y < at.y ? 0xc8a890 : GOAT.face), rigid(sx > 0 ? BONE.earL : BONE.earR), hi ? 8 : 6, 4);
    eye(s, V(sx * 0.058, poll.y - 0.025, poll.z + 0.09), 0.016, GOAT.eye, sx, detail);
  }
  // Ноги — длиннее овечьих, суставы видны.
  const fz = 0.24;
  const hz = -0.3;
  const top = by - 0.04;
  const L = top;
  const legSeg = hi ? 7 : 5;
  const legColor = (y: number): number => (y < 0.04 ? GOAT.hoof : y < 0.2 ? mix(GOAT.stripe, GOAT.flank, (y - 0.04) / 0.16) : GOAT.flank);
  for (const sx of [-1, 1]) {
    const x = sx * 0.12;
    leg(s, x, {
      pts: [
        [top + 0.04, fz, 0.07],
        [top - L * 0.3, fz + 0.01, 0.05],
        [top - L * 0.55, fz, 0.032],
        [top - L * 0.85, fz + 0.005, 0.024],
        [0.025, fz + 0.012, 0.028],
        [0.0, fz + 0.018, 0.026],
      ],
      joint: 2,
    }, sx > 0 ? BONE.fl : BONE.fr, sx > 0 ? BONE.flk : BONE.frk, legColor, legSeg);
    leg(s, x, {
      pts: [
        [top + 0.04, hz, 0.09],
        [top - L * 0.3, hz + 0.04, 0.065],
        [top - L * 0.55, hz - 0.05, 0.034],
        [top - L * 0.85, hz - 0.02, 0.024],
        [0.025, hz - 0.01, 0.028],
        [0.0, hz - 0.004, 0.026],
      ],
      joint: 2,
    }, sx > 0 ? BONE.bl : BONE.br, sx > 0 ? BONE.blk : BONE.brk, legColor, legSeg);
  }
  // Хвост — торчком вверх.
  const tail = V(0, by + 0.12, -0.42);
  s.tube([V(0, by + 0.1, -0.42), V(0, by + 0.19, -0.47), V(0, by + 0.25, -0.47)], [0.03, 0.028, 0.012], {
    seg: 6,
    color: GOAT.stripe,
    skin: (u) => blend(BONE.body, BONE.tail, smooth(0, 0.4, u)),
    caps: [0.2, 0.5],
  });
  const rig = new Rig(
    bones({
      body: V(0, by, 0),
      neck,
      head: V(0, poll.y - 0.01, poll.z - 0.02),
      jaw: V(0, poll.y - 0.06, poll.z + 0.08),
      ear,
      tail,
      fore: V(0.12, top, fz),
      knee: V(0.12, top - L * 0.55, fz),
      hip: V(0.12, top, hz),
      hock: V(0.12, top - L * 0.55, hz - 0.05),
    }),
  );
  const b = bake(
    s,
    rig,
    channels({
      walk: { A: 0.32, B: 0.75, Ah: 0.3, Bh: 0.65 },
      run: { kind: 'trot', stride: { A: 0.55, B: 1.2, Ah: 0.5, Bh: 1.0 } },
      fold: folds({ up: 1.0, knee: 2.6, hip: 0.95, hock: -2.45 }),
      ears: { earL: [0, 0.3, 0.45], earR: [0, -0.3, -0.45] },
      chew: { jaw: [0.15, 0, 0] },
      chest: { z: 0.12, y: by, len: 0.28 },
    }),
  );
  return { ...b, kind: 'goat', back: by + 0.2, lie: lieOf(b), side: 0.2, core: V(0, by, 0) };
}

// ---------- Корова ----------

const COW = { coat: 0x7a4b30, coatDark: 0x5a3622, patch: 0xebe5d8, belly: 0xd8cfc0, muzzle: 0xd8a89a, nose: 0x6a4040, hoof: 0x2a221c, horn: 0xe6dcc4, hornTip: 0x5a4a3a, eye: 0x2a1a12, udder: 0xe2aaa0 };

/** Корова: тяжёлый короб с выступающими маклаками, подгрудок, широкая розовая морда, рога, кисть хвоста, пятна. */
function cow(detail: Detail): Model {
  const hi = detail === 'hi';
  const s = new Sculpt();
  const by = 0.98;
  // Пятна — шумом по месту: пёстрая масть одна на модель, у каждой копии своя тень цвета (`Pack.setTint`).
  const pied = (p: THREE.Vector3, base: number): number => {
    const n = noise3(p.x * 3.1 + 5, p.y * 3.1, p.z * 3.1) * 0.75 + noise3(p.x * 9, p.y * 9, p.z * 9) * 0.25;
    return mix(base, COW.patch, smooth(0.56, 0.62, n));
  };
  const rings: Ring[] = [
    [-0.78, 0.06, 0.08, 0.06],
    [-0.74, 0.22, 0.24, 0.04],
    [-0.62, 0.29, 0.3, 0.02],
    [-0.4, 0.3, 0.32, 0.0],
    [-0.12, 0.32, 0.35, -0.03],
    [0.16, 0.31, 0.35, -0.02],
    [0.42, 0.27, 0.33, 0.02],
    [0.58, 0.18, 0.24, 0.06],
    [0.64, 0.06, 0.1, 0.08],
  ].map(([z, rx, ry, dy]) => ({ c: V(0, by + dy, z), rx, ry }));
  s.loft(hi ? smoothRings(rings, 2) : rings, {
    seg: hi ? 18 : 12,
    box: 2.7,
    color: (_u, a, p) => pied(p, mix(COW.coat, COW.belly, 0.25 * smooth(0.3, 0.95, -Math.cos(a)))),
    skin: rigid(BONE.body),
    // Маклаки и крестец: два бугра у крупа сверху — силуэт коровы, а не бочки.
    bump: (u, a) => 0.035 * smooth(0.12, 0, Math.abs(u - 0.17)) * smooth(0.8, 0.98, Math.max(Math.cos(a - 0.75), Math.cos(a + 0.75))),
    caps: [0.4, 0.3],
  });
  // Шея — короткая, вперёд и чуть вниз; подгрудок висит складкой.
  const neck = V(0, by + 0.08, 0.5);
  const poll = V(0, by + 0.12, 0.92);
  s.loft(
    [
      { c: V(0, by + 0.04, 0.44), rx: 0.22, ry: 0.26 },
      { c: V(0, by + 0.07, 0.62), rx: 0.17, ry: 0.22 },
      { c: V(0, by + 0.1, 0.78), rx: 0.13, ry: 0.17 },
      { c: V(0, by + 0.12, 0.88), rx: 0.11, ry: 0.13 },
    ],
    { seg: hi ? 14 : 9, color: (_u, _a, p) => pied(p, COW.coat), skin: (u) => neckSkin(u, 0.05, 0.5), caps: [null, 0.3] },
  );
  s.loft(
    [
      { c: V(0, by - 0.18, 0.5), rx: 0.04, ry: 0.06 },
      { c: V(0, by - 0.2, 0.62), rx: 0.05, ry: 0.11 },
      { c: V(0, by - 0.13, 0.76), rx: 0.04, ry: 0.08 },
    ],
    { seg: hi ? 8 : 6, color: COW.coat, skin: (u) => neckSkin(u, 0.0, 0.8), caps: [0.5, 0.5] },
  );
  // Голова — длинный клин вниз, широкая морда.
  const muzzle = V(0, poll.y - 0.3, poll.z + 0.2);
  s.loft(
    [
      { c: V(0, poll.y + 0.04, poll.z - 0.06), rx: 0.1, ry: 0.07 },
      { c: V(0, poll.y, poll.z + 0.02), rx: 0.125, ry: 0.1 },
      { c: V(0, poll.y - 0.1, poll.z + 0.09), rx: 0.105, ry: 0.095 },
      { c: V(0, poll.y - 0.2, poll.z + 0.15), rx: 0.085, ry: 0.08 },
      { c: muzzle, rx: 0.095, ry: 0.07 },
    ],
    {
      seg: hi ? 14 : 9,
      box: 2.5,
      color: (u, _a, p) => (u > 0.82 ? COW.muzzle : pied(p, COW.coatDark)),
      skin: (u, a) => (u > 0.62 && Math.cos(a) < -0.3 ? rigid(BONE.jaw) : rigid(BONE.head)),
      caps: [0.4, 0.6],
      up: V(0, 0.4, 1).normalize(),
    },
  );
  for (const sx of [-1, 1]) s.blob(V(sx * 0.035, muzzle.y + 0.0, muzzle.z + 0.075), V(0.016, 0.012, 0.01), new THREE.Euler(), COW.nose, rigid(BONE.head), 5, 4);
  // Рога — вбок и вверх, светлые с тёмным концом.
  const ear = V(0.12, poll.y - 0.02, poll.z);
  for (const sx of [-1, 1]) {
    s.tube([V(sx * 0.09, poll.y + 0.06, poll.z - 0.03), V(sx * 0.19, poll.y + 0.1, poll.z - 0.04), V(sx * 0.25, poll.y + 0.2, poll.z)], [0.03, 0.022, 0.006], {
      seg: hi ? 7 : 5,
      color: (u) => mix(COW.horn, COW.hornTip, smooth(0.5, 1, u)),
      skin: rigid(BONE.head),
      caps: [0.2, 0.5],
    });
    // Уши — вбок, с бахромой.
    const at = V(sx * 0.2, poll.y - 0.02, poll.z + 0.0);
    s.blob(at, V(0.1, 0.03, 0.055), new THREE.Euler(0, sx * 0.2, sx * -0.15), (p) => (p.y < at.y ? 0xc8968a : COW.coatDark), rigid(sx > 0 ? BONE.earL : BONE.earR), hi ? 8 : 6, 4);
    eye(s, V(sx * 0.105, poll.y - 0.07, poll.z + 0.08), 0.024, COW.eye, sx, detail);
  }
  // Вымя — розовое, между задних ног.
  s.blob(V(0, by - 0.36, -0.42), V(0.12, 0.08, 0.13), new THREE.Euler(), COW.udder, rigid(BONE.body), hi ? 9 : 6, 5);
  // Ноги — толстые, прямые.
  const fz = 0.4;
  const hz = -0.52;
  const top = by - 0.08;
  const L = top;
  const legSeg = hi ? 8 : 6;
  const legColor = (y: number): number => (y < 0.07 ? COW.hoof : y < 0.32 ? mix(COW.patch, COW.coat, smooth(0.15, 0.32, y)) : COW.coat);
  for (const sx of [-1, 1]) {
    const x = sx * 0.2;
    leg(s, x, {
      pts: [
        [top + 0.06, fz, 0.13],
        [top - L * 0.3, fz + 0.02, 0.1],
        [top - L * 0.6, fz, 0.065],
        [top - L * 0.85, fz + 0.005, 0.055],
        [0.045, fz + 0.015, 0.062],
        [0.0, fz + 0.025, 0.06],
      ],
      joint: 2,
    }, sx > 0 ? BONE.fl : BONE.fr, sx > 0 ? BONE.flk : BONE.frk, legColor, legSeg);
    leg(s, x, {
      pts: [
        [top + 0.06, hz, 0.16],
        [top - L * 0.3, hz + 0.05, 0.12],
        [top - L * 0.58, hz - 0.07, 0.065],
        [top - L * 0.85, hz - 0.03, 0.055],
        [0.045, hz - 0.015, 0.062],
        [0.0, hz - 0.005, 0.06],
      ],
      joint: 2,
    }, sx > 0 ? BONE.bl : BONE.br, sx > 0 ? BONE.blk : BONE.brk, legColor, legSeg);
  }
  // Хвост — длинный, висит до скакательного сустава, кисть на конце.
  const tail = V(0, by + 0.22, -0.76);
  const tailPts = [V(0, by + 0.22, -0.78), V(0, by + 0.05, -0.83), V(0, by - 0.25, -0.82), V(0, by - 0.48, -0.8)];
  s.tube(tailPts, [0.03, 0.022, 0.018, 0.016], { seg: 6, color: COW.coat, skin: (u) => blend(BONE.body, BONE.tail, smooth(0, 0.25, u)), caps: [0.2, 0.2] });
  s.blob(V(0, by - 0.56, -0.8), V(0.04, 0.09, 0.04), new THREE.Euler(), COW.coatDark, rigid(BONE.tail), 7, 5, (p) => 0.012 * (noise3(p.x * 40, p.y * 12, p.z * 40) - 0.3));
  const rig = new Rig(
    bones({
      body: V(0, by, 0),
      neck,
      head: V(0, poll.y, poll.z - 0.02),
      jaw: V(0, poll.y - 0.15, poll.z + 0.12),
      ear,
      tail,
      fore: V(0.2, top, fz),
      knee: V(0.2, top - L * 0.6, fz),
      hip: V(0.2, top, hz),
      hock: V(0.2, top - L * 0.58, hz - 0.07),
    }),
  );
  const b = bake(
    s,
    rig,
    channels({
      walk: { A: 0.24, B: 0.55, Ah: 0.22, Bh: 0.5 },
      fold: folds({ up: 1.0, knee: 2.6, hip: 0.95, hock: -2.45 }),
      ears: { earL: [0, 0.2, 0.4], earR: [0, -0.2, -0.4] },
      chew: { jaw: [0.12, 0, 0] },
      chest: { z: 0.2, y: by, len: 0.4 },
    }),
  );
  return { ...b, kind: 'cow', back: by + 0.33, lie: lieOf(b), side: 0.32, core: V(0, by, -0.05) };
}

// ---------- Олень ----------

const DEER = {
  back: 0x6a4428,
  flank: 0x8e5e36,
  belly: 0xcfae86,
  neck: 0x5a3e2a,
  mane: 0x4a3324,
  rump: 0xe8dcc4,
  face: 0x7a5236,
  muzzle: 0x2e2420,
  eyeRing: 0xc9b08a,
  hoof: 0x2a221c,
  leg: 0x7a5232,
  antler: 0xeae0c8,
  antlerMid: 0x9a8264,
  antlerBase: 0x4e3c2c,
  eye: 0x16110e,
};

/**
 * Олень: туловище в эллипсоиде попадания, шея к оси правила, большие уши, белое зеркало под хвостом, тонкие ноги со
 * скакательным суставом назад, у рогача — грива на шее и рога с отростками. Оленуха — без рогов и гривы.
 */
function deerModel(detail: Detail, antlers: boolean): Model {
  const hi = detail === 'hi';
  const s = new Sculpt();
  const cy = DEER_BODY.y;
  const cz = DEER_BODY.z;
  // Кольца — от крупа к груди; брюхо подтянуто, грудь глубокая, холка выше крупа.
  const rings: Ring[] = [
    [-0.64, 0.05, 0.06, 0.06],
    [-0.6, 0.15, 0.17, 0.05],
    [-0.48, 0.235, 0.25, 0.03],
    [-0.3, 0.22, 0.24, 0.04],
    [-0.1, 0.21, 0.235, 0.03],
    [0.1, 0.228, 0.27, 0.0],
    [0.28, 0.232, 0.28, 0.03],
    [0.42, 0.17, 0.22, 0.09],
    [0.5, 0.06, 0.09, 0.12],
  ].map(([z, rx, ry, dy]) => ({ c: V(0, cy + dy, cz + z + 0.05), rx, ry }));
  const coat = byAngle(DEER.back, DEER.flank, DEER.belly);
  // Кольцо — кратное четырём: крайние точки боков и спины лежат на полуосях, и рамка туловища — ровно эллипсоид правила.
  s.loft(hi ? smoothRings(rings, 2) : rings, {
    seg: hi ? 16 : 12,
    color: (u, a, p) => {
      // Зеркало: светлое пятно вокруг хвоста — по нему оленя видно, когда он повернулся спиной.
      const rump = smooth(0.2, 0.06, u) * smooth(-0.7, 0.2, Math.cos(a));
      return mix(mix(coat(a), DEER.back, 0.2 * noise3(p.x * 6, p.y * 6, p.z * 6)), DEER.rump, rump);
    },
    skin: rigid(BONE.body),
    caps: [0.35, 0.3],
  });
  // Шея — от груди к темени вокруг оси правила (`hunt.DEER_NECK`): доля шеи — единица уже на оси.
  const neck = V(0, DEER_NECK.y, DEER_NECK.z);
  const poll = V(0, DEER_NECK.y + 0.47, DEER_NECK.z + 0.27);
  const mane = (p: THREE.Vector3, a: number): number => (antlers ? 0.035 * smooth(-0.2, -0.8, Math.cos(a)) * (noise3(p.x * 20, p.y * 6, p.z * 20) * 0.7 + 0.3) : 0);
  s.loft(
    [
      { c: V(0, cy + 0.02, DEER_NECK.z - 0.1), rx: 0.15, ry: 0.19 },
      { c: V(0, neck.y + 0.0, neck.z + 0.02), rx: 0.12, ry: 0.15 },
      { c: V(0, neck.y + 0.18, neck.z + 0.1), rx: 0.09, ry: 0.115 },
      { c: V(0, neck.y + 0.34, neck.z + 0.18), rx: 0.075, ry: 0.09 },
      { c: V(0, poll.y - 0.02, poll.z - 0.02), rx: 0.07, ry: 0.075 },
    ],
    {
      seg: hi ? 12 : 8,
      up: V(0, 0.45, -1).normalize(),
      color: (_u, a) => mix(DEER.neck, antlers ? DEER.mane : DEER.flank, smooth(-0.1, -0.8, Math.cos(a)) * 0.6),
      skin: (u) => neckSkin(u, 0.05, 0.22),
      bump: (_u, a, p) => mane(p, a),
      caps: [null, 0.3],
    },
  );
  // Голова: от темени вперёд и вниз; морда тёмная, у глаз светлый ободок.
  const muzzle = V(0, poll.y - 0.15, poll.z + 0.27);
  s.loft(
    [
      { c: V(0, poll.y + 0.02, poll.z - 0.05), rx: 0.06, ry: 0.055 },
      { c: V(0, poll.y, poll.z + 0.03), rx: 0.08, ry: 0.08 },
      { c: V(0, poll.y - 0.05, poll.z + 0.12), rx: 0.065, ry: 0.075 },
      { c: V(0, poll.y - 0.1, poll.z + 0.2), rx: 0.045, ry: 0.058 },
      { c: muzzle, rx: 0.036, ry: 0.044 },
    ],
    {
      seg: hi ? 12 : 8,
      color: (u) => (u > 0.85 ? DEER.muzzle : mix(DEER.face, DEER.neck, 0.3 * u)),
      skin: (u, a) => (u > 0.6 && Math.cos(a) < -0.35 ? rigid(BONE.jaw) : rigid(BONE.head)),
      caps: [0.5, 0.65],
    },
  );
  // Уши — большие, торчком в стороны и вверх, светлые изнутри.
  const ear = V(0.06, poll.y + 0.03, poll.z);
  for (const sx of [-1, 1]) {
    const at = V(sx * 0.12, poll.y + 0.09, poll.z - 0.02);
    s.blob(at, V(0.052, 0.125, 0.02), new THREE.Euler(-0.2, sx * 0.5, sx * -0.8), (p) => (Math.sign(p.x - at.x) === -sx ? DEER.eyeRing : DEER.face), rigid(sx > 0 ? BONE.earL : BONE.earR), hi ? 8 : 6, 5);
    s.blob(V(sx * 0.055, poll.y - 0.03, poll.z + 0.09), V(0.012, 0.024, 0.026), new THREE.Euler(), DEER.eyeRing, rigid(BONE.head), 6, 4);
    eye(s, V(sx * 0.058, poll.y - 0.028, poll.z + 0.095), 0.018, DEER.eye, sx, detail);
  }
  // Рога рогача: ствол назад-вверх дугой, надглазничный отросток вперёд, средний и вилка короны.
  if (antlers) {
    const seg = hi ? 6 : 4;
    const antler = (pts: THREE.Vector3[], r0: number, r1: number): void => {
      s.tube(pts, pts.map((_, i) => r0 + (r1 - r0) * (i / (pts.length - 1))), {
        seg,
        color: (u) => (u < 0.6 ? mix(DEER.antlerBase, DEER.antlerMid, smooth(0, 0.6, u)) : mix(DEER.antlerMid, DEER.antler, smooth(0.6, 1, u))),
        skin: rigid(BONE.head),
        caps: [0.2, 0.7],
      });
    };
    for (const sx of [-1, 1]) {
      const b0 = V(sx * 0.05, poll.y + 0.05, poll.z - 0.01);
      const beam = [b0, V(sx * 0.1, poll.y + 0.17, poll.z - 0.06), V(sx * 0.17, poll.y + 0.32, poll.z - 0.08), V(sx * 0.2, poll.y + 0.46, poll.z - 0.04), V(sx * 0.18, poll.y + 0.56, poll.z + 0.02)];
      antler(beam, 0.032, 0.013);
      antler([V(sx * 0.07, poll.y + 0.1, poll.z - 0.02), V(sx * 0.1, poll.y + 0.14, poll.z + 0.08), V(sx * 0.11, poll.y + 0.15, poll.z + 0.16)], 0.02, 0.008);
      antler([V(sx * 0.17, poll.y + 0.31, poll.z - 0.08), V(sx * 0.2, poll.y + 0.36, poll.z + 0.03), V(sx * 0.21, poll.y + 0.37, poll.z + 0.1)], 0.018, 0.007);
      antler([V(sx * 0.2, poll.y + 0.46, poll.z - 0.04), V(sx * 0.25, poll.y + 0.55, poll.z - 0.09), V(sx * 0.27, poll.y + 0.6, poll.z - 0.1)], 0.017, 0.007);
    }
    // Кольцо у основания — розетка.
    for (const sx of [-1, 1]) s.blob(V(sx * 0.05, poll.y + 0.05, poll.z - 0.01), V(0.03, 0.015, 0.03), new THREE.Euler(), DEER.antlerBase, rigid(BONE.head), 6, 4);
  }
  // Ноги: тонкие и высокие; передние прямые, задние — скакательный сустав назад.
  const fz = DEER_NECK.z - 0.12;
  const hz = cz - 0.42;
  const topF = cy + 0.02;
  const topH = cy + 0.08;
  const legSeg = hi ? 7 : 5;
  const legColor = (y: number): number => (y < 0.05 ? DEER.hoof : y < 0.45 ? mix(DEER.neck, DEER.leg, smooth(0.08, 0.45, y)) : DEER.leg);
  for (const sx of [-1, 1]) {
    const x = sx * 0.12;
    leg(s, x, {
      pts: [
        [topF, fz, 0.09],
        [0.72, fz + 0.02, 0.06],
        [0.44, fz, 0.036],
        [0.13, fz + 0.01, 0.026],
        [0.035, fz + 0.03, 0.03],
        [0.0, fz + 0.04, 0.026],
      ],
      joint: 2,
    }, sx > 0 ? BONE.fl : BONE.fr, sx > 0 ? BONE.flk : BONE.frk, legColor, legSeg);
    leg(s, x, {
      pts: [
        [topH, hz, 0.12],
        [0.76, hz + 0.08, 0.075],
        [0.5, hz - 0.08, 0.035],
        [0.14, hz - 0.03, 0.026],
        [0.035, hz - 0.01, 0.03],
        [0.0, hz + 0.0, 0.026],
      ],
      joint: 2,
    }, sx > 0 ? BONE.bl : BONE.br, sx > 0 ? BONE.blk : BONE.brk, legColor, legSeg);
  }
  // Хвост — короткий, светлый снизу.
  const tail = V(0, cy + 0.12, cz - 0.6);
  s.tube([V(0, cy + 0.12, cz - 0.6), V(0, cy + 0.04, cz - 0.66), V(0, cy - 0.04, cz - 0.67)], [0.04, 0.035, 0.015], {
    seg: 6,
    color: (_u, a) => (Math.cos(a) > 0.3 ? DEER.back : DEER.rump),
    up: V(0, 0, -1),
    skin: (u) => blend(BONE.body, BONE.tail, smooth(0, 0.3, u)),
    caps: [0.2, 0.4],
  });
  const rig = new Rig(
    bones({
      body: V(0, cy, cz),
      neck,
      head: V(0, poll.y - 0.02, poll.z - 0.03),
      jaw: V(0, poll.y - 0.06, poll.z + 0.1),
      ear,
      tail,
      fore: V(0.12, topF - 0.02, fz),
      knee: V(0.12, 0.44, fz),
      hip: V(0.12, topH - 0.04, hz),
      hock: V(0.12, 0.5, hz - 0.08),
    }),
  );
  const b = bake(
    s,
    rig,
    channels({
      walk: { A: 0.3, B: 0.8, Ah: 0.3, Bh: 0.7 },
      run: { kind: 'bound', stride: { A: 0.75, B: 1.3, Ah: 0.7, Bh: 1.0 } },
      fold: folds({ up: 1.0, knee: 2.6, hip: 0.95, hock: -2.45 }),
      // Убитый: ноги вытянуты — перед вперёд, зад назад, — шея запрокинута поворотом шеи в кадре.
      dead: { fl: [-0.55, 0, 0], fr: [-0.35, 0, 0], flk: [0.25, 0, 0], frk: [0.5, 0, 0], bl: [0.55, 0, 0], br: [0.3, 0, 0], blk: [-0.15, 0, 0], brk: [-0.4, 0, 0] },
      ears: { earL: [0.5, 0.3, 0.2], earR: [0.5, -0.3, -0.2] },
      chew: { jaw: [0.13, 0, 0] },
      chest: { z: 0.2, y: cy, len: 0.35 },
    }),
  );
  return { ...b, kind: antlers ? 'stag' : 'doe', back: cy + 0.3, lie: lieOf(b), side: 0.27, core: V(0, cy, cz) };
}

// ---------- Склад ----------

const made = new Map<string, Model>();

/**
 * Порода в подробности `detail`. Лепится один раз на кусок: стадо одной породы делит одну сетку (`fauna.Pack`).
 * Разбирает сетку сцена (`disposeGeometries`), поэтому склад отдаёт свежую лепку на каждый вход.
 */
export function model(kind: Kind, detail: Detail): Model {
  switch (kind) {
    case 'sheep':
      return sheep(detail, false);
    case 'lamb':
      return sheep(detail, true);
    case 'goat':
      return goat(detail);
    case 'cow':
      return cow(detail);
    case 'stag':
      return deerModel(detail, true);
    case 'doe':
      return deerModel(detail, false);
  }
}

/** Кэш на тесты: лепка — десятки миллисекунд, а тесты спрашивают одну породу много раз. */
export function cachedModel(kind: Kind, detail: Detail): Model {
  const key = `${kind}:${detail}`;
  let m = made.get(key);
  if (!m) {
    m = model(kind, detail);
    made.set(key, m);
  }
  return m;
}

// ---------- Поза в кадре ----------

/** Что делает зверь в этот кадр — языком позы, а не морфов. Все доли — 0..1, углы — рад. */
export interface Posture {
  /** Шаг: доля полного размаха и фаза круга (0..1). */
  walk: number;
  /** Бег поверх шага: доля и фаза своего круга. */
  run: number;
  phase: number;
  /** Шея: наклон (плюс — вниз, к траве) и поворот (плюс — влево); голова — кивок поверх шеи. */
  neck: number;
  turn: number;
  head: number;
  /** Хвост: поднят (плюс — вверх) и машет (плюс — влево). */
  tailUp: number;
  tailSwish: number;
  /** Уши прижаты (1) или настороже (−1). */
  ears: number;
  /** Жуёт: челюсть открыта. */
  chew: number;
  /** Вдох: грудь шире. */
  breathe: number;
  /** Ложится: 0 — стоит, 1 — лежит (перед подгибается первым). */
  fold: number;
  /** Убит: ноги вытянуты. */
  dead: number;
}

export const STILL: Posture = { walk: 0, run: 0, phase: 0, neck: 0, turn: 0, head: 0, tailUp: 0, tailSwish: 0, ears: 0, chew: 0, breathe: 0, fold: 0, dead: 0 };

/** Разложить позу в доли морфов породы. Канала у породы нет — молча мимо (`fauna.Moves`). */
export function posture(m: Moves, p: Posture): void {
  m.clear();
  const runK = Math.max(0, Math.min(1, p.run));
  m.cycle('walk', WALK_KEYS, p.phase, p.walk * (1 - runK));
  m.cycle('run', RUN_KEYS, p.phase, runK);
  // Лёжка: перед подгибается первым, зад — следом (корова и овца ложатся на запястья).
  m.stage('foldF1', 'foldF2', smooth(0, 0.62, p.fold));
  m.stage('foldH1', 'foldH2', smooth(0.32, 1, p.fold));
  m.add('dead', p.dead);
  m.turn('neckX', p.neck);
  m.turn('neckY', p.turn);
  m.turn('headX', p.head);
  m.turn('tailX', -p.tailUp);
  m.turn('tailY', p.tailSwish);
  m.add('ears', p.ears);
  m.add('chew', p.chew);
  m.add('breathe', p.breathe);
}

// ---------- Олень для правила охоты ----------

/** Последняя поза упавшего оленя: ноги вытянуты, шея запрокинута, уши прижаты (`huntPlay`, падение). */
export const FALLEN: Posture = { ...STILL, dead: 1, neck: -0.55, ears: 0.8 };

/** Где лежит туловище упавшего на бок `side` (±1) — та же матрица, к которой падение приходит в `huntPlay`. */
export function fallenMatrix(m: Model, side: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  return placeBeast(out, 0, m.side - m.core.y, 0, 0, 0, side * (Math.PI / 2), m.core);
}

/**
 * Вершины туловища — только те, что целиком на кости тела: по ним правило охоты считает попадание (`hunt.DEER_BODY`
 * стоящему, `hunt.CARCASS` лежащему). Доли морфов `k` и матрица `at` — поза; без них — покой.
 */
export function torsoPoints(m: Model, k?: ArrayLike<number>, at?: THREE.Matrix4): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  m.skins.forEach((s, i) => {
    if (s.a !== BONE.body || s.w !== 0) return;
    const p = k ? morphed(m, k, i) : new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute, i);
    out.push(at ? p.applyMatrix4(at) : p);
  });
  return out;
}

/** Сколько вершин у кости `bone` (целиком на ней): рога оленя — на голове. */
export const bonePoints = (m: Model, bone: number): number => m.skins.filter((s) => s.a === bone && (s.w === 0 || s.b === bone)).length;
