/**
 * Материалы окружения: растительность, земля и пятна тени. Все — Ламберт three с
 * правкой шейдера перед сборкой (`onBeforeCompile`), как у поляны предыстории
 * (`prologue/surface.ts`): свет, туман и тени остаются общими с посёлком, а своё —
 * только ветер, два цвета и смешение земли.
 *
 * ИМЕНА THREE — ТОЛЬКО ТЕ, ЧТО УЖЕ ЕСТЬ В ИГРЕ. Любое новое имя класса дописалось бы
 * в первую загрузку общим куском three (docs/prologue.md, «три имени»); поэтому здесь
 * нет ни `ShaderMaterial`, ни `DataTexture`: шейдер правится у Ламберта, а карты земли
 * — `Texture` с `ImageData`, который three уже знает по предыстории.
 *
 * Материалы свои у каждой сцены: их отдаёт `EnvWorld.dispose`, а не модуль, — общие
 * материалы посёлка (`KIT`, `LEGACY`) проба не трогает ни на бит.
 */
import * as THREE from 'three';
import { CLEAR_RADIUS } from '../plan';

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

// ---------- Земля ----------

export interface GroundColors {
  grassDark: THREE.Color;
  grassLight: THREE.Color;
  lush: THREE.Color;
  litter: THREE.Color;
  dirt: THREE.Color;
  trample: THREE.Color;
  soil: THREE.Color;
  stone: THREE.Color;
  /** Выгон: выеденная трава. */
  graze: THREE.Color;
  /** Всходы пашни — цвет сезона, тот же, что у пучков всходов. */
  crop: THREE.Color;
}

const GROUND_VERT_PARS = /* glsl */ `
varying vec2 vEnvXZ;
`;

const GROUND_VERT = /* glsl */ `
#include <begin_vertex>
vEnvXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
`;

const GROUND_FRAG_PARS = /* glsl */ `
uniform sampler2D uGroundA;
uniform sampler2D uGroundB;
uniform sampler2D uNoise;
uniform float uMapScale;
uniform vec2 uFurrow;
uniform vec3 uGrassDark;
uniform vec3 uGrassLight;
uniform vec3 uLush;
uniform vec3 uLitter;
uniform vec3 uDirt;
uniform vec3 uTrample;
uniform vec3 uSoil;
uniform vec3 uStone;
uniform vec3 uGraze;
uniform vec3 uCrop;
uniform float uCropShow;
uniform float uEnvNight;
uniform float uEnvTime;
uniform float uEnvCloud;
uniform float uEnvSnow;
uniform vec3 uEnvSnowCol;
varying vec2 vEnvXZ;
${NIGHT_GREY}
${CLOUD}
`;

/**
 * Смешение земли. Карта (`env/rules.groundMap`) говорит, что где лежит, шум — где у
 * пятна край: край маски ломается мелким шумом, и граница травы с тропой читается
 * натоптанной, а не вырезанной циркулем. Шум — две выборки одной плитки на разных
 * масштабах: крупные пятна луга и мелкая рябь.
 */
const GROUND_FRAG_COLOR = /* glsl */ `
vec2 envUv = vEnvXZ * uMapScale + 0.5;
vec3 envA = texture2D( uGroundA, envUv ).rgb;
vec3 envB = texture2D( uGroundB, envUv ).rgb;
vec3 envN = texture2D( uNoise, vEnvXZ * 0.043 ).rgb;
vec3 envM = texture2D( uNoise, vEnvXZ * 0.19 + 0.37 ).rgb;
float envP = clamp( envN.r * 0.8 + envM.g * 0.35 - 0.08, 0.0, 1.0 );
vec3 envG = mix( uGrassDark, uGrassLight, smoothstep( 0.2, 0.8, envP ) );
envG = mix( envG, uLush, envB.g * 0.55 );
float envLit = smoothstep( 0.3, 0.7, envA.g + ( envM.r - 0.5 ) * 0.5 );
envG = mix( envG, uLitter * ( 0.82 + 0.34 * envM.b ), envLit );
float envSoil = smoothstep( 0.3, 0.72, envA.r + ( envM.b - 0.5 ) * 0.45 );
envG = mix( envG, mix( uTrample, uDirt, envN.g ) * ( 0.9 + 0.2 * envM.r ), envSoil );
float envGz = smoothstep( 0.15, 0.7, envB.b + ( envM.g - 0.5 ) * 0.3 );
envG = mix( envG, uGraze * ( 0.88 + 0.24 * envM.r ), envGz * 0.8 );
float envFld = smoothstep( 0.35, 0.6, envB.r );
// Furrows run along the strip, like the crop rows (rules.scatterCrops).
float envFur = 0.8 + 0.2 * sin( dot( vEnvXZ, vec2( -uFurrow.y, uFurrow.x ) ) * 18.0 );
// What is sown is the channel level above the mask (rules.SOWN_LEVEL): fallow ~0, spring
// crops ~0.6, winter rye 1. Rye takes the season's field colour, spring crops (and garden
// beds) are the season's meadow green with a touch of it, like the crop tufts (env/index);
// the canopy follows the season (SEASON_CROP) in rows.
float envSow = clamp( ( envB.r - 0.6 ) / 0.4, 0.0, 1.0 );
vec3 envCropC = mix( mix( uLush, uCrop, 0.3 ), uCrop, smoothstep( 0.75, 0.95, envSow ) );
float envRows = uCropShow * smoothstep( 0.3, 0.55, envSow ) * ( 0.55 + 0.45 * smoothstep( 0.7, 0.95, envFur ) );
vec3 envPl = mix( uSoil * envFur, envCropC * ( 0.9 + 0.12 * envFur ), envRows );
// Fallow rests a year: half overgrown, the sward shows through the old furrows.
envPl = mix( envPl, envG, ( 1.0 - smoothstep( 0.05, 0.25, envSow ) ) * 0.5 );
envG = mix( envG, envPl, envFld );
float envSt = smoothstep( 0.35, 0.65, envA.b + ( envM.g - 0.5 ) * 0.5 );
envG = mix( envG, uStone * ( 0.76 + 0.38 * envM.r ), envSt );
// Snow: patches by noise; paths, stones and litter under canopy keep less of it.
float envSnow = uEnvSnow * smoothstep( 0.18, 0.5, 0.95 - envSoil * 0.55 - envSt * 0.4 - envLit * 0.25 + ( envN.r - 0.5 ) * 0.6 + ( envM.g - 0.5 ) * 0.25 );
envG = mix( envG, uEnvSnowCol * ( 0.9 + 0.1 * envM.r ), envSnow );
diffuseColor.rgb *= envNightGrey( envG, uEnvNight ) * ( 1.0 - uEnvCloud * envCloud( vEnvXZ, uEnvTime ) );
`;

export interface GroundMaps {
  a: THREE.Texture;
  b: THREE.Texture;
  noise: THREE.Texture;
  /** 1 / ширина карты в единицах мира. */
  scale: number;
  furrow: THREE.Vector2;
}

/** `cropShow` — доля всходов сезона (`SEASON_CROP`), общая с пучками всходов. */
export function groundMaterial(maps: GroundMaps, c: GroundColors, shared: EnvShared, cropShow: { value: number }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  mat.name = 'env-ground';
  const own = {
    uGroundA: { value: maps.a },
    uGroundB: { value: maps.b },
    uNoise: { value: maps.noise },
    uMapScale: { value: maps.scale },
    uFurrow: { value: maps.furrow },
    uGrassDark: { value: c.grassDark },
    uGrassLight: { value: c.grassLight },
    uLush: { value: c.lush },
    uLitter: { value: c.litter },
    uDirt: { value: c.dirt },
    uTrample: { value: c.trample },
    uSoil: { value: c.soil },
    uStone: { value: c.stone },
    uGraze: { value: c.graze },
    uCrop: { value: c.crop },
    uCropShow: cropShow,
    uEnvNight: shared.night,
    uEnvTime: shared.time,
    uEnvCloud: shared.cloud,
    uEnvSnow: shared.snow,
    uEnvSnowCol: shared.snowColor,
  };
  mat.onBeforeCompile = (shader): void => {
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GROUND_VERT_PARS}`)
      .replace('#include <begin_vertex>', GROUND_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_FRAG_PARS}`)
      .replace('#include <color_fragment>', GROUND_FRAG_COLOR);
  };
  mat.customProgramCacheKey = (): string => 'env-ground';
  return mat;
}

// ---------- Пятна тени ----------

export interface ShadeUniforms {
  /** Направление от солнца по земле, единичное. */
  away: { value: THREE.Vector2 };
  /** Во сколько раз пятно вытянуто от солнца. */
  stretch: { value: number };
  /** Насколько центр пятна отнесён от основания, в радиусах. */
  shift: { value: number };
  /** Густота пятна: днём полная, под луной — слабее. */
  dark: { value: number };
}

const SHADE_VERT_PARS = /* glsl */ `
uniform vec2 uEnvAway;
uniform float uEnvStretch;
uniform float uEnvShift;
varying vec2 vEnvQ;
`;

/**
 * Пятно лежит у основания экземпляра, радиус — масштаб экземпляра. Вытягивается от
 * солнца и отъезжает от основания: низкое солнце — длинная тень, как у зданий.
 */
const SHADE_VERT_PROJECT = /* glsl */ `
vec3 envBase = vec3( 0.0 );
float envR = 1.0;
#ifdef USE_INSTANCING
  envBase = instanceMatrix[ 3 ].xyz;
  envR = length( instanceMatrix[ 0 ].xyz );
#endif
vec2 envP = position.xz;
float envAl = dot( envP, uEnvAway );
vec2 envQ = envP - envAl * uEnvAway + uEnvAway * envAl * uEnvStretch;
vec3 envW = envBase + vec3( envQ.x, 0.0, envQ.y ) * envR + vec3( uEnvAway.x, 0.0, uEnvAway.y ) * envR * uEnvShift;
envW.y = envBase.y + 0.04;
vEnvQ = envP;
vec4 mvPosition = modelViewMatrix * vec4( envW, 1.0 );
gl_Position = projectionMatrix * mvPosition;
`;

const SHADE_FRAG_PARS = /* glsl */ `
uniform float uEnvDark;
uniform vec3 uEnvShade;
varying vec2 vEnvQ;
`;

const SHADE_FRAG_COLOR = /* glsl */ `
float envA = ( 1.0 - smoothstep( 0.3, 1.0, length( vEnvQ ) ) ) * uEnvDark;
diffuseColor.rgb = mix( vec3( 1.0 ), uEnvShade, envA );
`;

/**
 * Пятна тени под деревьями и мелочью. Окружение теней от лампы не отбрасывает — лес
 * стоит за коробкой теней (docs/handbook/graphics.md), — и без пятен деревья висели бы
 * над землёй. Честное умножение того, что уже нарисовано, как пятно под зданием
 * (`materials.SHADE`): на траве, на снегу и на тропе — одно правило.
 */
export function shadeMaterial(shade: THREE.Color, u: ShadeUniforms): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    blending: THREE.MultiplyBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.name = 'env-shade';
  const own = {
    uEnvAway: u.away,
    uEnvStretch: u.stretch,
    uEnvShift: u.shift,
    uEnvDark: u.dark,
    uEnvShade: { value: shade },
  };
  mat.onBeforeCompile = (shader): void => {
    Object.assign(shader.uniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHADE_VERT_PARS}`)
      .replace('#include <project_vertex>', SHADE_VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SHADE_FRAG_PARS}`)
      .replace('#include <color_fragment>', SHADE_FRAG_COLOR);
  };
  mat.customProgramCacheKey = (): string => 'env-shade';
  return mat;
}
