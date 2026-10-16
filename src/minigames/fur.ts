/**
 * Шерсть и мех зверей промыслов: Ламберт с цветом в вершинах и тремя вставками (docs/polish.md, П-4).
 *
 *   ворс     — рельеф без текстуры: шум в осях покоя зверя гнёт нормаль (клоки руна у овцы, прядь вдоль тела у козы,
 *              коровы и оленя) и чуть темнит глубину между клоками. Шум — в осях ПОКОЯ: идущая нога несёт свой ворс
 *              с собой, а не проплывает сквозь него;
 *   свет     — обёрнутый: шерсть рассеивает свет под кожу волоса, и терминатор у неё мягкий, а не резаный, как у доски;
 *   кайма    — кончики шерсти на контуре светятся, сильнее против солнца: силуэт зверя на утреннем поле читается
 *              золотой каймой, как в кино.
 *
 * Сырость и снег — те же числа, что у копий материалов поляны (`prologue/surface`): мокрая шерсть темнеет, снег
 * ложится на спину. Белая масть (`coat` у копии, `fauna.Pack`) — та же сетка, выбеленная к кости; тёмные морда,
 * глаза и копыта остаются тёмными.
 *
 * Своих классов `three` нет: материал — Ламберт, вставки — строки шейдера. Программа одна на вид шерсти.
 */
import * as THREE from 'three';

export interface FurLook {
  /** Руно клоками (овца) или прядь вдоль тела (коза, корова, олень). */
  wool: boolean;
  /** Сколько клоков или прядей на метр. */
  grain: number;
  /** Глубина рельефа ворса, м. */
  bump: number;
  /** Насколько ворс темнит глубину: 0 — гладкая шкура. */
  depth: number;
  /** Кайма на контуре. */
  rim: number;
  /** Обёрнутый свет, 0..1. */
  wrap: number;
}

/** Числа поляны, которые шерсть только читает: сырость и снег. */
export interface FurWeather {
  wet: { value: number };
  snow: { value: number };
}

/** Руно: крупные клоки, глубокие тени между ними, мягкий свет. */
export const WOOL: FurLook = { wool: true, grain: 24, bump: 0.008, depth: 0.32, rim: 0.55, wrap: 0.5 };
/** Мех козы и оленя: прядь вдоль тела, неглубоко. */
export const HAIR: FurLook = { wool: false, grain: 70, bump: 0.004, depth: 0.16, rim: 0.4, wrap: 0.3 };
/** Короткая шерсть коровы: почти гладкая шкура. */
export const HIDE: FurLook = { wool: false, grain: 90, bump: 0.0025, depth: 0.1, rim: 0.28, wrap: 0.25 };

const VERT_HEAD = /* glsl */ `#include <common>
attribute float coat;
varying vec3 vFurP;`;

/** Белая масть: светлое — к кости, тёмное (глаза, нос, копыта) — каким было. */
const VERT_COLOR = /* glsl */ `#include <color_vertex>
vFurP = position;
#ifdef USE_COLOR
{
  float furL = dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vColor.rgb = mix( vColor.rgb, vec3( 0.86, 0.83, 0.77 ) * ( 0.55 + 0.45 * smoothstep( 0.0, 0.25, furL ) ), coat * smoothstep( 0.035, 0.075, furL ) );
}
#endif`;

const FRAG_HEAD = /* glsl */ `#include <common>
uniform float furWet;
uniform float furSnow;
varying vec3 vFurP;
float furHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float furNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( furHash( i ), furHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( furHash( i + vec3( 0, 1, 0 ) ), furHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( furHash( i + vec3( 0, 0, 1 ) ), furHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( furHash( i + vec3( 0, 1, 1 ) ), furHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
float furHeight( vec3 p ) {
#ifdef FUR_WOOL
  // Клоки: крупная кудря и мелкая поверх — руно, а не губка.
  float a = furNoise( p * FUR_GRAIN );
  float b = furNoise( p * FUR_GRAIN * 2.7 + 7.3 );
  return a * 0.65 + b * 0.35;
#else
  // Прядь: шум, вытянутый вдоль тела (ось +Z покоя), и мелкий поперёк.
  return furNoise( vec3( p.x * FUR_GRAIN, p.y * FUR_GRAIN, p.z * FUR_GRAIN * 0.16 ) ) * 0.8 + furNoise( p * FUR_GRAIN * 0.35 + 3.1 ) * 0.2;
#endif
}`;

/** Глубина ворса темнит цвет, сырость — тоже. */
const FRAG_COLOR = /* glsl */ `#include <color_fragment>
float furH = furHeight( vFurP );
diffuseColor.rgb *= 1.0 - FUR_DEPTH * ( 1.0 - furH );
diffuseColor.rgb *= 1.0 - furWet * 0.35;`;

/**
 * Рельеф ворса — производными экрана (как `bumpmap`, но без текстуры): нормаль клонится по градиенту высоты шума.
 * Вдали гаснет: клок мельче точки экрана рябит, а не читается шерстью.
 */
const FRAG_NORMAL = /* glsl */ `#include <normal_fragment_maps>
{
  float furFade = FUR_BUMP * ( 1.0 - smoothstep( 5.0, 22.0, length( vViewPosition ) ) );
  if ( furFade > 0.0 ) {
    vec3 sx = dFdx( - vViewPosition );
    vec3 sy = dFdy( - vViewPosition );
    vec2 dh = vec2( dFdx( furH ), dFdy( furH ) ) * furFade;
    vec3 r1 = cross( sy, normal );
    vec3 r2 = cross( normal, sx );
    float det = dot( sx, r1 ) * faceDirection;
    vec3 g = sign( det ) * ( dh.x * r1 + dh.y * r2 );
    normal = normalize( abs( det ) * normal - g );
  }
  // Снег — на то, что смотрит вверх, клоками по ворсу.
  vec3 furUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.89, 0.93 ), furSnow * smoothstep( 0.45, 0.85, dot( normal, furUp ) ) * ( 0.45 + 0.55 * furH ) );
}`;

/**
 * Обёрнутый свет и кайма — на месте Ламберта (`RE_Direct_Lambert`). Кусок шейдера — копией из three (r170): вставки
 * разворачиваются после `onBeforeCompile`, а брать `ShaderChunk` по имени — дописать его в первую загрузку. Что копия
 * совпадает с куском three до буквы, кроме вставки, держит тест (`fauna.test.ts`).
 */
export const LAMBERT_DIRECT = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;';
const FUR_DIRECT = /* glsl */ `float furNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( ( furNL + FUR_WRAP ) / ( 1.0 + FUR_WRAP ) );
	vec3 irradiance = dotNL * directLight.color;
	{
		float furNV = saturate( dot( geometryNormal, geometryViewDir ) );
		float furBack = saturate( dot( - geometryViewDir, directLight.direction ) );
		float furRim = pow( 1.0 - furNV, 3.0 ) * ( 0.3 + 0.7 * furBack ) * saturate( furNL + 0.65 );
		irradiance += directLight.color * furRim * FUR_RIM;
	}`;

/** Кусок `lights_lambert_pars_fragment` three r170 — как есть. */
export const LAMBERT_PARS =
  'varying vec3 vViewPosition;\nstruct LambertMaterial {\n\tvec3 diffuseColor;\n\tfloat specularStrength;\n};\nvoid RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {\n\t' +
  LAMBERT_DIRECT +
  '\n\treflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\nvoid RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {\n\treflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\n#define RE_Direct\t\t\t\tRE_Direct_Lambert\n#define RE_IndirectDiffuse\t\tRE_IndirectDiffuse_Lambert';

const FUR_PARS = LAMBERT_PARS.replace(LAMBERT_DIRECT, FUR_DIRECT);

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** Материал шерсти вида `look`; сырость и снег — числа поляны (`Surfaces.u`). Разбирает хозяин сцены. */
export function furMaterial(look: FurLook, weather: FurWeather): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = look.wool ? 'wool' : 'fur';
  mat.defines = {
    ...(look.wool ? { FUR_WOOL: '' } : {}),
    FUR_GRAIN: f(look.grain),
    FUR_BUMP: f(look.bump),
    FUR_DEPTH: f(look.depth),
    FUR_RIM: f(look.rim),
    FUR_WRAP: f(look.wrap),
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.furWet = weather.wet;
    shader.uniforms.furSnow = weather.snow;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <color_vertex>', VERT_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_HEAD)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_lambert_pars_fragment>', FUR_PARS);
  };
  const key = `fur:${look.wool ? 'w' : 'h'}:${look.grain}:${look.bump}:${look.depth}:${look.rim}:${look.wrap}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}
