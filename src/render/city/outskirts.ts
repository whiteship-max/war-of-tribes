// Дворы за стеной вида «город» (docs/city.md, разделы 4 и 5): лесопилка с водяным колесом на реке, Охотничий двор в
// лесу, Шахта со штольней и отвалом на опушке, Ферма — хутор с амбаром и стогами и загон на выгоне (ЗД-1: навес
// собирателей и каменоломня ушли в Охотничий двор и Шахту, их свой вид — ЗД-2). Один вид навсегда: уровни игры модель
// не меняют. Всё — в построитель зданий: один меш с городом.
//
// Дерево и камень — те же слои, что у города; мелочь (корзины, брёвна, шкуры, тачка) — только с
// подробностью выше низкой: силуэт двора держат объёмы.
import { CITY } from './palette';
import { Builder, box, cone, cylinder, tint, type V3 } from './geom';
import { L, TILE_M, type LayerName } from './tex';
import { ownerCode } from './sites';
import { Frame, log, pushQuadOut, pushTriOut, type Detail } from './kit';
import { body } from './civic';
import { FLOOR_LIFT, footSpan, heightAt, MINE_PORTAL, RACE_LEVEL, RIDGE_CRAGS, SAWMILL_BRIDGE, type Bridge, type Civic, type Yard } from './layout';
import { rnd } from './noise';

const wood = (k = 1): V3 => tint(CITY.oak, k);
const woodLight = (k = 1): V3 => tint(CITY.oakLight, k);
const grey = (k = 1): V3 => tint(CITY.timberGrey, k);
const straw = tint(0xd6b878);
const hide = tint(0x8a6646);

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
const hall = (y: Yard, f: number, r: number, rot: number, w: number, d: number, lift = 0): Civic => {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const [x, z] = fr.q(f, r);
  // Пол — над самой высокой землёй следа: дом двора на склоне не тонет, под ним цоколь (`civic.body`).
  return { kind: 'stable', x, z, rot, w, d, base: footSpan(x, z, Math.cos(rot), Math.sin(rot), w, d).hi + FLOOR_LIFT + lift, seed: y.seed + Math.round(f * 7 + r * 13) };
};

/**
 * Дома дворов: (вперёд, вправо, доворот, ширина, глубина, подъём цоколя) — одни на модели и на тест посадки (`seat.test.ts`).
 * Сторожка Шахты стоит у подножия гряды: редкая сетка земли «Низкого» поднимает там землю выше рельефа — цоколь выше на 0,35 м.
 */
const YARD_HALLS: Record<Yard['kind'], readonly (readonly [number, number, number, number, number, number?])[]> = {
  sawmill: [[0, 0, 0, 11, 8]],
  hunter_hut: [[0, 0, 0, 6.5, 5.5]],
  mine: [[-2.2, 6.6, 0, 5.5, 4.5, 0.35]],
  farm: [
    [0, -6, 0, 15, 8],
    [-9, 9, Math.PI / 2, 12, 8.5],
  ],
  pen: [],
};

/** Дома двора — как их ставит `yard`. */
export const yardHalls = (y: Yard): Civic[] => YARD_HALLS[y.kind].map(([f, r, rot, w, d, lift]) => hall(y, f, r, y.rot + rot, w, d, lift));

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
    // Брёвна штабелем за домом, вдоль задней стены: три, два, одно. У восточной стены — мост на сушу (ЗД-2).
    let k = 0;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const rr = 0.32;
        const f0 = -D / 2 - 2 - (i + row * 0.5) * rr * 2.05;
        const a = fr.p(f0, 0.3, 0);
        const e = fr.p(f0, 6.6, 0);
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
    bridge(b, SAWMILL_BRIDGE, d);
    return { lights: [fr.p(D / 2 + 0.4, -2, c.base + 2.6)], chimneys: [...r.chimneys, [kx, ky + 2.4, kz]] };
  }
  bridge(b, SAWMILL_BRIDGE, d);
  return { lights: [fr.p(D / 2 + 0.4, -2, c.base + 2.6)], chimneys: r.chimneys };
}

/** Настил моста над землёй на доле `t` пути от `a` к `b`: у концов — вровень с землёй, посередине — горбом. */
export function deckAt(br: Bridge, t: number): number {
  const ga = heightAt(br.a.x, br.a.z);
  const gb = heightAt(br.b.x, br.b.z);
  return ga + (gb - ga) * t + 0.12 + Math.sin(Math.PI * t) * 0.35;
}

/**
 * Мост (ЗД-2): дощатый настил на сваях поперёк мельничного ручья, перила на столбах. Концы настила лежат на земле вровень с
 * ней — тропа входит на мост без ступени (`deckAt`), сваи стоят в русле.
 */
function bridge(b: Builder, br: Bridge, d: Detail): void {
  const len = Math.hypot(br.b.x - br.a.x, br.b.z - br.a.z);
  const fx = (br.b.x - br.a.x) / len;
  const fz = (br.b.z - br.a.z) / len;
  const fr = new Frame(br.a.x, br.a.z, fx, fz);
  const W = br.half;
  const N = 6;
  const plank = woodLight(1.02);
  const at = (f: number, r: number, dy: number): V3 => fr.p(f, r, deckAt(br, f / len) + dy);
  for (let k = 0; k < N; k++) {
    const f0 = (k / N) * len;
    const f1 = ((k + 1) / N) * len;
    const up = at((f0 + f1) / 2, 0, 10);
    pushQuadOut(b, at(f0, -W, 0), at(f0, W, 0), at(f1, W, 0), at(f1, -W, 0), 'wood', plank, up, 0.95);
    for (const s of [-1, 1]) pushQuadOut(b, at(f0, s * W, 0), at(f1, s * W, 0), at(f1, s * W, -0.3), at(f0, s * W, -0.3), 'wood', wood(0.85), at((f0 + f1) / 2, s * 20, 0), 0.75);
  }
  // Сваи и насадки — в русле, по две пары.
  for (const t of [0.36, 0.64]) {
    const f = t * len;
    const top = deckAt(br, t) - 0.3;
    for (const r of [-W + 0.25, W - 0.25]) {
      const [x, z] = fr.q(f, r);
      log(b, [x, heightAt(x, z) - 0.8, z], [x, top, z], 0.17, wood(0.7), d === 0 ? 4 : 6, false);
    }
    const [mx, mz] = fr.q(f, 0);
    box(b, mx, mz, fx, fz, W * 2 + 0.4, 0.3, top - 0.28, top, 'wood', wood(0.75), 'wood');
  }
  if (d > 0) {
    // Перила: столбы у концов и посередине, жердь поверху.
    for (const s of [-1, 1]) {
      const r = s * (W - 0.12);
      const posts = [0.6, len / 2, len - 0.6];
      for (const f of posts) {
        const [x, z] = fr.q(f, r);
        const y0 = deckAt(br, f / len);
        box(b, x, z, fx, fz, 0.16, 0.16, y0 - 0.25, y0 + 1.05, 'wood', wood(0.9), 'wood');
      }
      for (let k = 0; k + 1 < posts.length; k++) log(b, at(posts[k], r, 1), at(posts[k + 1], r, 1), 0.06, wood(1.0), 4, false);
    }
  }
}

/** Навес сборщиков у дома охотника (ЗД-2) в рамке двора: середина (вперёд, вправо), ширина и глубина. */
export const GATHER_SHED = { f: -0.5, r: -9.5, W: 7, D: 4 } as const;

/** Рама со шкурой: две стойки, две перекладины, шкура растянута внутри; рама чуть заваливается назад. */
function hideFrame(b: Builder, fr: Frame, f: number, r: number, w: number, h: number, tone: V3): void {
  const g = heightAt(...fr.q(f, r));
  const T = grey(1.05);
  const lean = 0.35;
  const P = (dr: number, hh: number): V3 => fr.p(f - (hh / h) * lean, r + dr, g + hh);
  for (const dr of [-w / 2, w / 2]) log(b, P(dr, -0.3), P(dr, h), 0.06, T, 4, false);
  for (const hh of [0.35, h - 0.12]) log(b, P(-w / 2 - 0.12, hh), P(w / 2 + 0.12, hh), 0.05, T, 4, false);
  const A = P(-w / 2 + 0.16, 0.55);
  const B = P(w / 2 - 0.16, 0.55);
  const C = P(w / 2 - 0.22, h - 0.3);
  const D = P(-w / 2 + 0.2, h - 0.28);
  pushQuadOut(b, A, B, C, D, 'cloth', tone, fr.p(f + 5, r, g + h / 2), 0.92);
  pushQuadOut(b, A, B, C, D, 'cloth', [tone[0] * 0.78, tone[1] * 0.75, tone[2] * 0.72], fr.p(f - 5, r, g + h / 2), 0.7);
}

/** Вязанка хвороста: три жерди пучком, перевязь — светлее. */
function bundle(b: Builder, a: V3, e: V3, t: V3): void {
  log(b, a, e, 0.2, t, 5, true);
  const m: V3 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2];
  const dx = (e[0] - a[0]) * 0.04;
  const dy = (e[1] - a[1]) * 0.04;
  const dz = (e[2] - a[2]) * 0.04;
  log(b, [m[0] - dx, m[1] - dy, m[2] - dz], [m[0] + dx, m[1] + dy, m[2] + dz], 0.23, straw, 5, false);
}

/**
 * Охотничий двор (ЗД-2): сруб охотника под крутой дранкой, рядом — навес сборщиков (корзины, мешки, травы на сушиле, вязанки
 * хвороста у задней стенки), у западной опушки — шкуры на рамах; сушило со шкурами и поленница — у дома.
 */
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
  // Навес сборщиков: открытый к двору, на столбах под односкатной дранкой, задняя стенка — доски от ветра.
  const S = GATHER_SHED;
  const sf = new Frame(...fr.q(S.f, S.r), fr.fx, fr.fz);
  const base = heightAt(sf.cx, sf.cz);
  const yF = base + 3.1;
  const yB = base + 2.3;
  const T = wood(1.05);
  for (const rr of [-S.W / 2, 0, S.W / 2]) {
    post(b, sf, S.D / 2, rr, yF - heightAt(...sf.q(S.D / 2, rr)), 0.22, T);
    post(b, sf, -S.D / 2, rr, yB - heightAt(...sf.q(-S.D / 2, rr)), 0.22, T);
  }
  for (const [f, h] of [
    [S.D / 2, yF],
    [-S.D / 2, yB],
  ]) {
    const [x, z] = sf.q(f, 0);
    box(b, x, z, sf.fx, sf.fz, S.W + 0.4, 0.24, h - 0.26, h, 'wood', T, 'wood');
  }
  const A = sf.p(S.D / 2 + 0.6, -S.W / 2 - 0.45, yF + 0.22);
  const B = sf.p(S.D / 2 + 0.6, S.W / 2 + 0.45, yF + 0.22);
  const C = sf.p(-S.D / 2 - 0.5, S.W / 2 + 0.45, yB + 0.05);
  const E = sf.p(-S.D / 2 - 0.5, -S.W / 2 - 0.45, yB + 0.05);
  pushQuadOut(b, A, B, C, E, 'roofSlate', tint(CITY.shingleTint, 0.93), [A[0], A[1] + 10, A[2]], 0.95);
  pushQuadOut(b, A, B, C, E, 'wood', wood(0.6), [A[0], A[1] - 10, A[2]], 0.6);
  const [bx, bz] = sf.q(-S.D / 2 - 0.05, 0);
  box(b, bx, bz, sf.fx, sf.fz, S.W, 0.12, base - 0.2, yB - 0.3, 'wood', grey(0.95), null, { aoBottom: 0.7 });
  // Шкуры на рамах — у западной опушки, лицом к двору.
  const hides: [number, number, number][] = [
    [5.4, -15.2, 0.95],
    [6.5, -12.8, 1.08],
    [7.3, -10.3, 0.85],
  ];
  hides.forEach(([f, rr, k], i) => hideFrame(b, fr, f, rr, 1.7 + i * 0.15, 1.9 + (i % 2) * 0.25, [hide[0] * k, hide[1] * k * 0.96, hide[2] * k * 0.92]));
  if (d > 0) {
    // Корзины и мешки под навесом и у его края.
    for (let k = 0; k < 6; k++) {
      const [x, z] = sf.q(-0.4 + rnd(y.seed, k, 3) * 1.6 + (k > 3 ? 2.2 : 0), -2.6 + (k % 4) * 1.6);
      const h0 = heightAt(x, z);
      cylinder(b, x, z, 0.36 + (k % 2) * 0.06, h0, h0 + 0.48, 8, 'wood', tint(k % 2 ? 0xc9a26a : 0xb08850), { aoBottom: 0.6 });
    }
    // Вязанки хвороста у задней стенки навеса и у рам.
    for (let k = 0; k < 4; k++) {
      const h0 = heightAt(...sf.q(-S.D / 2 + 0.45, -2.8 + k * 1.8)) + 0.22 + (k % 2) * 0.08;
      bundle(b, sf.p(-S.D / 2 + 0.45, -3.4 + k * 1.8, h0), sf.p(-S.D / 2 + 0.45, -2.1 + k * 1.8, h0), woodLight(0.9));
    }
    for (let k = 0; k < 3; k++) {
      const p0 = fr.p(2.9 + k * 0.55, -16.6 + k * 0.35, 0);
      const p1 = fr.p(3.2 + k * 0.55, -15.2 + k * 0.35, 0);
      const h0 = Math.max(heightAt(p0[0], p0[2]), heightAt(p1[0], p1[2])) + 0.2 + (k === 2 ? 0.3 : 0);
      bundle(b, [p0[0], h0, p0[2]], [p1[0], h0, p1[2]], wood(0.95));
    }
    // Сушило со шкурами у дома.
    for (const rr of [4.2, 7.4]) post(b, fr, 1.5, rr, 2.2, 0.14, grey());
    const p0 = fr.p(1.5, 4.2, 0);
    const h1 = heightAt(p0[0], p0[2]) + 2.1;
    log(b, fr.p(1.5, 4.2, h1), fr.p(1.5, 7.4, h1), 0.06, grey(), 4, false);
    for (let k = 0; k < 2; k++) {
      const r0 = 4.5 + k * 1.4;
      const A2 = fr.p(1.5, r0, h1);
      const B2 = fr.p(1.5, r0 + 0.9, h1);
      const C2 = fr.p(1.45, r0 + 0.8, h1 - 1.3);
      const D2 = fr.p(1.45, r0 + 0.1, h1 - 1.2);
      const tone: V3 = [hide[0] * (0.85 + k * 0.12), hide[1] * (0.85 + k * 0.1), hide[2]];
      pushQuadOut(b, A2, B2, C2, D2, 'cloth', tone, fr.p(5, r0, h1), 0.9);
      pushQuadOut(b, A2, B2, C2, D2, 'cloth', tone, fr.p(-5, r0, h1), 0.7);
    }
    // Поленница у стены.
    const [px, pz] = fr.q(-0.5, -4.2);
    const ph = heightAt(px, pz);
    box(b, px, pz, fr.fx, fr.fz, 1.1, 3.4, ph - 0.1, ph + 1.3, 'wood', woodLight(0.85), 'wood');
  }
  return { lights: [fr.p(3.0, 0, c.base + 1.8)], chimneys: r.chimneys };
}

/**
 * Грань скалы: как `kit.pushQuadOut`, но пласты камня — крупнее плитки слоя и с наклоном (`tilt` — подъём пласта на метр по
 * ширине): ровные горизонтальные пласты во весь лоб читались кладкой стены.
 */
function rockFace(b: Builder, a: V3, bb: V3, c: V3, d: V3, t: V3, toward: V3, ao: number, tilt: number): void {
  const [tw, th] = TILE_M.rock;
  const k = 1.3;
  const hx = bb[0] - a[0];
  const hz = bb[2] - a[2];
  const hl = Math.hypot(hx, hz) || 1;
  const uv = (p: V3): [number, number] => {
    const s = ((p[0] - a[0]) * hx + (p[2] - a[2]) * hz) / hl;
    return [s / (tw * k), (p[1] - a[1] + tilt * s) / (th * k)];
  };
  const n: V3 = [(bb[1] - a[1]) * (d[2] - a[2]) - (bb[2] - a[2]) * (d[1] - a[1]), (bb[2] - a[2]) * (d[0] - a[0]) - (bb[0] - a[0]) * (d[2] - a[2]), (bb[0] - a[0]) * (d[1] - a[1]) - (bb[1] - a[1]) * (d[0] - a[0])];
  const front = n[0] * (toward[0] - a[0]) + n[1] * (toward[1] - a[1]) + n[2] * (toward[2] - a[2]) >= 0;
  const [p0, p1, p2, p3] = front ? [a, bb, c, d] : [bb, a, d, c];
  b.quad(p0, p1, p2, p3, [...uv(p0), ...uv(p1), ...uv(p2), ...uv(p3)] as [number, number, number, number, number, number, number, number], L.rock, t, [ao, ao, ao, ao]);
}

/**
 * Скала: неровная призма — многоугольник у земли (зарыт на полметра), верх сужен, сдвинут и с гребнем. Камень — тот же
 * слой, что у лба Шахты; на «Низком» — пять граней.
 */
export function crag(b: Builder, x: number, z: number, rad: number, h: number, seed: number, t: V3, d: Detail): void {
  const n = d === 0 ? 5 : 7;
  const g = heightAt(x, z);
  const lean = rnd(seed, 1, 3) * Math.PI * 2;
  const lx = Math.cos(lean) * rad * 0.22;
  const lz = Math.sin(lean) * rad * 0.22;
  const base: V3[] = [];
  const top: V3[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (rnd(seed, k, 5) - 0.5) * 0.6;
    const rr = rad * (0.75 + rnd(seed, k, 7) * 0.5);
    const bx = x + Math.cos(a) * rr;
    const bz = z + Math.sin(a) * rr;
    base.push([bx, heightAt(bx, bz) - 0.6, bz]);
    const s = 0.45 + rnd(seed, k, 9) * 0.25;
    const tx = x + lx + Math.cos(a) * rr * s;
    const tz = z + lz + Math.sin(a) * rr * s;
    top.push([tx, g + h * (0.72 + rnd(seed, k, 11) * 0.3), tz]);
  }
  const apex: V3 = [x + lx * 1.4, g + h, z + lz * 1.4];
  const lit: V3 = [t[0] * 1.12, t[1] * 1.12, t[2] * 1.08];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const mx = (base[k][0] + base[k1][0]) / 2;
    const mz = (base[k][2] + base[k1][2]) / 2;
    rockFace(b, base[k], base[k1], top[k1], top[k], t, [mx + (mx - x) * 4, g + h * 0.4, mz + (mz - z) * 4], 0.75, 0.2 + rnd(seed, k, 13) * 0.25);
    pushTriOut(b, top[k], top[k1], apex, 'rock', lit, [apex[0], apex[1] + 10, apex[2]]);
  }
}

/** Скальные выходы гряды (`layout.RIDGE_CRAGS`) — по две скалы рядом: большая и обломок у её подножия. Ничьи. */
export function ridgeCrags(b: Builder, d: Detail): void {
  const t = tint(CITY.stoneTints[2], 0.7);
  RIDGE_CRAGS.forEach((c, i) => {
    crag(b, c.x, c.z, c.r, c.h, 900 + i, t, d);
    if (d > 0) crag(b, c.x + c.r * 1.1, c.z + c.r * 0.6, c.r * 0.5, c.h * 0.55, 950 + i, tint(CITY.stoneTints[1], 0.66), d);
  });
}

/**
 * Устье штольни (ЗД-2): проём в лбу скалы, м — полуширина и высота; спуск — на сколько уходит вниз пол штольни на её глубину;
 * оклад — на сколько крепь выходит из лба наружу рамами с затяжкой.
 */
export const ADIT = { half: 1.55, h: 3, depth: 7, drop: 2.2, collar: 2.4 } as const;

/** Рельсы Шахты в рамке устья (вперёд, вправо): из глубины штольни — наружу, через оклад, и влево — к отвалу. */
export const RAILS: readonly (readonly [number, number])[] = [
  [-ADIT.depth + 0.8, 0],
  [-3.4, 0],
  [0, 0],
  [ADIT.collar + 2.6, 0],
  [ADIT.collar + 4.4, -0.8],
  [ADIT.collar + 5.6, -2.3],
  [ADIT.collar + 6.2, -3.9],
];

/** Отвал породы в рамке устья: середина конуса, радиус и высота; рядом — второй, ниже. */
export const DUMP = { f: ADIT.collar + 7.6, r: -5.8, R: 3.6, h: 2.7 } as const;

/** Пол штольни на глубине `f` (f < 0 — в скале): спускается от устья к забою. */
export const aditFloor = (g0: number, f: number): number => g0 - (Math.min(0, Math.max(f, -ADIT.depth)) / -ADIT.depth) * ADIT.drop;

/** Уклон рельсов от оклада наружу, м на метр: вода из штольни уходит по нему, вагонетка идёт под горку. */
const RAIL_GRADE = 0.15;

/** Высота рельса в точке рамки: в штольне — пол спуска, в окладе — пол устья, снаружи — уклоном к земле, не ниже её. */
function railY(fr: Frame, g0: number, f: number, r: number): number {
  if (f < 0) return aditFloor(g0, f);
  if (f <= ADIT.collar) return g0;
  return Math.max(heightAt(...fr.q(f, r)), g0 - (f - ADIT.collar) * RAIL_GRADE);
}

/** Пол устья: над самой высокой землёй под окладом — земля склона не встаёт в проём. */
export function aditSill(fr: Frame): number {
  let g = -Infinity;
  for (const f of [0, ADIT.collar / 2, ADIT.collar]) for (const r of [-ADIT.half, 0, ADIT.half]) g = Math.max(g, heightAt(...fr.q(f, r)));
  return g + 0.06;
}

/**
 * Шахта (ЗД-2): устье штольни в скальном лбу у подножия гряды — крепь из бруса выходит из лба окладом, проём во тьму, пол и
 * рельсы уходят вниз; у входа вагонетка с рудой, рельсы сворачивают к отвалу породы, сбоку — сторожка горняков и крепёжный лес.
 * Лоб стоит у `layout.MINE_PORTAL` (за ним поднимается холм гряды, `layout.hillsAt`), сторожка — по `YARD_HALLS`.
 */
function mine(b: Builder, y: Yard, d: Detail): V3[] {
  const P = MINE_PORTAL;
  const fr = new Frame(P.x, P.z, Math.cos(P.rot), Math.sin(P.rot));
  const g0 = aditSill(fr);
  const rockT = tint(0xd9d4ca, 0.86);
  const turf = tint(0x8a9a62, 0.8);
  const dark = tint(0x2a241e, 0.5);
  const pitch = tint(0x0c0a08, 0.45);
  const at = (f: number, r: number, h: number): V3 => fr.p(f, r, h);
  const H = ADIT.half;
  // Лоб: профиль верха над полом устья по ширине (вправо, высота), проём посередине; лоб чуть заваливается назад.
  const prof: [number, number][] = [
    [-7, 2.6],
    [-5, 6],
    [-3, 7.6],
    [-H, 8.2],
    [0, 8.6],
    [H, 8.3],
    [3.2, 7.4],
    [5.2, 5.6],
    [7, 2.4],
  ];
  const top = prof.map(([r, h], k) => {
    const hh = h * (0.92 + rnd(y.seed, k, 13) * 0.16);
    return at(-0.12 * hh + (rnd(y.seed, k, 15) - 0.5) * 0.9, r, g0 + hh);
  });
  const foot = prof.map(([r], k) => at((rnd(y.seed, k, 17) - 0.5) * 0.6, r, Math.min(g0, heightAt(...fr.q(0, r))) - 0.8));
  // Уступ посередине высоты: лоб — гранями разного наклона и тона, а не стеной.
  const ledge = prof.map(([r, h], k) => at(0.35 + rnd(y.seed, k, 19) * 0.7, r * (1 + (rnd(y.seed, k, 21) - 0.5) * 0.08), g0 + h * (0.38 + rnd(y.seed, k, 23) * 0.14)));
  const out = at(20, 0, g0 + 3);
  const tone = (k: number, lo: boolean): V3 => {
    const v = (lo ? 0.82 : 0.95) + rnd(y.seed, k, lo ? 25 : 27) * 0.14;
    return [rockT[0] * v, rockT[1] * v, rockT[2] * v * 0.98];
  };
  for (let k = 0; k + 1 < prof.length; k++) {
    const inGap = Math.abs(prof[k][0]) <= H + 1e-6 && Math.abs(prof[k + 1][0]) <= H + 1e-6;
    if (inGap) {
      rockFace(b, at(0, prof[k][0], g0 + ADIT.h + 0.3), at(0, prof[k + 1][0], g0 + ADIT.h + 0.3), top[k + 1], top[k], tone(k, false), out, 0.8, 0.22);
      continue;
    }
    // Над проёмом уступа нет: у его краёв уступ — на высоте перемычки.
    const lk = Math.abs(prof[k][0]) <= H + 1e-6 ? at(0, prof[k][0], g0 + ADIT.h + 0.3) : ledge[k];
    const lk1 = Math.abs(prof[k + 1][0]) <= H + 1e-6 ? at(0, prof[k + 1][0], g0 + ADIT.h + 0.3) : ledge[k + 1];
    rockFace(b, foot[k], foot[k + 1], lk1, lk, tone(k, true), out, 0.8, 0.22);
    rockFace(b, lk, lk1, top[k + 1], top[k], tone(k, false), out, 0.88, 0.22);
  }
  // Верх лба — дёрн назад, в склон холма: задняя кромка — на земле склона.
  const back = prof.map(([r]) => {
    const fb = -7 - Math.abs(r) * 0.35;
    return at(fb, r * 1.1, heightAt(...fr.q(fb, r * 1.1)) + 0.15);
  });
  for (let k = 0; k + 1 < prof.length; k++) pushQuadOut(b, top[k], top[k + 1], back[k + 1], back[k], 'grass', turf, at(-3, prof[k][0], g0 + 30), 1);
  // Бока лба — к склону.
  for (const k of [0, prof.length - 1]) {
    const side = Math.sign(prof[k][0]);
    const bf = at(-7, prof[k][0] * 1.15, heightAt(...fr.q(-7, prof[k][0] * 1.15)) - 0.6);
    rockFace(b, foot[k], bf, back[k], top[k], rockT, at(-2, prof[k][0] + side * 20, g0 + 2), 0.75, 0.22);
  }
  // Штольня: от устья оклада до забоя пол и свод уходят вниз, стены — тёмный камень, в глубине — тьма.
  const D = ADIT.depth;
  const C = ADIT.collar;
  const fl = (f: number): number => aditFloor(g0, f);
  const mid = at(-D * 0.5, 0, g0);
  pushQuadOut(b, at(C, -H, g0), at(C, H, g0), at(0, H, g0), at(0, -H, g0), 'rock', dark, [mid[0], g0 + 20, mid[2]], 0.6);
  pushQuadOut(b, at(0, -H, g0), at(0, H, g0), at(-D, H, fl(-D)), at(-D, -H, fl(-D)), 'rock', dark, [mid[0], g0 + 20, mid[2]], 0.6);
  pushQuadOut(b, at(0, -H, g0 + ADIT.h), at(0, H, g0 + ADIT.h), at(-D, H, fl(-D) + ADIT.h), at(-D, -H, fl(-D) + ADIT.h), 'rock', pitch, [mid[0], g0 - 20, mid[2]], 0.4);
  for (const sd of [-1, 1]) pushQuadOut(b, at(0, sd * H, g0 - 0.1), at(-D, sd * H, fl(-D) - 0.1), at(-D, sd * H, fl(-D) + ADIT.h), at(0, sd * H, g0 + ADIT.h + 0.4), 'rock', dark, mid, 0.5);
  pushQuadOut(b, at(-D, -H, fl(-D) - 0.1), at(-D, H, fl(-D) - 0.1), at(-D, H, fl(-D) + ADIT.h), at(-D, -H, fl(-D) + ADIT.h), 'groundDoor', pitch, at(0, 0, g0 + 1), 0.3);
  // Крепь: рамы оклада снаружи лба — стойки, верхняк, затяжка досками по бокам и поверху; в глубине — рамы ниже и ниже.
  const T = woodLight(0.95);
  const set = (f: number, k: number, tone: V3): void => {
    const y0 = fl(f) - 0.2;
    for (const r of [-(H + 0.05), H + 0.05]) {
      const [x, z] = fr.q(f, r);
      box(b, x, z, fr.fx, fr.fz, 0.3 * k, 0.3 * k, y0, fl(f) + ADIT.h + 0.1, 'wood', tone, null, { aoBottom: 0.6 });
    }
    const [lx, lz] = fr.q(f, 0);
    box(b, lx, lz, fr.fx, fr.fz, H * 2 + 0.7 * k, 0.32 * k, fl(f) + ADIT.h, fl(f) + ADIT.h + 0.34 * k, 'wood', tone, 'wood');
  };
  for (const f of [C, C / 2, 0.1]) set(f, 1.2, T);
  if (d > 0) for (const f of [-1.8, -3.6, -5.4]) set(f, 1, tint(CITY.oak, 0.55));
  // Затяжка оклада: доски поверх верхняков и по бокам — от осыпи.
  const lag = woodLight(0.8);
  pushQuadOut(b, at(C + 0.2, -H - 0.3, g0 + ADIT.h + 0.42), at(C + 0.2, H + 0.3, g0 + ADIT.h + 0.42), at(-0.3, H + 0.3, g0 + ADIT.h + 0.42), at(-0.3, -H - 0.3, g0 + ADIT.h + 0.42), 'wood', lag, at(1, 0, g0 + 30), 0.9);
  pushQuadOut(b, at(C + 0.2, -H - 0.3, g0 + ADIT.h + 0.42), at(C + 0.2, H + 0.3, g0 + ADIT.h + 0.42), at(-0.3, H + 0.3, g0 + ADIT.h + 0.42), at(-0.3, -H - 0.3, g0 + ADIT.h + 0.42), 'wood', pitch, at(1, 0, g0 - 30), 0.4);
  for (const sd of [-1, 1]) {
    const r = sd * (H + 0.22);
    pushQuadOut(b, at(C + 0.15, r, g0 - 0.2), at(-0.2, r, g0 - 0.2), at(-0.2, r, g0 + ADIT.h + 0.4), at(C + 0.15, r, g0 + ADIT.h + 0.4), 'wood', lag, at(1, sd * 20, g0 + 1), 0.8);
    pushQuadOut(b, at(C + 0.15, r, g0 - 0.2), at(-0.2, r, g0 - 0.2), at(-0.2, r, g0 + ADIT.h + 0.4), at(C + 0.15, r, g0 + ADIT.h + 0.4), 'wood', pitch, at(1, -sd * 20, g0 + 1), 0.4);
  }
  // Рельсы: шпалы и две нитки — из глубины, через оклад, к отвалу.
  const ties: [number, number, number, number][] = [];
  for (let k = 0; k + 1 < RAILS.length; k++) {
    const [f0, r0] = RAILS[k];
    const [f1, r1] = RAILS[k + 1];
    const len = Math.hypot(f1 - f0, r1 - r0);
    const nf = -(r1 - r0) / len;
    const nr = (f1 - f0) / len;
    for (const off of [-0.45, 0.45]) {
      const a = at(f0 + nf * off, r0 + nr * off, 0);
      const e = at(f1 + nf * off, r1 + nr * off, 0);
      log(b, [a[0], railY(fr, g0, f0, r0) + 0.16, a[2]], [e[0], railY(fr, g0, f1, r1) + 0.16, e[2]], 0.055, grey(0.7), 4, false);
    }
    if (d > 0) for (let sp = 0.4; sp < len; sp += 0.9) ties.push([f0 + ((f1 - f0) * sp) / len, r0 + ((r1 - r0) * sp) / len, nf, nr]);
  }
  for (const [f, r, nf, nr] of ties) {
    const [x, z] = fr.q(f, r);
    const yy = railY(fr, g0, f, r);
    // Шпала поперёк хода: «вперёд» коробки — по ходу рельсов.
    const hx = fr.fx * -nr + fr.fz * nf;
    const hz = fr.fz * -nr - fr.fx * nf;
    const hl = Math.hypot(hx, hz) || 1;
    box(b, x, z, hx / hl, hz / hl, 1.3, 0.22, yy - 0.05, yy + 0.1, 'wood', wood(0.8), 'wood');
  }
  // Упор в конце рельсов — брус поперёк.
  const [ef, er] = RAILS[RAILS.length - 1];
  const [ux, uz] = fr.q(ef + 0.4, er - 0.3);
  const uy = railY(fr, g0, ef, er);
  box(b, ux, uz, Math.cos(P.rot + 0.9), Math.sin(P.rot + 0.9), 1.5, 0.32, uy - 0.1, uy + 0.55, 'wood', wood(0.9), 'wood');
  // Отвал: два конуса битой породы у конца рельсов.
  const dumpT = tint(0xcfc6b6, 0.9);
  const [nx, nz] = fr.q(DUMP.f, DUMP.r);
  cone(b, nx, nz, DUMP.R, heightAt(nx, nz) - 0.4, heightAt(nx, nz) + DUMP.h, d === 0 ? 8 : 12, 'rubble', dumpT, 0.72);
  const [mx2, mz2] = fr.q(DUMP.f + 3.6, DUMP.r + 2.4);
  cone(b, mx2, mz2, DUMP.R * 0.62, heightAt(mx2, mz2) - 0.4, heightAt(mx2, mz2) + DUMP.h * 0.55, d === 0 ? 7 : 10, 'rubble', [dumpT[0] * 0.95, dumpT[1] * 0.94, dumpT[2] * 0.92], 0.72);
  if (d > 0) {
    // Вагонетка на рельсах у оклада: короб на раме, четыре колеса, руда горкой.
    const cf = C + 1.7;
    const cy = railY(fr, g0, cf, 0) + 0.22;
    const [vx, vz] = fr.q(cf, 0);
    box(b, vx, vz, fr.fx, fr.fz, 1.15, 1.8, cy + 0.15, cy + 1.0, 'wood', wood(1.1), null, { aoBottom: 0.7 });
    box(b, vx, vz, fr.fx, fr.fz, 1.21, 1.86, cy + 0.95, cy + 1.05, 'wood', grey(0.7), null);
    cone(b, vx, vz, 0.65, cy + 0.95, cy + 1.5, 6, 'rubble', tint(0x7a6a58, 0.8), 0.7);
    for (const f of [-0.6, 0.6]) {
      for (const r of [-0.52, 0.52]) {
        const c0 = at(cf + f, r, 0);
        const c1 = at(cf + f, r * 1.14, 0);
        log(b, [c0[0], cy + 0.05, c0[2]], [c1[0], cy + 0.05, c1[2]], 0.21, grey(0.6), 6, true);
      }
    }
    // Крепёжный лес у сторожки: стойки штабелем.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4 - row; i++) {
        const rr = 0.16;
        const r0 = 4.6 + (i + row * 0.5) * rr * 2.1;
        const a = at(C + 1.2, r0, 0);
        const e = at(C + 4.8, r0, 0);
        const ya = heightAt(a[0], a[2]) + rr + row * rr * 1.75;
        const ye = heightAt(e[0], e[2]) + rr + row * rr * 1.75;
        log(b, [a[0], ya, a[2]], [e[0], ye, e[2]], rr, woodLight(0.85), 6, true);
      }
    }
  }
  // Сторожка горняков.
  body(
    b,
    yardHalls(y)[0],
    {
      storeys: [{ h: 2.7, front: 'groundDoor', side: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (48 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
      chimneys: 0,
    },
    d,
  );
  // Фонарь — у правой стойки оклада, лицом к двору.
  return [at(C + 0.25, H + 0.45, g0 + 2.4)];
}

/**
 * Мельница Фермы (ЗД-2): каменная башня у южного торца амбара — пристройкой к нему, в рамке хутора (вперёд, вправо); радиус у
 * земли и у верха, высота кладки. Крылья — своим мешем, они крутятся (`sails`, `mill.SailMill`).
 */
export const WINDMILL = { f: -1.2, r: 15.8, R0: 3, R1: 2.35, H: 10.6 } as const;
/** Крылья: длина от оси, ширина решётки, вынос ступицы перед кладкой и подъём оси над верхом кладки. */
export const SAILS = { R: 8.4, W: 1.75, inner: 1.8, out: 1.2, lift: 1.1 } as const;

/** Башня с наклоном стен: от радиуса `r0` у `y0` до `r1` у `y1`, `seg` граней, UV — по окружности в плитках слоя. */
function taper(b: Builder, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, seg: number, layer: LayerName, t: V3): void {
  const [tw, th] = TILE_M[layer];
  const per = Math.max(1, Math.round((2 * Math.PI * r0) / tw));
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const u0 = ((seg - k - 1) / seg) * per;
    const u1 = ((seg - k) / seg) * per;
    b.quad(
      [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0],
      [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0],
      [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1],
      [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1],
      [u0, 0, u1, 0, u1, (y1 - y0) / th, u0, (y1 - y0) / th],
      L[layer],
      t,
      [0.72, 0.72, 0.95, 0.95],
    );
  }
}

/** Где мельница: середина башни, низ кладки (пол у двери) и верх; ступица крыльев — в мире, ось — вперёд рамки хутора. */
export function windmillAt(y: Yard): { x: number; z: number; base: number; top: number; hub: V3; fx: number; fz: number } {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const [x, z] = fr.q(WINDMILL.f, WINDMILL.r);
  const base = heightAt(...fr.q(WINDMILL.f + WINDMILL.R0 + 0.5, WINDMILL.r)) + 0.1;
  const top = base + WINDMILL.H;
  return { x, z, base, top, hub: fr.p(WINDMILL.f + WINDMILL.R1 + SAILS.out, WINDMILL.r, top + SAILS.lift), fx: fr.fx, fz: fr.fz };
}

/** Башня мельницы, шатёр и хвост-водило; дверь и бойница к двору. Огонь ночи — над дверью. */
function windmillTower(b: Builder, y: Yard, d: Detail): V3 {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const m = windmillAt(y);
  const seg = d === 0 ? 8 : 12;
  // Цоколь — в землю под всем следом башни.
  let lo = Infinity;
  for (let k = 0; k < 8; k++) lo = Math.min(lo, heightAt(m.x + Math.cos((k * Math.PI) / 4) * WINDMILL.R0, m.z + Math.sin((k * Math.PI) / 4) * WINDMILL.R0));
  const stone = tint(CITY.stoneTints[1], 0.9);
  taper(b, m.x, m.z, WINDMILL.R0 + 0.12, WINDMILL.R0 + 0.06, lo - 0.6, m.base + 0.5, seg, 'rubble', tint(CITY.stoneTints[1], 0.78));
  taper(b, m.x, m.z, WINDMILL.R0, WINDMILL.R1, m.base + 0.5, m.top, seg, 'plaster', tint(CITY.wallTints[3], 0.95));
  // Венец кладки под шатром — камень.
  taper(b, m.x, m.z, WINDMILL.R1 + 0.12, WINDMILL.R1 + 0.12, m.top - 0.45, m.top, seg, 'ashlar', stone);
  // Шатёр — дранкой; ось — из-под шатра вперёд к ступице.
  cone(b, m.x, m.z, WINDMILL.R1 + 0.45, m.top - 0.1, m.top + 2.6, seg, 'roofSlate', tint(CITY.shingleTint, 0.9), 0.85);
  const axisFrom = fr.p(WINDMILL.f + 0.4, WINDMILL.r, m.top + SAILS.lift - 0.15);
  log(b, axisFrom, [m.hub[0] - m.fx * 0.25, m.hub[1], m.hub[2] - m.fz * 0.25], 0.17, wood(0.9), 6, true);
  // Дверь и бойница — к двору (на запад рамки, к дому): точки на кладке с её наклоном, «наружу» — от середины башни.
  const P = (df: number, h: number): V3 => fr.p(WINDMILL.f + df, WINDMILL.r - WINDMILL.R0 + 0.03 + (h / WINDMILL.H) * (WINDMILL.R0 - WINDMILL.R1), m.base + h);
  const away = (h: number): V3 => fr.p(WINDMILL.f, WINDMILL.r - 20, m.base + h);
  pushQuadOut(b, P(-0.55, 0.5), P(0.55, 0.5), P(0.55, 2.5), P(-0.55, 2.5), 'wood', wood(0.7), away(1.5), 0.8);
  if (d > 0) pushQuadOut(b, P(-0.2, 5.4), P(0.2, 5.4), P(0.2, 6.4), P(-0.2, 6.4), 'wood', tint(0x1c1814, 0.6), away(6), 0.6);
  // Хвост-водило: от шатра назад и вниз к земле — им мельник поворачивает шатёр к ветру.
  const tailTop = fr.p(WINDMILL.f - WINDMILL.R1 - 0.2, WINDMILL.r, m.top + 0.4);
  const [tx, tz] = fr.q(WINDMILL.f - WINDMILL.R1 - 4.6, WINDMILL.r);
  log(b, tailTop, [tx, heightAt(tx, tz) + 0.5, tz], 0.13, wood(0.85), 5, false);
  if (d > 0) post(b, fr, WINDMILL.f - WINDMILL.R1 - 4.6, WINDMILL.r, 0.6, 0.22, grey(0.9));
  return P(0, 2.85);
}

/**
 * Крылья мельницы вокруг своей оси (x — ось, к ступице; y — вверх; z — против «вправо» хутора), как колесо лесопилки
 * (`wheelModel`): махи-брусья, решётка с одной стороны и полотно по ней. `at` переводит точку в место построителя: свой меш,
 * что крутится (`sails`), или общий меш ролика у стены — там крылья стоят.
 */
export function sailsModel(b: Builder, at: (x: number, y: number, z: number) => V3, d: Detail): void {
  const T = wood(1.05);
  const cloth = tint(0xe6dcc6, 0.95);
  // Точка на маху: `a` — угол маха, `s` — от оси, `w` — поперёк маха (к решётке), `x` — вдоль оси.
  const P = (a: number, s: number, w: number, x = 0): V3 => at(x, Math.cos(a) * s - Math.sin(a) * w, -(Math.sin(a) * s + Math.cos(a) * w));
  const hub = [P(0, 0, 0, -0.35), P(0, 0, 0, 0.35)];
  log(b, hub[0], hub[1], 0.42, wood(0.8), 6, true);
  const bars = d === 0 ? 2 : 5;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    log(b, P(a, 0.2, 0, 0.08), P(a, SAILS.R, 0, 0.08), 0.12, T, 4, false);
    log(b, P(a, SAILS.inner, SAILS.W, 0.02), P(a, SAILS.R, SAILS.W, 0.02), 0.05, T, 4, false);
    for (let i = 0; i < bars; i++) {
      const s = SAILS.inner + ((SAILS.R - SAILS.inner) * (i + 0.5)) / bars;
      log(b, P(a, s, -0.2, 0.05), P(a, s, SAILS.W, 0.05), 0.04, T, 4, false);
    }
    // Полотно — по решётке, с обеих сторон: крылья видны и спереди, и сзади.
    const A = P(a, SAILS.inner + 0.15, 0.18, 0);
    const B = P(a, SAILS.R - 0.15, 0.18, 0);
    const C = P(a, SAILS.R - 0.15, SAILS.W - 0.1, 0);
    const D = P(a, SAILS.inner + 0.15, SAILS.W - 0.1, 0);
    pushQuadOut(b, A, B, C, D, 'cloth', cloth, at(6, 0, 0), 0.95);
    pushQuadOut(b, A, B, C, D, 'cloth', [cloth[0] * 0.85, cloth[1] * 0.85, cloth[2] * 0.82], at(-6, 0, 0), 0.8);
  }
}

/** Крылья — своим мешем (`mill.FarmView` ставит его ступицей в `at` и крутит вокруг оси): модель и где она стоит. */
export function sails(y: Yard, d: Detail): { b: Builder; at: V3; fx: number; fz: number; R: number } {
  const m = windmillAt(y);
  const b = new Builder();
  sailsModel(b, (x, yy, z) => [x, yy, z], d);
  return { b, at: m.hub, fx: m.fx, fz: m.fz, R: SAILS.R };
}

/** Крылья в общем меше (ролик у стены): стоят там, где их поставила модель, — в мире, у ступицы. */
export function sailsStill(b: Builder, y: Yard, d: Detail): void {
  const m = windmillAt(y);
  // Ось x модели — вперёд рамки (fx, fz), z — против «вправо» (fz, −fx).
  sailsModel(b, (x, yy, z) => [m.hub[0] + m.fx * x - m.fz * z, m.hub[1] + yy, m.hub[2] + m.fz * x + m.fx * z], d);
}

/** Хутор: длинный дом и амбар под высокими кровлями, мельница у амбара, двор в изгороди, стога и телега. */
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
  const millLight = windmillTower(b, y, d);
  // Изгородь двора — с проходом к проезду; восточная сторона — за мельницей, по краю пашни.
  fence(b, fr, 7, -16, 7, -3, 2.6, d);
  fence(b, fr, 7, 3, 7, FARM_EAST, 2.6, d);
  fence(b, fr, 7, FARM_EAST, -16, FARM_EAST, 2.6, d);
  fence(b, fr, -16, FARM_EAST, -16, -16, 2.6, d);
  fence(b, fr, -16, -16, 7, -16, 2.6, d);
  // Стога за амбаром: два — всегда, ещё по два — с ростом Фермы (`farmGrowth`).
  for (let k = 0; k < 2; k++) {
    const [x, z] = fr.q(...STACKS[k]);
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
  return { lights: [fr.p(4.4, -6, house.base + 2.6), millLight], chimneys: r.chimneys };
}

/** Восточная сторона изгороди хутора (вправо рамки) — за мельницей, по краю пашни. */
const FARM_EAST = 21;
/** Стога за амбаром (вперёд, вправо): первые два — всегда, следующие — с ростом Фермы. */
const STACKS: readonly (readonly [number, number])[] = [
  [-21, 4],
  [-25.5, 7.5],
  [-21, 11],
  [-25.5, 14.5],
  [-21, 18],
  [-25.5, -2],
];
/** Загон в своей рамке: полуоси выгона (вперёд — на юг, вправо — на восток), проход — к проезду у хутора. */
export const PEN = { F: 10, R: 15 } as const;

/** Загон: выгон в изгороди перед хутором через проезд, ворота к проезду, навес для скота у западной изгороди, корыто. */
function pen(b: Builder, y: Yard, d: Detail): V3[] {
  const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
  const { F, R } = PEN;
  fence(b, fr, -F, -R, -F, -2.5, 2.5, d);
  fence(b, fr, -F, 2.5, -F, R, 2.5, d);
  fence(b, fr, -F, R, F, R, 2.5, d);
  fence(b, fr, F, R, F, -R, 2.5, d);
  fence(b, fr, F, -R, -F, -R, 2.5, d);
  // Навес у западной изгороди: столбы и односкатная дранка, открыт к востоку.
  const W = 7;
  const D = 3.2;
  const r0 = -R + 0.3;
  const [cx, cz] = fr.q(0, r0 + D / 2);
  const base = heightAt(cx, cz);
  for (const f of [-W / 2, W / 2]) {
    post(b, fr, f, r0, base + 2.1 - heightAt(...fr.q(f, r0)), 0.2, wood());
    post(b, fr, f, r0 + D, base + 2.6 - heightAt(...fr.q(f, r0 + D)), 0.2, wood());
  }
  const A = fr.p(-W / 2 - 0.4, r0 + D + 0.9, base + 2.75);
  const B = fr.p(W / 2 + 0.4, r0 + D + 0.9, base + 2.75);
  const C = fr.p(W / 2 + 0.4, r0 - 0.2, base + 2.05);
  const E = fr.p(-W / 2 - 0.4, r0 - 0.2, base + 2.05);
  pushQuadOut(b, A, B, C, E, 'roofSlate', tint(CITY.shingleTint, 0.9), [A[0], A[1] + 10, A[2]], 0.95);
  pushQuadOut(b, A, B, C, E, 'wood', wood(0.6), [A[0], A[1] - 10, A[2]], 0.6);
  // Корыто у ворот.
  const [tx, tz] = fr.q(-6, 5);
  const ty = heightAt(tx, tz);
  box(b, tx, tz, fr.fx, fr.fz, 0.7, 2.4, ty - 0.1, ty + 0.55, 'wood', wood(1.1), 'wood');
  return [];
}

/**
 * Рост Фермы с уровнем (ЗД-2): своим мешем, ступенями по `layout.FARM_TIERS` — меш рисует начало индексов до своей ступени
 * (`tiers` — где кончается каждая, `mill.growthCount`). С 4-го уровня: амбар-житница на камнях-грибах, ульи у дома и ещё два стога; с 7-го: голубятня
 * во дворе, хлев в загоне и ещё два стога.
 */
export function farmGrowth(farm: Yard, penY: Yard, d: Detail): { b: Builder; tiers: number[] } {
  const b = new Builder();
  b.owner = ownerCode('farm');
  const fr = new Frame(farm.x, farm.z, Math.cos(farm.rot), Math.sin(farm.rot));
  const tiers: number[] = [];
  // Ступень 1. Житница на камнях-грибах: от мышей и сырости.
  const gr = hall(farm, -11, -9, farm.rot, 4.4, 3.4);
  const lift = 0.85;
  for (const f of [-1.3, 1.3]) for (const r of [-1.8, 0, 1.8]) {
    const [x, z] = new Frame(gr.x, gr.z, Math.cos(gr.rot), Math.sin(gr.rot)).q(f, r);
    const g = heightAt(x, z);
    cylinder(b, x, z, 0.16, g - 0.2, gr.base + lift - 0.12, 6, 'rubble', tint(CITY.stoneTints[2], 0.8));
    if (d > 0) cylinder(b, x, z, 0.34, gr.base + lift - 0.14, gr.base + lift - 0.02, 6, 'rubble', tint(CITY.stoneTints[1], 0.85));
  }
  body(
    b,
    { ...gr, base: gr.base + lift },
    {
      storeys: [{ h: 2.3, front: 'wood', side: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (48 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
    },
    d,
  );
  for (let k = 2; k < 4; k++) {
    const [x, z] = fr.q(...STACKS[k]);
    stack(b, x, z, 1.6 + rnd(farm.seed, k, 9) * 0.4, 3.8 + rnd(farm.seed, k, 11));
  }
  // Ульи-колоды у западной стены дома.
  for (let k = 0; k < (d === 0 ? 2 : 4); k++) {
    const [x, z] = fr.q(1.5 - k * 1.3, -15);
    const g = heightAt(x, z);
    box(b, x, z, fr.fx, fr.fz, 0.6, 0.6, g - 0.1, g + 0.35, 'wood', wood(0.8), 'wood');
    cone(b, x, z, 0.42, g + 0.35, g + 1.15, 7, 'wood', straw, 0.8);
  }
  tiers.push(b.idx.length);
  // Ступень 2. Голубятня: круглая башенка под шатром.
  const [dx, dz] = fr.q(-12.5, 1.5);
  const dg = heightAt(dx, dz);
  taper(b, dx, dz, 1.55, 1.4, dg - 0.4, dg + 4.6, d === 0 ? 7 : 10, 'plaster', tint(CITY.wallTints[0], 0.95));
  cone(b, dx, dz, 1.85, dg + 4.5, dg + 6.6, d === 0 ? 7 : 10, 'roofSlate', tint(CITY.shingleTint, 0.88), 0.85);
  // Хлев у южной изгороди загона, внутри неё — касание по нему открывает Ферму: длинный и низкий, под дранкой, лицом к выгону.
  const [bx, bz] = new Frame(penY.x, penY.z, Math.cos(penY.rot), Math.sin(penY.rot)).q(PEN.F - 2.9, 3.5);
  const brot = penY.rot + Math.PI;
  const byre: Civic = { kind: 'stable', x: bx, z: bz, rot: brot, w: 10, d: 4.4, base: footSpan(bx, bz, Math.cos(brot), Math.sin(brot), 10, 4.4).hi + FLOOR_LIFT, seed: penY.seed + 3 };
  body(
    b,
    byre,
    {
      storeys: [{ h: 2.6, front: 'wood', side: 'wood' }],
      wallHex: CITY.wallTints[6],
      roof: { pitch: (42 * Math.PI) / 180, layer: 'roofSlate', hex: CITY.shingleTint, alongF: false },
    },
    d,
  );
  for (let k = 4; k < 6; k++) {
    const [x, z] = fr.q(...STACKS[k]);
    stack(b, x, z, 1.6 + rnd(farm.seed, k, 9) * 0.4, 3.8 + rnd(farm.seed, k, 11));
  }
  tiers.push(b.idx.length);
  return { b, tiers };
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

