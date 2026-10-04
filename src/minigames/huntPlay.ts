/**
 * «Охота» в сцене: поле, олени, лук в руках и стрелы (docs/minigames.md, раздел 13).
 *
 * Правило — в `hunt.ts`: где олени, что они слышат, куда летит стрела и во что втыкается — зерно, секунда игры и
 * то, что сделал игрок. Здесь только то, что видно и слышно: олень пасётся и вскидывает голову, бежит скачками,
 * падает; лук поднимается, тетива тянется к скуле, стрела летит дугой и остаётся торчать там, где легла, —
 * по воткнувшимся и учатся брать поправку.
 *
 * Палец во взгляде — тетива: лёг — тянет, ведёт — целится (взгляд вдвое тише), снят — выстрел. Сцена отдаёт эти
 * касания сюда (`Play.draw`, `Play.loose`); стик шага остаётся у левой руки — подкрадываться.
 *
 * Своим куском (`Minigame.tsx` грузит его по «На охоту»): «Ягоды» и «Скот» его не качают.
 */
import * as THREE from 'three';
import type { Surfaces } from '@/prologue/surface';
import { BOW_TIP, Shade, arrow as arrowModel, blob, bow as bowModel, bowLimb, carcass as carcassModel, deer as deerModel } from '@/prologue/models';
import type { Blocker } from '@/prologue/glade';
import type { Season } from '@/game/types';
import { haptic } from '@/telegram/webapp';
import { tufts } from './models';
import {
  ARROWS,
  CARCASS,
  DEER,
  DEER_BODY,
  GRAVITY,
  HOP_S,
  Hunt,
  ROAM_R,
  RUN_SPEED,
  START,
  coverRadius,
  flightAt,
  pins,
  type Arrow,
  type HuntEvent,
} from './hunt';
import { arrowsMesh, coverMesh, forestWall, meadowGround } from './huntModels';
import { huntSound, type Ear, type HuntSound, type ThudKind } from './huntSound';
import type { Tally, Target } from './rules';
import type { Play } from './stage';

/** Лук у камеры: во сколько раз меньше своего. Ближе — закрыл бы полкадра, дальше — не читался бы луком. */
const BOW_SCALE = 0.5;
/**
 * Где лук, опущенный и вскинутый, в осях камеры: положение и наклон. Опущенный — внизу слева, плечом в кадр; вскинутый
 * — левее середины и почти не завален: стрела на нём смотрит вдоль взгляда, и её линия сходится в прицел.
 */
const BOW_REST = { x: -0.2, y: -0.36, z: -0.62, rx: 0.3, ry: 0.25, rz: 0.75 };
const BOW_AIM = { x: -0.12, y: -0.1, z: -0.75, rx: 0, ry: 0, rz: 0.18 };
/** Насколько тетива уходит к стрелку в полную натяжку, в осях лука: хвост стрелы — в кадре, а не у самого глаза. */
const PULL = 0.55;
/** Хвост стрелы от её середины — по модели (`models.arrow`: древко 0,68). */
const ARROW_TAIL = 0.34;
/** Насколько уже угол обзора в полную натяжку: приближение лука — олень на тридцати шагах крупнее, метки дальше. */
const ZOOM = 0.3;
/** Взгляд с натянутым луком тише вдвое с лишним; шаг — медленнее. */
const AIM_LOOK = 0.45;
const AIM_STRIDE = 0.4;
/** Сколько длится падение подстреленного, прежде чем лечь тушей. */
const FALL_S = 0.45;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _d = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, -1);
const _up = new THREE.Vector3(0, 1, 0);
const _cord = new THREE.Vector3();
const _e = new THREE.Euler();

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (k: number): number => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

/** Что сказать над прицелом, когда стрела легла. */
const LANDED: Record<string, string> = { ground: 'Мимо', cover: 'В дерево', bush: 'В куст', lost: 'Улетела', deer: 'В тушу' };

export class HuntPlay implements Play {
  /** Утро: солнце над лесом, роса — тот час, когда выходят на опушку. */
  readonly solar = 0.13;
  readonly start = { ...START };
  readonly roam = ROAM_R;
  /** Тени — у ближних укрытий и оленей; дальше их съедает дымка, а коробка вдвое шире размыла бы ближние. */
  readonly shadowHalf = 26;
  readonly fog = { near: 28, far: 115 };
  readonly far = 150;
  readonly focus = 70;
  readonly hunt: Hunt;
  private sound: HuntSound | null = null;
  private camera: THREE.Camera | null = null;
  private deer: THREE.Group[] = [];
  private heads: THREE.Object3D[] = [];
  private legsF: THREE.Object3D[] = [];
  private legsB: THREE.Object3D[] = [];
  private carcasses: THREE.Mesh[] = [];
  private headAt: number[] = [];
  private beat: number[] = [];
  private blobs: THREE.InstancedMesh | null = null;
  private arrows: THREE.InstancedMesh | null = null;
  private bowRig: THREE.Mesh | null = null;
  private cords: THREE.Mesh[] = [];
  private nock: THREE.Mesh | null = null;
  private raise = 0;
  private drawShown = 0;
  private notes: string[] = [];
  private blockers_: Blocker[];
  private pins_ = pins();
  private walking = 0;
  /** Сезон города — от земли (`land`): листва берёз и кустов. */
  private season: Season = 'summer';

  constructor(seed: number) {
    this.hunt = new Hunt(seed);
    this.blockers_ = this.hunt.field.cover.map((c) => ({ x: c.x, z: c.z, r: coverRadius(c) }));
  }

  land(scene: THREE.Scene, surfaces: Surfaces, _shade: Shade, season: Season): void {
    this.season = season;
    // Трава — вокруг охотника, где её видно; не в кустах и не под елями.
    const keep = this.blockers_.map((b) => ({ x: b.x, z: b.z, r: b.r * 0.8 }));
    scene.add(
      surfaces.adopt(meadowGround(season)),
      surfaces.adopt(forestWall(), 'crown'),
      surfaces.adopt(tufts(season, keep, { count: 520, from: 0.6, to: 24, x: START.x, z: START.z - 6 }), 'tuft'),
    );
  }

  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, camera: THREE.Camera): void {
    this.camera = camera;
    scene.add(surfaces.adopt(coverMesh(this.hunt.field.cover, this.season, shade), 'crown'));
    for (let i = 0; i < DEER; i++) {
      // Оленуха — без рогов (`DeerSpec.doe`): у неё та же модель и тот же корпус для стрелы, рогов стрела не видит.
      const doe = this.hunt.field.deer[i].doe;
      const d = surfaces.adopt(deerModel(!doe));
      d.rotation.order = 'YXZ';
      this.heads.push(d.getObjectByName('head') ?? new THREE.Object3D());
      this.legsF.push(d.getObjectByName('legsFront') ?? new THREE.Object3D());
      this.legsB.push(d.getObjectByName('legsBack') ?? new THREE.Object3D());
      for (const leg of [this.legsF[i], this.legsB[i]]) (leg as THREE.Mesh).castShadow = false;
      scene.add(d);
      this.deer.push(d);
      const c = surfaces.adopt(carcassModel(!doe));
      c.visible = false;
      scene.add(c);
      this.carcasses.push(c);
      this.headAt.push(this.hunt.pose(i, 0).head);
      this.beat.push(0);
    }
    // Пятна тени под оленями — одним мешем копиями: шесть пятен — один вызов.
    const b = blob(0.42, 0.82);
    this.blobs = new THREE.InstancedMesh(b.geometry, b.material, DEER);
    this.blobs.name = 'deerBlobs';
    this.blobs.frustumCulled = false;
    scene.add(this.blobs);
    const one = arrowModel();
    this.arrows = arrowsMesh(one, ARROWS);
    one.geometry.dispose();
    scene.add(this.arrows);
    this.buildBow(camera);
    this.frame(0, 0, 0);
  }

  /**
   * Лук: дуга, тетива двумя плечами и стрела на тетиве. Рук нет нарочно: кулак кубом у самой камеры читался не рукой,
   * а ящиком поверх кадра (снимок стенда), а рук предыстории здесь не взять — они живут в её сцене.
   */
  private buildBow(camera: THREE.Camera): void {
    const b = bowModel(false);
    b.scale.setScalar(BOW_SCALE);
    b.castShadow = false;
    b.receiveShadow = false;
    for (let i = 0; i < 2; i++) {
      const limb = bowLimb();
      b.add(limb);
      this.cords.push(limb);
    }
    const nock = arrowModel();
    nock.scale.setScalar(1 / BOW_SCALE);
    nock.visible = false;
    b.add(nock);
    this.nock = nock;
    // Лук — вещь взгляда, а не мира: рисуется поверх всего и не режется ближней плоскостью о траву под ногами.
    b.traverse((o) => {
      o.renderOrder = 5;
      o.frustumCulled = false;
    });
    camera.add(b);
    this.bowRig = b;
  }

  blockers(): Blocker[] {
    return this.blockers_;
  }

  /** Тапом на охоте не трогают ничего: лук целится, а не досягает. */
  targets(): Target[] {
    return [];
  }

  tap(): string {
    return '';
  }

  begin(): void {
    this.sound ??= huntSound();
    this.sound.arm();
  }

  draw(t: number): void {
    this.hunt.pull(t);
  }

  loose(t: number, shoot: boolean): void {
    const cam = this.camera;
    if (!shoot || !cam) {
      this.hunt.slack();
      return;
    }
    if (!this.hunt.pulling) return;
    const drawn = this.hunt.drawn(t);
    cam.getWorldDirection(_d);
    const a = this.hunt.loose(t, { x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: _d.x, y: _d.y, z: _d.z });
    if (!a) {
      if (this.hunt.quiver > 0 && drawn > 0) this.notes.push('Натяни сильнее');
      return;
    }
    haptic('light');
    this.sound?.twang(drawn);
    // Свист — вдоль полёта: где стрела будет через полсекунды.
    const mid = flightAt(a, 0.5);
    this.sound?.whistle(0.9, this.ear(), mid.x, mid.z);
    if (this.hunt.quiver === 0) this.notes.push('Последняя стрела');
  }

  lookScale(): number {
    return this.hunt.pulling ? AIM_LOOK : 1;
  }

  stride(): number {
    return this.hunt.pulling ? AIM_STRIDE : 1;
  }

  zoom(): number {
    return 1 - ZOOM * this.drawShown;
  }

  drawn(): number {
    return this.hunt.drawn();
  }

  pins(): readonly { d: number; angle: number }[] {
    return this.pins_;
  }

  aside(): string {
    return `Стрел ${this.hunt.quiver}`;
  }

  say(): string {
    return this.notes.shift() ?? '';
  }

  over(t: number): boolean {
    return this.hunt.over(t);
  }

  /** Ухо охотника: где камера и куда её правая рука. */
  private ear(): Ear {
    const cam = this.camera;
    if (!cam) return { x: START.x, z: START.z, rx: 1, rz: 0 };
    cam.getWorldDirection(_d);
    const len = Math.hypot(_d.x, _d.z) || 1;
    return { x: cam.position.x, z: cam.position.z, rx: -_d.z / len, rz: _d.x / len };
  }

  frame(t: number, dt: number, walking: number): void {
    const cam = this.camera;
    this.walking = walking * this.stride();
    if (cam) this.hunt.advance(t, { x: cam.position.x, z: cam.position.z, walking: this.walking });
    this.react(this.hunt.takeEvents());
    this.syncDeer(t, dt);
    this.syncArrows(t);
    this.syncBow(dt);
  }

  /** Что случилось за кадр: звук, подпись, отклик рукой. */
  private react(events: readonly HuntEvent[]): void {
    const ear = this.ear();
    for (const e of events) {
      if (e.kind === 'hit') {
        this.notes.push('Попал');
        haptic('medium');
        this.sound?.thud('deer', ear, e.x, e.z);
      } else if (e.kind === 'thud') {
        const c = e.struck === 'cover' ? this.hunt.field.cover[this.hunt.arrows[e.id]?.what ?? -1] : undefined;
        const word = e.struck === 'cover' && c?.kind === 'bush' ? 'bush' : (e.struck ?? 'ground');
        this.notes.push(LANDED[word] ?? 'Мимо');
        const kind: ThudKind | null = e.struck === 'deer' ? 'deer' : e.struck === 'cover' && c?.kind !== 'bush' ? 'wood' : e.struck === 'lost' ? null : 'ground';
        if (kind) this.sound?.thud(kind, ear, e.x, e.z);
      }
    }
  }

  /** Олени: место, поворот, голова, ноги, скачок; подстреленный падает и ложится тушей. */
  private syncDeer(t: number, dt: number): void {
    const ear = this.ear();
    for (let i = 0; i < this.deer.length; i++) {
      const g = this.deer[i];
      const p = this.hunt.pose(i, t);
      const c = this.carcasses[i];
      if (p.kind === 'gone') {
        g.visible = false;
        c.visible = false;
        this.blob(i, null);
        continue;
      }
      if (p.kind === 'down') {
        const seg = this.hunt.segs[i].find((s) => s.kind === 'down');
        const k = seg ? (t - seg.t0) / FALL_S : 1;
        if (k < 1) {
          // Падает: валится на бок и оседает, потом ложится тушей.
          g.visible = true;
          c.visible = false;
          g.position.set(p.x, -0.35 * smooth(k), p.z);
          g.rotation.set(0, p.yaw, 1.45 * smooth(k));
        } else {
          g.visible = false;
          c.visible = true;
          c.position.set(p.x, 0, p.z);
          c.rotation.y = p.yaw;
        }
        this.blob(i, p);
        continue;
      }
      g.visible = true;
      c.visible = false;
      g.position.set(p.x, p.lift, p.z);
      g.rotation.set(0, p.yaw, 0);
      // Голова догоняет правило за доли секунды: правило решает «вскинул», глаз видит, как он вскидывает.
      this.headAt[i] += (p.head - this.headAt[i]) * Math.min(1, dt * 12);
      this.heads[i].rotation.x = this.headAt[i];
      const run = p.speed > 1.5;
      // Бег — скачками: передние вперёд, задние назад и наоборот, раз за скачок. Пасётся — переступает.
      const phase = run ? (p.ran / (RUN_SPEED * HOP_S)) * Math.PI * 2 : p.ran * 3;
      const swing = Math.sin(phase) * (run ? 0.7 : Math.min(0.25, p.speed * 2));
      this.legsF[i].rotation.x = swing;
      this.legsB[i].rotation.x = -swing;
      g.rotation.x = run ? Math.sin(phase) * 0.12 : 0;
      // Топот: два удара на скачок — передние и задние.
      if (run) {
        const n = Math.floor(p.ran / ((RUN_SPEED * HOP_S) / 2));
        if (n !== this.beat[i]) {
          this.beat[i] = n;
          this.sound?.hoof(ear, p.x, p.z);
        }
      }
      this.blob(i, p);
    }
    if (this.blobs) this.blobs.instanceMatrix.needsUpdate = true;
  }

  private blob(i: number, p: { x: number; z: number; yaw: number; kind: string } | null): void {
    const m = this.blobs;
    if (!m) return;
    if (!p) {
      _m.makeScale(0, 0, 0);
    } else {
      _e.set(0, p.yaw, 0);
      _q.setFromEuler(_e);
      _p.set(p.x, 0, p.z);
      const k = p.kind === 'down' ? 1.1 : 1;
      _s.set(k, 1, k);
      _m.compose(_p, _q, _s);
      _s.set(1, 1, 1);
    }
    m.setMatrixAt(i, _m);
  }

  /** Стрелы: летящие — по дуге носом по ходу, воткнувшиеся — где легли; в подстреленном — на туше. */
  private syncArrows(t: number): void {
    const m = this.arrows;
    if (!m) return;
    let n = 0;
    for (const a of this.hunt.arrows) {
      if (a.struck === 'lost') continue;
      if (!this.placeArrow(a, t)) continue;
      m.setMatrixAt(n++, _m);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }

  private placeArrow(a: Arrow, t: number): boolean {
    if (a.end === null || a.end > t) {
      const tau = Math.max(0, t - a.t0);
      const p = flightAt(a, tau);
      _d.set(a.vx, a.vy - GRAVITY * tau, a.vz).normalize();
      _p.set(p.x, p.y, p.z);
    } else {
      if (!a.at || !a.dir) return false;
      _d.set(a.dir.x, a.dir.y, a.dir.z);
      // Наконечник в том, во что попала; середина древка — позади.
      _p.set(a.at.x, a.at.y, a.at.z).addScaledVector(_d, -0.3);
      if (a.struck === 'deer') {
        // Подстреленный лёг: стрела торчит из туши, а не висит там, где была холка.
        _p.y = CARCASS.y + 0.2 + (_p.y - DEER_BODY.y) * 0.3;
      }
    }
    _q.setFromUnitVectors(_fwd, _d);
    _m.compose(_p, _q, _s);
    return true;
  }

  /** Лук: вскидывается, пока тянут, тетива уходит к скуле, стрела на тетиве — если наложена. */
  private syncBow(dt: number): void {
    const b = this.bowRig;
    if (!b) return;
    const pulling = this.hunt.pulling;
    this.raise += ((pulling ? 1 : 0) - this.raise) * Math.min(1, dt * (pulling ? 12 : 5));
    const draw = this.hunt.drawn();
    this.drawShown += (draw - this.drawShown) * Math.min(1, dt * 14);
    const k = smooth(this.raise);
    b.position.set(lerp(BOW_REST.x, BOW_AIM.x, k), lerp(BOW_REST.y, BOW_AIM.y, k), lerp(BOW_REST.z, BOW_AIM.z, k));
    b.rotation.set(lerp(BOW_REST.rx, BOW_AIM.rx, k), lerp(BOW_REST.ry, BOW_AIM.ry, k), lerp(BOW_REST.rz, BOW_AIM.rz, k));
    // Тетива — от концов плеч к хвосту стрелы; стрела наложена, если она есть и прошло время наложить.
    const nockZ = BOW_TIP.z + PULL * this.drawShown;
    for (let i = 0; i < this.cords.length; i++) {
      const limb = this.cords[i];
      const ty = i === 0 ? BOW_TIP.y : -BOW_TIP.y;
      _cord.set(0.06, -ty, nockZ - BOW_TIP.z);
      const len = _cord.length() || 1e-4;
      limb.position.set(0, ty, BOW_TIP.z);
      limb.quaternion.setFromUnitVectors(_up, _cord.divideScalar(len));
      limb.scale.set(1, len, 1);
    }
    const loaded = this.hunt.quiver > 0 && (pulling || this.raise > 0.05);
    if (this.nock) {
      this.nock.visible = loaded;
      this.nock.position.set(0.06, 0, nockZ - ARROW_TAIL / BOW_SCALE);
    }
  }

  tally(): Tally {
    return this.hunt.tally();
  }

  /** Геометрию разберёт сцена (`disposeGeometries` — лук висит на камере, камера в сцене); здесь — копии. */
  dispose(): void {
    this.blobs?.dispose();
    this.arrows?.dispose();
  }
}
