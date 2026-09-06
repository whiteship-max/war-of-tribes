// 3D-диорама поселения. Получает состояние через sync(), анимирует сам.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Building, BuildingTypeId, Caravan, GameState, Season, TroopId } from '@/game/types';
import {
  buildingAttention,
  caravanProgress,
  dayFraction,
  isSite,
  seasonOf,
  solarPhase,
  storageCap,
  workerCount,
  type Attention,
} from '@/game/derived';
import { TROOP_IDS } from '@/game/data/troops';
import { RESOURCE_IDS } from '@/game/constants';
import { buildTerrain } from './terrain';
import { FRAME_RADIUS, OUTSKIRTS_RADIUS, PLAN_SCALE, placeOf, plotRadius } from './plan';
import { buildVillage } from './village';
import { MAX_SOLDIERS, SoldierAgent, postFor } from './soldiers';
import {
  createBuildingGroup,
  footprintOf,
  levelScale,
  scaffold,
  visualTier,
  type Tier,
} from './buildings';
import { VillagerAgent, shownVillagers } from './villagers';
import { HeroAgent, heroShown } from './hero';
import { FigurePool } from './figures';
import { CaravanAgent } from './caravan';
import { SeasonVisuals } from './season';
import { CHIMNEY_LOOK, Smoke, Snowfall, chimneySmoke, type SmokeSource } from './weather';
import { SMOKE_HEIGHT, WORK_SIGN, WorkSigns, type LoadKind } from './worksigns';
import {
  applyDayNight,
  configureRenderer,
  configureSky,
  createLightRig,
  fireIntensity,
  fitShadow,
  type LightRig,
} from './lighting';
import { PALETTE } from './palette';
import { disposeGeometries } from './kit';

interface BuildingView {
  group: THREE.Group;
  /** Визуальная ступень: модель меняется на её пороге, а не на каждом уровне. */
  tier: Tier;
  type: Building['type'];
  /** Невидимая мишень для тапа — заметно крупнее самой модели. */
  hit: THREE.Mesh;
  scaffold: THREE.Group | null;
  /** Горн кузницы: он есть в модели и гаснет, когда кузнецов нет. */
  glow: THREE.Object3D | null;
  marker: THREE.Sprite | null;
  markerKind: Attention | null;
  markerY: number;
}

/** Тап пальцем: сколько можно проехать и как долго держать, чтобы это всё ещё был тап. */
const TAP_MOVE = 14;
const TAP_MS = 500;
/**
 * Промах по модели прощается в этом радиусе на экране. Посёлок теперь кадрируется
 * по стене целиком, постройки в кадре мельче — прощаем щедрее, чем раньше.
 */
const TAP_FORGIVE = 58;

/**
 * Сколько жителей видно разом. Больше десятка фигурок у костра — уже толпа, в
 * которой не сосчитать свободные руки, а весь смысл площади в том, чтобы их
 * было видно счётом. Остальные свободные просто не показываются.
 */

/** Доля вместимости, с которой у склада появляются мешки. */
const STORAGE_SHOWN = 0.15;

const MARKER_GLYPH: Record<Attention, string> = { idle: '💤', order: '⚒️', slot: '👤', upgrade: '⬆️' };
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
  church: 3.6,
  statue: 3.2,
  watch: 3.4,
  houses: 2.6,
  smithy: 2.8,
  mine: 2.6,
  market: 2.2,
  campfire: 1.8,
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
  private rig: LightRig;
  private fireLight: THREE.PointLight;
  /** Ландшафт с окружением — одной группой, чтобы силуэтный режим мог его погасить. */
  private terrain: THREE.Group;
  /** Силуэтный режим стенда: всё чёрным на белом, только постройки. */
  private silhouette = false;
  private silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private buildings = new Map<number, BuildingView>();
  private agents = new Map<number, VillagerAgent>();
  private nextAgentId = 1;
  private soldiers: SoldierAgent[] = [];
  /** Герой у своей статуи. null — он в походе или лежит после боя. */
  private hero: HeroAgent | null = null;
  /** Род, под который одет герой сейчас: сменился — фигурку пересобираем. */
  private heroKey: string | null = null;
  /** Все фигурки — жители и бойцы — одним пулом инстансов: девять вызовов на всех. */
  private figures = new FigurePool();
  /** Караваны рынка: телега на дороге у ворот, пока покупка в пути. */
  private caravans = new Map<number, { agent: CaravanAgent; departAt: number; arriveAt: number }>();
  /** Обстановка посёлка: площадь, дороги, размеченные площадки и декор. */
  private village: THREE.Group | null = null;
  /** Слепок того, из чего собрана обстановка: пересобираем только при изменениях. */
  private villageKey = '';
  /** Слепок армии — по нему пересобираются фигурки бойцов. */
  private armyKey = '';
  private clock = new THREE.Clock();
  private raf = 0;
  private frameNo = 0;
  /** Было ли уже состояние: по первому sync сезон ставится без перелива. */
  private synced = false;
  private gameTime = 0;
  private gameTimeAt = 0;
  private flame: THREE.Object3D | null = null;
  private flameInner: THREE.Object3D | null = null;
  private seasonVis = new SeasonVisuals();
  private snowfall = new Snowfall();
  private smoke = new Smoke();
  /** Дым труб — своя система: он гуще очажного, иначе признак работы не виден. */
  private chimneys = new Smoke(CHIMNEY_LOOK, []);
  /** Признаки занятости зданий: грузы у стен. Один вызов отрисовки на все. */
  private signs = new WorkSigns();
  private season: Season = 'spring';
  private disposed = false;
  private paused = false;
  /** Канва и рендерер отданы ролику о бое: диорама молчит, пока их не вернут. */
  private lent = false;
  private selection: THREE.Mesh;
  private selected: number | null = null;
  private down: { id: number; x: number; y: number; t: number } | null = null;
  /** Тап по зданию (или по пустому месту — тогда null). Ставит UI. */
  onPick: ((id: number | null) => void) | null = null;
  /** Вызывается сразу после render() — стенд снимает кадр, пока буфер ещё не очищен. */
  afterRender: (() => void) | null = null;
  /** Азимут стартового ракурса — сохраняется при перекадрировке. */
  private azimuth = Math.atan2(9, 12);
  /** После ручного вращения камеру больше не переставляем. */
  private userMoved = false;

  /** pixelRatio — принудительная плотность пикселей (стенд); по умолчанию — экрана, в [1, 2]. */
  constructor(private canvas: HTMLCanvasElement, private pixelRatio: number | null = null) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // dpr зажат в [1, 2]: на 3x-экранах третий пиксель не виден, а филлрейт растёт вдвое.
    this.renderer.setPixelRatio(this.dpr());
    configureRenderer(this.renderer);
    configureSky(this.scene);
    // Честный счёт вызовов: при autoReset счётчик сбрасывается после теневого
    // прохода, и stats() занижал бы бюджет вдвое. Сбрасываем сами перед кадром.
    this.renderer.info.autoReset = false;
    // Теневой проход через кадр: двигаются только фигурки, отставание тени на кадр не видно.
    this.renderer.shadowMap.autoUpdate = false;

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

    this.rig = createLightRig(this.scene);

    this.fireLight = new THREE.PointLight(PALETTE.fireLight, 0.6, 14, 1.6);
    this.fireLight.position.set(0, 1.0, 0);
    this.scene.add(this.fireLight);

    this.terrain = buildTerrain();
    this.scene.add(this.terrain);
    this.scene.add(this.figures.group);
    this.scene.add(this.snowfall.points);
    this.scene.add(this.smoke.points);
    this.scene.add(this.chimneys.points);
    this.scene.add(this.signs.group);

    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1.06, 32),
      // Цвет интерфейса, не сцены: кольцо не тонмапится, иначе акцент посереет.
      new THREE.MeshBasicMaterial({
        color: 0xe8a43c,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
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

  private dpr(): number {
    return this.pixelRatio ?? THREE.MathUtils.clamp(window.devicePixelRatio || 1, 1, 2);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w < 1 || h < 1) return;
    this.renderer.setPixelRatio(this.dpr());
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
    // 0.75 — граница портрета; любой телефон (0.46–0.62) попадает в narrow = 1.
    const narrow = THREE.MathUtils.clamp((0.75 - aspect) / 0.15, 0, 1);
    // В портрете смотрим заметно сверху: кольцо стены должно читаться кольцом,
    // а не полоской у горизонта под половиной экрана неба. Но не отвесно:
    // при 0.62 верхнюю треть экрана занимала голая трава, при 0.7 — опушка.
    const polar = THREE.MathUtils.lerp(0.95, 0.7, narrow);
    // В портрете угол шире: иначе кадр не удержать без отъезда за предел дистанции.
    const fov = THREE.MathUtils.lerp(42, 48, narrow);
    // Кадр держит план целиком, а не постройки: FRAME_RADIUS задан планом раз и
    // навсегда, поэтому кадр не дёргается при каждой новой крыше — посёлок растёт
    // внутри одной и той же рамки, как на карте укреплённого города. Считается он
    // не от стены, а от края застройки: ресурсные дворы стоят снаружи, и половина
    // хозяйства иначе оказалась бы за краем экрана.
    const fitRadius = FRAME_RADIUS * THREE.MathUtils.lerp(1.12, 0.96, narrow);
    const halfH = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
    const dist = THREE.MathUtils.clamp(fitRadius / Math.tan(halfH), 14, 92);

    this.camera.fov = fov;

    this.controls.minDistance = dist * 0.45;
    this.controls.maxDistance = dist * 1.6;
    this.controls.maxPolarAngle = Math.max(1.05, polar + 0.32);

    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist * 1.1;
    fog.far = dist * 1.75;
    this.camera.far = fog.far + 10;
    this.camera.updateProjectionMatrix();

    // Коробка теней накрывает посёлок целиком: она привязана к стене, как и кадр.
    // Тень накрывает и дворы за стеной: окружение теней не отбрасывает, а они — да.
    fitShadow(this.rig, OUTSKIRTS_RADIUS + 1);

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

  /**
   * Одалживает канву и рендерер ролику о бое. Второго контекста WebGL в игре не
   * бывает (раздел 12 документа о бое): пока одолжено, диорама кадров не рисует,
   * а свой цикл ведёт ролик. Геометрия посёлка при этом жива — как и на карте.
   */
  lend(on: boolean): THREE.WebGLRenderer {
    this.lent = on;
    return this.renderer;
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
   * Здание под пальцем — то, чей значок ближе всего к тапу на экране.
   *
   * Раньше здесь был честный рейкаст по невидимым мишеням, и на кольцевой
   * планировке он врал: луч к костру в центре успевал зацепить мишень соседа,
   * стоящего между камерой и центром. Экранная близость такой ошибки не даёт и,
   * главное, совпадает с тем, что игрок видит: подсветка обучения рисуется той же
   * функцией `screenSpot`, поэтому «тапни костёр» и «попал в костёр» — одно и то же.
   *
   * Каждому зданию своя досягаемость: крупная постройка ловит палец по всей крыше,
   * мелкая — в радиусе прощения промаха.
   */
  private pickAt(clientX: number, clientY: number): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const id of this.buildings.keys()) {
      const spot = this.screenSpot(id);
      if (!spot) continue;
      const dist = Math.hypot(spot.x - clientX, spot.y - clientY);
      const reach = Math.max(TAP_FORGIVE, spot.r);
      if (dist > reach) continue;
      const score = dist / reach;
      if (score < bestScore) {
        bestScore = score;
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
    const edge = center
      .add(right.multiplyScalar(Math.max(1.3, Math.max(w, d) * 0.9 * PLAN_SCALE)))
      .project(this.camera);
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
    // Кольцо лежит в сцене, а не в группе здания: масштаб плана к нему применяем сами.
    this.selection.scale.setScalar(Math.max(0.9, Math.max(w, d) * 0.85 * PLAN_SCALE));
    this.selection.visible = true;
  }

  // ---------- Синхронизация с состоянием ----------

  /**
   * Невидимая мишень для тапа. Считается по реальным габаритам собранной модели,
   * а не по фиксированной колонне: высокая мишень соседа перехватывала бы луч,
   * и палец по костру открывал бы стоящее рядом укрытие. Шире своей площадки
   * мишень тоже не бывает — по мелким целям добирает экранное прощение промаха.
   */
  private makeHitbox(b: Building, group: THREE.Group): THREE.Mesh {
    const box = new THREE.Box3().setFromObject(group);
    const spread = Math.max(
      Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
      Math.max(Math.abs(box.min.z), Math.abs(box.max.z)),
    );
    const r = Math.min(plotRadius(b.type) / PLAN_SCALE, Math.max(1.2, spread * 1.15));
    const h = Math.max(1.2, box.max.y) + 0.4;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 6),
      // Ничего не рисует, но остаётся в сцене — рейкаст по ней работает всегда.
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
    );
    mesh.position.y = h / 2;
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
      new THREE.SpriteMaterial({ map: markerTexture(kind), depthTest: false, transparent: true, toneMapped: false }),
    );
    sprite.scale.setScalar(0.9);
    sprite.position.y = view.markerY;
    sprite.renderOrder = 6;
    view.group.add(sprite);
    view.marker = sprite;
  }

  private disposeView(view: BuildingView): void {
    this.scene.remove(view.group);
    // Геометрия модели своя у каждого здания — без этого смена ступени текла в GPU.
    // Материалы общие, их не трогаем.
    disposeGeometries(view.group);
    (view.hit.material as THREE.Material).dispose();
  }

  sync(s: GameState): void {
    this.gameTime = s.time;
    this.gameTimeAt = performance.now();
    this.season = seasonOf(s.time);
    // Первый кадр уже нарисован в конструкторе с весной по умолчанию: настоящий
    // сезон ставим прыжком, иначе партия открывается с перелива к нему.
    if (!this.synced) {
      this.synced = true;
      this.seasonVis.jump(this.season);
    }
    this.syncVillage(s);

    // Здания. Модель пересобирается только на пороге ступени: внутри ступени
    // уровень читается масштабом, а улучшение — лесами поверх модели.
    const seen = new Set<number>();
    for (const b of s.buildings) {
      seen.add(b.id);
      const tier = visualTier(b.level);
      let view = this.buildings.get(b.id);
      if (view && view.tier !== tier) {
        this.disposeView(view);
        this.buildings.delete(b.id);
        view = undefined;
      }
      if (!view) {
        const group = createBuildingGroup(b.type, tier);
        // Место берётся из плана: у каждого типа оно своё и не меняется никогда.
        const spot = placeOf(b.type);
        group.position.set(spot.x, 0, spot.z);
        group.rotation.y = spot.rot;
        const hit = this.makeHitbox(b, group);
        group.add(hit);
        this.scene.add(group);
        view = {
          group,
          tier,
          type: b.type,
          hit,
          scaffold: null,
          glow: group.getObjectByName('forge') ?? null,
          marker: null,
          markerKind: null,
          markerY: ((MARKER_HEIGHT[b.type] ?? 2.3) * (1 + 0.28 * tier)) / PLAN_SCALE,
        };
        this.buildings.set(b.id, view);
        if (b.type === 'campfire') {
          this.flame = group.getObjectByName('flame') ?? null;
          this.flameInner = group.getObjectByName('flameInner') ?? null;
        }
      }
      // Уровень читается силуэтом и внутри ступени: постройка подрастает с каждым.
      // Общий масштаб плана к стене не применяется: стена сама и есть это кольцо.
      view.group.scale.setScalar(
        b.type === 'palisade' ? 1 : levelScale(b.level) * PLAN_SCALE,
      );

      // Улучшение: здание работает и не исчезает, его просто обносят лесами.
      const upgrading = isSite(b);
      if (upgrading && !view.scaffold) {
        const [w, d] = footprintOf(b.type, tier);
        view.scaffold = scaffold(w, d, 1.5 + 0.5 * tier);
        view.group.add(view.scaffold);
      } else if (!upgrading && view.scaffold) {
        view.group.remove(view.scaffold);
        view.scaffold = null;
      }

      this.setMarker(view, buildingAttention(s, b));
    }
    for (const [id, view] of this.buildings) {
      if (seen.has(id)) continue;
      this.disposeView(view);
      this.buildings.delete(id);
    }
    if (this.selected !== null) this.setSelected(this.selected);

    // Жители. На сцене только свободные руки: назначенный на работу житель с неё
    // исчезает, снятый — возвращается к костру. Занятость показывают сами здания
    // (syncWorkSigns), а не ходьба туда-обратно.
    //
    // Показывается не больше `MAX_VILLAGERS` фигурок: это потолок показа, а не
    // потолок племени (см. shownVillagers).
    const shown = shownVillagers(s);
    while (this.agents.size > shown) {
      const [id, agent] = [...this.agents][this.agents.size - 1];
      this.figures.remove(agent.figure);
      this.agents.delete(id);
    }
    while (this.agents.size < shown) {
      // Покрои идут по кругу: три вида одежды, и толпа у костра разношёрстная.
      const agent = new VillagerAgent(this.nextAgentId);
      this.agents.set(this.nextAgentId++, agent);
      this.figures.add(agent.figure);
    }

    // Герой: одна фигурка у статуи. Ушёл с походом или ранен — площадь пуста.
    // Пересобирается он и при смене рода: силуэт героя — это вид бойца, который
    // он ведёт, и менять его должна Статуя, а не отдельная таблица в сцене.
    const wantHero = heroShown(s);
    const heroKey = wantHero ? s.hero.kind : null;
    if (heroKey !== this.heroKey) {
      if (this.hero) this.figures.remove(this.hero.figure);
      this.hero = heroKey ? new HeroAgent(s) : null;
      if (this.hero) this.figures.add(this.hero.figure);
      this.heroKey = heroKey;
    }

    this.syncWorkSigns(s);
    this.syncSoldiers(s);
    this.syncCaravans(s);
  }

  /**
   * Телеги караванов. Своего времени у них нет: сцена запоминает сроки заказа
   * и каждый кадр пересчитывает долю пути — так телега едет плавно между тиками.
   */
  private syncCaravans(s: GameState): void {
    const seen = new Set<number>();
    for (const c of s.caravans ?? []) {
      seen.add(c.id);
      let view = this.caravans.get(c.id);
      if (!view) {
        const agent = new CaravanAgent(c.id);
        this.scene.add(agent.group);
        view = { agent, departAt: c.departAt, arriveAt: c.arriveAt };
        this.caravans.set(c.id, view);
      }
      view.departAt = c.departAt;
      view.arriveAt = c.arriveAt;
      // Первый кадр телега уже должна стоять на своём месте, а не в центре посёлка.
      view.agent.update(caravanProgress(s, c as Caravan), 0);
    }
    for (const [id, view] of this.caravans) {
      if (seen.has(id)) continue;
      this.scene.remove(view.agent.group);
      this.caravans.delete(id);
    }
  }

  /**
   * Обстановка посёлка. Пересобирается редко: только когда меняется набор построек
   * или их ступени. Дороги при этом никуда не переезжают — они заданы планом.
   */
  private syncVillage(s: GameState): void {
    const present = s.buildings.map((b) => b.type).sort();
    // Декали под зданиями растут со ступенью, поэтому ступень входит в ключ.
    const built = s.buildings
      .map((b) => ({ type: b.type, tier: visualTier(b.level) }))
      .sort((a, b) => (a.type < b.type ? -1 : 1));
    const key = `${present.join(',')}|${built.map((b) => `${b.type}:${b.tier}`).join(',')}`;
    if (key === this.villageKey && this.village) return;
    this.villageKey = key;
    if (this.village) {
      this.scene.remove(this.village);
      disposeGeometries(this.village);
    }
    this.village = buildVillage({ present, built });
    this.scene.add(this.village);
  }

  /**
   * Фигурки бойцов. Армия — счётчики, а не жители, поэтому фигурки пересобираются
   * целиком при изменении состава: их немного и они дешёвые.
   */
  private syncSoldiers(s: GameState): void {
    const key = TROOP_IDS.map((id) => s.army?.[id] ?? 0).join(',');
    if (key === this.armyKey) return;
    this.armyKey = key;
    for (const a of this.soldiers) this.figures.remove(a.figure);
    this.soldiers = [];

    const roster: TroopId[] = [];
    // Сильных показываем первыми: у ворот должна стоять лучшая дружина.
    for (const id of [...TROOP_IDS].reverse()) {
      const n = Math.max(0, s.army?.[id] ?? 0);
      for (let i = 0; i < n && roster.length < MAX_SOLDIERS; i++) roster.push(id);
    }
    if (roster.length === 0) return;
    const barracks = s.buildings.find((b) => b.type === 'barracks') ?? null;
    const spot = barracks ? placeOf('barracks') : null;
    const anchor = spot ? new THREE.Vector3(spot.x, 0, spot.z) : null;
    roster.forEach((troop, i) => {
      const { post, anchor: at } = postFor(i, barracks !== null, anchor);
      const agent = new SoldierAgent(troop, post, at, i);
      this.soldiers.push(agent);
      this.figures.add(agent.figure);
    });
  }

  /**
   * Признаки занятости. Здание, в котором есть рабочие, показывает это само:
   * груз у стены, дым из трубы, горящий горн. Считается в sync, а не каждый
   * кадр: набор работающих зданий меняется вместе с назначениями, не чаще.
   *
   * Склад — исключение из правила «есть рабочие»: их у него не бывает вовсе,
   * а мешки при полных закромах он показывать обязан, иначе главное здание
   * посёлка стоит мёртвым. У него признак считается по запасам.
   */
  private syncWorkSigns(s: GameState): void {
    const loads: { type: BuildingTypeId; kind: LoadKind }[] = [];
    const smoke: SmokeSource[] = [];
    const stock = RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0);
    const full = stock > storageCap(s) * STORAGE_SHOWN;
    for (const b of s.buildings) {
      const sign = WORK_SIGN[b.type];
      if (!sign) continue;
      // Склад — исключение по запасам, кузница — по заказам: кузнецы у горна
      // без заказа не работают, и горн у них холодный. Это и есть тот признак
      // простоя, который игрок обязан заметить со сцены, не открывая панели.
      const busy =
        b.type === 'storage'
          ? full
          : b.type === 'smithy'
            ? workerCount(s, b.id) > 0 && (s.forge?.length ?? 0) > 0
            : workerCount(s, b.id) > 0;
      const view = this.buildings.get(b.id);
      if (view?.glow) view.glow.visible = busy;
      if (!busy) continue;
      if (sign.load) loads.push({ type: b.type, kind: sign.load });
      if (sign.smoke) {
        const at = placeOf(b.type);
        smoke.push(chimneySmoke(at.x, SMOKE_HEIGHT, at.z));
      }
    }
    this.signs.set(loads);
    this.chimneys.setSources(smoke);
  }

  // ---------- Анимация ----------

  private loop = (): void => {
    if (this.disposed || this.paused) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frame();
  };

  /**
   * Один кадр вне цикла. Нужен стенду: в скрытой вкладке requestAnimationFrame
   * не идёт, а снимок всё равно должен быть с устоявшимися тенями и палитрой.
   */
  renderOnce(): void {
    if (this.disposed) return;
    this.frame();
  }

  private frame(): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    // Канва отдана ролику о бое: он рисует в неё сам, диораме тут делать нечего.
    if (this.lent) return;
    const t = this.clock.elapsedTime;

    const gameNow = this.gameTime + (performance.now() - this.gameTimeAt) / 1000;
    // Сезон переливает палитру сам, а фаза солнца уже учитывает длинную зимнюю ночь.
    this.seasonVis.update(this.season, dt);
    const solar = solarPhase(dayFraction(gameNow), this.season);
    this.applyDayNight(solar);
    const snow = this.seasonVis.snow;
    this.snowfall.update(dt, t, snow);
    this.smoke.update(dt, snow);
    this.chimneys.update(dt, snow);

    const night = solar > 0.58 && solar < 0.97;
    for (const a of this.agents.values()) {
      a.night = night;
      a.update(dt, t);
    }
    this.signs.update(t);
    // Дружина несёт службу и ночью: у ворот всегда кто-то стоит.
    for (const a of this.soldiers) a.update(dt, t);
    this.hero?.update(t);
    this.figures.update();
    for (const view of this.caravans.values()) {
      const total = Math.max(0.001, view.arriveAt - view.departAt);
      view.agent.update((gameNow - view.departAt) / total, t);
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
    // Горн работающей кузницы дышит — с той же частотой, что и костёр, но тише.
    for (const view of this.buildings.values()) {
      if (view.glow?.visible) view.glow.scale.setScalar(1 + Math.sin(t * 7 + view.markerY) * 0.14);
    }
    this.fireLight.intensity = fireIntensity(night, t);

    this.controls.update();
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = (this.frameNo++ & 1) === 0;
    this.renderer.render(this.scene, this.camera);
    this.afterRender?.();
  }

  /** solar: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь. */
  private applyDayNight(solar: number): void {
    if (this.silhouette) return;
    applyDayNight(this.rig, this.scene, solar, this.seasonVis);
  }

  // ---------- Стенд-витрина ----------

  /** Автоповорот камеры — стенд меряет им частоту кадров при вращении. */
  spin(on: boolean, degPerSec = 24): void {
    this.controls.autoRotate = on;
    // OrbitControls: скорость 2.0 — оборот за 30 с при 60 к/с, то есть 12°/с.
    this.controls.autoRotateSpeed = degPerSec / 6;
  }

  /** Бюджет кадра: вызовы отрисовки и треугольники последнего render(). */
  stats(): { calls: number; triangles: number; geometries: number; textures: number; programs: number } {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }

  /**
   * Силуэтный режим: постройки чёрным на белом, всё остальное погашено. Так
   * проверяется главный критерий формы — здание должно опознаваться силуэтом.
   */
  setSilhouette(on: boolean): void {
    this.silhouette = on;
    this.scene.overrideMaterial = on ? this.silhouetteMat : null;
    this.scene.fog = on ? null : this.scene.fog ?? new THREE.Fog(0xffffff, 22, 40);
    if (on) (this.scene.background as THREE.Color).setHex(0xffffff);
    this.terrain.visible = !on;
    if (this.village) this.village.visible = !on;
    this.figures.group.visible = !on;
    this.signs.group.visible = !on;
    for (const c of this.caravans.values()) c.agent.group.visible = !on;
    this.snowfall.points.visible = !on && this.snowfall.points.visible;
    this.smoke.points.visible = !on;
    this.chimneys.points.visible = !on && this.chimneys.active;
    this.selection.visible = !on && this.selected !== null;
    for (const view of this.buildings.values()) {
      view.hit.visible = !on;
      if (view.marker) view.marker.visible = !on;
    }
  }
}
