// Поле боя: плоская земля и свет. В этой пачке земля нарочно ровная и голая —
// красивым бой станет позже, а начинать с красоты на неправильном основании
// значит её потом выбросить.
//
// Свет — тот же риг, что у деревни и стенда: одно тёплое солнце с тенью,
// холодная полусфера сверху, тёплая снизу. Второго источника с тенью не заводить.
import * as THREE from 'three';
import { LEGACY } from '../materials';
import { PALETTE } from '../palette';
import { configureSky, createLightRig, fitShadow, type LightRig } from '../lighting';
import { FIELD } from '@/battle/replay';

/** Половина стороны поля: земля обязана уходить за кадр стратегического плана. */
export const FIELD_HALF = 60;

/** Докуда бьёт коробка теней. Дальше фигур нет, а карта тени тем острее, чем меньше квадрат. */
const SHADOW_HALF = Math.round(FIELD.laneW * 2 + FIELD.frontZ + FIELD.rowGap + FIELD.reserveGap) + 4;

/**
 * Плоская земля одним вызовом отрисовки. Тон — приглушённая трава палитры, а не
 * яркая: на весь экран открытый зелёный кричит и сцена читается тестовой.
 * Настоящая земля — рельеф, пятна, вытоптанность — придёт пачкой про красоту.
 */
export function buildField(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_HALF * 2, FIELD_HALF * 2), LEGACY.grassDark);
  mesh.name = 'field';
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Небо, туман и свет боевой сцены. Туман отодвинут: у деревни он начинается на
 * 22 метрах, а тут на этой дистанции стоит вторая армия — она не должна тонуть
 * в дымке ровно тогда, когда игрок оценивает соотношение сил.
 */
export function setupFieldScene(scene: THREE.Scene): LightRig {
  configureSky(scene);
  scene.fog = new THREE.Fog(PALETTE.fog, 45, 85);
  const rig = createLightRig(scene);
  fitShadow(rig, SHADOW_HALF);
  return rig;
}
