// 3D-диорама поселения. Получает состояние через sync(), анимирует сам.
import * as THREE from 'three';
import type { Building, BuildingTypeId, Caravan, GameState, Season, TroopId } from '@/game/types';
import {
  buildingAttention,
  caravanProgress,
  dayFraction,
  handsCount,
  isSite,
  seasonOf,
  solarPhase,
  storageCap,
  workerCount,
  type Attention,
} from '@/game/derived';
import { TROOP_IDS } from '@/game/data/troops';
import { RESOURCE_IDS } from '@/game/constants';
import { gameSeconds } from '@/game/pace';
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
import { HeroAgent, heroKind, heroShown } from './hero';
import { FigurePool } from './figures';
import { CaravanAgent } from './caravan';
import { SeasonVisuals } from './season';
import { CHIMNEY_LOOK, HEARTH_LOOK, Smoke, Snowfall, chimneySmoke, hearthSmoke, type SmokeSource } from './weather';
import { SMOKE_HEIGHT, WORK_SIGN, WorkSigns, type LoadKind } from './worksigns';
import {
  RIG,
  SHADOW_MAP,
  applyDayNight,
  configureRenderer,
  configureSky,
  createLightRig,
  fireGlow,
  windowNight,
  fireIntensity,
  fitShadow,
  type DayLight,
  type LightRig,
  type Look,
} from './lighting';
import { PALETTE } from './palette';
import { DECAL } from './materials';
import { disposeGeometries } from './kit';
import { Gesture, Press, TAP_TARGET, WHEEL_STEP, swallowGhostClick } from '@/gestures';
import { hitBox, onRing, pickBox, projectHitBox, silhouetteBox, type HitBox } from './pick';
import { AZIMUTH, PAN_STEP_MAX, clampPan, framing, zoomRange } from './camera';
import { FrameLoop, deviceRatio, pageHidden, pixelRatio } from './loop';
import { BUILD_SLICE_MS, QUALITIES, QUALITY, VILLAGE_STEADY, autoQuality, qualityDpr, type DeviceCaps, type Quality } from './quality';
import { autoCap, capQuality, rememberAutoCap } from './gfx';
import { Steady } from './steady';
import { WINDOW_NIGHT, dropGlow } from './glow';
import { serverNow } from '@/net/clock';
import type { EnvWorld, StartEnv } from './env';
import type * as EnvModule from './env';
import { sceneLog, sizeNote, type Block, type Vitals } from '@/scenelog';
import { gestLog, type End } from '@/gestlog';

export interface BuildingView {
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
 * Сколько жителей видно разом — `MAX_VILLAGERS` (villagers.ts). Больше фигурок у
 * костра — уже толпа, в которой не сосчитать свободные руки, а весь смысл площади
 * в том, чтобы их было видно счётом. Остальные свободные просто не показываются.
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
 * Сколько ждём возвращения контекста WebGL, прежде чем пересобирать сцену.
 *
 * Браузер возвращает контекст сам — но только если ему не помешали (см.
 * `onContextLost`), и не мгновенно: на Android между потерей и возвращением
 * проходит от десятков миллисекунд до секунды с лишним, пока система отдаёт
 * обратно графическую память. Три секунды заведомо больше этого и заведомо
 * меньше того, что игрок готов смотреть на чёрный прямоугольник.
 *
 * Ждать бесконечно нельзя: вебвью, у которого забрали поверхность совсем,
 * события возвращения не пришлёт никогда, и без срока диорама не вернулась бы
 * до перезахода — то есть ровно то, на что жалоба.
 */
export const RESTORE_WAIT = 3000;

/**
 * Сколько ждать готовности программ шейдеров окружения (`waitPrograms`), мс. С параллельной
 * сборкой браузер доготавливает их за доли секунды; без неё `compile` уже собрал их
 * по одной — ждать нечего. Срок — чтобы мир встал, даже если браузер медлит.
 */
const ENV_COMPILE_WAIT = 2000;

let active: TribeScene | null = null;
export const activeScene = (): TribeScene | null => active;

/**
 * Сцены других видов — своими ленивыми кусками: вид «город» (docs/city.md) кладёт сюда свой класс,
 * когда его кусок приехал (`main.tsx` везёт его до игры). Нет класса — посёлок.
 */
export const SCENES: Partial<Record<Look, typeof TribeScene>> = {};

/**
 * Вид и уровень качества сцены. Игра передаёт выбор игрока (`gfx.sceneGfx`: по умолчанию —
 * `next`, «Простой вид» — `now`), стенд — адрес (`?showcase=village&look=next&quality=low`);
 * без вида сцена рисует прежний. Уровень качества действует только на вид `next`: у
 * прежнего кадра свои числа, и новый вид их не трогает.
 */
export interface SceneLook {
  look?: Look;
  /**
   * `null` — по устройству (`quality.autoQuality`), но не выше того, до чего сторож
   * плавности опустил уровень на этом устройстве за неделю (`gfx.autoCap`); тогда же
   * сторож и следит. Заданный уровень (стенд, выбор игрока) сторож не трогает.
   */
  quality?: Quality | null;
}

/**
 * Что умеет устройство — единственное место, где сцена спрашивает об этом браузер.
 * Под заглушкой GL (`tap:report`) имени видеокарты нет, и это не ошибка: `gpu` — `null`.
 */
function readCaps(gl: WebGLRenderingContext | WebGL2RenderingContext): DeviceCaps {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as { deviceMemory?: number; hardwareConcurrency?: number };
  let gpu: string | null = null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    gpu = typeof name === 'string' ? name : null;
  } catch {
    gpu = null;
  }
  return {
    coarse: typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    gpu,
  };
}

export class TribeScene {
  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera: THREE.PerspectiveCamera;
  protected rig: LightRig;
  protected fireLight: THREE.PointLight;
  /** Ландшафт с окружением — одной группой, чтобы силуэтный режим мог его погасить. */
  protected terrain: THREE.Group;
  /** Силуэтный режим стенда: всё чёрным на белом, только постройки. */
  protected silhouette = false;
  private silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  protected buildings = new Map<number, BuildingView>();
  private agents = new Map<number, VillagerAgent>();
  private nextAgentId = 1;
  private soldiers: SoldierAgent[] = [];
  /** Герой у своей статуи. null — он в походе или лежит после боя. */
  private hero: HeroAgent | null = null;
  /** Род, под который одет герой сейчас: сменился — фигурку пересобираем. */
  private heroKey: string | null = null;
  /** Все фигурки — жители и бойцы — одним пулом инстансов: число вызовов от числа фигур не зависит (figures.ts). */
  protected figures = new FigurePool();
  /** Караваны рынка: телега на дороге у ворот, пока покупка в пути. */
  private caravans = new Map<number, { agent: CaravanAgent; departAt: number; arriveAt: number }>();
  /** Обстановка посёлка: площадь, дороги, размеченные площадки и декор. */
  private village: THREE.Group | null = null;
  /** Слепок того, из чего собрана обстановка: пересобираем только при изменениях. */
  private villageKey = '';
  /** Слепок армии — по нему пересобираются фигурки бойцов. */
  private armyKey = '';
  protected clock = new THREE.Clock();
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
  protected drawn = 0;
  protected lastFrame = 0;
  /** Размер и плотность, с которыми настроен буфер. По ним видно, что он отстал. */
  private sized = { w: 0, h: 0, dpr: 0 };
  /** Пересчёт отложен: холста в этот момент не было или он был нулевой. */
  protected needSize = false;
  /**
   * Контекст потерян и не вернулся в срок — сцену пора собирать заново. Делает
   * это владелец канвы (`ui/GameCanvas`), а не сцена: пересборка означает новый
   * элемент канвы, а сцена своим элементом не распоряжается.
   */
  onLost: (() => void) | null = null;
  private restoreTimer = 0;
  protected frameNo = 0;
  /** Было ли уже состояние: по первому sync сезон ставится без перелива. */
  protected synced = false;
  protected gameTime = 0;
  protected gameTimeAt = 0;
  private flame: THREE.Object3D | null = null;
  private flameInner: THREE.Object3D | null = null;
  protected seasonVis = new SeasonVisuals();
  protected snowfall = new Snowfall();
  protected smoke = new Smoke();
  /** Дым труб — своя система: он гуще очажного, иначе признак работы не виден. */
  protected chimneys = new Smoke(CHIMNEY_LOOK, []);
  /**
   * Дым очагов над трубами домов — только у вида `next` (`weather.HEARTH_LOOK`): живой
   * посёлок. Своя система точек (один вызов), чтобы не спутать его с дымом работы.
   */
  private hearths = new Smoke(HEARTH_LOOK, []);
  /** Признаки занятости зданий: грузы у стен. Один вызов отрисовки на все. */
  protected signs = new WorkSigns();
  protected season: Season = 'spring';
  protected disposed = false;
  /** Канва и рендерер отданы ролику о бое: диорама молчит, пока их не вернут. */
  protected lent = false;
  protected selection: THREE.Mesh;
  protected selected: number | null = null;
  /**
   * Разбор жеста — общий с картой мира (`src/gestures.ts`). Он же и командует
   * камерой: пока `panning` говорит «нет», картинка не двигается ни на пиксель.
   * Жестов ровно два, и оба те же, что на карте: одним пальцем камера **водит**,
   * двумя — приближает. Поворота нет никакого (см. `camera.ts`).
   */
  private touch = new Gesture();
  /** Пальцы на холсте: положение каждого. Из них и складывается щипок. */
  private pointers = new Map<number, { x: number; y: number }>();
  /**
   * Прошлый шаг щипка: расстояние между пальцами и середина между ними.
   *
   * Середина вернулась, но за другим делом. Раньше её сдвиг **поворачивал**
   * сцену — с этим и покончено; теперь за ней, как на карте, едет земля, а
   * приближение идёт к ней же. Правило у обоих холстов одно: щиплют туда, куда
   * смотрят.
   */
  private pinch: { dist: number; mx: number; my: number } | null = null;
  /** Где была середина посёлка на экране в начале касания — для журнала касаний. */
  private driftFrom: { x: number; y: number } | null = null;
  /** Сколько пальцев побывало на холсте за этот жест. Тоже журналу. */
  private maxFingers = 0;
  /** Здание под пальцем в момент нажатия — на отпускании оно и открывается. */
  private aimed: number | null = null;
  /** Тап по зданию (или по пустому месту — тогда null). Ставит UI. */
  onPick: ((id: number | null) => void) | null = null;
  /** Вызывается сразу после render() — стенд снимает кадр, пока буфер ещё не очищен. */
  afterRender: (() => void) | null = null;
  /**
   * Камера деревни целиком: куда смотрит, под каким наклоном и с какого
   * расстояния. Азимута среди этих чисел нет — он один на всю игру (`AZIMUTH`),
   * потому что поворота нет ни одним жестом.
   *
   * Держать их здесь, а не вычитывать обратно из позиции камеры, — то же
   * правило, что и везде: одно число живёт в одном месте. Позиция считается из
   * них (`place`), и обратного хода нет.
   */
  protected target = new THREE.Vector3(0, 0.4, 0);
  /** Наклон камеры: ставит кадрирование от аспекта, жест его не трогает. */
  protected polar = 0.95;
  /** Расстояние до цели — единственное, что меняет щипок. */
  protected dist = 20;
  /** Пол и потолок приближения, из `zoomRange`. */
  protected zoom = { min: 7, max: 26 };
  /** Шаг панорамы, который ещё движение пальца, а не вырождение у горизонта (`camera.PAN_STEP_MAX`). */
  protected stepMax = PAN_STEP_MAX;
  /**
   * Автоповорот стенда: единственное место в игре, где камера вообще
   * поворачивается. Им меряют частоту кадров на телефоне (`?showcase=village&perf=8`),
   * и в жест он не превращается ничем — ни кнопкой, ни настройкой.
   */
  protected spinRate = 0;
  protected spinTurn = 0;
  /** После ручного движения камеру больше не переставляем. */
  protected userMoved = false;
  /** Вид: нынешний или проба окружения (`lighting.Look`). */
  protected look: Look;
  /** Уровень качества пробы; у нынешнего вида не читается. */
  readonly quality: Quality;
  /**
   * Уровень, чью плотность пикселей берёт буфер. Сначала — `quality`; сторож плавности,
   * опустив уровень, опускает плотность сразу (главная ручка цены кадра на телефоне), а
   * траву и тени — со следующего захода (`gfx.rememberAutoCap`).
   */
  protected dprLevel: Quality;
  /** Сторож плавности посёлка (`render/steady`) — только у вида `next` с уровнем по устройству. */
  protected steady: Steady<Quality> | null = null;
  /**
   * Окружение пробы: земля, трава, лес, мелочь (`render/env`). Едет своим куском после
   * первого кадра — в первую загрузку не входит; до его прихода стоит прежняя земля.
   */
  private env: EnvWorld | null = null;
  /**
   * Окружение, которое ещё собирается — кусками между кадрами (`env/index.startEnv`), —
   * и обещание стенду, что оно встанет. В кадре до его конца стоит прежняя земля.
   */
  private envJob: { world: EnvWorld; mounted: () => void } | null = null;
  /** Собранное окружение, которое ждёт программ шейдеров: смена построек идёт и ему. */
  private envMounting: EnvWorld | null = null;
  /**
   * Фактура построек вида `next` (`env/facade.ts`) — едет куском окружения. До его прихода здания
   * стоят прежним телом; пришёл — одеваются все (`envArrived`), новые — сразу.
   */
  private facade: Pick<typeof EnvModule, 'dressFacade' | 'FACADE_SNOW'> | null = null;
  /** Люди и звери вида `next` (`env/folk.ts`): покрои и позы у огня, собака, куры. Едут тем же куском. */
  private life: EnvModule.VillageLife | null = null;
  /** Что насчитал свет последнего кадра: доля дня и ночи. */
  protected light: DayLight = { daylight: 1, nightK: 0, dusk: 0 };
  /** Посёлок, под который лежит земля окружения: заново — только при смене построек. */
  private envVillage: { present: BuildingTypeId[]; built: { type: BuildingTypeId; tier: Tier }[] } | null = null;
  /**
   * Сцена готова к снимку: у вида `now` — сразу, у `next` — когда приехало и встало
   * окружение. Стенд ждёт этого, прежде чем снимать.
   */
  readonly ready: Promise<void>;
  /** Зовётся прямо перед render() — стенд меряет им время видеокарты на кадр. */
  beforeRender: (() => void) | null = null;

  /**
   * pixelRatio — принудительная плотность пикселей (стенд); по умолчанию — экрана,
   * в [1, 2]. Выше потолка двери кадра (`loop.DPR_CAP`) не бывает ни та, ни другая.
   */
  constructor(protected canvas: HTMLCanvasElement, protected pixelRatio: number | null = null, opts: SceneLook = {}) {
    this.look = opts.look ?? 'now';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Нынешний вид уровня не читает, и устройство у игрока о нём не спрашивается.
    this.quality =
      opts.quality ??
      (this.look !== 'now' ? capQuality(autoQuality(readCaps(this.renderer.getContext())), autoCap(serverNow())) : 'medium');
    this.dprLevel = this.quality;
    if (this.look !== 'now' && !opts.quality) this.steady = new Steady(QUALITIES, this.quality, VILLAGE_STEADY);
    // На 3x-экранах третий пиксель не виден, а филлрейт растёт вдвое — отсюда потолок.
    this.renderer.setPixelRatio(this.dpr());
    configureRenderer(this.renderer);
    // Жёсткая тень на низком уровне: одна выборка карты вместо девяти (0 — BasicShadowMap;
    // числом, а не именем three: имя дописалось бы в первую загрузку).
    if (this.look !== 'now' && !QUALITY[this.quality].shadowSoft) this.renderer.shadowMap.type = 0;
    configureSky(this.scene);
    // Честный счёт вызовов: при autoReset счётчик сбрасывается после теневого
    // прохода, и stats() занижал бы бюджет вдвое. Сбрасываем сами перед кадром.
    this.renderer.info.autoReset = false;
    // Теневой проход через кадр: двигаются только фигурки, отставание тени на кадр не видно.
    this.renderer.shadowMap.autoUpdate = false;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.camera.position.set(9, 10, 12);

    /*
     * КАМЕРОЙ ПРАВИТ ТОЛЬКО СЦЕНА, И ВТОРОГО СУДЬИ У НЕЁ НЕТ.
     *
     * Здесь стоял `OrbitControls` с отобранным вводом: он брал `pointerdown`
     * себе и начинал панораму с первого же пикселя, ничего не зная о том, тап
     * это или ведение, — отсюда были обе жалобы разом (деревня уезжала под
     * пальцем при прицеливании, и панорама отставала от пальца на треть).
     * Ввод у него отобрали, и от него остались зажим дистанции с наклоном да
     * автоповорот стенда. С уходом поворота зажимать наклон стало нечего:
     * азимут один на игру, полярный угол ставит кадрирование, а дистанцию
     * держит щипок по `zoomRange`. Класс убран целиком — держать его ради двух
     * строк значило бы оставить в камере рычаг, которого никто не дёргает.
     *
     * Панораму и наезд ведёт сцена от общего с картой разбора жеста
     * (`src/gestures.ts`), позицию камеры считает `place()`.
     */
    // Прокрутку страницы под холстом гасим сами: полагаться теперь не на кого.
    canvas.style.touchAction = 'none';

    this.rig = createLightRig(this.scene, this.look === 'next' ? QUALITY[this.quality].shadowMap : SHADOW_MAP);

    this.fireLight = new THREE.PointLight(PALETTE.fireLight, 0.6, 14, 1.6);
    this.fireLight.position.set(0, 1.0, 0);
    this.scene.add(this.fireLight);

    this.terrain = buildTerrain();
    this.scene.add(this.terrain);
    // Окружение пробы едет своим куском: в первую загрузку игры оно не входит, а до его
    // прихода сцена стоит на прежней земле — первый кадр не ждёт ничего.
    this.ready =
      this.look === 'next'
        ? import('./env').then((m) => {
            this.envArrived(m);
            return this.startEnv(m.startEnv);
          })
        : Promise.resolve();
    this.scene.add(this.figures.group);
    this.scene.add(this.snowfall.points);
    this.scene.add(this.smoke.points);
    this.scene.add(this.chimneys.points);
    if (this.look === 'next') this.scene.add(this.hearths.points);
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

    // Потеря контекста — не исключительный случай, а обычное дело на телефоне:
    // система забирает графическую память у фонового вебвью и отдаёт обратно.
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    // Колесо мыши. Его обрабатывал `OrbitControls`, и вместе с ним оно и
    // пропало: щипок мы написали, а колесо — нет, и на ПК деревня перестала
    // приближаться вовсе. Пассивный слушатель — как у карты: страницу под
    // холстом никто не прокручивает, а `preventDefault` React на своём колесе
    // всё равно не даёт.
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);

    this.resize();
    // Кадры не идут в скрытой странице — не «идут редко», а не идут вовсе. Значит
    // и завести цепочку на скрытой странице нельзя: заявка повиснет до возвращения.
    // Видимость restart спрашивает у двери кадра сам (`render/loop.ts`).
    document.addEventListener('visibilitychange', this.onVisibility);
    this.beat.restart();
    active = this;
  }

  /**
   * Страница скрылась или вернулась.
   *
   * Остановить цепочку здесь нечего: скрытая страница и свёрнутая в Телеграме
   * аппка останавливают кадры у всех цепочек разом, в двери кадра
   * (`render/loop.ts`). Сцене остаётся своё — запись в журнал и побудка с
   * пересчётом холста. Оболочка зовёт `wake` теми событиями, которых сцене не
   * видно (`pageshow`, `resume`).
   */
  private onVisibility = (): void => {
    const hidden = pageHidden();
    sceneLog.mark(hidden ? 'hide' : 'show', this.sizeLine());
    if (!hidden) this.wake();
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
   * Скрыта ли страница, `restart` спрашивает у двери кадра сам, а не у памяти о
   * событии: событие возврата могло и не прийти.
   */
  wake(): void {
    if (this.disposed) return;
    // Вьюпорт мог поменяться, пока нас не было: поворот в фоне, вырезы, шапка
    // клиента, другая плотность пикселей. ResizeObserver узнает об этом только
    // со следующей раскладкой, а кадр пойдёт сейчас — и пошёл бы со старым буфером.
    this.resize();
    // Про потерю контекста спрашивается сам драйвер, а не наша память о событии:
    // потерянный в фоне контекст мог не прислать события вовсе, а вернувшийся —
    // не прислать второго. Кадры в мёртвый контекст рисовать незачем.
    const lost = this.lostNow();
    this.beat.block('lost', lost);
    if (lost) {
      this.askRestore();
      return;
    }
    this.beat.restart();
  }

  /**
   * Контекст WebGL потерян.
   *
   * `preventDefault` здесь — не вежливость, а условие: без него браузер даже не
   * пытается вернуть контекст, и `webglcontextrestored` не придёт никогда.
   * three делает это и сам, но правило записано здесь, а порядок чужих
   * обработчиков нам не подвластен, и второй раз отменить умолчание ничего не
   * стоит.
   */
  private onContextLost = (e: Event): void => {
    e.preventDefault();
    sceneLog.mark('lost', this.sizeLine());
    this.beat.block('lost', true);
    this.askRestore();
  };

  /**
   * Контекст вернулся. three заново поднимает состояние GL и заливает буферы по
   * первому требованию, но размер холста ему никто не назначал — назначаем.
   */
  private onContextRestored = (): void => {
    this.clearWait();
    sceneLog.mark('restored', this.sizeLine());
    this.beat.block('lost', false);
    this.sized = { w: 0, h: 0, dpr: 0 };
    this.resize();
    this.beat.restart();
  };

  /**
   * Попросить браузер вернуть контекст и завести срок ожидания.
   *
   * Просьба уходит следующим тактом, а не прямо здесь: `askRestore` зовётся из
   * обработчика самой потери, а браузер в разгар рассылки этого события просьбу
   * о возвращении не принимает.
   */
  private askRestore(): void {
    this.clearWait();
    setTimeout(() => {
      if (this.disposed || !this.lostNow()) return;
      try {
        this.renderer.forceContextRestore();
        sceneLog.mark('ask', 'просим вернуть контекст');
      } catch {
        // Настоящую потерю так не отменить: расширение умеет вернуть только ту,
        // которую само и устроило. Тогда остаётся ждать браузера и пересборки.
      }
    }, 0);
    this.restoreTimer = window.setTimeout(this.giveUp, RESTORE_WAIT);
  }

  private clearWait(): void {
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = 0;
  }

  /** Срок вышел. Контекст жив — ничего не случилось; мёртв — зовём пересборку. */
  private giveUp = (): void => {
    this.restoreTimer = 0;
    if (this.disposed || !this.lostNow()) return;
    // Скрытой странице контекст возвращать некуда: срок пойдёт заново с `wake`.
    if (pageHidden()) return;
    sceneLog.mark('watch', `контекст не вернулся за ${RESTORE_WAIT} мс`);
    this.onLost?.();
  };

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
    // Цепочка встала и пошла заново: первые кадры — не цена уровня.
    this.steady?.set(this.steady.tier);
  }

  /** Мир встал целиком: сборка кусками больше не отнимает у кадра своих миллисекунд. */
  protected settled(): boolean {
    return !!this.env && !this.envJob;
  }

  /**
   * Сторож плавности: судит кадры, только когда окружение уже стоит (сборка кусками
   * отнимает у кадра свои миллисекунды — это не цена уровня) и холст не одолжен ролику.
   * Опустил — плотность сразу, остальное — со следующего захода.
   */
  protected watch(gap: number): void {
    if (!this.steady || !this.settled()) return;
    const next = this.steady.feed(gap);
    if (!next) return;
    this.dprLevel = next;
    this.needSize = true;
    rememberAutoCap(next, serverNow());
  }

  protected dpr(): number {
    // Вид `next` берёт плотность своего уровня качества — не выше экрана (или той, что
    // задал стенд вместо экрана) и не выше потолка двери кадра.
    if (this.look !== 'now') return pixelRatio(qualityDpr(this.dprLevel, this.pixelRatio ?? deviceRatio()));
    return pixelRatio(this.pixelRatio);
  }

  /**
   * Приехал кусок окружения: одеть в фактуру здания, что уже стоят, и завести людей и зверей вида
   * `next` — жители у костра переодеваются в покрои и позы (`env/folk.ts`). Новые здания и жители
   * оденутся при появлении.
   */
  private envArrived(m: Pick<typeof EnvModule, 'dressFacade' | 'FACADE_SNOW' | 'startLife' | 'roundSmoke'>): void {
    if (this.disposed) return;
    this.facade = m;
    for (const view of this.buildings.values()) m.dressFacade(view.group);
    // Клубы дыма — круглые и мягкие: костёр, дым работы и очаги (docs/graphics_world.md, 11.6).
    for (const s of [this.smoke, this.chimneys, this.hearths]) m.roundSmoke(s.points.material as THREE.PointsMaterial);
    this.life = m.startLife({ pool: this.figures, quality: this.quality });
    for (const agent of this.agents.values()) this.life.dressFolk(agent);
  }

  /**
   * Приехал кусок окружения пробы: сборка заводится, а ведёт её кадр (`workEnv`) —
   * кусками под `BUILD_SLICE_MS`. Сцену могли выгрузить, пока кусок ехал, — тогда
   * собирать не для кого. Обещание сбывается, когда окружение встало в сцену.
   */
  private startEnv(start: StartEnv): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const world = start({
      quality: this.quality,
      season: this.seasonVis,
      village: this.envVillage,
      // Программы шейдеров — со светом, туманом и тенями этой сцены, иначе в кадре их
      // собрали бы второй раз.
      compile: (o) => void this.renderer.compile(o, this.camera, this.scene),
    });
    return new Promise((mounted) => {
      this.envJob = { world, mounted };
    });
  }

  /**
   * Кусок работы окружения в этом кадре: первая сборка или пересчёт под постройки.
   * Собрано впервые — дождаться программ шейдеров, не держа кадр (`compileAsync`
   * с `KHR_parallel_shader_compile`), и поставить мир целиком.
   */
  private workEnv(): void {
    const until = performance.now() + BUILD_SLICE_MS;
    if (this.env) this.env.work(until);
    const job = this.envJob;
    if (!job || !job.world.work(until)) return;
    this.envJob = null;
    this.envMounting = job.world;
    this.waitPrograms(job.world, () => {
      this.mountEnv(job.world);
      job.mounted();
    });
  }

  /**
   * Дождаться программ шейдеров окружения, не держа кадр. `compileAsync` three не годится:
   * при потерянном контексте его опрос не кончается никогда, а после выгрузки сцены падает
   * исключением из таймера (разбор ночи 1). Здесь опрос свой и с выходами: сцена выгружена,
   * контекст потерян или срок вышел — мир ставится как есть, программы доберёт кадр.
   */
  private waitPrograms(world: EnvWorld, done: () => void): void {
    const materials = [...this.renderer.compile(world.group, this.camera, this.scene)];
    const began = performance.now();
    const poll = (): void => {
      const over = this.disposed || this.renderer.getContext().isContextLost() || performance.now() - began > ENV_COMPILE_WAIT;
      const ready =
        over ||
        materials.every((m) => {
          const program = (this.renderer.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram;
          return !program || program.isReady();
        });
      if (ready) done();
      else setTimeout(poll, 16);
    };
    poll();
  }

  /**
   * Окружение собрано: оно встаёт на место прежней земли с лесом. Сцену могли
   * выгрузить, пока ждали программ, — тогда ставить некуда.
   */
  private mountEnv(env: EnvWorld): void {
    if (this.envMounting === env) this.envMounting = null;
    if (this.disposed) {
      env.dispose();
      return;
    }
    this.scene.remove(this.terrain);
    disposeGeometries(this.terrain);
    this.env = env;
    this.terrain = env.group;
    this.scene.add(this.terrain);
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
    // Размер окна — запасная величина только на самый первый замер, когда
    // раскладки ещё нет вовсе. Дальше ноль означает «холст не готов», и
    // подставлять вместо него окно нельзя: буфер получил бы чужой размер, счёл
    // бы дело сделанным и остался бы с ним.
    const blind = this.sized.w === 0;
    const w = this.canvas.clientWidth || (blind ? window.innerWidth : 0);
    const h = this.canvas.clientHeight || (blind ? window.innerHeight : 0);
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
  protected checkSize(): void {
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
  protected applyFraming(aspect: number): void {
    const f = framing(aspect);
    const zoom = zoomRange(f);

    this.camera.fov = f.fov;

    this.zoom = zoom;
    this.polar = f.polar;
    this.dist = Math.min(Math.max(this.dist, zoom.min), zoom.max);

    const fog = this.scene.fog as THREE.Fog;
    fog.near = f.fogNear;
    fog.far = f.fogFar;
    this.camera.far = fog.far + 10;
    this.camera.updateProjectionMatrix();

    // Коробка теней накрывает посёлок целиком: она привязана к стене, как и кадр.
    // Тень накрывает и дворы за стеной: окружение теней не отбрасывает, а они — да.
    fitShadow(this.rig, OUTSKIRTS_RADIUS + 1);

    if (this.userMoved) {
      // Игрок уже вёл камеру сам: цель и приближение его, а наклон мог смениться
      // вместе с аспектом — экран повернули или вырезало шапку.
      this.place();
      return;
    }
    // Цель чуть выше земли: деревня уходит из-под верхнего HUD.
    this.target.set(0, f.targetY, 0);
    this.dist = f.dist;
    this.place();
  }

  /**
   * Поставить камеру по своим числам: цель, наклон, расстояние и единственный
   * на игру азимут. Второго способа сдвинуть камеру в сцене нет — всё, что
   * двигает обзор, правит эти числа и зовёт `place`.
   */
  protected place(): void {
    this.camera.position
      .setFromSpherical(new THREE.Spherical(this.dist, this.polar, AZIMUTH + this.spinTurn))
      .add(this.target);
    this.camera.lookAt(this.target);
    // Матрицы обновляем здесь, а не ждём кадра. Ими считают луч под палец
    // (`groundAt`) и области попадания, и спрашивают их между кадрами — а кадра
    // может и не быть вовсе: на скрытой странице и на карте мира цепочка кадров
    // стоит. Раньше это молчаливо держалось на том, что луп идёт всегда.
    this.camera.updateMatrixWorld();
  }

  /**
   * Одалживает канву и рендерер ролику о бое. Второго контекста WebGL в игре не
   * бывает (раздел 12 документа о бое): пока одолжено, диорама кадров не рисует,
   * а свой цикл ведёт ролик. Геометрия посёлка при этом жива — как и на карте.
   *
   * Цепочка диорамы на это время встаёт своей причиной, а не крутится вхолостую:
   * прежде она шла под роликом кадр за кадром и выходила из кадра, не нарисовав
   * ничего, — две цепочки разом. Причина своя, а не `map`: ролик открывают и с
   * карты, и его конец не должен снимать остановку, поставленную картой.
   */
  lend(on: boolean): THREE.WebGLRenderer {
    this.lent = on;
    this.beat.block('lent', on);
    return this.renderer;
  }

  /**
   * Останавливает рендер-луп, не трогая сцену. Карта мира и диорама не рисуются
   * одновременно, но переход между ними обязан быть мгновенным: здания, жители и
   * текстуры остаются на месте, гаснет только отрисовка.
   *
   * Выгружать диораму на время карты **пробовали и откатили**: разменять
   * три мегабайта памяти на четверть секунды на каждом возврате домой оказалось
   * невыгодно. Числа — в docs/loading.md, раздел 3. Не заводить заново.
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
   * 3. **Слушатели.** Все они висят на самой канве и снимаются здесь поимённо.
   *    Порядок при этом остаётся прежним: сцена выгружается, **пока канва в
   *    разметке**. Поймали это на `OrbitControls` — его `dispose()` снимал
   *    слушатель с `domElement.getRootNode()`, и на оторванной канве корнем
   *    оказывалась она сама: слушатель оставался на документе, а документ держал
   *    всю сцену (замеряно снимком кучи — четыре круга на карту и обратно
   *    оставляли четыре живые диорамы). Самого `OrbitControls` в сцене больше
   *    нет, он ушёл вместе с поворотом камеры, но `GameCanvas` по-прежнему
   *    выгружает сцену в `useLayoutEffect`: его уборка идёт **до** того, как
   *    узел уйдёт из разметки, и отдавать контекст надо именно так.
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
    this.life?.dispose();
    this.life = null;
    if (active === this) active = null;
    this.beat.stop();
    // Материалы и текстуры окружения свои у каждой сцены (не модульные): их отдаёт оно само.
    this.env?.dispose();
    this.env = null;
    this.envJob?.world.dispose();
    this.envJob = null;
    this.clearWait();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    // Больше снимать нечего: все слушатели пальца висят на самой канве и сняты
    // выше, а `OrbitControls` с его слушателем на корне узла ушёл вместе с
    // поворотом камеры. Канва при уборке всё равно обязана быть ещё в разметке —
    // теперь ради отдачи контекста, а не ради чужого слушателя (см. выше).

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
   * Привязка к деревне: без неё панорама одним пальцем уводит в пустой лес за
   * окрестности. Цель возвращается на поводок, а камера считается из неё
   * заново — ракурс от этого не дёргается, потому что угол и расстояние
   * привязкой не трогаются. Зовётся там, где сцена двигает камеру (`shift`).
   */
  protected leash = (): void => {
    const t = this.target;
    const fixed = clampPan(t.x, t.z);
    t.x = fixed.x;
    t.z = fixed.z;
  };

  /**
   * Точка земли под пальцем: луч из камеры до плоскости, на которой лежит цель.
   *
   * Это и есть вся панорама деревни: взяли землю в точке, где лёг палец, и
   * держим её под ним. Отсюда движение один к одному — ровно как на карте мира,
   * где панорама по построению один к одному. Прежняя панорама `OrbitControls`
   * считала сдвиг линейно от дистанции до цели и по вертикали отставала от
   * пальца на треть (замер: палец 90 px — земля 61 px); вот эту разницу игрок и
   * называл «в деревне камера не такая, как на карте».
   *
   * null — луч не встречает землю впереди камеры (взгляд в горизонт или выше).
   */
  private groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const ndc = this.toNdc(clientX, clientY);
    if (!ndc) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const dy = ray.ray.direction.y;
    if (dy > -1e-4) return null;
    const t = (this.target.y - ray.ray.origin.y) / dy;
    if (!(t > 0)) return null;
    return ray.ray.at(t, new THREE.Vector3());
  }

  /** Увести цель: ракурс и приближение при этом не меняются. */
  private shift(dx: number, dz: number): void {
    this.target.x += dx;
    this.target.z += dz;
    this.leash();
    this.place();
  }

  /** Панорама: точка, за которую взялись, остаётся под пальцем. */
  private pan(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const a = this.groundAt(from.x, from.y);
    const b = this.groundAt(to.x, to.y);
    if (!a || !b) return;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    // У горизонта луч ложится почти вдоль земли, и один пиксель даёт километры.
    // Такой шаг не подрезается, а отбрасывается: он не движение пальца.
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > this.stepMax) return;
    this.userMoved = true;
    this.shift(dx, dz);
  }

  /**
   * Приближение к точке экрана: земля под ней остаётся под ней.
   *
   * То же правило, что у панорамы, и та же мерка: берём землю под курсором,
   * меняем расстояние, возвращаем землю на место. На карте это `zoomAt`
   * (`ui/map/grid.ts`), и расходиться в правилах два холста одной игры не
   * должны — наезд идёт туда, куда смотрят, а не в середину экрана.
   *
   * Пол и потолок — из `zoomRange`, своих чисел здесь нет. Упёрлись в предел —
   * землю не двигаем вовсе: иначе колесо у самого пола ползало бы по посёлку,
   * ничего не приближая.
   */
  private zoomTo(sx: number, sy: number, k: number): void {
    const next = Math.min(Math.max(this.dist * k, this.zoom.min), this.zoom.max);
    if (next === this.dist) return;
    const before = this.groundAt(sx, sy);
    this.userMoved = true;
    this.dist = next;
    this.place();
    const after = this.groundAt(sx, sy);
    if (!before || !after) return;
    const dx = before.x - after.x;
    const dz = before.z - after.z;
    // У горизонта луч ложится почти вдоль земли — такая поправка не движение
    // курсора, а вырождение расчёта, и её отбрасывают целиком (как в `pan`).
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > this.stepMax) return;
    this.shift(dx, dz);
  }

  /**
   * Колесо мыши: тот же наезд, что щипком, и тем же шагом, что на карте
   * (`WHEEL_STEP`). Читается только знак `deltaY` — величину браузеры отдают
   * то в пикселях, то в строках. На деревне колесо делит расстояние до цели,
   * на карте умножает масштаб; наружу это одно и то же движение.
   */
  private onWheel = (e: WheelEvent): void => {
    if (e.deltaY === 0) return;
    this.zoomTo(e.clientX, e.clientY, e.deltaY < 0 ? 1 / WHEEL_STEP : WHEEL_STEP);
  };

  /**
   * Два пальца: наезд к середине между ними, и земля едет за этой серединой.
   *
   * Поворота здесь нет и не будет — раньше сдвиг середины поворачивал сцену
   * (`TOUCH.DOLLY_ROTATE` у `OrbitControls`), и это было его бедой: щипок и
   * поворот живут на одном движении пальцев, поэтому наезд постоянно сбивал
   * ракурс. Теперь середина работает ровно как на карте: за ней тянется земля,
   * к ней же идёт приближение.
   */
  private pinchZoom(): void {
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const prev = this.pinch;
    this.pinch = { dist, mx, my };
    if (!prev) return;
    this.userMoved = true;
    this.pan({ x: prev.mx, y: prev.my }, { x: mx, y: my });
    if (prev.dist > 0 && dist > 0) this.zoomTo(mx, my, prev.dist / dist);
  }

  /** Где середина посёлка на экране — мерка «уехала ли картинка» для журнала. */
  private centerOnScreen(): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const v = new THREE.Vector3(0, 0, 0).project(this.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * rect.width + rect.left, y: ((1 - v.y) / 2) * rect.height + rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Захват: без него палец, ушедший за край холста, перестал бы слать события,
    // и жест повис бы незакрытым. Раньше захват брал OrbitControls — теперь его
    // берём мы, потому что ввод целиком наш. Карта делает это же и так же.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* захват не обязателен: жест обработается и без него */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size < 2) this.pinch = null;
    this.maxFingers = Math.max(this.maxFingers, this.pointers.size);
    this.touch.down(e.pointerId, e.clientX, e.clientY, performance.now());
    if (this.pointers.size === 1) this.driftFrom = this.centerOnScreen();
    // Цель выбирается здесь, а не на отпускании, и это не мелочь: сообщённая
    // системой точка на отпускании прыгает, когда пятно контакта схлопывается, —
    // игрок же целился в момент нажатия.
    //
    // Второй палец прицел не двигает: это щипок, и тапа в нём уже нет — но
    // перебивать им то, во что целился первый, всё равно незачем.
    if (!this.touch.multi) this.aimed = this.pickAt(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = performance.now();
    const p = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size >= 2) {
      this.pinchZoom();
      return;
    }
    this.touch.move(e.pointerId, p.x, p.y, now);
    // Камера едет только тогда, когда разбор жеста это разрешил. Пока палец
    // внутри `TAP_MOVE`, картинка стоит: прицеливание не должно шевелить
    // деревню, а прежний второй судья шевелил её на 11–16 px за обычный тап.
    if (this.touch.panning(now)) this.pan(prev, p);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    const press = this.touch.current;
    this.forget(e.pointerId);
    this.note(press?.id === e.pointerId ? press : null, 'отменено браузером', null);
    this.touch.cancel(e.pointerId);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const now = performance.now();
    const press = this.touch.current;
    const own = press?.id === e.pointerId ? press : null;
    const multi = this.touch.multi;
    this.forget(e.pointerId);
    // Ведение камеры не должно открывать панели, а щипок — тем более: судит это
    // общий с картой разбор жеста (`Gesture`), второй правды о том, тап это или
    // ведение, в игре быть не должно.
    const tapped = this.touch.up(e.pointerId, now);
    const end: End = tapped
      ? this.aimed === null
        ? 'мимо'
        : 'тап'
      : !own || multi
        ? 'два пальца'
        : own.moved
          ? 'ведение'
          : 'долгое';
    this.note(own, end, tapped ? this.aimed : null);
    if (!tapped) return;
    // Панель открывается сейчас, а следом за этим же касанием придёт
    // синтезированный щелчок — и закроет её о затемнение, которое она только
    // что подняла. Ловим его один раз (см. `swallowGhostClick`).
    swallowGhostClick();
    this.onPick?.(this.aimed);
  };

  /** Палец снят или отобран: убрать его из щипка и отпустить захват. */
  private forget(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinch = null;
    try {
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    } catch {
      /* захвата могло и не быть */
    }
  }

  /**
   * Запись в журнал касаний. Прибор честный: чего сцена не измерила, то и
   * пишется как «не знаю», а не подставляется нулём. Нажатие передаётся сюда
   * явно, а не берётся у `Gesture`: к моменту записи оно уже закрыто.
   */
  private note(press: Press | null, end: End, hit: number | null): void {
    const from = this.driftFrom;
    const to = this.centerOnScreen();
    gestLog.add({
      where: 'деревня',
      fingers: this.maxFingers,
      ms: press ? performance.now() - press.t : 0,
      far: press ? press.far : 0,
      path: press ? press.path : 0,
      end,
      hit: hit === null ? null : (this.buildings.get(hit)?.type ?? `id ${hit}`),
      drift: from && to ? Math.hypot(to.x - from.x, to.y - from.y) : null,
    });
    if (this.pointers.size === 0) {
      this.driftFrom = null;
      this.maxFingers = 0;
    }
  }

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
  protected pickAt(clientX: number, clientY: number): number | null {
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
  protected pickWall(clientX: number, clientY: number): number | null {
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

  protected toNdc(clientX: number, clientY: number): { x: number; y: number } | null {
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
  protected hitBoxOf(id: number): HitBox | null {
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
  protected wallSpot(id: number): HitBox | null {
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

  protected setMarker(view: BuildingView, kind: Attention | null): void {
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
        // Вид `next`: модель с признаками фактуры, одетая в неё (окна ночью — там же, `env/facade.ts`).
        // Нынешний: та же модель, что всегда, и признак окон снимается до выгрузки.
        const group = createBuildingGroup(b.type, tier, this.look === 'next');
        if (this.look === 'next') this.facade?.dressFacade(group);
        else dropGlow(group);
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
      // Покрои идут по кругу (`FOLK_KINDS`), и толпа у костра разношёрстная.
      const agent = new VillagerAgent(this.nextAgentId);
      this.agents.set(this.nextAgentId++, agent);
      this.figures.add(agent.figure);
      // Вид `next`: покрой и позы у огня из куска окружения (`env/folk.ts`), если он уже приехал.
      this.life?.dressFolk(agent);
    }

    // Герой: одна фигурка у статуи. Место полководца пустует — площадь пуста.
    // Пересобирается он и при смене рода: силуэт героя — вид бойца того рода,
    // которого в войске больше всего (`hero.heroKind`), а не отдельная таблица в сцене.
    const wantHero = heroShown(s);
    const heroKey = wantHero ? heroKind(s) : null;
    if (heroKey !== this.heroKey) {
      if (this.hero) this.figures.remove(this.hero.figure);
      this.hero = heroKey ? new HeroAgent(s) : null;
      if (this.hero) this.figures.add(this.hero.figure);
      this.heroKey = heroKey;
    }

    this.syncWorkSigns(s);
    this.syncHearths();
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
    // Земля окружения знает, где стоят дома и дороги: трава к ним не подходит, земля у
    // них вытоптана. Меняется это с той же редкостью, что обстановка.
    this.envVillage = { present, built };
    (this.env ?? this.envJob?.world ?? this.envMounting)?.setVillage(this.envVillage);
    if (this.village) {
      this.scene.remove(this.village);
      disposeGeometries(this.village);
    }
    this.village = buildVillage({ present, built });
    // У пробы вытоптанную землю под домами рисует сама земля (`env/rules.groundMap`):
    // прежняя полупрозрачная декаль легла бы поверх второй бурой кляксой. Пятно тени
    // под зданием остаётся — оно сажает дом в землю.
    if (this.look === 'next') {
      this.village.getObjectByName('decals')?.children.forEach((m) => {
        if ((m as THREE.Mesh).material === DECAL.trample) m.visible = false;
      });
    }
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
      // Двор, где работают одни невольники, работает: признак зажигают руки на
      // местах, а не то, вольные ли это руки.
      const busy =
        b.type === 'storage'
          ? full
          : b.type === 'smithy'
            ? workerCount(s, b.id) > 0 && (s.forge?.length ?? 0) > 0
            : handsCount(s, b.id) > 0;
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

  /**
   * Дым очагов (вид `next`): над каждой трубой дома, где бы дом ни стоял и как бы ни
   * подрос, — верхушки труб модель помнит сама (`buildings.houses`, `userData.chimneys`).
   * Список пересобирается, только если трубы сдвинулись.
   */
  private syncHearths(): void {
    if (this.look !== 'next') return;
    const smoke: SmokeSource[] = [];
    for (const view of this.buildings.values()) {
      const tops = view.group.userData.chimneys as THREE.Vector3[] | undefined;
      if (!tops) continue;
      view.group.updateMatrixWorld(true);
      for (const top of tops) {
        const at = top.clone().applyMatrix4(view.group.matrixWorld);
        smoke.push(hearthSmoke(at.x, at.y, at.z));
      }
    }
    this.hearths.setSources(smoke);
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

  protected frame(): void {
    // Считается кадр лупа, а не кадр диорамы: одолженная ролику канва рисуется
    // им, и «кадры идут» тут значит именно то, что цепочка жива.
    this.drawn++;
    const now = performance.now();
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    // Отложенный пересчёт — первым же кадром: холст мог вернуться из фона
    // нулевым, и тогда его размер надо взять при первой возможности.
    if (this.needSize || this.drawn % 60 === 0) this.checkSize();
    const dt = Math.min(0.1, this.clock.getDelta());
    // Канва отдана ролику о бое: он рисует в неё сам, диораме тут делать нечего.
    if (this.lent) return;
    this.watch(gap);
    const t = this.clock.elapsedTime;

    // Между пульсами время партии тянется само — настоящие секунды переводит в игровые
    // дверь времени. Прежде здесь стояли настоящие секунды как игровые: между пульсами
    // солнце бежало в тридцать раз быстрее и на каждом пульсе отскакивало назад.
    const gameNow = this.gameTime + gameSeconds((performance.now() - this.gameTimeAt) / 1000);
    // Сезон переливает палитру сам, а фаза солнца уже учитывает длинную зимнюю ночь.
    this.seasonVis.update(this.season, dt);
    const solar = solarPhase(dayFraction(gameNow), this.season);
    this.applyDayNight(solar);
    const snow = this.seasonVis.snow;
    this.snowfall.update(dt, t, snow);
    this.smoke.update(dt, snow);
    this.chimneys.update(dt, snow);
    if (this.look === 'next') this.hearths.update(dt, snow);

    const night = solar > 0.58 && solar < 0.97;
    for (const a of this.agents.values()) {
      a.night = night;
      a.update(dt, t);
    }
    this.signs.update(t);
    // Дружина несёт службу и ночью: у ворот всегда кто-то стоит.
    for (const a of this.soldiers) a.update(dt, t);
    this.hero?.update(t);
    this.life?.update(dt, t, night);
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
    this.fireLight.intensity = this.look === 'next' ? fireGlow(this.light.nightK, t) : fireIntensity(night, t);
    // Окна загораются в сумерках, раньше глубокой ночи: свет в доме зажигают, когда темнеет.
    if (this.look === 'next') WINDOW_NIGHT.value = windowNight(this.light);
    // Под снегом узор кровель гаснет: снег лёг на ряды черепицы и связки соломы.
    if (this.facade) this.facade.FACADE_SNOW.value = this.seasonVis.snow;

    // Камера сама по себе не двигается: её ведёт палец. Крутится она ровно в
    // одном случае — под замером частоты кадров на стенде.
    if (this.spinRate !== 0) {
      this.spinTurn += this.spinRate * dt;
      this.place();
    }
    this.workEnv();
    if (this.env) {
      const fog = this.scene.fog as THREE.Fog | null;
      this.env.update({
        t,
        camera: this.camera,
        sun: this.rig.sun.position,
        light: this.light,
        fogFar: fog?.far ?? this.camera.far,
      });
    }
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = (this.frameNo++ & 1) === 0;
    this.beforeRender?.();
    this.renderer.render(this.scene, this.camera);
    this.afterRender?.();
  }

  /** solar: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь. */
  protected applyDayNight(solar: number): void {
    if (this.silhouette) return;
    this.light = applyDayNight(this.rig, this.scene, solar, this.seasonVis, undefined, RIG[this.look as Exclude<Look, 'city'>]);
  }

  // ---------- Стенд-витрина ----------

  /**
   * Автоповорот камеры — стенд меряет им частоту кадров при вращении.
   *
   * Единственный поворот, оставшийся в игре, и он не жест: игроку его не
   * достать ничем, а без него замер на телефоне (`?showcase=village&perf=8`)
   * мерил бы неподвижный кадр. Прежде его вёл `OrbitControls.autoRotate`;
   * теперь угол прибавляется к азимуту прямо в кадре, и хранится он здесь, а
   * не в камере.
   */
  spin(on: boolean, degPerSec = 24): void {
    this.spinRate = on ? (degPerSec * Math.PI) / 180 : 0;
    if (!on) this.spinTurn = 0;
    this.place();
  }

  /**
   * Стенд: камера над точкой земли. `dist` — расстояние до цели в пределах приближения;
   * `null` — кадровое. Игроку этот рычаг не достаётся: жест двигает те же числа сам.
   */
  standView(x: number, z: number, dist: number | null): void {
    this.userMoved = true;
    this.target.x = x;
    this.target.z = z;
    this.leash();
    if (dist !== null) this.dist = Math.min(Math.max(dist, this.zoom.min), this.zoom.max);
    this.place();
  }

  /** Пол и потолок приближения нынешнего кадра — стенду, чтобы просить ближний план. */
  zoomLimits(): { min: number; max: number } {
    return { ...this.zoom };
  }

  /**
   * Память текстур, байты: карта теней (цвет и глубина — по четыре байта на тексель), значки
   * над крышами и текстуры окружения. Счёт, а не догадка: размеры знает сама сцена.
   */
  textureBytes(): number {
    const shadow = this.renderer.shadowMap.enabled ? this.rig.sun.shadow.mapSize.x * this.rig.sun.shadow.mapSize.y * 8 : 0;
    const markers = markerTextures.size * 128 * 128 * 4 * (4 / 3);
    return shadow + markers + (this.env?.textureBytes() ?? 0);
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
    this.hearths.points.visible = !on && this.hearths.active;
    this.selection.visible = !on && this.selected !== null;
    for (const view of this.buildings.values()) {
      if (view.marker) view.marker.visible = !on;
    }
  }
}
