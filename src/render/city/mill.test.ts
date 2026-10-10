// Водяное колесо лесопилки (docs/city.md, 16.4): крутится на «Среднем» и «Высоком» и стоит на «Низком»; низ колеса идёт
// по течению мельничного ручья; брызги — над водой у лопастей; всё — функция времени.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cityPlan, distPoly, RACE, RACE_HALF } from './layout';
import { buildStatic } from './budget';
import { dropAt, flowAt, MillWheel, SPLASH, type WheelPose } from './mill';
import type { V3 } from './geom';

const plan = cityPlan();

function poseOf(q: 'high' | 'medium'): WheelPose {
  const w = buildStatic(plan, q).wheel;
  if (!w) throw new Error('колеса нет');
  return { at: w.at, fx: w.fx, fz: w.fz, R: w.R, water: w.water };
}

/** Низ колеса в мире в миг `t` — через настоящую матрицу меша (`MillWheel`). */
function bottomAt(mill: MillWheel, R: number, t: number): THREE.Vector3 {
  mill.update(t);
  mill.wheel.updateMatrixWorld(true);
  return new THREE.Vector3(0, -R, 0).applyMatrix4(mill.wheel.matrixWorld);
}

describe('город: водяное колесо', () => {
  it('крутится своим мешем на «Среднем» и «Высоком»; на «Низком» стоит в меше зданий', () => {
    expect(buildStatic(plan, 'low').wheel).toBeNull();
    for (const q of ['medium', 'high'] as const) {
      const w = buildStatic(plan, q).wheel!;
      expect(w, q).not.toBeNull();
      expect(w.b.triangleCount, `${q}: колесо не пустое`).toBeGreaterThan(100);
    }
  });

  it('стоит в мельничном ручье, лопасти — в воде', () => {
    const p = poseOf('medium');
    expect(distPoly({ x: p.at[0], z: p.at[2] }, RACE), 'ось над ручьём').toBeLessThan(RACE_HALF);
    expect(p.at[1] - p.R - 0.05, 'низ лопастей под водой').toBeLessThan(p.water);
    expect(p.at[1] - p.R + 0.75, 'но ступица над водой').toBeGreaterThan(p.water);
  });

  it('низ колеса идёт по течению ручья, ровно и без рывков', () => {
    const p = poseOf('high');
    const flow = flowAt(p.at[0], p.at[2]);
    const mill = new MillWheel(p, new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    // Граница области: полный оборот (2π / 0.55 ≈ 11.4 с) через 0.05 с.
    let n = 0;
    let prev = bottomAt(mill, p.R, 0);
    for (let t = 0.05; t < 12; t += 0.05) {
      // Низ колеса — та точка обода, что сейчас внизу: её путь за 0.05 с — по течению.
      mill.update(t);
      mill.wheel.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(mill.wheel.matrixWorld).invert();
      // Точка обода, что внизу в миг t, — в своих координатах; где она через 0.05 с.
      const local = new THREE.Vector3(p.at[0], p.at[1] - p.R, p.at[2]).applyMatrix4(inv);
      mill.update(t + 0.05);
      mill.wheel.updateMatrixWorld(true);
      const next = local.clone().applyMatrix4(mill.wheel.matrixWorld);
      const d = next.sub(new THREE.Vector3(p.at[0], p.at[1] - p.R, p.at[2]));
      expect(d.x * flow.x + d.z * flow.z, `по течению в ${t.toFixed(2)} с`).toBeGreaterThan(0);
      expect(d.length(), 'обод — около полутора метров в секунду').toBeLessThan(0.15);
      const b = bottomAt(mill, p.R, t);
      expect(b.distanceTo(prev), 'без рывка').toBeLessThan(0.15);
      prev = b;
      n++;
    }
    expect(n).toBeGreaterThan(200);
    mill.dispose();
  });

  it('брызги — у лопастей над водой, гаснут к концу жизни; тот же миг — те же капли', () => {
    const p = poseOf('high');
    const out: V3 = [0, 0, 0];
    const again: V3 = [0, 0, 0];
    let seen = 0;
    // Граница области: десять секунд через кадр — каждая капля прожила много жизней.
    for (let t = 0; t < 10; t += 1 / 30) {
      for (let i = 0; i < SPLASH; i++) {
        const a = dropAt(p, i, t, out);
        expect(dropAt(p, i, t, again)).toBe(a);
        expect(again).toEqual(out);
        if (a <= 0) continue;
        seen++;
        expect(out[1], 'над водой').toBeGreaterThanOrEqual(p.water);
        expect(out[1] - p.water, 'не выше полутора метров').toBeLessThan(1.5);
        // У колеса: в пределах его круга и ширины по оси, с запасом на полёт.
        const dx = out[0] - p.at[0];
        const dz = out[2] - p.at[2];
        const along = dx * p.fx + dz * p.fz;
        const across = dx * p.fz - dz * p.fx;
        expect(Math.abs(along), 'вдоль оси — у лопастей').toBeLessThan(1.4);
        expect(Math.abs(across), 'поперёк — у обода').toBeLessThan(p.R + 0.8);
      }
    }
    expect(seen, 'брызги видны').toBeGreaterThan(SPLASH * 300 * 0.3);
  });
});
