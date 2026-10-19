// Вид из окна покоев (docs/city_v3.md, Г-7): город за окном целый. Дыра в кадре — это луч из глаза, который первой
// задевает изнанку грани: лицевые грани города смотрят наружу, изнанку видеокарта отбрасывает, и сквозь неё видно то, что
// за постройкой (храм без восточного щипца просвечивал насквозь). Тест бросает лучи из глаза покоев сквозь проёмы окон в
// меш зданий и землю города — первая задетая грань у каждого луча должна смотреть к глазу.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cityPlan, heightAt } from '../city/layout';
import { FEAST_AT } from '../city/life';
import { buildStatic } from '../city/budget';
import { groundGrid } from '../city/ground';
import { CITY_SPEC } from '../city/spec';
import { treeModel } from '../city/nature';
import * as THREE from 'three';
import { ChambersRoom, INSIDE_FAR } from './room';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { geometryOf } from '../city/index';
import { HALF, OPENINGS, POI_BY_ID, WALL_T, floorOf, wallPoint, alongOf, type Opening } from './plan';

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const plan = cityPlan();
const keep = plan.towers.find((t) => t.kind === 'keep')!;
const floor = floorOf(keep);

/** Треугольники города: здания и земля, плоскими массивами, и решётка по плану для лучей. */
function cityTris(): { P: Float32Array; I: Uint32Array; cells: Map<number, number[]>; cell: number } {
  const st = buildStatic(plan, 'medium');
  const spec = CITY_SPEC.medium;
  const g = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
  const bp = st.b.pos;
  const nb = bp.length / 3;
  const P = new Float32Array(bp.length + g.positions.length);
  P.set(bp, 0);
  P.set(g.positions, bp.length);
  const I = new Uint32Array(st.b.idx.length + g.index.length);
  I.set(st.b.idx, 0);
  for (let i = 0; i < g.index.length; i++) I[st.b.idx.length + i] = g.index[i] + nb;
  const cell = 8;
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number): number => (i + 1000) * 4000 + (j + 1000);
  for (let t = 0; t < I.length; t += 3) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k] * 3;
      x0 = Math.min(x0, P[v]);
      x1 = Math.max(x1, P[v]);
      z0 = Math.min(z0, P[v + 2]);
      z1 = Math.max(z1, P[v + 2]);
      cx += P[v] / 3;
      cz += P[v + 2] / 3;
    }
    // Сам донжон изнутри не виден: его стены из покоев — изнанкой, и сцена их отбрасывает (`city/inside.ts`).
    if (t < st.b.idx.length && Math.abs(cx - keep.x) < keep.size / 2 + 0.6 && Math.abs(cz - keep.z) < keep.size / 2 + 0.6) continue;
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = key(i, j);
        const a = cells.get(k);
        if (a) a.push(t);
        else cells.set(k, [t]);
      }
  }
  return { P, I, cells, cell };
}

const W = cityTris();

/** Запас доли на ребре грани и «равные» расстояния, м: луч по общему ребру не проскальзывает между гранями. */
const EPS = 1e-4;
const TIE = 0.02;

/** Первая грань по лучу: расстояние и лицом ли к глазу; `null` — луч ушёл в небо. */
function firstHit(o: [number, number, number], d: [number, number, number], far: number): { t: number; front: boolean; at: [number, number, number] } | null {
  const { P, I, cells, cell } = W;
  let best: { t: number; front: boolean } | null = null;
  const seen = new Set<number>();
  const step = cell * 0.5;
  for (let s = 0; s < far; s += step) {
    if (best && best.t < s - cell) break;
    const x = o[0] + d[0] * s;
    const z = o[2] + d[2] * s;
    const k = (Math.floor(x / cell) + 1000) * 4000 + (Math.floor(z / cell) + 1000);
    const list = cells.get(k);
    if (!list) continue;
    for (const t of list) {
      if (seen.has(t)) continue;
      seen.add(t);
      const a = I[t] * 3;
      const b = I[t + 1] * 3;
      const c = I[t + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tv = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
      const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
      if (u < -EPS || u > 1 + EPS) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
      if (v < -EPS || u + v > 1 + EPS) continue;
      const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
      // Ближняя плоскость камеры города — метр (`scene.placeInside`).
      if (tt < 1 || tt > far) continue;
      // Лицевая грань — против часовой к глазу: определитель Мёллера — Трумбора положителен.
      // Общее ребро двух граней луч задевает у обеих (растеризатор видеокарты рёбер не теряет): из почти равных — лицевая.
      const front = det > 0;
      if (!best || tt < best.t - TIE || (Math.abs(tt - best.t) <= TIE && front && !best.front)) best = { t: tt, front };
    }
  }
  return best ? { ...best, at: [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t] } : null;
}

/** Проходит ли луч из глаза (в осях комнаты) сквозь проём окна — по плоскости его доски. */
function throughOpening(o: Opening, e: [number, number, number], d: [number, number, number]): boolean {
  const n = o.wall === 'south' ? [0, 0, 1] : o.wall === 'west' ? [-1, 0, 0] : [1, 0, 0];
  const c = wallPoint(o.wall, alongOf(o), o.sill, o.plate);
  const dn = d[0] * n[0] + d[2] * n[2];
  if (dn < 1e-3) return false;
  const t = ((c[0] - e[0]) * n[0] + (c[2] - e[2]) * n[2]) / dn;
  if (t <= 0) return false;
  const h = [e[0] + d[0] * t, e[1] + d[1] * t, e[2] + d[2] * t];
  const u = o.wall === 'south' ? h[0] - c[0] : h[2] - c[2];
  const v = h[1] - o.sill;
  const hw = o.outW / 2 - 0.03;
  if (o.twin && Math.abs(u) < 0.1) return false;
  if (Math.abs(u) > hw || v < 0.02) return false;
  return v < o.spring - o.sill + Math.sqrt(Math.max(hw * hw - u * u, 0));
}

/** Кольцо проверки дыры, радианы: 0,2°. */
const RING = 0.0035;

/** Повернуть луч на малые углы по горизонтали и вертикали. */
function jitter(d: [number, number, number], dy: number, dp: number): [number, number, number] {
  const yaw = Math.atan2(d[0], d[2]) + dy;
  const p = Math.asin(Math.max(-1, Math.min(1, d[1]))) + dp;
  return [Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p)];
}

/** Лучи из глаза в осях комнаты сквозь проём: решётка по повороту и наклону головы в пределах точки. */
function rays(eye: [number, number, number], yaw0: number, yaws: readonly [number, number], pitches: readonly [number, number], o: Opening, n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const yaw = yaw0 + yaws[0] + ((yaws[1] - yaws[0]) * i) / n;
      const p = pitches[0] + ((pitches[1] - pitches[0]) * j) / n;
      const d: [number, number, number] = [Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p)];
      if (throughOpening(o, eye, d)) out.push(d);
    }
  return out;
}

describe('покои: вид из окна (Г-7)', () => {
  it('город из окна без дыр: первая задетая грань каждого луча сквозь проём — лицом к глазу, днём и ночью, «Ближе» и «Вдаль»', () => {
    // Граница области: лучи из глаза у окна (поза дела «Окно» — у подоконника) и из глубины покоев, в пределах поворота
    // головы, и только те, что выходят сквозь проём, — остальные упираются в камень покоев. Вид не зависит ни от часа,
    // ни от приближения: «Вдаль» лишь гуще те же лучи (решётка 64 — шаг меньше градуса).
    const south = OPENINGS.find((o) => o.wall === 'south')!;
    const win = POI_BY_ID.window;
    const views: { eye: [number, number, number]; yaw: number; yaws: readonly [number, number]; pitches: readonly [number, number]; o: Opening }[] = [
      { eye: [win.pose.x, win.pose.y, win.pose.z], yaw: win.pose.yaw, yaws: win.yaw!, pitches: win.pitch, o: south },
      { eye: [0, 1.62, 3.9], yaw: 0, yaws: [-0.6, 0.6], pitches: [-0.6, 0.3], o: south },
      // Г-9: дела «Окно на мыс» и «Окно на реку» — глаз в нише парного окна, в пределах поворота головы дела.
      ...(['windowE', 'windowW'] as const).map((id) => {
        const p = POI_BY_ID[id];
        return { eye: [p.pose.x, p.pose.y, p.pose.z] as [number, number, number], yaw: p.pose.yaw, yaws: p.yaw!, pitches: p.pitch, o: OPENINGS.find((o) => o.wall === (id === 'windowE' ? 'east' : 'west'))! };
      }),
      ...OPENINGS.filter((o) => o.wall !== 'south').map((o) => ({
        eye: [(o.wall === 'west' ? -1 : 1) * (HALF - 0.8), 1.62, o.at] as [number, number, number],
        yaw: o.wall === 'west' ? -Math.PI / 2 : Math.PI / 2,
        yaws: [-0.7, 0.7] as const,
        pitches: [-0.7, 0.35] as const,
        o,
      })),
    ];
    let cast = 0;
    let hits = 0;
    const holes: string[] = [];
    for (const v of views) {
      const ds = rays(v.eye, v.yaw, v.yaws, v.pitches, v.o, 64);
      const e: [number, number, number] = [keep.x + v.eye[0], floor + v.eye[1], keep.z + v.eye[2]];
      for (const d of ds) {
        cast++;
        // Луч начинается за наружной гранью стены донжона: внутри толщи — проём покоев, в меше города его нет.
        const out = (WALL_T + 0.2) / Math.max(0.2, Math.abs(v.o.wall === 'south' ? d[2] : d[0]));
        const o: [number, number, number] = [e[0] + d[0] * out, e[1] + d[1] * out, e[2] + d[2] * out];
        const h = firstHit(o, d, INSIDE_FAR);
        if (!h) continue;
        hits++;
        if (h.front) continue;
        // Изнанка под одним лучом — может быть щелью по ребру тоньше пикселя. Дыра — когда изнанку видят и соседние лучи
        // на кольце в 0,2° (у «Вдаль» — 10 точек экрана): тогда сквозь постройку видно пятно, а не нить.
        let ring = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const q = jitter(d, Math.cos(a) * RING, Math.sin(a) * RING);
          const r = firstHit([e[0] + q[0] * out, e[1] + q[1] * out, e[2] + q[2] * out], q, INSIDE_FAR);
          if (r && !r.front) ring++;
        }
        if (ring >= 4) holes.push(`${v.o.wall} (${h.at.map((x) => x.toFixed(1)).join(', ')}): ${ring} из 8 соседей`);
      }
    }
    // Лучей достаточно и они задевают город, а не уходят мимо: проверка — не пустая.
    expect(cast, 'лучей сквозь проёмы').toBeGreaterThan(1500);
    expect(hits, 'лучей в город').toBeGreaterThan(cast * 0.4);
    expect(holes, 'изнанка — первая грань по лучу').toEqual([]);
  });

  it('из покоев земля видна до края: дальняя плоскость дальше самой дальней точки сетки земли', () => {
    const spec = CITY_SPEC.medium;
    const g = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
    let far = 0;
    for (let i = 0; i < g.positions.length; i += 3) far = Math.max(far, Math.hypot(g.positions[i] - keep.x, g.positions[i + 1] - floor, g.positions[i + 2] - keep.z));
    expect(far, 'край земли от донжона').toBeGreaterThan(1000);
    expect(INSIDE_FAR, 'дальняя плоскость изнутри').toBeGreaterThan(far);
    // И камера изнутри её берёт: дальняя плоскость покоев — не ближе `INSIDE_FAR`.
    const src = strip(readFileSync(join(__dirname, '../city/scene.ts'), 'utf8'));
    const place = src.slice(src.indexOf('private placeInside('), src.indexOf('\n  }\n', src.indexOf('private placeInside(')));
    expect(place, 'дальняя плоскость в покоях').toMatch(/this\.camera\.far = Math\.max\([^)]*, room\.far \?\? 0\);/);
    const room = new ChambersRoom({ x: -4, z: -147, base: 16, height: 30 }, DEFAULT_ARMS, 'low', () => null);
    expect(room.far).toBe(INSIDE_FAR);
    room.dispose();
  });

  it('дальнее дерево из покоев — со стволом до земли, сверху — ком без ствола', () => {
    for (const sp of ['broadFar', 'spruceFar'] as const) {
      const low = treeModel(sp, 1, true);
      let lo = Infinity;
      for (let i = 1; i < low.pos.length; i += 3) lo = Math.min(lo, low.pos[i]);
      expect(lo, `${sp}: низ модели изнутри`).toBeLessThan(0.06);
    }
    const top = treeModel('broadFar', 1, false);
    let lo = Infinity;
    for (let i = 1; i < top.pos.length; i += 3) lo = Math.min(lo, top.pos[i]);
    // Без ствола ком кроны висит над землёй — потому изнутри и нужен ствол.
    expect(lo).toBeGreaterThan(0.2);
    // Вход в покои ставит стволы, выход — снимает (в городе сверху ствол не виден): сцена зовёт `attach` и `detach`.
    const src = strip(readFileSync(join(__dirname, '../city/scene.ts'), 'utf8'));
    const enter = src.slice(src.indexOf('enterInside(room: Inside): boolean {'), src.indexOf('leaveInside(room: Inside): void {'));
    expect(enter, 'вход — стволы').toMatch(/room\.attach\?\.\(this\.town\.group\)/);
    const leave = src.slice(src.indexOf('leaveInside(room: Inside): void {'), src.indexOf('private simplify(): void {'));
    expect(leave, 'выход — без стволов').toMatch(/room\.detach\?\.\(\)/);
    // И покои их правда меняют: дальний ком — на дерево со стволом, выход — обратно.
    const group = new THREE.Group();
    const comb = geometryOf(treeModel('broadFar', 0));
    const im = new THREE.InstancedMesh(comb, new THREE.MeshBasicMaterial(), 1);
    im.name = 'city-trees-broadFar';
    group.add(im);
    const room = new ChambersRoom({ x: -4, z: -147, base: 16, height: 30 }, DEFAULT_ARMS, 'low', () => null);
    room.attach(group);
    im.geometry.computeBoundingBox();
    expect(im.geometry.boundingBox!.min.y, 'изнутри — до земли').toBeLessThan(0.06);
    room.detach();
    expect(im.geometry, 'выход — прежний ком').toBe(comb);
    room.dispose();
  });
  it('живой город из окна (docs/city_v3.md, ЖГ-1): хоровод праздника на площади виден из южного окна, а не за храмом', () => {
    // Глаз — у южного окна (точка интереса `window`); точки — по кругу хоровода на высоте груди: видна большая часть круга.
    const p = POI_BY_ID.window.pose;
    const e: [number, number, number] = [keep.x + p.x, floor + p.y, keep.z + p.z];
    let seen = 0;
    const N = 16;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const x = FEAST_AT.x + Math.cos(a) * FEAST_AT.r;
      const z = FEAST_AT.z + Math.sin(a) * FEAST_AT.r;
      const y = heightAt(x, z) + 1.2;
      const d: [number, number, number] = [x - e[0], y - e[1], z - e[2]];
      const L = Math.hypot(d[0], d[1], d[2]);
      // Граница области: точка — в дали, которую открывает окно (`INSIDE_FAR`), и впереди окна (юг — +z).
      expect(L).toBeLessThan(INSIDE_FAR);
      expect(d[2]).toBeGreaterThan(0);
      const h = firstHit(e, [d[0] / L, d[1] / L, d[2] / L], L + 2);
      if (!h || h.t > L - 0.6) seen++;
    }
    expect(seen, 'мест круга на виду из окна').toBeGreaterThanOrEqual(N * 0.75);
  });
});
