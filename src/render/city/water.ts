// Вода города (docs/city.md, 11.6 и 12.3; docs/polish.md, П-8): река в западной долине и мельничный ручей лесопилки —
// одна лента, один вызов. Лента доходит до кромки, где плоскость воды встречает склон русла, и несёт в вершинах
// глубину, течение и метку ручья. Вид воды — общий (`render/water`): рябь по течению без повтора, круги дождя, пена у
// кромки, отражение неба, блик солнца, ночью лунная дорожка и отблески огней у воды; здесь — только то, что своё у
// города: лёд от берегов зимой (ручей у мельницы бежит быстро и не мёрзнет). Уровень — `CITY_SPEC.detail`, сторож
// плавности опускает его на ходу (`lowerWater`).
import * as THREE from 'three';
import { WATER_LIGHTS, waterGeometry } from './banks';
import { GRADE_GLSL, graded, misted, type CityUniforms } from './material';
import type { V3 } from './geom';
import { WATER_GLSL } from '../water/glsl';
import { WATER_TONE } from '../water/tone';
import { moonOverWater } from '../water/moon';

const VERT = /* glsl */ `
uniform mat4 cFrame;
attribute float wdepth;
attribute vec2 wflow;
attribute float wrun;
attribute float wrace;
varying vec3 vWPos;
varying float vDepth;
varying vec2 vFlow;
varying float vRun;
varying float vRace;
`;

const FRAG = /* glsl */ `
uniform float cTime;
uniform float cNight;
uniform float cSnow;
uniform vec3 cSunDir;
uniform vec3 cSky;
uniform float cRain;
uniform float cCloud;
uniform float cIce;
uniform vec3 cSnowCol;
uniform vec3 cTorchCol;
uniform vec4 cWaterLights[${WATER_LIGHTS}];
uniform float wLod;
uniform vec3 wShallow;
uniform vec3 wDeep;
uniform vec3 wFoamCol;
uniform vec3 wMoonDir;
varying vec3 vWPos;
varying float vDepth;
varying vec2 vFlow;
varying float vRun;
varying float vRace;
${WATER_GLSL}
${GRADE_GLSL}
`;

/** Числа воды, свои у ленты: уровень (сторож опускает его на ходу), краски толщи, луна над водой. */
export interface WaterUniforms {
  wLod: { value: number };
  wShallow: { value: THREE.Color };
  wDeep: { value: THREE.Color };
  wFoamCol: { value: THREE.Color };
  wMoonDir: { value: THREE.Vector3 };
}

/**
 * Вода: лента и её материал. `cols` — колонны реки поперёк (`SHORE_CAP.cols`), `detail` — уровень
 * (`CITY_SPEC.detail`), `lights` — огни у воды (`banks.waterLights`): их отблеск ложится на воду ночью.
 */
export function buildWater(u: CityUniforms, cols: readonly number[], detail: 0 | 1 | 2, lights: readonly V3[]): THREE.Mesh {
  const a = waterGeometry(cols);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  // Нормаль вверх задана явно; грани — лицом вверх (обход в `banks.ribbon`), с двух сторон — на всякий ракурс.
  const nor = new Float32Array(a.pos.length);
  for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('wdepth', new THREE.BufferAttribute(a.depth, 1));
  g.setAttribute('wflow', new THREE.BufferAttribute(a.flow, 2));
  g.setAttribute('wrun', new THREE.BufferAttribute(a.run, 1));
  g.setAttribute('wrace', new THREE.BufferAttribute(a.race, 1));
  g.setIndex(new THREE.BufferAttribute(a.idx, 1));
  g.computeBoundingSphere();
  // Огни у воды — свои числа: шейдер воды не обходит всех огней города, только ближние к ней.
  const wl = {
    value: Array.from({ length: WATER_LIGHTS }, (_, k) =>
      lights[k] ? new THREE.Vector4(lights[k][0], lights[k][1], lights[k][2], 9 * 9) : new THREE.Vector4(0, -1000, 0, 1),
    ),
  };
  const tone = WATER_TONE.river;
  const wu: WaterUniforms = {
    wLod: { value: detail },
    wShallow: { value: new THREE.Color(tone.shallow) },
    wDeep: { value: new THREE.Color(tone.deep) },
    wFoamCol: { value: new THREE.Color(tone.foam) },
    wMoonDir: { value: new THREE.Vector3(0, 0.6, 0.8) },
  };
  // Край воды — кромка: где глубина уходит в ноль, вода тает в прозрачность, и под ней — ил берега (`material.ts`).
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, wu, { cWaterLights: wl });
    shader.vertexShader =
      VERT +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vDepth = wdepth;
      vFlow = wflow;
      vRun = wrun;
      vRace = wrace;
      vWPos = (cFrame * (modelMatrix * vec4(transformed, 1.0))).xyz;`,
      );
    shader.fragmentShader = graded(
      FRAG +
        shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            /* glsl */ `
            // Рамка течения: вдоль — пройдено по течению (лента гнётся по руслу, рябь — за ней), поперёк — по месту.
            vec2 fdir = normalize(vFlow);
            vec2 fside = vec2(-fdir.y, fdir.x);
            vec2 fq = vec2(vRun, dot(vWPos.xz, fside));
            float flowV = mix(0.45, 1.3, vRace);
            float rough = 0.0;
            vec2 g = wRipple(fq, cTime, flowV, wLod, rough);
            // На мелководье у берега тише, в стрежне — живее; ручей у мельницы бежит быстрее и рябит сильнее.
            float deep = smoothstep(0.05, 1.1, vDepth);
            g *= mix(0.45, 1.0, deep) * mix(1.0, 1.4, vRace);
            vec2 gw = fdir * g.x + fside * g.y + wRain(vWPos.xz, cTime, cRain, wLod, rough);
            vec3 wn = normalize(vec3(-gw.x, 1.0, -gw.y));
            vec3 wv = normalize(cameraPosition - vWPos);
            float fres = wFres(wn, wv);
            // Пятна омутов и отмелей крупным шумом по миру: толща не ровная заливка.
            vec3 body = wBody(vDepth, wShallow, wDeep) * (0.9 + 0.2 * wNoise(vWPos.xz * 0.025));
            float foam = wFoam(fq, vDepth, cTime, flowV) + vRace * smoothstep(0.72, 0.95, wNoise(fq * vec2(0.4, 2.2) - vec2(cTime * 1.6, 0.0))) * 0.18;
            // Зима: река замерзает от берегов, кромка льда — неровными заберегами по течению; стрежень остаётся тёмной
            // открытой водой, ручей у мельницы бежит и не мёрзнет.
            float iceN = 0.5 + 0.5 * sin(vRun * 0.07 + 1.3 * sin(vRun * 0.023)) * sin(vRun * 0.031 + fq.y * 0.05 + 0.7);
            // Лёд — по холоду пояса (\`cIce\`): на Сицилии река не мёрзнет и после снегопада.
            float ice = cIce * (1.0 - vRace) * smoothstep(0.5, 0.75, (1.0 - deep) * 0.9 + iceN * 0.3 + cIce * 0.15);
            foam *= 1.0 - ice;
            vec3 iceCol = vec3(0.62, 0.68, 0.74);
            if (wLod > 0.5) {
              // Снег на льду — переметами, и тёмные трещины.
              float drift = smoothstep(0.55, 0.8, sin(vWPos.x * 0.37 + vWPos.z * 0.11) * 0.5 + 0.5 + iceN * 0.3);
              iceCol = mix(iceCol, cSnowCol, drift * 0.8);
              float crack = 1.0 - smoothstep(0.0, 0.05, abs(sin(vWPos.x * 0.9 + sin(vWPos.z * 0.55) * 2.2) * sin(vWPos.z * 0.7 + vWPos.x * 0.2)));
              iceCol *= 1.0 - crack * 0.35 * (1.0 - drift);
            }
            // Пена и лёд — краска под светом сцены: ночью они серые, а не белые пятна.
            diffuseColor.rgb = mix(mix(body * (1.0 - fres * 0.6), wFoamCol * 0.85, foam), iceCol, ice);
            diffuseColor.a = max(smoothstep(0.0, 0.3, vDepth) * mix(0.9, 1.0, deep), foam * 0.85 * smoothstep(0.0, 0.08, vDepth));`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `#include <emissivemap_fragment>
            // Небо в воде: у горизонта — дымка, к зениту синее; ночью дымка тёмная — и отражение тоже. У берега в воде
            // отражается берег — зелень и земля, темнее неба: вода не голубая лента, а зеркало долины.
            vec3 R = reflect(-wv, wn);
            vec3 skyR = wSkyOf(R, cSky * vec3(0.55, 0.72, 1.05), cSky, cCloud, cNight, cTime);
            skyR = mix(vec3(0.07, 0.09, 0.05) * mix(1.0, 0.35, cNight), skyR, smoothstep(0.15, 0.95, deep));
            // Мутная рябь (дождь, даль) зеркалит слабее.
            float clear = 1.0 / (1.0 + rough * 60.0);
            vec3 em = skyR * fres * clear * wTilt(gw, wv);
            // Светила: днём — солнце (тучи его гасят), ночью — луна над водой; в дождь луны нет.
            vec3 sunCol = vec3(1.0, 0.95, 0.84) * 1.5 * (1.0 - cNight) * (1.0 - 0.8 * cRain);
            vec3 moonCol = vec3(0.62, 0.7, 0.95) * cNight * (1.0 - 0.9 * cRain);
            vec3 glint = wSun(R, normalize(cSunDir), sunCol, rough) + wMoon(R, wMoonDir, moonCol, rough);
            if (wLod > 0.5 && cNight > 0.02) {
              // Огни у воды ночью: отблеск дрожит по ряби там, где отражённый луч смотрит на огонь.
              for (int i = 0; i < ${WATER_LIGHTS}; i++) glint += wTorch(R, vWPos, cWaterLights[i], cTorchCol, rough) * cNight;
            }
            em += wKnee(glint) * (1.0 - foam * 0.7);
            totalEmissiveRadiance += em * (1.0 - ice * 0.85);`,
          ),
    );
    misted(shader);
  };
  m.customProgramCacheKey = () => 'city-water-p8';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'city-water';
  mesh.receiveShadow = true;
  mesh.userData.water = wu;
  // Луна над водой — перед камерой (`water/moon.ts`): дорожка ложится в кадр с любого ракурса.
  mesh.onBeforeRender = (_r, _s, camera) => {
    moonOverWater(camera, wu.wMoonDir.value);
  };
  // Прозрачное рисуется после земли: кромка ложится на ил берега.
  mesh.renderOrder = 1;
  return mesh;
}

/** Сторож плавности опустил уровень: вода под `root` считает не больше `detail` — та же дверь, что у воды роликов. */
export { lowerWaterLook as lowerWater } from '../water/material';
