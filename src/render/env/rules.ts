/**
 * Окружение посёлка правилами, а не руками: где тропы и вытоптанная земля, где лесная
 * подстилка и камень, где стоит какое дерево, куда ложится мелочь, трава и цветы.
 *
 * ЗДЕСЬ НЕТ МЕШЕЙ И МАТЕРИАЛОВ — только числа от координат и зерна, и это нарочно:
 * правило расстановки держит тест (`rules.test.ts`), а не снимок. Сцена берёт отсюда
 * списки мест и карту земли и складывает из них экземпляры (`env/index.ts`).
 *
 * ДЕТЕРМИНИЗМ. Разброс — хешем от номера клетки и зерна окружения (`ENV_SEED`), без
 * `Math.random`: тот же посёлок даёт тот же лес на любом устройстве и в любом заходе,
 * как и прежний лес (`terrain.ts`). Позиция, попавшая в запретное место, не двигается
 * «куда-нибудь рядом», а отбрасывается — рисунок угодий от этого не плывёт.
 *
 * ЗОНА РАСЧИСТКИ (docs/handbook/graphics.md, «Зона расчистки»). Деревья, камни, кусты,
 * пни, брёвна и папоротник стоят только снаружи `inCleared` с учётом габарита. Внутри
 * расчистки — только покров земли: трава и цветы, и те — не на дорогах, не под домами,
 * не на стене (docs/graphics_world.md, раздел 3, «Покров, а не предметы»).
 */
import type { BuildingTypeId } from '@/game/types';
import { CLEAR_EDGE, CLEAR_RADIUS, GATE_ANGLE, GATE_CLEAR_HALF, OUTSKIRTS_RADIUS, PLAN, WALL_RADIUS, inCleared } from '../plan';
import { FOREST_FROM, GLADES, GROUND_RADIUS, ZONES, groundHeight, vnoise } from '../terrain';
import { decalSpotFor, roadLayout } from '../village';
import type { Tier } from '../buildings';

/** Зерно окружения — одно на всех, как у прежнего леса: 1200 — год мира игры. */
export const ENV_SEED = 1200;

/**
 * Край дальнего леса. Прежний мир кончался диском в `GROUND_RADIUS`, и с кадра телефона
 * за ним была видна пустота — пятая часть экрана плоского неба под горизонтом. Проба
 * продолжает землю и лес до этого радиуса: там их съедает дымка тумана, и кадр уходит
 * вдаль, а не обрывается.
 */
export const FAR_RADIUS = 96;

/**
 * Высота земли пробы: внутри прежнего мира — прежняя (`groundHeight`, на неё посажены
 * дома, дороги и старые модели), за его краем — пологие холмы, которые уходят в дымку.
 */
export function envHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const hills = smooth((r - GROUND_RADIUS) / 18) * (1.2 + 2.2 * vnoise(x / 13 + 3, z / 13 - 9));
  return groundHeight(x, z) + hills;
}

/** Какой посёлок стоит: к его домам и дорогам не подходит трава. */
export interface EnvVillage {
  present: BuildingTypeId[];
  built: { type: BuildingTypeId; tier: Tier }[];
}

// ---------- Хеш и мелочь ----------

/** Целочисленный хеш номера и соли → [0, 1). Порядок битов перемешан до конца. */
export function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((salt + ENV_SEED) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Хеш клетки решётки. */
const cell = (ix: number, iz: number, salt: number): number => hash(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663), salt);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};

// ---------- Раскладка: дороги, тропы, дома, поля ----------

/** Отрезок полосы на земле: концы и полуширина. */
export interface Strip {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/** Круг на земле. */
export interface Disc {
  x: number;
  z: number;
  r: number;
}

/**
 * Что на полосе — трёхполье средневековья: озимые (рожь), яровые (овёс, ячмень) и пар.
 * На пару всходов нет — он зарастает травой и отдыхает год.
 */
export type Sowing = 'winter' | 'spring' | 'fallow';

/** Полоса пашни: середина, полудлина вдоль борозды, полуширина поперёк, что посеяно. */
export interface Field {
  x: number;
  z: number;
  along: number;
  across: number;
  sowing: Sowing;
}

/** Место предмета угодий: стог, овца. */
export interface Spot {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  hue: number;
}

/** Звено изгороди: середина, направление вдоль и длина. */
export interface Panel {
  x: number;
  y: number;
  z: number;
  /** Поворот вокруг вертикали: звено лежит вдоль оси x модели. */
  rot: number;
  length: number;
}

/**
 * Угодья вокруг посёлка — отрисовкой, а не игрой (docs/graphics_world.md, 9.7): стога у
 * пашни и выгона, изгороди вдоль троп за чертой расчистки и вокруг выгона, овцы на выгоне.
 * Всё — снаружи расчистки (`inCleared` с габаритом): внутри неё предметов не бывает.
 */
export interface Farm {
  /** Выгон: круг пастбища у скотного двора. */
  pasture: Disc;
  hay: Spot[];
  fences: Panel[];
  flock: Spot[];
}

export interface Layout {
  /** Мощёные кольца (площадь — кольцо с нулевым внутренним краем). */
  rings: { r: number; half: number }[];
  /** Мощёные прямые: улица от ворот и отводы к дворам. */
  lines: Strip[];
  /** Тропы — земля, не мостовая: от дворов к угодьям и выезд из ворот в лес. */
  trails: Strip[];
  /** Основания построек. */
  spots: Disc[];
  /** Полосы пашни у поля. */
  fields: Field[];
  /** Направление борозд (единичное, в плоскости земли). */
  furrow: { x: number; z: number };
  /** Угодья: стога, изгороди, выгон и овцы. */
  farm: Farm;
}

/**
 * Тропа от двора к его угодью: ломаная с вихлянием по шуму — натоптанная, а не
 * проведённая по линейке. Начинается у края застройки, кончается в середине угодья.
 */
function trail(to: { x: number; z: number }, half: number, salt: number, out: Strip[]): void {
  const angle = Math.atan2(to.z, to.x);
  const r0 = OUTSKIRTS_RADIUS - 0.8;
  const r1 = Math.hypot(to.x, to.z);
  const n = 7;
  let px = Math.cos(angle) * r0;
  let pz = Math.sin(angle) * r0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const r = r0 + (r1 - r0) * t;
    // Вихляет посередине, у концов — нет: тропа выходит из двора и входит в угодье ровно.
    const side = (hash(i, salt) - 0.5) * 1.6 * Math.sin(t * Math.PI);
    const a = angle + side / r;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    out.push({ ax: px, az: pz, bx: x, bz: z, half });
    px = x;
    pz = z;
  }
}

/**
 * Где что лежит при этом посёлке. `null` — посёлок ещё не пришёл (первый кадр): тогда
 * дорог и домов нет, есть только то, что задано планом мира, — угодья и тропы.
 */
export function layoutOf(village: EnvVillage | null): Layout {
  const roads = roadLayout(village?.present ?? []);
  const rings = village ? [{ r: 0, half: roads.plaza }, ...roads.rings] : [];
  const lines: Strip[] = village
    ? roads.lines.map((l) => ({
        ax: Math.cos(l.angle) * l.from,
        az: Math.sin(l.angle) * l.from,
        bx: Math.cos(l.angle) * l.to,
        bz: Math.sin(l.angle) * l.to,
        half: l.half,
      }))
    : [];
  const spots: Disc[] = (village?.built ?? [])
    .filter((b) => b.type !== 'palisade' && b.type !== 'campfire')
    .map((b) => {
      const d = decalSpotFor(b.type, b.tier);
      return { x: d.x, z: d.z, r: d.radius };
    });

  const trails: Strip[] = [];
  let salt = 10;
  for (const to of [ZONES.forest, ZONES.rocks, ZONES.berries, ZONES.hunting, ZONES.fields]) trail(to, 0.34, salt++, trails);
  // Тропа на выгон — последней: прежние тропы не сдвигаются ни на шаг.
  trail(PASTURE, 0.34, 15, trails);
  // Выезд из ворот: главная улица кончается у просёлка, дальше в лес идёт колея — та,
  // по которой уезжает караван. Шире троп и прямее: по ней ездят, а не ходят.
  const gx = Math.cos(GATE_ANGLE);
  const gz = Math.sin(GATE_ANGLE);
  const from = OUTSKIRTS_RADIUS - 5.5;
  const to = GROUND_RADIUS - 1;
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const r0 = from + ((to - from) * i) / steps;
    const r1 = from + ((to - from) * (i + 1)) / steps;
    const w0 = i === 0 ? 0 : (hash(i, 40) - 0.5) * 0.5;
    const w1 = (hash(i + 1, 40) - 0.5) * 0.5;
    trails.push({ ax: gx * r0 - gz * w0, az: gz * r0 + gx * w0, bx: gx * r1 - gz * w1, bz: gz * r1 + gx * w1, half: 0.55 });
  }

  // Пашня: полосы бок о бок, борозды — вдоль радиуса от посёлка (открытое поле
  // средневековья — узкие длинные полосы с межами между ними).
  const fa = Math.atan2(ZONES.fields.z, ZONES.fields.x);
  const along = { x: Math.cos(fa), z: Math.sin(fa) };
  const across = { x: -along.z, z: along.x };
  const fields: Field[] = [];
  for (let i = -2; i <= 2; i++) {
    const len = 1.6 + hash(i + 3, 50) * 0.8;
    const shift = (hash(i + 3, 51) - 0.5) * 1.2;
    fields.push({
      x: ZONES.fields.x + across.x * i * 1.55 + along.x * shift,
      z: ZONES.fields.z + across.z * i * 1.55 + along.z * shift,
      along: len,
      across: 0.62,
      // Трёхполье по кругу: у соседних полос разное, и все три вида есть всегда.
      sowing: SOWINGS[(i + 2 + Math.floor(hash(0, 52) * 3)) % 3],
    });
  }
  const layout: Layout = { rings, lines, trails, spots, fields, furrow: along, farm: { pasture: { ...PASTURE }, hay: [], fences: [], flock: [] } };
  layout.farm = farmOf(layout);
  return layout;
}

const SOWINGS: readonly Sowing[] = ['winter', 'spring', 'fallow'];

/**
 * Выгон — у скотного двора, за чертой расчистки, по его направлению от посёлка. Своя
 * прогалина (`ENV_GLADES`) и своя тропа от двора. Не угодье игры — отрисовка: в прежнем
 * виде и в данных игры его нет.
 */
const PEN_ANGLE = PLAN.pen?.angle ?? Math.PI;
export const PASTURE: Disc = { x: Math.cos(PEN_ANGLE) * 30.5, z: Math.sin(PEN_ANGLE) * 30.5, r: 3.2 };

/** Прогалины окружения: угодья прежнего мира и выгон. Прежние `GLADES` не трогаются. */
export const ENV_GLADES: { at: { x: number; z: number }; r: number; keep: number }[] = [
  ...GLADES,
  { at: PASTURE, r: 5.6, keep: 0.04 },
];

/** Габарит стога и овцы при масштабе 1 — для расчистки, тропы и пятна тени. */
export const HAY_SPREAD = 0.62;
export const SHEEP_SPREAD = 0.38;

/**
 * Угодья под эту раскладку. Всё — от зерна и троп, не от построек: пересчёт под постройки
 * их не трогает. Предмет, попавший в расчистку, на тропу или в коридор, отбрасывается.
 */
function farmOf(l: Layout): Farm {
  const hay: Spot[] = [];
  const fences: Panel[] = [];
  const flock: Spot[] = [];
  const free = (x: number, z: number, r: number): boolean => !inCleared(x, z, r) && trailDist(l, x, z) > r + 0.25;

  // Стога — у торцов засеянных полос: жнут и мечут стог тут же, у поля.
  let n = 0;
  for (const f of l.fields) {
    if (f.sowing === 'fallow') continue;
    const end = hash(n, 53) < 0.5 ? -1 : 1;
    const u = end * (f.along + 0.75);
    const v = (hash(n, 54) - 0.5) * 0.5;
    const x = f.x + l.furrow.x * u - l.furrow.z * v;
    const z = f.z + l.furrow.z * u + l.furrow.x * v;
    const scale = 0.85 + hash(n, 55) * 0.3;
    if (free(x, z, HAY_SPREAD * scale)) hay.push({ x, y: groundHeight(x, z) - 0.03, z, scale, rot: hash(n, 56) * Math.PI * 2, hue: 0.92 + hash(n, 57) * 0.16 });
    n++;
  }

  // Сенокос у дороги из ворот: стога на лугу по обе стороны от выезда — там луг открыт
  // взгляду с первого кадра игры, а пашня и выгон лежат сбоку, за краем портретного кадра.
  // Кладут их на полосе вырубки, перед опушкой: ближе — расчистка, где предметов нет.
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const a = GATE_ANGLE + side * (0.3 + hash(i, 80) * 0.6);
    const r = CLEAR_RADIUS + 0.9 + hash(i, 81) * 2.8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const scale = 0.8 + hash(i, 82) * 0.35;
    if (!free(x, z, HAY_SPREAD * scale) || forestDensity(l, x, z, 1) > 0.45) continue;
    if (hay.some((h) => Math.hypot(h.x - x, h.z - z) < 1.8)) continue;
    hay.push({ x, y: groundHeight(x, z) - 0.03, z, scale, rot: hash(i, 83) * Math.PI * 2, hue: 0.9 + hash(i, 84) * 0.18 });
  }

  // Выгон: изгородь кругом с воротцами к тропе от двора, овцы внутри, стог сена у изгороди.
  const pa = l.farm.pasture;
  const toPen = Math.atan2(-pa.z, -pa.x);
  const PANEL = 1.1;
  const count = Math.ceil((2 * Math.PI * pa.r) / PANEL);
  for (let i = 0; i < count; i++) {
    const a = toPen + ((i + 0.5) / count) * Math.PI * 2;
    // Воротца: два звена против тропы оставлены пустыми.
    if (i === count - 1 || i === 0) continue;
    const x = pa.x + Math.cos(a) * pa.r;
    const z = pa.z + Math.sin(a) * pa.r;
    const length = ((2 * Math.PI * pa.r) / count) * 1.02;
    if (inCleared(x, z, length / 2)) continue;
    fences.push({ x, y: groundHeight(x, z) - 0.02, z, rot: -(a + Math.PI / 2), length });
  }
  for (let i = 0; i < 8; i++) {
    const a = hash(i, 60) * Math.PI * 2;
    const r = Math.sqrt(hash(i, 61)) * (pa.r - 0.7);
    const x = pa.x + Math.cos(a) * r;
    const z = pa.z + Math.sin(a) * r;
    if (flock.some((o) => Math.hypot(o.x - x, o.z - z) < 0.75)) continue;
    const scale = 0.85 + hash(i, 62) * 0.3;
    flock.push({ x, y: groundHeight(x, z) - 0.02, z, scale, rot: hash(i, 63) * Math.PI * 2, hue: 0.9 + hash(i, 64) * 0.2 });
  }
  for (let i = 0; i < 2; i++) {
    const a = toPen + Math.PI + (i ? 0.7 : -0.9);
    const r = pa.r + 1.1;
    const x = pa.x + Math.cos(a) * r;
    const z = pa.z + Math.sin(a) * r;
    const scale = 0.9 + hash(i, 58) * 0.25;
    if (free(x, z, HAY_SPREAD * scale)) hay.push({ x, y: groundHeight(x, z) - 0.03, z, scale, rot: hash(i, 59) * Math.PI * 2, hue: 0.92 + hash(i, 65) * 0.16 });
  }

  // Изгороди вдоль троп за чертой расчистки: звено на отрезок тропы, по одну сторону —
  // по жребию, иногда по обе, иногда прогал. В лесу не ставят: там гонять некого.
  let k = 0;
  for (const t of l.trails) {
    k++;
    const mx = (t.ax + t.bx) / 2;
    const mz = (t.az + t.bz) / 2;
    const dx = t.bx - t.ax;
    const dz = t.bz - t.az;
    const len = Math.hypot(dx, dz);
    if (len < 0.4 || t.half > 0.5) continue;
    if (forestDensity(l, mx, mz, 1) > 0.35) continue;
    const pick = hash(k, 70);
    if (pick < 0.25) continue;
    const sides = pick > 0.85 ? [-1, 1] : [hash(k, 71) < 0.5 ? -1 : 1];
    for (const side of sides) {
      const off = t.half + 0.38;
      const x = mx + (-dz / len) * off * side;
      const z = mz + (dx / len) * off * side;
      if (inCleared(x, z, len / 2) || Math.hypot(x - pa.x, z - pa.z) < pa.r + 0.8) continue;
      fences.push({ x, y: groundHeight(x, z) - 0.02, z, rot: -Math.atan2(dz, dx), length: len * 0.98 });
    }
  }
  return { pasture: pa, hay, fences, flock };
}

/** Расстояние до ближайшего предмета угодий минус его габарит: деревья и мелочь их не протыкают. */
export function farmDist(l: Layout, x: number, z: number): number {
  let d = Infinity;
  for (const h of l.farm.hay) d = Math.min(d, Math.hypot(x - h.x, z - h.z) - HAY_SPREAD * h.scale);
  for (const f of l.farm.fences) {
    const c = Math.cos(-f.rot);
    const s = Math.sin(-f.rot);
    const u = (x - f.x) * c + (z - f.z) * s;
    const v = -(x - f.x) * s + (z - f.z) * c;
    d = Math.min(d, Math.hypot(Math.max(0, Math.abs(u) - f.length / 2), v) - 0.12);
  }
  const pa = l.farm.pasture;
  // Выгон целиком: внутри изгороди деревьев и мелочи нет.
  d = Math.min(d, Math.hypot(x - pa.x, z - pa.z) - pa.r - 0.3);
  return d;
}

/** Коробка полосы с запасом `pad`: точка вне её заведомо дальше `pad` от полосы. */
interface Boxed<T> {
  item: T;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function boxStrip(s: Strip, pad: number): Boxed<Strip> {
  const p = pad + s.half;
  return { item: s, x0: Math.min(s.ax, s.bx) - p, x1: Math.max(s.ax, s.bx) + p, z0: Math.min(s.az, s.bz) - p, z1: Math.max(s.az, s.bz) + p };
}

const inBox = <T>(b: Boxed<T>, x: number, z: number): boolean => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

/** Расстояние от точки до отрезка полосы минус её полуширина (внутри полосы — меньше нуля). */
function stripDist(s: Strip, x: number, z: number): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? clamp01(((x - s.ax) * dx + (z - s.az) * dz) / len2) : 0;
  return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - s.half;
}

/** Расстояние до края мостовой (внутри — меньше нуля). */
export function roadDist(l: Layout, x: number, z: number): number {
  let d = Infinity;
  const r = Math.hypot(x, z);
  for (const ring of l.rings) d = Math.min(d, ring.r === 0 ? r - ring.half : Math.abs(r - ring.r) - ring.half);
  for (const s of l.lines) d = Math.min(d, stripDist(s, x, z));
  return d;
}

/** Расстояние до края ближайшей тропы. */
export function trailDist(l: Layout, x: number, z: number): number {
  let d = Infinity;
  for (const s of l.trails) d = Math.min(d, stripDist(s, x, z));
  return d;
}

/** Внутри полосы пашни: 1 — середина, 0 — межа и дальше; край мягкий. */
function fieldAt(l: Layout, x: number, z: number): number {
  let best = 0;
  for (const f of l.fields) {
    const dx = x - f.x;
    const dz = z - f.z;
    const u = Math.abs(dx * l.furrow.x + dz * l.furrow.z);
    const v = Math.abs(-dx * l.furrow.z + dz * l.furrow.x);
    // Пар зарастает: земля полосы видна наполовину, между — трава.
    const k = f.sowing === 'fallow' ? 0.5 : 1;
    best = Math.max(best, k * Math.min(smooth((f.along - u) / 0.25), smooth((f.across - v) / 0.18)));
  }
  return best;
}

// ---------- Карта земли ----------

/** Полуширина мира карты: квадрат ±`MAP_HALF` накрывает весь диск земли. */
export const MAP_HALF = GROUND_RADIUS;

/**
 * Карта земли: по тексель на клетку квадрата ±`MAP_HALF`. Каналы — доли 0..1:
 *
 *   soil    вытоптанная и голая земля: обочины, тропы, пятна у домов;
 *   litter  лесная подстилка: хвоя и листва под пологом;
 *   stone   каменистая земля у скал;
 *   field   пашня (борозды рисует шейдер);
 *   lush    густой луг — светлее, гуще трава и больше цветов;
 *   graze   выгон — трава выедена и вытоптана скотом, короче и желтее;
 *   grass   плотность пучков травы (для расстановки; в текстуру не идёт);
 *   bloom   плотность цветов (тоже только для расстановки).
 */
export interface GroundMap {
  size: number;
  soil: Float32Array;
  litter: Float32Array;
  stone: Float32Array;
  field: Float32Array;
  lush: Float32Array;
  graze: Float32Array;
  grass: Float32Array;
  bloom: Float32Array;
}

/** Мир → тексель карты (дробный). */
export const toTexel = (size: number, v: number): number => ((v + MAP_HALF) / (2 * MAP_HALF)) * size - 0.5;

/**
 * Работа по частям: генератор отдаёт управление (`yield`) после каждого куска, который
 * заведомо короче кадра, — ряда карты, ряда решётки. Сцена ведёт его кусками между
 * кадрами (`env/index.startEnv`), тест и стенд — целиком (`drain`). Строка вместо
 * пустого `yield` — имя начатой части: стенд называет по нему самый долгий шаг.
 */
export type Job<T> = Generator<string | void, T, void>;

/** Довести работу до конца разом. */
export function drain<T>(job: Job<T>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

/** Карта земли разом — для теста и стенда; сцена считает её по рядам (`groundMapJob`). */
export const groundMap = (l: Layout, size: number): GroundMap => drain(groundMapJob(l, size));

/**
 * Считает карту по рядам. Правила — в словах у каждой строки; числа — в единицах мира.
 * Стоит порядка десятков миллисекунд на 256 и вчетверо больше на 512 — один раз при
 * сборке окружения и при смене построек; ряд — доли миллисекунды.
 */
export function* groundMapJob(l: Layout, size: number): Job<GroundMap> {
  const n = size * size;
  const m: GroundMap = {
    size,
    soil: new Float32Array(n),
    litter: new Float32Array(n),
    stone: new Float32Array(n),
    field: new Float32Array(n),
    lush: new Float32Array(n),
    graze: new Float32Array(n),
    grass: new Float32Array(n),
    bloom: new Float32Array(n),
  };
  const step = (2 * MAP_HALF) / size;
  // Каждая точка спрашивает только те полосы и дома, в чью коробку попала: иначе карта
  // на телефоне считалась бы секунду — девяносто расстояний на каждый тексель.
  const lines = l.lines.map((s) => boxStrip(s, 0.7));
  const trails = l.trails.map((s) => boxStrip(s, 1.5));
  const spots = l.spots.map((d) => {
    const p = d.r * 1.7 + 0.5;
    return { item: d, x0: d.x - p, x1: d.x + p, z0: d.z - p, z1: d.z + p };
  });
  for (let j = 0; j < size; j++) {
    const z = -MAP_HALF + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      const x = -MAP_HALF + (i + 0.5) * step;
      const k = j * size + i;
      const r = Math.hypot(x, z);
      const wob = vnoise(x / 1.7 + 3.1, z / 1.7 - 7.3);

      // Мостовая и её обочины: у полотна земля вытоптана на полшага.
      let road = Infinity;
      for (const ring of l.rings) road = Math.min(road, ring.r === 0 ? r - ring.half : Math.abs(r - ring.r) - ring.half);
      for (const b of lines) if (inBox(b, x, z)) road = Math.min(road, stripDist(b.item, x, z));
      let tr = Infinity;
      for (const b of trails) if (inBox(b, x, z)) tr = Math.min(tr, stripDist(b.item, x, z));
      let soil = Math.max(0.75 * (1 - smooth((road - 0.02) / 0.32)), 1 - smooth((tr + 0.08 + wob * 0.06) / 0.28));
      // У домов вытоптано шире, чем лежит декаль: двор, где ходят.
      let under = 1;
      for (const b of spots) {
        if (!inBox(b, x, z)) continue;
        const s = b.item;
        const d = Math.hypot(x - s.x, z - s.z);
        soil = Math.max(soil, (1 - smooth((d - s.r * 1.05) / (s.r * 0.55 + 0.4))) * 0.85);
        if (d < s.r * 1.08) under = 0;
      }
      // Внутри стены трава вытоптана местами — пятнами, а не сплошь.
      if (r < WALL_RADIUS - 0.8) soil = Math.max(soil, 0.35 * smooth((vnoise(x / 2.6, z / 2.6) + 0.1) / 0.6));
      // Под стеной — полоса голой земли: у частокола не косят, но и не растёт.
      const wallBand = 1 - smooth((Math.abs(r - WALL_RADIUS) - 0.7) / 0.6);
      soil = Math.max(soil, wallBand * 0.7);
      // Полоса вырубки: земля местами разворочена пнями и волоком.
      // Полоса идёт от черты расчистки до края леса — тот рваный (`edgeRadius`), и полоса с ним.
      const edge = r - CLEAR_RADIUS;
      if (edge > 0 && r < FOREST_FROM + 4) {
        const strip = smooth(edge / 0.4) * (1 - smooth((r - edgeRadius(x, z) + 0.2) / 1.2));
        soil = Math.max(soil, 0.45 * strip * smooth((vnoise(x / 1.3 + 9, z / 1.3) - 0.15) / 0.5));
      }

      // Лесная подстилка — там, где полог: той же густотой, по которой растут деревья
      // (`forestDensity`). Купы леса лежат на подстилке, прогалины и опушка остаются
      // травой; ровной дуги по радиусу, которая читалась тенью облака, нет.
      // За краем прежнего мира карта не считает — там дальний лес, подстилка сплошь.
      const canopy = r > GROUND_RADIUS - 1.3 ? 0.85 : r > CLEAR_RADIUS + 0.5 ? forestDensity(l, x, z, tr) : 0;
      const litter = smooth((canopy - 0.25 + wob * 0.12) / 0.6);
      // Каменистая земля у скал: пятнами, трава между камнями остаётся.
      const rocks = Math.hypot(x - ZONES.rocks.x, z - ZONES.rocks.z);
      const stone = (1 - smooth((rocks - 3.2 + wob * 1.4) / 2.2)) * smooth((vnoise(x / 1.4 + 2, z / 1.4 - 6) + 0.35) / 0.7) * 0.85;
      const field = Math.hypot(x - ZONES.fields.x, z - ZONES.fields.z) < 7 ? fieldAt(l, x, z) : 0;
      // Выгон: внутри изгороди трава выедена, у воротец и кормушки вытоптана пятнами.
      const pd = Math.hypot(x - l.farm.pasture.x, z - l.farm.pasture.z) - l.farm.pasture.r;
      const graze = pd < 1 ? (1 - smooth((pd + 0.2) / 0.9)) * (0.75 + 0.25 * smooth((vnoise(x / 1.1 + 5, z / 1.1 - 8) + 0.2) / 0.6)) : 0;
      // Густой луг — пятнами по крупному шуму, только на открытом.
      const lush = smooth((vnoise(x / 4.2 - 11, z / 4.2 + 5) - 0.05) / 0.5) * (1 - litter) * (1 - graze);

      m.soil[k] = clamp01(soil);
      m.litter[k] = litter;
      m.stone[k] = stone;
      m.field[k] = field;
      m.lush[k] = lush;
      m.graze[k] = graze;

      // Трава: на лугу за стеной гуще всего, внутри стены реже, в лесу — редкими пучками.
      const open = r < WALL_RADIUS - 1.2 ? 0.3 : 1;
      let grass = open * (1 - litter * 0.72) * (1 - clamp01(soil) * 0.95) * (1 - stone) * (1 - field) * (1 - graze * 0.6) * under;
      if (Math.abs(r - WALL_RADIUS) < 1.35 || road < 0.12 || tr < 0.05 || r > GROUND_RADIUS - 1.5) grass = 0;
      m.grass[k] = clamp01(grass * (0.75 + 0.5 * lush));
      // Цветы: куртинами на пятнах густого луга и по межам пашни, а не ровной сыпью.
      const verge = field > 0.02 && field < 0.6 ? 0.9 : 0;
      const patch = smooth((lush - 0.35) / 0.4) * smooth((vnoise(x / 1.6 + 17, z / 1.6 - 3) + 0.1) / 0.5);
      m.bloom[k] = r < WALL_RADIUS + 1.4 || road < 0.2 ? 0 : clamp01(Math.max(patch * grass * (1 - graze), verge));
      // Ряд через посёлок спрашивает дома и дороги — он дороже ряда в лесу: кусок — треть
      // сотни текселей, а не ряд целиком.
      if ((i & 31) === 31) yield;
    }
  }
  return m;
}

/** Значение канала карты в точке мира — билинейно. Вне карты — ноль. */
export function sample(map: GroundMap, ch: Float32Array, x: number, z: number): number {
  const fx = toTexel(map.size, x);
  const fz = toTexel(map.size, z);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= map.size || j >= map.size ? 0 : ch[j * map.size + i]);
  return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - tz) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * tz;
}

// ---------- Деревья ----------

export type Species = 'spruce' | 'pine' | 'oak' | 'birch';
export const SPECIES: readonly Species[] = ['spruce', 'pine', 'oak', 'birch'];

/**
 * Радиус кроны вида при масштабе 1 — габарит для зоны расчистки (крона не должна
 * нависать над чертой) и для пятна тени под деревом. Числа сняты с моделей (`models.ts`).
 */
export const CROWN: Record<Species, number> = { spruce: 0.82, pine: 0.8, oak: 1.08, birch: 0.66 };

export interface Tree {
  x: number;
  y: number;
  z: number;
  species: Species;
  scale: number;
  rot: number;
  /** Разброс оттенка: множитель к цвету кроны, около 1. */
  hue: number;
  /** Дальний лес за краем прежнего мира: всегда дальней моделью, без пятна тени. */
  far?: boolean;
}

/**
 * Край леса в этой точке — радиус, где лес начинается. Не окружность: заливы и мысы по
 * крупному шуму (семь-восемь единиц — пара десятков выступов по кругу) и выкусы в одно-два
 * дерева по мелкому. Шум — от координат, а не от угла: у угла был бы шов на обороте.
 * Ближе черты расчистки с запасом край не подходит — там полоса вырубки.
 */
export function edgeRadius(x: number, z: number): number {
  const bay = vnoise(x / 7.5 + 41, z / 7.5 - 23);
  const bite = vnoise(x / 2.4 - 13, z / 2.4 + 29);
  return Math.max(CLEAR_RADIUS + 1.7, FOREST_FROM + 0.3 + 2.0 * bay + 0.7 * bite);
}

/**
 * Стена леса вдоль дороги из ворот, 0..1: коридор ворот (`plan.inCleared`) — прямая, и
 * лес, обрезанный по нему, читался вырубленным по линейке. Стена отступает от коридора по
 * шуму вдоль дороги — своему у каждой обочины, — на две единицы вглубь и обратно.
 * Сам коридор не трогается: он — пол, ниже которого стена не подходит. `scale` — шаг шума
 * вдоль дороги: у дальнего леса он крупнее.
 */
export function gateEdge(x: number, z: number, scale = 3.5): number {
  const along = x * Math.cos(GATE_ANGLE) + z * Math.sin(GATE_ANGLE);
  if (along <= 0) return 1;
  const s = -x * Math.sin(GATE_ANGLE) + z * Math.cos(GATE_ANGLE);
  const wall = GATE_CLEAR_HALF + 0.3 + 2.0 * (0.5 + 0.5 * vnoise(along / scale + (s > 0 ? 7 : -19), 3.3));
  return smooth((Math.abs(s) - wall + 0.8) / 1.8);
}

/** Опушка, 0..1: полоса у края леса, где растут подлесок и молодняк. */
export const fringe = (x: number, z: number): number => clamp01(1 - Math.abs(Math.hypot(x, z) - edgeRadius(x, z) + 0.5) / 1.8);

/** Прогалина угодья, 0..1: в середине угодья ноль — там ни молодняка, ни одиноких деревьев. */
function glade(x: number, z: number): number {
  let k = 1;
  for (const g of ENV_GLADES) k = Math.min(k, smooth((Math.hypot(x - g.at.x, z - g.at.z) / g.r - 0.7) / 0.4));
  return k;
}

/** Откуда ближний лес сходит на нет, а дальний входит: шов не читается кольцом. */
const SEAM = GROUND_RADIUS - 4;

/**
 * Густота леса в точке, 0..1: опушка входит мягко по рваному краю (`edgeRadius`), пятнами —
 * купы и прогалины, у угодий лес расступается (`GLADES`, край прогалины тоже неровный),
 * вдоль троп — редеет, вдоль дороги ворот — отступает рваной стеной (`gateEdge`).
 */
export function forestDensity(l: Layout, x: number, z: number, trail = trailDist(l, x, z)): number {
  const r = Math.hypot(x, z);
  if (r > GROUND_RADIUS - 1.3) return 0;
  let d = smooth((r - (edgeRadius(x, z) - 1.1)) / 2.2);
  if (d <= 0) return 0;
  const n = vnoise(x / 6.5 + 31, z / 6.5 - 17);
  // Прогалины внутри леса — мягкие: прежде густота падала ступенью, и край читался вырезанным.
  d *= 0.25 + (0.53 + 0.22 * n) * smooth((n + 0.7) / 0.3);
  for (const g of ENV_GLADES) {
    const k = Math.hypot(x - g.at.x, z - g.at.z) / g.r + 0.15 * vnoise(x / 2.5 + 57, z / 2.5 - 3);
    if (k < 1) d *= g.keep + (1 - g.keep) * smooth((k - 0.6) / 0.4);
  }
  d *= smooth((trail - 0.25 - 0.25 * (1 + vnoise(x / 3 + 71, z / 3))) / 1.1);
  d *= gateEdge(x, z);
  // Шов с дальним лесом: ближний сходит на нет, дальний входит (`scatterTreesJob`).
  d *= 1 - smooth((r - SEAM) / (GROUND_RADIUS - 1.3 - SEAM));
  return clamp01(d);
}

/**
 * Какой вид растёт в точке. Лес Европы 1200 года — смешанный: у опушки берёза
 * (первой заходит на вырубку), купами дуб, в глубине ель, на камнях у скал сосна.
 */
export function speciesAt(x: number, z: number, h: number): Species {
  const r = Math.hypot(x, z);
  const depth = clamp01((r - edgeRadius(x, z)) / (GROUND_RADIUS - FOREST_FROM));
  if (Math.hypot(x - ZONES.rocks.x, z - ZONES.rocks.z) < 8.5 && h < 0.65) return 'pine';
  if (depth < 0.2 && h < 0.42) return 'birch';
  const stand = vnoise(x / 9 + 5, z / 9 + 11);
  if (stand < -0.12) return h < 0.72 ? 'oak' : 'birch';
  if (stand > 0.3) return h < 0.82 ? 'spruce' : 'pine';
  return h < 0.42 ? 'spruce' : h < 0.7 ? 'oak' : h < 0.85 ? 'pine' : 'birch';
}

/** Клетка решётки леса: одно дерево на клетку, сдвинутое хешем. */
export const TREE_CELL = 1.62;

export const scatterTrees = (l: Layout): Tree[] => drain(scatterTreesJob(l));

/** Лес по рядам решётки: ближний, потом дальний. */
export function* scatterTreesJob(l: Layout): Job<Tree[]> {
  const out: Tree[] = [];
  const n = Math.ceil(GROUND_RADIUS / TREE_CELL);
  for (let iz = -n; iz <= n; iz++) {
    for (let ix = -n; ix <= n; ix++) {
      const x = (ix + 0.5 + (cell(ix, iz, 1) - 0.5) * 0.85) * TREE_CELL;
      const z = (iz + 0.5 + (cell(ix, iz, 2) - 0.5) * 0.85) * TREE_CELL;
      const d = forestDensity(l, x, z);
      if (d <= 0 || cell(ix, iz, 3) > d) continue;
      const species = speciesAt(x, z, cell(ix, iz, 4));
      const r = Math.hypot(x, z);
      const depth = clamp01((r - FOREST_FROM) / (GROUND_RADIUS - FOREST_FROM));
      // Опушка моложе чащи: у края деревья ниже — лес входит на вырубку, а не стоит стеной.
      const young = 0.55 + 0.45 * smooth((r - edgeRadius(x, z) + 1.0) / 3.2);
      const scale = (0.82 + cell(ix, iz, 5) * 0.48) * (0.92 + 0.22 * depth) * (species === 'birch' ? 0.9 : 1) * young;
      if (inCleared(x, z, CROWN[species] * scale) || farmDist(l, x, z) < CROWN[species] * scale) continue;
      out.push({ x, y: groundHeight(x, z) - 0.04, z, species, scale, rot: cell(ix, iz, 6) * Math.PI * 2, hue: 0.9 + cell(ix, iz, 7) * 0.2 });
    }
    yield;
  }
  // Молодняк на опушке: берёзки и ёлочки впереди стены леса — поросль, которая заходит
  // на вырубку. Те же породы тем же мешем, только мелкие: вызовов не прибавляет.
  const YOUNG_CELL = 1.1;
  const y = Math.ceil((FOREST_FROM + 3) / YOUNG_CELL);
  for (let iz = -y; iz <= y; iz++) {
    for (let ix = -y; ix <= y; ix++) {
      const x = (ix + cell(ix, iz, 20)) * YOUNG_CELL;
      const z = (iz + cell(ix, iz, 21)) * YOUNG_CELL;
      const r = Math.hypot(x, z);
      const e = edgeRadius(x, z);
      if (r < e - 2.4 || r > e + 0.8) continue;
      const band = clamp01(1 - Math.abs(r - e + 0.8) / 1.6);
      if (cell(ix, iz, 22) > 0.22 * band * gateEdge(x, z) * smooth((trailDist(l, x, z) - 0.4) / 0.8) * glade(x, z)) continue;
      const h = cell(ix, iz, 23);
      const species: Species = Math.hypot(x - ZONES.rocks.x, z - ZONES.rocks.z) < 8.5 ? 'pine' : h < 0.6 ? 'birch' : 'spruce';
      const scale = 0.32 + cell(ix, iz, 24) * 0.26;
      if (inCleared(x, z, CROWN[species] * scale) || farmDist(l, x, z) < CROWN[species] * scale) continue;
      out.push({ x, y: groundHeight(x, z) - 0.04, z, species, scale, rot: cell(ix, iz, 25) * Math.PI * 2, hue: 0.92 + cell(ix, iz, 26) * 0.2 });
    }
    yield;
  }

  // Одинокие деревья на лугу перед опушкой: старый дуб или берёза, которых не срубили.
  const LONE_CELL = 2.4;
  const w = Math.ceil((FOREST_FROM + 1) / LONE_CELL);
  for (let iz = -w; iz <= w; iz++) {
    for (let ix = -w; ix <= w; ix++) {
      const x = (ix + cell(ix, iz, 30)) * LONE_CELL;
      const z = (iz + cell(ix, iz, 31)) * LONE_CELL;
      const r = Math.hypot(x, z);
      const e = edgeRadius(x, z);
      if (r < e - 3.5 || r > e - 1.3) continue;
      if (cell(ix, iz, 32) > 0.12 * gateEdge(x, z) * glade(x, z) || trailDist(l, x, z) < 1.2) continue;
      const species: Species = cell(ix, iz, 33) < 0.6 ? 'oak' : 'birch';
      const scale = 0.85 + cell(ix, iz, 34) * 0.3;
      if (inCleared(x, z, CROWN[species] * scale) || farmDist(l, x, z) < CROWN[species] * scale + 0.4) continue;
      out.push({ x, y: groundHeight(x, z) - 0.04, z, species, scale, rot: cell(ix, iz, 35) * Math.PI * 2, hue: 0.9 + cell(ix, iz, 36) * 0.2 });
    }
  }
  yield;

  // Дальний лес: реже и крупнее, купами; за ним — только дымка. Входит он раньше края
  // прежнего мира, пока ближний сходит на нет (`SEAM`), — шов не читается кольцом.
  const FAR_CELL = 2.7;
  const m = Math.ceil(FAR_RADIUS / FAR_CELL);
  for (let iz = -m; iz <= m; iz++) {
    for (let ix = -m; ix <= m; ix++) {
      const x = (ix + 0.5 + (cell(ix, iz, 11) - 0.5) * 0.9) * FAR_CELL;
      const z = (iz + 0.5 + (cell(ix, iz, 12) - 0.5) * 0.9) * FAR_CELL;
      const r = Math.hypot(x, z);
      if (r < SEAM || r > FAR_RADIUS - 2) continue;
      const d = (0.55 + 0.4 * vnoise(x / 11 - 5, z / 11 + 7)) * smooth((r - SEAM) / (GROUND_RADIUS - 1.3 - SEAM)) * gateEdge(x, z, 6);
      if (cell(ix, iz, 13) > d) continue;
      const species = speciesAt(x, z, cell(ix, iz, 14));
      const scale = 1.05 + cell(ix, iz, 15) * 0.6;
      // Коридор ворот уходит к горизонту: дорога из ворот не упирается и в дальний лес.
      if (inCleared(x, z, CROWN[species] * scale)) continue;
      out.push({ x, y: envHeight(x, z) - 0.05, z, species, scale, rot: cell(ix, iz, 16) * Math.PI * 2, hue: 0.9 + cell(ix, iz, 17) * 0.2, far: true });
    }
    yield;
  }
  return out;
}

// ---------- Мелочь ----------

export type PropKind = 'bush' | 'berry' | 'fern' | 'rock' | 'stump' | 'log';
export const PROP_KINDS: readonly PropKind[] = ['bush', 'berry', 'fern', 'rock', 'stump', 'log'];

/** Габарит мелочи при масштабе 1 — для зоны расчистки и пятна тени. */
export const PROP_SPREAD: Record<PropKind, number> = { bush: 0.55, berry: 0.55, fern: 0.45, rock: 0.55, stump: 0.32, log: 0.85 };

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  hue: number;
}

/**
 * Мелочь по правилам. `share` — доля полного набора от уровня качества: правило
 * отбора то же, порог строже, и на низком уровне мелочь редеет, а не переезжает.
 */
export const scatterProps = (l: Layout, share: number): Prop[] => drain(scatterPropsJob(l, share));

/** Мелочь по слоям: кусок — ряд решётки слоя. */
export function* scatterPropsJob(l: Layout, share: number): Job<Prop[]> {
  const out: Prop[] = [];
  const put = (kind: PropKind, x: number, z: number, scale: number, pick: number, salt: number): void => {
    if (pick > share) return;
    if (inCleared(x, z, PROP_SPREAD[kind] * scale)) return;
    if (trailDist(l, x, z) < 0.15 + PROP_SPREAD[kind] * scale * 0.5) return;
    if (farmDist(l, x, z) < PROP_SPREAD[kind] * scale) return;
    if (Math.hypot(x, z) > GROUND_RADIUS - 1.2) return;
    out.push({ kind, x, y: groundHeight(x, z) - 0.03, z, scale, rot: hash(salt, 90) * Math.PI * 2, hue: 0.9 + hash(salt, 91) * 0.2 });
  };

  // Полоса вырубки: здесь племя брало лес на частокол — пни, брошенные стволы, поросль.
  for (let i = 0; i < 150; i++) {
    // Место в своей доле круга — любое, а не у её начала: ровная гребёнка через шаг читалась забором.
    const a = ((i + hash(i, 100)) / 150) * Math.PI * 2;
    // Глубина полосы — до края леса, а он рваный: где лес подошёл ближе, полоса уже.
    const reach = Math.min(CLEAR_EDGE, edgeRadius(Math.cos(a) * FOREST_FROM, Math.sin(a) * FOREST_FROM) - CLEAR_RADIUS);
    const r = CLEAR_RADIUS + 0.25 + hash(i, 101) * Math.max(0.3, reach - 0.3);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const kind = hash(i, 102);
    const pick = hash(i, 103);
    if (kind < 0.4) put('stump', x, z, 0.8 + hash(i, 104) * 0.6, pick, i);
    else if (kind < 0.55) put('log', x, z, 0.75 + hash(i, 104) * 0.5, pick, i);
    else if (kind < 0.8) put('bush', x, z, 0.55 + hash(i, 104) * 0.4, pick, i);
    else put('fern', x, z, 0.7 + hash(i, 104) * 0.5, pick, i);
  }

  // Лесной покров решёткой: у каждого вида своя клетка и своя доля.
  const layer = function* (kind: PropKind, size: number, keep: number, salt: number, scale: [number, number], where: (x: number, z: number) => number): Job<void> {
    const n = Math.ceil(GROUND_RADIUS / size);
    for (let iz = -n; iz <= n; iz++) {
      for (let ix = -n; ix <= n; ix++) {
        const x = (ix + cell(ix, iz, salt)) * size;
        const z = (iz + cell(ix, iz, salt + 1)) * size;
        const w = where(x, z);
        if (w <= 0 || cell(ix, iz, salt + 2) > keep * w) continue;
        const s = scale[0] + cell(ix, iz, salt + 3) * (scale[1] - scale[0]);
        put(kind, x, z, s, cell(ix, iz, salt + 4), salt * 997 + iz * 131 + ix);
      }
      yield;
    }
  };
  const forest = (x: number, z: number): number => smooth((Math.hypot(x, z) - edgeRadius(x, z) + 0.6) / 1.2);
  const nearZone = (at: { x: number; z: number }, r: number) => (x: number, z: number): number => 1 - smooth((Math.hypot(x - at.x, z - at.z) - r * 0.6) / (r * 0.4));

  yield* layer('fern', 1.3, 0.34, 200, [0.7, 1.25], (x, z) => forest(x, z) * (0.6 + 0.4 * vnoise(x / 3, z / 3 + 4)));
  yield* layer('bush', 2.9, 0.32, 210, [0.6, 1.1], forest);
  yield* layer('rock', 4.2, 0.24, 220, [0.45, 0.9], forest);
  yield* layer('log', 4.8, 0.22, 230, [0.7, 1.15], forest);
  yield* layer('stump', 6.2, 0.14, 240, [0.7, 1.2], forest);
  // Опушка: подлесок впереди стены леса — кусты, папоротник, ягодник. Те же виды тем же
  // мешем: вызовов не прибавляет.
  const edgeBand = (x: number, z: number): number => fringe(x, z) * gateEdge(x, z);
  yield* layer('bush', 1.7, 0.45, 320, [0.6, 1.15], edgeBand);
  yield* layer('fern', 1.2, 0.35, 330, [0.7, 1.1], edgeBand);
  yield* layer('berry', 3.4, 0.18, 340, [0.7, 1.0], edgeBand);
  // Угодья: лесосека у лесопилки — пни и брошенные стволы; у скал — валуны; ягодник.
  yield* layer('stump', 1.5, 0.42, 250, [0.8, 1.3], nearZone(ZONES.forest, 5.5));
  yield* layer('log', 2.6, 0.3, 260, [0.8, 1.2], nearZone(ZONES.forest, 5.5));
  yield* layer('rock', 1.25, 0.5, 270, [0.6, 1.9], nearZone(ZONES.rocks, 4.6));
  yield* layer('berry', 1.15, 0.55, 280, [0.75, 1.1], nearZone(ZONES.berries, 3.6));
  yield* layer('bush', 1.8, 0.35, 290, [0.7, 1.1], nearZone(ZONES.berries, 5.2));
  yield* layer('fern', 1.1, 0.45, 300, [0.8, 1.3], nearZone(ZONES.hunting, 6.5));
  yield* layer('log', 3.0, 0.3, 310, [0.8, 1.2], nearZone(ZONES.hunting, 6.5));
  return out;
}

// ---------- Покров: трава, цветы, всходы ----------

export interface Tuft {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  hue: number;
}

/** Цвет цветка — номер в `FLOWER_KEYS` (`env/index.ts`). */
export interface Flower extends Tuft {
  color: number;
}

/** Сколько видов цветов: ромашка, лютик, василёк, клевер, мак. */
export const FLOWER_COLORS = 5;

/**
 * Доли видов на лугу: белого и жёлтого — большинство, синего, розового и красного —
 * вкраплениями. Ровная смесь пяти цветов читалась конфетти, а не лугом.
 */
const FLOWER_SHARE = [0.36, 0.34, 0.12, 0.11, 0.07];

function flowerColor(h: number): number {
  let acc = 0;
  for (let i = 0; i < FLOWER_SHARE.length; i++) {
    acc += FLOWER_SHARE[i];
    if (h < acc) return i;
  }
  return 0;
}

/**
 * Можно ли покрову стоять в точке — по самой геометрии, а не по карте: карта считана
 * в тексель по трети единицы, и её выборка между текселями «протекает» травой на край
 * полотна. Точка на мостовой, на тропе, под домом или на стене отбрасывается.
 */
function coverFits(l: Layout, x: number, z: number): boolean {
  if (Math.abs(Math.hypot(x, z) - WALL_RADIUS) < 1.25) return false;
  if (roadDist(l, x, z) < 0.06 || trailDist(l, x, z) < 0.04) return false;
  for (const s of l.spots) if (Math.hypot(x - s.x, z - s.z) < s.r * 1.04) return false;
  return true;
}

/**
 * Разбрасывает `count` пучков по плотности канала: решётка с шагом, при котором
 * среднее число принятых выходит около `count`, сдвиг и отбор — хешем клетки.
 * Точное число не обещается — обещается потолок: больше `count` не бывает.
 */
function* scatterBy(l: Layout, map: GroundMap, ch: Float32Array, count: number, salt: number): Job<Tuft[]> {
  if (count <= 0) return [];
  let mass = 0;
  for (let k = 0; k < ch.length; k++) mass += ch[k];
  const texel = (2 * MAP_HALF) / map.size;
  const area = mass * texel * texel;
  if (area <= 0) return [];
  const step = Math.sqrt(area / count);
  const n = Math.ceil(MAP_HALF / step);
  const out: Tuft[] = [];
  for (let iz = -n; iz < n && out.length < count; iz++) {
    for (let ix = -n; ix < n && out.length < count; ix++) {
      const x = (ix + cell(ix, iz, salt)) * step;
      const z = (iz + cell(ix, iz, salt + 1)) * step;
      const d = sample(map, ch, x, z);
      if (d <= 0.02 || cell(ix, iz, salt + 2) > d || !coverFits(l, x, z)) continue;
      out.push({
        x,
        y: groundHeight(x, z) - 0.02,
        z,
        scale: (0.72 + cell(ix, iz, salt + 3) * 0.5) * (0.8 + 0.3 * d),
        rot: cell(ix, iz, salt + 4) * Math.PI * 2,
        hue: 0.88 + cell(ix, iz, salt + 5) * 0.24,
      });
      if ((ix & 63) === 63) yield;
    }
    yield;
  }
  return out;
}

export const scatterGrassJob = (l: Layout, map: GroundMap, count: number): Job<Tuft[]> => scatterBy(l, map, map.grass, count, 400);
export const scatterGrass = (l: Layout, map: GroundMap, count: number): Tuft[] => drain(scatterGrassJob(l, map, count));

export function* scatterFlowersJob(l: Layout, map: GroundMap, count: number): Job<Flower[]> {
  const list = yield* scatterBy(l, map, map.bloom, count, 500);
  return list.map((t, i) => ({ ...t, scale: t.scale * 0.9, color: flowerColor(hash(i, 510)) }));
}
export const scatterFlowers = (l: Layout, map: GroundMap, count: number): Flower[] => drain(scatterFlowersJob(l, map, count));

/** Всход: пучок и что посеяно — озимые и яровые разного цвета. */
export interface Crop extends Tuft {
  sowing: Sowing;
}

/** Всходы на пашне: рядами вдоль борозд, по одному пучку на шаг; на пару — ничего. */
export function scatterCrops(l: Layout, keep: number): Crop[] {
  const out: Crop[] = [];
  const across = { x: -l.furrow.z, z: l.furrow.x };
  let i = 0;
  for (const f of l.fields) {
    if (f.sowing === 'fallow') continue;
    for (let v = -f.across + 0.2; v <= f.across - 0.2; v += 0.3) {
      for (let u = -f.along + 0.15; u <= f.along - 0.15; u += 0.3) {
        i++;
        if (hash(i, 600) > keep) continue;
        const x = f.x + l.furrow.x * u + across.x * v + (hash(i, 601) - 0.5) * 0.08;
        const z = f.z + l.furrow.z * u + across.z * v + (hash(i, 602) - 0.5) * 0.08;
        out.push({ x, y: groundHeight(x, z) - 0.02, z, scale: 0.85 + hash(i, 603) * 0.3, rot: hash(i, 604) * Math.PI * 2, hue: 0.92 + hash(i, 605) * 0.16, sowing: f.sowing });
      }
    }
  }
  return out;
}
