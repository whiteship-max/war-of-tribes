import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Figure, PARTS, forEachPart } from './figures';
import { dressHero, dressSoldier, humanRig } from './units';
import { ACTIONS, poseFigure } from './poses';

describe('сочленённые фигуры', () => {
  it('кираса остаётся позади плоскости щита в боевых позах', () => {
    for (const kind of ['shieldman', 'legionary'] as const) {
      const f = new Figure();
      dressSoldier(f, kind);
      f.phase = 0;
      for (const action of ['stand', 'guard', 'walk', 'strike'] as const) {
        for (const time of [0, 0.2, 0.55, 0.8, 1.1]) {
          poseFigure(f, action, time);
          let shield: THREE.Matrix4 | undefined;
          let chest: THREE.Matrix4 | undefined;
          forEachPart(f, (slot, matrix) => {
            if (!shield && slot.joint === 'handL') shield = matrix.clone();
            if (!chest && slot.part === 'plate' && slot.joint === 'torso') chest = matrix.clone();
          });
          const toShield = shield!.invert().multiply(chest!);
          for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
            const corner = new THREE.Vector3(x, y, z).applyMatrix4(toShield);
            expect(corner.z, `${kind} ${action} ${time}`).toBeLessThan(-0.5);
          }
        }
      }
    }
  });

  it('локоть и колено остаются внутри стыка деталей во всех позах', () => {
    for (const kind of ['swordsman', 'rider'] as const) {
      const f = new Figure();
      dressSoldier(f, kind);
      f.phase = 0;
      for (const action of ACTIONS) for (const time of [0, 0.2, 0.7, 1.1]) {
        poseFigure(f, action, time);
        const ends = new Map<string, { top: THREE.Vector3; bottom: THREE.Vector3 }>();
        forEachPart(f, (slot, matrix) => {
          if (slot.part !== 'limb') return;
          ends.set(slot.joint, {
            top: new THREE.Vector3().applyMatrix4(matrix),
            bottom: new THREE.Vector3(0, -1, 0).applyMatrix4(matrix),
          });
        });
        for (const [a, b] of [['armL', 'elbowL'], ['armR', 'elbowR'], ['legL', 'kneeL'], ['legR', 'kneeR']]) {
          expect(ends.get(a)!.bottom.distanceTo(ends.get(b)!.top), `${kind} ${action} ${a}`).toBeLessThan(0.015);
        }
      }
    }
  });

  it('оружие привязано к кисти, поножи — к голени', () => {
    const f = new Figure();
    dressSoldier(f, 'legionary');
    expect(f.slots.filter((s) => s.part === 'plate' && s.joint === 'handR')).toHaveLength(2);
    expect(f.slots.filter((s) => s.part === 'plate' && s.joint.startsWith('knee'))).toHaveLength(2);
  });

  it('подол плаща движется относительно плеч и снимается при переодевании', () => {
    const f = new Figure();
    dressHero(f, 'swordsman');
    f.phase = 0;
    const hem = (t: number): THREE.Vector3 => {
      poseFigure(f, 'walk', t);
      let point = new THREE.Vector3();
      forEachPart(f, (slot, matrix) => {
        if (slot.joint === 'capeHem') point = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);
      });
      return point;
    };
    expect(hem(0).distanceTo(hem(0.2))).toBeGreaterThan(0.01);
    dressSoldier(f, 'swordsman');
    expect(f.hasCape).toBe(false);
    expect(f.slots.some((s) => s.joint.startsWith('cape'))).toBe(false);
  });

  it('пять голов, прежние семь примитивов и цвет стороны', () => {
    expect(PARTS).toEqual(['limb', 'body', 'head', 'cap', 'shaft', 'plate', 'shield']);
    const f = new Figure();
    dressSoldier(f, 'swordsman', 0x336f9b);
    const head = f.slots.find((s) => s.part === 'head')!;
    expect(new THREE.Vector3().setFromMatrixScale(head.local).y * 5).toBeCloseTo(humanRig().height);
    const torso = f.slots.find((s) => s.joint === 'torso' && s.part === 'body')!;
    expect(torso.color.getHex()).toBe(0x336f9b);
  });
});
