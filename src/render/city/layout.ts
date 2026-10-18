// Раскладка вида «город» (docs/city.md, раздел 4): рельеф мыса, стена по бровке, башни, улицы,
// площадь, большие здания и участки домов. Чистые функции от зерна — без three и без DOM; тесты и
// карта сверху для самопроверки зовут их в node.
//
// Оси — как у сцены: x на восток, z на юг (к камере), высота — y. Единица — метр. Главные ворота на
// юге (z ≈ +126), площадь в середине, замок на северной оконечности мыса (z ≈ −145).
import { clamp01, hash3, lerp, rnd, sstep, stream, vnoise } from './noise';

export const CITY_SEED = 1213;

export interface P {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------------------------
// Рельеф.

/** Кусочно-гладкая кривая по опорным точкам (z убывает к северу — берётся по возрастанию). */
function curve(pts: readonly (readonly [number, number])[], t: number): number {
  if (t <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) {
    const [z1, v1] = pts[k];
    if (t <= z1) {
      const [z0, v0] = pts[k - 1];
      const f = (t - z0) / (z1 - z0);
      return v0 + (v1 - v0) * f * f * (3 - 2 * f);
    }
  }
  return pts[pts.length - 1][1];
}

/** Ось мыса — чуть извилистая. */
export const axisX = (z: number): number => 6 * Math.sin(z / 80);

/** Высота хребта мыса вдоль оси. */
const RIDGE: readonly (readonly [number, number])[] = [
  [-230, 4],
  [-175, 13],
  [-135, 15],
  [-105, 13],
  [-60, 10],
  [0, 7],
  [40, 5.5],
  [110, 2.5],
  [150, 1.5],
  [230, 1],
];
/** Полуширина плато мыса. */
const HALF: readonly (readonly [number, number])[] = [
  [-230, 6],
  [-178, 32],
  [-140, 46],
  [-105, 60],
  [-60, 80],
  [0, 88],
  [40, 82],
  [110, 63],
  [150, 72],
  [230, 150],
];

export const ridgeAt = (z: number): number => curve(RIDGE, z);
export const halfAt = (z: number): number => curve(HALF, z);

/** Ров между городом и замком. */
export const MOAT_Z: readonly [number, number] = [-119, -113];

/** Высота земли в точке. */
export function heightAt(x: number, z: number): number {
  const e = ridgeAt(z);
  const hw = halfAt(z);
  const d = x - axisX(z);
  const side = d < 0 ? -1 : 1;
  const ad = Math.abs(d);
  // Плато чуть горбом к оси; за бровкой — склон в долину.
  const crown = -0.018 * ad;
  const valleyRaw = side < 0 ? -13 : -8;
  const neck = sstep(130, 230, z);
  const valley = lerp(valleyRaw, e - 2, neck);
  const slopeW = side < 0 ? 42 : 80;
  const over = Math.max(0, ad - hw);
  const fall = sstep(0, slopeW, over);
  let h = e + crown + (valley - (e + crown)) * fall;
  // Скала донжона на оконечности мыса.
  const kx = x + 4;
  const kz = z + 146;
  h += 6.5 * Math.exp(-(kx * kx + kz * kz) / (2 * 16 * 16));
  // Ров между городом и замком: сухой, 4 м.
  if (z > MOAT_Z[0] - 4 && z < MOAT_Z[1] + 4 && ad < hw + 6) {
    const m = 1 - sstep(MOAT_Z[1] - MOAT_Z[0] - 1, MOAT_Z[1] - MOAT_Z[0] + 6, Math.abs(z - (MOAT_Z[0] + MOAT_Z[1]) / 2) * 2);
    h -= 4 * m;
  }
  // Неровность: внутри стены мелкая, снаружи заметнее.
  const inner = 1 - sstep(hw - 8, hw + 10, ad);
  const n = vnoise(x / 60 + 50, z / 60 + 50, 1e6, 7) - 0.5;
  const n2 = vnoise(x / 18 + 50, z / 18 + 50, 1e6, 9) - 0.5;
  h += lerp(n * 3 + n2 * 0.8, n * 0.6 + n2 * 0.15, inner);
  // Река в западной долине.
  // Русло с плоским дном во всю ширину воды: редкая сетка земли вдали (шаг 5–10 м) не должна
  // протыкать воду кочками — берег поднимается уже за краем ленты воды (`water.ts`).
  const rd = Math.abs(x - riverX(z));
  h -= 3.0 * (1 - sstep(RIVER_HALF, RIVER_HALF + 12, rd));
  // Мельничный ручей: канава от реки к колесу лесопилки и обратно.
  if (x > -166 && x < -112 && z > -4 && z < 40) {
    const dr = distPoly({ x, z }, RACE);
    if (dr < RACE_HALF + 3.5) h = lerp(RACE_LEVEL - 0.9, h, sstep(RACE_HALF - 0.6, RACE_HALF + 3.5, dr));
  }
  return h;
}

/** Середина ленты воды реки через 8 м — от горизонта до горизонта (`water.ts`, счёт бюджета). */
export function riverRibbon(): { x: number; z: number; y: number }[] {
  const out: { x: number; z: number; y: number }[] = [];
  for (let z = -1100; z <= 1100; z += 8) out.push({ x: riverX(z), z, y: riverLevel(z) });
  return out;
}

/** Середина ленты воды мельничного ручья. */
export const raceRibbon = (): { x: number; z: number; y: number }[] => smoothPath(RACE, 2).map((p) => ({ ...p, y: RACE_LEVEL }));

/**
 * Мельничный ручей лесопилки (docs/city.md, раздел 5): вода отводится из реки выше по течению, обходит
 * мельницу с востока, бежит на запад под колесом вдоль её южной стены и возвращается в реку ниже.
 * Колесо стоит в нём лицом к камере игры — в самой реке, текущей с севера на юг, оно было бы видно
 * только ребром.
 */
export const RACE: readonly P[] = [
  { x: -158, z: 2 },
  { x: -140, z: 3 },
  { x: -124, z: 8 },
  { x: -120, z: 19 },
  { x: -126, z: 27.5 },
  { x: -146, z: 29 },
  { x: -159, z: 34 },
];
export const RACE_HALF = 1.9;
/** Уровень воды в ручье — уровень реки у отвода, на полметра ниже долины. */
export const RACE_LEVEL = -15.6;

export const RIVER_HALF = 9;
export const riverX = (z: number): number => -168 + 14 * Math.sin(z / 95 + 0.6);
/** Уровень воды реки. */
export const RIVER_Y = -14.4;

/**
 * Уровень воды реки у этого `z`: дно русла посередине плюс 1.3 м. Долина неровная (шум рельефа ±1.5 м),
 * и вода на одной высоте вдоль всей реки то заливала бы берег, то висела бы над дном; русло — 3 м
 * плоским дном во всю ширину воды (`heightAt`), так что вода у берегов не выше их.
 */
export function riverLevel(z: number): number {
  return heightAt(riverX(z), z) + 1.3;
}

// ---------------------------------------------------------------------------------------------
// Геометрия плана: отрезки, ломаные, многоугольники.

export function distSeg(p: P, a: P, b: P): { d: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp01(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2);
  const ex = a.x + dx * t - p.x;
  const ez = a.z + dz * t - p.z;
  return { d: Math.sqrt(ex * ex + ez * ez), t };
}

export function distPoly(p: P, pts: readonly P[], closed = false): number {
  let best = Infinity;
  const n = pts.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const d = distSeg(p, pts[k], pts[(k + 1) % n]).d;
    if (d < best) best = d;
  }
  return best;
}

export function insidePoly(p: P, pts: readonly P[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Точка ломаной на длине `s` и направление там. */
export function along(pts: readonly P[], s: number): { p: P; t: P } {
  let rest = s;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (rest <= l || k === pts.length - 2) {
      const f = l > 0 ? Math.min(1, rest / l) : 0;
      return { p: { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }, t: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
    }
    rest -= l;
  }
  const a = pts[0];
  return { p: { ...a }, t: { x: 1, z: 0 } };
}

export const polyLength = (pts: readonly P[]): number => {
  let l = 0;
  for (let k = 0; k < pts.length - 1; k++) l += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
  return l;
};

/** Сглаживание ломаной (Чайкин): улицы и стена без изломов-рёбер. */
export function smoothPath(pts: readonly P[], rounds = 2, closed = false): P[] {
  let cur = pts.slice();
  for (let r = 0; r < rounds; r++) {
    const out: P[] = closed ? [] : [cur[0]];
    const n = cur.length;
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const a = cur[k];
      const b = cur[(k + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    if (!closed) out.push(cur[n - 1]);
    cur = out;
  }
  return cur;
}

// ---------------------------------------------------------------------------------------------
// Город.

export type Surface = 'cobble' | 'dirt';

export interface Street {
  name: string;
  pts: P[];
  half: number;
  surface: Surface;
  /** Ставить ли дома по сторонам: обе, только левая/правая (по ходу), ни одной. */
  sides: 'both' | 'left' | 'right' | 'none';
  /** Богатство застройки 0..1: этажность и камень. */
  rich: number;
}

export type TowerKind = 'round' | 'square' | 'gate' | 'watch' | 'castleGate' | 'keep';

export interface Tower {
  kind: TowerKind;
  x: number;
  z: number;
  /** Поворот: направление «наружу» (угол в плане, рад). */
  out: number;
  /** Размер в плане: диаметр или сторона. */
  size: number;
  /** Высота до карниза над подножием. */
  height: number;
  /** Основание — земля под башней (самая низкая точка круга следа); от него — высота. */
  base: number;
  /** Самая низкая земля под всем следом (квадрат по оси — углы дальше круга) — низ кладки; нет — `base`. */
  foot?: number;
  /** Пол проезда надвратной башни — дорога у обоих концов арки и посередине, самая высокая; нет — `base`. */
  floor?: number;
  seed: number;
}

/** Большое здание — место и поворот; модель выбирает `kit` по `kind`. */
export type CivicKind = 'church' | 'hall' | 'granary' | 'guild' | 'smithy' | 'stable' | 'tavern' | 'spital' | 'palas' | 'barracks';

export interface Civic {
  kind: CivicKind;
  x: number;
  z: number;
  /** Угол фасада: куда смотрит главная сторона (рад, 0 — на +x). */
  rot: number;
  w: number;
  d: number;
  base: number;
  seed: number;
}

export type WallStyle = 'timber' | 'stone' | 'plaster';

export interface House {
  x: number;
  z: number;
  /** Направление фасада к улице (единичный вектор). */
  fx: number;
  fz: number;
  /** Фронт вдоль улицы и глубина от улицы. */
  w: number;
  d: number;
  floors: number;
  style: WallStyle;
  /** Рисунок фахверка 0..2. */
  frame: number;
  /** Щипцом на улицу (конёк поперёк улицы) или карнизом. */
  gable: boolean;
  roof: 'tile' | 'slate' | 'shingle';
  pitch: number;
  jetty: number;
  /**
   * Уровень пола первого этажа — не ниже самой высокой земли под домом (`footSpan`): дом на склоне не тонет, а
   * встаёт на цоколь; самая низкая земля под домом — низ цоколя; земля у фасада — откуда ступени к двери.
   */
  floor: number;
  low: number;
  /** Земля у фасада (у домов города): ниже пола — ступени (`kit.houseStoop`). */
  street?: number;
  wallTint: number;
  roofTint: number;
  seed: number;
  rich: number;
}

export interface Stall {
  x: number;
  z: number;
  rot: number;
  w: number;
  seed: number;
}

/** Двор за стеной — постройка игры с `outside` (docs/city.md, раздел 5): место, поворот фасада, поляна. */
export type YardKind = 'gathering' | 'sawmill' | 'quarry' | 'hunter_hut' | 'mine' | 'farm' | 'pen';

export interface Yard {
  kind: YardKind;
  x: number;
  z: number;
  /** Куда смотрит фасад (угол в плане, рад; 0 — на +x). */
  rot: number;
  /** Поляна вокруг двора: ни леса, ни пашни. */
  r: number;
  seed: number;
}

export interface CityPlan {
  wall: P[];
  castleWall: P[];
  towers: Tower[];
  /** Ворота: место на стене и поворот наружу. */
  gates: { x: number; z: number; out: number }[];
  streets: Street[];
  square: P[];
  civic: Civic[];
  houses: House[];
  stalls: Stall[];
  well: P;
  statue: P;
  /** Деревья во дворах и на площади (липа). */
  yardTrees: { x: number; z: number; r: number; seed: number }[];
  /** Дороги за стеной: в долину, на восток и тропы к дворам. */
  roads: Street[];
  /** Семь дворов игры за стеной. */
  yards: Yard[];
  /** Предместье у южной дороги — дома Жилищ за стеной. */
  suburb: House[];
}

// ---------------------------------------------------------------------------------------------
// За стеной: дороги, дворы, предместье.

/**
 * Край видимого мира, метры от середины: дальше земля уходит в дымку (`camera.cityFog`), и карта земель (`nature.LAND_AT`)
 * кончается. Дороги кончаются за ним — тест «дороги без обрывов» (`roads.test.ts`) требует этого от каждой дороги, что не
 * ведёт к двору.
 */
export const WORLD_EDGE = 1000;

/** Дороги и тропы за стеной: центральные линии, сглаженные, как улицы. */
function roadsOf(gates: { x: number; z: number }[]): Street[] {
  const g = gates[0];
  const e = gates[1];
  const r = (name: string, pts: P[], half: number): Street => ({ name, pts: smoothPath(pts, 2), half, surface: 'dirt', sides: 'none', rich: 0 });
  // Дороги от ворот уходят за край видимого мира (docs/city_v3.md, Г-3): за `WORLD_EDGE` и дальше, в дымку. Дальняя часть
  // лежит на карте земель (`nature.landMap`, канал b — расстояние до дороги), ближняя — на карте покрытий.
  return [
    r('Дорога в долину', [{ x: g.x, z: g.z }, { x: g.x + 2, z: g.z + 40 }, { x: g.x - 8, z: g.z + 110 }, { x: g.x - 4, z: g.z + 200 }, { x: g.x + 6, z: g.z + 330 }, { x: g.x - 14, z: g.z + 480 }, { x: g.x + 12, z: g.z + 640 }, { x: g.x - 22, z: g.z + 800 }, { x: g.x - 2, z: g.z + 980 }, { x: g.x - 16, z: WORLD_EDGE + 300 }], 3.2),
    r('Восточная дорога', [{ x: e.x, z: e.z }, { x: e.x + 40, z: e.z + 6 }, { x: e.x + 110, z: e.z - 20 }, { x: e.x + 200, z: e.z - 10 }, { x: e.x + 330, z: e.z + 10 }, { x: e.x + 480, z: e.z - 12 }, { x: e.x + 640, z: e.z + 22 }, { x: e.x + 820, z: e.z + 4 }, { x: e.x + 1000, z: e.z + 26 }, { x: WORLD_EDGE + 300, z: e.z + 12 }], 2.6),
    // Тропа на запад: из предместья вниз по склону к опушке, навесу собирателей и лесопилке на реке.
    r('Тропа к реке', [{ x: g.x - 4, z: g.z + 74 }, { x: -40, z: 196 }, { x: -78, z: 160 }, { x: -96, z: 112 }, { x: -122, z: 70 }, { x: -136, z: 30 }], 2),
    // От восточной дороги на север по склону — к руднику, каменоломне под замком и дальше в лес, к охотничьему домику.
    r('Тропа к руднику', [{ x: e.x + 30, z: e.z + 4 }, { x: 122, z: -46 }, { x: 112, z: -104 }, { x: 80, z: -170 }, { x: 46, z: -222 }], 1.8),
    // К загону: от дороги в долину на восток.
    r('Тропа к загону', [{ x: g.x + 2, z: g.z + 36 }, { x: 40, z: 168 }, { x: 78, z: 162 }], 1.8),
    // От охотничьего домика — лесная дорога на север, просекой через лес до края мира: сеть дорог выходит из кадра на все
    // стороны, куда смотрит камера игры (docs/city_v3.md, Г-3).
    r('Лесная дорога', [{ x: 46, z: -222 }, { x: 34, z: -300 }, { x: 52, z: -420 }, { x: 24, z: -560 }, { x: 44, z: -720 }, { x: 14, z: -900 }, { x: 30, z: -1060 }, { x: 18, z: -WORLD_EDGE - 400 }], 2),
  ];
}

/**
 * Дворы за стеной: где им положено по ремеслу (docs/city.md, раздел 5). Навес собирателей — на опушке у
 * подножия западного склона, лесопилка — на восточном берегу реки (колесо в воде), каменоломня — в
 * склоне мыса под замком, охотничий домик — в северном лесу, рудник — в восточном склоне, хутор — в
 * восточной долине у дороги, загон — на выгоне к юго-востоку.
 */
function yardsOf(seed: number): Yard[] {
  const y = (kind: YardKind, x: number, z: number, rot: number, r: number, k: number): Yard => ({ kind, x, z, rot, r, seed: hash3(k, 17, seed) });
  const S = Math.PI / 2;
  // Фасады — к югу и востоку, к камере игры (она смотрит с юга на север): двор читается лицом.
  const SE = Math.PI / 4;
  return [
    y('gathering', -100, 104, SE, 15, 1),
    y('sawmill', -136, 20, S, 20, 2),
    y('quarry', 68, -172, SE, 22, 3),
    y('hunter_hut', 34, -232, S, 15, 4),
    y('mine', 106, -116, SE * 0.6, 18, 5),
    y('farm', 152, 26, S, 30, 6),
    y('pen', 92, 158, S, 24, 7),
  ];
}

/** Предместье: дома по обе стороны дороги в долину — за гласисом, до полей. */
function placeSuburb(road: Street, wall: P[], yards: Yard[], seed: number): House[] {
  const out: House[] = [];
  const boxes: Box[] = [];
  const r = stream(seed);
  const len = polyLength(road.pts);
  for (const side of [1, -1] as const) {
    let s = 30;
    while (s < len - 10) {
      const w = 5 + r() * 2.6;
      const mid = along(road.pts, s + w / 2);
      if (mid.p.z > 232) break;
      const d = 7.5 + r() * 2.5;
      const nx = -mid.t.z * side;
      const nz = mid.t.x * side;
      const front = road.half + 1.2 + r() * 1.5;
      const cx = mid.p.x + nx * (front + d / 2);
      const cz = mid.p.z + nz * (front + d / 2);
      const box: Box = { cx, cz, ux: mid.t.x, uz: mid.t.z, hu: w / 2, hv: d / 2 };
      const pts = boxCorners(box);
      const ok =
        pts.every((q) => !insidePoly(q, wall) && distPoly(q, wall, true) > 34) &&
        !boxes.some((b) => boxesOverlap(box, b, 0.6)) &&
        yards.every((yd) => Math.hypot(cx - yd.x, cz - yd.z) > yd.r + 6);
      if (ok) {
        const fl = heightAt(mid.p.x + nx * (front + 0.5), mid.p.z + nz * (front + 0.5));
        const span = footSpan(cx, cz, -nx, -nz, w, d);
        out.push({
          x: cx,
          z: cz,
          fx: -nx,
          fz: -nz,
          w,
          d,
          // Предместье беднее: в один-два этажа, фахверк и штукатурка, кровли — больше дранки.
          floors: r() < 0.45 ? 1 : 2,
          style: r() < 0.25 ? 'plaster' : 'timber',
          frame: Math.floor(r() * 3),
          gable: r() < 0.7,
          roof: r() < 0.45 ? 'tile' : 'shingle',
          pitch: (50 + r() * 12) * (Math.PI / 180),
          jetty: r() < 0.5 ? 0 : 0.25 + r() * 0.2,
          floor: Math.max(fl, span.hi + FLOOR_LIFT),
          low: Math.min(fl, span.lo),
          street: fl,
          wallTint: Math.floor(r() * 7),
          roofTint: Math.floor(r() * 6),
          seed: Math.floor(r() * 1e9),
          rich: 0.1,
        });
        boxes.push(box);
        s += w + 0.8 + (r() < 0.25 ? 4 + r() * 5 : 0);
      } else s += 2;
    }
  }
  return out;
}

/** Стена города — замкнутый контур по бровке плато, с юга до рва. */
export const WALL_SOUTH = 126;
export const WALL_NORTH = MOAT_Z[1] + 1;
const wallX = (z: number, side: -1 | 1): number => axisX(z) + side * (halfAt(z) - 4);

function wallContour(): P[] {
  const pts: P[] = [];
  // Восточная сторона — с юга на север.
  for (let z = WALL_SOUTH; z >= WALL_NORTH; z -= 6) pts.push({ x: wallX(z, 1), z });
  // Северная — с востока на запад, чуть выгнута к замку.
  const xe = wallX(WALL_NORTH, 1);
  const xw = wallX(WALL_NORTH, -1);
  for (let k = 1; k < 8; k++) {
    const f = k / 8;
    pts.push({ x: lerp(xe, xw, f), z: WALL_NORTH - Math.sin(f * Math.PI) * 3 });
  }
  // Западная — с севера на юг.
  for (let z = WALL_NORTH; z <= WALL_SOUTH; z += 6) pts.push({ x: wallX(z, -1), z });
  // Южная — с запада на восток, выгнута наружу к дороге.
  const sw = wallX(WALL_SOUTH, -1);
  const se = wallX(WALL_SOUTH, 1);
  for (let k = 1; k < 12; k++) {
    const f = k / 12;
    pts.push({ x: lerp(sw, se, f), z: WALL_SOUTH + Math.sin(f * Math.PI) * 5 });
  }
  return smoothPath(pts, 1, true);
}

function castleContour(): P[] {
  const pts: P[] = [];
  const zs = MOAT_Z[0] - 1;
  const zn = -178;
  for (let z = zs; z >= zn; z -= 5) pts.push({ x: axisX(z) + (halfAt(z) - 3), z });
  for (let z = zn; z <= zs; z += 5) pts.push({ x: axisX(z) - (halfAt(z) - 3), z });
  return smoothPath(pts, 1, true);
}

/** Выпуклость поворота контура в вершине: косинус угла между отрезками. */
function turnAt(pts: readonly P[], k: number): number {
  const n = pts.length;
  const a = pts[(k - 3 + n) % n];
  const b = pts[k];
  const c = pts[(k + 3) % n];
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const vx = c.x - b.x;
  const vz = c.z - b.z;
  return (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
}

/** Направление наружу у точки контура (против часовой — нормаль вправо). */
function outward(pts: readonly P[], k: number, center: P): number {
  const n = pts.length;
  const a = pts[(k - 1 + n) % n];
  const b = pts[(k + 1) % n];
  let nx = b.z - a.z;
  let nz = -(b.x - a.x);
  const p = pts[k];
  if (nx * (p.x - center.x) + nz * (p.z - center.z) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return Math.atan2(nz, nx);
}

function nearestIndex(pts: readonly P[], p: P): number {
  let best = 0;
  let bd = Infinity;
  pts.forEach((q, k) => {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

/**
 * Земля под прямоугольным следом: самая высокая и самая низкая точки решёткой 5×5 (углы, середины кромок,
 * середина). `w` — поперёк оси (вправо), `d` — вдоль оси (`fx`, `fz`) — как `kit.Frame` и `geom.box`.
 */
export function footSpan(x: number, z: number, fx: number, fz: number, w: number, d: number): { hi: number; lo: number } {
  let hi = -Infinity;
  let lo = Infinity;
  for (let a = -1; a <= 1; a += 0.5) {
    for (let c = -1; c <= 1; c += 0.5) {
      const h = heightAt(x + (fx * d * a) / 2 + (fz * w * c) / 2, z + (fz * d * a) / 2 - (fx * w * c) / 2);
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
  }
  return { hi, lo };
}

/** Пол постройки над землёй: на столько выше самой высокой земли следа — сетка земли между узлами идёт прямой и вдали, на редкой сетке «Низкого», выше рельефа (охотничий домик — на 0.24 м, `seat.test.ts`). */
export const FLOOR_LIFT = 0.15;

/**
 * Башня на рельефе (docs/city.md, 16.1): низ — самая низкая земля под всем следом (`forts.inTowerShape`: круг у
 * круглой, квадрат по оси у остальных), пол проезда ворот — самая высокая дорога у концов арки и посередине.
 */
function seatTower(t: Tower): Tower {
  const fx = Math.cos(t.out);
  const fz = Math.sin(t.out);
  const h = t.size / 2;
  let foot = t.base;
  for (let a = -1; a <= 1; a += 0.5) {
    for (let c = -1; c <= 1; c += 0.5) {
      if (t.kind === 'round' && Math.hypot(a, c) > 1.01) continue;
      foot = Math.min(foot, heightAt(t.x + (fx * a + fz * c) * h, t.z + (fz * a - fx * c) * h));
    }
  }
  const gate = t.kind === 'gate' || t.kind === 'castleGate';
  const floor = gate ? Math.max(heightAt(t.x + fx * h, t.z + fz * h), heightAt(t.x - fx * h, t.z - fz * h), heightAt(t.x, t.z)) + 0.04 : undefined;
  return { ...t, foot, floor };
}

/** Самая низкая земля под кругом радиуса r. */
function lowUnder(x: number, z: number, r: number): number {
  let lo = heightAt(x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    lo = Math.min(lo, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return lo;
}

function placeTowers(wall: P[], gates: { x: number; z: number; out: number }[], seed: number): Tower[] {
  const towers: Tower[] = [];
  const center = { x: 0, z: 0 };
  const n = wall.length;
  // Длины по контуру.
  const acc: number[] = [0];
  for (let k = 1; k <= n; k++) acc.push(acc[k - 1] + Math.hypot(wall[k % n].x - wall[k - 1].x, wall[k % n].z - wall[k - 1].z));
  const total = acc[n];
  const posOf = (k: number): number => acc[k];
  // Ворота.
  const fixed: number[] = [];
  for (const g of gates) {
    const k = nearestIndex(wall, g);
    fixed.push(posOf(k));
  }
  // Изломы — круглые башни.
  const corners: number[] = [];
  for (let k = 0; k < n; k++) {
    if (turnAt(wall, k) < 0.86) {
      const s = posOf(k);
      if ([...fixed, ...corners].every((f) => Math.min(Math.abs(f - s), total - Math.abs(f - s)) > 30)) corners.push(s);
    }
  }
  const at = (s: number): { p: P; k: number } => {
    let k = 0;
    while (k < n - 1 && acc[k + 1] < s) k++;
    const f = (s - acc[k]) / (acc[k + 1] - acc[k] || 1);
    const a = wall[k];
    const b = wall[(k + 1) % n];
    return { p: { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) }, k };
  };
  const anchors = [...fixed.map((s) => ({ s, kind: 'gate' as const })), ...corners.map((s) => ({ s, kind: 'round' as const }))].sort((a, b) => a.s - b.s);
  // Между якорями — башни через 38–50 м.
  const all: { s: number; kind: TowerKind }[] = [...anchors];
  for (let a = 0; a < anchors.length; a++) {
    const s0 = anchors[a].s;
    const s1 = a + 1 < anchors.length ? anchors[a + 1].s : anchors[0].s + total;
    const span = s1 - s0;
    const cnt = Math.max(0, Math.round(span / 44) - 1);
    for (let c = 1; c <= cnt; c++) all.push({ s: (s0 + (span * c) / (cnt + 1)) % total, kind: 'square' });
  }
  const r = stream(seed);
  for (const t of all) {
    const { p, k } = at(t.s);
    const out = outward(wall, k, center);
    const gate = t.kind === 'gate';
    const g = gates.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 12);
    const main = g !== undefined && g.z > 100;
    let kind: TowerKind = t.kind;
    // Самая заметная башня западной стены над рекой — Дозор.
    if (kind === 'square' && p.x < 0 && p.z > -60 && p.z < -10 && !towers.some((q) => q.kind === 'watch')) kind = 'watch';
    const size = gate ? (main ? 11 : 8.5) : kind === 'round' ? 7.5 + r() * 1.2 : kind === 'watch' ? 8.5 : 7 + r() * 1.2;
    const height = gate ? (main ? 24 : 18) : kind === 'watch' ? 27 : kind === 'round' ? 15 + r() * 3 : 15.5 + r() * 3;
    const px = gate && g ? g.x : p.x;
    const pz = gate && g ? g.z : p.z;
    towers.push({ kind, x: px, z: pz, out: gate && g ? g.out : out, size, height, base: lowUnder(px, pz, size / 2), seed: hash3(Math.round(px * 10), Math.round(pz * 10), seed) });
  }
  return towers;
}

/** Улицы города (центральные линии сглажены). */
function streetsOf(wall: P[]): Street[] {
  const laneX = (z: number, side: -1 | 1): number => axisX(z) + side * 0.58 * (halfAt(z) - 11);
  const lane = (side: -1 | 1): P[] => {
    const pts: P[] = [];
    for (let z = 104; z >= -88; z -= 8) pts.push({ x: laneX(z, side), z });
    return pts;
  };
  // Улица вдоль стены — контур стены, сжатый к середине на 7 м.
  const ring: P[] = wall.map((p, k) => {
    const n = wall.length;
    const a = wall[(k - 1 + n) % n];
    const b = wall[(k + 1) % n];
    let nx = -(b.z - a.z);
    let nz = b.x - a.x;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    if (nx * -p.x + nz * -p.z < 0) {
      nx = -nx;
      nz = -nz;
    }
    return { x: p.x + nx * 7, z: p.z + nz * 7 };
  });
  ring.push(ring[0]);
  const s = (name: string, pts: P[], half: number, surface: Surface, sides: Street['sides'], rich: number, rounds = 2): Street => ({
    name,
    pts: smoothPath(pts, rounds),
    half,
    surface,
    sides,
    rich,
  });
  const gateIn = { x: axisX(WALL_SOUTH), z: WALL_SOUTH + 2 };
  return [
    s('Главная', [gateIn, { x: 2, z: 100 }, { x: 7, z: 74 }, { x: 5, z: 50 }, { x: 1, z: 30 }], 5, 'cobble', 'both', 0.85),
    s('Верхняя', [{ x: 25, z: -24 }, { x: 30, z: -50 }, { x: 25, z: -78 }, { x: 10, z: -100 }, { x: axisX(WALL_NORTH), z: WALL_NORTH - 2 }], 4, 'cobble', 'both', 0.7),
    s('Восточная', [{ x: 31, z: 0 }, { x: 55, z: 3 }, { x: wallX(0, 1) + 2, z: 0 }], 3.5, 'cobble', 'both', 0.6),
    s('Западная', [{ x: -27, z: -24 }, { x: -40, z: -27 }, { x: laneX(-28, -1), z: -28 }], 3, 'dirt', 'both', 0.5, 1),
    s('Переулок Западный', lane(-1), 2.25, 'dirt', 'both', 0.35),
    s('Переулок Восточный', lane(1), 2.25, 'dirt', 'both', 0.35),
    s('Поперечный Южный', [{ x: laneX(80, -1), z: 80 }, { x: 6, z: 80 }, { x: laneX(80, 1), z: 80 }], 2, 'dirt', 'both', 0.4, 1),
    s('Поперечный Средний', [{ x: laneX(46, -1), z: 46 }, { x: 4, z: 46 }], 2, 'dirt', 'both', 0.45, 1),
    // Поперечного Северного (z −64) больше нет: он шёл сквозь двор храма, развёрнутого лицом к площади (docs/city_v3.md).
    { name: 'Вдоль стены', pts: smoothPath(ring, 1), half: 2, surface: 'dirt', sides: 'both', rich: 0.15 },
  ];
}

/**
 * Площадь — неправильный четырёхугольник; с севера к ней прибавлена площадка перед храмом до ограды двора (`PARVIS`):
 * лестница паперти выходит на мостовую.
 */
const SQUARE: P[] = [
  { x: -27, z: 27 },
  { x: 31, z: 29 },
  { x: 28, z: -25 },
  { x: 16, z: -25.5 },
  { x: 16, z: -36 },
  { x: -27.5, z: -36 },
];

/**
 * Храм лицом к площади (docs/city_v3.md, Г-2): западная башня с порталом — к югу, к камере игры; неф уходит на север,
 * апсида — у дальнего края двора. Пол храма — над самой высокой землёй следа (склон мыса поднимается к замку), и к двери
 * ведут паперть — площадка у портала — и широкая лестница на площадь.
 */
export const CHURCH = { x: -4, front: -38, len: 42, width: 16 } as const;
/** Паперть: площадка у портала (до `top`) и лестница до мостовой (`foot`), ширина — `half` в обе стороны от оси. */
export const PARVIS = { half: 6, top: -35.5, foot: -30.5 } as const;
/** Двор храма за оградой: кладбище на западе, сад трав на востоке, плодовые деревья за апсидой. */
export const CLOSE = { x0: -28, x1: 16, z0: -36, z1: -90 } as const;
/** Земля, где домов нет: двор, сад за ним до улицы вдоль стены и полоса до Верхней улицы (коновязь, поилка, повозка). */
const PRECINCT = { x0: -30, x1: 21, z0: -26, z1: -103 } as const;

function civicOf(seed: number): Civic[] {
  const c = (kind: CivicKind, x: number, z: number, rot: number, w: number, d: number): Civic => ({
    kind,
    x,
    z,
    rot,
    w,
    d,
    base: footSpan(x, z, Math.cos(rot), Math.sin(rot), w, d).hi + FLOOR_LIFT,
    seed: hash3(Math.round(x), Math.round(z), seed),
  });
  const E = 0;
  const W = Math.PI;
  const S = Math.PI / 2;
  const N = -Math.PI / 2;
  return [
    // Храм: фасад с башней и порталом — на юг, к площади; неф уходит на север (`CHURCH`).
    c('church', CHURCH.x, CHURCH.front - CHURCH.len / 2, S, CHURCH.width, CHURCH.len),
    // Ратуша: западная сторона площади, аркада к площади (на восток).
    c('hall', -35, -2, E, 32, 13),
    c('granary', 41, 16, W, 24, 12),
    c('guild', 41, -14, W, 18, 13),
    c('smithy', 68, 15, N, 11, 10),
    c('stable', 68, -14, S, 16, 10),
    c('tavern', -11, 104, E, 11, 14),
    c('spital', 19, 103, W, 18, 12),
    // Замок: палас вдоль западной стены, казармы вдоль восточной.
    c('palas', -22, -150, E, 24, 11),
    c('barracks', 18, -146, W, 20, 9),
  ];
}

/** Прямоугольник в плане: середина, полуоси и направления. */
interface Box {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  hu: number;
  hv: number;
}

const boxOfCivic = (c: Civic): Box => {
  const fx = Math.cos(c.rot);
  const fz = Math.sin(c.rot);
  // Фасад смотрит по (fx, fz); длина `w` — вдоль фасада, `d` — вглубь.
  return { cx: c.x, cz: c.z, ux: -fz, uz: fx, hu: c.w / 2, hv: c.d / 2 };
};

const boxOfHouse = (h: House): Box => ({ cx: h.x, cz: h.z, ux: -h.fz, uz: h.fx, hu: h.w / 2, hv: h.d / 2 });

function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  const axes = [
    [a.ux, a.uz],
    [-a.uz, a.ux],
    [b.ux, b.uz],
    [-b.uz, b.ux],
  ];
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  for (const [ax, az] of axes) {
    const pa = Math.abs(a.ux * ax + a.uz * az) * a.hu + Math.abs(-a.uz * ax + a.ux * az) * a.hv;
    const pb = Math.abs(b.ux * ax + b.uz * az) * b.hu + Math.abs(-b.uz * ax + b.ux * az) * b.hv;
    if (Math.abs(dx * ax + dz * az) >= pa + pb - pad) return false;
  }
  return true;
}

function boxCorners(b: Box): P[] {
  const vx = -b.uz;
  const vz = b.ux;
  const out: P[] = [];
  for (const [su, sv] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [0, 0],
  ]) {
    out.push({ x: b.cx + b.ux * b.hu * su + vx * b.hv * sv, z: b.cz + b.uz * b.hu * su + vz * b.hv * sv });
  }
  return out;
}

/** Двор храма, площадь и места больших зданий — запретная для домов земля. */
function reserved(civic: Civic[]): Box[] {
  const out = civic.map((c) => {
    const b = boxOfCivic(c);
    return { ...b, hu: b.hu + 2, hv: b.hv + 2 };
  });
  // Двор храма с оградой и полоса до Верхней улицы: дома позади и по бокам храма убраны (docs/city_v3.md).
  const P = PRECINCT;
  out.push({ cx: (P.x0 + P.x1) / 2, cz: (P.z0 + P.z1) / 2, ux: 1, uz: 0, hu: (P.x1 - P.x0) / 2, hv: (P.z0 - P.z1) / 2 });
  // Колодец, статуя и ряды — на площади, она и так запретна.
  return out;
}

/** Расставить дома по сторонам улиц. */
function placeHouses(streets: Street[], wall: P[], blocked: Box[], seed: number): House[] {
  const houses: House[] = [];
  const boxes: Box[] = [];
  const r = stream(seed);
  const tryHouse = (st: Street, p: P, t: P, side: 1 | -1, w: number, d: number): House | null => {
    // Нормаль к улице в сторону участка.
    const nx = -t.z * side;
    const nz = t.x * side;
    const front = st.half + 0.25;
    const cx = p.x + nx * (front + d / 2);
    const cz = p.z + nz * (front + d / 2);
    const box: Box = { cx, cz, ux: t.x, uz: t.z, hu: w / 2, hv: d / 2 };
    const pts = boxCorners(box);
    for (const q of pts) {
      if (!insidePoly(q, wall) || distPoly(q, wall, true) < 8.6) return null;
      if (insidePoly(q, SQUARE) || distPoly(q, SQUARE, true) < 0.2) return null;
      for (const o of streets) {
        const lim = o === st ? o.half + 0.2 : o.half + 0.4;
        if (distPoly(q, o.pts) < lim) return null;
      }
    }
    for (const b of blocked) if (boxesOverlap(box, b)) return null;
    for (const b of boxes) if (boxesOverlap(box, b, 0.05)) return null;
    const fx = -nx;
    const fz = -nz;
    // Пол — не ниже земли под домом и не ниже земли у фасада; низ — самая низкая земля под домом.
    const fl = heightAt(p.x + nx * (front + 0.5), p.z + nz * (front + 0.5));
    const span = footSpan(cx, cz, fx, fz, w, d);
    const rich = st.rich;
    const stone = r() < 0.12 + rich * 0.35;
    const floors = r() < 0.15 + rich * 0.55 ? 3 : 2;
    const h: House = {
      x: cx,
      z: cz,
      fx,
      fz,
      w,
      d,
      floors,
      style: stone ? 'stone' : r() < 0.18 ? 'plaster' : 'timber',
      frame: Math.floor(r() * 3),
      gable: r() < 0.66,
      roof: r() < 0.72 ? 'tile' : r() < 0.6 ? 'shingle' : 'slate',
      pitch: (48 + r() * 12) * (Math.PI / 180),
      jetty: stone ? 0 : 0.28 + r() * 0.3,
      floor: Math.max(fl, span.hi + FLOOR_LIFT),
      low: Math.min(fl, span.lo),
      street: fl,
      wallTint: Math.floor(r() * 7),
      roofTint: Math.floor(r() * 6),
      seed: Math.floor(r() * 1e9),
      rich,
    };
    houses.push(h);
    boxes.push(box);
    return h;
  };
  for (const st of streets) {
    if (st.sides === 'none') continue;
    const len = polyLength(st.pts);
    for (const side of [1, -1] as const) {
      if ((st.sides === 'left' && side !== 1) || (st.sides === 'right' && side !== -1)) continue;
      let s = 1;
      while (s < len - 2) {
        const w = 4.8 + r() * 3 + st.rich * 1.4;
        const mid = along(st.pts, s + w / 2);
        let placed = false;
        for (const d of [9 + r() * 3 + st.rich * 3.5, 8.5, 7]) {
          for (const ww of [w, w * 0.8, 4.6]) {
            if (tryHouse(st, mid.p, mid.t, side, ww, d)) {
              s += ww + (r() < 0.06 ? 1.2 : 0);
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        if (!placed) s += 1.5;
      }
    }
  }
  // Ряд вдоль площади: дома смотрят на неё.
  const sq = SQUARE;
  for (let k = 0; k < sq.length; k++) {
    const a = sq[k];
    const b = sq[(k + 1) % sq.length];
    const st: Street = { name: 'Площадь', pts: [a, b], half: 0, surface: 'cobble', sides: 'both', rich: 1 };
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let s = 0.5;
    // Площадь обходится по часовой: участки — справа от хода, наружу.
    while (s < len - 2) {
      const w = 6.5 + r() * 3;
      const mid = along(st.pts, s + w / 2);
      let placed = false;
      for (const ww of [w, w * 0.8, 5]) {
        const dd = 11 + r() * 3;
        if (tryHouse(st, mid.p, mid.t, -1, ww, dd) || tryHouse(st, mid.p, mid.t, 1, ww, dd)) {
          s += ww;
          placed = true;
          break;
        }
      }
      if (!placed) s += 1.5;
    }
  }
  return houses;
}

function placeStalls(seed: number): Stall[] {
  const out: Stall[] = [];
  const r = stream(seed);
  // Ряды — в южной половине площади, но не вплотную к домам; колодец с огнём — в северной.
  for (let row = 0; row < 3; row++) {
    const z = 5 + row * 6.5;
    for (let x = -12; x < 22; x += 4.2 + r() * 0.8) {
      out.push({ x, z: z + (r() - 0.5) * 0.6, rot: row % 2 ? Math.PI : 0, w: 3.2 + r() * 0.8, seed: Math.floor(r() * 1e9) });
    }
  }
  return out;
}

/** План города от зерна — один на вид. */
export function cityPlan(seed = CITY_SEED): CityPlan {
  const wall = wallContour();
  const castleWall = castleContour();
  const gates = [
    { x: axisX(WALL_SOUTH), z: WALL_SOUTH + 5, out: Math.PI / 2 },
    { x: wallX(0, 1), z: 0, out: 0 },
    { x: axisX(WALL_NORTH), z: WALL_NORTH - 1.5, out: -Math.PI / 2 },
  ];
  const towers = placeTowers(wall, gates, seed);
  // Замок: ворота, донжон, башни по углам.
  const cw = castleWall;
  const keep: Tower = { kind: 'keep', x: -4, z: -147, out: -Math.PI / 2, size: 13, height: 30, base: lowUnder(-4, -147, 6.5), seed: seed + 5 };
  const cGate: Tower = { kind: 'castleGate', x: axisX(MOAT_Z[0] - 1), z: MOAT_Z[0] - 1, out: Math.PI / 2, size: 9, height: 19, base: lowUnder(axisX(MOAT_Z[0] - 1), MOAT_Z[0] - 1, 4.5), seed: seed + 7 };
  const cTowers = [-0.18, 0.18, 0.42, 0.58].map((f, i) => {
    const k = Math.floor(f < 0 ? cw.length + f * cw.length : f * cw.length) % cw.length;
    const p = cw[k];
    return { kind: 'round' as TowerKind, x: p.x, z: p.z, out: outward(cw, k, { x: -4, z: -147 }), size: 7, height: 17, base: lowUnder(p.x, p.z, 3.5), seed: seed + 11 + i };
  });
  const civic = civicOf(seed);
  const streets = streetsOf(wall);
  const blocked = reserved(civic);
  const houses = placeHouses(streets, wall, blocked, seed + 1);
  const stalls = placeStalls(seed + 2);
  // Деревья: липа на площади у храма, плодовые во дворах (за домами, где пусто).
  const yardTrees: CityPlan['yardTrees'] = [
    { x: -18, z: -21, r: 4.5, seed: 1 },
    // Двор храма: тисы на кладбище, дерево в саду трав, плодовые за апсидой.
    { x: -24.5, z: -47, r: 3.2, seed: 2 },
    { x: -21, z: -79, r: 3.6, seed: 3 },
    { x: 12.5, z: -68, r: 2.6, seed: 4 },
    { x: -11, z: -86.5, r: 3, seed: 5 },
    { x: 1, z: -87.5, r: 3.2, seed: 6 },
    { x: 11, z: -84, r: 2.8, seed: 7 },
    // За оградой двора, до улицы вдоль стены, — сад: там стояли дома позади храма.
    { x: -17, z: -97, r: 3.2, seed: 8 },
    { x: -4, z: -98.5, r: 3.4, seed: 9 },
    { x: 9, z: -96.5, r: 3, seed: 10 },
  ];
  const tr = stream(seed + 3);
  const hb = houses.map(boxOfHouse);
  for (let k = 0; k < 4000 && yardTrees.length < 90; k++) {
    const x = (tr() - 0.5) * 180;
    const z = 120 - tr() * 225;
    const p = { x, z };
    if (!insidePoly(p, wall) || distPoly(p, wall, true) < 8) continue;
    if (insidePoly(p, SQUARE)) continue;
    if (streets.some((s) => distPoly(p, s.pts) < s.half + 2.2)) continue;
    const probe: Box = { cx: x, cz: z, ux: 1, uz: 0, hu: 1.6, hv: 1.6 };
    if (hb.some((b) => boxesOverlap(probe, b))) continue;
    if (blocked.some((b) => boxesOverlap(probe, b))) continue;
    if (yardTrees.some((t) => Math.hypot(t.x - x, t.z - z) < 6)) continue;
    yardTrees.push({ x, z, r: 2.4 + tr() * 1.6, seed: Math.floor(tr() * 1e9) });
  }
  const roads = roadsOf(gates);
  const yards = yardsOf(seed);
  const suburb = placeSuburb(roads[0], wall, yards, seed + 4);
  return {
    wall,
    castleWall,
    towers: [...towers, keep, cGate, ...cTowers].map(seatTower),
    gates,
    streets,
    square: SQUARE,
    civic,
    houses,
    stalls,
    well: { x: 2, z: -7 },
    statue: { x: -21, z: 5 },
    yardTrees,
    roads,
    yards,
    suburb,
  };
}

void rnd;
