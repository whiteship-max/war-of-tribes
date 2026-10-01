// Фактура построек вида `next` (docs/graphics_world.md, 11.2): признаки в вершинах — только у модели
// вида `next`, одним атрибутом по байту на признак; форма та же байт в байт, групп и вызовов столько
// же, кровли переливает сезон, окна светятся телом фактуры. Прежний вид — без признаков вовсе.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { createBuildingGroup, type Tier } from '../buildings';
import * as K from '../kit';
import { KIT } from '../materials';
import { FACADE_BODY, FACADE_ROOFS, dressFacade } from './facade';

const TIERS: Tier[] = [0, 1, 2];

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

const mats = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

/** Признаки фактуры: место на грани (u, v), номер поверхности, свет окна. */
const tags = (m: THREE.Mesh): THREE.BufferAttribute | undefined => m.geometry.getAttribute('fac') as THREE.BufferAttribute | undefined;
const code = (a: THREE.BufferAttribute, i: number): number => Math.round(a.getZ(i) * 255);

describe('фактура построек: признаки в вершинах', () => {
  it('признаки — только у модели вида next, по четыре байта на вершину; форма та же байт в байт', () => {
    for (const b of BUILDINGS) {
      for (const t of TIERS) {
        const now = meshes(createBuildingGroup(b.id, t));
        const next = meshes(createBuildingGroup(b.id, t, true));
        expect(next.length, `${b.id}/${t}: мешей`).toBe(now.length);
        for (const m of now) expect(tags(m), `${b.id}/${t}: у прежнего вида признаков нет`).toBeUndefined();
        now.forEach((m, i) => {
          const a = m.geometry.getAttribute('position').array;
          const c = next[i].geometry.getAttribute('position').array;
          expect(Array.from(c), `${b.id}/${t}: форма`).toEqual(Array.from(a));
          expect(next[i].geometry.groups, `${b.id}/${t}: группы`).toEqual(m.geometry.groups);
        });
        // Склеенные модели несут признаки на каждой вершине; отдельные меши (пламя, горн) — без них.
        const tagged = next.filter((m) => tags(m));
        expect(tagged.length, `${b.id}/${t}: склеенный меш с признаками`).toBeGreaterThan(0);
        for (const m of tagged) {
          const a = tags(m)!;
          expect(a.itemSize).toBe(4);
          expect(a.array).toBeInstanceOf(Uint8Array);
          expect(a.normalized).toBe(true);
          expect(a.count).toBe(m.geometry.getAttribute('position').count);
          // Окна у фактуры — в признаках: отдельного атрибута света нет.
          expect(m.geometry.getAttribute('glow'), `${b.id}/${t}: свой атрибут окон`).toBeUndefined();
          for (let i = 0; i < a.count; i++) expect([0, 1, 2, 3]).toContain(code(a, i));
        }
      }
    }
  });

  it('у жилищ — штукатурка, дерево и камень; окна горят в признаках, и не весь дом — окна', () => {
    const codes = new Set<number>();
    let lit = 0;
    let all = 0;
    for (const m of meshes(createBuildingGroup('houses', 2, true))) {
      const a = tags(m);
      if (!a) continue;
      for (let i = 0; i < a.count; i++) {
        codes.add(code(a, i));
        all++;
        if (a.getW(i) > 0) lit++;
      }
    }
    expect([...codes].sort()).toEqual([0, 1, 2, 3]);
    expect(lit, 'горящих вершин').toBeGreaterThan(0);
    expect(lit, 'окна — не весь дом').toBeLessThan(all / 4);
    expect(K.SURFACE.plaster).toBe(1);
    expect(K.SURFACE.dark).toBeUndefined();
  });

  it('широкая грань затеняет углы, узкая — нет: столб, брус и грань круглой стены края не имеют', () => {
    const wall = K.withFacade(() => K.assemble([K.wallBox(2.4, 1.6, 1.4, K.paintOf('plaster'))]));
    const post = K.withFacade(() => K.assemble([K.post(0.1, 1.4, K.paintOf('timber'))]));
    // Граница области: у стены ширина есть — по краям 0 и 1; без неё правило «узкой» не спрашивается.
    const wa = tags(wall)!;
    const wu = Array.from({ length: wa.count }, (_, i) => wa.getX(i));
    expect(Math.min(...wu)).toBeCloseTo(0, 6);
    expect(Math.max(...wu)).toBeCloseTo(1, 6);
    const pa = tags(post)!;
    for (let i = 0; i < pa.count; i++) expect(Math.abs(pa.getX(i) - 0.5), 'узкая грань — без края').toBeLessThan(0.01);
    // Высота грани стены — снизу вверх: у земли 0, под свесом 1 (точность — байт).
    const pos = wall.geometry.getAttribute('position');
    const nrm = wall.geometry.getAttribute('normal');
    for (let i = 0; i < wa.count; i++) {
      if (Math.abs(nrm.getY(i)) > 0.5) continue;
      expect(Math.abs(wa.getY(i) - pos.getY(i) / 1.6), 'высота грани от низа').toBeLessThan(0.005);
    }
  });
});

describe('фактура построек: подмена материалов', () => {
  it('тело и кровли — копии с узором; групп и вызовов столько же, тело прежнее не остаётся', () => {
    let roofs = 0;
    for (const b of BUILDINGS) {
      for (const t of TIERS) {
        const g = createBuildingGroup(b.id, t, true);
        const before = meshes(g).map((m) => mats(m).length);
        const hadBody = meshes(g).some((m) => tags(m) && mats(m).includes(KIT.body));
        dressFacade(g);
        expect(meshes(g).map((m) => mats(m).length), `${b.id}/${t}`).toEqual(before);
        for (const m of meshes(g)) {
          if (!tags(m)) continue;
          expect(mats(m), `${b.id}/${t}: прежнее тело`).not.toContain(KIT.body);
          for (const k of Object.keys(FACADE_ROOFS) as (keyof typeof FACADE_ROOFS)[]) expect(mats(m)).not.toContain(KIT[k]);
          roofs += mats(m).filter((x) => Object.values(FACADE_ROOFS).includes(x as never)).length;
        }
        if (hadBody) expect(meshes(g).some((m) => mats(m).includes(FACADE_BODY)), `${b.id}/${t}: тело фактуры`).toBe(true);
      }
    }
    expect(roofs, 'кровель с узором').toBeGreaterThan(10);
  });

  it('сезон переливает и копии кровель: цвет у копии — тот же объект, что у оригинала', () => {
    for (const k of Object.keys(FACADE_ROOFS) as (keyof typeof FACADE_ROOFS)[]) {
      expect(FACADE_ROOFS[k].color, k).toBe(KIT[k].color);
      expect((FACADE_ROOFS[k] as THREE.MeshLambertMaterial).vertexColors, k).toBe(true);
    }
    expect(FACADE_BODY.vertexColors).toBe(true);
  });
});
