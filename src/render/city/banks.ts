// Берег воды города (docs/city.md, 12.3): сколько воды в точке, где кромка, насколько сыра земля у воды, где стоит
// камыш и лежат камни, какие огни отражаются в воде ночью. Чистые функции от плана и зерна — без three и без
// `Math.random`: их считают поток мира (`world.ts`), счёт бюджета (`budget.ts`) и тесты (`water.test.ts`).
import type { Quality } from '../quality';
import type { V3 } from './geom';
import { distPoly, heightAt, insidePoly, RACE, RACE_HALF, RACE_LEVEL, raceRibbon, riverLevel, riverRibbon, riverX, RIVER_HALF, smoothPath, type CityPlan } from './layout';
import { fieldAt, openLand } from './ground';
import { forestAt } from './nature';
import { rnd, vnoise } from './noise';
import { SHORE_CAP } from './spec';

/** Середина мельничного ручья — та же ломаная, что у ленты воды (`layout.raceRibbon`). */
export const RACE_PATH = smoothPath(RACE, 2);

/** Полоса долины, в которой уровень реки относится к земле: лента воды — до `SHORE_FIT` и метра за ней. */
const RIVER_REACH = RIVER_HALF + 14;

/**
 * Дальше этого от середины, метры, лента реки за кромкой не идёт: кромка долины ближе, а дальше её находит только
 * устье мельничного ручья (ручей ниже реки, `waterDepth`), и там воду несёт лента ручья (держит `water.test.ts`).
 */
export const SHORE_FIT = 18;

/** Кромка строки ленты: на сколько метров от середины `p` в сторону `(dx, dz)` вода встречает берег; не дальше `SHORE_FIT`. */
function edgeAlong(p: { x: number; z: number }, dx: number, dz: number): number {
  let d = RIVER_HALF;
  while (d < SHORE_FIT && waterDepth(p.x + dx * d, p.z + dz * d) > 0) d += 0.25;
  return d;
}

/** Суша дальше от воды, чем считает сырость: высота над водой «нигде». */
export const DRY = -99;

/**
 * Сколько воды над землёй в точке: больше нуля — глубина, метры; не больше нуля — суша, минус высота над водой.
 * Река — в своей долине (уровень `layout.riverLevel` у этого `z`), ручей — у своего русла (`RACE_LEVEL`); дальше — `DRY`.
 */
export function waterDepth(x: number, z: number): number {
  let d = DRY;
  if (Math.abs(x - riverX(z)) < RIVER_REACH) d = riverLevel(z) - heightAt(x, z);
  if (x > -170 && x < -110 && z > -8 && z < 44 && distPoly({ x, z }, RACE_PATH) < RACE_HALF + 3.5) d = Math.max(d, RACE_LEVEL - heightAt(x, z));
  return d;
}

/**
 * Кромка: на сколько метров от середины реки вода встречает берег (сторона `side` = ±1). Плоскость воды режет склон
 * русла (`layout.heightAt`: плоское дно во всю ширину, склон за ним) — там и кромка. Ищется шагом в четверть метра.
 */
export function shoreOffset(z: number, side: 1 | -1): number {
  const x0 = riverX(z);
  const level = riverLevel(z);
  for (let d = RIVER_HALF; d < RIVER_REACH; d += 0.25) if (heightAt(x0 + side * d, z) >= level) return d;
  return RIVER_REACH;
}

/** Подъём над водой, за которым земля уже не сырая, метры. */
export const WET_RISE = 2.2;

/**
 * Сырость земли у воды, 0..1: под водой и у самой кромки — 1 (ил), выше — убывает до нуля за `WET_RISE` метров
 * подъёма (сырая земля, потом влажная трава). По высоте над водой, а не по расстоянию: пологий берег сыр шире крутого.
 */
export function groundWet(x: number, z: number): number {
  const d = waterDepth(x, z);
  if (d >= 0) return 1;
  return Math.max(0, 1 + d / WET_RISE);
}

/** Куртина камыша: место (у кромки, основание на дне или на берегу), поворот, рост и оттенок. */
export interface Reed {
  x: number;
  y: number;
  z: number;
  rot: number;
  h: number;
  tone: number;
}

/** Камень на берегу: место (вросший), поворот и размер; оттенок камню даёт его место (`shore.ts`). */
export interface Stone {
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
}

/** Видимый участок реки: от леса за замком до дороги в долину — дальше её съедает дымка (`camera.cityFog`). */
export const SHORE_Z: readonly [number, number] = [-330, 300];

/** Камыш и камни не садятся на устья ручья: там вода бежит, а берег — работа людей мельницы. */
const nearRace = (x: number, z: number): boolean => x > -175 && x < -105 && z > -15 && z < 50 && distPoly({ x, z }, RACE_PATH) < RACE_HALF + 5;

/**
 * Камыш у кромки (в мелкой воде и на мокром берегу) и камни на берегу — от зерна, по уровню (`SHORE_CAP`). Камыш
 * растёт куртинами: густота — крупный шум вдоль реки, каменистые плёсы — где камыша нет. Не на дорогах, не во
 * дворах и не у устьев ручья (`ground.openLand`); не глубже метра.
 */
export function shoreItems(plan: CityPlan, q: Quality, seed = 4243): { reeds: Reed[]; stones: Stone[]; rocks: Stone[] } {
  const cap = SHORE_CAP[q];
  const reeds: Reed[] = [];
  const stones: Stone[] = [];
  const step = cap.step;
  const n = Math.ceil((SHORE_Z[1] - SHORE_Z[0]) / step);
  for (let i = 0; i <= n; i++) {
    const z0 = SHORE_Z[0] + i * step;
    for (const side of [-1, 1] as const) {
      const k = i * 2 + (side > 0 ? 1 : 0);
      const z = z0 + (rnd(i, side, seed) - 0.5) * step;
      const shore = shoreOffset(z, side);
      const thick = vnoise(z / 11, side * 7 + 20, 1e6, seed + 1);
      if (thick > 0.44 && rnd(k, 3, seed) < 0.9) {
        // В воду от кромки до полутора метров, на берег — до семи десятков сантиметров.
        const x = riverX(z) + side * (shore + (rnd(k, 5, seed) - 0.7) * 2.2);
        if (!nearRace(x, z) && openLand(x, z, plan, 1.5) && waterDepth(x, z) < 1) {
          reeds.push({ x, y: heightAt(x, z), z, rot: rnd(k, 7, seed) * Math.PI * 2, h: 1.5 + rnd(k, 11, seed) * 1.1, tone: rnd(k, 13, seed) });
        }
      } else if (rnd(k, 17, seed) < 0.16 + (0.44 - Math.min(thick, 0.44)) * 0.5) {
        const x = riverX(z) + side * (shore + 0.15 + rnd(k, 19, seed) * 2.4);
        if (!nearRace(x, z) && openLand(x, z, plan, 1.5)) {
          const s = 0.22 + Math.pow(rnd(k, 23, seed), 2) * 0.75;
          stones.push({ x, y: heightAt(x, z) - s * 0.25, z, rot: rnd(k, 29, seed) * Math.PI * 2, s });
        }
      }
    }
  }
  return { reeds: thin(reeds, cap.reeds), stones: thin(stones, cap.stones), rocks: slopeRocks(plan, q, seed + 7) };
}

/**
 * Камни на склонах мыса (docs/city_v3.md, Г-3): там, где земля круче 13°, — россыпью, гнёздами по крупному шуму (осыпь под
 * бровкой, валуны в траве); не на полях, дорогах и дворах, не в реке и не в чаще (в лесу их не видно). Модель и меш — те же,
 * что у камней берега: вызова не прибавляют. Сколько — `SHORE_CAP.rocks`.
 */
export function slopeRocks(plan: CityPlan, q: Quality, seed: number): Stone[] {
  const cap = SHORE_CAP[q].rocks;
  if (cap === 0) return [];
  const out: Stone[] = [];
  const STEP = 5;
  for (let j = -64; j <= 64; j++) {
    for (let i = -48; i <= 48; i++) {
      const x = i * STEP + (rnd(i, j, seed) - 0.5) * STEP;
      const z = -20 + j * STEP + (rnd(i, j, seed + 1) - 0.5) * STEP;
      const e = 1.2;
      const g = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      if (g < 0.23) continue;
      // Гнёзда: осыпь там, где крупный шум высок; чем круче, тем гуще.
      const nest = vnoise(x / 26 + 3, z / 26 + 3, 1e6, seed + 2);
      if (rnd(i, j, seed + 3) > (nest - 0.42) * 1.6 * Math.min(1, g * 2.2)) continue;
      if (Math.abs(x - riverX(z)) < RIVER_HALF + 3) continue;
      if (insidePoly({ x, z }, plan.wall) || insidePoly({ x, z }, plan.castleWall)) continue;
      if (distPoly({ x, z }, plan.wall, true) < 3 || distPoly({ x, z }, plan.castleWall, true) < 3) continue;
      if (!openLand(x, z, plan, 1) || fieldAt(x, z, plan) > 0 || forestAt(x, z, plan) > 0.6) continue;
      const s = 0.3 + Math.pow(rnd(i, j, seed + 4), 2.2) * 1.3;
      out.push({ x, y: heightAt(x, z) - s * 0.32, z, rot: rnd(i, j, seed + 5) * Math.PI * 2, s });
    }
  }
  return thin(out, cap);
}

/** Не больше `max` — равномерной выборкой по реке, а не первыми: куртины остаются по всей длине. */
function thin<T>(all: T[], max: number): T[] {
  if (all.length <= max) return all;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(all[Math.floor((i * all.length) / max)]);
  return out;
}

/** Сколько огней ложится отблеском на воду ночью (`water.ts`): шейдер воды обходит их на каждом пикселе. */
export const WATER_LIGHTS = 4;

/** Огонь дальше этого от воды, метры, в ней не отражается. */
export const WATER_LIGHT_REACH = 26;

/** Как далеко огонь от кромки реки или ручья, метры (по горизонтали; внутри воды — ноль). */
export const lightToWater = (p: V3): number =>
  Math.max(0, Math.min(Math.abs(p[0] - riverX(p[2])) - RIVER_HALF, distPoly({ x: p[0], z: p[2] }, RACE_PATH) - RACE_HALF));

/** Огни у воды: ближние к реке и ручью, не дальше `WATER_LIGHT_REACH` — фонарь мельницы, огонь у навеса. */
export function waterLights(lights: readonly V3[]): V3[] {
  return lights
    .map((p) => ({ p, d: lightToWater(p) }))
    .filter((l) => l.d < WATER_LIGHT_REACH)
    .sort((a, b) => a.d - b.d)
    .slice(0, WATER_LIGHTS)
    .map((l) => l.p);
}

// ---------- Лента воды: плоские массивы без three (сборка — `water.ts`, счёт бюджета, тест) ----------

/** Колонны ленты ручья поперёк, метры: русло узкое и с крутыми стенками. */
const RACE_COLS: readonly number[] = [-RACE_HALF - 1.4, -RACE_HALF, 0, RACE_HALF, RACE_HALF + 1.4];

/** Глубина в вершине — от −1 (суша) до 3 м: дальше цвет не меняется. */
const DEPTH_CLAMP: readonly [number, number] = [-1, 3];

/** Плоские массивы ленты: их считает и сборка, и счёт бюджета, и тест — без three. */
export interface WaterArrays {
  pos: Float32Array;
  /** Глубина под вершиной, м (≤ 0 — суша: там вода прозрачна). */
  depth: Float32Array;
  /** Направление течения в плане (x, z). */
  flow: Float32Array;
  /** Пройдено по течению от начала потока, м — по нему бежит рябь. */
  run: Float32Array;
  /** 1 — ручей у мельницы, 0 — река. */
  race: Float32Array;
  idx: Uint32Array;
}

/**
 * Лента вдоль ломаной: колонны поперёк (`cols`, м от середины), уровень воды — из точки. У реки (`fit`) колонны
 * за плоским дном (`RIVER_HALF`) ложатся по кромке этой строки (`edgeAlong`, поперёк течения): крайняя — в метре
 * за кромкой, прочие — в той же доле между дном и ею; крайняя всегда сухая, и вода к ней тает, а не обрывается.
 */
function ribbon(
  pts: { x: number; z: number; y: number }[],
  cols: readonly number[],
  isRace: number,
  out: { pos: number[]; depth: number[]; flow: number[]; run: number[]; race: number[]; idx: number[] },
  fit = false,
): void {
  const base = out.pos.length / 3;
  const w = cols.length;
  const cMax = Math.max(...cols.map(Math.abs));
  let run = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l;
    const nz = tx / l;
    const p = pts[k];
    if (k > 0) run += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
    // Край строки с каждой стороны — метр за кромкой.
    const edges = fit ? [edgeAlong(p, -nx, -nz) + 1, edgeAlong(p, nx, nz) + 1] : null;
    for (const c0 of cols) {
      let c = c0;
      if (edges && Math.abs(c0) > RIVER_HALF) {
        const edge = edges[c0 < 0 ? 0 : 1];
        c = Math.sign(c0) * (RIVER_HALF + ((Math.abs(c0) - RIVER_HALF) / (cMax - RIVER_HALF)) * (edge - RIVER_HALF));
      }
      const x = p.x + nx * c;
      const z = p.z + nz * c;
      out.pos.push(x, p.y, z);
      // Ручей, вошедший в реку, прозрачен: там уже лента реки, и второй слой воды лёг бы поверх полосами.
      const merged = isRace === 1 && Math.abs(x - riverX(z)) < RIVER_HALF + 2;
      const dry = merged || (fit && Math.abs(c0) === cMax);
      out.depth.push(dry ? DEPTH_CLAMP[0] : Math.min(DEPTH_CLAMP[1], Math.max(DEPTH_CLAMP[0], waterDepth(x, z))));
      out.flow.push(tx / l, tz / l);
      out.run.push(run);
      out.race.push(isRace);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    for (let c = 0; c < w - 1; c++) {
      const a = base + k * w + c;
      // Вершина a — левее по ходу, a + 1 — правее: обход a → a + 1 → a + w против часовой, если смотреть сверху, —
      // грань лицом вверх (иначе при двусторонней грани three перевернул бы нормаль вниз, и вода и лёд не получали
      // бы солнца).
      out.idx.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
    }
  }
}

/** Лента реки (колонны уровня, `SHORE_CAP.cols`) и ручья — плоскими массивами. */
export function waterGeometry(cols: readonly number[]): WaterArrays {
  const out = { pos: [] as number[], depth: [] as number[], flow: [] as number[], run: [] as number[], race: [] as number[], idx: [] as number[] };
  ribbon(riverRibbon(), cols, 0, out, true);
  ribbon(raceRibbon(), RACE_COLS, 1, out);
  return {
    pos: new Float32Array(out.pos),
    depth: new Float32Array(out.depth),
    flow: new Float32Array(out.flow),
    run: new Float32Array(out.run),
    race: new Float32Array(out.race),
    idx: new Uint32Array(out.idx),
  };
}

/** Треугольников ленты при этих колоннах — счёту бюджета. */
export const waterTriangles = (cols: readonly number[]): number =>
  (riverRibbon().length - 1) * (cols.length - 1) * 2 + (raceRibbon().length - 1) * (RACE_COLS.length - 1) * 2;
