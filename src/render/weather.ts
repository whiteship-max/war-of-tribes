// Погода: снег над поселением и дым от костра и труб. Обе системы — точки, без новой
// геометрии зданий: дым над работающей кузницей идёт теми же клубами, что над очагом.
import * as THREE from 'three';
import { WORLD_RADIUS, groundHeight } from './terrain';
import { PALETTE } from './palette';

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
      color: PALETTE.snowflake,
      size: 0.13,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
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
      // За стеной земля с рельефом: снежинка должна дойти до неё, а не пропасть под холмом.
      if (pos[i * 3 + 1] < groundHeight(pos[i * 3], pos[i * 3 + 2])) this.reset(pos, i, SNOW_TOP);
    }
    attr.needsUpdate = true;
  }
}

/** Клубов над костром и над одной трубой. Костру больше: он в центре кадра. */
const FIRE_PUFFS = 26;
const CHIMNEY_PUFFS = 9;
const FIRE_TOP = 5.5;
const CHIMNEY_TOP = 3.2;

/** Труба: откуда идёт дым и насколько высоко. Костёр — такой же источник. */
export interface SmokeSource {
  x: number;
  y: number;
  z: number;
  puffs: number;
  top: number;
}

export const fireSmoke = (): SmokeSource => ({ x: 0, y: 0.8, z: 0, puffs: FIRE_PUFFS, top: FIRE_TOP });

/**
 * Настройка облака. Дым очага и дым труб — две системы, а не одна: у очага он
 * редкий и еле заметный, у трубы обязан читаться признаком работы с высоты
 * стартовой камеры. Размер и плотность у точек задаются материалом, то есть
 * одни на всё облако, — поэтому и систем две. Вторая стоит один вызов.
 */
export interface SmokeLook {
  size: number;
  opacity: number;
  /**
   * Снос ветром: насколько клуб уходит вбок на единицу подъёма, по осям мира. Нет — дым
   * встаёт столбом (прежние системы).
   */
  drift?: { x: number; z: number };
}

export const FIRE_LOOK: SmokeLook = { size: 0.3, opacity: 0.12 };
export const CHIMNEY_LOOK: SmokeLook = { size: 0.5, opacity: 0.3 };
/**
 * Дым очагов над трубами домов (вид `next`): живой посёлок, а не признак работы. Реже,
 * тоньше и прозрачнее дыма работы (`CHIMNEY_LOOK`) — тот остаётся знаком, что двор
 * работает, и спутать их нельзя. Сносится ветром.
 */
export const HEARTH_LOOK: SmokeLook = { size: 0.34, opacity: 0.16, drift: { x: 0.42, z: -0.18 } };

/** Дым очага: над трубой дома, невысокий. */
export const hearthSmoke = (x: number, y: number, z: number): SmokeSource => ({ x, y, z, puffs: 5, top: 1.8 });

export const chimneySmoke = (x: number, y: number, z: number): SmokeSource => ({
  x,
  y,
  z,
  puffs: CHIMNEY_PUFFS,
  top: CHIMNEY_TOP,
});

/**
 * Дым: над костром и над трубами работающих зданий. Все клубы — одна система
 * точек, поэтому дым над кузницей не стоит ни одного лишнего вызова отрисовки.
 * Зимой гуще и заметнее — очаг топят сильнее.
 */
export class Smoke {
  readonly points: THREE.Points;
  private material: THREE.PointsMaterial;
  private phase = new Float32Array(0);
  /** К какому источнику относится клуб. */
  private owner: SmokeSource[] = [];
  private sources: SmokeSource[] = [];

  constructor(private look: SmokeLook = FIRE_LOOK, sources: SmokeSource[] = [fireSmoke()]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.material = new THREE.PointsMaterial({
      color: PALETTE.smoke,
      size: look.size,
      transparent: true,
      opacity: look.opacity,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.setSources(sources);
  }

  /**
   * Список труб. Пересобирает буфер, поэтому зовётся из sync — когда меняется
   * набор работающих зданий, — а не каждый кадр.
   */
  setSources(sources: SmokeSource[]): void {
    const same =
      sources.length === this.sources.length &&
      sources.every((s, i) => {
        const o = this.sources[i];
        return o.x === s.x && o.y === s.y && o.z === s.z && o.puffs === s.puffs;
      });
    if (same) return;
    this.sources = sources;
    this.owner = [];
    for (const src of sources) for (let i = 0; i < src.puffs; i++) this.owner.push(src);
    const n = this.owner.length;
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) this.phase[i] = i / Math.max(1, n);
    this.points.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points.geometry = geo;
    this.points.visible = n > 0;
  }

  /** Есть ли что рисовать: по этому сцена гасит и зажигает облако в силуэте. */
  get active(): boolean {
    return this.owner.length > 0;
  }

  update(dt: number, snow: number): void {
    // Зимой гуще: очаг топят сильнее, и это видно.
    this.material.opacity = this.look.opacity + snow * 0.34;
    this.material.size = this.look.size + snow * 0.28;
    const attr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    if (!attr) return;
    const pos = attr.array as Float32Array;
    const speed = 0.16 + snow * 0.06;
    for (let i = 0; i < this.owner.length; i++) {
      const src = this.owner[i];
      this.phase[i] = (this.phase[i] + dt * speed) % 1;
      const p = this.phase[i];
      // Клуб расходится тем шире, чем выше поднялся.
      const spread = 0.15 + p * (0.9 + snow * 0.5) * (src.top / FIRE_TOP);
      const a = i * 2.399 + p * 2.2;
      const drift = this.look.drift;
      pos[i * 3] = src.x + Math.cos(a) * spread + (drift ? drift.x * p * src.top : 0);
      pos[i * 3 + 1] = src.y + p * src.top;
      pos[i * 3 + 2] = src.z + Math.sin(a) * spread + (drift ? drift.z * p * src.top : 0);
    }
    attr.needsUpdate = true;
  }
}
