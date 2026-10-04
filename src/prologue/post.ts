/**
 * Кадр поляны после сцены: цели, проходы и итог на экран.
 *
 * ПОЛЯНА РИСУЕТСЯ НЕ В КАНВУ, А В ЦЕЛЬ ПОЛОВИННОЙ ТОЧНОСТИ, И ВСЁ ОСТАЛЬНОЕ СЧИТАЕТСЯ
 * ИЗ НЕЁ. Свет ярче белого — солнце, огонь, искры, небо у светила — остаётся в цели
 * светом, а не обрезается до единицы; из него растёт свечение, а тонирование ACES
 * сжимает его в экран последним проходом. Глубина той же цели — это и дымка у земли, и
 * затенение складок, и лучи сквозь кроны, и глубина резкости: все четыре читают одну
 * текстуру глубины, второго прохода по сцене нет ни у одного.
 *
 * Проходы по ступеням (`look.Tier`):
 *
 *   full  сцена (4 выборки) → затенение складок (½) и два прохода размытия →
 *         лучи (¼) → свечение: отбор (½) и пять ступеней вниз и вверх →
 *         глубина резкости (½) → итог;
 *   lite  сцена (без выборок) → лучи (¼, короче) → свечение: отбор (¼) и три
 *         ступени → итог со сглаживанием проходом (FXAA);
 *   base  сцена прямо в канву: прежний кадр, тонирование — в материалах.
 *
 * ИМЕНА THREE БЕРУТСЯ СКУПО, И ЭТО ПРО ПЕРВУЮ ЗАГРУЗКУ. Всякое имя, которое деревня из
 * общего чанка `three` не берёт, а предыстория взяла, дописывается в его экспорт — то
 * есть в первую загрузку (docs/prologue.md, раздел 10). Поэтому константы здесь —
 * числа (их значения держит тест), камеры для полноэкранного прохода нет вовсе (вершины
 * пишутся сразу в пространство экрана), а по имени взяты три класса, без которых
 * постобработки не бывает: цель, текстура глубины и материал со своим шейдером. Их код
 * в общем чанке и так лежит — им пользуется сам рендерер; прибавляются три имени.
 */
import * as THREE from 'three';
import type { Mist, Tier } from './look';

/** `THREE.HalfFloatType`: число, а не имя (первая загрузка). Значение держит тест. */
export const HALF_FLOAT = 1016;
/** `THREE.UnsignedByteType`. */
export const UNSIGNED_BYTE = 1009;
/** `THREE.ACESFilmicToneMapping`. */
export const ACES = 4;

/**
 * Сколько выборок сглаживания у сцены на полной ступени.
 *
 * Четыре — до двух миллионов точек экрана; дальше две: цель половинной точности с
 * четырьмя выборками на мониторе 2560×1440 — это двести мегабайт одних буферов.
 */
const SAMPLES = 4;
const SAMPLES_BIG = 2;
const BIG_PX = 2.2e6;

/** Сколько ступеней вниз у свечения. Больше — шире ореол; каждая вчетверо дешевле прошлой. */
const BLOOM_LEVELS: Record<Tier, number> = { full: 5, lite: 3, base: 0 };
/** Лучи: сколько шагов к солнцу на точку. На четверти экрана — дёшево и там, и там. */
const SHAFT_STEPS: Record<Tier, number> = { full: 48, lite: 24, base: 0 };

/** Что конвейеру нужно от сцены каждый кадр, кроме самой сцены и камеры. */
export interface Light {
  /** Куда светит солнце (от земли к светилу), мир, единичный. */
  sunDir: THREE.Vector3;
  /** Свет солнца — цвет, умноженный на силу; ночью это луна. */
  sun: THREE.Color;
  /** Цвет воздуха вокруг: чем подсвечена дымка без солнца. */
  haze: THREE.Color;
  /** Насколько солнце над горизонтом и не закрыто ненастьем, 0..1: от этого лучи и ореол. */
  sunUp: number;
  /** Какая доля воздуха поляны на солнце, а не в тени стены леса (`look.airLit`): от этого ореол. */
  air: number;
  /** Дымка у земли (`look.mistAt`). */
  mist: Mist;
  /** Во сколько раз открыт затвор (`look.exposure`). */
  exposure: number;
  /** Насколько дымка светится в сторону солнца (`look.MIE`). */
  mie: number;
  /** Насколько ясный день углубляет синеву неба к зениту, 0..1 (`look.RAYLEIGH`). */
  zenith: number;
}

/** Вершины полноэкранного треугольника — сразу в пространстве экрана. */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/** Общие помощники шейдеров. `ign` — шум с чередованием градиента (Jimenez): без узора и без `sin`. */
const COMMON = /* glsl */ `
varying vec2 vUv;
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec3 viewAt( sampler2D depth, mat4 invProj, vec2 uv ) {
  float d = texture2D( depth, uv ).x;
  vec4 v = invProj * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return v.xyz / v.w;
}`;

/**
 * Затенение складок — по глубине, без нормалей (SAO, McGuire 2012).
 *
 * Нормаль выводится из соседей по глубине, и из двух соседей берётся тот, что ближе
 * по глубине, — иначе на кромке ствола на фоне неба нормаль ложилась бы поперёк, и
 * вокруг каждого дерева встал бы тёмный ореол. Радиус — в метрах, на экран он
 * переводится по глубине: складка у ноги и складка у опушки затеняются одинаково.
 */
const AO_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform vec2 uTexel;
uniform float uProjScale;
uniform float uRadius;
void main() {
  float d = texture2D( tDepth, vUv ).x;
  if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 p = viewAt( tDepth, uInvProj, vUv );
  vec3 pl = viewAt( tDepth, uInvProj, vUv - vec2( uTexel.x, 0.0 ) );
  vec3 pr = viewAt( tDepth, uInvProj, vUv + vec2( uTexel.x, 0.0 ) );
  vec3 pd = viewAt( tDepth, uInvProj, vUv - vec2( 0.0, uTexel.y ) );
  vec3 pu = viewAt( tDepth, uInvProj, vUv + vec2( 0.0, uTexel.y ) );
  vec3 dx = abs( pr.z - p.z ) < abs( p.z - pl.z ) ? pr - p : p - pl;
  vec3 dy = abs( pu.z - p.z ) < abs( p.z - pd.z ) ? pu - p : p - pd;
  vec3 n = normalize( cross( dx, dy ) );
  float rPx = min( uRadius * uProjScale / -p.z, 90.0 );
  if ( rPx < 1.5 ) { gl_FragColor = vec4( 1.0 ); return; }
  float rot = ign( gl_FragCoord.xy ) * 6.2831853;
  float r2 = uRadius * uRadius;
  float sum = 0.0;
  for ( int i = 0; i < AO_SAMPLES; i++ ) {
    float t = ( float( i ) + 0.5 ) / float( AO_SAMPLES );
    float a = t * 6.2831853 * 7.0 + rot;
    vec2 uv = vUv + vec2( cos( a ), sin( a ) ) * t * rPx * uTexel;
    vec3 v = viewAt( tDepth, uInvProj, uv ) - p;
    float vv = dot( v, v );
    float vn = dot( v, n );
    float f = max( r2 - vv, 0.0 );
    sum += f * f * f * max( ( vn - 0.02 * -p.z ) / ( vv + 0.01 ), 0.0 );
  }
  float ao = max( 0.0, 1.0 - sum * 5.0 / ( r2 * r2 * r2 * float( AO_SAMPLES ) ) );
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

/** Размытие затенения по глубине: тень складки не переползает с ствола на небо. */
const AO_BLUR_FRAG = /* glsl */ `
${COMMON}
#include <packing>
uniform sampler2D tAo;
uniform sampler2D tDepth;
uniform vec2 uStep;
uniform float uNear;
uniform float uFar;
float zAt( vec2 uv ) { return -perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, uNear, uFar ); }
void main() {
  float z0 = zAt( vUv );
  float sum = texture2D( tAo, vUv ).r * 0.2270;
  float wsum = 0.2270;
  for ( int i = 1; i <= 4; i++ ) {
    float g = i == 1 ? 0.1945 : i == 2 ? 0.1216 : i == 3 ? 0.0540 : 0.0162;
    for ( int s = -1; s <= 1; s += 2 ) {
      vec2 uv = vUv + uStep * float( i * s );
      float w = g * max( 0.0, 1.0 - abs( zAt( uv ) - z0 ) * 4.0 / max( z0, 0.1 ) );
      sum += texture2D( tAo, uv ).r * w;
      wsum += w;
    }
  }
  float ao = sum / wsum;
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

/**
 * Лучи сквозь кроны: от солнца на экране — к точке, по открытому небу.
 *
 * Шаги идут от точки к светилу, и на каждом спрашивается одно: небо там или крона.
 * Небо близко к солнцу светит, крона — нет; сумма вдоль пути и есть луч. Считается
 * это на четверти экрана и по глубине, а не по цвету: цвет неба у светила уже
 * подкрашен куполом, а по глубине видно ровно то, что закрывает свет.
 */
const SHAFT_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
uniform float uReach;
void main() {
  vec2 delta = ( vUv - uSun ) * ( uReach / float( SHAFT_STEPS ) );
  vec2 uv = vUv - delta * ign( gl_FragCoord.xy );
  float fall = 1.0;
  float sum = 0.0;
  for ( int i = 0; i < SHAFT_STEPS; i++ ) {
    uv -= delta;
    vec2 c = clamp( uv, vec2( 0.001 ), vec2( 0.999 ) );
    float open = step( 0.99999, texture2D( tDepth, c ).x );
    vec2 dd = ( uv - uSun ) * vec2( uAspect, 1.0 );
    sum += open * exp( -dot( dd, dd ) * 9.0 ) * fall;
    fall *= 0.965;
  }
  float s = sum / float( SHAFT_STEPS ) * 3.0;
  gl_FragColor = vec4( s, s, s, 1.0 );
}`;

/**
 * Отбор для свечения: только то, что ярче порога, мягким коленом, — и без светлячков.
 *
 * Искра костра — одна точка в сотню раз ярче неба; усреднённая как есть, она мигала
 * бы ореолом при каждом сдвиге взгляда. Отсюда взвешивание по яркости (Karis): яркая
 * точка весит меньше, и ореол у искры ровный.
 */
const PICK_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
vec3 tap( vec2 o, out float w ) {
  vec3 c = texture2D( tColor, vUv + o * uTexel ).rgb;
  w = 1.0 / ( 1.0 + lum( c ) );
  return c * w;
}
void main() {
  float wa, wb, wc, wd;
  vec3 c = tap( vec2( -1.0, -1.0 ), wa ) + tap( vec2( 1.0, -1.0 ), wb ) + tap( vec2( -1.0, 1.0 ), wc ) + tap( vec2( 1.0, 1.0 ), wd );
  c /= wa + wb + wc + wd;
  float br = max( c.r, max( c.g, c.b ) );
  float knee = uThreshold * 0.5;
  float soft = clamp( br - uThreshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee + 1e-4 );
  c *= max( soft, br - uThreshold ) / max( br, 1e-4 );
  gl_FragColor = vec4( c, 1.0 );
}`;

/** Ступень свечения вниз — двойной фильтр Кавасе: пять выборок на точку. */
const DOWN_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tColor;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D( tColor, vUv ).rgb * 4.0;
  c += texture2D( tColor, vUv + vec2( -1.0, -1.0 ) * uTexel ).rgb;
  c += texture2D( tColor, vUv + vec2( 1.0, -1.0 ) * uTexel ).rgb;
  c += texture2D( tColor, vUv + vec2( -1.0, 1.0 ) * uTexel ).rgb;
  c += texture2D( tColor, vUv + vec2( 1.0, 1.0 ) * uTexel ).rgb;
  gl_FragColor = vec4( c / 8.0, 1.0 );
}`;

/** Ступень свечения вверх: нижняя растягивается шатром и ложится на свою. */
const UP_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tColor;
uniform sampler2D tLow;
uniform vec2 uTexel;
void main() {
  vec2 h = uTexel;
  vec3 c = texture2D( tLow, vUv + vec2( -2.0, 0.0 ) * h ).rgb;
  c += texture2D( tLow, vUv + vec2( -1.0, 1.0 ) * h ).rgb * 2.0;
  c += texture2D( tLow, vUv + vec2( 0.0, 2.0 ) * h ).rgb;
  c += texture2D( tLow, vUv + vec2( 1.0, 1.0 ) * h ).rgb * 2.0;
  c += texture2D( tLow, vUv + vec2( 2.0, 0.0 ) * h ).rgb;
  c += texture2D( tLow, vUv + vec2( 1.0, -1.0 ) * h ).rgb * 2.0;
  c += texture2D( tLow, vUv + vec2( 0.0, -2.0 ) * h ).rgb;
  c += texture2D( tLow, vUv + vec2( -1.0, -1.0 ) * h ).rgb * 2.0;
  gl_FragColor = vec4( texture2D( tColor, vUv ).rgb + c / 12.0, 1.0 );
}`;

/**
 * Глубина резкости: дальнее мягче, ближнее резкое.
 *
 * Только даль, и это решение, а не экономия. Поляна — место, где работают руками:
 * топор, лук, олень в девяти метрах и волк у опушки обязаны быть резкими, иначе
 * красивый кадр мешает играть. Размывается то, что за кромкой поляны, — лес в
 * глубине и небо, — и ровно настолько, чтобы даль читалась далью. Выборка берёт
 * соседа только тогда, когда он сам размыт настолько, чтобы дотянуться сюда: резкий
 * ствол на фоне размытого леса не расползается ореолом.
 */
const DOF_FRAG = /* glsl */ `
${COMMON}
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uRange;
uniform float uMax;
float cocAt( vec2 uv ) {
  float z = -perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, uNear, uFar );
  return clamp( ( z - uFocus ) / uRange, 0.0, 1.0 );
}
void main() {
  float c0 = cocAt( vUv );
  vec3 own = texture2D( tColor, vUv ).rgb;
  if ( c0 <= 0.002 ) { gl_FragColor = vec4( own, 0.0 ); return; }
  float r = c0 * uMax;
  vec3 acc = own;
  float wsum = 1.0;
  for ( int i = 0; i < 20; i++ ) {
    float t = ( float( i ) + 0.5 ) / 20.0;
    float a = float( i ) * 2.39996323;
    vec2 o = vec2( cos( a ), sin( a ) ) * sqrt( t ) * r;
    vec2 uv = vUv + o * uTexel;
    float w = smoothstep( length( o ) - 1.0, length( o ) + 1.0, cocAt( uv ) * uMax );
    acc += texture2D( tColor, uv ).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4( acc / wsum, c0 );
}`;

/**
 * Итог: сцена, дымка, лучи, свечение — и тонирование, виньетка, зерно.
 *
 * ДЫМКА ЗДЕСЬ ОБЪЁМНАЯ, А НЕ ПЛОСКАЯ, И СЧИТАЕТСЯ ЗАКРЫТОЙ ФОРМОЙ. Плотность воздуха
 * падает с высотой (`uHeight`), и путь взгляда до точки интегрируется точно: взгляд
 * вдоль земли тонет, взгляд вверх — нет, и кроны над дымкой стоят чище стволов. Свет,
 * рассеянный дымкой, — цвет воздуха плюс солнце по закону Хеньи — Гринстейна: к солнцу
 * дымка светится, от солнца — синеет. Небо той же формулой получает ореол у светила.
 *
 * Тонирование — то самое, что стоит у рендерера (`toneMapping`, ACES), и выход в sRGB —
 * его же: итог рисуется материалом three на экран, и обе вставки приходят от него.
 */
const FINAL_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform sampler2D tAo;
uniform sampler2D tDof;
uniform vec2 uTexel;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uHaze;
uniform float uSunUp;
uniform float uAir;
uniform float uMie;
uniform float uZenith;
uniform float uDensity;
uniform float uHeight;
uniform float uBloom;
uniform float uShafts;
uniform float uAo;
uniform float uVignette;
uniform float uGrain;
uniform float uGrade;
uniform float uFrame;
uniform float uSkyFar;
vec3 fetch( vec2 uv ) { return texture2D( tColor, uv ).rgb; }
float pl( vec3 c ) { float l = lum( c ); return l / ( 1.0 + l ); }
#ifdef FXAA
vec3 fxaa( vec2 uv ) {
  vec3 m = fetch( uv );
  vec3 nw = fetch( uv + vec2( -1.0, -1.0 ) * uTexel );
  vec3 ne = fetch( uv + vec2( 1.0, -1.0 ) * uTexel );
  vec3 sw = fetch( uv + vec2( -1.0, 1.0 ) * uTexel );
  vec3 se = fetch( uv + vec2( 1.0, 1.0 ) * uTexel );
  float lm = pl( m ), lnw = pl( nw ), lne = pl( ne ), lsw = pl( sw ), lse = pl( se );
  float lo = min( lm, min( min( lnw, lne ), min( lsw, lse ) ) );
  float hi = max( lm, max( max( lnw, lne ), max( lsw, lse ) ) );
  if ( hi - lo < max( 0.0312, hi * 0.125 ) ) return m;
  vec2 dir = vec2( -( ( lnw + lne ) - ( lsw + lse ) ), ( lnw + lsw ) - ( lne + lse ) );
  float reduce = max( ( lnw + lne + lsw + lse ) * 0.03125, 1.0 / 128.0 );
  dir = clamp( dir / ( min( abs( dir.x ), abs( dir.y ) ) + reduce ), vec2( -8.0 ), vec2( 8.0 ) ) * uTexel;
  vec3 a = 0.5 * ( fetch( uv + dir * ( 1.0 / 3.0 - 0.5 ) ) + fetch( uv + dir * ( 2.0 / 3.0 - 0.5 ) ) );
  vec3 b = a * 0.5 + 0.25 * ( fetch( uv - dir * 0.5 ) + fetch( uv + dir * 0.5 ) );
  float lb = pl( b );
  return ( lb < lo || lb > hi ) ? a : b;
}
#endif
void main() {
#ifdef FXAA
  vec3 col = fxaa( vUv );
#else
  vec3 col = fetch( vUv );
#endif
  float d = texture2D( tDepth, vUv ).x;
#ifdef DOF
  vec4 dof = texture2D( tDof, vUv );
  col = mix( col, dof.rgb, smoothstep( 0.0, 0.3, dof.a ) );
#endif
#ifdef AO
  col *= mix( 1.0, texture2D( tAo, vUv ).r, uAo );
#endif
  vec4 v = uInvProj * vec4( vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  vec3 w = ( uCamWorld * vec4( v.xyz / v.w, 1.0 ) ).xyz;
  vec3 ray = w - uCamPos;
  float dist = length( ray );
  vec3 dir = ray / max( dist, 1e-4 );
  if ( d >= 0.99999 ) {
    dist = uSkyFar;
    // Рэлей: ясный день синеет к зениту и белеет к горизонту — купол красит это
    // по вершинам, а здесь это доводится до той глубины, какую даёт чистый воздух.
    col *= mix( vec3( 1.0 ), vec3( 0.62, 0.82, 1.32 ), smoothstep( 0.02, 0.75, dir.y ) * uZenith );
  }
  float k = 1.0 / uHeight;
  float dy = dir.y * dist;
  float base = exp( -uCamPos.y * k );
  float tau = abs( dy ) < 1e-3 ? uDensity * base * dist : uDensity * dist * ( base - exp( -( uCamPos.y + dy ) * k ) ) / ( dy * k );
  float keep = exp( -tau );
  float cs = dot( dir, uSunDir );
  float g = 0.76;
  float hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * cs, 1.5 ) * 0.0795775;
  vec3 lit = uHaze + uSun * hg * uSunUp * uMie * uAir;
  col = col * keep + lit * ( 1.0 - keep );
  // Луч — свет, рассеянный дымкой между глазом и тем, что за ним, и его ровно столько,
  // сколько дымки на этом пути (та же толща tau): у ствола в двух шагах дымки нет, и
  // луч на него не ложится; в чистом небе над кромкой её нет тоже, и там луч не
  // стелется вуалью вокруг солнца — ореол у солнца рисует дымка сама (Хеньи — Гринстейн).
  col += texture2D( tShafts, vUv ).r * uSun * uShafts * ( 1.0 - exp( -tau * SHAFT_TAU ) );
  col += texture2D( tBloom, vUv ).rgb * uBloom;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Плёнка: тени холоднее, света теплее, цвет гуще — и тёмное остаётся тёмным. Холод
  // тени и тепло света разведены по яркости, а не по месту: снег в тени синеет, снег на
  // солнце и огонь теплеют сами, без правила про снег и огонь. Кривая в самом низу
  // опускает чёрное, которое подняла дымка, — только в тёмной трети, светлое не трогает.
  float gl = lum( gl_FragColor.rgb );
  vec3 split = mix( vec3( 0.88, 0.96, 1.12 ), vec3( 1.03, 1.0, 0.95 ), smoothstep( 0.08, 0.8, gl ) );
  gl_FragColor.rgb *= mix( vec3( 1.0 ), split, uGrade );
  gl_FragColor.rgb = max( mix( vec3( gl ), gl_FragColor.rgb, 1.0 + 0.18 * uGrade ), 0.0 );
  vec3 toe = gl_FragColor.rgb * gl_FragColor.rgb / ( gl_FragColor.rgb + 0.06 ) * 1.06;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, toe, uGrade * ( 1.0 - smoothstep( 0.1, 0.35, gl ) ) );
  vec2 q = vUv * 2.0 - 1.0;
  gl_FragColor.rgb *= 1.0 - uVignette * smoothstep( 0.45, 1.5, length( q ) );
  float n = ign( gl_FragCoord.xy + vec2( 5.588238 ) * mod( uFrame, 64.0 ) ) - 0.5;
  gl_FragColor.rgb += n * uGrain * ( 1.0 - 0.6 * lum( gl_FragColor.rgb ) );
}`;

/** Сколько стоит одна ступень: что показать стенду и игроку, который спросит. */
export interface Cost {
  tier: Tier;
  width: number;
  height: number;
  passes: number;
  /** Сколько мегабайт видеопамяти держат цели конвейера. */
  mb: number;
  /** Выборок сглаживания у сцены; есть ли затенение складок и глубина резкости. */
  samples: number;
  ao: boolean;
  dof: boolean;
}

/**
 * Настройки вида по ступени: насколько сильны эффекты. Числа подобраны снимками
 * кадра-мерила (`npm run prologue:stand`, `LOOK=`), а не описанием.
 */
const LOOK_NUMBERS: Record<Tier, { bloom: number; threshold: number; shafts: number; ao: number; vignette: number; grain: number; grade: number }> = {
  full: { bloom: 0.05, threshold: 1.1, shafts: 0.22, ao: 0.75, vignette: 0.32, grain: 0.035, grade: 1 },
  lite: { bloom: 0.05, threshold: 1.1, shafts: 0.22, ao: 0, vignette: 0.32, grain: 0.03, grade: 1 },
  base: { bloom: 0, threshold: 1, shafts: 0, ao: 0, vignette: 0, grain: 0, grade: 0 },
};

/** Глубина резкости: с какой дали размывается, за сколько метров доходит до предела и сколько точек предел. */
const DOF_FOCUS = 16;
const DOF_RANGE = 26;
const DOF_MAX_AT_800 = 4.5;

/** Докуда считать дымку по лучу, упёршемуся в небо: край земли поляны. */
const SKY_FAR = 60;

/**
 * Во сколько раз луч набирает силу быстрее, чем дымка гасит то, что за ней: при толще
 * дымки 0.05 (утренняя дымка на двадцати метрах у земли) луч в четверть силы, при 0.2 —
 * в две трети. Лучи — свет в дымке, и где её нет, их нет: в чистом полуденном воздухе и
 * в небе над кромкой леса.
 */
const SHAFT_TAU = 6;

/**
 * Лучи — утренний и вечерний свет в дымке: с какой плотности дымки (`look.mistAt`) они в
 * полную силу. Ниже — слабее ровно на долю: в полдень, когда солнце высоко и небо вокруг
 * открыто, «лучи» по открытому небу стали бы не лучами, а белёсой вуалью по всему кадру.
 */
const SHAFT_MIST = 0.012;

const _v = new THREE.Vector3();

export class Post {
  private tier: Tier;
  private width = 1;
  private height = 1;
  private quad: THREE.Mesh;
  private stage = new THREE.Scene();
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private aoA: THREE.WebGLRenderTarget | null = null;
  private aoB: THREE.WebGLRenderTarget | null = null;
  private shaftRT: THREE.WebGLRenderTarget | null = null;
  private dofRT: THREE.WebGLRenderTarget | null = null;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private aoMat!: THREE.ShaderMaterial;
  private aoBlurMat!: THREE.ShaderMaterial;
  private shaftMat!: THREE.ShaderMaterial;
  private pickMat!: THREE.ShaderMaterial;
  private downMat!: THREE.ShaderMaterial;
  private upMat!: THREE.ShaderMaterial;
  private dofMat!: THREE.ShaderMaterial;
  private finalMat!: THREE.ShaderMaterial;
  /**
   * Чёрная текстура-заглушка там, где у ступени прохода нет: шейдеру нужна любая. Цель,
   * в которую не рисовали, у three ещё не заведена — заводится она первым кадром
   * (`initRenderTarget`), и WebGL отдаёт её нулями.
   */
  private blank: THREE.WebGLRenderTarget;
  private blankReady = false;
  private frameNo = 0;
  /** С какой дали размывает глубина резкости, метры: у поляны — `DOF_FOCUS`, у поля промысла — своя (`setFocus`). */
  private focus = DOF_FOCUS;

  constructor(
    private renderer: THREE.WebGLRenderer,
    tier: Tier,
  ) {
    this.tier = tier;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.stage.add(this.quad);
    this.blank = new THREE.WebGLRenderTarget(1, 1, { type: UNSIGNED_BYTE, depthBuffer: false });
    this.build();
  }

  /** Сменить ступень: цели и шейдеры собираются заново. */
  setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.freeTargets();
    this.freeMaterials();
    this.build();
    this.alloc();
  }

  getTier(): Tier {
    return this.tier;
  }

  /**
   * С какой дали размывать. Поляна видна на двадцать метров, и дальше — лес; поле «Охоты» — на сорок, и олень на нём —
   * цель, а не фон (docs/minigames.md, 13): размытым его не взять.
   */
  setFocus(meters: number): void {
    this.focus = meters;
  }

  /** Размер рисующего буфера канвы, в точках экрана. */
  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.sceneRT) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.freeTargets();
    this.alloc();
  }

  /** Кадр. `camera` — та, что у сцены; итог ложится в канву. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, light: Light): void {
    const r = this.renderer;
    r.toneMappingExposure = light.exposure;
    if (this.tier === 'base' || !this.sceneRT) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    this.frameNo++;
    if (!this.blankReady) {
      r.initRenderTarget(this.blank);
      this.blankReady = true;
    }
    const n = LOOK_NUMBERS[this.tier];
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    const color = this.sceneRT.texture;
    const depth = this.sceneRT.depthTexture as THREE.Texture;
    const invProj = camera.projectionMatrixInverse;

    if (this.aoA && this.aoB) {
      this.aoMat.uniforms.tDepth.value = depth;
      this.aoMat.uniforms.uInvProj.value = invProj;
      this.aoMat.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      // Сколько точек экрана в метре на глубине в метр — по вертикали кадра.
      this.aoMat.uniforms.uProjScale.value = 0.5 * this.height * camera.projectionMatrix.elements[5];
      this.pass(this.aoMat, this.aoA);
      for (const [src, dst, sx, sy] of [
        [this.aoA, this.aoB, 1, 0],
        [this.aoB, this.aoA, 0, 1],
      ] as const) {
        this.aoBlurMat.uniforms.tAo.value = src.texture;
        this.aoBlurMat.uniforms.tDepth.value = depth;
        this.aoBlurMat.uniforms.uStep.value.set(sx / src.width, sy / src.height);
        this.aoBlurMat.uniforms.uNear.value = camera.near;
        this.aoBlurMat.uniforms.uFar.value = camera.far;
        this.pass(this.aoBlurMat, dst);
      }
    }

    // Лучи: где солнце на экране. За спиной — лучей нет.
    const sunOn = this.shaftRT && light.sunUp > 0.01;
    let shaftK = 0;
    if (this.shaftRT && sunOn) {
      _v.copy(light.sunDir).multiplyScalar(1000).add(camera.position);
      camera.getWorldDirection(SUN_VIEW);
      const facing = SUN_VIEW.dot(light.sunDir);
      _v.project(camera);
      // За спиной проекция выворачивается наизнанку — лучи только спереди.
      shaftK = Math.max(0, Math.min(1, (facing - 0.05) / 0.4)) * light.sunUp;
      if (shaftK > 0) {
        this.shaftMat.uniforms.tDepth.value = depth;
        this.shaftMat.uniforms.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
        this.shaftMat.uniforms.uAspect.value = this.width / this.height;
        this.pass(this.shaftMat, this.shaftRT);
      }
    }

    // Свечение: отбор, ступени вниз, ступени вверх.
    let bloom: THREE.Texture = this.blank.texture;
    if (this.down.length) {
      this.pickMat.uniforms.tColor.value = color;
      this.pickMat.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pickMat.uniforms.uThreshold.value = n.threshold;
      this.pass(this.pickMat, this.down[0]);
      for (let i = 1; i < this.down.length; i++) {
        const src = this.down[i - 1];
        this.downMat.uniforms.tColor.value = src.texture;
        this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.downMat, this.down[i]);
      }
      let low = this.down[this.down.length - 1];
      for (let i = this.down.length - 2; i >= 0; i--) {
        this.upMat.uniforms.tColor.value = this.down[i].texture;
        this.upMat.uniforms.tLow.value = low.texture;
        this.upMat.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
        this.pass(this.upMat, this.up[i]);
        low = this.up[i];
      }
      bloom = low.texture;
    }

    if (this.dofRT) {
      this.dofMat.uniforms.tColor.value = color;
      this.dofMat.uniforms.tDepth.value = depth;
      this.dofMat.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
      this.dofMat.uniforms.uNear.value = camera.near;
      this.dofMat.uniforms.uFar.value = camera.far;
      this.dofMat.uniforms.uMax.value = (DOF_MAX_AT_800 * this.height) / 800;
      this.dofMat.uniforms.uFocus.value = this.focus;
      this.pass(this.dofMat, this.dofRT);
    }

    const f = this.finalMat.uniforms;
    f.tColor.value = color;
    f.tDepth.value = depth;
    f.tBloom.value = bloom;
    f.tShafts.value = shaftK > 0 && this.shaftRT ? this.shaftRT.texture : this.blank.texture;
    f.tAo.value = this.aoA ? this.aoA.texture : this.blank.texture;
    f.tDof.value = this.dofRT ? this.dofRT.texture : this.blank.texture;
    f.uTexel.value.set(1 / this.width, 1 / this.height);
    f.uInvProj.value = invProj;
    f.uCamWorld.value = camera.matrixWorld;
    f.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    f.uSunDir.value.copy(light.sunDir);
    f.uSun.value.copy(light.sun);
    f.uHaze.value.copy(light.haze);
    f.uSunUp.value = light.sunUp;
    f.uAir.value = light.air;
    f.uMie.value = light.mie;
    f.uZenith.value = light.zenith;
    f.uDensity.value = light.mist.density;
    f.uHeight.value = light.mist.height;
    f.uBloom.value = n.bloom;
    // Сколько лучей — решает толща дымки на пути взгляда (`SHAFT_TAU` в итоге), а не пол
    // в треть силы: прежний пол стелил лучи вуалью по всему небу и в чистый полдень.
    f.uShafts.value = n.shafts * shaftK * Math.min(1, light.mist.density / SHAFT_MIST);
    f.uAo.value = n.ao;
    f.uVignette.value = n.vignette;
    f.uGrain.value = n.grain;
    f.uGrade.value = n.grade;
    f.uFrame.value = this.frameNo;
    f.uSkyFar.value = SKY_FAR;
    this.pass(this.finalMat, null);
  }

  /** Что стоит нынешняя ступень: размер, число проходов и память целей. */
  cost(): Cost {
    const all = [this.sceneRT, this.aoA, this.aoB, this.shaftRT, this.dofRT, ...this.down, ...this.up].filter(
      (t): t is THREE.WebGLRenderTarget => !!t,
    );
    let bytes = 0;
    for (const t of all) {
      const px = t.width * t.height;
      const texel = t.texture.type === HALF_FLOAT ? 8 : 4;
      bytes += px * texel * (t.samples > 0 ? t.samples + 1 : 1);
      if (t.depthTexture) bytes += px * 4 * (t.samples > 0 ? t.samples + 1 : 1);
    }
    const passes =
      this.tier === 'base'
        ? 1
        : 1 + (this.aoA ? 3 : 0) + (this.shaftRT ? 1 : 0) + (this.down.length ? this.down.length * 2 - 1 : 0) + (this.dofRT ? 1 : 0) + 1;
    return {
      tier: this.tier,
      width: this.width,
      height: this.height,
      passes,
      mb: bytes / 1048576,
      samples: this.sceneRT?.samples ?? 0,
      ao: !!this.aoA,
      dof: !!this.dofRT,
    };
  }

  dispose(): void {
    this.freeTargets();
    this.freeMaterials();
    this.blank.dispose();
    this.quad.geometry.dispose();
  }

  // ---------- Внутреннее ----------

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.stage, CAMERA_STUB);
  }

  private make(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number | string> = {}): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mats.push(m);
    return m;
  }

  private build(): void {
    const t = this.tier;
    const v2 = (): { value: THREE.Vector2 } => ({ value: new THREE.Vector2() });
    const tex = (): { value: THREE.Texture | null } => ({ value: null });
    const num = (x = 0): { value: number } => ({ value: x });
    this.aoMat = this.make(AO_FRAG, { tDepth: tex(), uInvProj: { value: new THREE.Matrix4() }, uTexel: v2(), uProjScale: num(), uRadius: num(0.55) }, { AO_SAMPLES: 12 });
    this.aoBlurMat = this.make(AO_BLUR_FRAG, { tAo: tex(), tDepth: tex(), uStep: v2(), uNear: num(), uFar: num() });
    this.shaftMat = this.make(SHAFT_FRAG, { tDepth: tex(), uSun: v2(), uAspect: num(1), uReach: num(0.85) }, { SHAFT_STEPS: Math.max(1, SHAFT_STEPS[t]) });
    this.pickMat = this.make(PICK_FRAG, { tColor: tex(), uTexel: v2(), uThreshold: num(1) });
    this.downMat = this.make(DOWN_FRAG, { tColor: tex(), uTexel: v2() });
    this.upMat = this.make(UP_FRAG, { tColor: tex(), tLow: tex(), uTexel: v2() });
    this.dofMat = this.make(DOF_FRAG, {
      tColor: tex(),
      tDepth: tex(),
      uTexel: v2(),
      uNear: num(),
      uFar: num(),
      uFocus: num(DOF_FOCUS),
      uRange: num(DOF_RANGE),
      uMax: num(),
    });
    const defines: Record<string, number | string> = {};
    if (t === 'lite') defines.FXAA = 1;
    if (t === 'full') {
      defines.AO = 1;
      defines.DOF = 1;
    }
    defines.SHAFT_TAU = SHAFT_TAU.toFixed(1);
    this.finalMat = this.make(
      FINAL_FRAG,
      {
        tColor: tex(),
        tDepth: tex(),
        tBloom: tex(),
        tShafts: tex(),
        tAo: tex(),
        tDof: tex(),
        uTexel: v2(),
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uSunUp: num(),
        uAir: num(1),
        uMie: num(),
        uZenith: num(),
        uDensity: num(),
        uHeight: num(1),
        uBloom: num(),
        uShafts: num(),
        uAo: num(),
        uVignette: num(),
        uGrain: num(),
        uGrade: num(),
        uFrame: num(),
        uSkyFar: num(SKY_FAR),
      },
      defines,
    );
    // Итог — единственный проход на экран: тонирование и sRGB приходят от рендерера.
    this.finalMat.toneMapped = true;
  }

  private alloc(): void {
    const t = this.tier;
    if (t === 'base') return;
    const w = this.width;
    const h = this.height;
    const hdr = { type: HALF_FLOAT, depthBuffer: false } as const;
    const samples = t === 'full' ? (w * h > BIG_PX ? SAMPLES_BIG : SAMPLES) : 0;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: HALF_FLOAT,
      samples,
      depthTexture: new THREE.DepthTexture(w, h),
      stencilBuffer: false,
    });
    const half = (d: number): [number, number] => [Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d))];
    if (t === 'full') {
      this.aoA = new THREE.WebGLRenderTarget(...half(2), { type: UNSIGNED_BYTE, depthBuffer: false });
      this.aoB = new THREE.WebGLRenderTarget(...half(2), { type: UNSIGNED_BYTE, depthBuffer: false });
      this.dofRT = new THREE.WebGLRenderTarget(...half(2), hdr);
    }
    this.shaftRT = new THREE.WebGLRenderTarget(...half(4), { type: UNSIGNED_BYTE, depthBuffer: false });
    const levels = BLOOM_LEVELS[t];
    const first = t === 'full' ? 2 : 4;
    for (let i = 0; i < levels; i++) {
      const d = first * 2 ** i;
      this.down.push(new THREE.WebGLRenderTarget(...half(d), hdr));
      if (i < levels - 1) this.up.push(new THREE.WebGLRenderTarget(...half(d), hdr));
    }
  }

  private freeTargets(): void {
    for (const rt of [this.sceneRT, this.aoA, this.aoB, this.shaftRT, this.dofRT, ...this.down, ...this.up]) {
      if (!rt) continue;
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    this.sceneRT = this.aoA = this.aoB = this.shaftRT = this.dofRT = null;
    this.down = [];
    this.up = [];
  }

  private freeMaterials(): void {
    for (const m of this.mats) m.dispose();
    this.mats = [];
  }
}

/** Куда смотрит камера — рабочий вектор для лучей, чтобы не заводить его в кадре. */
const SUN_VIEW = new THREE.Vector3();

/**
 * Камера полноэкранного прохода.
 *
 * Шейдер её не читает — вершины уже в пространстве экрана, — но `render` без камеры не
 * бывает. Взята та же перспективная, что у сцены: `OrthographicCamera` деревня из общего
 * чанка не берёт, и ради прохода, где камера не значит ничего, дописывать её имя в
 * первую загрузку незачем.
 */
const CAMERA_STUB = new THREE.PerspectiveCamera();
