// Клубок в окно (docs/city_v3.md, Р-1): куда летит клубок, брошенный в окно, где воздух, а где камень, как кот прыгает за
// ним наружу и откуда возвращается — снизу экрана, с клубком в зубах. Чистая геометрия покоев: стены, ниши, проёмы и мебель —
// из `plan.ts` и `walk.ts`, своих размеров комнаты здесь нет. Кадр и сцены — в `life.ts`.
import type { V3 } from '../city/geom';
import { HALF, OPENINGS, WALL_AXES, WALL_T, alongOf, type Opening } from './plan';
import { clear, free } from './walk';
import { CAT_R } from './cat';

/** Радиус клубка, м. */
export const BALL_R = 0.045;
/** Ускорение падения клубка, м/с². */
export const GRAVITY = 9.8;
/** Клубок кидают не чаще раза в столько секунд (слово владельца). */
export const BALL_EVERY = 10;
/** Кот за окном столько секунд, прежде чем вернуться (слово владельца: «через секунду»). */
export const CAT_AWAY = 1;
/** До окна клубок долетает, если окно не дальше стольких метров от глаза. */
const REACH = 6.5;

/** Проёмы окна: середина вдоль стены (по оси `U`) и полуширина каждого (у парного — два). */
export function lightsOf(o: Opening): { c: number; half: number }[] {
  const a = alongOf(o);
  if (!o.twin) return [{ c: a, half: o.outW / 2 }];
  const h = (o.outW - 0.16) / 4;
  return [-1, 1].map((s) => ({ c: a + s * (h + 0.08), half: h }));
}

/** Точка в осях стены: глубина от грани комнаты (наружу +) и место вдоль её оси `U`. */
function onWall(o: Opening, p: V3): { depth: number; along: number } {
  const { n, u } = WALL_AXES[o.wall];
  return { depth: p[0] * n[0] + p[2] * n[2] - HALF, along: p[0] * u[0] + p[2] * u[2] };
}

/** Из осей стены — в оси комнаты. */
function fromWall(o: Opening, along: number, y: number, depth: number): V3 {
  const { n, u } = WALL_AXES[o.wall];
  return [n[0] * (HALF + depth) + u[0] * along, y, n[2] * (HALF + depth) + u[2] * along];
}

/**
 * Воздух ли в точке для шара радиуса `r` (клубок, лапы и спина кота): в комнате — да; в толще стены — только в нише окна
 * (откосы и ставни сужают её, у южной — каменные сиденья по бокам) и в проёме доски над подоконником; за наружной гранью —
 * воздух. Мебель комнаты здесь не спрашивается — её держит `walk` (кот ходит его путями, клубок проверяется `flightClear`).
 */
export function passable(p: V3, r: number): boolean {
  const [x, y, z] = p;
  if (y < -1e-6) return false;
  if (Math.abs(x) <= HALF - r && Math.abs(z) <= HALF - r) return true;
  for (const o of OPENINGS) {
    const { depth, along } = onWall(o, p);
    if (depth < -r - 1e-9) continue;
    const a = alongOf(o);
    // Ниша: от грани комнаты до доски, откосы сходятся от `inW` к `midW`; ставни — на ладонь от откоса.
    if (depth <= o.plate) {
      const k = Math.max(0, depth) / o.plate;
      const half = o.inW / 2 + (o.midW / 2 - o.inW / 2) * k - 0.12;
      if (Math.abs(along - a) > half - r) continue;
      if (y - r < o.inSill - 1e-6 && depth > -r) continue;
      // Сиденья южной ниши — у откосов до 0,53 м.
      if (o.seats && Math.abs(along - a) > half - 0.5 && y - r < 0.53) continue;
      // Плита подоконника выходит в нишу на 7–12 см.
      if (depth > o.plate - 0.13 && y - r < o.sill - 1e-6) continue;
      if (y + r > o.inSpring) continue;
      return true;
    }
    // Проём доски до наружной грани: между откосами проёма, над подоконником, под пятой арки.
    if (depth <= WALL_T) {
      for (const l of lightsOf(o)) {
        if (Math.abs(along - l.c) <= l.half - r && y - r >= o.sill - 1e-6 && y + r <= o.spring) return true;
      }
      continue;
    }
    // За стеной — воздух (над землёй далеко внизу).
    if (Math.abs(along - a) < o.outW / 2 + 1.5) return true;
  }
  return false;
}

/** Бросок в окно: какое окно, какой проём, куда летит клубок (над доской), с какой скоростью из руки. */
export interface WindowShot {
  o: Opening;
  /** Середина проёма вдоль стены. */
  light: number;
  /** Точка над подоконником, сквозь которую летит клубок (оси комнаты). */
  target: V3;
  /** Начальная скорость из руки. */
  v: V3;
}

/**
 * Брошен ли клубок в окно: луч взгляда упирается в нишу окна (с запасом в пядь — пальцем точно не прицелиться), окно не
 * дальше `REACH`. Цель — проём, ближний к лучу, над подоконником; полёт — дугой из руки, и вся дуга, до наружной грани и за
 * неё, проходит воздухом (стены, откосы, ставни, столбик парного окна — мимо). Нет такой дуги — `null`: бросок обычный, на
 * пол.
 */
export function windowShot(eye: V3, yaw: number, pitch: number, hand: V3): WindowShot | null {
  const d: V3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  let best: { o: Opening; t: number; along: number; y: number } | null = null;
  for (const o of OPENINGS) {
    const { n } = WALL_AXES[o.wall];
    const dn = d[0] * n[0] + d[2] * n[2];
    if (dn < 0.2) continue;
    const e = onWall(o, eye);
    const t = (o.plate - e.depth) / dn;
    if (t <= 0 || t > REACH) continue;
    const hit: V3 = [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
    const h = onWall(o, hit);
    // В проём (с запасом в пядь), а не в пол ниши под подоконником и не в арку над ним.
    if (Math.abs(h.along - alongOf(o)) > o.midW / 2 + 0.3) continue;
    if (hit[1] < o.sill - 0.25 || hit[1] > o.spring + o.outW / 2 + 0.5) continue;
    // И луч входит в нишу, а не упирается раньше в стену рядом с ней.
    const t0 = -e.depth / dn;
    const g: V3 = [eye[0] + d[0] * t0, eye[1] + d[1] * t0, eye[2] + d[2] * t0];
    if (Math.abs(onWall(o, g).along - alongOf(o)) > o.inW / 2 + 0.15 || g[1] < o.inSill - 0.2 || g[1] > o.inSpring + 0.3) continue;
    if (!best || t < best.t) best = { o, t, along: h.along, y: hit[1] };
  }
  if (!best) return null;
  const o = best.o;
  const lights = lightsOf(o).sort((p, q) => Math.abs(p.c - best!.along) - Math.abs(q.c - best!.along));
  // Высота цели: куда смотрят, но над подоконником с запасом (на нём может сидеть кот) и под аркой.
  const lo = o.sill + (o.twin ? 0.28 : 0.5);
  const hi = o.spring - 0.15;
  for (const l of lights) {
    for (const y of [Math.min(hi, Math.max(lo, best.y)), (lo + hi) / 2, lo]) {
      const target = fromWall(o, l.c, y, o.plate + 0.05);
      const dh = Math.hypot(target[0] - hand[0], target[2] - hand[2]);
      for (const k of [1, 0.8, 1.25, 1.5]) {
        const t = Math.min(1.2, Math.max(0.3, dh / 6)) * k;
        const v: V3 = [(target[0] - hand[0]) / t, (target[1] - hand[1]) / t + 0.5 * GRAVITY * t, (target[2] - hand[2]) / t];
        if (flightClear(hand, v, o)) return { o, light: l.c, target, v };
      }
    }
  }
  return null;
}

/** Где клубок в полёте через `t` секунд. */
export function flightAt(p0: V3, v: V3, t: number): V3 {
  return [p0[0] + v[0] * t, p0[1] + v[1] * t - 0.5 * GRAVITY * t * t, p0[2] + v[2] * t];
}

/** Глубина точки за гранью стены окна (наружу +). */
export function depthOf(o: Opening, p: V3): number {
  return onWall(o, p).depth;
}

/**
 * Вся дуга из руки — воздухом и уходит за наружную грань стены этого окна. Мебель ниже: дуга идёт от руки (1,17 м) вверх к
 * проёму над подоконником — что она проходит выше стола и сундуков, держит сетка бросков (`toss.test`). Шаг проверки — не
 * длиннее сантиметра пути: наискось клубок задевал угол откоса между проверками через 1/120 с (найдено той же сеткой).
 */
function flightClear(p0: V3, v: V3, o: Opening): boolean {
  const dt = 0.01 / Math.max(1, Math.hypot(v[0], v[1], v[2]) + GRAVITY * 1.2);
  for (let t = 0; t < 3; t += dt) {
    const p = flightAt(p0, v, t);
    if (!passable(p, BALL_R)) return false;
    if (depthOf(o, p) > WALL_T + 0.3) return true;
  }
  return false;
}

/** Шаг кота: дойти по полу (`jump: false`) или прыгнуть дугой (`arc` — высота дуги над прямой, м). */
export interface Hop {
  to: V3;
  jump: boolean;
  arc?: number;
}

/**
 * Кот за клубком в окно: по полу к нише (у парного окна — к её низу и прыжком в неё), прыжком на подоконник в проёме, прыжком
 * наружу — вниз за грань стены, где его уже не видно.
 */
export function fetchHops(o: Opening, light: number): Hop[] {
  const hops: Hop[] = [];
  if (o.inSill > 0.05) {
    hops.push({ to: fromWall(o, light, 0, -0.42), jump: false });
    hops.push({ to: fromWall(o, light, o.inSill, o.plate - 0.32), jump: true });
  } else hops.push({ to: fromWall(o, light, 0, o.plate - 0.4), jump: false });
  hops.push({ to: fromWall(o, light, o.sill, o.plate + 0.24), jump: true });
  hops.push({ to: fromWall(o, light, o.sill - 0.95, WALL_T + 0.55), jump: true, arc: 0.12 });
  return hops;
}

/** Обратно тем же окном (если снизу экрана места нет): снаружи на подоконник, в нишу, на пол. */
export function windowBack(o: Opening, light: number): { from: V3; hops: Hop[] } {
  const out = fetchHops(o, light);
  const from = out[out.length - 1].to;
  const back: Hop[] = [];
  for (let i = out.length - 2; i >= 0; i--) back.push({ to: out[i].to, jump: out[i].to[1] > 0.01 || out[i + 1].to[1] > 0.01 });
  // Последний прыжок — с подоконника или ниши на пол комнаты, на шаг от стены.
  const last = back[back.length - 1];
  if (last.to[1] < 0.01 && !last.jump) last.jump = true;
  back.push({ to: fromWall(o, light, 0, -0.9), jump: false });
  return { from, hops: back };
}

/** Что видит глаз правителя: где стоит, куда смотрит, поле зрения по вертикали (градусы). */
export interface EyeNow {
  x: number;
  z: number;
  eyeY: number;
  yaw: number;
  pitch: number;
  fov: number;
}

/**
 * Кот возвращается снизу экрана: прыжок с пола у ног правителя — из-под нижнего края кадра или из-за спины, где его не видно, —
 * в кадр, на свободный пол в полутора-двух метрах; дуга идёт под глазом, и кот входит в кадр снизу. Старт — в комнате и
 * свободен, прямая до места — мимо мебели, место — в кадре целиком, прыжок — не длиннее кошачьего (`LEAP_MAX`). Из всех таких —
 * место ближе к середине кадра и к двум метрам. Нет такого (смотрит в пол, в стену, в окно через стол) — `null`: кот вернётся
 * тем же окном.
 */
export function leapBack(e: EyeNow): { from: V3; to: V3 } | null {
  const half = (e.fov * Math.PI) / 360;
  const bottom = e.pitch - half;
  // Сколько видно по сторонам: поле по горизонтали из вертикального и вида экрана телефона стоймя — не уже 0,3 рад от середины.
  const side = 0.3;
  // С какой дали пол виден у нижнего края — туда и чуть дальше прыгает кот (смотрит прямо — дальше, под ноги — ближе).
  const seen = bottom < -1.45 ? 0.6 : (e.eyeY - 0.05) / Math.tan(-Math.min(-0.05, bottom));
  const ideal = Math.min(3.2, Math.max(1.6, seen + 0.5));
  let best: { from: V3; to: V3; cost: number } | null = null;
  for (const dy of [0, 0.12, -0.12, 0.24, -0.24]) {
    if (Math.abs(dy) > side) continue;
    const yaw = e.yaw + dy;
    for (const d1 of [1.3, 1.6, 1.9, 2.2, 2.5, 2.8, 3.1, 3.4]) {
      const to: V3 = [e.x + Math.sin(yaw) * d1, 0, e.z + Math.cos(yaw) * d1];
      if (!inRoom(to) || !free(to[0], to[2], CAT_R)) continue;
      // Место — в кадре: лапы над нижним краем, спина под верхним.
      if (Math.atan2(0.05 - e.eyeY, d1) < bottom + 0.08 || Math.atan2(0.35 - e.eyeY, d1) > e.pitch + half) continue;
      for (let k = 0; k < 12; k++) {
        const a = e.yaw + (k / 12) * Math.PI * 2;
        for (const d0 of [0.32, 0.6, 0.9, 1.2, 1.5, 1.8]) {
          const from: V3 = [e.x + Math.sin(a) * d0, 0, e.z + Math.cos(a) * d0];
          const fwd = Math.cos(a - e.yaw) * d0;
          // Старт не виден: перед глазом — спина кота ниже нижнего края кадра; за глазом (сзади и сбоку) — вне кадра и так.
          if (fwd > 0.05 && Math.atan2(0.32 - e.eyeY, fwd) > bottom - 0.06) continue;
          const leap = Math.hypot(to[0] - from[0], to[2] - from[2]);
          if (leap > LEAP_MAX || leap < 0.9) continue;
          if (!inRoom(from) || !free(from[0], from[2], CAT_R)) continue;
          if (!clear({ x: from[0], z: from[2] }, { x: to[0], z: to[2] }, CAT_R)) continue;
          const cost = Math.abs(dy) * 2 + Math.abs(d1 - ideal) + Math.max(0, -fwd) * 0.6 + Math.abs(leap - 1.5) * 0.3;
          if (!best || cost < best.cost) best = { from, to, cost };
        }
      }
    }
  }
  return best ? { from: best.from, to: best.to } : null;
}

/** В кадре ли точка (оси комнаты) для глаза `e`: по горизонтали — в 0,3 рад от середины, по вертикали — в поле зрения. */
export function inView(e: EyeNow, p: V3): boolean {
  const dx = p[0] - e.x;
  const dz = p[2] - e.z;
  let a = Math.atan2(dx, dz) - e.yaw;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  const el = Math.atan2(p[1] - e.eyeY, Math.hypot(dx, dz));
  const half = (e.fov * Math.PI) / 360;
  return Math.abs(a) < 0.3 && el > e.pitch - half + 0.05 && el < e.pitch + half - 0.03;
}

/** Самый длинный прыжок кота с пола на пол, м. */
const LEAP_MAX = 2.3;

const inRoom = (p: V3): boolean => Math.abs(p[0]) <= HALF - CAT_R && Math.abs(p[2]) <= HALF - CAT_R;
