// Материалы вида «город» (docs/city.md, разделы 3 и 6): массив слоёв текстур (`sampler2DArray`) и
// Ламберт с правкой шейдера. Один материал на все здания, свой — у земли (смешение покрытий по карте
// и по высоте) и у крон. Новых имён three не заводит: массив слоёв — `Texture` с признаком массива
// (`DataArrayTexture` тянул бы своё имя в кусок three первой загрузки), Ламберт и `onBeforeCompile` —
// те же, что у окружения `next`.
import * as THREE from 'three';
import { CITY, linear } from './palette';
import { L, LAYERS, TILE_M } from './tex';
import { CITY_WIND, WIND_CALM } from './life';


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
  /** Огни ночи: (x, y, z, r²) — факелы стены и ворот, фонари площади; пустые — далеко внизу. */
  cLights: { value: THREE.Vector4[] };
  cTorchCol: { value: THREE.Color };
  /** Выбранная постройка — байт владельца вершины (`sites.ownerCode`), 0 — ничего; и сила подсветки. */
  cSel: { value: number };
  cSelGlow: { value: number };
  /** Направление на светило и цвет неба (дымки) — блик и отражение воды (`water.ts`). */
  cSunDir: { value: THREE.Vector3 };
  cSky: { value: THREE.Color };
  /**
   * Погода (docs/city.md, 15; числа — `render/climate.weatherAt`): сырость кровель и мостовой, сила теней облаков и их
   * сдвиг по ветру (метры, функция часов сцены), утренний туман в низинах, дождь на реке (круги), ветер — куда дует
   * (единичный, оси мира) и сила: им вьются флаги, сносит дым, качаются камыш и кроны.
   */
  cWet: { value: number };
  cCloud: { value: number };
  cCloudAt: { value: THREE.Vector2 };
  cMist: { value: number };
  cRain: { value: number };
  cWindDir: { value: THREE.Vector2 };
  cWind: { value: number };
}

/** Сколько огней видит шейдер: тёплые пятна без точечных ламп (их цена — на каждый пиксель). */
export const CITY_LIGHTS = 32;

export function cityUniforms(): CityUniforms {
  const w = linear(CITY.windowWarm);
  const s = linear(CITY.snow);
  const t = linear(CITY.torch);
  return {
    cityTex: { value: null },
    cNight: { value: 0 },
    cSnow: { value: 0 },
    cAutumn: { value: 0 },
    cTime: { value: 0 },
    cWarm: { value: new THREE.Color(w[0], w[1], w[2]) },
    cSnowCol: { value: new THREE.Color(s[0], s[1], s[2]) },
    cLights: { value: Array.from({ length: CITY_LIGHTS }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    cTorchCol: { value: new THREE.Color(t[0], t[1], t[2]) },
    cSel: { value: 0 },
    cSelGlow: { value: 0 },
    cSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
    cSky: { value: new THREE.Color(0.5, 0.6, 0.7) },
    cWet: { value: 0 },
    cCloud: { value: 0 },
    cCloudAt: { value: new THREE.Vector2() },
    cMist: { value: 0 },
    cRain: { value: 0 },
    cWindDir: { value: new THREE.Vector2(CITY_WIND.x, CITY_WIND.z) },
    cWind: { value: WIND_CALM },
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
varying float vOwner;
varying float vSeed;
`;

/**
 * Погода в шейдере: тени облаков — пятна в пару сотен метров, бегут по ветру (`cCloudAt`); пока облаков нет, ветка не
 * считается. Тень гасит только прямой свет солнца — рассеянный остаётся.
 */
const WEATHER_GLSL = /* glsl */ `
uniform vec3 cSky;
uniform float cWet;
uniform float cCloud;
uniform vec2 cCloudAt;
float cCloudShade(vec2 p) {
  if (cCloud < 0.02) return 1.0;
  vec2 q = (p - cCloudAt) * 0.0045;
  float n = sin(q.x + sin(q.y * 0.7) * 1.6) * sin(q.y * 1.13 + sin(q.x * 0.55) * 1.9);
  n += 0.5 * sin(q.x * 2.3 - q.y * 1.7 + 1.3) * sin(q.y * 2.1 + q.x * 0.9);
  n = n * 0.34 + 0.5;
  float cover = mix(0.78, 0.3, cCloud);
  return 1.0 - smoothstep(cover - 0.1, cover + 0.1, n) * 0.72;
}
// Сырость: мокрое темнее, горизонтали — сильнее стен.
vec3 cWetten(vec3 c, float up) {
  return c * mix(1.0, mix(0.82, 0.62, up), cWet);
}
// Блик мокрого: небо в лужах и на кровлях — у края взгляда сильнее (нормаль и взгляд — в осях камеры).
vec3 cSheen(vec3 n, vec3 v, float up, vec3 sky) {
  float ndv = max(dot(normalize(n), normalize(v)), 0.0);
  float fres = 0.03 + 0.55 * pow(1.0 - ndv, 4.0);
  return sky * fres * cWet * up;
}
`;

/**
 * Утренний туман в низинах (docs/city.md, 15): к дальней дымке — молочная мгла там, где земля низко (долина реки ниже
 * −4 м, город стоит на +7). Своё мировое «y» вершины — в любом материале: кроны и камыш — экземплярами.
 */
export function misted(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = 'varying float vMistY;\n' + shader.vertexShader.replace(
    '#include <fog_vertex>',
    /* glsl */ `#include <fog_vertex>
    vec4 cMistP = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      cMistP = instanceMatrix * cMistP;
    #endif
    vMistY = (modelMatrix * cMistP).y;`,
  );
  shader.fragmentShader = 'uniform float cMist;\nvarying float vMistY;\n' + shader.fragmentShader.replace(
    '#include <fog_fragment>',
    /* glsl */ `#ifdef USE_FOG
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      float cLow = 1.0 - smoothstep(-13.0, -3.0, vMistY);
      fogFactor = max(fogFactor, cMist * cLow * smoothstep(6.0, 120.0, vFogDepth) * 0.92);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif`,
  );
}

/** Тени облаков на прямом свете — после сложения света. */
const clouded = (src: string): string =>
  src.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directDiffuse *= cCloudShade(vCWPos.xz);');

/** Цветокоррекция города: чуть глуше насыщенность и тёплый подъём теней — «осадная карта», а не игрушка. */
export const GRADE_GLSL = /* glsl */ `
vec3 cGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.82);
  return c * vec3(1.02, 1.0, 0.96);
}
`;

const COMMON_FRAG = /* glsl */ `
uniform highp sampler2DArray cityTex;
uniform float cNight;
uniform float cSnow;
uniform float cAutumn;
uniform vec3 cWarm;
uniform vec3 cSnowCol;
uniform vec4 cLights[${CITY_LIGHTS}];
uniform vec3 cTorchCol;
uniform float cSel;
uniform float cSelGlow;
varying float vOwner;
varying float vSeed;
varying vec2 vCUv;
varying float vLayer;
varying float vGlow;
varying float vGrime;
varying vec3 vCWPos;
varying float vCNy;
float cTorch(vec3 p) {
  float acc = 0.0;
  for (int i = 0; i < ${CITY_LIGHTS}; i++) {
    vec4 l = cLights[i];
    vec3 d = p - l.xyz;
    float a = max(0.0, 1.0 - dot(d, d) / l.w);
    acc += a * a * a;
  }
  return min(acc, 1.5);
}
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
${GRADE_GLSL}
${WEATHER_GLSL}
float cMacro(vec2 p) {
  return sin(p.x * 0.13 + sin(p.y * 0.071) * 2.0) * sin(p.y * 0.11 + sin(p.x * 0.053) * 2.0) * 0.5 + 0.5;
}
`;

/** Цветокоррекция перед выходом: та же для всех материалов города (и воды, камыша и камней — `water.ts`, `shore.ts`). */
export const graded = (src: string): string => src.replace('#include <opaque_fragment>', 'outgoingLight = cGrade(outgoingLight);\n#include <opaque_fragment>');

/** Вершинная часть: свои атрибуты, мировое положение и вертикальность нормали (для снега). */
function patchVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = COMMON_VERT + shader.vertexShader.replace(
    '#include <begin_vertex>',
    /* glsl */ `#include <begin_vertex>
    vCUv = cuv;
    vLayer = cfg.x;
    vGlow = cfg.y / 255.0;
    vGrime = cfg.z / 255.0;
    vOwner = cfg.w;
    vec4 cwp = vec4(transformed, 1.0);
    vec3 cwn = objectNormal;
    // Своё число экземпляра (дерева) — от его места: осенью кроны желтеют и краснеют вразнобой.
    vSeed = 0.0;
    #ifdef USE_INSTANCING
      cwp = instanceMatrix * cwp;
      cwn = mat3(instanceMatrix) * cwn;
      vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
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
        // Кровли 50–60° (нормаль 0.5–0.64 вверх) держат снег: порог ниже, чем у земли.
        float cUp = smoothstep(0.3, 0.55, vCNy) * cSnow;
        diffuseColor.rgb = mix(diffuseColor.rgb, cSnowCol * (0.85 + 0.15 * cTex.r), cUp * 0.9);
        // Дождь: мокрое темнее — кровли и карнизы сильнее стен; под снегом сырости нет.
        float cWetUp = smoothstep(0.2, 0.7, vCNy) * (1.0 - cUp);
        diffuseColor.rgb = cWetten(diffuseColor.rgb, cWetUp);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Свет окон: маска стекла слоя × «горит ли дом» × доля ночи; окно на окно — своё. Свечение ниже 0.95 —
        // ровное (храм, проезд ворот): высокий витраж и арка выше ячейки окна, ячейки резали бы их в шахматку.
        float cWin = cHash(floor(vCWPos.xz * 0.7) + floor(vCWPos.y / 2.9) * 17.0);
        float cOn = mix(1.0, step(0.32, cWin) * (0.65 + 0.35 * cWin), step(0.95, vGlow));
        // Ровный свет идёт сквозь стекло своего цвета: витраж ночью — цветная мозаика, серый ход ворот — тёплый.
        vec3 cHue = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.001));
        vec3 cLamp = mix(cWarm * cHue * 1.25, cWarm, step(0.95, vGlow));
        totalEmissiveRadiance += cLamp * cTex.a * vGlow * cNight * cOn * 1.6 * (1.0 - cUp);
        totalEmissiveRadiance += diffuseColor.rgb * cTorchCol * cTorch(vCWPos) * cNight * 1.6;
        // Выбранная постройка светлеет пульсом — вся: все дома Жилищ, все башни, вся стена.
        float cIsSel = step(0.5, cSel) * (1.0 - step(0.5, abs(vOwner - cSel)));
        totalEmissiveRadiance += (diffuseColor.rgb * 0.55 + cWarm * 0.06) * cIsSel * cSelGlow;
        // Мокрые кровли ловят небо.
        totalEmissiveRadiance += cSheen(normal, vViewPosition, cWetUp, cSky) * 0.6 * (1.0 - 0.7 * cNight);`,
      );
    shader.fragmentShader = clouded(graded(shader.fragmentShader));
    misted(shader);
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
export function groundMaterial(u: CityUniforms, map: THREE.Texture, at: GroundMap, land: THREE.Texture, landAt: GroundMap): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const extra = {
    cityMap: { value: map },
    cMapAt: { value: new THREE.Vector3(at.x0, at.z0, at.size) },
    cityLand: { value: land },
    cLandAt: { value: new THREE.Vector3(landAt.x0, landAt.z0, landAt.size) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, extra);
    patchVertex(shader);
    // Сырость берега — в вершинах земли (`banks.groundWet`: по высоте над водой); между вершинами — плавно.
    shader.vertexShader = 'attribute float cwet;\nvarying float vWet;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n    vWet = cwet;');
    const T = (n: (typeof LAYERS)[number]): string => `vec2(${(1 / TILE_M[n][0]).toFixed(5)}, ${(1 / TILE_M[n][1]).toFixed(5)})`;
    shader.fragmentShader =
      /* glsl */ `uniform sampler2D cityMap;
      uniform vec3 cMapAt;
      uniform sampler2D cityLand;
      uniform vec3 cLandAt;
      varying float vWet;
      ` +
      COMMON_FRAG +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 wp = vCWPos.xz;
        vec2 muv = (wp - cMapAt.xy) / cMapAt.z;
        vec4 cm4 = texture(cityMap, muv);
        float inMap = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
        vec4 land = texture(cityLand, (wp - cLandAt.xy) / cLandAt.z);
        cm4 = mix(vec4(0.0, 0.0, land.g, 1.0), cm4, inMap);
        // Поворот плитки по клеткам 37 м — повтор травы не складывается в решётку.
        vec4 tg = texture(cityTex, vec3(wp * ${T('grass')}, ${L.grass}.0));
        vec4 tg2 = texture(cityTex, vec3(wp.yx * ${T('grass')} * 0.37 + 0.3, ${L.grass}.0));
        vec4 td = texture(cityTex, vec3(wp * ${T('dirt')}, ${L.dirt}.0));
        vec4 tc = texture(cityTex, vec3(wp * ${T('cobble')}, ${L.cobble}.0));
        vec4 tf = texture(cityTex, vec3(wp * ${T('field')}, ${L.field}.0));
        vec4 tr = texture(cityTex, vec3(vec2(wp.x + wp.y, vCWPos.y * 2.0) * ${T('rock')}, ${L.rock}.0));
        float macro = cMacro(wp * 0.35);
        vec3 grass = mix(tg.rgb, tg2.rgb, 0.4) * (0.9 + 0.16 * macro);
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
        // Мостовая крупными пятнами: темнее у стен, светлее посередине улиц, кое-где старая и новая кладка.
        float cmac = cMacro(wp * 1.7 + 13.0);
        vec3 cob = tc.rgb * vec3(0.92, 0.88, 0.82) * (0.62 + 0.3 * cmac) * mix(0.72, 1.0, cm4.a);
        // У стен домов в швах больше грязи.
        cob = mix(cob, td.rgb * 0.8, (1.0 - cm4.a) * 0.35);
        vec3 col = cob * bw.x + td.rgb * bw.y + tf.rgb * bw.z + grass * bw.w;
        col = mix(col, tr.rgb, wr);
        // Полог дальнего леса: листва слоя в масштабе крон (клетка — 5–6 м) и пятна пород.
        vec4 cp1 = texture(cityTex, vec3(wp / 170.0, ${L.foliage}.0));
        vec4 cp2 = texture(cityTex, vec3(wp.yx / 61.0 + 0.4, ${L.foliage}.0));
        vec3 canopy = mix(cp1.rgb, cp2.rgb, 0.35) * vec3(0.55, 0.62, 0.55) * (0.75 + 0.35 * macro);
        col = mix(col, canopy, smoothstep(0.08, 0.4, land.r) * (1.0 - wr * 0.5));
        // Берег воды: под водой и у кромки — тёмный ил, выше — сырая земля, ещё выше — влажная трава (banks.groundWet).
        float silt = smoothstep(0.62, 0.9, vWet);
        float damp = smoothstep(0.0, 0.62, vWet) * (1.0 - silt);
        col = mix(col, col * vec3(0.62, 0.66, 0.56), damp);
        col = mix(col, vec3(0.15, 0.13, 0.09) * (0.82 + 0.36 * td.a), silt);
        // Осень и зима: трава желтеет, на горизонталях снег.
        col = mix(col, col * vec3(1.15, 0.95, 0.6), cAutumn * bw.w);
        float cUp = smoothstep(0.6, 0.9, vCNy) * cSnow;
        col = mix(col, cSnowCol * (0.9 + 0.1 * tg.a), cUp * (0.85 - 0.3 * bw.x));
        // Дождь: мостовая и земля темнеют, в выбоинах — лужи (низкие места фактуры, крупные пятна по миру).
        float cPud = smoothstep(0.55, 0.85, macro) * (1.0 - smoothstep(0.25, 0.5, mix(td.a, tc.a, bw.x))) * (bw.x + bw.y);
        float cWetUp = (0.55 + 0.45 * bw.x + 0.6 * cPud) * (1.0 - cUp);
        col = cWetten(col, min(1.0, cWetUp));
        diffuseColor.rgb *= col * cm4.a;`,
      ).replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * cTorchCol * cTorch(vCWPos) * cNight * 1.8;
        // Мокрая мостовая и лужи зеркалят небо, ночью — тёплые огни.
        totalEmissiveRadiance += cSheen(normal, vViewPosition, cWetUp * (0.35 + 0.65 * max(bw.x, cPud)), cSky + cTorchCol * cTorch(vCWPos) * cNight) * (1.0 - 0.6 * cNight);`,
      );
    shader.fragmentShader = clouded(graded(shader.fragmentShader));
    misted(shader);
  };
  m.customProgramCacheKey = () => 'city-ground';
  return m;
}

/**
 * Кроны и полог леса: листва слоя × тон; осенью к охре, зимой — снег сверху. `ragged` (высокий уровень) рвёт
 * край кроны: на силуэте низкие места листвы (альфа слоя — высота) отбрасываются, и шар становится кружевом.
 * Только на высоком: `discard` в шейдере снимает раннюю проверку глубины, телефону это дорого.
 */
export function foliageMaterial(u: CityUniforms, ragged = false): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    patchVertex(shader);
    // Тон экземпляра (зелень породы) — отдельно: зиме и снегу он не указ, а `color_fragment` умножает на него всё.
    shader.vertexShader = 'varying vec3 vInst;\n' + shader.vertexShader.replace(
      '#include <color_vertex>',
      /* glsl */ `#include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        vInst = instanceColor.rgb;
      #else
        vInst = vec3(1.0);
      #endif`,
    );
    if (ragged) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        // Край кроны: чем ближе грань к ребру взгляда, тем выше порог листвы — между пучками видно небо.
        float cRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        // Зимой голая крона сквозная: просветы между пучками вырезаны по всей кроне, не только по краю.
        if (cTex.a < max(smoothstep(0.5, 0.92, cRim) * 0.85, 0.55 * cSnow * vGrime)) discard;`,
      );
    }
    shader.fragmentShader = 'varying vec3 vInst;\n' + COMMON_FRAG + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec4 cTex = texture(cityTex, vec3(vCUv, vLayer));
        vec3 leaf = cTex.rgb;
        // Лиственные (слой листвы) осенью — вразнобой: золото, рыжее, ржавое, у кого-то ещё зелень.
        vec3 fall = vSeed < 0.38 ? vec3(1.55, 1.2, 0.32) : vSeed < 0.7 ? vec3(1.65, 0.86, 0.3) : vSeed < 0.88 ? vec3(1.35, 0.55, 0.28) : vec3(1.1, 1.05, 0.55);
        leaf = mix(leaf, leaf * fall, cAutumn * vGrime);
        diffuseColor.rgb *= leaf;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // Тон вершины без тона экземпляра: затенение кома снизу и светлая листва модели.
        vec3 cShade = vColor.rgb / max(vInst, vec3(0.02));
        // Зимой лиственные голые: на месте пучков листвы (альфа слоя — высота) — тёмная сеть ветвей, в
        // просветах между пучками — светлое небо сквозь крону. Яркость листвы — не мерка: в дальнем мипе она
        // ровная, и крона выходила сплошным оливковым комом.
        // Высота листвы: просветы — у нуля (треть слоя), пучки — от 0.4 до 0.9.
        float twig = smoothstep(0.15, 0.4, cTex.a);
        vec3 bare = mix(vec3(0.34, 0.35, 0.38), vec3(0.055, 0.045, 0.04), twig) * cShade;
        diffuseColor.rgb = mix(diffuseColor.rgb, bare, cSnow * vGrime * 0.92);
        // Снег сверху; на голых ветвях он почти не лежит — шапка в 2.5 раза тоньше, чем на хвое.
        float cUp = smoothstep(0.35, 0.85, vCNy) * cSnow * (1.0 - 0.6 * vGrime);
        diffuseColor.rgb = mix(diffuseColor.rgb, cSnowCol * 0.9 * cShade, cUp * 0.8);`,
      );
    // Ветер качает кроны: макушка сильнее, дерево — своим ходом (зерно места), сила — от погоды.
    shader.vertexShader = 'uniform vec2 cWindDir;\nuniform float cWind;\nuniform float cTime;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `vec4 mvPosition = vec4(transformed, 1.0);
      float cBase = 0.0;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        cBase = instanceMatrix[3].y;
      #endif
      float cH = max(mvPosition.y - cBase, 0.0);
      float cGust = 0.55 + 0.3 * sin(cTime * 1.6 + vSeed * 6.28) + 0.15 * sin(cTime * 3.7 + vSeed * 17.0);
      mvPosition.xz += cWindDir * cH * (0.006 + 0.03 * cWind * cWind) * cGust;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
    shader.fragmentShader = clouded(graded(shader.fragmentShader));
    misted(shader);
  };
  m.customProgramCacheKey = () => (ragged ? 'city-foliage-ragged' : 'city-foliage');
  return m;
}
