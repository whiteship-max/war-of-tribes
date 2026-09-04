// Набор деталей: здание из него — один меш, у которого есть цвет вершин на каждой
// вершине. Материал с vertexColors и геометрия без атрибута color рисуются чёрным
// (у Lambert нет значения атрибута по умолчанию), поэтому инвариант проверяется
// на всех моделях всех ступеней, включая старые, — смешать наборы нельзя.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS } from '@/game/data/buildings';
import { createBuildingGroup, type Tier } from './buildings';
import { buildVillage } from './village';
import { buildTerrain } from './terrain';
import { MODEL_RADIUS } from './plan';

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function extent(root: THREE.Object3D): { radius: number; height: number } {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let radius = 0;
  let height = 0;
  for (const mesh of meshes(root)) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      radius = Math.max(radius, Math.hypot(v.x, v.z));
      height = Math.max(height, v.y);
    }
  }
  return { radius, height };
}

/** Каждый меш с материалом vertexColors несёт атрибут color на всю геометрию. */
function expectColored(root: THREE.Object3D, label: string): void {
  for (const mesh of meshes(root)) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const needs = mats.some((m) => (m as THREE.Material & { vertexColors?: boolean }).vertexColors);
    if (!needs) continue;
    const color = mesh.geometry.attributes.color;
    expect(color, `${label}: меш с vertexColors без атрибута color — будет чёрным`).toBeDefined();
    expect(color.count).toBe(mesh.geometry.attributes.position.count);
    // Диапазон проверяется одним проходом: по expect на вершину — минута на все модели.
    let bad = 0;
    const arr = color.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) if (!(arr[i] >= 0 && arr[i] <= 1.2)) bad++;
    expect(bad, `${label}: цвет вершины вне диапазона`).toBe(0);
  }
}

describe('набор деталей', () => {
  it('хижина из набора — один меш на всех ступенях', () => {
    for (const tier of [0, 1, 2] as Tier[]) {
      const g = createBuildingGroup('hut', tier);
      expect(meshes(g).length, `hut ступень ${tier}`).toBe(1);
      const mats = meshes(g)[0].material as THREE.Material[];
      // Тело + кровля (+ отделка): не больше четырёх вызовов отрисовки.
      expect(mats.length, `hut ступень ${tier}: слишком много материалов`).toBeLessThanOrEqual(4);
    }
  });

  it('ступени хижины растут вширь и ввысь и держатся в габарите плана', () => {
    const e = [0, 1, 2].map((t) => extent(createBuildingGroup('hut', t as Tier)));
    expect(e[1].radius).toBeGreaterThan(e[0].radius * 1.4);
    expect(e[2].radius).toBeGreaterThan(e[1].radius * 1.0);
    expect(e[1].height).toBeGreaterThan(e[0].height * 1.1);
    expect(e[2].height).toBeGreaterThan(e[1].height * 1.1);
    expect(e[2].radius).toBeLessThanOrEqual(MODEL_RADIUS.hut);
  });

  it('у каждого меша с vertexColors есть цвет вершин: здания, посёлок, ландшафт', () => {
    for (const def of BUILDINGS) {
      for (const tier of [0, 1, 2] as Tier[]) {
        expectColored(createBuildingGroup(def.id, tier), `${def.id} ${tier}`);
      }
    }
    const present = BUILDINGS.map((b) => b.id);
    expectColored(
      buildVillage({ present, built: present.map((type) => ({ type, tier: 2 as Tier })) }),
      'посёлок',
    );
    expectColored(buildTerrain(), 'ландшафт');
  });

  it('земля ровная внутри расчистки и с рельефом за ней', async () => {
    const { groundHeight } = await import('./terrain');
    const { CLEAR_RADIUS, WALL_RADIUS } = await import('./plan');
    expect(groundHeight(0, 0)).toBe(0);
    expect(groundHeight(WALL_RADIUS, 0)).toBe(0);
    expect(groundHeight(CLEAR_RADIUS - 0.1, 0)).toBe(0);
    let bumps = 0;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r = CLEAR_RADIUS + 5;
      if (Math.abs(groundHeight(Math.cos(a) * r, Math.sin(a) * r)) > 0.05) bumps++;
    }
    expect(bumps).toBeGreaterThan(18);
  });
});
