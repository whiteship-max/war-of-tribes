// Земля нового вида (docs/map_tw.md): шва между тайлами нет, озеро в клетку не пропадает, граница
// державы — замкнутая черта. Всё — на чистых функциях, без холста.
import { describe, expect, it } from 'vitest';
import type { Terrain } from '@/world/types';
import { WORLD_ORIGIN } from '@/world/data/tuning';
import { CELL_PAD, type Land, cellsFor, heightGrid, landAt, shade, shadowMargin, warpFor } from './field';
import { contour, soften } from './border';

const SEED = 20260912;
const X0 = WORLD_ORIGIN.x + 300;
const Y0 = WORLD_ORIGIN.y + 500;

/**
 * Земля под тестом: хребтовая страна посередине, море на юге, озеро в одну клетку и остров в одну
 * клетку, река поперёк равнины. Всего понемногу — чтобы свет, тень и берег было на чём проверить.
 */
function terrain(x: number, y: number): Terrain {
  const dx = x - (X0 + 20);
  const dy = y - (Y0 + 14);
  if (x === X0 + 6 && y === Y0 + 6) return 'water';
  if (x === X0 + 30 && y === Y0 + 33) return 'plain';
  if (y > Y0 + 28) return 'water';
  if (dx * dx + dy * dy < 49) return 'mountains';
  if (dx * dx + dy * dy < 100) return 'hills';
  return (x + y) % 7 === 0 ? 'forest' : 'plain';
}
const LAND: Land = {
  sample: terrain,
  river: (x, y) => y === Y0 + 24 && x < X0 + 16,
  ridge: (x, y) => y === Y0 + 14 && Math.abs(x - (X0 + 20)) < 5,
};

/** Решётка и краска окна `side` клеток с левым верхним углом (x, y) — как печёт её тайл. */
function bakeWindow(x: number, y: number, side: number, nodes: number) {
  const step = 1 / nodes;
  const n = side * nodes;
  const ml = shadowMargin(nodes) + 1;
  const nx = n + ml + 1;
  const gx0 = x + 0.5 * step - ml * step;
  const gy0 = y + 0.5 * step - ml * step;
  const cx0 = Math.floor(gx0) - CELL_PAD;
  const cy0 = Math.floor(gy0) - CELL_PAD;
  const cw = Math.ceil(gx0 + nx * step) + CELL_PAD - cx0;
  const cells = cellsFor(SEED, LAND, cx0, cy0, cw, cw, 0);
  const warp = warpFor(SEED, cx0, cy0, cw, cw);
  const grid = heightGrid(SEED, cells, warp, gx0, gy0, nx, nx, step);
  const land = new Uint8ClampedArray(n * n * 4);
  const water = new Uint8ClampedArray(n * n * 4);
  shade(SEED, cells, grid, { i0: ml, j0: ml, w: n, h: n }, { season: 0, castShadow: true }, land, water);
  return { n, ml, grid, land, cells };
}

describe('земля нового вида', () => {
  it('шва между тайлами нет: соседние окна в общей части дают одну высоту и один цвет', () => {
    const nodes = 8;
    const side = 12;
    // Второе окно сдвинуто на четыре клетки вправо и три вниз: общая часть — 8 × 9 клеток.
    const a = bakeWindow(X0 + 12, Y0 + 6, side, nodes);
    const b = bakeWindow(X0 + 16, Y0 + 9, side, nodes);
    const sx = 4 * nodes;
    const sy = 3 * nodes;
    let lo = Infinity;
    let hi = -Infinity;
    const lums: number[] = [];
    for (let j = 0; j < a.n - sy; j++) {
      for (let i = 0; i < a.n - sx; i++) {
        const ka = (a.ml + sy + j) * a.grid.nx + (a.ml + sx + i);
        const kb = (b.ml + j) * b.grid.nx + (b.ml + i);
        expect(b.grid.h[kb]).toBeCloseTo(a.grid.h[ka], 5);
        const pa = ((sy + j) * a.n + (sx + i)) * 4;
        const pb = (j * b.n + i) * 4;
        for (let c = 0; c < 3; c++) expect(Math.abs(b.land[pb + c] - a.land[pa + c])).toBeLessThanOrEqual(1);
        lo = Math.min(lo, a.grid.h[ka]);
        hi = Math.max(hi, a.grid.h[ka]);
        lums.push(a.land[pa] + a.land[pa + 1] + a.land[pa + 2]);
      }
    }
    // Область, где правило вообще спрашивается: в общей части есть горы — перепад высот, склоны на свету
    // и в тени. На равнине шов было бы нечем показать, и тест прошёл бы при любом коде.
    expect(hi - lo, 'перепад высот в общей части').toBeGreaterThan(0.6);
    lums.sort((x, y) => x - y);
    const p5 = lums[Math.floor(lums.length * 0.05)];
    const p95 = lums[Math.floor(lums.length * 0.95)];
    expect(p95 - p5, 'склоны на свету и в тени: разброс яркости').toBeGreaterThan(120);
  });

  it('озеро в одну клетку остаётся водой, остров в одну клетку — сушей', () => {
    const cells = cellsFor(SEED, LAND, X0, Y0, 40, 40, 0);
    expect(cells.code[6 * 40 + 6], 'озеро на месте в данных').toBe(0);
    expect(landAt(cells, X0 + 6.5, Y0 + 6.5)).toBeLessThan(0.5);
    expect(landAt(cells, X0 + 30.5, Y0 + 33.5)).toBeGreaterThan(0.5);
    // И вокруг них — то, что вокруг: равнина у озера, море у острова.
    expect(landAt(cells, X0 + 8.5, Y0 + 6.5)).toBeGreaterThan(0.5);
    expect(landAt(cells, X0 + 33.5, Y0 + 33.5)).toBeLessThan(0.5);
  });

  it('снег на севере лежит ниже: линия снега падает с широтой и зимой', () => {
    const south = cellsFor(SEED, LAND, WORLD_ORIGIN.x + 400, WORLD_ORIGIN.y + 700, 4, 4, 0);
    const north = cellsFor(SEED, LAND, WORLD_ORIGIN.x + 400, WORLD_ORIGIN.y + 150, 4, 4, 0);
    const winter = cellsFor(SEED, LAND, WORLD_ORIGIN.x + 400, WORLD_ORIGIN.y + 700, 4, 4, 1);
    expect(north.snow[5]).toBeLessThan(south.snow[5]);
    expect(winter.snow[5]).toBeLessThan(south.snow[5]);
  });
});

describe('граница державы', () => {
  it('черта по краю владения замкнута: у каждого конца отрезка есть пара', () => {
    const w = 16;
    const f = new Float32Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) f[j * w + i] = Math.hypot(i - 7.5, j - 7.5) < 5 ? 1 : 0;
    const segs = contour(soften(f, w, w), w, w, 0, 0);
    expect(segs.length).toBeGreaterThan(20);
    const key = (x: number, y: number): string => `${x.toFixed(4)}:${y.toFixed(4)}`;
    const ends = new Map<string, number>();
    for (const [ax, ay, bx, by] of segs) {
      ends.set(key(ax, ay), (ends.get(key(ax, ay)) ?? 0) + 1);
      ends.set(key(bx, by), (ends.get(key(bx, by)) ?? 0) + 1);
    }
    for (const n of ends.values()) expect(n).toBe(2);
  });
});
