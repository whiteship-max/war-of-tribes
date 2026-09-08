// Попасть по зданию пальцем. Проверяется не отвлечённая арифметика, а настоящий
// посёлок: те же модели, тот же план, та же камера, что в игре, — и экран 390 px,
// на котором жалоба и родилась.
//
// Числа отсюда стоят в отчёте: силуэт здания на 390 px — 18–39 px, то есть меньше
// отпечатка пальца. Область попадания обязана быть больше самой постройки.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';
import { BUILDINGS } from '@/game/data/buildings';
import { TAP_FORGIVE, TAP_TARGET } from '@/gestures';
import { createBuildingGroup, levelScale, visualTier } from './buildings';
import { PLAN_SCALE, placeOf } from './plan';
import { AZIMUTH, framing } from './camera';
import { hitBox, pickBox, projectHitBox, silhouetteBox, tapScore, type HitBox } from './pick';

const W = 390;
const H = 844;
const RECT = { left: 0, top: 0, width: W, height: H };

/** Здания посёлка, кроме стены: у кольца вокруг всего посёлка коробки не бывает. */
const TYPES = BUILDINGS.map((b) => b.id).filter((t) => t !== 'palisade');

/** Камера деревни на телефоне — ровно так её ставит `Scene.applyFraming`. */
function phoneCamera(): THREE.PerspectiveCamera {
  const f = framing(W / H);
  const cam = new THREE.PerspectiveCamera(f.fov, W / H, 0.1, f.fogFar + 10);
  const target = new THREE.Vector3(0, f.targetY, 0);
  cam.position.setFromSpherical(new THREE.Spherical(f.dist, f.polar, AZIMUTH)).add(target);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Посёлок первого уровня: тот, что видит новичок, и на котором таны мимо. */
function village(level = 1): { boxes: HitBox[]; raw: Map<BuildingTypeId, HitBox>; byId: BuildingTypeId[] } {
  const cam = phoneCamera();
  const boxes: HitBox[] = [];
  const raw = new Map<BuildingTypeId, HitBox>();
  const byId: BuildingTypeId[] = [];
  TYPES.forEach((type, id) => {
    const tier = visualTier(level);
    const group = createBuildingGroup(type, tier);
    // Силуэт — до расстановки, как в сцене: коробка нужна в своих координатах.
    const box = silhouetteBox(group);
    const spot = placeOf(type);
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.rot;
    group.scale.setScalar(levelScale(level) * PLAN_SCALE);
    group.updateWorldMatrix(true, false);
    const b = projectHitBox(id, box, group.matrixWorld, cam, RECT);
    byId[id] = type;
    if (!b) return;
    boxes.push(b);
    raw.set(type, b);
    // Настоящий силуэт, без раздувания под палец: он и есть предмет замера.
    const bare = projectHitBox(id, box, group.matrixWorld, cam, RECT);
    if (bare) raw.set(type, bare);
  });
  return { boxes, raw, byId };
}

describe('область попадания', () => {
  it('не меньше пальца ни у одного здания на 390 px', () => {
    const { boxes } = village();
    expect(boxes.length).toBe(TYPES.length);
    for (const b of boxes) {
      expect(b.hw * 2).toBeGreaterThanOrEqual(TAP_TARGET);
      expect(b.hh * 2).toBeGreaterThanOrEqual(TAP_TARGET);
    }
  });

  it('самое мелкое здание меньше пальца — потому раздувание и нужно', () => {
    // Замер, а не догадка: если модели однажды вырастут настолько, что палец
    // им уже не нужен, этот тест скажет об этом, а не промолчит.
    const cam = phoneCamera();
    let smallest = Infinity;
    for (const type of TYPES) {
      const group = createBuildingGroup(type, visualTier(1));
      const box = silhouetteBox(group);
      const spot = placeOf(type);
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = spot.rot;
      group.scale.setScalar(levelScale(1) * PLAN_SCALE);
      group.updateWorldMatrix(true, false);
      // Раздувание отключено: min = 0, то есть голый силуэт.
      const bare = projectHitBox(0, box, group.matrixWorld, cam, RECT, 0);
      if (!bare) continue;
      smallest = Math.min(smallest, Math.max(bare.hw, bare.hh) * 2);
    }
    expect(smallest).toBeLessThan(TAP_TARGET);
  });

  it('область стоит там же, где само здание', () => {
    // Держит от двойного преобразования: коробка снимается в собственных
    // координатах модели, а место ей даёт матрица группы. Снятая с уже
    // расставленной группы, она разъезжается с постройкой тем сильнее, чем
    // дальше та от центра, — глазами это видно не сразу, тестом сразу.
    const cam = phoneCamera();
    const { boxes, byId } = village();
    const off = boxes.map((b) => {
      const spot = placeOf(byId[b.id]);
      const p = new THREE.Vector3(spot.x, 0.9, spot.z).project(cam);
      return Math.hypot(b.x - ((p.x + 1) / 2) * W, b.y - ((1 - p.y) / 2) * H);
    });
    // Рынок стоит на воротах и на первом уровне занимает один ряд сбоку от
    // проезда — он и даёт самое большое честное расхождение, 17 px.
    expect(Math.max(...off)).toBeLessThan(20);
    expect(off.reduce((a, b) => a + b, 0) / off.length).toBeLessThan(8);
  });

  it('тап в середину здания открывает его, а не соседа', () => {
    const { boxes, byId } = village();
    for (const b of boxes) {
      const got = pickBox(boxes, b.x, b.y);
      expect(`${byId[b.id]}: ${got === null ? '—' : byId[got]}`).toBe(`${byId[b.id]}: ${byId[b.id]}`);
    }
  });

  it('промах рядом со зданием открывает его, и открывает ближайшее', () => {
    const { boxes } = village();
    let forgiven = 0;
    for (const b of boxes) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = b.x + dx * (b.hw + TAP_FORGIVE * 0.5);
        const y = b.y + dy * (b.hh + TAP_FORGIVE * 0.5);
        // Берём только настоящие промахи: точка вне всех областей попадания.
        if (boxes.some((o) => tapScore(o, x, y) <= 1)) continue;
        const got = pickBox(boxes, x, y);
        expect(got).not.toBeNull();
        // И открылось ближайшее, а не первое попавшееся.
        const best = Math.min(...boxes.map((o) => tapScore(o, x, y)));
        expect(tapScore(boxes.find((o) => o.id === got)!, x, y)).toBe(best);
        forgiven++;
      }
    }
    // Прощение обязано срабатывать не в теории: настоящих промахов рядом с
    // постройками на этом экране десятки.
    expect(forgiven).toBeGreaterThan(10);
  });

  it('промах в чистое поле не открывает ничего', () => {
    const { boxes } = village();
    // Угол экрана: там лес до края мира.
    expect(pickBox(boxes, 4, H - 4)).toBeNull();
    expect(pickBox(boxes, W - 4, 4)).toBeNull();
  });

  it('чем ближе к центру постройки, тем сильнее её право на тап', () => {
    const b = hitBox(1, 100, 100, 160, 160);
    expect(tapScore(b, 130, 130)).toBe(0);
    expect(tapScore(b, 130, 155)).toBeGreaterThan(0);
    expect(tapScore(b, 130, 155)).toBeLessThan(1);
    // Снаружи — всегда хуже любого попадания внутрь.
    expect(tapScore(b, 130, 170)).toBeGreaterThan(1);
    // Дальше прощения — не попал вовсе.
    expect(tapScore(b, 130, 160 + TAP_FORGIVE + 1)).toBe(Infinity);
  });

  it('мелкая постройка не отдаёт свой центр раздутому соседу', () => {
    // Два здания в 30 px друг от друга: мелкое (20 px) и крупное (80 px).
    const small = hitBox(1, 190, 190, 210, 210);
    const big = hitBox(2, 200, 200, 280, 280);
    expect(pickBox([small, big], 200, 200)).toBe(1);
    // А в глубине крупного побеждает крупное.
    expect(pickBox([small, big], 260, 260)).toBe(2);
  });
});
