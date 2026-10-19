// Храм лицом к площади (docs/city_v3.md, Г-2) и убранство Соборной площади вокруг него (Г-8): паперть с лестницей на
// площадь; по краям площади, у фасадов и не на проходе, — доска объявлений и свечные лотки в кармане у Западной улицы,
// колодки у углового дома при Верхней, коновязь с поилкой у рядов рынка. Двора с оградой, кладбища и сада трав больше нет:
// храм стоит на мостовой среди домов. Один вид навсегда: уровни игры его не меняют, уровень качества — только число мелочи.
import { CITY } from './palette';
import { box, disc, tint, type Builder, type V3 } from './geom';
import { log, pushQuadOut, type Detail } from './kit';
import { PARVIS, SQUARE_PROPS, heightAt, type Civic } from './layout';
import { L } from './tex';
import { rnd } from './noise';
import { barrel, stall } from './civic';

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

/**
 * Убранство Соборной площади — ничьё, как ступени домов: тап мимо него не открывает чужую постройку. Доска объявлений с
 * листами под козырьком и свечные лотки — в кармане у Западной улицы, колодки — у Верхней, коновязь, каменная поилка и
 * бочки — у западного края рынка, где ставят коней торговцы.
 */
export function churchSquare(b: Builder, c: Civic, detail: Detail): void {
  const P = SQUARE_PROPS;
  const oak = tint(CITY.oak);
  // Доска объявлений: два столба, доска с листами и козырёк — у фасада углового дома кармана, лицом на юг.
  const nx = P.board.x;
  const nz = P.board.z;
  const ny = heightAt(nx, nz);
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
  // Лотки свечей и крестиков — лицом к храму, вдоль западного края кармана.
  P.stalls.forEach((s, k) => {
    if (k > 0 && detail === 0) return;
    stall(b, { x: s.x, z: s.z, rot: -Math.PI / 2, w: 2.6, seed: c.seed + 1 + k }, detail);
  });
  // Колодки: низкая скамья и доска с прорезями для ног — у углового дома при Верхней, на виду у площади.
  const kx = P.stocks.x;
  const kz = P.stocks.z;
  const ky = heightAt(kx, kz);
  for (const s of [-1, 1]) box(b, kx + s * 0.85, kz, 0, 1, 0.14, 0.14, ky - 0.2, ky + 0.75, 'wood', oak, 'wood', { aoBottom: 0.7 });
  box(b, kx, kz, 0, 1, 1.85, 0.1, ky + 0.25, ky + 0.62, 'wood', tint(CITY.oakLight, 0.95), 'wood');
  box(b, kx, kz - 0.6, 0, 1, 1.6, 0.36, ky - 0.1, ky + 0.42, 'wood', tint(CITY.oak, 1.1), 'wood', { aoBottom: 0.7 });
  // Коновязь вдоль западного края рынка: три столба и жердь.
  const { x: rx, z0: rz0, z1: rz1 } = P.rail;
  const y0 = heightAt(rx, rz0);
  const y1 = heightAt(rx, rz1);
  const posts = 3;
  for (let k = 0; k < posts; k++) {
    const f = k / (posts - 1);
    const z = rz0 + (rz1 - rz0) * f;
    const y = y0 + (y1 - y0) * f;
    log(b, [rx, y - 0.3, z], [rx, y + 1.15, z], 0.09, oak, 5, true);
  }
  log(b, [rx, y0 + 1.0, rz0 - 0.2], [rx, y1 + 1.0, rz1 + 0.2], 0.06, tint(CITY.oakLight), 5, true);
  // Поилка: каменная колода с тёмной водой — в конце коновязи.
  const tx = P.trough.x;
  const tz = P.trough.z;
  const ty = heightAt(tx, tz);
  box(b, tx, tz, 1, 0, 2.4, 0.85, ty - 0.2, ty + 0.62, 'rubble', tint(CITY.stoneTints[1], 0.85), null, { aoBottom: 0.65, grimeBottom: 0.9 });
  disc(b, [
    [tx - 0.33, tz - 1.1],
    [tx + 0.33, tz - 1.1],
    [tx + 0.33, tz + 1.1],
    [tx - 0.33, tz + 1.1],
  ], ty + 0.52, 'rubble', tint(0x24343a, 0.6));
  // Бочки с овсом и водой — у коновязи, к фасаду.
  const bn = detail === 0 ? 2 : 3;
  for (let k = 0; k < bn; k++) {
    const x = rx - 1.3;
    const z = rz0 - 0.4 + k * 0.8;
    barrel(b, x, z, heightAt(x, z), c.seed + 9 + k, detail);
  }
}
