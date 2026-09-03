// План поселения — это обещание: место под здание зарезервировано по его самой
// крупной ступени, поэтому к концу партии ничего никуда не вылезет. Обещание
// проверяется здесь, а не глазами в сцене.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';
import { BUILDINGS } from '@/game/data/buildings';
import { createBuildingGroup, levelScale } from './buildings';
import {
  GATE_ANGLE,
  GATE_ROAD,
  MODEL_RADIUS,
  OUTER_ROAD,
  PLAN,
  PLAN_SCALE,
  PLAZA_RADIUS,
  PLAZA_ROAD,
  WALL_RADIUS,
  ROAD_HALF,
  RING_RADIUS,
  ROAD_THROUGH,
  SPARE_PLOTS,
  THROUGH_HALF,
  TOWER_PLACE,
  placeOf,
  plotRadius,
  spotAt,
  spurFor,
} from './plan';

/** Здания, у которых есть место на плане: стена — это кольцо, а не постройка. */
const PLACED: BuildingTypeId[] = BUILDINGS.map((b) => b.id).filter((id) => id !== 'palisade');

/** Настоящий радиус модели в плоскости XZ — по вершинам, а не по грубому боксу. */
function modelRadius(type: BuildingTypeId): number {
  const g = createBuildingGroup(type, 2, 2, 'state');
  g.updateMatrixWorld(true);
  let max = 0;
  const v = new THREE.Vector3();
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      max = Math.max(max, Math.hypot(v.x, v.z));
    }
  });
  return max;
}

/** Расстояние от точки до отрезка — им меряется зазор между дорогой и площадкой. */
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

describe('план поселения', () => {
  it('таблица габаритов совпадает с настоящими моделями', () => {
    for (const type of PLACED) {
      const real = modelRadius(type);
      // Запас в 6%: модель можно чуть подправить, не трогая план.
      expect(real, `${type}: модель выросла, поправь MODEL_RADIUS`).toBeLessThanOrEqual(
        MODEL_RADIUS[type] * 1.06,
      );
    }
  });

  it('площадка вмещает здание десятого уровня', () => {
    for (const type of PLACED) {
      const real = modelRadius(type) * PLAN_SCALE * levelScale(10);
      expect(real, `${type} не влезает в свою площадку`).toBeLessThanOrEqual(plotRadius(type));
    }
  });

  it('площадки не пересекаются', () => {
    const spots = PLACED.map((type) => ({ type, spot: placeOf(type), r: plotRadius(type) }));
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i];
        const b = spots[j];
        const d = Math.hypot(a.spot.x - b.spot.x, a.spot.z - b.spot.z);
        expect(d, `${a.type} и ${b.type} налезают друг на друга`).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
  });

  it('всё помещается внутри стены', () => {
    for (const type of PLACED) {
      const spot = placeOf(type);
      const outer = Math.hypot(spot.x, spot.z) + plotRadius(type);
      expect(outer, `${type} вылезает за стену`).toBeLessThanOrEqual(WALL_RADIUS);
    }
  });

  it('площадь в центре остаётся свободной', () => {
    for (const type of PLACED) {
      if (type === 'campfire') continue;
      const spot = placeOf(type);
      const inner = Math.hypot(spot.x, spot.z) - plotRadius(type);
      expect(inner, `${type} залезает на площадь`).toBeGreaterThanOrEqual(PLAZA_RADIUS - 1e-6);
    }
    // Костёр стоит в центре и площади не занимает целиком.
    expect(plotRadius('campfire')).toBeLessThan(PLAZA_RADIUS);
  });

  it('дорога от ворот к площади не идёт сквозь постройки', () => {
    const ax = Math.cos(GATE_ROAD.angle) * GATE_ROAD.from;
    const az = Math.sin(GATE_ROAD.angle) * GATE_ROAD.from;
    const bx = Math.cos(GATE_ROAD.angle) * GATE_ROAD.to;
    const bz = Math.sin(GATE_ROAD.angle) * GATE_ROAD.to;
    for (const type of PLACED) {
      // Рынок стоит на самой улице нарочно: она идёт между его рядами.
      // Что проезд при этом остаётся свободным, проверяет отдельный тест ниже.
      if (type === 'campfire' || ROAD_THROUGH.includes(type)) continue;
      const spot = placeOf(type);
      const d = distToSegment(spot.x, spot.z, ax, az, bx, bz);
      expect(d, `главная улица режет ${type}`).toBeGreaterThanOrEqual(plotRadius(type) + ROAD_HALF);
    }
  });

  it('здание на улице оставляет проезд свободным', () => {
    // Здание развёрнуто фасадом к центру, а улица идёт по радиусу — значит
    // в местных координатах модели дорога лежит вдоль оси z, ровно через x = 0.
    // Ни одна вершина не имеет права оказаться в этом коридоре.
    for (const type of ROAD_THROUGH) {
      expect(PLAN[type], `${type} стоит на улице, но не в плане`).toBeTruthy();
      for (const tier of [0, 1, 2] as const) {
        const g = createBuildingGroup(type, 2, tier, 'state');
        g.updateMatrixWorld(true);
        let min = Infinity;
        const v = new THREE.Vector3();
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const pos = mesh.geometry.attributes.position;
          if (!pos) return;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            min = Math.min(min, Math.abs(v.x));
          }
        });
        // Масштаб самый крупный из возможных: ступень 1 на седьмом уровне.
        const scale = PLAN_SCALE * Math.max(levelScale(7), levelScale(10));
        expect(min * scale, `${type}: ступень ${tier} загораживает проезд`).toBeGreaterThanOrEqual(
          THROUGH_HALF,
        );
      }
    }
  });

  it('улице от ворот есть куда вести: проезд шире самой дороги', () => {
    // Мостовая города — самая широкая: ROAD_HALF × 1.9.
    expect(THROUGH_HALF).toBeGreaterThan(ROAD_HALF * 1.9);
  });

  it('отводы к зданиям не режут соседей', () => {
    for (const type of PLACED) {
      const spur = spurFor(type);
      if (!spur) continue;
      const ax = Math.cos(spur.angle) * spur.from;
      const az = Math.sin(spur.angle) * spur.from;
      const bx = Math.cos(spur.angle) * spur.to;
      const bz = Math.sin(spur.angle) * spur.to;
      for (const other of PLACED) {
        if (other === type || other === 'campfire') continue;
        const spot = placeOf(other);
        const d = distToSegment(spot.x, spot.z, ax, az, bx, bz);
        expect(d, `отвод к ${type} режет ${other}`).toBeGreaterThanOrEqual(
          plotRadius(other) + ROAD_HALF,
        );
      }
    }
  });

  it('кольцевые дороги проходят по пустому месту', () => {
    for (const type of PLACED) {
      if (type === 'campfire') continue;
      const d = Math.hypot(placeOf(type).x, placeOf(type).z);
      const plot = plotRadius(type);
      for (const road of [PLAZA_ROAD, OUTER_ROAD]) {
        // Дорога либо снаружи площадки, либо внутри неё — но не поперёк.
        const clear = d - plot >= road + ROAD_HALF - 1e-6 || d + plot <= road - ROAD_HALF + 1e-6;
        expect(clear, `${type} стоит на кольцевой дороге ${road}`).toBe(true);
      }
    }
  });

  it('свободные места тоже никому не мешают', () => {
    const taken = PLACED.map((type) => ({ type, spot: placeOf(type), r: plotRadius(type) }));
    for (const spare of SPARE_PLOTS) {
      const spot = spotAt(RING_RADIUS[spare.ring], spare.angle);
      for (const t of taken) {
        const d = Math.hypot(spot.x - t.spot.x, spot.z - t.spot.z);
        // Площадка под декор мельче дома: ей хватает полутора метров.
        expect(d, `свободное место налезает на ${t.type}`).toBeGreaterThanOrEqual(t.r + 1.4);
      }
    }
  });

  it('ворота смотрят в камеру и стоят на своём месте', () => {
    // Стартовый азимут камеры — Math.atan2(9, 12); ворота должны быть с той же стороны.
    const camera = Math.atan2(9, 12);
    expect(Math.sin(GATE_ANGLE)).toBeCloseTo(Math.cos(camera), 5);
    expect(Math.cos(GATE_ANGLE)).toBeCloseTo(Math.sin(camera), 5);
    // Башня стоит сбоку от ворот, а не поперёк них.
    const spot = spotAt(TOWER_PLACE.r, TOWER_PLACE.angle);
    const d = distToSegment(
      spot.x,
      spot.z,
      Math.cos(GATE_ANGLE) * GATE_ROAD.from,
      Math.sin(GATE_ANGLE) * GATE_ROAD.from,
      Math.cos(GATE_ANGLE) * GATE_ROAD.to,
      Math.sin(GATE_ANGLE) * GATE_ROAD.to,
    );
    expect(d).toBeGreaterThanOrEqual(plotRadius('tower') + ROAD_HALF);
  });

  it('каждое здание развёрнуто фасадом к центру', () => {
    for (const type of PLACED) {
      const spot = placeOf(type);
      if (spot.r === 0) continue;
      // Перёд модели — её +z; после поворота он должен смотреть в центр.
      const fx = Math.sin(spot.rot);
      const fz = Math.cos(spot.rot);
      expect(fx * spot.x + fz * spot.z).toBeLessThan(0);
    }
  });

  it('у каждого здания, кроме стены, есть место в плане', () => {
    for (const def of BUILDINGS) {
      if (def.id === 'palisade' || def.id === 'campfire' || def.id === 'tower') continue;
      expect(PLAN[def.id], `${def.id} забыт в плане`).toBeTruthy();
    }
  });
});
