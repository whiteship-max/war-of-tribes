// Свет сцены: один тёплый направленный источник с тенью, холодный полусферический
// заполняющий, небо и туман. Живёт отдельно от Scene.ts, чтобы стенд-витрина
// (render/showcase.ts) освещал здания ровно тем же ригом, что и игра: иначе
// скриншоты со стенда ничего не доказывали бы.
//
// Как это устроено:
// - three 0.170 считает свет физически: у Ламберта выход = intensity × альбедо / π.
//   Солнце 3.0 даёт ≈ 0.95 × альбедо на грани, смотрящей на него, полусфера ещё
//   ≈ 0.35 — освещённая горизонтальная грань ≈ 1.08 × альбедо, и hex палитры
//   совпадает с тем, что на экране (Neutral tone mapping ниже 0.8 почти тождественен);
// - синева теней получается сама: в тени поверхность видит только полусферу, а
//   её небо холодное и солнце тёплое, поэтому «свет − тень» = «тёплое − холодное».
//   Второй источник с тенью не нужен и запрещён — каждый стоит прохода по сцене;
// - солнце стоит слева-спереди от стартовой камеры и никогда не в зените: левые
//   скаты и фасады светлые, правые в тени, тени ложатся вправо-назад — так силуэт
//   читается объёмом. Ночью та же лампа становится луной: синей и слабой, но с тенью.
import * as THREE from 'three';
import { PALETTE } from './palette';

export interface LightRig {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

/** Небо и дымка сезона — то, что переливает SeasonVisuals. */
export interface SkyColors {
  sky: THREE.Color;
  fog: THREE.Color;
}

/**
 * Размер карты теней. Коробка ±18 при 1024 даёт 28 текселей на единицу мира —
 * плотнее экрана телефона на стартовом кадре (12.5 px/ед.); 2048 стоило бы
 * 16 МБ и вчетверо больше филлрейта. Стенд может попросить больше через параметр.
 */
export const SHADOW_MAP = 1024;

/** Стартовый азимут камеры (Scene.applyFraming); солнце отсчитывается от него. */
export const CAMERA_AZIMUTH = Math.atan2(9, 12);
/**
 * Ключевой свет повёрнут на 55° влево от камеры (азимут меньше камерного: экранное
 * «вправо» — это (cos θ, −sin θ), и меньший азимут уходит от него влево).
 */
const KEY_AZIMUTH = CAMERA_AZIMUTH - (55 * Math.PI) / 180;
/** Расстояние до солнца: далеко, чтобы коробка теней была ортогональной честно. */
const SUN_DISTANCE = 40;
const DEG = Math.PI / 180;

/** Настройки рендерера, от которых зависит вид света: тени, цветовое пространство, тон-маппинг. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  // PCF, не PCFSoft: у Soft radius игнорируется, а выборок вдвое больше.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral держит тон и насыщенность плоских цветов; ACES серил зелень и уводил солому в оранжевое.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
}

/** Небо и туман сцены. Цвет дальше ведут сезон и время суток (см. applyDayNight). */
export function configureSky(scene: THREE.Scene): void {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 22, 40);
}

/** Добавляет в сцену солнце и полусферу. Единственный источник с тенью — солнце. */
export function createLightRig(scene: THREE.Scene, shadowMap = SHADOW_MAP): LightRig {
  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.1);
  scene.add(hemi);

  // Полуденное солнце стоит под 52°, а не в зените: 3.2 × sin 52° / π ≈ 0.8 × альбедо на
  // горизонтальной грани, полусфера добавляет ≈ 0.15 — вместе ≈ hex палитры на экране.
  // Тень от одной полусферы ≈ 0.3 × альбедо: читается, не чёрная.
  const sun = new THREE.DirectionalLight(PALETTE.sunDay, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMap, shadowMap);
  const sc = sun.shadow.camera;
  sc.near = 2;
  sc.far = SUN_DISTANCE * 2.5;
  // normalBias, а не bias, лечит акне на плоском затенении: bias отрывал бы тень от основания.
  // Больше 0.03 нельзя: тонкие столбы старых моделей (0.045 мировых) «расшиваются».
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  scene.add(sun);
  scene.add(sun.target);
  fitShadow({ sun, hemi }, 18);
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

const C_SKY_NIGHT = new THREE.Color(PALETTE.skyNight);
const C_SKY_DUSK = new THREE.Color(PALETTE.skyDusk);
const C_SUN_DAY = new THREE.Color(PALETTE.sunDay);
const C_SUN_DUSK = new THREE.Color(PALETTE.sunDusk);
const C_MOON = new THREE.Color(PALETTE.moon);
const C_HEMI_SKY = new THREE.Color(PALETTE.hemiSky);
const C_HEMI_GROUND = new THREE.Color(PALETTE.hemiGround);
const C_HEMI_SKY_NIGHT = new THREE.Color(PALETTE.hemiSkyNight);
const C_HEMI_GROUND_NIGHT = new THREE.Color(PALETTE.hemiGroundNight);

const TMP_A = new THREE.Color();
const TMP_B = new THREE.Color();
const SUN_POS = new THREE.Vector3();
const MOON_POS = new THREE.Vector3();

const smooth = (t: number): number => {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Направление на светило по азимуту и высоте — в позицию лампы. */
function setSun(out: THREE.Vector3, azimuth: number, elevation: number): void {
  const ce = Math.cos(elevation);
  out.set(Math.sin(azimuth) * ce, Math.sin(elevation), Math.cos(azimuth) * ce).multiplyScalar(SUN_DISTANCE);
}

/**
 * Время суток. solar: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь.
 * Днём солнце ходит дугой вокруг ключевого азимута: 12° на рассвете и закате
 * (длинные тёплые тени), 52° в полдень. Ночью лампа плавно переезжает в луну.
 */
export function applyDayNight(rig: LightRig, scene: THREE.Scene, solar: number, season: SkyColors): void {
  const angle = solar * Math.PI * 2;
  const elev = Math.sin(angle); // -1..1
  const daylight = THREE.MathUtils.clamp((elev + 0.35) / 0.5, 0, 1);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.3, 0, 1);
  const nightK = smooth(-elev / 0.15);

  const dayT = THREE.MathUtils.clamp(solar, 0, 0.5) / 0.5;
  const elevation = (12 + 40 * Math.sin(dayT * Math.PI)) * DEG;
  const azimuth = KEY_AZIMUTH + (solar - 0.25) * 1.25;
  setSun(SUN_POS, azimuth, elevation);
  setSun(MOON_POS, KEY_AZIMUTH + 0.6, 40 * DEG);
  rig.sun.position.copy(SUN_POS).lerp(MOON_POS, nightK);
  rig.sun.intensity = 0.6 + 2.6 * daylight;
  rig.sun.color.copy(TMP_A.copy(C_SUN_DAY).lerp(C_SUN_DUSK, dusk)).lerp(C_MOON, nightK);

  rig.hemi.intensity = 0.45 + 0.65 * daylight;
  rig.hemi.color.copy(C_HEMI_SKY_NIGHT).lerp(C_HEMI_SKY, daylight);
  rig.hemi.groundColor.copy(C_HEMI_GROUND_NIGHT).lerp(C_HEMI_GROUND, daylight);

  const sky = TMP_A.copy(C_SKY_NIGHT).lerp(season.sky, daylight).lerp(C_SKY_DUSK, dusk * 0.6);
  (scene.background as THREE.Color).copy(sky);
  const fog = scene.fog as THREE.Fog | null;
  if (fog) fog.color.copy(TMP_B.copy(C_SKY_NIGHT).lerp(season.fog, daylight).lerp(C_SKY_DUSK, dusk * 0.45));
}

/** Костёр: днём почти не виден, ночью — тёплая лужа на холодном лунном фоне. */
export const fireIntensity = (night: boolean, t: number): number => (night ? 8 : 0.6) * (1 + Math.sin(t * 17) * 0.12);
