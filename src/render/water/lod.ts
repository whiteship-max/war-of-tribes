// Вода — одна на игру (docs/polish.md, П-8): уровень воды на ходу. Без шейдера и без three-материалов: его зовут сторожа
// плавности города, роликов и промыслов, и куску промыслов не нужно тянуть за ним код воды.
import type * as THREE from 'three';

/** Сторож плавности опустил уровень: вода под `root` считает не больше `lod` (рябь, круги, огни), без пересборки. */
export function lowerWaterLook(root: THREE.Object3D, lod: number): void {
  root.traverse((o) => {
    const w = o.userData.water as { wLod: { value: number } } | undefined;
    if (w) w.wLod.value = Math.min(w.wLod.value, lod);
  });
}
