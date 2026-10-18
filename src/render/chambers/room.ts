// Покои правителя (docs/city_v3.md, Г-4): комната, глаз и руки. Вид изнутри сцены города (`city/inside.ts`): сцена
// города рисует комнату и город за окнами в своём кадре, а здесь — что видит глаз этим кадром.
//
//   · глаз стоит в точках интереса (`plan.POIS`) и переходит между ними касанием — свободной ходьбы нет; голову
//     поворачивает перетаскивание в пределах точки, у окна щипок и колесо смотрят вдаль;
//   · предметы стола открывают окна игры (`onUse`), безделушки берутся в руки и крутятся пальцем — механики у них нет;
//   · свет — огонь камина и свечи (ночью), небо и солнце из окон города этого кадра, погода та же.
//
// Палец судит общий судья (`src/gestures.ts`): тап это или ведение — решает он, второй правды нет.
import * as THREE from 'three';
import type { Inside, InsideSky } from '../city/inside';
import type { Tower } from '../city/layout';
import type { Quality } from '../quality';
import type { Detail } from '../city/kit';
import type { Arms } from '@/heraldry/arms';
import { Gesture, TAP_TARGET, swallowGhostClick } from '@/gestures';
import { geometryOf } from '../city/index';
import { buildRoom, ROOM_LIGHTS, type RoomModel } from './build';
import { LIGHTS_AT, roomMaterial, roomUniforms, type RoomUniforms } from './material';
import { RoomFire } from './fire';
import { ATLAS_PX, paintAtlas } from './paint';
import type { ChambersEar } from './sound';
import {
  DESK_THINGS,
  HEARTH,
  POIS,
  POI_BY_ID,
  THINGS,
  TRINKETS,
  clampLook,
  fitFov,
  floorOf,
  isTrinket,
  lookDir,
  moveSeconds,
  wrap,
  type Box,
  type Door,
  type Poi,
  type PoiId,
  type Pose,
  type Thing,
  type ThingId,
  type Trinket,
  type TrinketId,
} from './plan';

/** Мелочь модели по уровню (`city/kit.Detail`). */
const DETAIL: Record<Quality, Detail> = { low: 0, medium: 1, high: 2 };

/** Что видит слой интерфейса покоев: где глаз, идёт ли, что в руках, готово ли. */
export interface ChambersView {
  poi: PoiId;
  moving: boolean;
  held: TrinketId | null;
  /** Поле зрения у окна: доля приближения 0 (как стоит) … 1 (вдаль); `null` — не у окна. */
  zoom: number | null;
}

/** Что под пальцем: предмет или точка интереса. */
type Aim = { kind: 'thing'; thing: Thing } | { kind: 'poi'; poi: Poi };

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const RAY = new THREE.Ray();
const BOX = new THREE.Box3();
const C = new THREE.Color();
const HOLD = new THREE.Quaternion();
const REST = new THREE.Quaternion();
const BASE = new THREE.Quaternion();
const POS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const ZERO = new THREE.Vector3();

/** Свет огня камина и свечей (линейный, × сила лампы `ROOM_LIGHTS.power`). */
const FIRE = new THREE.Color(1.0, 0.42, 0.13).multiplyScalar(5.0);
const CANDLE = new THREE.Color(1.0, 0.6, 0.27).multiplyScalar(2.2);
/** Отражённый свет дня от пола, дерева и камня — тёплый. */
const BOUNCE = new THREE.Color(0.16, 0.12, 0.085);

/** Покои: комната, её свет и глаз. Ставит их сцена города (`CityScene.enterInside`), рисует — в своём кадре. */
export class ChambersRoom implements Inside {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  /** Начало комнаты в мире: середина пола верхнего яруса донжона. */
  readonly origin: THREE.Vector3;
  private u: RoomUniforms;
  private level: Quality;
  private model: RoomModel;
  private stone: THREE.ShaderMaterial;
  private cloth: THREE.ShaderMaterial;
  private atlas: THREE.CanvasTexture;
  private fire: RoomFire;
  private handFire: RoomFire;
  private trinkets = new Map<TrinketId, { mesh: THREE.Mesh; rest: THREE.Vector3; restYaw: number }>();
  private meshes: THREE.Mesh[] = [];
  private cityTex: () => THREE.Texture | null;

  // Глаз.
  private poi: Poi = POI_BY_ID.hall;
  private pose: Pose = { ...POI_BY_ID.hall.pose };
  private walk: { from: Pose; to: Pose; t: number; dur: number; then: (() => void) | null } | null = null;
  private vel = { yaw: 0, pitch: 0 };
  private zoomFov: number | null = null;
  private time = 0;

  // Палец.
  private touch = new Gesture();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: number | null = null;
  private aimed: Aim | null = null;
  private hover: Thing | null = null;
  private rect: { left: number; top: number; width: number; height: number } = { left: 0, top: 0, width: 1, height: 1 };

  // Руки.
  private held: { id: TrinketId; t: number; dir: 1 | -1; yaw: number; pitch: number } | null = null;

  // Подписи.
  private labelHost: HTMLElement | null = null;
  private label: HTMLDivElement | null = null;
  private tags: HTMLDivElement[] = [];
  private tagsUntil = 0;

  /** Интерфейс: переменилось то, что он показывает (`view`). */
  onChange: (() => void) | null = null;
  /** Предмет стола тронут там, где до него дотянуться: открыть окно игры. */
  onUse: ((door: Door, id: ThingId) => void) | null = null;
  /** Ухо: где глаз (до огня, с какой он стороны, до окна) и погода у окна — звуку покоев (`sound.ts`). */
  onEar: ((ear: ChambersEar, dt: number) => void) | null = null;

  constructor(keep: Pick<Tower, 'x' | 'z' | 'base' | 'height'>, arms: Arms, quality: Quality, cityTex: () => THREE.Texture | null) {
    this.level = quality;
    this.cityTex = cityTex;
    this.origin = new THREE.Vector3(keep.x, floorOf(keep), keep.z);
    this.u = roomUniforms();
    this.u.uOrigin.value.copy(this.origin);
    this.model = buildRoom(DETAIL[quality]);
    const canvas = paintAtlas(arms, quality === 'low' ? ATLAS_PX / 2 : ATLAS_PX);
    this.atlas = new THREE.CanvasTexture(canvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.anisotropy = quality === 'low' ? 1 : 4;
    this.u.atlas.value = this.atlas;
    this.u.cityTex.value = cityTex();
    const lights = LIGHTS_AT[quality];
    this.stone = roomMaterial(this.u, lights, false, quality !== 'low');
    this.cloth = roomMaterial(this.u, lights, true, quality !== 'low');
    this.add(geometryOf(this.model.stone.b), this.stone, 'chambers-stone');
    this.add(geometryOf(this.model.cloth.b), this.cloth, 'chambers-cloth');
    for (const t of TRINKETS) {
      const m = this.model.trinkets[t.id];
      const mesh = this.add(geometryOf(m.stone.b), this.stone, `chambers-${t.id}`);
      const rest = new THREE.Vector3(m.at[0], m.at[1], m.at[2]).add(this.origin);
      mesh.position.copy(rest);
      mesh.rotation.y = m.yaw;
      this.trinkets.set(t.id, { mesh, rest, restYaw: m.yaw });
    }
    this.fire = new RoomFire(this.model.flames, this.u, quality);
    this.fire.mesh.position.copy(this.origin);
    this.scene.add(this.fire.mesh);
    // Пламя свечи в руке — с безделушкой.
    this.handFire = new RoomFire(this.model.flames, this.u, quality, true);
    this.handFire.mesh.position.set(0, 0.34, 0);
    this.trinkets.get('candle')?.mesh.add(this.handFire.mesh);
    this.camera.near = 0.05;
    this.placeCamera(this.pose);
  }

  private add(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.position.copy(this.origin);
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  // ---------- Что видит интерфейс ----------

  view(): ChambersView {
    const z = this.poi.zoom;
    return {
      poi: this.poi.id,
      moving: this.walk !== null,
      held: this.held && this.held.dir > 0 ? this.held.id : null,
      zoom: z && this.zoomFov !== null ? (fitFov(z[1], this.camera.aspect) - this.zoomFov) / (fitFov(z[1], this.camera.aspect) - z[0]) : z ? 0 : null,
    };
  }

  private changed(): void {
    this.onChange?.();
  }

  /** Подписи — в слой интерфейса: подпись предмета под пальцем и, когда сел за стол, имена предметов на миг. */
  attachLabels(host: HTMLElement | null): void {
    this.label?.remove();
    for (const t of this.tags) t.remove();
    this.tags = [];
    this.label = null;
    this.labelHost = host;
    if (!host) return;
    const l = document.createElement('div');
    l.className = 'ch-label';
    l.style.visibility = 'hidden';
    host.appendChild(l);
    this.label = l;
    for (const t of DESK_THINGS) {
      const el = document.createElement('div');
      el.className = 'ch-tag';
      el.textContent = t.name;
      el.style.visibility = 'hidden';
      host.appendChild(el);
      this.tags.push(el);
    }
  }

  // ---------- Глаз ----------

  /** Перейти к точке интереса; `then` — что сделать по приходе (взять предмет). */
  go(id: PoiId, then: (() => void) | null = null): void {
    const to = POI_BY_ID[id];
    if (this.held) this.drop();
    if (to.id === this.poi.id && !this.walk) {
      then?.();
      return;
    }
    const from = { ...this.pose };
    this.poi = to;
    this.zoomFov = null;
    this.vel = { yaw: 0, pitch: 0 };
    this.walk = { from, to: { ...to.pose }, t: 0, dur: moveSeconds(from, to.pose), then };
    this.changed();
  }

  /**
   * Стенду снимков (`scripts/city-shots.ts`, `CHAMBERS=`): встать в точку сразу, без перехода, повернуть голову от её
   * взгляда и, если надо, взять безделушку уже в руку. Игроку этот рычаг не достаётся: в игре — только `go` и `take`.
   */
  snap(id: PoiId, dyaw = 0, dpitch = 0, hold: TrinketId | null = null): void {
    this.poi = POI_BY_ID[id];
    this.walk = null;
    this.zoomFov = null;
    this.pose = { ...this.poi.pose };
    this.turn(dyaw, dpitch);
    this.held = hold ? { id: hold, t: 1, dir: 1, yaw: 0, pitch: 0 } : null;
    this.placeCamera(this.pose);
    this.stepHands(0);
    this.changed();
  }

  /** Приближение у окна: шаг ±1 (кнопка) или множитель щипка. */
  zoomBy(k: number): void {
    const z = this.poi.zoom;
    if (!z || this.walk) return;
    const wide = fitFov(z[1], this.camera.aspect);
    const cur = this.zoomFov ?? wide;
    this.zoomFov = Math.min(wide, Math.max(z[0], cur / k));
    this.changed();
  }

  /** Камера по позе: место — от начала комнаты, взгляд — поворотом головы, поле зрения — с приближением. */
  private placeCamera(p: Pose): void {
    const sway = this.held ? 0 : 1;
    const br = Math.sin(this.time * 1.1) * 0.006 * sway;
    this.camera.position.set(this.origin.x + p.x, this.origin.y + p.y + br * (this.poi.id === 'bed' ? 0.4 : 1), this.origin.z + p.z);
    const d = lookDir(p.yaw + Math.sin(this.time * 0.37) * 0.004 * sway, p.pitch + br * 0.2);
    V.set(this.camera.position.x + d.x, this.camera.position.y + d.y, this.camera.position.z + d.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(V);
    const fov = this.zoomFov ?? fitFov(p.fov, this.camera.aspect);
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  // ---------- Кадр ----------

  frame(dt: number, t: number, sky: InsideSky): void {
    this.time = t;
    this.stepEye(dt);
    this.stepHands(dt);
    this.light(t, sky);
    this.placeCamera(this.pose);
    this.labels();
    if (this.onEar) {
      // Ухо: до огня и с какой он стороны, до большого окна; ветер и дождь — у окна этого кадра.
      const e = this.pose;
      const f = HEARTH.fire;
      const fx = f.x - e.x;
      const fz = f.z - e.z;
      const fd = Math.hypot(fx, fz) || 1;
      V.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.onEar({ fire: Math.hypot(fx, f.y - e.y, fz), firePan: (fx * V.x + fz * V.z) / fd, window: Math.hypot(e.x, e.y - 1.8, e.z - 6.1), wind: sky.wind, rain: Math.max(sky.rain, sky.snow * 0.3) }, dt);
    }
  }

  private stepEye(dt: number): void {
    const m = this.walk;
    if (m) {
      m.t = Math.min(1, m.t + dt / m.dur);
      const k = m.t * m.t * m.t * (m.t * (m.t * 6 - 15) + 10);
      const a = m.from;
      const b = m.to;
      // Дуга вверх посередине пути — шаг, а не скольжение (у кровати — ложится).
      const lift = Math.sin(Math.PI * m.t) * 0.05;
      this.pose = {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k + lift,
        z: a.z + (b.z - a.z) * k,
        yaw: a.yaw + wrap(b.yaw - a.yaw) * k,
        pitch: a.pitch + (b.pitch - a.pitch) * k,
        fov: a.fov + (b.fov - a.fov) * k,
      };
      if (m.t >= 1) {
        this.walk = null;
        this.pose = { ...b };
        if (this.poi.id === 'desk') this.tagsUntil = this.time + 3.2;
        this.changed();
        m.then?.();
      }
      return;
    }
    // Инерция головы после ведения пальцем.
    if (Math.abs(this.vel.yaw) + Math.abs(this.vel.pitch) > 1e-4 && this.pointers.size === 0) {
      this.turn(this.vel.yaw * dt, this.vel.pitch * dt);
      const keep = Math.exp(-dt * 6);
      this.vel.yaw *= keep;
      this.vel.pitch *= keep;
    }
  }

  private turn(dyaw: number, dpitch: number): void {
    const c = clampLook(this.poi, this.pose.yaw + dyaw, this.pose.pitch + dpitch);
    this.pose.yaw = c.yaw;
    this.pose.pitch = c.pitch;
  }

  /** Свет кадра: огонь дышит, свечи горят ночью, небо и солнце — из города. */
  private light(t: number, sky: InsideSky): void {
    const u = this.u;
    u.uTime.value = t;
    const tex = this.cityTex();
    if (tex && u.cityTex.value !== tex) u.cityTex.value = tex;
    const flick = 0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.3) + 0.08 * Math.sin(t * 17.0 + Math.sin(t * 2.0) * 3.0);
    const lit = Math.min(1, Math.max(0, (sky.night - 0.12) / 0.3));
    const cols = u.uLightCol.value;
    const pos = u.uLight.value;
    ROOM_LIGHTS.forEach((l, i) => {
      if (i === 0) cols[0].copy(FIRE).multiplyScalar(flick);
      else cols[i].copy(CANDLE).multiplyScalar(lit * (0.92 + 0.08 * Math.sin(t * (9 + i) + i * 3.1)));
      pos[i].w = l.power;
    });
    // Свеча в руке светит оттуда, где она сейчас.
    const c = this.trinkets.get('candle');
    if (c) {
      c.mesh.updateMatrixWorld();
      V.set(0, 0.34, 0).applyMatrix4(c.mesh.matrixWorld).sub(this.origin);
      pos[2].set(V.x, V.y, V.z, ROOM_LIGHTS[2].power);
    }
    // Небо в окнах: цвет фона города, днём ярче; вспышка молнии — в нём же.
    u.uSky.value.copy(sky.sky).multiplyScalar(1.3 + 1.2 * sky.daylight).add(C.copy(sky.hemi).multiplyScalar(0.12));
    u.uSunDir.value.copy(sky.sunDir);
    u.uSun.value.copy(sky.sun).multiplyScalar(0.85);
    // Отражённый свет: днём комната светла и в углах — окна отдают небо, пол и дерево возвращают его тёплым.
    u.uAmb.value
      .setRGB(0.012, 0.01, 0.009)
      .add(C.copy(FIRE).multiplyScalar(0.006 * flick))
      .add(C.copy(u.uSky.value).multiplyScalar(0.03 + 0.05 * sky.daylight))
      .add(C.copy(BOUNCE).multiplyScalar(sky.daylight))
      .add(C.copy(CANDLE).multiplyScalar(0.008 * lit));
    const sel = this.hover && (!this.held || this.hover.id === this.held.id) ? this.hover.code : 0;
    u.uSel.value = sel;
    u.uSelGlow.value = 0.65 + Math.sin(t * 4) * 0.25;
    const sunLum = sky.sun.r * 0.3 + sky.sun.g * 0.6 + sky.sun.b * 0.1;
    this.fire.update(t, lit, Math.min(1, sunLum / 2.2) * (1 - sky.night));
    this.handFire.update(t, Math.max(lit, this.held?.id === 'candle' ? 1 : 0), 0);
  }

  // ---------- Руки ----------

  /** Взять безделушку: подлетает к глазу, палец крутит её вместо головы. */
  take(id: TrinketId): void {
    if (this.held?.id === id && this.held.dir > 0) return;
    if (this.held) this.drop();
    this.held = { id, t: 0, dir: 1, yaw: 0, pitch: 0 };
    this.hover = null;
    this.changed();
  }

  /** Положить на место. */
  drop(): void {
    if (!this.held) return;
    this.held.dir = -1;
    this.changed();
  }

  private stepHands(dt: number): void {
    const h = this.held;
    if (!h) return;
    const tr = this.trinkets.get(h.id);
    if (!tr) return;
    h.t = Math.min(1, Math.max(0, h.t + (dt / 0.55) * h.dir));
    const k = h.t * h.t * (3 - 2 * h.t);
    const thing = TRINKETS.find((x) => x.id === h.id)!;
    const cam = this.camera;
    // Как держать: поворот пальцем поверх положения предмета в руке (`base`), в осях глаза.
    E.set(h.pitch, h.yaw, 0, 'YXZ');
    Q.setFromEuler(E);
    HOLD.copy(cam.quaternion).multiply(Q).multiply(this.base(thing));
    REST.setFromAxisAngle(UP, tr.restYaw);
    tr.mesh.quaternion.copy(REST).slerp(HOLD, k);
    // Рука: середина предмета — на оси взгляда, чуть ниже середины кадра.
    cam.getWorldDirection(V);
    V2.copy(cam.position).addScaledVector(V, thing.hold);
    V.set(0, 1, 0).applyQuaternion(cam.quaternion);
    V2.addScaledVector(V, -0.03);
    const mid = tr.mesh.geometry.boundingSphere?.center ?? ZERO;
    V.copy(mid).applyQuaternion(tr.mesh.quaternion);
    POS.copy(tr.rest).lerp(V2.sub(V), k);
    tr.mesh.position.copy(POS);
    if (h.dir < 0 && h.t <= 0) {
      tr.mesh.position.copy(tr.rest);
      tr.mesh.quaternion.copy(REST);
      this.held = null;
      this.changed();
    }
  }

  /**
   * Предмет в руке, в осях глаза: стоймя с наклоном к глазу (видно чашу кубка и ленту короны); меч — наискось снизу слева
   * вверх направо, плоскостью клинка к глазу (у меча клинок — по оси z своих осей, плоскость — по оси x).
   */
  private base(t: Trinket): THREE.Quaternion {
    if (t.id === 'sword') {
      const z = new THREE.Vector3(0.45, 0.89, 0).normalize();
      const x = new THREE.Vector3(0, 0, 1);
      const y = new THREE.Vector3().crossVectors(z, x);
      return BASE.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    return BASE.setFromAxisAngle(RIGHT, t.tilt);
  }

  // ---------- Палец ----------

  /** Ввод — слоя интерфейса поверх холста (`ui/chambers`); координаты страницы и рамка холста. */
  down(id: number, x: number, y: number, rect: DOMRect | { left: number; top: number; width: number; height: number }): void {
    this.rect = rect;
    this.pointers.set(id, { x, y });
    this.touch.down(id, x, y, performance.now());
    this.vel = { yaw: 0, pitch: 0 };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.aimed = null;
      return;
    }
    if (!this.touch.multi) {
      this.aimed = this.pickAt(x, y);
      this.hover = this.aimed?.kind === 'thing' ? this.aimed.thing : null;
    }
  }

  move(id: number, x: number, y: number): void {
    const prev = this.pointers.get(id);
    if (!prev) return;
    const now = performance.now();
    this.pointers.set(id, { x, y });
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch && d > 0) this.zoomBy(d / this.pinch);
      this.pinch = d;
      return;
    }
    this.touch.move(id, x, y, now);
    if (!this.touch.panning(now)) return;
    // Ведение: подсветка гаснет — это не касание предмета.
    this.hover = null;
    this.aimed = null;
    const dx = x - prev.x;
    const dy = y - prev.y;
    if (this.held && this.held.dir > 0) {
      this.held.yaw += dx * 0.012;
      this.held.pitch = Math.max(-1.4, Math.min(1.4, this.held.pitch + dy * 0.012));
      return;
    }
    if (this.walk) return;
    // Земля едет за пальцем: точка под пальцем остаётся под ним (угол на пиксель — от поля зрения).
    const k = ((this.camera.fov * Math.PI) / 180) / Math.max(1, this.rect.height);
    this.turn(dx * k, dy * k);
    this.vel.yaw = (dx * k) / (1 / 60);
    this.vel.pitch = (dy * k) / (1 / 60);
    this.vel.yaw *= 0.35;
    this.vel.pitch *= 0.35;
  }

  up(id: number): void {
    const now = performance.now();
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinch = null;
    const tapped = this.touch.up(id, now);
    if (!tapped) {
      if (this.pointers.size === 0 && !this.isMouse) this.hover = null;
      return;
    }
    swallowGhostClick();
    const aim = this.aimed;
    this.aimed = null;
    if (!this.isMouse) this.hover = null;
    this.act(aim);
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinch = null;
    this.touch.cancel(id);
    this.aimed = null;
    this.hover = null;
  }

  /** Колесо мыши: у окна — вдаль и обратно. */
  wheel(dy: number): void {
    this.zoomBy(dy < 0 ? 1.12 : 1 / 1.12);
  }

  private isMouse = false;

  /** Мышь без нажатия: подсветка и подпись предмета под указателем. */
  hoverAt(x: number, y: number, rect: DOMRect | { left: number; top: number; width: number; height: number }): void {
    this.isMouse = true;
    this.rect = rect;
    if (this.pointers.size > 0) return;
    const a = this.pickAt(x, y);
    this.hover = a?.kind === 'thing' ? a.thing : null;
  }

  /** Касание: предмет у руки — дело; издали — подойти к нему; точка интереса — перейти; в руке — положить. */
  act(aim: Aim | null): void {
    if (this.held && this.held.dir > 0) {
      if (!aim || aim.kind !== 'thing' || aim.thing.id !== this.held.id) this.drop();
      return;
    }
    if (!aim) return;
    if (aim.kind === 'poi') {
      this.go(aim.poi.id);
      return;
    }
    const t = aim.thing;
    if (this.poi.id !== t.poi || this.walk) {
      this.go(t.poi);
      return;
    }
    if (isTrinket(t)) {
      this.take(t.id);
      return;
    }
    const desk = DESK_THINGS.find((x) => x.id === t.id);
    if (desk) this.onUse?.(desk.door, desk.id);
  }

  /** Касание по предмету или точке: луч из глаза; мелкое раздувается до пальца на экране (`TAP_TARGET`). */
  pickAt(x: number, y: number): Aim | null {
    const r = this.rect;
    if (r.width < 1 || r.height < 1) return null;
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    RAY.copy(ray.ray);
    let best: { aim: Aim; d: number; exact: boolean } | null = null;
    const consider = (aim: Aim, d: number, exact: boolean): void => {
      if (!best || (exact && !best.exact) || (exact === best.exact && d < best.d)) best = { aim, d, exact };
    };
    for (const t of THINGS) {
      const b = this.worldBox(t);
      if (!b) continue;
      const hit = RAY.intersectBox(b, V);
      if (hit) {
        consider({ kind: 'thing', thing: t }, V.distanceTo(RAY.origin), true);
        continue;
      }
      // Мелкий предмет — палец: середина на экране ближе половины цели касания.
      b.getCenter(V2);
      const sp = V2.clone().project(this.camera);
      if (sp.z > 1 || sp.z < -1) continue;
      const px = ((sp.x + 1) / 2) * r.width + r.left;
      const py = ((1 - sp.y) / 2) * r.height + r.top;
      if (Math.hypot(px - x, py - y) <= TAP_TARGET * 0.6) consider({ kind: 'thing', thing: t }, V2.distanceTo(RAY.origin) + 0.3, false);
    }
    for (const p of POIS) {
      for (const hb of p.hits) {
        BOX.min.set(hb.x0, hb.y0, hb.z0).add(this.origin);
        BOX.max.set(hb.x1, hb.y1, hb.z1).add(this.origin);
        const hit = RAY.intersectBox(BOX, V);
        // Точка интереса — позади предмета: предмет на столе берёт касание раньше стола.
        if (hit) consider({ kind: 'poi', poi: p }, V.distanceTo(RAY.origin) + 0.6, false);
      }
    }
    const found = best as { aim: Aim } | null;
    return found ? found.aim : null;
  }

  /** Коробка предмета в мире — где он сейчас (безделушка в руке — у глаза). */
  private worldBox(t: Thing): THREE.Box3 | null {
    const tr = isTrinket(t) ? this.trinkets.get(t.id) : null;
    const b = t.box;
    if (tr && isTrinket(t) && this.held?.id === t.id) {
      const s = t.size * 0.6;
      return new THREE.Box3(tr.mesh.position.clone().addScalar(-s), tr.mesh.position.clone().addScalar(s));
    }
    return new THREE.Box3(new THREE.Vector3(b.x0, b.y0, b.z0).add(this.origin), new THREE.Vector3(b.x1, b.y1, b.z1).add(this.origin));
  }

  // ---------- Подписи ----------

  private screenOf(b: Box | THREE.Box3, top = true): { x: number; y: number; on: boolean } {
    if (b instanceof THREE.Box3) {
      b.getCenter(V);
      if (top) V.y = b.max.y;
    } else V.set((b.x0 + b.x1) / 2, top ? b.y1 : (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2).add(this.origin);
    V.project(this.camera);
    const r = this.rect;
    const w = this.labelHost?.clientWidth ?? r.width;
    const h = this.labelHost?.clientHeight ?? r.height;
    return { x: ((V.x + 1) / 2) * w, y: ((1 - V.y) / 2) * h, on: V.z > -1 && V.z < 1 && Math.abs(V.x) < 1.05 && Math.abs(V.y) < 1.05 };
  }

  private labels(): void {
    const l = this.label;
    if (!l) return;
    const h = this.hover;
    if (h && !this.walk && !(this.held && this.held.dir > 0)) {
      const b = this.worldBox(h);
      const s = b ? this.screenOf(b) : { x: 0, y: 0, on: false };
      if (s.on) {
        const near = this.poi.id === h.poi;
        const text = `<b>${h.name}</b><small>${near ? h.hint : POI_BY_ID[h.poi].verb}</small>`;
        if (l.dataset.k !== `${h.id}:${near}`) {
          l.innerHTML = text;
          l.dataset.k = `${h.id}:${near}`;
        }
        l.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
        l.style.visibility = '';
      } else l.style.visibility = 'hidden';
    } else l.style.visibility = 'hidden';
    // Имена предметов стола — на миг, когда сел за стол.
    const show = this.poi.id === 'desk' && !this.walk && this.time < this.tagsUntil && !this.hover && !this.held;
    DESK_THINGS.forEach((t, i) => {
      const el = this.tags[i];
      if (!el) return;
      if (!show) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        return;
      }
      const s = this.screenOf(t.box);
      el.style.visibility = s.on ? '' : 'hidden';
      el.style.opacity = String(Math.min(1, (this.tagsUntil - this.time) / 0.6));
      el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
    });
  }

  // ---------- Уровень и уборка ----------

  /** Сторож плавности опустил уровень (`CityScene.lowerTo`): меньше ламп и плашек огня. */
  setLevel(q: Quality): void {
    const order: Quality[] = ['high', 'medium', 'low'];
    if (order.indexOf(q) <= order.indexOf(this.level)) return;
    this.level = q;
    for (const m of [this.stone, this.cloth]) {
      m.defines.LIGHTS = LIGHTS_AT[q];
      if (q === 'low') delete m.defines.FIRE_SHADOW;
      m.needsUpdate = true;
    }
    this.fire.setLevel(q);
    this.handFire.setLevel(q);
  }

  /** Треугольники и вызовы комнаты — стенду и бюджету. */
  counts(): { triangles: number; meshes: number } {
    let tris = 0;
    for (const m of this.meshes) tris += (m.geometry.index?.count ?? 0) / 3;
    return { triangles: Math.round(tris), meshes: this.meshes.length + 2 };
  }

  dispose(): void {
    this.attachLabels(null);
    for (const m of this.meshes) m.geometry.dispose();
    this.stone.dispose();
    this.cloth.dispose();
    this.atlas.dispose();
    this.fire.dispose();
    this.handFire.dispose();
    this.scene.clear();
    this.onChange = null;
    this.onUse = null;
    this.onEar = null;
  }
}
