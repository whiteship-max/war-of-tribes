// Модель лагеря бродяги (ПН-12л): вид по земле и погоде, две ступени, скрытый без огня, бюджет треугольников по уровням качества.
// Сборка чистая — без экрана: модель собирается в узле и считается.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES } from '@/render/quality';
import { CLEAR } from '@/world/weather';
import type { CampGround, CampLook } from '@/world/campsite';
import { CAMP_TRIS, TREES, buildCamp, disposeCamp, trisOf } from './build';

const GROUNDS: readonly CampGround[] = ['forest', 'field', 'hills', 'shore', 'ruin', 'desert'];

const look = (over: Partial<CampLook>): CampLook => ({
  ground: 'field',
  tier: 'small',
  kind: 'open',
  fire: true,
  snow: 0,
  sky: CLEAR,
  heat: 0,
  season: 'summer',
  ...over,
});

const names = (root: THREE.Object3D): string[] => {
  const out: string[] = [];
  root.traverse((o) => o.name && out.push(o.name));
  return out;
};

describe('лагерь бродяги: модель', () => {
  it('каждый вид на каждом уровне — в бюджете треугольников уровня', () => {
    for (const q of QUALITIES) {
      for (const ground of GROUNDS) {
        for (const tier of ['small', 'large'] as const) {
          for (const snow of [0, 1]) {
            const m = buildCamp(look({ ground, tier, snow, kind: ground === 'ruin' ? 'ruin' : 'open' }), q);
            expect(m.tris, `${q} ${ground} ${tier} снег ${snow}`).toBeLessThanOrEqual(CAMP_TRIS[q]);
            expect(m.tris, 'сцена не пустая').toBeGreaterThan(200);
            disposeCamp(m);
          }
        }
      }
    }
    // Уровни правда разные: на низком лес реже и дешевле.
    expect(TREES.low).toBeLessThan(TREES.high);
    const hi = buildCamp(look({ ground: 'forest' }), 'high');
    const lo = buildCamp(look({ ground: 'forest' }), 'low');
    expect(lo.tris).toBeLessThan(hi.tris);
  });

  it('ступени: малый — костёр и две палатки без знамени; большой — шатёр героя, обоз, коновязь, знамя с гербом', () => {
    const small = buildCamp(look({ tier: 'small' }), 'medium');
    const large = buildCamp(look({ tier: 'large' }), 'medium');
    expect(small.flag, 'у малого знамени нет').toBeNull();
    expect(large.flag, 'у большого — знамя').not.toBeNull();
    expect(large.anchors.banner).not.toBeNull();
    // Шатёр героя выше палатки малого, обоз — телега выше мешков.
    expect(large.anchors.tent.y).toBeGreaterThan(small.anchors.tent.y + 1);
    expect(large.anchors.cargo.y).toBeGreaterThan(small.anchors.cargo.y + 0.5);
    expect(large.tris).toBeGreaterThan(small.tris);
  });

  it('скрытый лагерь — без огня и дыма; открытый — с огнём; залитый дождём — без огня', () => {
    const open = buildCamp(look({ kind: 'open', fire: true }), 'low');
    expect(open.flame).not.toBeNull();
    expect(open.smokeFrom).not.toBeNull();
    expect(names(open.root)).toContain('flame');
    const hidden = buildCamp(look({ kind: 'hidden', fire: false }), 'low');
    expect(hidden.flame).toBeNull();
    expect(hidden.smokeFrom).toBeNull();
    expect(names(hidden.root)).not.toContain('flame');
    // Огонь решает вид (`campsite.fireLit`): открытый лагерь, залитый дождём, приходит с `fire: false` — и огня нет.
    const wet = buildCamp(look({ kind: 'open', fire: false }), 'low');
    expect(wet.flame).toBeNull();
  });

  it('земля по клетке: берег — с водой, руины — со стенами, лес — гуще деревьями, пустыня — без деревьев', () => {
    expect(names(buildCamp(look({ ground: 'shore' }), 'low').root)).toContain('water');
    expect(names(buildCamp(look({ ground: 'field' }), 'low').root)).not.toContain('water');
    const ruin = buildCamp(look({ ground: 'ruin', kind: 'ruin', fire: false }), 'low');
    const field = buildCamp(look({ ground: 'field', kind: 'ruin', fire: false }), 'low');
    expect(ruin.tris, 'стены руин добавляют треугольники').toBeGreaterThan(field.tris + 100);
    const forest = buildCamp(look({ ground: 'forest' }), 'high');
    const desert = buildCamp(look({ ground: 'desert' }), 'high');
    expect(forest.tris).toBeGreaterThan(desert.tris + 500);
  });

  it('снег ложится на землю: цвет земли светлеет', () => {
    const avg = (m: { root: THREE.Object3D }): number => {
      const g = m.root.getObjectByName('ground') as THREE.Mesh;
      const c = g.geometry.getAttribute('color').array as Float32Array;
      let s = 0;
      for (const v of c) s += v;
      return s / c.length;
    };
    expect(avg(buildCamp(look({ snow: 1, season: 'winter' }), 'low'))).toBeGreaterThan(avg(buildCamp(look({ snow: 0, season: 'winter' }), 'low')) + 0.2);
  });

  it('счёт треугольников — по геометрии', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    expect(trisOf(g)).toBe(12);
  });
});
