// Камень и дерево места боя ролика TW: стена с боевым ходом и зубцами, надвратная башня с проездом, башни, дома города,
// колодец на площади; шатры, рогатки и костры лагеря; частокол и шалаши логова (docs/battle_tw.md, раздел 13).
//
// Всё — из набора города (`city/geom.ts`, `city/kit.ts`, `city/forts.ts`): те же кирпичики, та же палитра, в метрах,
// масштабом `CITY_M` к бойцу. Своих моделей нет, кроме того, чего у набора нет: проезда ворот и створок, лестницы,
// тарана, шатра. Город рисует их со слоями текстур (`city/material.ts`, 23 слоя), ролику они не по карману (текстура —
// мегабайты): здесь цвет слоя — его средний тон из палитры города, запечённый в вершины, материал — один Ламберт,
// как у земли поля. Неподвижное — одним мешем (вызов и тень); лестницы, таран и створки — своими, по кадру режиссуры.
import * as THREE from 'three';
import { CITY } from '../city/palette';
import { Builder, box, cone, cylinder, flat, pyramid, tint, type V3 } from '../city/geom';
import { house, log, type Detail } from '../city/kit';
import { hipRoof, tower } from '../city/forts';
import { LAYERS } from '../city/tex';
import type { Quality } from '../quality';
import {
  CITY_M,
  GATEHOUSE,
  GATEHOUSE_H,
  GATE_ARCH,
  LADDER_FOOT,
  PARAPET,
  gateOpen,
  gateShake,
  ladderUp,
  outOf,
  ramSwing,
  type TwWall,
} from './site';
import { unitPose, type TwPlan } from './plan';
import { BREACH_BAND, breachColumns } from './barrage';
import { heightAt } from '../reel/terrain';

/** Средний тон слоя набора города (sRGB): то, во что слой красит тон вершины, если смотреть издали. */
const LAYER_TONE: Record<(typeof LAYERS)[number], number> = {
  ashlar: CITY.limestone,
  rubble: CITY.rubbleGrey,
  plaster: CITY.plaster,
  timberA: 0xc2b297,
  timberB: 0xb9a78b,
  timberC: 0xbfae93,
  stoneWin: 0xa99a80,
  groundDoor: 0xa4937a,
  roofTile: CITY.tile,
  roofSlate: CITY.slate,
  wood: CITY.oakLight,
  cobble: CITY.cobble,
  dirt: CITY.dirt,
  grass: CITY.grass,
  foliage: CITY.leaf,
  rock: CITY.rock,
  churchWin: 0x9c8f78,
  field: CITY.crop,
  towerSlit: 0xb3a386,
  gateArch: 0x9a8c72,
  arcade: 0xa99a80,
  cloth: 0xd8cdb4,
  cut: CITY.limestone,
};
const TONES = LAYERS.map((n) => new THREE.Color(LAYER_TONE[n]));

const DETAIL: Record<Quality, Detail> = { low: 0, medium: 1, high: 2 };

/** Строитель → геометрия сцены: метры набора в единицы ролика, тон вершины × тон слоя. Её же берут машины обстрела. */
export function geometryOf(b: Builder): THREE.BufferGeometry {
  const n = b.vertexCount;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = b.pos[i * 3] * CITY_M;
    pos[i * 3 + 1] = b.pos[i * 3 + 1] * CITY_M;
    pos[i * 3 + 2] = b.pos[i * 3 + 2] * CITY_M;
    const tone = TONES[b.cfg[i * 4] | 0] ?? TONES[0];
    col[i * 3] = b.col[i * 3] * tone.r;
    col[i * 3 + 1] = b.col[i * 3 + 1] * tone.g;
    col[i * 3 + 2] = b.col[i * 3 + 2] * tone.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/** Метры набора от единиц ролика. */
export const m = (u: number): number => u / CITY_M;

/** Шаг зубцов парапета, единицы набора. */
export const MERLON_STEP = 1.55;
/** Осадную башню подкатывают к стене за столько секунд до сшибки. */
const TOWER_ROLL = 3;
/** Несомая лестница клонится вперёд на столько (рад): стоймя её несут над строем. */
const CARRY_TILT = 0.22;

/** Прямой пролёт стены по X (метры): тело до боевого хода, деревянный настил, парапет с зубцами снаружи. */
export function wallRun(b: Builder, w: TwWall, x0: number, x1: number, avoid: (x: number) => boolean): void {
  if (x1 - x0 < 0.2) return;
  const s = w.inward;
  const out = -s;
  const zo = m(w.z);
  const thick = m(w.thick);
  const base = m(w.base);
  const top = base + m(w.top);
  const T = tint(CITY.stoneTints[0]);
  const Tdark = tint(CITY.stoneTints[0], 0.86);
  const cx = (x0 + x1) / 2;
  const len = x1 - x0;
  const czBody = zo + s * (thick / 2);
  box(b, cx, czBody, 0, out, len, thick, base - 1.6, top, 'ashlar', T, null, { aoBottom: 0.72, grimeBottom: 0.9 });
  // Настил хода — дерево, от внутренней кромки до парапета.
  const par = m(PARAPET);
  const zIn = zo + s * thick;
  const zPar = zo + s * par;
  const walk: [number, number][] =
    s < 0
      ? [
          [x0, zPar],
          [x1, zPar],
          [x1, zIn],
          [x0, zIn],
        ]
      : [
          [x0, zIn],
          [x1, zIn],
          [x1, zPar],
          [x0, zPar],
        ];
  flat(b, walk, top, 'wood', tint(CITY.timberGrey, 1.1), true, 0.9);
  // Парапет снаружи и зубцы на нём.
  box(b, cx, zo + s * (par / 2), 0, out, len, par, top, top + 1.05, 'ashlar', Tdark, 'ashlar');
  for (let x = x0 + MERLON_STEP / 2; x < x1; x += MERLON_STEP) {
    if (avoid(x)) continue;
    box(b, x, zo + s * (par / 2), 0, out, 0.85, par, top + 1.05, top + 2.0, 'ashlar', T, 'ashlar');
  }
}

/**
 * Пролёт пролома (обстрел перед штурмом, `barrage.ts`): внутренняя половина стены цела и держит ход — защитники стоят на
 * нём, как стояли; наружная — опущена клином по столбцам пролома (`breachColumns`), без парапета и зубцов. До обвала её
 * закрывают целые куски (`siegeworks.ts`) — те же столбцы сверху.
 */
function breachRun(b: Builder, w: TwWall, x0: number, x1: number, cols: { x0: number; x1: number; drop: number }[]): void {
  if (x1 - x0 < 0.05) return;
  const s = w.inward;
  const out = -s;
  const zo = m(w.z);
  const thick = m(w.thick);
  const base = m(w.base);
  const top = base + m(w.top);
  const T = tint(CITY.stoneTints[0]);
  const Tbroken = tint(CITY.stoneTints[1], 0.92);
  const cx = (x0 + x1) / 2;
  const len = x1 - x0;
  const band = m(BREACH_BAND);
  box(b, cx, zo + s * (band + (thick - band) / 2), 0, out, len, thick - band, base - 1.6, top, 'ashlar', T, null, { aoBottom: 0.72, grimeBottom: 0.9 });
  for (const c of cols) {
    const a = Math.max(x0, m(c.x0));
    const e = Math.min(x1, m(c.x1));
    if (e - a < 0.02) continue;
    box(b, (a + e) / 2, zo + s * (band / 2), 0, out, e - a, band, base - 1.6, top - m(c.drop), 'ashlar', T, 'rubble', { aoBottom: 0.72 });
    // Излом кладки — светлее и грубее над срезом: свежий камень на грани уцелевшей кладки.
    box(b, (a + e) / 2, zo + s * (band + 0.04), 0, out, e - a, 0.1, top - m(c.drop), top - 0.05, 'rubble', Tbroken, null);
  }
  const mid = zo + s * band;
  const zIn = zo + s * thick;
  const walk: [number, number][] =
    s < 0
      ? [
          [x0, mid],
          [x1, mid],
          [x1, zIn],
          [x0, zIn],
        ]
      : [
          [x0, zIn],
          [x1, zIn],
          [x1, mid],
          [x0, mid],
        ];
  flat(b, walk, top, 'wood', tint(CITY.timberGrey, 1.1), true, 0.9);
}

/** Надвратная башня с проездом: два устоя, свод над проездом, верх с поясом и шатром (как надвратная набора). */
function gatehouse(b: Builder, w: TwWall, detail: Detail): void {
  const s = w.inward;
  const out = -s;
  const size = m(GATEHOUSE);
  const half = m(w.gateHalf);
  const cx = m(w.gateX);
  const cz = m(w.z) + s * (m(w.thick) / 2);
  const base = m(w.base);
  const arch = base + m(GATE_ARCH);
  const topY = base + m(GATEHOUSE_H);
  const T = tint(CITY.stoneTints[0], 0.98);
  const pier = size / 2 - half;
  for (const side of [1, -1]) {
    box(b, cx + side * (half + pier / 2), cz, 0, out, pier, size, base - 1.6, arch, 'ashlar', T, null, { aoBottom: 0.7, grimeBottom: 0.9 });
  }
  // Над проездом — верхний ярус целиком; снизу — свод проезда.
  box(b, cx, cz, 0, out, size, size, arch, topY, 'towerSlit', T, null, { vBase: arch, aoBottom: 0.85 });
  flat(b, [
    [cx - half, cz - size / 2],
    [cx + half, cz - size / 2],
    [cx + half, cz + size / 2],
    [cx - half, cz + size / 2],
  ], arch, 'wood', tint(CITY.oak, 0.6), false, 0.5);
  box(b, cx, cz, 0, out, size + 0.5, size + 0.5, topY, topY + 0.6, 'ashlar', T, 'ashlar', { aoBottom: 0.55 });
  hipRoof(b, cx, cz, 0, out, size + 1.2, size + 1.2, topY + 0.55, 56, 'roofTile', tint(CITY.roofTints[1]));
  if (detail > 0) {
    // Угловые башенки по наружным углам, как у надвратной набора.
    for (const c of [1, -1]) {
      const x = cx + c * (size / 2);
      const z = cz + out * (size / 2);
      cylinder(b, x, z, 1.15, topY - 5, topY + 1.2, 10, 'ashlar', T, { aoBottom: 0.55 });
      cone(b, x, z, 1.4, topY + 1.1, topY + 4.7, 10, 'roofTile', tint(CITY.roofTints[1]));
    }
  }
}

/** Шатёр лагеря (полотно на шесте) или шалаш логова (шкуры на жердях). */
function tent(b: Builder, x: number, z: number, yaw: number, size: number, hide: boolean, seed: number, y: number): void {
  const r = m(size);
  const sides = hide ? 7 : 6;
  const pts: [number, number][] = [];
  for (let k = 0; k < sides; k++) {
    const a = yaw + (k / sides) * Math.PI * 2;
    pts.push([m(x) + Math.cos(a) * r, m(z) + Math.sin(a) * r]);
  }
  const h = hide ? r * 1.25 : r * 1.55;
  const cloth = hide ? tint(0x7a5c40, 0.95 + (seed % 7) * 0.02) : tint(seed % 3 === 0 ? 0xe6dcc4 : seed % 3 === 1 ? 0xd8c8a4 : 0xc9b48c);
  // Стенки шатра — низкий барабан, верх — конус до шеста; у шалаша — сразу конус от земли.
  if (!hide) {
    for (let k = 0; k < sides; k++) {
      const a = pts[k];
      const e = pts[(k + 1) % sides];
      b.quad([e[0], y, e[1]], [a[0], y, a[1]], [a[0], y + 0.9, a[1]], [e[0], y + 0.9, e[1]], [0, 0, 1, 0, 1, 1, 0, 1], LAYERS.indexOf('cloth'), cloth, [0.8, 0.8, 1, 1]);
    }
    // Конус набора обходит основание по часовой сверху — нормали наружу.
    pyramid(b, [...pts].reverse(), y + 0.9, [m(x), y + 0.9 + h, m(z)], 'cloth', cloth, 0.9);
  } else {
    pyramid(b, [...pts].reverse(), y, [m(x), y + h, m(z)], 'cloth', cloth, 0.75);
    // Жерди торчат над шалашом.
    for (let k = 0; k < 3; k++) {
      const a = yaw + k * 2.1;
      log(b, [m(x) + Math.cos(a) * 0.15, y + h - 0.2, m(z) + Math.sin(a) * 0.15], [m(x) + Math.cos(a) * 0.5, y + h + 0.6, m(z) + Math.sin(a) * 0.5], 0.05, tint(CITY.oak), 4, false);
    }
  }
}

export interface FortView {
  group: THREE.Group;
  /** Треугольников неподвижного (тень — тот же меш ещё раз). */
  triangles: number;
  update(t: number): void;
  dispose(): void;
}

/** Построить место боя. Нет места — пустая группа. */
export function buildFort(plan: TwPlan, quality: Quality): FortView {
  const group = new THREE.Group();
  group.name = 'tw-fort';
  const site = plan.site;
  const disposables: { dispose(): void }[] = [];
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.name = 'tw-fort';
  disposables.push(mat);
  if (!site) return { group, triangles: 0, update: () => {}, dispose: () => disposables.forEach((d) => d.dispose()) };
  const detail = DETAIL[quality];
  const f = plan.field;
  const b = new Builder();
  const w = site.wall;
  if (w) {
    // Пролёты стены между башнями и надвратной; концы стены уходят углом назад, к городу.
    const stops: [number, number][] = [[m(w.gateX) - m(GATEHOUSE) / 2, m(w.gateX) + m(GATEHOUSE) / 2]];
    for (const t of w.towers) stops.push([m(t.x) - m(t.size) / 2 + 0.3, m(t.x) + m(t.size) / 2 - 0.3]);
    stops.sort((a, c) => a[0] - c[0]);
    // Пролом обстрела (`plan.barrage`): пролёт стены над ним строится опущенным снаружи (`breachRun`).
    const br = plan.barrage?.breach ?? null;
    const ba = br ? m(br.x - br.width / 2) : Infinity;
    const bb = br ? m(br.x + br.width / 2) : -Infinity;
    const cols = br ? breachColumns(br, plan.cast.seed) : [];
    const nearTower = (x: number): boolean => stops.some(([a, c]) => x > a - 0.9 && x < c + 0.9) || (x > ba - 0.4 && x < bb + 0.4);
    const run = (x0: number, x1: number): void => {
      if (!br || x1 <= ba || x0 >= bb) return wallRun(b, w, x0, x1, nearTower);
      if (x0 < ba) wallRun(b, w, x0, ba, nearTower);
      breachRun(b, w, Math.max(x0, ba), Math.min(x1, bb), cols);
      if (x1 > bb) wallRun(b, w, bb, x1, nearTower);
    };
    let x = -m(w.halfX);
    for (const [a, c] of stops) {
      if (a > x) run(x, Math.min(a, m(w.halfX)));
      x = Math.max(x, c);
    }
    if (x < m(w.halfX)) run(x, m(w.halfX));
    // Угол: стена у концов уходит внутрь, к городу (кольцо стены, а не забор).
    const s = w.inward;
    for (const e of [1, -1]) {
      const cx = e * m(w.halfX - w.thick / 2);
      const len = m(18);
      const T = tint(CITY.stoneTints[0], 0.95);
      box(b, cx, m(w.z) + s * (m(w.thick) + len / 2), e, 0, len, m(w.thick), m(w.base) - 1.6, m(w.base + w.top) + 1.05, 'ashlar', T, 'ashlar', { aoBottom: 0.72 });
    }
    gatehouse(b, w, detail);
    for (const t of w.towers) {
      tower(
        b,
        {
          kind: t.round ? 'round' : 'square',
          x: m(t.x),
          z: m(w.z) + s * (m(w.thick) / 2) - s * 1.2,
          out: Math.atan2(-s, 0),
          size: m(t.size),
          height: m(t.h),
          base: m(w.base),
          seed: t.seed,
        },
        detail,
      );
    }
    for (const h of site.houses) {
      const floor = m(heightAt(f, h.x, h.z));
      house(
        b,
        {
          x: m(h.x),
          z: m(h.z),
          fx: Math.sin(h.yaw),
          fz: Math.cos(h.yaw),
          w: m(h.w),
          d: m(h.d),
          floors: h.floors,
          style: h.seed % 5 === 0 ? 'stone' : h.seed % 5 === 1 ? 'plaster' : 'timber',
          frame: h.seed % 3,
          gable: h.seed % 2 === 0,
          roof: h.seed % 4 === 0 ? 'slate' : 'tile',
          // Уклон — в радианах, как у набора (`layout.ts`: 48–60°).
          pitch: ((50 + (h.seed % 9)) * Math.PI) / 180,
          jetty: 0.3 + (h.seed % 5) * 0.05,
          floor,
          low: floor - 0.3,
          wallTint: h.seed % CITY.wallTints.length,
          roofTint: (h.seed >> 2) % CITY.roofTints.length,
          seed: h.seed,
          rich: (h.seed % 10) / 10,
        },
        detail,
      );
    }
    const sq = site.square;
    if (sq) {
      // Колодец посреди площади.
      const y = m(heightAt(f, sq.x, sq.z));
      cylinder(b, m(sq.x), m(sq.z), 1.1, y - 0.2, y + 0.9, 10, 'rubble', tint(CITY.stoneTints[1]));
      for (const c of [1, -1]) box(b, m(sq.x) + c * 1.0, m(sq.z), 0, 1, 0.16, 0.16, y + 0.9, y + 2.6, 'wood', tint(CITY.oak), null);
      cone(b, m(sq.x), m(sq.z), 1.5, y + 2.5, y + 3.4, 6, 'roofTile', tint(CITY.roofTints[3]));
    }
  }
  const c = site.camp;
  if (c) {
    for (const t of c.tents) tent(b, t.x, t.z, t.yaw, t.size, t.hide, t.seed, m(heightAt(f, t.x, t.z)));
    for (const s of c.stakes) {
      // Рогатка: два заострённых бревна крестом, концами к полю.
      const y = m(heightAt(f, s.x, s.z));
      const ca = Math.cos(s.yaw);
      const sa = Math.sin(s.yaw);
      for (const k of [1, -1]) {
        const a: V3 = [m(s.x) - ca * 0.9 * k, y - 0.1, m(s.z) + sa * 0.9 * k];
        const e: V3 = [m(s.x) + ca * 0.9 * k, y + 1.5, m(s.z) - sa * 0.9 * k];
        log(b, a, e, 0.09, tint(CITY.oak, 0.95), 5, false);
      }
    }
    for (const fi of c.fires) {
      const y = m(heightAt(f, fi.x, fi.z));
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1;
        log(b, [m(fi.x) + Math.cos(a) * 0.5, y, m(fi.z) + Math.sin(a) * 0.5], [m(fi.x), y + 0.45, m(fi.z)], 0.08, tint(CITY.oak, 0.6), 4, false);
      }
      // Огонь — тёплый конус без света: лампа на сцене одна (docs/handbook/graphics.md).
      cone(b, m(fi.x), m(fi.z), 0.35, y + 0.05, y + 0.95, 5, 'cloth', tint(0xf0a040, 1.5), 1);
      for (let k = 0; k < 6; k++) {
        const a = k * 1.05;
        box(b, m(fi.x) + Math.cos(a) * 0.75, m(fi.z) + Math.sin(a) * 0.75, 1, 0, 0.32, 0.22, y - 0.05, y + 0.14, 'rock', tint(CITY.rockDark), 'rock');
      }
    }
    for (const p of c.palisade) {
      const y = m(heightAt(f, p.x, p.z));
      const h = 2.3 + ((p.x * 7.3 + p.z * 3.1) % 1 + 1) % 1 * 0.6;
      log(b, [m(p.x), y - 0.3, m(p.z)], [m(p.x), y + h, m(p.z)], 0.16, tint(CITY.oak, 0.85 + (((p.x * 13.7) % 1) + 1) % 1 * 0.2), 5, true);
    }
  }
  const geo = geometryOf(b);
  disposables.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'tw-fort-static';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const triangles = b.triangleCount;

  // ---- лестницы ----
  let ladders: THREE.InstancedMesh | null = null;
  if (w && site.ladders.length) {
    const lb = new Builder();
    const len = m(Math.hypot(w.top + 0.4, LADDER_FOOT));
    const T = tint(CITY.oakLight, 1.05);
    for (const side of [1, -1]) box(lb, side * 0.28, 0, 0, 1, 0.09, 0.09, 0, len, 'wood', T, 'wood');
    const rung = detail === 0 ? 0.7 : 0.42;
    for (let y = 0.35; y < len - 0.1; y += rung) box(lb, 0, 0, 0, 1, 0.6, 0.06, y, y + 0.06, 'wood', T, null);
    const lg = geometryOf(lb);
    disposables.push(lg);
    ladders = new THREE.InstancedMesh(lg, mat, site.ladders.length);
    ladders.name = 'tw-ladders';
    ladders.castShadow = true;
    ladders.frustumCulled = false;
    group.add(ladders);
    disposables.push(ladders);
  }

  // ---- осадная башня ----
  // Своей модели у набора нет: сруб из брёвен на колёсах, обшитый досками и сырыми шкурами, с площадкой вровень с боевым
  // ходом и откидным мостом. Перед — у z = 0 (к стене), тело — наружу (+z), как у тарана.
  let siege: THREE.Mesh | null = null;
  if (w && site.tower) {
    const tb = new Builder();
    const T = tint(CITY.oak, 0.9);
    const H = m(w.top) + 2.6;
    const half = 2.2;
    for (const [px, pz] of [[-half, 0.3], [half, 0.3], [-half, 4.4], [half, 4.4]] as const) box(tb, px, pz, 0, 1, 0.34, 0.34, 0, H, 'wood', T, 'wood');
    // Обшивка с трёх сторон: бока и зад; перед открыт на верхнем ярусе — мост.
    for (const side of [1, -1]) box(tb, side * half, 2.35, 1, 0, 4.1, 0.16, 0.5, H - 0.3, 'wood', tint(CITY.oak, 0.75), null);
    box(tb, 0, 4.4, 0, 1, 2 * half, 0.16, 0.5, H - 0.3, 'wood', tint(CITY.oak, 0.75), null);
    box(tb, 0, 0.3, 0, 1, 2 * half, 0.16, 0.5, m(w.top) - 0.6, 'wood', tint(CITY.oak, 0.75), null);
    // Шкуры по верху и площадка вровень с ходом.
    box(tb, 0, 2.35, 0, 1, 2 * half + 0.2, 4.4, H - 0.3, H, 'cloth', tint(0x8a7656), 'cloth');
    box(tb, 0, 2.35, 0, 1, 2 * half, 4.1, m(w.top) - 0.15, m(w.top) + 0.05, 'wood', T, 'wood');
    // Мост: опущен на стену, доски на 2 м вперёд.
    box(tb, 0, -1.0, 0, 1, 2.2, 2.2, m(w.top) - 0.1, m(w.top) + 0.05, 'wood', tint(CITY.oakLight, 1.0), 'wood');
    for (const side of [1, -1]) for (const zz of [0.9, 3.8]) box(tb, side * (half + 0.15), zz, 1, 0, 1.2, 0.2, 0, 1.2, 'wood', tint(CITY.oak, 0.7), 'wood');
    const sg = geometryOf(tb);
    disposables.push(sg);
    siege = new THREE.Mesh(sg, mat);
    siege.name = 'tw-siege-tower';
    siege.castShadow = true;
    group.add(siege);
  }

  // ---- таран ----
  let ram: THREE.Mesh | null = null;
  if (w && site.ram) {
    const rb = new Builder();
    const T = tint(CITY.oak, 0.95);
    // Бревно с окованной головой, на раме под двускатной крышей, на колёсах. Голова — у z = 0, тело — наружу (+z).
    log(rb, [0, 1.1, 0.2], [0, 1.1, 7.2], 0.32, T, 8, true);
    box(rb, 0, 0.35, 0, 1, 0.75, 0.8, 0.75, 1.45, 'rubble', tint(CITY.iron, 1.4), 'rubble');
    for (const side of [1, -1]) {
      box(rb, side * 1.0, 3.9, 0, 1, 0.16, 6.4, 0.4, 2.3, 'wood', tint(CITY.oak, 0.8), null);
      // Колёса — сплошные диски из досок.
      for (const zz of [1.6, 6.0]) box(rb, side * 1.15, zz, 1, 0, 1.1, 0.18, 0.0, 1.1, 'wood', tint(CITY.oak, 0.7), 'wood');
    }
    const rt = tint(0x8a7656);
    const ridge = 3.0;
    // Скаты крыши — против часовой снаружи (нормаль вверх-наружу): шкуры на жердях.
    rb.quad([-1.4, 2.2, 0.8], [-1.4, 2.2, 7.2], [0, ridge, 7.2], [0, ridge, 0.8], [0, 0, 1, 0, 1, 1, 0, 1], LAYERS.indexOf('cloth'), rt, [0.85, 0.85, 1, 1]);
    rb.quad([1.4, 2.2, 7.2], [1.4, 2.2, 0.8], [0, ridge, 0.8], [0, ridge, 7.2], [0, 0, 1, 0, 1, 1, 0, 1], LAYERS.indexOf('cloth'), rt, [0.85, 0.85, 1, 1]);
    const rg = geometryOf(rb);
    disposables.push(rg);
    ram = new THREE.Mesh(rg, mat);
    ram.name = 'tw-ram';
    ram.castShadow = true;
    group.add(ram);
  }

  // ---- створки ворот ----
  let leaves: THREE.InstancedMesh | null = null;
  if (w) {
    const gb = new Builder();
    const half = m(w.gateHalf);
    const h = m(GATE_ARCH) - 0.2;
    // Створка от петли (x = 0) к середине проезда (x = half): доски и две оковки.
    box(gb, half / 2, 0, 0, 1, half, 0.22, 0, h, 'wood', tint(CITY.oak, 0.9), 'wood');
    for (const yy of [0.25, 0.68]) box(gb, half / 2, 0, 0, 1, half, 0.26, h * yy, h * yy + 0.16, 'rubble', tint(CITY.iron, 1.5), null);
    const gg = geometryOf(gb);
    disposables.push(gg);
    leaves = new THREE.InstancedMesh(gg, mat, 2);
    leaves.name = 'tw-gate';
    leaves.castShadow = true;
    leaves.frustumCulled = false;
    group.add(leaves);
    disposables.push(leaves);
  }

  const M4 = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const V = new THREE.Vector3();
  const S1 = new THREE.Vector3(1, 1, 1);
  const update = (t: number): void => {
    if (!w) return;
    const s = w.inward;
    if (ladders) {
      site.ladders.forEach((l, k) => {
        // Лестница осадной башни — внутри сруба: её не несут и не видно.
        if (l.tower) {
          ladders!.setMatrixAt(k, M4.makeScale(0, 0, 0));
          return;
        }
        const u = plan.units[l.unit];
        const pose = unitPose(plan, u, Math.min(t, u.fleeAt ?? t));
        // Несут к стене стоймя перед строем, чуть наклонив вперёд; у стены — опускают верхом на боевой ход.
        const up = ladderUp(l, t);
        const carried = Math.max(LADDER_FOOT, outOf(w, pose.z) + 0.9);
        const foot = carried + (LADDER_FOOT - carried) * up;
        const lean = Math.atan2(LADDER_FOOT, w.top + 0.4);
        const tilt = CARRY_TILT * (1 - up) + lean * up;
        const fz = w.z - s * foot;
        const y = heightAt(f, l.x, fz) + 0.5 * (1 - up);
        // Лестница растёт по +Y; верх клонится к стене (внутрь): поворот вокруг X.
        E.set(s * tilt, 0, 0);
        Q.setFromEuler(E);
        V.set(l.x, y, fz);
        ladders!.setMatrixAt(k, M4.compose(V, Q, S1));
      });
      ladders.instanceMatrix.needsUpdate = true;
    }
    if (siege && site.tower) {
      // Башню катят перед строем и к сшибке ставят мостом на боевой ход; отряд дрогнул — она остаётся, где стояла.
      const u = plan.units[site.tower.unit];
      const pose = unitPose(plan, u, Math.min(t, u.fleeAt ?? t, site.tower.at));
      const roll = Math.min(1, Math.max(0, (t - (site.tower.at - TOWER_ROLL)) / TOWER_ROLL));
      const far = Math.max(1.4, outOf(w, pose.z) + 1.2);
      const front = far + (0.15 - far) * roll;
      const z = w.z - s * front;
      V.set(site.tower.x, heightAt(f, site.tower.x, z), z);
      siege.position.copy(V);
      siege.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? Math.PI : 0);
    }
    if (ram && site.ram) {
      const u = plan.units[site.ram.unit];
      const until = Math.min(t, u.fleeAt ?? Infinity, w.gateAt !== null && w.gateAt > 0 ? w.gateAt + 0.3 : Infinity);
      const pose = unitPose(plan, u, until);
      const swing = t <= until ? ramSwing(site.ram, t) : 0;
      // Удар доходит до створок (они в проезде, на 0.45 за наружной гранью).
      const head = Math.max(-0.4, Math.max(0.3, outOf(w, pose.z) - 0.8) - swing * 0.75);
      const z = w.z - s * head;
      V.set(site.ram.x, heightAt(f, site.ram.x, z), z);
      // Тело тарана — наружу от головы: поворот на π, если город у +Z.
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? Math.PI : 0);
      ram.position.copy(V);
      ram.quaternion.copy(Q);
    }
    if (leaves) {
      const open = gateOpen(w, t);
      const shake = gateShake(site.ram, t) * 0.05;
      const zH = w.z + s * 0.45;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        // Петля — у края проезда; закрытая створка смотрит к середине, открытая — повёрнута внутрь.
        const hingeX = w.gateX + side * w.gateHalf;
        const ang = open * (k === 0 ? 1.45 : 1.25) + shake;
        const yaw = (side > 0 ? Math.PI : 0) + side * s * ang;
        Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        V.set(hingeX, w.base, zH);
        leaves.setMatrixAt(k, M4.compose(V, Q, S1));
      }
      leaves.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  return {
    group,
    triangles,
    update,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
