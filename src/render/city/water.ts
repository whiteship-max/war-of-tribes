// Вода города (docs/city.md, 11.6 и 12.3): река в западной долине и мельничный ручей лесопилки — одна лента, один
// вызов. Лента доходит до кромки, где плоскость воды встречает склон русла, и несёт в вершинах глубину, течение и
// метку ручья: цвет — мелководье у берега и глубь посередине, отражение неба по Френелю (к зениту синее), рябь бежит
// по течению, у берега тише, блик и искры солнца, ночью — луна и отблески огней у воды, зимой — лёд от берегов (ручей
// у мельницы бежит быстро и не мёрзнет). Уровень качества — `CITY_SPEC.detail`: на низком одна рябь и без огней.
import * as THREE from 'three';
import { WATER_LIGHTS, waterGeometry } from './banks';
import { GRADE_GLSL, graded, misted, type CityUniforms } from './material';
import type { V3 } from './geom';

const VERT = /* glsl */ `
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
uniform float cIce;
uniform vec3 cSnowCol;
uniform vec3 cTorchCol;
uniform vec4 cWaterLights[${WATER_LIGHTS}];
varying vec3 vWPos;
varying float vDepth;
varying vec2 vFlow;
varying float vRun;
varying float vRace;
${GRADE_GLSL}
`;

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
      lights[k] ? new THREE.Vector4(lights[k][0], lights[k][1], lights[k][2], 16 * 16) : new THREE.Vector4(0, -1000, 0, 1),
    ),
  };
  // Край воды — кромка: где глубина уходит в ноль, вода тает в прозрачность, и под ней — ил берега (`material.ts`).
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  m.defines = { WATER_DETAIL: detail };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { cWaterLights: wl });
    shader.vertexShader =
      VERT +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vDepth = wdepth;
      vFlow = wflow;
      vRun = wrun;
      vRace = wrace;
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = graded(
      FRAG +
        shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            /* glsl */ `
            // Рябь — в рамке течения: вдоль (пройдено по течению) и поперёк; бежит вниз по течению, у ручья быстрее.
            vec2 fdir = normalize(vFlow);
            vec2 fside = vec2(-fdir.y, fdir.x);
            float along = vRun;
            float across = dot(vWPos.xz, fside);
            float sp = mix(1.0, 2.3, vRace);
            float t = cTime;
            // Октава ряби гаснет, когда её волна короче нескольких пикселей: вдали частая рябь мерцала бы сеткой.
            float px = max(fwidth(along), fwidth(across));
            float o0 = 1.0 - smoothstep(0.1, 0.25, px * 0.6 / 6.283);
            float o1 = 1.0 - smoothstep(0.1, 0.25, px * 1.9 / 6.283);
            float o2 = 1.0 - smoothstep(0.1, 0.25, px * 4.7 / 6.283);
            // Основная рябь — две волны вкось друг к другу, с изогнутыми гребнями и пятнами силы: одна волна легла бы
            // ровными полосами поперёк реки, две прямые — решёткой.
            float bA = along + 1.8 * sin(across * 0.19 + along * 0.05 + t * 0.1);
            float bC = across + 1.3 * sin(along * 0.13 - across * 0.07);
            float patchA = 0.6 + 0.4 * sin(along * 0.071 + across * 0.33 + t * 0.2) * sin(along * 0.023 - across * 0.19);
            vec2 g = vec2(
              sin(bA * 0.55 - t * 1.4 * sp + bC * 0.25) + 0.8 * sin(bA * 0.41 - t * 1.2 * sp - bC * 0.37),
              0.35 * sin(bC * 0.6 + bA * 0.2 - t * 0.7) + 0.5 * sin(bC * 0.47 - bA * 0.29 + t * 0.6)
            ) * 0.06 * patchA * o0;
            #if WATER_DETAIL >= 1
              g += vec2(sin(along * 1.7 + across * 0.9 - t * 2.6 * sp), sin(across * 1.9 - along * 0.7 + t * 1.9)) * 0.06 * o1;
            #endif
            #if WATER_DETAIL >= 2
              g += vec2(sin(along * 4.3 - across * 2.1 - t * 4.1 * sp), sin(across * 4.7 + along * 1.3 - t * 3.3)) * 0.03 * o2;
            #endif
            #if WATER_DETAIL >= 1
              // Дождь: капли бьют кругами — в клетке 1.6 м своя капля, свой миг и своё место; круг расходится и гаснет.
              if (cRain > 0.01) {
                vec2 rp = vWPos.xz / 1.6;
                vec2 ci = floor(rp);
                for (int k = 0; k < 2; k++) {
                  vec2 cc = ci + vec2(float(k) * 0.5);
                  vec2 rf = rp - cc - 0.5;
                  float hs = fract(sin(dot(cc, vec2(41.3, 289.1))) * 43758.5453);
                  vec2 off = vec2(fract(hs * 13.7), fract(hs * 71.3)) - 0.5;
                  vec2 d = rf - off * 0.5;
                  float r = length(d);
                  float ph = fract(t * (0.8 + 0.4 * hs) + hs * 7.0);
                  float R = ph * 0.55;
                  float on = step(hs, cRain * 0.9 + 0.05) * (1.0 - ph) * smoothstep(0.0, 0.08, ph);
                  float ring = sin((r - R) * 38.0) * (1.0 - smoothstep(0.0, 0.09, abs(r - R)));
                  vec2 dn = d / max(r, 1e-3);
                  g += vec2(dot(dn, fdir), dot(dn, fside)) * ring * on * 0.35 * o1;
                }
              }
            #endif
            // На мелководье у берега тише, в стрежне — живее.
            float deep = smoothstep(0.05, 1.1, vDepth);
            g *= mix(0.45, 1.0, deep) * mix(1.0, 1.5, vRace);
            vec2 gw = fdir * g.x + fside * g.y;
            vec3 wn = normalize(vec3(-gw.x, 1.0, -gw.y));
            vec3 wv = normalize(cameraPosition - vWPos);
            float ndv = max(dot(wv, wn), 0.0);
            // Отражение: и сверху вода зеркалит небо заметно — иначе с ракурса игры она читалась бы дорогой; ночью слабее.
            float fres = (0.12 + 0.75 * pow(1.0 - ndv, 4.0)) * mix(1.0, 0.65, cNight);
            // Цвет воды: мелководье — сквозь неё ил и песок, глубь — тёмная, зеленовато-бурая; пятна омутов и отмелей
            // крупным шумом по миру; ночью темнее.
            float pools = sin(vWPos.x * 0.06 + sin(vWPos.z * 0.021) * 2.5) * sin(vWPos.z * 0.043 + sin(vWPos.x * 0.05) * 1.7);
            vec3 body = mix(vec3(0.2, 0.19, 0.13), vec3(0.035, 0.06, 0.058), deep) * (0.92 + 0.16 * pools) * mix(1.0, 0.45, cNight);
            // Течение: редкие рваные струи вдоль стрежня — штрихами, а не полосами.
            float dash = smoothstep(0.55, 0.95, sin(along * 0.17 - t * 0.9 * sp + across * 0.31) * sin(along * 0.061 + across * 0.9));
            float streak = smoothstep(0.9, 1.0, sin(across * 0.9 + 2.4 * sin(along * 0.045 - t * 0.35 * sp))) * dash * (0.022 + 0.04 * vRace) * deep * o1;
            // Зима: река замерзает от берегов, кромка льда — неровными заберегами по течению; стрежень остаётся тёмной
            // открытой водой, ручей у мельницы бежит и не мёрзнет.
            float iceN = 0.5 + 0.5 * sin(along * 0.07 + 1.3 * sin(along * 0.023)) * sin(along * 0.031 + across * 0.05 + 0.7);
            // Лёд — по холоду пояса (\`cIce\`): на Сицилии река не мёрзнет и после снегопада.
            float ice = cIce * (1.0 - vRace) * smoothstep(0.5, 0.75, (1.0 - deep) * 0.9 + iceN * 0.3 + cIce * 0.15);
            vec3 iceCol = vec3(0.62, 0.68, 0.74);
            #if WATER_DETAIL >= 1
              // Снег на льду — переметами, и тёмные трещины.
              float drift = smoothstep(0.55, 0.8, sin(vWPos.x * 0.37 + vWPos.z * 0.11) * 0.5 + 0.5 + iceN * 0.3);
              iceCol = mix(iceCol, cSnowCol, drift * 0.8);
              float crack = 1.0 - smoothstep(0.0, 0.05, abs(sin(vWPos.x * 0.9 + sin(vWPos.z * 0.55) * 2.2) * sin(vWPos.z * 0.7 + vWPos.x * 0.2)));
              iceCol *= 1.0 - crack * 0.35 * (1.0 - drift);
            #endif
            diffuseColor.rgb = mix(body * (1.0 - fres * 0.6) + vec3(streak), iceCol, ice);
            diffuseColor.a = smoothstep(0.0, 0.3, vDepth) * mix(0.9, 1.0, deep);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `#include <emissivemap_fragment>
            // Небо в воде: у горизонта — дымка, к зениту синее; ночью дымка тёмная — и отражение тоже. У берега в воде
            // отражается берег — зелень и земля, темнее неба: вода не голубая лента, а зеркало долины.
            vec3 R = reflect(-wv, wn);
            vec3 skyR = mix(cSky, cSky * vec3(0.55, 0.72, 1.05), smoothstep(0.05, 0.75, R.y));
            vec3 bankR = vec3(0.07, 0.09, 0.05) * mix(1.0, 0.35, cNight);
            skyR = mix(bankR, skyR, smoothstep(0.15, 0.95, deep));
            // Блик светила: днём солнце тёплое и острое, ночью луна — холодная и широкая: дорожка по ряби.
            vec3 wh = normalize(normalize(cSunDir) + wv);
            float glint = pow(max(dot(wn, wh), 0.0), mix(220.0, 36.0, cNight));
            #if WATER_DETAIL >= 2
              // Искры: мелкие грани ряби ловят солнце по одной.
              vec3 fn = normalize(wn + vec3(sin(vWPos.x * 7.0 + t * 3.0), 0.0, sin(vWPos.z * 7.3 - t * 2.7)) * 0.06);
              glint += pow(max(dot(fn, wh), 0.0), 900.0) * 2.0 * o2;
            #endif
            vec3 lightCol = mix(vec3(1.0, 0.95, 0.84), vec3(0.62, 0.72, 0.95), cNight);
            vec3 em = skyR * fres * (1.0 - ice * 0.85) + lightCol * glint * mix(1.6, 0.9, cNight) * (1.0 - ice);
            // Луна на ряби: с ракурса игры луна за спиной, и дорожки от неё в кадре нет — но склоны ряби, обращённые к
            // зрителю, ловят лунный свет: мягкое серебро бежит по течению, и тёмная вода читается водой.
            vec2 fwd = normalize((vWPos - cameraPosition).xz + vec2(1e-4, 0.0));
            float crest = clamp(0.5 + dot(gw, fwd) * 3.5, 0.0, 1.0);
            em += vec3(0.5, 0.6, 0.85) * crest * crest * 0.07 * cNight * deep * (1.0 - ice);
            #if WATER_DETAIL >= 1
              // Огни у воды ночью: тёплая лужа света и отблеск там, где отражённый луч смотрит на огонь.
              for (int i = 0; i < ${WATER_LIGHTS}; i++) {
                vec4 l = cWaterLights[i];
                vec3 d = l.xyz - vWPos;
                float pool = max(0.0, 1.0 - dot(d, d) / l.w);
                float g2 = pow(max(dot(R, normalize(d)), 0.0), 60.0);
                em += cTorchCol * (pool * pool * 0.5 + g2 * pool * 2.0) * cNight * (1.0 - ice);
              }
            #endif
            totalEmissiveRadiance += em;`,
          ),
    );
    misted(shader);
  };
  m.customProgramCacheKey = () => `city-water-${detail}`;
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'city-water';
  mesh.receiveShadow = true;
  // Прозрачное рисуется после земли: кромка ложится на ил берега.
  mesh.renderOrder = 1;
  return mesh;
}
