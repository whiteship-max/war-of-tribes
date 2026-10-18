// Покои правителя (docs/city_v3.md, Г-6): предмет в руке — «поднял и рассматривает». Как предмет повёрнут перед глазом
// и где его держать, чтобы он целиком был в кадре при любом повороте пальцем: клинок меча — от навершия до острия,
// кубок — с чашей и ножкой. Чистые функции в осях глаза (x — вправо, y — вверх, глаз смотрит в −z): их зовёт комната
// (`room.ts`) и сверяет тест.
import * as THREE from 'three';
import type { Trinket } from './plan';

/** Сколько поворота предмета на радиан поворота головы пальцем взгляда: медленно, пол-оборота — на экран. */
export const TURN_PER_LOOK = 0.8;

/**
 * Где в кадре можно держать предмет (доли экрана от середины, −1…1): ниже шапки «Покои» и выше нижней полосы
 * («Положить»), не у самых краёв. Меч — во весь кадр, мелочь — ближе к середине.
 */
export const HOLD_FRAME = {
  sword: { x0: -0.74, x1: 0.8, y0: -0.64, y1: 0.72, px: 0.42, py: -0.48 },
  fist: { x0: -0.55, x1: 0.62, y0: -0.5, y1: 0.55, px: 0.14, py: -0.28 },
  palm: { x0: -0.55, x1: 0.62, y0: -0.5, y1: 0.55, px: 0.1, py: -0.34 },
} as const;

export const frameOf = (t: Trinket): (typeof HOLD_FRAME)[keyof typeof HOLD_FRAME] => (t.id === 'sword' ? HOLD_FRAME.sword : HOLD_FRAME[t.hold]);

const AX = new THREE.Vector3();
const QA = new THREE.Quaternion();
const M = new THREE.Matrix4();

/**
 * Поворот предмета в осях глаза: стоймя с наклоном верха к глазу `tilt`; меч — клинком вверх, влево и от глаза
 * (рассматривают, держа у плеча), плоскостью к глазу. Поверх — поворот пальцем `spin` вокруг оси хвата (`axis`:
 * у кубка и короны — их верх, у меча — клинок) и наклон `dtilt`.
 */
export function holdRotation(t: Trinket, spin: number, dtilt: number, out: THREE.Quaternion): THREE.Quaternion {
  if (t.id === 'sword') {
    const z = new THREE.Vector3(-0.24, 0.84, -0.48).normalize();
    // Наклон пальцем — клинок к глазу и от него, вокруг оси «вправо».
    z.applyAxisAngle(new THREE.Vector3(1, 0, 0), dtilt);
    const x = new THREE.Vector3(0.25, 0, 1);
    x.addScaledVector(z, -x.dot(z)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    out.setFromRotationMatrix(M.makeBasis(x, y, z));
  } else out.setFromAxisAngle(AX.set(1, 0, 0), t.tilt + dtilt);
  QA.setFromAxisAngle(AX.set(t.axis[0], t.axis[1], t.axis[2]).normalize(), spin);
  return out.multiply(QA);
}

/**
 * Где держать хват предмета (точку `grip`) в осях глаза, чтобы предмет целиком был в рамке `HOLD_FRAME` при любом
 * повороте пальцем (оборот вокруг оси и наклон во всех пределах): ближе всего, но не ближе `near` и не дальше `far`;
 * поперёк — у привычного места руки (`px`, `py`), сколько позволяет рамка. `fov` — по вертикали, градусы.
 */
export function holdFit(t: Trinket, bounds: THREE.Box3, fov: number, aspect: number): THREE.Vector3 {
  const f = frameOf(t);
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  // Углы коробки предмета от хвата — во всех поворотах пальцем.
  const pts: THREE.Vector3[] = [];
  const q = new THREE.Quaternion();
  const g = new THREE.Vector3(t.grip[0], t.grip[1], t.grip[2]);
  for (let i = 0; i < 12; i++)
    for (const tl of [t.tilts[0], (t.tilts[0] + t.tilts[1]) / 2, t.tilts[1]]) {
      holdRotation(t, (i / 12) * Math.PI * 2, tl, q);
      for (let c = 0; c < 8; c++) {
        const v = new THREE.Vector3(c & 1 ? bounds.max.x : bounds.min.x, c & 2 ? bounds.max.y : bounds.min.y, c & 4 ? bounds.max.z : bounds.min.z);
        pts.push(v.sub(g).applyQuaternion(q));
      }
    }
  // При расстоянии `d` (хват на −d по оси взгляда) каждая точка даёт окно для сдвига хвата вбок и вверх.
  const span = (d: number): { x: [number, number]; y: [number, number] } | null => {
    let xl = -Infinity;
    let xh = Infinity;
    let yl = -Infinity;
    let yh = Infinity;
    for (const p of pts) {
      const depth = d - p.z;
      if (depth < 0.08) return null;
      xl = Math.max(xl, f.x0 * tanH * depth - p.x);
      xh = Math.min(xh, f.x1 * tanH * depth - p.x);
      yl = Math.max(yl, f.y0 * tanV * depth - p.y);
      yh = Math.min(yh, f.y1 * tanV * depth - p.y);
    }
    return xl <= xh && yl <= yh ? { x: [xl, xh], y: [yl, yh] } : null;
  };
  let d = t.far;
  if (span(t.near)) d = t.near;
  else if (span(t.far)) {
    let lo = t.near;
    let hi = t.far;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (span(mid)) hi = mid;
      else lo = mid;
    }
    d = hi;
  }
  const s = span(d);
  const want = { x: f.px * tanH * d, y: f.py * tanV * d };
  if (!s) return new THREE.Vector3(want.x, want.y, -d);
  return new THREE.Vector3(Math.min(s.x[1], Math.max(s.x[0], want.x)), Math.min(s.y[1], Math.max(s.y[0], want.y)), -d);
}
