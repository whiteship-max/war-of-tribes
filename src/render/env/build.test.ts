// Сборка окружения по частям (`env/index.startEnv`): кусками между кадрами выходит тот же
// мир, что разом, — и управление она отдаёт сотни раз, а не одним куском.
//
// Область правила (правило 11): сборка идёт по шагу за вызов (`work(0)` — ровно один
// шаг), и тест сначала проверяет, что шагов много и мир собран, а потом уже — что он тот
// же. В node нет `ImageData` — карты земли кладутся в заглушку той же формы.
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { visualTier } from '../buildings';
import { SeasonVisuals } from '../season';
import { BUDGET, QUALITIES, QUALITY } from '../quality';
import { buildEnv, startEnv, type EnvWorld } from './index';
import { trianglesOf } from './models';
import type { EnvVillage } from './rules';

beforeAll(() => {
  const g = globalThis as { ImageData?: unknown };
  if (!g.ImageData) {
    g.ImageData = class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    };
  }
});

const FULL: EnvVillage = {
  present: BUILDINGS.map((b) => b.id),
  built: BUILDINGS.map((b) => ({ type: b.id, tier: visualTier(10) })),
};
/** Посёлок в начале партии: только то, что стоит на первом уровне. */
const SMALL: EnvVillage = {
  present: BUILDINGS.map((b) => b.id),
  built: BUILDINGS.map((b) => ({ type: b.id, tier: visualTier(1) })),
};

/** Меши мира по имени: сколько экземпляров и их матрицы с цветами. */
function snapshot(w: EnvWorld): Map<string, { count: number; matrices: number[]; colors: number[] }> {
  const out = new Map<string, { count: number; matrices: number[]; colors: number[] }>();
  w.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const n = mesh.count;
    out.set(mesh.name, {
      count: n,
      matrices: Array.from((mesh.instanceMatrix.array as Float32Array).subarray(0, n * 16)),
      colors: mesh.instanceColor ? Array.from((mesh.instanceColor.array as Float32Array).subarray(0, n * 3)) : [],
    });
  });
  return out;
}

/** Вести сборку по шагу за вызов; сколько шагов вышло. */
function stepThrough(w: EnvWorld): number {
  let steps = 1;
  while (!w.work(0)) steps++;
  return steps;
}

describe('окружение пробы: сборка по частям', () => {
  it('по шагу за вызов выходит тот же мир, что разом, и шагов — сотни', () => {
    const season = new SeasonVisuals();
    const whole = buildEnv({ quality: 'medium', season, village: FULL });
    const parts = startEnv({ quality: 'medium', season, village: FULL });
    expect(parts.built(), 'до работы мир пуст').toBe(false);
    const steps = stepThrough(parts);
    expect(parts.built()).toBe(true);
    // Карта 256 — 256 рядов, лес и мелочь — по ряду решётки: кусков сотни.
    expect(steps).toBeGreaterThan(300);
    const a = snapshot(whole);
    const b = snapshot(parts);
    expect(a.size).toBeGreaterThan(10);
    expect([...b.keys()]).toEqual([...a.keys()]);
    for (const [name, one] of a) {
      const two = b.get(name)!;
      expect(two.count, name).toBe(one.count);
      expect(two.matrices, name).toEqual(one.matrices);
      expect(two.colors, name).toEqual(one.colors);
    }
    whole.dispose();
    parts.dispose();
  });

  it('пересчёт под постройки идёт кусками, подменяет покров разом и сходится со сборкой заново', () => {
    const season = new SeasonVisuals();
    const w = buildEnv({ quality: 'medium', season, village: SMALL });
    const grass = w.group.getObjectByName('grass') as THREE.InstancedMesh;
    const array = grass.instanceMatrix.array as Float32Array;
    const was = Float32Array.from(array);
    const count = grass.count;
    const version = grass.instanceMatrix.version;
    w.setVillage(FULL);
    // Область правила — середина раскладки: новые матрицы уже пишутся, а пересчёт не кончен.
    // Там видеокарта обязана держать прежний покров: ни нового числа, ни выгрузки.
    let mid = 0;
    let steps = 1;
    while (!w.work(0)) {
      steps++;
      // Сравнение с шагом: весь массив на каждом шаге — секунды теста зря.
      let changed = false;
      for (let i = 0; i < array.length && !changed; i += 7) changed = array[i] !== was[i];
      if (changed) {
        mid++;
        expect(grass.count, 'число экземпляров — прежнее до конца').toBe(count);
        expect(grass.instanceMatrix.version, 'выгрузки до конца нет').toBe(version);
      }
    }
    expect(mid, 'застали раскладку в середине').toBeGreaterThan(2);
    expect(steps).toBeGreaterThan(100);
    expect(grass.instanceMatrix.version).toBeGreaterThan(version);
    const fresh = snapshot(buildEnv({ quality: 'medium', season, village: FULL }));
    const now = snapshot(w);
    for (const name of ['grass', 'flowers', 'crops']) {
      expect(now.get(name)!.count, name).toBe(fresh.get(name)!.count);
      expect(now.get(name)!.matrices, name).toEqual(fresh.get(name)!.matrices);
    }
    w.dispose();
  });

  it('новый пересчёт заменяет начатый, а не встаёт вторым', () => {
    const season = new SeasonVisuals();
    const w = buildEnv({ quality: 'low', season, village: SMALL });
    w.setVillage(FULL);
    for (let i = 0; i < 20; i++) w.work(0);
    w.setVillage(SMALL);
    stepThrough(w);
    const fresh = snapshot(buildEnv({ quality: 'low', season, village: SMALL }));
    expect(snapshot(w).get('flowers')!.matrices).toEqual(fresh.get('flowers')!.matrices);
    w.dispose();
  });
});

/**
 * Цена мира по счётчикам, не зависящим от железа: вызовы отрисовки, треугольники и память
 * текстур — того, что окружение добавляет к кадру. Верхняя граница: все деревья прежнего
 * мира — ближней моделью (камера в середине, дальность без края), дальний лес — дальней.
 */
function price(w: EnvWorld, shadowMap: number): { calls: number; triangles: number; textureMb: number } {
  const camera = new THREE.PerspectiveCamera();
  w.update({ t: 0, camera, sun: new THREE.Vector3(3, 8, 2), light: { daylight: 1, nightK: 0, dusk: 0 }, fogFar: 1e6 });
  let calls = 0;
  let triangles = 0;
  w.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const n = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    if (n <= 0) return;
    calls++;
    triangles += trianglesOf(mesh.geometry) * n;
  });
  // Карта теней: цвет и глубина по четыре байта на тексель.
  return { calls, triangles, textureMb: (shadowMap ** 2 * 8 + w.textureBytes()) / 1048576 };
}

describe('окружение пробы: бюджет уровней', () => {
  it('мир каждого уровня укладывается в свой бюджет вызовов, треугольников и памяти текстур', () => {
    const season = new SeasonVisuals();
    for (const q of QUALITIES) {
      const w = buildEnv({ quality: q, season, village: FULL });
      const p = price(w, QUALITY[q].shadowMap);
      // Область: мир собран и не пуст — земля, лес, мелочь, покров.
      expect(p.calls, `${q}: вызовы есть`).toBeGreaterThan(10);
      expect(p.triangles, `${q}: треугольники`).toBeLessThanOrEqual(BUDGET[q].triangles);
      expect(p.calls, `${q}: вызовы`).toBeLessThanOrEqual(BUDGET[q].calls);
      expect(p.textureMb, `${q}: текстуры`).toBeLessThanOrEqual(BUDGET[q].textureMb);
      expect(w.counts().grass, `${q}: трава не больше заказанного`).toBeLessThanOrEqual(QUALITY[q].grass);
      w.dispose();
    }
  });
});
