// Модель покоев (docs/city_v3.md, Г-4, Г-5): каменная коробка верхнего яруса донжона — бутовая кладка с раствором,
// тёсаный камень у проёмов, ниши окон в толще стены, — потолок на балках, камин с колпаком, дверь к лестнице, кровать под
// пологом, стол на козлах с документами, кресло правителя, сундуки, полки с книгами и свитками, знамёна и гобелены с
// гербом державы, оружие на стене, шахматы у огня, шкуры, люстра-обруч и свечи. Всё — в осях комнаты (`plan.ts`).
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
  ARMS,
  ARMREST,
  BANNERS,
  BED,
  CHAIR,
  CHESS,
  CHESTS,
  SHELVES,
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
  floor: 0x9c7552,
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
  /** Камень покоев (`stone.ts`) — плитка уже в цвете, тон вершин только греет и глушит. */
  wall: 0xf4ebe0,
  ashlar: 0xfaf0e2,
  green: 0x23452c,
  glass: 0xbfd2d0,
  sand: 0xc8a165,
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
  ceiling(stone, detail);
  hearth(stone, cloth);
  door(stone);
  bed(stone, cloth, detail);
  desk(stone, cloth);
  chair(stone, seg);
  chests(stone, seg);
  arms(stone, cloth, seg);
  chessTable(stone, cloth, seg, detail);
  shelves(stone, seg, detail);
  banners(stone, cloth);
  lights(stone, flames, seg);
  floorCloths(cloth);
  const trinkets = {} as RoomModel['trinkets'];
  for (const t of TRINKETS) trinkets[t.id] = trinket(t.id, seg + 4 + detail * 2, flames);
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
    // живая бутовая кладка с раствором (`stone.ts`, рельеф — в шейдере); тёсаный камень — у проёмов. Побелки с пятнами
    // бута (зубцы на снимках с телефона, Г-5) больше нет.
    m.uvK = 1;
    m.plane(o, [-u[0], 0, -u[2]], [0, 1, 0], rect(-HALF, -0.02, HALF, WALL_H + 0.05), holes, 'masonry', T(HUE.wall));
  }
  // Плинтус-цоколь: ряд тёсаного камня у пола — стена стоит, а не висит над досками.
  for (const w of ['south', 'north', 'west', 'east'] as const) {
    const plinth = (x0: number, x1: number): void => {
      const a = wallPoint(w, x0, 0, -0.035);
      const b = wallPoint(w, x1, 0, -0.035);
      const a0 = wallPoint(w, x0, 0, 0);
      const b0 = wallPoint(w, x1, 0, 0);
      m.quad([b[0], 0, b[2]], [a[0], 0, a[2]], [a[0], 0.2, a[2]], [b[0], 0.2, b[2]], 'dressed', T(HUE.ashlar, 0.78), [0.7, 0.7, 1, 1]);
      m.quad([b[0], 0.2, b[2]], [a[0], 0.2, a[2]], [a0[0], 0.2, a0[2]], [b0[0], 0.2, b0[2]], 'dressed', T(HUE.ashlar, 0.85));
    };
    // Разрывы — под проёмами от пола: ниша южного окна, камин и дверь.
    const gaps: [number, number][] = [];
    if (w === 'south') gaps.push([-1.32, 1.32]);
    if (w === 'north') {
      gaps.push([-HEARTH.mouthW / 2 - 0.55, HEARTH.mouthW / 2 + 0.55]);
      gaps.push([-DOOR.x - DOOR.w / 2 - 0.02, -DOOR.x + DOOR.w / 2 + 0.02]);
    }
    gaps.sort((p, q) => p[0] - q[0]);
    let from = -HALF;
    for (const [g0, g1] of gaps) {
      if (g0 > from) plinth(from, g0);
      from = g1;
    }
    plinth(from, HALF);
  }
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
    m.quad(P(o0[0], o0[1], -0.04), P(i0[0], i0[1], -0.04), P(i1[0], i1[1], -0.04), P(o1[0], o1[1], -0.04), 'dressed', T(HUE.ashlar, 1));
    m.quad(P(o0[0], o0[1], 0), P(o0[0], o0[1], -0.04), P(o1[0], o1[1], -0.04), P(o1[0], o1[1], 0), 'dressed', T(HUE.ashlar, 0.8));
    m.quad(P(i1[0], i1[1], 0), P(i1[0], i1[1], -0.04), P(i0[0], i0[1], -0.04), P(i0[0], i0[1], 0), 'dressed', T(HUE.ashlar, 0.88));
  }
}

/** Ниша окна: откос от комнаты до доски, доска с проёмом (у парного — двумя), короткий откос проёма до наружной грани. */
function opening(m: Mesher, o: Opening, detail: Detail): void {
  const w = o.wall;
  const a = alongOf(o);
  const S = T(HUE.ashlar, 0.92);
  const n = 10;
  const inner = archOutline(o.inW / 2, o.inSill, o.inSpring, o.inW * 0.24, n);
  const mid = archOutline(o.midW / 2, o.inSill, o.inSpring - 0.08, o.midW * 0.3, n);
  const pt = (pts: [number, number][], depth: number): V3[] => pts.map(([x, y]) => wallPoint(w, x + a, y, depth) as V3);
  // Откос ниши — толща стены тёсаным камнем; к доске темнее (свет из комнаты туда не доходит).
  m.loft(pt(inner, 0), pt(mid, o.plate), 'dressed', S, true, 0.72);
  const lights: [number, number][][] = o.twin
    ? [-1, 1].map((sgn) => {
        const h = (o.outW - 0.16) / 4;
        return archOutline(h, o.sill, o.spring, h, 8).map(([x, y]) => [x + sgn * (h + 0.08), y] as [number, number]);
      })
    : [archOutline(o.outW / 2, o.sill, o.spring, o.outW / 2, 12)];
  // Доска: грань к комнате, проёмы — дырами.
  const { u } = WALL_AXES[w];
  const po = wallPoint(w, 0, 0, o.plate);
  m.plane(po, [-u[0], 0, -u[2]], [0, 1, 0], mid.map(([x, y]) => [-(x + a), y]), lights.map((l) => l.map(([x, y]) => [-(x + a), y])), 'dressed', T(HUE.ashlar, 0.82));
  for (const l of lights) m.loft(pt(l, o.plate), pt(l, WALL_T + 0.04), 'dressed', T(HUE.ashlar, 0.86), true, 0.9);
  // Подоконник проёма — плита с выносом в комнату: на неё кладут руки (дело «Окно»).
  if (!o.twin) {
    const s0 = wallPoint(w, a - o.outW / 2 - 0.08, 0, o.plate - 0.07);
    const s1 = wallPoint(w, a + o.outW / 2 + 0.08, 0, WALL_T + 0.02);
    m.cuboid(Math.min(s0[0], s1[0]), o.sill - 0.06, Math.min(s0[2], s1[2]), Math.max(s0[0], s1[0]), o.sill, Math.max(s0[2], s1[2]), 'dressed', T(HUE.ashlar, 0.95), { aoLow: 0.8 });
  }
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
      10,
      'dressed',
      T(HUE.ashlar, 0.95),
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
      m.cuboid(sgn < 0 ? x0 : x0 + 0.02, 0, z0, sgn < 0 ? x1 - 0.02 : x1, 0.46, z1, 'dressed', T(HUE.ashlar, 0.9), { aoLow: 0.6 });
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

// ---------- Потолок ----------

/**
 * Потолок на балках (Г-5): три тяжёлые балки с запада на восток на каменных консолях, по ним — поперечные балки потолка,
 * сверху — доски настила. Тёплое дерево ловит свет люстры и огня; прежний шатёр стропил уходил во тьму.
 */
function ceiling(m: Mesher, detail: Detail): void {
  const top = WALL_H + 0.05;
  const B = T(HUE.beam, 1.15);
  // Настил — доски с севера на юг, чуть темнее балок.
  m.quad([-HALF, top, -HALF], [HALF, top, -HALF], [HALF, top, HALF], [-HALF, top, HALF], 'wood', T(HUE.oak, 0.78), [0.8, 0.8, 0.8, 0.8], [
    -HALF / 2,
    -HALF / 2,
    HALF / 2,
    -HALF / 2,
    HALF / 2,
    HALF / 2,
    -HALF / 2,
    HALF / 2,
  ]);
  const beamH = 0.34;
  const beams = [-3.4, 0, 3.4];
  for (const z of beams) {
    m.beam([-HALF, top - beamH / 2, z], [HALF, top - beamH / 2, z], 0.3, beamH, 'wood', B);
    // Консоли: тёсаный камень под концами балок, ступенями.
    for (const sx of [-1, 1]) {
      const x = sx * HALF;
      m.cuboid(Math.min(x, x - sx * 0.32), top - beamH - 0.16, z - 0.2, Math.max(x, x - sx * 0.32), top - beamH, z + 0.2, 'dressed', T(HUE.ashlar, 0.9), {});
      m.cuboid(Math.min(x, x - sx * 0.18), top - beamH - 0.34, z - 0.17, Math.max(x, x - sx * 0.18), top - beamH - 0.16, z + 0.17, 'dressed', T(HUE.ashlar, 0.85), {});
    }
  }
  // Поперечные балки потолка — с юга на север между большими, частым шагом.
  const step = detail === 0 ? 0.9 : 0.55;
  for (let x = -HALF + step / 2; x < HALF; x += step) m.beam([x, top - 0.07, -HALF], [x, top - 0.07, HALF], 0.12, 0.14, 'wood', T(HUE.beam, 1.05));
  // Лежни вдоль всех четырёх стен: на южном и северном лежат концы поперечных балок — край стены ровный, без зубцов.
  for (const sx of [-1, 1]) m.beam([sx * (HALF - 0.11), top - 0.11, -HALF], [sx * (HALF - 0.11), top - 0.11, HALF], 0.22, 0.22, 'wood', B);
  for (const sz of [-1, 1]) m.beam([-HALF, top - 0.13, sz * (HALF - 0.12)], [HALF, top - 0.13, sz * (HALF - 0.12)], 0.24, 0.26, 'wood', B);
}

// ---------- Камин ----------

function hearth(m: Mesher, cloth: Mesher): void {
  const z0 = -HALF;
  const hw = HEARTH.mouthW / 2;
  // Устье: откос в толщу стены и задняя плита в копоти.
  const mouth = rect(-hw, 0, hw, HEARTH.mouthH).map(([x, y]) => wallPoint('north', x, y, 0) as V3);
  const back = rect(-hw + 0.18, 0, hw - 0.18, HEARTH.mouthH - 0.05).map(([x, y]) => wallPoint('north', x, y, HEARTH.depth) as V3);
  m.loft(mouth, back, 'dressed', T(HUE.soot, 1.6), true, 0.55);
  m.quad(back[1], back[0], back[3], back[2], 'dressed', T(HUE.soot, 1.2), [0.8, 0.8, 0.4, 0.4]);
  // Очаг: плита до комнаты.
  m.cuboid(-hw - 0.45, 0, z0 - HEARTH.depth, hw + 0.45, 0.07, z0 + 0.75, 'dressed', T(HUE.ashlar, 0.62), { aoLow: 0.8 });
  // Косяки-колонны с капителями, балка, колпак до свода.
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.2);
    m.cuboid(x - 0.16, 0.07, z0 + 0.05, x + 0.16, HEARTH.hoodLow - 0.18, z0 + 0.5, 'dressed', T(HUE.ashlar, 0.95), { aoLow: 0.7 });
    m.cuboid(x - 0.22, HEARTH.hoodLow - 0.18, z0 + 0.0, x + 0.22, HEARTH.hoodLow, z0 + 0.62, 'dressed', T(HUE.ashlar, 1));
  }
  const fz = HEARTH.hoodFront;
  const lo = HEARTH.hoodLow;
  const hw2 = HEARTH.hoodW / 2;
  m.cuboid(-hw2, lo, z0, hw2, lo + 0.22, fz + 0.02, 'dressed', T(HUE.ashlar, 1));
  // Колпак: сужается к стене и вверх; копоть снизу.
  const y1 = lo + 0.22;
  const top = HEARTH.hoodTop;
  const tw = 0.8;
  const fl: V3 = [-hw2, y1, fz];
  const fr: V3 = [hw2, y1, fz];
  const tl: V3 = [-tw, top, z0];
  const tr: V3 = [tw, top, z0];
  m.quad(fl, fr, tr, tl, 'dressed', T(HUE.ashlar, 0.92), [0.45, 0.45, 0.95, 0.95]);
  m.quad([-hw2, y1, z0], fl, tl, tl, 'dressed', T(HUE.ashlar, 0.85), [0.42, 0.45, 0.9, 0.9]);
  m.quad(fr, [hw2, y1, z0], tr, tr, 'dressed', T(HUE.ashlar, 0.85), [0.45, 0.42, 0.9, 0.9]);
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
  m.loft(pts(0, 1), pts(0.32, 0.94), 'dressed', T(HUE.ashlar, 0.88), true, 0.7);
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
  // Кошель: кожаный мешок осел на столе, горловина стянута шнуром, рядом — монеты.
  const ub = by('purse');
  m.code = code('purse');
  m.shine = 0.22;
  m.at((ub.x0 + ub.x1) / 2, y, (ub.z0 + ub.z1) / 2 + 0.01).lathe(
    [
      [0.0, 0],
      [0.05, 0.004],
      [0.066, 0.022],
      [0.06, 0.045],
      [0.03, 0.058],
      [0.018, 0.062],
      [0.026, 0.072],
      [0.0, 0.075],
    ],
    14,
    'plain',
    T(HUE.leather, 1.05),
  );
  m.shine = 0.95;
  for (let i = 0; i < 5; i++) {
    m.at(ub.x1 + 0.02 + (i % 2) * 0.025, y + 0.002 + i * 0.004, ub.z0 + 0.01 + i * 0.011).lathe(
      [
        [0.0, 0],
        [0.016, 0],
        [0.016, 0.004],
        [0.0, 0.004],
      ],
      10,
      'plain',
      T(HUE.gold),
    );
  }
  m.shine = 0;
  m.reset();
  // Печать лежит на боку: рукоять дуба к востоку, лицо — медь с гербом.
  const eb = by('seal');
  const ez = (eb.z0 + eb.z1) / 2;
  m.code = code('seal');
  m.at(eb.x0 + 0.005, y + 0.025, ez, Math.PI / 2, Math.PI / 2).lathe(
    [
      [0.0, 0],
      [0.024, 0],
      [0.024, 0.012],
      [0.016, 0.025],
      [0.012, 0.06],
      [0.02, 0.1],
      [0.016, 0.125],
      [0.0, 0.13],
    ],
    12,
    'wood',
    T(HUE.dark, 1.1),
  );
  m.reset();
  m.shine = 0.85;
  m.at(eb.x0 + 0.002, y + 0.025, ez, Math.PI / 2, Math.PI / 2).lathe(
    [
      [0.0, -0.004],
      [0.026, -0.004],
      [0.026, 0.004],
      [0.0, 0.004],
    ],
    14,
    'plain',
    T(HUE.brass),
  );
  m.shine = 0;
  m.reset();
  // Мелочи стола (Г-5): песочные часы у карты, две книги стопкой у планов, песочница для чернил.
  m.code = 0;
  hourglass(m, 0.36, y, 3.18);
  m.cuboid(-0.62, y, 3.28, -0.4, y + 0.045, 3.46, 'cloth', T(0x4a1f30, 0.9), {});
  m.cuboid(-0.6, y + 0.045, 3.3, -0.42, y + 0.08, 3.44, 'cloth', T(0x24402c, 0.9), {});
  m.shine = 0.7;
  m.at(0.52, y, 2.98).lathe(
    [
      [0.0, 0],
      [0.026, 0],
      [0.03, 0.01],
      [0.022, 0.045],
      [0.03, 0.05],
      [0.0, 0.052],
    ],
    12,
    'plain',
    T(HUE.brass, 0.9),
  );
  m.reset();
  m.shine = 0;
  m.code = 0;
  cloth.code = 0;
}

/** Песочные часы: две колбы стекла в точёной оправе, песок в нижней. */
function hourglass(m: Mesher, x: number, y: number, z: number): void {
  m.at(x, y, z).cuboid(-0.035, 0, -0.035, 0.035, 0.012, 0.035, 'wood', T(HUE.oak), {});
  m.cuboid(-0.035, 0.148, -0.035, 0.035, 0.16, 0.035, 'wood', T(HUE.oak), {});
  for (const [px, pz] of [
    [-0.028, -0.028],
    [0.028, -0.028],
    [-0.028, 0.028],
    [0.028, 0.028],
  ])
    m.cuboid(px - 0.004, 0.012, pz - 0.004, px + 0.004, 0.148, pz + 0.004, 'wood', T(HUE.oak), {});
  m.shine = 0.5;
  m.lathe(
    [
      [0.0, 0.012],
      [0.024, 0.016],
      [0.026, 0.05],
      [0.005, 0.08],
      [0.026, 0.11],
      [0.024, 0.144],
      [0.0, 0.148],
    ],
    12,
    'plain',
    T(HUE.glass, 0.9),
  );
  m.shine = 0;
  m.lathe(
    [
      [0.0, 0.016],
      [0.022, 0.02],
      [0.02, 0.042],
      [0.0, 0.05],
    ],
    10,
    'plain',
    T(HUE.sand),
  );
  m.reset();
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
    16,
    'plain',
    T(0xdcc89c, 0.92),
  );
  m.reset();
}

// ---------- Кресло ----------

function chair(m: Mesher, seg: number): void {
  const O = T(HUE.oak, 0.95);
  const { x, z } = CHAIR;
  const sy = 0.48;
  const hw = 0.3;
  const z0 = z - 0.27;
  const z1 = z + 0.25;
  m.cuboid(x - hw, sy - 0.07, z0, x + hw, sy, z1, 'wood', O, {});
  for (const [px, pz, h] of [
    [x - hw + 0.04, z1 - 0.04, ARMREST.y - 0.02],
    [x + hw - 0.04, z1 - 0.04, ARMREST.y - 0.02],
    [x - hw + 0.04, z0 + 0.04, 1.52],
    [x + hw - 0.04, z0 + 0.04, 1.52],
  ] as const) {
    m.cuboid(px - 0.045, 0, pz - 0.045, px + 0.045, h, pz + 0.045, 'wood', O, { aoLow: 0.55 });
    if (h > 1) {
      m.at(px, h, pz).lathe(
        [
          [0.05, 0],
          [0.065, 0.04],
          [0.035, 0.09],
          [0.0, 0.12],
        ],
        seg,
        'plain',
        T(HUE.gold, 0.9),
      );
      m.reset();
    }
  }
  // Подлокотники — от спинки вперёд за передние ножки, концы — точёными навершиями: на них лежат руки правителя.
  for (const s of [-1, 1]) {
    const ax = x + s * ARMREST.x;
    m.beam([ax, ARMREST.y - 0.025, z0 + 0.04], [ax, ARMREST.y - 0.025, ARMREST.end - 0.03], 0.075, 0.05, 'wood', O);
    m.shine = 0.85;
    m.at(ax, ARMREST.y - 0.06, ARMREST.end - 0.03).lathe(
      [
        [0.0, 0],
        [0.03, 0.005],
        [0.042, 0.03],
        [0.038, 0.055],
        [0.02, 0.07],
        [0.0, 0.075],
      ],
      seg,
      'plain',
      T(HUE.gold, 0.85),
    );
    m.shine = 0;
    m.reset();
  }
  // Спинка филёнкой, перекладины.
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
    // Короб, крышка с выносом, железные полосы с заклёпками и замок; низ — на брусках.
    m.cuboid(x0, 0.04, z0, x1, h - 0.09, z1, 'wood', T(HUE.oak, 0.95), { aoLow: 0.55 });
    m.cuboid(x0 + 0.03, 0, z0 + 0.03, x1 - 0.03, 0.04, z1 - 0.03, 'wood', T(HUE.oak, 0.6), {});
    m.cuboid(x0 - 0.02, h - 0.09, z0 - 0.02, x1 + 0.02, h, z1 + 0.02, 'wood', T(HUE.oakLight, 0.95), {});
    const along = x1 - x0 > z1 - z0;
    m.shine = 0.7;
    for (const t of [0.1, 0.5, 0.9]) {
      if (along) {
        const x = x0 + (x1 - x0) * t;
        m.cuboid(x - 0.028, 0.04, z0 - 0.022, x + 0.028, h + 0.006, z1 + 0.022, 'plain', T(HUE.iron, 1.2), {});
      } else {
        const z = z0 + (z1 - z0) * t;
        m.cuboid(x0 - 0.022, 0.04, z - 0.028, x1 + 0.022, h + 0.006, z + 0.028, 'plain', T(HUE.iron, 1.2), {});
      }
    }
    // Замок — на лицевой стороне к середине комнаты.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const fx = along ? cx : Math.abs(x0) > Math.abs(x1) ? x1 : x0;
    const fz = along ? (Math.abs(z0) > Math.abs(z1) ? z1 : z0) : cz;
    const nx = along ? 0 : Math.sign(-fx) * 0.025;
    const nz = along ? Math.sign(-fz) * 0.025 : 0;
    m.cuboid(fx - 0.05 + nx, h - 0.24, fz - 0.05 + nz, fx + 0.05 + nx, h - 0.1, fz + 0.05 + nz, 'plain', T(HUE.brass, 0.9), {});
    m.shine = 0;
    void seg;
  };
  for (const c of CHESTS) one(c.x0, c.z0, c.x1, c.z1, c.h);
  // Подушка под короной на сундуке у оружия.
  const ca = CHESTS.find((c) => c.id === 'chestArms')!;
  m.cuboid(4.42, ca.h, ARMS.z - 0.26, 4.86, ca.h + 0.08, ARMS.z + 0.26, 'cloth', T(HUE.red, 1.0), {});
  // Шлем на южном сундуке.
  const cs = CHESTS.find((c) => c.id === 'chestSouth')!;
  const hx = cs.x0 + 0.28;
  const hz = (cs.z0 + cs.z1) / 2;
  m.shine = 0.8;
  m.at(hx, cs.h, hz).lathe(
    [
      [0.13, 0],
      [0.135, 0.06],
      [0.125, 0.15],
      [0.09, 0.24],
      [0.03, 0.3],
      [0.0, 0.31],
    ],
    14,
    'plain',
    T(HUE.steel, 0.8),
  );
  m.reset();
  m.cuboid(hx - 0.02, cs.h + 0.02, hz - 0.135, hx + 0.02, cs.h + 0.2, hz - 0.115, 'plain', T(HUE.steel, 0.8), {});
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
      m.at(px, top + 0.012, pz).lathe(piece(hgt), detail === 2 ? 8 : 6, 'plain', white ? T(HUE.ivory) : T(HUE.dark, 1.1));
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
    [0.017, 0],
    [0.018, h * 0.12],
    [0.009, h * 0.3],
    [0.008, h * 0.62],
    [0.013, h * 0.76],
    [0.0, h],
  ];
}

// ---------- Полки ----------

/**
 * Полки у стен по сторонам южного угла (Г-5): на западе — книжный шкаф (книги корешками, стопки, подсвечник), на
 * востоке — гнёзда со свитками. Дуб, книги — кожей разных цветов с золотыми бинтами.
 */
function shelves(m: Mesher, seg: number, detail: Detail): void {
  const r = bone(91);
  const O = T(HUE.oak, 0.9);
  for (const sh of SHELVES) {
    const west = sh.id === 'books';
    // Наружу (в комнату) — по x; стенка — у стены.
    const inX = west ? sh.x1 : sh.x0;
    const wallX = west ? sh.x0 : sh.x1;
    const out = west ? 1 : -1;
    const z0 = sh.z0;
    const z1 = sh.z1;
    const h = sh.h;
    // Боковины, верх с карнизом, цоколь.
    for (const z of [z0, z1 - 0.05]) m.cuboid(Math.min(inX, wallX), 0, z, Math.max(inX, wallX), h, z + 0.05, 'wood', O, { aoLow: 0.6 });
    m.cuboid(Math.min(inX + out * 0.03, wallX), h, z0 - 0.03, Math.max(inX + out * 0.03, wallX), h + 0.07, z1 + 0.03, 'wood', T(HUE.oak, 1), {});
    m.cuboid(Math.min(inX, wallX), 0, z0, Math.max(inX, wallX), 0.1, z1, 'wood', T(HUE.oak, 0.7), {});
    const levels = west ? [0.1, 0.62, 1.12, 1.62] : [0.1, 0.5, 0.9, 1.3, 1.7];
    for (const y of levels.slice(1)) m.cuboid(Math.min(inX, wallX), y - 0.035, z0 + 0.05, Math.max(inX, wallX), y, z1 - 0.05, 'wood', O, {});
    if (west) {
      // Книги корешками к комнате: ряд за рядом, иногда стопка лёжа.
      const covers = [0x5a1c16, 0x3b2a1c, 0x24402c, 0x2a3354, 0x6a4a26, 0x4a1f30, 0x7a5c34];
      for (let k = 0; k < levels.length; k++) {
        const y = levels[k];
        const room = (levels[k + 1] ?? h) - y - 0.04;
        let z = z0 + 0.06;
        while (z < z1 - 0.1) {
          const lying = r() < 0.12 && detail > 0;
          const t = 0.035 + r() * 0.045;
          const bh = Math.min(room - 0.02, 0.2 + r() * 0.12);
          const depth = 0.2 + r() * 0.08;
          const col = T(covers[Math.floor(r() * covers.length)], 0.85 + r() * 0.3);
          const x0 = inX - out * 0.02 - out * depth;
          const x1 = inX - out * 0.02;
          if (lying) {
            let yy = y;
            for (let i = 0; i < 3; i++) {
              const tt = 0.04 + r() * 0.02;
              m.cuboid(Math.min(x0, x1), yy, z, Math.max(x0, x1), yy + tt, z + bh * 0.9, 'cloth', T(covers[Math.floor(r() * covers.length)], 0.9), {});
              yy += tt;
            }
            z += bh * 0.9 + 0.03;
            continue;
          }
          // Книга корешком к комнате: без донца и без задней грани у стены — их не видно.
          m.cuboid(Math.min(x0, x1), y, z, Math.max(x0, x1), y + bh, z + t, 'cloth', col, { skip: `-y ${west ? '-x' : '+x'}` });
          // Золотые бинты по корешку.
          if (detail > 1) {
            m.shine = 0.8;
            for (const by of [0.22, 0.78]) m.cuboid(Math.min(x1, x1 + out * 0.004), y + bh * by - 0.006, z - 0.001, Math.max(x1, x1 + out * 0.004), y + bh * by + 0.006, z + t + 0.001, 'plain', T(HUE.gold, 0.85), {});
            m.shine = 0;
          }
          z += t + (r() < 0.15 ? 0.01 : 0.002);
        }
      }
      // Подсвечник на шкафу.
      candle(m, inX - out * 0.18, h + 0.07, (z0 + z1) / 2, 0.16, seg);
    } else {
      // Гнёзда со свитками: решётка, в каждом — свитки торцами к комнате.
      const cols = 4;
      const cw = (z1 - z0 - 0.1) / cols;
      for (let i = 1; i < cols; i++) m.cuboid(Math.min(inX, wallX), 0.1, z0 + 0.05 + i * cw - 0.012, Math.max(inX, wallX), h, z0 + 0.05 + i * cw + 0.012, 'wood', O, {});
      for (let k = 0; k + 1 < levels.length; k++) {
        const y = levels[k];
        const rowH = levels[k + 1] - y - 0.04;
        for (let i = 0; i < cols; i++) {
          const n = 2 + Math.floor(r() * 3);
          for (let j = 0; j < n; j++) {
            const rr = 0.03 + r() * 0.012;
            const cz = z0 + 0.05 + i * cw + cw * (0.25 + 0.5 * ((j + 0.5) / n)) + (r() - 0.5) * 0.02;
            const cy = y + rr + (j % 2 ? 0.0 : 0) + (j > 1 ? rr * 1.6 : 0);
            if (cy + rr > y + rowH) continue;
            // Свиток виден торцом: короткий цилиндр с завитком на торце (глубже — темнота гнезда).
            m.at(inX - out * 0.01, cy, cz, out > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI / 2).lathe(
              [
                [0, 0.002],
                [rr, 0.006],
                [rr, 0.09],
              ],
              detail === 2 ? 9 : 6,
              'plain',
              T(0xdcc59a, 0.85 + r() * 0.2),
            );
            m.reset();
            // Тесьма.
            if (detail > 1) m.cuboid(Math.min(inX - out * 0.05, inX - out * 0.07), cy - rr - 0.002, cz - rr - 0.002, Math.max(inX - out * 0.05, inX - out * 0.07), cy + rr + 0.002, cz + rr + 0.002, 'cloth', T(r() < 0.5 ? HUE.red : HUE.green, 0.9), {});
          }
        }
      }
    }
  }
}

/** Сеяная кость модели — книги и свитки у всех одни. */
function bone(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

// ---------- Знамёна ----------

/** Знамёна с гербом державы по сторонам большого окна: на кованых прутах, полотнище складками (атлас `banner`). */
function banners(m: Mesher, cloth: Mesher): void {
  cloth.code = 0;
  for (const b of BANNERS) {
    const z = HALF - 0.06;
    // Прут на двух кронштейнах, навершия.
    m.shine = 0.6;
    m.beam([b.x - b.w / 2 - 0.08, b.top + 0.04, z - 0.03], [b.x + b.w / 2 + 0.08, b.top + 0.04, z - 0.03], 0.025, 0.025, 'plain', T(HUE.iron, 1.2));
    for (const s of [-1, 1]) {
      m.beam([b.x + s * (b.w / 2 + 0.05), b.top + 0.04, z - 0.03], [b.x + s * (b.w / 2 + 0.05), b.top + 0.04, HALF], 0.02, 0.02, 'plain', T(HUE.iron, 1.2));
      m.at(b.x + s * (b.w / 2 + 0.1), b.top + 0.04, z - 0.03, 0, s * Math.PI / 2).lathe(
        [
          [0.0, 0],
          [0.02, 0.0],
          [0.028, 0.02],
          [0.0, 0.05],
        ],
        8,
        'plain',
        T(HUE.gold, 0.9),
      );
      m.reset();
    }
    m.shine = 0;
    // Полотнище: пять полос с изломом — складки висящей ткани; низ — ласточкин хвост (вырез — альфой атласа).
    const n = 5;
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const x0 = b.x - b.w / 2 + b.w * u0;
      const x1 = b.x - b.w / 2 + b.w * u1;
      const d0 = i % 2 ? 0.035 : 0;
      const d1 = i % 2 ? 0 : 0.035;
      const sh0 = i % 2 ? 0.86 : 1;
      cloth.quad([x1, b.bottom, z - d1], [x0, b.bottom, z - d0], [x0, b.top, z - d0], [x1, b.top, z - d1], 'cloth', T(0xffffff), [0.8 * sh0, 0.8 * sh0, sh0, sh0], cellUv('banner', 1 - u1, 0, 1 - u0, 1));
    }
  }
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
  // Воск — свой материал шейдера (блеск выше 0,965): свет пламени проходит в тело свечи.
  const sh = m.shine;
  m.shine = 0.98;
  m.at(x, y, z).lathe(
    [
      [0.026, 0],
      [0.022, 0.015],
      [0.019, h * 0.4],
      [0.018, h],
      [0.0, h + 0.004],
    ],
    seg >= 12 ? seg - 2 : 6,
    'plain',
    W,
  );
  m.shine = sh;
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
  // Овчина у кровати — ступить босиком с постели.
  c.quad([-3.05, y + 0.006, -3.35], [-2.15, y + 0.006, -3.35], [-2.15, y + 0.006, -4.45], [-3.05, y + 0.006, -4.45], 'cloth', T(0xffffff), [1, 1, 1, 1], cellUv('sheep'));
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
      m.shine = 0.95;
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
      m.shine = 0.95;
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
      m.shine = 0.95;
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
