// Покои правителя (docs/city_v3.md, Г-5): по комнате ходят сами — план пола, мебель, через которую не пройти, и путь к
// месту действия в обход неё. Чистый модуль без three: его читают глаз комнаты (`room.ts`) и тесты.
//
// Тело — круг радиусом `BODY_R` на полу. Ходить можно по комнате и в нишу южного окна между каменными сиденьями; стены,
// камин, кровать, стол, кресло, сундуки, полки, столик с шахматами и подсвечники — препятствия. Шаг пальцем двигает круг и
// выталкивает его из препятствий (скольжение вдоль стены, а не остановка). Касание далёкого предмета ведёт сюда же — путь
// по углам препятствий, раздутых на тело (граф видимости), кратчайший.
import { BED, CHAIR, CHESS, DESK, DUMMY, HALF, HEARTH, OPENINGS, SHELVES, STANDS, CHESTS, type Box } from './plan';

/** Радиус тела, м: плечи человека в плаще. */
export const BODY_R = 0.24;
/** Глаз стоя, м. */
export const EYE_STAND = 1.62;
/** Шаг пальцем, м/с: спокойный шаг по покоям (быстрый шаг поляны и промыслов — 2.6 — здесь в три шага до стены). */
export const WALK_SPEED = 1.5;
/** Подход сам — чуть медленнее: правитель идёт, а не бежит, и кадр не дёргается. */
export const AUTO_SPEED = 1.3;

/** Препятствие на плане: прямоугольник или круг. */
export type Obstacle = { kind: 'box'; id: string; x0: number; z0: number; x1: number; z1: number } | { kind: 'disc'; id: string; x: number; z: number; r: number };

const rectOf = (id: string, b: Pick<Box, 'x0' | 'z0' | 'x1' | 'z1'>, pad = 0): Obstacle => ({ kind: 'box', id, x0: b.x0 - pad, z0: b.z0 - pad, x1: b.x1 + pad, z1: b.z1 + pad });

/** Ниша южного окна: коридор между каменными сиденьями — до доски окна. */
const SOUTH = OPENINGS.find((o) => o.wall === 'south')!;
/** Внутренний край сиденья ниши у комнаты (`build.opening`: сиденье — от откоса на 0.22, с запасом 0.18). */
export const NICHE_HALF = SOUTH.midW / 2 - 0.2 - 0.18;
export const NICHE_END = HALF + SOUTH.plate;

/** Мебель и камин на плане (в осях комнаты, `plan.ts`). */
export const OBSTACLES: readonly Obstacle[] = [
  rectOf('desk', { x0: -DESK.w / 2, z0: DESK.z - DESK.d / 2, x1: DESK.w / 2, z1: DESK.z + DESK.d / 2 }),
  rectOf('chair', { x0: CHAIR.x - 0.34, z0: CHAIR.z - 0.29, x1: CHAIR.x + 0.34, z1: CHAIR.z + 0.27 }),
  rectOf('bed', BED),
  // Очаг и косяки камина, поленница, кочерга с метлой.
  rectOf('hearth', { x0: -HEARTH.mouthW / 2 - 0.47, z0: -HALF - 1, x1: HEARTH.mouthW / 2 + 0.47, z1: -HALF + 0.72 }),
  rectOf('logs', { x0: 1.86, z0: -HALF - 1, x1: 2.52, z1: -4.4 }),
  rectOf('poker', { x0: -1.74, z0: -HALF - 1, x1: -1.36, z1: -4.55 }),
  ...CHESTS.map((c) => rectOf(c.id, c)),
  ...SHELVES.map((s) => rectOf(s.id, s)),
  { kind: 'disc', id: 'chess', x: CHESS.x, z: CHESS.z, r: 0.43 },
  { kind: 'disc', id: 'stoolW', x: CHESS.x - 0.75, z: CHESS.z + 0.1, r: 0.2 },
  { kind: 'disc', id: 'stoolE', x: CHESS.x + 0.75, z: CHESS.z - 0.1, r: 0.2 },
  ...STANDS.map((s) => ({ kind: 'disc' as const, id: s.id, x: s.x, z: s.z, r: s.r })),
  // Чучело (Г-11): крестовина на полу.
  { kind: 'disc', id: 'dummy', x: DUMMY.x, z: DUMMY.z, r: DUMMY.base },
];

/** Внутри ли пола: комната без полосы у стен на тело — или коридор ниши южного окна. */
export function onFloor(x: number, z: number, r = BODY_R): boolean {
  const room = Math.abs(x) <= HALF - r + 1e-9 && Math.abs(z) <= HALF - r + 1e-9;
  const niche = Math.abs(x) <= NICHE_HALF - r + 1e-9 && z >= 0 && z <= NICHE_END - r + 1e-9;
  return room || niche;
}

/** Ближайшая точка пола: комната или ниша — что ближе. */
function toFloor(x: number, z: number, r: number): { x: number; z: number } {
  if (onFloor(x, z, r)) return { x, z };
  const m = HALF - r;
  const a = { x: clamp(x, -m, m), z: clamp(z, -m, m) };
  const n = NICHE_HALF - r;
  const b = { x: clamp(x, -n, n), z: clamp(z, 0, NICHE_END - r) };
  return (a.x - x) ** 2 + (a.z - z) ** 2 <= (b.x - x) ** 2 + (b.z - z) ** 2 ? a : b;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Насколько круг тела в точке залезает в препятствие (0 — не залезает) и куда его вытолкнуть. */
function push(o: Obstacle, x: number, z: number, r: number): { dx: number; dz: number } | null {
  if (o.kind === 'disc') {
    const dx = x - o.x;
    const dz = z - o.z;
    const d = Math.hypot(dx, dz);
    const need = o.r + r;
    if (d >= need) return null;
    if (d < 1e-9) return { dx: need, dz: 0 };
    return { dx: (dx / d) * (need - d), dz: (dz / d) * (need - d) };
  }
  const cx = clamp(x, o.x0, o.x1);
  const cz = clamp(z, o.z0, o.z1);
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= r) return null;
  if (d > 1e-9) return { dx: (dx / d) * (r - d), dz: (dz / d) * (r - d) };
  // Середина тела внутри прямоугольника — наружу кратчайшей стороной.
  const out = [
    { dx: o.x0 - r - x, dz: 0 },
    { dx: o.x1 + r - x, dz: 0 },
    { dx: 0, dz: o.z0 - r - z },
    { dx: 0, dz: o.z1 + r - z },
  ];
  return out.reduce((a, b) => (Math.abs(a.dx) + Math.abs(a.dz) <= Math.abs(b.dx) + Math.abs(b.dz) ? a : b));
}

/** Свободна ли точка для тела: на полу и ни в одном препятствии. */
export function free(x: number, z: number, r = BODY_R): boolean {
  if (!onFloor(x, z, r)) return false;
  for (const o of OBSTACLES) if (push(o, x, z, r)) return false;
  return true;
}

/**
 * Шаг тела: из `from` хотели в (`x`, `z`) — куда пришли. Препятствия выталкивают, стены держат; вдоль стены тело скользит.
 * Шаг делится на куски не длиннее половины радиуса: быстрый палец не проносит тело сквозь тонкий столбик.
 */
export function step(from: { x: number; z: number }, x: number, z: number, r = BODY_R): { x: number; z: number } {
  const d = Math.hypot(x - from.x, z - from.z);
  const n = Math.max(1, Math.ceil(d / (r * 0.5)));
  let p = { x: from.x, z: from.z };
  for (let i = 1; i <= n; i++) {
    let q = { x: p.x + ((x - from.x) * 1) / n, z: p.z + ((z - from.z) * 1) / n };
    for (let k = 0; k < 4; k++) {
      q = toFloor(q.x, q.z, r);
      let moved = false;
      for (const o of OBSTACLES) {
        const s = push(o, q.x, q.z, r);
        if (s) {
          q = { x: q.x + s.dx, z: q.z + s.dz };
          moved = true;
        }
      }
      if (!moved && onFloor(q.x, q.z, r)) break;
    }
    q = toFloor(q.x, q.z, r);
    // Не вытолкнулось (угол двух препятствий) — стоим, где стояли: сквозь мебель не проходим ни на сантиметр.
    if (!free(q.x, q.z, r)) return p;
    p = q;
  }
  return p;
}

/**
 * Виден ли отрезок для тела: ни одно препятствие, раздутое на тело, его не пересекает (прямоугольник — раздут квадратом,
 * с запасом в углах; круг — точно), и он на полу (по комнате — всегда, если концы в ней; через нишу — пробой через 6 см).
 */
export function clear(a: { x: number; z: number }, b: { x: number; z: number }, r = BODY_R): boolean {
  if (!free(a.x, a.z, r) || !free(b.x, b.z, r)) return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const o of OBSTACLES) {
    if (o.kind === 'disc') {
      const l2 = dx * dx + dz * dz || 1e-12;
      const t = clamp(((o.x - a.x) * dx + (o.z - a.z) * dz) / l2, 0, 1);
      if (Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) < o.r + r) return false;
      continue;
    }
    // Пересечение отрезка с прямоугольником методом плит.
    let t0 = 0;
    let t1 = 1;
    const slab = (p: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-12) return p > lo && p < hi;
      let u0 = (lo - p) / d;
      let u1 = (hi - p) / d;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
      return t0 < t1;
    };
    if (slab(a.x, dx, o.x0 - r, o.x1 + r) && slab(a.z, dz, o.z0 - r, o.z1 + r)) return false;
  }
  const inRoom = (p: { x: number; z: number }): boolean => Math.abs(p.x) <= HALF - r + 1e-9 && Math.abs(p.z) <= HALF - r + 1e-9;
  if (inRoom(a) && inRoom(b)) return true;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.06));
  for (let i = 1; i < n; i++) if (!onFloor(a.x + (dx * i) / n, a.z + (dz * i) / n, r)) return false;
  return true;
}

/** Узлы графа обхода: углы препятствий, раздутых на тело с запасом, и середина ниши. */
const NODES: readonly { x: number; z: number }[] = (() => {
  const pad = BODY_R + 0.07;
  const out: { x: number; z: number }[] = [
    { x: 0, z: HALF - BODY_R - 0.05 },
    { x: 0, z: NICHE_END - BODY_R - 0.05 },
  ];
  for (const o of OBSTACLES) {
    if (o.kind === 'box') {
      for (const x of [o.x0 - pad, o.x1 + pad]) for (const z of [o.z0 - pad, o.z1 + pad]) out.push({ x, z });
    } else {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        const rr = (o.r + pad) / Math.cos(Math.PI / 8);
        out.push({ x: o.x + Math.cos(a) * rr, z: o.z + Math.sin(a) * rr });
      }
    }
  }
  return out.filter((p) => free(p.x, p.z));
})();

/**
 * Путь тела от `a` до `b` в обход мебели: ломаная от `a` (не включая) до `b` (включая); `null` — не дойти. Кратчайший по
 * графу видимости (Дейкстра на нескольких десятках узлов — доли миллисекунды, и считается только по касанию).
 */
export function pathTo(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] | null {
  const free0 = free(a.x, a.z) ? a : step(a, a.x, a.z);
  if (!free(b.x, b.z)) return null;
  if (clear(free0, b)) return [b];
  // У угла препятствия тело стоит свободно (угол — круглый), а отрезок раздут квадратом — из такой точки не виден ни один
  // узел, и касание вещи ничего не делало (Г-9, «Кубок» у кресла): сперва шаг из квадрата, дальше — как обычно.
  const start = free0 === a ? outOfSquare(a) : free0;
  const lead = start === free0 ? [] : [start];
  if (lead.length && clear(start, b)) return [start, b];
  const pts = [start, ...NODES, b];
  const n = pts.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === n - 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const w = Math.hypot(pts[v].x - pts[u].x, pts[v].z - pts[u].z);
      if (dist[u] + w >= dist[v]) continue;
      if (!clear(pts[u], pts[v])) continue;
      dist[v] = dist[u] + w;
      prev[v] = u;
    }
  }
  if (dist[n - 1] === Infinity) return null;
  const out: { x: number; z: number }[] = [];
  for (let v = n - 1; v > 0; v = prev[v]) out.unshift(pts[v]);
  return [...lead, ...out];
}

/** Точка тела, вытолкнутая из квадратов препятствий (раздутых на тело) по кратчайшей оси, если она свободна. */
function outOfSquare(p: { x: number; z: number }, r = BODY_R): { x: number; z: number } {
  let q = p;
  for (const o of OBSTACLES) {
    if (o.kind !== 'box') continue;
    const x0 = o.x0 - r;
    const x1 = o.x1 + r;
    const z0 = o.z0 - r;
    const z1 = o.z1 + r;
    if (!(q.x > x0 && q.x < x1 && q.z > z0 && q.z < z1)) continue;
    const moves = [
      { x: x0 - 0.01, z: q.z },
      { x: x1 + 0.01, z: q.z },
      { x: q.x, z: z0 - 0.01 },
      { x: q.x, z: z1 + 0.01 },
    ].sort((u, v) => Math.hypot(u.x - q.x, u.z - q.z) - Math.hypot(v.x - q.x, v.z - q.z));
    const m = moves.find((u) => free(u.x, u.z, r));
    if (m) q = m;
  }
  return q;
}

/** Длина ломаной от `a` через точки пути. */
export function pathLength(a: { x: number; z: number }, path: readonly { x: number; z: number }[]): number {
  let l = 0;
  let p = a;
  for (const q of path) {
    l += Math.hypot(q.x - p.x, q.z - p.z);
    p = q;
  }
  return l;
}
