// Стража города — те же бойцы, что в роликах (docs/polish.md, П-5): виды толпы роликов, и стоят они там, где жизнь города
// ставит стражу, — двух правд о месте стражника нет.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cityPlan } from './layout';
import { buildStatic } from './budget';
import { CityLife } from './life';
import { CityGarrison, GUARD_SCALE } from './garrison';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');

describe('город: стража бойцами роликов', () => {
  it('лучники на стене и копейщики у ворот — виды толпы роликов, на местах жизни города', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    life.set(200, 12, []);
    life.update(0.016, 30, 0, 0);
    const garrison = new CityGarrison(life, 'medium', null);
    // Камера над воротами: в кадре — часть стражи; без отсечения считается всё, поэтому — камера далеко и широко.
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 5000);
    camera.position.set(0, 900, 0.1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    garrison.update(30, camera);
    const cap = life.guardCap;
    const n = cap.wall + cap.gate;
    const spots = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), moving: new Uint8Array(n) };
    const { count, wall } = life.guardsInto(spots);
    // Граница области: на стене и у ворот стража есть.
    expect(wall).toBeGreaterThan(0);
    expect(count - wall).toBeGreaterThan(0);
    // Виды — те же, что в роликах: лучник и копейщик (ключ вида толпы `face:род`).
    const crowd = garrison.group.getObjectByName('tw-crowd')!;
    const names = crowd.children.map((c) => c.name);
    expect(names.some((x) => x.endsWith('archer:archer'))).toBe(true);
    expect(names.some((x) => x.endsWith('spearman:spear'))).toBe(true);
    // Сколько стражи у жизни города — столько бойцов в кадре, и стоят они на тех же местах.
    const drawn: THREE.Vector3[] = [];
    for (const c of crowd.children) {
      const im = c as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !im.visible) continue;
      const place = im.geometry.getAttribute('aPlace') as THREE.InstancedBufferAttribute;
      const anim = im.geometry.getAttribute('aAnim') as THREE.InstancedBufferAttribute;
      for (let k = 0; k < im.count; k++) {
        drawn.push(new THREE.Vector3(place.getX(k), place.getY(k), place.getZ(k)));
        expect(anim.getW(k)).toBeCloseTo(GUARD_SCALE);
      }
    }
    expect(drawn.length).toBe(count);
    for (let k = 0; k < count; k++) {
      const want = new THREE.Vector3(spots.x[k], spots.y[k], spots.z[k]);
      expect(Math.min(...drawn.map((d) => d.distanceTo(want))), `страж ${k}`).toBeLessThan(1e-3);
    }
    // Прежние фигуры стражи погашены: дважды стражник не стоит.
    expect((life.group.getObjectByName('city-guards') as THREE.Mesh).visible).toBe(false);
    expect((life.group.getObjectByName('city-gate-guards') as THREE.Mesh).visible).toBe(false);
    garrison.dispose();
    life.dispose();
  });
});
