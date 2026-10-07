// Осадки над городом (docs/city.md, 15): струи дождя и снегопад — своя докачка (`vite.config.ts`, `LAZY_DOORS`
// «город: погода»), сцена тянет её вместе с суетой после первого кадра города; на «Низком» её нет вовсе — там погода
// только светом, небом, сыростью и дымкой.
//
// Всё — функция часов сцены: капля и снежинка лежат в коробке вокруг цели камеры, падают и сносятся ветром в
// вершинном шейдере (место — дробная часть времени со сдвигом), а коробка заворачивает их по краям — кадру считать
// нечего, кроме ручек. Один вызов на дождь и один на снег; пока их нет, оба скрыты.
import * as THREE from 'three';
import type { Quality } from '../quality';
import { softDot } from './life';

/** Сколько капель и снежинок по уровню: на «Низком» осадков частицами нет. */
export const PRECIP_CAP: Record<Quality, { rain: number; snow: number }> = {
  low: { rain: 0, snow: 0 },
  medium: { rain: 2600, snow: 1800 },
  high: { rain: 5200, snow: 3600 },
};

/** Скорость падения, м/с: дождь — около девяти, снег — метр с небольшим. */
const RAIN_FALL = 9;
const SNOW_FALL = 1.3;

const VERT = /* glsl */ `
attribute vec4 drop;
uniform float pTime;
uniform float pAmount;
uniform vec3 pCenter;
uniform float pBox;
uniform vec2 pWind;
varying float vOn;
// Место частицы: коробка вокруг цели камеры, падение — дробная часть времени, снос ветром; край коробки заворачивает.
vec3 pPlace(float fall, float side) {
  float h = pBox * 0.55;
  float age = fract(pTime * fall / h * (0.85 + 0.3 * drop.w) + drop.z);
  vec2 xz = drop.xy * pBox + pWind * side * pTime;
  xz = pCenter.xz + mod(xz - pCenter.xz + pBox * 0.5, pBox) - pBox * 0.5;
  vOn = step(drop.w, pAmount) * smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.9, 1.0, age));
  return vec3(xz.x, pCenter.y + h * (0.75 - age), xz.y);
}
`;

function dropsAttr(n: number, perDrop: number, salt: number): THREE.BufferAttribute {
  const a = new Float32Array(n * perDrop * 4);
  // Сеяно: у каждой частицы своё место, сдвиг возраста и порог «идёт ли при такой силе» (w).
  let x = 0x2545f491 ^ salt;
  const next = (): number => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const d = [next(), next(), next(), next()];
    for (let k = 0; k < perDrop; k++) a.set(d, (i * perDrop + k) * 4);
  }
  return new THREE.BufferAttribute(a, 4);
}

/** Ручки осадков — общие у дождя и снега. */
interface PrecipUniforms {
  pTime: { value: number };
  pAmount: { value: number };
  pCenter: { value: THREE.Vector3 };
  pBox: { value: number };
  pWind: { value: THREE.Vector2 };
  pLight: { value: number };
}

function rainMesh(n: number, u: PrecipUniforms): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  g.setAttribute('drop', dropsAttr(n, 2, 1));
  // Конец струи: 0 — голова, 1 — хвост.
  const tail = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) tail[i * 2 + 1] = 1;
  g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
  const m = new THREE.LineBasicMaterial({ color: 0xc4ccd6, transparent: true, opacity: 1, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      VERT +
      'attribute float tail;\nuniform float pLight;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 transformed = pPlace(${RAIN_FALL.toFixed(1)}, 1.0);
        // Струя — вдоль скорости: вниз и по ветру; длина — путь капли за десятую долю секунды с небольшим.
        vec3 vel = vec3(pWind.x, -${RAIN_FALL.toFixed(1)}, pWind.y);
        // Издали струя длиннее: в кадре с полукилометра метровая капля была бы точкой.
        transformed -= normalize(vel) * tail * (0.7 + 0.5 * drop.w) * max(1.0, pBox / 70.0);`,
      );
    shader.fragmentShader =
      'varying float vOn;\nuniform float pLight;\n' +
      shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= pLight;\n  diffuseColor.a *= vOn * 0.5;');
  };
  m.customProgramCacheKey = () => 'city-rain';
  const mesh = new THREE.LineSegments(g, m);
  mesh.name = 'city-rain';
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

function snowMesh(n: number, u: PrecipUniforms): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('drop', dropsAttr(n, 1, 2));
  const m = new THREE.PointsMaterial({ color: 0xf4f6fa, size: 0.32, transparent: true, depthWrite: false });
  const dot = softDot();
  if (dot) {
    m.map = dot;
    m.alphaTest = 0.01;
  }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      VERT +
      'uniform float pLight;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 transformed = pPlace(${SNOW_FALL.toFixed(1)}, 1.0);
        // Снежинка кружит: своя петля по месту и времени.
        float sw = drop.x * 40.0 + drop.y * 17.0;
        transformed.x += sin(pTime * 1.3 + sw) * 0.6;
        transformed.z += cos(pTime * 1.1 + sw * 1.7) * 0.6;`,
      );
    shader.fragmentShader =
      'varying float vOn;\nuniform float pLight;\n' +
      shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= pLight;\n  diffuseColor.a *= vOn * 0.9;');
  };
  m.customProgramCacheKey = () => 'city-snowfall';
  const pts = new THREE.Points(g, m);
  pts.name = 'city-snowfall';
  pts.frustumCulled = false;
  pts.visible = false;
  return pts;
}

/** Осадки города: дождь струями, снег хлопьями — вокруг того, на что смотрит камера. */
export class CityPrecip {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.Points | null = null;
  private u: PrecipUniforms = {
    pTime: { value: 0 },
    pAmount: { value: 0 },
    pCenter: { value: new THREE.Vector3() },
    pBox: { value: 120 },
    pWind: { value: new THREE.Vector2() },
    pLight: { value: 1 },
  };
  private su: PrecipUniforms;

  constructor(quality: Quality) {
    const cap = PRECIP_CAP[quality];
    this.group.name = 'city-precip';
    // У снега свои сила и снос — ручки те же, числа свои.
    this.su = { ...this.u, pAmount: { value: 0 }, pWind: { value: new THREE.Vector2() } };
    if (cap.rain > 0) {
      this.rain = rainMesh(cap.rain, this.u);
      this.group.add(this.rain);
    }
    if (cap.snow > 0) {
      this.snow = snowMesh(cap.snow, this.su);
      this.group.add(this.snow);
    }
  }

  /** Есть ли что рисовать на этом уровне. */
  get any(): boolean {
    return this.rain !== null || this.snow !== null;
  }

  /**
   * Кадр: `t` — часы сцены; `rain`, `snow` 0..1; ветер — куда дует и сила; `center` — цель камеры, `dist` — её
   * расстояние (коробка растёт с ним: издали дождь — завеса над городом, вблизи — струи у глаз); `light` — яркость
   * (ночью капли тёмные, вспышка их высвечивает).
   */
  update(t: number, rain: number, snow: number, windX: number, windZ: number, wind: number, center: THREE.Vector3, dist: number, light: number): void {
    const u = this.u;
    u.pTime.value = t;
    u.pAmount.value = rain;
    u.pCenter.value.copy(center);
    u.pBox.value = Math.min(420, Math.max(70, dist * 0.9));
    u.pLight.value = light;
    // Дождь косит ветер до пяти метров в секунду, снег несёт до трёх.
    u.pWind.value.set(windX, windZ).multiplyScalar(0.6 + 4.4 * wind);
    this.su.pAmount.value = snow;
    this.su.pWind.value.set(windX, windZ).multiplyScalar(0.4 + 2.6 * wind);
    if (this.rain) this.rain.visible = rain > 0.01;
    if (this.snow) {
      this.snow.visible = snow > 0.01;
      // Хлопья — с расстоянием крупнее: издали снегопад читается пеленой, а не пылью.
      (this.snow.material as THREE.PointsMaterial).size = 0.35 + Math.min(2, dist / 250);
    }
  }

  dispose(): void {
    for (const o of [this.rain, this.snow]) {
      if (!o) continue;
      o.geometry.dispose();
      const m = o.material as THREE.Material & { map?: THREE.Texture | null };
      m.map?.dispose();
      m.dispose();
    }
  }
}
