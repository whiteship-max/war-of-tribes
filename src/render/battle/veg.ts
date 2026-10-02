/**
 * Материал луга и опушки ролика о бое: растительность — Ламберт three с правкой шейдера перед сборкой
 * (`onBeforeCompile`), как у поляны предыстории (`prologue/surface.ts`): свет, туман и тени общие со сценой, а
 * своё — только ветер и два цвета. Взят из окружения посёлка вида `next` дословно, когда посёлок убрали
 * (docs/city.md, «Город — единственный вид»); радиус расчистки посёлка в тени облаков стал числом — текст
 * шейдера тот же, а облаков ролик не включает (`EnvShared.cloud` — ноль).
 *
 * ИМЕНА THREE — ТОЛЬКО ТЕ, ЧТО УЖЕ ЕСТЬ В ИГРЕ. Любое новое имя класса дописалось
 * бы в первую загрузку общим куском three (docs/prologue.md, «три имени»).
 *
 * Материалы свои у каждого ролика: их отдаёт луг (`MeadowView`), а не модуль.
 */
import * as THREE from 'three';

/** Радиус расчистки прежнего посёлка — числом: им гасилась тень облаков у домов (у ролика облаков нет). */
const CLEAR_RADIUS = 24.82;

/** Общие на всё окружение числа кадра: время, ветер, дальность травы, доля ночи. */
export interface EnvShared {
  time: { value: number };
  wind: { value: number };
  far: { value: number };
  /**
   * Насколько обесцвечены земля и растительность: ночью глаз не различает зелёного, и
   * луг под луной — серо-синий, а не изумрудный. Дома и кровли краску не теряют: на
   * серо-синей земле красная черепица и светлая штукатурка и держат ночной кадр.
   */
  night: { value: number };
  /**
   * Густота теней облаков, 0..1 (9.8): днём, не в сумерках и не на низком уровне. Облака —
   * пятна, плывущие по земле и лесу за чертой расчистки; посёлок они не темнят: дома
   * рисует тело набора, которого облака не знают, и тень, скользящая по лугу и минующая
   * дом, читалась бы ошибкой.
   */
  cloud: { value: number };
  /** Доля зимы (`SeasonVisuals.snow`): шапки снега на кронах и верхах, снег на земле. */
  snow: { value: number };
  /** Доля деревьев со второй осенней листвой (`SeasonVisuals.turn`). */
  turn: { value: number };
  /** Цвет снега — живой цвет сезона (`palette.snow`). */
  snowColor: { value: THREE.Color };
}

export const envShared = (): EnvShared => ({
  time: { value: 0 },
  wind: { value: 0 },
  far: { value: 100 },
  night: { value: 0 },
  cloud: { value: 0 },
  snow: { value: 0 },
  turn: { value: 0 },
  snowColor: { value: new THREE.Color(0xe9eef3) },
});

/** Обесцвечивание альбедо к серому той же яркости — одна строка на растения и землю. */
const NIGHT_GREY = /* glsl */ `
vec3 envNightGrey( vec3 c, float k ) {
  return mix( c, vec3( dot( c, vec3( 0.3, 0.59, 0.11 ) ) ), k );
}
`;

/**
 * Тень облака в точке земли, 0..1: крупные пятна из трёх синусов, плывущие с ветром. Без
 * текстуры — одна формула на землю (по пикселю) и растительность (по экземпляру). За
 * чертой расчистки — полная, в посёлке — нет (см. `EnvShared.cloud`).
 */
const CLOUD = /* glsl */ `
float envCloud( vec2 p, float t ) {
  float a = sin( p.x * 0.083 + t * 0.021 ) * sin( p.y * 0.071 - t * 0.017 );
  float b = sin( ( p.x + p.y ) * 0.047 + t * 0.013 + 1.7 );
  float c = 0.5 + 0.32 * a + 0.22 * b;
  return smoothstep( 0.52, 0.74, c ) * smoothstep( ${(CLEAR_RADIUS - 3).toFixed(2)}, ${(CLEAR_RADIUS + 3).toFixed(2)}, length( p ) );
}
`;

// ---------- Растительность ----------

const VEG_VERT_PARS = /* glsl */ `
uniform float uEnvTime;
uniform float uEnvWind;
uniform float uEnvSway;
uniform float uEnvFar;
uniform float uEnvShow;
uniform float uEnvCloud;
uniform float uEnvTurn;
varying vec3 vEnvData;
varying vec3 vEnvTint;
varying float vEnvShade;
varying float vEnvTurn;
${CLOUD}
`;

/** Цвет вершин — не цвет, а три числа (`env/models.ts`); цвет экземпляра — разброс или цвет цветка. */
const VEG_VERT_COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
vEnvData = color;
#ifdef USE_INSTANCING_COLOR
  vEnvTint = instanceColor;
#else
  vEnvTint = vec3( 1.0 );
#endif
`;

/**
 * Экземпляр ставится своей матрицей, потом — ветер в мировых осях (у соседних пучков
 * фаза почти одна, и по лугу идёт волна), потом покров по сезону и угасание вдаль:
 * пучок уходит в землю к своему основанию, а не исчезает гранью.
 */
const VEG_VERT_PROJECT = /* glsl */ `
#ifdef ENV_GRAZE
  // Sheep graze: the head (model x beyond the neck) dips to the grass and back, each sheep at its own time.
  vec3 envHome = vec3( 0.0 );
  #ifdef USE_INSTANCING
    envHome = instanceMatrix[ 3 ].xyz;
  #endif
  float envGz = step( 0.3, transformed.x ) * smoothstep( 0.1, 0.7, sin( uEnvTime * 0.45 + envHome.x * 1.7 + envHome.z * 2.3 ) );
  vec2 envNk = transformed.xy - vec2( 0.3, 0.42 );
  float envGc = cos( -0.8 * envGz );
  float envGs = sin( -0.8 * envGz );
  transformed.xy = vec2( 0.3, 0.42 ) + vec2( envGc * envNk.x - envGs * envNk.y, envGs * envNk.x + envGc * envNk.y );
#endif
vec4 mvPosition = vec4( transformed, 1.0 );
vec3 envBase = vec3( 0.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  envBase = instanceMatrix[ 3 ].xyz;
#endif
float envPh = uEnvTime * 1.6 + envBase.x * 0.37 + envBase.z * 0.29;
float envS = ( sin( envPh ) + 0.4 * sin( envPh * 2.3 + 1.1 ) ) * uEnvWind * uEnvSway * color.b;
mvPosition.x += envS;
mvPosition.z += envS * 0.55;
float envK = 1.0;
#ifdef ENV_SHOW
  float envLot = fract( sin( dot( envBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  envK *= step( envLot, uEnvShow );
#endif
#ifdef ENV_FADE
  envK *= 1.0 - smoothstep( uEnvFar * 0.8, uEnvFar, distance( cameraPosition, envBase ) );
#endif
mvPosition.xyz = envBase + ( mvPosition.xyz - envBase ) * envK;
vEnvShade = 1.0 - uEnvCloud * envCloud( envBase.xz, uEnvTime );
// Autumn second crown colour: only for about half of the trees, by position.
vEnvTurn = uEnvTurn * step( 0.5, fract( sin( dot( envBase.xz, vec2( 41.37, 17.91 ) ) ) * 24634.6345 ) );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const VEG_FRAG_PARS = /* glsl */ `
uniform vec3 uEnvA;
uniform vec3 uEnvB;
uniform float uEnvNight;
uniform vec3 uEnvTurnCol;
uniform float uEnvSnow;
uniform vec3 uEnvSnowCol;
varying vec3 vEnvData;
varying vec3 vEnvTint;
varying float vEnvShade;
varying float vEnvTurn;
${NIGHT_GREY}
`;

/**
 * Трава, цветы и папоротник видны с обеих сторон, и three у обратной стороны
 * переворачивает нормаль вниз — такая травинка освещена одной землёй полусферы и
 * читается на лугу тёмной звёздочкой. Нормаль покрова всегда вверх: пучок освещён как
 * земля под ним, с какой стороны на него ни смотри.
 */
const VEG_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
#ifdef ENV_UP
  normal = normalize( vNormal );
  nonPerturbedNormal = normal;
#endif
#ifdef ENV_SNOW
  // Snow caps: faces looking up take the snow colour, only on the crown/top share.
  float envUp = dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
  float envCap = uEnvSnow * smoothstep( 0.3, 0.7, envUp ) * smoothstep( 0.2, 0.6, vEnvData.g );
  diffuseColor.rgb = mix( diffuseColor.rgb, envNightGrey( uEnvSnowCol, uEnvNight ) * ( 0.9 + 0.1 * vEnvData.r ), envCap );
#endif
`;

const VEG_FRAG_COLOR = /* glsl */ `
#ifdef ENV_PETAL
  vec3 envCol = mix( uEnvA, vEnvTint, vEnvData.g );
#else
  vec3 envCol = mix( uEnvA, mix( uEnvB, uEnvTurnCol, vEnvTurn ), vEnvData.g ) * vEnvTint;
#endif
diffuseColor.rgb *= envNightGrey( envCol, uEnvNight ) * vEnvData.r * vEnvShade;
`;

export interface VegOptions {
  /** Первый цвет: ствол, стебель, камень. Живой объект сезона — материал его не копирует. */
  a: THREE.Color;
  /** Второй цвет: крона, колос, мох. */
  b: THREE.Color;
  /** Размах качания у макушки, в долях общего ветра. 0 — не качается. */
  sway: number;
  /** Грани видны с обеих сторон (трава, папоротник, лепестки). */
  twoSided?: boolean;
  /** Плоское затенение по граням (деревья, камни); без него — нормали сетки (трава). */
  flat?: boolean;
  /** Угасает вдаль (`EnvShared.far`). */
  fade?: boolean;
  /** Цвет второй части — цвет экземпляра (цветы). */
  petal?: boolean;
  /** Доля показанных экземпляров по сезону (трава зимой, цветы осенью). */
  show?: { value: number };
  /** Зимой на верхних гранях второго цвета лежит снег (кроны, камни, жерди, стога). */
  snowy?: boolean;
  /** Второй осенний цвет кроны — у половины деревьев вразнобой (`EnvShared.turn`). */
  turnTo?: THREE.Color;
  /** Пасётся: голова (модель по x дальше шеи) опускается к траве и поднимается, у каждого экземпляра в свой срок (овцы). */
  graze?: boolean;
}

export function vegMaterial(name: string, o: VegOptions, shared: EnvShared): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: o.flat ?? false });
  if (o.twoSided) mat.side = THREE.DoubleSide;
  mat.name = `env-${name}`;
  const defines: Record<string, string> = {};
  if (o.fade) defines.ENV_FADE = '';
  if (o.petal) defines.ENV_PETAL = '';
  if (o.show) defines.ENV_SHOW = '';
  // Двусторонний покров без плоского затенения держит нормаль вверх (`VEG_NORMAL`).
  if (o.twoSided && !o.flat) defines.ENV_UP = '';
  if (o.snowy) defines.ENV_SNOW = '';
  if (o.graze) defines.ENV_GRAZE = '';
  mat.defines = defines;
  const own = {
    uEnvA: { value: o.a },
    uEnvB: { value: o.b },
    uEnvSway: { value: o.sway },
    uEnvShow: o.show ?? { value: 1 },
    uEnvTime: shared.time,
    uEnvWind: shared.wind,
    uEnvFar: shared.far,
    uEnvNight: shared.night,
    uEnvCloud: shared.cloud,
    uEnvTurn: o.turnTo ? shared.turn : { value: 0 },
    uEnvTurnCol: { value: o.turnTo ?? o.b },
    uEnvSnow: shared.snow,
    uEnvSnowCol: shared.snowColor,
  };
  mat.onBeforeCompile = (shader): void => {
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VEG_VERT_PARS}`)
      .replace('#include <color_vertex>', VEG_VERT_COLOR)
      .replace('#include <project_vertex>', VEG_VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${VEG_FRAG_PARS}`)
      .replace('#include <color_fragment>', VEG_FRAG_COLOR)
      .replace('#include <normal_fragment_begin>', VEG_NORMAL);
  };
  // Правка одна на все растения; варианты различают определения, а их three и так
  // кладёт в ключ программы.
  mat.customProgramCacheKey = (): string => 'env-veg';
  return mat;
}
