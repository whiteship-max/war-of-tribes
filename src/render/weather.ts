// Погода: снег над поселением и дым от костра. Обе системы — точки, без новой геометрии зданий.
import * as THREE from 'three';
import { WORLD_RADIUS } from './terrain';

const SNOW_COUNT = 420;
const SNOW_TOP = 12;

/** Снегопад: точки падают и закручиваются, при snow = 0 система выключена целиком. */
export class Snowfall {
  readonly points: THREE.Points;
  private velocity: Float32Array;
  private material: THREE.PointsMaterial;

  constructor() {
    const positions = new Float32Array(SNOW_COUNT * 3);
    this.velocity = new Float32Array(SNOW_COUNT);
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.reset(positions, i, Math.random() * SNOW_TOP);
      this.velocity[i] = 0.7 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.13,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  private reset(pos: Float32Array, i: number, y: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (WORLD_RADIUS + 2);
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }

  update(dt: number, t: number, snow: number): void {
    this.material.opacity = snow * 0.85;
    this.points.visible = snow > 0.02;
    if (!this.points.visible) return;
    const attr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    for (let i = 0; i < SNOW_COUNT; i++) {
      pos[i * 3 + 1] -= this.velocity[i] * dt;
      // Лёгкий боковой снос, чтобы снег не падал строго вертикально.
      pos[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.35;
      if (pos[i * 3 + 1] < 0) this.reset(pos, i, SNOW_TOP);
    }
    attr.needsUpdate = true;
  }
}

const SMOKE_COUNT = 26;
const SMOKE_TOP = 5.5;

/** Дым над костром: зимой гуще и заметнее — очаг топят сильнее. */
export class Smoke {
  readonly points: THREE.Points;
  private material: THREE.PointsMaterial;
  private phase: Float32Array;

  constructor() {
    const positions = new Float32Array(SMOKE_COUNT * 3);
    this.phase = new Float32Array(SMOKE_COUNT);
    for (let i = 0; i < SMOKE_COUNT; i++) this.phase[i] = i / SMOKE_COUNT;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xd8d2c8,
      size: 0.4,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number, snow: number): void {
    this.material.opacity = 0.12 + snow * 0.34;
    this.material.size = 0.3 + snow * 0.28;
    const attr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const speed = 0.16 + snow * 0.06;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      this.phase[i] = (this.phase[i] + dt * speed) % 1;
      const p = this.phase[i];
      const y = 0.8 + p * SMOKE_TOP;
      // Клуб расходится тем шире, чем выше поднялся.
      const spread = 0.15 + p * (0.9 + snow * 0.5);
      const a = i * 2.399 + p * 2.2;
      pos[i * 3] = Math.cos(a) * spread;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * spread;
    }
    attr.needsUpdate = true;
  }
}
