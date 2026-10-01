// Большие здания и убранство площади вида «город» (docs/city.md, разделы 2 и 5): храм с западной
// башней и шпилем, ратуша с аркадой и ступенчатыми щипцами, Хлебный дом, цеховой дом, кузница,
// конюшня, трактир, госпиталь, палас и казармы замка; торговые ряды, колодец, огненная чаша, «Роланд»,
// ограда церковного двора. Один вид навсегда: уровни игры модель не меняют.
import { CITY } from './palette';
import { Builder, box, cone, cylinder, pyramid, tint, wall, type V3 } from './geom';
import { Frame, GROUND_H, STOREY_H, chimney, face, gableRoof, gableTri, pushQuadOut, type Detail } from './kit';
import { heightAt, type Civic, type P, type Stall } from './layout';
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

const lowUnder = (fr: Frame, w: number, d: number): number => {
  let lo = Infinity;
  for (const [f, r] of [
    [d / 2, w / 2],
    [d / 2, -w / 2],
    [-d / 2, w / 2],
    [-d / 2, -w / 2],
    [0, 0],
  ]) {
    const [x, z] = fr.q(f, r);
    lo = Math.min(lo, heightAt(x, z));
  }
  return lo;
};

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

/** Храм: западная башня со шпилем, неф с контрфорсами, апсида на восток. */
function church(b: Builder, c: Civic, detail: Detail): V3[] {
  const fr = new Frame(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
  const T = tint(CITY.stoneTints[0]);
  const base = c.base;
  const low = lowUnder(fr, c.w, c.d);
  // По оси «вправо» (r) — запад→восток: r < 0 — запад (башня), r > 0 — восток (апсида).
  const tw = 9.5;
  const westEnd = -c.w / 2;
  const naveW = 15;
  const naveH = 13;
  const r0 = westEnd + tw;
  const r1 = c.w / 2 - 6.5;
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
  return [fr.p(hd + 0.3, r0 - 1, base + 3.5)];
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

/** Колодец: каменное кольцо, два столба и двускатный навес. */
export function well(b: Builder, p: P, detail: Detail): void {
  const y = heightAt(p.x, p.z);
  const T = tint(CITY.stoneTints[1]);
  cylinder(b, p.x, p.z, 1.35, y - 0.3, y + 0.85, detail === 0 ? 8 : 12, 'rubble', T, { aoBottom: 0.65 });
  cylinder(b, p.x, p.z, 1.5, y + 0.85, y + 1.0, detail === 0 ? 8 : 12, 'ashlar', T);
  for (const s of [-1, 1]) box(b, p.x + s * 1.2, p.z, 1, 0, 0.18, 0.18, y + 0.9, y + 3.0, 'wood', tint(CITY.oak), null);
  box(b, p.x, p.z, 1, 0, 0.12, 2.6, y + 2.5, y + 2.62, 'wood', tint(CITY.oak), 'wood');
  const fr = new Frame(p.x, p.z, 0, 1);
  gableRoof(b, fr, -1.3, 1.3, -1.0, 1.0, y + 2.9, (40 * Math.PI) / 180, true, 'roofSlate', tint(CITY.shingleTint), detail, 7, { eave: 0.3, verge: 0.2 });
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

/** Ограда церковного двора: низкая каменная стенка по прямоугольнику с проходом к площади. */
export function churchyard(b: Builder, c: Civic): void {
  const fr = new Frame(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot));
  const hw = c.w / 2 + 6;
  const hd = c.d / 2 + 4.5;
  const T = tint(CITY.stoneTints[1], 0.92);
  const sides: [[number, number], [number, number]][] = [
    [
      [hd, -hw],
      [hd, -3],
    ],
    [
      [hd, 3],
      [hd, hw],
    ],
    [
      [hd, hw],
      [-hd, hw],
    ],
    [
      [-hd, hw],
      [-hd, -hw],
    ],
    [
      [-hd, -hw],
      [hd, -hw],
    ],
  ];
  for (const [a, e] of sides) {
    const [ax, az] = fr.q(a[0], a[1]);
    const [ex, ez] = fr.q(e[0], e[1]);
    const len = Math.hypot(ex - ax, ez - az);
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k < steps; k++) {
      const f0 = k / steps;
      const f1 = (k + 1) / steps;
      const x0 = ax + (ex - ax) * f0;
      const z0 = az + (ez - az) * f0;
      const x1 = ax + (ex - ax) * f1;
      const z1 = az + (ez - az) * f1;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const y = heightAt(mx, mz);
      const dx = (x1 - x0) / (len / steps);
      const dz = (z1 - z0) / (len / steps);
      box(b, mx, mz, -dz, dx, len / steps + 0.05, 0.5, y - 0.4, y + 1.1, 'rubble', T, 'ashlar', { aoBottom: 0.65, grimeBottom: 0.7 });
    }
  }
  void wall;
}
