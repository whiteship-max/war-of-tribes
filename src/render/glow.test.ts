// Окна ночью (docs/graphics_world.md, 9.5): признак окна едет в вершинах, вызовов не
// прибавляет, днём окно — прежняя тёмная краска, у нынешнего вида признака нет вовсе.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { createBuildingGroup, type Tier } from './buildings';
import { LIT_BODY, dropGlow, lightWindows } from './glow';
import { pane, paintOf, windowLight } from './kit';
import { windowNight } from './lighting';
import { KIT } from './materials';

const TIERS: Tier[] = [0, 1, 2];

/** Меши здания с их материалами. */
function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

const mats = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

describe('окна: признак в вершинах', () => {
  it('у жилищ на каждой ступени окна светятся, и не все вершины дома — окна', () => {
    for (const t of TIERS) {
      const g = createBuildingGroup('houses', t);
      const lit = meshes(g).filter((m) => m.geometry.getAttribute('glow'));
      expect(lit.length, `ступень ${t}: меш с окнами`).toBeGreaterThan(0);
      for (const m of lit) {
        const glow = m.geometry.getAttribute('glow');
        expect(glow.count).toBe(m.geometry.getAttribute('position').count);
        let on = 0;
        for (let i = 0; i < glow.count; i++) {
          const v = glow.getX(i);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          if (v > 0) on++;
        }
        expect(on, `ступень ${t}: горящих вершин`).toBeGreaterThan(0);
        expect(on, `ступень ${t}: окна — не весь дом`).toBeLessThan(glow.count / 4);
      }
    }
  });

  it('днём окно — прежняя краска: у стекла та же краска и тот же материал, что у двери', () => {
    expect(pane().tint).toBe(paintOf('dark').tint);
    expect(pane().mat).toBe(paintOf('dark').mat);
    expect(paintOf('dark').glow).toBeFalsy();
  });

  it('свет у окон разный, и каждое седьмое примерно — тёмное', () => {
    const v = Array.from({ length: 700 }, (_, i) => windowLight(i));
    const dark = v.filter((x) => x === 0).length / v.length;
    expect(dark).toBeGreaterThan(0.08);
    expect(dark).toBeLessThan(0.22);
    for (const x of v) if (x > 0) expect(x).toBeGreaterThanOrEqual(0.6);
    expect(new Set(v.map((x) => x.toFixed(2))).size).toBeGreaterThan(20);
  });

  it('светящееся тело встаёт на место тела — групп и вызовов столько же', () => {
    for (const b of BUILDINGS) {
      for (const t of TIERS) {
        const g = createBuildingGroup(b.id, t);
        const before = meshes(g).map((m) => mats(m).length);
        const hadBody = meshes(g).some((m) => m.geometry.getAttribute('glow') && mats(m).includes(KIT.body));
        lightWindows(g);
        expect(meshes(g).map((m) => mats(m).length), `${b.id}/${t}`).toEqual(before);
        for (const m of meshes(g)) {
          if (!m.geometry.getAttribute('glow')) expect(mats(m)).not.toContain(LIT_BODY);
          else expect(mats(m)).not.toContain(KIT.body);
        }
        if (hadBody) expect(meshes(g).some((m) => mats(m).includes(LIT_BODY))).toBe(true);
      }
    }
  });

  it('у нынешнего вида признака нет: атрибуты те же, что у здания без окон', () => {
    const g = createBuildingGroup('houses', 2);
    dropGlow(g);
    for (const m of meshes(g)) expect(Object.keys(m.geometry.attributes).sort()).toEqual(['color', 'normal', 'position']);
  });
});

describe('окна: когда горят', () => {
  const at = (daylight: number, nightK: number): number => windowNight({ daylight, nightK, dusk: 0 });

  it('днём не горят, ночью — в полную силу, в сумерках — уже горят', () => {
    expect(at(1, 0)).toBe(0);
    expect(at(0, 1)).toBe(1);
    expect(at(0.5, 0)).toBeGreaterThan(0.5);
    let prev = -1;
    for (let d = 1; d >= 0; d -= 0.05) {
      const v = at(d, 0);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
