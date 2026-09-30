// Свет сцены: один тёплый направленный источник с тенью, холодный полусферический
// заполняющий, небо и туман. Живёт отдельно от Scene.ts, чтобы стенд-витрина
// (render/showcase.ts) освещал здания ровно тем же ригом, что и игра: иначе
// скриншоты со стенда ничего не доказывали бы.
//
// Как это устроено:
// - three 0.170 считает свет физически: у Ламберта выход = intensity × альбедо / π.
//   Силы солнца и полусферы подобраны так, что освещённая горизонтальная грань
//   в полдень выходит на альбедо (расчёт — у `createLightRig`), и hex палитры
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

/**
 * Вид сцены: `now` — нынешний, его видит игрок; `next` — проба окружения посёлка
 * (docs/graphics_world.md): новый свет ночи, земля, трава, лес. Проба живёт за этим
 * выключателем, пока владелец не посмотрит снимки: игра рисует `now`, стенд умеет оба
 * (`?showcase=village&look=next`). Второго выключателя нет — сцена спрашивает этот.
 */
export type Look = 'now' | 'next';

export const lookOf = (s: string | null | undefined): Look => (s === 'next' ? 'next' : 'now');

/**
 * Числа света по виду. Днём оба вида одинаковы: палитра подобрана под полуденный риг
 * (см. `createLightRig`), и переписывать её пробе незачем. Расходятся они ночью.
 *
 * `now` — ночь «физическая»: луна втрое слабее солнца и синяя, полусфера тёмная. На
 * экране телефона это тёмно-синяя каша, где читаются только костёр и крыши (снимки
 * владельца, 01.10.2026): штукатурка выходит около 70/255, трава — около 50.
 *
 * `next` — ночь «сценическая», как в мобильных стратегиях: ночь — половина игрового
 * времени, и играть её надо так же, как день. Луна — ключевой свет с диапазоном: её
 * сила 1.7 при цвете `moonlight` кладёт на освещённую горизонталь около пятой доли
 * альбедо в красном и почти половину в синем (1.7 × sin 40° × цвет / π), полусфера
 * ночи добавляет ещё десятую в синем. Штукатурка на луне выходит около 110–140/255,
 * в тени — около 55–85: вдвое темнее, но различима. Тепло дают костёр и окна.
 */
export interface RigLook {
  /** Сила лампы: полдень и глубокая ночь (луна); между ними — по доле дневного света. */
  sun: { day: number; night: number };
  /** Сила полусферы: день и ночь. */
  hemi: { day: number; night: number };
  /** Цвет луны. */
  moon: number;
  /** Полусфера днём: небо сверху и отсвет снизу. */
  hemiSkyDay: number;
  hemiGroundDay: number;
  /** Полусфера ночью: небо сверху и отсвет снизу. */
  hemiSkyNight: number;
  hemiGroundNight: number;
  /** Фон ночью — край мира за туманом. */
  skyNight: number;
  /** Дымка ночью: светлее земли, чтобы дальний лес уходил в неё, а не в черноту. */
  fogNight: number;
  /** Высота луны, градусы: выше — короче тени и светлее горизонтали. */
  moonElevation: number;
  /**
   * Фон — дымка, а не небо. Камера деревни смотрит вниз, и неба над горизонтом не видит
   * вовсе: за краем земли у неё — пустота под горизонтом, и крашенная небом она читалась
   * голубой полосой. У пробы за краем — дальний лес в дымке (`env/rules.FAR_RADIUS`), и
   * фон — цвет самой дымки: лес уходит в неё без шва.
   */
  hazeSky: boolean;
}

export const RIG: Record<Look, RigLook> = {
  now: {
    sun: { day: 3.2, night: 1.0 },
    hemi: { day: 1.1, night: 0.6 },
    moon: PALETTE.moon,
    hemiSkyDay: PALETTE.hemiSky,
    hemiGroundDay: PALETTE.hemiGround,
    hemiSkyNight: PALETTE.hemiSkyNight,
    hemiGroundNight: PALETTE.hemiGroundNight,
    skyNight: PALETTE.skyNight,
    fogNight: PALETTE.skyNight,
    moonElevation: 40,
    hazeSky: false,
  },
  next: {
    sun: { day: 3.2, night: 1.7 },
    hemi: { day: 1.1, night: 1.35 },
    moon: PALETTE.moonlight,
    hemiSkyDay: PALETTE.hemiSkyWarm,
    hemiGroundDay: PALETTE.hemiGroundWarm,
    hemiSkyNight: PALETTE.nightFill,
    hemiGroundNight: PALETTE.nightBounce,
    skyNight: PALETTE.nightSky,
    fogNight: PALETTE.nightHaze,
    moonElevation: 46,
    hazeSky: true,
  },
};

/** Что насчитал свет этого кадра: ими живут огонь, окна и пятна теней окружения. */
export interface DayLight {
  /** 0 — ночь, 1 — день. */
  daylight: number;
  /** 0 — день, 1 — глубокая ночь; плавный. */
  nightK: number;
  /** 1 — солнце у горизонта (закат, рассвет). */
  dusk: number;
}

/** Небо, дымка и солнце сезона — то, что переливает SeasonVisuals. */
export interface SkyColors {
  sky: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
  /** Высота солнечной дуги: 1 — весна, зимой меньше. */
  sunArc: number;
}

/**
 * Размер карты теней. Коробка теней (`fitShadow`, её ставит `Scene.applyFraming`)
 * при 1024 даёт на единицу мира больше текселей, чем экран телефона пикселей на
 * стартовом кадре; 2048 стоило бы 16 МБ и вчетверо больше филлрейта. Стенд может попросить больше через параметр.
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

const C_SKY_DUSK = new THREE.Color(PALETTE.skyDusk);
const C_SUN_DUSK = new THREE.Color(PALETTE.sunDusk);

/** Ночные цвета вида и его полусфера дня — один раз на вид, а не на кадр. */
interface NightColors {
  sky: THREE.Color;
  fog: THREE.Color;
  moon: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  daySky: THREE.Color;
  dayGround: THREE.Color;
}
const nightColors = new Map<RigLook, NightColors>();
function nightOf(look: RigLook): NightColors {
  let c = nightColors.get(look);
  if (!c) {
    c = {
      sky: new THREE.Color(look.skyNight),
      fog: new THREE.Color(look.fogNight),
      moon: new THREE.Color(look.moon),
      hemiSky: new THREE.Color(look.hemiSkyNight),
      hemiGround: new THREE.Color(look.hemiGroundNight),
      daySky: new THREE.Color(look.hemiSkyDay),
      dayGround: new THREE.Color(look.hemiGroundDay),
    };
    nightColors.set(look, c);
  }
  return c;
}

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
 *
 * `key` — вокруг какого азимута ходит солнце. У деревни он выведен из стартовой
 * камеры и меняться не должен; сцена боя смотрит в другую сторону и просит свой,
 * иначе её войско оказалось бы против света и обе стороны стали бы одного цвета.
 *
 * `look` — числа ночи (`RIG`); без него — нынешние, и кадр тот же, что до выключателя.
 */
export function applyDayNight(
  rig: LightRig,
  scene: THREE.Scene,
  solar: number,
  season: SkyColors,
  key: number = KEY_AZIMUTH,
  look: RigLook = RIG.now,
): DayLight {
  const angle = solar * Math.PI * 2;
  const elev = Math.sin(angle); // -1..1
  const daylight = THREE.MathUtils.clamp((elev + 0.35) / 0.5, 0, 1);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.3, 0, 1);
  const nightK = smooth(-elev / 0.15);
  const night = nightOf(look);

  const dayT = THREE.MathUtils.clamp(solar, 0, 0.5) / 0.5;
  const elevation = (12 + 40 * season.sunArc * Math.sin(dayT * Math.PI)) * DEG;
  const azimuth = key + (solar - 0.25) * 1.25;
  setSun(SUN_POS, azimuth, elevation);
  setSun(MOON_POS, key + 0.6, look.moonElevation * DEG);
  rig.sun.position.copy(SUN_POS).lerp(MOON_POS, nightK);
  // Ночью лампа — луна, но с тенью; жители у ворот должны оставаться различимы.
  rig.sun.intensity = look.sun.night + (look.sun.day - look.sun.night) * daylight;
  rig.sun.color.copy(TMP_A.copy(season.sun).lerp(C_SUN_DUSK, dusk)).lerp(night.moon, nightK);

  rig.hemi.intensity = look.hemi.night + (look.hemi.day - look.hemi.night) * daylight;
  rig.hemi.color.copy(night.hemiSky).lerp(night.daySky, daylight);
  rig.hemi.groundColor.copy(night.hemiGround).lerp(night.dayGround, daylight);

  const sky = TMP_A.copy(night.sky).lerp(season.sky, daylight).lerp(C_SKY_DUSK, dusk * 0.6);
  const haze = TMP_B.copy(night.fog).lerp(season.fog, daylight).lerp(C_SKY_DUSK, dusk * 0.45);
  (scene.background as THREE.Color).copy(look.hazeSky ? haze : sky);
  const fog = scene.fog as THREE.Fog | null;
  if (fog) fog.color.copy(haze);
  return { daylight, nightK, dusk };
}

/**
 * Окна (`render/glow.ts`): загораются, когда дневной свет уходит, — в сумерках, раньше
 * глубокой ночи, — и к ночи горят в полную силу. Плавно, от доли дня, без ступеньки.
 */
export const windowNight = (l: DayLight): number => smooth((1 - l.daylight) * 1.5);

/** Костёр: днём почти не виден, ночью — тёплая лужа на холодном лунном фоне. */
export const fireIntensity = (night: boolean, t: number): number => (night ? 8 : 0.6) * (1 + Math.sin(t * 17) * 0.12);

/**
 * Костёр вида `next`: сила идёт за ночью плавно, а не ступенькой. У `fireIntensity` ночь —
 * флаг сцены, и на его пороге огонь прыгал с 0.6 до 8 за один кадр; здесь та же пара чисел
 * (чуть ярче ночью — вокруг костра стало светлее само) ведётся долей ночи из рига.
 */
export const fireGlow = (nightK: number, t: number): number => (0.6 + 8.4 * nightK) * (1 + Math.sin(t * 17) * 0.12);
