// Камера-режиссёр ролика боя (docs/gfx.md, «Камера»): общий план → сшибка → перелом → развязка, по тактам журнала
// (`beats.ts`). Чистый расчёт положения камеры — четыре числа `CamState`; ведёт её `TacticalCamera`, пока игрок не взял
// камеру пальцем (кнопка возвращает режиссёра).
//
// Где что стоит на поле, режиссёр не знает: спрашивает у плана места (`DirectorScene`) — прямоугольник строя и место
// сектора на секунде. Поэтому он общий для поля и осады: план стены ответит своими местами, а смысл кадра тот же.
//
//   общий план  — открывается низко за серединой нашей первой линии (знамёна и люди крупно, за ними чужой строй), потом
//                 отъезжает вверх и назад, пока в кадре не встанут обе армии; к сшибке камера мягко наезжает;
//   сшибка      — ниже и ближе, наискось к полосе, где в первой сшибке выбили больше всех;
//   сеча        — между тактами камера держит линию соприкосновения средним планом;
//   перелом     — к сектору, с которого бой пошёл к исходу, сбоку от его фланга;
//   развязка    — выше и шире: бегущие и погоня; на развязке после боя (`clock.CODA_SECONDS`) — низко над полем с
//                 павшими, из-за наших: победили — наши знамёна над полем, бегущие вдали; проиграли — за полем
//                 ликуют чужие. Облёта к победителю нет: полуоборот вокруг поля за три секунды — рывок, а не ход.
//
// Переходы — плавные, без склеек: каждый такт приходит смешением с прежним (`blendCam`), и чем длиннее путь камеры,
// тем дольше переход (`blendFor`); такт держится не меньше `HOLD`, а живой прямоугольник строя камера переводит в ход
// сглаживанием (`camera.AUTO_HALF_LIFE`).
import type { Sector, Side } from '@/battle/types';
import { blendCam, overview, type CamState } from './camera';
import type { Beat } from './beats';
import type { ReelTiming } from './clock';

const DEG = Math.PI / 180;

/** Прямоугольник на земле. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Что режиссёр спрашивает у плана места. */
export interface DirectorScene {
  /** Сторона игрока: она на −Z, камера общего плана — за ней. */
  us: Side;
  /**
   * Прямоугольник отрядов на секунде `t`: `lines` — первые и вторые линии обеих сторон (без резерва и полководца),
   * `field` — кто ещё в строю (бежавшие далеко — нет), `rout` — бегущие и гонящие у поля боя. null — на поле никого.
   */
  box(t: number, which: 'lines' | 'field' | 'rout'): Box | null;
  /** Середина передней шеренги сектора стороны на секунде `t`; null — сектора на поле нет. */
  spot(side: Side, sector: Sector, t: number): { x: number; z: number } | null;
}

/** Наклоны планов: общий — над строем, близкие — ниже, к горизонту, чтобы фигуры закрывали друг друга и была глубина. */
export const SHOT_PITCH = { open: 16 * DEG, overview: 34 * DEG, overviewEnd: 30 * DEG, clash: 26 * DEG, melee: 29 * DEG, turn: 28 * DEG, rout: 31 * DEG, coda: 22 * DEG };
/**
 * Смешение такта с прежним: начинается за `LEAD` до такта и длится не меньше `BLEND`; длинный путь камеры — дольше, со
 * скоростью не выше `GLIDE` метров в секунду (`blendFor`), но не дольше `BLEND_MAX`. Такт держится не меньше `HOLD`
 * секунд: перелом через две секунды после сшибки не уводит камеру, пока сшибку не разглядели.
 */
export const BLEND = 1.8;
export const BLEND_MAX = 3.4;
export const LEAD = 0.9;
export const GLIDE = 24;
export const HOLD = 2.8;
/** Кадр развязки после боя: полуширина по фронту, метры; переход к нему — `blendFor`, половина — к концу боя. */
const CODA_HALF = 12;
/** Ближний план: полуширина кадра по фронту и запас по глубине, метры сцены. */
const NEAR = { clash: 11, turn: 10, depth: 7, rout: 11 };

const sideways = (x: number): number => (x > 1 ? -1 : x < -1 ? 1 : 1);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Кадр вокруг точки: `half` по фронту, `depth` вглубь в обе стороны. */
function around(x: number, z: number, half: number, depth: number, aspect: number, yaw: number, pitch: number): CamState {
  return overview({ minX: x - half, maxX: x + half, minZ: z - depth, maxZ: z + depth }, aspect, yaw, pitch);
}

/** Открытие держится столько секунд, отъезд к общему плану идёт столько. */
export const OPEN = { hold: 1.3, pull: 3.2 };

/** Открытие: низко за серединой нашей первой линии — наши знамёна и люди крупно, за ними, через поле, чужой строй. */
function openShot(scene: DirectorScene, t: number): CamState {
  const p = scene.spot(scene.us, 'B', t) ?? { x: 0, z: -12 };
  return { tx: p.x, tz: p.z + 5, dist: 17, yaw: 0.3, pitch: SHOT_PITCH.open };
}

/** Общий план: открытие → отъезд до обеих армий (первые и вторые линии) → мягкий наезд к сшибке. */
function overviewShot(scene: DirectorScene, t: number, clashAt: number, aspect: number): CamState {
  const u = clamp01(t / Math.max(1, clashAt));
  const box = scene.box(t, 'lines') ?? scene.box(t, 'field') ?? { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  const wide = overview(box, aspect, 0.16 - 0.1 * u, SHOT_PITCH.overview + (SHOT_PITCH.overviewEnd - SHOT_PITCH.overview) * u);
  wide.dist *= 1.02 - 0.12 * u;
  const k = clamp01((t - OPEN.hold) / OPEN.pull);
  return k < 1 ? blendCam(openShot(scene, t), wide, k) : wide;
}

/** Сшибка: наискось к полосе сшибки, от её внешнего фланга. */
function clashShot(scene: DirectorScene, beat: Beat, t: number, aspect: number): CamState {
  const f = beat.focus!;
  const p = scene.spot(f.side, f.sector, t) ?? { x: 0, z: 0 };
  return around(p.x, 0, NEAR.clash, NEAR.depth, aspect, 0.42 * sideways(p.x), SHOT_PITCH.clash);
}

/** Сеча между тактами: линия соприкосновения средним планом — вся ширина строя в кадре, чуть ниже общего. */
function meleeShot(scene: DirectorScene, t: number, aspect: number): CamState {
  const box = scene.box(t, 'field') ?? { minX: -20, maxX: 20, minZ: -10, maxZ: 10 };
  const half = Math.max(12, (box.maxX - box.minX) / 2);
  return around((box.minX + box.maxX) / 2, 0, half, 10, aspect, 0.16, SHOT_PITCH.melee);
}

/** Перелом: к сектору, с которого бой пошёл к исходу, — сбоку от его фланга. */
function turnShot(scene: DirectorScene, beat: Beat, t: number, aspect: number): CamState {
  const f = beat.focus!;
  const p = scene.spot(f.side, f.sector, Math.min(t, beat.at + 0.5)) ?? { x: 0, z: 0 };
  return around(p.x, p.z * 0.5, NEAR.turn, NEAR.depth + 2, aspect, 0.55 * sideways(p.x), SHOT_PITCH.turn);
}

/**
 * Развязка: бегущие и погоня — выше прочих близких планов, по середине бегства. Кадр — не весь разбег бегущих, а
 * середина действия (`NEAR.rout`): в портрете фронт в тридцать метров увёл бы камеру на девяносто, и боец стал бы точкой.
 */
function routShot(scene: DirectorScene, t: number, aspect: number): CamState {
  const box = scene.box(t, 'rout') ?? scene.box(t, 'field') ?? { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  return around((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2, NEAR.rout, NEAR.rout + 2, aspect, 0.22, SHOT_PITCH.rout);
}

/**
 * После боя: низко над полем, где лежат павшие, из-за наших. Победили мы — над полем стоят наши знамёна, бегущие уходят
 * вдаль; проиграли — за полем павших ликуют чужие.
 */
function codaShot(scene: DirectorScene, t: number, aspect: number): CamState {
  const box = scene.box(t, 'field') ?? { minX: -16, maxX: 16, minZ: -8, maxZ: 8 };
  const cx = (box.minX + box.maxX) / 2;
  const half = Math.max(9, Math.min(CODA_HALF, (box.maxX - box.minX) / 2));
  return around(cx, 2, half, 9, aspect, 0.3, SHOT_PITCH.coda);
}

/** Длина пути камеры между двумя положениями, метры: цель, расстояние и дуга облёта. */
function pathOf(a: CamState, b: CamState): number {
  const turn = Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)));
  return Math.hypot(b.tx - a.tx, b.tz - a.tz) + Math.abs(b.dist - a.dist) + turn * Math.max(a.dist, b.dist) * Math.cos(Math.min(a.pitch, b.pitch));
}

/** Сколько длится переход: не короче `BLEND`, со скоростью не выше `GLIDE`, не дольше `BLEND_MAX`. */
export function blendFor(a: CamState, b: CamState): number {
  return Math.min(BLEND_MAX, Math.max(BLEND, pathOf(a, b) / GLIDE));
}

/** Кадр одного такта на секунде `t`. */
function shotOf(scene: DirectorScene, beat: Beat, start: number, t: number, tm: ReelTiming, beats: readonly Beat[], aspect: number): CamState {
  const clashAt = beats.find((b) => b.id === 'clash')?.at ?? tm.intro;
  switch (beat.id) {
    case 'overview':
      return overviewShot(scene, t, clashAt, aspect);
    case 'clash': {
      // Сшибка держится, пока не пришёл следующий такт; дальше трёх секунд — сеча средним планом.
      const c = clashShot(scene, beat, t, aspect);
      const k = clamp01((t - Math.max(beat.at, start) - 3) / BLEND);
      return k > 0 ? blendCam(c, meleeShot(scene, t, aspect), k) : c;
    }
    case 'turn': {
      const c = turnShot(scene, beat, t, aspect);
      const k = clamp01((t - Math.max(beat.at, start) - 3.2) / BLEND);
      return k > 0 ? blendCam(c, meleeShot(scene, t, aspect), k) : c;
    }
    case 'outcome':
      return routShot(scene, t, aspect);
  }
}

/**
 * Когда камера трогается к каждому такту: за `LEAD` до него, но не раньше, чем прежний такт продержался `HOLD`. Общий
 * план — с нуля.
 */
export function beatCues(beats: readonly Beat[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < beats.length; i++) out.push(i === 0 ? 0 : Math.max(beats[i].at - LEAD, out[i - 1] + (i === 1 ? 0 : HOLD)));
  return out;
}

/** Положение камеры режиссёра на секунде ролика `t`. Тот же журнал — тот же ход камеры. */
export function directorView(scene: DirectorScene, beats: readonly Beat[], tm: ReelTiming, t: number, aspect: number): CamState {
  const cues = beatCues(beats);
  let cur = 0;
  for (let i = 0; i < beats.length; i++) if (t >= cues[i]) cur = i;
  const b = beats[cur];
  let shot = shotOf(scene, b, cues[cur], t, tm, beats, aspect);
  if (cur > 0) {
    // Длина перехода — по пути камеры в миг, когда она тронулась: тот же журнал — тот же переход.
    const from = shotOf(scene, beats[cur - 1], cues[cur - 1], cues[cur], tm, beats, aspect);
    const len = blendFor(from, shotOf(scene, b, cues[cur], cues[cur], tm, beats, aspect));
    const k = clamp01((t - cues[cur]) / len);
    if (k < 1) shot = blendCam(shotOf(scene, beats[cur - 1], cues[cur - 1], t, tm, beats, aspect), shot, k);
  }
  // Развязка после боя — свой кадр поверх такта развязки: половина перехода — к концу боя; длина — по пути камеры в миг,
  // когда бой кончился (тот же журнал — тот же переход).
  let last = 0;
  for (let i = 0; i < beats.length; i++) if (tm.end >= cues[i]) last = i;
  const len = blendFor(shotOf(scene, beats[last], cues[last], tm.end, tm, beats, aspect), codaShot(scene, tm.end, aspect));
  if (t > tm.end - len * 0.5) {
    const k = clamp01((t - (tm.end - len * 0.5)) / len);
    shot = blendCam(shot, codaShot(scene, t, aspect), k);
  }
  return shot;
}
