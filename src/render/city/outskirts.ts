// Дворы за стеной вида «город» (docs/city.md, разделы 4 и 5): навес собирателей на опушке, лесопилка с
// водяным колесом на реке, каменоломня в склоне мыса под замком, охотничий домик в лесу, рудник со
// штольней и отвалом, хутор с амбаром и стогами, загон на выгоне. Один вид навсегда: уровни игры модель
// не меняют. Всё — в построитель зданий: один меш с городом.
//
// Дерево и камень — те же слои, что у города; мелочь (корзины, брёвна, шкуры, тачка) — только с
// подробностью выше низкой: силуэт двора держат объёмы.
import { CITY } from './palette';
import { Builder, box, cone, cylinder, flat, tint, type V3 } from './geom';
import { Frame, log, pushQuadOut, type Detail } from './kit';
import { body } from './civic';
import { heightAt, RACE_LEVEL, type Civic, type Yard } from './layout';
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
  return { kind: 'stable', x, z, rot, w, d, base: heightAt(x, z), seed: y.seed + Math.round(f * 7 + r * 13) };
};

/** Стог: цилиндр соломы под конусом. */
function stack(b: Builder, x: number, z: number, r: number, h: number): void {
  const y = heightAt(x, z);
  cylinder(b, x, z, r, y - 0.2, y + h * 0.55, 10, 'wood', straw, { aoBottom: 0.6 });
  cone(b, x, z, r * 1.08, y + h * 0.5, y + h, 10, 'wood', [straw[0] * 1.05, straw[1] * 1.05, straw[2]], 0.85);
}

// ---------------------------------------------------------------------------------------------

/** Навес собирателей: открытый навес на столбах под односкатной кровлей, корзины, хворост, сушило. */
function gathering(b: Builder, y: Yard, d: Detail): V3[] {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const W = 9;
  const D = 5;
  const base = heightAt(y.x, y.z);
  const yF = base + 3.5;
  const yB = base + 2.5;
  const T = wood(1.05);
  for (const r of [-W / 2, 0, W / 2]) {
    post(b, fr, D / 2, r, yF - heightAt(...fr.q(D / 2, r)), 0.24, T);
    post(b, fr, -D / 2, r, yB - heightAt(...fr.q(-D / 2, r)), 0.24, T);
  }
  // Обвязка по столбам.
  for (const [f, h] of [
    [D / 2, yF],
    [-D / 2, yB],
  ]) {
    const [x, z] = fr.q(f, 0);
    box(b, x, z, fr.fx, fr.fz, W + 0.5, 0.26, h - 0.28, h, 'wood', T, 'wood');
  }
  // Односкатная кровля из дранки со свесами и исподкой.
  const A = fr.p(D / 2 + 0.7, -W / 2 - 0.5, yF + 0.25);
  const B = fr.p(D / 2 + 0.7, W / 2 + 0.5, yF + 0.25);
  const C = fr.p(-D / 2 - 0.6, W / 2 + 0.5, yB + 0.05);
  const E = fr.p(-D / 2 - 0.6, -W / 2 - 0.5, yB + 0.05);
  pushQuadOut(b, A, B, C, E, 'roofSlate', tint(CITY.shingleTint, 0.95), [A[0], A[1] + 10, A[2]], 0.95);
  pushQuadOut(b, A, B, C, E, 'wood', wood(0.6), [A[0], A[1] - 10, A[2]], 0.6);
  // Задняя стенка из досок — от ветра.
  const [bx, bz] = fr.q(-D / 2 - 0.05, 0);
  box(b, bx, bz, fr.fx, fr.fz, W, 0.12, base - 0.2, yB - 0.3, 'wood', grey(0.95), null, { aoBottom: 0.7 });
  if (d > 0) {
    // Корзины и мешки под навесом, вязанки хвороста у стенки, сушило с травами сбоку.
    for (let k = 0; k < 5; k++) {
      const [x, z] = fr.q(-0.6 + rnd(y.seed, k, 3) * 1.8, -3.4 + k * 1.5);
      const h0 = heightAt(x, z);
      cylinder(b, x, z, 0.38, h0, h0 + 0.5, 8, 'wood', tint(k % 2 ? 0xc9a26a : 0xb08850), { aoBottom: 0.6 });
    }
    for (let k = 0; k < 4; k++) {
      const h0 = heightAt(...fr.q(-D / 2 + 0.6, -3 + k * 2)) + 0.25 + (k % 2) * 0.1;
      log(b, fr.p(-D / 2 + 0.6, -3.6 + k * 2, h0), fr.p(-D / 2 + 0.6, -2.3 + k * 2, h0), 0.28, woodLight(0.9), 6, true);
    }
    // Сушило: две стойки и жердь с пучками трав.
    for (const r of [W / 2 + 1.2, W / 2 + 4]) post(b, fr, 0.5, r, 2, 0.12, grey());
    const p0 = fr.q(0.5, W / 2 + 1.2);
    const p1 = fr.q(0.5, W / 2 + 4);
    const h1 = heightAt(p0[0], p0[1]) + 1.95;
    log(b, [p0[0], h1, p0[1]], [p1[0], h1, p1[1]], 0.05, grey(), 4, false);
    for (let k = 0; k < 5; k++) {
      const [x, z] = fr.q(0.5, W / 2 + 1.6 + k * 0.6);
      cone(b, x, z, 0.17, h1 - 0.05, h1 - 0.75, 5, 'grass', tint(0xa8b070), 0.8);
    }
  }
  return [fr.p(D / 2 + 0.4, 0, yF - 0.6)];
}

/**
 * Лесопилка: каменный низ и фахверк над ним, колесо в мельничном ручье у южной стены (`layout.RACE`) —
 * лицом к камере, ось — в стену; брёвна штабелем и доски во дворе.
 */
function sawmill(b: Builder, y: Yard, d: Detail): { lights: V3[]; chimneys: V3[] } {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const W = 11;
  const D = 8;
  const c = hall(y, 0, 0, y.rot, W, D);
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
  // Колесо: в ручье перед фасадом, обод — в плоскости фасада, ось — вперёд, в стену.
  const wf = D / 2 + 4.5;
  const R = 2.7;
  const cy = RACE_LEVEL + R - 0.45;
  const seg = d === 0 ? 10 : 16;
  const T = wood(1.15);
  const rim = (k: number, rr: number, off: number): V3 => {
    const ang = (k / seg) * Math.PI * 2;
    return fr.p(wf + off, Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
  };
  for (const off of [-0.55, 0.55]) {
    for (let k = 0; k < seg; k++) log(b, rim(k, R, off), rim(k + 1, R, off), 0.12, T, 4, false);
  }
  // Лопасти — доски по радиусу во всю ширину колеса; спицы — через одну четверть.
  for (let k = 0; k < seg; k += d === 0 ? 2 : 1) {
    const ang = ((k + 0.5) / seg) * Math.PI * 2;
    const p = (off: number, rr: number): V3 => fr.p(wf + off, Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    const A = p(-0.55, R - 0.75);
    const B = p(0.55, R - 0.75);
    const C = p(0.55, R + 0.05);
    const E = p(-0.55, R + 0.05);
    pushQuadOut(b, A, B, C, E, 'wood', T, fr.p(wf, Math.cos(ang + 0.5) * R * 2, cy + Math.sin(ang + 0.5) * R * 2), 0.9);
    pushQuadOut(b, A, B, C, E, 'wood', T, fr.p(wf, Math.cos(ang - 0.5) * R * 2, cy + Math.sin(ang - 0.5) * R * 2), 0.7);
    if (k % 4 === 0) log(b, fr.p(wf, 0, cy), rim(k, R, 0), 0.08, T, 4, false);
  }
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
  }
  return { lights: [fr.p(D / 2 + 0.4, -2, c.base + 2.6)], chimneys: r.chimneys };
}

/**
 * Каменоломня: свежий срез скалы мыса уступами — забои лицом к камере, площадки в каменной пыли, блоки
 * тёсаного камня у подножия, кран с колесом-топчаком, сарай каменотёсов.
 */
function quarry(b: Builder, y: Yard, d: Detail): V3[] {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const face = tint(CITY.stoneTints[0], 1.0);
  const dust = tint(0xf2ece0, 1.08);
  // Уступы: вперёд (вниз по склону) — ниже, назад (в склон) — выше. Каждый — ступень скалы от земли под
  // ней до своего верха: забой спереди, площадка сверху.
  const steps = [
    { f: 3, w: 18, dd: 6 },
    { f: -3, w: 14, dd: 6 },
    { f: -8.5, w: 10, dd: 5 },
  ];
  let top = -Infinity;
  steps.forEach((st, k) => {
    const lo0 = lowUnder(new Frame(...fr.q(st.f, 0), fr.fx, fr.fz), st.dd / 2, st.w / 2) - 0.6;
    const hi0 = Math.max(heightAt(...fr.q(st.f - st.dd / 2, 0)) + 0.9, top + 2.4);
    top = hi0;
    // Уступ — из нескольких глыб разной глубины и высоты: кромка забоя рваная, а не по линейке.
    const parts = d === 0 ? 2 : 4;
    for (let j = 0; j < parts; j++) {
      const pw = st.w / parts;
      const r = -st.w / 2 + pw * (j + 0.5) + (k - 1) * 0.8;
      const df = (rnd(y.seed, k * 7 + j, 13) - 0.5) * 1.6;
      const dh = (rnd(y.seed, k * 7 + j, 15) - 0.5) * 1.2;
      const [x, z] = fr.q(st.f + df, r);
      const hi = hi0 + dh;
      box(b, x, z, fr.fx, fr.fz, pw + 0.3, st.dd, lo0, hi, 'cut', face, null, { aoBottom: 0.7, grimeBottom: 0.3, vBase: lo0 });
      // Площадка — в каменной пыли, светлее камня: свежая крошка.
      flatOn(b, x, z, fr, pw + 0.3, st.dd, hi, dust);
      // Осыпь щебня у подножия забоя.
      if (d > 0 && rnd(y.seed, k * 7 + j, 17) < 0.6) {
        const [hx, hz] = fr.q(st.f + df + st.dd / 2 + 0.6, r + (rnd(y.seed, j, 19) - 0.5) * pw * 0.6);
        const hy = heightAt(hx, hz);
        cone(b, hx, hz, 1.3 + rnd(y.seed, j, 21) * 0.8, Math.max(hy, k > 0 ? top - 2.4 : hy) - 0.3, Math.max(hy, k > 0 ? top - 2.4 : hy) + 0.9, 7, 'rubble', tint(CITY.stoneTints[1], 1.05), 0.75);
      }
    }
  });
  // Блоки тёсаного камня у подножия, рядами и вразброс.
  const blocks = d === 0 ? 4 : 11;
  for (let k = 0; k < blocks; k++) {
    const f = 7 + rnd(y.seed, k, 3) * 4.5;
    const r = -7 + k * 1.35 + rnd(y.seed, k, 5) * 0.6;
    const [x, z] = fr.q(f, r);
    const h0 = heightAt(x, z);
    const s = 0.7 + rnd(y.seed, k, 7) * 0.5;
    const tier = k % 3 === 2 ? 1 : 0;
    box(b, x, z, fr.fx, fr.fz, s * 1.4, s, h0 - 0.1 + tier * 0.7, h0 + 0.6 + tier * 0.7, 'ashlar', tint(CITY.stoneTints[0], 0.98), 'ashlar', { aoBottom: 0.7 });
  }
  if (d > 0) {
    // Кран: две стойки домиком, стрела над нижним забоем и колесо-топчак.
    const cy = heightAt(...fr.q(6, 9));
    const T = wood(1.05);
    log(b, fr.p(6, 7.5, cy - 0.2), fr.p(6, 9, cy + 7), 0.14, T, 5, false);
    log(b, fr.p(6, 10.5, cy - 0.2), fr.p(6, 9, cy + 7), 0.14, T, 5, false);
    log(b, fr.p(8.5, 9, cy + 6.4), fr.p(1.5, 9, cy + 4.6), 0.12, T, 5, true);
    const R = 1.7;
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2;
      const a1 = ((k + 1) / 12) * Math.PI * 2;
      for (const off of [-0.5, 0.5]) {
        log(b, fr.p(6 + off, 9 + Math.cos(a0) * R, cy + R + 0.2 + Math.sin(a0) * R), fr.p(6 + off, 9 + Math.cos(a1) * R, cy + R + 0.2 + Math.sin(a1) * R), 0.07, T, 4, false);
      }
    }
  }
  // Сарай каменотёсов — сбоку, у подножия.
  body(
    b,
    hall(y, 9, -11, y.rot, 5, 4),
    {
      storeys: [{ h: 2.6, front: 'groundDoor', side: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (45 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
    },
    d,
  );
  return [fr.p(9 + 2.3, -11, heightAt(...fr.q(9, -11)) + 2)];
}

/** Плоская плита в рамке (середина, ширина вправо, глубина вперёд) на высоте `y` — пыль площадки. */
function flatOn(b: Builder, cx: number, cz: number, fr: Frame, w: number, dd: number, y: number, t: V3): void {
  const f = new Frame(cx, cz, fr.fx, fr.fz);
  flat(b, [f.q(dd / 2, -w / 2), f.q(dd / 2, w / 2), f.q(-dd / 2, w / 2), f.q(-dd / 2, -w / 2)], y, 'cut', t, true, 1);
}

/** Охотничий домик: сруб под крутой дранкой, сушило со шкурами, поленница. */
function hunterHut(b: Builder, y: Yard, d: Detail): { lights: V3[]; chimneys: V3[] } {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const c = hall(y, 0, 0, y.rot, 6.5, 5.5);
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
    hall(y, 7, -9, y.rot, 5.5, 4.5),
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
  const house = hall(y, 0, -6, y.rot, 15, 8);
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
    hall(y, -9, 9, y.rot + Math.PI / 2, 12, 8.5),
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
    case 'gathering':
      return { lights: gathering(b, y, d), chimneys: [] };
    case 'sawmill':
      return sawmill(b, y, d);
    case 'quarry':
      return { lights: quarry(b, y, d), chimneys: [] };
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

