// Храм лицом к площади и его двор (docs/city_v3.md, Г-2): паперть с лестницей на площадь, ограда двора, кладбище с
// крестами, сад трав с ульями; у площадки перед храмом — доска объявлений, колодки и лотки со свечами; у Верхней улицы —
// коновязь, поилка, сено, повозка и бочки. Деревья двора — `layout.yardTrees`. Один вид навсегда: уровни игры его не
// меняют, уровень качества — только число мелочи.
import { CITY } from './palette';
import { box, cone, cylinder, disc, tint, type Builder, type V3 } from './geom';
import { log, pushQuadOut, type Detail } from './kit';
import { CLOSE, PARVIS, heightAt, type Civic } from './layout';
import { L } from './tex';
import { rnd } from './noise';
import { barrel, cart, stall } from './civic';

/** Подъём ступени паперти, м: лестница — столько ступеней, сколько нужно, чтобы ни одна не была выше. */
export const STEP_RISE_MAX = 0.19;

/**
 * Паперть: площадка у портала на уровне пола храма и лестница во всю её ширину до мостовой; по бокам лестницы — каменные
 * щёки. Храм смотрит на юг (+z, `layout.CHURCH`), так что всё здесь — в метрах плана.
 */
export function parvis(b: Builder, c: Civic, detail: Detail): void {
  const x = c.x;
  const front = c.z + c.d / 2;
  const hw = PARVIS.half;
  const T = tint(CITY.stoneTints[1], 0.9);
  const top = tint(CITY.stoneTints[2], 0.96);
  const low = Math.min(heightAt(x - hw, front), heightAt(x + hw, front), heightAt(x, PARVIS.top));
  box(b, x, (front + PARVIS.top) / 2, 0, 1, hw * 2, PARVIS.top - front, low - 0.4, c.base, 'rubble', T, 'ashlar', { aoBottom: 0.7, grimeBottom: 0.7 });
  const footY = heightAt(x, PARVIS.foot);
  const rise = c.base - footY;
  const run = PARVIS.foot - PARVIS.top;
  const n = Math.max(3, Math.ceil(rise / STEP_RISE_MAX));
  const sr = run / n;
  for (let k = 0; k < n; k++) {
    const z = PARVIS.top + sr * (k + 0.5);
    const y1 = c.base - ((k + 1) * rise) / (n + 1);
    const y0 = Math.min(heightAt(x - hw, z), heightAt(x + hw, z)) - 0.3;
    box(b, x, z, 0, 1, hw * 2, sr + 0.02, y0, y1, 'ashlar', [top[0] * (1 - (k % 2) * 0.03), top[1] * (1 - (k % 2) * 0.03), top[2] * (1 - (k % 2) * 0.03)], 'ashlar', { aoBottom: 0.75 });
  }
  // Щёки лестницы: наклонная стенка от площадки к мостовой.
  for (const s of [-1, 1]) {
    const cx = x + s * (hw + 0.3);
    const yT = c.base + 0.55;
    const yF = footY + 0.45;
    const g0 = heightAt(cx, PARVIS.top) - 0.3;
    const g1 = heightAt(cx, PARVIS.foot) - 0.3;
    const P = (dx: number, z: number, y: number): V3 => [cx + dx, y, z];
    const out: V3 = [cx + s * 5, yT, (PARVIS.top + PARVIS.foot) / 2];
    const inn: V3 = [cx - s * 5, yT, (PARVIS.top + PARVIS.foot) / 2];
    for (const [dx, toward] of [
      [0.3 * s, out],
      [-0.3 * s, inn],
    ] as const) {
      pushQuadOut(b, P(dx, PARVIS.top, g0), P(dx, PARVIS.foot, g1), P(dx, PARVIS.foot, yF), P(dx, PARVIS.top, yT), 'ashlar', T, toward, 0.85);
    }
    pushQuadOut(b, P(-0.3, PARVIS.top, yT), P(0.3, PARVIS.top, yT), P(0.3, PARVIS.foot, yF), P(-0.3, PARVIS.foot, yF), 'ashlar', top, [cx, yT + 5, PARVIS.top], 0.95);
    pushQuadOut(b, P(-0.3, PARVIS.foot, g1), P(0.3, PARVIS.foot, g1), P(0.3, PARVIS.foot, yF), P(-0.3, PARVIS.foot, yF), 'ashlar', T, [cx, yF, PARVIS.foot + 5], 0.85);
  }
  void detail;
}

/** Ограда двора: низкая стенка по прямоугольнику `CLOSE`, проход — лестница паперти. */
function closeWall(b: Builder, c: Civic): void {
  const T = tint(CITY.stoneTints[1], 0.92);
  const { x0, x1, z0, z1 } = CLOSE;
  const gapL = c.x - PARVIS.half - 0.65;
  const gapR = c.x + PARVIS.half + 0.65;
  const runs: [number, number, number, number][] = [
    [x0, z0, gapL, z0],
    [gapR, z0, x1, z0],
    [x1, z0, x1, z1],
    [x1, z1, x0, z1],
    [x0, z1, x0, z0],
  ];
  for (const [ax, az, ex, ez] of runs) {
    const len = Math.hypot(ex - ax, ez - az);
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k < steps; k++) {
      const f0 = k / steps;
      const f1 = (k + 1) / steps;
      const mx = ax + (ex - ax) * ((f0 + f1) / 2);
      const mz = az + (ez - az) * ((f0 + f1) / 2);
      const y = heightAt(mx, mz);
      const dx = (ex - ax) / len;
      const dz = (ez - az) / len;
      box(b, mx, mz, -dz, dx, len / steps + 0.05, 0.5, y - 0.4, y + 1.1, 'rubble', T, 'ashlar', { aoBottom: 0.65, grimeBottom: 0.7 });
    }
  }
}

/** Крест на могиле: столб и перекладина — камень или дерево, у старых — наклон. */
function cross(b: Builder, x: number, z: number, seed: number, detail: Detail): void {
  const y = heightAt(x, z);
  const wood = rnd(seed, 1, 41) < 0.4;
  const t = wood ? tint(CITY.oak, 0.9 + rnd(seed, 2, 41) * 0.3) : tint(CITY.stoneTints[(seed >>> 3) % CITY.stoneTints.length], 0.78 + rnd(seed, 3, 41) * 0.12);
  const h = 0.95 + rnd(seed, 4, 41) * 0.45;
  const layer = wood ? 'wood' : 'ashlar';
  box(b, x, z, 0, 1, 0.16, 0.14, y - 0.2, y + h, layer, t, layer, { aoBottom: 0.7 });
  box(b, x, z, 0, 1, 0.62, 0.12, y + h - 0.42, y + h - 0.28, layer, t, layer);
  // Холмик — на «Высоком»: на прочих кресты стоят на траве.
  if (detail > 1) box(b, x, z - 1, 0, 1, 0.8, 1.7, y - 0.2, y + 0.12, 'dirt', tint(0xd8dcc8), 'grass', { aoBottom: 0.85 });
}

/** Гряда сада трав: дощатый борт и зелень — каждая гряда своим оттенком. */
function bed(b: Builder, x: number, z: number, w: number, d: number, k: number): void {
  const y = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2));
  // Тон поверх слоя листвы: шалфей, мята, рута, лук — от сизого до жёлто-зелёного.
  const greens = [0xe4ecd8, 0xf2f4d4, 0xd0dcc8, 0xfaf0c8, 0xdce8d0, 0xecf0e0];
  box(b, x, z, 0, 1, w, d, y - 0.2, y + 0.32, 'wood', tint(CITY.oakLight, 0.9), 'foliage', { aoBottom: 0.7 });
  box(b, x, z, 0, 1, w - 0.3, d - 0.3, y + 0.3, y + 0.42 + (k % 3) * 0.06, 'foliage', tint(greens[k % greens.length]), 'foliage', { aoBottom: 0.8 });
}

/**
 * Двор храма за оградой: стенка, кресты кладбища с запада, гряды сада трав, скамья и ульи с востока. Пишется под
 * владельцем «Храм» (подсветка выбора — вместе с храмом), но коробку касания не растит: двор — земля, а не здание.
 */
export function churchClose(b: Builder, c: Civic, detail: Detail): void {
  closeWall(b, c);
  // Кладбище: ряды крестов между оградой и храмом, у тисов — свободно. Холмики — только на «Высоком».
  const west = c.x - c.w / 2 - 2.2;
  const cols = detail === 0 ? [CLOSE.x0 + 4, CLOSE.x0 + 9.5] : detail === 1 ? [CLOSE.x0 + 3.2, CLOSE.x0 + 7.8, CLOSE.x0 + 12.4] : [CLOSE.x0 + 3, CLOSE.x0 + 6.4, CLOSE.x0 + 9.8, CLOSE.x0 + 13.2];
  const rows = detail === 0 ? 6 : detail === 1 ? 9 : 11;
  const step = (CLOSE.z0 - CLOSE.z1 - 14) / rows;
  let seed = c.seed;
  cols.forEach((x, ci) => {
    if (x > west) return;
    for (let k = 0; k < rows; k++) {
      const z = CLOSE.z0 - 5 - k * step - (ci % 2) * step * 0.5;
      if (Math.hypot(x + 24.5, z + 47) < 2.6 || Math.hypot(x + 21, z + 79) < 2.8) continue;
      seed = (seed * 1103515245 + 12345) >>> 0;
      cross(b, x + (rnd(seed, 5, 41) - 0.5) * 0.5, z + (rnd(seed, 6, 41) - 0.5) * 0.4, seed, detail);
    }
  });
  // Сад трав: гряды в два столбца у восточной ограды.
  const gx = [c.x + c.w / 2 + 4.2, c.x + c.w / 2 + 8.2];
  const gz = detail === 0 ? [-43, -49.5] : [-43, -49.5, -56];
  let n = 0;
  for (const z of gz) for (const x of gx) bed(b, x, z, 2.4, 4.6, n++);
  // Скамья у грядок и ульи-колоды на доске.
  const sy = heightAt(gx[0], -60.5);
  box(b, gx[0], -60.5, 0, 1, 2, 0.45, sy - 0.1, sy + 0.45, 'wood', tint(CITY.oak, 1.1), 'wood', { aoBottom: 0.65 });
  const hx = gx[1] + 0.6;
  const hy = heightAt(hx, -61);
  box(b, hx, -61, 1, 0, 3, 0.6, hy - 0.1, hy + 0.35, 'wood', tint(CITY.oak, 0.9), 'wood');
  const skeps = detail === 0 ? 2 : 3;
  for (let k = 0; k < skeps; k++) {
    const z = -62.2 + k * 1.1;
    cone(b, hx, z, 0.36, hy + 0.35, hy + 1.0, 6, 'cloth', tint(0xc8a860, 0.95), 0.75);
  }
}

/**
 * Площадка перед храмом и полоса у Верхней улицы — ничьё: доска объявлений у ограды, колодки у лотков, два лотка свечей
 * и крестиков по сторонам лестницы; коновязь, каменная поилка, стог и тюки сена, повозка и бочки — у дороги к замку.
 */
export function churchSquare(b: Builder, c: Civic, detail: Detail): void {
  const z0 = CLOSE.z0;
  // Доска объявлений: два столба, доска с листами и козырёк — у ограды справа от лестницы.
  const nx = c.x + PARVIS.half + 3.4;
  const nz = z0 + 0.9;
  const ny = heightAt(nx, nz);
  const oak = tint(CITY.oak);
  for (const s of [-1, 1]) log(b, [nx + s * 0.85, ny - 0.2, nz], [nx + s * 0.85, ny + 2.35, nz], 0.07, oak, 5, true);
  box(b, nx, nz, 0, 1, 1.9, 0.08, ny + 1.1, ny + 2.1, 'wood', tint(CITY.oakLight, 1.1), 'wood');
  const pent = tint(CITY.shingleTint);
  pushQuadOut(b, [nx - 1.15, ny + 2.3, nz - 0.25], [nx + 1.15, ny + 2.3, nz - 0.25], [nx + 1.15, ny + 2.1, nz + 0.4], [nx - 1.15, ny + 2.1, nz + 0.4], 'roofSlate', pent, [nx, ny + 6, nz + 2], 0.9);
  const sheets = detail === 0 ? 2 : 4;
  for (let k = 0; k < sheets; k++) {
    const px = nx - 0.6 + (k % 2) * 1.05 + rnd(k, 1, 43) * 0.15;
    const py = ny + 1.3 + Math.floor(k / 2) * 0.42;
    b.quad([px - 0.2, py, nz + 0.05], [px + 0.2, py, nz + 0.05], [px + 0.2, py + 0.32, nz + 0.05], [px - 0.2, py + 0.32, nz + 0.05], [0, 0, 0.2, 0, 0.2, 0.16, 0, 0.16], L.cloth, tint(0xece2c8, 0.95 + k * 0.02), [0.95, 0.95, 1, 1]);
  }
  // Колодки: низкая скамья и доска с прорезями для ног — слева от лестницы, на виду у площади.
  const kx = c.x - PARVIS.half - 6.5;
  const kz = z0 + 2.6;
  const ky = heightAt(kx, kz);
  for (const s of [-1, 1]) box(b, kx + s * 0.85, kz, 0, 1, 0.14, 0.14, ky - 0.2, ky + 0.75, 'wood', oak, 'wood', { aoBottom: 0.7 });
  box(b, kx, kz, 0, 1, 1.85, 0.1, ky + 0.25, ky + 0.62, 'wood', tint(CITY.oakLight, 0.95), 'wood');
  box(b, kx, kz - 0.75, 0, 1, 1.6, 0.36, ky - 0.1, ky + 0.42, 'wood', tint(CITY.oak, 1.1), 'wood', { aoBottom: 0.7 });
  // Лотки свечей и крестиков у ограды, лицом к площади.
  stall(b, { x: c.x - PARVIS.half - 3.2, z: z0 + 1.7, rot: 0, w: 2.6, seed: c.seed + 1 }, detail);
  if (detail > 0) stall(b, { x: c.x + PARVIS.half + 7.4, z: z0 + 1.7, rot: 0, w: 2.6, seed: c.seed + 2 }, detail);
  // Полоса у Верхней улицы: коновязь вдоль дороги, поилка, сено, повозка, бочки.
  const rx = CLOSE.x1 + 4.6;
  const rz0 = z0 - 5;
  const rz1 = z0 - 11;
  const posts = 3;
  const y0 = heightAt(rx, rz0);
  const y1 = heightAt(rx, rz1);
  for (let k = 0; k < posts; k++) {
    const f = k / (posts - 1);
    const z = rz0 + (rz1 - rz0) * f;
    const y = y0 + (y1 - y0) * f;
    log(b, [rx, y - 0.3, z], [rx, y + 1.15, z], 0.09, oak, 5, true);
  }
  log(b, [rx, y0 + 1.0, rz0 + 0.2], [rx, y1 + 1.0, rz1 - 0.2], 0.06, tint(CITY.oakLight), 5, true);
  // Поилка: каменная колода с тёмной водой.
  const tx = rx + 0.3;
  const tz = rz1 - 2.6;
  const ty = heightAt(tx, tz);
  box(b, tx, tz, 1, 0, 2.4, 0.85, ty - 0.2, ty + 0.62, 'rubble', tint(CITY.stoneTints[1], 0.85), null, { aoBottom: 0.65, grimeBottom: 0.9 });
  disc(b, [
    [tx - 0.33, tz - 1.1],
    [tx + 0.33, tz - 1.1],
    [tx + 0.33, tz + 1.1],
    [tx - 0.33, tz + 1.1],
  ], ty + 0.52, 'rubble', tint(0x24343a, 0.6));
  // Стог и тюки сена.
  const hx = rx - 2;
  const hz = tz - 4.2;
  const hy = heightAt(hx, hz);
  const straw = tint(0xc8b070, 0.92);
  cylinder(b, hx, hz, 1.35, hy - 0.1, hy + 1.1, detail === 0 ? 6 : 8, 'cloth', straw, { aoBottom: 0.7 });
  cone(b, hx, hz, 1.42, hy + 1.1, hy + 2.5, detail === 0 ? 6 : 8, 'cloth', [straw[0] * 1.06, straw[1] * 1.05, straw[2] * 1.0], 0.85);
  if (detail > 0) {
    for (let k = 0; k < 2; k++) box(b, hx + 1.9, hz - 0.6 + k * 1.15, 1, 0.15, 1.0, 0.6, hy - 0.05 + 0, hy + 0.5, 'cloth', [straw[0] * 0.95, straw[1] * 0.95, straw[2] * 0.9], 'cloth', { aoBottom: 0.7 });
  }
  cart(b, rx - 1.2, hz - 4.6, -Math.PI / 2 + 0.25, c.seed + 5, detail);
  const bn = detail === 0 ? 2 : 3;
  for (let k = 0; k < bn; k++) {
    const a = (k / bn) * Math.PI * 2;
    const x = CLOSE.x1 + 2.3 + Math.cos(a) * 0.45;
    const z = z0 - 2 + Math.sin(a) * 0.45;
    barrel(b, x, z, heightAt(x, z), c.seed + 9 + k, detail);
  }
}
