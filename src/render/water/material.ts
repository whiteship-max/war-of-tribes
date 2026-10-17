// Вода — одна на игру (docs/polish.md, П-8): материал прямой воды — река ролика боя и осады, река и море рыбалки.
// Вид — общий (`glsl.ts`), тот же, что у реки города: рябь по течению, круги дождя, пена на мелком, отражение неба с
// облаками, блик солнца, ночью лунная дорожка. В вершинах — только глубина (`wdepth`, м); течение у прямой воды одно
// (`wFlowDir`, `wFlow`), рамка — в осях меша. Числа часа и погоды место кладёт в униформы (`syncWaterLight`), луна над
// водой встаёт сама перед камерой (`water/moon.ts`).
import * as THREE from 'three';
import { WATER_GLSL } from './glsl';
import { moonOverWater } from './moon';
import { WATER_TONE } from './tone';

/** Сколько всплесков-кругов держит вода разом (поплавок, рыба): у реки ролика их нет. */
export const SPLASHES = 10;

/** Числа воды: часы, уровень, погода, свет, краски, течение. */
export interface WaterLook {
  wTime: { value: number };
  /** Уровень: 0 — низкий, 1 — средний, 2 — высокий; сторож плавности опускает его на ходу. */
  wLod: { value: number };
  wRain: { value: number };
  wCloud: { value: number };
  wNight: { value: number };
  wSunDir: { value: THREE.Vector3 };
  wSunCol: { value: THREE.Color };
  wMoonDir: { value: THREE.Vector3 };
  wSkyZen: { value: THREE.Color };
  wSkyHor: { value: THREE.Color };
  /** Что отражается у самого берега: зелень и земля, темнее неба. */
  wBank: { value: THREE.Color };
  wShallow: { value: THREE.Color };
  wDeep: { value: THREE.Color };
  wFoamCol: { value: THREE.Color };
  /** Течение: направление в осях меша и скорость, м/с (0 — стоячая вода, рябь гонит ветер). */
  wFlowDir: { value: THREE.Vector2 };
  wFlow: { value: number };
  /** Поворот меша по рысканию: рябь считается в осях меша, а свет — в осях мира. */
  wYaw: { value: number };
  /** Зыбь моря — вершины поднимаются медленными волнами (0 — нет). */
  wSwell: { value: number };
  /** Всплески: x, z в осях меша, секунда начала, сила. */
  wSplash: { value: THREE.Vector4[] };
}

export function waterLook(kind: 'river' | 'sea', lod: number): WaterLook {
  const tone = WATER_TONE[kind];
  return {
    wTime: { value: 0 },
    wLod: { value: lod },
    wRain: { value: 0 },
    wCloud: { value: 0 },
    wNight: { value: 0 },
    wSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    wSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    wMoonDir: { value: new THREE.Vector3(0, 0.6, 0.8) },
    wSkyZen: { value: new THREE.Color(0x6d93c4) },
    wSkyHor: { value: new THREE.Color(0xc9d8e2) },
    wBank: { value: new THREE.Color(0x26301c) },
    wShallow: { value: new THREE.Color(tone.shallow) },
    wDeep: { value: new THREE.Color(tone.deep) },
    wFoamCol: { value: new THREE.Color(tone.foam) },
    wFlowDir: { value: new THREE.Vector2(1, 0) },
    wFlow: { value: kind === 'river' ? 0.5 : 0 },
    wYaw: { value: 0 },
    wSwell: { value: kind === 'sea' ? 1 : 0 },
    wSplash: { value: Array.from({ length: SPLASHES }, () => new THREE.Vector4(0, 0, -99, 0)) },
  };
}

/** Краски и течение воды по месту: река течёт вдоль оси x меша, море стоит и дышит зыбью. */
export function toneWater(look: WaterLook, kind: 'river' | 'sea'): void {
  const tone = WATER_TONE[kind];
  look.wShallow.value.set(tone.shallow);
  look.wDeep.value.set(tone.deep);
  look.wFoamCol.value.set(tone.foam);
  look.wFlow.value = kind === 'river' ? 0.5 : 0;
  look.wSwell.value = kind === 'sea' ? 1 : 0;
}

const _sun = new THREE.Vector3();

/**
 * Час и погода — в воду из сцены: солнце (направление и цвет, ночью гаснет — светит луна над водой), небо у зенита и у
 * горизонта, доля ночи, дождь и облачность.
 */
export function syncWaterLight(
  look: WaterLook,
  o: { sun: THREE.DirectionalLight; zenith: THREE.Color; horizon: THREE.Color; night: number; rain?: number; cloud?: number },
): void {
  look.wSunDir.value.copy(_sun.copy(o.sun.position).sub(o.sun.target.position).normalize());
  look.wSunCol.value.copy(o.sun.color).multiplyScalar(Math.min(1.6, o.sun.intensity) * (1 - o.night));
  look.wSkyZen.value.copy(o.zenith);
  look.wSkyHor.value.copy(o.horizon);
  look.wNight.value = o.night;
  look.wRain.value = o.rain ?? 0;
  look.wCloud.value = o.cloud ?? 0;
}

const VERT_HEAD = /* glsl */ `
uniform float wTime;
uniform float wSwell;
attribute float wdepth;
varying vec3 vWWorld;
varying vec2 vWLocal;
varying float vWDepth;
`;

const VERT_BODY = /* glsl */ `#include <begin_vertex>
// Зыбь моря: вершины поднимаются медленными волнами; у реки — ровно.
transformed.y += wSwell * (0.07 * sin(dot(position.xz, vec2(0.11, 0.21)) + wTime * 0.9) + 0.04 * sin(dot(position.xz, vec2(-0.23, 0.13)) + wTime * 1.3));
vWLocal = position.xz;
vWDepth = wdepth;
`;

const VERT_WORLD = /* glsl */ `#include <project_vertex>
vWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_HEAD = /* glsl */ `#include <common>
uniform float wTime;
uniform float wLod;
uniform float wRain;
uniform float wCloud;
uniform float wNight;
uniform vec3 wSunDir;
uniform vec3 wSunCol;
uniform vec3 wMoonDir;
uniform vec3 wSkyZen;
uniform vec3 wSkyHor;
uniform vec3 wBank;
uniform vec3 wShallow;
uniform vec3 wDeep;
uniform vec3 wFoamCol;
uniform vec2 wFlowDir;
uniform float wFlow;
uniform float wYaw;
uniform vec4 wSplash[${SPLASHES}];
varying vec3 vWWorld;
varying vec2 vWLocal;
varying float vWDepth;
${WATER_GLSL}
// Всплеск: бегущее кольцо радиуса R с затуханием — наклон по радиусу (поплавок, рыба, брызги).
vec2 wSplashRing(vec2 p, vec2 c, float age, float amp) {
  vec2 d = p - c;
  float dist = length(d) + 1e-4;
  float x = dist - (0.12 + age * 0.85);
  return d / dist * exp(-x * x / (0.02 + 0.03 * age)) * amp * cos(x * 26.0);
}
`;

const FRAG_MAP = /* glsl */ `
vec2 fdir = wFlowDir;
vec2 fside = vec2(-fdir.y, fdir.x);
vec2 fq = vec2(dot(vWLocal, fdir), dot(vWLocal, fside));
float rough = 0.0;
vec2 g = wRipple(fq, wTime, wFlow, wLod, rough);
float wdeep = smoothstep(0.05, 1.1, vWDepth);
g *= mix(0.5, 1.0, wdeep);
vec2 gl = fdir * g.x + fside * g.y + wRain(vWLocal, wTime, wRain, wLod, rough);
for (int i = 0; i < ${SPLASHES}; i++) {
  vec4 r = wSplash[i];
  float age = wTime - r.z;
  if (r.w > 0.0 && age > 0.0 && age < 3.0) {
    float k = 1.0 - age / 3.0;
    gl += wSplashRing(vWLocal, r.xy, age, r.w * k * k * 0.09);
  }
}
// Наклон из осей меша — в оси мира (меш повёрнут рысканием).
float cr = cos(wYaw);
float sr = sin(wYaw);
vec2 gw = vec2(gl.x * cr + gl.y * sr, -gl.x * sr + gl.y * cr);
vec3 wn = normalize(vec3(-gw.x, 1.0, -gw.y));
vec3 wv = normalize(cameraPosition - vWWorld);
float fres = wFres(wn, wv);
float foam = wFoam(fq, vWDepth, wTime, wFlow);
vec3 body = wBody(vWDepth, wShallow, wDeep) * (0.9 + 0.2 * wNoise(vWLocal * 0.025));
// Пена — краска под светом сцены: ночью она серая, а не белая.
diffuseColor.rgb = mix(body * (1.0 - fres * 0.6), wFoamCol * 0.85, foam);
diffuseColor.a = max(smoothstep(0.0, 0.25, vWDepth), foam * 0.85 * smoothstep(0.0, 0.06, vWDepth));
`;

const FRAG_LIGHT = /* glsl */ `#include <emissivemap_fragment>
vec3 R = reflect(-wv, wn);
vec3 skyR = mix(wBank * (1.0 - 0.65 * wNight), wSkyOf(R, wSkyZen, wSkyHor, wCloud, wNight, wTime), smoothstep(0.1, 0.9, wdeep));
float clear = 1.0 / (1.0 + rough * 60.0);
vec3 em = skyR * fres * clear * wTilt(gw, wv);
vec3 moonCol = vec3(0.62, 0.7, 0.95) * wNight * (1.0 - 0.9 * wRain);
vec3 glint = wSun(R, normalize(wSunDir), wSunCol * (1.0 - 0.8 * wRain), rough) + wMoon(R, wMoonDir, moonCol, rough);
totalEmissiveRadiance += em + wKnee(glint) * (1.0 - foam * 0.7);
`;

/**
 * Меш прямой воды и её материал. `geo` — сетка с атрибутом `wdepth` (м), лицом вверх; `look` — униформы воды
 * (`waterLook`): их двигает место. Прозрачна у кромки, тень облаков и деревьев ложится на неё.
 */
export function waterMesh(geo: THREE.BufferGeometry, look: WaterLook, name: string): THREE.Mesh {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  m.name = name;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, look);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERT_HEAD}`)
      .replace('#include <begin_vertex>', VERT_BODY)
      .replace('#include <project_vertex>', VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_HEAD)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <emissivemap_fragment>', FRAG_LIGHT);
  };
  m.customProgramCacheKey = () => 'water-p8';
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.userData.water = look;
  // Луна над водой — перед камерой: дорожка ложится в кадр с любого ракурса.
  mesh.onBeforeRender = (_r, _s, camera) => {
    moonOverWater(camera, look.wMoonDir.value);
  };
  return mesh;
}

/** Сторож плавности опустил уровень: вода под `root` считает не больше `lod`, без пересборки. */
export function lowerWaterLook(root: THREE.Object3D, lod: number): void {
  root.traverse((o) => {
    const w = o.userData.water as { wLod: { value: number } } | undefined;
    if (w) w.wLod.value = Math.min(w.wLod.value, lod);
  });
}
