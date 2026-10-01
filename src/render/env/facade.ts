/**
 * Фактура построек вида `next` (этап 2, пункт 2; docs/graphics_world.md, 11.2): черепица, солома и
 * дранка, штукатурка, брус и доска, камень с износом и мхом, мягкое затенение углов и полосы под
 * свесом — без текстур и без единого нового вызова отрисовки.
 *
 * КАК. Модель вида `next` собрана с признаками в вершинах (`kit.withFacade`): один атрибут `fac` по
 * байту на признак — место на грани, номер поверхности (`kit.SURFACE`) и свет окна. Тело всех зданий —
 * одна копия `KIT.body` (`FACADE_BODY`), которая их читает; в ней же свет окон (`glow.windowGlow`). Кровли — копии
 * сезонных материалов с узором по скату (`FACADE_ROOFS`): цвет у копии — тот же объект, что у
 * оригинала, и сезон переливает их вместе (`season.ts` красит `KIT[key].color` на месте). Узоры — от
 * координат модели: здание повёрнуто только вокруг вертикали, и ряд черепицы лежит вдоль кромки
 * при любом повороте. Групп у меша столько же, сколько было: подменяется материал, а не деление.
 *
 * НЫНЕШНИЙ ВИД НЕ ТРОНУТ: `KIT` не правится, модели вида `now` собираются без признаков
 * (`createBuildingGroup` без `facade`), а окна у них снимаются (`glow.dropGlow`).
 *
 * ЛЕНИВО. Модуль лежит в куске окружения (`render/env/`, своя дверь в `vite.config.ts`): шейдеры фактуры
 * в первую загрузку не входят. Сцена одевает здания, когда кусок приехал (`Scene.dressBuildings`); до
 * того они нарисованы прежним телом — признаки в вершинах ему не мешают.
 */
import * as THREE from 'three';
import { windowGlow } from '../glow';
import { KIT, type ColorMaterial } from '../materials';
import { FACADE_MOSS, FACADE_SHADE } from '../palette';

/** Сколько снега на кровлях: 0 летом, 1 в разгар зимы. Узор черепицы под снегом гаснет. Ведёт сцена. */
export const FACADE_SNOW = { value: 0 };

const vec3 = (m: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(m[0], m[1], m[2]);

const COMMON_VERT = /* glsl */ `
varying vec3 vFacP;
`;

const COMMON_FRAG = /* glsl */ `
varying vec3 vFacP;
float facHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float facNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( facHash( i ), facHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( facHash( i + vec2( 0.0, 1.0 ) ), facHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

/**
 * Грань в координатах модели: нормаль по самой грани (плоское затенение), горизонталь вдоль неё и
 * расстояние вверх по скату. У вертикальной стены «вверх по скату» — просто высота.
 */
const FACE_FRAME = /* glsl */ `
vec3 facN = normalize( cross( dFdx( vFacP ), dFdy( vFacP ) ) );
vec2 facT = normalize( vec2( -facN.z, facN.x ) + vec2( 1e-4, 0.0 ) );
float facS = dot( vFacP.xz, facT );
float facUp = abs( facN.y );
float facF = vFacP.y / max( 0.25, sqrt( max( 0.0, 1.0 - facN.y * facN.y ) ) );
`;

const BODY_VERT_PARS = /* glsl */ `
${COMMON_VERT}
attribute vec4 fac;
varying float vFacS;
varying vec2 vFacF;
`;

const BODY_FRAG_PARS = /* glsl */ `
${COMMON_FRAG}
varying float vFacS;
varying vec2 vFacF;
uniform vec3 uFacShade;
uniform vec3 uFacMoss;
`;

/**
 * Узор тела по поверхности. Штукатурка — неровная известь пятнами; брус и доска — швы по высоте, у
 * каждой доски свой тон, волокна вдоль; камень — кладка рядами со сдвигом, шов темнее, у каждого
 * камня свой тон, износ пятнами и мох у земли. Затенение — у вертикальных краёв грани и полосой под
 * свесом, холодное, как контактное у земли. Множители — около единицы: краска палитры остаётся собой.
 */
const BODY_FRAG = /* glsl */ `
#include <color_fragment>
{
  ${FACE_FRAME}
  float facCode = vFacS;
  float facWall = 1.0 - smoothstep( 0.5, 0.8, facUp );
  float facK = 1.0;
  if ( facCode == 1.0 ) {
    facK *= 0.93 + 0.09 * facNoise( vec2( facS, vFacP.y ) * 2.2 ) + 0.04 * facNoise( vec2( facS, vFacP.y ) * 7.0 );
  } else if ( facCode == 2.0 ) {
    float row = vFacP.y / 0.16;
    float seam = smoothstep( 0.0, 0.1, fract( row ) ) * ( 1.0 - smoothstep( 0.88, 1.0, fract( row ) ) );
    float plank = 0.9 + 0.16 * facHash( vec2( floor( row ), 7.0 ) );
    float grain = 0.94 + 0.08 * facNoise( vec2( facS * 9.0, vFacP.y * 0.8 ) );
    facK *= mix( 1.0, mix( 0.74, 1.0, seam ) * plank, facWall ) * grain;
  } else if ( facCode == 3.0 ) {
    float row = vFacP.y / 0.23;
    float col = facS / 0.4 + 0.5 * mod( floor( row ), 2.0 );
    float mortar = min(
      smoothstep( 0.0, 0.08, fract( row ) ) * ( 1.0 - smoothstep( 0.92, 1.0, fract( row ) ) ),
      smoothstep( 0.0, 0.05, fract( col ) ) * ( 1.0 - smoothstep( 0.95, 1.0, fract( col ) ) )
    );
    float block = 0.86 + 0.22 * facHash( vec2( floor( col ), floor( row ) ) );
    float wear = 0.9 + 0.12 * facNoise( vec2( facS, vFacP.y ) * 3.1 );
    facK *= mix( 1.0, mix( 0.7, 1.0, mortar ), facWall ) * block * wear;
    float moss = ( 1.0 - smoothstep( 0.1, 0.65, vFacP.y ) ) * smoothstep( 0.45, 0.75, facNoise( vec2( facS, vFacP.y ) * 4.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uFacMoss, moss * 0.6 * facWall );
  }
  if ( facCode > 0.5 ) {
    float edge = smoothstep( 0.0, 0.16, min( vFacF.x, 1.0 - vFacF.x ) );
    float eave = smoothstep( 0.0, 0.14, 1.0 - vFacF.y );
    diffuseColor.rgb *= mix( uFacShade, vec3( 1.0 ), mix( 1.0, min( edge, eave ), facWall ) );
  }
  diffuseColor.rgb *= facK;
}
`;

/** Тело всех зданий вида `next`: свет окон и фактура стен. Одно на игру, как само тело. */
export const FACADE_BODY: THREE.MeshLambertMaterial = KIT.body.clone();
FACADE_BODY.name = 'body-facade';
FACADE_BODY.onBeforeCompile = (shader): void => {
  windowGlow(shader, 'fac.w');
  Object.assign(shader.uniforms, {
    uFacShade: { value: vec3(FACADE_SHADE) },
    uFacMoss: { value: vec3(FACADE_MOSS) },
  });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${BODY_VERT_PARS}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacP = transformed;\nvFacS = floor( fac.z * 255.0 + 0.5 );\nvFacF = fac.xy;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${BODY_FRAG_PARS}`)
    .replace('#include <color_fragment>', BODY_FRAG);
};
FACADE_BODY.customProgramCacheKey = (): string => 'body-facade';

/** Кровля вида `next`: по виду кровли — свой узор по скату. */
type RoofKey = 'tile' | 'thatch' | 'thatchDark' | 'shingle';

/**
 * Узоры кровель. Черепица — ряды вдоль кромки со сдвигом через ряд, желобок поперёк (светлее гребень),
 * тень нахлёста у верхнего края ряда, у каждой черепицы свой тон. Солома — связки рядами (нижний край
 * связки темнее), стебли вдоль ската, пятна выгоревшего. Дранка — мелкие ряды, планки разной ширины
 * со щелями, тень нахлёста. Под снегом узор гаснет: снег лёг на ряды.
 */
const ROOF_FRAG: Record<RoofKey, string> = {
  tile: /* glsl */ `
    float row = facF / 0.15;
    float col = facS / 0.19 + 0.5 * mod( floor( row ), 2.0 );
    float profile = 0.9 + 0.12 * sin( fract( col ) * 6.2832 );
    float lap = 1.0 - 0.28 * smoothstep( 0.72, 1.0, fract( row ) );
    float tone = 0.88 + 0.18 * facHash( vec2( floor( col ), floor( row ) ) );
    facK = profile * lap * tone;`,
  thatch: /* glsl */ `
    float row = facF / 0.34;
    float course = 0.92 + 0.08 * smoothstep( 0.0, 0.25, fract( row ) + 0.15 * facNoise( vec2( facS * 3.0, 1.0 ) ) );
    float straw = 0.76 + 0.36 * facNoise( vec2( facS * 26.0, facF * 0.9 ) );
    float burnt = 0.9 + 0.14 * facNoise( vec2( facS, facF ) * 1.7 );
    facK = course * straw * burnt;`,
  thatchDark: /* glsl */ `
    float straw = 0.78 + 0.32 * facNoise( vec2( facS * 26.0, facF * 0.9 ) );
    facK = straw;`,
  shingle: /* glsl */ `
    float row = facF / 0.12;
    float r = floor( row );
    float col = facS / ( 0.13 + 0.05 * facHash( vec2( r, 3.0 ) ) ) + facHash( vec2( r, 5.0 ) );
    float gap = smoothstep( 0.0, 0.08, fract( col ) ) * ( 1.0 - smoothstep( 0.92, 1.0, fract( col ) ) );
    float lap = 1.0 - 0.34 * smoothstep( 0.7, 1.0, fract( row ) );
    float tone = 0.82 + 0.28 * facHash( vec2( floor( col ), r ) );
    facK = mix( 0.66, 1.0, gap ) * lap * tone;`,
};

function roof(key: RoofKey): ColorMaterial {
  const base = KIT[key];
  const m = base.clone() as THREE.MeshLambertMaterial;
  // Цвет — тот же объект: сезон красит оригинал на месте, копия идёт за ним.
  m.color = base.color;
  m.name = `facade-${key}`;
  m.onBeforeCompile = (shader): void => {
    shader.uniforms.uFacSnow = FACADE_SNOW;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacP = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAG}\nuniform float uFacSnow;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n{\n${FACE_FRAME}\nfloat facK = 1.0;\n${ROOF_FRAG[key]}\ndiffuseColor.rgb *= mix( facK, 1.0, uFacSnow * 0.8 );\n}`,
      );
  };
  m.customProgramCacheKey = (): string => `facade-${key}`;
  return m;
}

/** Кровли вида `next`: копия каждого сезонного материала кровли — со своим узором. */
export const FACADE_ROOFS: Record<RoofKey, ColorMaterial> = {
  tile: roof('tile'),
  thatch: roof('thatch'),
  thatchDark: roof('thatchDark'),
  shingle: roof('shingle'),
};

const SWAP = new Map<THREE.Material, THREE.Material>([
  [KIT.body, FACADE_BODY],
  ...(Object.keys(FACADE_ROOFS) as RoofKey[]).map((k): [THREE.Material, THREE.Material] => [KIT[k], FACADE_ROOFS[k]]),
]);

/**
 * Одеть здание вида `next` в фактуру: тело и кровли — их копии с узором. Меши без признаков фактуры
 * (пламя костра, горн — они отдельные и светятся сами) не трогаются. Свет окон — в признаках же
 * (`fac.w`): своего атрибута окнам не нужно.
 */
export function dressFacade(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('fac')) return;
    const swap = (m: THREE.Material): THREE.Material => SWAP.get(m) ?? m;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}
