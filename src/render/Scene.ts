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
import { OUTSKIRTS_RADIUS, PLAN_SCALE, WALL_RADIUS, placeOf } from './plan';
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
import { Gesture, TAP_TARGET } from '@/gestures';
import { hitBox, onRing, pickBox, projectHitBox, silhouetteBox, type HitBox } from './pick';
import { clampPan, framing, zoomRange } from './camera';
import { FrameLoop } from './loop';
import { sceneLog, sizeNote, type Block, type Vitals } from '@/scenelog';

interface BuildingView {
  group: THREE.Group;
  /** Визуальная ступень: модель меняется на её пороге, а не на каждом уровне. */
  tier: Tier;
  type: Building['type'];
  /**
   * Силуэт модели в её собственных координатах: описанная коробка, снятая один
   * раз при сборке — до того, как к группе подвесили леса и значок. По ней
   * считается область попадания, поэтому тонкая геометрия ранних ступеней тапу
   * не мешает: коробка накрывает здание целиком, и основание, и высоту.
   */
  box: THREE.Box3;
  scaffold: THREE.Group | null;
  /** Горн кузницы: он есть в модели и гаснет, когда кузнецов нет. */
  glow: THREE.Object3D | null;
  marker: THREE.Sprite | null;
  markerKind: Attention | null;
  markerY: number;
}

/**
 * Полуширина полосы, в которой тап считается попаданием по стене, в мировых
 * единицах. Стена — кольцо вокруг всего посёлка, коробки под неё не бывает
 * (см. `pick.onRing`), а полоса чуть шире самой кладки: по стене тоже целятся
 * пальцем, а не пикселем.
 */
const WALL_BAND = 1.6;

/** Земля посёлка: по ней тап опускается в мир, когда меряется попадание по стене. */
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

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
/**
 * Скрыта ли страница сейчас. Отдельной функцией, потому что спрашивают дважды, а
 * главное — потому что ответ обязан быть «видна» там, где документа нет вовсе.
 */
const hiddenNow = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

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
  /**
   * Цепочка кадров и все причины, по которым она сейчас стоит: карта, скрытая
   * страница, потерянный контекст, выгруженная сцена. Флаг тут не годится —
   * причины накладываются друг на друга, и снятие одной ничего не решает
   * (разбор — в `render/loop.ts`).
   */
  private beat = new FrameLoop<Block>(
    () => this.frame(),
    () => this.rewind(),
  );
  /** Сколько кадров нарисовано за жизнь сцены и когда был последний. */
  private drawn = 0;
  private lastFrame = 0;
  /** Размер и плотность, с которыми настроен буфер. По ним видно, что он отстал. */
  private sized = { w: 0, h: 0, dpr: 0 };
  /** Пересчёт отложен: холста в этот момент не было или он был нулевой. */
  private needSize = false;
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
  /** Канва и рендерер отданы ролику о бое: диорама молчит, пока их не вернут. */
  private lent = false;
  private selection: THREE.Mesh;
  private selected: number | null = null;
  /**
   * Разбор жеста — общий с картой мира (`src/gestures.ts`). Панораму, наезд и
   * поворот ведёт `OrbitControls`; здесь решается только одно: тап это был или
   * ведение. Одним пальцем камера **водит** (`TOUCH.PAN`), поворот бывает
   * только двумя — как на карте.
   */
  private touch = new Gesture();
  /** Здание под пальцем в момент нажатия — на отпускании оно и открывается. */
  private aimed: number | null = null;
  /** Тап по зданию (или по пустому месту — тогда null). Ставит UI. */
  onPick: ((id: number | null) => void) | null = null;
  /** Вызывается сразу после render() — стенд снимает кадр, пока буфер ещё не очищен. */
  afterRender: (() => void) | null = null;
  /** Азимут стартового ракурса — сохраняется при перекадрировке. */
  private azimuth = Math.atan2(9, 12);
  /** После ручного вращения камеру больше не переставляем. */
  private userMoved = false;
  /** Ссылкой, а не литералом: на выгрузке подписку надо снять поимённо. */
  private onControlStart = (): void => {
    this.userMoved = true;
  };

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
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 26;
    this.controls.minPolarAngle = 0.45;
    this.controls.maxPolarAngle = 1.25;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    // Ведение по деревне — как по карте мира: один палец водит, щипок приближает.
    // Разные жесты в двух местах одной игры игрок не прощает, а карта — это
    // половина игры. Третий жест у диорамы свой: поворот двумя пальцами. У плоской
    // карты такого жеста нет, поэтому и конфликта нет — см. `src/gestures.ts`.
    this.controls.enablePan = true;
    // Панорама идёт по земле, а не по плоскости экрана: иначе движение вниз
    // поднимало бы камеру над посёлком, и «увести вбок» превращалось бы во взлёт.
    this.controls.screenSpacePanning = false;
    this.controls.panSpeed = 1;
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.addEventListener('start', this.onControlStart);
    // Привязка к деревне: OrbitControls своей у цели не имеет, поэтому держим её
    // сами на каждом изменении — уехать за окрестности в пустой лес нельзя.
    this.controls.addEventListener('change', this.leash);

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
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);

    this.resize();
    // Кадры не идут в скрытой странице — не «идут редко», а не идут вовсе. Значит
    // и завести цепочку на скрытой странице нельзя: заявка повиснет до возвращения.
    document.addEventListener('visibilitychange', this.onVisibility);
    this.beat.block('hidden', hiddenNow());
    this.beat.restart();
    active = this;
  }

  /**
   * Страница скрылась или вернулась.
   *
   * Слушателя нет ни у кого другого нарочно: цепочка кадров — дело сцены, и
   * решать, идти ей или стоять, должна она сама. Оболочка зовёт `wake` теми
   * событиями, которых сцене не видно (`pageshow`, `resume`, Телеграм).
   */
  private onVisibility = (): void => {
    const hidden = hiddenNow();
    sceneLog.mark(hidden ? 'hide' : 'show', this.sizeLine());
    if (hidden) {
      this.beat.block('hidden', true);
      return;
    }
    this.wake();
  };

  /**
   * Вернулись из фона.
   *
   * Зовут это четверо — `visibilitychange`, `pageshow`, `resume` и Телеграм, — и
   * все четверо зовут одно и то же. Идемпотентность здесь не удобство, а
   * необходимость: какое из событий придёт на конкретном клиенте (и придёт ли
   * хоть одно), заранее не известно, а прийти могут все сразу.
   *
   * Цепочка кадров заводится **заново**, а не «продолжается»: заявка, поданная
   * перед сворачиванием, могла не пережить фон, и тогда её никто уже не позовёт.
   */
  wake(): void {
    if (this.disposed) return;
    this.beat.block('hidden', false);
    // Вьюпорт мог поменяться, пока нас не было: поворот в фоне, вырезы, шапка
    // клиента, другая плотность пикселей. ResizeObserver узнает об этом только
    // со следующей раскладкой, а кадр пойдёт сейчас — и пошёл бы со старым буфером.
    this.resize();
    this.beat.restart();
  }

  /** Размеры холста и окна одной строкой — для журнала. */
  private sizeLine(): string {
    return sizeNote(
      { w: this.canvas.clientWidth, h: this.canvas.clientHeight },
      { w: this.canvas.width, h: this.canvas.height },
      { w: window.innerWidth, h: window.innerHeight },
    );
  }

  /**
   * Показания приборов. Их читает служебный экран (`src/scenelog.ts`), и они же
   * — единственный источник ответа «что со сценой»: своей копии состояния у
   * прибора нет, а про потерю контекста спрашивается сам драйвер, а не наша
   * память о событии.
   */
  vitals(): Vitals {
    return {
      now: performance.now(),
      frames: this.drawn,
      lastFrame: this.lastFrame,
      lost: this.lostNow(),
      blocks: this.disposed ? ['gone'] : this.beat.stopped(),
      css: { w: this.canvas.clientWidth, h: this.canvas.clientHeight },
      buffer: { w: this.canvas.width, h: this.canvas.height },
    };
  }

  /** Живой ответ драйвера, а не флаг: контекст мог вернуться сам. */
  private lostNow(): boolean {
    try {
      return this.renderer.getContext().isContextLost();
    } catch {
      return false;
    }
  }

  /**
   * Часы стояли вместе с цепочкой: съедаем накопленную дельту, иначе первый кадр
   * после карты или после сна прыгнет на всё это время разом.
   */
  private rewind(): void {
    this.clock.getDelta();
    this.gameTimeAt = performance.now();
  }

  private dpr(): number {
    return this.pixelRatio ?? THREE.MathUtils.clamp(window.devicePixelRatio || 1, 1, 2);
  }

  /**
   * Пересчитать буфер под нынешний холст.
   *
   * Нулевой размер молча пропустить нельзя — а раньше именно это и делалось.
   * Вебвью, вернувшийся из фона, отдаёт нулевую раскладку на один-два кадра;
   * единственный пересчёт, пришедшийся на этот миг, уходил впустую, и буфер
   * навсегда оставался прежним. Поэтому пропуск запоминается, и первый же кадр
   * пробует снова.
   */
  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w < 1 || h < 1) {
      if (!this.needSize) sceneLog.mark('zero', this.sizeLine());
      this.needSize = true;
      return;
    }
    this.needSize = false;
    const dpr = this.dpr();
    if (this.sized.w !== w || this.sized.h !== h || this.sized.dpr !== dpr) {
      sceneLog.mark('size', `${w}×${h} @${dpr.toFixed(2)}`);
      this.sized = { w, h, dpr };
    }
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyFraming(w / h);
  }

  /**
   * Не отстал ли буфер от холста. Спрашивается раз в секунду, а не каждый кадр:
   * `clientWidth` — чтение раскладки, и шестьдесят таких чтений в секунду на
   * телефоне не бесплатны.
   *
   * ResizeObserver сюда не годится: он следит за элементом, а плотность пикселей
   * меняется мимо него — на повороте, при переносе окна на другой экран и при
   * возвращении вебвью из фона. Буфер при этом остаётся прежним, и картинка либо
   * мылится, либо не появляется вовсе.
   */
  private checkSize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w < 1 || h < 1) {
      this.needSize = true;
      return;
    }
    if (w === this.sized.w && h === this.sized.h && this.dpr() === this.sized.dpr) return;
    this.resize();
  }

  /**
   * Кадрирование от аспекта — числа считает `camera.framing`, здесь только
   * раскладка по three.js. Туман и коробка теней сжимаются вместе с дистанцией:
   * дальняя геометрия не рисуется.
   */
  private applyFraming(aspect: number): void {
    const f = framing(aspect);
    const zoom = zoomRange(f);

    this.camera.fov = f.fov;

    this.controls.minDistance = zoom.min;
    this.controls.maxDistance = zoom.max;
    this.controls.maxPolarAngle = Math.max(1.05, f.polar + 0.32);

    const fog = this.scene.fog as THREE.Fog;
    fog.near = f.fogNear;
    fog.far = f.fogFar;
    this.camera.far = fog.far + 10;
    this.camera.updateProjectionMatrix();

    // Коробка теней накрывает посёлок целиком: она привязана к стене, как и кадр.
    // Тень накрывает и дворы за стеной: окружение теней не отбрасывает, а они — да.
    fitShadow(this.rig, OUTSKIRTS_RADIUS + 1);

    if (this.userMoved) return;
    // Цель чуть выше земли: деревня уходит из-под верхнего HUD.
    this.controls.target.set(0, f.targetY, 0);
    this.camera.position.setFromSpherical(new THREE.Spherical(f.dist, f.polar, this.azimuth)).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
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

  /**
   * Останавливает рендер-луп, не трогая сцену. Карта мира и диорама не рисуются
   * одновременно, но переход между ними обязан быть мгновенным: здания, жители и
   * текстуры остаются на месте, гаснет только отрисовка.
   *
   * Выгружать диораму на время карты **пробовали и откатили**: разменять
   * три мегабайта памяти на четверть секунды на каждом возврате домой оказалось
   * невыгодно. Числа — в docs/loading.md, часть 2. Не заводить заново.
   */
  pause(): void {
    if (this.disposed) return;
    this.beat.block('map', true);
  }

  resume(): void {
    if (this.disposed) return;
    // Скрытая страница снимет свою причину сама, когда вернётся: снятая здесь,
    // она завела бы цепочку кадров в фоне — то есть не завела бы вовсе.
    this.beat.block('map', false);
  }

  /**
   * Освобождает всё. Не «останавливает», как `pause`, а именно освобождает:
   * после этого объект мёртв, и возврат в посёлок собирает диораму заново.
   *
   * Порядок важен, и вот что здесь делается на самом деле.
   *
   * 1. **Геометрия.** Своя у каждой сцены целиком — общих геометрий в модулях
   *    рендера нет ни одной (набор деталей отдаёт новую на каждый вызов, пул
   *    фигур строит свои в конструкторе). Поэтому обход всего графа безопасен.
   * 2. **Материалы спрайтов.** Маркеры внимания создают `SpriteMaterial` на
   *    каждый маркер, а текстура под ним общая и кэшируется по виду тревоги.
   *    Материал — наш, его убираем; текстуру не трогаем, она переживёт сцену.
   *    Остальные материалы модульные (`KIT`, `LEGACY`, `DECAL`), и трогать их
   *    нельзя: следующая сцена возьмёт те же и получит мёртвые.
   * 3. **Слушатели.** `OrbitControls.dispose()` снимает свой слушатель клавиатуры
   *    с `domElement.getRootNode()` — то есть с документа, пока канва в нём. Если
   *    выгружать сцену после того, как React убрал канву из разметки, корнем
   *    окажется сама оторванная канва, слушатель останется на документе, и через
   *    него документ будет держать всю сцену: замеряно снимком кучи — четыре
   *    круга на карту и обратно оставляли четыре живые диорамы. Поэтому
   *    `GameCanvas` выгружает сцену в `useLayoutEffect`: его уборка идёт **до**
   *    того, как узел уйдёт из разметки. Свои подписки на контролы мы всё равно
   *    снимаем сами — на случай, если порядок когда-нибудь изменится.
   *
   *    Утечка была и до разделения сцен, и осталась бы после отката: диорама
   *    выгружается при уходе с экрана игры, и без этой правки каждый такой уход
   *    оставлял бы в памяти целую сцену. Правка поэтому не про разделение и
   *    откату не подлежит.
   * 4. **Контекст WebGL.** `dispose` возвращает программы, но сам контекст
   *    остаётся жив до сборки мусора — а браузер держит их не больше десятка на
   *    вкладку и роняет самый старый молча. `forceContextLoss` отдаёт его сразу,
   *    и это единственный способ сказать драйверу «мне больше не надо».
   */
  dispose(): void {
    this.disposed = true;
    if (active === this) active = null;
    this.beat.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    // Свои подписки снимаем сами: OrbitControls живёт дольше сцены (см. ниже),
    // и через них он утащил бы её за собой.
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.removeEventListener('change', this.leash);
    this.controls.dispose();

    this.scene.traverse((o) => {
      const sprite = o as THREE.Sprite;
      if (sprite.isSprite && sprite.material) sprite.material.dispose();
    });
    disposeGeometries(this.scene);
    this.silhouetteMat.dispose();
    this.scene.clear();

    // Ссылки на подсистемы рвутся, чтобы граф не держался за них через сцену.
    this.buildings.clear();
    this.agents.clear();
    this.caravans.clear();
    this.soldiers = [];
    this.hero = null;
    this.village = null;
    this.flame = null;
    this.flameInner = null;

    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      // Старый драйвер может не отдать контекст — тогда его заберёт сборщик.
    }
  }

  /**
   * Что сцена держит в памяти сейчас. Цифры рендерера, а не догадка: по ним и
   * меряется размен «выгружаем диораму — платим сборкой» (docs/loading.md).
   */
  memory(): { geometries: number; textures: number; programs: number; bytes: number } {
    const info = this.renderer.info;
    // Счётчики рендерера — штуки, а вопрос про байты. Считаем сами: буфер
    // вершин ровно столько и весит, и в видеопамяти, и в куче.
    let bytes = 0;
    const seen = new Set<THREE.BufferGeometry>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const geo = mesh.geometry;
      if (!geo || seen.has(geo)) return;
      seen.add(geo);
      for (const attr of Object.values(geo.attributes)) {
        bytes += (attr as THREE.BufferAttribute).array.byteLength;
      }
      if (geo.index) bytes += geo.index.array.byteLength;
      const inst = mesh as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        bytes += inst.instanceMatrix.array.byteLength;
        if (inst.instanceColor) bytes += inst.instanceColor.array.byteLength;
      }
    });
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      bytes,
    };
  }

  // ---------- Выбор здания ----------

  /**
   * Привязка к деревне. OrbitControls умеет держать дистанцию и угол, но не
   * цель, — а без неё панорама одним пальцем уводит в пустой лес за окрестности.
   * Цель возвращается на поводок, камера едет за ней тем же вектором: иначе
   * ракурс дёргался бы у самой границы.
   */
  private leash = (): void => {
    const t = this.controls.target;
    const fixed = clampPan(t.x, t.z);
    if (fixed.x === t.x && fixed.z === t.z) return;
    this.camera.position.x += fixed.x - t.x;
    this.camera.position.z += fixed.z - t.z;
    t.x = fixed.x;
    t.z = fixed.z;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.touch.down(e.pointerId, e.clientX, e.clientY, performance.now());
    // Цель выбирается здесь, а не на отпускании, и это не мелочь: за время
    // касания палец успевает сдвинуть камеру панорамой, а сообщённая системой
    // точка на отпускании прыгает — игрок же целился в момент нажатия.
    //
    // Второй палец прицел не двигает: это щипок, и тапа в нём уже нет — но
    // перебивать им то, во что целился первый, всё равно незачем.
    if (!this.touch.multi) this.aimed = this.pickAt(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.touch.move(e.pointerId, e.clientX, e.clientY, performance.now());
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.touch.cancel(e.pointerId);
  };

  private onPointerUp = (e: PointerEvent): void => {
    // Ведение камеры не должно открывать панели, а щипок — тем более: судит это
    // общий с картой разбор жеста (`Gesture`), второй правды о том, тап это или
    // ведение, в игре быть не должно.
    if (!this.touch.up(e.pointerId, performance.now())) return;
    this.onPick?.(this.aimed);
  };

  /**
   * Здание под пальцем.
   *
   * Меряется не расстояние до точки, а попадание в **область**: у каждого здания
   * своя коробка на экране, накрывающая силуэт целиком, и не меньше пальца
   * (`TAP_TARGET`). Прежний выбор шёл по ближайшему якорю у подножия модели, и
   * на кольцевой планировке это давало ячейку ±15–24 px на здание при силуэте в
   * 18–39 px — вдвое меньше отпечатка, который эту ячейку ещё и закрывает.
   *
   * Промах прощается: не попал никуда, но рядом дом — открывается дом
   * (`TAP_FORGIVE`), при нескольких рядом — ближайший. Тап в чистое поле не
   * открывает ничего.
   *
   * Стена спрашивается последней и по-своему: коробки у кольца вокруг посёлка
   * быть не может, она накрыла бы весь посёлок (см. `pick.onRing`).
   */
  private pickAt(clientX: number, clientY: number): number | null {
    const boxes: HitBox[] = [];
    for (const id of this.buildings.keys()) {
      const box = this.hitBoxOf(id);
      if (box) boxes.push(box);
    }
    const hit = pickBox(boxes, clientX, clientY);
    if (hit !== null) return hit;
    return this.pickWall(clientX, clientY);
  }

  /** Тап по кладке: точка касания опускается на землю и меряется до кольца стены. */
  private pickWall(clientX: number, clientY: number): number | null {
    let wall: number | null = null;
    for (const [id, view] of this.buildings) if (view.type === 'palisade') wall = id;
    if (wall === null) return null;
    const ndc = this.toNdc(clientX, clientY);
    if (!ndc) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const at = ray.ray.intersectPlane(GROUND, new THREE.Vector3());
    if (!at) return null;
    return onRing(at.x, at.z, WALL_RADIUS, WALL_BAND) ? wall : null;
  }

  private toNdc(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((clientY - rect.top) / rect.height) * 2 - 1),
    };
  }

  /**
   * Область попадания здания: восемь углов его силуэта, спроецированные на экран,
   * и описанный вокруг них прямоугольник — не меньше пальца. Силуэт снят с самой
   * модели, поэтому тонкая геометрия ранних ступеней тапу не мешает, а высокая
   * постройка ловит палец и по крыше.
   */
  private hitBoxOf(id: number): HitBox | null {
    const view = this.buildings.get(id);
    // Стена — кольцо вокруг всего посёлка, прямоугольника у неё не бывает.
    if (!view || view.type === 'palisade') return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    view.group.updateWorldMatrix(true, false);
    return projectHitBox(id, view.box, view.group.matrixWorld, this.camera, rect);
  }

  /**
   * Где здание на экране: центр в пикселях страницы и радиус, накрывающий его модель.
   * Считается от текущей камеры, поэтому подсветка обучения не отстаёт при
   * движении. Источник тот же, что у тапа: «дырка» в затемнении обязана стоять
   * ровно там, куда попадёт палец. null — здания нет или оно за спиной камеры.
   */
  screenSpot(id: number): { x: number; y: number; r: number } | null {
    const box = this.hitBoxOf(id) ?? this.wallSpot(id);
    if (!box) return null;
    return { x: box.x, y: box.y, r: Math.max(TAP_TARGET / 2, Math.max(box.hw, box.hh)) };
  }

  /** Подсветка стены: кольцо целиком, иначе обучению нечего показать. */
  private wallSpot(id: number): HitBox | null {
    const view = this.buildings.get(id);
    if (!view || view.type !== 'palisade') return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      v.set(Math.cos(a) * WALL_RADIUS, 1.4, Math.sin(a) * WALL_RADIUS).project(this.camera);
      if (v.z > 1) continue;
      const x = ((v.x + 1) / 2) * rect.width + rect.left;
      const y = ((1 - v.y) / 2) * rect.height + rect.top;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (minX > maxX) return null;
    return hitBox(id, minX, minY, maxX, maxY);
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
        // Силуэт снимается до расстановки: коробка нужна в собственных
        // координатах группы, а место и поворот придут её матрицей.
        const box = silhouetteBox(group);
        // Место берётся из плана: у каждого типа оно своё и не меняется никогда.
        const spot = placeOf(b.type);
        group.position.set(spot.x, 0, spot.z);
        group.rotation.y = spot.rot;
        this.scene.add(group);
        view = {
          group,
          tier,
          type: b.type,
          box,
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


  /**
   * Один кадр вне цикла. Нужен стенду: в скрытой вкладке requestAnimationFrame
   * не идёт, а снимок всё равно должен быть с устоявшимися тенями и палитрой.
   */
  renderOnce(): void {
    if (this.disposed) return;
    this.frame();
  }

  private frame(): void {
    // Считается кадр лупа, а не кадр диорамы: одолженная ролику канва рисуется
    // им, и «кадры идут» тут значит именно то, что цепочка жива.
    this.drawn++;
    this.lastFrame = performance.now();
    // Отложенный пересчёт — первым же кадром: холст мог вернуться из фона
    // нулевым, и тогда его размер надо взять при первой возможности.
    if (this.needSize || this.drawn % 60 === 0) this.checkSize();
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
      if (view.marker) view.marker.visible = !on;
    }
  }
}
