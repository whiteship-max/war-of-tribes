// Водяное колесо лесопилки (docs/city.md, 16.4): крутится от воды мельничного ручья, у лопастей — брызги. Всё — функция
// времени сцены: угол — скорость × время, брызги — возраст капли от времени, `dt` не копится. Колесо — свой меш из той же
// модели и того же материала, что здания (`outskirts.wheelModel`, `buildingMaterial`); на «Низком» его нет — колесо стоит
// в общем меше зданий.
import * as THREE from 'three';
import type { V3 } from './geom';
import { RACE } from './layout';
import { softDot } from './life';

/** Скорость колеса, рад/с: обод (2.7 м) идёт около полутора метров в секунду — как вода в ручье. */
export const MILL_SPIN = 0.55;
/** Брызг у колеса: на выходе лопастей из воды и на входе в неё. */
export const SPLASH = 36;
/** Сколько живёт капля, с. */
const DROP_LIFE = 0.6;
const G = 9.8;

/** Колесо в мире: где ось, куда смотрит (`fx`, `fz`), радиус, уровень воды. */
export interface WheelPose {
  at: V3;
  fx: number;
  fz: number;
  R: number;
  water: number;
}

/**
 * Куда бежит вода у колеса: касательная мельничного ручья (`layout.RACE` — от отвода из реки к возврату) у ближайшей к
 * колесу точки.
 */
export function flowAt(x: number, z: number): { x: number; z: number } {
  let best = 0;
  let bd = Infinity;
  for (let k = 0; k + 1 < RACE.length; k++) {
    const mx = (RACE[k].x + RACE[k + 1].x) / 2;
    const mz = (RACE[k].z + RACE[k + 1].z) / 2;
    const d = Math.hypot(mx - x, mz - z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  const dx = RACE[best + 1].x - RACE[best].x;
  const dz = RACE[best + 1].z - RACE[best].z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

/**
 * Знак вращения: низ колеса идёт по течению. Меш поворачивается вокруг y так, что его ось x смотрит на (fx, fz), а его z
 * — против «вправо» двора, (−fz, fx); вращение на θ вокруг своей x уносит низ (y = −R) по своей z со скоростью −R·θ̇,
 * то есть в мире — по (fz, −fx)·R·θ̇.
 */
export function spinSign(p: WheelPose): number {
  const f = flowAt(p.at[0], p.at[2]);
  return Math.sign(p.fz * f.x - p.fx * f.z) || 1;
}

/** Угол колеса в миг `t` (с). */
export const wheelAngle = (p: WheelPose, t: number): number => spinSign(p) * MILL_SPIN * t;

/** Капля `i` в миг `t`: место в мире и яркость 0..1 (0 — нет). Функция времени — тот же миг, то же место. */
export function dropAt(p: WheelPose, i: number, t: number, out: V3): number {
  const life = DROP_LIFE * (0.7 + 0.3 * frac(Math.sin(i * 12.9898) * 43758.5453));
  const phase = frac(Math.sin(i * 78.233) * 12543.21);
  const age = frac(t / life + phase) * life;
  const sign = spinSign(p);
  // Где обод пересекает воду: лопасть выходит с одной стороны и входит с другой.
  const dy = p.water - p.at[1];
  const cross = Math.sqrt(Math.max(0, p.R * p.R - dy * dy));
  const exit = i % 3 !== 2;
  // Сторона выхода: низ идёт по (fz, −fx)·sign, вверх лопасть поднимается на той стороне, куда низ уходит.
  const side = (exit ? 1 : -1) * sign;
  const along = (frac(Math.sin(i * 3.17) * 9137.1) - 0.5) * 1.1;
  // Вдоль «вправо» двора — (fz, −fx); местная z меша — против него.
  const rx = p.fz * side * cross;
  const rz = -p.fx * side * cross;
  const ox = p.at[0] + p.fx * along + rx;
  const oz = p.at[2] + p.fz * along + rz;
  // Скорость: на выходе — вверх и по течению (лопасть сбрасывает воду), на входе — ниже и против течения (шлепок).
  const up = exit ? 1.9 + 1.2 * frac(Math.sin(i * 5.3) * 3313.7) : 1.0;
  const sp = exit ? 0.5 : 0.9;
  const jit = (frac(Math.sin(i * 7.1) * 711.3) - 0.5) * 0.8;
  const vx = p.fz * side * sp + p.fx * jit;
  const vz = -p.fx * side * sp + p.fz * jit;
  out[0] = ox + vx * age;
  out[1] = p.water + 0.05 + up * age - 0.5 * G * age * age;
  out[2] = oz + vz * age;
  if (out[1] < p.water) return 0;
  // Ярче в начале, гаснет к концу жизни.
  return 1 - age / life;
}

const frac = (x: number): number => x - Math.floor(x);

/** Колесо и брызги в сцене: меш колеса (тот же материал, что здания) и точки брызг. */
export class MillWheel {
  readonly group = new THREE.Group();
  private spray: THREE.Points;
  private at = new THREE.Vector3();
  private tmp: V3 = [0, 0, 0];

  constructor(
    private pose: WheelPose,
    readonly wheel: THREE.Mesh,
  ) {
    wheel.name = 'city-mill-wheel';
    wheel.position.set(pose.at[0], pose.at[1], pose.at[2]);
    wheel.rotation.order = 'YXZ';
    wheel.rotation.y = -Math.atan2(pose.fz, pose.fx);
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    this.group.add(wheel);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLASH * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPLASH * 4), 4));
    this.spray = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.45, map: softDot(), color: 0xe4eef2, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.spray.name = 'city-mill-spray';
    this.spray.frustumCulled = false;
    this.group.add(this.spray);
    this.at.set(pose.at[0], pose.at[1], pose.at[2]);
  }

  /** Кадр: угол колеса и капли — от времени `t` (с). */
  update(t: number): void {
    this.wheel.rotation.x = wheelAngle(this.pose, t);
    const pos = this.spray.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.spray.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < SPLASH; i++) {
      const a = dropAt(this.pose, i, t, this.tmp);
      pos.setXYZ(i, this.tmp[0], this.tmp[1], this.tmp[2]);
      col.setXYZW(i, 1, 1, 1, a * 0.85);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    const m = this.spray.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
    this.spray.geometry.dispose();
  }
}
