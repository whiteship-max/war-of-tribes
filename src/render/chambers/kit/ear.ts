// Ухо набора персонажа с рельефом (ЛЦ-5, docs/characters.md): прежние уши гонца — лоскут в три столбца, и оценщики ЛЦ-3
// видели в них плоские пластины. Здесь — пять столбцов по ширине уха: основание на черепе, раковина (впадина), противозавиток
// (гребень), завиток (край наружу и назад) и подогнутая кромка завитка (вперёд и к голове) — в силуэте у уха есть толщина и
// изгиб. Ряды — от мочки к верху; мочка — без впадины, мясистая. Лист — свой прямоугольник листа лица (`paintEar`), рельеф
// на нём лежит по тем же столбцам, что в сетке. Прежние фигуры этим не пользуются — их вид не меняется.
import type { V3 } from '../../city/geom';
import type { SheetBox } from './body';
import { Img, boxOf, flesh, mix, noise, poly, spline, stroke, type RGB } from './paint';
import type { SkinMesh, Weights } from './skin';

/** Ухо: угол основания, высоты мочки и верха над подбородком, вынос края наружу и назад, чертёжные метры. */
export interface EarSpec {
  th: number;
  h0: number;
  h1: number;
  out: number;
  back: number;
}

/** Столбцы уха: доля ширины на листе, вынос (доля `out`), отвод назад (доля `back`), впадина (м), сдвиг по углу (рад). */
export const EAR_COLS: readonly { u: number; out: number; back: number; dip: number; dth: number }[] = [
  { u: 0, out: 0, back: 0, dip: 0, dth: 0 },
  { u: 0.3, out: 0.32, back: 0.3, dip: -0.0042, dth: 0.03 },
  { u: 0.56, out: 0.62, back: 0.58, dip: 0.0012, dth: 0.03 },
  { u: 0.84, out: 1, back: 0.95, dip: 0, dth: 0.03 },
  // Кромка завитка подогнута вперёд и к голове: толщина края в силуэте.
  { u: 1, out: 0.86, back: 0.78, dip: -0.0016, dth: 0.03 },
];
/** Ряды: доли высоты уха от мочки к верху. */
export const EAR_ROWS: readonly number[] = [0, 0.22, 0.48, 0.74, 1];

/**
 * Уши обеих сторон: `skull(th, h)` — точка на черепе (чертёж головы) под ухом, `hz` — ось головы по глубине. Лист — `box` на
 * листе `sheet`. Возвращает число граней.
 */
export function buildEars(m: SkinMesh, skull: (th: number, h: number) => V3, hz: number, s: EarSpec, box: SheetBox, sheet: 0 | 1, w: Weights): number {
  const from = m.triangles;
  const W = box.x1 - box.x0;
  const H = box.y1 - box.y0;
  for (const sx of [1, -1] as const) {
    const rows = EAR_ROWS.map((k) => {
      const h = s.h0 + (s.h1 - s.h0) * k;
      // Край по дуге: у мочки и у верха — уже, посередине — шире; мочка не отставлена.
      const bulge = Math.sin(Math.PI * (0.12 + 0.76 * k));
      const lobe = k < 0.15 ? 0.55 : 1;
      return EAR_COLS.map((c) => {
        const base = skull(sx * (s.th + c.dth), h);
        const dx = base[0];
        const dz = base[2] - hz;
        const r = Math.hypot(dx, dz) || 1;
        const out = s.out * c.out * (0.5 + 0.5 * bulge) * lobe + c.dip * (k < 0.15 ? 0.2 : 1);
        const back = s.back * c.back * (0.45 + 0.55 * bulge);
        // Верх завитка загибается вниз-вперёд, мочка — чуть вниз.
        const curl = c.u === 1 ? -0.003 * k : k === 0 ? -0.002 * c.out : 0;
        const p: V3 = [base[0] + (dx / r) * out, base[1] + curl, base[2] + (dz / r) * out - back];
        const u = box.x0 + 3 + c.u * (W - 6);
        const v = box.y1 - 3 - k * (H - 6);
        return m.v(p, [u / 512, v / 512], sheet, w);
      });
    });
    m.strip(rows, false, (p) => [p[0] - sx * 0.05, p[1], p[2]]);
  }
  return m.triangles - from;
}

/**
 * Лист уха по столбцам сетки: у черепа — в тени, раковина — глубокая впадина посередине (выше мочки), противозавиток —
 * светлым гребнем с развилкой у верха, завиток — светлый, под его кромкой — тёмная складка; козелок у основания; мочка —
 * мясистая и розовее. Край — к красному (`ruddy`, доля `red`).
 */
export function paintEar(img: Img, box: SheetBox, skin: RGB, ruddy: RGB, red: number, seed = 61): void {
  const W = box.x1 - box.x0;
  const H = box.y1 - box.y0;
  const n = noise(seed);
  const at = (u: number, v: number): [number, number] => [box.x0 + 3 + u * (W - 6), box.y1 - 3 - v * (H - 6)];
  img.shape((x, y) => -1, box, (x, y) => {
    const u = (x - box.x0) / W;
    const v = (box.y1 - y) / H;
    const concha = Math.exp(-(((u - 0.3) / 0.13) ** 2) - (((v - 0.5) / 0.24) ** 2));
    const ridge = Math.exp(-(((u - 0.56) / 0.07) ** 2)) * (v > 0.2 && v < 0.92 ? 1 : 0.3);
    const helix = Math.exp(-(((u - 0.84) / 0.07) ** 2));
    const fold = Math.exp(-(((u - 0.95) / 0.035) ** 2));
    const base = Math.max(0, 1 - u / 0.18);
    const lobe = v < 0.18 ? 1 - v / 0.18 : 0;
    let c = flesh(skin, -0.22 + 0.42 * helix + 0.3 * ridge - 1.05 * concha * (1 - lobe) - 0.75 * fold - 0.35 * base + 0.18 * lobe + (n(x * 0.2, y * 0.2) - 0.5) * 0.06);
    c = mix(c, ruddy, red * (0.4 * helix + 0.3 * lobe + 0.2 * ridge));
    return c;
  });
  // Развилка противозавитка у верха — две тёмные ямки по бокам гребня.
  const fossa = spline([at(0.42, 0.8), at(0.56, 0.86), at(0.7, 0.8)]);
  img.shape(stroke(fossa, (t) => 3 * Math.sin(Math.PI * t) + 1), boxOf(fossa, 6), flesh(skin, -0.9), { soft: 3, alpha: 0.55 });
  // Козелок — бугорок у основания на высоте раковины, тень за ним.
  const tragus = poly([at(0.04, 0.42), at(0.2, 0.47), at(0.2, 0.62), at(0.05, 0.6)]);
  img.shape(tragus, box, flesh(skin, 0.05), { soft: 3, alpha: 0.6 });
}
