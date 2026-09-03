// Зона расчистки — обещание сцены: вокруг поселения чистое место, и стену есть
// где замкнуть. Раньше лес подходил вплотную к кольцу частокола и местами
// заходил на него, поэтому обещание проверяется здесь, а не глазами.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDINGS } from '@/game/data/buildings';
import { createBuildingGroup } from './buildings';
import { buildEnvironment, WORLD_RADIUS } from './terrain';
import { buildVillage } from './village';
import { CLEAR_EDGE, CLEAR_RADIUS, GATE_ANGLE, GATE_CLEAR_HALF, WALL_RADIUS, inCleared } from './plan';

interface Extent {
  min: number;
  max: number;
  /** Ближайшая к центру вершина — по ней понятно, что именно вылезло. */
  at: { x: number; z: number };
}

/** Разброс вершин группы по расстоянию от центра посёлка. */
function extent(root: THREE.Object3D): Extent {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let min = Infinity;
  let max = 0;
  let at = { x: 0, z: 0 };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const r = Math.hypot(v.x, v.z);
      if (r < min) {
        min = r;
        at = { x: v.x, z: v.z };
      }
      if (r > max) max = r;
    }
  });
  return { min, max, at };
}

/** Все вершины группы — ими проверяется коридор перед воротами. */
function vertices(root: THREE.Object3D): { x: number; z: number }[] {
  root.updateMatrixWorld(true);
  const out: { x: number; z: number }[] = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      out.push({ x: v.x, z: v.z });
    }
  });
  return out;
}

/** Стена на максимальной стадии: каменное кольцо с башнями и воротами. */
const wall = (): THREE.Group => createBuildingGroup('palisade', 2, 2, 'state');

describe('зона расчистки', () => {
  it('запас между стеной и лесом заметен, а не символичен', () => {
    expect(CLEAR_RADIUS).toBeGreaterThan(WALL_RADIUS + 3);
    // За зоной ещё должна остаться полоса вырубки и лес до края мира.
    expect(CLEAR_RADIUS + CLEAR_EDGE).toBeLessThan(WORLD_RADIUS - 2);
  });

  it('ни одно дерево, ни один камень не стоит внутри радиуса расчистки', () => {
    const env = extent(buildEnvironment());
    expect(
      env.min,
      `окружение зашло в зону расчистки: ${env.at.x.toFixed(1)} / ${env.at.z.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(CLEAR_RADIUS);
  });

  it('кольцо стены на максимальной стадии не пересекается с окружением', () => {
    const w = extent(wall());
    // Стена стоит там, где ей положено: кольцо вокруг WALL_RADIUS.
    expect(w.min).toBeGreaterThan(WALL_RADIUS - 1.5);
    expect(w.max).toBeLessThan(WALL_RADIUS + 1.5);
    expect(extent(buildEnvironment()).min).toBeGreaterThan(w.max);
  });

  it('обстановка посёлка не наезжает на стену изнутри', () => {
    const present = BUILDINGS.map((b) => b.id);
    const village = buildVillage({ stage: 'town', era: 'state', present });
    const decor = village.getObjectByName('decor');
    expect(decor, 'декор посёлка должен лежать своей группой').toBeTruthy();
    expect(extent(decor as THREE.Object3D).max).toBeLessThan(extent(wall()).min);
  });

  it('перед воротами оставлен свободный выезд', () => {
    const points = vertices(buildEnvironment());
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      const along = p.x * Math.cos(GATE_ANGLE) + p.z * Math.sin(GATE_ANGLE);
      if (along <= 0) continue;
      const across = Math.abs(-p.x * Math.sin(GATE_ANGLE) + p.z * Math.cos(GATE_ANGLE));
      expect(across, 'дорога из ворот упирается в лес').toBeGreaterThanOrEqual(GATE_CLEAR_HALF);
    }
  });

  it('inCleared описывает ровно то, что проверяют тесты выше', () => {
    expect(inCleared(0, 0)).toBe(true);
    expect(inCleared(WALL_RADIUS + 1, 0)).toBe(true);
    // Прямо за воротами — коридор; в ту же сторону, но вбок от него — уже лес.
    const far = CLEAR_RADIUS + CLEAR_EDGE;
    expect(inCleared(Math.cos(GATE_ANGLE) * far, Math.sin(GATE_ANGLE) * far)).toBe(true);
    const side = GATE_ANGLE + Math.PI / 2;
    expect(inCleared(Math.cos(side) * far, Math.sin(side) * far)).toBe(false);
    // Позади посёлка коридора нет: лес начинается сразу за расчисткой.
    const back = GATE_ANGLE + Math.PI;
    expect(inCleared(Math.cos(back) * far, Math.sin(back) * far)).toBe(false);
  });
});
