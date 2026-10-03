// Знамёна ролика TW: у каждого отряда, стяг у полководца (docs/battle_tw.md, раздел 3).
//
// Знамя держит знаменосец — фигура ближе всех к середине строя (правило прежнего ролика: знамя стоит на занятом
// месте, а не шестом посреди травы). Пал знаменосец — знамя валится; отряд бежит — знамя кренится и уходит с ним.
// На общем виде знамя — главное, по чему отряд читается, поэтому оно крупнее жизни и растёт с расстоянием камеры
// (как значок отряда в Total War), а полотнище всегда повёрнуто к камере.
//
// Полотнище цвета стороны, на нём знак рода светлой краской — шейдером, без текстуры: копья — столб, пехота —
// андреевский крест, лучники — шеврон, конница — пояс, латные — крест, ополчение — круг. У стяга полководца —
// золотая кайма.
import * as THREE from 'three';
import type { UnitKind } from '@/battle/types';
import { PALETTE } from '../palette';
import { SIDE_CLOTH } from './crowd';
import { bearerOf, type FigureFrame, type TwPlan, type TwUnit } from './plan';

/** Высота древка и размер полотнища, метры сцены: выше копий (копьё — 1.4 роста, `SPEAR_LEN`). */
const POLE = 3.3;
const CLOTH_W = 1.05;
const CLOTH_H = 1.45;
/** Стяг полководца крупнее знамени отряда во столько раз. */
const STANDARD = 1.45;
/** Знамя растёт с расстоянием камеры, но не меньше жизни и не больше этого. */
const GROW_FROM = 45;
const GROW_MAX = 2.0;
/** Знак рода. */
const EMBLEM: Record<UnitKind, number> = { spear: 0, infantry: 1, archer: 2, cavalry: 3, heavy: 4 };
const FOLK_EMBLEM = 5;

/** Древко с перекладиной и навершием — одной геометрией с цветом в вершинах. */
function kitGeometry(): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, number][] = [
    [new THREE.CylinderGeometry(0.035, 0.045, POLE, 5, 1, true).translate(0, POLE / 2, 0), PALETTE.woodDark],
    [new THREE.CylinderGeometry(0.025, 0.025, CLOTH_W + 0.16, 4, 1, true).rotateZ(Math.PI / 2).translate(0, POLE - 0.12, 0), PALETTE.woodDark],
    [new THREE.ConeGeometry(0.08, 0.26, 5).translate(0, POLE + 0.12, 0), 0xc9a24a],
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (const [g, hex] of parts) {
    const off = pos.length / 3;
    c.set(hex);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    const gi = g.getIndex()!;
    for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + off);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Полотнище: висит с перекладины, верх — у неё; `uv` — для знака. */
function clothGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 4, 8);
  g.translate(0, POLE - 0.12 - CLOTH_H / 2, 0.02);
  return g;
}

const CLOTH_VERT = /* glsl */ `
attribute vec4 aBan;
uniform float uTime;
varying vec2 vBanUv;
varying vec4 vBan;
`;

const CLOTH_WAVE = /* glsl */ `
vBanUv = uv;
vBan = aBan;
// Полотнище колышется: низ сильнее верха, у каждого знамени своя фаза.
float twLoose = 1.0 - uv.y;
transformed.z += sin(uv.y * 4.0 + uTime * 2.6 + aBan.z) * 0.07 * twLoose + sin(uTime * 1.3 + aBan.z) * 0.05 * twLoose;
transformed.x += sin(uTime * 1.7 + aBan.z * 1.3) * 0.04 * twLoose * twLoose;
`;

const CLOTH_FRAG = /* glsl */ `
uniform vec3 uSide0;
uniform vec3 uSide1;
uniform vec3 uPaint;
uniform vec3 uGold;
varying vec2 vBanUv;
varying vec4 vBan;
float twEmblem(vec2 p, float id) {
  vec2 q = vec2(p.x, (p.y - 0.12) / 0.88);
  if (id < 0.5) return step(abs(q.x - 0.5), 0.13);
  if (id < 1.5) { float a = abs((q.x - 0.5) - (q.y - 0.5) * 0.72); float b = abs((q.x - 0.5) + (q.y - 0.5) * 0.72); return step(min(a, b), 0.09); }
  if (id < 2.5) return step(abs((q.y - 0.42) - abs(q.x - 0.5) * 0.85), 0.09);
  if (id < 3.5) return step(abs(q.y - 0.55), 0.11);
  if (id < 4.5) return max(step(abs(q.x - 0.5), 0.09), step(abs(q.y - 0.6), 0.08));
  return step(length((q - vec2(0.5, 0.58)) * vec2(1.0, 1.4)), 0.2);
}
`;

const CLOTH_COLOR = /* glsl */ `
vec2 twUv = vBanUv;
// Ласточкин хвост внизу: полотнище читается знаменем, а не простынёй.
if (twUv.y < 0.14 && abs(twUv.x - 0.5) < (0.14 - twUv.y) * 1.6) discard;
vec3 twBase = mix(uSide0, uSide1, vBan.y);
float twMark = twEmblem(twUv, vBan.x);
vec3 twC = mix(twBase, uPaint, twMark);
// Кайма: у стяга полководца — золотая и шире.
float twEdge = min(min(twUv.x, 1.0 - twUv.x), 1.0 - twUv.y);
twC = mix(twC, vBan.w > 0.5 ? uGold : twBase * 0.62, step(twEdge, vBan.w > 0.5 ? 0.09 : 0.035));
diffuseColor.rgb = twC;
`;

export class Banners {
  readonly group = new THREE.Group();
  private kit: THREE.InstancedMesh;
  private cloth: THREE.InstancedMesh;
  private ban: THREE.InstancedBufferAttribute;
  private units: TwUnit[];
  private bearer: Int32Array;
  private time = { value: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private plan: TwPlan) {
    this.group.name = 'tw-banners';
    this.units = plan.units.filter((u) => u.banner !== null);
    const n = Math.max(1, this.units.length);
    // Знаменосец — фигура ближе всех к середине строя, во второй шеренге, если она есть (`bearerOf`, одна дверь с режиссурой).
    this.bearer = Int32Array.from(this.units.map((u) => bearerOf(plan, u)));
    const kitMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
    kitMat.name = 'tw-banner-kit';
    this.kit = new THREE.InstancedMesh(kitGeometry(), kitMat, n);
    this.kit.name = 'tw-banner-kit';
    this.kit.castShadow = true;
    this.kit.frustumCulled = false;
    const clothMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    clothMat.name = 'tw-banner-cloth';
    const time = this.time;
    clothMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.uniforms.uSide0 = { value: new THREE.Color(SIDE_CLOTH.ours) };
      sh.uniforms.uSide1 = { value: new THREE.Color(SIDE_CLOTH.theirs) };
      sh.uniforms.uPaint = { value: new THREE.Color(0xe6dcc2) };
      // Бахрома и навершие — светлое золото: на золотом полотнище своих (`side.ts`) тёмное золото пропало бы.
      sh.uniforms.uGold = { value: new THREE.Color(0xf0dfa8) };
      sh.vertexShader = CLOTH_VERT + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CLOTH_WAVE);
      sh.fragmentShader = CLOTH_FRAG + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + CLOTH_COLOR);
    };
    clothMat.customProgramCacheKey = () => 'tw-banner-cloth';
    const clothGeo = clothGeometry();
    this.ban = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    clothGeo.setAttribute('aBan', this.ban);
    this.units.forEach((u, k) => {
      const emblem = u.face === 'militia' ? FOLK_EMBLEM : EMBLEM[u.kind];
      this.ban.setXYZW(k, emblem, u.ours ? 0 : 1, (u.id * 1.618) % 6.283, u.banner === 'standard' ? 1 : 0);
    });
    this.cloth = new THREE.InstancedMesh(clothGeo, clothMat, n);
    this.cloth.name = 'tw-banner-cloth';
    this.cloth.castShadow = true;
    this.cloth.frustumCulled = false;
    this.kit.count = this.units.length;
    this.cloth.count = this.units.length;
    this.group.add(this.kit, this.cloth);
  }

  /** Разложить знамёна: у знаменосца, к камере полотнищем, крупнее с расстоянием. */
  update(frame: FigureFrame, t: number, camera: THREE.Camera, camDist: number): void {
    this.time.value = t;
    const grow = Math.min(GROW_MAX, Math.max(1, camDist / GROW_FROM));
    this.units.forEach((u, k) => {
      const i = this.bearer[k];
      const x = frame.x[i];
      const z = frame.z[i];
      const y = frame.y[i];
      // Пал знаменосец — знамя валится набок за секунду; отряд бежит — кренится назад.
      const deathAt = this.plan.deathAt[i];
      const fallen = deathAt <= t ? Math.min(1.45, (t - deathAt) * 2.2) : 0;
      const flee = u.fleeAt !== null && t > u.fleeAt ? Math.min(0.45, (t - u.fleeAt) * 0.9) : 0;
      const yaw = Math.atan2(camera.position.x - x, camera.position.z - z);
      this.e.set(fallen > 0 ? 0 : -flee, yaw, fallen, 'YXZ');
      this.q.setFromEuler(this.e);
      // Знаменосец убежал за край поля и погас — знамя уходит с ним.
      const big = frame.shown[i] ? (u.banner === 'standard' ? STANDARD : 1) * grow : 0;
      this.s.setScalar(big);
      // Древко в руке знаменосца — чуть в стороне от его оси.
      this.v.set(x + 0.22 * Math.cos(frame.yaw[i]), y, z - 0.22 * Math.sin(frame.yaw[i]));
      this.m.compose(this.v, this.q, this.s);
      this.kit.setMatrixAt(k, this.m);
      this.cloth.setMatrixAt(k, this.m);
    });
    this.kit.instanceMatrix.needsUpdate = true;
    this.cloth.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.kit.geometry.dispose();
    (this.kit.material as THREE.Material).dispose();
    this.kit.dispose();
    this.cloth.geometry.dispose();
    (this.cloth.material as THREE.Material).dispose();
    this.cloth.dispose();
  }
}
