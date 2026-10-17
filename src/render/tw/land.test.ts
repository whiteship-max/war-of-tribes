// Земля ролика вне города (docs/city_v3.md, Г-3): тракт и тропа к логову — чистые от деревьев и кустиков и нарисованы
// шейдером по своей оси, камни — не под строем и не в воде, пашня — только вдали.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { TW_SPEC } from '../reel/spec';
import { TwStage } from './stage';
import { roadX, stoneSpots, trailX } from '../reel/land';
import type { TwPlan } from './plan';

function stageOf(query: string): { plan: TwPlan; stage: TwStage } {
  const b = standBattle(new URLSearchParams(query));
  const plan = twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, b.site);
  return { plan, stage: new TwStage(plan, TW_SPEC.medium, null) };
}

function spots(stage: TwStage, name: string): { x: number; z: number; s: number }[] {
  const im = stage.scene.getObjectByName(name) as THREE.InstancedMesh | undefined;
  if (!im) return [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const out: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m);
    m.decompose(p, q, s);
    out.push({ x: p.x, z: p.z, s: s.y });
  }
  return out;
}

/** Униформы земли: шейдер собирается подменой кусков — отдаём ему пустую заготовку и читаем, что он положил. */
function groundUniforms(stage: TwStage): Record<string, { value: unknown }> {
  const plate = stage.scene.getObjectByName('tw-plate') as THREE.Mesh;
  const sh = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
  (plate.material as THREE.Material).onBeforeCompile(sh as never, null as never);
  return sh.uniforms;
}

describe('ролик: земля вне города (Г-3)', () => {
  it('логово: тропа от ворот лагеря в поле — в шейдере, деревья и кустики на неё не встают', () => {
    const { stage } = stageOf('replay=tw&site=lair&men=300&foe=220&seed=8&place=woods&hour=17');
    const u = groundUniforms(stage).uTwTrail.value as THREE.Vector4;
    expect(u.x, 'тропа есть').toBe(1);
    // Ось тропы — от середины лагеря (`uTwTrail.y`), как у шейдера.
    const c = { x0: u.y, x1: u.y, z0: 0, z1: 0 };
    const front = u.z;
    const dir = u.w;
    // Граница области: тропа — за воротами лагеря, на поле; кустики травы лежат по всему полю, и у тропы их много.
    const side = spots(stage, 'tw-tufts').filter((t) => (t.z - front) * dir < 1 && Math.abs(t.x - trailX(c, t.z)) < 5);
    expect(side.length, 'кустики у тропы — проверка внутри области').toBeGreaterThan(20);
    for (const t of side) expect(Math.abs(t.x - trailX(c, t.z)), `кустик на тропе (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBeGreaterThan(1.1 + 0.3 - 1e-6);
    for (const t of [...spots(stage, 'tw-spruce'), ...spots(stage, 'tw-oak')]) {
      if ((t.z - front) * dir < 1) expect(Math.abs(t.x - trailX(c, t.z)), `дерево на тропе (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBeGreaterThan(1.1 + 1.5 - 1e-6);
    }
    stage.dispose();
  });

  it('тракт: в шейдере до горизонта, деревья, кустики и камни — не на нём', () => {
    const { plan, stage } = stageOf('replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10');
    const f = plan.field;
    expect(f.road).toBe(true);
    const u = groundUniforms(stage);
    expect((u.uTwRoad.value as THREE.Vector4).x, 'тракт есть').toBe(1);
    expect((u.uTwRoad.value as THREE.Vector4).y).toBe(f.seed);
    for (const t of [...spots(stage, 'tw-spruce'), ...spots(stage, 'tw-oak')]) expect(Math.abs(t.x - roadX(f, t.z)), `дерево на тракте (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBeGreaterThan(3 - 1e-6);
    for (const t of spots(stage, 'tw-tufts')) expect(Math.abs(t.x - roadX(f, t.z)), `кустик на тракте (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBeGreaterThan(2.2 - 1e-6);
    const stones = spots(stage, 'tw-stones');
    expect(stones.length, 'камни есть').toBeGreaterThan(0);
    for (const s of stones) expect(Math.abs(s.x - roadX(f, s.z)), `камень на тракте (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`).toBeGreaterThan(2.6 - 1e-6);
    stage.dispose();
  });

  it('холмы: валуны выходами — не под строем на построении и не дальше кромки поля; камней не больше уровня', () => {
    const { plan, stage } = stageOf('replay=tw&men=500&foe=420&seed=3&place=hills,woods&hour=8');
    const f = plan.field;
    const stones = spots(stage, 'tw-stones');
    expect(stones.length).toBeLessThanOrEqual(TW_SPEC.medium.stones);
    // Граница области: валуны (выше 0.4 · 0.62 единицы) — есть; спутники гнезда — у своего валуна, его проверяем.
    const big = stones.filter((s) => s.s > 0.4 * 0.62);
    expect(big.length, 'валуны').toBeGreaterThan(5);
    for (const s of big) {
      expect(Math.abs(s.x) < f.halfX + 24 + 4 && s.z > f.minZ - 18 - 4 && s.z < f.maxZ + 18 + 4, `камень за кромкой поля (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBe(true);
    }
    // Строй во всю середину поля: валуны его обходят. Граница области: вне строя валуны есть, и строй стоит там, где без
    // правила их было бы много (холмы — гнёзда по всему полю).
    const wide = [{ x: 0, z: (f.minZ + f.maxZ) / 2, width: f.halfX, depth: (f.maxZ - f.minZ) / 4, ours: true }];
    const rocks = stoneSpots(f, { field: f, deployZ: { attacker: f.minZ, defender: f.maxZ }, units: wide, site: null }, 400).filter((r) => r.s >= 0.45);
    const u = wide[0];
    const inside = (r: { x: number; z: number }, pad: number): boolean => Math.abs(r.x - u.x) < u.width / 2 - pad && Math.abs(r.z - u.z) < u.depth - pad;
    expect(rocks.filter((r) => !inside(r, -3)).length, 'валуны вне строя').toBeGreaterThan(10);
    // Спутник гнезда может лечь у края строя (до 4,3 единицы от валуна за краем); глубже — валунов нет.
    for (const r of rocks) expect(inside(r, 4.5), `валун под строем (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`).toBe(false);
    // Пашни на холмах нет: пастбище и камень.
    expect((groundUniforms(stage).uTwFarm.value as THREE.Vector4).x).toBe(0);
    stage.dispose();
  });
});
