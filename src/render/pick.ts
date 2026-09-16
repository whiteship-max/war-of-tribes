/**
 * Попадание пальцем по зданию — экранная геометрия и её мерки.
 *
 * Причина, по которой это отдельный модуль: попасть по дому на телефоне нельзя
 * было не из-за луча и не из-за значков, а из-за размера. На 390 px силуэт
 * здания меньше отпечатка пальца (`npm run tap:report`, столбец «силуэт»), а прежний выбор шёл по
 * ближайшей точке-якорю у подножия модели: якоря стоят в 30–48 px друг от друга,
 * то есть на здание приходилась ячейка ±15–24 px — вдвое меньше отпечатка пальца,
 * который эту ячейку к тому же закрывает. Мышь такого не воспроизводит: у неё
 * острие в один пиксель и видимый курсор.
 *
 * Поэтому здесь не точка, а **область**: прямоугольник, накрывающий силуэт
 * целиком — и основание, и высоту, — раздутый до размера пальца. Тонкая
 * геометрия ранних ступеней на это не влияет: считается описанная коробка
 * модели, а не её доски.
 */
import * as THREE from 'three';
import { TAP_FORGIVE, TAP_TARGET } from '@/gestures';

/** Область попадания здания на экране: центр и полуразмеры в пикселях. */
export interface HitBox {
  id: number;
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/**
 * Область попадания из экранных границ силуэта. Меньше пальца не бывает:
 * `min` — это `--tap`, и здание на 20 px всё равно ловит палец размером в `TAP_TARGET`.
 */
export function hitBox(id: number, minX: number, minY: number, maxX: number, maxY: number, min = TAP_TARGET): HitBox {
  return {
    id,
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    hw: Math.max((maxX - minX) / 2, min / 2),
    hh: Math.max((maxY - minY) / 2, min / 2),
  };
}

/**
 * Насколько тап «принадлежит» области. Внутри — 0..1, доля пути от центра до
 * края: попал в самую середину дома — ноль, и никакой сосед этого не перебьёт.
 * Снаружи — 1..2 по расстоянию до края, то есть прощённый промах всегда
 * проигрывает настоящему попаданию. Дальше прощения — `Infinity`.
 *
 * Мерка внутри нормирована на размер области нарочно. Раздутая до `TAP_TARGET` мелкая
 * постройка накрывает соседей, и без нормировки крупный сосед забирал бы тап
 * просто потому, что его центр ближе в пикселях.
 */
export function tapScore(b: HitBox, x: number, y: number, forgive = TAP_FORGIVE): number {
  const dx = Math.abs(x - b.x);
  const dy = Math.abs(y - b.y);
  const ox = dx - b.hw;
  const oy = dy - b.hh;
  if (ox <= 0 && oy <= 0) return Math.max(dx / b.hw, dy / b.hh);
  const out = Math.hypot(Math.max(ox, 0), Math.max(oy, 0));
  return out > forgive ? Infinity : 1 + out / forgive;
}

/**
 * Здание под пальцем. Промах прощается: если тап не попал ни в одну область, но
 * рядом есть здание — открывается оно, и при нескольких рядом побеждает ближайшее
 * к точке касания. Тап в чистое поле не открывает ничего.
 */
export function pickBox(boxes: readonly HitBox[], x: number, y: number, forgive = TAP_FORGIVE): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const b of boxes) {
    const score = tapScore(b, x, y, forgive);
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  return best;
}

/**
 * Попал ли тап в кольцо стены. Стена — единственное здание, у которого нет
 * прямоугольной области: её силуэт — весь посёлок, и любая коробка под неё
 * съела бы каждый тап внутри кольца. Поэтому у стены своя мерка — расстояние до
 * самого кольца на земле, — и спрашивают её последней, когда не выиграл никто.
 */
export function onRing(gx: number, gz: number, radius: number, band: number): boolean {
  return Math.abs(Math.hypot(gx, gz) - radius) <= band;
}

/**
 * Силуэт модели в её собственных координатах — описанная коробка готовой группы.
 *
 * Снимается один раз, сразу после сборки: до того, как группу поставили на место
 * (`setFromObject` считает по мировым матрицам, и с уже расставленной группы
 * коробка вышла бы мировой, а её потом ещё раз двинет та же матрица), и до того,
 * как к ней подвесили леса и значок — иначе в область попадания попал бы значок
 * над крышей, а не сам дом.
 *
 * Пустая группа (модель-заглушка) дала бы вывернутую коробку — даём ей объём
 * руками, дальше её всё равно раздует до пальца.
 */
export function silhouetteBox(group: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.6, 0, -0.6), new THREE.Vector3(0.6, 1.2, 0.6));
  return box;
}

/** Прямоугольник канвы на странице — столько от DOM, сколько нужно проекции. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Область попадания из силуэта модели: восемь углов коробки в мир, оттуда на
 * экран, вокруг них описанный прямоугольник. Считается здесь, а не в сцене,
 * потому что ровно эти же числа берёт тест — второй правды о том, где здание на
 * экране, быть не должно (по ним же рисуется «дырка» обучения).
 *
 * null — здание за спиной камеры.
 */
export function projectHitBox(
  id: number,
  box: THREE.Box3,
  matrix: THREE.Matrix4,
  camera: THREE.Camera,
  rect: ScreenRect,
  /** Минимальная цель под палец. Ноль — голый силуэт, каким его видит игрок. */
  min = TAP_TARGET,
): HitBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    v.applyMatrix4(matrix).project(camera);
    if (v.z > 1) return null;
    const x = ((v.x + 1) / 2) * rect.width + rect.left;
    const y = ((1 - v.y) / 2) * rect.height + rect.top;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return hitBox(id, minX, minY, maxX, maxY, min);
}
