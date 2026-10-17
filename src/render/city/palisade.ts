// Частокол вокруг города — кольцо стены из брёвен, когда стена города ниже четвёртого уровня (docs/polish.md, П-6). Вид
// «город» его не рисует: там стена каменная с начала (docs/city.md, раздел 5). Рисует его ролик осады и боя у города, где
// стена — по уровню (docs/gfx.md, ГФ-2, «Замок по уровню»): спереди частокол ролика (`tw/fort.ts`, `palisadeRun`), по кругу —
// этот. Та же раскладка, что у каменной (`forts.wallPlan`): звенья по бровке, низ по земле, ход по сглаженной земле; брёвна
// и ход — те же, что у частокола ролика: та же высота хода, та же толщина бревна.
import { CITY } from './palette';
import { box, flat, pyramid, quadToward, tint, type Builder, type V3 } from './geom';
import { log, type Detail } from './kit';
import { wallPlan, WALL_H, type WallPiece } from './forts';
import { L, TILE_M } from './tex';
import type { P, Tower } from './layout';

/** Ход частокола над землёй, м — тот же, что у частокола ролика (`tw/site.WALL_TOP`, решение 18): защитники там же. */
export const WOOD_WALK = 7.5;
/** Брёвна выше хода на столько (без острия). */
const STAKE_OVER = 1.25;
const STAKE_R = 0.2;
/** Ближе этого к середине ролика — бревно к бревну; дальше — щит из досок с зубцами по верху: издали его не отличить. */
const NEAR_R = 110;

const stakeT = (k: number): V3 => tint(k % 3 === 0 ? CITY.oakLight : CITY.timberGrey, 1.15 + ((k * 37) % 9) * 0.04);

/** Звено частокола: брёвна или щит, ход изнутри. */
function palisadePiece(b: Builder, c: WallPiece, near: boolean, detail: Detail, k0: number): void {
  const [ox0, oz0] = c.o0;
  const [ox1, oz1] = c.o1;
  const len = Math.hypot(ox1 - ox0, oz1 - oz0);
  if (len < 0.05) return;
  // Внутрь — от наружной кромки к внутренней.
  const ix = c.i0[0] - ox0;
  const iz = c.i0[1] - oz0;
  const il = Math.hypot(ix, iz) || 1;
  const nx = ix / il;
  const nz = iz / il;
  const lift = WALL_H - WOOD_WALK;
  const w0 = c.t0 - lift;
  const w1 = c.t1 - lift;
  const out: V3 = [-nx, 0, -nz];
  if (near) {
    const step = detail === 0 ? 0.62 : 0.42;
    const n = Math.max(1, Math.round(len / step));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      const x = ox0 + (ox1 - ox0) * f + nx * STAKE_R;
      const z = oz0 + (oz1 - oz0) * f + nz * STAKE_R;
      const y0 = c.base0 + (c.base1 - c.base0) * f;
      const top = w0 + (w1 - w0) * f + STAKE_OVER + (((k0 + j) * 13) % 5) * 0.08;
      const T = stakeT(k0 + j);
      log(b, [x, y0, z], [x, top, z], STAKE_R, T, 5, false);
      if (detail > 0 || j % 2 === 0) {
        // Острие — конус над бревном.
        const r = STAKE_R;
        const seg = 5;
        for (let s = 0; s < seg; s++) {
          const a0 = (s / seg) * Math.PI * 2;
          const a1 = ((s + 1) / seg) * Math.PI * 2;
          b.tri([x + Math.cos(a0) * r, top, z + Math.sin(a0) * r], [x, top + r * 2.6, z], [x + Math.cos(a1) * r, top, z + Math.sin(a1) * r], [0, 0, 0.5, 1, 1, 0], L.wood, T, [0.9, 1, 0.9]);
        }
      }
    }
  } else {
    // Щит: наружная и внутренняя грани брёвнами слоя «дерево», по верху — зубцы острий.
    const [tw, th] = TILE_M.wood;
    const T = tint(CITY.timberGrey, 1.2);
    const t0 = w0 + STAKE_OVER;
    const t1 = w1 + STAKE_OVER;
    for (const side of [0, 1]) {
      const d = side === 0 ? 0 : STAKE_R * 2;
      const a: V3 = [ox0 + nx * d, c.base0, oz0 + nz * d];
      const e: V3 = [ox1 + nx * d, c.base1, oz1 + nz * d];
      const want: V3 = side === 0 ? out : [nx, 0, nz];
      const u1 = len / tw;
      quadToward(b, a, e, [e[0], t1, e[2]], [a[0], t0, a[2]], [0, c.base0 / th, u1, c.base1 / th, u1, t1 / th, 0, t0 / th], L.wood, T, want, [0.75, 0.75, 1, 1]);
      const n = Math.max(1, Math.round(len / 0.5));
      for (let j = 0; j < n; j++) {
        const f0 = j / n;
        const f1 = (j + 1) / n;
        const fm = (j + 0.5) / n;
        const p0: V3 = [a[0] + (e[0] - a[0]) * f0, t0 + (t1 - t0) * f0, a[2] + (e[2] - a[2]) * f0];
        const p1: V3 = [a[0] + (e[0] - a[0]) * f1, t0 + (t1 - t0) * f1, a[2] + (e[2] - a[2]) * f1];
        const pm: V3 = [a[0] + (e[0] - a[0]) * fm, t0 + (t1 - t0) * fm + 0.5, a[2] + (e[2] - a[2]) * fm];
        // Обход — наружу у наружной грани и внутрь у внутренней.
        if (side === 0) b.tri(p1, pm, p0, [1, 0, 0.5, 1, 0, 0], L.wood, T);
        else b.tri(p0, pm, p1, [0, 0, 0.5, 1, 1, 0], L.wood, T);
      }
    }
  }
  // Ход: настил от брёвен до внутренней кромки, по ходу сглаженной земли.
  const pk0: [number, number] = [ox0 + nx * STAKE_R * 2, oz0 + nz * STAKE_R * 2];
  const pk1: [number, number] = [ox1 + nx * STAKE_R * 2, oz1 + nz * STAKE_R * 2];
  const [tw] = TILE_M.wood;
  quadToward(b, [pk0[0], w0, pk0[1]], [pk1[0], w1, pk1[1]], [c.i1[0], w1, c.i1[1]], [c.i0[0], w0, c.i0[1]], [0, 0, len / tw, 0, len / tw, 0.6, 0, 0.6], L.wood, tint(CITY.timberGrey, 1.05), [0, 1, 0], [0.9, 0.9, 0.85, 0.85]);
  if (near && detail > 0) {
    // Столбы под настилом изнутри.
    for (let s = 1.2; s < len; s += 2.4) {
      const f = s / len;
      const x = c.i0[0] + (c.i1[0] - c.i0[0]) * f - nx * 0.15;
      const z = c.i0[1] + (c.i1[1] - c.i0[1]) * f - nz * 0.15;
      log(b, [x, c.base0 + (c.base1 - c.base0) * f + 1.6, z], [x, w0 + (w1 - w0) * f, z], 0.14, tint(CITY.timberGrey, 1.15), 5, false);
    }
  }
}

/**
 * Частокол по контуру (`pts`, замкнутый): звенья `forts.wallPlan`, брёвна у `near` (середина ролика) и щиты дальше;
 * `skip` — звенья, которых нет (стену там рисует ролик). Башни — срубы на месте каменных (`timberTower`).
 */
export function palisadeRing(b: Builder, pts: readonly P[], center: P, towers: readonly Tower[], detail: Detail, skip: (p: P, q: P) => boolean, near: P): void {
  const { pieces } = wallPlan(pts, center, towers, detail, () => false, skip);
  let k = 0;
  for (const c of pieces) {
    if (c.hidden) continue;
    const mx = (c.p.x + c.q.x) / 2 - near.x;
    const mz = (c.p.z + c.q.z) / 2 - near.z;
    palisadePiece(b, c, Math.hypot(mx, mz) < NEAR_R, detail, k);
    k += Math.round(c.len / 0.42);
  }
}

/**
 * Башня частокола на месте каменной: сруб на четырёх столбах, обшитый верх выше хода, шатёр из досок. Дозор — выше всех
 * (вышка над рекой). Ворота — две башни по бокам проезда, перекладина и обшитая галерея над ним. Огни ночи — у верха.
 */
export function timberTower(b: Builder, t: Tower, detail: Detail): V3[] {
  const fx = Math.cos(t.out);
  const fz = Math.sin(t.out);
  const ground = t.base;
  const foot = (t.foot ?? t.base) - 0.6;
  const walk = ground + WOOD_WALK;
  const lights: V3[] = [];
  const one = (x: number, z: number, size: number, h: number): void => {
    const half = size / 2;
    const T = tint(CITY.timberGrey, 1.3);
    const rx = fz;
    const rz = -fx;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const px = x + (fx * a + rx * c) * half;
      const pz = z + (fz * a + rz * c) * half;
      log(b, [px, foot, pz], [px, ground + h, pz], 0.3, T, detail > 0 ? 6 : 4, false);
    }
    box(b, x, z, fx, fz, size, size, walk + 0.4, ground + h, 'wood', tint(CITY.oakLight, 1.2), 'wood');
    const o = half + 0.55;
    const corners: [number, number][] = [
      [x + (fx + rx) * o, z + (fz + rz) * o],
      [x + (-fx + rx) * o, z + (-fz + rz) * o],
      [x + (-fx - rx) * o, z + (-fz - rz) * o],
      [x + (fx - rx) * o, z + (fz - rz) * o],
    ];
    pyramid(b, corners, ground + h, [x, ground + h + size * 0.75, z], 'wood', tint(CITY.oakLight, 0.95), 0.9);
    if (detail > 0) {
      // Площадка под шатром: выступ настила за обшивку.
      flat(b, corners, walk + 0.4, 'wood', tint(CITY.timberGrey, 0.9), false, 0.6);
    }
    lights.push([x + fx * (half + 0.2), walk + 1.6, z + fz * (half + 0.2)]);
  };
  if (t.kind === 'gate' || t.kind === 'castleGate') {
    const pass = 2.2;
    const size = 3.8;
    const h = WOOD_WALK + 4.2;
    const rx = fz;
    const rz = -fx;
    for (const side of [1, -1]) one(t.x + rx * side * (pass + size / 2), t.z + rz * side * (pass + size / 2), size, h);
    // Перекладина над проездом и обшитая галерея.
    box(b, t.x, t.z, fx, fz, pass * 2, 2.4, ground + 5.6, ground + 6.5, 'wood', tint(CITY.oakLight, 1.25), 'wood');
    box(b, t.x, t.z, fx, fz, pass * 2 + 1, 3.0, walk + 0.4, ground + h - 0.6, 'wood', tint(CITY.oakLight, 1.15), 'wood');
  } else if (t.kind === 'watch') {
    one(t.x, t.z, 5.6, WOOD_WALK + 15);
  } else {
    one(t.x, t.z, t.kind === 'round' ? 4.6 : 4.4, WOOD_WALK + 5 + ((t.seed % 5) * 0.3));
  }
  return lights;
}
