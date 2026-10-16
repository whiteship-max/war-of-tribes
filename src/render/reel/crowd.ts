// Толпа ролика TW: сотни бойцов строем (docs/battle_tw.md, разделы 3 и 8).
//
// Один `InstancedMesh` на вид бойца, меш и кадры клипов — запечённые (`bake.ts`). На фигуру в кадр пишется место,
// разворот, две строки клипа с долей смешивания, рост, сторона и тон — двенадцать чисел, а не матрица на каждую
// деталь, как у пула фигур посёлка (`figures.ts`): там фигур десятки, здесь — сотни.
//
// Тень бойцов — заместитель (`spec.shadow`): столбик на фигуру в отдельном инстансе, которого видит только камера
// тени (слой `SHADOW_LAYER`). Своего материала глубины с костями не нужно, и поза в тени на этом расстоянии не
// видна (решение 4).
import * as THREE from 'three';
import { sidePaint } from '@/side';
import type { TwSpec } from './spec';
import { bakeLooks, frameRows, lookOf, type BakedLook, type BoneTexture } from './bake';
import { CLIPS, type FigureFrame, type Troupe } from './troupe';

/** Слой, который видит только камера тени: заместители тени бойцов. */
export const SHADOW_LAYER = 1;

/**
 * Наши в золоте, чужие в красном — цвет стороны на всех деталях, включая щит и гребень; краска под светом сцены из одной
 * двери (`side.sidePaint`), той же, что у прежнего ролика (`render/battle/troops.CLOTH_OF`).
 */
export const SIDE_CLOTH = { ours: sidePaint(true), theirs: sidePaint(false) } as const;

const VERT_HEAD = /* glsl */ `
attribute float aJoint;
attribute float aSide;
attribute vec4 aPlace;
attribute vec4 aAnim;
attribute vec2 aTint;
uniform highp sampler2D uBones;
uniform vec3 uSide0;
uniform vec3 uSide1;
varying float vSide;
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
 * в дюжину пикселей не видно.
 */
const VERT_BODY = /* glsl */ `
#ifdef TW_FAR
mat4 twM = twBone(aAnim.z < 0.5 ? aAnim.x : aAnim.y, aJoint);
#else
mat4 twM = twBone(aAnim.x, aJoint) * (1.0 - aAnim.z) + twBone(aAnim.y, aJoint) * aAnim.z;
#endif
float twC = cos(aPlace.w);
float twS = sin(aPlace.w);
mat3 twYaw = mat3(twC, 0.0, -twS, 0.0, 1.0, 0.0, twS, 0.0, twC);
objectNormal = twYaw * (mat3(twM) * objectNormal);
`;

const VERT_POS = /* glsl */ `
transformed = twYaw * ((twM * vec4(transformed, 1.0)).xyz * aAnim.w) + aPlace.xyz;
`;

const VERT_COLOR = /* glsl */ `
#if defined( USE_COLOR )
  vec3 twSideC = mix(uSide0, uSide1, aTint.x) * (1.0 + aTint.y);
  vColor = aSide > 0.0 ? twSideC * aSide : vColor * (1.0 + aTint.y * 0.4);
#endif
`;

/** Материал толпы: Ламберт игры (тот же, что у фигур, `materials.INSTANCED`) плюс суставы из текстуры. */
function crowdMaterial(bones: BoneTexture, far = false): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
  mat.name = far ? 'tw-crowd-far' : 'tw-crowd';
  if (far) mat.defines = { TW_FAR: '' };
  const ours = new THREE.Color(SIDE_CLOTH.ours);
  const theirs = new THREE.Color(SIDE_CLOTH.theirs);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBones = { value: bones };
    sh.uniforms.uSide0 = { value: ours };
    sh.uniforms.uSide1 = { value: theirs };
    sh.vertexShader = VERT_HEAD + sh.vertexShader;
    sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + VERT_BODY)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_POS)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_COLOR);
  };
  mat.customProgramCacheKey = () => (far ? 'tw-crowd-far' : 'tw-crowd');
  return mat;
}

/**
 * Боец мельче стольких пикселей эталонного экрана (портрет 844) — в дальнем облике (`BakedLook.far`). Порог выше, чем
 * видно разницу: дальний облик теряет предплечья и мелочь, а это читается только у бойца крупнее двух десятков точек.
 */
export const LOD_PX = 14;
const REF_H = 844;
const MAN_H = 1.05;

/** Расстояние до камеры, дальше которого боец — в дальнем облике: по полю зрения камеры. */
export function lodDistance(fovDeg: number): number {
  return ((REF_H / 2) / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * (MAN_H / LOD_PX);
}

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
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  for (const a of [place, anim, tint]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPlace', place);
  geo.setAttribute('aAnim', anim);
  geo.setAttribute('aTint', tint);
  return { mesh, place, anim, tint };
}

interface Group {
  baked: BakedLook;
  mesh: THREE.InstancedMesh;
  place: THREE.InstancedBufferAttribute;
  anim: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  /** Дальний облик тех же фигур (`BakedLook.far`). */
  far: Instances;
  /** Фигуры этого вида — номера в плане. */
  figures: Int32Array;
  proxy: THREE.InstancedMesh | null;
}

export class Crowd {
  readonly group = new THREE.Group();
  readonly bones: BoneTexture;
  private groups: Group[] = [];
  /** Геометрии добавочных фигур: свои только атрибуты инстансов, остальное — у вида (`extras`). */
  private extraMeshes: THREE.InstancedMesh[] = [];
  private material: THREE.MeshLambertMaterial;
  private farMaterial: THREE.MeshLambertMaterial;
  private proxyMaterial: THREE.MeshLambertMaterial | null = null;
  private rows = { a: 0, b: 0, w: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private plan: Troupe,
    spec: TwSpec,
  ) {
    this.group.name = 'tw-crowd';
    // Виды боя: что надето, по отрядам; один меш на вид.
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
    this.material = crowdMaterial(texture);
    this.farMaterial = crowdMaterial(texture, true);
    if (spec.shadow === 'proxy') {
      this.proxyMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
      this.proxyMaterial.name = 'tw-shadow-proxy';
    }
    baked.forEach((b, gi) => {
      const figures = Int32Array.from(byKey.get(keys[gi])!);
      const n = figures.length;
      const { mesh, place, anim, tint } = instances(b.geometry, this.material, n, `tw-${b.look.key}`);
      const far = instances(b.far, this.farMaterial, n, `tw-far-${b.look.key}`);
      far.mesh.count = 0;
      this.group.add(far.mesh);
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
      this.group.add(mesh);
      this.groups.push({ baked: b, mesh, place, anim, tint, far, figures, proxy });
    });
  }

  /**
   * Разложить кадр фигур по инстансам. `eye` — камера: дальше `lod` метров боец — в дальнем облике; без неё — все
   * ближние (снимок без камеры, тест).
   */
  update(frame: FigureFrame, eye: { x: number; y: number; z: number } | null = null, lod = Infinity): void {
    const lod2 = lod * lod;
    for (const g of this.groups) {
      const { place, anim, tint, figures, proxy, far } = g;
      const near = { pa: place.array as Float32Array, aa: anim.array as Float32Array, ta: tint.array as Float32Array, n: 0 };
      const away = { pa: far.place.array as Float32Array, aa: far.anim.array as Float32Array, ta: far.tint.array as Float32Array, n: 0 };
      let shown = 0;
      for (let j = 0; j < figures.length; j++) {
        const i = figures[j];
        if (!frame.shown[i]) continue;
        const k = shown++;
        const dx = eye ? frame.x[i] - eye.x : 0;
        const dy = eye ? frame.y[i] - eye.y : 0;
        const dz = eye ? frame.z[i] - eye.z : 0;
        const to = eye && dx * dx + dy * dy + dz * dz > lod2 ? away : near;
        const m = to.n++;
        const { pa, aa, ta } = to;
        pa[m * 4] = frame.x[i];
        pa[m * 4 + 1] = frame.y[i];
        pa[m * 4 + 2] = frame.z[i];
        pa[m * 4 + 3] = frame.yaw[i];
        frameRows(g.baked, CLIPS[frame.clip[i]], frame.time[i], this.rows);
        aa[m * 4] = this.rows.a;
        aa[m * 4 + 1] = this.rows.b;
        aa[m * 4 + 2] = this.rows.w;
        aa[m * 4 + 3] = this.plan.scale[i];
        // Сторона и тон — по месту инстанса в кадре, а не по номеру фигуры: погасший бежавший сдвигает всех за ним.
        ta[m * 2] = this.plan.units[this.plan.unitOf[i]].ours ? 0 : 1;
        ta[m * 2 + 1] = this.plan.tone[i];
        if (proxy) {
          // Павший кладёт тень плашмя: столбик ложится вдоль земли.
          const down = CLIPS[frame.clip[i]] === 'fall';
          this.q.setFromAxisAngle(this.up, frame.yaw[i]);
          this.v.set(frame.x[i], frame.y[i], frame.z[i]);
          this.s.set(1, down ? 0.18 : this.plan.scale[i], down ? 1.6 : 1);
          proxy.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
        }
      }
      g.mesh.count = near.n;
      place.needsUpdate = true;
      anim.needsUpdate = true;
      tint.needsUpdate = true;
      far.mesh.count = away.n;
      far.place.needsUpdate = true;
      far.anim.needsUpdate = true;
      far.tint.needsUpdate = true;
      if (proxy) {
        proxy.count = shown;
        proxy.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * Добавочные фигуры того же вида, что фигура плана `template`, — не бойцы плана: расчёты машин обстрела и сбитые со
   * стены (`siegeworks.ts`, docs/battle_tw.md, раздел 15). Свой инстанс на ту же геометрию и тот же материал (запечённые
   * позы — те же), место и клип — от хозяина. Без тени: их немного, и стоят они далеко от строя.
   */
  extras(template: number, n: number): CrowdExtras | null {
    const g = this.groups.find((x) => x.figures.includes(template));
    if (!g || n <= 0) return null;
    const src = g.baked.geometry;
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (name !== 'aPlace' && name !== 'aAnim' && name !== 'aTint') geo.setAttribute(name, attr);
    }
    geo.setIndex(src.index);
    const place = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
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
        ta[k * 2] = ours;
        ta[k * 2 + 1] = tone + ((k * 37) % 11) * 0.01 - 0.05;
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
    return this.groups.reduce((n, g) => n + g.baked.triangles * g.mesh.count + g.baked.farTriangles * g.far.mesh.count, 0);
  }

  /** Виды и сколько фигур у каждого — стенду. */
  looks(): { key: string; figures: number; triangles: number }[] {
    return this.groups.map((g) => ({ key: g.baked.look.key, figures: g.figures.length, triangles: g.baked.triangles }));
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
      g.mesh.geometry.dispose();
      g.mesh.dispose();
      g.far.mesh.geometry.dispose();
      g.far.mesh.dispose();
      if (g.proxy) {
        g.proxy.geometry.dispose();
        g.proxy.dispose();
      }
    }
    this.material.dispose();
    this.farMaterial.dispose();
    this.proxyMaterial?.dispose();
    this.bones.dispose();
  }
}
