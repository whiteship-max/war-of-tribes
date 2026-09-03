// Свет сцены: один тёплый направленный источник с тенью, холодный полусферический
// заполняющий, небо и туман. Живёт отдельно от Scene.ts, чтобы стенд-витрина
// (render/showcase.ts) освещал здания ровно тем же ригом, что и игра: иначе
// скриншоты со стенда ничего не доказывали бы.
import * as THREE from 'three';

/** Стартовый цвет неба до первого кадра; дальше его ведёт сезон. */
export const SKY_INIT = 0x9fc9e8;
const SKY_DUSK = new THREE.Color(0xe08a5a);
const SKY_NIGHT = new THREE.Color(0x141a2e);
const SUN_DAY = new THREE.Color(0xffe7c4);
const SUN_DUSK = new THREE.Color(0xff9a5a);

export interface LightRig {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

/** Настройки рендерера, от которых зависит вид света: тени, цветовое пространство, тон-маппинг. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

/** Небо и туман сцены. Цвет дальше ведут сезон и время суток (см. applyDayNight). */
export function configureSky(scene: THREE.Scene): void {
  scene.background = new THREE.Color(SKY_INIT);
  scene.fog = new THREE.Fog(SKY_INIT, 22, 40);
}

/** Добавляет в сцену солнце и полусферу. Единственный источник с тенью — солнце. */
export function createLightRig(scene: THREE.Scene): LightRig {
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6a3a, 0.7);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(12, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -18;
  sc.right = 18;
  sc.top = 18;
  sc.bottom = -18;
  sc.near = 1;
  sc.far = 60;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);
  return { sun, hemi };
}

/** Коробка теней накрывает квадрат ±half вокруг центра. */
export function fitShadow(rig: LightRig, half: number): void {
  const sc = rig.sun.shadow.camera;
  sc.left = -half;
  sc.right = half;
  sc.top = half;
  sc.bottom = -half;
  sc.updateProjectionMatrix();
}

const TMP_SKY = new THREE.Color();
const TMP_SUN = new THREE.Color();

/**
 * Время суток. solar: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь.
 * seasonSky — дневной цвет неба текущего сезона (его переливает SeasonVisuals).
 */
export function applyDayNight(rig: LightRig, scene: THREE.Scene, solar: number, seasonSky: THREE.Color): void {
  const angle = solar * Math.PI * 2;
  const elev = Math.sin(angle); // -1..1
  const daylight = THREE.MathUtils.clamp((elev + 0.35) / 0.5, 0, 1);
  rig.sun.position.set(Math.cos(angle) * 16, Math.max(2, elev * 20), 8);
  rig.sun.intensity = 0.15 + daylight * 1.5;
  rig.hemi.intensity = 0.25 + daylight * 0.55;

  const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.3, 0, 1);
  const sky = TMP_SKY.copy(SKY_NIGHT).lerp(seasonSky, daylight);
  sky.lerp(SKY_DUSK, dusk * 0.6);
  (scene.background as THREE.Color).copy(sky);
  (scene.fog as THREE.Fog).color.copy(sky);
  rig.sun.color.copy(TMP_SUN.copy(SUN_DAY).lerp(SUN_DUSK, dusk));
}
