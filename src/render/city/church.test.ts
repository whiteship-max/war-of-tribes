// Храм лицом к площади (docs/city_v3.md, Г-2): портал смотрит на камеру игры, домов за храмом нет, прихожане поднимаются по
// лестнице, входят в открытую створку и выходят, ноги на лестнице — у ступеней; у колодца стоят лицом к нему.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHURCH, PARVIS, cityPlan, heightAt, insidePoly } from './layout';
import { buildStatic } from './budget';
import { CityLife, visitAt, visitOf } from './life';
import { CITY_AZIMUTH, cityFraming } from './camera';
import { STEP_RISE_MAX } from './precinct';

const plan = cityPlan();
const church = plan.civic.find((c) => c.kind === 'church')!;
const door = { x: CHURCH.x, z: CHURCH.front + 0.75 };

describe('город: храм лицом к площади', () => {
  it('портал смотрит на камеру игры, храм стоит там, где его ждут паперть и ограда', () => {
    const f = cityFraming(390 / 844);
    const elev = Math.PI / 2 - f.polar;
    const cam = {
      x: f.target.x + Math.sin(CITY_AZIMUTH) * Math.cos(elev) * f.dist,
      z: f.target.z + Math.cos(CITY_AZIMUTH) * Math.cos(elev) * f.dist,
    };
    const fx = Math.cos(church.rot);
    const fz = Math.sin(church.rot);
    const tx = cam.x - door.x;
    const tz = cam.z - door.z;
    // Камера — перед фасадом: направление на неё почти по нормали портала.
    expect((fx * tx + fz * tz) / Math.hypot(tx, tz), 'портал к камере').toBeGreaterThan(0.9);
    // Фасад храма — у паперти: передняя грань там, где начинается площадка.
    expect(church.z + (fz * church.d) / 2).toBeCloseTo(CHURCH.front, 6);
    expect(church.x).toBe(CHURCH.x);
  });

  it('за храмом и по бокам его двора домов нет — до улицы вдоль стены', () => {
    // Граница области: полоса за апсидой и бока двора — внутри городской стены.
    const behind = { x0: CHURCH.x - 14, x1: CHURCH.x + 14, z0: CHURCH.front - CHURCH.len, z1: -100 };
    for (const p of [
      { x: behind.x0, z: behind.z1 },
      { x: behind.x1, z: behind.z1 },
      { x: behind.x0, z: behind.z0 },
      { x: behind.x1, z: behind.z0 },
    ]) {
      expect(insidePoly(p, plan.wall), 'полоса — внутри стены').toBe(true);
    }
    for (const h of plan.houses) {
      const inBehind = h.x > behind.x0 && h.x < behind.x1 && h.z < behind.z0 && h.z > behind.z1;
      const inYard = h.x > -28 && h.x < 16 && h.z < -36 && h.z > CHURCH.front - CHURCH.len;
      expect(inBehind || inYard, `дом за храмом (${h.x.toFixed(0)}, ${h.z.toFixed(0)})`).toBe(false);
    }
    // Город не опустел: убраны только дома двора.
    expect(plan.houses.length).toBeGreaterThan(150);
  });

  it('прихожане входят в храм и выходят: пропадают только у порога, внутри — за ним', () => {
    let hides = 0;
    let shows = 0;
    for (let k = 0; k < 40; k++) {
      const v = visitOf(plan, k, 74);
      let was: { x: number; z: number; hidden: boolean } | null = null;
      const period = (2 * v.len) / v.v + v.inside + v.stay;
      for (let t = 0; t < period * 2; t += 0.25) {
        const p = visitAt(v, t);
        if (p.hidden) {
          expect(p.z, 'в храме — за порогом').toBeLessThan(door.z);
        } else {
          // На виду — перед лицом портала: не в храме и не в стене.
          expect(p.z, 'на виду — перед порталом').toBeGreaterThanOrEqual(door.z - 0.01);
        }
        if (was && was.hidden !== p.hidden) {
          const at = p.hidden ? was : p;
          expect(Math.hypot(at.x - door.x, at.z - door.z), 'пропадает и появляется у порога').toBeLessThan(1.2);
          if (p.hidden) hides++;
          else shows++;
        }
        was = { x: p.x, z: p.z, hidden: p.hidden };
      }
    }
    // Граница области: за два периода каждый успел и войти, и выйти.
    expect(hides).toBeGreaterThanOrEqual(40);
    expect(shows).toBeGreaterThanOrEqual(40);
  });

  it('на лестнице паперти ноги прихожанина — у ступеней, не в камне и не в воздухе', () => {
    const footY = heightAt(CHURCH.x, PARVIS.foot);
    const rise = church.base - footY;
    const run = PARVIS.foot - PARVIS.top;
    const n = Math.max(3, Math.ceil(rise / STEP_RISE_MAX));
    let onStairs = 0;
    for (let k = 0; k < 30; k++) {
      const v = visitOf(plan, k, 74);
      const period = (2 * v.len) / v.v + v.inside + v.stay;
      for (let t = 0; t < period; t += 0.2) {
        const p = visitAt(v, t);
        // Граница области: точка — над ступенями, а не над площадкой или мостовой.
        if (p.hidden || p.z <= PARVIS.top + 0.05 || p.z >= PARVIS.foot - 0.05) continue;
        expect(Math.abs(p.x - CHURCH.x), 'в ширину лестницы').toBeLessThan(PARVIS.half);
        const step = Math.min(n - 1, Math.floor(((p.z - PARVIS.top) / run) * n));
        const top = church.base - ((step + 1) * rise) / (n + 1);
        expect(Math.abs(p.y - top), `ступень ${step}, z ${p.z.toFixed(2)}`).toBeLessThan(0.3);
        onStairs++;
      }
    }
    expect(onStairs).toBeGreaterThan(100);
  });

  it('у колодца стоят лицом к нему, мимо сруба', () => {
    const st = buildStatic(plan, 'medium');
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'high' });
    life.set(1000, 1000, []);
    life.update(0.1, 0, 0, 0);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let near = 0;
    for (const im of life.group.children) {
      if (!(im instanceof THREE.InstancedMesh) || !im.name.startsWith('city-people')) continue;
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, m);
        p.setFromMatrixPosition(m);
        const d = Math.hypot(p.x - plan.well.x, p.z - plan.well.z);
        // Граница области: в трёх метрах от колодца ни одна улица и ни один путь площади не проходят — тут только кружок.
        if (d > 3) continue;
        near++;
        expect(d, 'не в срубе').toBeGreaterThan(1.6);
        dir.setFromMatrixColumn(m, 0).normalize();
        const to = { x: (plan.well.x - p.x) / d, z: (plan.well.z - p.z) / d };
        expect(dir.x * to.x + dir.z * to.z, 'лицом к колодцу').toBeGreaterThan(0.9);
      }
    }
    expect(near).toBeGreaterThanOrEqual(4);
    life.dispose();
  });
});
