// Масса войска: знамёна, лес древков и тёмное пятно под строем.
//
// Всё, что здесь рисуется, — не украшение, а способ показать число, которого
// фигурами не показать. Фигур на сторону не больше `FIGURE_CAP`, и двадцать
// против пятисот по ним не читаются никак; знамёна, древки и пятно читаются.
//
// Сколько чего — решает раскадровка (`bannersFor`, `shaftsFor`, `dustRadius`).
// Здесь только расстановка и отрисовка: три инстансированных набора, три вызова
// на всё поле, сколько бы ни было войска.
//
// Древки и знамёна — это и есть то, что видно у реального строя издалека, а не
// лица. Поэтому они гуще фигур и стоят выше их.
import * as THREE from 'three';
import { FILE_STEP, RANK_STEP, type SectorFrame } from '@/battle/replay';
import { INSTANCED, SHADE } from '../materials';
import { PALETTE } from '../palette';

/** Высота древка над землёй: заметно выше человека (`MAN_HEIGHT` = 1.05). */
const SHAFT_H = { min: 1.5, max: 2.05 };
const SHAFT_R = 0.014;
/** Наклон древка от вертикали: строй не забор, но и не хаос. */
const SHAFT_TILT = 0.13;

/** Знамя выше древков — иначе его в лесу не видно. */
const BANNER_H = 2.6;
const BANNER_CLOTH = { w: 0.44, h: 0.3 };

/** Насколько пятно массы темнит землю под собой. */
const DUST_DARK = 0.62;

/**
 * Детерминированный хеш: одна и та же раскадровка обязана давать один и тот же
 * лес древков. `Math.random` здесь запрещён так же, как в режиссуре.
 */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Общий пул инстансов массы: один меш на каждый примитив, три вызова на всё. */
export class MassView {
  readonly group = new THREE.Group();
  private shafts: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private dust: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(capacity: { shafts: number; flags: number; dust: number }) {
    this.group.name = 'mass';
    // Древко без донцев — их закрывает строй; четыре грани, восемь треугольников.
    const shaft = new THREE.CylinderGeometry(SHAFT_R, SHAFT_R * 1.15, 1, 4, 1, true).translate(0, 0.5, 0);
    const flag = new THREE.PlaneGeometry(1, 1).translate(0.5, -0.5, 0);
    this.shafts = this.make(shaft, INSTANCED, Math.max(1, capacity.shafts), false);
    this.flags = this.make(flag, INSTANCED, Math.max(1, capacity.flags), true);
    this.dust = this.make(dustDisc(), SHADE, Math.max(1, capacity.dust), false);
    // Пятно лежит на земле и тени не отбрасывает: оно само и есть тень.
    this.dust.renderOrder = -1;
    for (const mesh of [this.shafts, this.flags, this.dust]) this.group.add(mesh);
  }

  private make(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    twoSided: boolean,
  ): THREE.InstancedMesh {
    const mat = twoSided ? (material as THREE.Material).clone() : material;
    if (twoSided) mat.side = THREE.DoubleSide;
    const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Масса ходит по всему кадру; сфера по одной детали культуру только испортит.
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  /**
   * Разложить массу всех секторов кадра. Зовётся раз в кадр после фигур.
   * `cloth` — цвет стороны: знамя обязано быть того же цвета, что и рубаха,
   * иначе оно не говорит, чьё оно.
   */
  update(sectors: readonly SectorFrame[], cloth: (s: SectorFrame) => number): void {
    let shafts = 0;
    let flags = 0;
    let dust = 0;
    sectors.forEach((f, si) => {
      // Блок: передняя шеренга на месте сектора, ряды уходят назад.
      const back = Math.sign(f.z) || 1;
      const halfW = (f.files * FILE_STEP) / 2 + 0.3;
      // Глубина берётся по ПОСТАВЛЕННЫМ рядам, а не по полному блоку: на близком
      // плане стоит одна шеренга, и древки, растянутые на всю глубину, торчали бы
      // из пустой земли позади неё.
      const shown = Math.max(1, Math.ceil(f.figures / Math.max(1, f.files)));
      const depth = Math.max(RANK_STEP, Math.min(f.ranks, shown) * RANK_STEP);
      const color = cloth(f);

      // Пятно массы — под всем блоком, площадь по числу бойцов.
      if (f.dust > 0.01) {
        this.p.set(f.x, 0.012, f.z + (back * depth) / 2);
        this.s.set(f.dust, 1, f.dust * 0.85);
        this.e.set(-Math.PI / 2, 0, 0);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        dust = this.write(this.dust, dust, this.m, this.c.setScalar(1));
      }

      // Лес древков: гуще фигур, стоит по всей глубине блока, к задним рядам плотнее.
      for (let i = 0; i < f.shafts; i++) {
        const r1 = hash(si * 9173 + i * 31 + 1);
        const r2 = hash(si * 9173 + i * 31 + 2);
        const r3 = hash(si * 9173 + i * 31 + 3);
        const x = f.x + (r1 * 2 - 1) * halfW;
        // Смещение к задним рядам: спереди древки закрыли бы лица переднего строя.
        const z = f.z + back * (0.25 + r2 * depth);
        const h = SHAFT_H.min + r3 * (SHAFT_H.max - SHAFT_H.min);
        this.p.set(x, 0, z);
        this.s.set(1, h, 1);
        this.e.set((r1 - 0.5) * SHAFT_TILT, 0, (r2 - 0.5) * SHAFT_TILT);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        // Древко темнее к концу леса: иначе стена читается плоской заливкой.
        this.c.setHex(r3 > 0.5 ? PALETTE.woodDark : PALETTE.wood);
        shafts = this.write(this.shafts, shafts, this.m, this.c);
      }

      // Знамёна стоят в середине блока по глубине, а не сзади: сзади — это со
      // стороны камеры для нашей армии, и они закрыли бы собственный строй.
      for (let i = 0; i < f.banners; i++) {
        const u = f.banners === 1 ? 0.5 : i / (f.banners - 1);
        const x = f.x + (u * 2 - 1) * halfW * 0.7;
        const z = f.z + back * depth * 0.45;
        this.p.set(x, 0, z);
        this.s.set(1, BANNER_H, 1);
        this.e.set(0, 0, 0);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        this.c.setHex(PALETTE.woodDark);
        shafts = this.write(this.shafts, shafts, this.m, this.c);

        // Полотнище висит у верха древка, развёрнуто поперёк взгляда камеры.
        this.p.set(x + 0.02, BANNER_H - 0.06, z);
        this.s.set(BANNER_CLOTH.w, BANNER_CLOTH.h, 1);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        this.c.setHex(color);
        flags = this.write(this.flags, flags, this.m, this.c);
      }
    });
    this.finish(this.shafts, shafts);
    this.finish(this.flags, flags);
    this.finish(this.dust, dust);
  }

  private write(mesh: THREE.InstancedMesh, at: number, m: THREE.Matrix4, color: THREE.Color): number {
    if (at >= mesh.instanceMatrix.count) return at;
    mesh.setMatrixAt(at, m);
    mesh.setColorAt(at, color);
    return at + 1;
  }

  private finish(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.shafts, this.flags, this.dust]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}

/**
 * Диск пятна массы: тёмный в середине, к краю сходит на нет. Растушёвка идёт
 * цветом вершин — умножающее смешивание альфу не смотрит, ровно как у пятна
 * тени под зданием.
 */
function dustDisc(segments = 16): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, segments);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const pos = g.attributes.position;
  for (let i = 0; i < count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    // Середина темнит на DUST_DARK, край — единица, то есть ничего не меняет.
    const k = DUST_DARK + (1 - DUST_DARK) * Math.min(1, r);
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k * 1.03;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
