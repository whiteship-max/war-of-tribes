// Сценки жителей вблизи — вид (docs/city_v3.md, ЖГ-2). Свой ленивый кусок (`vite.config.ts`, `LAZY_DOORS`, «город: сценки»):
// сцена тянет его вместе с суетой после первого кадра города, в первую загрузку и в кусок города он не едет.
//
// Что играет и где — режиссёр (`skits.SkitDirector`), позы — каталог (`skits.SKITS`); здесь — только меши: по одному
// экземплярному на вид фигуры (три вида горожан, стражник, скотина, телега) и на вещи (коробка в размер вещи). Пустой меш не
// рисуется — издали сценок нет ни одного вызова. Звук каждой сценки — по месту: громче ближе к камере, слева или справа
// по экрану (`sound/ear.hearSkits`).
import * as THREE from 'three';
import type { Quality } from '../quality';
import { hearSkits, type HeardSkit } from '@/sound/ear';
import { loadedIn } from '@/world/cache';
import { useWorld } from '@/world/store';
import { heightAt, type CityPlan } from './layout';
import { figure, figureLod, figureMaterial, gaitOf, guardGeometry, beastGeometry, townsGeometry, type Townsfolk } from './life';
import { cartGeometry } from './alive';
import { linear } from './palette';
import { hash3 } from './noise';
import type { Site } from './sites';
import { SKIT_FIGURES } from './spec';
import type { V3 } from './geom';
import {
  LAIR_NEAR,
  SKIT_ZOOM,
  SKIT_ZOOM_OFF,
  SkitDirector,
  placeOf,
  posesFor,
  seededRnd,
  skitWorld,
  slotsOf,
  type Fig,
  type Pose,
  type SkitCtx,
  type SkitId,
} from './skits';

/** Звук сценки слышен целиком ближе стольких метров от камеры и смолкает к дальнему. */
export const SKIT_HEAR = { near: 45, far: 150 } as const;

const DRESS = [0x7a4a3a, 0x5a6a7a, 0x8a7a5a, 0x6a5a4a, 0x9a8a6a, 0x4a5a3a, 0x8a5a5a, 0x5a4a6a, 0xa09070, 0x6a6a5a];
const SECOND = [0x6a5a48, 0x4a5a72, 0x7a3a30, 0x5a4a38, 0x4a5a3a, 0x8a7a60, 0xe8e0cc, 0xd8cfb8];
const SKINS = [0xe0b494, 0xd4a07e, 0xc79a7a, 0xb88462, 0xa87252, 0x8e5e40];
/** Сюрко стражи — червлень города. */
const TABARD = 0x8a2f2a;

const FIGS: readonly Fig[] = ['hood', 'cap', 'woman', 'guard', 'beast', 'cart', 'prop'];

interface Lane {
  im: THREE.InstancedMesh;
  gait: THREE.InstancedBufferAttribute;
  cloth2: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  n: number;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler(0, 0, 0, 'YZX');
const S = new THREE.Vector3();
const T = new THREE.Vector3();
const C = new THREE.Color();
const V = new THREE.Vector3();

const setLinear = (arr: Float32Array, k: number, hex: number): void => {
  const v: V3 = linear(hex);
  arr[k * 3] = v[0];
  arr[k * 3 + 1] = v[1];
  arr[k * 3 + 2] = v[2];
};

export interface SkitsInput {
  plan: CityPlan;
  sites: readonly Site[];
  quality: Quality;
}

/** Что кадр знает о минуте: распорядок, состояние города, погода, зима — сценкам (`SkitCtx` без логова: его ищет вид сам). */
export type SkitMinute = Omit<SkitCtx, 'lair'>;

export class CitySkits {
  readonly group = new THREE.Group();
  readonly director: SkitDirector;
  private lanes = new Map<Fig, Lane>();
  private poses = new Map<SkitId, Pose[]>();
  private shown = false;
  private lair = false;
  private lairAt = -Infinity;
  private heard: HeardSkit[] = [];

  constructor(input: SkitsInput) {
    this.group.name = 'city-skits';
    const q = input.quality;
    const slots = slotsOf(q);
    this.director = new SkitDirector(skitWorld(input.plan, input.sites), slots, seededRnd((hash3(17, 29, 31) ^ 0x51ce) >>> 0));
    const lod = figureLod(q);
    const mat = figureMaterial();
    const cap = slots * SKIT_FIGURES;
    const prop = figure([{ x: 0, y0: 0, y1: 1, hw: 0.5, hd: 0.5, col: [1, 1, 1], tint: 1 }]);
    const geo: Record<Fig, () => THREE.BufferGeometry> = {
      hood: () => townsGeometry('hood' as Townsfolk, lod),
      cap: () => townsGeometry('cap', lod),
      woman: () => townsGeometry('woman', lod),
      guard: () => guardGeometry(lod),
      beast: () => beastGeometry(lod === 0),
      cart: () => cartGeometry(),
      prop: () => prop,
    };
    for (const f of FIGS) {
      const g = geo[f]();
      const im = new THREE.InstancedMesh(g, mat, f === 'cart' ? slots : cap);
      im.name = `city-skits-${f}`;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, C.setRGB(1, 1, 1));
      const n = im.instanceMatrix.count;
      const cloth2 = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const skin = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      g.setAttribute('cloth2', cloth2);
      g.setAttribute('skinTone', skin);
      im.count = 0;
      im.visible = false;
      this.lanes.set(f, { im, gait: gaitOf(im), cloth2, skin, n: 0 });
      this.group.add(im);
    }
  }

  /** Сторож плавности опустил уровень — сценок меньше сразу. */
  setLevel(q: Quality): void {
    this.director.setSlots(Math.min(this.director.active.length, slotsOf(q)));
  }

  /** Разведанное логово разбойников рядом с городом (кэш карты, `world/cache`): раз в пять секунд. */
  private lairNear(t: number): boolean {
    if (t - this.lairAt < 5) return this.lair;
    this.lairAt = t;
    const home = useWorld.getState().info?.home;
    if (!home) return (this.lair = false);
    const r = LAIR_NEAR;
    this.lair = loadedIn({ x: home.x - r, y: home.y - r, w: 2 * r + 1, h: 2 * r + 1 }).some((c) =>
      c.settlements.some((s) => s.relation === 'barbarian' && Math.hypot(s.x - home.x, s.y - home.y) <= r),
    );
    return this.lair;
  }

  /**
   * Кадр: `share` — доля приближения камеры (`camera.zoomShare`), `inside` — вид из покоев (сценок нет), `eye` — точка
   * взгляда на земле.
   */
  update(t: number, camera: THREE.Camera, eye: { x: number; z: number }, share: number, inside: boolean, minute: SkitMinute, lair?: boolean): void {
    this.shown = !inside && share >= (this.shown ? SKIT_ZOOM_OFF : SKIT_ZOOM);
    const ctx: SkitCtx = { ...minute, lair: lair ?? this.lairNear(t) };
    this.director.update(t, eye, { x: camera.position.x, z: camera.position.z }, this.shown, ctx);
    for (const l of this.lanes.values()) l.n = 0;
    this.heard.length = 0;
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse;
    for (let k = 0; k < this.director.active.length; k++) {
      const a = this.director.active[k];
      if (!a) continue;
      let poses = this.poses.get(a.def.id);
      if (!poses) this.poses.set(a.def.id, (poses = posesFor(a.def)));
      const lt = Math.max(0, t - a.t0);
      a.def.pose(lt, a.len, a.r, poses);
      for (let i = 0; i < poses.length; i++) {
        const p = poses[i];
        if (p.hide) continue;
        const cast = a.def.cast[i];
        const lane = this.lanes.get(cast.fig)!;
        if (lane.n >= lane.im.instanceMatrix.count) continue;
        const at = placeOf(a, lt, p);
        T.set(at.x, at.y + p.y, at.z);
        E.set(p.roll, at.yaw, -p.lean);
        Q.setFromEuler(E);
        const b = cast.box;
        const sc = cast.scale ?? 1;
        if (b) S.set(b[2], b[1], b[0]);
        else S.set(sc, sc, sc);
        M.compose(T, Q, S);
        const j = lane.n++;
        lane.im.setMatrixAt(j, M);
        lane.gait.setXY(j, p.walk, p.amp);
        // Одежда: своя у роли (вдова в чёрном, монах в буром), иначе — от номера сценки и актёра.
        const salt = Math.floor(a.r * 997);
        const dress = cast.color ?? (cast.fig === 'guard' ? TABARD : DRESS[hash3(salt, i, 3) % DRESS.length]);
        const dv = linear(dress);
        lane.im.setColorAt(j, C.setRGB(dv[0], dv[1], dv[2]));
        setLinear(lane.cloth2.array as Float32Array, j, cast.second ?? SECOND[hash3(salt, i, 5) % SECOND.length]);
        setLinear(lane.skin.array as Float32Array, j, SKINS[hash3(salt, i, 7) % SKINS.length]);
      }
      // Звук: ближе к камере — громче; панорама — где сценка на экране.
      const c = this.director.centerOf(a, t);
      V.set(c.x, heightAt(c.x, c.z) + 1.5, c.z);
      const d = V.distanceTo(camera.position);
      const gain = Math.min(1, Math.max(0, (SKIT_HEAR.far - d) / (SKIT_HEAR.far - SKIT_HEAR.near)));
      V.applyMatrix4(view);
      const pan = Math.max(-0.85, Math.min(0.85, V.x / Math.max(1, -V.z * 0.6)));
      if (gain > 0) this.heard.push({ id: a.def.id, gain, pan, k: Math.min(1, lt / a.len) });
    }
    for (const l of this.lanes.values()) {
      l.im.count = l.n;
      l.im.visible = l.n > 0;
      if (l.n === 0) continue;
      l.im.instanceMatrix.needsUpdate = true;
      if (l.im.instanceColor) l.im.instanceColor.needsUpdate = true;
      l.gait.needsUpdate = true;
      l.cloth2.needsUpdate = true;
      l.skin.needsUpdate = true;
    }
    hearSkits(this.heard);
  }

  /** Сколько фигур и вещей нарисовано этим кадром — тестам и стенду. */
  drawn(): number {
    let n = 0;
    for (const l of this.lanes.values()) n += l.n;
    return n;
  }

  dispose(): void {
    hearSkits([]);
    const mats = new Set<THREE.Material>();
    for (const l of this.lanes.values()) {
      l.im.geometry.dispose();
      mats.add(l.im.material as THREE.Material);
      l.im.dispose();
    }
    for (const m of mats) m.dispose();
    this.group.clear();
  }
}
