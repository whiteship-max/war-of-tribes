/**
 * Места промыслов: земля, трава, цветы, деревья и камни — мягко, а не гранями (docs/polish.md, П-4).
 *
 * МАТЕРИАЛЫ — СВОИ, А ЧИСЛА ПОГОДЫ — ПОЛЯНЫ. Ламберт с цветом в вершинах и гладкой нормалью, и вставки:
 *
 *   ветер     — качает крону и траву; фаза — от места копии в мире, а не от вершины: роща качается волной, а не
 *               хором, и каждая копия травы — своим порывом (`instanceMatrix`);
 *   свет      — обёрнутый (листва и трава мягкие) и сквозной: против солнца лист и травинка светятся;
 *   рябь      — мелкий шум по месту в мире: земля, кора, хвоя и камень не залиты одним цветом;
 *   погода    — сырость темнит, снег ложится на то, что смотрит вверх: те же числа, что у копий поляны
 *               (`Surfaces.u`): погода сцены одна на всё.
 *
 * ЛИСТВА МЯГКАЯ, ПОТОМУ ЧТО НОРМАЛЬ — ОТ ЦЕНТРА КРОНЫ. Шапки кроны лепятся шарами с шумом, а нормаль каждой вершины
 * клонится к направлению от середины кроны: свет ложится на крону как на одно облако — приём рисованных игр.
 *
 * Копиями: роща одной породы — одна сетка и один вызов, трава — тысяча копий одного пучка. Своих классов `three` нет.
 */
import * as THREE from 'three';
import type { Season } from '@/game/types';
import type { SurfaceUniforms } from '@/prologue/surface';
import { GLSL_NOISE, LAMBERT_DIRECT, LAMBERT_PARS } from './fur';
import { Sculpt, rigid, smooth } from './fauna';
import { mix, noise3 } from './beasts';

// ---------- Материалы ----------

export type NatureKind = 'leaf' | 'needle' | 'bark' | 'grass' | 'ground' | 'rock';

interface NatureLook {
  /** Рельеф по шуму места, м (купы листьев, лапы ели); нет — гладко. */
  bump?: number;
  /** Ветер: откуда начинает качать (м над основой) и сколько на метр; трава — от корня квадратом. */
  swayFrom: number;
  swayGain: number;
  /** Обёрнутый свет и сквозной (против солнца). */
  wrap: number;
  sss: number;
  /** Рябь цвета: частота на метр и сила. */
  grain: number;
  speckle: number;
  /** Сколько берёт снега и темнеет от сырости. */
  snow: number;
  wet: number;
}

const LOOKS: Record<NatureKind, NatureLook> = {
  leaf: { bump: 0.09, swayFrom: 1.4, swayGain: 0.012, wrap: 0.55, sss: 0.55, grain: 3.1, speckle: 0.32, snow: 0.85, wet: 0.16 },
  needle: { bump: 0.045, swayFrom: 1.6, swayGain: 0.008, wrap: 0.4, sss: 0.25, grain: 5.5, speckle: 0.3, snow: 0.9, wet: 0.14 },
  bark: { swayFrom: 99, swayGain: 0, wrap: 0.3, sss: 0, grain: 9, speckle: 0.3, snow: 0.45, wet: 0.3 },
  grass: { swayFrom: 0, swayGain: 0.55, wrap: 0.6, sss: 0.7, grain: 1.7, speckle: 0.22, snow: 0.35, wet: 0.2 },
  ground: { swayFrom: 99, swayGain: 0, wrap: 0.15, sss: 0, grain: 2.3, speckle: 0.26, snow: 0, wet: 0.45 },
  rock: { bump: 0.02, swayFrom: 99, swayGain: 0, wrap: 0.15, sss: 0, grain: 7, speckle: 0.32, snow: 0.8, wet: 0.35 },
};

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

const VERT_HEAD = /* glsl */ `#include <common>
uniform float natTime;
uniform float natWind;
varying vec3 vNatW;`;

const VERT_BODY = /* glsl */ `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  mat4 natM = modelMatrix * instanceMatrix;
#else
  mat4 natM = modelMatrix;
#endif
  vec3 natO = natM[3].xyz;
#ifdef NAT_ROOT
  float natH = transformed.y * transformed.y * NAT_SWAY_GAIN;
#else
  float natH = max( 0.0, transformed.y - NAT_SWAY_FROM ) * NAT_SWAY_GAIN;
#endif
  if ( natH > 0.0 ) {
    float ph = natTime * 1.5 + natO.x * 0.31 + natO.z * 0.23 + transformed.x * 0.35;
    float gust = 0.65 + 0.35 * sin( natTime * 0.41 + natO.x * 0.06 + natO.z * 0.04 );
    float s = ( sin( ph ) + 0.4 * sin( ph * 2.3 + 1.1 ) ) * natWind * natH * gust;
    transformed.x += s;
    transformed.z += s * 0.55;
  }
  vNatW = ( natM * vec4( transformed, 1.0 ) ).xyz;
}`;

const FRAG_HEAD = /* glsl */ `#include <common>
uniform float natWet;
uniform float natSnow;
varying vec3 vNatW;
${GLSL_NOISE}`;

const FRAG_COLOR = /* glsl */ `#include <color_fragment>
float natN = furNoise( vNatW * NAT_GRAIN ) * 0.65 + furNoise( vNatW * NAT_GRAIN * 3.7 + 1.7 ) * 0.35;
diffuseColor.rgb *= 1.0 - NAT_SPECKLE * ( 0.5 - natN );
diffuseColor.rgb *= 1.0 - natWet * NAT_WET;`;

const FRAG_NORMAL = /* glsl */ `#include <normal_fragment_maps>
#ifdef NAT_BUMP
{
  // Купы листьев и лап — рельефом по шуму места, без треугольников: крона ловит свет клоками, а не гладким шаром.
  // Вдали гаснет: клок мельче точки экрана рябил бы.
  float natFade = NAT_BUMP * ( 1.0 - smoothstep( 25.0, 60.0, length( vViewPosition ) ) );
  if ( natFade > 0.0 ) {
    vec3 sx = dFdx( - vViewPosition );
    vec3 sy = dFdy( - vViewPosition );
    vec2 dh = vec2( dFdx( natN ), dFdy( natN ) ) * natFade;
    vec3 r1 = cross( sy, normal );
    vec3 r2 = cross( normal, sx );
    float det = dot( sx, r1 ) * faceDirection;
    normal = normalize( abs( det ) * normal - sign( det ) * ( dh.x * r1 + dh.y * r2 ) );
  }
}
#endif
#ifdef NAT_ROOT
  // Травинка видна с обеих сторон, а светится одинаково: нормаль — вверх-наружу, без переворота изнанки.
  normal = normalize( vNormal );
#endif
{
  vec3 natUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.89, 0.93 ), natSnow * NAT_SNOW * smoothstep( 0.35, 0.8, dot( normal, natUp ) ) * ( 0.55 + 0.45 * natN ) );
}`;

/** Обёрнутый и сквозной свет — на месте Ламберта (кусок three — копией из `fur.ts`, тест держит совпадение). */
const NAT_DIRECT = /* glsl */ `float natNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( ( natNL + NAT_WRAP ) / ( 1.0 + NAT_WRAP ) );
	vec3 irradiance = dotNL * directLight.color;
	irradiance += directLight.color * pow( saturate( dot( - geometryViewDir, directLight.direction ) ), 3.0 ) * NAT_SSS * ( 0.35 + 0.65 * saturate( - natNL + 0.3 ) );`;
const NAT_PARS = LAMBERT_PARS.replace(LAMBERT_DIRECT, NAT_DIRECT);

/** Материал места вида `kind`. Ветер, сырость и снег — числа поляны (`Surfaces.u`). Разбирает хозяин сцены. */
export function natureMaterial(kind: NatureKind, u: SurfaceUniforms): THREE.MeshLambertMaterial {
  const L = LOOKS[kind];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = `nature-${kind}`;
  if (kind === 'grass') mat.side = THREE.DoubleSide;
  mat.defines = {
    ...(kind === 'grass' ? { NAT_ROOT: '' } : {}),
    ...(L.bump ? { NAT_BUMP: f(L.bump) } : {}),
    NAT_SWAY_FROM: f(L.swayFrom),
    NAT_SWAY_GAIN: f(L.swayGain),
    NAT_WRAP: f(L.wrap),
    NAT_SSS: f(L.sss),
    NAT_GRAIN: f(L.grain),
    NAT_SPECKLE: f(L.speckle),
    NAT_SNOW: f(L.snow),
    NAT_WET: f(L.wet),
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.natTime = u.time;
    shader.uniforms.natWind = u.wind;
    shader.uniforms.natWet = u.wet;
    shader.uniforms.natSnow = u.snow;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_HEAD)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_lambert_pars_fragment>', NAT_PARS);
  };
  mat.customProgramCacheKey = () => `nature:${kind}`;
  return mat;
}

/** Материалы места: по одному на вид, все на одних числах погоды. Разбирает `dispose`. */
export class NatureMats {
  private made = new Map<NatureKind, THREE.MeshLambertMaterial>();

  constructor(private u: SurfaceUniforms) {}

  of(kind: NatureKind): THREE.MeshLambertMaterial {
    let m = this.made.get(kind);
    if (!m) {
      m = natureMaterial(kind, this.u);
      this.made.set(kind, m);
    }
    return m;
  }

  dispose(): void {
    for (const m of this.made.values()) m.dispose();
    this.made.clear();
  }
}

// ---------- Лепка ----------

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Чистое «случайное» число: места, рост и поворот у каждой копии свои, без `Math.random`. */
export const rnd = (i: number, k: number): number => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Склонить нормали вершин `[from, to)` к направлению от точки `c`: шапка кроны светится облаком. */
export function soften(g: THREE.BufferGeometry, from: number, to: number, c: THREE.Vector3, k: number, squashY = 1): void {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const d = new THREE.Vector3();
  const m = new THREE.Vector3();
  for (let i = from; i < to; i++) {
    d.fromBufferAttribute(p, i).sub(c);
    d.y *= squashY;
    d.normalize();
    m.fromBufferAttribute(n, i).lerp(d, k).normalize();
    n.setXYZ(i, m.x, m.y, m.z);
  }
}

/** Поделить сетку на куски по материалу: кора и листва — два меша одной группы, по вызову на материал. */
interface Split {
  bark: Sculpt;
  crown: Sculpt;
  /** Что смягчить: диапазон вершин кроны, середина и сила. */
  soft: { from: number; to: number; c: THREE.Vector3; k: number; sy: number }[];
}

const split = (): Split => ({ bark: new Sculpt(), crown: new Sculpt(), soft: [] });

/** Шапка кроны: шар с шумом по поверхности — купа листвы, а не мяч. */
function puff(s: Split, at: THREE.Vector3, r: THREE.Vector3, color: (p: THREE.Vector3) => number, seed: number, seg: number, center: THREE.Vector3): void {
  const from = s.crown.skins.length;
  s.crown.blob(at, r, new THREE.Euler(0, seed, 0), color, rigid(0), seg, Math.max(4, Math.round(seg * 0.65)), (p) => {
    const n = noise3(p.x * 2.6 + seed * 7, p.y * 2.6, p.z * 2.6) - 0.5;
    return n * Math.min(r.x, r.y) * 0.35;
  });
  s.soft.push({ from, to: s.crown.skins.length, c: center, k: 0.62, sy: 1.25 });
}

/** Собрать дерево: кора и крона — две сетки; нормали кроны смягчены к её середине. */
function finish(s: Split): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const bark = s.bark.geometry({ under: 0.7, ground: 0.6, groundUp: 0.8 });
  const crown = s.crown.geometry({ under: 0.55, ground: 1, groundUp: 1 });
  for (const q of s.soft) soften(crown, q.from, q.to, q.c, q.k, q.sy);
  return { bark, crown };
}

export type Detail = 'hi' | 'lo';

/** Хвоя: тёмная глубь яруса и светлые кончики; у соседних ёлок оттенок свой (тон копии). */
const NEEDLE = { deep: 0x1e3a26, mid: 0x2f5a35, tip: 0x5a8a4a, under: 0x16281c };
const BARK = { spruce: 0x6a4e3a, oak: 0x76604c, birch: 0xf2ede2, birchMark: 0x2a2622, cut: 0xc9a77a };

/**
 * Ель: ствол и ярусы-юбки — каждый ярус висит вниз зубцами лап, снизу закрыт: из-под ёлки на неё смотрят снизу.
 * Высота 1 — весь масштаб даёт копия.
 */
export function spruce(detail: Detail, seed: number): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const s = split();
  const hi = detail === 'hi';
  const H = 1;
  s.bark.tube([V(0, -0.02, 0), V(0, 0.35 * H, 0), V(0, 0.9 * H, 0)], [0.032, 0.022, 0.008], { seg: hi ? 7 : 5, color: (u) => mix(0x3e2e22, BARK.spruce, smooth(0, 0.4, u)), skin: rigid(0), caps: [null, 0.5] });
  const tiers = hi ? 5 : 3;
  const seg = hi ? 10 : 7;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y0 = H * (0.14 + 0.72 * t);
    const r = H * 0.33 * (1 - t * 0.82) * (0.9 + 0.2 * rnd(seed, k));
    const h = H * (0.24 - 0.08 * t);
    const droop = r * 0.32;
    const tip = V(0, y0 + h, 0);
    const from = s.crown.skins.length;
    // Кольцо кончиков лап — зубцами: длинная лапа и короткая через одну; кольцо середины — выше и уже.
    const outer: number[] = [];
    const mid: number[] = [];
    const under: number[] = [];
    const tipI = s.crown.vert(tip, NEEDLE.mid, rigid(0));
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2 + rnd(seed, k * 31) * 6;
      const jag = j % 2 ? 0.8 : 1.05 + 0.1 * rnd(seed + j, k);
      const ro = r * jag;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      mid.push(s.crown.vert(V(c * ro * 0.55, y0 + h * 0.45, sn * ro * 0.55), mix(NEEDLE.deep, NEEDLE.mid, 0.6), rigid(0)));
      outer.push(s.crown.vert(V(c * ro, y0 - droop * jag, sn * ro), mix(NEEDLE.mid, NEEDLE.tip, 0.55 + 0.45 * rnd(j, k + seed)), rigid(0)));
      under.push(s.crown.vert(V(c * ro * 0.45, y0 + h * 0.08, sn * ro * 0.45), NEEDLE.under, rigid(0)));
    }
    const core = s.crown.vert(V(0, y0 + h * 0.12, 0), NEEDLE.under, rigid(0));
    for (let j = 0; j < seg; j++) {
      const n = (j + 1) % seg;
      s.crown.idx.push(tipI, mid[n], mid[j]);
      s.crown.idx.push(mid[j], mid[n], outer[j], mid[n], outer[n], outer[j]);
      s.crown.idx.push(outer[j], outer[n], under[j], outer[n], under[n], under[j]);
      s.crown.idx.push(under[j], under[n], core);
    }
    s.soft.push({ from, to: s.crown.skins.length, c: V(0, y0 + h * 0.2, 0), k: 0.55, sy: 1.6 });
  }
  return finish(s);
}

/** Лиственное (липа, дуб): ствол с развилкой и крона купами — тёмная снизу и внутри, светлая сверху. */
export function broadleaf(detail: Detail, seed: number, season: Season): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const s = split();
  const hi = detail === 'hi';
  const leaf = LEAF[season];
  s.bark.tube([V(0, -0.02, 0), V(0.01, 0.25, 0), V(0.03, 0.45, 0.01)], [0.05, 0.035, 0.026], { seg: hi ? 8 : 5, color: BARK.oak, skin: rigid(0), caps: [null, 0.4] });
  for (let b = 0; b < (hi ? 2 : 1); b++) {
    const a = seed * 3 + b * 2.1;
    s.bark.tube([V(0.03, 0.42, 0.01), V(Math.cos(a) * 0.1, 0.58, Math.sin(a) * 0.1), V(Math.cos(a) * 0.17, 0.68, Math.sin(a) * 0.17)], [0.022, 0.014, 0.006], { seg: hi ? 6 : 4, color: BARK.oak, skin: rigid(0), caps: [null, 0.4] });
  }
  const center = V(0, 0.68, 0);
  const color = (p: THREE.Vector3): number => {
    const top = smooth(0.45, 0.95, p.y);
    const n = noise3(p.x * 5 + seed, p.y * 5, p.z * 5);
    return mix(mix(leaf.deep, leaf.mid, top), leaf.light, smooth(0.55, 0.95, p.y) * 0.6 * n);
  };
  const puffs = hi ? 5 : 3;
  for (let i = 0; i < puffs; i++) {
    const a = seed * 5 + i * 2.4;
    const rr = i === 0 ? 0 : 0.16 + 0.06 * rnd(seed, i);
    const y = i === 0 ? 0.72 : 0.6 + 0.2 * rnd(i, seed);
    // Зимой листа нет: купа — голые ветви, меньше и темнее, снег ложится на них сверху.
    const r = (0.17 + 0.06 * rnd(seed + 3, i)) * (season === 'winter' ? 0.72 : 1);
    puff(s, V(Math.cos(a) * rr, y, Math.sin(a) * rr), V(r * 1.2, r * 0.95, r * 1.2), color, seed + i, hi ? 8 : 6, center);
  }
  return finish(s);
}

/** Берёза: тонкий белый ствол в чёрных чечевичках и полосах, крона лёгкая и светлая, купы вытянуты вниз. */
export function birch(detail: Detail, seed: number, season: Season): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const s = split();
  const hi = detail === 'hi';
  const leaf = BIRCH_LEAF[season];
  const lean = (rnd(seed, 1) - 0.5) * 0.04;
  // Ствол — девятью кольцами: чёрные чечевички штрихами поперёк ствола должны лечь на свои кольца, а не растечься по
  // трём кольцам на весь ствол (белые «сосульки» под кроной в дымке — находка снимка П-4).
  const rings = 9;
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    path.push(V(lean * 2 * t, -0.02 + 0.64 * t, lean * t * t));
    radii.push(0.026 - 0.018 * t);
  }
  s.bark.tube(path, radii, {
    seg: hi ? 7 : 5,
    color: (u, a) => {
      // Тёмный низ, а выше — штрихи на двух-трёх кольцах, каждый — на своей стороне ствола: берёзу узнают по коре.
      if (u < 0.07) return 0x4a443c;
      const ring = Math.round(u * (rings - 1));
      const mark = (ring === 2 || ring === 4 || ring === 6) && Math.cos(a - ring * 1.7 - seed) > 0.35;
      return mark ? BARK.birchMark : mix(BARK.birch, 0xd8d2c4, rnd(ring, seed));
    },
    skin: rigid(0),
    caps: [null, 0.5],
  });
  const center = V(lean * 1.6, 0.66, 0);
  const color = (p: THREE.Vector3): number => mix(leaf.deep, leaf.light, smooth(0.45, 0.9, p.y) * (0.6 + 0.4 * noise3(p.x * 6, p.y * 6 + seed, p.z * 6)));
  const puffs = hi ? 4 : 2;
  for (let i = 0; i < puffs; i++) {
    const a = seed * 2 + i * 2.6;
    const rr = i === 0 ? 0 : 0.1 + 0.05 * rnd(seed, i + 9);
    const y = 0.56 + 0.22 * (i / puffs) + 0.05 * rnd(i, seed);
    const k = season === 'winter' ? 0.7 : 1;
    puff(s, V(center.x + Math.cos(a) * rr, y, Math.sin(a) * rr), V(0.12 * k, 0.15 * k, 0.12 * k), color, seed + i * 3, hi ? 7 : 6, center);
  }
  return finish(s);
}

/** Ива: короткий толстый ствол с развилкой, крона — свисающие до воды пряди вокруг шапки; серебристая зелень. */
export function willow(detail: Detail, seed: number, season: Season): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const s = split();
  const hi = detail === 'hi';
  const leaf = WILLOW_LEAF[season];
  s.bark.tube([V(0, -0.02, 0), V(0.01, 0.2, 0), V(0.02, 0.36, 0)], [0.07, 0.06, 0.05], { seg: hi ? 8 : 6, color: BARK.oak, skin: rigid(0), caps: [null, 0.4] });
  for (const sx of [-1, 1]) s.bark.tube([V(0.02, 0.34, 0), V(sx * 0.1, 0.5, 0.02), V(sx * 0.14, 0.62, 0.03)], [0.035, 0.026, 0.014], { seg: hi ? 6 : 4, color: BARK.oak, skin: rigid(0), caps: [null, 0.4] });
  const center = V(0, 0.62, 0);
  const color = (p: THREE.Vector3): number => mix(leaf.deep, leaf.light, smooth(0.25, 0.85, p.y) * (0.6 + 0.4 * noise3(p.x * 7, p.y * 4 + seed, p.z * 7)));
  puff(s, V(0, 0.74, 0), V(0.27, 0.16, 0.27), color, seed, hi ? 9 : 6, center);
  const strands = hi ? 7 : 4;
  for (let i = 0; i < strands; i++) {
    const a = seed + (i / strands) * Math.PI * 2;
    const r = 0.21 + 0.05 * rnd(seed, i);
    // Прядь — вытянутая вниз купа: ива плачет к воде.
    puff(s, V(Math.cos(a) * r, 0.52 - 0.06 * rnd(i, seed), Math.sin(a) * r), V(0.1, 0.26, 0.1), color, seed + i * 5, hi ? 7 : 5, center);
  }
  return finish(s);
}

/** Сосна-зонтик (тёплое море): высокий голый ствол с наклоном и плоская шапка наверху. */
export function pine(detail: Detail, seed: number): { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const s = split();
  const hi = detail === 'hi';
  const lean = 0.08 + 0.04 * rnd(seed, 1);
  s.bark.tube([V(0, -0.02, 0), V(lean * 0.4, 0.45, 0), V(lean, 0.86, 0)], [0.035, 0.028, 0.018], { seg: hi ? 7 : 5, color: (u) => mix(0x4a3426, 0x7a5a40, u), skin: rigid(0), caps: [null, 0.4] });
  const center = V(lean, 0.9, 0);
  const color = (p: THREE.Vector3): number => mix(0x2e4a26, 0x5e7e3e, smooth(0.86, 0.98, p.y) * (0.6 + 0.4 * noise3(p.x * 6, p.y * 6 + seed, p.z * 6)));
  for (let k = 0; k < (hi ? 4 : 3); k++) {
    const a = seed + k * 2.1;
    puff(s, V(lean + Math.cos(a) * 0.12, 0.9 + 0.02 * k, Math.sin(a) * 0.12), V(0.28, 0.08, 0.25), color, seed + k, hi ? 9 : 6, center);
  }
  return finish(s);
}

const WILLOW_LEAF: Record<Season, { deep: number; light: number }> = {
  spring: { deep: 0x5a7a3a, light: 0xb4cc78 },
  summer: { deep: 0x4e6e36, light: 0x9ab468 },
  autumn: { deep: 0x8a7a34, light: 0xd8c060 },
  winter: { deep: 0x5a5240, light: 0x7d6e52 },
};

/** Листва по сезону: глубь, середина и свет купы. */
const LEAF: Record<Season, { deep: number; mid: number; light: number }> = {
  spring: { deep: 0x3e6a30, mid: 0x6a9a3e, light: 0xa8cc6a },
  summer: { deep: 0x2c5428, mid: 0x4a7a34, light: 0x86a850 },
  autumn: { deep: 0x6a4a1e, mid: 0xb0742a, light: 0xe0b048 },
  winter: { deep: 0x2e2620, mid: 0x463a30, light: 0x5e5244 },
};
const BIRCH_LEAF: Record<Season, { deep: number; light: number }> = {
  spring: { deep: 0x4a7a30, light: 0xb4d470 },
  summer: { deep: 0x3e6a2e, light: 0x9ac05c },
  autumn: { deep: 0xa07a24, light: 0xf0c848 },
  winter: { deep: 0x3a3228, light: 0x5a4e40 },
};

/** Камень: шар с шумом, приплюснутый и наполовину в земле; сверху — мох. */
export function rock(seed: number, detail: Detail): THREE.BufferGeometry {
  const s = new Sculpt();
  const seg = detail === 'hi' ? 10 : 7;
  s.blob(V(0, 0.15, 0), V(0.55, 0.38, 0.45), new THREE.Euler(0, seed, 0), (p) => {
    const moss = smooth(0.28, 0.48, p.y) * noise3(p.x * 4 + seed, p.y * 4, p.z * 4);
    return mix(mix(0x6a665e, 0x8a867c, noise3(p.x * 6, p.y * 6, p.z * 6 + seed)), 0x4e6a34, smooth(0.35, 0.6, moss));
  }, rigid(0), seg, Math.round(seg * 0.7), (p) => (noise3(p.x * 3 + seed * 3, p.y * 3, p.z * 3) - 0.5) * 0.22);
  return s.geometry({ under: 0.5, ground: 0.55, groundUp: 0.25 });
}

// ---------- Трава и цветы ----------

/** Трава по сезону: корень, середина, кончик. Зимой — солома из-под снега. */
const GRASS: Record<Season, { root: number; mid: number; tip: number }> = {
  spring: { root: 0x34502a, mid: 0x5e8a3c, tip: 0x9cba66 },
  summer: { root: 0x2e4626, mid: 0x547a38, tip: 0x8ca85a },
  autumn: { root: 0x4a4424, mid: 0x8a7a3a, tip: 0xc8b064 },
  winter: { root: 0x5a4a30, mid: 0x9a8458, tip: 0xd0bc8a },
};

/**
 * Пучок травы: травинки треугольниками от общего корня, изогнуты наружу; корень тёмный, кончик светлый. Высота — 1:
 * рост даёт копия. Кончик выше корня по Y — ветер гнёт от корня квадратом (`NAT_ROOT`).
 */
export function grassClump(blades: number, season: Season, seed = 1): THREE.BufferGeometry {
  const c = GRASS[season];
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const _c = new THREE.Color();
  const put = (x: number, y: number, z: number, hex: number, nx: number, nz: number): void => {
    pos.push(x, y, z);
    _c.setHex(hex);
    col.push(_c.r, _c.g, _c.b);
    // Нормаль травинки — вверх и наружу: пучок светится сверху, а не плашками по сторонам.
    const l = Math.hypot(nx, 1, nz);
    nor.push(nx / l, 1 / l, nz / l);
  };
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd(seed, b) * 1.2;
    const r = 0.03 + 0.05 * rnd(b, seed + 2);
    const h = 0.6 + 0.4 * rnd(b + 7, seed);
    const lean = 0.18 + 0.2 * rnd(b, seed + 5);
    const w = 0.022 + 0.01 * rnd(b + 3, seed);
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    // Основа поперёк направления наклона, кончик — вынесен наружу.
    const px = -sz * w;
    const pz = cx * w;
    const bx = cx * r;
    const bz = sz * r;
    put(bx - px, 0, bz - pz, c.root, cx * 0.5, sz * 0.5);
    put(bx + px, 0, bz + pz, c.root, cx * 0.5, sz * 0.5);
    put(bx + cx * lean * h, h, bz + sz * lean * h, mix(c.mid, c.tip, rnd(b, seed + 9)), cx * 0.8, sz * 0.8);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Цветок: стебель и венчик из пяти лепестков вокруг тёмной середины; цвет венчика даёт копия (`setColorAt`). */
export function flower(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const _c = new THREE.Color();
  const put = (x: number, y: number, z: number, hex: number, ny = 1): void => {
    pos.push(x, y, z);
    _c.setHex(hex);
    col.push(_c.r, _c.g, _c.b);
    nor.push(0, ny, 0.2);
  };
  // Стебель — тонкая тёмно-зелёная пластинка.
  put(-0.006, 0, 0, 0x3a5a2a, 0.3);
  put(0.006, 0, 0, 0x3a5a2a, 0.3);
  put(0, 0.2, 0, 0x5a8a3a, 0.3);
  // Венчик: пять лепестков веером, середина — жёлто-бурая.
  const y = 0.2;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2;
    const a1 = a0 + 0.9;
    put(0, y + 0.004, 0, 0x8a6a20);
    put(Math.cos(a0) * 0.045, y + 0.01, Math.sin(a0) * 0.045, 0xffffff);
    put(Math.cos(a1) * 0.045, y + 0.01, Math.sin(a1) * 0.045, 0xf4f2ea);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Цвета луга по сезону: ромашка, лютик, колокольчик, клевер. Зимой цветов нет. */
export const BLOOM: Record<Season, readonly number[]> = {
  spring: [0xffffff, 0xf2d23a, 0x8a7ad8, 0xf2f0f8],
  summer: [0xffffff, 0xf2d23a, 0x6a7ad8, 0xd86a9a],
  autumn: [0xf0e0b0, 0xd8a02a],
  winter: [],
};

// ---------- Раскладка копиями ----------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

/** Место копии: точка, поворот, рост (и ширина) и тон. */
export interface Spot {
  x: number;
  z: number;
  y?: number;
  yaw: number;
  h: number;
  w?: number;
  tint?: number;
  /** Наклон, рад: берёза и сухостой не стоят свечками. */
  lean?: number;
}

/** Копии одной сетки по местам. Нет мест — нет меша (вызова отрисовки тоже). */
export function scatter(geo: THREE.BufferGeometry, mat: THREE.Material, spots: readonly Spot[], name: string, shadow = false): THREE.InstancedMesh | null {
  if (!spots.length) {
    geo.dispose();
    return null;
  }
  const m = new THREE.InstancedMesh(geo, mat, spots.length);
  m.name = name;
  spots.forEach((s, i) => {
    _e.set(s.lean ?? 0, s.yaw, (s.lean ?? 0) * 0.6, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(s.x, s.y ?? 0, s.z);
    _s.set(s.w ?? s.h, s.h, s.w ?? s.h);
    _m.compose(_p, _q, _s);
    m.setMatrixAt(i, _m);
    m.setColorAt(i, _col.setHex(s.tint ?? 0xffffff));
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

/** Где не расти: круги вокруг того, что стоит у игры (кусты, стог, жерди, укрытия). */
export interface Keep {
  x: number;
  z: number;
  r: number;
}

const free = (x: number, z: number, keep: readonly Keep[]): boolean => !keep.some((k) => Math.hypot(x - k.x, z - k.z) < k.r);

/**
 * Места травы в кольце `from..to` вокруг `(cx, cz)`: гуще к середине, где ходит игрок, реже к лесу — дальше трава видна
 * землёй, а не копиями. Рост — `h0..h1`; `density` — множитель числа на ступени.
 */
export function grassSpots(n: number, cx: number, cz: number, from: number, to: number, h0: number, h1: number, keep: readonly Keep[], seed: number): Spot[] {
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd(i, seed) * Math.PI * 2;
    // Гуще к середине, где ходит игрок и куда смотрят под ноги; к лесу поле читается землёй и цветами.
    const r = from + (to - from) * rnd(i, seed + 1) ** 0.85;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!free(x, z, keep)) continue;
    const patch = noise3(x * 0.35, 0, z * 0.35);
    const h = h0 + (h1 - h0) * (0.4 * rnd(i, seed + 2) + 0.6 * patch);
    out.push({ x, z, yaw: rnd(i, seed + 3) * Math.PI * 2, h, w: h * (0.8 + 0.4 * rnd(i, seed + 4)), tint: mix(0xffffff, 0xd8e0c0, rnd(i, seed + 5)) });
  }
  return out;
}

/** Места цветов: кучками, а не ровной сыпью — луг цветёт пятнами. */
export function bloomSpots(n: number, cx: number, cz: number, from: number, to: number, season: Season, keep: readonly Keep[], seed: number): Spot[] {
  const colors = BLOOM[season];
  if (!colors.length) return [];
  const out: Spot[] = [];
  const clusters = Math.max(3, Math.round(n / 14));
  for (let c = 0; c < clusters; c++) {
    const a = rnd(c, seed) * Math.PI * 2;
    const r = from + (to - from) * Math.sqrt(rnd(c, seed + 1));
    const ox = cx + Math.cos(a) * r;
    const oz = cz + Math.sin(a) * r;
    const color = colors[Math.floor(rnd(c, seed + 2) * colors.length)];
    for (let i = 0; i < n / clusters; i++) {
      const aa = rnd(i + c * 50, seed + 3) * Math.PI * 2;
      const rr = 1.4 * Math.sqrt(rnd(i + c * 50, seed + 4));
      const x = ox + Math.cos(aa) * rr;
      const z = oz + Math.sin(aa) * rr;
      if (!free(x, z, keep)) continue;
      out.push({ x, z, yaw: rnd(i, c) * 6.3, h: 0.9 + 0.6 * rnd(i, c + 1), tint: color });
    }
  }
  return out;
}

/** Деревья кольцом: порода и рост по зерну; кольцо — от `from` до `to`, `step` — шаг между стволами по дуге, м. */
export interface Ring {
  from: number;
  to: number;
  step: number;
  /** Доли пород: ель, лиственное, берёза. */
  mix: readonly [number, number, number];
  /** Рост, м: от и до. */
  h0: number;
  h1: number;
}

export type TreeKind = 'spruce' | 'broadleaf' | 'birch';

/** Места деревьев кольца по породам; где не расти — `keep` (кусты, загон, укрытия). */
export function treeSpots(ring: Ring, cx: number, cz: number, keep: readonly Keep[], seed: number): Record<TreeKind, Spot[]> {
  const out: Record<TreeKind, Spot[]> = { spruce: [], broadleaf: [], birch: [] };
  let n = 0;
  for (let r = ring.from; r < ring.to; r += ring.step * 0.85) {
    const count = Math.max(6, Math.round((Math.PI * 2 * r) / ring.step));
    for (let i = 0; i < count; i++) {
      n++;
      const a = ((i + rnd(n, seed) * 0.85) / count) * Math.PI * 2;
      const rr = r + (rnd(n, seed + 1) - 0.5) * ring.step * 0.7;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (!free(x, z, keep)) continue;
      const pick = rnd(n, seed + 2);
      const kind: TreeKind = pick < ring.mix[0] ? 'spruce' : pick < ring.mix[0] + ring.mix[1] ? 'broadleaf' : 'birch';
      const h = ring.h0 + (ring.h1 - ring.h0) * rnd(n, seed + 3);
      const w = h * (kind === 'spruce' ? 0.85 + 0.3 * rnd(n, seed + 4) : 0.9 + 0.35 * rnd(n, seed + 4));
      const tint = kind === 'spruce' ? mix(0xffffff, 0xc8d8c0, rnd(n, seed + 5)) : mix(0xffffff, 0xe8f0c8, rnd(n, seed + 5));
      out[kind].push({ x, z, yaw: rnd(n, seed + 6) * Math.PI * 2, h, w, tint, lean: kind === 'birch' ? (rnd(n, seed + 7) - 0.5) * 0.12 : 0 });
    }
  }
  return out;
}

/** Роща: копии деревьев по породам — кора и крона каждой породы по вызову. */
export function grove(spots: Record<TreeKind, Spot[]>, mats: NatureMats, season: Season, detail: Detail, seed: number, shadow: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'grove';
  const make = { spruce: () => spruce(detail, seed), broadleaf: () => broadleaf(detail, seed + 1, season), birch: () => birch(detail, seed + 2, season) } as const;
  for (const kind of ['spruce', 'broadleaf', 'birch'] as const) {
    const at = spots[kind];
    if (!at.length) continue;
    const t = make[kind]();
    const bark = scatter(t.bark, mats.of('bark'), at.map((s) => ({ ...s, tint: 0xffffff })), `${kind}-bark`, shadow);
    const crown = scatter(t.crown, mats.of(kind === 'spruce' ? 'needle' : 'leaf'), at, `${kind}-crown`, shadow);
    if (bark) g.add(bark);
    if (crown) g.add(crown);
  }
  return g;
}

// ---------- Земля ----------

/** Чем окрашена земля в точке: цвет sRGB. */
export type Paint = (x: number, z: number) => number;

/** Высота земли в точке: ровно в круге игры (`flat`), дальше — пологие холмы. Деревья и камни ставятся на неё. */
export const groundY =
  (flat: number, seed: number) =>
  (x: number, z: number): number =>
    smooth(flat, flat + 8, Math.hypot(x, z)) * (noise3(x * 0.07 + seed, 0, z * 0.07) - 0.35) * 2.2;

/**
 * Земля кругом радиусом `R`: кольца гуще у середины, где на неё смотрят под ноги; ровная в круге игры (`flat`), дальше
 * — пологие холмы к лесу. Цвет — `paint` по месту; гладкая, а не гранями.
 */
export function groundDisk(R: number, flat: number, paint: Paint, detail: Detail, seed: number): THREE.BufferGeometry {
  const SEG = detail === 'hi' ? 80 : 56;
  const radii: number[] = [0];
  let r = 0;
  // У ног — гуще (на неё смотрят сверху вниз), к лесу — реже: дальше земля — цвет, а не рельеф.
  while (r < flat + 2) radii.push((r += (detail === 'hi' ? 0.8 : 1.2) + r * 0.06));
  while (r < R) radii.push((r += r < 30 ? 2.6 : 6));
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const _c = new THREE.Color();
  for (let i = 0; i < radii.length; i++) {
    const rr = radii[i];
    const n = i === 0 ? 1 : SEG;
    for (let j = 0; j < n; j++) {
      const a = ((j + (i % 2) * 0.5) / SEG) * Math.PI * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      pos.push(x, groundY(flat, seed)(x, z), z);
      _c.setHex(paint(x, z));
      col.push(_c.r, _c.g, _c.b);
    }
  }
  // Середина — веером, дальше кольца полосами.
  for (let j = 0; j < SEG; j++) idx.push(0, 1 + ((j + 1) % SEG), 1 + j);
  for (let i = 1; i < radii.length - 1; i++) {
    const a0 = 1 + (i - 1) * SEG;
    const b0 = a0 + SEG;
    for (let j = 0; j < SEG; j++) {
      const a = a0 + j;
      const a1 = a0 + ((j + 1) % SEG);
      const b = b0 + j;
      const b1 = b0 + ((j + 1) % SEG);
      idx.push(a, a1, b, a1, b1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Земля по сезону: трава, сухая трава, лесная подстилка, вытоптанное, грязь. */
export const SOIL: Record<Season, { lush: number; dry: number; litter: number; trodden: number; mud: number; moss: number }> = {
  spring: { lush: 0x527432, dry: 0x7c8448, litter: 0x564a32, trodden: 0x74664a, mud: 0x564634, moss: 0x44602c },
  summer: { lush: 0x4b6c2e, dry: 0x86824c, litter: 0x564a32, trodden: 0x7e6e50, mud: 0x5a4a36, moss: 0x405a2c },
  autumn: { lush: 0x6a6c36, dry: 0x96804a, litter: 0x7a5630, trodden: 0x7e6c4c, mud: 0x564634, moss: 0x52602e },
  winter: { lush: 0x8a8a6a, dry: 0xa89a76, litter: 0x6a5a44, trodden: 0x8a7a5e, mud: 0x5e5040, moss: 0x6a6a4a },
};
