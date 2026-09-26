/**
 * Материалы поляны с текстурами: кора, хвоя, снег, земля и мох, камень, дерево.
 *
 * ЭТО ТЕ ЖЕ КОПИИ МАТЕРИАЛОВ, ЧТО В `surface.ts`, А НЕ НОВЫЙ КЛАСС. Под именем у
 * копии — Ламберт деревни, а в его шейдер вставлены три вещи: текстуры в мировых
 * координатах (триплановая проекция — у склеенных мешей набора нет развёртки, и
 * заводить её значило бы трогать форму деревьев, а она — пачка 3), нормаль из
 * текстуры и блик по GGX с шероховатостью из текстуры. Класс three по имени не
 * прибавляется ни один: `MeshStandardMaterial` деревня не берёт, и его имя
 * дописалось бы в первую загрузку (docs/prologue.md, раздел 10). Поэтому свет —
 * своими функциями вместо Ламбертовых, по тем же входам, что даёт риг.
 *
 * ЦВЕТ — ДВУМЯ СПОСОБАМИ, И ВЫБОР ЗАПИСАН У КАЖДОГО МАТЕРИАЛА (`LOOKS`).
 *   photo  цвет — сама текстура: снег, кора сосны, камень. Цвет вершин несёт только
 *          затенение у земли и разброс яркости;
 *   tint   цвет — свой (палитры или `base`), текстура даёт ему рисунок: отношение
 *          текстуры к её же среднему (последний мип). Так крона остаётся еловой, а
 *          не бурой, как опавшая хвоя, с которой снят рисунок, а берёза — белой.
 *
 * СНЕГ — ПОЛОВИНА КАДРА, И ОН СВОЙ (`ground`). Земля поляны — ровный снег (`snow`),
 * тропы от огня к палатке, дому и колоде — снег со следами (`trail`), у огня —
 * утоптанный до земли (`trod`), под елями поляны, где снега мало, — подстилка и мох
 * (`litter`). Где что — по месту в мире (`glade.ts`), а не по развёртке: тропа там,
 * где ходят. На солнце снег блестит зерном — редкие точки с почти зеркальной
 * гранью, каждая под своим углом (`PRO_GLINT`), — а в тени синеет сам.
 */
import * as THREE from 'three';
import { AXE_STUMP, FIRE, HOUSE, TENT, TREES } from './glade';
import type { SetName, Textures } from './textures';

/** Как выглядит материал: какой набор, как ложится цвет, есть ли снег сверху. */
export interface Look {
  set: SetName;
  /** Триплановая проекция (три выборки) или только сверху (земля). */
  tri: boolean;
  /** Цвет — сама текстура (`photo`) или свой цвет с рисунком текстуры (`tint`). */
  photo: boolean;
  /** Множитель цвета текстуры в `photo`: свет альбедо, а не рисунка. */
  gain: number;
  /** Глубина рельефа из нормали: 1 — как снята. */
  bump: number;
  /** Множитель шероховатости из текстуры. */
  rough: number;
  /** Метров на образец, если не по описи набора. */
  meters?: number;
  /** Свой цвет вместо цвета материала (`tint`): крона зимой — хвоя, а не палитра деревни. */
  base?: number;
  /** Ложится ли на верхние грани снег (набор `snow`). */
  cap: boolean;
  /**
   * Сколько цвета текстуры идёт в рисунок у `tint`: 0 — только светлее-темнее, 1 — и
   * оттенки. У золы и берёзы оттенков из чужой текстуры быть не должно: мох подстилки
   * зеленил бы золу, ржавчина сосновой коры рыжила бы берёзу.
   */
  chroma?: number;
  /** Земля поляны: снег, тропы, утоптанное у огня и подстилка под елями. */
  ground?: boolean;
}

/**
 * Хвоя ели зимой — тёмная, с холодным отливом; вторая крона чуть светлее и синее,
 * чтобы соседние ели не сливались в одно пятно. Дуб держит сухой лист всю зиму —
 * бурый. Цвета sRGB, как в палитре.
 */
const SPRUCE = 0x2e3d2c;
const SPRUCE_2 = 0x344536;
const OAK_DRY = 0x5b4632;
/**
 * Зола в очаге — серо-чёрная; шкура палатки — выделанная, бурая. У деревни зимой обе
 * белые (`SEASON_OVERRIDES`: на крышах и в золе посёлка лежит снег), а на поляне снег
 * ложится поверх них сам (`PRO_CAP`) — только на то, что смотрит вверх.
 */
const ASH = 0x3b3835;
const HIDE = 0x8a6644;

/** Снег Poly Haven снят серее, чем лежит на поляне: альбедо свежего снега — к девяти десятым. */
export const SNOW_GAIN = 1.3;

/**
 * Таблица материалов по имени исходного (`MATERIAL_KEYS` деревни и два своих — `PRO_MATS`).
 * Имени нет в таблице — материал остаётся прежней копией без текстур (шкура палатки,
 * трава, звери, люди).
 */
export const LOOKS: Readonly<Record<string, Look>> = {
  grass: { set: 'snow', tri: false, photo: true, gain: SNOW_GAIN, bump: 1, rough: 1, cap: false, ground: true },
  trample: { set: 'litter', tri: false, photo: false, gain: 1, bump: 0.8, rough: 1, base: ASH, cap: false, chroma: 0 },
  hide: { set: 'litter', tri: true, photo: false, gain: 1, bump: 0.3, rough: 1.1, meters: 1.5, base: HIDE, cap: true, chroma: 0 },
  trunk: { set: 'bark', tri: true, photo: true, gain: 1, bump: 1, rough: 1, cap: true },
  leaves: { set: 'needles', tri: true, photo: false, gain: 1, bump: 1.3, rough: 1.1, meters: 0.7, base: SPRUCE, cap: true },
  leaves2: { set: 'needles', tri: true, photo: false, gain: 1, bump: 1.3, rough: 1.1, meters: 0.7, base: SPRUCE_2, cap: true },
  bush: { set: 'needles', tri: true, photo: false, gain: 1, bump: 1.2, rough: 1.1, meters: 0.6, base: OAK_DRY, cap: true },
  rock: { set: 'rock', tri: true, photo: true, gain: 1, bump: 1, rough: 1, cap: true },
  body: { set: 'bark', tri: true, photo: false, gain: 1, bump: 0.6, rough: 1, cap: true },
  proStone: { set: 'rock', tri: true, photo: true, gain: 1, bump: 1, rough: 1, meters: 0.6, cap: true },
  proWood: { set: 'logs', tri: true, photo: false, gain: 1, bump: 0.8, rough: 1, meters: 0.9, cap: true, chroma: 0.5 },
};

/**
 * Свои материалы моделей поляны: камень и дерево. В наборе деревни камень очага,
 * жерди палатки и доски сруба — одно «тело» с цветом в вершинах (`KIT.body`), и
 * отличить камень от бревна шейдеру было бы не по чему. У поляны это два своих
 * материала: склейка набора кладёт их в свои группы, как любой другой, — два вызова
 * отрисовки сверх прежнего, — а копии узнают их по имени. Белые множители, цвет —
 * в вершинах, как у `KIT.body`.
 */
export const PRO_MATS = {
  stone: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true, name: 'proStone' }),
  wood: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true, name: 'proWood' }),
};

/** Сколько троп и сколько елей знает земля: шейдер держит их массивами. */
const PATHS = 3;
const TRUNKS = TREES.length;

/**
 * Тропы — от огня к палатке, дому и колоде: там ходят каждый заход. Ширина тропы и
 * пятно у огня — в шейдере (`PBR_SURFACE`); ели поляны — пятно подстилки под кроной.
 *
 * Массивы — плоскими числами, а не векторами: `Vector4` деревня у three не берёт, и
 * его имя дописалось бы в первую загрузку. Шейдеру всё равно — массив `vec4` three
 * заливает из плоского.
 */
function pathUniform(): Float32Array {
  return new Float32Array([TENT, HOUSE, AXE_STUMP].flatMap((p) => [FIRE.x, FIRE.z, p.x, p.z]));
}
/** Ель поляны: место и радиус пятна подстилки, метров. */
const LITTER_R = 1.3;
function trunkUniform(): Float32Array {
  return new Float32Array(TREES.flatMap((t) => [t.x, t.z, LITTER_R]));
}

// ---------- Шейдер ----------

export const PBR_VERT_HEAD = /* glsl */ `
#ifdef PRO_PBR
varying vec3 proWPos;
varying vec3 proWNrm;
#endif`;

export const PBR_VERT_BODY = /* glsl */ `
#ifdef PRO_PBR
proWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
proWNrm = normalize( mat3( modelMatrix ) * objectNormal );
#endif`;

/**
 * Объявления фрагмента: выборки, свет по GGX и глобальные величины, которые считает
 * вставка поверхности, а читает свет (`proRough`, блеск зерна).
 */
export const PBR_FRAG_HEAD = /* glsl */ `
#ifdef PRO_PBR
varying vec3 proWPos;
varying vec3 proWNrm;
uniform sampler2D proC;
uniform sampler2D proD;
uniform float proTexOn;
uniform float proScale;
uniform float proBump;
uniform float proGain;
uniform float proRoughK;
uniform vec3 proBase;
uniform float proBaseK;
uniform float proChroma;
#if defined( PRO_CAP ) || defined( PRO_GROUND )
uniform sampler2D proSC;
uniform sampler2D proSD;
uniform float proSScale;
#endif
#ifdef PRO_GROUND
uniform sampler2D proTC;
uniform sampler2D proTD;
uniform sampler2D proRC;
uniform sampler2D proRD;
uniform sampler2D proLC;
uniform sampler2D proLD;
uniform float proLScale;
uniform vec4 proPaths[ PRO_PATHS ];
uniform vec3 proTrunks[ PRO_TRUNKS ];
uniform vec2 proFire;
#endif
float proRough = 0.85;
float proGlint = 0.0;
float proSnowy = 0.0;
vec3 proGlintN = vec3( 0.0, 1.0, 0.0 );
float proHash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
vec3 proHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
// Нормаль из карты в мировые оси вдоль проекции: смесь «белого»/UDN (Golus, 2017).
vec2 proTan( vec3 d, float s ) { vec2 t = ( d.xy * 2.0 - 1.0 ) * proBump; t.x *= s; return t; }
#endif`;

/**
 * Свет: Ламберт для рассеянного и GGX для блика (Смит, Шлик), и блеск зерна снега.
 * Входы — те же, что даёт риг Ламберту; структура та же, с шероховатостью сверху.
 */
export const PBR_LIGHT_PARS = /* glsl */ `
#ifdef PRO_PBR
varying vec3 vViewPosition;
struct LambertMaterial {
  vec3 diffuseColor;
  float specularStrength;
  float roughness;
};
float proGgxD( float a2, float nh ) { float d = nh * nh * ( a2 - 1.0 ) + 1.0; return a2 / ( PI * d * d ); }
float proGgxV( float a2, float nl, float nv ) {
  float gv = nl * sqrt( nv * nv * ( 1.0 - a2 ) + a2 );
  float gl = nv * sqrt( nl * nl * ( 1.0 - a2 ) + a2 );
  return 0.5 / max( gv + gl, 1e-5 );
}
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float nl = saturate( dot( geometryNormal, directLight.direction ) );
  vec3 irradiance = nl * directLight.color;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  // Без текстур (не приехали — или стенд меряет их цену, AB=1) блика нет: копия рисуется
  // прежним Ламбертом палитры.
  if ( proTexOn < 0.5 ) return;
  vec3 h = normalize( directLight.direction + geometryViewDir );
  float nh = saturate( dot( geometryNormal, h ) );
  float nv = saturate( dot( geometryNormal, geometryViewDir ) ) + 1e-4;
  float vh = saturate( dot( geometryViewDir, h ) );
  float a = material.roughness * material.roughness;
  float a2 = a * a;
  float f = PRO_F0 + ( 1.0 - PRO_F0 ) * pow( 1.0 - vh, 5.0 );
  reflectedLight.directSpecular += irradiance * f * proGgxD( a2, nh ) * proGgxV( a2, nl, nv );
  // Блеск зерна: грань льдинки почти зеркальна и повёрнута по-своему — вспыхивает
  // только там, где она ровно между солнцем и глазом. Тень гасит её вместе со светом.
  if ( proGlint > 0.0 ) {
    float g = pow( saturate( dot( proGlintN, h ) ), PRO_GLINT_POW );
    reflectedLight.directSpecular += directLight.color * ( g * proGlint * PRO_GLINT_GAIN * step( 0.02, nl ) );
  }
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  // Снег в тени синее неба над ним: свет входит в зерно и выходит холоднее.
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor ) * mix( vec3( 1.0 ), PRO_SNOW_BLUE, proSnowy );
}
#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
#else
#include <lights_lambert_pars_fragment>
#endif`;

export const PBR_LIGHT_BODY = /* glsl */ `#include <lights_lambert_fragment>
#ifdef PRO_PBR
material.roughness = proRough;
#endif`;

/**
 * Блик неба: отражение полусферы рига — небо сверху, снег снизу — по шероховатости
 * (приближение Карриса к интегралу GGX). Без него гладкое было бы матовым везде,
 * кроме пятна от солнца.
 */
export const PBR_OUT = /* glsl */ `vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
#ifdef PRO_PBR
if ( proTexOn > 0.5 ) {
  vec3 proVd = normalize( vViewPosition );
  float proNv = saturate( dot( normal, proVd ) );
  vec3 proR = ( vec4( reflect( -proVd, normal ), 0.0 ) * viewMatrix ).xyz;
  vec3 proEnv = vec3( 0.0 );
#if NUM_HEMI_LIGHTS > 0
  proEnv = mix( hemisphereLights[ 0 ].groundColor, hemisphereLights[ 0 ].skyColor, proR.y * 0.5 + 0.5 ) * RECIPROCAL_PI;
#endif
  vec4 proR4 = proRough * vec4( -1.0, -0.0275, -0.572, 0.022 ) + vec4( 1.0, 0.0425, 1.04, -0.04 );
  float proA = min( proR4.x * proR4.x, exp2( -9.28 * proNv ) ) * proR4.x + proR4.y;
  vec2 proAB = vec2( -1.04, 1.04 ) * proA + proR4.zw;
  outgoingLight += reflectedLight.directSpecular + proEnv * ( PRO_F0 * proAB.x + proAB.y );
}
#endif`;

/**
 * Поверхность: цвет, нормаль и шероховатость из текстур, снег на верхних гранях,
 * сырость. Вставлено там же, где прежде стояли снег и сырость Ламберта, — после
 * нормали и до света, — и заменяет их, когда у материала есть набор.
 */
export const PBR_SURFACE = /* glsl */ `
#ifdef PRO_PBR
if ( proTexOn > 0.5 ) {
  vec3 wn = normalize( proWNrm );
  vec3 wp = proWPos;
#ifdef USE_COLOR
  vec3 vc = vColor.rgb;
#else
  vec3 vc = vec3( 1.0 );
#endif
  vec3 alb;
  vec3 nW;
  float rough;
#ifdef PRO_GROUND
  {
    vec2 xz = wp.xz;
    // Рисунок пятен — сам снег в крупном масштабе: края троп и пятен не циркульные.
    float br = texture2D( proSC, xz * proSScale * 0.21 + 0.37 ).g * 2.0 - 1.0;
    float dFire = length( xz - proFire );
    float path = 1.0 - smoothstep( 3.0, 5.2, dFire + br * 0.9 );
    for ( int i = 0; i < PRO_PATHS; i++ ) {
      vec4 s = proPaths[ i ];
      vec2 ab = s.zw - s.xy;
      float t = clamp( dot( xz - s.xy, ab ) / dot( ab, ab ), 0.0, 1.0 );
      float d = length( xz - s.xy - ab * t );
      path = max( path, 1.0 - smoothstep( 0.4, 0.95, d + br * 0.3 ) );
    }
    float trod = 1.0 - smoothstep( 1.2, 2.0, dFire + br * 0.5 );
    float litter = 0.0;
    for ( int i = 0; i < PRO_TRUNKS; i++ ) {
      vec3 t = proTrunks[ i ];
      litter = max( litter, 1.0 - smoothstep( t.z * 0.35, t.z, length( xz - t.xy ) + br * 0.35 ) );
    }
    vec2 us = xz * proSScale;
    vec3 c = texture2D( proSC, us ).rgb * PRO_SNOW_GAIN;
    vec3 d = texture2D( proSD, us ).rgb;
    float snowy = 1.0;
    if ( path > 0.004 ) {
      vec3 c2 = texture2D( proTC, us ).rgb * PRO_SNOW_GAIN;
      vec3 d2 = texture2D( proTD, us ).rgb;
      c = mix( c, c2, path );
      d = mix( d, d2, path );
    }
    if ( trod > 0.004 ) {
      // Утоптанный снег у огня — плотный и серый, с землёй в следах, а не грязь: цвета
      // у него половина, рельеф весь.
      vec3 c3 = texture2D( proRC, us ).rgb * 1.2;
      vec3 d3 = texture2D( proRD, us ).rgb;
      c = mix( c, c3, trod * 0.35 );
      d = mix( d, d3, trod );
      snowy -= trod * 0.4;
    }
    if ( litter > 0.004 ) {
      vec2 ul = xz * proLScale;
      vec3 c4 = texture2D( proLC, ul ).rgb;
      vec3 d4 = texture2D( proLD, ul ).rgb;
      // Под елью снег лежит пятнами: подстилка проглядывает там, где рельеф выше.
      float k = litter * smoothstep( 0.4, 0.7, d4.x * 0.5 + 0.5 - ( 1.0 - litter ) * 0.6 + br * 0.3 );
      c = mix( c, c4 * 0.85, k * 0.85 );
      d = mix( d, d4, k );
      snowy -= k;
    }
    // Крупные наметы: та же нормаль снега в масштабе вдесятеро крупнее.
    vec3 dm = texture2D( proSD, xz * proSScale * 0.11 ).rgb;
    vec2 t = proTan( d, 1.0 ) + ( dm.xy * 2.0 - 1.0 ) * 0.35;
    nW = normalize( vec3( t.x + wn.x, wn.y, t.y + wn.z ) );
    alb = c * mix( 1.0, dot( vc, vec3( 0.333 ) ), 0.5 );
    rough = d.z;
    proSnowy = clamp( snowy, 0.0, 1.0 );
    proGlint = proSnowy;
  }
#else
  vec3 p = wp * proScale;
  vec3 sg = vec3( wn.x >= 0.0 ? 1.0 : -1.0, wn.y >= 0.0 ? 1.0 : -1.0, wn.z >= 0.0 ? 1.0 : -1.0 );
#ifdef PRO_TRI
  vec3 w = pow( abs( wn ), vec3( 4.0 ) );
  w /= w.x + w.y + w.z;
  vec2 ux = vec2( -sg.x * p.z, p.y );
  vec2 uy = vec2( -sg.y * p.x, p.z );
  vec2 uz = vec2( sg.z * p.x, p.y );
  vec3 c = texture2D( proC, ux ).rgb * w.x + texture2D( proC, uy ).rgb * w.y + texture2D( proC, uz ).rgb * w.z;
  vec3 dx = texture2D( proD, ux ).rgb;
  vec3 dy = texture2D( proD, uy ).rgb;
  vec3 dz = texture2D( proD, uz ).rgb;
  vec2 tx = proTan( dx, -sg.x );
  vec2 ty = proTan( dy, -sg.y );
  vec2 tz = proTan( dz, sg.z );
  vec3 nx = vec3( tx + wn.zy, wn.x );
  vec3 ny = vec3( ty + wn.xz, wn.y );
  vec3 nz = vec3( tz + wn.xy, wn.z );
  nW = normalize( nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z );
  rough = dx.z * w.x + dy.z * w.y + dz.z * w.z;
  vec3 avg = textureLod( proC, uy, 12.0 ).rgb;
#else
  vec2 uy = p.xz;
  vec3 c = texture2D( proC, uy ).rgb;
  vec3 d = texture2D( proD, uy ).rgb;
  vec2 t = proTan( d, 1.0 );
  nW = normalize( vec3( t.x + wn.x, wn.y, t.y + wn.z ) );
  rough = d.z;
  vec3 avg = textureLod( proC, uy, 12.0 ).rgb;
#endif
#ifdef PRO_PHOTO
  alb = c * proGain * vc;
#else
  vec3 base = mix( diffuseColor.rgb, proBase * vc, proBaseK );
  vec3 ratio = clamp( c / max( avg, vec3( 0.02 ) ), 0.0, 3.0 );
  float lr = clamp( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( avg, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.02 ), 0.0, 3.0 );
  alb = base * mix( vec3( lr ), ratio, proChroma );
#endif
#ifdef PRO_CAP
  {
    // Снег ложится на то, что смотрит вверх, и раньше — на выступы рельефа: край
    // снега идёт по рисунку коры и хвои, а не ровной линией по высоте.
    // Снега больше — он ложится шире, а не гуще: край снега остаётся краем, белым по
    // тёмному, а не серой вуалью по всей кроне.
    float bump = dot( c, vec3( 0.333 ) ) / max( dot( avg, vec3( 0.333 ) ), 0.02 ) - 1.0;
    float cover = proSnow * proSnowK;
    float edge = 0.84 - cover * 0.55;
    float cap = step( 0.02, cover ) * smoothstep( edge, edge + 0.12, nW.y + bump * PRO_CAP_BREAK );
    if ( cap > 0.003 ) {
      vec2 us = wp.xz * proSScale;
      vec3 sc = texture2D( proSC, us ).rgb * PRO_SNOW_GAIN;
      vec3 sd = texture2D( proSD, us ).rgb;
      vec2 ts = ( sd.xy * 2.0 - 1.0 ) * 0.7;
      vec3 ns = normalize( vec3( ts.x + wn.x, max( wn.y, 0.2 ), ts.y + wn.z ) );
      alb = mix( alb, sc, cap );
      nW = normalize( mix( nW, ns, cap ) );
      rough = mix( rough, sd.z, cap );
      proSnowy = cap;
      proGlint = cap;
    }
  }
#endif
#endif
  float damp = proWet * proWetK;
  alb *= vec3( 1.0 - damp, 1.0 - damp * 0.92, 1.0 - damp * 0.78 );
  rough *= 1.0 - 0.45 * damp;
  diffuseColor.rgb = alb;
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
  proRough = clamp( rough * proRoughK, 0.08, 1.0 );
  if ( proGlint > 0.0 ) {
    // Зерно — ячейка в сантиметр с лишним; вспыхивает каждая восьмая, и только
    // вблизи: дальше ячейка меньше точки экрана, и блеск рябил бы, а не искрился.
    vec3 cell = floor( wp * PRO_GLINT_CELLS );
    vec3 r3 = proHash3( cell ) * 2.0 - 1.0;
    float on = step( 0.875, proHash( cell + 17.0 ) );
    float far = 1.0 - smoothstep( 5.0, 11.0, length( vViewPosition ) );
    proGlint *= on * far * ( 1.0 - damp );
    proGlintN = normalize( ( viewMatrix * vec4( normalize( nW * 1.6 + r3 ), 0.0 ) ).xyz );
  }
} else {
#endif
{
  float proUp = dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
  float proDamp = proWet * proWetK;
  diffuseColor.rgb *= vec3( 1.0 - proDamp, 1.0 - proDamp * 0.92, 1.0 - proDamp * 0.78 );
  diffuseColor.rgb = mix( diffuseColor.rgb, proSnowColor, proSnow * proSnowK * smoothstep( 0.22, 0.68, proUp ) );
}
#ifdef PRO_PBR
}
#endif`;

/**
 * Числа шейдера, общие на все материалы. Подобраны снимками кадра-мерила, кроме
 * `PRO_F0`: у снега, льда, коры и камня френелевский отражатель при взгляде в лоб —
 * от двух до четырёх сотых.
 */
const DEFINES = {
  PRO_F0: '0.03',
  PRO_SNOW_GAIN: SNOW_GAIN.toFixed(2),
  PRO_SNOW_BLUE: 'vec3( 0.9, 0.97, 1.1 )',
  PRO_GLINT_CELLS: '70.0',
  PRO_GLINT_POW: '1600.0',
  PRO_GLINT_GAIN: '60.0',
  PRO_CAP_BREAK: '0.6',
  PRO_PATHS: PATHS,
  PRO_TRUNKS: TRUNKS,
};

/** Всё, что вставка ждёт от сцены: текстуры и общий выключатель. */
export interface PbrShared {
  texOn: { value: number };
  tex: Textures;
}

/**
 * Дописать материалу текстуры: определения шейдера и свои числа. Зовётся копией
 * (`surface.ts`) до первой компиляции; шейдер собирает её `onBeforeCompile`.
 */
export function pbrOf(
  mat: THREE.MeshLambertMaterial,
  look: Look,
  shared: PbrShared,
  meters: (set: SetName) => number,
): Record<string, THREE.IUniform> {
  mat.flatShading = false;
  const defs = (mat.defines ??= {}) as Record<string, string | number>;
  Object.assign(defs, DEFINES, { PRO_PBR: '' });
  if (look.tri) defs.PRO_TRI = '';
  if (look.photo) defs.PRO_PHOTO = '';
  if (look.cap) defs.PRO_CAP = '';
  if (look.ground) defs.PRO_GROUND = '';
  const main = shared.tex.get(look.set);
  const snow = shared.tex.get('snow');
  const u: Record<string, THREE.IUniform> = {
    proC: { value: main.color },
    proD: { value: main.data },
    proTexOn: shared.texOn,
    proScale: { value: 1 / (look.meters ?? meters(look.set)) },
    proBump: { value: look.bump },
    proGain: { value: look.gain },
    proRoughK: { value: look.rough },
    proBase: { value: new THREE.Color(look.base ?? 0xffffff) },
    proBaseK: { value: look.base === undefined ? 0 : 1 },
    proChroma: { value: look.chroma ?? 0 },
    proSC: { value: snow.color },
    proSD: { value: snow.data },
    proSScale: { value: 1 / meters('snow') },
  };
  if (look.ground) {
    const trail = shared.tex.get('trail');
    const trod = shared.tex.get('trod');
    const litter = shared.tex.get('litter');
    Object.assign(u, {
      proTC: { value: trail.color },
      proTD: { value: trail.data },
      proRC: { value: trod.color },
      proRD: { value: trod.data },
      proLC: { value: litter.color },
      proLD: { value: litter.data },
      proLScale: { value: 1 / meters('litter') },
      proPaths: { value: pathUniform() },
      proTrunks: { value: trunkUniform() },
      proFire: { value: new THREE.Vector2(FIRE.x, FIRE.z) },
    });
  }
  return u;
}
