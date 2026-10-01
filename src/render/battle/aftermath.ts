// Поле после боя: брошенные щиты, копья, воткнутые в землю, оброненные шлемы.
//
// Без этого финальный кадр ничем не отличается от начального, кроме числа фигур,
// — то есть читается паузой, а не концом. Разница между «бой остановили» и «бой
// кончился» вся в земле под ногами.
//
// Считает это не картинка: сколько всего лежит, говорит раскадровка
// (`SectorFrame.wreck`), а она — потери журнала. Раскладка по земле
// детерминирована хешем: тот же бой оставляет тот же след, вещь к вещи.
//
// Цвет — сторона, и здесь тоже. По брошенному щиту должно быть видно, чей фланг
// тут стоял; ровно это и делает поле после боя рассказом, а не мусором.
import * as THREE from 'three';
import { FILE_STEP, RANK_STEP, type SectorFrame } from '@/battle/replay';
import { INSTANCED } from '../materials';
import { PALETTE } from '../palette';
import { beastSector } from './troops';

/** Щит на земле: тот же круг, что в руке, только лежит. */
const SHIELD_R = 0.34;
const SHIELD_TH = 0.05;

/** Воткнутое копьё: обломок древка, ушедший в землю под углом. */
const SHAFT_R = 0.016;
const SHAFT_H = { min: 0.9, max: 1.45 };
/** Наклон воткнутого древка: они торчат вразнобой — строя тут больше нет. */
const SHAFT_LEAN = { min: 0.25, max: 0.85 };

/** Доля вещей, которые не щит, а древко: копий на поле всегда больше щитов. */
const SHAFT_SHARE = 0.55;

/** Насколько брошенное вылезает перед строем — туда, где линии и сошлись. */
const FRONT_SPILL = 1.9;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Брошенное на поле. Два инстансированных набора на всё поле: щиты лежат и тени
 * не отбрасывают (они и есть плоское пятно), древки торчат и отбрасывают —
 * на низком солнце это и рисует поле полосами.
 */
export class Aftermath {
  readonly group = new THREE.Group();
  private shields: THREE.InstancedMesh;
  private shafts: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(capacity: number) {
    this.group.name = 'aftermath';
    const n = Math.max(1, capacity);
    const shield = new THREE.CylinderGeometry(SHIELD_R, SHIELD_R * 0.92, SHIELD_TH, 8);
    const shaft = new THREE.CylinderGeometry(SHAFT_R, SHAFT_R * 1.4, 1, 4, 1, true).translate(0, 0.5, 0);
    this.shields = this.make(shield, n);
    this.shafts = this.make(shaft, n);
    this.shields.castShadow = false;
    this.shafts.castShadow = true;
    this.group.add(this.shields);
    this.group.add(this.shafts);
  }

  private make(geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, INSTANCED, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    return mesh;
  }

  /**
   * Разложить брошенное по кадру. `cloth` — цвет стороны: щит на земле обязан
   * говорить, чей он, так же как щит в руке.
   *
   * Место сектора берётся без смещения: разгон конницы и бегство двигают живых,
   * а брошенное остаётся там, где его бросили.
   */
  update(sectors: readonly SectorFrame[], cloth: (s: SectorFrame) => number): void {
    let shields = 0;
    let shafts = 0;
    sectors.forEach((f, si) => {
      // Стая ничего не роняет: ни щита, ни копья у неё нет — на земле остаются только павшие волки.
      if (f.wreck <= 0 || beastSector(f)) return;
      const back = Math.sign(f.z) || 1;
      const halfW = (f.files * FILE_STEP) / 2 + 0.4;
      const depth = Math.max(RANK_STEP, Math.min(f.ranks, Math.ceil(f.figures / Math.max(1, f.files))) * RANK_STEP);
      const color = cloth(f);
      for (let i = 0; i < f.wreck; i++) {
        const r1 = hash(si * 6151 + i * 47 + 1);
        const r2 = hash(si * 6151 + i * 47 + 2);
        const r3 = hash(si * 6151 + i * 47 + 3);
        const x = f.x + (r1 * 2 - 1) * halfW;
        // Лежит и перед строем, и в нём: линия соприкосновения — это и есть
        // место, где падали, а позади остаётся брошенное при отходе.
        const z = f.z + back * (r2 * (depth + FRONT_SPILL) - FRONT_SPILL);
        if (r3 < SHAFT_SHARE) {
          const h = SHAFT_H.min + r1 * (SHAFT_H.max - SHAFT_H.min);
          const lean = SHAFT_LEAN.min + r2 * (SHAFT_LEAN.max - SHAFT_LEAN.min);
          this.e.set(lean * (r3 > 0.27 ? 1 : -1), r1 * Math.PI * 2, lean * (r2 - 0.5));
          this.p.set(x, 0, z);
          this.s.set(1, h, 1);
          this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
          shafts = this.write(this.shafts, shafts, this.m, this.c.setHex(r1 > 0.5 ? PALETTE.woodDark : PALETTE.wood));
        } else {
          // Щит лежит плашмя, слегка на боку: ровный круг читается монеткой.
          this.e.set(Math.PI * 0.5 - 0.18 - r1 * 0.3, r2 * Math.PI * 2, 0);
          this.p.set(x, SHIELD_R * 0.34, z);
          this.s.set(1, 1, 1);
          this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
          shields = this.write(this.shields, shields, this.m, this.c.setHex(color));
        }
      }
    });
    this.finish(this.shields, shields);
    this.finish(this.shafts, shafts);
  }

  private write(mesh: THREE.InstancedMesh, at: number, m: THREE.Matrix4, color: THREE.Color): number {
    if (at >= mesh.instanceMatrix.count) return at;
    mesh.setMatrixAt(at, m);
    mesh.setColorAt(at, color);
    return at + 1;
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = Math.min(count, mesh.instanceMatrix.count);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.shields, this.shafts]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
