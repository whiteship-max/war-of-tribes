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
import { CLIPS, type FigureFrame, type TwPlan } from './plan';

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

/** Сустав по кадру клипа, смешанный между двумя соседними кадрами; потом рост, разворот и место фигуры. */
const VERT_BODY = /* glsl */ `
mat4 twM = twBone(aAnim.x, aJoint) * (1.0 - aAnim.z) + twBone(aAnim.y, aJoint) * aAnim.z;
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
function crowdMaterial(bones: BoneTexture): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
  mat.name = 'tw-crowd';
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
  mat.customProgramCacheKey = () => 'tw-crowd';
  return mat;
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

interface Group {
  baked: BakedLook;
  mesh: THREE.InstancedMesh;
  place: THREE.InstancedBufferAttribute;
  anim: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
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
  private proxyMaterial: THREE.MeshLambertMaterial | null = null;
  private rows = { a: 0, b: 0, w: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private plan: TwPlan,
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
    if (spec.shadow === 'proxy') {
      this.proxyMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
      this.proxyMaterial.name = 'tw-shadow-proxy';
    }
    baked.forEach((b, gi) => {
      const figures = Int32Array.from(byKey.get(keys[gi])!);
      const n = figures.length;
      const mesh = new THREE.InstancedMesh(b.geometry, this.material, n);
      mesh.name = `tw-${b.look.key}`;
      // Матрица инстанса — единичная навсегда: место и разворот приходят своими атрибутами (`aPlace`).
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const place = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      place.setUsage(THREE.DynamicDrawUsage);
      anim.setUsage(THREE.DynamicDrawUsage);
      b.geometry.setAttribute('aPlace', place);
      b.geometry.setAttribute('aAnim', anim);
      b.geometry.setAttribute('aTint', tint);
      tint.setUsage(THREE.DynamicDrawUsage);
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
      this.groups.push({ baked: b, mesh, place, anim, tint, figures, proxy });
    });
  }

  /** Разложить кадр фигур по инстансам. */
  update(frame: FigureFrame): void {
    for (const g of this.groups) {
      const { place, anim, tint, figures, proxy } = g;
      const pa = place.array as Float32Array;
      const aa = anim.array as Float32Array;
      const ta = tint.array as Float32Array;
      let shown = 0;
      for (let j = 0; j < figures.length; j++) {
        const i = figures[j];
        if (!frame.shown[i]) continue;
        const k = shown++;
        pa[k * 4] = frame.x[i];
        pa[k * 4 + 1] = frame.y[i];
        pa[k * 4 + 2] = frame.z[i];
        pa[k * 4 + 3] = frame.yaw[i];
        frameRows(g.baked, CLIPS[frame.clip[i]], frame.time[i], this.rows);
        aa[k * 4] = this.rows.a;
        aa[k * 4 + 1] = this.rows.b;
        aa[k * 4 + 2] = this.rows.w;
        aa[k * 4 + 3] = this.plan.scale[i];
        // Сторона и тон — по месту инстанса в кадре, а не по номеру фигуры: погасший бежавший сдвигает всех за ним.
        ta[k * 2] = this.plan.units[this.plan.unitOf[i]].ours ? 0 : 1;
        ta[k * 2 + 1] = this.plan.tone[i];
        if (proxy) {
          // Павший кладёт тень плашмя: столбик ложится вдоль земли.
          const down = CLIPS[frame.clip[i]] === 'fall';
          this.q.setFromAxisAngle(this.up, frame.yaw[i]);
          this.v.set(frame.x[i], frame.y[i], frame.z[i]);
          this.s.set(1, down ? 0.18 : this.plan.scale[i], down ? 1.6 : 1);
          proxy.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
        }
      }
      g.mesh.count = shown;
      place.needsUpdate = true;
      anim.needsUpdate = true;
      tint.needsUpdate = true;
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

  /** Сколько треугольников у бойцов в кадре (без тени): по ним сверяется бюджет. */
  triangles(): number {
    return this.groups.reduce((n, g) => n + g.baked.triangles * g.mesh.count, 0);
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
      if (g.proxy) {
        g.proxy.geometry.dispose();
        g.proxy.dispose();
      }
    }
    this.material.dispose();
    this.proxyMaterial?.dispose();
    this.bones.dispose();
  }
}
