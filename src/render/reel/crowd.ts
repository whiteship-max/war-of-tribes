// Толпа ролика TW: сотни бойцов строем (docs/battle_tw.md, разделы 3 и 8; облик — docs/polish.md, П-5).
//
// Инстансы на вид бойца, меш и кадры клипов — запечённые (`bake.ts`). На фигуру в кадр пишется место, разворот, две
// строки клипа с долей смешивания, рост, сторона, тон и зерно — тринадцать чисел, а не матрица на каждую деталь, как у
// пула фигур посёлка (`figures.ts`): там фигур десятки, здесь — сотни.
//
// Облик — по дальности (`LOD_PX`, `NEAR_PX`): вблизи — точные формы снаряжения, средний — прежние примитивы, вдали — без
// мелочи и одним кадром клипа. Фигура вне кадра камеры не пишется вовсе (сфера против пирамиды обзора): вершин в кадре
// столько, сколько бойцов видно, а не сколько их на поле. Тени заместителей пишутся у всех — тень приходит и из-за края.
//
// Разброс в строю — шейдер по зерну фигуры (`aTint.z`): кожа, волосы, борода, шоссы, масть коня, вариант шлема. Поле
// герба стороны (`paint.paintField`) — текстура двух клеток, наша слева, их справа, на щитах и груди сюрко; обод щита и
// сюрко — цвет стороны (`side.ts`): сторона читается и у бойца в чужих красках герба.
//
// Тень бойцов — заместитель (`spec.shadow`): столбик на фигуру в отдельном инстансе, которого видит только камера
// тени (слой `SHADOW_LAYER`). Своего материала глубины с костями не нужно, и поза в тени на этом расстоянии не
// видна (решение 4).
import * as THREE from 'three';
import { sidePaint } from '@/side';
import { anyArms } from '@/heraldry/arms';
import { ARMS_ASPECT, canPaintArms, paintField } from '@/heraldry/paint';
import type { TwSpec } from './spec';
import { LODS, bakeLooks, frameRows, lookOf, type BakedLook, type BoneTexture } from './bake';
import { CLIPS, type FigureFrame, type Troupe } from './troupe';

/** Слой, который видит только камера тени: заместители тени бойцов. */
export const SHADOW_LAYER = 1;

/**
 * Наши в золоте, чужие в красном — цвет стороны на всех деталях, включая щит и гребень; краска под светом сцены из одной
 * двери (`side.sidePaint`), той же, что у прежнего ролика (`render/battle/troops.CLOTH_OF`).
 */
export const SIDE_CLOTH = { ours: sidePaint(true), theirs: sidePaint(false) } as const;

/**
 * Разброс в строю: краски, из которых шейдер выбирает каждому бойцу свою (sRGB). Кожа, волосы (от чёрных до седых и
 * светлых), некрашеная и крашеная растительной краской шерсть шосс и капюшонов, масть коня и грива к ней. Ни одной — в
 * цвет чужой стороны (`side.test.ts`).
 */
export const CROWD_TINTS = {
  skin: [0xe2b48c, 0xd9a77a, 0xc48d62, 0xa8744e],
  hair: [0x2a1f19, 0x3b2a20, 0x5a3c26, 0x7a4e2c, 0xa98a5a, 0x8c8680],
  hose: [0x6c5a46, 0x5b4c3d, 0x7a6c56, 0x5a5e4a, 0x4f5158, 0x6e5a3e],
  horse: [0x7a5236, 0x8a4f2a, 0x2f2622, 0x9a958c, 0xa88358],
  mane: [0x2a1d16, 0x6e3c1e, 0x1c1714, 0xd8d4cc, 0x3a2c20],
} as const;

const VERT_HEAD = /* glsl */ `
attribute float aJoint;
attribute float aSide;
attribute vec4 aPart;
attribute vec4 aPlace;
attribute vec4 aAnim;
attribute vec3 aTint;
uniform highp sampler2D uBones;
uniform vec3 uSide0;
uniform vec3 uSide1;
uniform vec3 uSkin[4];
uniform vec3 uHair[6];
uniform vec3 uHose[6];
uniform vec3 uHorse[5];
uniform vec3 uMane[5];
varying vec3 vCoat;
mat4 twBone(float row, float joint) {
  ivec2 c = ivec2(int(joint) * 3, int(row));
  vec4 r0 = texelFetch(uBones, c, 0);
  vec4 r1 = texelFetch(uBones, c + ivec2(1, 0), 0);
  vec4 r2 = texelFetch(uBones, c + ivec2(2, 0), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
`;

/**
 * Сустав по кадру клипа, смешанный между двумя соседними кадрами; потом рост, разворот и место фигуры. Дальний облик
 * (`TW_FAR`) берёт один кадр без смешивания: выборок из текстуры суставов вдвое меньше, а разницу в долю кадра на бойце
 * в дюжину пикселей не видно. Вариант детали, не выпавший этому бойцу (`aPart.y`: шлем не тот, бороды нет), сжимается в
 * точку сустава — треугольников нет, вызова лишнего тоже.
 */
const VERT_BODY = /* glsl */ `
#ifdef TW_FAR
mat4 twM = twBone(aAnim.z < 0.5 ? aAnim.x : aAnim.y, aJoint);
#else
mat4 twM = twBone(aAnim.x, aJoint) * (1.0 - aAnim.z) + twBone(aAnim.y, aJoint) * aAnim.z;
#endif
float twHide = 0.0;
if (aPart.y > 0.5) {
  if (aPart.y < 9.5) twHide = step(0.55, fract(aTint.z * 7.31));
  else {
    float twN = floor(aPart.y / 10.0);
    float twK = aPart.y - twN * 10.0;
    twHide = abs(floor(fract(aTint.z * 3.71) * twN) + 1.0 - twK) > 0.5 ? 1.0 : 0.0;
  }
}
float twC = cos(aPlace.w);
float twS = sin(aPlace.w);
mat3 twYaw = mat3(twC, 0.0, -twS, 0.0, 1.0, 0.0, twS, 0.0, twC);
objectNormal = twYaw * (mat3(twM) * objectNormal);
`;

const VERT_POS = /* glsl */ `
transformed = twYaw * ((twM * vec4(transformed * (1.0 - twHide), 1.0)).xyz * aAnim.w) + aPlace.xyz;
`;

const VERT_COLOR = /* glsl */ `
#if defined( USE_COLOR )
  vec3 twSideC = mix(uSide0, uSide1, aTint.x) * (1.0 + aTint.y);
  int twMat = int(aPart.x + 0.5);
  vec3 twCol = vColor;
  if (twMat == 1) twCol = uSkin[int(fract(aTint.z * 5.13) * 4.0)];
  else if (twMat == 2) twCol = uHair[int(fract(aTint.z * 11.7) * 6.0)];
  else if (twMat == 3) twCol = uHose[int(fract(aTint.z * 17.3) * 6.0)];
  else if (twMat == 4) twCol = vColor * (0.82 + 0.36 * fract(aTint.z * 23.9));
  else if (twMat == 5) twCol = vColor * (0.85 + 0.3 * fract(aTint.z * 29.3));
  else if (twMat == 6) twCol = uHorse[int(fract(aTint.z * 13.9) * 5.0)];
  else if (twMat == 7) twCol = uMane[int(fract(aTint.z * 13.9) * 5.0)];
  vColor = aSide > 0.0 ? twSideC * aSide : twCol * (1.0 + aTint.y * 0.4);
#endif
vCoat = vec3(aPart.z, aPart.w, aTint.x);
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vCoat;
uniform sampler2D uArms;
uniform float uHasArms;
`;

/** Поле герба поверх цвета стороны — где у вершин есть место на гербе; вдали (`TW_FAR`) — цвет стороны. */
const FRAG_COLOR = /* glsl */ `
#ifndef TW_FAR
if (uHasArms > 0.5 && vCoat.x >= 0.0) {
  vec4 twA = texture2D(uArms, vec2((clamp(vCoat.x, 0.0, 1.0) + vCoat.z) * 0.5, clamp(vCoat.y, 0.0, 1.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, twA.rgb, twA.a);
}
#endif
`;

/** Клетка текстуры поля герба: ширина в точках, высота — по пропорции герба. */
const COAT_W = 64;
const COAT_H = Math.ceil(COAT_W * ARMS_ASPECT);

/**
 * Поле гербов сторон для щитов и сюрко: наша клетка слева (`u` 0…0.5), их — справа; без щита и обвода — форму задаёт
 * доска (`gear.ts`). Без холста (тест в узле) — `null`: щиты цвета стороны.
 */
export function fieldTexture(coats: { ours: string; theirs: string }): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !canPaintArms()) return null;
  const c = document.createElement('canvas');
  c.width = COAT_W * 2;
  c.height = COAT_H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  paintField(ctx, anyArms(coats.ours), 0, 0, COAT_W, COAT_H);
  paintField(ctx, anyArms(coats.theirs), COAT_W, 0, COAT_W, COAT_H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // Холст рисует сверху вниз, а `v` поля — снизу вверх.
  t.flipY = true;
  t.anisotropy = 4;
  return t;
}

const linear = (hexes: readonly number[]): THREE.Color[] => hexes.map((h) => new THREE.Color(h));

/** Материал толпы: Ламберт игры (тот же, что у фигур, `materials.INSTANCED`) плюс суставы из текстуры. */
function crowdMaterial(bones: BoneTexture, arms: THREE.Texture | null, far = false): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
  mat.name = far ? 'tw-crowd-far' : 'tw-crowd';
  if (far) mat.defines = { TW_FAR: '' };
  const ours = new THREE.Color(SIDE_CLOTH.ours);
  const theirs = new THREE.Color(SIDE_CLOTH.theirs);
  const tints = {
    uSkin: { value: linear(CROWD_TINTS.skin) },
    uHair: { value: linear(CROWD_TINTS.hair) },
    uHose: { value: linear(CROWD_TINTS.hose) },
    uHorse: { value: linear(CROWD_TINTS.horse) },
    uMane: { value: linear(CROWD_TINTS.mane) },
  };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBones = { value: bones };
    sh.uniforms.uSide0 = { value: ours };
    sh.uniforms.uSide1 = { value: theirs };
    Object.assign(sh.uniforms, tints);
    sh.uniforms.uArms = { value: arms };
    sh.uniforms.uHasArms = { value: arms ? 1 : 0 };
    sh.vertexShader = VERT_HEAD + sh.vertexShader;
    sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + VERT_BODY)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_POS)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_COLOR);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
  };
  mat.customProgramCacheKey = () => (far ? 'tw-crowd-far' : 'tw-crowd');
  return mat;
}

/**
 * Боец мельче стольких пикселей эталонного экрана (портрет 844) — в дальнем облике; крупнее `NEAR_PX` — в ближнем. Порог
 * дальнего выше, чем видно разницу: дальний облик теряет предплечья и мелочь, а это читается только у бойца крупнее двух
 * десятков точек; ближний — там, где видно наносник шлема и герб на щите.
 */
export const LOD_PX = 14;
export const NEAR_PX = 44;
const REF_H = 844;
const MAN_H = 1.05;

/** Расстояние до камеры, дальше которого боец — в дальнем облике: по полю зрения камеры. */
export function lodDistance(fovDeg: number): number {
  return ((REF_H / 2) / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * (MAN_H / LOD_PX);
}

/** Расстояние, ближе которого боец — в ближнем облике. */
export const nearDistance = (fovDeg: number): number => (lodDistance(fovDeg) * LOD_PX) / NEAR_PX;

/** Добавочные фигуры вида (`Crowd.extras`): разложить `k`-ю и показать первые `count`. */
export interface CrowdExtras {
  mesh: THREE.InstancedMesh;
  set(k: number, x: number, y: number, z: number, yaw: number, clip: (typeof CLIPS)[number], time: number): void;
  show(count: number): void;
}

/** Заместитель тени: столбик ростом с человека (пеший) или с всадника (конный, зверь — ниже и длиннее). */
function proxyGeometry(body: 'man' | 'horse' | 'beast'): THREE.BufferGeometry {
  if (body === 'horse') return new THREE.BoxGeometry(0.42, 1.75, 1.5).translate(0, 0.88, 0);
  if (body === 'beast') return new THREE.BoxGeometry(0.22, 0.5, 0.9).translate(0, 0.32, 0);
  return new THREE.BoxGeometry(0.34, 1.0, 0.22).translate(0, 0.5, 0);
}

/** Инстансы одного облика: меш и его атрибуты места, клипа и тона. */
interface Instances {
  mesh: THREE.InstancedMesh;
  place: THREE.InstancedBufferAttribute;
  anim: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
}

function instances(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string): Instances {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = name;
  // Матрица инстанса — единичная навсегда: место и разворот приходят своими атрибутами (`aPlace`).
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const place = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  for (const a of [place, anim, tint]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPlace', place);
  geo.setAttribute('aAnim', anim);
  geo.setAttribute('aTint', tint);
  mesh.count = 0;
  mesh.visible = false;
  return { mesh, place, anim, tint };
}

interface Group {
  baked: BakedLook;
  /** Облики по дальности (`bake.LODS`): вдали, средний, вблизи. */
  sets: [Instances, Instances, Instances];
  /** Фигуры этого вида — номера в плане. */
  figures: Int32Array;
  /** Радиус сферы отсечения и высота её середины: всадник с копьём выше и длиннее пешего. */
  reach: number;
  lift: number;
  proxy: THREE.InstancedMesh | null;
}

/** Зерно фигуры для разброса в строю: от номера, одно на весь ролик — у бойца не меняется шлем посреди боя. */
const seedOf = (i: number): number => {
  const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return s - Math.floor(s);
};

export class Crowd {
  readonly group = new THREE.Group();
  readonly bones: BoneTexture;
  private groups: Group[] = [];
  /** Геометрии добавочных фигур: свои только атрибуты инстансов, остальное — у вида (`extras`). */
  private extraMeshes: THREE.InstancedMesh[] = [];
  private material: THREE.MeshLambertMaterial;
  private farMaterial: THREE.MeshLambertMaterial;
  private proxyMaterial: THREE.MeshLambertMaterial | null = null;
  private arms: THREE.CanvasTexture | null;
  private seeds: Float32Array;
  private rows = { a: 0, b: 0, w: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private frustum = new THREE.Frustum();
  private viewProj = new THREE.Matrix4();
  /** Бойцов в кадре по обликам (вдали, средний, вблизи) — стенду и замеру. */
  readonly shown: [number, number, number] = [0, 0, 0];

  constructor(
    private plan: Troupe,
    spec: TwSpec,
    coats: { ours: string; theirs: string } | null = null,
  ) {
    this.group.name = 'tw-crowd';
    // Виды боя: что надето, по отрядам; один набор обликов на вид.
    const byKey = new Map<string, number[]>();
    const looks = new Map<string, ReturnType<typeof lookOf>>();
    for (const u of plan.units) {
      for (let i = u.first; i < u.first + u.figures; i++) {
        const face = plan.faceIds[plan.faceOf[i]];
        const look = lookOf(face.id, face.kind);
        looks.set(look.key, look);
        const list = byKey.get(look.key) ?? [];
        list.push(i);
        byKey.set(look.key, list);
      }
    }
    const keys = [...byKey.keys()].sort();
    const { baked, texture } = bakeLooks(
      keys.map((k) => looks.get(k)!),
      spec.bakeFps,
    );
    this.bones = texture;
    this.arms = coats ? fieldTexture(coats) : null;
    this.material = crowdMaterial(texture, this.arms);
    this.farMaterial = crowdMaterial(texture, null, true);
    this.seeds = new Float32Array(plan.unitOf.length);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = seedOf(i);
    if (spec.shadow === 'proxy') {
      this.proxyMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
      this.proxyMaterial.name = 'tw-shadow-proxy';
    }
    baked.forEach((b, gi) => {
      const figures = Int32Array.from(byKey.get(keys[gi])!);
      const n = figures.length;
      const sets = LODS.map((d) =>
        instances(b.lods[d], d === 0 ? this.farMaterial : this.material, n, `tw-${['far', 'mid', 'near'][d]}-${b.look.key}`),
      ) as Group['sets'];
      for (const set of sets) this.group.add(set.mesh);
      let proxy: THREE.InstancedMesh | null = null;
      if (this.proxyMaterial) {
        proxy = new THREE.InstancedMesh(proxyGeometry(b.look.body), this.proxyMaterial, n);
        proxy.name = `tw-shadow-${b.look.key}`;
        proxy.castShadow = true;
        proxy.receiveShadow = false;
        proxy.frustumCulled = false;
        proxy.layers.set(SHADOW_LAYER);
        proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(proxy);
      }
      const horse = b.look.body === 'horse';
      this.groups.push({ baked: b, sets, figures, reach: horse ? 2.1 : 1.35, lift: horse ? 1.0 : 0.65, proxy });
    });
  }

  /**
   * Разложить кадр фигур по инстансам. `camera` — камера кадра: облик по дальности до неё, фигуры вне её пирамиды обзора
   * не пишутся; без камеры (снимок без камеры, тест) — все в среднем облике. `pin` — все в этом облике (стенд шеренги).
   */
  update(frame: FigureFrame, camera: THREE.PerspectiveCamera | null = null, pin: 0 | 1 | 2 | null = null): void {
    let far2 = Infinity;
    let near2 = -1;
    const eye = camera ? camera.position : null;
    if (camera) {
      camera.updateMatrixWorld();
      this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProj);
      const far = lodDistance(camera.fov);
      const near = nearDistance(camera.fov);
      far2 = far * far;
      near2 = near * near;
    }
    const planes = this.frustum.planes;
    this.shown[0] = this.shown[1] = this.shown[2] = 0;
    const cursor = [0, 0, 0];
    for (const g of this.groups) {
      const { figures, proxy, sets } = g;
      cursor[0] = cursor[1] = cursor[2] = 0;
      let shadows = 0;
      for (let j = 0; j < figures.length; j++) {
        const i = figures[j];
        if (!frame.shown[i]) continue;
        const scale = this.plan.scale[i];
        if (proxy) {
          // Павший кладёт тень плашмя: столбик ложится вдоль земли.
          const down = CLIPS[frame.clip[i]] === 'fall';
          this.q.setFromAxisAngle(this.up, frame.yaw[i]);
          this.v.set(frame.x[i], frame.y[i], frame.z[i]);
          this.s.set(1, down ? 0.18 : scale, down ? 1.6 : 1);
          proxy.setMatrixAt(shadows++, this.m.compose(this.v, this.q, this.s));
        }
        let lod: number = pin ?? 1;
        if (eye && pin === null) {
          // Вне пирамиды обзора — не пишется: сфера фигуры целиком за одной из плоскостей.
          const cx = frame.x[i];
          const cy = frame.y[i] + g.lift * scale;
          const cz = frame.z[i];
          const r = g.reach * scale;
          let out = false;
          for (let k = 0; k < 6; k++) {
            const p = planes[k];
            if (p.normal.x * cx + p.normal.y * cy + p.normal.z * cz + p.constant < -r) {
              out = true;
              break;
            }
          }
          if (out) continue;
          const dx = cx - eye.x;
          const dy = cy - eye.y;
          const dz = cz - eye.z;
          const d2 = (dx * dx + dy * dy + dz * dz) / (scale * scale);
          lod = d2 > far2 ? 0 : d2 < near2 ? 2 : 1;
        }
        const set = sets[lod];
        const m = cursor[lod]++;
        const pa = set.place.array as Float32Array;
        const aa = set.anim.array as Float32Array;
        const ta = set.tint.array as Float32Array;
        pa[m * 4] = frame.x[i];
        pa[m * 4 + 1] = frame.y[i];
        pa[m * 4 + 2] = frame.z[i];
        pa[m * 4 + 3] = frame.yaw[i];
        frameRows(g.baked, CLIPS[frame.clip[i]], frame.time[i], this.rows);
        aa[m * 4] = this.rows.a;
        aa[m * 4 + 1] = this.rows.b;
        aa[m * 4 + 2] = this.rows.w;
        aa[m * 4 + 3] = scale;
        // Сторона, тон и зерно — по месту инстанса в кадре, а не по номеру фигуры: погасший бежавший сдвигает всех за ним.
        ta[m * 3] = this.plan.units[this.plan.unitOf[i]].ours ? 0 : 1;
        ta[m * 3 + 1] = this.plan.tone[i];
        ta[m * 3 + 2] = this.seeds[i];
      }
      for (let d = 0; d < 3; d++) {
        const set = sets[d];
        set.mesh.count = cursor[d];
        set.mesh.visible = cursor[d] > 0;
        set.place.needsUpdate = true;
        set.anim.needsUpdate = true;
        set.tint.needsUpdate = true;
        this.shown[d] += cursor[d];
      }
      if (proxy) {
        proxy.count = shadows;
        proxy.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * Добавочные фигуры того же вида, что фигура плана `template`, — не бойцы плана: расчёты машин обстрела и сбитые со
   * стены (`siegeworks.ts`, docs/battle_tw.md, раздел 15). Свой инстанс на геометрию среднего облика и тот же материал
   * (запечённые позы — те же), место и клип — от хозяина. Без тени: их немного, и стоят они далеко от строя.
   */
  extras(template: number, n: number): CrowdExtras | null {
    const g = this.groups.find((x) => x.figures.includes(template));
    if (!g || n <= 0) return null;
    const src = g.baked.lods[1];
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (name !== 'aPlace' && name !== 'aAnim' && name !== 'aTint') geo.setAttribute(name, attr);
    }
    geo.setIndex(src.index);
    const place = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (const a of [place, anim, tint]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPlace', place);
    geo.setAttribute('aAnim', anim);
    geo.setAttribute('aTint', tint);
    const mesh = new THREE.InstancedMesh(geo, this.material, n);
    mesh.name = `tw-extra-${g.baked.look.key}`;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    this.group.add(mesh);
    const baked = g.baked;
    const rows = { a: 0, b: 0, w: 0 };
    const ours = this.plan.units[this.plan.unitOf[template]].ours ? 0 : 1;
    const tone = this.plan.tone[template];
    const scale = this.plan.scale[template];
    const extra: CrowdExtras = {
      mesh,
      set: (k, x, y, z, yaw, clip, time) => {
        const pa = place.array as Float32Array;
        const aa = anim.array as Float32Array;
        const ta = tint.array as Float32Array;
        pa[k * 4] = x;
        pa[k * 4 + 1] = y;
        pa[k * 4 + 2] = z;
        pa[k * 4 + 3] = yaw;
        frameRows(baked, clip, time, rows);
        aa[k * 4] = rows.a;
        aa[k * 4 + 1] = rows.b;
        aa[k * 4 + 2] = rows.w;
        aa[k * 4 + 3] = scale;
        ta[k * 3] = ours;
        ta[k * 3 + 1] = tone + ((k * 37) % 11) * 0.01 - 0.05;
        ta[k * 3 + 2] = seedOf(template * 31 + k);
      },
      show: (count) => {
        mesh.count = count;
        place.needsUpdate = true;
        anim.needsUpdate = true;
        tint.needsUpdate = true;
      },
    };
    this.extraMeshes.push(mesh);
    return extra;
  }

  /** Тени бойцов заместителями — включить или погасить (сторож ролика опустил уровень, у которого их нет). */
  shadows(on: boolean): void {
    for (const g of this.groups) if (g.proxy) g.proxy.visible = on;
  }

  /** Сколько треугольников у бойцов в кадре (без тени): по ним сверяется бюджет. */
  triangles(): number {
    return this.groups.reduce((n, g) => n + g.sets.reduce((k, s, d) => k + g.baked.lodTriangles[d] * s.mesh.count, 0), 0);
  }

  /** Виды и сколько фигур у каждого, треугольники обликов (вдали, средний, вблизи) — стенду. */
  looks(): { key: string; figures: number; triangles: number; lods: [number, number, number] }[] {
    return this.groups.map((g) => ({ key: g.baked.look.key, figures: g.figures.length, triangles: g.baked.lodTriangles[1], lods: g.baked.lodTriangles }));
  }

  dispose(): void {
    // Геометрия добавочных делит буферы вида: снимаются только свои атрибуты инстансов — общие уйдут с видом.
    for (const mesh of this.extraMeshes) {
      const geo = mesh.geometry;
      for (const n of Object.keys(geo.attributes)) if (n !== 'aPlace' && n !== 'aAnim' && n !== 'aTint') geo.deleteAttribute(n);
      geo.setIndex(null);
      geo.dispose();
      mesh.dispose();
    }
    for (const g of this.groups) {
      for (const s of g.sets) {
        s.mesh.geometry.dispose();
        s.mesh.dispose();
      }
      if (g.proxy) {
        g.proxy.geometry.dispose();
        g.proxy.dispose();
      }
    }
    this.material.dispose();
    this.farMaterial.dispose();
    this.proxyMaterial?.dispose();
    this.arms?.dispose();
    this.bones.dispose();
  }
}
