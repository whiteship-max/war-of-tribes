// Вода — одна на игру (docs/polish.md, П-8): луна над водой. Ракурс игры смотрит на воду сверху, и настоящая луна рига
// (`lighting.applyDayNight`) стоит так, что дорожки от неё в кадре нет. Для воды луна встаёт перед камерой: дорожка
// ложится посередине кадра — сверху короткая и широкая, с берега (рыбалка) длинная до горизонта.
import * as THREE from 'three';
import { MOON_ELEV } from './shape';

const DEG = Math.PI / 180;
const fwd = new THREE.Vector3();

/**
 * Куда смотреть на луну с воды: по горизонту — вперёд камеры с поворотом на 8°, по высоте — от `MOON_ELEV.eye` у глаза
 * над водой до `MOON_ELEV.top` при взгляде сверху (по наклону камеры). Пишет в `out` и возвращает его.
 */
export function moonOverWater(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
  camera.getWorldDirection(fwd);
  const down = Math.max(0, Math.min(1, -fwd.y / 0.8));
  const az = Math.atan2(fwd.x, fwd.z) + 8 * DEG;
  const el = (MOON_ELEV.eye + (MOON_ELEV.top - MOON_ELEV.eye) * down) * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * Ночь на этой доле суток: 0 — день, 1 — глубокая ночь; в сумерках — между. Одна мерка у роликов боя и осады и у воды
 * промыслов (прежде — `reel/light.nightOf`).
 */
export function nightOf(solar: number): number {
  if (solar > 0.5 && solar < 1) return Math.min(1, Math.sin(((solar - 0.5) / 0.5) * Math.PI) * 1.6);
  const edge = Math.min(Math.abs(solar - 0.5), Math.abs(solar), Math.abs(solar - 1));
  return Math.max(0, 0.6 - edge * 12);
}
