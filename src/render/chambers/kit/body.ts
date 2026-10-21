// Тело набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): кольца вокруг вертикали, зеркальные листы,
// трубки вдоль руки и ноги и кисть-«варежка» — ладонь с пальцами одним куском и отдельный большой палец. Чьё тело — решают
// ряды и меры фигуры (`consort/figure.ts`, `herald/figure.ts`); здесь только то, как они становятся сеткой.
import type { V3 } from '../../city/geom';
import { SkinMesh, add, scale, type Weights } from './skin';

/** Лист тела — 512 × 512 точек. */
export const BODY_PX = 512;
/** Точки листа (x, y — вниз) → UV. */
export const uvB = (x: number, y: number): [number, number] => [x / BODY_PX, y / BODY_PX];
/** Зеркальные листы: середина спереди — левый край листа (0), сзади — правый (512); выборка у края его не переходит. */
export const mirrorU = (a: number): number => (Math.min(Math.PI, Math.abs(a)) / Math.PI) * BODY_PX;

/** Прямоугольник листа в точках. */
export interface SheetBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** Кольцо вокруг вертикали по углу `a` (0 — перед, + — к левому боку): полуоси, сдвиг середины вперёд. */
export const ringPt = (a: number, y: number, rx: number, rz: number, zc: number): V3 => [rx * Math.sin(a), y, zc + rz * Math.cos(a)];

/** Углы кольца зеркальной половины: 0, правая сторона и левая — по одному набору (`half` — от 0 до π включительно). */
export function mirrorRing(half: readonly number[]): number[] {
  const out = [...half];
  for (let i = half.length - 2; i >= 1; i--) out.push(-half[i]);
  return out;
}

export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const smooth = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Кольцо поперёк оси с середины `c`: полуоси по `u` и `v`, `seg` углов + шов (последняя — копия первой с u = 1). */
export function tube(m: SkinMesh, c: V3, u: V3, v: V3, ru: number, rv: number, seg: number, uv: (k: number) => [number, number], w: Weights, phase = 0): number[] {
  const out: number[] = [];
  for (let k = 0; k <= seg; k++) {
    const a = phase + (k / seg) * Math.PI * 2;
    const p = add(c, add(scale(u, Math.cos(a) * ru), scale(v, Math.sin(a) * rv)));
    out.push(m.v(p, uv(k / seg), 0, w));
  }
  return out;
}

/** Кисть-«варежка»: сечения ладони с пальцами, кончик, большой палец — меры фигуры; листы кисти и пальца. */
export interface MittenSpec {
  /** Сечения от запястья: сдвиг по руке, ширина (поперёк, к большому пальцу), толщина (к ладони), подгиб к ладони, строка листа. */
  rings: readonly (readonly [number, number, number, number, number])[];
  /** Кончик пальцев: сдвиг по руке и подгиб; веер к кончику — вокруг точки `fan`, ось кисти дальше `bend` — к ладони на `bendBy`. */
  tip: readonly [number, number];
  fan: readonly [number, number];
  bend: readonly [number, number];
  /** Большой палец: направление (по руке, поперёк, к ладони), сечения у основания и у сустава, сустав и кончик по длине. */
  thumbDir: V3;
  thumbR: readonly [readonly [number, number], readonly [number, number]];
  thumbAt: readonly [number, number, number];
  hand: SheetBox;
  thumb: SheetBox;
}

/**
 * Кисть стороны `sx` (1 — левая, +x): у запястья `W`, рука вдоль `d`, начало большого пальца `base` (у левой руки — зеркалится
 * по x). Покой — рука вниз, ладонь к бедру (к телу), большой палец вперёд; пальцы чуть подогнуты к ладони.
 */
export function mitten(m: SkinMesh, sx: 1 | -1, W: V3, d: V3, base0: V3, s: MittenSpec): void {
  const side = sx === 1 ? 'L' : 'R';
  const hand = `hand${side}`;
  const fore = `fore${side}`;
  const palm: V3 = [-sx, 0, 0];
  const across = scale(norm(crs(palm, d)), sx);
  const h = s.hand;
  const uvH = (v: number) => (k: number): [number, number] => uvB(h.x0 + 1 + k * (h.x1 - h.x0 - 2), v);
  const inner = Math.PI / 2;
  const rows = s.rings.map(([t, w, th, curl, v], i) => tube(m, add(add(W, scale(d, t)), scale(palm, curl)), across, palm, w, th, 6, uvH(v), i === 0 ? [hand, fore, 0.5] : hand, inner));
  m.strip(rows, false, (p) => {
    const t = (p[0] - W[0]) * d[0] + (p[1] - W[1]) * d[1] + (p[2] - W[2]) * d[2];
    return add(add(W, scale(d, t)), scale(palm, t > s.bend[0] ? s.bend[1] : 0));
  });
  const tip = m.v(add(add(W, scale(d, s.tip[0])), scale(palm, s.tip[1])), uvB(h.x0 + 64, h.y1 - 2), 0, hand);
  const last = rows[rows.length - 1];
  for (let k = 0; k < last.length - 1; k++) m.quad(last[k], last[k + 1], tip, tip, add(add(W, scale(d, s.fan[0])), scale(palm, s.fan[1])));
  // Большой палец: от основания у запястья — вниз, вперёд и к ладони.
  const tb = s.thumb;
  const uvT = (v: number) => (k: number): [number, number] => uvB(tb.x0 + 1 + k * (tb.x1 - tb.x0 - 2), v);
  const base = [base0[0] * sx, base0[1], base0[2]] as V3;
  const td = norm(add(add(scale(d, s.thumbDir[0]), scale(across, s.thumbDir[1])), scale(palm, s.thumbDir[2])));
  const tu = norm(crs(td, palm));
  const tv = norm(crs(td, tu));
  const thumb = `thumb${side}`;
  const [r0, r1] = s.thumbR;
  const [joint, tipAt, fanAt] = s.thumbAt;
  const trs = [tube(m, base, tu, tv, r0[0], r0[1], 5, uvT(tb.y0 + 2), [thumb, hand, 0.5]), tube(m, add(base, scale(td, joint)), tu, tv, r1[0], r1[1], 5, uvT(tb.y0 + 34), thumb)];
  m.strip(trs, false, (p) => add(base, scale(td, (p[0] - base[0]) * td[0] + (p[1] - base[1]) * td[1] + (p[2] - base[2]) * td[2])));
  const ttip = m.v(add(base, scale(td, tipAt)), uvB(tb.x0 + 16, tb.y1 - 2), 0, thumb);
  const tl = trs[1];
  for (let k = 0; k < tl.length - 1; k++) m.quad(tl[k], tl[k + 1], ttip, ttip, add(base, scale(td, fanAt)));
}

/** Перенести вершины с `from` по месту: голова — к своему масштабу, тело — к росту. */
export function place(m: SkinMesh, from: number, to: (p: V3) => V3): void {
  for (let i = from; i < m.vertexCount; i++) {
    const p = to(m.at(i));
    m.pos[i * 3] = p[0];
    m.pos[i * 3 + 1] = p[1];
    m.pos[i * 3 + 2] = p[2];
  }
}
