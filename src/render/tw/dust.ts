// Пыль сшибки и сечи ролика TW (docs/battle_tw.md, раздел 4): клубы над линией соприкосновения — густо на удар строя о
// строй, редко и всё время, пока полоса рубится. Где — середина полосы и линия её давления (`pushOf`), когда — сшибка и
// натиски кругов (`separationOf`): своих чисел исхода у пыли нет. Из-под ног — на разбеге первой линии перед сшибкой и
// за гонящими в погоне (ГФ-1, docs/gfx.md, «Пыль»). Клуб — диск лицом к камере с мягким краем (прозрачность гаснет к
// краю в шейдере), все — одним инстансом, один вызов на поле; разброс места и размера — от сида, без `Math.random`.
import * as THREE from 'three';
import { RUN_LAST, pushOf, separationOf, unitPose, type TwPlan } from './plan';
import { hash, heightAt } from '../reel/terrain';

/** Клубов разом, не больше. */
const CAP = 220;
/** Из-под ног: клуб за клубом, пока отряд бежит или гонит, и сколько он живёт. */
const FEET = { beat: 0.22, life: 1.4, size: 0.9 };
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
    const geo = new THREE.CircleGeometry(1, 12);
    const mat = new THREE.MeshBasicMaterial({ color: DUST, transparent: true, opacity: 0.34, depthWrite: false });
    mat.name = 'tw-dust';
    // Мягкий край: клуб гуще в середине и тает к краю — плоский диск с ровной прозрачностью читался монеткой.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec2 vTwUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTwUv = uv;');
      sh.fragmentShader =
        'varying vec2 vTwUv;\n' +
        sh.fragmentShader.replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\nfloat twR = length(vTwUv - 0.5) * 2.0;\ndiffuseColor.a *= pow(max(0.0, 1.0 - twR * twR), 1.6);',
        );
    };
    mat.customProgramCacheKey = () => 'tw-dust';
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

  /** Клуб из-под ног отряда `u`, вставший в `born`: позади строя, по его ширине. */
  private feet(n: number, u: TwPlan['units'][number], j: number, born: number, t: number, cam: THREE.Camera): number {
    if (n >= CAP) return n;
    const age = t - born;
    if (age < 0 || age > FEET.life) return n;
    const plan = this.plan;
    const seed = plan.cast.seed;
    const k = Math.round(born * 100) * 53 + u.id * 11 + j;
    const p = unitPose(plan, u, born);
    const back = u.ours ? -1 : 1;
    const x = p.x + (hash(seed, k, 45) - 0.5) * u.width;
    const z = p.z + back * (u.depth + 0.4 + hash(seed, k, 46) * 1.2);
    const v = age / FEET.life;
    const r = FEET.size * (0.6 + hash(seed, k, 47) * 0.5) * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.2)), 0.7) * (0.8 + 0.7 * v);
    if (r <= 0.01) return n;
    this.v.set(x, heightAt(plan.field, x, z) + 0.3 + age * 0.35, z);
    this.s.set(r, r * 0.6, r);
    this.m.compose(this.v, cam.quaternion, this.s);
    this.mesh.setMatrixAt(n, this.m);
    return n + 1;
  }

  update(t: number, cam: THREE.Camera): void {
    const plan = this.plan;
    let n = 0;
    // Из-под ног: разбег первой линии перед сшибкой и погоня — пыль встаёт за бегущим строем и за гонящими.
    for (const u of plan.units) {
      const run: [number, number][] = [];
      if (u.row === 'front' && !u.perch && plan.site?.kind !== 'wall') run.push([plan.clashAt - RUN_LAST, plan.clashAt]);
      if (u.chase) run.push([u.chase.from, u.chase.from + 3.5]);
      for (const [a, b] of run) {
        for (let k = Math.max(Math.ceil(a / FEET.beat), Math.floor((t - FEET.life) / FEET.beat)); k * FEET.beat <= Math.min(t, b); k++) {
          n = this.feet(n, u, k % 4, k * FEET.beat, t, cam);
        }
      }
    }
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
