// Бюджет кадра ролика TW по уровням — подсчётом построенного, без браузера (docs/battle_tw.md, раздел 7; как
// `city.test.ts` считает город). Сцена собирается целиком, как на стенде, и обходится: вызовы и треугольники главного
// прохода и теневого, байты текстур. Бой — самый тяжёлый: обе стороны на потолке фигур уровня.
import { barrageShares } from '@/ui/battle/barrage';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES, type Quality } from '../quality';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { TW_BUDGET, TW_SPEC } from '../reel/spec';
import { TwStage } from './stage';
import { SHADOW_LAYER } from '../reel/crowd';

interface Count {
  calls: number;
  triangles: number;
  figures: number;
  bytes: number;
}

/** Что нарисует кадр: каждый видимый меш — вызов, его треугольники на число инстансов; тень — второй раз. */
function countStage(stage: TwStage): Count {
  let calls = 0;
  let triangles = 0;
  stage.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    const shadowOnly = m.layers.mask === 1 << SHADOW_LAYER;
    if (!shadowOnly) {
      calls += 1;
      triangles += tris * inst;
    }
    if (m.castShadow) {
      calls += 1;
      triangles += tris * inst;
    }
  });
  return { calls, triangles, figures: stage.plan.figures, bytes: stage.textureBytes() };
}

/**
 * Самый тяжёлый кадр уровня: войска больше потолка с обеих сторон, все фигуры поставлены, лес. С местом боя
 * (docs/battle_tw.md, раздел 13) — то же войско у стены, у ворот, у лагеря, у логова: камень, дома, шатры и лестницы
 * поверх потолка фигур.
 */
function heaviest(q: Quality, site = '', shots = 0): Count {
  const b = standBattle(new URLSearchParams(`replay=tw&men=4000&foe=4000&seed=7&place=woods,road,river,ford${site ? `&site=${site}` : ''}`));
  const plan = twPlanOfRecord(b.result, b.us, b.troops, q, b.militia, b.place, b.beastSide, b.site, barrageShares(shots));
  const stage = new TwStage(plan, TW_SPEC[q]);
  // Кадр на построении: все живы и все стоят — фигур больше, чем когда-либо потом.
  const cam = { camera: new THREE.PerspectiveCamera(), now: { tx: 0, tz: 0, dist: 120, yaw: 0, pitch: 0.8 }, groundY: 0 };
  // С обстрелом (раздел 15) — самый тяжёлый кадр пролога: строи стоят, и в воздухе камни, обломки, пыль обвала и дым;
  // перебор по четверти секунды, берётся худший. Бой после пролога — с машинами, сбитыми и дымом.
  let worst: Count | null = null;
  const pre = plan.barrage?.seconds ?? 0;
  const times = pre > 0 ? [...Array.from({ length: Math.ceil(pre * 4) }, (_, i) => i / 4), pre + 1] : [1];
  for (const clip of times) {
    stage.apply(pre > 0 ? Math.max(0, clip - pre) : clip, cam as never, clip);
    const c = countStage(stage);
    if (!worst || c.calls + c.triangles / 1e4 > worst.calls + worst.triangles / 1e4) worst = c;
  }
  stage.dispose();
  return worst!;
}

describe('ролик TW: бюджет кадра по уровням', () => {
  const counts = Object.fromEntries(QUALITIES.map((q) => [q, heaviest(q)])) as Record<Quality, Count>;

  it('вызовов, треугольников и текстур не больше бюджета уровня', () => {
    for (const q of QUALITIES) {
      const c = counts[q];
      const b = TW_BUDGET[q];
      expect(c.calls, `${q}: вызовов`).toBeLessThanOrEqual(b.calls);
      expect(c.triangles, `${q}: треугольников`).toBeLessThanOrEqual(b.triangles);
      expect(c.bytes / 1048576, `${q}: текстуры, МБ`).toBeLessThanOrEqual(b.textureMB);
    }
  });

  it('бой на потолке: фигур почти вдвое больше потолка стороны — замер на самом тяжёлом месте', () => {
    // Точка внутри области правила (правило 11): обе стороны упёрлись в потолок, а не стоят малым числом.
    for (const q of QUALITIES) expect(counts[q].figures).toBeGreaterThan(TW_SPEC[q].perSide * 1.8);
    if (process.env.TW_BUDGET_SHOW === '1') {
      for (const q of QUALITIES) {
        const c = counts[q];
        console.log(`${q}: фигур ${c.figures} · вызовов ${c.calls} · треугольников ${c.triangles} · текстуры ${(c.bytes / 1048576).toFixed(1)} МБ`);
      }
    }
  });

  it('место боя (стена, ворота, лагерь, логово) — в том же бюджете уровня', () => {
    for (const site of ['wall', 'gate', 'sortie', 'camp', 'joint', 'lair']) {
      for (const q of QUALITIES) {
        const c = heaviest(q, site);
        const b = TW_BUDGET[q];
        if (process.env.TW_BUDGET_SHOW === '1') console.log(`${site} ${q}: фигур ${c.figures} · вызовов ${c.calls} · треугольников ${c.triangles} · текстуры ${(c.bytes / 1048576).toFixed(1)} МБ`);
        expect(c.calls, `${site} ${q}: вызовов`).toBeLessThanOrEqual(b.calls);
        expect(c.triangles, `${site} ${q}: треугольников`).toBeLessThanOrEqual(b.triangles);
        expect(c.bytes / 1048576, `${site} ${q}: текстуры, МБ`).toBeLessThanOrEqual(b.textureMB);
        // Точка внутри области: обе стороны на потолке фигур, место построено.
        expect(c.figures, `${site} ${q}`).toBeGreaterThan(TW_SPEC[q].perSide * 1.8);
      }
    }
  });

  it('обстрел перед штурмом (стена и логово, три залпа) — в том же бюджете уровня', () => {
    for (const site of ['wall', 'lair']) {
      for (const q of QUALITIES) {
        const c = heaviest(q, site, 3);
        const bare = heaviest(q, site);
        const b = TW_BUDGET[q];
        if (process.env.TW_BUDGET_SHOW === '1') {
          console.log(`${site}+обстрел ${q}: вызовов ${bare.calls} → ${c.calls} · треугольников ${bare.triangles} → ${c.triangles}`);
        }
        // Точка внутри области: пролог есть и что-то добавил.
        expect(c.calls, `${site} ${q}`).toBeGreaterThan(bare.calls);
        expect(c.calls, `${site} ${q}: вызовов`).toBeLessThanOrEqual(b.calls);
        expect(c.triangles, `${site} ${q}: треугольников`).toBeLessThanOrEqual(b.triangles);
      }
    }
  });

  it('низкий дешевле среднего, средний — высокого', () => {
    expect(counts.low.triangles).toBeLessThan(counts.medium.triangles);
    expect(counts.medium.triangles).toBeLessThan(counts.high.triangles);
  });
});
