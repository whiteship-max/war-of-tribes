// Тактическая камера ролика TW (docs/battle_tw.md, раздел 5): общий вид влезает в портрет, границы держат, жест
// идёт за пальцами — проверяется настоящим разбором указателя на поддельном холсте, без браузера.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OVERVIEW_PITCH, PITCH_MAX, PITCH_MIN, TacticalCamera, clampState, overview, type CamBounds } from './camera';

const BOUNDS: CamBounds = { minX: -60, maxX: 60, minZ: -70, maxZ: 70, minDist: 4.5, maxDist: 400 };
const W = 390;
const H = 844;

/** Поддельный холст: события указателя и размер экрана телефона. */
function fakeCanvas(): EventTarget & { getBoundingClientRect: () => DOMRect; setPointerCapture: () => void } {
  const el = new EventTarget() as EventTarget & { getBoundingClientRect: () => DOMRect; setPointerCapture: () => void };
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  el.setPointerCapture = () => undefined;
  return el;
}

function pointer(el: EventTarget, type: string, id: number, x: number, y: number): void {
  const e = new Event(type) as Event & Record<string, unknown>;
  Object.assign(e, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, shiftKey: false });
  el.dispatchEvent(e);
}

/** Где на экране точка земли — в пикселях. */
function screenOf(cam: TacticalCamera, x: number, z: number): { x: number; y: number } {
  cam.camera.updateMatrixWorld();
  const v = new THREE.Vector3(x, 0, z).project(cam.camera);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

function settle(cam: TacticalCamera): void {
  for (let i = 0; i < 120; i++) cam.update(1 / 60);
}

describe('ролик TW: тактическая камера', () => {
  it('общий вид: прямоугольник поля влезает в узкую сторону портрета', () => {
    const box = { minX: -30, maxX: 30, minZ: -40, maxZ: 40 };
    const s = overview(box, W / H);
    const cam = new TacticalCamera(s, BOUNDS);
    cam.setAspect(W / H);
    for (const [x, z] of [
      [box.minX, box.minZ],
      [box.maxX, box.minZ],
      [box.minX, box.maxZ],
      [box.maxX, box.maxZ],
    ]) {
      const p = screenOf(cam, x, z);
      expect(p.x, `угол ${x},${z} по ширине`).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(W + 1);
      expect(p.y, `угол ${x},${z} по высоте`).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(H + 1);
    }
    expect(s.pitch).toBe(OVERVIEW_PITCH);
  });

  it('границы: цель не уходит с поля, расстояние и наклон — в своих пределах', () => {
    const s = clampState({ tx: 500, tz: -500, dist: 9999, yaw: 7, pitch: 3 }, BOUNDS);
    expect(s).toMatchObject({ tx: 60, tz: -70, dist: 400, pitch: PITCH_MAX });
    expect(Math.abs(s.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(clampState({ tx: 0, tz: 0, dist: 1, yaw: 0, pitch: 0 }, BOUNDS)).toMatchObject({ dist: 4.5, pitch: PITCH_MIN });
  });

  it('ведение пальцем — один к одному: земля под пальцем остаётся под ним', () => {
    const cam = new TacticalCamera({ tx: 0, tz: 0, dist: 80, yaw: 0, pitch: 0.8 }, BOUNDS);
    cam.setAspect(W / H);
    const el = fakeCanvas();
    cam.attach(el as unknown as HTMLElement);
    const before = screenOf(cam, 0, 0);
    pointer(el, 'pointerdown', 1, 195, 422);
    for (let k = 1; k <= 10; k++) pointer(el, 'pointermove', 1, 195 + k * 4, 422 + k * 12);
    pointer(el, 'pointerup', 1, 235, 542);
    const after = screenOf(cam, 0, 0);
    expect(after.x - before.x).toBeCloseTo(40, 0);
    expect(after.y - before.y).toBeCloseTo(120, 0);
    expect(cam.auto).toBe(false);
  });

  it('поворот двумя пальцами: поле крутится за пальцами, на тот же угол', () => {
    const cam = new TacticalCamera({ tx: 0, tz: 0, dist: 80, yaw: 0, pitch: 0.8 }, BOUNDS);
    cam.setAspect(W / H);
    const el = fakeCanvas();
    cam.attach(el as unknown as HTMLElement);
    const angle = (p: { x: number; y: number }, c: { x: number; y: number }): number => Math.atan2(p.y - c.y, p.x - c.x);
    const c0 = screenOf(cam, 0, 0);
    const p0 = screenOf(cam, -10, 0);
    // Пальцы по часовой (экранный угол растёт: ось y вниз) на 40°, вокруг середины экрана.
    pointer(el, 'pointerdown', 1, 115, 422);
    pointer(el, 'pointerdown', 2, 275, 422);
    const turn = (40 * Math.PI) / 180;
    for (let k = 1; k <= 20; k++) {
      const a = (k / 20) * turn;
      pointer(el, 'pointermove', 1, 195 - 80 * Math.cos(a), 422 - 80 * Math.sin(a));
      pointer(el, 'pointermove', 2, 195 + 80 * Math.cos(a), 422 + 80 * Math.sin(a));
    }
    pointer(el, 'pointerup', 1, 0, 0);
    pointer(el, 'pointerup', 2, 0, 0);
    settle(cam);
    expect(cam.now.yaw).toBeCloseTo(turn, 3);
    // На экране точка земли повернулась вокруг цели в ту же сторону, что пальцы (по часовой). Перспектива искажает
    // угол на экране, поэтому сверяется знак и порядок, а не градусы.
    const c1 = screenOf(cam, 0, 0);
    const p1 = screenOf(cam, -10, 0);
    const d = angle(p1, c1) - angle(p0, c0);
    expect(d).toBeGreaterThan(0.2);
  });

  it('щипок приближает во столько раз, во сколько разошлись пальцы; поворота при этом нет', () => {
    const cam = new TacticalCamera({ tx: 0, tz: 0, dist: 120, yaw: 0, pitch: 0.8 }, BOUNDS);
    cam.setAspect(W / H);
    const el = fakeCanvas();
    cam.attach(el as unknown as HTMLElement);
    pointer(el, 'pointerdown', 1, 145, 422);
    pointer(el, 'pointerdown', 2, 245, 422);
    // Пальцы расходятся и чуть-чуть поворачиваются (5°) — меньше порога поворота: жест — щипок.
    for (let k = 1; k <= 16; k++) {
      const a = (k / 16) * ((5 * Math.PI) / 180);
      const r = 50 + k * 5;
      pointer(el, 'pointermove', 1, 195 - r * Math.cos(a), 422 - r * Math.sin(a));
      pointer(el, 'pointermove', 2, 195 + r * Math.cos(a), 422 + r * Math.sin(a));
    }
    pointer(el, 'pointerup', 1, 0, 0);
    pointer(el, 'pointerup', 2, 0, 0);
    settle(cam);
    expect(cam.now.dist).toBeCloseTo(120 / 2.6, 0);
    expect(cam.now.yaw).toBe(0);
  });
});
