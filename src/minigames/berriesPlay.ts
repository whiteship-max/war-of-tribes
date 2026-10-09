/**
 * «Ягоды» в сцене: кусты и ягоды на поляне, сбор тапом (docs/minigames.md, раздел 5).
 *
 * Правило — в `berries.ts`: раскладка от зерна, спелость — от секунды игры. Здесь только то, что видно: ягода
 * краснеет (синеет) за `BLUSH` секунд до спелости, обобранный куст стоит пустым. Цвет ягод — инстансы одного меша,
 * и перекладываются только те, чей цвет в этом кадре поменялся.
 */
import * as THREE from 'three';
import type { Surfaces } from '@/prologue/surface';
import type { Shade } from '@/prologue/models';
import type { Blocker } from '@/prologue/glade';
import { BUSH_KINDS, Basket, blush, layBerries, type Field } from './berries';
import { BERRY_GREEN, BERRY_RIPE, BERRY_SIZE, berriesMesh, bushesMesh } from './models';
import type { Tally, Target } from './rules';
import type { Play } from './stage';
import { Sparks } from './sparks';
import { fieldSound, type FieldSound } from './miniSound';
import { HEAP, basketGeometry, basketHand, heapSpots, viewMaterial } from './hands';

/** Корзина в левой: внизу слева, наклонена к глазу — видно, сколько в ней. */
const BASKET_AT = { x: -0.13, y: -0.48, z: -0.72 };
/** Ягода в горке — с вишню: крупнее ягоды на кусте (`BERRY_SIZE`), у глаза она меньше точки пальца не станет. */
const HEAP_BERRY = 0.026;

/** Листва в горсти из куста — те же оттенки, что у шапок (`models.LEAF`), чуть светлее на изнанке. */
const LEAF_BITS = [0x5d8f45, 0x6aa04d, 0x7fb25a];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _green = new THREE.Color();
const _ripe = new THREE.Color();

/** Ягода — сколько ступеней цвета: перекладывается инстанс, только когда ступень сменилась. */
const STEPS = 12;

export class BerriesPlay implements Play {
  /** Утро: низкое солнце сквозь стену леса, дымка у земли — тот же час, что мерило поляны. */
  readonly solar = 0.09;
  /** Середина поляны, лицом вдоль −Z. */
  readonly start = { x: 0, z: 0, yaw: 0 };
  readonly roam = 12.4;
  /** Кусты — до одиннадцати метров от середины. */
  readonly shadowHalf = 12;
  readonly field: Field;
  private basket = new Basket();
  private mesh: THREE.InstancedMesh | null = null;
  private bushMesh: THREE.Mesh | null = null;
  /** Какая ступень цвета у каждой ягоды стоит сейчас (−1 — сорвана). */
  private shown: number[] = [];
  private blockers_: Blocker[];
  private sparks = new Sparks(0.06);
  /** Корзина у глаза: плетёнка, левая на дужке и горка ягод, растущая со счётом. */
  private basket_: THREE.Group | null = null;
  private heap: THREE.InstancedMesh | null = null;
  /** Сколько ягод лежит в горке сейчас. */
  private heaped = 0;
  private viewMat = viewMaterial();
  /** Когда ягоды легли в корзину — горка подпрыгивает. */
  private poppedAt = -1;
  private sway = 0;
  private clock = 0;
  private sound: FieldSound | null = null;

  constructor(seed: number) {
    this.field = layBerries(seed);
    this.blockers_ = this.field.bushes.map((b) => ({ x: b.x, z: b.z, r: BUSH_KINDS[b.kind].r * 0.85 }));
  }

  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, camera: THREE.Camera): void {
    this.bushMesh = surfaces.adopt(bushesMesh(this.field.bushes));
    scene.add(this.bushMesh);
    for (const b of this.field.bushes) {
      const r = BUSH_KINDS[b.kind].r;
      shade.add(b.x, b.z, r * 1.3, r * 1.3, b.yaw);
    }
    this.mesh = berriesMesh(this.field.total);
    let i = 0;
    for (const b of this.field.bushes) {
      const cos = Math.cos(b.yaw);
      const sin = Math.sin(b.yaw);
      for (const berry of b.berries) {
        _p.set(b.x + berry.x * cos - berry.z * sin, berry.y, b.z + berry.x * sin + berry.z * cos);
        _s.setScalar(BERRY_SIZE[b.kind]);
        this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
        this.mesh.setColorAt(i, _c.setHex(BERRY_GREEN[b.kind]));
        this.shown.push(-2);
        i++;
      }
    }
    scene.add(this.mesh);
    scene.add(this.sparks.points);
    this.buildBasket(camera);
    this.paint(0);
  }

  /** Корзина в левой руке: плетёнка, кисть на дужке и горка ягод цветами трёх кустов. */
  private buildBasket(camera: THREE.Camera): void {
    const g = new THREE.Group();
    g.name = 'basket';
    const view = (geo: THREE.BufferGeometry, name: string): THREE.Mesh => {
      const m = new THREE.Mesh(geo, this.viewMat);
      m.name = name;
      m.castShadow = false;
      m.frustumCulled = false;
      g.add(m);
      return m;
    };
    view(basketGeometry(), 'wicker');
    view(basketHand(), 'basketHand');
    // Горка — ягоды копиями: каждая — своим цветом, как на кустах (черника, брусника, малина вперемешку).
    const heap = berriesMesh(HEAP);
    heap.name = 'heap';
    heap.frustumCulled = false;
    const ripe = Object.values(BERRY_RIPE);
    heapSpots().forEach((p, i) => {
      heap.setMatrixAt(i, _m.compose(p, _q, _s.setScalar(HEAP_BERRY * (0.85 + ((i * 5) % 7) * 0.05))));
      heap.setColorAt(i, _c.setHex(ripe[(i * 7) % ripe.length]));
    });
    heap.count = 0;
    g.add(heap);
    this.heap = heap;
    g.position.set(BASKET_AT.x, BASKET_AT.y, BASKET_AT.z);
    g.rotation.set(0.48, 0.22, 0.16);
    camera.add(g);
    this.basket_ = g;
  }

  begin(): void {
    this.sound ??= fieldSound();
    this.sound.arm();
  }

  tick(): void {
    this.sound?.tick();
  }

  blockers(): Blocker[] {
    return this.blockers_;
  }

  targets(): Target[] {
    const out: Target[] = [];
    for (const b of this.field.bushes) {
      if (this.basket.isPicked(b.id)) continue;
      out.push({ id: b.id, x: b.x, z: b.z, r: BUSH_KINDS[b.kind].r, verb: `Собрать ${BUSH_KINDS[b.kind].name}` });
    }
    return out;
  }

  tap(target: Target, t: number): string {
    const bush = this.field.bushes[target.id];
    const y = bush ? this.basket.pick(bush, t) : null;
    if (!y) return '';
    this.paint(t);
    if (y.ripe > 0) this.poppedAt = this.clock;
    this.sound?.pick(y.ripe, y.green);
    // Горсть из куста: спелые — его цветом, сколько сорвано (не больше дюжины), и листья.
    const ripe = BERRY_RIPE[bush.kind];
    const colors = [...Array(Math.min(12, y.ripe)).fill(ripe), ...LEAF_BITS];
    if (y.green > 0) colors.push(BERRY_GREEN[bush.kind]);
    this.sparks.burst(bush.x, BUSH_KINDS[bush.kind].h * 0.7, bush.z, { colors, n: colors.length + 4, speed: 1.7, up: 0.75, gravity: 5.5, life: 1.1, drag: 1.5 });
    if (y.ripe === 0) return `Зелёных пропало ${y.green}`;
    return y.green > 0 ? `+${y.ripe}, зелёных пропало ${y.green}` : `+${y.ripe}`;
  }

  frame(t: number, dt: number, walking = 0): void {
    this.paint(t);
    this.sparks.frame(dt);
    this.clock += dt;
    this.swayBasket(dt, walking);
  }

  /** Корзина качается на шагу; горка — по счёту: доля собранного от всего на поляне, и подпрыгивает на новых ягодах. */
  private swayBasket(dt: number, walking: number): void {
    const g = this.basket_;
    const h = this.heap;
    if (!g || !h) return;
    this.sway += dt * 9 * walking;
    g.position.y = BASKET_AT.y - Math.abs(Math.sin(this.sway * 0.5)) * 0.018 * walking;
    g.position.x = BASKET_AT.x + Math.sin(this.sway * 0.5) * 0.012 * walking;
    // Горка — доля собранного: полная корзина — все ягоды поляны. Новые ягоды — подскок.
    const fill = this.field.total > 0 ? this.basket.got / this.field.total : 0;
    const n = Math.min(HEAP, Math.ceil(fill * HEAP));
    if (n !== this.heaped) {
      this.heaped = n;
      h.count = n;
    }
    const since = this.clock - this.poppedAt;
    const pop = since >= 0 && since < 0.35 ? Math.sin((since / 0.35) * Math.PI) * 0.06 : 0;
    h.position.y = pop * 0.05;
    h.scale.setScalar(1 + pop);
  }

  /** Цвет ягод по спелости в секунду `t`; сорванные — из кадра. */
  private paint(t: number): void {
    const m = this.mesh;
    if (!m) return;
    let i = 0;
    let moved = false;
    let tinted = false;
    for (const b of this.field.bushes) {
      const gone = this.basket.isPicked(b.id);
      _green.setHex(BERRY_GREEN[b.kind]);
      _ripe.setHex(BERRY_RIPE[b.kind]);
      for (const berry of b.berries) {
        const step = gone ? -1 : Math.round(blush(berry, t) * STEPS);
        if (step !== this.shown[i]) {
          if (step === -1) {
            // Сорванная ягода уходит из кадра: инстанс сжимается в точку.
            m.getMatrixAt(i, _m);
            _m.decompose(_p, _qd, _s);
            m.setMatrixAt(i, _m.compose(_p, _qd, _s.setScalar(0)));
            moved = true;
          } else {
            m.setColorAt(i, _c.copy(_green).lerp(_ripe, step / STEPS));
            tinted = true;
          }
          this.shown[i] = step;
        }
        i++;
      }
    }
    if (moved) m.instanceMatrix.needsUpdate = true;
    if (tinted && m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  tally(): Tally {
    return { got: this.basket.got, total: this.field.total };
  }

  dispose(): void {
    this.sparks.dispose();
    this.basket_?.removeFromParent();
    this.basket_?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    (this.heap?.material as THREE.Material | undefined)?.dispose();
    this.heap?.dispose();
    this.viewMat.dispose();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.dispose();
    }
  }
}
