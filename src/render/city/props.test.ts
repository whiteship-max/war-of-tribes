// Желоб мостовой и мелочь у рядов рынка (docs/city.md, 11.6): желоб — посреди мощёной улицы, на земле и не в
// проезде ворот; повозки, бочки и ящики — на площади, но не в рядах, не на статуе и не у колодца.
import { describe, expect, it } from 'vitest';
import { Builder } from './geom';
import { gutter, marketProps } from './civic';
import { cityPlan, distPoly, heightAt, insidePoly, type Stall } from './layout';

const plan = cityPlan();

const verts = (b: Builder): { x: number; y: number; z: number }[] => {
  const out: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k < b.pos.length; k += 3) out.push({ x: b.pos[k], y: b.pos[k + 1], z: b.pos[k + 2] });
  return out;
};

/** Внутри ли точка следа ряда: прилавок, столбы и навес (`civic.stall`). */
function inStall(p: { x: number; z: number }, s: Stall): boolean {
  const fx = Math.cos(s.rot + Math.PI / 2);
  const fz = Math.sin(s.rot + Math.PI / 2);
  const along = (p.x - s.x) * fx + (p.z - s.z) * fz;
  const across = (p.x - s.x) * fz - (p.z - s.z) * fx;
  return Math.abs(across) < s.w / 2 + 0.15 && along > -1.2 && along < 1.7;
}

describe('город: желоб и мелочь рынка', () => {
  it('желоб — посреди мощёной улицы, на земле, не в проезде ворот', () => {
    const paved = plan.streets.filter((s) => s.surface === 'cobble' && s.half >= 3);
    // Граница области: мощёных улиц три, и у каждой желоб есть.
    expect(paved.map((s) => s.name).sort()).toEqual(['Верхняя', 'Восточная', 'Главная']);
    for (const st of paved) {
      const b = new Builder();
      gutter(b, st.pts, plan.gates);
      const vs = verts(b);
      expect(vs.length, st.name).toBeGreaterThan(40);
      for (const v of vs) {
        expect(distPoly(v, st.pts), `${st.name}: посреди улицы`).toBeLessThan(0.6);
        const dy = v.y - heightAt(v.x, v.z);
        expect(dy, `${st.name}: на земле, не в ней`).toBeGreaterThan(0.02);
        expect(dy, `${st.name}: на земле, не над ней`).toBeLessThan(0.08);
        for (const g of plan.gates) expect(Math.hypot(v.x - g.x, v.z - g.z), `${st.name}: не в проезде ворот`).toBeGreaterThan(5);
      }
    }
  });

  it('повозки, бочки, ящики — на площади, не в рядах, не на статуе и не у колодца', () => {
    const b = new Builder();
    marketProps(b, plan.stalls[0].seed, 1);
    const vs = verts(b);
    // Граница области: мелочь есть, и её довольно — две повозки, бочки, ящики.
    expect(vs.length).toBeGreaterThan(300);
    for (const v of vs) {
      const at = `(${v.x.toFixed(1)}, ${v.z.toFixed(1)})`;
      expect(insidePoly(v, plan.square), `на площади ${at}`).toBe(true);
      expect(Math.hypot(v.x - plan.statue.x, v.z - plan.statue.z), `не на статуе ${at}`).toBeGreaterThan(1.7);
      expect(Math.hypot(v.x - plan.well.x, v.z - plan.well.z), `не у колодца ${at}`).toBeGreaterThan(5);
      for (const s of plan.stalls) expect(inStall(v, s), `не в ряду ${at}`).toBe(false);
    }
  });
});
