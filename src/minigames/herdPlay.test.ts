/**
 * Лепка стада по дальности (docs/polish.md, П-4, «Решения»; `herdPlay.NEAR_HI`): на телефоне подробно лепятся ближние
 * к человеку, остальные — простой лепкой. Область: ступень `lite` (настольная лепит подробно всех, пол — всех просто),
 * породы, где животных больше подробных мест (овцы и козы), человек — в загоне, где и ходит (`HerdPlay.roam`).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Dome } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import { HerdPlay, NEAR_HI, SWAP_M } from './herdPlay';
import { furnish } from './world';
import { model } from './beasts';

interface LifeView {
  slot: number;
  near: boolean;
  d: number;
  tint: number;
}
interface KindView {
  pack: { mesh: THREE.InstancedMesh };
  far: { mesh: THREE.InstancedMesh } | null;
  who: number[];
}
interface Inside {
  lives: LifeView[];
  packs: Map<string, KindView>;
}

const set = (tier: 'full' | 'lite' | 'base'): { play: HerdPlay; camera: THREE.PerspectiveCamera; inside: Inside } => {
  const play = new HerdPlay(7);
  play.dress(tier);
  const camera = new THREE.PerspectiveCamera(72, 390 / 844, 0.05, 90);
  furnish(new THREE.Scene(), new Surfaces(), play, camera, new Dome(), 'summer');
  return { play, camera, inside: play as unknown as Inside };
};

/** Тон копии в её меше. */
const tintAt = (mesh: THREE.InstancedMesh, slot: number): number => {
  const c = new THREE.Color();
  mesh.getColorAt(slot, c);
  return c.getHex();
};

describe('промыслы: лепка стада по дальности', () => {
  it('на телефоне подробны ближние, места копий не делятся, тон шерсти — за животным', () => {
    const { play, camera, inside } = set('lite');
    let seen = 0;
    // Человек обходит загон по кругу: ближние меняются, и правило проверяется на каждом шаге.
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const r = play.roam * (0.3 + 0.6 * ((k * 7) % 5) / 4);
      camera.position.set(Math.cos(a) * r, 1.6, Math.sin(a) * r);
      expect(Math.hypot(camera.position.x, camera.position.z), 'точка внутри загона').toBeLessThanOrEqual(play.roam);
      play.frame(k * 0.5, 0.5, 0);
      for (const kind of ['sheep', 'goat']) {
        const P = inside.packs.get(kind)!;
        expect(P.far, `${kind}: точка внутри области — простых мест есть`).not.toBeNull();
        const lives = P.who.map((i) => inside.lives[i]);
        const near = lives.filter((L) => L.near);
        const far = lives.filter((L) => !L.near);
        expect(near.length, kind).toBe(NEAR_HI);
        expect(new Set(near.map((L) => L.slot)).size, `${kind}: подробные места не делятся`).toBe(near.length);
        expect(new Set(far.map((L) => L.slot)).size, `${kind}: простые места не делятся`).toBe(far.length);
        for (const L of near) expect(L.slot).toBeLessThan(P.pack.mesh.count);
        for (const L of far) expect(L.slot).toBeLessThan(P.far!.mesh.count);
        // Подробная не дальше простой больше, чем на запас против мерцания.
        const nearMax = Math.max(...near.map((L) => L.d));
        const farMin = Math.min(...far.map((L) => L.d));
        expect(nearMax, `${kind}, шаг ${k}`).toBeLessThanOrEqual(farMin + SWAP_M + 1e-9);
        for (const L of near) expect(tintAt(P.pack.mesh, L.slot), `${kind}: тон подробной`).toBe(L.tint);
        for (const L of far) expect(tintAt(P.far!.mesh, L.slot), `${kind}: тон простой`).toBe(L.tint);
        seen++;
      }
    }
    expect(seen).toBe(96);
  });

  it('ближняя, но в запасе — лепку не меняет: человек качается у двух соседок, а лепка не мигает', () => {
    const { play, camera, inside } = set('lite');
    const P = inside.packs.get('sheep')!;
    const t = 3;
    const lives = (): LifeView[] => P.who.map((i) => inside.lives[i]);
    // Место, где простая овца и дальняя подробная почти на равном расстоянии: качнись — и простая то ближе, то дальше.
    let spot: { x: number; z: number } | null = null;
    for (let gx = -6; gx <= 6 && !spot; gx += 0.25) {
      for (let gz = -6; gz <= 6 && !spot; gz += 0.25) {
        if (Math.hypot(gx, gz) > play.roam) continue;
        camera.position.set(gx, 1.6, gz);
        play.frame(t, 0, 0);
        const L = lives();
        const nearMax = Math.max(...L.filter((x) => x.near).map((x) => x.d));
        const farMin = Math.min(...L.filter((x) => !x.near).map((x) => x.d));
        if (Math.abs(nearMax - farMin) < 0.05) spot = { x: gx, z: gz };
      }
    }
    expect(spot, 'точка внутри области: есть место, где соседки на равном расстоянии').not.toBeNull();
    // Две соседки — дальняя подробная и ближняя простая в этом месте; их дальности — геометрия, а не лепка.
    const L0 = lives();
    const x = L0.filter((v) => v.near).reduce((m, v) => (v.d > m.d ? v : m));
    const y = L0.filter((v) => !v.near).reduce((m, v) => (v.d < m.d ? v : m));
    let flips = 0;
    let crossed = 0;
    let order = Math.sign(x.d - y.d);
    let prev = lives().map((v) => v.near);
    for (let k = 0; k < 40; k++) {
      const dx = 0.3 * Math.sin(k * 0.9);
      camera.position.set(spot!.x + dx, 1.6, spot!.z);
      play.frame(t, 0, 0);
      const now = Math.sign(x.d - y.d);
      if (now !== 0 && now !== order) {
        crossed++;
        order = now;
      }
      const near = lives().map((v) => v.near);
      if (near.some((v, i) => v !== prev[i])) flips++;
      prev = near;
    }
    expect(crossed, 'точка внутри области: соседки менялись местами по дальности не раз').toBeGreaterThan(1);
    expect(flips, 'лепка меняется не чаще раза за качание').toBeLessThanOrEqual(1);
  });

  it('простая лепка — та же кость и те же морфы, что подробная: доли и место копии годятся обеим', () => {
    for (const kind of ['sheep', 'goat', 'cow', 'lamb'] as const) {
      const hi = model(kind, 'hi');
      const lo = model(kind, 'lo');
      expect(lo.count, kind).toBe(hi.count);
      expect(lo.slots, kind).toEqual(hi.slots);
      // Ось туловища и лёжка — числа подробной лепки ставят и простую (`HerdPlay.beast`): разница — не больше сантиметра.
      expect(lo.core.distanceTo(hi.core), kind).toBeLessThan(0.01);
      expect(Math.abs(lo.lie - hi.lie), kind).toBeLessThan(0.01);
    }
  });

  it('настольная ступень лепит подробно всех, пол — всех просто: простых мест нет', () => {
    for (const tier of ['full', 'base'] as const) {
      const { inside } = set(tier);
      for (const [kind, P] of inside.packs) {
        expect(P.far, `${tier}, ${kind}`).toBeNull();
        expect(P.pack.mesh.count, `${tier}, ${kind}`).toBe(P.who.length);
      }
    }
  });
});
