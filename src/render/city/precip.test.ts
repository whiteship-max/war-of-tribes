import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES } from '../quality';
import { CityPrecip, PRECIP_CAP, type PrecipFrame } from './precip';

const camera = new THREE.PerspectiveCamera(36, 390 / 844, 1, 2000);
camera.position.set(0, 400, 300);
camera.lookAt(0, 7, 0);

const frame = (t: number, rain: number, snow: number): PrecipFrame => ({
  t,
  rain,
  snow,
  windX: 1,
  windZ: 0,
  wind: 0.4,
  center: new THREE.Vector3(0, 7, 0),
  dist: 500,
  camera,
  bufferHeight: 1266,
  light: 1,
  flash: 0,
  night: 0,
  sky: new THREE.Color(0.5, 0.55, 0.6),
  fogNear: 400,
  fogFar: 1200,
});

/** Видимые вызовы осадков: что нарисует кадр. */
const drawn = (p: CityPrecip): string[] => p.group.children.filter((o) => o.visible).map((o) => o.name).sort();

describe('осадки — цена и тишина', () => {
  it('каждый уровень с дождём и снегом; брызги — со среднего; счёт — по потолку уровня', () => {
    for (const q of QUALITIES) {
      const p = new CityPrecip(q);
      const cap = PRECIP_CAP[q];
      expect(p.counts(), q).toEqual({ rain: cap.rain, near: cap.near, splash: q === 'low' ? 0 : cap.splash, snow: cap.snow, flakes: cap.flakes });
      expect(p.group.children.length, q).toBe(q === 'low' ? 4 : 5);
      p.dispose();
    }
    // «Низкий» — проще, но дождь есть (П-3): струи и хлопья, без брызг и поля высот.
    expect(PRECIP_CAP.low.rain).toBeGreaterThan(0);
    expect([PRECIP_CAP.low.splash, PRECIP_CAP.low.map]).toEqual([0, 0]);
    // Средний — телефону: не больше трёх тысяч струй, двух тысяч хлопьев и полутора тысяч брызг.
    expect(PRECIP_CAP.medium.rain + PRECIP_CAP.medium.near).toBeLessThanOrEqual(3000);
    expect(PRECIP_CAP.medium.snow + PRECIP_CAP.medium.flakes).toBeLessThanOrEqual(2000);
    expect(PRECIP_CAP.medium.splash).toBeLessThanOrEqual(1500);
  });

  it('сухо — ни одного вызова; дождь — только струи (и брызги, когда поле высот готово); снег — только хлопья', () => {
    const p = new CityPrecip('medium');
    p.update(frame(10, 0, 0));
    expect(drawn(p)).toEqual([]);
    // Поля высот ещё нет (поверхностей не дали) — брызгам не на что лечь.
    p.update(frame(11, 0.7, 0));
    expect(drawn(p)).toEqual(['city-rain', 'city-rain-near']);
    p.update(frame(12, 0, 0.7));
    expect(drawn(p)).toEqual(['city-snow-near', 'city-snowfall']);
    p.dispose();
  });

  it('брызги встают, когда поле высот готово, и только в дождь', () => {
    const p = new CityPrecip('medium');
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2));
    p.ground([ground]);
    p.update(frame(1, 0.7, 0));
    expect(p.grounded).toBe(true);
    expect(drawn(p)).toEqual(['city-rain', 'city-rain-near', 'city-splash']);
    p.update(frame(2, 0, 0.7));
    expect(drawn(p)).not.toContain('city-splash');
    p.dispose();
  });

  it('сторож опустил уровень — счёт сразу по новому уровню; вверх не поднимает', () => {
    const p = new CityPrecip('medium');
    p.setLevel('low');
    const low = PRECIP_CAP.low;
    expect(p.counts()).toEqual({ rain: low.rain, near: low.near, splash: 0, snow: low.snow, flakes: low.flakes });
    p.setLevel('high');
    expect(p.counts().rain).toBe(low.rain);
    p.dispose();
  });
});
