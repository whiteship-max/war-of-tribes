// Огонь покоев (docs/city_v3.md, Г-4): языки пламени в камине, свечение очага, свечи с ореолом, искры над огнём и пыль в
// солнечном луче — одним вызовом отрисовки: плашки, повёрнутые к глазу (языки — по вертикали), складываются светом.
// Форма и дрожь — шумом в шейдере от часов сцены; число плашек — по уровню (`FIRE_SPEC`).
import * as THREE from 'three';
import type { Quality } from '../quality';
import { INSIDE_DEPTH_GLSL } from '../city/inside';
import { HEARTH } from './plan';
import type { Flame } from './build';
import { SUN_GLSL, type RoomUniforms } from './material';

/** Плашек по уровню: языков огня, искр, пылинок в луче. */
export const FIRE_SPEC: Record<Quality, { tongues: number; embers: number; dust: number }> = {
  low: { tongues: 6, embers: 0, dust: 0 },
  medium: { tongues: 10, embers: 18, dust: 40 },
  high: { tongues: 14, embers: 32, dust: 90 },
};

/** Виды плашек — номер в атрибуте `aKind`. */
const KIND = { tongue: 0, flame: 1, halo: 2, ember: 3, dust: 4, glow: 5 } as const;

interface Plate {
  /** Номер внутри вида, доля 0..1 — уровень гасит хвост (`uKeep`). */
  rank?: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  kind: number;
  seed: number;
}

/** Сеяная кость: у всех одна и та же пляска огня. */
function bone(seed: number): () => number {
  let x = seed >>> 0 || 7;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec2 aSize;
attribute float aKind;
attribute float aSeed;
attribute float aRank;
uniform float uTime;
uniform float uLit;
uniform float uDust;
// Доля плашек вида, что горит на уровне: языки, искры, пылинки (по номеру внутри вида, aRank).
uniform vec3 uKeep;
varying vec2 vC;
varying float vKind;
varying float vSeed;
varying float vA;
${SUN_GLSL}
void main() {
  vec3 c = aCenter;
  vec2 size = aSize;
  float a = 1.0;
  if (aKind > 2.5 && aKind < 3.5) {
    // Искра: поднимается к колпаку и гаснет; путь свой у каждой.
    float life = fract(uTime * (0.22 + 0.12 * fract(aSeed * 7.13)) + aSeed);
    c.y += life * 1.25;
    c.x += sin(uTime * 1.3 + aSeed * 20.0) * 0.09 * life;
    c.z += cos(uTime * 1.1 + aSeed * 13.0) * 0.05 * life + life * 0.12;
    a = (1.0 - life) * smoothstep(0.0, 0.08, life);
  } else if (aKind > 3.5 && aKind < 4.5) {
    // Пылинка: медленно плывёт; видна только в солнечном луче.
    c += vec3(sin(uTime * 0.11 + aSeed * 31.0), sin(uTime * 0.07 + aSeed * 17.0) * 0.6, cos(uTime * 0.09 + aSeed * 23.0)) * 0.3;
    a = uDust * sunThrough(c) * (0.5 + 0.5 * sin(uTime * 0.7 + aSeed * 40.0));
  } else if (aKind > 0.5 && aKind < 2.5) {
    // Свеча и её ореол горят, когда зажжены (ночью); язык дрожит.
    a = uLit;
    size *= 0.9 + 0.1 * sin(uTime * 9.0 + aSeed * 30.0) * sin(uTime * 5.3 + aSeed * 11.0);
  } else {
    size *= 0.88 + 0.12 * sin(uTime * 3.1 + aSeed * 17.0);
  }
  vC = aCorner;
  vKind = aKind;
  vSeed = aSeed;
  vA = a;
  vec4 wp = modelMatrix * vec4(c, 1.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // Языки и свечи — стоймя: вертикаль мира, бок — от глаза по земле.
  if (aKind < 1.5) {
    right = normalize(vec3(right.x, 0.0, right.z) + vec3(1e-4, 0.0, 0.0));
    up = vec3(0.0, 1.0, 0.0);
  }
  wp.xyz += right * aCorner.x * size.x + up * aCorner.y * size.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
  float keep = aKind < 0.5 ? uKeep.x : aKind > 2.5 && aKind < 3.5 ? uKeep.y : aKind > 3.5 && aKind < 4.5 ? uKeep.z : 1.0;
  if (a <= 0.001 || aRank >= keep) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  ${INSIDE_DEPTH_GLSL}
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec2 vC;
varying float vKind;
varying float vSeed;
varying float vA;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 col;
  float k;
  if (vKind < 0.5) {
    // Язык огня: капля, сужается кверху, шум бежит вверх и рвёт край.
    float y = clamp(vC.y, 0.0, 1.0);
    float n = vn(vec2(vC.x * 2.0 + vSeed * 9.0, y * 3.0 - uTime * 2.4 + vSeed * 5.0));
    float n2 = vn(vec2(vC.x * 5.0 - vSeed * 3.0, y * 6.0 - uTime * 4.1));
    float x = vC.x + (n - 0.5) * 0.6 * y;
    float w = (1.0 - y) * (0.55 + 0.45 * smoothstep(0.0, 0.25, vC.y + 0.15));
    float shape = 1.0 - smoothstep(w * 0.45, w, abs(x));
    shape *= smoothstep(-0.15, 0.05, vC.y) * (1.0 - smoothstep(0.55 + 0.35 * n2, 1.0, y));
    float core = shape * (1.0 - y) * (1.0 - smoothstep(0.0, w * 0.6, abs(x)));
    col = mix(vec3(0.85, 0.16, 0.02), vec3(1.0, 0.55, 0.12), shape) + vec3(0.9, 0.75, 0.45) * core;
    k = shape * 0.9;
  } else if (vKind < 1.5) {
    // Пламя свечи: светлая капля, синеватое донце, жёлтый верх.
    float y = vC.y;
    float d = length(vec2(vC.x / (0.42 * (1.0 - 0.55 * clamp(y, 0.0, 1.0)) + 0.02), (y - 0.3) / 0.7));
    float shape = 1.0 - smoothstep(0.55, 1.0, d);
    vec3 base = mix(vec3(0.25, 0.35, 0.9), vec3(1.0, 0.72, 0.3), smoothstep(-0.1, 0.25, y));
    col = mix(base, vec3(1.0, 0.95, 0.8), (1.0 - smoothstep(0.0, 0.6, d)) * 0.8);
    k = shape * 1.2;
  } else if (vKind < 2.5) {
    // Ореол свечи.
    float d = dot(vC, vC);
    col = vec3(1.0, 0.62, 0.28);
    k = exp(-d * 5.0) * 0.22;
  } else if (vKind < 3.5) {
    float d = length(vC);
    col = vec3(1.0, 0.5, 0.12);
    k = (1.0 - smoothstep(0.2, 1.0, d)) * 1.4;
  } else if (vKind < 4.5) {
    float d = length(vC);
    col = vec3(1.0, 0.93, 0.8);
    k = (1.0 - smoothstep(0.0, 1.0, d)) * 0.6;
  } else {
    // Свечение очага — воздух над огнём.
    float d = dot(vC, vC);
    col = vec3(1.0, 0.45, 0.12);
    k = exp(-d * 3.5) * 0.28 * (0.85 + 0.15 * sin(uTime * 4.0));
  }
  gl_FragColor = vec4(col * k * vA, 1.0);
  #include <colorspace_fragment>
}
`;

/** Плашки огня покоев: огонь камина, свечи (кроме свечи в руке — у неё свои), искры и пыль. */
export class RoomFire {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(flames: readonly Flame[], u: RoomUniforms, q: Quality, hand = false) {
    const r = bone(1201);
    const ps: Plate[] = [];
    // Номер внутри вида — доля от числа «Высокого»: уровень ниже гасит хвост вида.
    const span = (_kind: number, f: () => void): void => {
      const start = ps.length;
      f();
      const n = ps.length - start;
      for (let i = 0; i < n; i++) ps[start + i].rank = i / Math.max(1, n);
    };
    if (!hand) {
      const f = HEARTH.fire;
      span(KIND.tongue, () => {
        for (let i = 0; i < FIRE_SPEC.high.tongues; i++) {
          const t = (i + 0.5) / FIRE_SPEC.high.tongues;
          ps.push({ x: f.x + (t - 0.5) * 0.95 + (r() - 0.5) * 0.12, y: f.y - 0.12, z: f.z + (r() - 0.5) * 0.25, w: 0.13 + r() * 0.12, h: 0.38 + (1 - Math.abs(t - 0.5) * 1.6) * 0.42 + r() * 0.12, kind: KIND.tongue, seed: r() });
        }
      });
      span(KIND.glow, () => ps.push({ x: f.x, y: f.y + 0.3, z: f.z + 0.1, w: 1.1, h: 0.9, kind: KIND.glow, seed: r() }));
      span(KIND.ember, () => {
        for (let i = 0; i < FIRE_SPEC.high.embers; i++) ps.push({ x: f.x + (r() - 0.5) * 0.8, y: f.y, z: f.z + (r() - 0.5) * 0.2, w: 0.012, h: 0.012, kind: KIND.ember, seed: r() });
      });
      span(KIND.dust, () => {
        for (let i = 0; i < FIRE_SPEC.high.dust; i++) ps.push({ x: (r() - 0.5) * 3.2, y: 0.4 + r() * 2.8, z: 1.4 + r() * 3.8, w: 0.006, h: 0.006, kind: KIND.dust, seed: r() });
      });
    }
    span(KIND.flame, () => {
      for (const fl of flames) if (hand === (fl.trinket !== undefined)) ps.push({ x: hand ? 0 : fl.x, y: hand ? 0 : fl.y, z: hand ? 0 : fl.z, w: fl.size * 0.55, h: fl.size * 1.9, kind: KIND.flame, seed: r() });
    });
    span(KIND.halo, () => {
      for (const fl of flames) if (hand === (fl.trinket !== undefined)) ps.push({ x: hand ? 0 : fl.x, y: (hand ? 0 : fl.y) + fl.size * 0.6, z: hand ? 0 : fl.z, w: 0.32, h: 0.32, kind: KIND.halo, seed: r() });
    });
    const g = new THREE.BufferGeometry();
    const n = ps.length;
    const center = new Float32Array(n * 12);
    const corner = new Float32Array(n * 8);
    const size = new Float32Array(n * 8);
    const kind = new Float32Array(n * 4);
    const seed = new Float32Array(n * 4);
    const rank = new Float32Array(n * 4);
    const idx = new Uint16Array(n * 6);
    ps.forEach((p, i) => {
      const flame = p.kind === KIND.tongue || p.kind === KIND.flame;
      const lo = flame ? -0.15 : -1;
      const cs = [
        [-1, lo],
        [1, lo],
        [1, 1],
        [-1, 1],
      ];
      for (let k = 0; k < 4; k++) {
        center.set([p.x, p.y, p.z], (i * 4 + k) * 3);
        corner.set(cs[k], (i * 4 + k) * 2);
        size.set([p.w, p.h], (i * 4 + k) * 2);
        kind[i * 4 + k] = p.kind;
        seed[i * 4 + k] = p.seed;
        rank[i * 4 + k] = p.rank ?? 0;
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
    // Положение three нужно для рамки отбора: середины плашек.
    g.setAttribute('position', new THREE.BufferAttribute(center, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 2));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aRank', new THREE.BufferAttribute(rank, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 1;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...u, uLit: { value: 0 }, uDust: { value: 0 }, uKeep: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.material.name = 'chambers-fire';
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.renderOrder = 5;
    this.mesh.name = hand ? 'chambers-hand-flame' : 'chambers-fire';
    this.setLevel(q);
  }

  /** Уровень: языков, искр и пылинок — сколько у уровня; лишние плашки гаснут, вызов один (буфер не перестраивается). */
  setLevel(q: Quality): void {
    const c = FIRE_SPEC[q];
    const hi = FIRE_SPEC.high;
    (this.material.uniforms.uKeep.value as THREE.Vector3).set(c.tongues / hi.tongues, c.embers / hi.embers, c.dust / hi.dust);
  }

  /** Кадр: часы, зажжены ли свечи (0..1), сила пыли в луче. */
  update(t: number, lit: number, dust: number): void {
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uLit.value = lit;
    u.uDust.value = dust;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
