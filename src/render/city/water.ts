// Вода вида «город» (docs/city.md, раздел 11.6): река в западной долине и мельничный ручей лесопилки —
// одна лента, один вызов. Ламберт с правкой шейдера: тёмная вода с рябью по течению, отражение неба по
// Френелю и блик солнца — в собственном свечении (его свет не гасит), зимой — лёд у берегов. Уровень
// воды идёт за долиной (`layout.riverLevel`): берега выше воды на полметра.
import * as THREE from 'three';
import { RACE_HALF, RIVER_HALF, raceRibbon, riverRibbon } from './layout';
import type { CityUniforms } from './material';

/** Лента вдоль ломаной: середина, полуширина, высота воды в точке. */
function ribbon(pts: { x: number; z: number; y: number }[], half: number, pos: number[], idx: number[], edge: number[]): void {
  const base = pos.length / 3;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l;
    const nz = tx / l;
    const p = pts[k];
    pos.push(p.x - nx * half, p.y, p.z - nz * half, p.x + nx * half, p.y, p.z + nz * half);
    edge.push(-1, 1);
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const a = base + k * 2;
    // Вершина a — слева по ходу, a + 1 — справа: обход a → a + 1 → a + 2 против часовой, если смотреть
    // сверху, — грань лицом вверх (иначе при двусторонней грани three перевернул бы нормаль вниз, и вода
    // с зимним льдом не получали бы солнца).
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

export function buildWater(u: CityUniforms): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  const edge: number[] = [];
  ribbon(riverRibbon(), RIVER_HALF + 1.5, pos, idx, edge);
  ribbon(raceRibbon(), RACE_HALF + 1.2, pos, idx, edge);
  // Нормаль вверх задана явно; грани — лицом вверх (обход в `ribbon`), с двух сторон — на всякий ракурс.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const nor = new Float32Array(pos.length);
  for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  // Поперёк ленты: −1 у одного берега, +1 у другого — по нему вода тает к берегам.
  g.setAttribute('edge', new THREE.BufferAttribute(new Float32Array(edge), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // Сетка земли вдали от середины редкая (шаг 5–10 м), и берег под лентой лежит не там, где его считает
  // рельеф: край воды тает в прозрачность — у берега отмель, а не ступенька стекла над травой.
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = 'attribute float edge;\nvarying float vEdge;\nvarying vec3 vWPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vEdge = edge;
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader =
      /* glsl */ `uniform float cTime;
      uniform float cNight;
      uniform float cSnow;
      uniform vec3 cSunDir;
      uniform vec3 cSky;
      varying vec3 vWPos;
      varying float vEdge;
      ` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          // Рябь — бегущие волны по течению (на юг) и поперёк: из них нормаль воды.
          vec2 p = vWPos.xz;
          float t = cTime;
          vec2 g = vec2(cos(p.x * 0.9 + p.y * 0.35 - t * 1.3), cos(p.y * 0.7 - t * 1.1)) * 0.07
                 + vec2(cos(p.x * 2.3 - p.y * 1.7 - t * 2.2), cos(p.y * 2.6 + p.x * 0.6 - t * 2.6)) * 0.035
                 + vec2(cos(p.x * 5.1 + p.y * 3.3 - t * 3.7), cos(p.y * 4.7 - p.x * 2.9 - t * 3.1)) * 0.015;
          vec3 wn = normalize(vec3(g.x, 1.0, g.y));
          vec3 wv = normalize(cameraPosition - vWPos);
          float fres = 0.1 + 0.8 * pow(1.0 - max(dot(wv, wn), 0.0), 3.0);
          // Вода тёмная, торфяная, к середине глубже; пятна течения — светлее.
          vec3 deep = vec3(0.045, 0.07, 0.065);
          vec3 shallow = vec3(0.11, 0.14, 0.1);
          vec3 wcol = mix(deep, shallow, 0.5 + 0.5 * sin(p.x * 0.07 + p.y * 0.031 + sin(p.y * 0.013) * 3.0));
          // Зимой — лёд: светлый, серо-голубой, рябь на нём не бежит.
          float ice = cSnow * 0.75;
          diffuseColor.rgb = mix(wcol, vec3(0.55, 0.6, 0.65), ice);
          diffuseColor.a = 1.0 - smoothstep(0.55, 1.0, abs(vEdge));`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          vec3 wh = normalize(normalize(cSunDir) + wv);
          float spec = pow(max(dot(wn, wh), 0.0), 90.0) * (1.0 - 0.75 * cNight) * (1.0 - ice);
          totalEmissiveRadiance += cSky * fres * (1.0 - ice * 0.7) + vec3(1.0, 0.94, 0.82) * spec * 1.4;`,
        );
  };
  m.customProgramCacheKey = () => 'city-water';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'city-water';
  mesh.receiveShadow = true;
  // Прозрачное рисуется после земли: отмель ложится на неё.
  mesh.renderOrder = 1;
  return mesh;
}
