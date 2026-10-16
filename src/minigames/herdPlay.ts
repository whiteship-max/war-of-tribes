/**
 * «Скот» в сцене: загон, стог, стадо и охапка в руках (docs/minigames.md, раздел 6; вид — docs/polish.md, П-4).
 *
 * Правило — в `herd.ts`: где бредёт животное, решает зерно и секунда игры; кто сколько съел — кормёжка. Здесь только
 * то, что видно, и оно правила не трогает ни числом:
 *
 *   идёт      — шаг кругом из шести поз по скорости правила (`roamSpeed`), коза на бегу переходит на рысь, ягнёнок —
 *               на скачки; тело качается в такт шагу;
 *   пасётся   — стоящее опускает голову к траве и жуёт, раз в несколько секунд поднимает и оглядывается;
 *   смотрит   — голодные поворачивают голову к человеку с охапкой: видно, кто ждёт;
 *   пугается  — человек налетел вплотную бегом: голова вверх, уши торчком, хвост дёрнулся, скачок на месте;
 *   ест и ложится — накормленное тянется к охапке и жуёт, сытое ложится: сперва на запястья, потом задом, и лёжа
 *               дышит, жуёт жвачку и прядает ушами.
 *
 * Порода — копиями одной сетки (`fauna.Pack`): четыре овцы — один вызов отрисовки, их тень — второй. Все позы —
 * морфы этой сетки (`beasts.posture`).
 */
import * as THREE from 'three';
import type { Surfaces } from '@/prologue/surface';
import { Shade, blob } from '@/prologue/models';
import type { Blocker } from '@/prologue/glade';
import { BEASTS, Feed, HAY, LAMB_WORTH, PEN_R, herdBonusMax, herdOf, roamAt, roamSpeed, roamYaw, type BeastKind, type Herd } from './herd';
import { armful, hayMesh, penMesh } from './models';
import type { Tally, Target } from './rules';
import type { Play } from './stage';
import { Sparks } from './sparks';
import { armfulArms, viewMaterial } from './hands';
import { fieldSound, type FieldSound } from './miniSound';
import { Moves, Pack, placeBeast, smooth } from './fauna';
import { STILL, model, posture, type Detail, type Model, type Posture } from './beasts';
import { HAIR, HIDE, WOOL, furMaterial, type FurLook } from './fur';
import type { Tier } from '@/prologue/look';
import type { Season } from '@/game/types';
import { NatureMats } from './nature';
import { DENSITY, penLand } from './places';

/** Сено в горсти: соломенное, светлое и выгоревшее — как у стога (`models.hayMesh`). */
const HAY_BITS = [0xd8b860, 0xc9a24a, 0xe8d08a, 0xb89440];

/** Где охапка в кадре: внизу посередине, чуть справа, — в руках. */
const ARMFUL_AT = { x: 0.1, y: -0.5, z: -0.78 };

/** Шерсть породы. */
const LOOK: Record<BeastKind, FurLook> = { sheep: WOOL, lamb: WOOL, goat: HAIR, cow: HIDE };

/** Длина шага породы, м на круг из шести поз: корова шагает широко, ягнёнок семенит. */
const STRIDE: Record<BeastKind, number> = { sheep: 0.62, goat: 0.72, cow: 1.15, lamb: 0.5 };
/** С какой скорости порода бежит (рысь, скачки), м/с; корова и овца в загоне не бегают. */
const RUN_FROM: Record<BeastKind, number> = { sheep: 9, goat: 1.15, cow: 9, lamb: 1.0 };
/** Длина круга бега, м. */
const RUN_STRIDE: Record<BeastKind, number> = { sheep: 1, goat: 1.25, cow: 1, lamb: 0.85 };
/** Насколько опускается шея к траве. */
const GRAZE: Record<BeastKind, number> = { sheep: 0.95, goat: 0.8, cow: 0.85, lamb: 0.9 };

/** Тон шерсти копии: у каждой овцы своя белизна, у козы — своя рыжина. Множитель цвета модели. */
const TINTS: Record<BeastKind, readonly number[]> = {
  sheep: [0xffffff, 0xf2ece2, 0xfff8ec, 0xe8e2d8],
  lamb: [0xffffff],
  goat: [0xffffff, 0xc8b8a8, 0xf0dcc8],
  cow: [0xffffff],
};

/** Ближе этого человек бегом — испуг; не чаще раза в столько секунд. */
const SCARE_R = 1.05;
const SCARE_EVERY = 6;
/** Сколько ест охапку и когда сытое ложится. */
const EAT_S = 1.5;
const LIE_FROM = 1.15;
const LIE_S = 1.5;

/** Чистое «случайное» число копии: ритм пастьбы и ушей у каждой свой, без `Math.random`. */
const hash = (i: number, k: number): number => {
  const s = Math.sin(i * 91.7 + k * 47.3) * 43758.5453;
  return s - Math.floor(s);
};

/** Значок «сколько ещё»: охапки точками на тёмной плашке. Печётся один раз на число. */
function needCanvas(n: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  if (!g) return c;
  const w = 24 + n * 30;
  const x0 = (128 - w) / 2;
  g.fillStyle = 'rgba(28, 24, 20, 0.78)';
  // Пилюля дугами, а не `roundRect`: его нет в старых вебвью.
  g.beginPath();
  g.arc(x0 + 18, 24, 18, Math.PI / 2, (Math.PI * 3) / 2);
  g.arc(x0 + w - 18, 24, 18, -Math.PI / 2, Math.PI / 2);
  g.closePath();
  g.fill();
  for (let i = 0; i < n; i++) {
    g.fillStyle = '#e0b860';
    g.beginPath();
    g.arc(x0 + 27 + i * 30, 24, 10, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Что делает копия — то, что вид помнит между кадрами. В правило не идёт ничего. */
interface Life {
  phase: number;
  walk: number;
  run: number;
  graze: number;
  turn: number;
  neck: number;
  scaredAt: number;
  /** Откуда налетел человек: туда голова. */
  scareFrom: { x: number; z: number };
  /** Когда ела последнюю охапку, секунды сцены. */
  ateAt: number;
  slot: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/** Угол к точке `(x, z)` в осях зверя, смотрящего по `yaw`: плюс — влево (к его +X). */
function bearing(yaw: number, fx: number, fz: number, x: number, z: number): number {
  const dx = x - fx;
  const dz = z - fz;
  const lx = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const lz = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
  return Math.atan2(lx, lz);
}

export class HerdPlay implements Play {
  /** Утро позже, чем у ягод: солнце выше леса, загон на свету. */
  readonly solar = 0.17;
  /** У стога сбоку от него, лицом к овечьей куче: стадо в кадре с первой секунды, стог взгляду не мешает. */
  readonly start: { x: number; z: number; yaw: number };
  /** Изнутри к жердям ближе не подойти. */
  readonly roam = PEN_R - 0.45;
  /** Загон с жердями. */
  readonly shadowHalf = PEN_R + 1;
  readonly herd: Herd;
  private feed: Feed;
  private packs = new Map<BeastKind, { pack: Pack; model: Model; moves: Moves }>();
  private lives: Life[] = [];
  private blobs: THREE.InstancedMesh | null = null;
  private marks: THREE.Sprite[] = [];
  private needTex: THREE.Texture[] = [];
  private pose: Posture = { ...STILL };
  private camera: THREE.Camera | null = null;
  private walkingNow = 0;
  private lastT = 0;
  /** Охапка в руках: копна сена и руки под ней — вещь взгляда, висит на камере. */
  private hands: THREE.Group | null = null;
  private armfulMesh: THREE.Mesh | null = null;
  private arms: THREE.Mesh | null = null;
  private sway = 0;
  private sparks = new Sparks(0.055);
  private sound: FieldSound | null = null;

  /** Отклики, случившиеся сами: ягнёнок в загоне — на «Начать». */
  private notes: string[] = [];

  /** Подробность лепки (`beasts.Detail`): сцена выбирает её по ступени (`dress`). */
  private detail: Detail = 'hi';

  constructor(seed: number) {
    // Редкий ягнёнок — раз в три выхода (`herd.LAMB_P`).
    this.herd = herdOf(seed, { rare: true });
    this.feed = new Feed(this.herd);
    const flock = roamAt(this.herd, this.herd.beasts[0], 0);
    const a = Math.atan2(flock.z, flock.x) + Math.PI / 2;
    const x = Math.cos(a) * (HAY.r + 1.1);
    const z = Math.sin(a) * (HAY.r + 1.1);
    this.start = { x, z, yaw: Math.atan2(-(flock.x - x), -(flock.z - z)) };
  }

  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, camera: THREE.Camera): void {
    this.camera = camera;
    this.mats ??= new NatureMats(surfaces.u);
    scene.add(penMesh(this.mats.of('bark')), hayMesh(this.mats.of('bark')));
    shade.add(HAY.x, HAY.z, HAY.r * 1.5, HAY.r * 1.5);
    const browser = typeof document !== 'undefined';
    if (browser) for (let n = 1; n <= 3; n++) this.needTex.push(new THREE.CanvasTexture(needCanvas(n)));
    // Породы: по копии сетки на каждое животное, шерсть — одна на породу (руно у овцы и ягнёнка общее).
    const mats = new Map<FurLook, THREE.Material>();
    const count = new Map<BeastKind, number>();
    for (const b of this.herd.beasts) count.set(b.kind, (count.get(b.kind) ?? 0) + 1);
    for (const [kind, n] of count) {
      const look = LOOK[kind];
      let mat = mats.get(look);
      if (!mat) {
        mat = furMaterial(look, surfaces.u);
        mats.set(look, mat);
      }
      const m = model(kind, this.detail);
      const pack = new Pack(m, mat, n, kind);
      this.packs.set(kind, { pack, model: m, moves: new Moves(m.slots, m.count) });
      scene.add(pack.mesh);
    }
    const seen = new Map<BeastKind, number>();
    this.herd.beasts.forEach((b, i) => {
      const slot = seen.get(b.kind) ?? 0;
      seen.set(b.kind, slot + 1);
      const tints = TINTS[b.kind];
      this.packs.get(b.kind)!.pack.setTint(slot, _c.setHex(tints[slot % tints.length]));
      this.lives.push({ phase: hash(i, 1), walk: 0, run: 0, graze: 0, turn: 0, neck: 0, scaredAt: -1e9, scareFrom: { x: 0, z: 0 }, ateAt: -1e9, slot });
      // Без страницы (счёт бюджета в тесте) холста нет — значок встаёт без рисунка, но встаёт: вызов тот же.
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.needTex[BEASTS[b.kind].need - 1] ?? null, depthWrite: false, fog: false, toneMapped: false }));
      s.scale.set(0.62, 0.23, 1);
      scene.add(s);
      this.marks.push(s);
    });
    // Пятна тени у ног — одним мешем копиями: под каждым своё, по его толщине.
    const one = blob(1, 1);
    this.blobs = new THREE.InstancedMesh(one.geometry, one.material, this.herd.beasts.length);
    this.blobs.name = 'herdBlobs';
    this.blobs.frustumCulled = false;
    scene.add(this.blobs);
    // Охапку несут руками: кисти в перчатках снизу у её краёв, рукава уходят к нижним углам кадра (`hands.ts`).
    const carry = new THREE.Group();
    carry.name = 'carry';
    this.armfulMesh = armful();
    this.armfulMesh.scale.setScalar(0.7);
    this.arms = new THREE.Mesh(armfulArms(), viewMaterial());
    this.arms.name = 'arms';
    this.arms.castShadow = false;
    for (const o of [this.armfulMesh, this.arms]) {
      o.frustumCulled = false;
      carry.add(o);
    }
    carry.position.set(ARMFUL_AT.x, ARMFUL_AT.y, ARMFUL_AT.z);
    carry.visible = false;
    camera.add(carry);
    this.hands = carry;
    scene.add(this.sparks.points);
    this.frame(0, 0, 0);
  }

  /** Ступень входа: сколько травы и подробность деревьев (`places.DENSITY`). */
  private tier: Tier = 'lite';
  private mats: NatureMats | null = null;

  /** Подробность лепки по ступени: загон рядом — `hi`, пол телефона — `lo`. Зовётся до `build`. */
  dress(tier: Tier): void {
    this.tier = tier;
    this.detail = tier === 'base' ? 'lo' : 'hi';
  }

  /** Луг вокруг загона (`places.penLand`): выбитая земля внутри, луг и лес снаружи, колода и навес за жердями. */
  land(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, season: Season): void {
    this.mats = new NatureMats(surfaces.u);
    penLand({ scene, mats: this.mats, shade, season, density: DENSITY[this.tier], seed: 2207, keep: [{ x: HAY.x, z: HAY.z, r: HAY.r + 0.2 }] }, PEN_R, HAY.r);
  }

  begin(): void {
    this.sound ??= fieldSound();
    this.sound.arm();
    if (this.herd.beasts.some((b) => b.kind === 'lamb')) this.notes.push('В загоне ягнёнок — накорми и его');
  }

  say(): string {
    return this.notes.shift() ?? '';
  }

  rest(): string {
    return this.feed.carrying ? 'Накормить' : 'Взять охапку';
  }

  tick(): void {
    this.sound?.tick();
  }

  blockers(t: number): Blocker[] {
    const out: Blocker[] = [{ x: HAY.x, z: HAY.z, r: HAY.r }];
    this.herd.beasts.forEach((b, i) => {
      const p = this.feed.at(i, t);
      out.push({ x: p.x, z: p.z, r: BEASTS[b.kind].r * 0.8 });
    });
    return out;
  }

  /** Без охапки трогать можно только стог; с охапкой — только голодных. */
  targets(t: number): Target[] {
    if (!this.feed.carrying) return [{ id: -1, x: HAY.x, z: HAY.z, r: HAY.r, verb: 'Взять охапку' }];
    const out: Target[] = [];
    this.herd.beasts.forEach((b, i) => {
      if (this.feed.sated(i)) return;
      const p = this.feed.at(i, t);
      out.push({ id: i, x: p.x, z: p.z, r: BEASTS[b.kind].r, verb: `Накормить ${BEASTS[b.kind].name}` });
    });
    return out;
  }

  tap(target: Target, t: number): string {
    if (target.id < 0) {
      if (!this.feed.take()) return '';
      this.sound?.take();
      // Охапка из стога: сено летит с его бока, к человеку.
      this.sparks.burst(HAY.x, HAY.r * 0.9, HAY.z, { colors: HAY_BITS, n: 14, speed: 1.6, up: 0.6, gravity: 2.4, life: 1.3, drag: 2.2 });
      return 'Охапка в руках';
    }
    const b = this.herd.beasts[target.id];
    if (!b || !this.feed.feed(target.id, t)) return '';
    const left = BEASTS[b.kind].need - this.feed.given[target.id];
    this.sound?.feed(b.kind, left <= 0);
    const life = this.lives[target.id];
    if (life) life.ateAt = t;
    if (b.kind === 'lamb') return `Ягнёнок сыт · сверху +${LAMB_WORTH}`;
    // Сено у морды: где животное стоит в эту секунду, на высоте спины.
    const p = this.feed.at(target.id, t);
    const back = this.packs.get(b.kind)?.model.back ?? 0.7;
    this.sparks.burst(p.x, back * 0.75, p.z, { colors: HAY_BITS, n: 10, speed: 1.1, up: 0.7, gravity: 2.4, life: 1.1, drag: 2.2 });
    return left > 0 ? `Ещё ${left}` : 'Сыта';
  }

  frame(t: number, dt: number, walking: number): void {
    this.walkingNow = walking;
    const cam = this.camera;
    const hx = cam?.position.x ?? this.start.x;
    const hz = cam?.position.z ?? this.start.z;
    // Время вида — кадровое, а не игровое: до «Начать» стадо живёт так же (пасётся, дышит), а `t` стоит.
    const clock = (this.lastT += dt);
    this.herd.beasts.forEach((b, i) => this.beast(b.kind, i, t, dt, clock, hx, hz));
    for (const p of this.packs.values()) p.pack.commit();
    if (this.blobs) this.blobs.instanceMatrix.needsUpdate = true;
    this.sparks.frame(dt);
    const h = this.hands;
    if (h) {
      h.visible = this.feed.carrying;
      this.sway += dt * 9 * walking;
      h.position.y = ARMFUL_AT.y - Math.abs(Math.sin(this.sway * 0.5)) * 0.02 * walking;
      h.position.x = ARMFUL_AT.x + Math.sin(this.sway * 0.5) * 0.014 * walking;
    }
  }

  /** Одно животное за кадр: поза из правила и того, что рядом человек, — в морфы и матрицу копии. */
  private beast(kind: BeastKind, i: number, t: number, dt: number, clock: number, hx: number, hz: number): void {
    const b = this.herd.beasts[i];
    const P = this.packs.get(kind);
    const L = this.lives[i];
    if (!P || !L) return;
    const m = P.model;
    const sated = this.feed.sated(i);
    const fedAt = this.feed.fedAt[i];
    const at = fedAt ?? t;
    const p = this.feed.at(i, t);
    const yaw = roamYaw(this.herd, b, at);
    const speed = sated ? 0 : roamSpeed(this.herd, b, t);
    const k = Math.min(1, dt * 6);
    const pose = this.pose;
    Object.assign(pose, STILL);
    // Шаг: размах — по скорости, фаза — по пройденному: ноги не скользят по земле.
    const runTo = smooth(RUN_FROM[kind], RUN_FROM[kind] + 0.5, speed);
    L.run += (runTo - L.run) * k;
    L.walk += (smooth(0.04, 0.45, speed) - L.walk) * k;
    const stride = STRIDE[kind] * (1 - L.run) + RUN_STRIDE[kind] * L.run;
    L.phase += (speed * dt) / stride;
    pose.walk = L.walk;
    pose.run = L.run;
    pose.phase = L.phase;
    const dist = Math.hypot(hx - p.x, hz - p.z);
    const toMan = bearing(yaw, p.x, p.z, hx, hz);
    // Испуг: человек налетел бегом вплотную.
    if (!sated && this.walkingNow > 0.55 && dist < BEASTS[kind].r + SCARE_R && clock - L.scaredAt > SCARE_EVERY) {
      L.scaredAt = clock;
      L.scareFrom = { x: hx, z: hz };
    }
    const since = clock - L.scaredAt;
    const fright = since < 2.2 ? Math.exp(-since / 0.8) * smooth(0, 0.08, since) : 0;
    const hop = since < 0.4 ? Math.sin((since / 0.4) * Math.PI) * 0.07 * (kind === 'cow' ? 0.4 : 1) : 0;
    // Пастьба: стоящее опускает голову, раз в несколько секунд поднимает и оглядывается.
    const period = 7 + 5 * hash(i, 3);
    const ph = (clock + hash(i, 4) * period) % period;
    const glance = ph < 2.2 ? smooth(0, 0.35, ph) * smooth(2.2, 1.8, ph) : 0;
    const hungry = !sated;
    const watching = hungry && this.feed.carrying && dist < 4.5 ? smooth(4.5, 2.5, dist) : 0;
    const grazeTo = hungry ? (1 - L.walk * 0.85) * (1 - glance) * (1 - watching) * (1 - fright) : 0;
    L.graze += (grazeTo - L.graze) * Math.min(1, dt * 2.5);
    // Голова: к траве, к человеку с охапкой, к тому, откуда напугали, или оглядывается.
    const scareTurn = fright > 0 ? Math.max(-0.9, Math.min(0.9, bearing(yaw, p.x, p.z, L.scareFrom.x, L.scareFrom.z))) : 0;
    const idleTurn = Math.sin(clock * 0.37 + i * 2.1) * 0.35 * glance;
    const want = Math.max(-0.85, Math.min(0.85, toMan));
    const turnTo = watching > 0 ? want * watching : fright > 0 ? scareTurn : idleTurn;
    L.turn += (turnTo - L.turn) * Math.min(1, dt * 4);
    // Ест: тянется к человеку и жуёт; сытое после еды ложится.
    const eat = t - L.ateAt >= 0 && t - L.ateAt < EAT_S ? smooth(0, 0.2, t - L.ateAt) * smooth(EAT_S, EAT_S - 0.3, t - L.ateAt) : 0;
    const lie = sated && fedAt !== null ? smooth(fedAt + LIE_FROM, fedAt + LIE_FROM + LIE_S, t) : 0;
    const neckTo = GRAZE[kind] * L.graze - 0.22 * fright - 0.12 * watching + 0.45 * eat - 0.1 * lie;
    L.neck += (neckTo - L.neck) * Math.min(1, dt * 5);
    pose.neck = L.neck;
    pose.head = 0.25 * L.graze + 0.1 * eat;
    pose.turn = L.turn * (1 - eat) + (eat > 0 ? want * eat : 0);
    pose.chew = (L.graze > 0.6 ? 0.5 + 0.5 * Math.sin(clock * 9 + i) : 0) * L.graze + eat * (0.5 + 0.5 * Math.sin(clock * 13)) + lie * Math.max(0, Math.sin(clock * 4 + i)) * 0.6;
    // Уши прядают раз в несколько секунд; испуг и интерес — торчком.
    const flickP = 3 + 4 * hash(i, 5);
    const fl = (clock + hash(i, 6) * flickP) % flickP;
    pose.ears = (fl < 0.25 ? Math.sin((fl / 0.25) * Math.PI) * 0.7 : 0) - 0.9 * Math.max(fright, watching * 0.6);
    // Хвост: корова отмахивается, коза и овца — дёргают; испуг — вверх.
    const swish = kind === 'cow' ? 0.5 * Math.sin(clock * 1.6 + i) : 0.25 * Math.sin(clock * (5 + 3 * hash(i, 7))) * (0.3 + 0.7 * L.walk);
    pose.tailSwish = swish;
    pose.tailUp = 0.6 * fright + (kind === 'goat' ? 0.15 : 0);
    pose.breathe = 0.5 + 0.5 * Math.sin(clock * (lie > 0.5 ? 1.4 : 1.9) + i);
    pose.fold = lie;
    posture(P.moves, pose);
    // Тело: качка шага, скачок испуга, лёжка — ниже на длину подогнутых ног, перед — первым.
    const bob = Math.abs(Math.sin(L.phase * Math.PI * 2)) * (0.012 + 0.03 * L.run) * L.walk;
    const front = smooth(0, 0.62, lie);
    const rear = smooth(0.32, 1, lie);
    const low = m.lie * (front * 0.55 + rear * 0.45);
    const pitch = 0.16 * (front - rear) - 0.05 * fright + 0.04 * L.run * Math.sin(L.phase * Math.PI * 4);
    placeBeast(_m, p.x, bob + hop - low, p.z, yaw, pitch, 0.02 * Math.sin(L.phase * Math.PI * 2) * L.walk, m.core);
    P.pack.put(L.slot, _m, P.moves.k);
    // Пятно тени — по толщине породы; у лежащей шире.
    if (this.blobs) {
      const r = BEASTS[kind].r;
      _q.setFromEuler(_e.set(0, yaw, 0));
      _p.set(p.x, 0, p.z);
      _s.set(r * 1.15 * (1 + 0.2 * lie), 1, r * 2 * (1 + 0.05 * lie));
      _m.compose(_p, _q, _s);
      _s.set(1, 1, 1);
      this.blobs.setMatrixAt(i, _m);
    }
    const mark = this.marks[i];
    if (mark) {
      const left = BEASTS[kind].need - this.feed.given[i];
      mark.visible = !sated && left > 0;
      if (mark.visible) {
        mark.position.set(p.x, m.back + 0.5 + bob + hop, p.z);
        const tex = this.needTex[left - 1] ?? null;
        const mat = mark.material;
        if (mat.map !== tex) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      }
    }
  }

  tally(): Tally {
    return { got: this.feed.got, total: this.herd.total, bonus: this.feed.bonus, bonusMax: herdBonusMax(this.herd) };
  }

  dispose(): void {
    this.mats?.dispose();
    this.sparks.dispose();
    for (const s of this.marks) s.material.dispose();
    for (const tex of this.needTex) tex.dispose();
    // Руно у овцы и ягнёнка — один материал на две породы: разобрать его один раз.
    const mats = new Set<THREE.Material>();
    for (const p of this.packs.values()) {
      mats.add(p.pack.mesh.material as THREE.Material);
      p.pack.dispose();
    }
    for (const m of mats) m.dispose();
    this.blobs?.dispose();
    this.hands?.removeFromParent();
    this.armfulMesh?.geometry.dispose();
    this.arms?.geometry.dispose();
    (this.arms?.material as THREE.Material | undefined)?.dispose();
  }
}
