// Касание по постройкам города (docs/city.md, раздел 5). Судья жеста — общий (`src/gestures.ts`): он
// решает, тап это или ведение; здесь — только «во что попал тап». Мерки пальца — те же, что у посёлка
// (`TAP_TARGET`, `TAP_FORGIVE`, `render/pick.ts`): второй правды о размере пальца в игре нет.
//
// Почему не экранные прямоугольники, как в посёлке. В посёлке двадцать четыре постройки стоят врозь
// на кольце; в городе двести домов сомкнуты фронтом, а храм, ратуша и башни — среди них. Описанный
// прямоугольник наклонной коробки на экране вдвое шире силуэта и накрыл бы соседей. Поэтому сначала —
// честный луч в коробки мест (`sites.ts`, сняты с самих моделей): попадает то, что видно первым по
// лучу. Пальцу помогают двумя правилами посёлка: мелкая постройка (силуэт меньше пальца) раздувается
// до `TAP_TARGET` и в своей области сильнее соседа, а промах мимо всего прощается до `TAP_FORGIVE`.
import * as THREE from 'three';
import { TAP_FORGIVE, TAP_TARGET } from '@/gestures';
import { hitBox, pickBox, tapScore, type HitBox, type ScreenRect } from '../pick';
import { siteCorners, type Site } from './sites';

/** Постройка игры и её коробки в мире. */
export interface Pickable {
  id: number;
  sites: readonly Site[];
}

/** Расстояние по лучу до входа в коробку места; `Infinity` — мимо. */
export function raySite(o: THREE.Vector3, d: THREE.Vector3, s: Site): number {
  // Луч — в рамку коробки: «вперёд» (fx, fz), «вправо» (fz, −fx), вверх.
  const ox = o.x - s.x;
  const oz = o.z - s.z;
  const lo = [ox * s.fx + oz * s.fz, ox * s.fz - oz * s.fx, o.y];
  const ld = [d.x * s.fx + d.z * s.fz, d.x * s.fz - d.z * s.fx, d.y];
  const mn = [-s.hf, -s.hr, s.y0];
  const mx = [s.hf, s.hr, s.y1];
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-9) {
      if (lo[k] < mn[k] || lo[k] > mx[k]) return Infinity;
      continue;
    }
    let ta = (mn[k] - lo[k]) / ld[k];
    let tb = (mx[k] - lo[k]) / ld[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

const V = new THREE.Vector3();

/** Коробка мест на экране — описанный прямоугольник их углов; null — всё за спиной камеры. */
export function screenBox(id: number, sites: readonly Site[], camera: THREE.Camera, rect: ScreenRect, min = 0): HitBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of sites) {
    for (const [x, y, z] of siteCorners(s)) {
      V.set(x, y, z).project(camera);
      if (V.z > 1) return null;
      const sx = ((V.x + 1) / 2) * rect.width + rect.left;
      const sy = ((1 - V.y) / 2) * rect.height + rect.top;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
  }
  if (minX > maxX) return null;
  return hitBox(id, minX, minY, maxX, maxY, min);
}

/** Мелкая ли постройка на экране: силуэт всех её мест уже пальца хоть в одну сторону. */
export const isSmall = (raw: HitBox): boolean => raw.hw * 2 < TAP_TARGET || raw.hh * 2 < TAP_TARGET;

const RAY = new THREE.Raycaster();
const NDC = new THREE.Vector2();

/**
 * Постройка под пальцем (x, y — пиксели страницы) или null. Три ступени: мелкая постройка в своей
 * раздутой области; иначе первая по лучу коробка; иначе ближайшая в пределах прощения.
 */
export function cityPick(items: readonly Pickable[], camera: THREE.Camera, rect: ScreenRect, x: number, y: number): number | null {
  if (rect.width < 1 || rect.height < 1) return null;
  // 1. Мелкая постройка — не меньше пальца, и в своей области она сильнее соседа (как в посёлке).
  let small: number | null = null;
  let smallScore = Infinity;
  for (const it of items) {
    const raw = screenBox(it.id, it.sites, camera, rect);
    if (!raw || !isSmall(raw)) continue;
    const score = tapScore(hitBox(it.id, raw.x - raw.hw, raw.y - raw.hh, raw.x + raw.hw, raw.y + raw.hh), x, y, 0);
    if (score <= 1 && score < smallScore) {
      smallScore = score;
      small = it.id;
    }
  }
  if (small !== null) return small;
  // 2. Луч: что видно первым.
  NDC.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
  RAY.setFromCamera(NDC, camera);
  const { origin, direction } = RAY.ray;
  let best: number | null = null;
  let bestT = Infinity;
  for (const it of items) {
    for (const s of it.sites) {
      const t = raySite(origin, direction, s);
      if (t < bestT) {
        bestT = t;
        best = it.id;
      }
    }
  }
  if (best !== null) return best;
  // 3. Промах прощается: ближайшее место в пределах полупальца.
  const boxes: HitBox[] = [];
  for (const it of items) {
    for (const s of it.sites) {
      const b = screenBox(it.id, [s], camera, rect);
      if (b) boxes.push(b);
    }
  }
  return pickBox(boxes, x, y, TAP_FORGIVE);
}
