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
import { SHADOW_LAYER, lodDistance, nearDistance } from '../reel/crowd';
import { cameraPosition } from '../reel/camera';

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
 * поверх потолка фигур. Бойцы — все в кадре и все в среднем облике (`Crowd.update` без камеры): толпа не отсекает
 * никого, и ближний облик не нужен — его цену меряет кадр вблизи (`closeUp`).
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
    stage.crowd.update(stage.frame, null);
    const c = countStage(stage);
    if (!worst || c.calls + c.triangles / 1e4 > worst.calls + worst.triangles / 1e4) worst = c;
  }
  stage.dispose();
  return worst!;
}

/** Камера ролика на четырёх числах (`reel/camera`): место и взгляд на цель, поле зрения портрета. */
function placed(now: { tx: number; tz: number; dist: number; yaw: number; pitch: number }, fov = 52): { camera: THREE.PerspectiveCamera; now: typeof now; groundY: number } {
  const camera = new THREE.PerspectiveCamera(fov, 390 / 844, 0.5, 3000);
  cameraPosition(now, 0, camera.position);
  camera.lookAt(now.tx, 0, now.tz);
  camera.updateMatrixWorld();
  return { camera, now, groundY: 0 };
}

/**
 * Кадр вблизи (облик бойцов, docs/polish.md, П-5): камера в шести метрах от середины нашей первой линии, на сшибке —
 * ближние бойцы в ближнем облике, дальние — в среднем и дальнем, за кадром — никого. Самое тяжёлое место для ближнего
 * облика: строй на потолке фигур уровня, обе линии сошлись.
 */
function closeUp(q: Quality): { count: Count; shown: [number, number, number]; stage: TwStage; cam: ReturnType<typeof placed> } {
  const b = standBattle(new URLSearchParams('replay=tw&men=4000&foe=4000&seed=7&place=woods,road'));
  const plan = twPlanOfRecord(b.result, b.us, b.troops, q, b.militia, b.place, b.beastSide);
  const stage = new TwStage(plan, TW_SPEC[q]);
  const t = plan.clashAt + 0.5;
  const front = plan.units.filter((u) => u.ours && u.row === 'front').sort((a, c) => Math.abs(a.x) - Math.abs(c.x))[0];
  const cam = placed({ tx: front.x, tz: plan.contactZ[front.side], dist: 6, yaw: front.ours ? Math.PI + 0.5 : 0.5, pitch: 0.25 });
  stage.apply(t, cam as never, t);
  return { count: countStage(stage), shown: [...stage.crowd.shown] as [number, number, number], stage, cam };
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

  it('сторож опустил уровень посреди ролика: гаснут тени бойцов, облака и кустики — кадр дешевле, фигур столько же', () => {
    const b = standBattle(new URLSearchParams('replay=tw&men=4000&foe=4000&seed=7&place=woods,road'));
    const plan = twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide);
    const stage = new TwStage(plan, TW_SPEC.medium);
    const cam = { camera: new THREE.PerspectiveCamera(), now: { tx: 0, tz: 0, dist: 120, yaw: 0, pitch: 0.8 }, groundY: 0 };
    stage.apply(1, cam as never, 1);
    const before = countStage(stage);
    stage.lower(TW_SPEC.low);
    stage.apply(1, cam as never, 1);
    const after = countStage(stage);
    stage.dispose();
    // Точка внутри области правила: у среднего есть что гасить — тени бойцов, облака, кустики.
    expect(TW_SPEC.medium.shadow).toBe('proxy');
    expect(TW_SPEC.medium.tufts).toBeGreaterThan(0);
    expect(after.calls, 'вызовов').toBeLessThan(before.calls);
    expect(after.triangles, 'треугольников').toBeLessThan(before.triangles);
    expect(after.figures).toBe(before.figures);
  });

  it('кадр вблизи: ближний облик у ближних, за кадром никого — в бюджете уровня', () => {
    for (const q of QUALITIES) {
      const { count, shown, stage } = closeUp(q);
      const b = TW_BUDGET[q];
      if (process.env.TW_BUDGET_SHOW === '1') {
        console.log(`вблизи ${q}: в кадре вдали/средн/вблизи ${shown.join('/')} из ${count.figures} · вызовов ${count.calls} · треугольников ${count.triangles}`);
      }
      // Точка внутри области правила: вблизи есть бойцы в ближнем облике, а часть поля — за кадром.
      expect(shown[2], `${q}: ближних`).toBeGreaterThan(0);
      expect(shown[0] + shown[1] + shown[2], `${q}: в кадре`).toBeLessThan(count.figures);
      expect(count.calls, `${q}: вызовов`).toBeLessThanOrEqual(b.calls);
      expect(count.triangles, `${q}: треугольников`).toBeLessThanOrEqual(b.triangles);
      stage.dispose();
    }
  });

  it('отсечение: всякий боец в пирамиде обзора нарисован, всякий за спиной камеры — нет', () => {
    const { stage, cam } = closeUp('medium');
    const frame = stage.frame;
    const plan = stage.plan;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.camera.projectionMatrix, cam.camera.matrixWorldInverse));
    const look = new THREE.Vector3();
    cam.camera.getWorldDirection(look);
    let inside = 0;
    let behind = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < plan.figures; i++) {
      if (!frame.shown[i]) continue;
      p.set(frame.x[i], frame.y[i] + 0.6, frame.z[i]);
      if (frustum.containsPoint(p)) inside++;
      else if (p.clone().sub(cam.camera.position).dot(look) < -3) behind++;
    }
    // Точка внутри области: в кадре и за спиной есть бойцы.
    expect(inside).toBeGreaterThan(20);
    expect(behind).toBeGreaterThan(20);
    const drawn = stage.crowd.shown[0] + stage.crowd.shown[1] + stage.crowd.shown[2];
    // Нарисованы все, чья середина в кадре, — и не больше, чем не за спиной.
    expect(drawn).toBeGreaterThanOrEqual(inside);
    expect(drawn).toBeLessThanOrEqual(plan.figures - behind);
    // Пороги обликов: ближний ближе дальнего.
    expect(nearDistance(52)).toBeLessThan(lodDistance(52));
    stage.dispose();
  });

  it('низкий дешевле среднего, средний — высокого', () => {
    expect(counts.low.triangles).toBeLessThan(counts.medium.triangles);
    expect(counts.medium.triangles).toBeLessThan(counts.high.triangles);
  });
});
