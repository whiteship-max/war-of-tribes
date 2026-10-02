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

describe('город: кроны', () => {
  it('ком листвы освещён круглым: излом нормалей между соседними гранями — меньше 25°, у граней — больше 40°', async () => {
    const { treeModel } = await import('./nature');
    const { L } = await import('./tex');
    const angle = (a: number[], c: number[]): number => (Math.acos(Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2])) * 180) / Math.PI;
    for (const sp of ['broad', 'fruit', 'broadFar'] as const) {
      const b = treeModel(sp, 2);
      const P = (k: number): number[] => [b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2]];
      // Плоская нормаль грани — из её углов (у этих пород одни четырёхугольники, по четыре вершины подряд).
      const flat = (k: number): number[] => {
        const q = k - (k % 4);
        const [a, e, d] = [P(q), P(q + 1), P(q + 3)];
        const u = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
        const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        return [n[0] / l, n[1] / l, n[2] / l];
      };
      const N = (k: number): number[] => [b.nor[k * 3], b.nor[k * 3 + 1], b.nor[k * 3 + 2]];
      const at = new Map<string, number[]>();
      for (let k = 0; k < b.pos.length / 3; k++) {
        if (b.cfg[k * 4] !== L.foliage) continue;
        // Ключ точки — в стотысячных; «−0» и «0» — одна точка.
        const key = P(k).map((x) => Math.round(x * 1e5) || 0).join(',');
        at.set(key, [...(at.get(key) ?? []), k]);
      }
      let pairs = 0;
      let flatWorst = 0;
      let roundWorst = 0;
      for (const ks of at.values()) {
        for (let i = 1; i < ks.length; i++) {
          flatWorst = Math.max(flatWorst, angle(flat(ks[0]), flat(ks[i])));
          roundWorst = Math.max(roundWorst, angle(N(ks[0]), N(ks[i])));
          pairs++;
        }
      }
      // Ком замкнут: у каждой вершины листвы есть соседняя грань в той же точке — щели по шву кольца нет.
      const lone = [...at.values()].filter((ks) => ks.length < 2).length;
      expect(lone, `${sp}: вершины без соседней грани (щель)`).toBe(0);
      // Граница области: общих вершин у соседних граней много, и сами грани кома изломаны — иначе мерить нечего.
      expect(pairs, sp).toBeGreaterThan(20);
      expect(flatWorst, `${sp}: излом граней, °`).toBeGreaterThan(40);
      // Плоской нормали в круглой не больше четверти (у полюсов — ноль): излом — не больше четверти прямого угла и шума.
      expect(roundWorst, `${sp}: излом нормалей при изломе граней ${flatWorst.toFixed(0)}°`).toBeLessThan(25);
    }
  });
});
