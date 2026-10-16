// Бюджет кадра ролика осады по уровням — подсчётом построенного, без браузера (как `render/tw/budget.test.ts`): сцена
// собирается целиком, как в игре, и на каждом эпизоде (начало и середина) обходится — вызовы и треугольники главного
// прохода и теневого, байты текстур. Осады — образцы стенда: каждый исход, машины, пожар, частокол и логово. Уровни те
// же, что у ролика боя (`TW_BUDGET`): телефону ролик осады не дороже ролика боя.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES, type Quality } from '../quality';
import { TW_BUDGET, TW_SPEC } from '../reel/spec';
import { SHADOW_LAYER } from '../reel/crowd';
import { showOfSiege } from '@/ui/battle/siege';
import { standSiege } from './stand';
import { siegeReel } from './reel';
import { SiegeStage } from './stage';

const CASES = ['gates', 'storm', 'hunger', 'broken', 'paid', 'lair', 'repair'] as const;

interface Count {
  calls: number;
  triangles: number;
  bytes: number;
  /** Секунда ролика и эпизод худшего кадра. */
  at: string;
}

/** Что нарисует кадр: каждый видимый меш — вызов, его треугольники на число инстансов; тень — второй раз. */
function countStage(stage: SiegeStage): Omit<Count, 'at'> {
  let calls = 0;
  let triangles = 0;
  stage.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    if (m.layers.mask !== 1 << SHADOW_LAYER) {
      calls += 1;
      triangles += tris * inst;
    }
    if (m.castShadow) {
      calls += 1;
      triangles += tris * inst;
    }
  });
  return { calls, triangles, bytes: stage.textureBytes() };
}

/** Худший кадр осады на уровне: начало и середина каждого эпизода. */
function heaviest(name: string, q: Quality): Count & { seconds: number; samples: number } {
  const { rec, report } = standSiege(new URLSearchParams(`replay=siege&case=${name}`));
  const reel = siegeReel(showOfSiege(rec, report), q);
  const stage = new SiegeStage(reel, TW_SPEC[q]);
  const camera = new THREE.PerspectiveCamera(40, 390 / 844, 0.5, 2000);
  camera.position.set(0, 60, -90);
  const cam = { camera, now: { tx: 0, tz: 0, dist: 90, yaw: 0, pitch: 0.6 }, groundY: 0 };
  let worst: Count | null = null;
  let samples = 0;
  for (const ep of reel.episodes) {
    for (const t of [ep.at + 0.2, ep.at + ep.len * 0.5]) {
      stage.apply(t, cam as never);
      samples++;
      const c = countStage(stage);
      if (!worst || c.calls + c.triangles / 1e4 > worst.calls + worst.triangles / 1e4) worst = { ...c, at: `${t.toFixed(1)} с, ${ep.kind}` };
    }
  }
  stage.dispose();
  return { ...worst!, seconds: reel.seconds, samples };
}

describe('ролик осады: бюджет кадра по уровням', () => {
  it.each(CASES)('%s: вызовов, треугольников и текстур не больше бюджета уровня ролика боя', (name) => {
    for (const q of QUALITIES) {
      const c = heaviest(name, q);
      const b = TW_BUDGET[q];
      // Граница области: ролик прошёл все эпизоды, и кадров в обходе больше одного на эпизод.
      expect(c.samples, `${name} ${q}: кадров в обходе`).toBeGreaterThan(4);
      if (process.env.TW_BUDGET_SHOW === '1') console.log(`${name} ${q}: ${c.seconds.toFixed(0)} с · вызовов ${c.calls} · треугольников ${c.triangles} · текстуры ${(c.bytes / 1048576).toFixed(1)} МБ · худший — ${c.at}`);
      expect(c.calls, `${name} ${q}: вызовов (${c.at})`).toBeLessThanOrEqual(b.calls);
      expect(c.triangles, `${name} ${q}: треугольников (${c.at})`).toBeLessThanOrEqual(b.triangles);
      expect(c.bytes / 1048576, `${name} ${q}: текстуры, МБ`).toBeLessThanOrEqual(b.textureMB);
    }
  }, 120_000);
});
