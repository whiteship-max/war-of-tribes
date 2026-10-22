// Дворы за стеной вида «город» (docs/city.md, разделы 4 и 5): лесопилка с водяным колесом на реке, Охотничий двор в
// лесу, Шахта со штольней и отвалом на опушке, Ферма — хутор с амбаром и стогами и загон на выгоне (ЗД-1: навес
// собирателей и каменоломня ушли в Охотничий двор и Шахту, их свой вид — ЗД-2). Один вид навсегда: уровни игры модель
// не меняют. Всё — в построитель зданий: один меш с городом.
//
// Дерево и камень — те же слои, что у города; мелочь (корзины, брёвна, шкуры, тачка) — только с
// подробностью выше низкой: силуэт двора держат объёмы.
import { CITY } from './palette';
import { Builder, box, cone, cylinder, tint, type V3 } from './geom';
import { Frame, log, pushQuadOut, type Detail } from './kit';
import { body } from './civic';
import { FLOOR_LIFT, footSpan, heightAt, RACE_LEVEL, type Civic, type Yard } from './layout';
import { rnd } from './noise';

const wood = (k = 1): V3 => tint(CITY.oak, k);
const woodLight = (k = 1): V3 => tint(CITY.oakLight, k);
const grey = (k = 1): V3 => tint(CITY.timberGrey, k);
const straw = tint(0xd6b878);
const hide = tint(0x8a6646);

/** Самая низкая земля под прямоугольником рамки. */
function lowUnder(fr: Frame, hf: number, hr: number): number {
  let lo = Infinity;
  for (const [f, r] of [
    [hf, hr],
    [hf, -hr],
    [-hf, hr],
    [-hf, -hr],
    [0, 0],
  ]) {
    const [x, z] = fr.q(f, r);
    lo = Math.min(lo, heightAt(x, z));
  }
  return lo;
}

/** Столб в рамке: квадратный брус от земли под ним до `top` (над землёй, если `fromGround`). */
function post(b: Builder, fr: Frame, f: number, r: number, h: number, s: number, t: V3, bury = 0.3): void {
  const [x, z] = fr.q(f, r);
  const y = heightAt(x, z);
  box(b, x, z, fr.fx, fr.fz, s, s, y - bury, y + h, 'wood', t, 'wood', { aoBottom: 0.6 });
}

/** Изгородь в рамке от (f0, r0) до (f1, r1): столбы через `step` и две жерди по земле. */
function fence(b: Builder, fr: Frame, f0: number, r0: number, f1: number, r1: number, step: number, detail: Detail): void {
  const len = Math.hypot(f1 - f0, r1 - r0);
  const n = Math.max(1, Math.round(len / step));
  const T = grey(1.05);
  for (let k = 0; k <= n; k++) post(b, fr, f0 + ((f1 - f0) * k) / n, r0 + ((r1 - r0) * k) / n, 1.25, 0.16, T);
  for (const h of detail > 0 ? [0.55, 1.05] : [0.9]) {
    for (let k = 0; k < n; k++) {
      const pa = fr.q(f0 + ((f1 - f0) * k) / n, r0 + ((r1 - r0) * k) / n);
      const pe = fr.q(f0 + ((f1 - f0) * (k + 1)) / n, r0 + ((r1 - r0) * (k + 1)) / n);
      log(b, [pa[0], heightAt(pa[0], pa[1]) + h, pa[1]], [pe[0], heightAt(pe[0], pe[1]) + h, pe[1]], 0.06, T, 4, false);
    }
  }
}

/** Здание двора — то же тело, что у больших зданий (`civic.body`). */
const hall = (y: Yard, f: number, r: number, rot: number, w: number, d: number): Civic => {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const [x, z] = fr.q(f, r);
  // Пол — над самой высокой землёй следа: дом двора на склоне не тонет, под ним цоколь (`civic.body`).
  return { kind: 'stable', x, z, rot, w, d, base: footSpan(x, z, Math.cos(rot), Math.sin(rot), w, d).hi + FLOOR_LIFT, seed: y.seed + Math.round(f * 7 + r * 13) };
};

/** Дома дворов: (вперёд, вправо, доворот, ширина, глубина) — одни на модели и на тест посадки (`seat.test.ts`). */
const YARD_HALLS: Record<Yard['kind'], readonly (readonly [number, number, number, number, number])[]> = {
  sawmill: [[0, 0, 0, 11, 8]],
  hunter_hut: [[0, 0, 0, 6.5, 5.5]],
  mine: [[7, -9, 0, 5.5, 4.5]],
  farm: [
    [0, -6, 0, 15, 8],
    [-9, 9, Math.PI / 2, 12, 8.5],
  ],
  pen: [],
};

/** Дома двора — как их ставит `yard`. */
export const yardHalls = (y: Yard): Civic[] => YARD_HALLS[y.kind].map(([f, r, rot, w, d]) => hall(y, f, r, y.rot + rot, w, d));

/** Стог: цилиндр соломы под конусом. */
function stack(b: Builder, x: number, z: number, r: number, h: number): void {
  const y = heightAt(x, z);
  cylinder(b, x, z, r, y - 0.2, y + h * 0.55, 10, 'wood', straw, { aoBottom: 0.6 });
  cone(b, x, z, r * 1.08, y + h * 0.5, y + h, 10, 'wood', [straw[0] * 1.05, straw[1] * 1.05, straw[2]], 0.85);
}

// ---------------------------------------------------------------------------------------------

/** Колесо лесопилки в рамке двора: вынос вперёд от середины дома, высота оси, радиус. */
const WHEEL_R = 2.7;
const WHEEL_AT = { wf: 8 / 2 + 4.5, cy: RACE_LEVEL + WHEEL_R - 0.45 };

/**
 * Водяное колесо (docs/city.md, 16.4): два обода, лопасти во всю ширину, спицы. `P(off, r, y)` — точка: `off` вдоль
 * оси, (`r`, `y`) — в плоскости колеса от оси. Одна модель на два места: стоя в общем меше (на «Низком») и в своём
 * меше, что крутится (`millWheel`).
 */
export function wheelModel(b: Builder, P: (off: number, r: number, y: number) => V3, d: Detail): void {
  const R = WHEEL_R;
  const seg = d === 0 ? 10 : 16;
  const T = wood(1.15);
  const rim = (k: number, rr: number, off: number): V3 => {
    const ang = (k / seg) * Math.PI * 2;
    return P(off, Math.cos(ang) * rr, Math.sin(ang) * rr);
  };
  for (const off of [-0.55, 0.55]) {
    for (let k = 0; k < seg; k++) log(b, rim(k, R, off), rim(k + 1, R, off), 0.12, T, 4, false);
  }
  // Лопасти — доски по радиусу во всю ширину колеса; спицы — через одну четверть.
  for (let k = 0; k < seg; k += d === 0 ? 2 : 1) {
    const ang = ((k + 0.5) / seg) * Math.PI * 2;
    const p = (off: number, rr: number): V3 => P(off, Math.cos(ang) * rr, Math.sin(ang) * rr);
    const A = p(-0.55, R - 0.75);
    const B = p(0.55, R - 0.75);
    const C = p(0.55, R + 0.05);
    const E = p(-0.55, R + 0.05);
    pushQuadOut(b, A, B, C, E, 'wood', T, P(0, Math.cos(ang + 0.5) * R * 2, Math.sin(ang + 0.5) * R * 2), 0.9);
    pushQuadOut(b, A, B, C, E, 'wood', T, P(0, Math.cos(ang - 0.5) * R * 2, Math.sin(ang - 0.5) * R * 2), 0.7);
    if (k % 4 === 0) log(b, P(0, 0, 0), rim(k, R, 0), 0.08, T, 4, false);
  }
}

/**
 * Колесо, что крутится: модель вокруг своей оси (x — ось, y — вверх, z — против «вправо» двора) и где оно стоит.
 * Меш ставит `index.MillWheel`: поворот вокруг y — ось на (fx, fz), вращение — вокруг своей x.
 */
export function millWheel(y: Yard, d: Detail): { b: Builder; at: V3; fx: number; fz: number; R: number; water: number } {
  const fx = Math.cos(y.rot);
  const fz = Math.sin(y.rot);
  const fr = new Frame(y.x, y.z, fx, fz);
  const b = new Builder();
  wheelModel(b, (off, r, yy) => [off, yy, -r], d);
  return { b, at: fr.p(WHEEL_AT.wf, 0, WHEEL_AT.cy), fx, fz, R: WHEEL_R, water: RACE_LEVEL };
}

/**
 * Угольная куча лесопилки во дворе (вперёд, вправо, радиус): за домом и левее — мельничный ручей обходит дом сзади и
 * справа, река — слева; место выбрано так, чтобы куча стояла на суше с запасом от обоих, и держит это `seat.test.ts`.
 */
export const KILN = { f: -9, r: -5, R: 3 } as const;

/**
 * Лесопилка: каменный низ и фахверк над ним, колесо в мельничном ручье у южной стены (`layout.RACE`) —
 * лицом к камере, ось — в стену; брёвна штабелем и доски во дворе.
 */
function sawmill(b: Builder, y: Yard, d: Detail): { lights: V3[]; chimneys: V3[] } {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const W = 11;
  const D = 8;
  const c = yardHalls(y)[0];
  const r = body(
    b,
    c,
    {
      storeys: [
        { h: 3.4, front: 'groundDoor', side: 'rubble', back: 'rubble' },
        { h: 2.9, front: 'timberB', side: 'timberB' },
      ],
      wallHex: CITY.wallTints[1],
      roof: { pitch: (52 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
      chimneys: 1,
      glow: 1,
    },
    d,
  );
  // Колесо: в ручье перед фасадом, обод — в плоскости фасада, ось — вперёд, в стену. На «Среднем» и «Высоком» оно
  // крутится — его рисует отдельный меш (`millWheel`, `index.MillWheel`), здесь — только на «Низком», стоя.
  const { wf, cy } = WHEEL_AT;
  if (d === 0) wheelModel(b, (off, r, yy) => fr.p(wf + off, r, cy + yy), d);
  // Ось — из стены через колесо на каменную опору за ручьём.
  log(b, fr.p(D / 2 - 0.2, 0, cy), fr.p(wf + 2.6, 0, cy), 0.2, wood(0.9), 6, true);
  const [sx, sz] = fr.q(wf + 2.6, 0);
  box(b, sx, sz, fr.fx, fr.fz, 0.9, 0.9, heightAt(sx, sz) - 1, cy - 0.15, 'rubble', tint(CITY.stoneTints[1], 0.85), 'ashlar', { aoBottom: 0.7 });
  if (d > 0) {
    // Брёвна штабелем у восточной стены: три, два, одно — вдоль «вперёд».
    let k = 0;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const rr = 0.32;
        const r0 = W / 2 + 2 + (i + row * 0.5) * rr * 2.05;
        const a = fr.p(-3.5, r0, 0);
        const e = fr.p(3, r0, 0);
        const ya = heightAt(a[0], a[2]) + rr + row * rr * 1.75;
        const ye = heightAt(e[0], e[2]) + rr + row * rr * 1.75;
        log(b, [a[0], ya, a[2]], [e[0], ye, e[2]], rr + rnd(y.seed, k++, 5) * 0.06, woodLight(0.8), 7, true);
      }
    }
    // Доски стопкой у западной стены.
    const [lx, lz] = fr.q(0, -W / 2 - 1.6);
    const ly = heightAt(lx, lz);
    box(b, lx, lz, fr.fx, fr.fz, 1.6, 4.5, ly, ly + 1.1, 'wood', woodLight(1.1), 'wood', { aoBottom: 0.6 });
    // Угольная куча за лесопилкой: сучья под дёрном тлеют неделю, дым идёт из макушки (docs/economy.md, «Уголь вместо
    // костей»). Низкий земляной купол — два конуса, чёрная земля у подножия и дёрн выше; поленница сучьев рядом.
    const [kx, kz] = fr.q(KILN.f, KILN.r);
    const ky = heightAt(kx, kz);
    cone(b, kx, kz, KILN.R, ky - 0.3, ky + 1.6, 12, 'rubble', tint(0x4a4651, 0.9), 0.75);
    cone(b, kx, kz, KILN.R * 0.63, ky + 0.6, ky + 2.3, 10, 'grass', tint(0x6f6a4e, 0.85), 0.8);
    // Сучья — между кучей и домом, поперёк «вперёд».
    for (let i = 0; i < 4; i++) {
      const a0 = fr.p(KILN.f + KILN.R + 0.25 + i * 0.4, KILN.r - 1.2, 0);
      const e0 = fr.p(KILN.f + KILN.R + 0.25 + i * 0.4, KILN.r + 1.2, 0);
      const yy = Math.max(heightAt(a0[0], a0[2]), heightAt(e0[0], e0[2])) + 0.12 + (i % 2) * 0.1;
      log(b, [a0[0], yy, a0[2]], [e0[0], yy, e0[2]], 0.12, wood(0.8), 5, true);
    }
    return { lights: [fr.p(D / 2 + 0.4, -2, c.base + 2.6)], chimneys: [...r.chimneys, [kx, ky + 2.4, kz]] };
  }
  return { lights: [fr.p(D / 2 + 0.4, -2, c.base + 2.6)], chimneys: r.chimneys };
}

/** Охотничий домик: сруб под крутой дранкой, сушило со шкурами, поленница. */
function hunterHut(b: Builder, y: Yard, d: Detail): { lights: V3[]; chimneys: V3[] } {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const c = yardHalls(y)[0];
  const r = body(
    b,
    c,
    {
      storeys: [{ h: 2.7, front: 'groundDoor', side: 'wood', back: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (52 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
      chimneys: 1,
      glow: 1,
    },
    d,
  );
  if (d > 0) {
    // Сушило: две стойки, жердь, три шкуры.
    for (const rr of [4.6, 8.4]) post(b, fr, 1.5, rr, 2.2, 0.14, grey());
    const p0 = fr.p(1.5, 4.6, 0);
    const h1 = heightAt(p0[0], p0[2]) + 2.1;
    log(b, fr.p(1.5, 4.6, h1), fr.p(1.5, 8.4, h1), 0.06, grey(), 4, false);
    for (let k = 0; k < 3; k++) {
      const r0 = 4.9 + k * 1.2;
      const A = fr.p(1.5, r0, h1);
      const B = fr.p(1.5, r0 + 0.9, h1);
      const C = fr.p(1.45, r0 + 0.8, h1 - 1.3);
      const D2 = fr.p(1.45, r0 + 0.1, h1 - 1.2);
      const tone: V3 = [hide[0] * (0.85 + k * 0.12), hide[1] * (0.85 + k * 0.1), hide[2]];
      pushQuadOut(b, A, B, C, D2, 'cloth', tone, fr.p(5, r0, h1), 0.9);
      pushQuadOut(b, A, B, C, D2, 'cloth', tone, fr.p(-5, r0, h1), 0.7);
    }
    // Поленница у стены.
    const [px, pz] = fr.q(-0.5, -4.2);
    const ph = heightAt(px, pz);
    box(b, px, pz, fr.fx, fr.fz, 1.1, 3.4, ph - 0.1, ph + 1.3, 'wood', woodLight(0.85), 'wood', { aoBottom: 0.6 });
  }
  return { lights: [fr.p(3.0, 0, c.base + 1.8)], chimneys: r.chimneys };
}

/** Рудник: забой в склоне с крепью штольни, отвал, рельсы и тачка, хижина горняков. */
function mine(b: Builder, y: Yard, d: Detail): V3[] {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const rockT = tint(CITY.stoneTints[2], 0.72);
  // Забой: скальный выступ клином — отвесный лоб к долине, верх уходит в склон; в лбу — устье штольни.
  const lo = lowUnder(new Frame(...fr.q(-2, 0), fr.fx, fr.fz), 3.5, 6) - 0.6;
  const g = heightAt(...fr.q(1.6, 0));
  const hiF = g + 4.6;
  const hb = heightAt(...fr.q(-7, 0)) + 0.4;
  const P = (f: number, r: number, h: number): V3 => fr.p(f, r, h);
  const out = fr.p(20, 0, g);
  pushQuadOut(b, P(1.5, -6, lo), P(1.5, 6, lo), P(1.5, 6, hiF), P(1.5, -6, hiF), 'rock', rockT, out, 0.85);
  pushQuadOut(b, P(1.5, -6, hiF), P(1.5, 6, hiF), P(-7, 6.5, hb), P(-7, -6.5, hb), 'rock', [rockT[0] * 1.1, rockT[1] * 1.12, rockT[2] * 1.05], fr.p(0, 0, hiF + 20), 1);
  for (const side of [-1, 1]) {
    pushQuadOut(b, P(1.5, 6 * side, lo), P(-7, 6.5 * side, lo), P(-7, 6.5 * side, hb), P(1.5, 6 * side, hiF), 'rock', rockT, fr.p(0, side * 20, g), 0.8);
  }
  const g0 = heightAt(...fr.q(1.6, 0));
  // Устье: тёмный проём в рамке крепи.
  const A = fr.p(1.55, -1.1, g0);
  const B = fr.p(1.55, 1.1, g0);
  const C = fr.p(1.55, 1.1, g0 + 2.4);
  const D2 = fr.p(1.55, -1.1, g0 + 2.4);
  pushQuadOut(b, A, B, C, D2, 'groundDoor', tint(0x1a1612, 0.6), fr.p(6, 0, g0 + 1), 0.4);
  const T = wood(1.0);
  for (const r of [-1.25, 1.25]) {
    const [x, z] = fr.q(1.7, r);
    box(b, x, z, fr.fx, fr.fz, 0.3, 0.3, g0 - 0.2, g0 + 2.7, 'wood', T, null, { aoBottom: 0.6 });
  }
  const [lx, lz] = fr.q(1.7, 0);
  box(b, lx, lz, fr.fx, fr.fz, 3.2, 0.34, g0 + 2.5, g0 + 2.85, 'wood', T, 'wood');
  // Отвал пустой породы — ниже по склону, сбоку.
  const [hx, hz] = fr.q(9, 6);
  const hy = heightAt(hx, hz);
  cone(b, hx, hz, 6.5, hy - 0.6, hy + 3.2, d === 0 ? 8 : 12, 'rock', tint(0x8a7c6a, 0.9), 0.75);
  if (d > 0) {
    // Рельсы от устья к отвалу и тачка.
    for (const off of [-0.45, 0.45]) {
      const p0 = fr.p(2, off, 0);
      const p1 = fr.p(8.5, 4 + off, 0);
      log(b, [p0[0], heightAt(p0[0], p0[2]) + 0.08, p0[2]], [p1[0], heightAt(p1[0], p1[2]) + 0.08, p1[2]], 0.06, grey(0.8), 4, false);
    }
    const [tx, tz] = fr.q(5, 1.8);
    const ty = heightAt(tx, tz);
    box(b, tx, tz, fr.fx, fr.fz, 1.1, 1.5, ty + 0.25, ty + 0.95, 'wood', wood(1.1), 'rock');
  }
  // Хижина горняков.
  body(
    b,
    yardHalls(y)[0],
    {
      storeys: [{ h: 2.7, front: 'groundDoor', side: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (48 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
    },
    d,
  );
  return [fr.p(2.2, 0, g0 + 2)];
}

/** Хутор: длинный дом и амбар под высокими кровлями, двор в изгороди, стога и телега. */
function farm(b: Builder, y: Yard, d: Detail): { lights: V3[]; chimneys: V3[] } {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const house = yardHalls(y)[0];
  const r = body(
    b,
    house,
    {
      storeys: [
        { h: 3.4, front: 'groundDoor', side: 'plaster' },
        { h: 2.9, front: 'timberC', side: 'timberC' },
      ],
      wallHex: CITY.wallTints[1],
      roof: { pitch: (55 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
      chimneys: 1,
      glow: 1,
    },
    d,
  );
  // Амбар поперёк — дощатый, под тёмной дранкой, ворота к двору.
  body(
    b,
    yardHalls(y)[1],
    {
      storeys: [{ h: 4.2, front: 'wood', side: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (50 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
    },
    d,
  );
  // Изгородь двора — с проходом к дороге.
  fence(b, fr, 7, -16, 7, -3, 2.6, d);
  fence(b, fr, 7, 3, 7, 16, 2.6, d);
  fence(b, fr, 7, 16, -16, 16, 2.6, d);
  fence(b, fr, -16, 16, -16, -16, 2.6, d);
  fence(b, fr, -16, -16, 7, -16, 2.6, d);
  // Стога за амбаром.
  for (let k = 0; k < (d === 0 ? 2 : 4); k++) {
    const [x, z] = fr.q(-21 - (k % 2) * 4.5, 4 + k * 3.5);
    stack(b, x, z, 1.7 + rnd(y.seed, k, 9) * 0.4, 4 + rnd(y.seed, k, 11));
  }
  if (d > 0) {
    // Телега у амбара: короб и два колеса.
    const [tx, tz] = fr.q(-1, 9);
    const ty = heightAt(tx, tz);
    box(b, tx, tz, fr.fx, fr.fz, 1.5, 3, ty + 0.7, ty + 1.3, 'wood', woodLight(1.05), 'wood');
    for (const rr of [-0.9, 0.9]) {
      const c0 = fr.p(-1, 9 + rr, 0);
      cylinder(b, c0[0], c0[2], 0.7, ty, ty + 0.12, 8, 'wood', wood(0.9));
      log(b, fr.p(-1.6, 9 + rr, ty + 0.7), fr.p(-0.4, 9 + rr, ty + 0.7), 0.05, wood(0.8), 4, false);
    }
    log(b, fr.p(1.3, 9, ty + 0.9), fr.p(3.6, 9, ty + 0.3), 0.06, wood(0.9), 4, false);
  }
  return { lights: [fr.p(4.4, -6, house.base + 2.6)], chimneys: r.chimneys };
}

/** Загон: выгон в изгороди, навес для овец, корыто. */
function pen(b: Builder, y: Yard, d: Detail): V3[] {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const F = 10;
  const R = 15;
  fence(b, fr, F, -R, F, -2.5, 2.5, d);
  fence(b, fr, F, 2.5, F, R, 2.5, d);
  fence(b, fr, F, R, -F, R, 2.5, d);
  fence(b, fr, -F, R, -F, -R, 2.5, d);
  fence(b, fr, -F, -R, F, -R, 2.5, d);
  // Навес у задней изгороди: столбы и односкатная дранка.
  const W = 7;
  const D = 3.2;
  const [cx, cz] = fr.q(-F + D / 2 + 0.3, 6);
  const base = heightAt(cx, cz);
  for (const r of [6 - W / 2, 6 + W / 2]) {
    post(b, fr, -F + 0.3, r, base + 2.1 - heightAt(...fr.q(-F + 0.3, r)), 0.2, wood());
    post(b, fr, -F + 0.3 + D, r, base + 2.6 - heightAt(...fr.q(-F + 0.3 + D, r)), 0.2, wood());
  }
  const A = fr.p(-F + D + 0.9, 6 - W / 2 - 0.4, base + 2.75);
  const B = fr.p(-F + D + 0.9, 6 + W / 2 + 0.4, base + 2.75);
  const C = fr.p(-F - 0.2, 6 + W / 2 + 0.4, base + 2.05);
  const E = fr.p(-F - 0.2, 6 - W / 2 - 0.4, base + 2.05);
  pushQuadOut(b, A, B, C, E, 'roofSlate', tint(CITY.shingleTint, 0.9), [A[0], A[1] + 10, A[2]], 0.95);
  pushQuadOut(b, A, B, C, E, 'wood', wood(0.6), [A[0], A[1] - 10, A[2]], 0.6);
  // Корыто.
  const [tx, tz] = fr.q(3, -8);
  const ty = heightAt(tx, tz);
  box(b, tx, tz, fr.fx, fr.fz, 2.4, 0.7, ty - 0.1, ty + 0.55, 'wood', wood(1.1), 'wood');
  return [];
}

/** Двор по виду; возвращает огни ночи и трубы. */
export function yard(b: Builder, y: Yard, d: Detail): { lights: V3[]; chimneys: V3[] } {
  switch (y.kind) {
    case 'sawmill':
      return sawmill(b, y, d);
    case 'hunter_hut':
      return hunterHut(b, y, d);
    case 'mine':
      return { lights: mine(b, y, d), chimneys: [] };
    case 'farm':
      return farm(b, y, d);
    case 'pen':
      return { lights: pen(b, y, d), chimneys: [] };
  }
}

