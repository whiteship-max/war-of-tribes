// Большие здания и убранство площади вида «город» (docs/city.md, разделы 2 и 5): храм с западной
// башней и шпилем, ратуша с аркадой и ступенчатыми щипцами, Хлебный дом, цеховой дом, кузница,
// конюшня, трактир, госпиталь, палас и казармы замка; торговые ряды, колодец, огненная чаша, «Роланд»,
// паперть и двор храма — `precinct.ts`. Один вид навсегда: уровни игры модель не меняют.
import { CITY } from './palette';
import { Builder, box, cone, cylinder, disc, pyramid, ring, tint, type V3 } from './geom';
import { Frame, GROUND_H, STOREY_H, chimney, face, gableRoof, gableTri, log, pushQuadOut, stoop, type Detail } from './kit';
import { footSpan, heightAt, type Civic, type P, type Stall } from './layout';
import { L, TILE_M, type LayerName } from './tex';
import { rnd } from './noise';

export interface Storey {
  h: number;
  front: LayerName;
  side: LayerName;
  back?: LayerName;
}

export interface Body {
  storeys: Storey[];
  wallHex: number;
  roof: { pitch: number; layer: 'roofTile' | 'roofSlate'; hex: number; alongF: boolean };
  stepped?: boolean;
  dormers?: number;
  chimneys?: number;
  turret?: boolean;
  glow?: number;
}

const lowUnder = (fr: Frame, w: number, d: number): number => footSpan(fr.cx, fr.cz, fr.fx, fr.fz, w, d).lo;

/**
 * Ступени к главной двери большого здания или дома двора, если пол (над самой высокой землёй следа,
 * `layout.footSpan`) выше земли перед фасадом. Мимо коробки касания (`budget.buildStatic`), как у домов.
 */
export function civicStoop(b: Builder, c: Civic): void {
  const fr = new Frame(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
  const [sx, sz] = fr.q(c.d / 2 + 1, 0);
  stoop(b, fr, c.d / 2 + 0.08, Math.min(c.w * 0.4, 6), heightAt(sx, sz), c.base, tint(CITY.stoneTints[1], 0.86));
}

/** Коробка большого здания по этажам, кровля, щипцы (простые или ступенчатые), трубы, слуховые окна. */
export function body(b: Builder, c: Civic, s: Body, detail: Detail): { top: number; ridge: number; chimneys: V3[] } {
  const fr = new Frame(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
  const hw = c.w / 2;
  const hd = c.d / 2;
  const T = tint(s.wallHex);
  const base = c.base;
  const low = lowUnder(fr, c.w, c.d);
  box(b, c.x, c.z, fr.fx, fr.fz, c.w + 0.16, c.d + 0.16, low - 0.5, base + 0.35, 'rubble', tint(CITY.stoneTints[1], 0.86), null, { aoBottom: 0.7, grimeBottom: 1, grimeTop: 0.4 });
  let y = base;
  s.storeys.forEach((st, k) => {
    const y1 = y + st.h;
    const o = { span: true, vTile: st.h, vBase: y, aoB: k === 0 ? 0.76 : 0.9, aoT: k === s.storeys.length - 1 ? 0.8 : 0.97, glow: s.glow ?? 1, grimeB: k === 0 ? 0.7 : 0 };
    face(b, fr, [hd, -hw], [hd, hw], y, y1, st.front, T, o);
    face(b, fr, [hd, hw], [-hd, hw], y, y1, st.side, T, o);
    face(b, fr, [-hd, hw], [-hd, -hw], y, y1, st.back ?? st.side, T, o);
    face(b, fr, [-hd, -hw], [hd, -hw], y, y1, st.side, T, o);
    y = y1;
  });
  const roofT = tint(s.roof.hex);
  const r = gableRoof(b, fr, -hd, hd, -hw, hw, y, s.roof.pitch, s.roof.alongF, s.roof.layer, roofT, detail, c.seed);
  const gl = s.storeys[s.storeys.length - 1].side;
  const gableLayer: LayerName = s.stepped ? 'ashlar' : gl;
  // Щипцы: на концах конька.
  const ends: [[number, number], [number, number]][] = s.roof.alongF
    ? [
        [
          [hd, -hw],
          [hd, hw],
        ],
        [
          [-hd, hw],
          [-hd, -hw],
        ],
      ]
    : [
        [
          [hd, hw],
          [-hd, hw],
        ],
        [
          [-hd, -hw],
          [hd, -hw],
        ],
      ];
  for (const [a, e] of ends) gableTri(b, fr, a, e, y, r.ridge, gableLayer, T, y, STOREY_H, 0);
  if (s.stepped) {
    const n = 6;
    const span = s.roof.alongF ? c.w : c.d;
    const step = r.rise / n;
    for (const sign of [1, -1]) {
      for (let k = 0; k < n; k++) {
        const wk = span * (1 - k / n) - 0.2;
        const y0 = y + k * step;
        const y1 = y0 + step + 0.55;
        if (s.roof.alongF) {
          const [x, z] = fr.q(sign * (hd - 0.35), 0);
          box(b, x, z, fr.fx, fr.fz, wk, 0.7, y0, y1, 'ashlar', T, 'ashlar', { aoBottom: 0.9 });
        } else {
          const [x, z] = fr.q(0, sign * (hw - 0.35));
          box(b, x, z, fr.fz, -fr.fx, wk, 0.7, y0, y1, 'ashlar', T, 'ashlar', { aoBottom: 0.9 });
        }
      }
    }
  }
  const chimneys: V3[] = [];
  for (let k = 0; k < (s.chimneys ?? 0); k++) {
    const f = s.roof.alongF ? (k === 0 ? -hd * 0.5 : hd * 0.5) : 0;
    const rr = s.roof.alongF ? 0 : k === 0 ? -hw * 0.5 : hw * 0.5;
    const [x, z] = fr.q(f, rr);
    const top = r.ridge + 1;
    chimney(b, x, z, y + 0.5, top, c.rot, tint(CITY.stoneTints[2], 0.9), detail);
    chimneys.push([x, top + 0.3, z]);
  }
  if (s.turret && detail > 0) {
    // Башенка на коньке: восьмигранник и шпиль.
    const [x, z] = fr.q(0, 0);
    cylinder(b, x, z, 1.1, r.ridge - 1.5, r.ridge + 2.2, 8, 'wood', tint(CITY.timberGrey, 1.1), { aoBottom: 0.7 });
    cone(b, x, z, 1.35, r.ridge + 2.1, r.ridge + 7.5, 8, 'roofSlate', tint(CITY.slateTint));
  }
  if ((s.dormers ?? 0) > 0 && detail > 0) {
    // Слуховые окна-«глаза» в несколько рядов по скатам (Хлебный дом).
    const rows = s.dormers ?? 0;
    const tp = Math.tan(s.roof.pitch);
    for (let row = 0; row < rows; row++) {
      const along = s.roof.alongF ? c.d : c.w;
      const across = s.roof.alongF ? hw : hd;
      const cnt = Math.max(2, Math.round(along / 4.5) - row);
      for (const side of [1, -1]) {
        for (let k = 0; k < cnt; k++) {
          const l = -along / 2 + ((k + 0.5) / cnt) * along;
          const cOff = across * (0.72 - row * 0.3);
          const yy = y + (across - cOff) * tp;
          const pos = s.roof.alongF ? fr.p(l, side * cOff, yy) : fr.p(side * cOff, l, yy);
          const out: V3 = s.roof.alongF ? fr.p(l, side * (cOff + 3), yy) : fr.p(side * (cOff + 3), l, yy);
          ventDormer(b, pos, out, roofT);
        }
      }
    }
  }
  return { top: y, ridge: r.ridge, chimneys };
}

/** Слуховой «глаз»: тёмный треугольник отверстия и козырёк над ним — читается рядом точек на кровле. */
function ventDormer(b: Builder, p: V3, toward: V3, roofT: V3): void {
  const dx = toward[0] - p[0];
  const dz = toward[2] - p[2];
  const l = Math.hypot(dx, dz) || 1;
  const fx = dx / l;
  const fz = dz / l;
  const rx = fz;
  const rz = -fx;
  const w = 0.55;
  const h = 0.55;
  const A: V3 = [p[0] - rx * w + fx * 0.05, p[1] + 0.02, p[2] - rz * w + fz * 0.05];
  const B: V3 = [p[0] + rx * w + fx * 0.05, p[1] + 0.02, p[2] + rz * w + fz * 0.05];
  const C: V3 = [p[0] + fx * 0.05, p[1] + h, p[2] + fz * 0.05];
  b.tri(A, B, C, [0.2, 0.3, 0.3, 0.3, 0.25, 0.5], L.groundDoor, tint(CITY.glass, 0.6), [0.4, 0.4, 0.4]);
  const R0: V3 = [p[0] - rx * (w + 0.15) + fx * 0.25, p[1] - 0.05, p[2] - rz * (w + 0.15) + fz * 0.25];
  const R1: V3 = [p[0] + rx * (w + 0.15) + fx * 0.25, p[1] - 0.05, p[2] + rz * (w + 0.15) + fz * 0.25];
  const R2: V3 = [p[0] - fx * 0.6, p[1] + h + 0.35, p[2] - fz * 0.6];
  pushQuadOut(b, R0, R1, R2, R2, 'roofTile', roofT, [p[0] + fx * 2, p[1] + 2, p[2] + fz * 2], 0.95);
}

/**
 * Храм лицом к площади (docs/city_v3.md, Г-2): западная башня со шпилем и порталом — к фасаду (`c.rot`, к площади и
 * камере), неф с контрфорсами уходит вглубь, апсида — в дальнем конце. `c.w` — ширина фасада, `c.d` — длина храма.
 */
function church(b: Builder, c: Civic, detail: Detail): V3[] {
  // Рамка нефа: ось r — от фасада вглубь (r < 0 — башня у площади, r > 0 — апсида), f — поперёк нефа.
  const fr = new Frame(c.x, c.z, Math.sin(c.rot), -Math.cos(c.rot));
  const len = c.d;
  const T = tint(CITY.stoneTints[0]);
  const base = c.base;
  const low = footSpan(c.x, c.z, fr.fx, fr.fz, len, c.w).lo;
  const tw = 9.5;
  const westEnd = -len / 2;
  const naveW = 15;
  const naveH = 13;
  const r0 = westEnd + tw;
  const r1 = len / 2 - 6.5;
  const hd = naveW / 2;
  // Цоколь нефа.
  const [nx, nz] = fr.q(0, (r0 + r1) / 2);
  box(b, nx, nz, fr.fx, fr.fz, r1 - r0 + 0.3, naveW + 0.3, low - 0.5, base + 0.5, 'rubble', tint(CITY.stoneTints[1], 0.85), null, { aoBottom: 0.7, grimeBottom: 1 });
  // Стены нефа: длинные — с окнами храма, торцы — кладка.
  const o = { span: false, vTile: 12, vBase: base, aoB: 0.75, aoT: 0.85, glow: 0.8, grimeB: 0.6 };
  face(b, fr, [hd, r0], [hd, r1], base, base + naveH, 'churchWin', T, { ...o, span: true });
  face(b, fr, [-hd, r1], [-hd, r0], base, base + naveH, 'churchWin', T, { ...o, span: true });
  face(b, fr, [-hd, r0], [hd, r0], base, base + naveH, 'ashlar', T, o);
  // Контрфорсы между окнами: по шагу плитки (4 м), уступом.
  const n = Math.floor((r1 - r0) / 4);
  for (let k = 0; k <= n; k++) {
    const rr = r0 + ((r1 - r0) * k) / n;
    for (const side of [1, -1]) {
      const [x, z] = fr.q(side * (hd + 0.7), rr);
      box(b, x, z, fr.fx * side, fr.fz * side, 1.1, 1.4, low - 0.3, base + naveH - 3, 'ashlar', T, 'ashlar', { aoBottom: 0.7, grimeBottom: 0.8 });
      const [x2, z2] = fr.q(side * (hd + 0.45), rr);
      box(b, x2, z2, fr.fx * side, fr.fz * side, 1.0, 0.9, base + naveH - 3, base + naveH - 0.6, 'ashlar', T, 'ashlar');
    }
  }
  // Кровля нефа: конёк вдоль r, сланец.
  const roofT = tint(CITY.slateTint);
  const rr = gableRoof(b, fr, -hd, hd, r0, r1, base + naveH, (56 * Math.PI) / 180, false, 'roofSlate', roofT, detail, c.seed, { eave: 0.6, verge: 0.2 });
  gableTri(b, fr, [-hd, r0], [hd, r0], base + naveH, rr.ridge, 'ashlar', T, base, 4, 0);
  // Апсида: половина восьмиугольника на восток, стены с окнами и полушатёр.
  const ar = hd;
  const segs = 4;
  const ac = r1;
  const apts: [number, number][] = [];
  for (let k = 0; k <= segs; k++) {
    const a = -Math.PI / 2 + (k / segs) * Math.PI;
    apts.push([Math.sin(-a) * ar, ac + Math.cos(a) * ar]);
  }
  for (let k = 0; k < segs; k++) {
    const p = apts[k];
    const q = apts[k + 1];
    face(b, fr, [p[0], p[1]], [q[0], q[1]], base, base + naveH - 1.5, 'churchWin', T, { vTile: 12, vBase: base - 1, aoB: 0.75, aoT: 0.85, glow: 0.8, grimeB: 0.6 });
  }
  const apex = fr.p(0, ac, base + naveH - 1.5 + ar * Math.tan((50 * Math.PI) / 180));
  for (let k = 0; k < segs; k++) {
    const p = fr.p(apts[k][0] * 1.06, ac + (apts[k][1] - ac) * 1.06, base + naveH - 1.7);
    const q = fr.p(apts[k + 1][0] * 1.06, ac + (apts[k + 1][1] - ac) * 1.06, base + naveH - 1.7);
    const [tw2, th2] = TILE_M.roofSlate;
    const w = Math.hypot(q[0] - p[0], q[2] - p[2]);
    const tri = (A: V3, B: V3, C: V3): void => {
      const ux = B[0] - A[0];
      const uz = B[2] - A[2];
      const vx = C[0] - A[0];
      const vy = C[1] - A[1];
      const vz = C[2] - A[2];
      const ny = uz * vx - ux * vz;
      void vy;
      if (ny >= 0) b.tri(A, B, C, [0, 0, w / tw2, 0, w / tw2 / 2, 8 / th2], L.roofSlate, roofT, [0.8, 0.8, 1]);
      else b.tri(B, A, C, [0, 0, w / tw2, 0, w / tw2 / 2, 8 / th2], L.roofSlate, roofT, [0.8, 0.8, 1]);
    };
    tri(p, q, apex);
  }
  // Западная башня: кладка с бойницами, ярус звона с проёмами, пояс, восьмигранный шпиль.
  const [tx, tz] = fr.q(0, westEnd + tw / 2);
  const towerTop = base + 33;
  box(b, tx, tz, fr.fx, fr.fz, tw, tw, low - 0.5, towerTop - 4.5, 'towerSlit', T, null, { aoBottom: 0.72, grimeBottom: 0.8, vBase: low - 0.5 });
  box(b, tx, tz, fr.fx, fr.fz, tw, tw, towerTop - 4.5, towerTop, 'stoneWin', T, null, { vBase: towerTop - 4.5, vTile: 3.4 });
  box(b, tx, tz, fr.fx, fr.fz, tw + 0.6, tw + 0.6, towerTop, towerTop + 0.7, 'ashlar', T, 'ashlar', { aoBottom: 0.55 });
  const sp: [number, number][] = [];
  const sr = tw / 2 - 0.2;
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    sp.push([tx + Math.cos(a) * sr, tz + Math.sin(a) * sr]);
  }
  sp.reverse();
  // Обход против часовой сверху: в плане (x, z) — по убыванию угла.
  pyramid(b, sp, towerTop + 0.6, [tx, towerTop + 24, tz], 'roofSlate', roofT, 0.75);
  if (detail > 0) {
    for (const [a, e] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const [x, z] = fr.q(a * (tw / 2 - 0.4), westEnd + tw / 2 + e * (tw / 2 - 0.4));
      cone(b, x, z, 0.55, towerTop + 0.7, towerTop + 5, 6, 'roofSlate', roofT, 0.8);
    }
    cone(b, tx, tz, 0.12, towerTop + 23.5, towerTop + 26, 4, 'wood', tint(CITY.stainGold, 1.3), 1);
  }
  portal(b, fr, westEnd, base, low, T, detail);
  // Факелы по сторонам портала, на лице башни.
  return [fr.p(-3.75, westEnd - 0.12, base + 3.3), fr.p(3.75, westEnd - 0.12, base + 3.3)];
}

/** Стрельчатый проём в плоскости `r` рамки: полуширина `hw`, пята арки на `ys`, вершина на `ya` (от `y0`). */
function archOutline(hw: number, ys: number, ya: number): [number, number][] {
  return [
    [-hw, 0],
    [hw, 0],
    [hw, ys],
    [0, ya],
    [-hw, ys],
  ];
}

/**
 * Портал башни храма: выступ кладки с щипцом-вимпергом, стрельчатый проём в два уступа с колонками, в проёме — тёмная
 * глубина храма (ночью — свет свечей, плиткой проезда ворот) и распахнутая правая створка; левая закрыта. Лицом — к `−r`.
 */
function portal(b: Builder, fr: Frame, westEnd: number, base: number, low: number, T: V3, detail: Detail): void {
  const dep = 0.9;
  const hw = 3;
  const ph = 7.2;
  const face0 = westEnd - dep;
  const [bx, bz] = fr.q(0, westEnd - dep / 2);
  // Лицо выступа смотрит к площади: «вперёд» коробки — по −r рамки.
  const ox = -fr.fz;
  const oz = fr.fx;
  box(b, bx, bz, ox, oz, hw * 2, dep, low - 0.3, base + ph, 'ashlar', T, 'ashlar', { aoBottom: 0.72, grimeBottom: 0.6 });
  // Вимперг над порталом: щипец в плоскости лица и два ската до стены башни.
  const apex = base + ph + 3.1;
  gableTri(b, fr, [-hw - 0.15, face0 - 0.02], [hw + 0.15, face0 - 0.02], base + ph, apex, 'ashlar', T, base, 4, 0);
  const A = fr.p(-hw - 0.15, face0 - 0.02, base + ph);
  const E = fr.p(hw + 0.15, face0 - 0.02, base + ph);
  const M = fr.p(0, face0 - 0.02, apex);
  const A2 = fr.p(-hw - 0.15, westEnd, base + ph);
  const E2 = fr.p(hw + 0.15, westEnd, base + ph);
  const M2 = fr.p(0, westEnd, apex);
  const up: V3 = [M[0], M[1] + 5, M[2]];
  pushQuadOut(b, A, M, M2, A2, 'roofSlate', tint(CITY.slateTint), up, 0.85);
  pushQuadOut(b, M, E, E2, M2, 'roofSlate', tint(CITY.slateTint), up, 0.85);
  if (detail > 0) cone(b, M[0], M[2], 0.22, apex - 0.1, apex + 0.9, 4, 'ashlar', T, 0.9);
  // Проём: тёмная глубина и створки — чуть впереди лица выступа.
  const P = (f: number, y: number, d: number): V3 => fr.p(f, face0 - d, base + y);
  const ow = 1.45;
  const ys = 3.4;
  const ya = 4.95;
  const [, th] = TILE_M.gateArch;
  // UV — кусок хода плитки проезда ворот ниже решётки (u 0.38..0.62, v до 3.5 м плитки).
  const v1 = 3.5 / th;
  const vs = (ys / ya) * v1;
  b.quad(P(-ow, 0, 0.03), P(ow, 0, 0.03), P(ow, ys, 0.03), P(-ow, ys, 0.03), [0.38, 0.01, 0.62, 0.01, 0.62, vs, 0.38, vs], L.gateArch, T, [0.6, 0.6, 0.9, 0.9], 0.4);
  b.tri(P(-ow, ys, 0.03), P(ow, ys, 0.03), P(0, ya, 0.03), [0.38, vs, 0.62, vs, 0.5, v1], L.gateArch, T, [0.9, 0.9, 1], 0.4);
  // Левая створка — закрыта, дуб с полосами железа; правая распахнута внутрь (её не видно).
  const oak = tint(CITY.oak, 0.85);
  b.quad(P(-ow, 0, 0.05), P(0, 0, 0.05), P(0, ys, 0.05), P(-ow, ys, 0.05), [0, 0, 0.7, 0, 0.7, 1.7, 0, 1.7], L.wood, oak, [0.7, 0.7, 0.95, 0.95]);
  b.tri(P(-ow, ys, 0.05), P(0, ys, 0.05), P(0, ya, 0.05), [0, 1.7, 0.7, 1.7, 0.7, 2.5], L.wood, oak, [0.95, 0.95, 1]);
  // Уступы обрамления: два ряда клинчатых камней по контуру проёма, внешний выступает сильнее.
  for (const [off, d, k] of [
    [0.38, 0.1, 1.08],
    [0.78, 0.18, 0.96],
  ] as const) {
    const inner = archOutline(ow + off - 0.38, ys, ya + off - 0.38);
    const outer = archOutline(ow + off, ys, ya + off + 0.1);
    const t2 = tint(CITY.stoneTints[0], k);
    // Косяки и два ската арки: от внутреннего контура к внешнему.
    for (const [i, j] of [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ] as const) {
      const a0 = P(inner[i][0], inner[i][1], d);
      const a1 = P(inner[j][0], inner[j][1], d);
      const e1 = P(outer[j][0], outer[j][1], d);
      const e0 = P(outer[i][0], outer[i][1], d);
      const toward = fr.p(0, face0 - 5, base + 2);
      pushQuadOut(b, e0, e1, a1, a0, 'ashlar', t2, toward, 0.92);
    }
  }
  // Колонки в уступах — со среднего уровня.
  if (detail > 0) {
    for (const s of [-1, 1]) {
      const [cx, cz] = fr.q(s * (ow + 0.58), face0 - 0.2);
      cylinder(b, cx, cz, 0.13, base, base + ys, 6, 'ashlar', tint(CITY.stoneTints[2], 1.05));
    }
  }
}

/** Ратуша: аркада к площади, верхний этаж с окнами, высокая кровля, ступенчатые щипцы, башенка. */
function hall(b: Builder, c: Civic, detail: Detail): V3[] {
  const r = body(
    b,
    c,
    {
      storeys: [
        { h: 4.4, front: 'arcade', side: 'ashlar' },
        { h: 3.4, front: 'stoneWin', side: 'stoneWin' },
        { h: 3.2, front: 'stoneWin', side: 'stoneWin' },
      ],
      wallHex: CITY.stoneTints[3],
      roof: { pitch: (57 * Math.PI) / 180, layer: 'roofTile', hex: CITY.roofTints[3], alongF: false },
      stepped: true,
      turret: true,
      chimneys: 2,
    },
    detail,
  );
  const fr = new Frame(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
  return [fr.p(c.d / 2 + 0.4, -c.w / 4, c.base + 3), fr.p(c.d / 2 + 0.4, c.w / 4, c.base + 3), ...r.chimneys.slice(0, 0)];
}

const CIVIC_BODY: Partial<Record<Civic['kind'], Body>> = {
  granary: {
    storeys: [
      { h: GROUND_H, front: 'groundDoor', side: 'rubble' },
      { h: STOREY_H, front: 'timberC', side: 'timberC' },
    ],
    wallHex: CITY.stoneTints[1],
    roof: { pitch: (60 * Math.PI) / 180, layer: 'roofTile', hex: CITY.roofTints[5], alongF: false },
    dormers: 2,
  },
  guild: {
    storeys: [
      { h: GROUND_H, front: 'groundDoor', side: 'rubble' },
      { h: 3.2, front: 'stoneWin', side: 'stoneWin' },
      { h: 3.0, front: 'stoneWin', side: 'stoneWin' },
    ],
    wallHex: CITY.stoneTints[2],
    roof: { pitch: (55 * Math.PI) / 180, layer: 'roofTile', hex: CITY.roofTints[4], alongF: true },
    stepped: true,
    chimneys: 1,
  },
  smithy: {
    storeys: [{ h: 4, front: 'groundDoor', side: 'rubble' }],
    wallHex: CITY.stoneTints[1],
    roof: { pitch: (42 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
    chimneys: 1,
  },
  stable: {
    storeys: [{ h: 3.8, front: 'timberC', side: 'timberC' }],
    wallHex: CITY.wallTints[1],
    roof: { pitch: (48 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
  },
  tavern: {
    storeys: [
      { h: GROUND_H, front: 'groundDoor', side: 'plaster' },
      { h: STOREY_H, front: 'timberA', side: 'timberA' },
      { h: STOREY_H, front: 'timberA', side: 'timberA' },
    ],
    wallHex: CITY.wallTints[2],
    roof: { pitch: (55 * Math.PI) / 180, layer: 'roofTile', hex: CITY.roofTints[1], alongF: true },
    chimneys: 2,
  },
  spital: {
    storeys: [
      { h: GROUND_H, front: 'groundDoor', side: 'rubble' },
      { h: 3.2, front: 'stoneWin', side: 'stoneWin' },
    ],
    wallHex: CITY.stoneTints[0],
    roof: { pitch: (52 * Math.PI) / 180, layer: 'roofTile', hex: CITY.roofTints[3], alongF: false },
    turret: true,
    chimneys: 1,
  },
  palas: {
    storeys: [
      { h: GROUND_H, front: 'rubble', side: 'rubble' },
      { h: 3.4, front: 'stoneWin', side: 'stoneWin' },
      { h: 3.4, front: 'stoneWin', side: 'stoneWin' },
    ],
    wallHex: CITY.stoneTints[0],
    roof: { pitch: (58 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.slateTint, alongF: false },
    chimneys: 2,
  },
  barracks: {
    storeys: [
      { h: GROUND_H, front: 'groundDoor', side: 'rubble' },
      { h: STOREY_H, front: 'stoneWin', side: 'stoneWin' },
    ],
    wallHex: CITY.stoneTints[2],
    roof: { pitch: (50 * Math.PI) / 180, layer: 'roofTile', hex: CITY.roofTints[4], alongF: false },
    chimneys: 1,
  },
};

/** Большое здание по виду; возвращает точки трубного дыма и огней. */
export function civic(b: Builder, c: Civic, detail: Detail): { chimneys: V3[]; lights: V3[] } {
  if (c.kind === 'church') return { chimneys: [], lights: church(b, c, detail) };
  if (c.kind === 'hall') return { chimneys: [], lights: hall(b, c, detail) };
  const spec = CIVIC_BODY[c.kind];
  if (!spec) return { chimneys: [], lights: [] };
  const r = body(b, c, spec, detail);
  const fr = new Frame(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
  return { chimneys: r.chimneys, lights: [fr.p(c.d / 2 + 0.4, 0, c.base + 2.8)] };
}

// ---------------------------------------------------------------------------------------------
// Площадь.


/** Торговый ряд: столбы, прилавок, полотняный навес, товар на прилавке. */
export function stall(b: Builder, s: Stall, detail: Detail): void {
  const fx = Math.cos(s.rot + Math.PI / 2);
  const fz = Math.sin(s.rot + Math.PI / 2);
  const rx = fz;
  const rz = -fx;
  const y = heightAt(s.x, s.z);
  const d = 2.2;
  const wood = tint(CITY.oakLight, 1.05);
  box(b, s.x + fx * 0.4, s.z + fz * 0.4, fx, fz, s.w, 0.8, y, y + 0.95, 'wood', wood, 'wood', { aoBottom: 0.6 });
  for (const a of [-1, 1]) {
    for (const f of [-1, 1]) {
      const x = s.x + rx * (s.w / 2 - 0.1) * a + fx * (d / 2) * f;
      const z = s.z + rz * (s.w / 2 - 0.1) * a + fz * (d / 2) * f;
      box(b, x, z, fx, fz, 0.12, 0.12, y, y + (f > 0 ? 2.1 : 2.5), 'wood', tint(CITY.oak), null);
    }
  }
  const col = tint(CITY.awnings[s.seed % CITY.awnings.length], 1.0);
  const A: V3 = [s.x - rx * (s.w / 2 + 0.15) + fx * (d / 2 + 0.6), y + 1.95, s.z - rz * (s.w / 2 + 0.15) + fz * (d / 2 + 0.6)];
  const B: V3 = [s.x + rx * (s.w / 2 + 0.15) + fx * (d / 2 + 0.6), y + 1.95, s.z + rz * (s.w / 2 + 0.15) + fz * (d / 2 + 0.6)];
  const C: V3 = [s.x + rx * (s.w / 2 + 0.15) - fx * (d / 2 + 0.1), y + 2.6, s.z + rz * (s.w / 2 + 0.15) - fz * (d / 2 + 0.1)];
  const D: V3 = [s.x - rx * (s.w / 2 + 0.15) - fx * (d / 2 + 0.1), y + 2.6, s.z - rz * (s.w / 2 + 0.15) - fz * (d / 2 + 0.1)];
  pushQuadOut(b, A, B, C, D, 'cloth', col, [s.x, y + 10, s.z], 1);
  if (detail > 0) pushQuadOut(b, A, B, C, D, 'cloth', [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], [s.x, y - 10, s.z], 0.6);
  // Товар: ящики и короба разного цвета.
  const n = 3;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * (s.w / n);
    const g = CITY.goods[(s.seed >>> (k * 3)) % CITY.goods.length];
    box(b, s.x + rx * off + fx * 0.4, s.z + rz * off + fz * 0.4, fx, fz, s.w / n - 0.25, 0.5, y + 0.95, y + 1.18 + rnd(s.seed, k, 3) * 0.2, 'wood', tint(g, 1.1), 'wood');
  }
}

/** Бочка: клёпка, крышка и два железных обруча (обручи — со среднего уровня). */
export function barrel(b: Builder, x: number, z: number, y: number, seed: number, detail: Detail): void {
  const seg = detail === 0 ? 6 : 8;
  const t = tint(CITY.oakLight, 0.85 + rnd(seed, 1, 7) * 0.3);
  cylinder(b, x, z, 0.36, y, y + 0.9, seg, 'wood', t, { aoBottom: 0.6 });
  cone(b, x, z, 0.36, y + 0.9, y + 0.95, seg, 'wood', [t[0] * 1.2, t[1] * 1.15, t[2] * 1.1], 1);
  if (detail === 0) return;
  for (const h of [0.16, 0.66]) cylinder(b, x, z, 0.375, y + h, y + h + 0.08, seg, 'wood', tint(CITY.iron, 1.6));
}

/** Повозка у рядов: короб на двух колёсах, оглобли опущены к земле, в коробе — мешки. */
export function cart(b: Builder, x: number, z: number, rot: number, seed: number, detail: Detail): void {
  const fx = Math.cos(rot);
  const fz = Math.sin(rot);
  const rx = fz;
  const rz = -fx;
  const y = heightAt(x, z);
  const wood = tint(CITY.oakLight, 0.95);
  const P = (f: number, r: number, h: number): V3 => [x + fx * f + rx * r, y + h, z + fz * f + rz * r];
  box(b, x, z, fx, fz, 1.4, 2.4, y + 0.62, y + 0.76, 'wood', wood, 'wood');
  for (const s of [-1, 1]) {
    box(b, x + rx * s * 0.66, z + rz * s * 0.66, fx, fz, 0.08, 2.4, y + 0.76, y + 1.16, 'wood', wood, 'wood');
    box(b, x + fx * s * 1.16, z + fz * s * 1.16, fx, fz, 1.24, 0.08, y + 0.76, y + 1.1, 'wood', wood, 'wood');
    // Колесо — короткий многогранник поперёк хода, ось — под серединой короба.
    log(b, P(-0.2, s * 0.76, 0.6), P(-0.2, s * 0.9, 0.6), 0.6, tint(CITY.oak), detail === 0 ? 6 : 10);
    log(b, P(1.2, s * 0.45, 0.7), P(3.3, s * 0.38, 0.12), 0.05, tint(CITY.oak), 4, false);
  }
  const goods = CITY.goods;
  for (let k = 0; k < 3; k++) {
    const g = goods[(seed >>> (k * 3)) % goods.length];
    const h = 0.32 + rnd(seed, k, 5) * 0.18;
    box(b, x + fx * (k - 1) * 0.7, z + fz * (k - 1) * 0.7, fx, fz, 1.05, 0.6, y + 0.76, y + 0.76 + h, 'cloth', tint(g, 0.9), 'cloth');
  }
}

/** Ящики: стопка в два яруса, каждый чуть повёрнут. */
function crates(b: Builder, x: number, z: number, n: number, seed: number): void {
  for (let k = 0; k < n; k++) {
    const a = rnd(seed, k, 11) * 0.5;
    const up = k >= n - 1 && n > 2;
    const ox = up ? 0.2 : (k - (n - 2) / 2) * 0.85;
    const y = heightAt(x + ox, z) + (up ? 0.8 : 0);
    const t = tint(CITY.oakLight, 0.9 + rnd(seed, k, 13) * 0.35);
    box(b, x + ox, z + (up ? 0.1 : 0), Math.cos(a), Math.sin(a), 0.8, 0.8, y, y + 0.8, 'wood', t, 'wood', { aoBottom: up ? 0.8 : 0.6 });
  }
}

/**
 * Мелочь у рядов рынка: повозки, бочки, ящики (docs/city.md, 11.6). Стоят по краям рядов, а не
 * между ними: проход вдоль прилавков остаётся улицей.
 */
export function marketProps(b: Builder, seed: number, detail: Detail): void {
  cart(b, -17, 12.5, Math.PI / 2 + 0.35, seed, detail);
  cart(b, 26, 9, Math.PI / 2 - 0.4, seed + 1, detail);
  const groups: [number, number, number][] = [
    [-16.5, 19.5, 3],
    [25, 16.5, 2],
    [8, 22.8, 3],
  ];
  groups.forEach(([gx, gz, n], i) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i;
      const r = n > 1 ? 0.45 : 0;
      const x = gx + Math.cos(a) * r;
      const z = gz + Math.sin(a) * r;
      barrel(b, x, z, heightAt(x, z), seed + i * 7 + k, detail);
    }
  });
  crates(b, -15.5, 5.5, 3, seed + 21);
  crates(b, 25.5, 3.5, 2, seed + 22);
  crates(b, 16, 22.8, 3, seed + 23);
}

/**
 * Желоб посреди мостовой: полоса плоских плит с тёмной сырой серединой — по нему вода стекает к
 * воротам (docs/city.md, 11.6). Лежит на земле, шаг 1.5 м — чтобы не уходить в склон между точками;
 * у концов улицы отступает на `trim` и рвётся ближе 7 м к воротам `gates`: в проезд не заходит.
 */
export function gutter(b: Builder, pts: readonly P[], gates: readonly P[] = [], trim = 6): void {
  const acc = [0];
  for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
  const total = acc[acc.length - 1];
  if (total < trim * 2 + 3) return;
  const along = (s: number): { x: number; z: number; tx: number; tz: number } => {
    let k = 1;
    while (k < pts.length - 1 && acc[k] < s) k++;
    const a = pts[k - 1];
    const e = pts[k];
    const l = acc[k] - acc[k - 1] || 1;
    const f = Math.min(1, Math.max(0, (s - acc[k - 1]) / l));
    return { x: a.x + (e.x - a.x) * f, z: a.z + (e.z - a.z) * f, tx: (e.x - a.x) / l, tz: (e.z - a.z) / l };
  };
  const w = 0.38;
  const T = tint(CITY.gutter);
  const [tw, th] = TILE_M.ashlar;
  const n = Math.ceil((total - trim * 2) / 1.5);
  let prev: { l: V3; c: V3; r: V3; v: number } | null = null;
  for (let k = 0; k <= n; k++) {
    const s = trim + ((total - trim * 2) * k) / n;
    const p = along(s);
    if (gates.some((g) => Math.hypot(p.x - g.x, p.z - g.z) < 7)) {
      prev = null;
      continue;
    }
    // Поперёк — (−tz, tx): тогда обход «лево → середина → дальше» смотрит нормалью вверх.
    const at = (o: number, dy: number): V3 => {
      const x = p.x - p.tz * o;
      const z = p.z + p.tx * o;
      return [x, heightAt(x, z) + dy, z];
    };
    const cur = { l: at(-w, 0.06), c: at(0, 0.035), r: at(w, 0.06), v: s / th };
    if (prev) {
      const u = w / tw;
      // Середина темнее краёв — сырая, но не чёрная: с камеры игры желоб в 0,4 тени и полной грязи читался тёмной дорожкой
      // вдоль улицы (docs/city_v3.md, Г-3, «Косяки»).
      b.quad(prev.l, prev.c, cur.c, cur.l, [-u, prev.v, 0, prev.v, 0, cur.v, -u, cur.v], L.ashlar, T, [1, 0.68, 0.68, 1], 0, [0.3, 0.6, 0.6, 0.3]);
      b.quad(prev.c, prev.r, cur.r, cur.c, [0, prev.v, u, prev.v, u, cur.v, 0, cur.v], L.ashlar, T, [0.68, 1, 1, 0.68], 0, [0.6, 0.3, 0.3, 0.6]);
    }
    prev = cur;
  }
}

/**
 * Колодец площади (docs/city_v3.md, Г-2): каменный сруб с плитой-венцом и тёмной водой в жерле, мокрая отмостка вокруг, два
 * дубовых столба с распорками и навес из дранки, ворот с рукоятью, верёвка с ведром над жерлом, второе ведро у сруба и
 * каменная колода. Ночью рядом — фонарь на столбе (`budget.buildStatic`, свет П-9).
 */
export function well(b: Builder, p: P, detail: Detail): void {
  const y = heightAt(p.x, p.z);
  const seg = detail === 0 ? 8 : 12;
  const T = tint(CITY.stoneTints[1], 0.95);
  // Отмостка: плиты вокруг сруба, тёмные от воды, — пятно расплёсканного у ведра темнее.
  disc(b, ring(p.x, p.z, 2.7, seg), y + 0.05, 'cobble', tint(CITY.stoneTints[2], 0.5));
  if (detail > 0) disc(b, ring(p.x + 0.9, p.z + 1.1, 1.0, 8), y + 0.06, 'cobble', tint(CITY.stoneTints[2], 0.36));
  // Сруб: бутовая кладка, венец тёсаного камня, внутри — тёмная вода.
  cylinder(b, p.x, p.z, 1.25, y - 0.3, y + 0.82, seg, 'rubble', T, { aoBottom: 0.6, grimeBottom: 0.9 });
  cylinder(b, p.x, p.z, 1.38, y + 0.82, y + 0.98, seg, 'ashlar', tint(CITY.stoneTints[0]));
  const rim = ring(p.x, p.z, 1.38, seg);
  const hole = ring(p.x, p.z, 0.92, seg);
  for (let k = 0; k < seg; k++) {
    const a = rim[k];
    const e = rim[(k + 1) % seg];
    const hA = hole[k];
    const hE = hole[(k + 1) % seg];
    pushQuadOut(b, [a[0], y + 0.98, a[1]], [e[0], y + 0.98, e[1]], [hE[0], y + 0.98, hE[1]], [hA[0], y + 0.98, hA[1]], 'ashlar', tint(CITY.stoneTints[0], 0.95), [p.x, y + 5, p.z], 0.95);
  }
  disc(b, hole, y + 0.55, 'rubble', tint(0x1c262a, 0.5));
  // Столбы на венце, распорки и навес.
  const oak = tint(CITY.oak);
  for (const s of [-1, 1]) {
    box(b, p.x + s * 1.12, p.z, 1, 0, 0.2, 0.2, y + 0.9, y + 3.15, 'wood', oak, null);
    if (detail > 0) log(b, [p.x + s * 1.12, y + 2.55, p.z - 0.05], [p.x + s * 0.55, y + 3.12, p.z - 0.05], 0.05, oak, 4, false);
  }
  box(b, p.x, p.z, 1, 0, 0.14, 2.7, y + 3.05, y + 3.18, 'wood', oak, 'wood');
  const fr = new Frame(p.x, p.z, 0, 1);
  gableRoof(b, fr, -1.25, 1.25, -1.55, 1.55, y + 3.12, (42 * Math.PI) / 180, false, 'roofSlate', tint(CITY.shingleTint), detail, 7, { eave: 0.35, verge: 0.25 });
  // Ворот между столбами, рукоять снаружи восточного; верёвка с ведром над жерлом.
  const wy = y + 2.05;
  log(b, [p.x - 1.02, wy, p.z], [p.x + 1.02, wy, p.z], 0.13, tint(CITY.oakLight), detail === 0 ? 5 : 8, true);
  log(b, [p.x + 1.22, wy, p.z], [p.x + 1.42, wy, p.z], 0.04, tint(CITY.iron, 1.5), 4, false);
  log(b, [p.x + 1.42, wy, p.z], [p.x + 1.42, wy - 0.38, p.z + 0.12], 0.035, tint(CITY.iron, 1.5), 4, false);
  log(b, [p.x + 1.42, wy - 0.38, p.z + 0.12], [p.x + 1.62, wy - 0.38, p.z + 0.12], 0.04, oak, 4, false);
  log(b, [p.x + 0.15, wy - 0.12, p.z], [p.x + 0.15, y + 1.38, p.z], 0.022, tint(0xc8b890, 0.75), 3, false);
  bucket(b, p.x + 0.15, p.z, y + 1.05, detail);
  // Второе ведро — на земле у сруба, полное; колода для воды — с запада.
  bucket(b, p.x + 1.25, p.z + 1.55, y + 0.05, detail);
  const tx = p.x - 2.35;
  const tz = p.z - 0.4;
  box(b, tx, tz, 1, 0, 1.9, 0.7, y - 0.15, y + 0.55, 'rubble', T, null, { aoBottom: 0.65 });
  disc(b, [
    [tx - 0.24, tz - 0.8],
    [tx + 0.24, tz - 0.8],
    [tx + 0.24, tz + 0.8],
    [tx - 0.24, tz + 0.8],
  ], y + 0.46, 'rubble', tint(0x24343a, 0.6));
}

/** Ведро: дубовые клёпки, железный обруч, тёмная вода; дужка — со среднего уровня. */
function bucket(b: Builder, x: number, z: number, y: number, detail: Detail): void {
  const seg = detail === 0 ? 5 : 7;
  cylinder(b, x, z, 0.2, y, y + 0.32, seg, 'wood', tint(CITY.oakLight, 1.1), { aoBottom: 0.7 });
  disc(b, ring(x, z, 0.19, seg), y + 0.27, 'rubble', tint(0x24343a, 0.6));
  if (detail === 0) return;
  cylinder(b, x, z, 0.21, y + 0.22, y + 0.27, seg, 'wood', tint(CITY.iron, 1.6));
  log(b, [x - 0.2, y + 0.32, z], [x, y + 0.5, z], 0.012, tint(CITY.iron, 1.6), 3, false);
  log(b, [x, y + 0.5, z], [x + 0.2, y + 0.32, z], 0.012, tint(CITY.iron, 1.6), 3, false);
}

/** Огненная чаша у колодца — «Костёр» игры. */
export function fireBowl(b: Builder, p: P): V3 {
  const y = heightAt(p.x, p.z);
  cylinder(b, p.x, p.z, 0.25, y, y + 0.9, 8, 'ashlar', tint(CITY.stoneTints[2]), { aoBottom: 0.7 });
  cone(b, p.x, p.z, 0.3, y + 0.85, y + 1.3, 8, 'wood', tint(CITY.iron, 1.4), 1);
  cylinder(b, p.x, p.z, 0.75, y + 1.2, y + 1.45, 8, 'wood', tint(CITY.iron, 1.4));
  return [p.x, y + 1.6, p.z];
}

/** «Роланд»: постамент и каменная фигура со щитом и мечом — Статуя Героя игры. */
export function statue(b: Builder, p: P, facing: number): void {
  const y = heightAt(p.x, p.z);
  const T = tint(CITY.stoneTints[0], 0.95);
  const fx = Math.cos(facing);
  const fz = Math.sin(facing);
  box(b, p.x, p.z, fx, fz, 2.2, 2.2, y - 0.2, y + 0.5, 'ashlar', T, 'ashlar', { aoBottom: 0.6 });
  box(b, p.x, p.z, fx, fz, 1.5, 1.5, y + 0.5, y + 2.6, 'ashlar', T, 'ashlar', { aoBottom: 0.8 });
  // Фигура: ноги, туника, плечи, голова, щит, меч.
  const top = y + 2.6;
  box(b, p.x, p.z, fx, fz, 0.7, 0.45, top, top + 1.4, 'ashlar', T, null);
  cylinder(b, p.x, p.z, 0.5, top + 1.2, top + 2.6, 8, 'ashlar', T);
  box(b, p.x, p.z, fx, fz, 1.25, 0.55, top + 2.5, top + 2.9, 'ashlar', T, 'ashlar');
  cylinder(b, p.x, p.z, 0.24, top + 2.9, top + 3.4, 8, 'ashlar', T);
  cone(b, p.x, p.z, 0.27, top + 3.35, top + 3.6, 8, 'ashlar', T);
  const rx = fz;
  const rz = -fx;
  box(b, p.x - rx * 0.55 + fx * 0.35, p.z - rz * 0.55 + fz * 0.35, fx, fz, 0.7, 0.12, top + 1.3, top + 2.4, 'ashlar', tint(CITY.stoneTints[3], 0.9), 'ashlar');
  box(b, p.x + rx * 0.5 + fx * 0.3, p.z + rz * 0.5 + fz * 0.3, fx, fz, 0.1, 0.1, top + 1.6, top + 3.9, 'ashlar', tint(CITY.iron, 1.8), 'ashlar');
}
