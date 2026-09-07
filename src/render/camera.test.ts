// Обзор деревни отпущен, но не в пустоту: у панорамы есть привязка к посёлку,
// у приближения — пол и потолок. Проверяется это числами, а не глазами.
import { describe, expect, it } from 'vitest';
import { FRAME_RADIUS, OUTSKIRTS_RADIUS } from './plan';
import { PAN_LEASH, clampPan, framing, zoomRange } from './camera';

/** Телефон в портрете — тот экран, ради которого всё и делается. */
const PHONE = 390 / 844;

describe('камера деревни', () => {
  it('привязка держит центр экрана в пределах окрестностей', () => {
    // Внутри поводка ничего не двигается.
    expect(clampPan(3, -4)).toEqual({ x: 3, z: -4 });
    // Снаружи — возвращается ровно на поводок, не меняя направления.
    const far = clampPan(200, 0);
    expect(far.x).toBeCloseTo(PAN_LEASH, 6);
    expect(far.z).toBeCloseTo(0, 6);
    const diag = clampPan(-100, 100);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(PAN_LEASH, 6);
    expect(diag.x / diag.z).toBeCloseTo(-1, 6);
    // Центр экрана доходит до самого дальнего двора и ни на шаг дальше.
    expect(PAN_LEASH).toBeCloseTo(OUTSKIRTS_RADIUS, 6);
  });

  it('поводок не спотыкается о ноль', () => {
    expect(clampPan(0, 0)).toEqual({ x: 0, z: 0 });
  });

  it('кадровая дистанция лежит между полом и потолком приближения', () => {
    for (const aspect of [PHONE, 375 / 812, 0.62, 1, 16 / 9]) {
      const f = framing(aspect);
      const z = zoomRange(f);
      expect(z.min).toBeLessThan(f.dist);
      expect(z.max).toBeGreaterThanOrEqual(f.dist);
    }
  });

  it('пол приближения ближе прежнего: здание должно дорасти до пальца', () => {
    const f = framing(PHONE);
    const z = zoomRange(f);
    // Прежний пол — 0.45 кадровой дистанции. Здание на 20 px становилось 45 px,
    // то есть ровно впритык к пальцу; теперь оно вырастает вдвое сильнее.
    expect(z.min).toBeLessThan(f.dist * 0.45);
    // Но не настолько, чтобы камера залезла внутрь моделей.
    expect(z.min).toBeGreaterThanOrEqual(12);
  });

  it('потолок отдаления не выпускает деревню в туман', () => {
    for (const aspect of [PHONE, 0.62, 1, 16 / 9]) {
      const f = framing(aspect);
      const z = zoomRange(f);
      // Дальний край застройки при полном отдалении остаётся по эту сторону тумана.
      expect(z.max + FRAME_RADIUS).toBeLessThanOrEqual(f.fogFar);
    }
  });

  it('портрет телефона кадрируется ближе и сверху', () => {
    const phone = framing(PHONE);
    const wide = framing(16 / 9);
    expect(phone.polar).toBeLessThan(wide.polar);
    expect(phone.fov).toBeGreaterThan(wide.fov);
    expect(phone.targetY).toBeGreaterThan(wide.targetY);
  });
});
