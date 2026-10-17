// Огни города и их железо (docs/polish.md, П-9): у каждого огня есть то, что горит, — кронштейн с факелом на стене, фонарь
// у двери, фонарь на столбе улицы, жаровня, горн кузницы. Света без источника нет: огонь ставят те же руки, что строят
// его держатель. Числа огня — `glow/lamps.ts`.
import { CITY } from './palette';
import { box, cone, tint, type Builder, type V3 } from './geom';
import { log } from './kit';
import { along, heightAt, insidePoly, type CityPlan, type P } from './layout';
import type { Site } from './sites';
import type { Lamp, LampKind } from '../glow/lamps';

const IRON = (): V3 => tint(CITY.iron, 1.25);
const TAR = (): V3 => tint(CITY.iron, 0.7);
const STAFF = (): V3 => tint(CITY.oak, 0.75);

/** Огонь у стены постройки `s`: наружу — по той грани коробки, к которой он ближе всего (в долях полуширины). */
export function mounted(p: V3, kind: LampKind, s: Site | null): Lamp {
  let dx = 0;
  let dz = 0;
  if (s) {
    const ox = p[0] - s.x;
    const oz = p[2] - s.z;
    const f = ox * s.fx + oz * s.fz;
    const r = ox * s.fz - oz * s.fx;
    if (Math.abs(f) / Math.max(s.hf, 0.1) >= Math.abs(r) / Math.max(s.hr, 0.1)) {
      dx = Math.sign(f) * s.fx;
      dz = Math.sign(f) * s.fz;
    } else {
      dx = Math.sign(r) * s.fz;
      dz = -Math.sign(r) * s.fx;
    }
  }
  return { x: p[0], y: p[1], z: p[2], kind, dx, dz, lift: p[1] - heightAt(p[0], p[2]) };
}

/** Свободно стоящий огонь (жаровня, фонарь на столбе, фонарь под шатром дозора). */
export const standing = (p: V3, kind: LampKind): Lamp => ({ x: p[0], y: p[1], z: p[2], kind, dx: 0, dz: 0, lift: p[1] - heightAt(p[0], p[2]) });

/** Клетка фонаря вокруг огня: четыре прута, донце и шатёр; огонь — посередине. */
function cage(b: Builder, x: number, y: number, z: number, fx: number, fz: number): void {
  const T = IRON();
  const rx = fz;
  const rz = -fx;
  for (const [a, c] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    box(b, x + (fx * a + rx * c) * 0.13, z + (fz * a + rz * c) * 0.13, fx, fz, 0.035, 0.035, y - 0.22, y + 0.22, 'wood', T, null);
  }
  box(b, x, z, fx, fz, 0.32, 0.32, y - 0.26, y - 0.22, 'wood', T, 'wood');
  cone(b, x, z, 0.24, y + 0.21, y + 0.42, 4, 'wood', T, 1);
}

/**
 * Железо огня у стены: факел — кронштейн и древко с просмолённой головкой под пламенем; фонарь — рука из стены и клетка на
 * ней. Свободно стоящему фонарю (под шатром дозора) — клетка на цепи. Жаровня, горн и костёр строятся своим кодом.
 */
export function fixture(b: Builder, l: Lamp): void {
  const { x, y, z, dx, dz } = l;
  const wall = dx !== 0 || dz !== 0;
  if (l.kind === 'torch') {
    if (!wall) return;
    log(b, [x - dx * 0.5, y - 0.42, z - dz * 0.5], [x - dx * 0.02, y - 0.42, z - dz * 0.02], 0.035, IRON(), 4, false);
    // Древко чуть отклонено от стены — так факел держат, чтобы не коптить кладку.
    log(b, [x - dx * 0.12, y - 0.85, z - dz * 0.12], [x, y - 0.12, z], 0.045, STAFF(), 5, false);
    cone(b, x, z, 0.085, y - 0.24, y - 0.05, 5, 'wood', TAR(), 1);
    return;
  }
  if (l.kind === 'lantern') {
    if (wall) {
      log(b, [x - dx * 0.55, y + 0.5, z - dz * 0.55], [x, y + 0.5, z], 0.03, IRON(), 4, false);
      cage(b, x, y, z, dx, dz);
      return;
    }
    log(b, [x, y + 0.42, z], [x, y + 0.9, z], 0.015, IRON(), 3, false);
    cage(b, x, y, z, 1, 0);
  }
}

/** Фонарь на столбе у края улицы: столб, рука к середине улицы, клетка. `nx`, `nz` — к середине улицы. */
function lanternPost(b: Builder, px: number, pz: number, nx: number, nz: number): Lamp {
  const g = heightAt(px, pz);
  const top = g + 3.5;
  log(b, [px, g - 0.3, pz], [px, top, pz], 0.075, STAFF(), 6, true);
  box(b, px, pz, nx, nz, 0.34, 0.34, g - 0.1, g + 0.35, 'ashlar', tint(CITY.stoneTints[1]), 'ashlar', { aoBottom: 0.7 });
  const lx = px + nx * 0.6;
  const lz = pz + nz * 0.6;
  log(b, [px, top - 0.15, pz], [lx, top - 0.15, lz], 0.035, IRON(), 4, false);
  const ly = top - 0.62;
  log(b, [lx, ly + 0.42, lz], [lx, top - 0.15, lz], 0.015, IRON(), 3, false);
  cage(b, lx, ly, lz, nx, nz);
  return { x: lx, y: ly, z: lz, kind: 'lantern', dx: 0, dz: 0, lift: ly - heightAt(lx, lz) };
}

/** Шаг фонарей вдоль мощёной улицы, м, и сколько оставить свободным у ворот и у других огней. */
const STREET_STEP = 26;
const GATE_CLEAR = 14;
const LAMP_CLEAR = 9;

/**
 * Фонари улиц: на мощёных — через `STREET_STEP` по очереди с двух сторон, у края мостовой; на площади — по углам. Не у
 * ворот (там факелы надвратных башен) и не вплотную к другим огням.
 */
export function streetLamps(b: Builder, plan: CityPlan, others: readonly Lamp[]): Lamp[] {
  const out: Lamp[] = [];
  const clear = (x: number, z: number): boolean =>
    !plan.gates.some((g) => Math.hypot(g.x - x, g.z - z) < GATE_CLEAR) && ![...others, ...out].some((l) => Math.hypot(l.x - x, l.z - z) < LAMP_CLEAR);
  // Площадь: по углу, на шаг внутрь — рынок светится по краям, ряды в середине.
  const sq = plan.square;
  const cx = sq.reduce((a, p) => a + p.x, 0) / sq.length;
  const cz = sq.reduce((a, p) => a + p.z, 0) / sq.length;
  for (const p of sq) {
    const d = Math.hypot(cx - p.x, cz - p.z) || 1;
    const x = p.x + ((cx - p.x) / d) * 3;
    const z = p.z + ((cz - p.z) / d) * 3;
    if (clear(x, z)) out.push(lanternPost(b, x, z, (cx - p.x) / d, (cz - p.z) / d));
  }
  for (const st of plan.streets) {
    if (st.surface !== 'cobble') continue;
    let total = 0;
    for (let k = 1; k < st.pts.length; k++) total += Math.hypot(st.pts[k].x - st.pts[k - 1].x, st.pts[k].z - st.pts[k - 1].z);
    let side = 1;
    for (let s = STREET_STEP / 2; s < total - 4; s += STREET_STEP, side = -side) {
      const { p, t } = along(st.pts, s);
      // Влево по ходу — (tz, −tx), как «право» рамки с обратным знаком.
      const nx = t.z * side;
      const nz = -t.x * side;
      const x = p.x + nx * (st.half - 0.55);
      const z = p.z + nz * (st.half - 0.55);
      if (insidePoly({ x, z } as P, sq) || !clear(x, z)) continue;
      out.push(lanternPost(b, x, z, -nx, -nz));
    }
  }
  return out;
}

/**
 * Горн кузницы под открытым навесом у входа: каменный очаг по пояс, в нём угли. Огонь — над углями, низко: свет ложится
 * на землю у двери и на стену.
 */
export function forge(b: Builder, x: number, z: number, fx: number, fz: number): Lamp {
  const g = heightAt(x, z);
  box(b, x, z, fx, fz, 1.5, 1.1, g - 0.2, g + 0.85, 'rubble', tint(CITY.stoneTints[2], 0.85), 'rubble', { aoBottom: 0.6 });
  box(b, x, z, fx, fz, 1.0, 0.65, g + 0.85, g + 0.92, 'rock', tint(CITY.rockDark, 0.6), 'rock');
  return { x, y: g + 1.15, z, kind: 'forge', dx: 0, dz: 0, lift: 1.15 };
}
