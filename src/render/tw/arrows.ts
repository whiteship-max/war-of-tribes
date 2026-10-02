// Стрелы ролика TW: залп — туча по дуге от лучников к отряду противника (docs/battle_tw.md, раздел 4).
//
// Когда и сколько — режиссура (`plan.volleysAt`: залпы отряда в фазах огня, по стреле на живую фигуру лучника, под
// потолком уровня). Откуда — от своих лучников, каждая стрела со своей фигуры; куда — в строй цели, разброс — по его
// ширине и глубине, от сида. Стрела в небе — одна инстансированная тонкая пирамида, один вызов на всё поле.
import * as THREE from 'three';
import { PALETTE } from '../palette';
import { ARROW_FLIGHT, unitPose, volleysAt, type TwPlan } from './plan';
import { hash, heightAt } from './terrain';

/** Стрела крупнее жизни: на общем виде залп должен читаться штрихами, а не пропадать. */
const ARROW_LEN = 1.25;

export class Arrows {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private d = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private fwd = new THREE.Vector3(0, 0, 1);

  constructor(
    private plan: TwPlan,
    private cap: number,
  ) {
    // Трёхгранная пирамида вдоль +Z: остриё вперёд.
    const geo = new THREE.ConeGeometry(0.04, ARROW_LEN, 3, 1).rotateX(Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: PALETTE.woodDark, flatShading: true });
    mat.name = 'tw-arrows';
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
    this.mesh.name = 'tw-arrows';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(t: number): void {
    const plan = this.plan;
    let n = 0;
    for (const v of volleysAt(plan, t, this.cap)) {
      const from = plan.units[v.from];
      const to = plan.units[v.to];
      const a = unitPose(plan, from, v.at);
      const b = unitPose(plan, to, v.at + ARROW_FLIGHT);
      const ca = Math.cos(a.yaw);
      const sa = Math.sin(a.yaw);
      const cb = Math.cos(b.yaw);
      const sb = Math.sin(b.yaw);
      for (let k = 0; k < v.arrows && n < this.cap; k++) {
        // Каждая стрела — со своей фигуры лучника и со своим мигом срыва (раскрой в треть секунды).
        const i = from.first + (k % from.figures);
        const lag = hash(plan.cast.seed, v.at * 100 + k, 21) * 0.35;
        const u = (t - v.at - lag) / ARROW_FLIGHT;
        if (u < 0 || u > 1) continue;
        const ax = a.x + plan.lx[i] * ca + plan.lz[i] * sa;
        const az = a.z - plan.lx[i] * sa + plan.lz[i] * ca;
        const ay = heightAt(plan.field, ax, az) + 1.3;
        // Куда: точка в строю цели, разброс — по его ширине и глубине.
        const ox = (hash(plan.cast.seed, k, v.to * 7 + 22) - 0.5) * (to.width + 2);
        const oz = -hash(plan.cast.seed, k, v.to * 7 + 23) * (to.depth + 2) + 1;
        const bx = b.x + ox * cb + oz * sb;
        const bz = b.z - ox * sb + oz * cb;
        const by = heightAt(plan.field, bx, bz) + 0.3;
        const dist = Math.hypot(bx - ax, bz - az);
        const h = 2 + dist * 0.32;
        const px = ax + (bx - ax) * u;
        const pz = az + (bz - az) * u;
        const py = ay + (by - ay) * u + h * 4 * u * (1 - u);
        // Касательная дуги — куда смотрит стрела.
        this.d.set(bx - ax, by - ay + h * 4 * (1 - 2 * u), bz - az).normalize();
        this.q.setFromUnitVectors(this.fwd, this.d);
        this.v.set(px, py, pz);
        this.mesh.setMatrixAt(n++, this.m.compose(this.v, this.q, this.s));
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
