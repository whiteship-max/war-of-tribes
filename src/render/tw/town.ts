// Город игрока в ролике (docs/polish.md, П-6): где стоит настоящий город — тот же, что в окне города (`render/city`), —
// относительно стены ролика, какая под полем его земля и где город уступает место бою. Чистое, без three: его читают план
// и режиссура (высота фигур, дома под огонь и дым), сцена и поток сборки города (что убрать, что оставить).
//
// Стена ролика — южная стена города: её ворота — главные ворота города, её концы — углы, от которых стены города уходят
// по бровке мыса назад, к замку. Город лежит в метрах и смотрит воротами на юг (+Z); ролик — в единицах сцены (`CITY_M`
// на метр), наружу от стены — `−inward`. Переход — поворот на полоборота или без него и масштаб; зеркала нет: река у
// города в ролике на той же руке, что в окне города.
import { axisX, halfAt, heightAt as cityHeight, WALL_SOUTH } from '../city/layout';
import type { TownGround } from '../reel/terrain';
import { CITY_M, WALL_THICK, type TwHouse, type TwWall } from './site';

/** Главные ворота города — середина стены у ворот, метры вида «город» (`layout.cityPlan`, `gates[0]`). */
export const TOWN_GATE = { x: axisX(WALL_SOUTH), z: WALL_SOUTH + 5 } as const;
/** Наружная грань стены у ворот: на ней стоит наружная грань стены ролика (`TwWall.z`). */
export const TOWN_FACE = TOWN_GATE.z + WALL_THICK / CITY_M / 2;
/** Земля города у ворот — ноль высоты ролика: на ней стоит подошва стены (`TwWall.base`). */
export const TOWN_H0 = cityHeight(TOWN_GATE.x, TOWN_GATE.z);
/**
 * Полуширина стены ролика, когда за ней город: от ворот до угла, где южная стена города встречает боковые (стены — по
 * бровке мыса, на четыре метра внутрь от неё, `layout.wallX`). Единицы ролика.
 */
export const TOWN_HALF = (halfAt(TOWN_GATE.z) - 4) * CITY_M;

/** Где стоит город для этой стены ролика: куда внутрь (`s`), где ворота по X и наружная грань по Z. */
export interface TownFrame {
  s: 1 | -1;
  gx: number;
  wz: number;
}

export const frameOf = (w: Pick<TwWall, 'inward' | 'gateX' | 'z'>): TownFrame => ({ s: w.inward, gx: w.gateX, wz: w.z });

/** Точка ролика → точка города (метры). */
export function toCity(f: TownFrame, x: number, z: number): { x: number; z: number } {
  return { x: TOWN_GATE.x - (f.s * (x - f.gx)) / CITY_M, z: TOWN_FACE - (f.s * (z - f.wz)) / CITY_M };
}

/** Точка города (метры) → точка ролика. */
export function toReel(f: TownFrame, cx: number, cz: number): { x: number; z: number } {
  return { x: f.gx - f.s * (cx - TOWN_GATE.x) * CITY_M, z: f.wz - f.s * (cz - TOWN_FACE) * CITY_M };
}

/** Высота города (метры над морем вида «город») → высота ролика. */
export const townY = (cy: number): number => (cy - TOWN_H0) * CITY_M;

/** Высота земли города в точке ролика — точно, без растра (растр — `townGround`). */
export function townLift(f: TownFrame, x: number, z: number): number {
  const c = toCity(f, x, z);
  return townY(cityHeight(c.x, c.z));
}

/** Шаг растра земли города под полем, единицы ролика: рельеф мыса — десятки метров, растр в два метра его держит. */
const GROUND_STEP = 1.2;

/** Земля города под полем ролика — растром по прямоугольнику поля с запасом (плита земли шире поля). */
export function townGround(f: TownFrame, r: { halfX: number; minZ: number; maxZ: number }, margin = 60): TownGround {
  const x0 = -r.halfX - margin;
  const z0 = r.minZ - margin;
  const nx = Math.ceil((r.halfX * 2 + margin * 2) / GROUND_STEP) + 1;
  const nz = Math.ceil((r.maxZ - r.minZ + margin * 2) / GROUND_STEP) + 1;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = townLift(f, x0 + i * GROUND_STEP, z0 + j * GROUND_STEP);
  return { x0, z0, step: GROUND_STEP, nx, nz, h };
}

/** Прямоугольник по осям (ролика или города — смотря кто зовёт). */
export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Прямоугольник ролика → прямоугольник города: поворот на полоборота или без него оси не косит. */
export function boxToCity(f: TownFrame, b: Box2): Box2 {
  const a = toCity(f, b.x0, b.z0);
  const c = toCity(f, b.x1, b.z1);
  return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
}

export function boxToReel(f: TownFrame, b: Box2): Box2 {
  const a = toReel(f, b.x0, b.z0);
  const c = toReel(f, b.x1, b.z1);
  return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
}

/**
 * Что городу сделать под бой (поток сборки города, `city/town.ts`), всё — в метрах города. Стену между углами рисует
 * ролик (камень или частокол по уровню, проломы, ворота), город к ней подводит свои боковые стены. Где стоят и ходят люди
 * ролика — дома, ряды, деревья дворов уходят (`clear`); перед стеной, где лагерь, машины и поле, — лес, предместье и
 * дворы (`field`).
 */
export interface TownCut {
  /** Углы стены ролика — середины угловых башен: в них приходят боковые стены города. */
  west: { x: number; z: number };
  east: { x: number; z: number };
  /** Частокол из брёвен (стена до третьего уровня) — кольцо города тоже деревянное; иначе камень. */
  wood: boolean;
  /** Где город уступает место людям ролика: внутри стены — двор у ворот, улица, площадь, строи гарнизона. */
  clear: Box2[];
  /** Поле перед стеной: лагерь, машины, подход. */
  field: Box2;
}

/**
 * Что убрать под бой: стена ролика `w`, где за ней ходят люди (`inside`, прямоугольники ролика), и поле перед ней
 * (`field`). Углы — середины крайних башен ролика (у концов стены).
 */
export function townCut(w: TwWall, inside: readonly Box2[], field: Box2): TownCut {
  const f = frameOf(w);
  const ends = [...w.towers].sort((a, b) => a.x - b.x);
  const left = ends[0]?.x ?? -w.halfX;
  const right = ends[ends.length - 1]?.x ?? w.halfX;
  const a = toCity(f, left, w.z + w.inward * (w.thick / 2));
  const c = toCity(f, right, w.z + w.inward * (w.thick / 2));
  const [west, east] = a.x < c.x ? [a, c] : [c, a];
  return { west, east, wood: !!w.wood, clear: inside.map((b) => boxToCity(f, b)), field: boxToCity(f, field) };
}

/**
 * Дом настоящего города, что остался под бой (`city/town.ts` отдаёт их в метрах): место, фасад, этажи, конёк. Ролику — под
 * огонь, дым и перелёт камня (`TwHouse`), а рисует его город.
 */
export interface TownHouse {
  x: number;
  z: number;
  fx: number;
  fz: number;
  w: number;
  d: number;
  floors: number;
  /** Конёк кровли — высота города, метры. */
  top: number;
  seed: number;
}

/** Дом города → дом ролика: место и фасад поворотом, размеры масштабом, конёк — высотой ролика. */
export function houseOfTown(f: TownFrame, h: TownHouse): TwHouse {
  const p = toReel(f, h.x, h.z);
  const fx = -f.s * h.fx;
  const fz = -f.s * h.fz;
  return { x: p.x, z: p.z, w: h.w * CITY_M, d: h.d * CITY_M, yaw: Math.atan2(fx, fz), floors: h.floors, seed: h.seed, top: townY(h.top) };
}

/**
 * Земля ролика над землёй города (`reel/land.LandInput.town`): где лежит плита поля — поле перед стеной, где ходят люди
 * ролика, места убранных домов, — и как далеко точка от дороги города. Всё в единицах ролика; на входе — то, что отдали
 * раскладка (`inside`, `outside` ролика) и город (`cleared`, `road` — метры города).
 */
export function townLand(
  f: TownFrame,
  inside: readonly Box2[],
  outside: Box2,
  cleared: readonly Box2[],
  road: readonly { x: number; z: number }[],
): { keep(x: number, z: number): number; road(x: number, z: number): number } {
  const zones: { b: Box2; fade: number }[] = [
    { b: outside, fade: 7 },
    ...inside.map((b) => ({ b, fade: 2.5 })),
    ...cleared.map((b) => ({ b: boxToReel(f, b), fade: 2 })),
  ];
  const pts = road.map((p) => toReel(f, p.x, p.z));
  return {
    keep(x: number, z: number): number {
      let k = 0;
      for (const { b, fade } of zones) {
        const d = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
        if (d >= 0) return 1;
        const u = 1 + d / fade;
        if (u > k) k = u;
      }
      return k <= 0 ? 0 : k * k * (3 - 2 * k);
    },
    road(x: number, z: number): number {
      let best = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const c = pts[i + 1];
        const vx = c.x - a.x;
        const vz = c.z - a.z;
        const l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
        if (d < best) best = d;
      }
      return best;
    },
  };
}
