// Живность окружения (docs/graphics_world.md, 9.8): птицы днём над лесом, светлячки ночью
// у опушки; место — чистая функция времени, ничего не копится.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CLEAR_RADIUS, WALL_RADIUS } from '../plan';
import { makeLife } from './life';

/** Места показанных птиц. */
function birdSpots(life: ReturnType<typeof makeLife>): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: life.birds.count }, (_, i) => {
    life.birds.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

describe('живность', () => {
  it('днём — птицы над лесом, а не над посёлком; светлячков нет', () => {
    const life = makeLife();
    life.update(37, 1, 0, 1, 0);
    expect(life.birds.visible).toBe(true);
    expect(life.birds.count).toBeGreaterThanOrEqual(10);
    expect(life.fireflies.visible).toBe(false);
    for (const p of birdSpots(life)) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(Math.hypot(p.x, p.z), 'птица над лесом').toBeGreaterThan(CLEAR_RADIUS - 5);
      expect(p.y).toBeGreaterThan(5);
    }
    life.dispose();
  });

  it('ночью — светлячки у опушки и на лугу за стеной, птиц нет; зимой светлячков нет', () => {
    const life = makeLife();
    life.update(512, 0, 1, 1, 0);
    expect(life.birds.visible).toBe(false);
    expect(life.fireflies.visible).toBe(true);
    const pos = life.fireflies.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(40);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      expect(r, 'не в посёлке').toBeGreaterThan(WALL_RADIUS);
    }
    life.update(512, 0, 1, 1, 1);
    expect(life.fireflies.visible).toBe(false);
    life.dispose();
  });

  it('место — функция времени: два мира в одно время одинаковы, и прошлое не копится', () => {
    const a = makeLife();
    const b = makeLife();
    for (const t of [3, 50, 700]) a.update(t, 1, 0, 1, 0);
    b.update(700, 1, 0, 1, 0);
    expect(birdSpots(a).map((p) => p.toArray())).toEqual(birdSpots(b).map((p) => p.toArray()));
    a.dispose();
    b.dispose();
  });
});
