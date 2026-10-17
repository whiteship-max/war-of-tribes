// Формы снаряжения (docs/polish.md, П-5): грани смотрят наружу — толпа рисует только лицевые (задние отбрасываются), и
// шлем с гранями внутрь показал бы вместо купола внутренность затылка (так и было в первом заходе П-5).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { shapeGeometry, type Detail, type Shape } from './gear';

const DETAILS: Detail[] = [0, 1, 2];

/** Грани формы: середина и нормаль по обходу вершин; подматериал первой вершины. */
function faces(shape: Shape, d: Detail): { at: THREE.Vector3; n: THREE.Vector3; sub: number }[] {
  const g = shapeGeometry(shape, d);
  const p = g.getAttribute('position');
  const sub = g.getAttribute('sub');
  const idx = g.getIndex()!;
  const out: { at: THREE.Vector3; n: THREE.Vector3; sub: number }[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    out.push({ at: a.clone().add(b).add(c).divideScalar(3), n: n.normalize(), sub: sub.getX(idx.getX(i)) });
  }
  g.dispose();
  return out;
}

describe('формы снаряжения', () => {
  it('тела вращения (шлемы, капюшон, подол, дубина): боковые грани смотрят от оси', () => {
    for (const shape of ['nasal', 'spangen', 'kettle', 'great', 'felt', 'hair', 'hood', 'skirt', 'club'] as Shape[]) {
      for (const d of DETAILS) {
        const side = faces(shape, d).filter((f) => Math.hypot(f.n.x, f.n.z) > 0.5 && Math.hypot(f.at.x, f.at.z) > 0.2);
        const out = side.filter((f) => f.n.x * f.at.x + f.n.z * f.at.z > 0).length;
        // Граница: у формы есть боковые грани; наружу — почти все (наносник и поля шапели — коробки, не тело вращения).
        expect(side.length, `${shape}@${d}`).toBeGreaterThan(3);
        expect(out / side.length, `${shape}@${d}`).toBeGreaterThan(0.9);
      }
    }
  });

  it('щит: поле герба смотрит вперёд, изнанка — назад', () => {
    for (const shape of ['kite', 'heater', 'round'] as Shape[]) {
      for (const d of [1, 2] as Detail[]) {
        const all = faces(shape, d);
        const coat = all.filter((f) => f.sub === 1);
        // Граница: поле есть (вблизи и на среднем облике).
        expect(coat.length, `${shape}@${d}`).toBeGreaterThan(3);
        for (const f of coat) expect(f.n.z, `${shape}@${d}: поле`).toBeGreaterThan(0);
        const back = all.filter((f) => f.sub === 0 && Math.abs(f.n.z) > 0.6 && f.at.z < 0.2 && Math.hypot(f.at.x, f.at.y) < 0.4);
        expect(back.length, `${shape}@${d}: изнанка`).toBeGreaterThan(0);
        for (const f of back) expect(f.n.z, `${shape}@${d}: изнанка`).toBeLessThan(0);
      }
    }
  });

  it('попона: бока смотрят от коня, поле герба — на боках', () => {
    for (const d of DETAILS) {
      const all = faces('caparison', d);
      const sides = all.filter((f) => Math.abs(f.n.x) > 0.5);
      expect(sides.length, `caparison@${d}`).toBeGreaterThan(3);
      for (const f of sides) expect(Math.sign(f.n.x), `caparison@${d}`).toBe(Math.sign(f.at.x));
      if (d > 0) expect(all.some((f) => f.sub === 1)).toBe(true);
    }
  });

  it('лук: плечи — коробки с гранями наружу от своей оси', () => {
    for (const d of DETAILS) {
      const wood = faces('bow', d).filter((f) => f.sub === 0);
      expect(wood.length).toBeGreaterThan(8);
      // Грань плеча смотрит от середины своего отрезка по z (лицо и изнанка) или по x (бока).
      const zFaces = wood.filter((f) => Math.abs(f.n.z) > 0.9);
      for (const f of zFaces) expect(Math.sign(f.n.z), `bow@${d}`).toBe(Math.sign(f.at.z));
    }
  });
});
