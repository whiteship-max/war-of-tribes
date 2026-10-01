// Материалы вида «город» (docs/city.md, разделы 3 и 6): массив слоёв текстур (`sampler2DArray`) и
// Ламберт с правкой шейдера. Один материал на все здания, свой — у земли (смешение покрытий по карте
// и по высоте) и у крон. Новых имён three не заводит: массив слоёв — `Texture` с признаком массива
// (`DataArrayTexture` тянул бы своё имя в кусок three первой загрузки), Ламберт и `onBeforeCompile` —
// те же, что у окружения `next`.
import * as THREE from 'three';
import { CITY, linear } from './palette';
import { L, LAYERS, TILE_M } from './tex';

/** Массив слоёв RGBA8 sRGB: `size`² × число слоёв, строки снизу вверх; мипы строит видеокарта. */
export class LayerTexture extends THREE.Texture {
  readonly isDataArrayTexture = true;
  readonly layerUpdates = new Set<number>();
  constructor(data: Uint8Array, size: number, depth: number, anisotropy = 1) {
    super();
    this.image = { data, width: size, height: size, depth };
    this.magFilter = THREE.LinearFilter;
    this.minFilter = THREE.LinearMipmapLinearFilter;
    this.wrapS = THREE.RepeatWrapping;
    this.wrapT = THREE.RepeatWrapping;
    this.generateMipmaps = true;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.colorSpace = THREE.SRGBColorSpace;
    this.anisotropy = anisotropy;
    this.needsUpdate = true;
  }
  clearLayerUpdates(): void {
    this.layerUpdates.clear();
  }
}

/** Плоская карта RGBA8 (покрытия земли): признак `isDataTexture`, без своего имени three. */
export class MapTexture extends THREE.Texture {
  readonly isDataTexture = true;
  constructor(data: Uint8Array, size: number) {
    super();
    this.image = { data, width: size, height: size };
    this.magFilter = THREE.LinearFilter;
    this.minFilter = THREE.LinearMipmapLinearFilter;
    this.generateMipmaps = true;
    this.flipY = false;
    this.unpackAlignment = 1;
    this.needsUpdate = true;
  }
}

/** Общие ручки города: ночь, снег, осень — сцена правит их каждый кадр. */
export interface CityUniforms {
  cityTex: { value: THREE.Texture | null };
  cNight: { value: number };
  cSnow: { value: number };
  cAutumn: { value: number };
  cTime: { value: number };
  cWarm: { value: THREE.Color };
  cSnowCol: { value: THREE.Color };
}

export function cityUniforms(): CityUniforms {
  const w = linear(CITY.windowWarm);
  const s = linear(CITY.snow);
  return {
    cityTex: { value: null },
    cNight: { value: 0 },
    cSnow: { value: 0 },
    cAutumn: { value: 0 },
    cTime: { value: 0 },
    cWarm: { value: new THREE.Color(w[0], w[1], w[2]) },
    cSnowCol: { value: new THREE.Color(s[0], s[1], s[2]) },
  };
}

const COMMON_VERT = /* glsl */ `
attribute vec2 cuv;
attribute vec4 cfg;
varying vec2 vCUv;
varying float vLayer;
varying float vGlow;
varying float vGrime;
varying vec3 vCWPos;
varying float vCNy;
`;

const COMMON_FRAG = /* glsl */ `
uniform highp sampler2DArray cityTex;
uniform float cNight;
uniform float cSnow;
uniform float cAutumn;
uniform vec3 cWarm;
uniform vec3 cSnowCol;
varying vec2 vCUv;
varying float vLayer;
varying float vGlow;
varying float vGrime;
varying vec3 vCWPos;
varying float vCNy;
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cMacro(vec2 p) {
  return sin(p.x * 0.13 + sin(p.y * 0.071) * 2.0) * sin(p.y * 0.11 + sin(p.x * 0.053) * 2.0) * 0.5 + 0.5;
}
`;

/** Вершинная часть: свои атрибуты, мировое положение и вертикальность нормали (для снега). */
function patchVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = COMMON_VERT + shader.vertexShader.replace(
    '#include <begin_vertex>',
    /* glsl */ `#include <begin_vertex>
    vCUv = cuv;
    vLayer = cfg.x;
    vGlow = cfg.y / 255.0;
    vGrime = cfg.z / 255.0;
    vec4 cwp = vec4(transformed, 1.0);
    vec3 cwn = objectNormal;
    #ifdef USE_INSTANCING
      cwp = instanceMatrix * cwp;
      cwn = mat3(instanceMatrix) * cwn;
    #endif
    cwp = modelMatrix * cwp;
    vCWPos = cwp.xyz;
    vCNy = normalize(mat3(modelMatrix) * cwn).y;`,
  );
}

/**
 * Материал зданий: цвет — слой массива × тон вершины × крупные пятна по миру (ломают повтор),
 * грязь у земли, снег на горизонталях, ночью — тёплый свет окон по маске стекла.
 */
export function buildingMaterial(u: CityUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    patchVertex(shader);
    shader.fragmentShader = COMMON_FRAG + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec4 cTex = texture(cityTex, vec3(vCUv, vLayer));
        float cm = cMacro(vCWPos.xz);
        diffuseColor.rgb *= cTex.rgb * (0.9 + 0.18 * cm);
        // Грязь и сырость у земли: темнее и в зелень.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.52, 0.53, 0.42), vGrime * 0.7);
        // Снег — на горизонталях (кровли, карнизы, зубцы).
        float cUp = smoothstep(0.45, 0.8, vCNy) * cSnow;
        diffuseColor.rgb = mix(diffuseColor.rgb, cSnowCol, cUp * 0.92);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Свет окон: маска стекла слоя × «горит ли дом» × доля ночи; окно на окно — своё.
        float cWin = cHash(floor(vCWPos.xz * 0.7) + floor(vCWPos.y / 2.9) * 17.0);
        float cOn = step(0.32, cWin) * (0.65 + 0.35 * cWin);
        totalEmissiveRadiance += cWarm * cTex.a * vGlow * cNight * cOn * 1.6 * (1.0 - cUp);`,
      );
  };
  m.customProgramCacheKey = () => 'city-building';
  return m;
}

/** Карта земли: где лежит карта покрытий в мире. */
export interface GroundMap {
  x0: number;
  z0: number;
  size: number;
}

/**
 * Земля: смешение травы, земли, брусчатки и пашни по карте покрытий и по высоте фактуры (камни
 * брусчатки торчат из грязи), скала на крутом, затенение у подножий из альфы карты.
 */
export function groundMaterial(u: CityUniforms, map: THREE.Texture, at: GroundMap): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const extra = {
    cityMap: { value: map },
    cMapAt: { value: new THREE.Vector3(at.x0, at.z0, at.size) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, extra);
    patchVertex(shader);
    const T = (n: (typeof LAYERS)[number]): string => `vec2(${(1 / TILE_M[n][0]).toFixed(5)}, ${(1 / TILE_M[n][1]).toFixed(5)})`;
    shader.fragmentShader =
      /* glsl */ `uniform sampler2D cityMap;
      uniform vec3 cMapAt;
      ` +
      COMMON_FRAG +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 wp = vCWPos.xz;
        vec2 muv = (wp - cMapAt.xy) / cMapAt.z;
        vec4 cm4 = texture(cityMap, muv);
        float inMap = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
        cm4 = mix(vec4(0.0, 0.0, 0.0, 1.0), cm4, inMap);
        // Поворот плитки по клеткам 37 м — повтор травы не складывается в решётку.
        vec4 tg = texture(cityTex, vec3(wp * ${T('grass')}, ${L.grass}.0));
        vec4 tg2 = texture(cityTex, vec3(wp.yx * ${T('grass')} * 0.37 + 0.3, ${L.grass}.0));
        vec4 td = texture(cityTex, vec3(wp * ${T('dirt')}, ${L.dirt}.0));
        vec4 tc = texture(cityTex, vec3(wp * ${T('cobble')}, ${L.cobble}.0));
        vec4 tf = texture(cityTex, vec3(wp * ${T('field')}, ${L.field}.0));
        vec4 tr = texture(cityTex, vec3(vec2(wp.x + wp.y, vCWPos.y * 2.0) * ${T('rock')}, ${L.rock}.0));
        float macro = cMacro(wp * 0.35);
        vec3 grass = mix(tg.rgb, tg2.rgb, 0.35) * (0.82 + 0.3 * macro);
        // Веса: карта + высота фактуры; трава — остаток.
        float wc = cm4.r;
        float wd = cm4.g;
        float wf = cm4.b;
        float wr = smoothstep(0.42, 0.62, 1.0 - vCNy);
        float wg = max(0.0, 1.0 - wc - wd - wf);
        float hc = wc * 1.6 + tc.a * wc;
        float hd = wd * 1.3 + td.a * 0.5 * wd;
        float hf = wf * 1.3 + tf.a * 0.3 * wf;
        float hg = wg * 1.2 + tg.a * 0.6 * wg;
        float top = max(max(hc, hd), max(hf, hg)) - 0.28;
        vec4 bw = max(vec4(hc, hd, hf, hg) - top, 0.0);
        bw /= max(1e-4, bw.x + bw.y + bw.z + bw.w);
        vec3 col = tc.rgb * bw.x + td.rgb * bw.y + tf.rgb * bw.z + grass * bw.w;
        col = mix(col, tr.rgb, wr);
        // Осень и зима: трава желтеет, на горизонталях снег.
        col = mix(col, col * vec3(1.15, 0.95, 0.6), cAutumn * bw.w);
        float cUp = smoothstep(0.6, 0.9, vCNy) * cSnow;
        col = mix(col, cSnowCol * (0.9 + 0.1 * tg.a), cUp * (0.85 - 0.3 * bw.x));
        diffuseColor.rgb *= col * cm4.a;`,
      );
  };
  m.customProgramCacheKey = () => 'city-ground';
  return m;
}

/** Кроны и полог леса: листва слоя × тон; осенью к охре, зимой — снег сверху. */
export function foliageMaterial(u: CityUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    patchVertex(shader);
    shader.fragmentShader = COMMON_FRAG + shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
        vec4 cTex = texture(cityTex, vec3(vCUv, vLayer));
        vec3 leaf = cTex.rgb;
        // Лиственные (слой листвы) осенью к охре и рыжему; хвоя (тон темнее) — меньше.
        leaf = mix(leaf, leaf * vec3(1.6, 1.05, 0.45), cAutumn * vGrime);
        diffuseColor.rgb *= leaf;
        float cUp = smoothstep(0.35, 0.85, vCNy) * cSnow;
        diffuseColor.rgb = mix(diffuseColor.rgb, cSnowCol * 0.9, cUp * 0.8);`,
    );
  };
  m.customProgramCacheKey = () => 'city-foliage';
  return m;
}
