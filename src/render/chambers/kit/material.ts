// Материал набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): почти без освещения, как у моделей
// классического Warcraft III — свет и тень нарисованы в листах, а шейдер добавляет только общий свет сцены (день и ночь
// покоев одним цветом, `uTint`) и тонкий контурный свет со стороны окна (`uRim`, `uRimDir`). Ни металла, ни PBR. Изнанка
// (юбка и плащ изнутри, волосы у лица) — тёмной заливкой. Выбранная пальцем — светлее и ободом, как всё в покоях
// (`material.uSel`).
import * as THREE from 'three';
import { INSIDE_DEPTH_GLSL } from '../../city/inside';

export interface FigureUniforms {
  [k: string]: THREE.IUniform;
  bodyMap: { value: THREE.Texture | null };
  faceMap: { value: THREE.Texture | null };
  uOrigin: { value: THREE.Vector3 };
  uTint: { value: THREE.Color };
  uRim: { value: THREE.Color };
  uRimDir: { value: THREE.Vector3 };
  uSel: { value: number };
  uSelGlow: { value: number };
  uCode: { value: number };
}

const VERT = /* glsl */ `
attribute float sheet;
attribute float shade;
uniform vec3 uOrigin;
varying vec2 vUv;
varying float vSheet;
varying float vShade;
varying vec3 vN;
varying vec3 vL;
void main() {
  vUv = uv;
  vSheet = sheet;
  vShade = shade;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vL = wp.xyz - uOrigin;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #ifdef INSIDE
  ${INSIDE_DEPTH_GLSL}
  #endif
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D bodyMap;
uniform sampler2D faceMap;
uniform vec3 uOrigin;
uniform vec3 uTint;
uniform vec3 uRim;
uniform vec3 uRimDir;
uniform float uSel;
uniform float uSelGlow;
uniform float uCode;
varying vec2 vUv;
varying float vSheet;
varying float vShade;
varying vec3 vN;
varying vec3 vL;
void main() {
  // Оба листа читаются всегда (производные выборки — вне ветвления), выбирает вершина.
  vec3 b = texture2D(bodyMap, vUv).rgb;
  vec3 f = texture2D(faceMap, vUv).rgb;
  vec3 albedo = mix(b, f, step(0.5, vSheet)) * vShade;
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - uOrigin - vL);
  float back = gl_FrontFacing ? 0.0 : 1.0;
  n = mix(n, -n, back);
  // Свет сцены одним цветом, чуть объёма от окна; изнанка — тёмная заливка.
  vec3 col = albedo * uTint * mix(0.9 + 0.16 * max(dot(n, uRimDir), 0.0), 0.3, back);
  // Тонкий контур со стороны окна — по бокам силуэта, не на макушке; цвет — свет окна, смешанный с тоном самого материала
  // (на тёмных волосах чистый свет неба дал бы серую полосу, а не блик).
  float fr = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 rimCol = uRim * mix(vec3(1.0), albedo * 2.2, 0.55);
  col += rimCol * fr * smoothstep(-0.25, 0.75, dot(n, uRimDir)) * (1.0 - 0.8 * max(n.y, 0.0)) * (1.0 - back);
  float sel = step(0.5, uSel) * (1.0 - step(0.5, abs(uCode - uSel)));
  col += (albedo * 0.35 + vec3(1.0, 0.78, 0.45) * (0.05 + 0.45 * fr)) * sel * uSelGlow;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Лист в текстуру: sRGB, мип-уровни, края не повторяются (зеркало без шва). */
export function sheetTexture(rgba: Uint8Array<ArrayBuffer>, size: number, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  t.name = name;
  t.colorSpace = THREE.SRGBColorSpace;
  // Края — `ClampToEdgeWrapping`, умолчание `DataTexture`: эта постоянная нигде больше в игре не нужна, и имя её здесь
  // меняло кусок three первой загрузки (без него кусок — байт в байт как до ЛЦ-2).
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Материал фигуры. `shared` — ручки покоев, которые правит кадр комнаты (выбор пальцем, начало комнаты): их объекты
 * общие, а не копии. `inside` — глубина в доле буфера под комнату (`city/inside`), как у всего в покоях.
 */
export function figureMaterial(body: THREE.Texture, face: THREE.Texture, code: number, inside: boolean, shared: { uOrigin: { value: THREE.Vector3 }; uSel: { value: number }; uSelGlow: { value: number } } | undefined, name: string): { material: THREE.ShaderMaterial; u: FigureUniforms } {
  const u: FigureUniforms = {
    bodyMap: { value: body },
    faceMap: { value: face },
    uOrigin: shared?.uOrigin ?? { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uRim: { value: new THREE.Color(0.25, 0.27, 0.3) },
    uRimDir: { value: new THREE.Vector3(0.5, 0.3, 0.8).normalize() },
    uSel: shared?.uSel ?? { value: 0 },
    uSelGlow: shared?.uSelGlow ?? { value: 0 },
    uCode: { value: code },
  };
  const material = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, defines: inside ? { INSIDE: 1 } : {} });
  // Свет и тень нарисованы в листах: тональное сжатие сцены съело бы светлые тона кожи и плоско выровняло лицо.
  material.toneMapped = false;
  material.name = name;
  return { material, u };
}
