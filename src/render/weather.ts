// Дым и ветер: клубы над костром поляны предыстории и над трубами города — точки, одна система на облако,
// без новой геометрии. Снегопад и дым работы и очагов посёлка ушли вместе с посёлком (docs/city.md, «Город —
// единственный вид»); снос дыма очагов остался — это ветер мира (`HEARTH_LOOK`, `city/life.CITY_WIND`).
import * as THREE from 'three';
import { PALETTE } from './palette';

/** Клубов над костром и высота их подъёма. */
const FIRE_PUFFS = 26;
const FIRE_TOP = 5.5;

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
/**
 * Дым очагов посёлка вида `next` — посёлка нет, а его снос остался ветром мира: по нему вьются флаги и идёт
 * дым труб города (`city/life.CITY_WIND`, тест «по одному ветру»). Размер и плотность — прежние числа клуба.
 */
export const HEARTH_LOOK: SmokeLook = { size: 0.34, opacity: 0.16, drift: { x: 0.42, z: -0.18 } };

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
