// Пыль сшибки и сечи ролика TW (docs/battle_tw.md, раздел 4): клубы над линией соприкосновения — густо на удар строя о
// строй, редко и всё время, пока полоса рубится. Где — середина полосы и линия её давления (`pushOf`), когда — сшибка и
// натиски кругов (`separationOf`): своих чисел исхода у пыли нет. Клуб — плоский диск лицом к камере, все — одним
// инстансом, один вызов на поле; разброс места и размера — от сида, без `Math.random`.
import * as THREE from 'three';
import { pushOf, separationOf, type TwPlan } from './plan';
import { hash, heightAt } from './terrain';

/** Клубов разом, не больше. */
const CAP = 140;
/** Сколько живёт клуб и как часто встаёт новый в рубящейся полосе. */
const LIFE = 1.8;
const BEAT = 0.3;
/** Удар строя: клубов на полосу и их срок. */
const HIT = { puffs: 9, life: 2.4 };
const DUST = 0xb39a72;

export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** Полосы, где первые линии обеих сторон сошлись: только там и пылит. */
  private slots: number[];

  constructor(private plan: TwPlan) {
    const geo = new THREE.CircleGeometry(1, 9);
    const mat = new THREE.MeshBasicMaterial({ color: DUST, transparent: true, opacity: 0.2, depthWrite: false });
    mat.name = 'tw-dust';
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.name = 'tw-dust';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    this.slots = [0, 1, 2].filter((slot) => {
      const inSlot = plan.units.filter((u) => u.row === 'front' && u.lane !== null && (u.ours ? u.lane : 2 - u.lane) === slot);
      return inSlot.some((u) => u.ours) && inSlot.some((u) => !u.ours);
    });
  }

  /** Клуб номер `j` полосы `slot`, вставший в `born`: где, какой и сколько ему сейчас. */
  private puff(n: number, slot: number, j: number, born: number, life: number, size: number, t: number, cam: THREE.Camera): number {
    if (n >= CAP) return n;
    const age = t - born;
    if (age < 0 || age > life) return n;
    const plan = this.plan;
    const seed = plan.cast.seed;
    const k = Math.round(born * 100) * 31 + slot * 7 + j;
    const x = plan.slotX[slot] + (hash(seed, k, 41) - 0.5) * plan.slotW[slot];
    const z = pushOf(plan, slot, born) + (hash(seed, k, 42) - 0.5) * 1.6;
    const u = age / life;
    // Растёт и тает: в начале — плотный клуб у земли, к концу — шире и выше, пока не сойдёт на нет.
    const r = size * (0.6 + hash(seed, k, 43) * 0.6) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.7) * (0.7 + 0.6 * u);
    if (r <= 0.01) return n;
    this.v.set(x, heightAt(plan.field, x, z) + 0.5 + age * 0.55, z);
    this.s.set(r, r * 0.7, r);
    this.m.compose(this.v, cam.quaternion, this.s);
    this.mesh.setMatrixAt(n, this.m);
    return n + 1;
  }

  update(t: number, cam: THREE.Camera): void {
    const plan = this.plan;
    let n = 0;
    if (this.slots.length > 0 && t > plan.clashAt - 0.2) {
      // Удар строя о строй — густо, разом.
      for (const slot of this.slots) for (let j = 0; j < HIT.puffs; j++) n = this.puff(n, slot, j, plan.clashAt + hash(plan.cast.seed, j, 44) * 0.4, HIT.life, 2.4, t, cam);
      // Свалка — клуб за клубом, пока полоса рубится (не в отходе линий на огонь кругов и не после слома).
      const end = Math.min(t, plan.timing.melee[1]);
      for (let b = Math.max(Math.ceil((plan.clashAt + 0.5) / BEAT), Math.floor((t - LIFE) / BEAT)); b * BEAT <= end; b++) {
        const born = b * BEAT;
        if (separationOf(plan, born) > 0.3) continue;
        if (plan.brokenAt.attacker !== null && born > plan.brokenAt.attacker) continue;
        if (plan.brokenAt.defender !== null && born > plan.brokenAt.defender) continue;
        for (const slot of this.slots) n = this.puff(n, slot, b % 3, born, LIFE, 1.5, t, cam);
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
