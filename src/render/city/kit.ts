// Модели вида «город» (docs/city.md, раздел 2): дом, стена, башни, ворота, храм, ратуша, большие
// здания, ряды, колодец, статуя. Всё пишется в построитель (`geom.Builder`) — один меш на весь город.
// Один вид каждого здания навсегда: уровни игры модель не меняют.
//
// `detail` — уровень подробности по качеству: 0 — низкий (без слуховых окон, досок свесов, конька и
// прогиба), 1 — средний, 2 — высокий.
import { CITY } from './palette';
import { Builder, box, flat, tint, wall, type V3 } from './geom';
import type { House } from './layout';
import { L, TILE_M, type LayerName } from './tex';
import { rnd } from './noise';

export type Detail = 0 | 1 | 2;

/** Высоты этажей: первый — под плитку двери, верхние — под плитку фахверка. */
export const GROUND_H = 3.4;
export const STOREY_H = 2.9;

const FRAME_LAYER: readonly LayerName[] = ['timberA', 'timberB', 'timberC'];
/** Доля плитки на одно окно-пролёт у рисунка: окна не режутся углом дома. */
const BAY: Record<string, number> = { timberA: 0.5, timberB: 1 / 3, timberC: 0.5, stoneWin: 0.5, groundDoor: 0.5, plaster: 0.25, churchWin: 1, arcade: 1, towerSlit: 1 };

/** Локальная рамка дома: середина, «вперёд» к улице и «вправо», если смотреть на фасад снаружи. */
export class Frame {
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly fx: number,
    readonly fz: number,
  ) {}
  /** Точка: `f` — вперёд от середины, `r` — вправо, `y` — высота. */
  p(f: number, r: number, y: number): V3 {
    return [this.cx + this.fx * f + this.fz * r, y, this.cz + this.fz * f - this.fx * r];
  }
  /** План: (x, z). */
  q(f: number, r: number): [number, number] {
    return [this.cx + this.fx * f + this.fz * r, this.cz + this.fz * f - this.fx * r];
  }
}

/** Пролётов на ширину: целое число окон, без обрезка углом. */
export function spanOf(layer: LayerName, width: number): number {
  const [tw] = TILE_M[layer];
  const bay = BAY[layer] ?? width / tw;
  const n = Math.max(1, Math.round(width / tw / bay));
  return n * bay;
}

/** Вертикальная грань в рамке: от (f, r0) до (f, r1) — слева направо снаружи. */
export function face(
  b: Builder,
  fr: Frame,
  a: [number, number],
  e: [number, number],
  y0: number,
  y1: number,
  layer: LayerName,
  t: V3,
  o: { span?: boolean; u0?: number; vTile?: number; vBase?: number; aoB?: number; aoT?: number; glow?: number; grimeB?: number } = {},
): void {
  const [ax, az] = fr.q(a[0], a[1]);
  const [bx, bz] = fr.q(e[0], e[1]);
  const len = Math.hypot(bx - ax, bz - az);
  wall(b, {
    ax,
    az,
    bx,
    bz,
    y0,
    y1,
    layer,
    tint: t,
    u0: o.u0 ?? 0,
    uSpan: o.span ? spanOf(layer, len) : undefined,
    vTile: o.vTile,
    vBase: o.vBase,
    aoBottom: o.aoB,
    aoTop: o.aoT,
    glow: o.glow,
    grimeBottom: o.grimeB,
  });
}

/** Треугольный щипец в плоскости стены: низ от a до e на `y0`, вершина над серединой на `y1`. */
export function gableTri(b: Builder, fr: Frame, a: [number, number], e: [number, number], y0: number, y1: number, layer: LayerName, t: V3, vBase: number, vTile: number, glow: number): void {
  const [tw] = TILE_M[layer];
  const A = fr.p(a[0], a[1], y0);
  const E = fr.p(e[0], e[1], y0);
  const M = fr.p((a[0] + e[0]) / 2, (a[1] + e[1]) / 2, y1);
  const len = Math.hypot(E[0] - A[0], E[2] - A[2]);
  const span = spanOf(layer, len);
  const v0 = (y0 - vBase) / vTile;
  const v1 = (y1 - vBase) / vTile;
  void tw;
  b.tri(A, E, M, [0, v0, span, v0, span / 2, v1], L[layer], t, [0.95, 0.95, 1], glow);
}

const pick = <T>(arr: readonly T[], k: number): T => arr[((k % arr.length) + arr.length) % arr.length];

/** Толщина кровли, м: на столько ниже ската лежит его изнанка (`gableRoof`). */
const ROOF_T = 0.1;

/**
 * Кровля над прямоугольником рамки: `f0..f1` вперёд, `r0..r1` вправо, карниз на `y`.
 * `alongF` — конёк вдоль «вперёд» (щипцы спереди и сзади), иначе — вдоль «вправо».
 * `hip` — вальма на концах конька: 0 — двускатная со щипцами, 0..1 — полувальма (щипец срезан
 * сверху на эту долю), 1 — вальмовая. Возвращает конёк, подъём и срез щипца (для стены щипца).
 */
export function gableRoof(
  b: Builder,
  fr: Frame,
  f0: number,
  f1: number,
  r0: number,
  r1: number,
  y: number,
  pitch: number,
  alongF: boolean,
  layer: LayerName,
  t: V3,
  detail: Detail,
  seed: number,
  over = { eave: 0.45, verge: 0.35 },
  hip = 0,
): { ridge: number; rise: number; cutY: number; cutHalf: number } {
  const tp = Math.tan(pitch);
  // Оси кровли: «длина» вдоль конька (l), «поперёк» (c).
  const lo = alongF ? f0 : r0;
  const hi = alongF ? f1 : r1;
  const c0 = alongF ? r0 : f0;
  const c1 = alongF ? r1 : f1;
  const half = (c1 - c0) / 2;
  const mid = (c0 + c1) / 2;
  const rise = half * tp;
  const ridge = y + rise;
  const oe = over.eave;
  const yEave = y - oe * tp;
  const P = (l: number, c: number, h: number): V3 => (alongF ? fr.p(l, c, h) : fr.p(c, l, h));
  const hipped = hip > 0;
  // Концы ската: у щипца — свес по фронтону, у вальмы — почти по стене.
  const endOver = hipped ? (hip >= 1 ? oe : 0.2) : over.verge;
  const L0 = lo - endOver;
  const L1 = hi + endOver;
  const Lm = (L0 + L1) / 2;
  // Срез: высота, где кончается щипец, и полуширина ската там; вынос конька от концов.
  const run = half + oe;
  const yCut = hipped ? yEave + (ridge - yEave) * (1 - hip) : ridge;
  const cutHalf = hipped ? run * hip : 0;
  const inset = hipped ? Math.min(run * hip, (L1 - L0) / 2 - 0.05) : 0;
  const R0 = L0 + inset;
  const R1 = L1 - inset;
  const sag = detail > 0 && !hipped ? 0.03 + rnd(seed, 1, 3) * 0.06 : 0;
  const segs: [number, number, number, number][] = sag > 0 ? [[L0, Lm, 0, sag], [Lm, L1, sag, 0]] : [[L0, L1, 0, 0]];
  let u = rnd(seed, 2, 3) * 4;
  const [tw, th] = TILE_M[layer];
  const quadUp = (a: V3, bb: V3, c: V3, d: V3, uv: readonly [number, number, number, number, number, number, number, number]): void => {
    const n = cross(sub(bb, a), sub(d, a));
    if (n[1] >= 0) b.quad(a, bb, c, d, uv, L[layer], t, [0.92, 0.92, 1, 1]);
    else b.quad(bb, a, d, c, [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]], L[layer], t, [0.92, 0.92, 1, 1]);
  };
  // Изнанка ската — тёмная, лицом вниз, на толщину кровли ниже: под свесом у щипца и карниза её видно сбоку и сверху вдоль
  // фасада (из покоев донжона — вдоль домов Соборной площади, docs/city_v3.md, Г-8), а без неё сквозь свес видно мостовую за
  // домом. Ниже, а не в плоскости ската: в тени изнанка — заслон, и на самом скате ей не лечь пятнами.
  const under: V3 = [t[0] * 0.42, t[1] * 0.4, t[2] * 0.38];
  const quadDown = (q: readonly [V3, V3, V3, V3], uv: readonly [number, number, number, number, number, number, number, number]): void => {
    const n = cross(sub(q[1], q[0]), sub(q[3], q[0]));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    // Отвесно вниз на толщину кровли (Г-9), а не по нормали: по нормали край изнанки выходил из-под края ската на
    // `ROOF_T · sin(уклона)`, и сверху, из окон донжона, вдоль карниза сквозила полоса изнанки — дыра в кровле. Отвесно край
    // изнанки — под краем ската, щель между ними снаружи закрывают доски карниза и ветровые.
    const dy = -ROOF_T / Math.max(0.3, Math.abs(n[1]) / l);
    const [a, bb, c, d] = q.map((p): V3 => [p[0], p[1] + dy, p[2]]);
    // Та же диагональ a–c, что у ската (`Builder.quad`), обход обратный: изнанка повторяет излом провисшего ската.
    if (n[1] >= 0) b.quad(a, d, c, bb, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]], L[layer], under, [0.6, 0.75, 0.75, 0.6]);
    else b.quad(a, bb, c, d, uv, L[layer], under, [0.6, 0.6, 0.75, 0.75]);
  };
  const slant = (h0: number, h1: number): number => (h1 - h0) / Math.sin(pitch) / th;
  for (const side of [1, -1]) {
    const ce = side > 0 ? c1 + oe : c0 - oe;
    const cc = mid + side * cutHalf;
    if (!hipped) {
      for (const [la, lb, sa, sb] of segs) {
        const ua = u + (la - L0) / tw;
        const ub = u + (lb - L0) / tw;
        const v1 = slant(yEave, ridge);
        const q: [V3, V3, V3, V3] = [P(la, ce, yEave - sa * 0.5), P(lb, ce, yEave - sb * 0.5), P(lb, mid, ridge - sb), P(la, mid, ridge - sa)];
        quadUp(q[0], q[1], q[2], q[3], [ua, 0, ub, 0, ub, v1, ua, v1]);
        quadDown(q, [ua, 0, ub, 0, ub, v1, ua, v1]);
      }
    } else {
      // Полоса от карниза до среза — во всю длину, выше — трапеция до укороченного конька.
      const vc = slant(yEave, yCut);
      if (yCut > yEave + 0.01) quadUp(P(L0, ce, yEave), P(L1, ce, yEave), P(L1, cc, yCut), P(L0, cc, yCut), [u, 0, u + (L1 - L0) / tw, 0, u + (L1 - L0) / tw, vc, u, vc]);
      const vr = slant(yEave, ridge);
      quadUp(P(L0, cc, yCut), P(L1, cc, yCut), P(R1, mid, ridge), P(R0, mid, ridge), [u, vc, u + (L1 - L0) / tw, vc, u + (R1 - L0) / tw, vr, u + (R0 - L0) / tw, vr]);
    }
  }
  if (hipped) {
    // Скаты вальмы: треугольник от среза к концу конька — на обоих концах.
    for (const [end, rEnd, dir] of [
      [L0, R0, -1],
      [L1, R1, 1],
    ] as const) {
      const A = P(end, mid - cutHalf, yCut);
      const B = P(end, mid + cutHalf, yCut);
      const K = P(rEnd, mid, ridge);
      const w = (cutHalf * 2) / tw;
      const n = cross(sub(B, A), sub(K, A));
      const out = P(end + dir * 3, mid, yCut + 2);
      if (dot(n, sub(out, A)) >= 0) b.tri(A, B, K, [0, 0, w, 0, w / 2, slant(yCut, ridge)], L[layer], t, [0.92, 0.92, 1]);
      else b.tri(B, A, K, [0, 0, w, 0, w / 2, slant(yCut, ridge)], L[layer], t, [0.92, 0.92, 1]);
    }
  }
  void u;
  if (detail > 0) {
    // Доски карниза: узкая полоса под краем ската, снаружи.
    const fasc = 0.16;
    const wood = tint(CITY.oak, 1.1);
    for (const side of [1, -1]) {
      const cc = side > 0 ? c1 + oe : c0 - oe;
      const A = P(L0, cc, yEave - sag * 0.5);
      const B = P(L1, cc, yEave - sag * 0.5);
      const C2: V3 = [B[0], B[1] - fasc, B[2]];
      const D2: V3 = [A[0], A[1] - fasc, A[2]];
      pushQuadOut(b, A, B, C2, D2, 'wood', wood, side > 0 ? P(Lm, cc + 1, yEave) : P(Lm, cc - 1, yEave));
    }
    // Конёк: два узких ската-«гребня» над коньком.
    const capW = 0.14;
    const capH = 0.07;
    const cap = [t[0] * 0.78, t[1] * 0.74, t[2] * 0.72] as V3;
    const cl = (R1 - R0) / 4;
    for (const side of [1, -1]) {
      const a0 = P(R0, mid, ridge + capH);
      const a1 = P(R1, mid, ridge + capH);
      const b0 = P(R0, mid + side * capW, ridge + capH - capW * tp * 0.6);
      const b1 = P(R1, mid + side * capW, ridge + capH - capW * tp * 0.6);
      const n = cross(sub(a1, a0), sub(b0, a0));
      if (n[1] >= 0) b.quad(a0, a1, b1, b0, [0, 0, cl, 0, cl, 0.05, 0, 0.05], L[layer], cap);
      else b.quad(a1, a0, b0, b1, [0, 0, cl, 0, cl, 0.05, 0, 0.05], L[layer], cap);
    }
    // Доски щипцов (ветровые) — только у щипцов, у вальмы их нет.
    if (!hipped) {
      const wood2 = tint(CITY.oak, 1.0);
      for (const end of [L0, L1]) {
        for (const side of [c0 - oe, c1 + oe]) {
          const A = P(end, side, yEave);
          const K = P(end, mid, ridge);
          const A2: V3 = [A[0], A[1] - 0.16, A[2]];
          const K2: V3 = [K[0], K[1] - 0.16, K[2]];
          const outward = P(end + (end === L0 ? -1 : 1), mid, ridge);
          pushQuadOut(b, A, K, K2, A2, 'wood', wood2, outward);
        }
      }
    }
  }
  // Срез щипца на стене: высота и полуширина в плоскости стены (там свеса нет).
  const wallCutHalf = hipped ? Math.max(0, half - (yCut - y) / tp) : 0;
  return { ridge, rise, cutY: hipped ? yCut : ridge, cutHalf: hip >= 1 ? -1 : wallCutHalf };
}

/** Стена щипца под полувальмой: трапеция от низа щипца до среза (у вальмы стены щипца нет). */
export function gableTrap(b: Builder, fr: Frame, a: [number, number], e: [number, number], y0: number, yCut: number, cutHalf: number, layer: LayerName, t: V3, vBase: number, vTile: number, glow: number): void {
  if (cutHalf < 0) return;
  const A = fr.p(a[0], a[1], y0);
  const E = fr.p(e[0], e[1], y0);
  const mx = (a[0] + e[0]) / 2;
  const mr = (a[1] + e[1]) / 2;
  const len = Math.hypot(E[0] - A[0], E[2] - A[2]);
  const ux = (e[0] - a[0]) / len;
  const ur = (e[1] - a[1]) / len;
  const Ct = fr.p(mx + ux * cutHalf, mr + ur * cutHalf, yCut);
  const Dt = fr.p(mx - ux * cutHalf, mr - ur * cutHalf, yCut);
  const span = spanOf(layer, len);
  const v0 = (y0 - vBase) / vTile;
  const v1 = (yCut - vBase) / vTile;
  const f = cutHalf / len;
  b.quad(A, E, Ct, Dt, [0, v0, span, v0, span * (0.5 + f), v1, span * (0.5 - f), v1], L[layer], t, [0.95, 0.95, 1, 1], glow);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Четырёхугольник, развёрнутый нормалью к точке `toward`. */
export function pushQuadOut(b: Builder, a: V3, bb: V3, c: V3, d: V3, layer: LayerName, t: V3, toward: V3, ao = 0.9): void {
  const n = cross(sub(bb, a), sub(d, a));
  const w = Math.hypot(bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]);
  const h = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  const [tw, th] = TILE_M[layer];
  const uv = [0, 0, w / tw, 0, w / tw, h / th, 0, h / th] as const;
  if (dot(n, sub(toward, a)) >= 0) b.quad(a, bb, c, d, uv, L[layer], t, [ao, ao, ao, ao]);
  else b.quad(bb, a, d, c, uv, L[layer], t, [ao, ao, ao, ao]);
}

/** Труба: кладка с плитой-шапкой. */
export function chimney(b: Builder, x: number, z: number, y0: number, y1: number, rot: number, t: V3, detail: Detail): void {
  const fx = Math.cos(rot);
  const fz = Math.sin(rot);
  box(b, x, z, fx, fz, 0.62, 0.74, y0, y1, 'rubble', t, null);
  box(b, x, z, fx, fz, 0.82, 0.94, y1, y1 + 0.12, 'ashlar', tint(CITY.limestoneGrey, 0.9), 'ashlar');
  if (detail > 0) {
    box(b, x, z, fx, fz, 0.42, 0.5, y1 + 0.12, y1 + 0.3, 'rubble', t, null);
    // Дымоход — сажей в двух сантиметрах под краем трубы (Г-9): открытый верх сверху, из окон донжона, глядел изнанкой
    // дальней стенки, и сквозь трубу было видно кровлю за ней.
    const rx = fz;
    const rz = -fx;
    const c = [
      [x + fx * 0.25 - rx * 0.21, z + fz * 0.25 - rz * 0.21],
      [x + fx * 0.25 + rx * 0.21, z + fz * 0.25 + rz * 0.21],
      [x - fx * 0.25 + rx * 0.21, z - fz * 0.25 + rz * 0.21],
      [x - fx * 0.25 - rx * 0.21, z - fz * 0.25 - rz * 0.21],
    ] as [number, number][];
    flat(b, c, y1 + 0.28, 'rubble', tint(CITY.rubbleDark, 0.22));
  }
}

// ---------------------------------------------------------------------------------------------
// Дом.

export interface HouseOut {
  /** Верх кровли — для дыма из трубы и счёта. */
  chimneys: V3[];
  ridge: number;
}

/** Ниже этой — ступеней нет (порог у двери); выше — одна или две: пол выше улицы больше чем на полметра бывает редко. */
const STEP_RISE = 0.24;
const STEP_RUN = 0.32;

/**
 * Ступени от земли `yLow` к полу `yHigh` у кромки `front` (вперёд от середины), шириной `width`. Ниже ступени
 * нечего класть; каждая ступень — короб до самой земли, вперёд от кромки, на улицу.
 */
export function stoop(b: Builder, fr: Frame, front: number, width: number, yLow: number, yHigh: number, t: V3): void {
  const rise = yHigh - yLow;
  if (rise < STEP_RISE) return;
  const n = Math.min(2, Math.ceil(rise / STEP_RISE));
  for (let k = 0; k < n; k++) {
    const top = yHigh - ((k + 1) * rise) / (n + 1);
    const [x, z] = fr.q(front + STEP_RUN * (k + 0.5), 0);
    box(b, x, z, fr.fx, fr.fz, width, STEP_RUN, yLow - 0.3, top, 'rubble', [t[0] * (1 - k * 0.03), t[1] * (1 - k * 0.03), t[2] * (1 - k * 0.03)], 'rubble', { aoBottom: 0.7 });
  }
}

/**
 * Ступени к двери дома на склоне, что стоит выше улицы (`layout.footSpan`, `House.floor`). Отдельно от `house`:
 * сборка кладёт их мимо коробки касания дома (`budget.buildStatic`) — ступени на улице не заслоняют пальцу соседа.
 */
export function houseStoop(b: Builder, h: House): void {
  if (h.street === undefined) return;
  const fr = new Frame(h.x, h.z, h.fx, h.fz);
  stoop(b, fr, h.d / 2 + 0.07, h.w * 0.7, h.street, h.floor, tint(CITY.stoneTints[h.seed % CITY.stoneTints.length], 0.86));
}

export function house(b: Builder, h: House, detail: Detail): HouseOut {
  const fr = new Frame(h.x, h.z, h.fx, h.fz);
  const hd = h.d / 2;
  const hw = h.w / 2;
  const stone = h.style !== 'timber';
  const wallT = stone ? tint(pick(CITY.stoneTints, h.wallTint), h.style === 'plaster' ? 1.02 : 1) : tint(pick(CITY.wallTints, h.wallTint));
  const plinthT = tint(CITY.stoneTints[h.seed % CITY.stoneTints.length], 0.86);
  const upLayer: LayerName = stone ? 'stoneWin' : FRAME_LAYER[h.frame];
  const lit = rnd(h.seed, 5, 1) < 0.62 ? 1 : 0;
  const y0 = h.floor;
  const lean = (rnd(h.seed, 7, 1) - 0.5) * 0.08;
  // Цоколь: от самой низкой земли до пола, чуть шире стены.
  const pl = 0.07;
  const yP0 = h.low - 0.4;
  const yP1 = y0 + 0.32;
  box(b, h.x, h.z, h.fx, h.fz, h.w + pl * 2, h.d + pl * 2, yP0, yP1, 'rubble', plinthT, null, { aoBottom: 0.7, aoTop: 0.9, grimeBottom: 1, grimeTop: 0.5 });
  // Первый этаж: фасад — дверь и лавка, бока и зад — гладко.
  const yG1 = y0 + GROUND_H;
  const sideLow: LayerName = stone ? 'rubble' : 'plaster';
  const doorShift = rnd(h.seed, 9, 1) < 0.5 ? 0 : 0.5;
  face(b, fr, [hd, -hw], [hd, hw], y0, yG1, 'groundDoor', wallT, { span: true, u0: doorShift, vTile: GROUND_H, aoB: 0.78, aoT: 0.95, glow: lit, grimeB: 0.8 });
  face(b, fr, [hd, hw], [-hd, hw], y0, yG1, sideLow, wallT, { aoB: 0.75, aoT: 0.95, grimeB: 0.8 });
  face(b, fr, [-hd, hw], [-hd, -hw], y0, yG1, sideLow, wallT, { aoB: 0.75, aoT: 0.95, grimeB: 0.8 });
  face(b, fr, [-hd, -hw], [hd, -hw], y0, yG1, sideLow, wallT, { aoB: 0.75, aoT: 0.95, grimeB: 0.8 });
  // Верхние этажи: каждый нависает над нижним вперёд на `jetty`.
  let y = yG1;
  let front = hd;
  const shiftU = rnd(h.seed, 11, 1) < 0.5 ? 0 : (BAY[upLayer] ?? 0.5);
  for (let k = 1; k < h.floors; k++) {
    const nf = front + h.jetty;
    const yy = y + STOREY_H;
    const sx = lean * k;
    const o = { span: true, u0: shiftU, vTile: STOREY_H, vBase: y, aoB: 0.86, aoT: k === h.floors - 1 ? 0.8 : 0.97, glow: lit };
    face(b, fr, [nf, -hw + sx], [nf, hw + sx], y, yy, upLayer, wallT, o);
    face(b, fr, [nf, hw + sx], [-hd, hw + sx], y, yy, upLayer, wallT, o);
    face(b, fr, [-hd, hw + sx], [-hd, -hw + sx], y, yy, upLayer, wallT, o);
    face(b, fr, [-hd, -hw + sx], [nf, -hw + sx], y, yy, upLayer, wallT, o);
    if (h.jetty > 0) {
      // Нависание: потолок-исподка и торец балок.
      const under = tint(CITY.oak, 0.9);
      const A = fr.p(front, -hw, y);
      const B = fr.p(front, hw, y);
      const C2 = fr.p(nf, hw, y);
      const D2 = fr.p(nf, -hw, y);
      pushQuadOut(b, A, B, C2, D2, 'wood', under, [A[0], A[1] - 1, A[2]], 0.55);
      const E = fr.p(nf, -hw, y - 0.18);
      const F = fr.p(nf, hw, y - 0.18);
      pushQuadOut(b, D2, C2, F, E, 'wood', tint(CITY.oak, 1.1), fr.p(nf + 1, 0, y), 0.8);
    }
    front = nf;
    y = yy;
  }
  // Кровля над верхним этажом.
  const sx = lean * (h.floors - 1);
  const roofLayer: LayerName = h.roof === 'tile' ? 'roofTile' : 'roofSlate';
  const roofHex = h.roof === 'shingle' ? CITY.shingleTint : h.roof === 'slate' ? CITY.slateTint : pick(CITY.roofTints, h.roofTint);
  const roofT = tint(roofHex, 0.92 + rnd(h.seed, 21, 1) * 0.16);
  const pitch = h.roof === 'shingle' ? h.pitch + 0.05 : h.pitch;
  // Форма кровли: щипец, полувальма (щипец срезан сверху) или вальма — у широких домов карнизом.
  const form = rnd(h.seed, 23, 1);
  const hip = !h.gable && h.w > 7.5 && form < 0.3 ? 1 : form < 0.28 ? 0.32 + rnd(h.seed, 25, 1) * 0.12 : 0;
  const r = gableRoof(b, fr, -hd, front, -hw + sx, hw + sx, y, pitch, h.gable, roofLayer, roofT, detail, h.seed, undefined, hip);
  // Щипцы: спереди и сзади (конёк вдоль «вперёд») или по бокам; под полувальмой — трапеция.
  const glow = lit;
  const ends: [[number, number], [number, number]][] = h.gable
    ? [
        [
          [front, -hw + sx],
          [front, hw + sx],
        ],
        [
          [-hd, hw + sx],
          [-hd, -hw + sx],
        ],
      ]
    : [
        [
          [front, hw + sx],
          [-hd, hw + sx],
        ],
        [
          [-hd, -hw + sx],
          [front, -hw + sx],
        ],
      ];
  for (const [a, e] of ends) {
    if (hip > 0) gableTrap(b, fr, a, e, y, r.cutY, r.cutHalf, upLayer, wallT, y, STOREY_H, glow);
    else gableTri(b, fr, a, e, y, r.ridge, upLayer, wallT, y, STOREY_H, glow);
  }
  // Слуховое окно на скате к улице у домов карнизом к улице.
  if (!h.gable && detail > 0 && h.w > 5.5) {
    const n = h.w > 8 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const rr = n === 1 ? sx : sx + (k === 0 ? -h.w / 4 : h.w / 4);
      dormer(b, fr, front, -hd, rr, y, pitch, roofT, wallT, upLayer, lit);
    }
  }
  // Трубы: у конька, ближе к заду.
  const chimneys: V3[] = [];
  const nCh = rnd(h.seed, 13, 1) < (detail === 0 ? 0.45 : 0.75) ? (h.w > 7.5 && rnd(h.seed, 15, 1) < 0.3 ? 2 : 1) : 0;
  for (let k = 0; k < nCh; k++) {
    const along = h.gable ? -hd + (h.d + front - hd) * (0.25 + 0.5 * k) : sx + (k === 0 ? -1 : 1) * h.w * 0.25;
    const across = (rnd(h.seed, 17 + k, 1) - 0.5) * 0.8;
    const p = h.gable ? fr.p(along, across + sx, 0) : fr.p((front - hd) / 2 + across, along, 0);
    const top = r.ridge + 0.7 + rnd(h.seed, 19 + k, 1) * 0.6;
    chimney(b, p[0], p[2], y + 0.5, top, Math.atan2(h.fz, h.fx), plinthT, detail);
    chimneys.push([p[0], top + 0.3, p[2]]);
  }
  return { chimneys, ridge: r.ridge };
}

/** Слуховое окно со своей двускаткой: стенка-фасад с окном, щёки и кровля. */
function dormer(b: Builder, fr: Frame, front: number, back: number, r: number, y: number, pitch: number, roofT: V3, wallT: V3, layer: LayerName, lit: number): void {
  const tp = Math.tan(pitch);
  const half = (front - back) / 2;
  const mid = (front + back) / 2;
  const w = 1.25;
  const hgt = 1.25;
  // Фасад слухового окна стоит на скате в трети от карниза.
  const fpos = front - half * 0.32;
  const ySlope = y + (front - fpos) * tp;
  const yTop = ySlope + hgt;
  const back2 = fpos - hgt / tp - 0.1;
  const t = tint(CITY.oak, 1);
  // Окно: кусок фахверковой плитки с окном (A: окно 0.62–1.38 по x, 0.98–1.98 по y).
  const A = fr.p(fpos, r - w / 2, ySlope);
  const B = fr.p(fpos, r + w / 2, ySlope);
  const C2 = fr.p(fpos, r + w / 2, yTop);
  const D2 = fr.p(fpos, r - w / 2, yTop);
  const winL = layer === 'stoneWin' ? 'timberA' : layer;
  b.quad(A, B, C2, D2, [0.125, 0.26, 0.375, 0.26, 0.375, 0.72, 0.125, 0.72], L[winL], wallT, [0.9, 0.9, 1, 1], lit);
  // Щёки: треугольники от фасада к скату.
  for (const s of [-1, 1]) {
    const P0 = fr.p(fpos, r + (s * w) / 2, ySlope);
    const P1 = fr.p(fpos, r + (s * w) / 2, yTop);
    const P2 = fr.p(back2, r + (s * w) / 2, yTop);
    const n = cross(sub(P1, P0), sub(P2, P0));
    const out = fr.p(fpos, r + s * 3, yTop);
    if (dot(n, sub(out, P0)) >= 0) b.tri(P0, P1, P2, [0, 0, 0, 0.4, 0.4, 0.4], L.plaster, wallT, [0.85, 0.95, 0.95]);
    else b.tri(P0, P2, P1, [0, 0, 0.4, 0.4, 0, 0.4], L.plaster, wallT, [0.85, 0.95, 0.95]);
  }
  // Кровелька: конёк вдоль «вперёд».
  const rise = (w / 2 + 0.15) * Math.tan(Math.PI / 4);
  for (const s of [-1, 1]) {
    const e0 = fr.p(fpos + 0.2, r + s * (w / 2 + 0.15), yTop);
    const e1 = fr.p(back2, r + s * (w / 2 + 0.15), yTop);
    const k1 = fr.p(back2, r, yTop + rise);
    const k0 = fr.p(fpos + 0.2, r, yTop + rise);
    pushQuadOut(b, e0, e1, k1, k0, 'roofTile', roofT, fr.p(mid, r + s * 3, yTop + 3), 0.95);
  }
  const g0 = fr.p(fpos, r - w / 2, yTop);
  const g1 = fr.p(fpos, r + w / 2, yTop);
  const g2 = fr.p(fpos, r, yTop + rise - 0.15);
  pushTriOut(b, g0, g1, g2, 'wood', t, fr.p(fpos + 2, r, yTop));
}

export function pushTriOut(b: Builder, a: V3, bb: V3, c: V3, layer: LayerName, t: V3, toward: V3): void {
  const n = cross(sub(bb, a), sub(c, a));
  if (dot(n, sub(toward, a)) >= 0) b.tri(a, bb, c, [0, 0, 0.5, 0, 0.25, 0.3], L[layer], t);
  else b.tri(bb, a, c, [0, 0, 0.5, 0, 0.25, 0.3], L[layer], t);
}

const crs3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Бревно (или жердь): многогранник от `a` до `e`, радиус `r`; торцы — при `caps`. */
export function log(b: Builder, a: V3, e: V3, r: number, t: V3, sides = 6, caps = true): void {
  const ax = nrm3(sub(e, a));
  let u = crs3(ax, [0, 1, 0]);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-3) u = crs3(ax, [1, 0, 0]);
  u = nrm3(u);
  const v = crs3(ax, u);
  const at = (p: V3, k: number): V3 => {
    const ang = (k / sides) * Math.PI * 2;
    const c = Math.cos(ang) * r;
    const s = Math.sin(ang) * r;
    return [p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s];
  };
  for (let k = 0; k < sides; k++) {
    const a0 = at(a, k);
    const a1 = at(a, k + 1);
    const e1 = at(e, k + 1);
    const e0 = at(e, k);
    const ang = ((k + 0.5) / sides) * Math.PI * 2;
    const out: V3 = [a0[0] + u[0] * Math.cos(ang) * 5 + v[0] * Math.sin(ang) * 5, a0[1] + u[1] * Math.cos(ang) * 5 + v[1] * Math.sin(ang) * 5, a0[2] + u[2] * Math.cos(ang) * 5 + v[2] * Math.sin(ang) * 5];
    pushQuadOut(b, a0, a1, e1, e0, 'wood', t, out, k < sides / 2 ? 0.95 : 0.7);
  }
  if (!caps) return;
  // Торцы — светлее: свежий спил.
  const cap: V3 = [t[0] * 1.35, t[1] * 1.3, t[2] * 1.2];
  for (const [p, dir] of [
    [a, -1],
    [e, 1],
  ] as const) {
    const out: V3 = [p[0] + ax[0] * dir * 5, p[1] + ax[1] * dir * 5, p[2] + ax[2] * dir * 5];
    for (let k = 1; k < sides - 1; k++) pushTriOut(b, at(p, 0), at(p, k), at(p, k + 1), 'wood', cap, out);
  }
}
