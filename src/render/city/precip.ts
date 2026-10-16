// Осадки над городом (docs/city.md, 15; docs/polish.md, П-3): дождь, брызги и снегопад — своя докачка
// (`vite.config.ts`, `LAZY_DOORS` «город: погода»), сцена тянет её вместе с суетой после первого кадра города.
//
// Всё — функция часов сцены: капля и снежинка лежат в коробке, падают и сносятся ветром в вершинном шейдере (место —
// дробная часть времени со сдвигом), коробка заворачивает их по краям — кадру считать нечего, кроме ручек.
//
// Дождь — три слоя, а не палочки одной краски:
// - **струи у города** — полоски вдоль скорости капли (вниз и по ветру, с порывами), толщиной не тоньше пикселя
//   экрана, с мягким краем и хвостом; цвет — от неба (капля светлее тёмной кровли и темнее неба, как в жизни), ночью
//   у фонарей капли ловят тёплый свет; сила дождя ходит полосами, которые несёт ветер (ливень идёт стенами, а не
//   ровной сеткой); струя кончается на кровле, земле или воде (поле высот, `heights.ts`);
// - **ближние струи у камеры** — редкие, крупные, полупрозрачные: глубина кадра и параллакс при движении камеры;
// - **брызги** — короны на кровлях, мостовой и воде: точка на поверхности по полю высот (середина клетки, край
//   карниза — без брызг), растёт кольцом и гаснет за четверть секунды.
// Снег — хлопья у города (оседают на поверхности) и крупные мягкие у камеры.
//
// Уровни (`PRECIP_CAP`): на «Низком» — меньше струй и хлопьев, без брызг и без поля высот (капля гаснет по возрасту);
// сторож плавности, опустив уровень, режет счёт сразу (`setLevel`) — одна мерка «тянет ли телефон» на всю сцену.
import * as THREE from 'three';
import type { Quality } from '../quality';
import { HeightRaster, NO_HEIGHT, SPLASH_KINK, type HeightField, type Surface } from './heights';

export interface PrecipCap {
  /** Струй у города и у камеры. */
  rain: number;
  near: number;
  /** Брызг на поверхностях (одновременно горит около трети). */
  splash: number;
  /** Хлопьев у города и у камеры. */
  snow: number;
  flakes: number;
  /** Клеток поля высот по стороне; 0 — поля нет. */
  map: number;
}

/** Сколько чего по уровню. Средний — бюджет телефона среднего класса (docs/polish.md, П-3, «Цена»). */
export const PRECIP_CAP: Record<Quality, PrecipCap> = {
  low: { rain: 900, near: 90, splash: 0, snow: 700, flakes: 60, map: 0 },
  medium: { rain: 2400, near: 240, splash: 1400, snow: 1700, flakes: 140, map: 768 },
  high: { rain: 4800, near: 480, splash: 3000, snow: 3400, flakes: 280, map: 1024 },
};

/** Поле высот: квадрат вокруг поводка камеры с запасом на коробку дождя (`camera.CITY_LEASH` ± 210 м). */
export const HEIGHT_AREA = { x0: -465, z0: -490, span: 960 } as const;

/** Сколько миллисекунд кадра отдаётся полю высот, пока оно не готово. */
const RASTER_MS = 2;

/** Что сцена говорит осадкам каждый кадр. */
export interface PrecipFrame {
  /** Часы сцены, с. */
  t: number;
  rain: number;
  snow: number;
  /** Куда дует (единичный, оси мира) и сила 0..1. */
  windX: number;
  windZ: number;
  wind: number;
  /** Цель камеры и её расстояние: коробка дождя у города растёт с ним. */
  center: THREE.Vector3;
  dist: number;
  camera: THREE.PerspectiveCamera;
  /** Высота буфера в пикселях: толщина струи — не тоньше пикселя. */
  bufferHeight: number;
  /** Яркость дня (ночью капли тёмные), вспышка молнии, доля ночи (свет фонарей на каплях). */
  light: number;
  flash: number;
  night: number;
  /** Цвет неба и дымки: от него цвет капли. */
  sky: THREE.Color;
  fogNear: number;
  fogFar: number;
}

/** Огни города для капель ночью — те же, что у шейдеров города (`material.cLights`). */
export interface PrecipLights {
  cLights: { value: THREE.Vector4[] };
  cTorchCol: { value: THREE.Color };
}

interface PrecipUniforms {
  [k: string]: THREE.IUniform;
  pTime: { value: number };
  pRain: { value: number };
  pSnow: { value: number };
  pCenter: { value: THREE.Vector3 };
  pBox: { value: number };
  pNearC: { value: THREE.Vector3 };
  pNearBox: { value: number };
  pSplashBox: { value: number };
  pWind: { value: THREE.Vector2 };
  pSnowWind: { value: THREE.Vector2 };
  pLight: { value: number };
  pFlash: { value: number };
  pNight: { value: number };
  pSky: { value: THREE.Color };
  pScale: { value: number };
  pFog: { value: THREE.Vector2 };
  pHeight: { value: THREE.Texture | null };
  pHeightAt: { value: THREE.Vector4 };
  pHeightOn: { value: number };
  pLights: { value: THREE.Vector4[] };
  pTorch: { value: THREE.Color };
}

const COMMON = (lights: number): string => /* glsl */ `
uniform float pTime;
uniform float pRain;
uniform float pSnow;
uniform vec3 pCenter;
uniform float pBox;
uniform vec3 pNearC;
uniform float pNearBox;
uniform float pSplashBox;
uniform vec2 pWind;
uniform vec2 pSnowWind;
uniform float pLight;
uniform float pFlash;
uniform float pNight;
uniform vec3 pSky;
uniform float pScale;
uniform vec2 pFog;
uniform sampler2D pHeight;
uniform vec4 pHeightAt;
uniform float pHeightOn;
uniform vec4 pLights[${lights}];
uniform vec3 pTorch;
float pHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Верх города под точкой (поле высот); поля нет или точка за краем — далеко внизу.
float pGround(vec2 xz) {
  vec2 uv = (xz - pHeightAt.xy) * pHeightAt.z;
  if (pHeightOn < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return ${NO_HEIGHT.toFixed(1)};
  return textureLod(pHeight, uv, 0.0).r;
}
// Ливень идёт полосами: густота дождя в этом месте, полосы несёт ветер.
float pBand(vec2 xz) {
  vec2 q = (xz - pWind * pTime * 0.8) * 0.0055;
  float n = sin(q.x * 1.7 + sin(q.y * 1.3) * 1.5) * sin(q.y * 1.9 + sin(q.x * 0.9) * 1.2);
  return 0.62 + 0.48 * n;
}
// Ночью у фонарей капля и хлопья ловят тёплый свет.
float pGlow(vec3 p) {
  float acc = 0.0;
  for (int i = 0; i < ${lights}; i++) {
    vec3 d = p - pLights[i].xyz;
    float a = max(0.0, 1.0 - dot(d, d) / (pLights[i].w * 3.0));
    acc += a * a;
  }
  return min(acc, 1.2);
}
`;

/** Струя: полоска вдоль скорости капли, `position.x` — сторона (−1, 1), `position.y` — голова (0) или хвост (1). */
const RAIN_VERT = /* glsl */ `
attribute vec4 drop;
attribute vec2 jit;
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
void main() {
#ifdef NEAR
  vec3 C = pNearC;
  float B = pNearBox;
  float H = B;
  float top = 0.5;
#else
  vec3 C = pCenter;
  float B = pBox;
  float H = B * 0.55;
  float top = 0.75;
#endif
  float fall = 8.0 + 2.5 * jit.x;
  float age = fract(pTime * fall / H + drop.z);
  vec2 rel = mod(drop.xy * B + pWind * pTime - C.xz + B * 0.5, B) - B * 0.5;
  vec3 head = vec3(C.x + rel.x, C.y + H * (top - age), C.z + rel.y);
  float edge = 1.0 - smoothstep(0.4, 0.5, max(abs(rel.x), abs(rel.y)) / B);
  // Порывы: косина дышит, место от места по-своему.
  float gust = 0.85 + 0.15 * sin(pTime * 0.9 + head.x * 0.021 + head.z * 0.013) + 0.1 * sin(pTime * 2.3 + drop.z * 6.283);
  vec3 dir = normalize(vec3(pWind.x * gust, -fall, pWind.y * gust));
  float d = max(distance(head, cameraPosition), 1.0);
  float px = d / pScale;
#ifdef NEAR
  float len = (0.6 + 0.6 * jit.y) * (0.25 + d * 0.035);
  float wide = max(0.012, px * 2.4);
  float alpha = 0.3 * smoothstep(5.0, 14.0, d) * edge;
#else
  float len = (0.5 + 0.6 * jit.y) * (0.6 + d * 0.012);
  float wide = max(0.005, px * 2.0);
  // Тоньше пикселя капля не бывает: дальняя струя — пиксель шириной и бледнее (та же доля света на экране).
  float alpha = (0.5 + 0.5 * jit.y) * 0.6 * edge * (1.0 - 0.75 * smoothstep(pFog.x, pFog.y, d)) * clamp(0.005 / wide, 0.6, 1.0);
#endif
  vec3 tail = head - dir * len;
#ifndef NEAR
  // Капля кончается на кровле, земле или воде.
  float g = pGround(head.xz);
  if (head.y < g) {
    alpha *= step(g, tail.y);
    head = tail + (head - tail) * clamp((tail.y - g) / max(tail.y - head.y, 1e-3), 0.0, 1.0);
  }
#endif
  float on = step(drop.w, pRain * pBand(head.xz) * 1.1) * step(0.002, alpha);
  if (on < 0.5) {
    // Не идёт — полоска в точку за экраном: ни пикселя заливки.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vA = 0.0;
    vUv = vec2(0.0);
    vCol = vec3(0.0);
    return;
  }
  vec3 side = normalize(cross(dir, head - cameraPosition));
  vec3 p = mix(head, tail, position.y) + side * position.x * wide;
  // Капля — линза: светлее тёмной кровли и темнее неба; от неба и берёт цвет.
  vec3 col = (pSky * 1.12 + 0.07) * pLight;
#ifndef NEAR
  if (pNight > 0.05) {
    float gl = pGlow(head) * pNight;
    col += pTorch * gl * 0.9;
    alpha *= 1.0 + gl * 0.7;
  }
#endif
  vCol = col + pFlash * 0.9;
  vA = alpha;
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
void main() {
  // Мягкий край поперёк и хвост вдоль: размазанная движением капля, а не палочка. Середина поперёк ровная: полоска в
  // два пикселя иначе теряла бы свет между центрами пикселей.
  float across = 1.0 - smoothstep(0.4, 1.0, abs(vUv.x));
  float along = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  gl_FragColor = vec4(vCol, vA * across * along);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Брызги: у точки свой цикл; в каждом цикле — новое место в коробке у цели камеры, поставленное в середину клетки
 * поля высот (тот же счёт, что `heights.splashSpot`): край карниза и пустая клетка — брызг нет.
 */
const SPLASH_VERT = /* glsl */ `
attribute vec4 seed;
varying float vA;
varying float vF;
varying float vPx;
varying vec3 vCol;
void main() {
  float rate = 1.1 + 0.9 * seed.w;
  float cyc = pTime * rate + seed.z * 13.0;
  float c = floor(cyc);
  float f = fract(cyc) / 0.3;
  vec2 r = vec2(pHash(seed.xy * 91.7 + c * 0.618), pHash(seed.yx * 53.3 + c * 0.371 + 4.1));
  vec2 rel = (r - 0.5) * pSplashBox;
  float n = pHeightAt.w;
  vec2 uv = (pCenter.xz + rel - pHeightAt.xy) * pHeightAt.z;
  vec2 cell = floor(uv * n);
  float ok = step(1.0, cell.x) * step(1.0, cell.y) * step(cell.x, n - 2.0) * step(cell.y, n - 2.0);
  vec2 tc = (cell + 0.5) / n;
  float tx = 1.0 / n;
  float hC = textureLod(pHeight, tc, 0.0).r;
  float hL = textureLod(pHeight, tc - vec2(tx, 0.0), 0.0).r;
  float hR = textureLod(pHeight, tc + vec2(tx, 0.0), 0.0).r;
  float hD = textureLod(pHeight, tc - vec2(0.0, tx), 0.0).r;
  float hU = textureLod(pHeight, tc + vec2(0.0, tx), 0.0).r;
  float kink = max(abs(hL + hR - 2.0 * hC), abs(hD + hU - 2.0 * hC));
  ok *= step(${(NO_HEIGHT * 0.5).toFixed(1)}, min(min(hC, min(hL, hR)), min(hD, hU))) * step(kink, ${SPLASH_KINK.toFixed(2)});
  ok *= step(f, 1.0) * step(pHash(seed.zw + c * 0.13), pRain * pBand(pCenter.xz + rel)) * pHeightOn;
  // Ближе к краю коробки — реже: граница брызг не видна.
  ok *= 1.0 - smoothstep(0.3, 0.5, max(abs(rel.x), abs(rel.y)) / pSplashBox);
  if (ok < 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vA = 0.0;
    vF = 0.0;
    vPx = 0.0;
    vCol = vec3(0.0);
    return;
  }
  // Место внутри клетки — по скату поверхности: брызги не висят над кровлей и не тонут в ней.
  float cellM = 1.0 / (pHeightAt.z * n);
  vec2 j = (vec2(pHash(seed.zw + c), pHash(seed.wz + c * 1.3)) - 0.5) * cellM;
  vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * cellM);
  vec3 p = vec3(pHeightAt.x + tc.x / pHeightAt.z + j.x, hC + dot(grad, j) + 0.05, pHeightAt.y + tc.y / pHeightAt.z + j.y);
  // К камере на четверть метра: точка — плоский квадрат, скат за ней не должен резать корону.
  p += normalize(cameraPosition - p) * 0.25;
  float d = max(distance(p, cameraPosition), 1.0);
  float size = (0.1 + 0.32 * f) * pScale / d;
  gl_PointSize = clamp(size, 2.2, 48.0);
  vPx = gl_PointSize;
  vA = ok * pow(1.0 - f, 0.7) * clamp(size / 2.2, 0.8, 1.0) * (1.0 - 0.7 * smoothstep(pFog.x, pFog.y, d));
  vF = f;
  vec3 col = (pSky * 1.6 + 0.2) * pLight;
  if (pNight > 0.05) col += pTorch * pGlow(p) * pNight * 1.8;
  vCol = col + pFlash;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
varying float vA;
varying float vF;
varying float vPx;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  // Удар — яркая точка, потом корона кольцом расходится; верх короны (брошенные капли) ярче. В три-четыре пикселя
  // корону не нарисовать — там брызги ровный блёсткий кружок.
  float ring = exp(-pow((r - mix(0.2, 0.85, vF)) / 0.17, 2.0)) * (0.55 + 0.45 * smoothstep(0.2, -0.6, q.y));
  float core = (1.0 - vF) * exp(-r * r * 9.0);
  float crown = ring * 0.8 + core;
  float dot1 = 1.0 - smoothstep(0.6, 1.0, r);
  float a = mix(dot1, crown, smoothstep(3.0, 8.0, vPx)) * vA * step(r, 1.0);
  gl_FragColor = vec4(vCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Хлопья: точки, кружат петлями, оседают на поверхности; у камеры — крупные и мягкие. */
const SNOW_VERT = /* glsl */ `
attribute vec4 drop;
attribute vec2 jit;
varying float vA;
varying vec3 vCol;
void main() {
#ifdef NEAR
  vec3 C = pNearC;
  float B = pNearBox;
  float H = B;
  float top = 0.5;
#else
  vec3 C = pCenter;
  float B = pBox;
  float H = B * 0.55;
  float top = 0.75;
#endif
  float fall = 0.9 + 0.7 * jit.x;
  float age = fract(pTime * fall / H + drop.z);
  vec2 rel = mod(drop.xy * B + pSnowWind * pTime - C.xz + B * 0.5, B) - B * 0.5;
  vec3 p = vec3(C.x + rel.x, C.y + H * (top - age), C.z + rel.y);
  float sw = drop.x * 40.0 + drop.y * 17.0;
  p.x += sin(pTime * (0.9 + jit.x) + sw) * 0.7;
  p.z += cos(pTime * (0.7 + jit.y) + sw * 1.7) * 0.7;
  p.y += sin(pTime * 1.7 + sw * 2.3) * 0.15;
  float alpha = (1.0 - smoothstep(0.4, 0.5, max(abs(rel.x), abs(rel.y)) / B)) * step(drop.w, pSnow * (0.7 + 0.3 * pBand(p.xz)));
  float d = max(distance(p, cameraPosition), 1.0);
  float sizeM = 0.025 + 0.035 * jit.y;
  float s = sizeM * pScale / d;
#ifdef NEAR
  // Мимо камеры — крупные мягкие хлопья не в фокусе.
  s = clamp(s * 3.5, 3.0, 34.0);
  alpha *= 0.5 * smoothstep(3.0, 9.0, d);
#else
  // Хлопок оседает: у поверхности гаснет, под ней его нет.
  float g = pGround(p.xz);
  alpha *= smoothstep(g - 0.05, g + 0.5, p.y) * (1.0 - 0.7 * smoothstep(pFog.x, pFog.y, d)) * clamp(s / 2.0, 0.6, 1.0) * 0.95;
  s = max(s, 2.0);
#endif
  if (alpha < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vA = 0.0;
    vCol = vec3(0.0);
    return;
  }
  gl_PointSize = s;
  vec3 col = vec3(0.94, 0.95, 0.98) * (0.12 + 0.88 * pLight);
  if (pNight > 0.05) col += pTorch * pGlow(p) * pNight * 1.4;
  vCol = col + pFlash * 0.8;
  vA = alpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const SNOW_FRAG = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
#ifdef NEAR
  float a = (1.0 - r2) * (1.0 - r2);
#else
  float a = 1.0 - smoothstep(0.25, 1.0, r2);
#endif
  gl_FragColor = vec4(vCol, vA * a * step(r2, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Сеяный ряд 0..1: у каждой частицы свои место, сдвиг возраста и порог «идёт ли при такой силе». */
function seeded(salt: number): () => number {
  let x = 0x2545f491 ^ salt;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function instanced(n: number, size: number, salt: number): THREE.InstancedBufferAttribute {
  const next = seeded(salt);
  const a = new Float32Array(n * size);
  for (let i = 0; i < a.length; i++) a[i] = next();
  return new THREE.InstancedBufferAttribute(a, size);
}

function plain(n: number, size: number, salt: number): THREE.BufferAttribute {
  const next = seeded(salt);
  const a = new Float32Array(n * size);
  for (let i = 0; i < a.length; i++) a[i] = next();
  return new THREE.BufferAttribute(a, size);
}

function material(u: PrecipUniforms, lights: number, vert: string, frag: string, near: boolean, key: string): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: COMMON(lights) + vert,
    fragmentShader: frag,
    defines: near ? { NEAR: 1 } : {},
    transparent: true,
    depthWrite: false,
    // Полоска разворачивается к камере сама (сторона — поперёк взгляда), и обход её граней зависит от ветра: обе стороны.
    side: THREE.DoubleSide,
  });
  m.customProgramCacheKey = () => key;
  return m;
}

/** Струи одним вызовом: полоска на каплю экземплярами. */
function rainMesh(n: number, u: PrecipUniforms, lights: number, near: boolean): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.setAttribute('drop', instanced(n, 4, near ? 11 : 1));
  g.setAttribute('jit', instanced(n, 2, near ? 12 : 3));
  g.instanceCount = n;
  const mesh = new THREE.Mesh(g, material(u, lights, RAIN_VERT, RAIN_FRAG, near, near ? 'city-rain-near' : 'city-rain'));
  mesh.name = near ? 'city-rain-near' : 'city-rain';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = near ? 3 : 2;
  return mesh;
}

function pointsOf(n: number, attrs: Record<string, [number, number]>, mat: THREE.ShaderMaterial, name: string): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  for (const [k, [size, salt]] of Object.entries(attrs)) g.setAttribute(k, plain(n, size, salt));
  const p = new THREE.Points(g, mat);
  p.name = name;
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

const IDENTITY = new THREE.Matrix4();

/** Треугольники меша в мировых координатах — для поля высот. */
export function surfaceOf(mesh: THREE.Mesh): Surface | null {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos || pos.itemSize !== 3 || (pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
  mesh.updateWorldMatrix(true, false);
  let positions = pos.array as ArrayLike<number>;
  if (!mesh.matrixWorld.equals(IDENTITY)) {
    const out = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    positions = out;
  }
  return { positions, index: mesh.geometry.index ? (mesh.geometry.index.array as ArrayLike<number>) : null };
}

/** Поле высот текстурой: полуплавающие числа, без сглаживания — край кровли не размазывается в воздух. */
function heightTexture(f: HeightField): THREE.DataTexture {
  const half = new Uint16Array(f.h.length);
  for (let i = 0; i < f.h.length; i++) half[i] = THREE.DataUtils.toHalfFloat(f.h[i]);
  const tex = new THREE.DataTexture(half, f.n, f.n, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const QUALITY_ORDER: readonly Quality[] = ['high', 'medium', 'low'];
const FWD = new THREE.Vector3();

/** Осадки города: дождь струями и брызгами, снег хлопьями. */
export class CityPrecip {
  readonly group = new THREE.Group();
  private rain: THREE.Mesh | null;
  private nearRain: THREE.Mesh | null;
  private splash: THREE.Points | null;
  private snow: THREE.Points | null;
  private flakes: THREE.Points | null;
  private raster: HeightRaster | null;
  /** Поверхности для поля высот даны: без них поле пустое, и брызгам не на что лечь. */
  private fed = false;
  private u: PrecipUniforms;
  private built: PrecipCap;
  private level: Quality;

  constructor(quality: Quality, lights?: PrecipLights) {
    const cap = PRECIP_CAP[quality];
    this.built = cap;
    this.level = quality;
    this.group.name = 'city-precip';
    const lamps = lights?.cLights.value ?? [new THREE.Vector4(0, -1e4, 0, 1)];
    this.u = {
      pTime: { value: 0 },
      pRain: { value: 0 },
      pSnow: { value: 0 },
      pCenter: { value: new THREE.Vector3() },
      pBox: { value: 120 },
      pNearC: { value: new THREE.Vector3() },
      pNearBox: { value: 40 },
      pSplashBox: { value: 120 },
      pWind: { value: new THREE.Vector2() },
      pSnowWind: { value: new THREE.Vector2() },
      pLight: { value: 1 },
      pFlash: { value: 0 },
      pNight: { value: 0 },
      pSky: { value: new THREE.Color(0.6, 0.65, 0.7) },
      pScale: { value: 1000 },
      pFog: { value: new THREE.Vector2(400, 1200) },
      pHeight: { value: null },
      pHeightAt: { value: new THREE.Vector4(HEIGHT_AREA.x0, HEIGHT_AREA.z0, 1 / HEIGHT_AREA.span, Math.max(1, cap.map)) },
      pHeightOn: { value: 0 },
      pLights: { value: lamps },
      pTorch: { value: lights?.cTorchCol.value ?? new THREE.Color(1, 0.6, 0.3) },
    };
    const u = this.u;
    const n = lamps.length;
    this.rain = cap.rain > 0 ? rainMesh(cap.rain, u, n, false) : null;
    this.nearRain = cap.near > 0 ? rainMesh(cap.near, u, n, true) : null;
    this.splash =
      cap.splash > 0 && cap.map > 0
        ? pointsOf(cap.splash, { seed: [4, 5] }, material(u, n, SPLASH_VERT, SPLASH_FRAG, false, 'city-splash'), 'city-splash')
        : null;
    this.snow = cap.snow > 0 ? pointsOf(cap.snow, { drop: [4, 2], jit: [2, 6] }, material(u, n, SNOW_VERT, SNOW_FRAG, false, 'city-snowfall'), 'city-snowfall') : null;
    this.flakes =
      cap.flakes > 0 ? pointsOf(cap.flakes, { drop: [4, 7], jit: [2, 8] }, material(u, n, SNOW_VERT, SNOW_FRAG, true, 'city-snow-near'), 'city-snow-near') : null;
    if (this.splash) this.splash.renderOrder = 2;
    for (const o of [this.rain, this.nearRain, this.splash, this.snow, this.flakes]) if (o) this.group.add(o);
    this.raster = cap.map > 0 ? new HeightRaster(HEIGHT_AREA.x0, HEIGHT_AREA.z0, HEIGHT_AREA.span, cap.map) : null;
  }

  /** Есть ли что рисовать на этом уровне. */
  get any(): boolean {
    return this.group.children.length > 0;
  }

  /** Готово ли поле высот (капли кончаются на поверхностях, брызги стоят на них). */
  get grounded(): boolean {
    return this.u.pHeightOn.value > 0.5;
  }

  /** Поверхности города для поля высот: кровли, земля, вода. Растеризуются кусками, когда впервые пошли осадки. */
  ground(meshes: readonly THREE.Mesh[]): void {
    if (!this.raster) return;
    for (const m of meshes) {
      const s = surfaceOf(m);
      if (!s) continue;
      this.raster.add(s);
      this.fed = true;
    }
  }

  /** Поле высот — разом, не кусками: стенду, чтобы снять дождь с брызгами, не дожидаясь кадров. */
  groundNow(): void {
    if (!this.raster || !this.fed || this.grounded) return;
    this.raster.step();
    this.lay();
  }

  private lay(): void {
    if (!this.raster) return;
    this.u.pHeight.value = heightTexture(this.raster.field);
    this.u.pHeightOn.value = 1;
  }

  /**
   * Уровень опустил сторож плавности: счёт струй, брызг и хлопьев — сразу, по числам нового уровня (не выше собранного).
   * Выше собранного не поднимает.
   */
  setLevel(q: Quality): void {
    if (QUALITY_ORDER.indexOf(q) < QUALITY_ORDER.indexOf(this.level)) return;
    this.level = q;
    const c = PRECIP_CAP[q];
    const b = this.built;
    if (this.rain) (this.rain.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(c.rain, b.rain);
    if (this.nearRain) (this.nearRain.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(c.near, b.near);
    this.splash?.geometry.setDrawRange(0, Math.min(c.splash, b.splash));
    this.snow?.geometry.setDrawRange(0, Math.min(c.snow, b.snow));
    this.flakes?.geometry.setDrawRange(0, Math.min(c.flakes, b.flakes));
  }

  /** Сколько чего рисуется сейчас — счёт уровня (тест цены и стенд). */
  counts(): { rain: number; near: number; splash: number; snow: number; flakes: number } {
    const inst = (m: THREE.Mesh | null): number => (m ? (m.geometry as THREE.InstancedBufferGeometry).instanceCount : 0);
    const pts = (p: THREE.Points | null): number => (p ? Math.min(p.geometry.drawRange.count, p.geometry.getAttribute('position').count) : 0);
    return { rain: inst(this.rain), near: inst(this.nearRain), splash: pts(this.splash), snow: pts(this.snow), flakes: pts(this.flakes) };
  }

  /** Кадр. */
  update(f: PrecipFrame): void {
    const u = this.u;
    const wet = f.rain > 0.01;
    const white = f.snow > 0.01;
    // Поле высот — кусками, пока идут осадки: ясная погода его не ждёт и за него не платит.
    if (this.raster && this.fed && (wet || white) && !this.grounded) {
      const now = typeof performance === 'undefined' ? () => 0 : () => performance.now();
      if (this.raster.step(RASTER_MS, now)) this.lay();
    }
    u.pTime.value = f.t;
    u.pRain.value = f.rain;
    u.pSnow.value = f.snow;
    u.pCenter.value.copy(f.center);
    u.pBox.value = Math.min(420, Math.max(70, f.dist * 0.9));
    u.pSplashBox.value = Math.min(u.pBox.value, 240);
    // Ближний слой — перед камерой: глубина кадра и параллакс.
    const near = Math.min(60, Math.max(8, f.dist * 0.1));
    f.camera.getWorldDirection(FWD);
    u.pNearC.value.copy(f.camera.position).addScaledVector(FWD, near);
    u.pNearBox.value = near * 1.6;
    u.pScale.value = f.bufferHeight / (2 * Math.tan((f.camera.fov * Math.PI) / 360));
    u.pFog.value.set(f.fogNear, f.fogFar);
    u.pLight.value = f.light;
    u.pFlash.value = f.flash;
    u.pNight.value = f.night;
    u.pSky.value.copy(f.sky);
    // Дождь косит ветер до пяти метров в секунду, снег несёт до трёх.
    u.pWind.value.set(f.windX, f.windZ).multiplyScalar(0.6 + 4.4 * f.wind);
    u.pSnowWind.value.set(f.windX, f.windZ).multiplyScalar(0.4 + 2.6 * f.wind);
    if (this.rain) this.rain.visible = wet;
    if (this.nearRain) this.nearRain.visible = wet;
    if (this.splash) this.splash.visible = wet && this.grounded;
    if (this.snow) this.snow.visible = white;
    if (this.flakes) this.flakes.visible = white;
  }

  dispose(): void {
    for (const o of [this.rain, this.nearRain, this.splash, this.snow, this.flakes]) {
      if (!o) continue;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.u.pHeight.value?.dispose();
    this.u.pHeight.value = null;
  }
}
