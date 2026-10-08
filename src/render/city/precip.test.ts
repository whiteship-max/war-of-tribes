import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES } from '../quality';
import { CityPrecip, PRECIP_CAP } from './precip';

const at = new THREE.Vector3(0, 7, 0);

describe('осадки — цена и тишина', () => {
  it('на «Низком» частиц нет; выше — дождь и снег по одному вызову, не больше потолка уровня', () => {
    expect(PRECIP_CAP.low).toEqual({ rain: 0, snow: 0 });
    for (const q of QUALITIES) {
      const p = new CityPrecip(q);
      const meshes = p.group.children as (THREE.LineSegments | THREE.Points)[];
      expect(meshes.length, q).toBe(q === 'low' ? 0 : 2);
      for (const m of meshes) {
        const n = m.geometry.attributes.position.count;
        if (m instanceof THREE.LineSegments) expect(n, `${q} дождь`).toBe(PRECIP_CAP[q].rain * 2);
        else expect(n, `${q} снег`).toBe(PRECIP_CAP[q].snow);
      }
      p.dispose();
    }
    // Средний — не больше трёх тысяч струй и двух тысяч хлопьев: телефону.
    expect(PRECIP_CAP.medium.rain).toBeLessThanOrEqual(3000);
    expect(PRECIP_CAP.medium.snow).toBeLessThanOrEqual(2000);
  });

  it('сухо — ни одного вызова; дождь — только дождь, снег — только снег', () => {
    const p = new CityPrecip('medium');
    const rain = p.group.getObjectByName('city-rain')!;
    const snow = p.group.getObjectByName('city-snowfall')!;
    p.update(10, 0, 0, 1, 0, 0.4, at, 300, 1);
    expect([rain.visible, snow.visible]).toEqual([false, false]);
    p.update(11, 0.7, 0, 1, 0, 0.4, at, 300, 1);
    expect([rain.visible, snow.visible]).toEqual([true, false]);
    p.update(12, 0, 0.7, 1, 0, 0.4, at, 300, 1);
    expect([rain.visible, snow.visible]).toEqual([false, true]);
    p.dispose();
  });
});
