// Ночной свет сцены (docs/polish.md, П-9): огни места — настоящие (униформы шейдеров), огоньки с ореолом над каждым
// источником и пятна на земле под низкими. Одна сборка на город, ролик боя и ролик осады; числа — `lamps.ts`.
//
// Цена: огоньки — один вызов точками на всё место, пятна — один вызов экземплярами; настоящий свет — цикл до
// `LAMP_SPEC.real` огней в шейдерах, что его берут (здания, земля, люди ролика). Кадр пишет только веса и цвета.
import * as THREE from 'three';
import { LAMP, LampSlots, MAX_LAMPS, lampFlicker, lampLife, lampLinear, lampOn, pooled, type Lamp } from './lamps';
import { LAMP_GLSL } from './glsl';

/** Униформы огней: одни на все материалы сцены. Места — в мире сцены. */
export interface GlowUniforms {
  [k: string]: THREE.IUniform;
  gLampPos: { value: THREE.Vector4[] };
  gLampCol: { value: THREE.Vector4[] };
  gLampN: { value: number };
  /** Лунная ночь сцены (0 — день, 1 — ночь): тёмное холоднеет — гамма заплатки `litByLamps`, как `cBlue` города. */
  gBlue: { value: number };
}

export function glowUniforms(): GlowUniforms {
  return {
    gLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
    gLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
    gLampN: { value: 0 },
    gBlue: { value: 0 },
  };
}

/** Огонь в мире сцены: `s` — единиц мира на метр (город — 1, город в ролике — `CITY_M`). */
export interface WorldLamp extends Lamp {
  s: number;
}

/** Огни места в мир сцены: переход `m` (нет — как есть) и единиц на метр `s`. */
export function lampsToWorld(lamps: readonly Lamp[], m: THREE.Matrix4 | null, s = 1): WorldLamp[] {
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  return lamps.map((l) => {
    v.set(l.x, l.y, l.z);
    d.set(l.dx, 0, l.dz);
    if (m) {
      v.applyMatrix4(m);
      d.transformDirection(m);
    }
    return { ...l, x: v.x, y: v.y, z: v.z, dx: d.x, dz: d.z, s };
  });
}

/** `THREE.DynamicDrawUsage` числом: см. смешивание пятен ниже. */
const DYNAMIC = 35048;

/** Сила пятна: оно множит землю, как свет (`src·dst + dst`), и стоит вместо настоящего света низкого огня. */
const POOL_POWER = 1.35;

const FLAME_VERT = /* glsl */ `
attribute vec2 gSize;
attribute float gK;
attribute vec3 gCol;
uniform float gPx;
varying vec3 vCol;
varying float vK;
varying float vCore;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Ореол — к камере на полрадиуса: стена, на которой висит факел, не режет его прямым краем.
  mv.xyz += normalize(-mv.xyz) * gSize.y * 0.5;
  gl_Position = projectionMatrix * mv;
  float px = gSize.y * gPx / max(-mv.z, 0.01);
  gl_PointSize = gK < 0.004 ? 0.0 : max(px, 2.0);
  vCore = gSize.x / gSize.y;
  vCol = gCol;
  vK = gK;
}
`;

const FLAME_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vK;
varying float vCore;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  // Ореол — лёгкий: воздух у огня теплеет, кадр не засвечен.
  float h = 1.0 - r2;
  h = h * h * h * 0.14;
  // Пламя — капля: уже кверху, сердце ниже середины, у сердца — почти белое.
  vec2 c = vec2(q.x / (vCore * 0.7), (q.y + vCore * 0.3) / (vCore * 1.2));
  float core = exp(-dot(c, c) * 2.4);
  vec3 col = vCol * h + mix(vCol, vec3(1.0, 0.86, 0.62), 0.55) * core * 1.15;
  gl_FragColor = vec4(col * vK, 1.0);
  #include <colorspace_fragment>
}
`;

const POOL_VERT = /* glsl */ `
attribute float pK;
attribute vec3 pCol;
varying vec2 vQ;
varying vec3 vC;
void main() {
  vQ = uv * 2.0 - 1.0;
  vC = pCol * pK;
  vec3 p = position * step(0.003, pK);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const POOL_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vC;
void main() {
  float x = dot(vQ, vQ);
  if (x >= 1.0) discard;
  float win = 1.0 - x * x;
  gl_FragColor = vec4(vC * (win * win / (1.0 + 9.0 * x)), 1.0);
}
`;

/**
 * Свет места на кадр: огни, их огоньки и пятна, униформы настоящих. Огоньки и пятна — в `group` (мир сцены), униформы —
 * `uniforms` (их берут материалы: город — `CityUniforms`, ролик — `litByLamps`).
 */
export class LampRig {
  readonly group = new THREE.Group();
  readonly uniforms: GlowUniforms;
  private slots: LampSlots;
  private on: Float32Array;
  private cap: number;
  private flames: THREE.Points;
  private flameK: THREE.BufferAttribute;
  private flameU = { gPx: { value: 400 } };
  private pools: THREE.InstancedMesh | null = null;
  private poolK: THREE.InstancedBufferAttribute | null = null;
  /** Огни с пятном: номер огня по порядку пятен. */
  private pooled: number[] = [];
  private col: [number, number, number][];

  constructor(
    readonly lamps: readonly WorldLamp[],
    /** Сколько огней настоящих (`LAMP_SPEC[уровень].real`). */
    cap: number,
    uniforms: GlowUniforms = glowUniforms(),
    /** Где лежит земля под огнём (мир): пятно ложится на неё. Нет — под огнём на его высоте над землёй. */
    groundAt?: (x: number, z: number) => number,
  ) {
    this.group.name = 'glow';
    this.uniforms = uniforms;
    this.slots = new LampSlots(lamps);
    this.on = new Float32Array(lamps.length);
    this.cap = cap;
    this.col = lamps.map((l) => lampLinear(l.kind));

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap((l) => [l.x, l.y, l.z]), 3));
    g.setAttribute('gSize', new THREE.Float32BufferAttribute(lamps.flatMap((l) => [LAMP[l.kind].core * l.s, LAMP[l.kind].halo * l.s]), 2));
    g.setAttribute('gCol', new THREE.Float32BufferAttribute(this.col.flat(), 3));
    this.flameK = new THREE.Float32BufferAttribute(new Float32Array(lamps.length), 1);
    this.flameK.setUsage(DYNAMIC);
    g.setAttribute('gK', this.flameK);
    const fm = new THREE.ShaderMaterial({
      uniforms: this.flameU,
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    fm.name = 'glow-flames';
    this.flames = new THREE.Points(g, fm);
    this.flames.name = 'glow-flames';
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 3;
    this.group.add(this.flames);

    lamps.forEach((l, i) => {
      if (pooled(l)) this.pooled.push(i);
    });
    if (this.pooled.length > 0) {
      const pg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
      this.poolK = new THREE.InstancedBufferAttribute(new Float32Array(this.pooled.length), 1);
      this.poolK.setUsage(DYNAMIC);
      pg.setAttribute('pK', this.poolK);
      pg.setAttribute('pCol', new THREE.InstancedBufferAttribute(new Float32Array(this.pooled.flatMap((i) => this.col[i])), 3));
      const pm = new THREE.ShaderMaterial({
        vertexShader: POOL_VERT,
        fragmentShader: POOL_FRAG,
        transparent: true,
        depthWrite: false,
        // Пятно множит землю, как свет: src·dst + dst. Числа констант three (CustomBlending, AddEquation, DstColorFactor,
        // OneFactor), а не их имена: имя тянуло бы их в общий кусок three первой загрузки.
        blending: 5,
        blendEquation: 100,
        blendSrc: 208,
        blendDst: 201,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      });
      pm.name = 'glow-pools';
      const mesh = new THREE.InstancedMesh(pg, pm, this.pooled.length);
      const m4 = new THREE.Matrix4();
      this.pooled.forEach((i, k) => {
        const l = lamps[i];
        const lift = l.lift * l.s;
        const y = groundAt ? groundAt(l.x, l.z) : l.y - lift;
        const reach = LAMP[l.kind].reach * l.s;
        const r = Math.sqrt(Math.max(0, reach * reach - (l.y - y) * (l.y - y))) * 0.85;
        mesh.setMatrixAt(k, m4.makeScale(r, 1, r).setPosition(l.x, y + 0.06 * l.s, l.z));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = 'glow-pools';
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.pools = mesh;
      this.group.add(mesh);
    }
  }

  /** Уровень сменился (сторож плавности): настоящих огней — сколько велит уровень, лишние гаснут наплывом в пятна. */
  setCap(cap: number): void {
    this.cap = cap;
  }

  /**
   * Кадр: `t` — время сцены (с; у ролика — его часы: по ним горят огни со своим часом), `dt` — с прошлого кадра, `night` — доля ночи, `fx`, `fz` — куда смотрит камера (мир),
   * `camera` и высота буфера — размер огоньков в пикселях.
   */
  update(t: number, dt: number, night: number, fx: number, fz: number, camera: THREE.PerspectiveCamera, bufferHeight: number): void {
    const u = this.uniforms;
    const dark = night > 0.001;
    this.group.visible = dark;
    u.gBlue.value = night;
    if (!dark) {
      u.gLampN.value = 0;
      return;
    }
    const lamps = this.lamps;
    const k = this.flameK.array as Float32Array;
    for (let i = 0; i < lamps.length; i++) {
      this.on[i] = lampOn(lamps[i], night) * lampLife(lamps[i], t);
      k[i] = this.on[i] * lampFlicker(lamps[i], t);
    }
    this.flameK.needsUpdate = true;
    this.flameU.gPx.value = (bufferHeight / 2) * camera.projectionMatrix.elements[5];
    const active = this.slots.step(fx, fz, this.on, this.cap, dt);
    const w = this.slots.w;
    active.forEach((i, j) => {
      const l = lamps[i];
      const look = LAMP[l.kind];
      const c = this.col[i];
      const p = look.power * k[i] * w[i];
      u.gLampPos.value[j].set(l.x, l.y, l.z, look.reach * l.s);
      u.gLampCol.value[j].set(c[0] * p, c[1] * p, c[2] * p, 0);
    });
    u.gLampN.value = active.length;
    if (this.poolK) {
      const pk = this.poolK.array as Float32Array;
      this.pooled.forEach((i, j) => {
        pk[j] = k[i] * (1 - w[i]) * POOL_POWER;
      });
      this.poolK.needsUpdate = true;
    }
  }

  dispose(): void {
    this.flames.geometry.dispose();
    (this.flames.material as THREE.Material).dispose();
    if (this.pools) {
      this.pools.geometry.dispose();
      (this.pools.material as THREE.Material).dispose();
      this.pools.dispose();
    }
    this.group.clear();
  }
}

/** Лунная гамма: та же мера, что `cGrade` города (`city/material.ts`), на выходе Ламберта; свет огней — мимо неё. */
const MOON_GLSL = /* glsl */ `
  {
    vec3 gm = max(outgoingLight - gLitAdd, 0.0);
    float gl = dot(gm, vec3(0.2126, 0.7152, 0.0722));
    float gk = gBlue * (1.0 - smoothstep(0.05, 0.22, gl));
    gm.r *= 1.0 - 0.25 * gk;
    outgoingLight = mix(gm, gl * vec3(0.7, 0.92, 1.4), gk * 0.5) + gLitAdd;
  }
`;

/**
 * Ламберт сцены под огни: свет огней складывается с прочим светом, множа альбедо (`gLamps` по миру и нормали). Своя
 * правка материала остаётся (вызывается первой); ключ программы — свой. `moon` — лунная гамма ночи (тёмное холоднеет,
 * красное гаснет первым); бойцам и знамёнам её нет: цвет стороны ночью читается так же, как днём (`src/side.ts`).
 */
export function litByLamps<M extends THREE.Material>(mat: M, u: GlowUniforms, moon = true): M {
  const prev = mat.onBeforeCompile.bind(mat);
  const key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vGlowW;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
  {
    vec4 gw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      gw = instanceMatrix * gw;
    #endif
    vGlowW = (modelMatrix * gw).xyz;
  }`,
    );
    sh.fragmentShader = 'varying vec3 vGlowW;\nuniform float gBlue;\nvec3 gLitAdd = vec3(0.0);\n' + LAMP_GLSL + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  gLitAdd = diffuseColor.rgb * gLamps(vGlowW, inverseTransformDirection(normal, viewMatrix));\n  totalEmissiveRadiance += gLitAdd;',
    );
    if (moon) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', MOON_GLSL + '#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => `${key()}+lamps${moon ? '+moon' : ''}`;
  mat.userData.lamps = true;
  return mat;
}

/**
 * Все Ламберты сцены ролика — под огни (земля, шатры, люди, стены, деревья): один обход до первого кадра. Материалы, что
 * берут огни сами (город — `city/material.ts`), помечены `userData.lamps` и не трогаются.
 */
export function lightScene(root: THREE.Object3D, u: GlowUniforms): void {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (seen.has(mat) || !(mat instanceof THREE.MeshLambertMaterial) || mat.userData.lamps) continue;
      seen.add(mat);
      litByLamps(mat, u, !/crowd|banner|cloth|arms/.test(mat.name));
    }
  });
}
