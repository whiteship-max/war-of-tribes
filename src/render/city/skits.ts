// Сценки жителей вблизи (docs/city_v3.md, ЖГ-2): потасовка у трактира, пьяные песни, танцы на площади, торг у лотка, вдова
// после проигранного боя, дети, проповедник, влюблённые, кости у ворот, погоня за вором, похороны, пир после победы; за
// стеной — путники с телегой, пастух со стадом, жнецы, охотник, паломники, лазутчики разбойников на опушке.
//
// Только вид и звук: механики здесь нет. Всё — чистые функции и один режиссёр без своих часов:
// - **каталог** (`SKITS`) — где сценка бывает (`PlaceKind`), её вес по часу, погоде и состоянию города (`skitWeight`), состав
//   и позы актёров по времени (`posesOf`);
// - **место** (`placeKind`, `layoutOk`) — что за земля под точкой взгляда (трактир, площадь, паперть, поле, опушка…) и не
//   встанет ли кто из актёров в дом, в постройку, в дерево или на проход;
// - **режиссёр** (`SkitDirector`) — сколько сценок играет сразу (по уровню, `spec.SKITS`), какие и где: только при
//   максимальном приближении камеры (`SKIT_ZOOM`), рядом с точкой взгляда, не одна и та же подряд.
//
// Рисует их `skitview.ts` (ленивый кусок), звук — `sound/epoch/skits.ts` через ухо камеры (`sound/ear.hearSkits`).
import type { Quality } from '../quality';
import { CHURCH, PARVIS, SQUARE_PROPS, distPoly, heightAt, insidePoly, type CityPlan, type P } from './layout';
import { SQUARE_PATHS, at, heightOnPath, nearestOn, pathOf, standFree, type Path } from './life';
import { forestAt } from './nature';
import { fieldAt, inRiver, openLand } from './ground';
import type { Site } from './sites';
import type { CityMood, DayRhythm } from './rhythm';
import { SKITS_CAP } from './spec';

// ---------------------------------------------------------------------------------------------
// Что за место под точкой.

/**
 * Где играют сценки: в городе — у трактира, на площади, у рядов рынка, на паперти, у ворот и казармы, в переулках; за
 * стеной — на дороге, в поле, на лугу, на опушке.
 */
export type PlaceKind = 'tavern' | 'square' | 'market' | 'parvis' | 'gate' | 'lane' | 'road' | 'field' | 'meadow' | 'edge';

export const TOWN_PLACES: readonly PlaceKind[] = ['tavern', 'square', 'market', 'parvis', 'gate', 'lane'];

/** Что сценкам нужно от города: план, коробки построек и проходы — улицы с площадью в стене и дороги за ней. */
export interface SkitWorld {
  plan: CityPlan;
  sites: readonly Site[];
  /** Проходы в стене: улицы и дорожки площади — на них не стоят. */
  walks: Path[];
  /** Дороги за стеной: по ним идут путники и паломники. */
  roads: Path[];
  tavern: Site | null;
  market: Site | null;
}

const ground = (p: P): number => heightAt(p.x, p.z);

export function skitWorld(plan: CityPlan, sites: readonly Site[]): SkitWorld {
  const walks = [...plan.streets.map((s) => pathOf(s.pts, s.half, ground)), ...SQUARE_PATHS.map((s) => pathOf(s.pts, s.half, ground))];
  const roads = plan.roads.map((r) => pathOf(r.pts, r.half, ground));
  const main = (t: string): Site | null => sites.find((s) => s.type === t) ?? null;
  return { plan, sites, walks, roads, tavern: main('tavern'), market: main('market') };
}

/** Точка в коробке постройки — с запасом `pad`. */
export function inSite(x: number, z: number, s: Site, pad: number): boolean {
  const dx = x - s.x;
  const dz = z - s.z;
  return Math.abs(dx * s.fx + dz * s.fz) < s.hf + pad && Math.abs(-dx * s.fz + dz * s.fx) < s.hr + pad;
}

export const inTown = (plan: CityPlan, x: number, z: number): boolean => insidePoly({ x, z }, plan.wall) || insidePoly({ x, z }, plan.castleWall);

/** Что за место под точкой (`null` — вода, стена, двор, предместье: там сценок нет). */
export function placeKind(w: SkitWorld, x: number, z: number): PlaceKind | null {
  const plan = w.plan;
  if (inTown(plan, x, z)) {
    if (w.tavern && Math.hypot(x - w.tavern.x, z - w.tavern.z) < 24) return 'tavern';
    if (Math.abs(x - CHURCH.x) < 15 && z > CHURCH.front && z < CHURCH.front + 15) return 'parvis';
    if (w.market && inSite(x, z, w.market, 6)) return 'market';
    if (insidePoly({ x, z }, plan.square)) return 'square';
    if (insidePoly({ x, z }, plan.castleWall)) return 'gate';
    if (plan.gates.some((g) => Math.hypot(x - g.x, z - g.z) < 28)) return 'gate';
    return 'lane';
  }
  if (inRiver(x, z)) return null;
  const p = { x, z };
  if (distPoly(p, plan.wall, true) < 8 || distPoly(p, plan.castleWall, true) < 8) return null;
  if (fieldAt(x, z, plan) > 0) return 'field';
  if (!openLand(x, z, plan, 1)) return w.roads.some((r) => nearestOn(r, p).d < r.half + 6) ? 'road' : null;
  if (w.roads.some((r) => nearestOn(r, p).d < r.half + 6)) return 'road';
  if (woods(plan, x, z)) return null;
  // Опушка: под ногами чисто, а в дюжине метров — лес.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    if (forestAt(x + Math.cos(a) * 14, z + Math.sin(a) * 14, plan) > 0.45) return 'edge';
  }
  return 'meadow';
}

/** Кроны: дерево встаёт там, где лес гуще 0,08 (`nature.placeTrees`), и раскидывает крону метров на пять. */
const woods = (plan: CityPlan, x: number, z: number): boolean => {
  if (forestAt(x, z, plan) > 0.05) return true;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    if (forestAt(x + Math.cos(a) * 5, z + Math.sin(a) * 5, plan) > 0.08) return true;
  }
  return false;
};

/**
 * Поляна вокруг середины сценки за стеной: ни одного места, где встанет дерево (лес гуще 0,08 — и на межах между полями), в
 * шести метрах, а не на опушке — и в одиннадцати: крона высокого дерева — до девяти метров, она закрыла бы сценку сверху.
 */
export function clearing(plan: CityPlan, x: number, z: number, edge: boolean): boolean {
  for (const r of edge ? [6] : [6, 11]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (forestAt(x + Math.cos(a) * r, z + Math.sin(a) * r, plan) > 0.08) return false;
    }
  }
  return true;
}

/** Стоит ли актёр на своём месте: не в доме, не в постройке, не в дереве и не в воде, в своей части мира. */
export function spotFree(w: SkitWorld, x: number, z: number, town: boolean): boolean {
  const plan = w.plan;
  if (inTown(plan, x, z) !== town) return false;
  if (!standFree(plan, x, z)) return false;
  for (const s of w.sites) if (s.type !== 'church' && Math.abs(x - s.x) < 30 && Math.abs(z - s.z) < 30 && inSite(x, z, s, 0.6)) return false;
  // Паперть — площадка и лестница над мостовой (`precinct.parvis`), и кружки прихожан у её подножия: земля под ногами там
  // не `heightAt`, а место — жизни города.
  if (town && Math.abs(x - CHURCH.x) < CHURCH.width / 2 + 4 && z > CHURCH.front - 1 && z < PARVIS.foot + 4.5) return false;
  if (town) return distPoly({ x, z }, plan.wall, true) > 4;
  if (inRiver(x, z) || woods(plan, x, z)) return false;
  for (const h of plan.suburb) if (Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) / 2 + 1.5) return false;
  for (const y of plan.yards) if (Math.hypot(x - y.x, z - y.z) < y.r) return false;
  return true;
}

/** Коробка пути с запасом — дальние пути не считать. */
const boxes = new WeakMap<Path, { x0: number; x1: number; z0: number; z1: number }>();
function boxOf(w: Path): { x0: number; x1: number; z0: number; z1: number } {
  let b = boxes.get(w);
  if (!b) {
    b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const p of w.pts) {
      b.x0 = Math.min(b.x0, p.x - w.half - 1);
      b.x1 = Math.max(b.x1, p.x + w.half + 1);
      b.z0 = Math.min(b.z0, p.z - w.half - 1);
      b.z1 = Math.max(b.z1, p.z + w.half + 1);
    }
    boxes.set(w, b);
  }
  return b;
}

/** На проходе ли точка: ближе полуширины прохода с запасом в полметра. */
export function onWalk(paths: readonly Path[], x: number, z: number): boolean {
  for (const w of paths) {
    const b = boxOf(w);
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    if (nearestOn(w, { x, z }).d < w.half + 0.5) return true;
  }
  return false;
}

/**
 * Места, которые держит жизнь города и убранство площади: колодец, статуя, хоровод праздника, доска объявлений, свечные
 * лотки, колодки, коновязь с поилкой, — туда сценки не встают.
 */
const KEEP_CLEAR: readonly { x: number; z: number; r: number }[] = [
  { x: 2, z: -7, r: 4.5 },
  { x: -21, z: 5, r: 3 },
  { x: -21, z: -3.5, r: 6 },
  { ...SQUARE_PROPS.board, r: 2.2 },
  ...SQUARE_PROPS.stalls.map((p) => ({ ...p, r: 1.8 })),
  { ...SQUARE_PROPS.stocks, r: 2 },
  { x: SQUARE_PROPS.rail.x, z: (SQUARE_PROPS.rail.z0 + SQUARE_PROPS.rail.z1) / 2, r: 4.5 },
  { ...SQUARE_PROPS.trough, r: 2 },
];

// ---------------------------------------------------------------------------------------------
// Каталог.

export type SkitId =
  | 'brawl'
  | 'drunks'
  | 'dance'
  | 'haggle'
  | 'widow'
  | 'children'
  | 'preacher'
  | 'lovers'
  | 'dice'
  | 'thief'
  | 'funeral'
  | 'revel'
  | 'travelers'
  | 'shepherd'
  | 'reapers'
  | 'hunter'
  | 'pilgrims'
  | 'scouts';

/** Что известно сценкам о минуте: распорядок, состояние города, погода, сезон, близкое логово. */
export interface SkitCtx {
  solar: number;
  rh: DayRhythm;
  mood: CityMood;
  rain: number;
  snow: number;
  storm: number;
  winter: boolean;
  /** Разведанное логово разбойников близко к городу (`LAIR_NEAR` клеток). */
  lair: boolean;
}

/** Фигура актёра: горожане трёх видов, стражник, скотина, телега с волом, вещь (коробка). */
export type Fig = 'hood' | 'cap' | 'woman' | 'guard' | 'beast' | 'cart' | 'prop';

export interface Cast {
  fig: Fig;
  /** Цвет одежды (или вещи), шестнадцатеричный; нет — свой у каждого. */
  color?: number;
  /** Вторая ткань: капюшон, платок. */
  second?: number;
  /** Размер: дети — 0,62, собака — 0,55. */
  scale?: number;
  /** Размеры вещи, м: ширина (вбок), высота, длина (вперёд). */
  box?: readonly [number, number, number];
}

/** Поза актёра в миг: место в рамке сценки, поворот, наклон, шаг. */
export interface Pose {
  /** Вперёд (к камере у стоящих, по ходу у идущих), вправо, вверх от земли, м. */
  u: number;
  v: number;
  y: number;
  /** Поворот в рамке: 0 — лицом вперёд (`u`), π/2 — вправо (`v`). */
  yaw: number;
  /** Наклон вперёд и вбок, рад. */
  lean: number;
  roll: number;
  /** Пройденный путь (шаг в шейдере) и размах шага 0..1. */
  walk: number;
  amp: number;
  hide: boolean;
}

export interface SkitDef {
  id: SkitId;
  /** Где бывает. */
  where: readonly PlaceKind[];
  /** Идёт по проходу (погоня, похороны, путники) или стоит на месте. */
  moving: boolean;
  /** Скорость хода по проходу, м/с (у стоящих — 0). */
  speed: number;
  /** Сколько длится, с: от и до. */
  len: readonly [number, number];
  cast: readonly Cast[];
  /** Позы в миг `lt` (с от начала) из `L`; `r` — жребий сценки 0..1. */
  pose: (lt: number, L: number, r: number, out: Pose[]) => void;
  /** Фонарь в темноте: у какого актёра (или на какой вещи) и где от него в рамке, м. */
  lamp?: { actor: number; u: number; v: number; y: number };
}

const band = (x: number, a: number, b: number, e: number): number => {
  const s = (t: number, lo: number, hi: number): number => {
    const k = Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
    return k * k * (3 - 2 * k);
  };
  return s(x, a - e, a + e) * (1 - s(x, b - e, b + e));
};
/** День: от рассвета до заката; вечер: сумерки; ночь — после сумерек до предрассветья (доли фазы солнца, `rhythm`). */
export const dayOf = (solar: number): number => band(solar, 0.03, 0.46, 0.02);
export const eveOf = (solar: number): number => band(solar, 0.44, 0.64, 0.03);
export const nightOf = (solar: number): number => band(solar, 0.6, 0.97, 0.03);

/** Порог погоды: сильный дождь, снегопад или гроза гонят с улицы гулянье. */
const wet = (c: SkitCtx): number => Math.max(c.rain, c.snow * 0.8, c.storm);

/**
 * Вес сценки в эту минуту, 0 — не бывает. Час (`dayOf`, `eveOf`, `nightOf`), погода и состояние города: в тревогу в городе
 * пусто (все на стенах или по домам), праздник — пляшут и пируют, траур после поражения — вдова и похороны, голод — воры и
 * проповедь, мор — похороны и проповедь, хмуро — драка, весело — танцы и влюблённые.
 */
export function skitWeight(id: SkitId, c: SkitCtx): number {
  const m = c.mood;
  const day = dayOf(c.solar);
  const eve = eveOf(c.solar);
  const night = nightOf(c.solar);
  const dry = 1 - Math.min(1, wet(c) / 0.35);
  const up = Math.max(0, m.cheer);
  const down = Math.max(0, -m.cheer);
  const town = 1 - m.alarm;
  const gay = (1 - m.mourn) * (1 - m.plague) * (1 - 0.7 * m.hunger);
  const w = ((): number => {
    switch (id) {
      case 'brawl':
        return (eve + night * 0.7) * (0.5 + down + 0.6 * m.hunger) * (1 - m.mourn * 0.7);
      case 'drunks':
        return (eve * 0.8 + night) * (0.6 + up + m.feast) * (1 - m.plague) * (1 - 0.8 * m.mourn);
      case 'dance':
        return (day * 0.5 + eve) * dry * gay * (m.feast + up * 0.9 + (m.cheer > -0.2 ? 0.25 : 0));
      case 'haggle':
        return c.rh.market * (0.9 + 0.5 * m.hunger) * (1 - 0.5 * m.plague) * (1 - 0.6 * wet(c));
      case 'widow':
        return day * m.mourn * 2.2;
      case 'children':
        return day * (1 - m.plague) * (1 - Math.min(1, c.rain / 0.3)) * (0.7 + up * 0.5);
      case 'preacher':
        return day * dry * (0.35 + m.plague + m.hunger * 0.8 + m.mourn * 0.8);
      case 'lovers':
        return (eve + day * 0.25) * dry * gay * (0.4 + up + m.feast * 0.5);
      case 'dice':
        return (eve + night * 0.8 + day * 0.2) * (1 - 0.7 * wet(c)) * (1 - 0.5 * m.mourn);
      case 'thief':
        return (day * 0.7 + eve * 0.6 + night * 0.4) * (0.35 + 1.4 * m.hunger + down * 0.4);
      case 'funeral':
        return day * Math.max(m.mourn, m.plague) * 2;
      case 'revel':
        return (day * 0.6 + eve) * m.feast * 2.4 * (1 - 0.6 * wet(c));
      case 'travelers':
        return day * (1 - 0.5 * c.storm);
      case 'shepherd':
        return day * (c.winter ? 0 : 1) * (1 - 0.6 * wet(c));
      case 'reapers':
        return band(c.solar, 0.04, 0.42, 0.02) * (c.winter ? 0 : 1) * dry;
      case 'hunter':
        return (day + band(c.solar, 0.95, 1.05, 0.03)) * (1 - 0.5 * wet(c));
      case 'pilgrims':
        return day * (0.5 + m.plague + m.mourn * 0.5) * (1 - 0.6 * c.storm);
      case 'scouts':
        return c.lair ? (day * 0.6 + eve + night) * 1.6 : 0;
    }
  })();
  const def = SKIT_BY[id];
  const inTownOnly = def.where.every((k) => TOWN_PLACES.includes(k));
  // В тревогу город пуст, а за стеной видны только лазутчики врага.
  if (m.alarm > 0) return id === 'scouts' ? w : 0;
  return Math.max(0, inTownOnly ? w * town : w);
}

// ---------------------------------------------------------------------------------------------
// Позы.

const pose0 = (): Pose => ({ u: 0, v: 0, y: 0, yaw: 0, lean: 0, roll: 0, walk: 0, amp: 0, hide: false });
const put = (o: Pose, u: number, v: number, yaw: number, extra?: Partial<Pose>): void => {
  o.u = u;
  o.v = v;
  o.y = 0;
  o.yaw = yaw;
  o.lean = 0;
  o.roll = 0;
  o.walk = 0;
  o.amp = 0;
  o.hide = false;
  if (extra) Object.assign(o, extra);
};
/** Лицом к точке рамки. */
const face = (u: number, v: number, tu: number, tv: number): number => Math.atan2(tv - v, tu - u);
const sm = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};
/** Идёт от (u0, v0) к (u1, v1) за время [t0, t1]: место, поворот по ходу и шаг. */
function walkLeg(o: Pose, lt: number, t0: number, t1: number, u0: number, v0: number, u1: number, v1: number): boolean {
  if (lt < t0 || lt > t1) return false;
  const k = (lt - t0) / (t1 - t0);
  const d = Math.hypot(u1 - u0, v1 - v0);
  put(o, u0 + (u1 - u0) * k, v0 + (v1 - v0) * k, Math.atan2(v1 - v0, u1 - u0), { walk: d * k, amp: 1 });
  return true;
}

const BLACK = 0x2a2624;
const MONK = 0x5a4632;
const STRAW = 0xc8a858;
const WOOD = 0x6a5038;
const LINEN = 0xd8cfb8;

export const SKITS: readonly SkitDef[] = [
  {
    // Потасовка у трактира: двое сцепились, вокруг глазеют; на середине прибегают двое стражи и растаскивают.
    id: 'brawl',
    where: ['tavern', 'square', 'lane'],
    moving: false,
    speed: 0,
    len: [34, 46],
    cast: [{ fig: 'cap' }, { fig: 'hood' }, { fig: 'hood' }, { fig: 'woman' }, { fig: 'cap' }, { fig: 'guard' }, { fig: 'guard' }],
    pose(lt, L, r, o) {
      const sep = L * 0.55;
      const torn = sm((lt - sep) / 2);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const sway = Math.sin(lt * 3.1 + i * 1.7) * 0.35 * (1 - torn);
        const lunge = Math.max(0, Math.sin(lt * 4.3 + i * 2.1)) * 0.3 * (1 - torn);
        const gap = 0.55 + 1.6 * torn;
        put(o[i], sway * 0.6, s * (gap - lunge) + sway, s > 0 ? -Math.PI / 2 : Math.PI / 2, {
          lean: 0.18 + lunge * 0.6 - torn * 0.1,
          roll: sway * 0.25,
          walk: lt * 1.2,
          amp: 0.4 * (1 - torn),
        });
      }
      // Глазеют кругом, качаются с ноги на ногу.
      const ring: readonly [number, number][] = [
        [2.6, -1.4],
        [2.2, 1.8],
        [-2.4, 0.6],
      ];
      for (let i = 0; i < 3; i++) {
        const [u, v] = ring[i];
        put(o[2 + i], u, v, face(u, v, 0, 0), { lean: 0.05 + 0.05 * Math.sin(lt * 2 + i), walk: lt * 0.6 + i, amp: 0.25 });
      }
      // Стража: бегом от края, потом держит каждого за своим.
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const g = o[5 + i];
        const from: readonly [number, number] = [-7 - 2 * r, s * 5];
        const to: readonly [number, number] = [-0.5, s * 1.4];
        if (lt < sep - 4) put(g, 0, 0, 0, { hide: true });
        else if (!walkLeg(g, lt, sep - 4, sep, from[0], from[1], to[0], to[1])) put(g, to[0], s * (1.4 + 1.3 * torn), face(to[0], s, 0, 0), { lean: 0.12 });
      }
    },
  },
  {
    // Пьяные поют: трое в обнимку бредут улицей от трактира, качаясь от края к краю.
    id: 'drunks',
    where: ['tavern', 'lane', 'square'],
    moving: true,
    speed: 0.45,
    len: [36, 48],
    cast: [{ fig: 'hood' }, { fig: 'cap' }, { fig: 'hood' }],
    lamp: { actor: 0, u: 0.3, v: -0.15, y: 0.75 },
    pose(lt, _L, _r, o) {
      // Бредут улицей домой в обнимку, качаясь от края к краю; кто-то отстаёт и догоняет.
      const drift = Math.sin(lt * 0.5) * 0.7;
      for (let i = 0; i < 3; i++) {
        const sway = Math.sin(lt * 1.7 + i * 0.6) * 0.22;
        put(o[i], Math.sin(lt * 0.4 + i * 2) * 0.35, drift + (i - 1) * 0.6, 0, {
          roll: sway,
          lean: 0.06 + Math.abs(sway) * 0.4,
          walk: lt * 0.45 + i * 0.3,
          amp: 0.8,
        });
      }
    },
  },
  {
    // Танцы на площади: круг из шести идёт посолонь вприпрыжку; дударь и бубенщик — у края.
    id: 'dance',
    where: ['square', 'parvis', 'market', 'meadow'],
    moving: false,
    speed: 0,
    len: [40, 60],
    cast: [{ fig: 'woman' }, { fig: 'hood' }, { fig: 'woman' }, { fig: 'cap' }, { fig: 'woman' }, { fig: 'hood' }, { fig: 'cap', color: 0x8a2f2a }, { fig: 'hood', color: 0x4a5a72 }],
    pose(lt, _L, _r, o) {
      const R = 2.1;
      for (let i = 0; i < 6; i++) {
        const a = lt * 0.7 + (i / 6) * Math.PI * 2;
        const hop = Math.abs(Math.sin(lt * 4.2 + i * 0.9)) * 0.16;
        // Идёт по кругу — лицом по касательной.
        put(o[i], Math.cos(a) * R, Math.sin(a) * R, a + Math.PI / 2, { y: hop, walk: lt * 1.5, amp: 0.9, roll: Math.sin(lt * 4.2 + i) * 0.08 });
      }
      put(o[6], -3.6, -1.3, face(-3.6, -1.3, 0, 0), { lean: 0.04 * Math.sin(lt * 3), y: Math.abs(Math.sin(lt * 4.2)) * 0.05 });
      put(o[7], -3.4, 1.1, face(-3.4, 1.1, 0, 0), { lean: 0.08 * Math.max(0, Math.sin(lt * 8.4)) });
    },
  },
  {
    // Торг у лотка: купец за столом с товаром, покупатель торгуется — подаётся вперёд, отшатывается; рядом вторая ждёт.
    id: 'haggle',
    where: ['market', 'square', 'parvis'],
    moving: false,
    speed: 0,
    len: [36, 50],
    cast: [
      { fig: 'cap', color: 0x7a5a2a },
      { fig: 'woman' },
      { fig: 'hood' },
      { fig: 'prop', color: 0x9a7048, box: [1.8, 0.82, 0.8] },
      { fig: 'prop', color: 0x8a3a30, box: [1.7, 0.06, 0.7] },
      { fig: 'prop', color: STRAW, box: [0.42, 0.36, 0.42] },
      { fig: 'prop', color: 0xa86a3a, box: [0.36, 0.3, 0.36] },
    ],
    pose(lt, _L, _r, o) {
      put(o[0], -0.9, 0, 0, { lean: 0.05 + 0.12 * Math.max(0, Math.sin(lt * 1.3 + 1)) });
      // Покупатель: торг — вперёд и назад, на середине разворачивается уйти и возвращается.
      const haggle = Math.sin(lt * 1.3);
      const leave = sm((lt % 18) / 2 - 6) * (1 - sm((lt % 18) / 2 - 7.5));
      put(o[1], 0.95 + 0.25 * Math.max(0, -haggle) + leave * 0.9, 0.15, Math.PI + leave * 2.4, {
        lean: 0.15 * Math.max(0, haggle),
        walk: lt * 0.4,
        amp: leave > 0.05 ? 0.6 : 0,
      });
      put(o[2], 1.4, 1.5, face(1.4, 1.5, 0, 0));
      put(o[3], 0, 0, Math.PI / 2);
      put(o[4], 0, 0, Math.PI / 2, { y: 0.82 });
      put(o[5], -0.1, -0.5, 0.3, { y: 0.88 });
      put(o[6], 0.05, 0.45, -0.2, { y: 0.88 });
    },
  },
  {
    // Вдова плачет после проигранного боя: на коленях, согнувшись; две женщины рядом утешают, ребёнок жмётся.
    id: 'widow',
    where: ['parvis', 'square', 'lane'],
    moving: false,
    speed: 0,
    len: [40, 56],
    cast: [{ fig: 'woman', color: BLACK, second: BLACK }, { fig: 'woman', color: 0x4a4038 }, { fig: 'woman' }, { fig: 'hood', scale: 0.62 }],
    pose(lt, _L, _r, o) {
      const sob = Math.max(0, Math.sin(lt * 2.6)) * 0.1;
      put(o[0], 0, 0, 0, { y: -0.42, lean: 0.42 + sob });
      put(o[1], -0.1, -0.75, Math.PI / 2 - 0.3, { lean: 0.2 + 0.04 * Math.sin(lt * 0.8) });
      put(o[2], -0.7, 0.55, face(-0.7, 0.55, 0, 0), { lean: 0.12 });
      put(o[3], 0.2, 0.62, face(0.2, 0.62, 0, 0), { lean: 0.1 });
    },
  },
  {
    // Дети играют в салки: четверо бегают кругами и врассыпную, догоняют друг друга.
    id: 'children',
    where: ['square', 'lane', 'market', 'meadow', 'parvis'],
    moving: false,
    speed: 0,
    len: [30, 44],
    cast: [{ fig: 'hood', scale: 0.6 }, { fig: 'woman', scale: 0.6 }, { fig: 'cap', scale: 0.6 }, { fig: 'woman', scale: 0.58 }],
    pose(lt, _L, r, o) {
      for (let i = 0; i < 4; i++) {
        // Восьмёрки разного размаха: кто-то догоняет, кто-то убегает.
        const a = lt * (1.05 + i * 0.12) + i * 1.6 + r * 5;
        const R = 2.4 + i * 0.35;
        const u = Math.sin(a) * R;
        const v = Math.sin(a * 2) * R * 0.55;
        const du = Math.cos(a) * R;
        const dv = Math.cos(a * 2) * R * 1.1;
        put(o[i], u, v, Math.atan2(dv, du), { walk: lt * 2.6, amp: 1, y: Math.abs(Math.sin(lt * 7 + i)) * 0.05 });
      }
    },
  },
  {
    // Проповедник на ящике: монах кланяется и простирает руки (качается вперёд); слушатели полукругом, двое на коленях.
    id: 'preacher',
    where: ['parvis', 'square', 'market'],
    moving: false,
    speed: 0,
    len: [44, 64],
    cast: [
      { fig: 'hood', color: MONK, second: MONK },
      { fig: 'prop', color: WOOD, box: [0.7, 0.42, 0.7] },
      { fig: 'woman' },
      { fig: 'cap' },
      { fig: 'hood' },
      { fig: 'woman' },
      { fig: 'cap' },
    ],
    pose(lt, _L, _r, o) {
      const preach = Math.sin(lt * 0.9);
      put(o[0], 0, 0, Math.sin(lt * 0.35) * 0.7, { y: 0.42, lean: 0.1 + 0.18 * Math.max(0, preach) - 0.1 * Math.max(0, -preach) });
      put(o[1], 0, 0, 0);
      const arc: readonly [number, number, boolean][] = [
        [2.5, -1.6, false],
        [2.9, 0, true],
        [2.6, 1.6, false],
        [3.7, -0.8, false],
        [3.6, 1.0, true],
      ];
      for (let i = 0; i < 5; i++) {
        const [u, v, kneel] = arc[i];
        put(o[2 + i], u, v, face(u, v, 0, 0), { y: kneel ? -0.42 : 0, lean: kneel ? 0.3 : 0.04 + 0.03 * Math.sin(lt + i) });
      }
    },
  },
  {
    // Влюблённые: стоят близко лицом друг к другу, потом медленно идут рядом и возвращаются.
    id: 'lovers',
    where: ['square', 'lane', 'tavern', 'meadow', 'parvis'],
    moving: false,
    speed: 0,
    len: [36, 50],
    cast: [{ fig: 'cap' }, { fig: 'woman' }],
    pose(lt, L, _r, o) {
      const stroll = sm((lt - L * 0.45) / 3) * (1 - sm((lt - L * 0.82) / 3));
      const sv = Math.sin(((lt - L * 0.45) / (L * 0.4)) * Math.PI) * 2.6 * stroll;
      const near = 0.42 - 0.08 * Math.max(0, Math.sin(lt * 0.6));
      put(o[0], -near * (1 - stroll), sv - 0.3 * stroll, stroll > 0.5 ? Math.PI / 2 : 0, { lean: 0.06 * (1 - stroll), walk: sv, amp: stroll });
      put(o[1], near * (1 - stroll), sv + 0.3 * stroll, stroll > 0.5 ? Math.PI / 2 : Math.PI, { lean: 0.04 * (1 - stroll), walk: sv, amp: stroll });
    },
  },
  {
    // Стража играет в кости: трое на корточках вокруг бочки, бросающий подаётся вперёд, кости скачут по крышке.
    id: 'dice',
    where: ['gate', 'tavern', 'lane'],
    moving: false,
    speed: 0,
    len: [34, 48],
    cast: [{ fig: 'guard' }, { fig: 'guard' }, { fig: 'guard' }, { fig: 'prop', color: WOOD, box: [0.62, 0.72, 0.62] }, { fig: 'prop', color: LINEN, box: [0.09, 0.09, 0.09] }, { fig: 'prop', color: LINEN, box: [0.09, 0.09, 0.09] }],
    lamp: { actor: 3, u: 0.18, v: 0.2, y: 0.85 },
    pose(lt, _L, _r, o) {
      const turn = Math.floor(lt / 5) % 3;
      const k = (lt % 5) / 5;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const u = Math.cos(a) * 0.95;
        const v = Math.sin(a) * 0.95;
        const throws = i === turn ? Math.max(0, Math.sin(k * Math.PI * 2)) : 0;
        put(o[i], u, v, face(u, v, 0, 0), { y: -0.5, lean: 0.16 + throws * 0.22 - (i !== turn && k > 0.6 ? 0.1 : 0) });
      }
      put(o[3], 0, 0, 0);
      // Кости скачут после броска.
      const hop = k > 0.3 && k < 0.6 ? Math.abs(Math.sin((k - 0.3) * 30)) * 0.12 * (0.6 - k) * 3 : 0;
      put(o[4], -0.1 + k * 0.2, 0.08, k * 4, { y: 0.72 + hop });
      put(o[5], 0.08, -0.1 + k * 0.15, k * 3, { y: 0.72 + hop * 0.7 });
    },
  },
  {
    // Вора гонят по улице: с мешком бегом впереди, за ним торговец и стражник.
    id: 'thief',
    where: ['lane', 'market', 'square'],
    moving: true,
    speed: 4.2,
    len: [13, 17],
    cast: [{ fig: 'hood', color: 0x4a4038, second: 0x3a3632 }, { fig: 'prop', color: 0xa89470, box: [0.4, 0.45, 0.35] }, { fig: 'cap', color: 0x7a5a2a }, { fig: 'guard' }],
    pose(lt, _L, _r, o) {
      put(o[0], 4.5, 0.3 * Math.sin(lt * 2), 0, { walk: lt * 4.2, amp: 1, lean: 0.25 });
      put(o[1], 4.3, 0.3 * Math.sin(lt * 2) - 0.25, 0, { y: 1.15 });
      put(o[2], 0.5, -0.4, 0, { walk: lt * 4.2 + 0.4, amp: 1, lean: 0.2 });
      put(o[3], -1.6, 0.45, 0, { walk: lt * 4.2 + 0.9, amp: 1, lean: 0.22 });
    },
  },
  {
    // Похороны: священник с крестом впереди, четверо несут гроб на плечах, за ними вдова и родня — медленно.
    id: 'funeral',
    where: ['lane', 'parvis', 'square'],
    moving: true,
    speed: 0.7,
    len: [56, 72],
    cast: [
      { fig: 'hood', color: BLACK, second: BLACK },
      { fig: 'prop', color: WOOD, box: [0.06, 2.2, 0.06] },
      { fig: 'prop', color: WOOD, box: [0.06, 0.06, 0.6] },
      { fig: 'hood', color: 0x3a3632 },
      { fig: 'hood', color: 0x4a4038 },
      { fig: 'cap', color: 0x3a3632 },
      { fig: 'cap', color: 0x4a4038 },
      { fig: 'prop', color: 0x4a3828, box: [0.62, 0.42, 2.1] },
      { fig: 'woman', color: BLACK, second: BLACK },
      { fig: 'woman', color: 0x3a3632 },
    ],
    pose(lt, _L, _r, o) {
      const w = lt * 0.7;
      put(o[0], 3.2, 0, 0, { walk: w, amp: 0.8, lean: 0.06 });
      // Крест — в руке перед собой.
      put(o[1], 3.6, 0.28, 0, { y: 0.4 });
      put(o[2], 3.6, 0.28, Math.PI / 2, { y: 2.15 });
      const bearers: readonly [number, number][] = [
        [0.8, -0.42],
        [0.8, 0.42],
        [-0.8, -0.42],
        [-0.8, 0.42],
      ];
      for (let i = 0; i < 4; i++) put(o[3 + i], bearers[i][0], bearers[i][1], 0, { walk: w + i * 0.3, amp: 0.7, lean: 0.05 });
      put(o[7], 0, 0, 0, { y: 1.5 + 0.02 * Math.sin(lt * 2.4) });
      put(o[8], -2.4, -0.2, 0, { walk: w, amp: 0.6, lean: 0.3 });
      put(o[9], -3.2, 0.4, 0, { walk: w + 0.5, amp: 0.6, lean: 0.12 });
    },
  },
  {
    // Пир после победы: длинный стол, вокруг поднимают кружки — подаются вперёд разом, смеются и качаются.
    id: 'revel',
    where: ['square', 'tavern', 'market', 'parvis'],
    moving: false,
    speed: 0,
    len: [44, 60],
    cast: [
      { fig: 'prop', color: 0x8a6a48, box: [3.2, 0.8, 0.9] },
      { fig: 'prop', color: 0x6a5038, box: [3.0, 0.45, 0.32] },
      { fig: 'cap' },
      { fig: 'hood' },
      { fig: 'woman' },
      { fig: 'cap' },
      { fig: 'woman' },
      { fig: 'hood' },
      { fig: 'prop', color: 0xa07040, box: [0.36, 0.42, 0.36] },
    ],
    pose(lt, _L, _r, o) {
      put(o[0], 0, 0, 0);
      put(o[1], 0.82, 0, 0);
      // Тост: раз в восемь секунд все разом подаются к столу.
      const toast = Math.max(0, Math.sin((lt / 8) * Math.PI * 2)) ** 3;
      const seats: readonly [number, number][] = [
        [-0.85, -1.1],
        [-0.85, 0],
        [-0.85, 1.1],
        [0.95, -1.1],
        [0.95, 0.15],
        [0.95, 1.2],
      ];
      for (let i = 0; i < 6; i++) {
        const [u, v] = seats[i];
        const back = u > 0 ? Math.PI : 0;
        const rock = Math.sin(lt * 2.2 + i * 1.3) * 0.08;
        put(o[2 + i], u, v, back, { lean: 0.08 + 0.3 * toast + rock, roll: rock * 0.6, y: u > 0 ? -0.18 : 0 });
      }
      put(o[8], 0.1, -0.2, 0.4, { y: 0.8 });
    },
  },
  {
    // Путники с телегой: возница с волом, двое пешком следом; идут дорогой мимо.
    id: 'travelers',
    where: ['road'],
    moving: true,
    speed: 1.05,
    len: [52, 66],
    cast: [{ fig: 'cart' }, { fig: 'hood', color: 0x6a5a48 }, { fig: 'woman' }, { fig: 'cap', color: 0x5a4a38 }],
    pose(lt, _L, _r, o) {
      const w = lt * 1.05;
      put(o[0], 1.5, 0.6, 0, { walk: w, amp: 1 });
      put(o[1], -2.1, -0.5, 0, { walk: w, amp: 1, lean: 0.06 });
      put(o[2], -2.6, 0.5, 0, { walk: w + 0.3, amp: 1 });
      put(o[3], -4.2, 0, 0, { walk: w + 0.6, amp: 1, lean: 0.1 });
    },
  },
  {
    // Пастух со стадом: овцы щиплют траву и бредут за ним, пастух с посохом, собака обегает стадо.
    id: 'shepherd',
    where: ['meadow'],
    moving: false,
    speed: 0,
    len: [50, 70],
    cast: [
      { fig: 'hood', color: 0x6a5a44, second: 0x8a7a60 },
      { fig: 'prop', color: WOOD, box: [0.05, 1.9, 0.05] },
      { fig: 'beast', color: 0x4a3a2c, scale: 0.55 },
      ...Array.from({ length: 9 }, (_, i): Cast => ({ fig: 'beast', color: i === 4 ? 0x3a3632 : 0xe0d8c8, scale: 0.8 + (i % 3) * 0.08 })),
    ],
    pose(lt, L, r, o) {
      // Стадо медленно бредёт поперёк рамки: от −3 до 3 м за сценку.
      const drift = -3 + (6 * lt) / L;
      put(o[0], -3.2, drift - 1.2, Math.PI / 2 + Math.sin(lt * 0.2) * 0.4, { walk: drift, amp: 0.4 });
      put(o[1], -3.0, drift - 0.95, 0);
      const da = lt * 0.9;
      put(o[2], Math.cos(da) * 4.2, drift + Math.sin(da) * 3.4, da + Math.PI / 2, { walk: lt * 3, amp: 1 });
      for (let i = 0; i < 9; i++) {
        const gx = ((i * 37 + Math.floor(r * 50)) % 7) - 3;
        const gz = ((i * 53) % 5) * 1.1 - 2.2;
        const graze = Math.sin(lt * 0.3 + i * 1.3);
        put(o[3 + i], gx * 0.9 + 0.3 * graze, drift + gz + 0.3 * Math.cos(lt * 0.25 + i), Math.PI / 2 + graze * 0.9, {
          lean: graze > 0.3 ? 0.35 : 0,
          walk: lt * 0.3 + i,
          amp: graze < 0.3 ? 0.6 : 0,
        });
      }
    },
  },
  {
    // Жнецы в поле: трое в ряд гнутся с серпом и шаг за шагом идут по полосе, жница вяжет снопы, снопы встают позади.
    id: 'reapers',
    where: ['field'],
    moving: false,
    speed: 0,
    len: [50, 70],
    cast: [{ fig: 'hood', color: LINEN }, { fig: 'cap', color: 0x8a7a5a }, { fig: 'hood', color: 0x9a8a6a }, { fig: 'woman' }, ...Array.from({ length: 4 }, (): Cast => ({ fig: 'prop', color: STRAW, box: [0.36, 0.85, 0.36] }))],
    pose(lt, L, _r, o) {
      const row = -4 + (8 * lt) / L;
      for (let i = 0; i < 3; i++) {
        const cut = Math.max(0, Math.sin(lt * 1.9 + i * 0.8));
        put(o[i], 1.2 - i * 1.1, row - i * 0.5, Math.PI / 2, { lean: 0.3 + 0.18 * cut, walk: row, amp: 0.15 });
      }
      put(o[3], -1.5, row - 2.6, Math.PI / 2 + 0.6 * Math.sin(lt * 0.5), { lean: 0.26 + 0.14 * Math.max(0, Math.sin(lt * 1.2)), walk: row, amp: 0.15 });
      // Снопы — позади ряда, по мере жатвы.
      for (let i = 0; i < 4; i++) {
        const sv = -4 + i * 2;
        put(o[4 + i], -0.6 - (i % 2) * 1.1, sv, i * 0.7, { hide: sv > row - 2.4 });
      }
    },
  },
  {
    // Охотник: крадётся опушкой с собакой, приседает и целится — олень у леса вскидывается и уходит.
    id: 'hunter',
    where: ['edge', 'meadow'],
    moving: false,
    speed: 0,
    len: [36, 50],
    cast: [{ fig: 'hood', color: 0x4a5a3a, second: 0x3a4a2a }, { fig: 'beast', color: 0x5a4a3a, scale: 0.55 }, { fig: 'beast', color: 0x8a6a44, scale: 1.25 }, { fig: 'prop', color: WOOD, box: [0.05, 1.5, 0.05] }],
    pose(lt, L, _r, o) {
      const stalk = Math.min(1, lt / (L * 0.55));
      const aim = lt > L * 0.55 && lt < L * 0.7;
      const hu = -4 + stalk * 2.5;
      put(o[0], hu, -2, 0, { y: aim ? -0.45 : -0.15, lean: aim ? 0.15 : 0.35, walk: stalk * 2.5, amp: aim ? 0 : 0.5 });
      put(o[1], hu - 0.6, -2.9, 0, { walk: stalk * 2.5 + lt * 0.4, amp: aim ? 0 : 0.6, lean: 0.1 });
      put(o[3], hu + 0.35, -1.75, 0, { y: aim ? 0.35 : 0.6, roll: aim ? 0 : 0.3, lean: aim ? 1.5 : 0 });
      // Олень щиплет траву; после выстрела — прыжками прочь.
      const flee = Math.max(0, lt - L * 0.68);
      put(o[2], 3.5 + flee * 3.2, 1.5 + flee * 1.5, flee > 0 ? 0.45 : Math.PI + Math.sin(lt * 0.3) * 0.5, {
        lean: flee > 0 ? 0 : 0.3 * Math.max(0, Math.sin(lt * 0.4)),
        y: flee > 0 ? Math.abs(Math.sin(flee * 6)) * 0.4 : 0,
        walk: flee * 3,
        amp: flee > 0 ? 1 : 0,
        hide: flee > 6,
      });
    },
  },
  {
    // Паломники: гуськом с посохами, в серых плащах и широких шапках, впереди — с крестом.
    id: 'pilgrims',
    where: ['road'],
    moving: true,
    speed: 0.85,
    len: [56, 70],
    cast: [
      { fig: 'hood', color: 0x6a6258, second: 0x5a5248 },
      { fig: 'prop', color: WOOD, box: [0.05, 2.3, 0.05] },
      { fig: 'prop', color: WOOD, box: [0.05, 0.05, 0.5] },
      { fig: 'hood', color: 0x7a7266, second: 0x6a6258 },
      { fig: 'woman', color: 0x6a6258, second: LINEN },
      { fig: 'hood', color: 0x5a5248, second: 0x4a443c },
      { fig: 'cap', color: 0x6a6258 },
    ],
    pose(lt, _L, _r, o) {
      const w = lt * 0.85;
      put(o[0], 3.2, 0, 0, { walk: w, amp: 0.8, lean: 0.08 });
      put(o[1], 3.5, 0.3, 0, { y: 0.15 });
      put(o[2], 3.5, 0.3, Math.PI / 2, { y: 2.1 });
      for (let i = 0; i < 4; i++) put(o[3 + i], 1.7 - i * 1.5, (i % 2 ? 0.25 : -0.25), 0, { walk: w + i * 0.4, amp: 0.8, lean: 0.12 });
    },
  },
  {
    // Лазутчики разбойников на опушке: двое пригнулись у края леса и следят за городом, один перебегает к другому.
    id: 'scouts',
    where: ['edge'],
    moving: false,
    speed: 0,
    len: [34, 46],
    cast: [{ fig: 'hood', color: 0x3a3a2a, second: 0x2a2a20 }, { fig: 'hood', color: 0x3a3228, second: 0x2a261e }],
    pose(lt, L, _r, o) {
      // Лицом к городу — «вперёд» рамки (к камере); одна пробежка посередине.
      put(o[0], 0, -0.9, 0, { y: -0.48, lean: 0.28 + 0.05 * Math.sin(lt * 0.7) });
      if (!walkLeg(o[1], lt, L * 0.4, L * 0.4 + 3, -1.2, 3.2, -0.3, 0.6)) {
        const k = lt < L * 0.4 ? 0 : 1;
        put(o[1], k ? -0.3 : -1.2, k ? 0.6 : 3.2, 0, { y: -0.48, lean: 0.3 });
      } else {
        o[1].y = -0.2;
        o[1].lean = 0.4;
      }
    },
  },
];

export const SKIT_BY: Record<SkitId, SkitDef> = Object.fromEntries(SKITS.map((d) => [d.id, d])) as Record<SkitId, SkitDef>;
export const SKIT_IDS: readonly SkitId[] = SKITS.map((d) => d.id);

/** Пустые позы под сценку. */
export const posesFor = (d: SkitDef): Pose[] => d.cast.map(pose0);

// ---------------------------------------------------------------------------------------------
// Режиссёр.

/**
 * Сценки видны и слышны только при максимальном приближении: доля приближения камеры (`camera.zoomShare`) не ниже этой
 * (на телефоне 390×844 — ближе ~134 м, горожанин в шестнадцать точек ростом); прячутся ниже `SKIT_ZOOM_OFF`.
 */
export const SKIT_ZOOM = 0.85;
export const SKIT_ZOOM_OFF = 0.82;
/** Логово разбойников «близко» — не дальше стольких клеток карты от города. */
export const LAIR_NEAR = 6;
/** Сценка уходит, если взгляд отошёл от неё дальше стольких метров; новые ищутся в кольцах до `PICK_R`. */
export const KEEP_R = 70;
export const PICK_R = 40;
/** Две сценки — не ближе стольких метров друг к другу. */
export const APART = 15;
/** Сколько последних сценок не повторяется. */
export const RECENT = 3;

/** Где играет сценка: середина и рамка — у стоящих; путь и начало хода — у идущих. */
export interface Stage {
  kind: PlaceKind;
  x: number;
  z: number;
  /** Поворот рамки: «вперёд» сценки — (cos yaw, −sin yaw), как у фигур. */
  yaw: number;
  path: Path | null;
  /** Начало хода по пути, м, и направление. */
  s0: number;
  dir: 1 | -1;
}

export interface Active {
  def: SkitDef;
  stage: Stage;
  t0: number;
  len: number;
  /** Жребий сценки 0..1 — разброс поз. */
  r: number;
}

/** Мировое место актёра: точка, высота земли, поворот (у фигуры, как `rotation.y`). */
export interface Placed {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const PLACED: Placed = { x: 0, y: 0, z: 0, yaw: 0 };

/**
 * Куда встаёт поза: рамка стоящей сценки или место на пути идущей. `ground` — высота нарисованной земли (вид даёт сетку земли
 * игры, `ground.gridHeight`: вдали она редкая и идёт выше или ниже рельефа — по `heightAt` жнецы в поле ушли бы под неё).
 */
export function placeOf(a: Active, lt: number, p: Pose, ground: (x: number, z: number) => number = heightAt): Placed {
  const st = a.stage;
  if (st.path) {
    const s = st.s0 + st.dir * (a.def.speed * lt + p.u);
    const q = at(st.path, s);
    const tx = q.tx * st.dir;
    const tz = q.tz * st.dir;
    // Вправо от хода — (tz, −tx), как у рамки стоящих; лицом по ходу.
    PLACED.x = q.p.x + tz * p.v;
    PLACED.z = q.p.z - tx * p.v;
    PLACED.y = ground === heightAt ? heightOnPath(st.path, s) : ground(PLACED.x, PLACED.z);
    PLACED.yaw = Math.atan2(-tz, tx) + p.yaw;
    return PLACED;
  }
  const fx = Math.cos(st.yaw);
  const fz = -Math.sin(st.yaw);
  // Вправо в рамке — (fz, −fx): тот же поворот, что у фигуры лицом вперёд.
  PLACED.x = st.x + fx * p.u + fz * p.v;
  PLACED.z = st.z + fz * p.u - fx * p.v;
  PLACED.y = ground(PLACED.x, PLACED.z);
  PLACED.yaw = st.yaw + p.yaw;
  return PLACED;
}

/**
 * Видна ли с камеры точка сценки (голова человека над землёй): луч от неё к камере шагом в три четверти метра не входит ни в
 * одну коробку постройки или дома ниже её кровли (с запасом 0,4 м — угол коробки между шагами). Сценка за трактиром или за крышей камере не нужна — её не увидят.
 */
export function inView(w: SkitWorld, cam: { x: number; y: number; z: number }, x: number, z: number): boolean {
  const y = heightAt(x, z) + 1.4;
  const dx = cam.x - x;
  const dy = cam.y - y;
  const dz = cam.z - z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1) return true;
  // Последние метры у камеры не в счёт: там геометрию режет ближняя плоскость (камера над башней ворот — не за ней).
  for (let d = 0.75; d < len - 8; d += 0.75) {
    const k = d / len;
    const h = y + dy * k;
    // Выше всех кровель и башен — дальше луч свободен.
    if (h > 46) return true;
    const px = x + dx * k;
    const pz = z + dz * k;
    for (const s of w.sites) {
      // Верхняя пятая часть коробки — скат кровли и шатёр башни: они уже коробки, луч над ними проходит.
      if (h > s.y1 - 0.2 * (s.y1 - s.y0) || h < s.y0 - 0.5 || Math.abs(px - s.x) > 30 || Math.abs(pz - s.z) > 30) continue;
      if (inSite(px, pz, s, 0.4)) return false;
    }
  }
  return true;
}

/** Ход идущей сценки проверяется через столько секунд: телега проходит метр, вор — четыре. */
const WALK_DT = 1;
/** След стоящей сценки — клетками такого размера, м, и шагом по времени, с. */
const CELL = 0.4;
/** За стеной — крупнее: там проверяется лес в пяти метрах кругом (`woods`), а не стена дома в шаге. */
const CELL_OUT = 0.8;
const TRACE_DT = 0.25;

/**
 * След стоящей сценки в её рамке: где побывал хоть кто-то из актёров за весь её ход (кроме спрятанных), клетками `CELL`.
 * Проверять мир по следу, а не по нескольким мгновениям: покупатель, отошедший от лотка между мгновениями, — тоже в следе.
 */
export function footprint(a: Active, cell = CELL): [number, number][] {
  const key = `${a.def.id}:${Math.round(a.len)}:${Math.round(a.r * 8)}:${cell}`;
  const hit = traces.get(key);
  if (hit) return hit;
  const poses = posesFor(a.def);
  const seen = new Map<number, [number, number]>();
  for (let lt = 0; lt <= a.len; lt += TRACE_DT) {
    a.def.pose(lt, a.len, a.r, poses);
    for (const p of poses) {
      if (p.hide) continue;
      const iu = Math.round(p.u / cell);
      const iv = Math.round(p.v / cell);
      seen.set(iu * 4096 + iv, [iu * cell, iv * cell]);
    }
  }
  const out = [...seen.values()];
  if (traces.size > 400) traces.clear();
  traces.set(key, out);
  return out;
}

/** След зависит от сценки, её длины и жребия, но не от места и поворота: считается раз (до 400 следов в памяти). */
const traces = new Map<string, [number, number][]>();

/** Занята ли точка домом или постройкой — идущим (улица и дорога свободны, но тропа к загону входит во двор). */
const blocked = (w: SkitWorld, x: number, z: number): boolean =>
  !standFree(w.plan, x, z) || w.sites.some((s) => s.type !== 'church' && Math.abs(x - s.x) < 30 && Math.abs(z - s.z) < 30 && inSite(x, z, s, 0.3));

const TRACE: Pose = { u: 0, v: 0, y: 0, yaw: 0, lean: 0, roll: 0, walk: 0, amp: 0, hide: false };

/**
 * Встанет ли сценка на месте целиком: у стоящей — весь её след (`footprint`) на свободной земле своей части мира
 * (`spotFree`), не на проходе (`onWalk`) и не в местах жизни города (колодец, статуя, хоровод); у идущей — каждый актёр в
 * своей части мира и путь не кончается раньше хода.
 */
export function layoutOk(w: SkitWorld, a: Active): boolean {
  const it = layoutSteps(w, a);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Та же проверка шагами: уступает кадр через каждые `STEP_CELLS` клеток следа (режиссёр с бюджетом кадра). */
function* layoutSteps(w: SkitWorld, a: Active): Generator<void, boolean> {
  const town = TOWN_PLACES.includes(a.stage.kind);
  const st = a.stage;
  if (st.path) {
    const path = st.path;
    const poses = posesFor(a.def);
    for (let lt = 0; lt <= a.len; lt += WALK_DT) {
      const s = st.s0 + st.dir * a.def.speed * lt;
      if (s < 0 || s > path.len) return false;
      a.def.pose(lt, a.len, a.r, poses);
      for (const p of poses) {
        if (p.hide) continue;
        const q = placeOf(a, lt, p);
        if (inTown(w.plan, q.x, q.z) !== town || blocked(w, q.x, q.z)) return false;
      }
      if (lt % 8 === 0) yield;
    }
    return true;
  }
  const cells = footprint(a, town ? CELL : CELL_OUT);
  yield;
  for (let i = 0; i < cells.length; i++) {
    TRACE.u = cells[i][0];
    TRACE.v = cells[i][1];
    const q = placeOf(a, 0, TRACE);
    if (!freeAt(w, q.x, q.z, town)) return false;
    if (onWalk(town ? w.walks : w.roads, q.x, q.z)) return false;
    if (town && KEEP_CLEAR.some((c) => Math.hypot(q.x - c.x, q.z - c.z) < c.r)) return false;
    if (i % STEP_CELLS === STEP_CELLS - 1) yield;
  }
  return true;
}

/** Сколько клеток следа проверяется между уступками кадра. */
const STEP_CELLS = 24;

/** Свободна ли земля — с памятью по клеткам в четверть метра: соседние сценки и повторные поиски проверяют те же точки. */
const freeMemo = new Map<number, boolean>();
function freeAt(w: SkitWorld, x: number, z: number, town: boolean): boolean {
  const key = (Math.round(x * 4) + 8192) * 16384 * 2 + (Math.round(z * 4) + 8192) * 2 + (town ? 1 : 0);
  const hit = freeMemo.get(key);
  if (hit !== undefined) return hit;
  const v = spotFree(w, x, z, town);
  if (freeMemo.size > 60000) freeMemo.clear();
  freeMemo.set(key, v);
  return v;
}

/** Генератор жребия: сеяный, чтобы тест повторялся (в картинке случайность законна, но стенду нужен повтор). */
export function seededRnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Сценок сразу по уровню (`spec.SKITS_CAP`): на «Среднем» тесно — две. */
export const slotsOf = (q: Quality): number => SKITS_CAP[q].slots;

/**
 * Режиссёр сценок: держит до `slots` сценок рядом с точкой взгляда. Новая — по весу минуты (`skitWeight`), ближе к взгляду
 * — вероятнее, на месте, где встаёт целиком (`layoutOk`); та же, что недавно, подряд не идёт (`RECENT`), две одинаковые
 * разом — тоже. Взгляд издали (`show` ложно) — сценок нет вовсе.
 */
export class SkitDirector {
  readonly active: (Active | null)[];
  private recent: SkitId[] = [];
  private nextAt = 0;
  private shown = false;
  /** Сценка адресом (`?skit=brawl`) — стенду и проверке на телефоне: ставится только она, вне веса и очереди. */
  forced: SkitId | null = null;
  /** Поиск места, идущий кусками по кадрам (`advance`), и подошёл ли взгляд, когда он начался. */
  private job: Generator<void, Active | null> | null = null;
  private jobFresh = false;

  constructor(
    private w: SkitWorld,
    slots: number,
    private rnd: () => number = seededRnd(0x5c17),
    /** Бюджет поиска места на кадр, мс; бесконечность — искать сразу (тестам). */
    private budget = Infinity,
  ) {
    this.active = Array.from({ length: slots }, () => null);
  }

  /** Уровень опустил сторож плавности: лишние сценки уходят сразу. */
  setSlots(n: number): void {
    while (this.active.length > n) this.active.pop();
    while (this.active.length < n) this.active.push(null);
  }

  /** Недавние сценки — от новой к старой. */
  get history(): readonly SkitId[] {
    return this.recent;
  }

  /**
   * Кадр: `t` — время сцены, с; `eye` — точка взгляда на земле, `cam` — камера по земле (куда стоящие сценки обращены
   * лицом); `show` — приближение максимальное.
   */
  update(t: number, eye: P, cam: P & { y?: number }, show: boolean, ctx: SkitCtx): void {
    if (!show) {
      for (let k = 0; k < this.active.length; k++) this.active[k] = null;
      this.shown = false;
      this.job = null;
      return;
    }
    const fresh = !this.shown;
    this.shown = true;
    for (let k = 0; k < this.active.length; k++) {
      const a = this.active[k];
      if (!a) continue;
      const c = this.centerOf(a, t);
      const over = t > a.t0 + a.len || (a.def.id !== this.forced && skitWeight(a.def.id, ctx) <= 0);
      if (over || Math.hypot(c.x - eye.x, c.z - eye.z) > KEEP_R) this.active[k] = null;
    }
    if (this.job) {
      this.advance(t, fresh);
      return;
    }
    if (t < this.nextAt && !fresh) return;
    if (this.active.indexOf(null) < 0) return;
    this.job = this.pick(t, eye, cam, ctx);
    this.jobFresh = fresh;
    this.advance(t, fresh);
  }

  /** Поиск идёт кусками: не дольше `budget` мс за кадр (бесконечность — сразу целиком, тестам). */
  private advance(t: number, fresh: boolean): void {
    const job = this.job!;
    // Сценка адресом (стенд) ищется сразу: у стенда кадры программной отрисовки редки.
    const until = Number.isFinite(this.budget) && !this.forced ? now() + this.budget : Infinity;
    for (;;) {
      const r = job.next();
      if (r.done) {
        this.job = null;
        this.settle(t, r.value, fresh || this.jobFresh);
        return;
      }
      if (now() > until) return;
    }
  }

  /** Сценка нашлась (или нет): встаёт в свободное место; следующая — через несколько секунд. */
  private settle(t: number, a: Active | null, fresh: boolean): void {
    const free = this.active.indexOf(null);
    if (a && free >= 0) {
      // Взгляд только что подошёл — сценка уже идёт (не с прихода актёров); иначе — с начала.
      a.t0 = fresh ? t - a.len * 0.25 : t;
      this.active[free] = a;
      this.recent.unshift(a.def.id);
      this.recent.length = Math.min(this.recent.length, RECENT);
    }
    this.nextAt = t + (a ? 2 + 4 * this.rnd() : 1.5);
  }

  /** Где сценка сейчас: у стоящей — середина, у идущей — место на пути. */
  centerOf(a: Active, t: number): P {
    if (!a.stage.path) return a.stage;
    const q = at(a.stage.path, a.stage.s0 + a.stage.dir * a.def.speed * (t - a.t0));
    return { x: q.p.x, z: q.p.z };
  }

  private *pick(t: number, eye: P, cam: P & { y?: number }, ctx: SkitCtx): Generator<void, Active | null> {
    const busy = new Set(this.active.filter((a): a is Active => a !== null).map((a) => a.def.id));
    const others = this.active.filter((a): a is Active => a !== null).map((a) => this.centerOf(a, t));
    const ok = this.forced
      ? SKITS.filter((d) => d.id === this.forced && !busy.has(d.id))
      : SKITS.filter((d) => !busy.has(d.id) && !this.recent.includes(d.id) && skitWeight(d.id, ctx) > 0);
    if (ok.length === 0) return null;
    // Кольца точек вокруг взгляда: что за место под каждой.
    const cand: { d: SkitDef; p: P; kind: PlaceKind; score: number }[] = [];
    const turn = this.rnd() * Math.PI * 2;
    for (const r of [0, 6, 12, 20, 30, PICK_R]) {
      const n = r === 0 ? 1 : 8;
      for (let i = 0; i < n; i++) {
        const a = turn + (i / n) * Math.PI * 2;
        const p = { x: eye.x + Math.cos(a) * r, z: eye.z + Math.sin(a) * r };
        if (others.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < APART)) continue;
        const kind = placeKind(this.w, p.x, p.z);
        if (!kind) continue;
        for (const d of ok) {
          if (!d.where.includes(kind)) continue;
          cand.push({ d, p, kind, score: ((this.forced ? 1 : skitWeight(d.id, ctx)) * (0.35 + this.rnd())) / (1 + (r / 12) ** 2) });
        }
      }
      yield;
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand.slice(0, 14)) {
      const len = c.d.len[0] + (c.d.len[1] - c.d.len[0]) * this.rnd();
      const a = yield* this.stageFor(c.d, c.p, c.kind, cam, len, t);
      if (a) return a;
    }
    return null;
  }

  /** Поставить сценку у точки: стоящую — лицом к камере (с поворотами, если не встаёт), идущую — по ближнему проходу. */
  private *stageFor(d: SkitDef, p: P, kind: PlaceKind, cam: P & { y?: number }, len: number, t: number): Generator<void, Active | null> {
    const r = this.rnd();
    // Камера над землёй известна — сценка за постройкой не ставится.
    if (cam.y !== undefined && !inView(this.w, { x: cam.x, y: cam.y, z: cam.z }, p.x, p.z)) return null;
    if (!TOWN_PLACES.includes(kind) && !d.moving && !clearing(this.w.plan, p.x, p.z, kind === 'edge')) return null;
    yield;
    if (d.moving) {
      const paths = TOWN_PLACES.includes(kind) ? this.w.walks.filter((w) => w.half >= 1.9) : this.w.roads;
      let best: { path: Path; s: number; d: number } | null = null;
      for (const path of paths) {
        const n = nearestOn(path, p);
        if (n.d < 14 && (!best || n.d < best.d)) best = { path, s: n.s, d: n.d };
      }
      if (!best) return null;
      const dir: 1 | -1 = this.rnd() < 0.5 ? 1 : -1;
      // Мимо взгляда — на середине хода.
      const s0 = best.s - dir * d.speed * len * 0.5;
      const a: Active = { def: d, stage: { kind, x: p.x, z: p.z, yaw: 0, path: best.path, s0, dir }, t0: t, len, r };
      return (yield* layoutSteps(this.w, a)) ? a : null;
    }
    const base = Math.atan2(-(cam.z - p.z), cam.x - p.x);
    for (const turn of [0, 0.7, -0.7, 1.6, -1.6, Math.PI]) {
      const a: Active = { def: d, stage: { kind, x: p.x, z: p.z, yaw: base + turn, path: null, s0: 0, dir: 1 }, t0: t, len, r };
      if (yield* layoutSteps(this.w, a)) return a;
    }
    return null;
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
