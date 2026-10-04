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

  constructor(seed: number) {
    this.field = layBerries(seed);
    this.blockers_ = this.field.bushes.map((b) => ({ x: b.x, z: b.z, r: BUSH_KINDS[b.kind].r * 0.85 }));
  }

  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade): void {
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
    this.frame(0);
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
    this.frame(t);
    if (y.ripe === 0) return `Зелёных пропало ${y.green}`;
    return y.green > 0 ? `+${y.ripe}, зелёных пропало ${y.green}` : `+${y.ripe}`;
  }

  frame(t: number): void {
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
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.dispose();
    }
  }
}
