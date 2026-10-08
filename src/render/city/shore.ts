// Камыш у кромки и камни на берегу реки (docs/city.md, 12.3): экземплярами, по вызову на вид, тени не бросают (у
// воды они мелкие, а тень стоила бы прохода). Места — `banks.shoreItems` (от зерна, по уровню), здесь — модели и
// материалы. Камыш качается тем же ветром, что флаги и дым (погода, `cWindDir` и `cWind`): летом зелёный, осенью рыжеет,
// зимой — сухая солома; камни во мху снизу и под снегом сверху зимой.
import * as THREE from 'three';
import { GRADE_GLSL, graded, misted, type CityUniforms } from './material';
import type { Reed, Stone } from './banks';

/**
 * Куртина камыша: `blades` листьев — по треугольнику, выгнутых наружу, — и две метёлки по два треугольника. Высота —
 * единица (куртину растит матрица экземпляра). Цвет вершины — три числа, а не цвет: r — затемнение к земле, g — доля
 * метёлки (0 — лист, 1 — метёлка), b — сколько вершина качается (0 у земли, 1 у макушки).
 */
export function reedGeometry(blades: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const jit = (i: number, s: number): number => {
    const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + jit(b, 1) * 0.9;
    const r = 0.12 + jit(b, 2) * 0.08;
    const h = 0.75 + jit(b, 3) * 0.45;
    const lean = 0.1 + jit(b, 4) * 0.08;
    const w = 0.035;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const ox = dx * r * 0.4;
    const oz = dz * r * 0.4;
    pos.push(ox - dz * w, 0, oz + dx * w, ox + dz * w, 0, oz - dx * w, ox + dx * (r + lean), h, oz + dz * (r + lean));
    col.push(0.62, 0, 0, 0.62, 0, 0, 1.05, 0, 1);
  }
  // Метёлки — бурые початки на двух листьях повыше: по узкой грани (два треугольника), вторая поперёк первой.
  for (let k = 0; k < 2; k++) {
    const x = (k === 0 ? 0.05 : -0.06) + jit(k, 5) * 0.04;
    const z = (k === 0 ? -0.03 : 0.05) + jit(k, 6) * 0.04;
    const y0 = 0.82 + k * 0.1;
    const y1 = y0 + 0.16;
    const ax = k === 0 ? 0.022 : 0;
    const az = k === 0 ? 0 : 0.022;
    pos.push(x - ax, y0, z - az, x + ax, y0, z + az, x + ax, y1, z + az, x - ax, y0, z - az, x + ax, y1, z + az, x - ax, y1, z - az);
    for (let v = 0; v < 6; v++) col.push(0.95, 1, 0.95);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Нормаль вверх: лист освещён как берег под ним, а не гранью — иначе половина куртины смотрела бы в тень.
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Камень: икосаэдр, сплюснутый и с разъехавшимися вершинами — плоский валун у воды. Двадцать треугольников. */
export function stoneGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = Math.sin(i * 7.31) * 0.12;
    p.setXYZ(i, p.getX(i) * (1 + k), p.getY(i) * 0.55 * (1 - k), p.getZ(i) * (1.1 - k));
  }
  geo.computeVertexNormals();
  return geo;
}

const REED_VERT = /* glsl */ `
uniform float cTime;
uniform vec2 cWindDir;
uniform float cWind;
varying vec3 vReed;
varying float vTone;
`;

const REED_FRAG = /* glsl */ `
uniform float cAutumn;
uniform float cWinter;
varying vec3 vReed;
varying float vTone;
${GRADE_GLSL}
`;

/** Камыш: лист — от тёмной зелени у воды к светлой макушке; осенью рыжеет, зимой — сухая солома. */
function reedMaterial(u: CityUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      REED_VERT +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vReed = color.rgb;
        // Своё число куртины — от её места: качаются вразнобой, тон тоже свой.
        vec3 at = vec3(0.0);
        #ifdef USE_INSTANCING
          at = instanceMatrix[3].xyz;
        #endif
        vTone = fract(sin(dot(at.xz, vec2(12.9898, 78.233))) * 43758.5453);
        // Ветер — в мире, не в куртине: у каждой свой поворот, а ветер один (погода, \`cWindDir\`), метры у макушки; сила — от
        // погоды: в тишь камыш едва колышется, в бурю гнётся.
        float sway = (color.b * color.b * (0.28 + 0.14 * sin(cTime * 1.7 + vTone * 6.28)) + color.b * 0.08 * sin(cTime * 4.1 + at.x * 0.3)) * (0.35 + 1.6 * cWind);
        vec3 wd = vec3(cWindDir.x, 0.0, cWindDir.y) * sway;
        #ifdef USE_INSTANCING
          wd = inverse(mat3(instanceMatrix)) * wd;
        #endif
        transformed += wd;`,
      ).replace('#include <color_vertex>', '');
    shader.fragmentShader =
      REED_FRAG +
      graded(
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          /* glsl */ `
          vec3 leafLow = vec3(0.12, 0.17, 0.07);
          vec3 leafTop = mix(vec3(0.42, 0.48, 0.2), vec3(0.5, 0.5, 0.24), vTone);
          vec3 leaf = mix(leafLow, leafTop, smoothstep(0.62, 1.05, vReed.r));
          leaf = mix(leaf, leaf * vec3(1.55, 1.05, 0.5) + vec3(0.06, 0.02, 0.0), cAutumn * 0.85);
          leaf = mix(leaf, vec3(0.5, 0.44, 0.31) * (0.8 + 0.3 * vReed.r), cWinter);
          vec3 head = mix(vec3(0.26, 0.15, 0.08), vec3(0.32, 0.27, 0.2), cWinter);
          diffuseColor.rgb *= mix(leaf, head, vReed.g) * (0.9 + 0.2 * vTone);`,
        ),
      );
    misted(shader);
  };
  m.customProgramCacheKey = () => 'city-reeds';
  return m;
}

const STONE_VERT = /* glsl */ `
varying float vStoneNy;
varying float vStoneTone;
`;

const STONE_FRAG = /* glsl */ `
uniform float cSnow;
uniform vec3 cSnowCol;
varying float vStoneNy;
varying float vStoneTone;
${GRADE_GLSL}
`;

/** Камень: серо-бурый, снизу во мху, зимой сверху под снегом. */
function stoneMaterial(u: CityUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      STONE_VERT +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec3 sn = objectNormal;
        vec3 sat = vec3(0.0);
        #ifdef USE_INSTANCING
          sn = mat3(instanceMatrix) * sn;
          sat = instanceMatrix[3].xyz;
        #endif
        vStoneNy = normalize(mat3(modelMatrix) * sn).y;
        vStoneTone = fract(sin(dot(sat.xz, vec2(39.3468, 11.135))) * 43758.5453);`,
      );
    shader.fragmentShader =
      STONE_FRAG +
      graded(
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          /* glsl */ `
          vec3 rock = mix(vec3(0.36, 0.34, 0.3), vec3(0.44, 0.4, 0.33), vStoneTone);
          rock = mix(vec3(0.2, 0.26, 0.13), rock, smoothstep(-0.3, 0.35, vStoneNy));
          rock = mix(rock, cSnowCol, smoothstep(0.45, 0.8, vStoneNy) * cSnow);
          diffuseColor.rgb *= rock;`,
        ),
      );
    misted(shader);
  };
  m.customProgramCacheKey = () => 'city-stones';
  return m;
}

/** Камыш и камни берега — два меша экземплярами; `blades` — листьев в куртине (`SHORE_CAP.reedBlades`). */
export function buildShore(u: CityUniforms, reeds: readonly Reed[], stones: readonly Stone[], blades: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'city-shore';
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  if (reeds.length > 0) {
    const im = new THREE.InstancedMesh(reedGeometry(blades), reedMaterial(u), reeds.length);
    reeds.forEach((r, k) => {
      const wide = 1.1 + r.tone * 0.7;
      im.setMatrixAt(k, m4.compose(p.set(r.x, r.y, r.z), q4.setFromAxisAngle(up, r.rot), s.set(r.h * wide, r.h, r.h * wide)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    im.name = 'city-reeds';
    group.add(im);
  }
  if (stones.length > 0) {
    const im = new THREE.InstancedMesh(stoneGeometry(), stoneMaterial(u), stones.length);
    stones.forEach((st, k) => {
      im.setMatrixAt(k, m4.compose(p.set(st.x, st.y, st.z), q4.setFromAxisAngle(up, st.rot), s.set(st.s, st.s, st.s)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    im.name = 'city-stones';
    group.add(im);
  }
  return group;
}

/** Треугольников куртины и камня по моделям — тест сверяет их со счётом бюджета (`spec.shoreTris`). */
export function shoreModelTris(blades: number): { reed: number; stone: number } {
  const stone = stoneGeometry();
  return { reed: reedGeometry(blades).attributes.position.count / 3, stone: (stone.index?.count ?? stone.attributes.position.count) / 3 };
}
