// 3D-диорама поселения. Получает состояние через sync(), анимирует сам.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Building, EraId, GameState, Season, Villager } from '@/game/types';
import { buildingAttention, dayFraction, era, isSite, seasonOf, solarPhase, type Attention } from '@/game/derived';
import { BUILDING_ZONE, buildTerrain, farmSlot, ringIndexToward, ringSlot, shelterSlot, ZONES, type Slot } from './terrain';
import {
  createBuildingGroup,
  footprintOf,
  levelScale,
  scaffold,
  stageOf,
  visualTier,
  type Stage,
  type Tier,
} from './buildings';
import { VillagerAgent } from './villagers';
import { SeasonVisuals } from './season';
import { Smoke, Snowfall } from './weather';

interface BuildingView {
  group: THREE.Group;
  stage: Stage;
  /** Визуальная ступень: модель меняется на её пороге, а не на каждом уровне. */
  tier: Tier;
  /** Эпоха, в материалах которой сложена нынешняя модель. */
  era: EraId;
  type: Building['type'];
  /** Невидимая мишень для тапа — заметно крупнее самой модели. */
  hit: THREE.Mesh;
  scaffold: THREE.Group | null;
  marker: THREE.Sprite | null;
  markerKind: Attention | null;
  markerY: number;
}

const SKY_DUSK = new THREE.Color(0xe08a5a);
const SKY_NIGHT = new THREE.Color(0x141a2e);
/** Стартовый цвет неба до первого кадра; дальше его ведёт сезон. */
const SKY_INIT = new THREE.Color(0x9fc9e8);

/** Тап пальцем: сколько можно проехать и как долго держать, чтобы это всё ещё был тап. */
const TAP_MOVE = 14;
const TAP_MS = 500;
/** Промах по модели прощается в этом радиусе на экране — иначе на 390 px не попасть. */
const TAP_FORGIVE = 46;

const MARKER_GLYPH: Record<Attention, string> = { idle: '💤', slot: '👤', upgrade: '⬆️' };
const markerTextures = new Map<Attention, THREE.Texture>();

/** Значок над крышей рисуется в канву: эмодзи читается лучше любой low-poly иконки. */
function markerTexture(kind: Attention): THREE.Texture {
  let tex = markerTextures.get(kind);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(26, 20, 16, 0.85)';
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e8a43c';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.font = '62px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MARKER_GLYPH[kind], 64, 70);
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  markerTextures.set(kind, tex);
  return tex;
}

/** Высота маркера над зданием: высокие постройки не должны его прятать. */
const MARKER_HEIGHT: Partial<Record<Building['type'], number>> = {
  tower: 3.8,
  totem: 3.2,
  hut: 3.0,
  smithy: 2.8,
  mine: 2.6,
  campfire: 1.8,
  shelter: 1.7,
};

/**
 * Живая сцена в приложении одна, а обучению нужна проекция здания в экранные
 * координаты — чтобы «дырка» в затемнении следовала за зданием при повороте камеры.
 */
let active: TribeScene | null = null;
export const activeScene = (): TribeScene | null => active;

export class TribeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fireLight: THREE.PointLight;
  private buildings = new Map<number, BuildingView>();
  private agents = new Map<number, VillagerAgent>();
  private ringSlots = new Map<number, number>(); // id здания -> индекс слота
  private farmSlots = new Map<number, number>();
  private shelterSlots = new Map<number, number>();
  private usedRing = new Set<number>();
  private usedFarm = new Set<number>();
  private clock = new THREE.Clock();
  private raf = 0;
  private gameTime = 0;
  private gameTimeAt = 0;
  private flame: THREE.Object3D | null = null;
  private flameInner: THREE.Object3D | null = null;
  private seasonVis = new SeasonVisuals();
  private snowfall = new Snowfall();
  private smoke = new Smoke();
  private season: Season = 'spring';
  private disposed = false;
  private paused = false;
  private raycaster = new THREE.Raycaster();
  private selection: THREE.Mesh;
  private selected: number | null = null;
  private down: { id: number; x: number; y: number; t: number } | null = null;
  /** Тап по зданию (или по пустому месту — тогда null). Ставит UI. */
  onPick: ((id: number | null) => void) | null = null;
  /** Азимут стартового ракурса — сохраняется при перекадрировке. */
  private azimuth = Math.atan2(9, 12);
  /** Аспект последнего кадрирования — по нему пересобирается кадр при росте посёлка. */
  private aspect = 1;
  /** Самая крупная визуальная ступень в посёлке: кадр растёт вместе с постройками. */
  private villageTier: Tier = 0;
  /** После ручного вращения камеру больше не переставляем. */
  private userMoved = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // dpr зажат в [1, 2]: на 3x-экранах третий пиксель не виден, а филлрейт растёт вдвое.
    this.renderer.setPixelRatio(THREE.MathUtils.clamp(window.devicePixelRatio || 1, 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = SKY_INIT.clone();
    this.scene.fog = new THREE.Fog(SKY_INIT.clone(), 22, 40);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.camera.position.set(9, 10, 12);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.4, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 26;
    this.controls.minPolarAngle = 0.45;
    this.controls.maxPolarAngle = 1.25;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
    });

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6a3a, 0.7);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.sun.position.set(12, 18, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 18;
    sc.bottom = -18;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fireLight = new THREE.PointLight(0xff9a3a, 2.5, 12, 1.6);
    this.fireLight.position.set(0, 1.0, 0);
    this.scene.add(this.fireLight);

    this.scene.add(buildTerrain());
    this.scene.add(this.snowfall.points);
    this.scene.add(this.smoke.points);

    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1.06, 32),
      new THREE.MeshBasicMaterial({ color: 0xe8a43c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.position.y = 0.07;
    this.selection.visible = false;
    this.selection.renderOrder = 3;
    this.scene.add(this.selection);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);

    this.resize();
    this.loop();
    active = this;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w < 1 || h < 1) return;
    this.renderer.setPixelRatio(THREE.MathUtils.clamp(window.devicePixelRatio || 1, 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyFraming(w / h);
  }

  /**
   * Кадрирование от аспекта. В портрете (aspect < 0.7) камера подходит
   * ближе и поднимается выше, иначе диорама теряется в центре экрана. Туман
   * и коробка теней сжимаются вместе с дистанцией — дальняя геометрия не рисуется.
   */
  private applyFraming(aspect: number): void {
    this.aspect = aspect;
    // 0.75 — граница портрета; любой телефон (0.46–0.62) попадает в narrow = 1.
    const narrow = THREE.MathUtils.clamp((0.75 - aspect) / 0.15, 0, 1);
    const polar = THREE.MathUtils.lerp(0.99, 0.74, narrow);
    // В портрете угол шире: иначе кадр не удержать без отъезда за предел дистанции.
    const fov = THREE.MathUtils.lerp(42, 48, narrow);
    // Сколько мира должно влезать по ширине. В портрете горизонтальный fov уже,
    // но кадр всё равно держит ближнее кольцо застройки целиком — вместе с самой
    // крупной визуальной ступенью зданий: панель открывается тапом по крыше.
    // Кадр растёт вместе с посёлком: лагерь из навесов не должен теряться в пустом поле.
    const fitRadius = THREE.MathUtils.lerp(11.5, 7.2, narrow) * (1 + 0.14 * this.villageTier);
    const halfH = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
    const dist = THREE.MathUtils.clamp(fitRadius / Math.tan(halfH), 9, 46);

    this.camera.fov = fov;

    this.controls.minDistance = dist * 0.45;
    this.controls.maxDistance = dist * 1.6;
    this.controls.maxPolarAngle = Math.max(1.05, polar + 0.32);

    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.1;
    fog.far = dist * 1.75;
    this.camera.far = fog.far + 10;
    this.camera.updateProjectionMatrix();

    // Коробка теней сжимается вместе с кадром: меньше площадь — чётче тень при том же разрешении.
    const half = THREE.MathUtils.lerp(21, 17, narrow);
    const sc = this.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.updateProjectionMatrix();

    if (this.userMoved) return;
    // Цель чуть выше земли: деревня уходит из-под верхнего HUD.
    this.controls.target.set(0, THREE.MathUtils.lerp(0.4, 1.4, narrow), 0);
    this.camera.position.setFromSpherical(new THREE.Spherical(dist, polar, this.azimuth)).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /**
   * Останавливает рендер-луп, не трогая сцену. Карта мира и диорама не рисуются
   * одновременно, но возвращение с карты не должно заново собирать геометрию:
   * здания, жители и текстуры остаются на месте, гаснет только отрисовка.
   */
  pause(): void {
    if (this.paused || this.disposed) return;
    this.paused = true;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    // Часы стояли вместе с лупом: съедаем накопленную дельту, иначе первый кадр
    // прыгнет на всё время, проведённое на карте.
    this.clock.getDelta();
    this.gameTimeAt = performance.now();
    this.loop();
  }

  dispose(): void {
    this.disposed = true;
    if (active === this) active = null;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.controls.dispose();
    this.renderer.dispose();
  }

  // ---------- Выбор здания ----------

  private onPointerDown = (e: PointerEvent): void => {
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerCancel = (): void => {
    this.down = null;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== e.pointerId || !this.onPick) return;
    // Вращение камеры не должно открывать панели: тап — это короткое касание без сдвига.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE) return;
    if (performance.now() - d.t > TAP_MS) return;
    this.onPick(this.pickAt(e.clientX, e.clientY));
  };

  /**
   * Здание под пальцем. Сначала честный рейкаст по увеличенным мишеням,
   * потом — ближайшая крыша в радиусе TAP_FORGIVE на экране.
   */
  private pickAt(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Mesh[] = [];
    for (const v of this.buildings.values()) targets.push(v.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length > 0) return (hits[0].object.userData.buildingId as number) ?? null;

    let best: number | null = null;
    let bestDist = TAP_FORGIVE;
    const p = new THREE.Vector3();
    for (const [id, view] of this.buildings) {
      p.copy(view.group.position);
      p.y = 0.8;
      p.project(this.camera);
      if (p.z > 1) continue;
      const sx = ((p.x + 1) / 2) * rect.width;
      const sy = ((1 - p.y) / 2) * rect.height;
      const dist = Math.hypot(sx - x, sy - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = id;
      }
    }
    return best;
  }

  /**
   * Где здание на экране: центр в пикселях страницы и радиус, накрывающий его модель.
   * Считается от текущей камеры, поэтому подсветка не отстаёт при вращении.
   * null — здания нет или оно за спиной камеры.
   */
  screenSpot(id: number): { x: number; y: number; r: number } | null {
    const view = this.buildings.get(id);
    if (!view) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const center = view.group.position.clone();
    center.y = 0.9;
    const p = center.clone().project(this.camera);
    if (p.z > 1) return null;
    const toScreen = (v: THREE.Vector3): [number, number] => [
      ((v.x + 1) / 2) * rect.width + rect.left,
      ((1 - v.y) / 2) * rect.height + rect.top,
    ];
    const [x, y] = toScreen(p);
    // Радиус меряем тем же способом: точка, сдвинутая вбок на размер основания.
    const [w, d] = footprintOf(view.type, view.tier);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const edge = center.add(right.multiplyScalar(Math.max(1.3, Math.max(w, d) * 0.9))).project(this.camera);
    const [ex, ey] = toScreen(edge);
    return { x, y, r: Math.min(140, Math.max(34, Math.hypot(ex - x, ey - y))) };
  }

  setSelected(id: number | null): void {
    this.selected = id;
    const view = id !== null ? this.buildings.get(id) : undefined;
    if (!view) {
      this.selection.visible = false;
      return;
    }
    const [w, d] = footprintOf(view.type, view.tier);
    this.selection.position.set(view.group.position.x, 0.07, view.group.position.z);
    this.selection.scale.setScalar(Math.max(1.1, Math.max(w, d) * 0.85));
    this.selection.visible = true;
  }

  // ---------- Синхронизация с состоянием ----------

  private takeIndex(used: Set<number>): number {
    let i = 0;
    while (used.has(i)) i++;
    used.add(i);
    return i;
  }

  private slotFor(b: Building, ordinalShelter: number): Slot {
    if (b.type === 'campfire' || b.type === 'palisade') return { x: 0, z: 0, rot: 0 };
    if (b.type === 'shelter') {
      let i = this.shelterSlots.get(b.id);
      if (i === undefined) {
        i = ordinalShelter;
        this.shelterSlots.set(b.id, i);
      }
      return shelterSlot(i);
    }
    if (b.type === 'farm') {
      let i = this.farmSlots.get(b.id);
      if (i === undefined) {
        i = this.takeIndex(this.usedFarm);
        this.farmSlots.set(b.id, i);
      }
      return farmSlot(i);
    }
    let i = this.ringSlots.get(b.id);
    if (i === undefined) {
      // Здание добычи просится в слот со стороны своей зоны; занято — берём первый свободный.
      const zone = BUILDING_ZONE[b.type];
      const want = zone ? ringIndexToward(zone) : -1;
      i = want >= 0 && !this.usedRing.has(want) ? want : this.takeIndex(this.usedRing);
      this.usedRing.add(i);
      this.ringSlots.set(b.id, i);
    }
    return ringSlot(i);
  }

  private buildingPosition(id: number): THREE.Vector3 | null {
    const v = this.buildings.get(id);
    return v ? v.group.position.clone() : null;
  }

  private makeHitbox(b: Building, tier: Tier): THREE.Mesh {
    const [w, d] = footprintOf(b.type, tier);
    const r = Math.max(1.4, Math.max(w, d) * 0.85);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 3.4, 6),
      // Ничего не рисует, но остаётся в сцене — рейкаст по ней работает всегда.
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
    );
    mesh.position.y = 1.5;
    mesh.userData.buildingId = b.id;
    return mesh;
  }

  private setMarker(view: BuildingView, kind: Attention | null): void {
    if (view.markerKind === kind) return;
    view.markerKind = kind;
    if (view.marker) {
      view.group.remove(view.marker);
      view.marker = null;
    }
    if (!kind) return;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: markerTexture(kind), depthTest: false, transparent: true }),
    );
    sprite.scale.setScalar(0.9);
    sprite.position.y = view.markerY;
    sprite.renderOrder = 6;
    view.group.add(sprite);
    view.marker = sprite;
  }

  private disposeView(view: BuildingView): void {
    this.scene.remove(view.group);
    view.hit.geometry.dispose();
    (view.hit.material as THREE.Material).dispose();
  }

  sync(s: GameState): void {
    this.gameTime = s.time;
    this.gameTimeAt = performance.now();
    this.season = seasonOf(s.time);

    // Здания. Модель пересобирается только на пороге ступени или при смене эпохи:
    // внутри ступени уровень читается масштабом, а стройка — лесами поверх модели.
    const eraId = era(s);
    const seen = new Set<number>();
    let shelterOrdinal = 0;
    let tallest: Tier = 0;
    for (const b of s.buildings) {
      seen.add(b.id);
      const stage = stageOf(b);
      const tier = visualTier(b.level);
      let view = this.buildings.get(b.id);
      if (view && (view.stage !== stage || view.tier !== tier || view.era !== eraId)) {
        this.disposeView(view);
        this.buildings.delete(b.id);
        view = undefined;
      }
      if (!view) {
        const group = createBuildingGroup(b.type, stage, tier, eraId);
        const slot = this.slotFor(b, shelterOrdinal);
        group.position.set(slot.x, 0, slot.z);
        group.rotation.y = slot.rot;
        const hit = this.makeHitbox(b, tier);
        group.add(hit);
        this.scene.add(group);
        view = {
          group,
          stage,
          tier,
          era: eraId,
          type: b.type,
          hit,
          scaffold: null,
          marker: null,
          markerKind: null,
          markerY: (MARKER_HEIGHT[b.type] ?? 2.3) * (1 + 0.28 * tier),
        };
        this.buildings.set(b.id, view);
        if (b.type === 'campfire') {
          this.flame = group.getObjectByName('flame') ?? null;
          this.flameInner = group.getObjectByName('flameInner') ?? null;
        }
      }
      // Уровень читается силуэтом и внутри ступени: постройка подрастает с каждым.
      view.group.scale.setScalar(levelScale(b.level));
      if (b.type === 'shelter') shelterOrdinal++;

      // Улучшение: здание работает и не исчезает, его просто обносят лесами.
      const upgrading = b.level > 0 && isSite(b);
      if (upgrading && !view.scaffold) {
        const [w, d] = footprintOf(b.type, tier);
        view.scaffold = scaffold(w, d, 1.5 + 0.5 * tier);
        view.group.add(view.scaffold);
      } else if (!upgrading && view.scaffold) {
        view.group.remove(view.scaffold);
        view.scaffold = null;
      }

      this.setMarker(view, buildingAttention(s, b));
      if (tier > tallest) tallest = tier;
    }
    // Постройки доросли до новой ступени — отодвигаем камеру, чтобы посёлок влез в кадр.
    if (tallest !== this.villageTier) {
      this.villageTier = tallest;
      this.applyFraming(this.aspect);
    }
    for (const [id, view] of this.buildings) {
      if (seen.has(id)) continue;
      this.disposeView(view);
      this.buildings.delete(id);
      for (const [map, used] of [
        [this.ringSlots, this.usedRing],
        [this.farmSlots, this.usedFarm],
      ] as [Map<number, number>, Set<number>][]) {
        const i = map.get(id);
        if (i !== undefined) {
          used.delete(i);
          map.delete(id);
        }
      }
      this.shelterSlots.delete(id);
    }
    if (this.selected !== null) this.setSelected(this.selected);

    // Жители.
    const site = s.buildings.find(isSite);
    const sitePos = site ? this.buildingPosition(site.id) : null;
    const perJob = new Map<string, number>();
    const seenV = new Set<number>();
    for (const v of s.villagers) {
      seenV.add(v.id);
      let agent = this.agents.get(v.id);
      if (!agent) {
        agent = new VillagerAgent(v, new THREE.Vector3(0, 0, 0));
        this.agents.set(v.id, agent);
        this.scene.add(agent.group);
      }
      const n = perJob.get(v.job) ?? 0;
      perJob.set(v.job, n + 1);
      const [pos, wander] = this.workplaceFor(v, n, sitePos);
      agent.setWork(v.job, pos, wander);
    }
    for (const [id, agent] of this.agents) {
      if (seenV.has(id)) continue;
      this.scene.remove(agent.group);
      this.agents.delete(id);
    }
  }

  /** Где житель работает: приписан к зданию — идёт туда, вольный сбор — в свою зону. */
  private workplaceFor(v: Villager, ordinal: number, sitePos: THREE.Vector3 | null): [THREE.Vector3 | null, number] {
    if (v.workplace !== null) {
      const p = this.buildingPosition(v.workplace);
      if (p) return [p, 1.1];
    }
    switch (v.job) {
      case 'gatherer':
        return [ZONES.berries, 1.8];
      case 'hunter':
        return [ZONES.hunting, 3.5];
      case 'woodcutter':
        return [ZONES.forest, 2.5];
      case 'stonecutter':
      case 'miner':
        return [ZONES.rocks, 1.8];
      case 'farmer':
      case 'herder':
        return [ZONES.fields, 1.2];
      case 'idle':
      default:
        return [sitePos, 1.2];
    }
  }

  // ---------- Анимация ----------

  private loop = (): void => {
    if (this.disposed || this.paused) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    const gameNow = this.gameTime + (performance.now() - this.gameTimeAt) / 1000;
    // Сезон переливает палитру сам, а фаза солнца уже учитывает длинную зимнюю ночь.
    this.seasonVis.update(this.season, dt);
    const solar = solarPhase(dayFraction(gameNow), this.season);
    this.applyDayNight(solar);
    const snow = this.seasonVis.snow;
    this.snowfall.update(dt, t, snow);
    this.smoke.update(dt, snow);

    const night = solar > 0.58 && solar < 0.97;
    for (const a of this.agents.values()) {
      a.night = night;
      a.update(dt, t);
    }

    // Маркеры покачиваются, кольцо выбора дышит — взгляд цепляется без лишних цветов.
    for (const view of this.buildings.values()) {
      if (view.marker) view.marker.position.y = view.markerY + Math.sin(t * 2.2 + view.markerY) * 0.1;
    }
    if (this.selection.visible) {
      (this.selection.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.25;
    }

    if (this.flame) {
      const f = 1 + Math.sin(t * 14) * 0.08 + Math.sin(t * 23) * 0.05;
      this.flame.scale.set(f, 1 + Math.sin(t * 9) * 0.12, f);
      this.flame.rotation.y = t * 2;
    }
    if (this.flameInner) this.flameInner.rotation.y = -t * 3;
    this.fireLight.intensity = (night ? 4 : 1.2) * (1 + Math.sin(t * 17) * 0.12);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** solar: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь. */
  private applyDayNight(solar: number): void {
    const angle = solar * Math.PI * 2;
    const elev = Math.sin(angle); // -1..1
    const daylight = THREE.MathUtils.clamp((elev + 0.35) / 0.5, 0, 1);
    this.sun.position.set(Math.cos(angle) * 16, Math.max(2, elev * 20), 8);
    this.sun.intensity = 0.15 + daylight * 1.5;
    this.hemi.intensity = 0.25 + daylight * 0.55;

    const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.3, 0, 1);
    const sky = new THREE.Color().copy(SKY_NIGHT).lerp(this.seasonVis.sky, daylight);
    sky.lerp(SKY_DUSK, dusk * 0.6);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    const sunColor = new THREE.Color(0xffe7c4).lerp(new THREE.Color(0xff9a5a), dusk);
    this.sun.color.copy(sunColor);
  }
}
