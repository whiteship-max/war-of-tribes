// Сцена лагеря бродяги (ПН-12л, docs/gdd/path_of_sword.md, 5.2 и «Решения ПН-12л») — главный экран отряда: лагерь на земле клетки
// под небом этой минуты. Едет своим куском (`ui/camp/CampScreen`) — только тому, кому открыт путь.
//
// Модель — чистая сборка `render/camp/build` из вида лагеря (`world/campsite.campLook`); здесь — свет города (`render/lighting`:
// солнце и полусфера, сутки по часам партии), погода в движении (дождь и снег — линиями и точками, туман — дымкой, ветер качает
// знамя и уносит дым, тучи гасят солнце) и огонь с отсветом. Камера стоит: лагерь — диорама, а не мир; предметы-кнопки — подписями
// поверх холста по точкам модели (`anchors`).
//
// КАДР — ТОЛЬКО ЧЕРЕЗ ДВЕРЬ `render/loop.ts`: потолок частоты и плотности, остановка в скрытой странице. Цепочка одна; живое (огонь,
// капли, дым) рисуется около тридцати раз в секунду (`rest`), неподвижное — раз в секунду.
import * as THREE from 'three';
import { applyDayNight, createLightRig, type LightRig, type SkyColors } from '@/render/lighting';
import { PALETTE, SEASON_SUN_ARC, seasonColor } from '@/render/palette';
import { FrameLoop, pixelRatio } from '@/render/loop';
import { QUALITY, type Quality } from '@/render/quality';
import { windTo } from '@/world/weather';
import type { CampLook } from '@/world/campsite';
import { armsCanvas } from '@/heraldry/paint';
import { DROPS, buildCamp, disposeCamp, type CampAnchors, type CampModel } from './build';

/** Живое (огонь, капли, дым) — кадр раз в столько мс; неподвижное — раз в `STILL_MS`. */
const LIVE_MS = 33;
const STILL_MS = 1000;
/** Клубов дыма над костром. */
const PUFFS = 12;
/** Коробка капель и хлопьев над лагерем, м: шире кадра у лагеря, дальше — дымка. */
const PRECIP_SPAN = 26;
const PRECIP_TOP = 14;

/** Точка предмета на экране, CSS px от левого верхнего угла холста; за кадром — `null`. */
export type ScreenPoint = { x: number; y: number } | null;

export interface CampScreenAnchors {
  tent: ScreenPoint;
  fire: ScreenPoint;
  cargo: ScreenPoint;
}

/** Ключ модели: пересобирать, только когда сменилось то, из чего она собрана (не погода в движении). */
const modelKey = (l: CampLook, arms: string | null): string =>
  [l.ground, l.tier, l.kind ?? '-', l.fire ? 1 : 0, Math.round(l.snow * 4), l.season, arms ?? ''].join('|');

let puff: THREE.Texture | null = null;

/** Круглое пятно с мягким краем — клуб дыма и хлопья снега (без него точки рисуются квадратами). */
function puffTex(): THREE.Texture | null {
  if (puff || typeof document === 'undefined') return puff;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  puff = new THREE.CanvasTexture(c);
  return puff;
}

export class CampScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.5, 120);
  /** Расстояние камеры до лагеря, м — от него дымка. */
  private dist = 20;
  private readonly rig: LightRig;
  private readonly fireLight = new THREE.PointLight(PALETTE.fireLight, 0, 14, 1.6);
  private readonly loop: FrameLoop<'idle'>;
  private model: CampModel | null = null;
  private key = '';
  private look: CampLook | null = null;
  private solar = 0.25;
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly smoke: THREE.Points;
  private readonly drops: number;
  private flagTex: THREE.CanvasTexture | null = null;
  private last = 0;
  private t = 0;
  private w = 1;
  private h = 1;
  /** Подписи предметов пересчитаны — оболочка ставит кнопки. */
  onAnchors: ((a: CampScreenAnchors) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly q: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q === 'high', powerPreference: 'low-power' });
    this.renderer.setPixelRatio(pixelRatio(QUALITY[q].dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 18, 48);
    this.rig = createLightRig(this.scene, 512);
    this.rig.sun.castShadow = false;
    this.scene.add(this.fireLight);
    this.drops = DROPS[q];
    this.rain = this.precip('rain') as THREE.LineSegments;
    this.snow = this.precip('snow') as THREE.Points;
    this.smoke = this.puffs();
    this.scene.add(this.rain, this.snow, this.smoke);
    this.loop = new FrameLoop<'idle'>(
      () => this.frame(),
      () => {
        this.last = performance.now();
      },
    );
  }

  /** Капли дождя (пары точек — линии) или хлопья снега (точки) в коробке над лагерем. */
  private precip(kind: 'rain' | 'snow'): THREE.LineSegments | THREE.Points {
    const per = kind === 'rain' ? 2 : 1;
    const pos = new Float32Array(this.drops * per * 3);
    for (let i = 0; i < this.drops; i++) {
      const x = (((i * 7919) % 1000) / 1000 - 0.5) * PRECIP_SPAN;
      const z = (((i * 104729) % 1000) / 1000 - 0.5) * PRECIP_SPAN;
      const y = (((i * 15485863) % 1000) / 1000) * PRECIP_TOP;
      for (let k = 0; k < per; k++) pos.set([x, y + k * 0.8, z], (i * per + k) * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (kind === 'rain') {
      const m = new THREE.LineBasicMaterial({ color: 0xc8d4de, transparent: true, opacity: 0.75 });
      const l = new THREE.LineSegments(g, m);
      l.visible = false;
      l.frustumCulled = false;
      return l;
    }
    const m = new THREE.PointsMaterial({ color: PALETTE.snowflake, size: 0.16, transparent: true, opacity: 0.9, map: puffTex(), depthWrite: false });
    const p = new THREE.Points(g, m);
    p.visible = false;
    p.frustumCulled = false;
    return p;
  }

  private puffs(): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3));
    const m = new THREE.PointsMaterial({ color: PALETTE.smoke, size: 1.1, transparent: true, opacity: 0.4, depthWrite: false, map: puffTex() });
    const p = new THREE.Points(g, m);
    p.visible = false;
    p.frustumCulled = false;
    return p;
  }

  /** Поставить вид лагеря, герб знамени и фазу солнца партии; модель пересобирается только при смене того, из чего собрана. */
  show(look: CampLook, arms: string | null, solar: number): void {
    this.look = look;
    this.solar = solar;
    const key = modelKey(look, arms);
    if (key !== this.key) {
      this.key = key;
      if (this.model) {
        this.scene.remove(this.model.root);
        disposeCamp(this.model);
      }
      this.model = buildCamp(look, this.q);
      this.scene.add(this.model.root);
      this.dressFlag(arms);
      this.aim();
      this.placeAnchors();
    }
    this.weather(look);
    this.loop.restart();
  }

  /** Герб на полотнище знамени — холстом герба (`heraldry/paint.armsCanvas`). */
  private dressFlag(arms: string | null): void {
    const flag = this.model?.flag;
    if (!flag) return;
    const art = arms ? armsCanvas(arms, 96, { gloss: false }) : null;
    if (!art) return;
    this.flagTex?.dispose();
    this.flagTex = new THREE.CanvasTexture(art);
    this.flagTex.colorSpace = THREE.SRGBColorSpace;
    const mat = flag.material as THREE.MeshLambertMaterial;
    mat.map = this.flagTex;
    mat.color.setHex(0xffffff);
    mat.needsUpdate = true;
  }

  /** Погода сцены: дымка, тучи, капли, снег, свет и сутки. */
  private weather(l: CampLook): void {
    const w = l.sky;
    const fog = this.scene.fog as THREE.Fog;
    const thick = Math.min(1, w.fog + 0.35 * w.rain + 0.25 * w.snow);
    // Дымка — от расстояния до лагеря: в ясный день лагерь чёткий, дальний лес тонет; туман и ливень подходят к самому лагерю.
    fog.near = this.dist * (1.15 - 0.75 * thick);
    fog.far = this.dist * (2.6 - 1.35 * thick);
    this.rain.visible = w.rain > 0.05;
    this.rain.geometry.setDrawRange(0, Math.round(this.drops * Math.min(1, w.rain + 0.15)) * 2);
    this.snow.visible = w.snow > 0.05;
    this.snow.geometry.setDrawRange(0, Math.round(this.drops * Math.min(1, w.snow + 0.15)));
    this.smoke.visible = this.model?.smokeFrom !== null && this.model?.smokeFrom !== undefined;
    this.light();
  }

  /** Сутки — светом города (`lighting.applyDayNight`), тучи гасят солнце, огонь светит у костра. */
  private light(): void {
    const l = this.look;
    if (!l) return;
    const sky: SkyColors = {
      sky: new THREE.Color(seasonColor(l.season, 'sky')),
      fog: new THREE.Color(seasonColor(l.season, 'fog')),
      sun: new THREE.Color(seasonColor(l.season, 'sunDay')),
      sunArc: SEASON_SUN_ARC[l.season],
    };
    const day = applyDayNight(this.rig, this.scene, this.solar, sky);
    const gloom = Math.min(1, l.sky.cloud * 0.6 + l.sky.rain * 0.3 + l.sky.snow * 0.2);
    this.rig.sun.intensity *= 1 - 0.65 * gloom;
    this.rig.hemi.intensity *= 1 - 0.25 * gloom;
    // Небо в тучах серее.
    (this.scene.background as THREE.Color).lerp(new THREE.Color(0x8d969e), 0.55 * gloom * day.daylight);
    (this.scene.fog as THREE.Fog).color.lerp(new THREE.Color(0x9aa3ab), 0.55 * gloom * day.daylight);
    this.fireLight.intensity = this.model?.flame ? 2.2 + 3 * day.nightK : 0;
    if (this.model?.flame) this.fireLight.position.copy(this.model.flame.position).add(new THREE.Vector3(0, 0.8, 0));
  }

  /** Размер холста, CSS px: камера отходит так, чтобы лагерь влез по ширине на любом экране. */
  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setSize(this.w, this.h, false);
    this.aim();
    this.placeAnchors();
    this.loop.restart();
  }

  /**
   * Камера по ширине лагеря: малый (±3.9 м) и большой (±5.8 м) влезают по ширине — на узком телефоне камера отходит, на широком
   * подходит. Середина взгляда — над лагерем: сверху полоса отряда, и лагерь встаёт ниже середины экрана.
   */
  private aim(): void {
    const aspect = this.w / this.h;
    this.camera.aspect = aspect;
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect;
    const span = this.look?.tier === 'large' ? 5.8 : 3.9;
    this.dist = Math.max(8, Math.min(30, span / half));
    const d = this.dist;
    this.camera.position.set(0, d * 0.58, d * 0.82);
    this.camera.lookAt(0, 1 + 0.1 * d, -1.2);
    this.camera.updateProjectionMatrix();
    if (this.look) this.weather(this.look);
  }

  private toScreen(v: THREE.Vector3 | null): ScreenPoint {
    if (!v) return null;
    const p = v.clone().project(this.camera);
    if (p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) return null;
    return { x: ((p.x + 1) / 2) * this.w, y: ((1 - p.y) / 2) * this.h };
  }

  /** Точки предметов на экране — оболочке под кнопки. */
  anchors(): CampScreenAnchors {
    const a: CampAnchors | undefined = this.model?.anchors;
    return a ? { tent: this.toScreen(a.tent), fire: this.toScreen(a.fire), cargo: this.toScreen(a.cargo) } : { tent: null, fire: null, cargo: null };
  }

  private placeAnchors(): void {
    this.onAnchors?.(this.anchors());
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const l = this.look;
    let live = false;
    if (l && this.model) {
      const wind = windTo(l.sky.from);
      const gust = l.sky.wind;
      if (this.model.flame) {
        live = true;
        const s = 1 + 0.12 * Math.sin(this.t * 11) + 0.08 * Math.sin(this.t * 17.3);
        this.model.flame.scale.set(1, s, 1);
        this.model.flame.rotation.y += dt * 1.5;
        this.fireLight.intensity *= 0.97 + 0.03 * s;
      }
      if (this.model.flag) {
        live = true;
        // Ветер разворачивает полотнище по ветру и качает его.
        this.model.flag.rotation.y = Math.atan2(-wind.z, wind.x) + 0.25 * gust * Math.sin(this.t * (2 + 3 * gust));
        this.model.flag.rotation.z = -0.05 - 0.15 * (1 - gust);
      }
      if (this.rain.visible) {
        live = true;
        this.fall(this.rain, 14 * dt, wind, gust * 3 * dt, 2);
      }
      if (this.snow.visible) {
        live = true;
        this.fall(this.snow, 1.2 * dt, wind, gust * 1.2 * dt, 1);
      }
      if (this.smoke.visible && this.model.smokeFrom) {
        live = true;
        this.rise(this.model.smokeFrom, wind, gust);
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.loop.rest(live ? LIVE_MS : STILL_MS);
  }

  /** Капли и хлопья падают, сносимые ветром; упавшие — снова наверху. */
  private fall(obj: THREE.LineSegments | THREE.Points, down: number, wind: { x: number; z: number }, drift: number, per: number): void {
    const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < this.drops; i++) {
      const j = i * per * 3;
      let y = a[j + 1] - down;
      let x = a[j] + wind.x * drift;
      let z = a[j + 2] + wind.z * drift;
      const h = PRECIP_SPAN / 2;
      if (y < 0) y += PRECIP_TOP;
      if (x > h) x -= PRECIP_SPAN;
      if (x < -h) x += PRECIP_SPAN;
      if (z > h) z -= PRECIP_SPAN;
      if (z < -h) z += PRECIP_SPAN;
      for (let k = 0; k < per; k++) {
        a[j + k * 3] = x + wind.x * k * 0.12 * per;
        a[j + k * 3 + 1] = y + k * 0.8;
        a[j + k * 3 + 2] = z + wind.z * k * 0.12 * per;
      }
    }
    pos.needsUpdate = true;
  }

  /** Дым поднимается клубами и уходит по ветру. */
  private rise(from: THREE.Vector3, wind: { x: number; z: number }, gust: number): void {
    const pos = this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < PUFFS; i++) {
      const life = (this.t * 0.35 + i / PUFFS) % 1;
      a[i * 3] = from.x + wind.x * life * (1 + 4 * gust) + 0.2 * Math.sin(this.t + i);
      a[i * 3 + 1] = from.y + life * 4;
      a[i * 3 + 2] = from.z + wind.z * life * (1 + 4 * gust);
    }
    pos.needsUpdate = true;
  }

  /** Совсем: цепочка стоит, геометрия и контекст отпущены. */
  dispose(): void {
    this.loop.stop();
    if (this.model) disposeCamp(this.model);
    this.flagTex?.dispose();
    for (const o of [this.rain, this.snow, this.smoke] as THREE.Object3D[]) {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
  }
}
