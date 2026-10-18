// Модель покоев (docs/city_v3.md, Г-4): каменная коробка верхнего яруса донжона с нишами окон, шатёр стропил, камин с
// колпаком, дверь к лестнице, кровать под пологом, стол на козлах с документами, кресло правителя, сундуки, оружие на
// стене, шахматы у огня, люстра-обруч и свечи. Всё — в осях комнаты (`plan.ts`), числа — оттуда же.
//
// Выход — три построителя: камень и дерево слоями текстур города (`stone`), нарисованное атласом покоев (`cloth`) — и по
// построителю на каждую безделушку: их берут в руки, они двигаются сами. Где горят свечи и огонь — списком, им светит
// шейдер и рисует пламя `fire.ts`.
import type { V3 } from '../city/geom';
import { tint } from '../city/geom';
import type { Detail } from '../city/kit';
import { Mesher, archOutline, type RoomLayer } from './geo';
import { cellUv, type AtlasCell } from './paint';
import {
  APEX,
  ARMS,
  BED,
  CHAIR,
  CHESS,
  DESK,
  DESK_THINGS,
  DOOR,
  HALF,
  HEARTH,
  OPENINGS,
  TRINKETS,
  WALL_AXES,
  WALL_H,
  WALL_T,
  alongOf,
  box,
  wallPoint,
  type Box,
  type Opening,
  type ThingId,
  type TrinketId,
} from './plan';

/** Краски покоев (sRGB) — тон вершин поверх слоя. */
const HUE = {
  stone: 0xbdb3b0,
  stoneDark: 0x6e6252,
  soot: 0x2a221c,
  lime: 0xd6cab2,
  floor: 0x7a5636,
  beam: 0x4f3826,
  oak: 0x5e3f28,
  oakLight: 0x7d5a3c,
  iron: 0x2b2927,
  gold: 0xd2a84e,
  silver: 0xc4c2ba,
  brass: 0xb58c45,
  linen: 0xe4dbc6,
  red: 0x7d1c17,
  blue: 0x22325c,
  wax: 0xece2c8,
  ivory: 0xe9dfc4,
  dark: 0x4a2418,
  leather: 0x6a4428,
  steel: 0x9aa0a6,
  ember: 0x3a1a0c,
} as const;
const T = (hex: number, k = 1): V3 => tint(hex, k);

/** Где горит свеча: место в осях комнаты, к какой группе она светит (одна лампа на группу) и днём ли горит. */
export interface Flame {
  x: number;
  y: number;
  z: number;
  /** Номер лампы шейдера (`ROOM_LIGHTS`); у люстры — одна лампа на шесть огней. */
  light: number;
  /** Высота языка, м. */
  size: number;
  /** Свеча в руках: пламя едет с безделушкой. */
  trinket?: TrinketId;
}

/** Лампы шейдера: огонь камина — нулевая, дальше свечи по важности (уровень берёт первые `n`). */
export const ROOM_LIGHTS = [
  { name: 'fire', x: HEARTH.fire.x, y: HEARTH.fire.y + 0.25, z: HEARTH.fire.z + 0.35, power: 1 },
  { name: 'chandelier', x: 0, y: 3.15, z: 0.2, power: 0.75 },
  { name: 'desk', x: -0.58, y: DESK.top + 0.34, z: 2.7, power: 0.32 },
  { name: 'standW', x: -1.6, y: 1.62, z: 3.45, power: 0.38 },
  { name: 'standE', x: 1.6, y: 1.62, z: 3.45, power: 0.38 },
  { name: 'bed', x: -2.75, y: 1.3, z: -4.75, power: 0.3 },
  { name: 'chess', x: CHESS.x + 0.33, y: CHESS.top + 0.25, z: CHESS.z - 0.12, power: 0.22 },
  { name: 'sconceW', x: -2.1, y: 2.25, z: HALF - 0.22, power: 0.28 },
  { name: 'sconceE', x: 2.1, y: 2.25, z: HALF - 0.22, power: 0.28 },
  { name: 'door', x: 2.75, y: 2.15, z: -HALF + 0.2, power: 0.25 },
] as const;

/** Коробки, о которые гаснет солнце из окна и темнеет пол под мебелью (шейдер: тень и прижатость). */
export const OCCLUDERS: readonly Box[] = [
  box(-DESK.w / 2, 0.3, DESK.z - DESK.d / 2, DESK.w / 2, DESK.top, DESK.z + DESK.d / 2),
  box(BED.x0, 0, BED.z0, BED.x1, BED.canopy, BED.z1),
  box(CHAIR.x - 0.36, 0, CHAIR.z - 0.32, CHAIR.x + 0.36, 1.45, CHAIR.z + 0.3),
  box(CHESS.x - 0.45, 0.1, CHESS.z - 0.45, CHESS.x + 0.45, CHESS.top, CHESS.z + 0.45),
];

export interface RoomModel {
  stone: Mesher;
  cloth: Mesher;
  /** Безделушки: свой построитель в своих осях (начало — где предмет стоит) и где он лежит в комнате. */
  trinkets: Record<TrinketId, { stone: Mesher; at: V3; yaw: number }>;
  flames: Flame[];
}

/** Собрать покои. `detail` — уровень мелочи (`city/kit.Detail`): стропил, складок, шахмат, граней точёного. */
export function buildRoom(detail: Detail): RoomModel {
  const stone = new Mesher();
  const cloth = new Mesher();
  const flames: Flame[] = [];
  const seg = detail === 0 ? 8 : detail === 1 ? 12 : 16;
  shell(stone, detail);
  roof(stone, detail);
  hearth(stone, cloth);
  door(stone);
  bed(stone, cloth, detail);
  desk(stone, cloth);
  chair(stone, seg);
  chests(stone, seg);
  arms(stone, cloth, seg);
  chessTable(stone, cloth, seg, detail);
  lights(stone, flames, seg);
  floorCloths(cloth);
  const trinkets = {} as RoomModel['trinkets'];
  for (const t of TRINKETS) trinkets[t.id] = trinket(t.id, seg, flames);
  return { stone, cloth, trinkets, flames };
}

// ---------- Оболочка ----------

function shell(m: Mesher, detail: Detail): void {
  // Кладка покоев — мельче городской: её видят с метра.
  m.uvK = 1.6;
  // Пол — доски с запада на восток, у стен темнее (шейдер ещё прижимает углы).
  m.quad([-HALF, 0, HALF], [HALF, 0, HALF], [HALF, 0, -HALF], [-HALF, 0, -HALF], 'wood', T(HUE.floor), [0.85, 0.85, 0.85, 0.85], [
    HALF / 2,
    -HALF / 2,
    HALF / 2,
    HALF / 2,
    -HALF / 2,
    HALF / 2,
    -HALF / 2,
    -HALF / 2,
  ]);
  for (const w of ['south', 'north', 'west', 'east'] as const) {
    const holes: [number, number][][] = [];
    for (const o of OPENINGS.filter((x) => x.wall === w)) {
      const a = alongOf(o);
      holes.push(archOutline(o.inW / 2, o.inSill, o.inSpring, o.inW * 0.24, 10).map(([x, y]) => [-(x + a), y]));
      opening(m, o, detail);
      archRing(m, o);
    }
    if (w === 'north') {
      holes.push(rect(-HEARTH.mouthW / 2, 0, HEARTH.mouthW / 2, HEARTH.mouthH).map(([x, y]) => [-x, y]));
      holes.push(archOutline(DOOR.w / 2, 0, DOOR.h - DOOR.w / 2, DOOR.w / 2, 8).map(([x, y]) => [-(x - DOOR.x), y]));
    }
    const { u } = WALL_AXES[w];
    const o = wallPoint(w, 0, 0, 0);
    // Низ контура — под полом: проёмы от пола (ниша окна, камин, дверь) лежат внутри контура, а не на его краю. Стены —
    // известковая побелка с проступающим бутом; тёсаный камень — у проёмов (откосы, арки, камин).
    m.uvK = 1.15;
    m.plane(o, [-u[0], 0, -u[2]], [0, 1, 0], rect(-HALF, -0.02, HALF, WALL_H + 0.05), holes, 'plaster', T(HUE.lime, 0.9));
    m.uvK = 1.6;
  }
  // Пояс под стропилами: известь, а не камень, — так держится балка в гнезде.
  for (const w of ['south', 'north', 'west', 'east'] as const) {
    const { u } = WALL_AXES[w];
    const a = wallPoint(w, -HALF, WALL_H - 0.32, -0.02);
    const b = wallPoint(w, HALF, WALL_H - 0.32, -0.02);
    m.quad([b[0], b[1], b[2]], [a[0], a[1], a[2]], [a[0], WALL_H + 0.05, a[2]], [b[0], WALL_H + 0.05, b[2]], 'plaster', T(HUE.lime, 0.8));
    void u;
  }
  m.uvK = 1;
}

/** Арка ниши — тёсаный камень светлее кладки, чуть вперёд от стены: проём читается рамой. */
function archRing(m: Mesher, o: Opening): void {
  const w = o.wall;
  const a = alongOf(o);
  const n = 10;
  const inner = archOutline(o.inW / 2, o.inSill, o.inSpring, o.inW * 0.24, n);
  const outer = archOutline(o.inW / 2 + 0.24, o.inSill, o.inSpring, o.inW * 0.24 + 0.24, n);
  // Только дуга и косяки: точки контура 2…n+1 (правая пята, дуга, левая пята) и столбы вниз до низа ниши.
  const arc = (pts: [number, number][]): [number, number][] => [[pts[1][0], o.inSill], ...pts.slice(2), [pts[0][0], o.inSill]];
  const ai = arc(inner);
  const ao = arc(outer);
  const P = (x: number, y: number, d: number): V3 => wallPoint(w, x + a, y, d) as V3;
  for (let k = 0; k + 1 < ai.length; k++) {
    const i0 = ai[k];
    const i1 = ai[k + 1];
    const o0 = ao[k];
    const o1 = ao[k + 1];
    // Лицо к комнате (на 4 см вперёд) и торец к стене — по обходу контура.
    m.quad(P(o0[0], o0[1], -0.04), P(i0[0], i0[1], -0.04), P(i1[0], i1[1], -0.04), P(o1[0], o1[1], -0.04), 'ashlar', T(HUE.lime, 0.82));
    m.quad(P(o0[0], o0[1], 0), P(o0[0], o0[1], -0.04), P(o1[0], o1[1], -0.04), P(o1[0], o1[1], 0), 'ashlar', T(HUE.lime, 0.7));
    m.quad(P(i1[0], i1[1], 0), P(i1[0], i1[1], -0.04), P(i0[0], i0[1], -0.04), P(i0[0], i0[1], 0), 'ashlar', T(HUE.lime, 0.75));
  }
}

/** Ниша окна: откос от комнаты до доски, доска с проёмом (у парного — двумя), короткий откос проёма до наружной грани. */
function opening(m: Mesher, o: Opening, detail: Detail): void {
  const w = o.wall;
  const a = alongOf(o);
  const S = T(HUE.stone, 0.96);
  const n = 10;
  const inner = archOutline(o.inW / 2, o.inSill, o.inSpring, o.inW * 0.24, n);
  const mid = archOutline(o.midW / 2, o.inSill, o.inSpring - 0.08, o.midW * 0.3, n);
  const pt = (pts: [number, number][], depth: number): V3[] => pts.map(([x, y]) => wallPoint(w, x + a, y, depth) as V3);
  m.loft(pt(inner, 0), pt(mid, o.plate), 'ashlar', S, true, 0.8);
  const lights: [number, number][][] = o.twin
    ? [-1, 1].map((sgn) => {
        const h = (o.outW - 0.16) / 4;
        return archOutline(h, o.sill, o.spring, h, 8).map(([x, y]) => [x + sgn * (h + 0.08), y] as [number, number]);
      })
    : [archOutline(o.outW / 2, o.sill, o.spring, o.outW / 2, 12)];
  // Доска: грань к комнате, проёмы — дырами.
  const { u } = WALL_AXES[w];
  const po = wallPoint(w, 0, 0, o.plate);
  m.plane(po, [-u[0], 0, -u[2]], [0, 1, 0], mid.map(([x, y]) => [-(x + a), y]), lights.map((l) => l.map(([x, y]) => [-(x + a), y])), 'ashlar', T(HUE.stone, 0.9));
  for (const l of lights) m.loft(pt(l, o.plate), pt(l, WALL_T + 0.04), 'ashlar', T(HUE.stone, 0.86), true, 0.9);
  if (o.twin) {
    // Столбик между проёмами: ствол, капитель, база.
    const [x, , z] = wallPoint(w, a, 0, o.plate + 0.08);
    m.at(x, 0, z).lathe(
      [
        [0.07, o.sill],
        [0.075, o.sill + 0.08],
        [0.05, o.sill + 0.1],
        [0.05, o.spring - 0.1],
        [0.085, o.spring - 0.02],
        [0.085, o.spring + 0.02],
      ],
      8,
      'ashlar',
      T(HUE.lime, 0.9),
    );
    m.reset();
  }
  if (o.seats) {
    // Каменные сиденья вдоль откосов ниши.
    for (const sgn of [-1, 1]) {
      const p0 = wallPoint(w, a + sgn * (o.inW / 2 - 0.22), 0, 0.05);
      const p1 = wallPoint(w, a + sgn * (o.midW / 2 - 0.2), 0, o.plate - 0.05);
      const x0 = Math.min(p0[0], p1[0]) - 0.18;
      const x1 = Math.max(p0[0], p1[0]) + 0.18;
      const z0 = Math.min(p0[2], p1[2]);
      const z1 = Math.max(p0[2], p1[2]);
      m.cuboid(sgn < 0 ? x0 : x0 + 0.02, 0, z0, sgn < 0 ? x1 - 0.02 : x1, 0.46, z1, 'ashlar', T(HUE.stone, 0.92), { aoLow: 0.6 });
      // Подушка на сиденье.
      m.cuboid(x0 + 0.04, 0.46, z0 + 0.06, x1 - 0.04, 0.53, z1 - 0.06, 'cloth', T(HUE.red, 0.9));
    }
    // Ставни распахнуты внутрь — к откосам.
    for (const sgn of [-1, 1]) {
      const p = wallPoint(w, a + sgn * (o.midW / 2 - 0.06), 0, o.plate - 0.04);
      const q = wallPoint(w, a + sgn * (o.midW / 2 + 0.14), 0, o.plate - 0.9);
      shutter(m, p, q, o.sill + 0.05, o.spring + 0.55);
    }
  }
  if (detail > 0 && !o.seats) {
    for (const sgn of [-1, 1]) {
      const p = wallPoint(w, a + sgn * (o.midW / 2 - 0.05), 0, o.plate - 0.03);
      const q = wallPoint(w, a + sgn * (o.midW / 2 + 0.06), 0, o.plate - 0.55);
      shutter(m, p, q, o.sill, o.spring + 0.3);
    }
  }
}

/** Ставня: доски на шпонках, петли — железом; лежит от петли `p` к краю `q` от низа до верха. */
function shutter(m: Mesher, p: V3, q: V3, y0: number, y1: number): void {
  const W = T(HUE.oak, 0.95);
  const dx = q[0] - p[0];
  const dz = q[2] - p[2];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const t = 0.05;
  const c: V3[] = [
    [p[0], y0, p[2]],
    [q[0], y0, q[2]],
    [q[0], y1, q[2]],
    [p[0], y1, p[2]],
  ];
  const off = (v: V3, k: number): V3 => [v[0] + nx * k, v[1], v[2] + nz * k];
  m.quad(off(c[0], t), off(c[1], t), off(c[2], t), off(c[3], t), 'wood', W);
  m.quad(c[1], c[0], c[3], c[2], 'wood', W);
  m.quad(off(c[1], t), c[1], c[2], off(c[2], t), 'wood', W);
  for (const y of [y0 + 0.25, y1 - 0.25]) m.beam(off([p[0], y, p[2]], t + 0.01), off([q[0], y, q[2]], t + 0.01), 0.02, 0.06, 'plain', T(HUE.iron));
}

function rect(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

// ---------- Шатёр ----------

function roof(m: Mesher, detail: Detail): void {
  const B = T(HUE.beam);
  const eave = WALL_H + 0.05;
  const corners: V3[] = [
    [HALF, eave, HALF],
    [-HALF, eave, HALF],
    [-HALF, eave, -HALF],
    [HALF, eave, -HALF],
  ];
  const apex: V3 = [0, APEX, 0];
  // Обшивка — тёмные доски по скату, грани к комнате.
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    m.quad(a, b, apex, apex, 'wood', T(HUE.beam, 0.62), [0.7, 0.7, 0.45, 0.45]);
  }
  // Мауэрлат по стенам, затяжки с востока на запад, бабка и подкосы.
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const ia: V3 = [a[0] * 0.97, eave - 0.18, a[2] * 0.97];
    const ib: V3 = [b[0] * 0.97, eave - 0.18, b[2] * 0.97];
    m.beam(ia, ib, 0.3, 0.26, 'wood', B);
  }
  for (const z of [-3.4, 0, 3.4]) m.beam([-HALF, 4.56, z], [HALF, 4.56, z], 0.3, 0.34, 'wood', B);
  m.beam([0, 4.7, 0], [0, APEX - 0.1, 0], 0.26, 0.26, 'wood', B);
  for (const s of [-1, 1]) m.beam([0, 6.2, 0], [s * 2.1, 4.75, 0], 0.16, 0.18, 'wood', B);
  // Рёбра шатра и стропила к ним.
  const drop = 0.12;
  for (const c of corners) m.beam([c[0] * 0.98, eave - 0.05, c[2] * 0.98], [0, APEX - drop, 0], 0.22, 0.24, 'wood', B);
  const step = detail === 0 ? 1.0 : 0.62;
  const slope = (APEX - eave) / HALF;
  for (let k = 0; k < 4; k++) {
    const { n, u } = WALL_AXES[(['south', 'east', 'north', 'west'] as const)[k]];
    for (let x = -HALF + step; x < HALF - step * 0.5; x += step) {
      const e = HALF - Math.abs(x);
      const p0: V3 = [n[0] * (HALF - 0.1) + u[0] * x, eave - 0.06, n[2] * (HALF - 0.1) + u[2] * x];
      const reach = (HALF - Math.abs(x)) * 0.98;
      const p1: V3 = [n[0] * (HALF - reach) + u[0] * x, eave + e * slope * 0.98 - drop, n[2] * (HALF - reach) + u[2] * x];
      m.beam(p0, p1, 0.13, 0.16, 'wood', T(HUE.beam, 0.9));
    }
  }
}

// ---------- Камин ----------

function hearth(m: Mesher, cloth: Mesher): void {
  const z0 = -HALF;
  const hw = HEARTH.mouthW / 2;
  // Устье: откос в толщу стены и задняя плита в копоти.
  const mouth = rect(-hw, 0, hw, HEARTH.mouthH).map(([x, y]) => wallPoint('north', x, y, 0) as V3);
  const back = rect(-hw + 0.18, 0, hw - 0.18, HEARTH.mouthH - 0.05).map(([x, y]) => wallPoint('north', x, y, HEARTH.depth) as V3);
  m.loft(mouth, back, 'ashlar', T(HUE.soot, 1.1), true, 0.55);
  m.quad(back[1], back[0], back[3], back[2], 'ashlar', T(HUE.soot, 0.8), [0.8, 0.8, 0.4, 0.4]);
  // Очаг: плита до комнаты.
  m.cuboid(-hw - 0.45, 0, z0 - HEARTH.depth, hw + 0.45, 0.07, z0 + 0.75, 'ashlar', T(HUE.stoneDark, 1.1), { aoLow: 0.8 });
  // Косяки-колонны с капителями, балка, колпак до свода.
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.2);
    m.cuboid(x - 0.16, 0.07, z0 + 0.05, x + 0.16, HEARTH.hoodLow - 0.18, z0 + 0.5, 'ashlar', T(HUE.stone, 0.95), { aoLow: 0.7 });
    m.cuboid(x - 0.22, HEARTH.hoodLow - 0.18, z0 + 0.0, x + 0.22, HEARTH.hoodLow, z0 + 0.62, 'ashlar', T(HUE.lime, 0.9));
  }
  const fz = HEARTH.hoodFront;
  const lo = HEARTH.hoodLow;
  const hw2 = HEARTH.hoodW / 2;
  m.cuboid(-hw2, lo, z0, hw2, lo + 0.22, fz + 0.02, 'ashlar', T(HUE.lime, 0.95));
  // Колпак: сужается к стене и вверх; копоть снизу.
  const y1 = lo + 0.22;
  const top = HEARTH.hoodTop;
  const tw = 0.8;
  const fl: V3 = [-hw2, y1, fz];
  const fr: V3 = [hw2, y1, fz];
  const tl: V3 = [-tw, top, z0];
  const tr: V3 = [tw, top, z0];
  m.uvK = 1.6;
  m.quad(fl, fr, tr, tl, 'ashlar', T(HUE.stone, 0.95), [0.5, 0.5, 0.95, 0.95]);
  m.quad([-hw2, y1, z0], fl, tl, tl, 'ashlar', T(HUE.stone, 0.88), [0.45, 0.5, 0.9, 0.9]);
  m.quad(fr, [hw2, y1, z0], tr, tr, 'ashlar', T(HUE.stone, 0.88), [0.5, 0.45, 0.9, 0.9]);
  m.uvK = 1;
  // Таганы и поленья: низ поленьев тлеет (свечение), верх обуглен.
  const fz0 = HEARTH.fire.z;
  for (const s of [-1, 1]) {
    m.cuboid(s * 0.42 - 0.03, 0.07, fz0 - 0.25, s * 0.42 + 0.03, 0.3, fz0 + 0.28, 'plain', T(HUE.iron), {});
    m.at(s * 0.42, 0.3, fz0 + 0.28).lathe(
      [
        [0.05, 0],
        [0.05, 0.08],
        [0.0, 0.14],
      ],
      6,
      'plain',
      T(HUE.iron),
    );
    m.reset();
  }
  m.glow = 0.55;
  log(m, [-0.62, 0.3, fz0 + 0.05], [0.62, 0.32, fz0 - 0.05], 0.1);
  log(m, [-0.55, 0.36, fz0 + 0.22], [0.5, 0.42, fz0 - 0.18], 0.085);
  m.glow = 0.9;
  log(m, [-0.38, 0.12, fz0 + 0.1], [0.42, 0.11, fz0 - 0.08], 0.07);
  m.glow = 0;
  // Поленница у камина.
  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 3);
    const k = i % 3;
    const x = 1.95 + k * 0.17 + (row % 2) * 0.08;
    log(m, [x, 0.09 + row * 0.15, -5.08], [x, 0.09 + row * 0.15, -4.45], 0.075);
  }
  // Шкура у огня — атласом (`floorCloths`); метла и щипцы у косяка.
  m.beam([-1.55, 0.07, -4.6], [-1.42, 1.1, -4.95], 0.03, 0.03, 'plain', T(HUE.iron));
  m.beam([-1.66, 0.07, -4.62], [-1.52, 1.05, -4.98], 0.03, 0.03, 'wood', T(HUE.oak));
  void cloth;
}

/** Полено — круглое, с торцами: точёным телом вдоль оси от `a` к `e`. */
function log(m: Mesher, a: V3, e: V3, r: number): void {
  cyl(m, a, e, r, 'wood', T(HUE.oak, m.glow > 0 ? 0.55 : 0.85), 7);
}

/** Цилиндр между двумя точками — точёным телом: ось тела (y своих осей) кладётся на отрезок наклоном и поворотом. */
function cyl(m: Mesher, a: V3, e: V3, r: number, layer: RoomLayer, t: V3, seg: number): void {
  const dx = e[0] - a[0];
  const dy = e[1] - a[1];
  const dz = e[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dz);
  m.at(a[0], a[1], a[2], Math.atan2(dx, dz), Math.atan2(flat, dy)).lathe(
    [
      [0, 0],
      [r, 0],
      [r * 0.96, len * 0.5],
      [r, len],
      [0, len],
    ],
    seg,
    layer,
    t,
  );
  m.reset();
}

// ---------- Дверь ----------

function door(m: Mesher): void {
  const a = -DOOR.x;
  const hw = DOOR.w / 2;
  const out = archOutline(hw, 0, DOOR.h - hw, hw, 8);
  const pts = (d: number, k: number): V3[] => out.map(([x, y]) => wallPoint('north', x * k + a, y * (k < 1 ? 0.97 : 1), d) as V3);
  m.loft(pts(0, 1), pts(0.32, 0.94), 'ashlar', T(HUE.stone, 0.88), true, 0.7);
  const leaf = pts(0.32, 0.94);
  const { u } = WALL_AXES.north;
  const o = wallPoint('north', 0, 0, 0.32);
  m.plane(o, [-u[0], 0, -u[2]], [0, 1, 0], leaf.map((p) => [p[0], p[1]] as [number, number]), [], 'wood', T(HUE.oak, 0.9));
  for (const y of [0.45, 1.25, 1.95]) m.beam([DOOR.x - hw * 0.9, y, -HALF - 0.3], [DOOR.x + hw * 0.9, y, -HALF - 0.3], 0.025, 0.07, 'plain', T(HUE.iron));
  m.at(DOOR.x - hw * 0.55, 1.05, -HALF - 0.28, 0, Math.PI / 2).lathe(
    [
      [0.0, -0.02],
      [0.06, -0.02],
      [0.07, 0],
      [0.06, 0.02],
      [0.0, 0.02],
    ],
    10,
    'plain',
    T(HUE.iron),
  );
  m.reset();
}

// ---------- Кровать ----------

function bed(m: Mesher, cloth: Mesher, detail: Detail): void {
  const O = T(HUE.oak);
  const { x0, x1, z0, z1, top, canopy } = BED;
  for (const [x, z] of [
    [x0 + 0.06, z0 + 0.06],
    [x1 - 0.06, z0 + 0.06],
    [x0 + 0.06, z1 - 0.06],
    [x1 - 0.06, z1 - 0.06],
  ]) {
    m.cuboid(x - 0.065, 0, z - 0.065, x + 0.065, canopy, z + 0.065, 'wood', O, { aoLow: 0.55 });
    m.at(x, canopy, z).lathe(
      [
        [0.08, 0],
        [0.09, 0.04],
        [0.05, 0.1],
        [0.0, 0.16],
      ],
      8,
      'wood',
      O,
    );
    m.reset();
  }
  // Рама, матрас, изголовье.
  m.cuboid(x0 + 0.02, 0.2, z0 + 0.02, x1 - 0.02, 0.38, z1 - 0.02, 'wood', T(HUE.oak, 0.9), { aoLow: 0.7 });
  m.cuboid(x0 + 0.08, 0.38, z0 + 0.1, x1 - 0.08, top, z1 - 0.06, 'cloth', T(HUE.linen, 0.95));
  m.cuboid(x0 + 0.06, 0.38, z0 + 0.0, x1 - 0.06, 1.25, z0 + 0.08, 'wood', T(HUE.oak, 0.85));
  // Валик и подушка у изголовья.
  m.at((x0 + x1) / 2, top + 0.09, z0 + 0.32, Math.PI / 2, Math.PI / 2).lathe(
    [
      [0.0, -0.78],
      [0.07, -0.76],
      [0.11, -0.6],
      [0.11, 0.6],
      [0.07, 0.76],
      [0.0, 0.78],
    ],
    10,
    'cloth',
    T(HUE.linen),
  );
  m.reset();
  // Покрывало — атласом: верх и свес по бокам и в ногах.
  const cz0 = z0 + 0.55;
  const cy = top + 0.02;
  const hang = 0.36;
  cloth.code = 0;
  cloth.quad([x0 + 0.04, cy, z1 - 0.02], [x1 - 0.04, cy, z1 - 0.02], [x1 - 0.04, cy, cz0], [x0 + 0.04, cy, cz0], 'cloth', T(0xffffff), [1, 1, 0.9, 0.9], cellUv('cover', 0, 0, 1, 0.82));
  cloth.quad([x1 - 0.02, cy - hang, z1 - 0.02], [x1 - 0.02, cy - hang, cz0], [x1 - 0.04, cy, cz0], [x1 - 0.04, cy, z1 - 0.02], 'cloth', T(0xffffff), [0.7, 0.7, 1, 1], cellUv('cover', 0, 0, 0.18, 1));
  cloth.quad([x0 + 0.04, cy - hang, z1], [x1 - 0.04, cy - hang, z1], [x1 - 0.04, cy, z1 - 0.02], [x0 + 0.04, cy, z1 - 0.02], 'cloth', T(0xffffff), [0.7, 0.7, 1, 1], cellUv('cover', 0, 0, 1, 0.18));
  // Полог: доска над кроватью, подзор, занавеси у стены и собранные у столбов.
  m.cuboid(x0, canopy - 0.06, z0, x1, canopy, z1, 'wood', T(HUE.oak, 0.8), {});
  // Подбой полога — синее сукно складками, лицом вниз.
  const ly = canopy - 0.075;
  const nf = detail === 0 ? 4 : 8;
  for (let i = 0; i < nf; i++) {
    const za = z0 + ((z1 - z0) * i) / nf;
    const zb = z0 + ((z1 - z0) * (i + 1)) / nf;
    const sag = i % 2 ? 0.05 : 0;
    m.quad([x0 + 0.02, ly - sag, za], [x1 - 0.02, ly - sag, za], [x1 - 0.02, ly - 0.05 + sag, zb], [x0 + 0.02, ly - 0.05 + sag, zb], 'cloth', T(HUE.blue, 1.1), [0.85, 0.85, 0.85, 0.85]);
  }
  const R = T(HUE.red, 0.95);
  const valance = (a: V3, b: V3): void => folds(m, a, b, canopy - 0.36, canopy - 0.06, R, detail, 0.04);
  valance([x0, 0, z1 + 0.01], [x1, 0, z1 + 0.01]);
  valance([x1 + 0.01, 0, z1], [x1 + 0.01, 0, z0]);
  // Западная занавесь — вдоль стены во всю длину; изголовье — гобелен с гербом на северной стене.
  folds(m, [x0 + 0.02, 0, z0 + 0.1], [x0 + 0.02, 0, z1 - 0.1], 0.3, canopy - 0.36, R, detail, 0.07);
  // Собраны у изголовья с востока и в ногах с запада: восточный край в ногах открыт — из кровати видно покои и огонь.
  for (const [x, z] of [
    [x1 - 0.06, z0 + 0.06],
    [x0 + 0.06, z1 - 0.06],
  ]) {
    m.at(x + 0.05, 0.25, z + 0.05).lathe(
      [
        [0.09, 0],
        [0.16, 0.6],
        [0.11, 1.15],
        [0.07, 1.35],
        [0.12, 1.6],
        [0.17, 2.0],
        [0.0, 2.05],
      ],
      detail === 0 ? 6 : 10,
      'cloth',
      R,
    );
    m.reset();
  }
  // Гобелен изголовья.
  cloth.quad([x0 + 0.08, 0.72, -HALF + 0.03], [x1 - 0.06, 0.72, -HALF + 0.03], [x1 - 0.06, 3.0, -HALF + 0.03], [x0 + 0.08, 3.0, -HALF + 0.03], 'cloth', T(0xffffff), [0.8, 0.8, 1, 1], cellUv('tapA'));
}

/** Складки ткани между двумя точками плана от `y0` до `y1`: зигзаг граней, глубина `deep`. */
function folds(m: Mesher, a: V3, b: V3, y0: number, y1: number, t: V3, detail: Detail, deep: number): void {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const n = Math.max(2, Math.round(len / (detail === 0 ? 0.4 : 0.22)));
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const d0 = i % 2 ? deep : -deep;
    const d1 = i % 2 ? -deep : deep;
    const p0: V3 = [a[0] + dx * t0 + nx * d0, 0, a[2] + dz * t0 + nz * d0];
    const p1: V3 = [a[0] + dx * t1 + nx * d1, 0, a[2] + dz * t1 + nz * d1];
    const sh = i % 2 ? 0.86 : 1;
    // Двусторонняя ткань: грань к обеим сторонам.
    m.quad([p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], 'cloth', t, [0.7 * sh, 0.7 * sh, sh, sh]);
    m.quad([p1[0], y0, p1[2]], [p0[0], y0, p0[2]], [p0[0], y1, p0[2]], [p1[0], y1, p1[2]], 'cloth', t, [0.6, 0.6, 0.85, 0.85]);
  }
}

// ---------- Стол и предметы на нём ----------

function desk(m: Mesher, cloth: Mesher): void {
  const O = T(HUE.oakLight);
  const { z, w, d, top } = DESK;
  m.cuboid(-w / 2, top - 0.07, z - d / 2, w / 2, top, z + d / 2, 'wood', O, {});
  // Козлы: две пары ног враспор, брус под столешницей, перекладина.
  for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
    m.beam([x, top - 0.08, z - d / 2 + 0.12], [x, top - 0.08, z + d / 2 - 0.12], 0.1, 0.1, 'wood', T(HUE.oak));
    for (const s of [-1, 1]) m.beam([x, top - 0.1, z + s * 0.08], [x, 0.0, z + s * 0.4], 0.09, 0.09, 'wood', T(HUE.oak));
  }
  m.beam([-w / 2 + 0.3, 0.32, z], [w / 2 - 0.3, 0.32, z], 0.08, 0.08, 'wood', T(HUE.oak));
  // Предметы стола — каждый своим номером (подсветка касанием).
  const y = top;
  const by = (id: ThingId): Box => DESK_THINGS.find((t) => t.id === id)!.box;
  // Карта развёрнута, края придавлены.
  const mb = by('map');
  cloth.code = code('map');
  sheet(cloth, mb, y + 0.004, 'map');
  m.code = code('map');
  m.cuboid(mb.x0 - 0.02, y, mb.z0 + 0.02, mb.x0 + 0.04, y + 0.03, mb.z0 + 0.08, 'plain', T(HUE.iron));
  m.cuboid(mb.x1 - 0.04, y, mb.z1 - 0.08, mb.x1 + 0.02, y + 0.03, mb.z1 - 0.02, 'plain', T(HUE.iron));
  // Письма: три сложенных листа стопкой, верхний — наискось.
  const lb = by('letters');
  cloth.code = code('letters');
  for (let i = 0; i < 3; i++) {
    const cx = (lb.x0 + lb.x1) / 2 + (i - 1) * 0.015;
    const cz = (lb.z0 + lb.z1) / 2 + (i - 1) * 0.01;
    m.code = code('letters');
    m.at(cx, y + i * 0.008, cz, -0.14 + i * 0.12).cuboid(-0.125, 0, -0.085, 0.125, 0.0075, 0.085, 'plain', T(0xd8c49a), { skip: '-y' });
    cloth.at(cx, y + i * 0.008, cz, -0.14 + i * 0.12);
    cloth.quad([0.125, 0.0075, -0.085], [-0.125, 0.0075, -0.085], [-0.125, 0.0075, 0.085], [0.125, 0.0075, 0.085], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv('letter'));
  }
  cloth.reset();
  m.reset();
  // Чернильница и перо у писем.
  m.code = code('letters');
  m.at(0.41, y, 2.86).lathe(
    [
      [0.03, 0],
      [0.035, 0.04],
      [0.02, 0.055],
      [0.012, 0.06],
      [0, 0.06],
    ],
    8,
    'plain',
    T(HUE.dark),
  );
  m.reset();
  m.beam([0.41, y + 0.05, 2.86], [0.5, y + 0.26, 2.94], 0.008, 0.03, 'plain', T(HUE.linen));
  // Свиток указов: развёрнут наполовину, второй конец — рулоном.
  const sb = by('decrees');
  cloth.code = code('decrees');
  sheet(cloth, { ...sb, x1: sb.x1 - 0.08 }, y + 0.004, 'scroll', true);
  m.code = code('decrees');
  roll(m, [sb.x1 - 0.06, y + 0.04, sb.z0 + 0.02], [sb.x1 - 0.06, y + 0.04, sb.z1 - 0.02], 0.038);
  roll(m, [sb.x0 + 0.02, y + 0.03, sb.z0 + 0.02], [sb.x0 + 0.02, y + 0.03, sb.z1 - 0.02], 0.026);
  // Список людей — раскрытая книга.
  const pb = by('people');
  m.code = code('people');
  m.cuboid(pb.x0, y, pb.z0, pb.x1, y + 0.035, pb.z1, 'cloth', T(HUE.leather, 0.8), {});
  cloth.code = code('people');
  sheet(cloth, { ...pb, x0: pb.x0 + 0.02, x1: pb.x1 - 0.02, z0: pb.z0 + 0.02, z1: pb.z1 - 0.02 }, y + 0.037, 'ledger');
  // Перечень войска — длинный лист.
  const ab = by('army');
  cloth.code = code('army');
  cloth.at((ab.x0 + ab.x1) / 2, y + 0.006, (ab.z0 + ab.z1) / 2, -0.12);
  cloth.quad([0.12, 0, -0.19], [-0.12, 0, -0.19], [-0.12, 0, 0.19], [0.12, 0, 0.19], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv('roll'));
  cloth.reset();
  m.code = code('army');
  roll(m, [ab.x0 + 0.06, y + 0.025, ab.z1 - 0.03], [ab.x1 - 0.06, y + 0.025, ab.z1 + 0.02], 0.024);
  // Планы: лист с чертежом под циркулем и линейкой.
  const plb = by('plans');
  cloth.code = code('plans');
  sheet(cloth, plb, y + 0.008, 'plans');
  m.code = code('plans');
  m.beam([plb.x0 + 0.05, y + 0.015, plb.z0 + 0.04], [plb.x1 - 0.1, y + 0.015, plb.z0 + 0.06], 0.03, 0.012, 'wood', T(HUE.oakLight, 1.1));
  m.shine = 0.7;
  m.beam([plb.x1 - 0.22, y + 0.02, plb.z1 - 0.05], [plb.x1 - 0.12, y + 0.02, plb.z0 + 0.06], 0.008, 0.008, 'plain', T(HUE.brass));
  m.beam([plb.x1 - 0.22, y + 0.02, plb.z1 - 0.05], [plb.x1 - 0.3, y + 0.02, plb.z0 + 0.07], 0.008, 0.008, 'plain', T(HUE.brass));
  m.shine = 0;
  // Кошель: кожаный мешочек, монеты рядом.
  const ub = by('purse');
  m.code = code('purse');
  m.at((ub.x0 + ub.x1) / 2, y, (ub.z0 + ub.z1) / 2 + 0.02).lathe(
    [
      [0.032, 0],
      [0.06, 0.028],
      [0.056, 0.065],
      [0.025, 0.095],
      [0.03, 0.115],
      [0.0, 0.12],
    ],
    10,
    'cloth',
    T(HUE.leather),
  );
  m.shine = 1;
  for (let i = 0; i < 5; i++) {
    m.at(ub.x1 + 0.02 + (i % 2) * 0.025, y + 0.002 + i * 0.004, ub.z0 + 0.01 + i * 0.011).lathe(
      [
        [0.0, 0],
        [0.016, 0],
        [0.016, 0.004],
        [0.0, 0.004],
      ],
      8,
      'plain',
      T(HUE.gold),
    );
  }
  m.shine = 0;
  m.reset();
  // Печать: рукоять дуба, лицо — медь с гербом (атлас снизу не виден — лицо смотрит вверх, печать лежит на боку).
  const eb = by('seal');
  const ex = (eb.x0 + eb.x1) / 2;
  const ez = (eb.z0 + eb.z1) / 2;
  m.code = code('seal');
  m.at(ex, y, ez).lathe(
    [
      [0.035, 0],
      [0.035, 0.015],
      [0.02, 0.03],
      [0.014, 0.06],
      [0.024, 0.1],
      [0.02, 0.12],
      [0.0, 0.125],
    ],
    10,
    'wood',
    T(HUE.dark, 1.1),
  );
  m.reset();
  m.code = 0;
  cloth.code = 0;
}

/** Номер предмета по имени — для подсветки. */
const code = (id: ThingId): number => DESK_THINGS.find((t) => t.id === id)?.code ?? TRINKETS.find((t) => t.id === id)?.code ?? 0;

/**
 * Лист на столе: клетка атласа на коробке, чуть приподнят; `curl` — край загнут к рулону. Низ листа — к креслу (юг стола —
 * дальний край), левый край — к востоку: правитель сидит лицом на юг, и восток у него слева.
 */
function sheet(c: Mesher, b: Box, y: number, cell: AtlasCell, curl = false): void {
  const yw = y + (curl ? 0.012 : 0);
  c.quad([b.x1, y, b.z0], [b.x0, yw, b.z0], [b.x0, yw, b.z1], [b.x1, y, b.z1], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv(cell));
}

/** Рулон пергамента. */
function roll(m: Mesher, a: V3, e: V3, r: number): void {
  const dx = e[0] - a[0];
  const dz = e[2] - a[2];
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  m.at((a[0] + e[0]) / 2, a[1], (a[2] + e[2]) / 2, yaw, Math.PI / 2).lathe(
    [
      [0, -len / 2],
      [r, -len / 2],
      [r, len / 2],
      [0, len / 2],
    ],
    10,
    'plaster',
    T(0xdcc89c),
  );
  m.reset();
}

// ---------- Кресло ----------

function chair(m: Mesher, seg: number): void {
  const O = T(HUE.oak, 0.95);
  const { x, z } = CHAIR;
  const sy = 0.48;
  const hw = 0.32;
  const z0 = z - 0.27;
  const z1 = z + 0.25;
  m.cuboid(x - hw, sy - 0.07, z0, x + hw, sy, z1, 'wood', O, {});
  for (const [px, pz, h] of [
    [x - hw + 0.04, z1 - 0.04, 0.78],
    [x + hw - 0.04, z1 - 0.04, 0.78],
    [x - hw + 0.04, z0 + 0.04, 1.52],
    [x + hw - 0.04, z0 + 0.04, 1.52],
  ] as const) {
    m.cuboid(px - 0.045, 0, pz - 0.045, px + 0.045, h, pz + 0.045, 'wood', O, { aoLow: 0.55 });
    m.at(px, h, pz).lathe(
      [
        [0.05, 0],
        [0.065, 0.04],
        [0.035, 0.09],
        [0.0, 0.12],
      ],
      seg,
      'wood',
      T(HUE.gold, 0.9),
    );
    m.reset();
  }
  // Подлокотники, спинка филёнкой, перекладины.
  for (const s of [-1, 1]) m.beam([x + s * (hw - 0.04), 0.74, z0 + 0.04], [x + s * (hw - 0.04), 0.74, z1 - 0.02], 0.07, 0.05, 'wood', O);
  m.cuboid(x - hw + 0.08, sy + 0.08, z0 + 0.0, x + hw - 0.08, 1.42, z0 + 0.06, 'wood', T(HUE.oak, 0.85), {});
  m.cuboid(x - hw + 0.02, 1.36, z0 - 0.01, x + hw - 0.02, 1.47, z0 + 0.07, 'wood', O, {});
  m.beam([x - hw + 0.04, 0.16, z0 + 0.04], [x + hw - 0.04, 0.16, z0 + 0.04], 0.05, 0.05, 'wood', O);
  m.beam([x - hw + 0.04, 0.16, z1 - 0.04], [x + hw - 0.04, 0.16, z1 - 0.04], 0.05, 0.05, 'wood', O);
  // Подушка червлёная.
  m.cuboid(x - hw + 0.04, sy, z0 + 0.06, x + hw - 0.04, sy + 0.07, z1 - 0.02, 'cloth', T(HUE.red, 0.95), {});
  m.cuboid(x - hw + 0.1, sy + 0.12, z0 + 0.06, x + hw - 0.1, 1.3, z0 + 0.11, 'cloth', T(HUE.red, 0.85), {});
}

// ---------- Сундуки ----------

function chests(m: Mesher, seg: number): void {
  const one = (x0: number, z0: number, x1: number, z1: number, h: number): void => {
    m.cuboid(x0, 0, z0, x1, h - 0.08, z1, 'wood', T(HUE.oak, 0.9), { aoLow: 0.55 });
    m.cuboid(x0 - 0.015, h - 0.08, z0 - 0.015, x1 + 0.015, h, z1 + 0.015, 'wood', T(HUE.oak, 1.0), {});
    // Железные полосы и замок.
    const along = x1 - x0 > z1 - z0;
    for (const t of [0.12, 0.5, 0.88]) {
      if (along) {
        const x = x0 + (x1 - x0) * t;
        m.cuboid(x - 0.025, 0.02, z0 - 0.02, x + 0.025, h + 0.005, z1 + 0.02, 'plain', T(HUE.iron), {});
      } else {
        const z = z0 + (z1 - z0) * t;
        m.cuboid(x0 - 0.02, 0.02, z - 0.025, x1 + 0.02, h + 0.005, z + 0.025, 'plain', T(HUE.iron), {});
      }
    }
    void seg;
  };
  one(BED.x0 + 0.25, BED.z1 + 0.12, BED.x1 - 0.2, BED.z1 + 0.62, 0.55);
  one(4.32, ARMS.z - 0.62, 4.95, ARMS.z + 0.62, 0.58);
  one(-4.95, 3.65, -3.95, 4.6, 0.52);
  // Подушка под короной на восточном сундуке.
  m.cuboid(4.42, 0.58, ARMS.z - 0.26, 4.86, 0.66, ARMS.z + 0.26, 'cloth', T(HUE.red, 1.0), {});
  // Шлем на сундуке у юго-западного угла.
  m.shine = 0.6;
  m.at(-4.45, 0.52, 4.12).lathe(
    [
      [0.13, 0],
      [0.135, 0.06],
      [0.125, 0.15],
      [0.09, 0.24],
      [0.03, 0.3],
      [0.0, 0.31],
    ],
    12,
    'plain',
    T(HUE.steel, 0.8),
  );
  m.reset();
  m.cuboid(-4.47, 0.54, 4.24, -4.43, 0.72, 4.26, 'plain', T(HUE.steel, 0.8), {});
  m.shine = 0;
}

// ---------- Стена оружия ----------

function arms(m: Mesher, cloth: Mesher, seg: number): void {
  const x = HALF - 0.04;
  const z = ARMS.z;
  const y = ARMS.y;
  // Щит с гербом державы — атласом, по контуру щита (обрезка по альфе).
  cloth.code = 0;
  cloth.quad([x - 0.02, y - 0.5, z - 0.4], [x - 0.02, y - 0.5, z + 0.4], [x - 0.02, y + 0.5, z + 0.4], [x - 0.02, y + 0.5, z - 0.4], 'cloth', T(0xffffff), [0.9, 0.9, 1, 1], cellUv('shield'));
  // За щитом — копья накрест, у края — секира.
  for (const s of [-1, 1]) {
    m.beam([x - 0.01, y - 1.15, z - s * 1.05], [x - 0.01, y + 1.1, z + s * 1.0], 0.035, 0.035, 'wood', T(HUE.oak, 1.1));
    m.shine = 0.8;
    const tipZ = z + s * 1.0;
    m.at(x - 0.015, y + 1.1, tipZ, 0, s * 0.74).lathe(
      [
        [0.025, 0],
        [0.04, 0.08],
        [0.0, 0.3],
      ],
      4,
      'plain',
      T(HUE.steel),
    );
    m.reset();
    m.shine = 0;
  }
  m.beam([x - 0.02, 0.9, z + 1.45], [x - 0.02, 2.4, z + 1.45], 0.04, 0.04, 'wood', T(HUE.oak, 1.1));
  m.shine = 0.7;
  m.cuboid(x - 0.035, 2.05, z + 1.45, x - 0.005, 2.35, z + 1.8, 'plain', T(HUE.steel, 0.9), {});
  m.shine = 0;
  // Колышки под мечом.
  for (const dz of [-0.55, 0.45]) m.beam([HALF, 1.48, z + dz], [HALF - 0.14, 1.5, z + dz], 0.03, 0.03, 'wood', T(HUE.oak));
  void seg;
}

// ---------- Шахматы ----------

function chessTable(m: Mesher, cloth: Mesher, seg: number, detail: Detail): void {
  const { x, z, top, board } = CHESS;
  m.at(x, 0, z).lathe(
    [
      [0.3, 0],
      [0.3, 0.04],
      [0.08, 0.1],
      [0.06, 0.4],
      [0.09, top - 0.06],
      [0.42, top - 0.04],
      [0.42, top],
      [0.0, top],
    ],
    seg + 4,
    'wood',
    T(HUE.oak, 0.95),
    0.6,
  );
  m.reset();
  cloth.code = 0;
  const h = board / 2;
  cloth.quad([x - h, top + 0.012, z + h], [x + h, top + 0.012, z + h], [x + h, top + 0.012, z - h], [x - h, top + 0.012, z - h], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv('chess'));
  m.cuboid(x - h - 0.01, top, z - h - 0.01, x + h + 0.01, top + 0.011, z + h + 0.01, 'wood', T(HUE.dark), {});
  // Фигуры: две последние горизонтали у каждой стороны (у «Низкого» — только старшие).
  const sq = board / 8;
  const rows = detail === 0 ? [0, 7] : [0, 1, 6, 7];
  for (const r of rows) {
    for (let c = 0; c < 8; c++) {
      const white = r < 4;
      // Белый король — безделушка (`TRINKETS.chess`): его клетка пуста.
      if (white && r === 0 && c === 4) continue;
      const px = x - h + sq * (c + 0.5);
      const pz = z + h - sq * (r + 0.5);
      const pawn = r === 1 || r === 6;
      const hgt = pawn ? 0.045 : c === 3 || c === 4 ? 0.085 : c === 0 || c === 7 ? 0.06 : 0.068;
      m.at(px, top + 0.012, pz).lathe(piece(hgt), detail === 0 ? 6 : 8, 'plain', white ? T(HUE.ivory) : T(HUE.dark, 1.1));
    }
  }
  m.reset();
  // Табуреты.
  for (const [sx, sz] of [
    [x - 0.75, z + 0.1],
    [x + 0.75, z - 0.1],
  ]) {
    m.at(sx, 0, sz).lathe(
      [
        [0.18, 0],
        [0.18, 0.03],
        [0.06, 0.06],
        [0.05, 0.36],
        [0.2, 0.4],
        [0.2, 0.45],
        [0.0, 0.46],
      ],
      seg,
      'wood',
      T(HUE.oak),
      0.6,
    );
    m.reset();
  }
}

/** Шахматная фигура — профилем: основание, стан, голова. */
function piece(h: number): [number, number][] {
  return [
    [0.0, 0],
    [0.017, 0],
    [0.018, h * 0.12],
    [0.01, h * 0.25],
    [0.008, h * 0.6],
    [0.013, h * 0.72],
    [0.011, h * 0.88],
    [0.0, h],
  ];
}

// ---------- Свет ----------

function lights(m: Mesher, flames: Flame[], seg: number): void {
  const I = T(HUE.iron);
  const W = T(HUE.wax);
  // Люстра-обруч на цепях с центральной затяжки.
  const cy = 3.2;
  const r = 0.55;
  const cz = 0.2;
  const n = 6;
  m.shine = 0.4;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    m.beam([Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], [Math.cos(a1) * r, cy, cz + Math.sin(a1) * r], 0.04, 0.06, 'plain', I);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    m.beam([Math.cos(a) * r, cy, cz + Math.sin(a) * r], [0, 4.4, 0], 0.012, 0.012, 'plain', I);
  }
  m.shine = 0;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / n;
    const px = Math.cos(a) * r;
    const pz = cz + Math.sin(a) * r;
    candle(m, px, cy + 0.03, pz, 0.16, seg);
    flames.push({ x: px, y: cy + 0.03 + 0.18, z: pz, light: 1, size: 0.05 });
  }
  // Подсвечники на полу у стола — высокие, кованые.
  for (const [s, light] of [
    [-1, 3],
    [1, 4],
  ] as const) {
    const x = s * 1.6;
    const z = 3.45;
    m.shine = 0.35;
    m.at(x, 0, z).lathe(
      [
        [0.17, 0],
        [0.17, 0.03],
        [0.04, 0.1],
        [0.025, 0.3],
        [0.035, 0.34],
        [0.02, 0.38],
        [0.02, 1.32],
        [0.09, 1.36],
        [0.1, 1.4],
        [0.0, 1.4],
      ],
      seg,
      'plain',
      I,
      0.6,
    );
    m.reset();
    m.shine = 0;
    candle(m, x, 1.4, z, 0.22, seg);
    flames.push({ x, y: 1.4 + 0.24, z, light, size: 0.06 });
  }
  // Подсвечник у кровати, на столике у шахмат, бра у окна и у двери.
  const stand = (x: number, z: number, h: number, light: number): void => {
    m.shine = 0.35;
    m.at(x, 0, z).lathe(
      [
        [0.13, 0],
        [0.13, 0.03],
        [0.03, 0.09],
        [0.02, h - 0.04],
        [0.08, h],
        [0.0, h],
      ],
      seg,
      'plain',
      I,
      0.6,
    );
    m.reset();
    m.shine = 0;
    candle(m, x, h, z, 0.18, seg);
    flames.push({ x, y: h + 0.2, z, light, size: 0.055 });
  };
  stand(-2.75, -4.75, 1.08, 5);
  candle(m, CHESS.x + 0.33, CHESS.top, CHESS.z - 0.12, 0.12, seg);
  flames.push({ x: CHESS.x + 0.33, y: CHESS.top + 0.14, z: CHESS.z - 0.12, light: 6, size: 0.045 });
  const sconce = (x: number, y: number, z: number, nz: number, light: number): void => {
    m.beam([x, y - 0.25, z + nz * 0.04], [x, y - 0.02, z + nz * 0.22], 0.025, 0.025, 'plain', I);
    m.cuboid(x - 0.07, y - 0.32, z - 0.02 * nz - 0.02, x + 0.07, y - 0.12, z - 0.02 * nz + 0.02, 'plain', I, {});
    m.at(x, y - 0.02, z + nz * 0.22).lathe(
      [
        [0.06, 0],
        [0.065, 0.02],
        [0.0, 0.02],
      ],
      seg,
      'plain',
      I,
    );
    m.reset();
    candle(m, x, y, z + nz * 0.22, 0.16, seg);
    flames.push({ x, y: y + 0.18, z: z + nz * 0.22, light, size: 0.05 });
  };
  sconce(-2.1, 2.07, HALF, -1, 7);
  sconce(2.1, 2.07, HALF, -1, 8);
  sconce(2.75, 1.97, -HALF, 1, 9);
  void W;
}

/** Свеча: столбик воска с наплывом; низ темнее, верх у фитиля светлее (свечение). */
function candle(m: Mesher, x: number, y: number, z: number, h: number, seg: number): void {
  const W = T(HUE.wax);
  m.at(x, y, z).lathe(
    [
      [0.026, 0],
      [0.022, 0.015],
      [0.019, h * 0.4],
      [0.018, h],
      [0.0, h + 0.004],
    ],
    Math.max(6, seg - 4),
    'plain',
    W,
  );
  m.reset();
}

// ---------- Ковёр и шкура ----------

function floorCloths(c: Mesher): void {
  c.code = 0;
  const y = 0.012;
  // Ковёр посреди покоев, под люстрой: под столом — доски (вблизи из кресла ткань атласа мылится, а доски слоя — нет).
  c.quad([-1.6, y, 1.05], [1.6, y, 1.05], [1.6, y, -1.4], [-1.6, y, -1.4], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv('rug'));
  // Медвежья шкура у огня (обрезка по альфе).
  c.quad([-1.35, y + 0.004, -2.55], [1.35, y + 0.004, -2.55], [1.35, y + 0.004, -4.35], [-1.35, y + 0.004, -4.35], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv('fur'));
  // Гобелен на западной стене — на шесте.
  c.quad([-HALF + 0.04, 0.85, 0.65], [-HALF + 0.04, 0.85, -1.95], [-HALF + 0.04, 3.55, -1.95], [-HALF + 0.04, 3.55, 0.65], 'cloth', T(0xffffff), [0.8, 0.8, 1, 1], cellUv('tapB'));
}

// ---------- Безделушки ----------

function trinket(id: TrinketId, seg: number, flames: Flame[]): RoomModel['trinkets'][TrinketId] {
  const t = TRINKETS.find((x) => x.id === id)!;
  const m = new Mesher();
  m.code = t.code;
  const at: V3 = [(t.box.x0 + t.box.x1) / 2, t.box.y0, (t.box.z0 + t.box.z1) / 2];
  let yaw = 0;
  switch (id) {
    case 'goblet':
      m.shine = 0.95;
      m.lathe(
        [
          [0.0, 0],
          [0.05, 0],
          [0.052, 0.008],
          [0.03, 0.02],
          [0.011, 0.04],
          [0.011, 0.08],
          [0.022, 0.095],
          [0.012, 0.1],
          [0.04, 0.12],
          [0.055, 0.17],
          [0.058, 0.205],
          [0.054, 0.205],
          [0.05, 0.17],
          [0.0, 0.17],
        ],
        seg,
        'plain',
        T(HUE.silver, 0.95),
      );
      // Позолоченный пояс и вино.
      m.lathe(
        [
          [0.0365, 0.11],
          [0.046, 0.13],
          [0.0465, 0.135],
        ],
        seg,
        'plain',
        T(HUE.gold),
      );
      m.shine = 0.6;
      m.lathe(
        [
          [0.0, 0.168],
          [0.05, 0.168],
          [0.0, 0.169],
        ],
        seg,
        'plain',
        T(0x3a0a10, 0.8),
      );
      break;
    case 'candle': {
      m.shine = 0.75;
      m.lathe(
        [
          [0.0, 0],
          [0.07, 0],
          [0.072, 0.01],
          [0.05, 0.018],
          [0.015, 0.03],
          [0.012, 0.09],
          [0.02, 0.1],
          [0.04, 0.11],
          [0.04, 0.12],
          [0.0, 0.12],
        ],
        seg,
        'plain',
        T(HUE.brass),
      );
      m.shine = 0;
      candle(m, 0, 0.12, 0, 0.2, seg);
      flames.push({ x: at[0], y: at[1] + 0.34, z: at[2], light: 2, size: 0.055, trinket: 'candle' });
      break;
    }
    case 'chess':
      m.shine = 0.25;
      m.lathe(
        [
          [0.0, 0],
          [0.022, 0],
          [0.023, 0.012],
          [0.015, 0.025],
          [0.011, 0.07],
          [0.017, 0.08],
          [0.013, 0.095],
          [0.016, 0.105],
          [0.0, 0.108],
        ],
        seg,
        'plain',
        T(HUE.ivory),
      );
      // Крест на венце.
      m.cuboid(-0.003, 0.105, -0.003, 0.003, 0.128, 0.003, 'plain', T(HUE.ivory), {});
      m.cuboid(-0.009, 0.116, -0.003, 0.009, 0.121, 0.003, 'plain', T(HUE.ivory), {});
      break;
    case 'sword': {
      // Меч лежит на колышках вдоль стены: клинок — к северу (−z). Оси предмета: длина — z.
      yaw = Math.PI;
      m.shine = 1;
      const blade = 0.82;
      // Клинок — плоскостью к стене (ширина — по y), обе стороны; дол — тёмной полосой; перекрестье — поперёк по y.
      m.quad([0, -0.025, 0.12], [0, 0.025, 0.12], [0, 0.006, 0.12 + blade], [0, -0.006, 0.12 + blade], 'plain', T(HUE.steel, 1.1));
      m.quad([0, 0.025, 0.12], [0, -0.025, 0.12], [0, -0.006, 0.12 + blade], [0, 0.006, 0.12 + blade], 'plain', T(HUE.steel, 1.0));
      m.cuboid(-0.003, -0.004, 0.12, 0.003, 0.004, 0.12 + blade - 0.08, 'plain', T(HUE.steel, 0.7), {});
      m.cuboid(-0.012, -0.11, 0.1, 0.012, 0.11, 0.125, 'plain', T(HUE.gold), {});
      m.shine = 0.2;
      m.at(0, 0, -0.04, 0, Math.PI / 2).lathe(
        [
          [0.0, 0],
          [0.016, 0],
          [0.017, 0.14],
          [0.0, 0.14],
        ],
        8,
        'cloth',
        T(HUE.leather),
      );
      m.shine = 1;
      m.at(0, 0, -0.07, 0, Math.PI / 2).lathe(
        [
          [0.0, 0],
          [0.024, 0.008],
          [0.03, 0.03],
          [0.0, 0.05],
        ],
        seg,
        'plain',
        T(HUE.gold),
      );
      m.reset();
      at[0] = HALF - 0.12;
      at[1] = 1.555;
      at[2] = ARMS.z + 0.45;
      break;
    }
    case 'crown': {
      m.shine = 1;
      const G = T(HUE.gold);
      m.lathe(
        [
          [0.1, 0],
          [0.104, 0.01],
          [0.104, 0.06],
          [0.1, 0.07],
        ],
        seg + 4,
        'plain',
        G,
      );
      // Изнутри — та же лента гранями внутрь.
      m.lathe(
        [
          [0.096, 0.07],
          [0.096, 0],
        ],
        seg + 4,
        'plain',
        T(HUE.gold, 0.7),
      );
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const big = k % 2 === 0;
        const hh = big ? 0.075 : 0.04;
        m.quad([c * 0.104 - s * 0.03, 0.07, s * 0.104 + c * 0.03], [c * 0.104 + s * 0.03, 0.07, s * 0.104 - c * 0.03], [c * 0.106, 0.07 + hh, s * 0.106], [c * 0.106, 0.07 + hh, s * 0.106], 'plain', G);
        m.quad([c * 0.1 + s * 0.03, 0.07, s * 0.1 - c * 0.03], [c * 0.1 - s * 0.03, 0.07, s * 0.1 + c * 0.03], [c * 0.102, 0.07 + hh, s * 0.102], [c * 0.102, 0.07 + hh, s * 0.102], 'plain', T(HUE.gold, 0.7));
        // Камни: червлёный и лазоревый, в ленте.
        m.glow = 0.12;
        m.at(c * 0.106, 0.035, s * 0.106, Math.atan2(c, s), 0).cuboid(-0.012, -0.012, 0, 0.012, 0.012, 0.008, 'plain', big ? T(0x9c1020, 1.2) : T(0x1d3f9a, 1.2), {});
        m.glow = 0;
        m.reset();
      }
      break;
    }
  }
  return { stone: m, at, yaw };
}
