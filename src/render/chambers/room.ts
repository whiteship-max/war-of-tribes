// Покои правителя (docs/city_v3.md, Г-4, Г-5): комната, глаз, тело и руки. Вид изнутри сцены города (`city/inside.ts`):
// сцена города рисует комнату и город за окнами в своём кадре, а здесь — что видит глаз этим кадром.
//
//   · по комнате ходят сами, как в промыслах (docs/minigames.md, 18.1): левая половина экрана — палец движения (вверх-вниз
//     — шаг, вбок — плавный поворот), правая — взгляд перетаскиванием; мебель и стены не проходятся (`walk.ts`);
//   · касание мебели — правитель сам подходит в обход мебели и делает дело (`acts.ts`): садится за стол, ложится, смотрит
//     в окно, греет руки у огня, берёт меч; палец движения поднимает его из дела;
//   · предметы стола открывают окна игры (`onUse`) — сидя за столом; безделушки берутся в руки и крутятся пальцем;
//   · подписи предметов стола стоят, пока предмет на экране (`tags.ts`);
//   · свет — огонь камина и свечи (ночью), небо и солнце из окон города этого кадра, погода та же.
//
// Палец судит общий разбор режима от первого лица (`prologue/controls.Sticks`) с порогами общего судьи (`src/gestures.ts`):
// тап это или ведение — решает он, второй правды нет.
import * as THREE from 'three';
import type { Inside, InsideSky } from '../city/inside';
import type { Tower } from '../city/layout';
import type { Quality } from '../quality';
import type { Detail } from '../city/kit';
import type { Arms } from '@/heraldry/arms';
import { TAP_TARGET, swallowGhostClick } from '@/gestures';
import { Keys, Sticks, mergeWalk, typing, type Walk } from '@/prologue/controls';
import { turnRate } from '@/minigames/pad';
import { geometryOf } from '../city/index';
import { treeModel } from '../city/nature';
import { tint } from '../city/geom';
import { Mesher } from './geo';
import { buildRoom, ROOM_LIGHTS, type RoomModel } from './build';
import { LIGHTS_AT, roomMaterial, roomUniforms, type RoomUniforms } from './material';
import { RoomFire } from './fire';
import { ATLAS_PX, paintAtlas } from './paint';
import { paintStone } from './stone';
import { Body, holdHand, type HandPose } from './body';
import { TURN_PER_LOOK, holdFit, holdRotation } from './hold';
import { ACTS, GRAB_AT, KNOCKS, actLength, frameAt, type Act, type Frame } from './acts';
import { ChambersLife, LIFE_CODE, type LifeCue, type LifeMemory, type Who } from './life';
import { AUTO_SPEED, BODY_R, EYE_STAND, WALK_SPEED, pathLength, pathTo, step } from './walk';
import { layoutTags, TAG_FONT, type TagOut } from './tags';
import type { ChambersEar } from './sound';
import type { ChamberCue } from './cues';
import {
  CHAIR,
  DESK,
  DOOR,
  DESK_THINGS,
  HALF,
  LABELS,
  OCCLUDERS,
  HEARTH,
  OPENINGS,
  POIS,
  POI_BY_ID,
  THINGS,
  TRINKETS,
  fitFov,
  floorOf,
  isSmall,
  isTrinket,
  lookDir,
  softFloor,
  wrap,
  type Box,
  type Door,
  type Label,
  type Poi,
  type PoiId,
  type SpotId,
  type Stand,
  type Thing,
  type ThingId,
  type Trinket,
  type TrinketId,
} from './plan';

/**
 * Дальняя плоскость камеры города изнутри, м (Г-7): за край земли города (сетка — до 1,4 км от середины, углы — до 2 км).
 * С высоты глаза в донжоне горизонт открыт, и при прежних 749 м земля кончалась на 3–4° ниже него: в полосе под горизонтом
 * было небо, а кроны дальнего леса висели в нём. Дальше дымки всё одного цвета с ней — цена только в заливке.
 */
export const INSIDE_FAR = 2300;

/** Мелочь модели по уровню (`city/kit.Detail`). */
const DETAIL: Record<Quality, Detail> = { low: 0, medium: 1, high: 2 };

/** Что делает правитель: ходит сам, идёт к месту дела, садится (встаёт), сидит в деле. */
export type Mode = 'free' | 'walk' | 'act' | 'in';

/** Звук дела (Г-6): шаг по доскам и по ковру, скрип кресла, шорох постели, звон меча, взял и положил безделушку. */
export type Cue = ChamberCue;

/** Что видит слой интерфейса покоев: что делает правитель, в каком деле, что в руках, вдаль ли у окна. */
export interface ChambersView {
  mode: Mode;
  /** Место дела, в котором правитель (или к которому идёт); `null` — ходит сам. */
  spot: SpotId | null;
  held: TrinketId | null;
  /** Поле зрения у окна: доля приближения 0 (как стоит) … 1 (вдаль); `null` — не у окна. */
  zoom: number | null;
  /** Что игрок уже делал — подписи-указатели первого входа гаснут по делу. */
  used: { walk: boolean; look: boolean; act: boolean };
  /** Кубок с вином в руке — можно выпить (Г-7). */
  drink: boolean;
}

/** Что под пальцем: предмет, место дела, человек покоев или кот (Г-7). */
export type Aim = { kind: 'thing'; thing: Thing } | { kind: 'poi'; poi: Poi } | { kind: 'folk'; who: Who } | { kind: 'cat' };

/** Имена людей покоев на подписи касания. */
export const FOLK_NAME: Record<Who, string> = { servant: 'Слуга', maid: 'Служанка', wife: 'Супруга' };

/** Куда правитель идёт и что делает, придя. */
type Then = { kind: 'spot'; id: SpotId } | { kind: 'take'; id: TrinketId };

/** Подоконник большого окна, м: на него кладут руки. */
const SILL = OPENINGS.find((o) => o.wall === 'south')!.sill;

/** Дотянуться стоя, м: от глаза по полу до середины предмета. */
export const REACH = 0.9;
/** Поле зрения стоя, градусы: как у входа Г-4. */
const FREE_FOV = 70;
/** Подпись проступает, когда вещь ближе к середине кадра этого угла, и гаснет дальше второго (радианы); за столько секунд. */
export const GAZE_IN = 0.28;
export const GAZE_OUT = 0.38;
const LABEL_FADE = 0.25;
/** Качание головы на метр пути: полшага — π (шаг 0,68 м). */
const BOB_PER_M = Math.PI / 0.68;
/** Звуки дел на их мигах (с от начала дела): сел — скрип кресла, лёг и встал — шорох постели. */
const ACT_CUES: Record<SpotId, readonly (readonly [number, Cue])[]> = {
  desk: [[1.12, 'creak']],
  bed: [
    [0.8, 'rustle'],
    [1.8, 'rustle'],
  ],
  window: [],
  hearth: [],
  arms: [],
  door: [],
};
/** Гладить кота: сколько длится, с; присесть — глаз на этой высоте. */
const PET_LEN = 4.2;
const PET_EYE = 1.02;
/** Глоток вина из кубка: длится, с; сколько вина за глоток. */
const SIP_LEN = 1.7;
const SIP = 0.34;
/** Наклон головы стоя: пределы. */
const FREE_PITCH: readonly [number, number] = [-1.2, 1.1];

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q = new THREE.Quaternion();
const BOX = new THREE.Box3();
const C = new THREE.Color();
const HOLD = new THREE.Quaternion();
const REST = new THREE.Quaternion();
const POS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Свет огня камина и свечей (линейный, × сила лампы `ROOM_LIGHTS.power`). */
const FIRE = new THREE.Color(1.0, 0.42, 0.13).multiplyScalar(5.0);
const CANDLE = new THREE.Color(1.0, 0.6, 0.27).multiplyScalar(2.2);
/** Отражённый свет дня от пола, дерева и камня — тёплый. */
const BOUNCE = new THREE.Color(0.16, 0.12, 0.085);
/** Синева зенита днём (линейная, доля яркости неба). */
const DEEP = new THREE.Color(0.2, 0.36, 0.78);

const easeInOut = (k: number): number => k * k * (3 - 2 * k);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Луч `o + t·d` и коробка: доля `t` входа (0…1 — до конца отрезка) или `null`. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box): number | null {
  let t0 = 0;
  let t1 = 1;
  for (const [o, d, lo, hi] of [
    [ox, dx, b.x0, b.x1],
    [oy, dy, b.y0, b.y1],
    [oz, dz, b.z0, b.z1],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Покои: комната, её свет, глаз и тело. Ставит их сцена города (`CityScene.enterInside`), рисует — в своём кадре. */
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
  private stoneTex: THREE.DataTexture[] = [];
  private sky: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private fire: RoomFire;
  private handFire: RoomFire;
  private body: Body;
  private trinkets = new Map<TrinketId, { mesh: THREE.Mesh; rest: THREE.Vector3; restYaw: number }>();
  private meshes: THREE.Mesh[] = [];
  private cityTex: () => THREE.Texture | null;

  // Глаз: место, поворот, наклон, поле зрения.
  private pose = { x: 0, y: EYE_STAND, z: 0, yaw: 0, pitch: 0, fov: FREE_FOV };
  private mode: Mode = 'free';
  /** Путь к месту дела и что сделать, придя. */
  private path: { pts: { x: number; z: number }[]; face: Stand; then: Then; v: number } | null = null;
  /** Дело: ключи, время, туда (1) или обратно (−1), что сделать после «обратно». */
  private act: { a: Act; t: number; dir: 1 | -1; after: Then | null; grabbed: boolean } | null = null;
  /** Поворот головы поверх дела (в деле — в его пределах; на выходе гаснет). */
  private off = { yaw: 0, pitch: 0 };
  private frameNow: Frame | null = null;
  private zoomFov: number | null = null;
  private bob = 0;
  private walkK = 0;
  private time = 0;
  private used = { walk: false, look: false, act: false };

  // Палец и клавиши.
  private sticks = new Sticks();
  private keys = new Keys();
  private presses = new Map<number, { x: number; y: number }>();
  private hover: Aim | null = null;
  private isMouse = false;
  private rect: { left: number; top: number; width: number; height: number } = { left: 0, top: 0, width: 1, height: 1 };

  // Руки.
  /** Безделушка в руке: доля пути к глазу, туда или обратно; поворот пальцем — цель и где он сейчас (плавно). */
  private held: { id: TrinketId; t: number; dir: 1 | -1; spin: number; tilt: number; spinGoal: number; tiltGoal: number } | null = null;
  /** Где держать предмет перед глазом — по полю зрения кадра (`holdFit`); считается заново, когда поле меняется. */
  private fit: { key: string; at: THREE.Vector3 } | null = null;

  // Подписи и стик.
  private labelHost: HTMLElement | null = null;
  private label: HTMLDivElement | null = null;
  private tagEls: { box: HTMLDivElement; dot: HTMLDivElement; line: HTMLDivElement }[] = [];
  /** Подписи вещей: насколько проступила (0…1) и нужна ли сейчас — плавно появляются и гаснут (Г-6). */
  private tagFade = LABELS.map(() => ({ a: 0, want: false }));
  private stickEl: HTMLDivElement | null = null;
  /** Раскладка подписей последнего кадра — тестам и стенду. */
  tagsNow: TagOut[] = [];
  private lastView = '';
  private skyLast = { night: 0, sunY: 0.6, sunX: 0 };

  /** Интерфейс: переменилось то, что он показывает (`view`). */
  onChange: (() => void) | null = null;
  /** Предмет стола тронут сидя за столом: открыть окно игры. */
  onUse: ((door: Door, id: ThingId) => void) | null = null;
  /** Звук дела: шаг по доскам или ковру, скрип кресла, шорох постели, меч и безделушка в руке (`sound.ts`, `cue`). */
  onCue: ((cue: Cue) => void) | null = null;
  /** Ухо: где глаз (до огня, с какой он стороны, до окна) и погода у окна — звуку покоев (`sound.ts`). */
  onEar: ((ear: ChambersEar, dt: number) => void) | null = null;
  /** Звук жизни покоев (Г-7): стук, дверь, шаги людей и кота, мяу, вино, музыка ночи; где звучит (оси комнаты). */
  onLifeCue: ((cue: LifeCue, at: readonly [number, number, number] | null) => void) | null = null;

  /** Жизнь покоев (Г-7): дверь, слуга, служанка, супруга, кот, клубок, вино в кубке. */
  readonly life: ChambersLife;
  /** Камере города изнутри — даль до края земли (`Inside.far`). */
  readonly far = INSIDE_FAR;
  /** Дальние деревья города со стволом, пока покои открыты: сетка сверху и своя (`attach`). */
  private trunks: { im: THREE.InstancedMesh; top: THREE.BufferGeometry; low: THREE.BufferGeometry }[] = [];
  /** Гладит кота: сколько прошло; позвал — ждёт, пока подойдёт. */
  private pet: { t: number } | null = null;
  private petWant = 0;
  /** Глоток из кубка: сколько прошло, глотнул ли. */
  private sip: { t: number; gulped: boolean } | null = null;
  private wineMesh: THREE.Mesh;
  /** Сколько секунд палец взгляда не вёл: столько — и голова сама оборачивается к собеседнику. */
  private idleLook = 0;

  constructor(keep: Pick<Tower, 'x' | 'z' | 'base' | 'height'>, arms: Arms, quality: Quality, cityTex: () => THREE.Texture | null, memory: LifeMemory = { cat: false, catSpot: null }) {
    this.level = quality;
    this.cityTex = cityTex;
    this.origin = new THREE.Vector3(keep.x, floorOf(keep), keep.z);
    this.u = roomUniforms();
    this.u.uOrigin.value.copy(this.origin);
    this.model = buildRoom(DETAIL[quality]);
    // Без страницы (тесты в узле) холста нет: атлас пуст, геометрия и касания — те же.
    const canvas = typeof document === 'undefined' ? null : paintAtlas(arms, quality === 'low' ? ATLAS_PX / 2 : ATLAS_PX);
    this.atlas = canvas ? new THREE.CanvasTexture(canvas) : (new THREE.Texture() as THREE.CanvasTexture);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.anisotropy = quality === 'low' ? 1 : 4;
    this.u.atlas.value = this.atlas;
    this.u.cityTex.value = cityTex();
    // Камень покоев (`stone.ts`): бут стен и тёсаный — рисуются здесь же, при входе.
    const mas = stoneTexture(paintStone('masonry', quality === 'low' ? 512 : 1024), quality === 'low' ? 512 : 1024, quality);
    const dre = stoneTexture(paintStone('dressed', 512), 512, quality);
    this.stoneTex.push(mas, dre);
    this.u.masonry.value = mas;
    this.u.dressed.value = dre;
    this.sky = skyDome();
    this.scene.add(this.sky.mesh);
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
    this.body = new Body(this.stone);
    this.scene.add(this.body.mesh);
    // Вино в кубке: гладь в чаше, поднимается с уровнем (`wine`).
    this.wineMesh = wineSurface(this.stone);
    this.trinkets.get('goblet')?.mesh.add(this.wineMesh);
    this.life = new ChambersLife(
      {
        scene: this.scene,
        material: this.stone,
        origin: this.origin,
        arms,
        quality,
        ruler: () => this.rulerNow(),
        cue: (c, at) => this.onLifeCue?.(c, at),
        intend: (spot) => this.intend({ kind: 'spot', id: spot }),
        stand: () => this.leave(),
        goblet: () => this.gobletAt(),
        dropGoblet: () => {
          if (this.held?.id === 'goblet') this.release();
        },
      },
      memory,
    );
    this.camera.near = 0.05;
    this.standAt(POI_BY_ID.hall);
    this.placeCamera();
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
    const z = this.mode === 'in' && this.act?.a.id === 'window' ? POI_BY_ID.window.zoom! : null;
    const wide = z ? fitFov(z[1], this.camera.aspect) : 0;
    return {
      mode: this.mode,
      spot: this.act?.a.id ?? (this.path?.then.kind === 'spot' ? this.path.then.id : null),
      held: this.held && this.held.dir > 0 ? this.held.id : null,
      zoom: z ? (this.zoomFov !== null ? (wide - this.zoomFov) / (wide - z[0]) : 0) : null,
      used: { ...this.used },
      drink: this.canDrink,
    };
  }

  /** Где глаз и что делает правитель — тестам и стенду. */
  state(): { mode: Mode; spot: SpotId | null; x: number; y: number; z: number; yaw: number; pitch: number } {
    return { mode: this.mode, spot: this.act?.a.id ?? null, x: this.pose.x, y: this.pose.y, z: this.pose.z, yaw: this.pose.yaw, pitch: this.pose.pitch };
  }

  /** Сказать интерфейсу — только когда переменилось то, что он показывает. */
  private changed(): void {
    const v = this.view();
    const key = JSON.stringify(v);
    if (key === this.lastView) return;
    this.lastView = key;
    this.onChange?.();
  }

  /** Подписи и стик — в слой интерфейса: подпись под пальцем, имена предметов стола, кружок пальца движения. */
  attachLabels(host: HTMLElement | null): void {
    this.label?.remove();
    this.stickEl?.remove();
    for (const t of this.tagEls) {
      t.box.remove();
      t.dot.remove();
      t.line.remove();
    }
    this.tagEls = [];
    this.label = null;
    this.stickEl = null;
    this.labelHost = host;
    if (!host) return;
    const l = document.createElement('div');
    l.className = 'ch-label';
    l.style.opacity = '0';
    host.appendChild(l);
    this.label = l;
    for (const t of LABELS) {
      const line = document.createElement('div');
      line.className = 'ch-tag-line';
      const dot = document.createElement('div');
      dot.className = 'ch-tag-dot';
      const box = document.createElement('div');
      box.className = 'ch-tag';
      box.textContent = t.name;
      for (const el of [line, dot, box]) {
        el.style.visibility = 'hidden';
        host.appendChild(el);
      }
      this.tagEls.push({ box, dot, line });
    }
    const st = document.createElement('div');
    st.className = 'ch-stick';
    st.innerHTML = '<i></i>';
    host.appendChild(st);
    this.stickEl = st;
  }

  // ---------- Глаз ----------

  /** Встать на место на полу (вход, снимки стенда): глаз стоя, без перехода. */
  private standAt(p: Poi, dyaw = 0, dpitch = 0): void {
    this.mode = 'free';
    this.act = null;
    this.path = null;
    this.off = { yaw: 0, pitch: 0 };
    this.zoomFov = null;
    this.pose = { ...p.pose, y: EYE_STAND, yaw: p.pose.yaw + dyaw, pitch: clamp(p.pose.pitch + dpitch, FREE_PITCH[0], FREE_PITCH[1]) };
  }

  /**
   * Стенду снимков (`scripts/city-shots.ts`, `CHAMBERS=`): встать в дело сразу, без подхода и перехода, повернуть голову
   * от его взгляда и, если надо, взять безделушку уже в руку. Игроку этот рычаг не достаётся: в игре — касания и палец.
   */
  snap(id: PoiId, dyaw = 0, dpitch = 0, hold: TrinketId | null = null, hover: ThingId | null = null): void {
    const p = POI_BY_ID[id];
    if (id === 'hall') this.standAt(p, dyaw, dpitch);
    else {
      const a = ACTS[id];
      this.mode = 'in';
      this.path = null;
      this.act = { a, t: actLength(a), dir: 1, after: null, grabbed: true };
      this.zoomFov = null;
      this.off = { yaw: 0, pitch: 0 };
      this.applyAct();
      this.look(dyaw, dpitch);
    }
    // Дело «Оружие» и есть меч в руке.
    const inHand = hold ?? (id === 'arms' ? 'sword' : null);
    this.held = inHand ? { id: inHand, t: 1, dir: 1, spin: 0, tilt: 0, spinGoal: 0, tiltGoal: 0 } : null;
    const h = hover ? THINGS.find((t) => t.id === hover) ?? null : null;
    this.hover = h ? { kind: 'thing', thing: h } : null;
    this.placeCamera();
    this.stepHands(0);
    this.stepBody();
    this.changed();
  }

  /** Тестам и стенду: встать стоя в точку пола и смотреть так (без перехода, подписи — с нуля). */
  standAtPoint(x: number, z: number, yaw: number, pitch: number): void {
    this.standAt({ ...POI_BY_ID.hall, pose: { ...POI_BY_ID.hall.pose, x, z, yaw, pitch } });
    this.held = null;
    this.hover = null;
    this.placeCamera();
    this.stepBody();
    this.changed();
  }

  /** Приближение у окна: шаг ±1 (кнопка) или множитель колеса. */
  zoomBy(k: number): void {
    if (!(this.mode === 'in' && this.act?.a.id === 'window')) return;
    const z = POI_BY_ID.window.zoom!;
    const wide = fitFov(z[1], this.camera.aspect);
    const cur = this.zoomFov ?? wide;
    this.zoomFov = Math.min(wide, Math.max(z[0], cur / k));
    this.changed();
  }

  /** Поле зрения сейчас: стоя — `FREE_FOV`, в деле — поле дела (у стола шире: в кадре руки и колени). */
  private fovNow(): number {
    if (this.zoomFov !== null) return this.zoomFov;
    const free = fitFov(FREE_FOV, this.camera.aspect);
    const a = this.act;
    if (!a) return free;
    const p = POI_BY_ID[a.a.id];
    const k = easeInOut(clamp(a.t / actLength(a.a), 0, 1));
    const at = a.a.id === 'desk' ? fitFov(p.pose.fov, this.camera.aspect, 46, 86) : fitFov(p.pose.fov, this.camera.aspect);
    return free + (at - free) * k;
  }

  /** Камера по позе: место — от начала комнаты, взгляд — поворотом головы, поле зрения — с приближением. */
  private placeCamera(): void {
    const p = this.pose;
    const idle = this.held || this.mode === 'walk' ? 0 : 1 - this.walkK;
    const br = Math.sin(this.time * 1.1) * 0.005 * idle;
    // Голова ниже всего, когда ступня встаёт на пол (шаг — на кратном π, `pace`), и чуть качается с ноги на ногу.
    const bob = -(1 + Math.cos(2 * this.bob)) * 0.0065 * this.walkK;
    const sway = Math.sin(this.bob) * 0.005 * this.walkK;
    const lying = this.act?.a.id === 'bed' && this.mode === 'in' ? 0.4 : 1;
    this.camera.position.set(this.origin.x + p.x - Math.cos(p.yaw) * sway, this.origin.y + p.y + br * lying + bob, this.origin.z + p.z + Math.sin(p.yaw) * sway);
    const d = lookDir(p.yaw + Math.sin(this.time * 0.37) * 0.003 * idle, p.pitch + br * 0.2);
    V.set(this.camera.position.x + d.x, this.camera.position.y + d.y, this.camera.position.z + d.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(V);
    const fov = this.fovNow();
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.sky.mesh.position.copy(this.camera.position);
  }

  // ---------- Кадр ----------

  frame(dt: number, t: number, sky: InsideSky): void {
    this.time = t;
    this.stepEye(Math.min(dt, 0.1));
    this.life.step(Math.min(dt, 0.1));
    this.stepPet(Math.min(dt, 0.1));
    this.attendTalk(Math.min(dt, 0.1));
    this.stepHands(dt);
    this.placeCamera();
    this.life.draw();
    this.stepWine();
    this.stepBody();
    this.light(t, sky);
    this.labels(dt);
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
    this.changed();
  }

  /** Палец и клавиши этого кадра: куда идти и на сколько повернуть голову. */
  private input(): { walk: Walk; look: { yaw: number; pitch: number } } {
    // Разговор и ночь держат ноги (`life.holdsLegs`); кончились — палец движения снова ведёт.
    const walk = this.life.holdsLegs ? { forward: 0, strafe: 0 } : mergeWalk(this.sticks.walk(), this.keys.walk());
    const look = this.sticks.takeLook();
    if (walk.forward !== 0 || walk.strafe !== 0) this.used.walk = true;
    if (look.yaw !== 0 || look.pitch !== 0) {
      this.used.look = true;
      this.idleLook = 0;
    }
    return { walk, look };
  }

  private stepEye(dt: number): void {
    const { walk, look } = this.input();
    const moving = walk.forward !== 0 || walk.strafe !== 0;
    // Безделушка в руке: палец взгляда крутит её, а не голову; палец движения кладёт её на место.
    if (this.held && this.held.dir > 0) {
      // Медленно: пол-оборота — на ширину экрана; наклон — в пределах предмета.
      const tr = TRINKETS.find((x) => x.id === this.held!.id)!;
      this.held.spinGoal -= look.yaw * TURN_PER_LOOK;
      this.held.tiltGoal = clamp(this.held.tiltGoal - look.pitch * TURN_PER_LOOK, tr.tilts[0], tr.tilts[1]);
      look.yaw = 0;
      look.pitch = 0;
      if (moving) this.drop();
    }
    switch (this.mode) {
      case 'free': {
        // Пошёл — гладить бросил.
        if (moving && this.pet) this.stopPet();
        if (moving) this.petWant = 0;
        this.pose.yaw += look.yaw + turnRate(walk.strafe) * dt;
        this.pose.pitch = clamp(this.pose.pitch + look.pitch, FREE_PITCH[0], FREE_PITCH[1]);
        this.stride(walk.forward * WALK_SPEED * dt, dt);
        // Гладит кота — присел; иначе стоит.
        const eyeY = this.pet ? EYE_STAND + (PET_EYE - EYE_STAND) * this.petK() : EYE_STAND;
        this.pose.y += (eyeY - this.pose.y) * (1 - Math.exp(-dt * 8));
        return;
      }
      case 'walk': {
        if (moving) {
          // Палец движения перехватывает: подход отменён, дальше — сам.
          this.path = null;
          this.mode = 'free';
          return this.stepEye(0);
        }
        this.followPath(dt);
        return;
      }
      case 'act': {
        const a = this.act!;
        if (moving && a.dir > 0) a.dir = -1;
        const was = a.t;
        a.t = clamp(a.t + dt * a.dir, 0, actLength(a.a));
        // Звук дела — на своём миге, туда и обратно: кресло скрипнуло, постель зашуршала.
        for (const [at, cue] of ACT_CUES[a.a.id]) if ((was < at) !== (a.t < at)) this.onCue?.(cue);
        // Дверь: костяшки о доску — стук; после третьего удара за дверью слышат (слуга поднимается).
        if (a.a.id === 'door' && a.dir > 0) {
          for (const at of KNOCKS) if (was < at && a.t >= at) this.onLifeCue?.('knock', [DOOR_AT[0], 1.4, DOOR_AT[2]]);
          const heard = KNOCKS[KNOCKS.length - 1] + 0.2;
          if (was < heard && a.t >= heard) this.life.knocked();
        }
        // В переходе поворот головы гаснет: глаз садится (встаёт) к взгляду дела, а не рывком.
        const keep = Math.exp(-dt * 5);
        this.off.yaw *= keep;
        this.off.pitch *= keep;
        this.applyAct();
        if (a.a.id === 'arms' && a.dir > 0 && !a.grabbed && a.t >= GRAB_AT) {
          a.grabbed = true;
          this.take('sword');
        }
        // Меч кладут, вернувшись к стене: рука отпускает его там же, где брала.
        if (a.a.id === 'arms' && a.dir < 0 && this.held?.id === 'sword' && this.held.dir > 0 && a.t <= GRAB_AT) this.release();
        if (a.dir > 0 && a.t >= actLength(a.a)) {
          this.mode = 'in';
          this.used.act = true;
        } else if (a.dir < 0 && a.t <= 0) this.finishLeave();
        return;
      }
      case 'in': {
        // Палец движения поднимает из дела; меч положен — правитель отходит от стены.
        if (moving || (this.act!.a.id === 'arms' && !(this.held && this.held.dir > 0))) {
          this.leave();
          return;
        }
        this.look(look.yaw, look.pitch);
        this.applyAct();
        return;
      }
    }
  }

  /** Шаг тела вперёд на `d` м по взгляду: мебель и стены выталкивают, вдоль них — скольжение. */
  private stride(d: number, dt: number): void {
    const want = { x: this.pose.x + Math.sin(this.pose.yaw) * d, z: this.pose.z + Math.cos(this.pose.yaw) * d };
    const got = step(this.pose, want.x, want.z, BODY_R);
    const moved = Math.hypot(got.x - this.pose.x, got.z - this.pose.z);
    this.pose.x = got.x;
    this.pose.z = got.z;
    const speed = dt > 0 ? moved / dt : 0;
    this.pace(moved);
    this.walkK += (Math.min(1, speed / WALK_SPEED) - this.walkK) * Math.min(1, dt * 6);
  }

  /**
   * Шаг: голова качается в такт (шаг — 0,68 м, два в секунду на ходу), на каждый шаг — его звук: по доскам или, тише, по
   * ковру и шкурам (`plan.SOFT_FLOOR`).
   */
  private pace(d: number): void {
    const before = Math.floor(this.bob / Math.PI);
    this.bob += d * BOB_PER_M;
    if (Math.floor(this.bob / Math.PI) !== before) this.onCue?.(softFloor(this.pose.x, this.pose.z) ? 'stepSoft' : 'step');
  }

  /** Повернуть голову в пределах: стоя — кругом, в деле — от взгляда дела. */
  private look(dyaw: number, dpitch: number): void {
    if (this.mode === 'in' || this.mode === 'act') {
      const p = POI_BY_ID[this.act!.a.id];
      const f = this.frameNow ?? frameAt(this.act!.a, this.act!.t);
      const y = this.off.yaw + dyaw;
      const pt = this.off.pitch + dpitch;
      this.off.yaw = p.yaw ? clamp(y, p.yaw[0], p.yaw[1]) : wrap(y);
      this.off.pitch = clamp(f.pitch + pt, p.pitch[0], p.pitch[1]) - f.pitch;
      return;
    }
    this.pose.yaw += dyaw;
    this.pose.pitch = clamp(this.pose.pitch + dpitch, FREE_PITCH[0], FREE_PITCH[1]);
  }

  /** Глаз по ключам дела и повороту головы поверх. */
  private applyAct(): void {
    const a = this.act!;
    const f = frameAt(a.a, a.t);
    this.frameNow = f;
    this.pose.x = f.x;
    this.pose.y = f.y;
    this.pose.z = f.z;
    this.pose.yaw = f.yaw + this.off.yaw;
    this.pose.pitch = f.pitch + this.off.pitch;
    this.walkK = 0;
  }

  /** Пройти по пути к месту дела: разгон, ровный шаг, торможение; взгляд — туда, куда идёт, у цели — на мебель. */
  private followPath(dt: number): void {
    const p = this.path!;
    const left = pathLength(this.pose, p.pts);
    const target = Math.min(AUTO_SPEED, Math.sqrt(2 * 2.2 * left) + 0.05);
    p.v += clamp(target - p.v, -3 * dt, 2.4 * dt);
    let d = p.v * dt;
    while (d > 0 && p.pts.length) {
      const q = p.pts[0];
      const seg = Math.hypot(q.x - this.pose.x, q.z - this.pose.z);
      if (seg <= d) {
        this.pose.x = q.x;
        this.pose.z = q.z;
        d -= seg;
        p.pts.shift();
      } else {
        this.pose.x += ((q.x - this.pose.x) / seg) * d;
        this.pose.z += ((q.z - this.pose.z) / seg) * d;
        d = 0;
      }
    }
    // Взгляд: по ходу, у цели — к мебели; поворот мягкий и не быстрее 2,4 рад/с.
    const q = p.pts[0];
    const ahead = q ? Math.atan2(q.x - this.pose.x, q.z - this.pose.z) : p.face.yaw;
    const near = clamp((0.7 - left) / 0.7, 0, 1);
    const want = q && left > 0.02 ? ahead + wrap(p.face.yaw - ahead) * near : p.face.yaw;
    const turn = wrap(want - this.pose.yaw);
    this.pose.yaw += clamp(turn * (1 - Math.exp(-dt * 7)), -2.4 * dt, 2.4 * dt);
    this.pose.pitch += (-0.12 - this.pose.pitch) * (1 - Math.exp(-dt * 4));
    this.pose.y += (EYE_STAND - this.pose.y) * (1 - Math.exp(-dt * 8));
    this.pace(p.v * dt);
    this.walkK += (Math.min(1, p.v / WALK_SPEED) - this.walkK) * Math.min(1, dt * 6);
    if (!p.pts.length && Math.abs(wrap(p.face.yaw - this.pose.yaw)) < 0.03) {
      this.pose.yaw = p.face.yaw;
      this.path = null;
      this.mode = 'free';
      this.walkK = 0;
      this.arrive(p.then);
    }
  }

  /** Пришёл: начать дело или взять предмет. */
  private arrive(then: Then): void {
    if (then.kind === 'spot') this.begin(then.id);
    else this.take(then.id);
  }

  /** Начать дело с места подхода: сесть, лечь, к окну, к огню, к мечу. */
  private begin(id: SpotId): void {
    const a = ACTS[id];
    this.mode = 'act';
    this.act = { a, t: 0, dir: 1, after: null, grabbed: false };
    this.off = { yaw: 0, pitch: 0 };
    // Взгляд до начала — от позы подхода: поворот головы, если был, гаснет вместе с ключами.
    this.off.pitch = this.pose.pitch - a.keys[0].pitch;
    this.zoomFov = null;
    this.applyAct();
    this.changed();
  }

  /** Встать из дела (кнопка «Встать», палец движения). `after` — куда потом. */
  leave(after: Then | null = null): void {
    const a = this.act;
    if (!a) return;
    if (this.held && !(a.a.id === 'arms' && this.held.id === 'sword')) this.release();
    this.zoomFov = null;
    a.dir = -1;
    a.after = after;
    this.mode = 'act';
    this.changed();
  }

  private finishLeave(): void {
    const a = this.act!;
    const after = a.after;
    const k = a.a.keys[0];
    this.act = null;
    this.frameNow = null;
    this.mode = 'free';
    this.pose = { x: k.x, y: k.y, z: k.z, yaw: k.yaw + this.off.yaw, pitch: clamp(k.pitch + this.off.pitch, FREE_PITCH[0], FREE_PITCH[1]), fov: FREE_FOV };
    this.off = { yaw: 0, pitch: 0 };
    this.changed();
    if (after) this.intend(after);
  }

  /** Захотеть: пойти к месту и сделать дело (из дела — сперва встать). */
  private intend(then: Then): void {
    const spot = then.kind === 'spot' ? then.id : null;
    if (this.act) {
      if (this.mode === 'in' && spot === this.act.a.id) {
        // У двери постучать ещё раз: шаг назад — и снова к двери (Г-7).
        if (spot === 'door') this.leave(then);
        return;
      }
      this.leave(then);
      return;
    }
    const face: Stand | null = spot ? POI_BY_ID[spot].approach : TRINKETS.find((t) => t.id === (then as { id: TrinketId }).id)?.stand ?? null;
    if (!face) return;
    const pts = pathTo(this.pose, face);
    if (!pts) return;
    this.path = { pts, face, then, v: this.path?.v ?? 0 };
    this.mode = 'walk';
    this.changed();
  }

  // ---------- Жизнь покоев (Г-7) ----------

  /** Правитель — режиссёру жизни: где стоит, куда смотрит, в каком деле. */
  private rulerNow(): { x: number; z: number; yaw: number; eye: [number, number, number]; spot: SpotId | null; inAct: boolean } {
    const p = this.pose;
    return { x: p.x, z: p.z, yaw: p.yaw, eye: [p.x, p.y, p.z], spot: this.act?.a.id ?? null, inAct: this.mode === 'in' || this.mode === 'act' };
  }

  /** Кубок: середина чаши (оси комнаты) и в руке ли он. */
  private gobletAt(): { at: [number, number, number]; held: boolean } {
    const g = this.trinkets.get('goblet')!;
    V.set(0, 0.19, 0).applyQuaternion(g.mesh.quaternion).add(g.mesh.position).sub(this.origin);
    return { at: [V.x, V.y, V.z], held: this.held?.id === 'goblet' };
  }

  /** Касание кота: рядом — присесть и погладить; далеко или в деле — позвать: подойдёт — погладит. */
  petCat(): void {
    const c = this.life.cat;
    if (!c?.visible || this.pet) return;
    if (this.held && this.held.dir > 0) this.drop();
    if (this.act) this.leave();
    const near = Math.hypot(c.x - this.pose.x, c.z - this.pose.z) < 0.95 && c.y < 0.05;
    if (near && this.mode === 'free') {
      this.pet = { t: 0 };
      c.pet(true);
      this.used.act = true;
    } else {
      this.petWant = 14;
      c.come(this.pose.x + Math.sin(this.pose.yaw) * 0.5, this.pose.z + Math.cos(this.pose.yaw) * 0.5);
    }
  }

  /** Доля присеста (0 — стоит, 1 — присел у кота): вниз за полсекунды, вверх — к концу. */
  private petK(): number {
    const t = this.pet?.t ?? 0;
    return easeInOut(clamp(t / 0.55, 0, 1)) * (1 - easeInOut(clamp((t - (PET_LEN - 0.55)) / 0.55, 0, 1)));
  }

  private stopPet(): void {
    this.pet = null;
    this.life.cat?.pet(false);
  }

  /** Гладить: позвал — ждёт; подошёл — присел, взгляд на кота, рука по спине; кончил — встал. */
  private stepPet(dt: number): void {
    const c = this.life.cat;
    if (this.petWant > 0) {
      this.petWant -= dt;
      if (c?.visible && this.mode === 'free' && Math.hypot(c.x - this.pose.x, c.z - this.pose.z) < 0.85 && c.y < 0.05) {
        this.petWant = 0;
        this.pet = { t: 0 };
        c.pet(true);
      }
    }
    if (!this.pet) return;
    if (!c?.visible || this.mode !== 'free') {
      this.stopPet();
      return;
    }
    this.pet.t += dt;
    // Глаз — на кота (если палец взгляда не ведёт).
    if (this.idleLook > 0.3) {
      const dx = c.x - this.pose.x;
      const dz = c.z - this.pose.z;
      const want = Math.atan2(dx, dz);
      this.pose.yaw += wrap(want - this.pose.yaw) * (1 - Math.exp(-dt * 4));
      const pitch = Math.atan2(c.y + 0.22 - this.pose.y, Math.hypot(dx, dz));
      this.pose.pitch += (clamp(pitch, FREE_PITCH[0], FREE_PITCH[1]) - this.pose.pitch) * (1 - Math.exp(-dt * 4));
    }
    if (this.pet.t >= PET_LEN) this.stopPet();
  }

  /** Голова сама оборачивается к собеседнику, пока палец взгляда не ведёт. */
  private attendTalk(dt: number): void {
    this.idleLook += dt;
    const head = this.life.focus();
    if (!head || this.idleLook < 0.9 || this.pet || this.held) return;
    const dx = head[0] - this.pose.x;
    const dz = head[2] - this.pose.z;
    const want = Math.atan2(dx, dz);
    const pitch = Math.atan2(head[1] - this.pose.y, Math.hypot(dx, dz));
    const k = 1 - Math.exp(-dt * 2.2);
    if (this.mode === 'free') {
      this.pose.yaw += wrap(want - this.pose.yaw) * k;
      this.pose.pitch += (clamp(pitch, FREE_PITCH[0], FREE_PITCH[1]) - this.pose.pitch) * k;
    } else if (this.mode === 'in' && this.act) {
      this.look(wrap(want - this.pose.yaw) * k, (pitch - this.pose.pitch) * k);
    }
  }

  /** Гладь вина в кубке — по уровню: выше и шире к краю чаши; пустой — гладь не видна. */
  private stepWine(): void {
    const w = this.life.wine;
    this.wineMesh.visible = w > 0.01;
    const r = 0.0502 + 0.0036 * w;
    this.wineMesh.scale.set(r, 1, r);
    this.wineMesh.position.y = 0.1712 + 0.029 * w;
  }

  /** Свет города последнего кадра — часу разговоров (ночь, солнце над горизонтом и с какой стороны). */
  skyNow(): { night: number; sunY: number; sunX: number } {
    return this.skyLast;
  }

  /** Громкость и сторона звука в точке (оси комнаты) для уха глаза; за закрытой дверью — глуше. */
  hear(at: readonly [number, number, number]): { gain: number; pan: number } {
    V.set(at[0], at[1], at[2]).add(this.origin).sub(this.camera.position);
    const d = V.length();
    V2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = d > 0.01 ? V.dot(V2) / d : 0;
    let gain = Math.min(1, 1.6 / Math.max(1, d));
    if (at[2] < -HALF - 0.2) gain *= 0.35 + 0.65 * this.life.doorOpen;
    return { gain, pan };
  }

  /** Выпить из кубка в руке: к губам, наклон, глоток, назад. */
  drink(): void {
    if (this.held?.id !== 'goblet' || this.held.dir < 0 || this.life.wine < 0.02 || this.sip) return;
    this.sip = { t: 0, gulped: false };
    this.changed();
  }

  /** Есть ли что выпить (кубок в руке и в нём вино) — кнопке «Выпить». */
  get canDrink(): boolean {
    return this.held?.id === 'goblet' && this.held.dir > 0 && this.held.t > 0.95 && this.life.wine > 0.02 && !this.sip;
  }

  // ---------- Свет ----------

  /** Свет кадра: огонь дышит, свечи горят ночью, небо и солнце — из города. */
  private light(t: number, sky: InsideSky): void {
    const u = this.u;
    this.skyLast = { night: sky.night, sunY: sky.sunDir.y, sunX: sky.sunDir.x };
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
    // Солнце сквозь проём ярче всего в комнате: пятно на полу читается рядом с огнём и небом окон.
    u.uSun.value.copy(sky.sun).multiplyScalar(1.25);
    // Отражённый свет: днём комната светла и в углах — окна отдают небо, пол и дерево возвращают его тёплым.
    u.uAmb.value
      .setRGB(0.012, 0.01, 0.009)
      .add(C.copy(FIRE).multiplyScalar(0.006 * flick))
      .add(C.copy(u.uSky.value).multiplyScalar(0.03 + 0.075 * sky.daylight))
      .add(C.copy(BOUNCE).multiplyScalar(1.5 * sky.daylight))
      .add(C.copy(CANDLE).multiplyScalar(0.008 * lit));
    const h = this.hover?.kind === 'thing' ? this.hover.thing : null;
    const hv = this.hover;
    const sel = h && (!this.held || h.id === this.held.id) ? h.code : hv?.kind === 'folk' ? LIFE_CODE[hv.who] : hv?.kind === 'cat' ? LIFE_CODE.cat : hv?.kind === 'poi' && hv.poi.id === 'door' ? LIFE_CODE.door : 0;
    u.uSel.value = sel;
    u.uSelGlow.value = 0.65 + Math.sin(t * 4) * 0.25;
    // Небо за окнами — своё, а не плоский цвет фона: к горизонту — дымка города (на ней тает даль города), к зениту —
    // синева, у солнца — сияние, ночью — звёзды. Днём окно не уходит в белое.
    const su = this.sky.mat.uniforms;
    const lum = sky.sky.r * 0.2126 + sky.sky.g * 0.7152 + sky.sky.b * 0.0722;
    const clear = (1 - sky.cloud) * (1 - sky.mist * 0.7);
    su.uHaze.value.copy(sky.haze);
    // Зенит днём — синева без пересвета (небо фона города — выше единицы и в окне ушло бы в белое).
    su.uZen.value.copy(sky.sky).multiplyScalar(0.55).lerp(C.copy(DEEP).multiplyScalar(Math.min(1, lum) * 0.95), 0.85 * clear * sky.daylight).multiplyScalar(1 - 0.35 * sky.night);
    su.uSunDir.value.copy(sky.sunDir);
    su.uSunCol.value.copy(sky.sun).multiplyScalar(0.35 * clear);
    su.uNight.value = sky.night * clear;
    const sunLum = sky.sun.r * 0.3 + sky.sun.g * 0.6 + sky.sun.b * 0.1;
    this.fire.update(t, lit, Math.min(1, sunLum / 2.2) * (1 - sky.night));
    this.handFire.update(t, Math.max(lit, this.held?.id === 'candle' ? 1 : 0), 0);
  }

  // ---------- Руки ----------

  /** Взять безделушку: подлетает к руке у глаза, палец взгляда крутит её вместо головы. */
  take(id: TrinketId): void {
    if (this.held?.id === id && this.held.dir > 0) return;
    if (this.held) this.release();
    this.held = { id, t: 0, dir: 1, spin: 0, tilt: 0, spinGoal: 0, tiltGoal: 0 };
    this.hover = null;
    this.used.act = true;
    this.onCue?.(id === 'sword' ? 'ring' : 'take');
    this.changed();
  }

  /** Положить на место. Меч кладут на стену: правитель сперва шагает к ней (дело «Оружие» — назад), там рука отпускает. */
  drop(): void {
    if (!this.held) return;
    if (this.held.id === 'sword' && this.act?.a.id === 'arms' && this.mode === 'in') {
      this.leave();
      return;
    }
    this.release();
  }

  private release(): void {
    if (!this.held || this.held.dir < 0) return;
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
    // Поворот пальцем догоняет цель плавно — предмет поворачивают, а не дёргают.
    const ease = 1 - Math.exp(-dt * 6);
    h.spin += (h.spinGoal - h.spin) * ease;
    h.tilt += (h.tiltGoal - h.tilt) * ease;
    const thing = TRINKETS.find((x) => x.id === h.id)!;
    const cam = this.camera;
    // Как держать: предмет повёрнут в осях глаза (`holdRotation`), середина хвата — там, где он целиком в кадре.
    holdRotation(thing, h.spin, h.tilt, Q);
    HOLD.copy(cam.quaternion).multiply(Q);
    REST.setFromAxisAngle(UP, tr.restYaw);
    tr.mesh.quaternion.copy(REST).slerp(HOLD, k);
    const at = this.holdAt(thing, tr.mesh);
    V2.copy(at).applyQuaternion(cam.quaternion).add(cam.position);
    V.set(thing.grip[0], thing.grip[1], thing.grip[2]).applyQuaternion(HOLD);
    POS.copy(tr.rest).lerp(V2.sub(V), k);
    tr.mesh.position.copy(POS);
    // Глоток: кубок к губам и наклон к себе; на середине — глоток, вина меньше.
    if (this.sip && h.id === 'goblet') {
      const s = this.sip;
      s.t += dt;
      const up = easeInOut(clamp(s.t / 0.55, 0, 1)) * (1 - easeInOut(clamp((s.t - 1.2) / 0.5, 0, 1)));
      V.set(0, -0.085, -0.12).applyQuaternion(cam.quaternion).add(cam.position);
      V2.set(0, 0.19, 0).applyQuaternion(tr.mesh.quaternion);
      tr.mesh.position.lerp(V.sub(V2), up);
      V.set(1, 0, 0).applyQuaternion(cam.quaternion);
      Q.setFromAxisAngle(V, 1.05 * up);
      tr.mesh.quaternion.premultiply(Q);
      if (!s.gulped && s.t > 0.85) {
        s.gulped = true;
        this.life.wine = Math.max(0, this.life.wine - SIP);
        this.onLifeCue?.('gulp', null);
      }
      if (s.t >= SIP_LEN) {
        this.sip = null;
        this.changed();
      }
    }
    if (h.dir < 0 && h.t <= 0) {
      tr.mesh.position.copy(tr.rest);
      tr.mesh.quaternion.copy(REST);
      this.held = null;
      this.onCue?.('put');
      this.changed();
    }
  }

  /** Где хват предмета в осях глаза: считается под поле зрения кадра и не меняется, пока оно то же. */
  private holdAt(thing: Trinket, mesh: THREE.Mesh): THREE.Vector3 {
    const cam = this.camera;
    const key = `${thing.id}:${cam.fov.toFixed(2)}:${cam.aspect.toFixed(3)}`;
    if (this.fit?.key === key) return this.fit.at;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const at = holdFit(thing, g.boundingBox!, cam.fov, cam.aspect);
    this.fit = { key, at };
    return at;
  }

  // ---------- Тело ----------

  /** Тело этого кадра: руки дела и предмета в руке, ноги сидя. */
  private stepBody(): void {
    const f = this.frameNow;
    const a = this.act;
    const eye: [number, number, number] = [this.pose.x, this.pose.y, this.pose.z];
    const yaw = a ? f?.yaw ?? this.pose.yaw : this.pose.yaw;
    const fwd: [number, number, number] = [Math.sin(yaw), 0, Math.cos(yaw)];
    const right: [number, number, number] = [-Math.cos(yaw), 0, Math.sin(yaw)];
    // Опущенная рука — у бедра, ниже кадра: из неё рука входит в дело и в неё уходит.
    const low = (side: 1 | -1): HandPose => ({ w: [eye[0] + right[0] * side * 0.24 + fwd[0] * 0.08, eye[1] - 0.86, eye[2] + right[2] * side * 0.24 + fwd[2] * 0.08], f: [0, -1, 0], u: [right[0] * side, 0, right[2] * side], curl: 0.25 });
    let left: HandPose | null = null;
    let rightH: HandPose | null = null;
    const k = a && f ? clamp(f.hands, 0, 1) : 0;
    if (a && f && k > 0.001 && a.a.hands !== 'none') {
      const target = this.handsOf(a.a.hands, eye, fwd, right);
      rightH = blendHand(low(1), target.right, k);
      left = blendHand(low(-1), target.left, k);
    }
    // Дело «Оружие»: правая рука тянется к рукояти меча, пока не взяла его.
    if (a?.a.id === 'arms' && !this.held) {
      const sw = this.trinkets.get('sword')!;
      const reach = clamp(a.t / GRAB_AT, 0, 1);
      const g = TRINKETS.find((t) => t.id === 'sword')!.grip;
      V.set(g[0], g[1], g[2]).applyQuaternion(sw.mesh.quaternion).add(sw.mesh.position).sub(this.origin);
      const target: HandPose = { w: [V.x - 0.07, V.y - 0.01, V.z + 0.05], f: [1, 0.05, -0.35], u: [0, 1, 0.2], curl: 0.3 + reach * 0.5 };
      rightH = blendHand(low(1), target, easeInOut(reach));
    }
    // Предмет в руке: правая кисть держит его за `grip` — кулаком вокруг рукояти или на ладони (`body.holdHand`).
    if (this.held) {
      const h = this.held;
      const tr = this.trinkets.get(h.id)!;
      const thing = TRINKETS.find((t) => t.id === h.id)!;
      V.set(thing.grip[0], thing.grip[1], thing.grip[2]).applyQuaternion(tr.mesh.quaternion).add(tr.mesh.position).sub(this.origin);
      V2.set(thing.axis[0], thing.axis[1], thing.axis[2]).applyQuaternion(tr.mesh.quaternion);
      const cam = this.camera;
      const cf = cam.getWorldDirection(new THREE.Vector3());
      const cr = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const target = holdHand(thing.hold, [V.x, V.y, V.z], [V2.x, V2.y, V2.z], [cf.x, cf.y, cf.z], [cr.x, cr.y, cr.z], thing.gripR);
      rightH = blendHand(rightH ?? low(1), target, easeInOut(h.t));
    }
    // Гладит кота: ладонь вниз, пальцы к хвосту, рука идёт от шеи к спине и обратно (Г-7).
    const cat = this.life.cat;
    if (this.pet && cat?.visible) {
      const pk = this.petK();
      const s = (Math.sin(this.pet.t * 2.4 - Math.PI / 2) + 1) / 2;
      const a = cat.rig.at('neck');
      const b = cat.rig.at('pelvis');
      const w: [number, number, number] = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s + 0.075, a[2] + (b[2] - a[2]) * s];
      const dl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      const target: HandPose = { w, f: [(b[0] - a[0]) / dl, -0.25, (b[2] - a[2]) / dl], u: [0, 1, 0], curl: 0.18, spread: 0.1 };
      rightH = blendHand(rightH ?? low(1), target, pk);
    }
    const sit = a?.a.id === 'desk' && f ? f.sit : 0;
    this.body.update(rightH || left || sit > 0.02 ? { eye, yaw, left, right: rightH, sit, seat: { x: CHAIR.x, z: CHAIR.z - 0.14, y: 0.55 } } : null, this.origin);
  }

  /** Руки в деле — куда кладутся кисти (в осях комнаты). */
  private handsOf(kind: Act['hands'], eye: [number, number, number], fwd: [number, number, number], right: [number, number, number]): { left: HandPose; right: HandPose } {
    const t = this.time;
    switch (kind) {
      case 'desk': {
        // Сидя за столом, подавшись к нему: предплечья — над концами подлокотников, кисти легли на край столешницы, пальцы
        // на столе перед бумагами (Г-6: на подлокотниках у края кадра их на телефоне не видно).
        const hand = (side: 1 | -1): HandPose => ({
          w: [CHAIR.x - side * 0.16, DESK.top + 0.028, DESK.z - DESK.d / 2 - 0.1],
          f: [side * 0.08, -0.14, 1],
          u: [side * 0.04, 1, 0.14],
          curl: 0.34 + 0.03 * Math.sin(t * 0.7 + side),
          spread: 0.06,
        });
        return { right: hand(1), left: hand(-1) };
      }
      case 'sill':
        // Ладони на подоконнике большого окна (`plan.OPENINGS`: плита подоконника выходит из доски в комнату).
        return {
          right: { w: [-0.17, SILL + 0.04, HALF + 0.8], f: [0.22, -0.16, 1], u: [0, 1, 0.16], curl: 0.12, spread: 0.1 },
          left: { w: [0.17, SILL + 0.04, HALF + 0.8], f: [-0.22, -0.16, 1], u: [0, 1, 0.16], curl: 0.12, spread: 0.1 },
        };
      case 'knock': {
        // Стук (Г-7): правая — кулаком к доске двери, на ударах касается её и отдёргивается; левая опущена.
        const at = this.act?.t ?? 0;
        let hit = 0;
        for (const k of KNOCKS) hit = Math.max(hit, Math.max(0, 1 - Math.abs(at - k) / 0.11));
        const leafZ = -HALF - 0.32 + 0.11;
        return {
          right: { w: [DOOR_AT[0] + 0.06, 1.38, leafZ + 0.1 - 0.085 * hit], f: [0.05, 0.25, -1], u: [-0.15, 0.95, 0.2], curl: 0.92 },
          left: { w: [eye[0] - right[0] * 0.24, eye[1] - 0.9, eye[2] - right[2] * 0.24 + fwd[2] * 0.05], f: [0, -1, 0], u: [-right[0], 0, -right[2]], curl: 0.25 },
        };
      }
      case 'warm': {
        // Ладони к огню, пальцы вверх; кисти чуть трутся одна о другую.
        const hand = (side: 1 | -1): HandPose => {
          const rub = Math.sin(t * 1.9 + (side > 0 ? 0 : Math.PI)) * 0.012;
          const w: [number, number, number] = [
            eye[0] + fwd[0] * 0.4 + right[0] * side * (0.11 + rub),
            eye[1] - 0.42 + Math.sin(t * 1.3 + side) * 0.006,
            eye[2] + fwd[2] * 0.4 + right[2] * side * (0.11 + rub),
          ];
          return {
            w,
            f: [fwd[0] * 0.6 - right[0] * side * 0.16, 0.8, fwd[2] * 0.6 - right[2] * side * 0.16],
            u: [-fwd[0], 0.35, -fwd[2]],
            curl: 0.22 + 0.06 * Math.sin(t * 1.1 + side),
            spread: 0.08,
          };
        };
        return { right: hand(1), left: hand(-1) };
      }
      default:
        return { right: { w: [0, -50, 0.3], f: [0, 0, 1], u: [0, 1, 0], curl: 0 }, left: { w: [0, -50, 0.3], f: [0, 0, 1], u: [0, 1, 0], curl: 0 } };
    }
  }

  // ---------- Палец ----------

  /** Ввод — слоя интерфейса поверх холста (`ui/chambers`); координаты страницы и рамка холста. */
  down(id: number, x: number, y: number, rect: DOMRect | { left: number; top: number; width: number; height: number }): void {
    this.rect = rect;
    const half = this.sticks.down(id, x - rect.left, y - rect.top, performance.now(), rect.width);
    if (!half) return;
    this.presses.set(id, { x, y });
    // Касание — подсветка того, что под пальцем, пока он лежит (ведение её гасит).
    this.hover = this.pickAt(x, y);
  }

  move(id: number, x: number, y: number): void {
    if (!this.presses.has(id)) return;
    this.sticks.move(id, x - this.rect.left, y - this.rect.top, performance.now());
    const p = this.presses.get(id)!;
    if (Math.hypot(x - p.x, y - p.y) > 12) this.hover = null;
  }

  up(id: number): void {
    const p = this.presses.get(id);
    this.presses.delete(id);
    const r = this.sticks.up(id, performance.now());
    if (!r || !p) return;
    if (!r.tap) {
      if (!this.isMouse) this.hover = null;
      return;
    }
    swallowGhostClick();
    const aim = this.pickAt(p.x, p.y);
    if (!this.isMouse) this.hover = null;
    this.touch(aim);
  }

  cancel(id: number): void {
    this.presses.delete(id);
    this.sticks.cancel(id);
    this.hover = null;
  }

  /** Клавиши: W/S и стрелки — шаг, A/D — поворот (как в промыслах). */
  keyDown(code: string, target: unknown = null): boolean {
    if (typing(target)) return false;
    return this.keys.down(code);
  }

  keyUp(code: string): void {
    this.keys.up(code);
  }

  /** Колесо мыши: у окна — вдаль и обратно. */
  wheel(dy: number): void {
    this.zoomBy(dy < 0 ? 1.12 : 1 / 1.12);
  }

  /** Мышь без нажатия: подсветка и подпись предмета под указателем. */
  hoverAt(x: number, y: number, rect: DOMRect | { left: number; top: number; width: number; height: number }): void {
    this.isMouse = true;
    this.rect = rect;
    if (this.presses.size > 0) return;
    this.hover = this.pickAt(x, y);
  }

  /** Рамка холста без касания (снимки стенда, тесты): подписи раскладываются в ней. */
  setRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.rect = rect;
  }

  /** Что сейчас под пальцем — у кого подпись. */
  get aimed(): Aim | null {
    return this.hover;
  }

  /**
   * Касание: предмет стола сидя — его окно; издали — сесть за стол. Безделушка рядом — в руку, издали — подойти и взять.
   * Мебель — подойти и сделать дело. Предмет в руке — касание мимо кладёт его.
   */
  touch(aim: Aim | null): void {
    if (this.held && this.held.dir > 0) {
      if (!aim || aim.kind !== 'thing' || aim.thing.id !== this.held.id) this.drop();
      return;
    }
    if (!aim) return;
    if (aim.kind === 'folk') {
      this.life.callOver(aim.who);
      return;
    }
    if (aim.kind === 'cat') {
      this.petCat();
      return;
    }
    if (this.mode === 'act') return;
    if (aim.kind === 'poi') {
      if (aim.poi.id !== 'hall') this.intend({ kind: 'spot', id: aim.poi.id });
      return;
    }
    const t = aim.thing;
    const seated = this.mode === 'in' && this.act?.a.id === 'desk';
    if (!isTrinket(t)) {
      const desk = DESK_THINGS.find((x) => x.id === t.id);
      if (desk && seated) this.onUse?.(desk.door, desk.id);
      else this.intend({ kind: 'spot', id: 'desk' });
      return;
    }
    if (t.id === 'sword') {
      this.intend({ kind: 'spot', id: 'arms' });
      return;
    }
    if ((seated && t.poi === 'desk') || (this.mode === 'free' && this.canReach(t))) {
      this.take(t.id);
      return;
    }
    this.intend({ kind: 'take', id: t.id });
  }

  /** Дотянуться стоя: предмет у тела и перед ним. */
  private canReach(t: Thing): boolean {
    const b = t.box;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const dx = cx - this.pose.x;
    const dz = cz - this.pose.z;
    if (Math.hypot(dx, dz) > REACH) return false;
    return Math.abs(wrap(Math.atan2(dx, dz) - this.pose.yaw)) < 1.3;
  }

  /** Касание по предмету или месту дела: луч из глаза; мелкое раздувается до пальца на экране (`TAP_TARGET`). */
  pickAt(x: number, y: number): Aim | null {
    const r = this.rect;
    if (r.width < 1 || r.height < 1) return null;
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1));
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, this.camera);
    const RAY = caster.ray;
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
        // Мебель — позади предмета: предмет на столе берёт касание раньше стола.
        if (hit) consider({ kind: 'poi', poi: p }, V.distanceTo(RAY.origin) + 0.6, false);
      }
    }
    // Люди и кот (Г-7): точнее мебели — тело перед ней.
    const lp = this.life.pick(RAY);
    if (lp) consider(lp.kind === 'folk' ? { kind: 'folk', who: lp.who } : { kind: 'cat' }, lp.d, true);
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

  /** Точка на экране (точки CSS слоя): середина коробки или её верх. */
  private screenOf(b: Box | THREE.Box3 | THREE.Vector3, top = true): { x: number; y: number; on: boolean; dist: number } {
    if (b instanceof THREE.Vector3) V.copy(b);
    else if (b instanceof THREE.Box3) {
      b.getCenter(V);
      if (top) V.y = b.max.y;
    } else V.set((b.x0 + b.x1) / 2, top ? b.y1 : (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2).add(this.origin);
    const dist = V.distanceTo(this.camera.position);
    V.project(this.camera);
    const { w, h } = this.viewSize();
    return { x: ((V.x + 1) / 2) * w, y: ((1 - V.y) / 2) * h, on: V.z > -1 && V.z < 1 && Math.abs(V.x) < 1 && Math.abs(V.y) < 1, dist };
  }

  private viewSize(): { w: number; h: number } {
    return { w: this.labelHost?.clientWidth || this.rect.width, h: this.labelHost?.clientHeight || this.rect.height };
  }

  /**
   * Кому из вещей нужна подпись этим кадром (Г-6, слово владельца): подошёл близко (`Label.near` до ближней точки вещи)
   * и смотрит — точка подписи у середины кадра (`GAZE_IN`, уйдя дальше `GAZE_OUT` — гаснет; между ними — как была);
   * сидя за столом — все предметы стола на экране. Сквозь мебель (`OCCLUDERS`) — нет; с предметом в руке, в переходе
   * дела и у вещи под пальцем (у неё своя подпись) — нет.
   */
  labelWants(): boolean[] {
    const seated = this.mode === 'in' && this.act?.a.id === 'desk';
    const quiet = !!(this.held && this.held.dir > 0) || this.mode === 'act';
    const hoverId = this.hover?.kind === 'thing' ? this.hover.thing.id : null;
    const eye = this.camera.position;
    this.camera.getWorldDirection(V2);
    return LABELS.map((l, i) => {
      if (quiet || l.id === hoverId) return false;
      V.set(l.at[0], l.at[1], l.at[2]).add(this.origin);
      const s = this.screenOf(V);
      if (!s.on) return false;
      if (!(seated && l.desk)) {
        const b = l.box;
        const dx = Math.max(b.x0 - (eye.x - this.origin.x), 0, eye.x - this.origin.x - b.x1);
        const dy = Math.max(b.y0 - (eye.y - this.origin.y), 0, eye.y - this.origin.y - b.y1);
        const dz = Math.max(b.z0 - (eye.z - this.origin.z), 0, eye.z - this.origin.z - b.z1);
        if (Math.hypot(dx, dy, dz) > l.near) return false;
        V.set(l.at[0], l.at[1], l.at[2]).add(this.origin).sub(eye).normalize();
        const ang = Math.acos(clamp(V.dot(V2), -1, 1));
        if (ang > (this.tagFade[i].want ? GAZE_OUT : GAZE_IN)) return false;
      }
      return !this.occluded(l);
    });
  }

  /** Заслоняет ли мебель точку подписи от глаза: луч до неё проходит сквозь чужую коробку. */
  private occluded(l: Label): boolean {
    const e = this.camera.position;
    const ex = e.x - this.origin.x;
    const ey = e.y - this.origin.y;
    const ez = e.z - this.origin.z;
    const dx = l.at[0] - ex;
    const dy = l.at[1] - ey;
    const dz = l.at[2] - ez;
    for (const o of OCCLUDERS) {
      if (o.id === l.id) continue;
      const t = rayBox(ex, ey, ez, dx, dy, dz, o.box);
      if (t !== null && t < 0.985) return true;
    }
    return false;
  }

  /** Подписи этого кадра: кому нужны, раскладка без наложений в рамке экрана (ниже шапки, выше нижнего края). */
  layoutLabels(): TagOut[] {
    const { w, h } = this.viewSize();
    const wants = this.labelWants();
    const items = LABELS.map((l, i) => {
      V.set(l.at[0], l.at[1], l.at[2]).add(this.origin);
      const s = this.screenOf(V);
      const f = this.tagFade[i];
      // Уже видимые — первыми: пришедшая подпись не сгоняет стоящую; мелочь — раньше мебели под ней.
      return { id: l.id, text: l.name, ax: s.x, ay: s.y, dist: s.dist, on: s.on && (wants[i] || f.a > 0.01), rank: (f.a > 0.5 ? 0 : 100) + (isSmall(l) ? 0 : 10) + s.dist };
    });
    const out = layoutTags(items, { left: 6, top: 64, right: w - 6, bottom: h - 8 });
    out.forEach((t, i) => {
      this.tagFade[i].want = wants[i] && t.visible;
    });
    return out;
  }

  /** Подписи — плавно: проступают и гаснут за четверть секунды; не уместилась — гаснет сразу (поверх не ложится). */
  private fadeLabels(dt: number): void {
    this.tagsNow = this.layoutLabels();
    this.tagsNow.forEach((t, i) => {
      const f = this.tagFade[i];
      if (!t.visible) f.a = 0;
      else f.a = clamp(f.a + (f.want ? 1 : -1) * (dt / LABEL_FADE), 0, 1);
      t.visible = t.visible && f.a > 0.01;
      t.alpha = f.a;
    });
  }

  private labels(dt: number): void {
    this.fadeLabels(dt);
    const l = this.label;
    if (!l) return;
    const aim = this.hover;
    if (aim && this.mode !== 'act' && !(this.held && this.held.dir > 0)) {
      const box = aim.kind === 'thing' ? this.worldBox(aim.thing) : null;
      const hb = aim.kind === 'poi' ? aim.poi.hits[0] : null;
      const lv = aim.kind === 'folk' || aim.kind === 'cat' ? this.lifeTop(aim) : null;
      const s = box ? this.screenOf(box) : hb ? this.screenOf(hb) : lv ? this.screenOf(lv) : { x: 0, y: 0, on: false, dist: 0 };
      if (s.on) {
        const [name, small] = this.aimWords(aim);
        const key = `${name}:${small}`;
        if (l.dataset.k !== key) {
          l.innerHTML = `<b>${name}</b><small>${small}</small>`;
          l.dataset.k = key;
        }
        // Подпись не выходит за край экрана: середина — не ближе полуширины плашки (220 px, `chambers.css`) к краю.
        const w = this.viewSize().w;
        const x = Math.min(Math.max(s.x, 118), Math.max(118, w - 118));
        l.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(Math.max(s.y, 120))}px, 0)`;
        l.style.opacity = '1';
      } else l.style.opacity = '0';
    } else l.style.opacity = '0';
    this.tagsNow.forEach((t, i) => {
      const el = this.tagEls[i];
      if (!el) return;
      if (!t.visible) {
        for (const e of [el.box, el.dot, el.line]) if (e.style.visibility !== 'hidden') e.style.visibility = 'hidden';
        return;
      }
      const op = (t.alpha ?? 1).toFixed(2);
      for (const e of [el.box, el.dot, el.line]) e.style.opacity = op;
      el.box.style.visibility = '';
      el.box.style.fontSize = `${(TAG_FONT * t.scale).toFixed(1)}px`;
      el.box.style.transform = `translate3d(${Math.round(t.x - t.w / 2)}px, ${Math.round(t.y - t.h / 2)}px, 0)`;
      el.box.style.width = `${t.w}px`;
      el.dot.style.visibility = '';
      el.dot.style.transform = `translate3d(${Math.round(t.ax)}px, ${Math.round(t.ay)}px, 0)`;
      if (t.led) {
        // Черта от предмета к сдвинутой подписи.
        const dx = t.x - t.ax;
        const dy = t.y + t.h / 2 - t.ay;
        el.line.style.visibility = '';
        el.line.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
        el.line.style.transform = `translate3d(${Math.round(t.ax)}px, ${Math.round(t.ay)}px, 0) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      } else if (el.line.style.visibility !== 'hidden') el.line.style.visibility = 'hidden';
    });
    // Кружок пальца движения — под пальцем, ручка — куда его увели.
    const st = this.stickEl;
    if (st) {
      const s = this.sticks.stick;
      if (s) {
        st.dataset.on = '1';
        st.style.transform = `translate3d(${Math.round(s.ox)}px, ${Math.round(s.oy)}px, 0)`;
        const dx = clamp(s.x - s.ox, -40, 40);
        const dy = clamp(s.y - s.oy, -40, 40);
        (st.firstChild as HTMLElement).style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
      } else if (st.dataset.on !== '0') st.dataset.on = '0';
    }
  }

  /** Подпись того, что под пальцем: имя и что будет от касания. */
  private aimWords(aim: Aim): [string, string] {
    if (aim.kind === 'poi') return [aim.poi.name, aim.poi.verb];
    if (aim.kind === 'folk') return [FOLK_NAME[aim.who], 'Поговорить'];
    if (aim.kind === 'cat') {
      const c = this.life.cat;
      const near = !!c && Math.hypot(c.x - this.pose.x, c.z - this.pose.z) < 0.95;
      return ['Кот', near ? 'Погладить' : 'Позвать и погладить'];
    }
    const t = aim.thing;
    const seated = this.mode === 'in' && this.act?.a.id === 'desk';
    if (!isTrinket(t)) return [t.name, seated ? t.hint : 'Сесть за стол'];
    if (t.id === 'sword') return [t.name, this.held?.id === 'sword' ? t.hint : 'Взять меч со стены'];
    const near = (seated && t.poi === 'desk') || (this.mode === 'free' && this.canReach(t));
    return [t.name, near ? t.hint : 'Подойти и взять'];
  }

  // ---------- Город за окном (Г-7) ----------

  /**
   * Вошли в город: дальние деревья — со стволом. Ком кроны без ствола (вид сверху, ствола там не видно) из окна донжона
   * висел над землёй; изнутри ставится модель со стволом (`nature.treeModel`, `low`), выход возвращает прежнюю.
   */
  attach(group: THREE.Group): void {
    this.detach();
    for (const sp of ['broadFar', 'spruceFar'] as const) {
      const im = group.getObjectByName(`city-trees-${sp}`);
      if (!(im instanceof THREE.InstancedMesh)) continue;
      const low = geometryOf(treeModel(sp, DETAIL[this.level], true));
      this.trunks.push({ im, top: im.geometry, low });
      im.geometry = low;
    }
  }

  detach(): void {
    for (const t of this.trunks) {
      t.im.geometry = t.top;
      t.low.dispose();
    }
    this.trunks = [];
  }

  // ---------- Уровень и уборка ----------

  /** Сторож плавности опустил уровень (`CityScene.lowerTo`): меньше ламп и плашек огня. */
  setLevel(q: Quality): void {
    const order: Quality[] = ['high', 'medium', 'low'];
    if (order.indexOf(q) <= order.indexOf(this.level)) return;
    this.level = q;
    for (const m of [this.stone, this.cloth]) {
      m.defines.LIGHTS = LIGHTS_AT[q];
      if (q === 'low') {
        delete m.defines.FIRE_SHADOW;
        delete m.defines.BUMP;
      }
      m.needsUpdate = true;
    }
    this.fire.setLevel(q);
    this.handFire.setLevel(q);
  }

  /** Над головой человека или над котом — подписи касания (мир). */
  private lifeTop(aim: Aim): THREE.Vector3 | null {
    if (aim.kind === 'folk') {
      const p = this.life.personOf(aim.who);
      return p ? new THREE.Vector3(...p.rig.at('head', [0, 0.26, 0])).add(this.origin) : null;
    }
    const c = this.life.cat;
    return c?.visible ? new THREE.Vector3(c.x, c.y + 0.42, c.z).add(this.origin) : null;
  }

  /** Треугольники и вызовы комнаты — стенду и бюджету (с живыми, что сейчас в покоях). */
  counts(): { triangles: number; meshes: number } {
    let tris = 0;
    for (const m of this.meshes) tris += (m.geometry.index?.count ?? 0) / 3;
    const l = this.life.counts();
    return { triangles: Math.round(tris + this.body.triangles + l.triangles), meshes: this.meshes.length + 3 + l.meshes };
  }

  dispose(): void {
    this.attachLabels(null);
    for (const m of this.meshes) m.geometry.dispose();
    this.body.dispose();
    this.stone.dispose();
    this.cloth.dispose();
    this.atlas.dispose();
    for (const t of this.stoneTex) t.dispose();
    this.sky.mesh.geometry.dispose();
    this.sky.mat.dispose();
    this.fire.dispose();
    this.handFire.dispose();
    this.life.dispose();
    this.detach();
    this.wineMesh.geometry.dispose();
    this.scene.clear();
    this.sticks.clear();
    this.keys.clear();
    this.onChange = null;
    this.onUse = null;
    this.onEar = null;
    this.onCue = null;
    this.onLifeCue = null;
  }
}

/** Дверь в осях комнаты: середина проёма у пола внутренней грани. */
const DOOR_AT: [number, number, number] = [DOOR.x, 0, -HALF];

/** Гладь вина: диск радиуса 1 (масштаб — по уровню), лицом вверх; тёмно-красное, с бликом. */
function wineSurface(m: THREE.Material): THREE.Mesh {
  const b = new Mesher();
  b.shine = 0.55;
  const n = 14;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    b.tri([0, 0, 0], [Math.cos(a1), 0, Math.sin(a1)], [Math.cos(a0), 0, Math.sin(a0)], 'plain', tint(0x4a0a14));
  }
  const mesh = new THREE.Mesh(geometryOf(b.b), m);
  mesh.name = 'chambers-wine';
  mesh.visible = false;
  return mesh;
}

/** Плитка камня покоев: цвет и рельеф в одной текстуре, повтор без шва, мипы. Без страницы — один тон. */
function stoneTexture(data: Uint8Array<ArrayBuffer> | null, px: number, q: Quality): THREE.DataTexture {
  const t = data ? new THREE.DataTexture(data, px, px, THREE.RGBAFormat) : new THREE.DataTexture(new Uint8Array([150, 140, 128, 200]), 1, 1, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = q === 'low' ? 1 : 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Небо за окнами покоев: купол вокруг глаза, рисуется первым и без глубины — комната ложится поверх, город за окнами
 * встаёт поверх неба там, где он есть (`city/scene.draw`: второй проход без фона). Своя сфера, а не `SphereGeometry`:
 * новое имя три легло бы в кусок three первой загрузки (docs/city_v3.md, Г-4, решение 13).
 */
function skyDome(): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const R = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  const W = 24;
  const H = 12;
  for (let j = 0; j <= H; j++) {
    const v = (j / H) * Math.PI;
    for (let i = 0; i <= W; i++) {
      const u = (i / W) * Math.PI * 2;
      pos.push(Math.sin(v) * Math.cos(u) * R, Math.cos(v) * R, Math.sin(v) * Math.sin(u) * R);
    }
  }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const a = j * (W + 1) + i;
      idx.push(a, a + 1, a + W + 1, a + 1, a + W + 2, a + W + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZen: { value: new THREE.Color(0.3, 0.45, 0.8) },
      uHaze: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(0, 0, 0) },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZen;
      uniform vec3 uHaze;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform float uNight;
      varying vec3 vDir;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // У горизонта — дымка города (на ней тает его даль), выше — быстро в синеву.
        vec3 col = mix(uHaze, uZen, pow(smoothstep(-0.01, 0.32, h), 0.75));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunCol * (pow(s, 900.0) * 2.5 + pow(s, 24.0) * 0.16 + pow(s, 4.0) * 0.04);
        // Звёзды: ночью и в ясную погоду, выше дымки горизонта.
        float st = step(0.9972, hash(floor(d * 260.0)));
        col += vec3(0.85, 0.9, 1.0) * st * uNight * smoothstep(0.06, 0.3, h) * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'chambers-sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/** Смешать две позы кисти: запястье и оси — линейно, сгиб — долей. */
function blendHand(a: HandPose, b: HandPose, k: number): HandPose {
  const m = (p: readonly number[], q: readonly number[]): [number, number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  return { w: m(a.w, b.w), f: m(a.f, b.f), u: m(a.u, b.u), curl: a.curl + (b.curl - a.curl) * k, spread: (a.spread ?? 0.08) + ((b.spread ?? 0.08) - (a.spread ?? 0.08)) * k };
}
