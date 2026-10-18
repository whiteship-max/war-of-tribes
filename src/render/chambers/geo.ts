// Построитель покоев (docs/city_v3.md, Г-4): грани в осях комнаты поверх построителя города (`city/geom.Builder`) — тот же
// формат вершин (положение, нормаль, UV, тон × затенение, `cfg`), те же слои текстур города, ни одной своей картинки камня
// и дерева. `cfg` у покоев читается своим шейдером (`material.ts`): слой, свечение, блеск металла, номер предмета
// (подсветка касанием).
//
// UV — плоской проекцией по главной оси грани в метрах плитки слоя; у холста покоев (`paint.ts`) — доли атласа, их
// зовущий задаёт сам.
import { Builder, type V3 } from '../city/geom';
import { L, TILE_M, type LayerName } from '../city/tex';
import { DRESSED_M, MASONRY_M } from './stone';

type Ao4 = readonly [number, number, number, number];

/**
 * Слой покоев: слой текстур города или `plain` — ровный тон без рисунка (металл, воск, кость, камни): у слоёв города на
 * мелочи с метра видны чужие следы — гнёзда клиньев каменоломни, трещины штукатурки. Шейдер покоев берёт для него белое.
 */
export type RoomLayer = LayerName | 'plain' | 'masonry' | 'dressed';
/** Номер ровного тона в `cfg.x` — за последним слоем города. */
export const PLAIN_LAYER = 250;
/** Свой камень покоев (`stone.ts`, Г-5): бутовая кладка стен и тёсаный камень проёмов — с рельефом в альфе. */
export const MASONRY_LAYER = 251;
export const DRESSED_LAYER = 252;
const OWN: Record<'plain' | 'masonry' | 'dressed', number> = { plain: PLAIN_LAYER, masonry: MASONRY_LAYER, dressed: DRESSED_LAYER };
const layerNo = (l: RoomLayer): number => (l in OWN ? OWN[l as keyof typeof OWN] : L[l as LayerName]);
const tileOf = (l: RoomLayer): readonly [number, number] =>
  l === 'plain' ? [1, 1] : l === 'masonry' ? [MASONRY_M, MASONRY_M] : l === 'dressed' ? [DRESSED_M, DRESSED_M] : TILE_M[l];
type Uv4 = readonly [number, number, number, number, number, number, number, number];

/** Построитель с переносом и поворотом вокруг вертикали: модель предмета пишется в своих осях. */
export class Mesher {
  readonly b = new Builder();
  /** Номер предмета (`plan.Thing.code`) — подсветка касанием; 0 — ничьё. */
  code = 0;
  /** Блеск металла 0..1 и свечение 0..1 — в `cfg`. */
  shine = 0;
  glow = 0;
  /** Мельче плитка слоя во столько раз (кладка покоев мельче городской: её видят с метра, а не с сотни). */
  uvK = 1;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private c = 1;
  private s = 0;
  /** Наклон вперёд (вокруг местной оси x), радианы — у книги и свитка. */
  private tc = 1;
  private ts = 0;

  /** Поставить начало и поворот (yaw — от оси z к оси x, как взгляд `plan.lookDir`). */
  at(x: number, y: number, z: number, yaw = 0, tilt = 0): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    this.tc = Math.cos(tilt);
    this.ts = Math.sin(tilt);
    return this;
  }

  reset(): this {
    return this.at(0, 0, 0, 0, 0);
  }

  /** Точка своих осей → оси комнаты. */
  p(x: number, y: number, z: number): V3 {
    const y1 = y * this.tc - z * this.ts;
    const z1 = y * this.ts + z * this.tc;
    return [this.ox + x * this.c + z1 * this.s, this.oy + y1, this.oz - x * this.s + z1 * this.c];
  }

  /** Четырёхугольник против часовой снаружи, в своих осях; UV — проекцией (или заданные). */
  quad(a: V3, b: V3, c: V3, d: V3, layer: RoomLayer, tint: V3, ao: Ao4 = [1, 1, 1, 1], uv?: Uv4): void {
    const A = this.p(...a);
    const B = this.p(...b);
    const C = this.p(...c);
    const D = this.p(...d);
    this.b.owner = this.code;
    const sh = this.shine;
    const k = this.uvK;
    const w = uv ?? planarUv([a, b, c, d], layer);
    const uvs = (k === 1 ? w : w.map((x) => x * k)) as unknown as Uv4;
    this.b.quad(A, B, C, D, uvs, layerNo(layer), tint, ao, this.glow, [sh, sh, sh, sh]);
  }

  /** Треугольник — вырожденным четырёхугольником: у треугольника построителя нет блеска. */
  tri(a: V3, b: V3, c: V3, layer: RoomLayer, tint: V3, ao: readonly [number, number, number] = [1, 1, 1]): void {
    this.quad(a, b, c, c, layer, tint, [ao[0], ao[1], ao[2], ao[2]]);
  }

  /** Коробка по своим осям, нормали наружу; `skip` — каких граней нет (`+x -x +y -y +z -z`); низ темнее у пола. */
  cuboid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, layer: RoomLayer, tint: V3, opt: { skip?: string; aoLow?: number; topLayer?: RoomLayer } = {}): void {
    const sk = opt.skip ?? '';
    const lo = opt.aoLow ?? 1;
    const side: Ao4 = [lo, lo, 1, 1];
    if (!sk.includes('+x')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], layer, tint, side);
    if (!sk.includes('-x')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], layer, tint, side);
    if (!sk.includes('+z')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], layer, tint, side);
    if (!sk.includes('-z')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], layer, tint, side);
    if (!sk.includes('+y')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opt.topLayer ?? layer, tint);
    if (!sk.includes('-y')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], layer, tint, [lo, lo, lo, lo]);
  }

  /** Брус между двумя точками (стропило, ножка, рукоять): квадратное сечение `w × h`, ось — от `a` к `e`. */
  beam(a: V3, e: V3, w: number, h: number, layer: RoomLayer, tint: V3): void {
    const dx = e[0] - a[0];
    const dy = e[1] - a[1];
    const dz = e[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const f: V3 = [dx / len, dy / len, dz / len];
    // Боковая ось — горизонтальная поперёк, если брус не отвесный.
    let sx = -f[2];
    let sz = f[0];
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-3) {
      sx = 1;
      sz = 0;
    } else {
      sx /= sl;
      sz /= sl;
    }
    const sv: V3 = [sx, 0, sz];
    const uv: V3 = [f[1] * sz - f[2] * 0, f[2] * sx - f[0] * sz, f[0] * 0 - f[1] * sx];
    const corner = (p: V3, i: number, j: number): V3 => [p[0] + sv[0] * i * w * 0.5 + uv[0] * j * h * 0.5, p[1] + sv[1] * i * w * 0.5 + uv[1] * j * h * 0.5, p[2] + sv[2] * i * w * 0.5 + uv[2] * j * h * 0.5];
    const ring = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (let k = 0; k < 4; k++) {
      const [i0, j0] = ring[k];
      const [i1, j1] = ring[(k + 1) % 4];
      // Против часовой снаружи: поперёк у начала, потом вдоль к концу. Волокно дерева — вдоль бруса (v слоя).
      const p0 = corner(a, i0, j0);
      const p1 = corner(a, i1, j1);
      const p2 = corner(e, i1, j1);
      const p3 = corner(e, i0, j0);
      const [, th] = tileOf(layer);
      const v1 = len / th;
      this.quad(p0, p1, p2, p3, layer, tint, [1, 1, 1, 1], [0, 0, 0.12, 0, 0.12, v1, 0, v1]);
    }
  }

  /**
   * Сгладить нормали вершин с номера `from`: вершины в одной точке с гранями не круче `deg` друг к другу получают общую
   * нормаль — точёное тело круглое, а не гранёное (кубок, свиток, свеча), рёбра круче — остаются рёбрами.
   */
  smoothFrom(from: number, deg = 50): void {
    const pos = this.b.pos;
    const nor = this.b.nor;
    const n = this.b.vertexCount;
    const cos = Math.cos((deg * Math.PI) / 180);
    const buckets = new Map<string, number[]>();
    for (let i = from; i < n; i++) {
      const key = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
      const b = buckets.get(key);
      if (b) b.push(i);
      else buckets.set(key, [i]);
    }
    const out = nor.slice(from * 3, n * 3);
    for (const b of buckets.values()) {
      if (b.length < 2) continue;
      for (const i of b) {
        let x = 0;
        let y = 0;
        let z = 0;
        for (const j of b) {
          const d = nor[i * 3] * nor[j * 3] + nor[i * 3 + 1] * nor[j * 3 + 1] + nor[i * 3 + 2] * nor[j * 3 + 2];
          if (d < cos) continue;
          x += nor[j * 3];
          y += nor[j * 3 + 1];
          z += nor[j * 3 + 2];
        }
        const l = Math.hypot(x, y, z) || 1;
        const o = (i - from) * 3;
        out[o] = x / l;
        out[o + 1] = y / l;
        out[o + 2] = z / l;
      }
    }
    for (let i = 0; i < out.length; i++) nor[from * 3 + i] = out[i];
  }

  /**
   * Точёное тело (кубок, свеча, ножка, фигура): профиль `[r, y]` снизу вверх, `seg` граней по кругу, середина — начало.
   * Нулевой радиус — вершина или донце. Нормали сглажены (`smoothFrom`): тело круглое, перегибы профиля круче 50° — рёбра.
   */
  lathe(profile: readonly (readonly [number, number])[], seg: number, layer: RoomLayer, tint: V3, aoBottom = 1): void {
    const from = this.b.vertexCount;
    this.latheFaces(profile, seg, layer, tint, aoBottom);
    this.smoothFrom(from);
  }

  private latheFaces(profile: readonly (readonly [number, number])[], seg: number, layer: RoomLayer, tint: V3, aoBottom: number): void {
    const [tw, th] = tileOf(layer);
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      const a0 = i === 0 ? aoBottom : 1;
      for (let k = 0; k < seg; k++) {
        const t0 = (k / seg) * Math.PI * 2;
        const t1 = ((k + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(t0);
        const s0 = Math.sin(t0);
        const c1 = Math.cos(t1);
        const s1 = Math.sin(t1);
        const u0 = (k / seg) * (Math.PI * 2 * Math.max(r0, r1, 0.02)) / tw;
        const u1 = ((k + 1) / seg) * (Math.PI * 2 * Math.max(r0, r1, 0.02)) / tw;
        // Снаружи против часовой: по кругу от t1 к t0 внизу, затем вверх. Ноль радиуса — треугольник: у построителя
        // нормаль — по первым трём углам, и два совпавших дали бы нулевую.
        const A: V3 = [c1 * r0, y0, s1 * r0];
        const B: V3 = [c0 * r0, y0, s0 * r0];
        const C: V3 = [c0 * r1, y1, s0 * r1];
        const D: V3 = [c1 * r1, y1, s1 * r1];
        if (r0 < 1e-6) this.quad(A, C, D, D, layer, tint, [a0, 1, 1, 1], [u1, y0 / th, u0, y1 / th, u1, y1 / th, u1, y1 / th]);
        else if (r1 < 1e-6) this.quad(A, B, C, C, layer, tint, [a0, a0, 1, 1], [u1, y0 / th, u0, y0 / th, u0, y1 / th, u0, y1 / th]);
        else this.quad(A, B, C, D, layer, tint, [a0, a0, 1, 1], [u1, y0 / th, u0, y0 / th, u0, y1 / th, u1, y1 / th]);
      }
    }
  }

  /**
   * Плоская грань с дырами в плоскости с началом `o`, осями `u`, `v` (нормаль — u × v, к зрителю): контур и дыры —
   * многоугольники в метрах плоскости. Режется вертикальными полосами по углам контура и дыр: в каждой полосе — грань под
   * дырой и над ней (или во всю высоту). Поэтому контур и дыры — выпуклые (прямоугольник стены, арка ниши и проёма), а
   * дыры по ширине не заходят друг на друга. Триангуляцию three (`ShapeUtils`) покои не зовут: её имя легло бы в кусок
   * three первой загрузки (docs/city_v3.md, Г-4, «Вес загрузки»).
   */
  plane(o: V3, u: V3, v: V3, outer: readonly (readonly [number, number])[], holes: readonly (readonly (readonly [number, number])[])[], layer: RoomLayer, tint: V3): void {
    const at = (x: number, y: number): V3 => [o[0] + u[0] * x + v[0] * y, o[1] + u[1] * x + v[1] * y, o[2] + u[2] * x + v[2] * y];
    const xs = [...new Set([...outer, ...holes.flat()].map((p) => p[0]))].sort((a, b) => a - b);
    const [tw, th] = tileOf(layer);
    const k = this.uvK;
    const face = (x0: number, a0: number, b0: number, x1: number, a1: number, b1: number): void => {
      if (b0 - a0 < 1e-5 && b1 - a1 < 1e-5) return;
      this.b.owner = this.code;
      const sh = this.shine;
      const uv = [x0 / tw, a0 / th, x1 / tw, a1 / th, x1 / tw, b1 / th, x0 / tw, b0 / th].map((q) => q * k) as unknown as Uv4;
      this.b.quad(this.p(...at(x0, a0)), this.p(...at(x1, a1)), this.p(...at(x1, b1)), this.p(...at(x0, b0)), uv, layerNo(layer), tint, [1, 1, 1, 1], this.glow, [sh, sh, sh, sh]);
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      // Края полосы — чуть внутрь: отвесная сторона дыры на краю принадлежит соседней полосе.
      const x0 = xs[i] + 1e-6;
      const x1 = xs[i + 1] - 1e-6;
      if (x1 - x0 < 1e-5) continue;
      const c0 = slice(outer, x0);
      const c1 = slice(outer, x1);
      if (!c0 || !c1) continue;
      const mid = (x0 + x1) / 2;
      const hole = holes.find((h) => {
        const r = slice(h, mid);
        return r !== null;
      });
      const h0 = hole ? slice(hole, x0) : null;
      const h1 = hole ? slice(hole, x1) : null;
      if (h0 && h1) {
        face(x0, c0[0], h0[0], x1, c1[0], h1[0]);
        face(x0, h0[1], c0[1], x1, h1[1], c1[1]);
      } else face(x0, c0[0], c0[1], x1, c1[0], c1[1]);
    }
  }

  /** Откос между двумя многоугольниками равной длины (ниша окна, устье камина): грани внутрь, к оси проёма. */
  loft(a: readonly V3[], e: readonly V3[], layer: RoomLayer, tint: V3, closed: boolean, aoFar = 1): void {
    const n = a.length;
    const [tw, th] = tileOf(layer);
    let run = 0;
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const k1 = (k + 1) % n;
      const seg = Math.hypot(a[k1][0] - a[k][0], a[k1][1] - a[k][1], a[k1][2] - a[k][2]);
      const depth = Math.hypot(e[k][0] - a[k][0], e[k][1] - a[k][1], e[k][2] - a[k][2]);
      this.quad(a[k], e[k], e[k1], a[k1], layer, tint, [1, aoFar, aoFar, 1], [run / tw, 0, run / tw, depth / th, (run + seg) / tw, depth / th, (run + seg) / tw, 0]);
      run += seg;
    }
  }
}

/** Срез выпуклого многоугольника отвесной прямой `x`: низ и верх, или `null`, если прямая мимо. */
function slice(poly: readonly (readonly [number, number])[], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if (x < Math.min(ax, bx) || x > Math.max(ax, bx) || ax === bx) continue;
    const y = ay + ((by - ay) * (x - ax)) / (bx - ax);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** UV плоской проекцией по главной оси нормали, в плитках слоя. */
function planarUv(ps: readonly V3[], layer: RoomLayer): Uv4 {
  const [a, b, , d] = ps;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  const nx = Math.abs(uy * vz - uz * vy);
  const ny = Math.abs(uz * vx - ux * vz);
  const nz = Math.abs(ux * vy - uy * vx);
  const [tw, th] = tileOf(layer);
  const out: number[] = [];
  for (const p of ps) {
    if (ny >= nx && ny >= nz) out.push(p[0] / tw, p[2] / th);
    else if (nx >= nz) out.push(p[2] / tw, p[1] / th);
    else out.push(p[0] / tw, p[1] / th);
  }
  return out as unknown as Uv4;
}

/** Арка проёма: полукруг над пятой, `n` отрезков, от левой пяты к правой; к ней снизу — прямоугольник до подоконника. */
export function archOutline(half: number, sill: number, spring: number, rise: number, n: number): [number, number][] {
  const pts: [number, number][] = [[-half, sill], [half, sill], [half, spring]];
  for (let k = 1; k < n; k++) {
    const a = (k / n) * Math.PI;
    pts.push([Math.cos(a) * half, spring + Math.sin(a) * rise]);
  }
  pts.push([-half, spring]);
  return pts;
}
