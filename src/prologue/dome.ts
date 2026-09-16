/**
 * Небо поляны картинкой: купол градиентом, солнце и луна, звёзды и цвет часа.
 *
 * ЗАЛИВКА ФОНА НЕБОМ НЕ ЧИТАЕТСЯ. Одним цветом за деревьями небо выходило
 * картонным задником: утро, полдень и закат отличались оттенком листа, а не
 * светом. Купол красится по вершинам — у горизонта светлее, к зениту глубже, со
 * стороны светила теплее, — а дымка берёт цвет неба над кромкой леса, и лес,
 * уходящий в туман, растворяется в небе, а не упирается в него краем.
 *
 * ЦВЕТ ЧАСА — ТАБЛИЦЕЙ, А НЕ ФОРМУЛОЙ ПО МЕСТУ. Холодное утро, белый полдень,
 * рыжий закат и синяя ночь — ключи по часу поляны (`sky.sunAt`), и все цвета в
 * них — смеси цветов палитры. Общий световой риг (`render/lighting.ts`) про это
 * не знает и знать не должен: деревня и бой живут своим светом, а поляна
 * докрашивает солнце поверх него — тем же приёмом, каким гасит его в ненастье.
 *
 * ВРЕМЯ ЗДЕСЬ ТОЛЬКО ЧИТАЕТСЯ. Час приходит числом от сцены, которая берёт его
 * у `serverNow()`; сам купол не копит ничего и в сохранение не попадает.
 *
 * Стоит это трёх вызовов отрисовки: купол всегда, светило днём и ночью, звёзды
 * ночью. Перекрашивается купол не каждый кадр, а когда сцена перекладывает свет
 * (`scene.applySky`, по шагу `scene.SKY_STEP`): все вершины купола.
 */
import * as THREE from 'three';
import { PALETTE } from '@/render/palette';
import { hash } from './glade';
import { mix } from './paint';

/**
 * Радиус купола. За лесом (`models.FOREST_TO`) и краем земли (`models.GROUND_R`),
 * но ближе дальней плоскости камеры (`scene.ts`, `PerspectiveCamera`): иначе купол
 * срезался бы.
 */
const RADIUS = 74;

/** Где висит светило: ближе купола, чтобы рисоваться поверх его градиента. */
const ORB_AT = 66;

/** Звёзд на небе. Видно из них треть — остальное за лесом. */
const STARS = 220;

const C = PALETTE;

/** Цвет часа. */
export interface Tone {
  /** Небо над головой. */
  zenith: THREE.Color;
  /** Небо у горизонта. Дымка берёт его смесью с зенитом (`Dome.haze`). */
  horizon: THREE.Color;
  /** Свечение вокруг светила и насколько оно сильное. */
  glow: THREE.Color;
  glowK: number;
  /** Каким светом светит солнце и насколько он перебивает цвет рига. */
  light: THREE.Color;
  lightK: number;
}

interface Key {
  at: number;
  zenith: number;
  horizon: number;
  glow: number;
  glowK: number;
  light: number;
  lightK: number;
}

/**
 * Ключи часа: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глухая ночь.
 *
 * Утро холодное: свет белёсо-голубой, небо бледное, у горизонта только розовая
 * кромка. Полдень белый: солнце без желтизны рига. После полудня свет теплеет до
 * того, каким его знает деревня. Закат рыжий: кромка неба в огне, свет оранжевый.
 * Сумерки гаснут в красное и синее. Ночь синяя: светит луна рига.
 */
const DAWN: Omit<Key, 'at'> = {
  zenith: mix(C.hemiSkyNight, C.sky, 0.45),
  horizon: mix(C.fog, C.skyDusk, 0.22),
  glow: mix(C.sunDusk, C.bone, 0.3),
  glowK: 0.5,
  light: mix(C.snowflake, C.hemiSky, 0.6),
  lightK: 0.85,
};

/** Круг замкнут: последний ключ — тот же рассвет, иначе на стыке суток цвет прыгал бы. */
const KEYS: readonly Key[] = [
  { at: 0, ...DAWN },
  { at: 0.1, zenith: mix(C.sky, C.hemiSky, 0.6), horizon: mix(C.fog, C.snowflake, 0.5), glow: C.bone, glowK: 0.3, light: mix(C.snowflake, C.hemiSky, 0.5), lightK: 0.8 },
  { at: 0.25, zenith: mix(C.sky, C.paintBlue, 0.22), horizon: mix(C.fog, C.snowflake, 0.2), glow: C.snowflake, glowK: 0.25, light: C.snowflake, lightK: 0.65 },
  { at: 0.39, zenith: C.sky, horizon: C.fog, glow: C.sunDay, glowK: 0.35, light: C.sunDay, lightK: 0 },
  { at: 0.47, zenith: mix(C.sky, C.hemiSkyNight, 0.4), horizon: mix(C.skyDusk, C.sunDusk, 0.3), glow: mix(C.fireLight, C.sunDusk, 0.3), glowK: 1, light: mix(C.sunDusk, C.fireLight, 0.5), lightK: 0.7 },
  { at: 0.52, zenith: mix(C.hemiSkyNight, C.skyNight, 0.35), horizon: mix(C.skyDusk, C.paintRed, 0.4), glow: C.fireLight, glowK: 0.8, light: mix(C.sunDusk, C.paintRed, 0.35), lightK: 0.8 },
  { at: 0.59, zenith: C.skyNight, horizon: mix(C.skyNight, C.hemiSkyNight, 0.55), glow: C.moon, glowK: 0.22, light: C.moon, lightK: 0 },
  { at: 0.93, zenith: C.skyNight, horizon: mix(C.skyNight, C.hemiSkyNight, 0.55), glow: C.moon, glowK: 0.22, light: C.moon, lightK: 0 },
  { at: 1, ...DAWN },
];

const COLORS = KEYS.map((k) => ({
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  glow: new THREE.Color(k.glow),
  light: new THREE.Color(k.light),
}));

const smooth = (t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
};

/** Цвет часа поляны: между двумя ключами — плавно. */
export function toneAt(solar: number, out: Tone): Tone {
  const s = ((solar % 1) + 1) % 1;
  let i = 0;
  while (i + 2 < KEYS.length && KEYS[i + 1].at <= s) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = smooth((s - a.at) / Math.max(1e-6, b.at - a.at));
  out.zenith.copy(COLORS[i].zenith).lerp(COLORS[i + 1].zenith, k);
  out.horizon.copy(COLORS[i].horizon).lerp(COLORS[i + 1].horizon, k);
  out.glow.copy(COLORS[i].glow).lerp(COLORS[i + 1].glow, k);
  out.light.copy(COLORS[i].light).lerp(COLORS[i + 1].light, k);
  out.glowK = a.glowK + (b.glowK - a.glowK) * k;
  out.lightK = a.lightK + (b.lightK - a.lightK) * k;
  return out;
}

export const newTone = (): Tone => ({
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  glow: new THREE.Color(),
  glowK: 0,
  light: new THREE.Color(),
  lightK: 0,
});

const SUN = new THREE.Color(C.snowflake);
const MOON = new THREE.Color(mix(C.moon, C.snowflake, 0.62));
const TMP_Z = new THREE.Color();
const TMP_C = new THREE.Color();

export class Dome {
  readonly root = new THREE.Group();
  /** Цвет горизонта после последней покраски: его берёт фон. */
  readonly horizon = new THREE.Color(C.fog);
  /**
   * Цвет дымки: небо чуть выше горизонта, а не сам горизонт.
   *
   * Дальний лес стоит против неба заметно выше горизонта, а там небо уже
   * наполовину зенит. Туман цветом самого горизонта выбеливал кромку леса
   * до бежевого в сумерки и до белёсого днём; смесь с зенитом — тот цвет, в котором
   * верхушки и растворяются.
   */
  readonly haze = new THREE.Color(C.fog);
  private sky: THREE.Mesh;
  private dirs: Float32Array;
  private colors: THREE.BufferAttribute;
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshBasicMaterial;

  constructor() {
    const geo = new THREE.SphereGeometry(RADIUS, 32, 16);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    const pos = geo.attributes.position as THREE.BufferAttribute;
    this.dirs = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      this.dirs[i * 3] = pos.getX(i) / RADIUS;
      this.dirs[i * 3 + 1] = pos.getY(i) / RADIUS;
      this.dirs[i * 3 + 2] = pos.getZ(i) / RADIUS;
    }
    this.colors = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    geo.setAttribute('color', this.colors);
    // Купол рисуется первым и глубину не пишет: всё, что ближе, ложится поверх.
    this.sky = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }),
    );
    this.sky.renderOrder = -3;
    this.sky.frustumCulled = false;

    const sp = new Float32Array(STARS * 3);
    const sc = new Float32Array(STARS * 3);
    const star = new THREE.Color(C.snowflake);
    for (let i = 0; i < STARS; i++) {
      // Равномерно по площади верхней полусферы: высота — равномерная доля.
      const y = 0.08 + 0.92 * hash(i, 301);
      const a = hash(i, 303) * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const d = RADIUS - 2;
      sp.set([Math.cos(a) * r * d, y * d, Math.sin(a) * r * d], i * 3);
      const b = 0.3 + 0.7 * hash(i, 305) ** 2;
      sc.set([star.r * b, star.g * b, star.b * b], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -2;
    this.stars.frustumCulled = false;
    this.stars.visible = false;

    this.orbMat = new THREE.MeshBasicMaterial({ color: SUN, fog: false, depthWrite: false, toneMapped: false, transparent: true });
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.orbMat);
    this.orb.renderOrder = -1;
    this.root.add(this.sky, this.stars, this.orb);
  }

  /** Купол ездит за глазом: небо не приближается, сколько ни иди. */
  follow(eye: THREE.Vector3): void {
    this.root.position.copy(eye);
  }

  /**
   * Покрасить небо.
   *
   * `dir` — куда светит лампа рига (днём солнце, ночью луна), `dark` — глубина
   * ночи (`sky.darkness`), `gloom` — хмурость и `tint` — цвет ненастья: к нему
   * тянутся и купол, и туман, а звёзды и светило в ненастье гаснут.
   */
  paint(tone: Tone, dir: THREE.Vector3, dark: number, gloom: number, tint: THREE.Color): void {
    const z = TMP_Z.copy(tone.zenith).lerp(tint, gloom * 0.55);
    const h = this.horizon.copy(tone.horizon).lerp(tint, gloom * 0.6);
    this.haze.copy(h).lerp(z, 0.35);
    const glowK = tone.glowK * (1 - gloom * 0.85);
    const g = tone.glow;
    const out = this.colors.array as Float32Array;
    const n = this.dirs.length / 3;
    for (let i = 0; i < n; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      const up = dy > 0 ? Math.sqrt(dy) : 0;
      const s = Math.max(0, dx * dir.x + dy * dir.y + dz * dir.z);
      const s2 = s * s;
      const s8 = s2 * s2 * s2 * s2;
      const lift = 1 - Math.max(0, dy) * 0.45;
      const k = glowK * (s8 * s8 * 0.95 + s2 * s * 0.3) * lift;
      out[i * 3] = h.r + (z.r - h.r) * up + g.r * k;
      out[i * 3 + 1] = h.g + (z.g - h.g) * up + g.g * k;
      out[i * 3 + 2] = h.b + (z.b - h.b) * up + g.b * k;
    }
    this.colors.needsUpdate = true;

    const stars = smooth((dark - 0.45) / 0.4) * (1 - smooth(gloom * 1.6));
    this.starMat.opacity = stars;
    this.stars.visible = stars > 0.01;

    // Светило: днём солнце, в глухую ночь луна; в переходе лампа едет от одного к
    // другому, и диск по небу не ездит — его просто нет.
    const sun = dark < 0.3 && dir.y > -0.03;
    const moon = dark > 0.72;
    const k = (sun ? 1 - dark / 0.3 : moon ? (dark - 0.72) / 0.28 : 0) * (1 - smooth(gloom * 1.5));
    this.orb.visible = k > 0.02;
    if (!this.orb.visible) return;
    this.orb.position.copy(dir).multiplyScalar(ORB_AT);
    this.orb.scale.setScalar(sun ? 2.6 : 2.2);
    this.orbMat.color.copy(sun ? TMP_C.copy(g).lerp(SUN, 0.55) : MOON);
    this.orbMat.opacity = Math.min(1, k * 1.5);
  }

  dispose(): void {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.orb.geometry.dispose();
    this.orbMat.dispose();
  }
}
