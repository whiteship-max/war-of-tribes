// Поля города (docs/city_v3.md, Р-2; слово владельца): за рекой полей нет — там лес; у города пашня — только справа от хутора,
// много и клетками разных культур, с полевыми дорогами по межам; на месте прежней пашни — луг, лес и рощи; деревни вдали —
// с полями только около них.
import { describe, expect, it } from 'vitest';
import { cityPlan, distSeg, riverX, RIVER_HALF } from './layout';
import { FARM_FIELDS, fieldAt, hamlets } from './ground';
import { forestAt, LAND_AT } from './nature';

const plan = cityPlan();
const farm = plan.yards.find((y) => y.kind === 'farm')!;
const hs = hamlets(plan);
const nearHamlet = (x: number, z: number, pad: number): boolean => hs.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 60 + pad);

describe('город: поля (Р-2)', () => {
  it('за рекой полей нет — и у деревни, чей круг полей заходит за реку', () => {
    let west = 0;
    let wood = 0;
    let hamletWest = 0;
    for (let z = LAND_AT.z0; z < LAND_AT.z0 + LAND_AT.size; z += 12)
      for (let x = LAND_AT.x0; x < 0; x += 12) {
        if (x > riverX(z) - RIVER_HALF) continue;
        west++;
        if (nearHamlet(x, z, -60)) hamletWest++;
        if (forestAt(x, z, plan) > 0.3) wood++;
        expect(fieldAt(x, z, plan), `пашня за рекой (${x}, ${z})`).toBe(0);
      }
    // Граница области: правило спрашивается и там, где поле встало бы без него, — в круге полей деревни на дороге в долину.
    expect(west).toBeGreaterThan(1000);
    expect(hamletWest).toBeGreaterThan(20);
    // За рекой — лес.
    expect(wood / west).toBeGreaterThan(0.6);
  });

  it('у города пашня — только справа от хутора, клетка к клетке', () => {
    let fields = 0;
    let block = 0;
    let blockField = 0;
    for (let z = -400; z <= 400; z += 6)
      for (let x = -400; x <= 600; x += 6) {
        if (nearHamlet(x, z, 0)) continue;
        const f = fieldAt(x, z, plan);
        if (f > 0) {
          fields++;
          expect(x, `пашня левее хутора (${x}, ${z})`).toBeGreaterThan(farm.x - 2);
        }
        if (x > FARM_FIELDS.x0 + 4 && x < FARM_FIELDS.x1 && z > FARM_FIELDS.z0 + 50 && z < FARM_FIELDS.z1) {
          block++;
          if (f > 0) blockField++;
        }
      }
    // Граница области: решётка доходит и до прежней пашни под стеной и на юге (там правило запрещает), и до угодий хутора.
    expect(fields).toBeGreaterThan(1000);
    // Угодья хутора — много: межи, дороги и двор хутора берут не больше трети.
    expect(blockField / block).toBeGreaterThan(0.66);
  });

  it('полевые дороги — между полями: по обе стороны дороги в угодьях — пашня до обочины', () => {
    const tracks = plan.roads.filter((r) => r.name.startsWith('Полевая'));
    expect(tracks.length).toBe(3);
    for (const r of tracks) {
      let n = 0;
      let both = 0;
      for (let k = 0; k < r.pts.length - 1; k++) {
        const a = r.pts[k];
        const b = r.pts[k + 1];
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        for (let s = 0; s < l; s += 3) {
          const x = a.x + ((b.x - a.x) * s) / l;
          const z = a.z + ((b.z - a.z) * s) / l;
          // Граница области: внутри угодий и не у стыка с другой дорогой.
          if (x < FARM_FIELDS.x0 + 10 || plan.roads.some((o) => o !== r && o.pts.some((_, j) => j < o.pts.length - 1 && distSeg({ x, z }, o.pts[j], o.pts[j + 1]).d < 12))) continue;
          const nx = -(b.z - a.z) / l;
          const nz = (b.x - a.x) / l;
          const side = (c: number): boolean => [3.5, 4.5].some((d) => fieldAt(x + nx * d * c, z + nz * d * c, plan) > 0);
          n++;
          if (side(1) && side(-1)) both++;
        }
      }
      expect(n, r.name).toBeGreaterThan(10);
      expect(both / n, `${r.name}: пашня по обе стороны`).toBeGreaterThan(0.6);
    }
  });

  it('на месте прежней пашни — луг с рощами, не пашня и не сплошной лес', () => {
    let n = 0;
    let wood = 0;
    for (let z = 180; z < 330; z += 6)
      for (let x = -140; x < 140; x += 6) {
        if (plan.roads.some((r) => r.pts.some((_, j) => j < r.pts.length - 1 && distSeg({ x, z }, r.pts[j], r.pts[j + 1]).d < r.half + 6))) continue;
        n++;
        expect(fieldAt(x, z, plan), `пашня на юге (${x}, ${z})`).toBe(0);
        if (forestAt(x, z, plan) > 0.08) wood++;
      }
    expect(n).toBeGreaterThan(500);
    expect(wood / n, 'рощи есть').toBeGreaterThan(0.05);
    expect(wood / n, 'луг, а не сплошной лес').toBeLessThan(0.5);
  });
});
