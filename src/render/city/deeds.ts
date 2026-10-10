// Отклик города на дела игрока (docs/city.md, 14): стройка лесами, праздник готовности, найм строем и добыча над
// дворами. Своя докачка (`vite.config.ts`, `LAZY_DOORS` «город: отклик»): сцена тянет кусок после первого кадра города,
// не пришёл — город стоит без отклика, а игра идёт как шла.
//
// **Всё — функция времени**, как жизнь города (docs/city.md, 13.1): леса, груз на блоке, шаг строителя, пыль, вспышка,
// стяг и строй найма считаются от времени сцены заново каждый кадр. Состояние — только начала: когда кончилась стройка
// и когда вышел найм. Вид постройки при этом один навсегда (docs/city.md, раздел 5): леса — временное, вокруг неё.
//
// Касаний отклик не берёт: судья касания — коробки мест (`pick.cityPick`), а не меши; слой надписей — `pointer-events:
// none` (`pops.ts`).
import * as THREE from 'three';
import './deeds.css';
import type { BuildingTypeId } from '@/game/types';
import type { Quality } from '../quality';
import { heightAt, type P } from './layout';
import { at, figureLod, figureMaterial, figureMesh, gaitOf, guardGeometry, heightOnPath, nearestOn, pathOf, patrolAt, personGeometry, softDot, tangentAt, type Junction, type Path } from './life';
import { hash3, rnd } from './noise';
import { linear } from './palette';
import { mainSite, type Site } from './sites';
import type { V3 } from './geom';

// ---------------------------------------------------------------------------------------------
// Леса: раскладка от коробки места — чистая функция, её судит тест.

/** Коробка в мире: середина, полуразмеры вдоль своих осей, поворот вокруг вертикали, цвет. */
export interface Beam {
  x: number;
  y: number;
  z: number;
  /** Полуразмеры: вдоль поворота (`yaw`), по вертикали, поперёк. */
  a: number;
  h: number;
  b: number;
  yaw: number;
  col: V3;
}

const WOOD = linear(0x8a6a48);
const PLANK = linear(0xa58258);
const RAIL = linear(0x6e5034);
const ROPE = linear(0x3a3026);
const CRATE = linear(0x6a4a2e);
const SACK = linear(0xb8a07a);
const BANNER = linear(0xb02a1e);
const GOLD = linear(0xd4a535);
const STAFF = linear(0x4a3a2a);

/** Леса стоят на столько метров от стены постройки. */
export const SCAFFOLD_OFF = 1.1;
/** Шаг ярусов настила, метры. */
const LEVEL = 2.4;

/** Высота лесов у постройки: до трёх четвертей её высоты, от четырёх с половиной до пятнадцати метров. */
export const scaffoldHeight = (s: Site, ground: number): number => Math.min(15, Math.max(4.5, (s.y1 - ground) * 0.72));

/** Рамка места: точка (вперёд `f`, вправо `r`) в мире — «вправо» как у `kit.Frame`. */
const frame = (s: Site, f: number, r: number): P => ({ x: s.x + s.fx * f + s.fz * r, z: s.z + s.fz * f - s.fx * r });

/**
 * Леса вокруг места: стойки по контуру в `SCAFFOLD_OFF` от стен, настилы ярусами через `LEVEL`, перила (кроме
 * «Низкого») и мачта блока у переднего фасада. На «Низком» стоек — только углы и середины сторон, ярусов не больше двух.
 */
export function scaffoldOf(s: Site, quality: Quality): { beams: Beam[]; height: number; ground: number; levels: number[] } {
  const ground = heightAt(s.x, s.z);
  const H = scaffoldHeight(s, ground);
  const F = s.hf + SCAFFOLD_OFF;
  const R = s.hr + SCAFFOLD_OFF;
  const low = quality === 'low';
  const yawF = Math.atan2(-s.fz, s.fx);
  const yawR = Math.atan2(s.fx, s.fz);
  const beams: Beam[] = [];
  // Стойки: по контуру, шаг ~3.2 м, у большой постройки реже — не больше сорока на леса.
  const sides: { a: P; b: P; len: number; yaw: number; f: number; r: number; along: 'f' | 'r' }[] = [
    { a: frame(s, F, -R), b: frame(s, F, R), len: 2 * R, yaw: yawR, f: F, r: 0, along: 'r' },
    { a: frame(s, -F, -R), b: frame(s, -F, R), len: 2 * R, yaw: yawR, f: -F, r: 0, along: 'r' },
    { a: frame(s, -F, R), b: frame(s, F, R), len: 2 * F, yaw: yawF, f: 0, r: R, along: 'f' },
    { a: frame(s, -F, -R), b: frame(s, F, -R), len: 2 * F, yaw: yawF, f: 0, r: -R, along: 'f' },
  ];
  const perimeter = 4 * (F + R);
  const step = low ? Infinity : Math.max(3.2, perimeter / 40);
  for (const sd of sides) {
    const n = Math.max(1, low ? 2 : Math.round(sd.len / step));
    // Углы ставят передняя и задняя стороны; боковые — только середину.
    const from = sd.along === 'r' ? 0 : 1;
    const to = sd.along === 'r' ? n : n - 1;
    for (let k = from; k <= to; k++) {
      const u = k / n;
      const p = { x: sd.a.x + (sd.b.x - sd.a.x) * u, z: sd.a.z + (sd.b.z - sd.a.z) * u };
      const g = Math.min(heightAt(p.x, p.z), ground);
      const top = ground + H;
      beams.push({ x: p.x, y: (g + top) / 2, z: p.z, a: 0.09, h: (top - g) / 2, b: 0.09, yaw: sd.yaw, col: WOOD });
    }
  }
  // Настилы: ярусы через `LEVEL`, доска шириной в зазор от стены до стоек; перила — на метр выше, по внешней линии.
  const levels: number[] = [];
  for (let y = LEVEL; y <= H - 0.4 && levels.length < (low ? 2 : 6); y += LEVEL) levels.push(y);
  const deckMid = SCAFFOLD_OFF / 2 + 0.05;
  for (const y of levels) {
    for (const sd of sides) {
      const inward = sd.along === 'r' ? { f: -Math.sign(sd.f) * deckMid, r: 0 } : { f: 0, r: -Math.sign(sd.r) * deckMid };
      const c = frame(s, sd.f + inward.f, sd.r + inward.r);
      const half = sd.len / 2;
      beams.push({ x: c.x, y: ground + y, z: c.z, a: half, h: 0.06, b: SCAFFOLD_OFF / 2 - 0.05, yaw: sd.yaw, col: PLANK });
      if (!low) {
        const o = frame(s, sd.f, sd.r);
        beams.push({ x: o.x, y: ground + y + 1, z: o.z, a: half, h: 0.04, b: 0.04, yaw: sd.yaw, col: RAIL });
      }
    }
  }
  // Мачта блока: у середины переднего фасада, выше лесов на два с половиной метра; стрела — наружу.
  if (!low) {
    const m = frame(s, F + 0.3, 0);
    const gm = heightAt(m.x, m.z);
    const top = ground + H + 2.5;
    beams.push({ x: m.x, y: (gm + top) / 2, z: m.z, a: 0.12, h: (top - gm) / 2, b: 0.12, yaw: yawF, col: STAFF });
    const arm = frame(s, F + 1.3, 0);
    beams.push({ x: arm.x, y: top - 0.2, z: arm.z, a: 1.1, h: 0.08, b: 0.08, yaw: yawF, col: STAFF });
  }
  return { beams, height: H, ground, levels };
}

/**
 * Груз на блоке в миг `t`: доля подъёма 0..1. Цикл десять секунд: четыре — вверх, две — снимают наверху, три — вниз,
 * одна — грузят внизу; разгон и торможение — плавные.
 */
export function hoistAt(t: number, phase: number): number {
  const m = ((((t + phase) % 10) + 10) % 10);
  const ease = (u: number): number => u * u * (3 - 2 * u);
  if (m < 4) return ease(m / 4);
  if (m < 6) return 1;
  if (m < 9) return 1 - ease((m - 6) / 3);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Праздник готовности.

/** Сколько длится праздник: леса уходят, вспышка, пыль, стяг на крыше — и он опускается. */
export const FEAST = 7;
/** Леса снимаются за столько секунд от конца стройки. */
export const STRIKE = 0.9;

/** Праздник в миг `age` от конца стройки: доля лесов, вспышка (размер и яркость), стяг (подъём 0..1). */
export function feastAt(age: number): { scaffold: number; flash: number; glow: number; banner: number } {
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  const e = c(age / 0.7);
  return {
    scaffold: 1 - c(age / STRIKE),
    flash: 0.4 + 0.6 * e,
    glow: age < 0.7 ? (1 - e) * (1 - e) : 0,
    banner: Math.min(c((age - 0.3) / 0.8), c((FEAST - age) / 0.8)),
  };
}

// ---------------------------------------------------------------------------------------------
// Найм: из казарм строем на площадь.

/** Площадь сбора: открытое место у колодца, куда выходит новый отряд. */
export const MUSTER_AT: P = { x: 8, z: -8 };
/** Шаг строя, м/с; шаг рядов и ширина строя. */
export const MARCH_V = 1.5;
const ROW = 1.6;
const FILE = 0.75;
/** Сколько отряд стоит на площади, прежде чем уйти обратно в казармы. */
export const MUSTER_HOLD = 16;

/**
 * Путь по графу улиц от `from` до `to`: кратчайший по длине (Дейкстра) между ближайшими к ним точками улиц, с прямыми
 * подходами в начале и в конце. Узлы — концы путей и перекрёстки (`life.junctionsOf`).
 */
export function marchRoute(paths: readonly Path[], junctions: readonly Junction[][], from: P, to: P): P[] {
  const nodes: { i: number; s: number }[] = [];
  const index = new Map<string, number>();
  const node = (i: number, s: number): number => {
    const key = `${i}:${Math.round(s * 10)}`;
    let n = index.get(key);
    if (n === undefined) {
      n = nodes.length;
      nodes.push({ i, s });
      index.set(key, n);
    }
    return n;
  };
  const per: number[][] = paths.map(() => []);
  paths.forEach((p, i) => {
    per[i].push(node(i, 0), node(i, p.len));
    for (const j of junctions[i]) per[i].push(node(i, j.s));
  });
  const near = (pt: P): { i: number; s: number } => {
    let best = { i: 0, s: 0, d: Infinity };
    paths.forEach((p, i) => {
      const n = nearestOn(p, pt);
      if (n.d < best.d) best = { i, s: n.s, d: n.d };
    });
    return best;
  };
  const a = near(from);
  const b = near(to);
  const na = node(a.i, a.s);
  const nb = node(b.i, b.s);
  per[a.i].push(na);
  per[b.i].push(nb);
  const adj: { to: number; w: number }[][] = nodes.map(() => []);
  const link = (u: number, v: number, w: number): void => {
    adj[u].push({ to: v, w });
    adj[v].push({ to: u, w });
  };
  per.forEach((list) => {
    const sorted = [...new Set(list)].sort((u, v) => nodes[u].s - nodes[v].s);
    for (let k = 1; k < sorted.length; k++) link(sorted[k - 1], sorted[k], nodes[sorted[k]].s - nodes[sorted[k - 1]].s);
  });
  junctions.forEach((list, i) =>
    list.forEach((j) => {
      const pa = at(paths[i], j.s).p;
      const ax = pa.x;
      const az = pa.z;
      const pb = at(paths[j.q], j.sq).p;
      link(node(i, j.s), node(j.q, j.sq), Math.max(0.1, Math.hypot(pb.x - ax, pb.z - az)));
    }),
  );
  // Дейкстра: узлов сотни — квадрат без кучи.
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const done = new Uint8Array(nodes.length);
  dist[na] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < nodes.length; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
    if (u < 0 || u === nb) break;
    done[u] = 1;
    for (const e of adj[u]) {
      if (dist[u] + e.w < dist[e.to]) {
        dist[e.to] = dist[u] + e.w;
        prev[e.to] = u;
      }
    }
  }
  const chain: number[] = [];
  for (let u = nb; u >= 0; u = prev[u]) chain.unshift(u);
  const pts: P[] = [{ x: from.x, z: from.z }];
  const push = (p: P): void => {
    const q = pts[pts.length - 1];
    if (Math.hypot(p.x - q.x, p.z - q.z) > 0.3) pts.push({ x: p.x, z: p.z });
  };
  for (let k = 0; k < chain.length; k++) {
    const n = nodes[chain[k]];
    const m = k > 0 ? nodes[chain[k - 1]] : null;
    if (m && m.i === n.i) {
      // По пути: вершины ломаной между местами.
      const path = paths[n.i];
      const lo = Math.min(m.s, n.s);
      const hi = Math.max(m.s, n.s);
      const inner = path.acc.map((s, idx) => ({ s, idx })).filter((v) => v.s > lo && v.s < hi);
      if (n.s < m.s) inner.reverse();
      for (const v of inner) push(path.pts[v.idx]);
    }
    const p = at(paths[n.i], n.s).p;
    push({ x: p.x, z: p.z });
  }
  push(to);
  return pts;
}

/**
 * Боец `k` отряда в миг `age` от выхода: где он на пути строя (метры от двери казарм), идёт ли и виден ли. Отряд —
 * колонной по двое: ряд за рядом выходит из двери, доходит до площади и стоит строем `MUSTER_HOLD` секунд; потом
 * поворачивает и уходит обратно — первым в казармы входит последний ряд.
 */
export function marchAt(len: number, k: number, n: number, age: number): { s: number; moving: number; back: boolean; seen: boolean } {
  const row = Math.min(k, n - 1) >> 1;
  const stop = Math.max(0, len - row * ROW);
  const out = MARCH_V * age - row * ROW;
  // Ряд встаёт на `ROW` раньше переднего — к месту приходят все разом, на `len / MARCH_V`.
  const turn = len / MARCH_V + MUSTER_HOLD;
  if (age < turn) {
    const s = Math.min(stop, out);
    return { s, moving: out > 0 && out < stop ? 1 : 0, back: false, seen: out > 0 };
  }
  const s = stop - MARCH_V * (age - turn);
  return { s: Math.max(0, s), moving: s > 0 ? 1 : 0, back: true, seen: s > 0 };
}

/** Сколько живёт выход отряда: туда, стоянка, обратно. */
export const marchLife = (len: number): number => (2 * len) / MARCH_V + MUSTER_HOLD + 1;

// ---------------------------------------------------------------------------------------------
// Пыль, вспышка, искры — точки своего шейдера: размер и прозрачность у каждой свои.

function puffMaterial(additive: boolean): THREE.PointsMaterial {
  // Точки three с затуханием по расстоянию (`size` — 1 / tan половины угла зрения, его ставит кадр: тогда размер точки —
  // в метрах), мягкое пятно — `softDot`; размер, прозрачность и цвет у каждой точки свои — атрибутами.
  const m = new THREE.PointsMaterial({ size: 3, sizeAttenuation: true, transparent: true, depthWrite: false, map: softDot() });
  m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aSize;\nattribute float aAlpha;\nattribute vec3 aCol;\nvarying float vA;\nvarying vec3 vC;\n' +
      shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = aAlpha;\nvC = aCol;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    shader.fragmentShader = 'varying float vA;\nvarying vec3 vC;\n' + shader.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vC, opacity * vA );');
  };
  m.customProgramCacheKey = () => 'city-puff';
  return m;
}

/** Точки с размером, прозрачностью и цветом у каждой: кадр пишет их заново. */
class Puffs {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private col: Float32Array;
  private n = 0;
  readonly material: THREE.PointsMaterial;

  constructor(
    private cap: number,
    additive: boolean,
    name: string,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = puffMaterial(additive);
    this.points = new THREE.Points(g, this.material);
    this.points.name = name;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, size: number, alpha: number, c: V3): void {
    if (this.n >= this.cap || alpha <= 0.004) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.col[i * 3] = c[0];
    this.col[i * 3 + 1] = c[1];
    this.col[i * 3 + 2] = c[2];
  }

  end(): void {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aCol']) (g.getAttribute(k) as THREE.BufferAttribute).needsUpdate = this.n > 0;
    this.points.visible = this.n > 0;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}

const DUST = linear(0xb9a486);
const FLASH = linear(0xffd890);
const SPARK = linear(0xffc860);

// ---------------------------------------------------------------------------------------------

/** Сколько чего отклик держит разом — по уровню качества. */
const CAP: Record<Quality, { beams: number; builders: number; soldiers: number; puffs: number; glow: number }> = {
  high: { beams: 900, builders: 4, soldiers: 16, puffs: 96, glow: 40 },
  medium: { beams: 700, builders: 3, soldiers: 12, puffs: 64, glow: 24 },
  low: { beams: 260, builders: 2, soldiers: 6, puffs: 0, glow: 4 },
};
export { CAP as DEED_CAP };

export interface DeedsInput {
  sites: readonly Site[];
  quality: Quality;
  street: { paths: readonly Path[]; junctions: readonly Junction[][] };
}

interface Works {
  type: BuildingTypeId;
  site: Site;
  beams: Beam[];
  height: number;
  ground: number;
  levels: number[];
  seed: number;
}

interface Feast {
  works: Works;
  t0: number;
}

interface Muster {
  path: Path;
  n: number;
  t0: number;
}

const WORK_DRESS = [0x6a5440, 0x7a6248, 0x5a5a4a, 0x8a6e50].map(linear);

/**
 * Отклик города: леса у строящихся построек, праздник готовности, найм строем. Экземплярами: коробки лесов и стягов —
 * один меш, строители и бойцы — по мешу фигур (программа общая с горожанами, `city-figure`), пыль и вспышки — две
 * группы точек. Пока ничего не идёт, всё скрыто — ни одного вызова.
 */
export class CityDeeds {
  readonly group = new THREE.Group();
  private beams: THREE.InstancedMesh;
  private builders: THREE.InstancedMesh;
  private soldiers: THREE.InstancedMesh;
  private builderGait: THREE.InstancedBufferAttribute;
  private soldierGait: THREE.InstancedBufferAttribute;
  private dust: Puffs | null;
  private glow: Puffs;
  private works = new Map<BuildingTypeId, Works>();
  private feasts: Feast[] = [];
  private musters: Muster[] = [];
  private cap: (typeof CAP)[Quality];
  private m4 = new THREE.Matrix4();
  private q4 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private c3 = new THREE.Color();

  constructor(private input: DeedsInput) {
    const q = input.quality;
    this.cap = CAP[q];
    const box = new THREE.BoxGeometry(2, 2, 2);
    this.beams = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), this.cap.beams);
    this.beams.name = 'city-scaffold';
    this.beams.castShadow = q === 'high';
    const mat = figureMaterial();
    // Цвет одежды, вторая ткань и кожа — до первого кадра (`life.figureMesh`): без них программа собралась бы без цвета
    // экземпляров, а капюшон и лицо вышли бы чёрными.
    this.builders = figureMesh(personGeometry(figureLod(q)), mat, this.cap.builders * 3, 'city-builders', WORK_DRESS, WORK_DRESS, 41);
    this.soldiers = figureMesh(guardGeometry(figureLod(q)), mat, this.cap.soldiers * 2, 'city-muster', [linear(0x8a2f2a)], [linear(0x9a2a24), linear(0xb08a3a)], 43);
    this.builderGait = gaitOf(this.builders);
    this.soldierGait = gaitOf(this.soldiers);
    for (let i = 0; i < this.beams.count; i++) this.beams.setColorAt(i, this.c3.setRGB(1, 1, 1));
    for (const im of [this.beams, this.builders, this.soldiers]) {
      im.frustumCulled = false;
      im.count = 0;
      im.visible = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    this.dust = this.cap.puffs > 0 ? new Puffs(this.cap.puffs, false, 'city-dust') : null;
    this.glow = new Puffs(this.cap.glow, true, 'city-flash');
    if (this.dust) this.group.add(this.dust.points);
    this.group.add(this.glow.points);
  }

  /** Постройки, у которых идёт улучшение: у каждой — леса на её главном месте. */
  setWorks(types: readonly BuildingTypeId[]): void {
    const want = new Set(types);
    for (const type of [...this.works.keys()]) if (!want.has(type)) this.works.delete(type);
    for (const type of want) {
      if (this.works.has(type)) continue;
      const w = this.worksOf(type);
      if (w) this.works.set(type, w);
    }
  }

  private worksOf(type: BuildingTypeId): Works | null {
    const site = mainSite(this.input.sites, type);
    if (!site) return null;
    const sc = scaffoldOf(site, this.input.quality);
    return { type, site, ...sc, seed: hash3(Math.round(site.x), Math.round(site.z), 41) };
  }

  /** Стройка кончилась в миг `t`: праздник у постройки — леса снимаются, вспышка, пыль, стяг. */
  done(type: BuildingTypeId, t: number): void {
    const w = this.works.get(type) ?? this.worksOf(type);
    this.works.delete(type);
    if (w) this.feasts.push({ works: w, t0: t });
  }

  /** Обучено `n` бойцов в миг `t`: выходят из казарм строем на площадь. */
  muster(n: number, t: number): void {
    if (n <= 0) return;
    const site = mainSite(this.input.sites, 'barracks');
    if (!site) return;
    const door = { x: site.x + site.fx * (site.hf + 1), z: site.z + site.fz * (site.hf + 1) };
    const pts = marchRoute(this.input.street.paths, this.input.street.junctions, door, MUSTER_AT);
    if (pts.length < 2) return;
    const path = pathOf(pts, 0, (p) => heightAt(p.x, p.z));
    this.musters.push({ path, n: Math.min(n, this.cap.soldiers), t0: t });
  }

  /** Знает ли сцена, что сейчас что-то идёт (стенду и тесту). */
  busy(): boolean {
    return this.works.size > 0 || this.feasts.length > 0 || this.musters.length > 0;
  }

  /**
   * Кадр: `t` — время сцены, `night` — 0..1, `scale` — 1 / tan половины угла зрения камеры (точкам: размер в метрах), `eye` —
   * где камера в плане: стяг праздника разворачивается полотнищем к ней (ребром он не читался бы вовсе).
   */
  update(t: number, night: number, scale: number, eye: P = { x: 0, z: 400 }): void {
    this.feasts = this.feasts.filter((f) => t - f.t0 < FEAST);
    this.musters = this.musters.filter((m) => t - m.t0 < marchLife(m.path.len));
    let nb = 0;
    let nf = 0;
    const resting = night > 0.55;
    const low = this.input.quality === 'low';
    this.dust?.begin();
    this.glow.begin();
    const beam = (b: Beam, k = 1, base = 0): void => {
      if (nb >= this.cap.beams || k <= 0.001) return;
      // Уходящие леса оседают к земле: высота и середина сжимаются к подножию.
      const y = base + (b.y - base) * k;
      this.q4.setFromAxisAngle(this.up, b.yaw);
      this.m4.compose(this.v3.set(b.x, y, b.z), this.q4, this.s3.set(b.a, b.h * k, b.b));
      this.beams.setMatrixAt(nb, this.m4);
      this.beams.setColorAt(nb, this.c3.setRGB(b.col[0], b.col[1], b.col[2]));
      nb++;
    };
    const fig = (im: THREE.InstancedMesh, gait: THREE.InstancedBufferAttribute, i: number, x: number, y: number, z: number, yaw: number, dist: number, moving: number): void => {
      this.q4.setFromAxisAngle(this.up, yaw);
      this.m4.compose(this.v3.set(x, y, z), this.q4, this.s3.set(1, 1, 1));
      im.setMatrixAt(i, this.m4);
      gait.setXY(i, dist, moving);
    };

    // Леса строящихся построек: стойки, настилы, блок с грузом, строители, пыль у подножия.
    for (const w of this.works.values()) {
      for (const b of w.beams) beam(b);
      const s = w.site;
      const F = s.hf + SCAFFOLD_OFF;
      const phase = rnd(w.seed, 1, 43) * 10;
      if (!low) {
        const lift = resting ? 0 : hoistAt(t, phase);
        const tip = frame(s, F + 2.3, 0);
        const g = heightAt(tip.x, tip.z);
        const top = w.ground + w.height + 2.3;
        const deck = w.ground + (w.levels[w.levels.length - 1] ?? 2) + 0.5;
        const cy = g + 0.45 + (deck - g) * lift;
        const yaw = Math.atan2(-s.fz, s.fx);
        beam({ x: tip.x, y: (top + cy + 0.4) / 2, z: tip.z, a: 0.025, h: Math.max(0.05, (top - cy - 0.4) / 2), b: 0.025, yaw, col: ROPE });
        beam({ x: tip.x, y: cy, z: tip.z, a: 0.4, h: 0.4, b: 0.4, yaw, col: CRATE });
        beam({ x: tip.x, y: cy + 0.48, z: tip.z, a: 0.3, h: 0.1, b: 0.25, yaw: yaw + 0.4, col: SACK });
      }
      // Строители: первый тянет верёвку у блока, остальные ходят по настилам своих сторон.
      for (let k = 0; k < this.cap.builders && nf < this.builders.instanceMatrix.count; k++) {
        if (k === 0 && !low) {
          const p = frame(s, F + 3.1, 0.9);
          const pull = resting ? 0 : Math.abs(Math.sin(t * 1.6 + phase)) * 0.12;
          fig(this.builders, this.builderGait, nf++, p.x, heightAt(p.x, p.z) - pull, p.z, Math.atan2(s.fz, -s.fx), 0, 0);
          continue;
        }
        const lv = w.levels[Math.min(w.levels.length - 1, (k - 1) % Math.max(1, w.levels.length))] ?? 0;
        const side = (k + (w.seed & 3)) % 4;
        const alongF = side >= 2;
        const half = (alongF ? s.hf : s.hr) + SCAFFOLD_OFF - 0.8;
        const out = (side % 2 === 0 ? 1 : -1) * (alongF ? s.hr + 0.6 : s.hf + 0.6);
        const pat = patrolAt(resting ? 0 : t, 0.55, Math.max(0.2, half), 3 + k, rnd(w.seed, k, 44));
        const u = resting ? (rnd(w.seed, k, 45) - 0.5) * half : pat.s;
        const p = alongF ? frame(s, u, out) : frame(s, out, u);
        const dirYaw = alongF ? Math.atan2(-s.fz, s.fx) : Math.atan2(s.fx, s.fz);
        fig(this.builders, this.builderGait, nf++, p.x, w.ground + lv + 0.06, p.z, dirYaw + (pat.dir < 0 ? Math.PI : 0), resting ? 0 : pat.dist, resting ? 0 : pat.moving);
      }
      // Пыль у подножия: клубы по кругу, каждый — дробная часть времени со своим сдвигом.
      if (this.dust && !resting) {
        for (let k = 0; k < 6; k++) {
          const a = (((t / 3.2 + k / 6 + rnd(w.seed, k, 46)) % 1) + 1) % 1;
          const ang = rnd(w.seed, k, 47) * Math.PI * 2;
          const p = frame(s, Math.cos(ang) * (F + 0.6), Math.sin(ang) * (s.hr + SCAFFOLD_OFF + 0.6));
          this.dust.add(p.x + a * 0.8, heightAt(p.x, p.z) + 0.3 + a * 2.2, p.z, 1.2 + a * 2.4, Math.sin(Math.PI * a) * 0.32, DUST);
        }
      }
    }

    // Праздник готовности.
    for (const f of this.feasts) {
      const age = t - f.t0;
      const st = feastAt(age);
      const w = f.works;
      const s = w.site;
      if (!low) for (const b of w.beams) beam(b, st.scaffold, w.ground);
      const r = Math.max(s.hf, s.hr) + SCAFFOLD_OFF;
      // Вспышка — над крышей: внутри постройки её закрыла бы сама постройка.
      const cy = s.y1 + Math.min(6, r * 0.35);
      if (st.glow > 0) this.glow.add(s.x, cy, s.z, r * 3.2 * st.flash, st.glow, FLASH);
      // Искры — золотые точки вьются вверх вокруг постройки; пыль — кольцом от подножия.
      if (!low && age < 2.4) {
        for (let k = 0; k < 10; k++) {
          const u = Math.min(1, Math.max(0, (age - 0.15 - k * 0.06) / 1.8));
          if (u <= 0 || u >= 1) continue;
          const ang = k * 2.4 + u * 3;
          this.glow.add(s.x + Math.cos(ang) * r * (0.6 + u * 0.3), s.y1 - 2 + u * 10, s.z + Math.sin(ang) * r * (0.6 + u * 0.3), 1.4, (1 - u) * 0.9, SPARK);
        }
      }
      if (this.dust && age < 2.6) {
        for (let k = 0; k < 16; k++) {
          const u = Math.min(1, age / 2.6);
          const ang = (k / 16) * Math.PI * 2;
          const d = r * (0.9 + u * 0.7);
          const x = s.x + Math.cos(ang) * d;
          const z = s.z + Math.sin(ang) * d;
          this.dust.add(x, heightAt(x, z) + 0.4 + u * 2.5, z, 2 + u * 4, (1 - u) * 0.45, DUST);
        }
      }
      // Стяг на крыше: древко поднимается, полотнище — красное с золотым поясом, разворачивается к камере и вьётся.
      if (st.banner > 0) {
        const top = s.y1 + 0.2;
        const hgt = 5.5 * st.banner;
        const sway = Math.sin(t * 3.1 + s.x) * 0.3;
        // Полотнище вдоль своей оси x — поперёк взгляда: «вправо» от направления камеры на стяг.
        const yaw = Math.atan2(-(s.x - eye.x), -(s.z - eye.z)) + sway;
        beam({ x: s.x, y: top + hgt / 2, z: s.z, a: 0.11, h: Math.max(0.01, hgt / 2), b: 0.11, yaw, col: STAFF });
        if (st.banner > 0.6) {
          const k = (st.banner - 0.6) / 0.4;
          const cx = s.x + Math.cos(yaw) * 1.6 * k;
          const cz = s.z - Math.sin(yaw) * 1.6 * k;
          beam({ x: cx, y: top + hgt - 1, z: cz, a: 1.6 * k, h: 0.95, b: 0.05, yaw, col: BANNER });
          beam({ x: cx, y: top + hgt - 1, z: cz, a: 1.6 * k, h: 0.16, b: 0.07, yaw, col: GOLD });
        }
      }
    }

    // Найм: колонна по двое из двери казарм на площадь, стоянка строем, обратно.
    let ns = 0;
    for (const m of this.musters) {
      const age = t - m.t0;
      for (let k = 0; k < m.n && ns < this.soldiers.instanceMatrix.count; k++) {
        const st = marchAt(m.path.len, k, m.n, age);
        if (!st.seen) continue;
        const { tx, tz } = tangentAt(m.path, st.s);
        const p = at(m.path, st.s).p;
        const px = p.x;
        const pz = p.z;
        const side = (k & 1 ? 1 : -1) * FILE;
        const x = px - tz * side;
        const z = pz + tx * side;
        const go = st.back ? -1 : 1;
        fig(this.soldiers, this.soldierGait, ns++, x, heightOnPath(m.path, st.s), z, Math.atan2(-tz * go, tx * go), st.back ? 2 * m.path.len - st.s : st.s, st.moving);
      }
    }

    this.beams.count = nb;
    this.beams.visible = nb > 0;
    this.beams.instanceMatrix.needsUpdate = nb > 0;
    if (this.beams.instanceColor && nb > 0) this.beams.instanceColor.needsUpdate = true;
    this.builders.count = nf;
    this.builders.visible = nf > 0;
    this.builders.instanceMatrix.needsUpdate = nf > 0;
    this.builderGait.needsUpdate = nf > 0;
    this.soldiers.count = ns;
    this.soldiers.visible = ns > 0;
    this.soldiers.instanceMatrix.needsUpdate = ns > 0;
    this.soldierGait.needsUpdate = ns > 0;
    if (this.dust) {
      this.dust.material.size = scale;
      this.dust.end();
    }
    this.glow.material.size = scale;
    this.glow.end();
  }

  dispose(): void {
    this.beams.geometry.dispose();
    (this.beams.material as THREE.Material).dispose();
    this.builders.geometry.dispose();
    this.soldiers.geometry.dispose();
    (this.builders.material as THREE.Material).dispose();
    this.dust?.dispose();
    this.glow.dispose();
  }
}

export { CityPops, YieldTally, type Pop, type Yard } from './pops';
export { SiteTags } from './tags';
