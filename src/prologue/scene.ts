/**
 * Сцена предыстории: поляна от первого лица.
 *
 * ВРЕМЕНИ ЗДЕСЬ ДВА, И ГРАНИЦА МЕЖДУ НИМИ ПРОХОДИТ РОВНО ПО ЭТОМУ ФАЙЛУ.
 *
 * Всё, что живёт в этом классе, живёт во **времени сцены** (`performance.now()`,
 * цикл кадров): шаг, поворот головы, замах топора, дрожь пламени, отсвет огня.
 * Ни одно из этих чисел не попадает в сохранение и не переживает выход — да и
 * незачем: игрок вернётся к костру, а не в середину замаха.
 *
 * Всё, что выход переживает, лежит в `PrologueSave` и считается **на чтении**
 * из `serverNow()`: горение костра (`fire.ts`), голод и холод (`body.ts`),
 * зарастание пней (`glade.standing`), сам факт зверя на поляне и срок туши
 * (`hunt.ts`). Сцена их не накапливает и не тикает: каждый кадр она просто
 * **спрашивает** формулу. Поэтому кадр, пропущенный в фоне, ничего не стоит, а
 * двое суток без игры считаются тем же выражением, что и две секунды.
 *
 * Правило, которое из этого следует и которое нельзя размывать: **ни одна
 * величина не должна двигаться и там, и там.** Захочется завтра, чтобы костёр
 * разгорался от подкладывания на глазах, — разгораться будет картинка (высота
 * пламени, яркость света), а число дров останется формулой от времени. Как
 * только число начнут копить в кадре, оно разойдётся с формулой у первого же
 * игрока, свернувшего аппку.
 *
 * ДВА МЕСТА, ГДЕ КАДР ВСЁ-ТАКИ КАСАЕТСЯ ЗАПИСИ, И ОБА — СОБЫТИЯМИ, А НЕ
 * ВЕЛИЧИНАМИ. Первое: человек пересёк круг у костра (`warmth`) — от этого
 * зависит, растёт холод или убывает, и пересечение закрывает отрезок ровно так
 * же, как подложенные дрова. Второе: стрела долетела (`arrowStep`) — полёт
 * живёт в кадрах целиком, а записью становится одна точка, куда она воткнулась.
 * В обоих случаях кадр только **замечает мгновение**; считает по-прежнему
 * формула, и пересчитать тот же промежуток по частям — значит получить то же
 * число (`body.test.ts`).
 *
 * ОДНА ЖИВАЯ СЦЕНА, ОДИН КОНТЕКСТ WEBGL. Диорама деревни на время предыстории
 * не приостанавливается, а **снимается целиком**: `Prologue.tsx` не рисует
 * `GameCanvas`, тот убирает за собой (`TribeScene.dispose`) и отдаёт контекст.
 * Иначе их было бы два, и на телефоне это кончилось бы тем, что браузер молча
 * отобрал бы старший. По той же причине канву заводит код, а не разметка:
 * отданный контекст элемент не отпускает (подробно — в `ui/GameCanvas.tsx`).
 */
import * as THREE from 'three';
import {
  applyDayNight,
  configureRenderer,
  configureSky,
  createLightRig,
  fitShadow,
  type LightRig,
} from '@/render/lighting';
import { PALETTE } from '@/render/palette';
import { SeasonVisuals } from '@/render/season';
import { Smoke, type SmokeLook } from '@/render/weather';
import { disposeGeometries } from '@/render/kit';
import { swallowGhostClick } from '@/gestures';
import { gestLog } from '@/gestlog';
import { serverNow } from '@/net/clock';
import { Keys, KEY_BOW, PITCH_LIMIT, STICK_FULL, Sticks, mergeWalk, type Walk } from './controls';
import {
  CHOPS_TO_FELL,
  CHOP_MS,
  EYE,
  GLADE_R,
  START,
  TREES,
  WALK_SPEED,
  blockers,
  byFire,
  hash,
  nearest,
  slide,
  standing,
  type Spot,
} from './glade';
import { hearthFill, burnWords, feed, logsTaken, spend } from './fire';
import {
  coldFill,
  coldWords,
  eat,
  fedFill,
  hungerAt,
  hungerWords,
  setWarm,
  warming,
  type Death,
} from './body';
import {
  ARROWS_START,
  ARROW_SPEED,
  BUTCHER_MS,
  DEER_ALERT,
  DEER_CALM_MS,
  DEER_FLEE,
  DEER_RUN,
  DEER_WALK,
  arrowByCarcass,
  arrowHits,
  arrowLanding,
  deerHome,
  deerLive,
  landArrow,
  liveCarcass,
  nockArrow,
  pickArrow,
  type Pt,
} from './hunt';
import {
  ROAST_COST,
  bow as bowOffer,
  death,
  logsFromTree,
  meal,
  offer,
  reach,
  roastCount,
  type Offer,
} from './act';
import {
  arrow as arrowModel,
  axe as axeModel,
  bow as bowModel,
  campfire,
  carcass as carcassModel,
  choppable,
  chopBlock,
  deer as deerModel,
  forest,
  gladeGround,
  stump,
  tent,
} from './models';
import { KIT_MEAT, revive as reviveSave, savePrologue, type PrologueSave } from './save';

/**
 * Что показывает надстройка над сценой. Пересобирается только когда меняется.
 *
 * Плоский набор чисел и строк, а не вложенные объекты, и не для красоты: сцена
 * сравнивает его с показанным на каждом кадре, чтобы не дёргать React
 * шестьдесят раз в секунду, — а сравнивать поле за полем можно только плоское.
 */
export interface PrologueView {
  /** Полнота очага, 0..1, и сколько ещё гореть — словами. */
  fireFill: number;
  fireWords: string;
  /** Сытость, 0..1: полоса запаса. */
  fedFill: number;
  fedWords: string;
  /** Холод, 0..1: полоса тревоги, а не запаса. Пустая — всё хорошо. */
  coldFill: number;
  coldWords: string;
  /** Греется ли прямо сейчас — надстройка красит полосу иначе. */
  warming: boolean;
  logs: number;
  axe: boolean;
  bow: boolean;
  quiver: number;
  cooked: number;
  raw: number;
  /** Что предлагает то, рядом с чем стоим. */
  offer: Offer;
  /** Что предлагает лук: натянуть, пустить или почему нельзя. */
  shot: Offer;
  /** Еда: жареное и сырое, каждое своей кнопкой на счётчике. */
  eatCooked: Offer;
  eatRaw: Offer;
  /** Натянут ли лук: по этому надстройка ставит перекрестье. */
  drawn: boolean;
  /** Что делаем и сколько раз осталось: рубка или разделка. Пусто — ничего. */
  busy: string;
  busyLeft: number;
  /** Жив ли человек. Не `null` — поверх всего встаёт экран с причиной. */
  dead: Death;
}

/**
 * Время суток на поляне.
 *
 * Ранний вечер и никакого хода часов: солнце низко и тепло, костёр читается
 * огнём, а тени длинные и лежат поперёк поляны. Ночь была бы честнее к замыслу
 * («поддерживай огонь»), но в ней не видно ни модели, ни силуэта, а этот кусок —
 * про то, играется ли это пальцем. Ход суток появится вместе с голодом и
 * холодом, не раньше.
 */
const SOLAR = 0.47;

/** Сколько поляны накрывает коробка теней. Ровно поляна: лес теней не отбрасывает. */
const SHADOW_HALF = 20;

/** Отсвет костра: тот же цвет и та же дальность, что у костра деревни. */
const FIRE_RANGE = 14;

/**
 * Дым костра: свои размеры, а не общие с деревней.
 *
 * `FIRE_LOOK` рассчитан на камеру деревни — она в двадцати метрах, и клуб в
 * тридцать сантиметров там читается дымом. Здесь камера в трёх метрах от огня,
 * и тот же клуб выходит бледным квадратом в полэкрана. Общую величину при этом
 * править нельзя — она про деревню; поэтому здесь своя.
 */
const SMOKE_LOOK: SmokeLook = { size: 0.13, opacity: 0.09 };

/**
 * Где топор лежит в покое — от него же считается и замах.
 *
 * Рукоять модели лежит вдоль −Z, лезвие у дальнего конца. Поворот по X на
 * +0.9 задирает лезвие вверх, по Y уводит его влево: получается топор, который
 * держат у правого плеча обухом от себя. Знак по X важен — при −0.9 лезвие
 * смотрит вниз, и в руке оказывается не топор, а молоток плашмя.
 */
const AXE_REST = { x: 0.22, y: -0.52, z: -0.95, rx: 0.9, ry: 0.35, rz: 0.2 };

/**
 * Лук в левой руке: опущенный и натянутый.
 *
 * Числа той же природы, что у топора, и подобраны тем же способом — на экране
 * 375×812, где по горизонтали остаётся ±18.5°. Опущенный лук стоит у левого
 * края и повёрнут плашмя; натянутый выходит к середине и встаёт прямо, но не в
 * саму середину: перекрестье должно остаться видно, а рука — не заслонить
 * зверя, в которого целятся.
 */
const BOW_LOW = { x: -0.34, y: -0.46, z: -0.86, rx: 0.15, ry: 0.5, rz: 0.85 };
const BOW_DRAWN = { x: -0.19, y: -0.13, z: -0.66, rx: 0, ry: 0.12, rz: 0.05 };

/** За сколько миллисекунд лук выходит из опущенного в натянутый. Время сцены. */
const DRAW_MS = 260;

/** Насколько уменьшен лук в руке: та же мера, что у топора. */
const BOW_SCALE = 0.45;

/** Как часто складываем на диск. Записывать каждый кадр незачем: пара чисел. */
const SAVE_EVERY = 4000;

/**
 * Как часто пересобирается надпись надстройки.
 *
 * Не каждый кадр, и это замер, а не бережливость: `snapshot` строит четыре
 * предложения и три строки со сроками, то есть с десяток мелких объектов
 * шестьдесят раз в секунду. На телефоне это стоило кадров — медиана уезжала за
 * шестнадцать и семь.
 *
 * Ждать при этом нечего: **всё, что случается по воле игрока, зовёт `refresh`
 * само** — взял, срубил, положил, натянул, съел. Через этот промежуток видно
 * только то, что меняется от времени и от шага: полосы (у них шаг в часы) и
 * надпись на кнопке, когда подошёл к новому предмету. Восьмая доля секунды на
 * это — не задержка, а незаметность.
 */
const VIEW_EVERY = 120;

/** Как то, до чего дотянулись, называется в журнале касаний. */
const SPOT_WORDS: Record<Spot['kind'], string> = {
  tree: 'дерево',
  fire: 'костёр',
  axe: 'топор',
  tent: 'палатка',
  carcass: 'туша',
  arrow: 'стрела',
};

/** Что делает зверь. Живёт во времени сцены и никуда не пишется. */
type Beast = { x: number; z: number; yaw: number; homeX: number; homeZ: number; fleeUntil: number; fleeYaw: number; gait: number };

/** Стрела в полёте: тоже целиком время сцены — приземлившись, она станет записью. */
interface Flight {
  obj: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  flown: number;
  range: number;
  land: Pt;
}

/** Одинаковы ли два предложения — по тому, что видно на кнопке. */
const sameOffer = (a: Offer, b: Offer): boolean => a.label === b.label && a.can === b.can && a.why === b.why;

/**
 * Изменилось ли то, что показано.
 *
 * Полосы сравниваются с допуском: они ползут непрерывно, и точное сравнение
 * означало бы перерисовку каждый кадр — то есть ровно то, ради чего эта функция
 * и написана. Допуск взят по пикселю полосы: две тысячных её ширины на экране
 * не видно ни на одном телефоне.
 */
function same(a: PrologueView, b: PrologueView): boolean {
  return (
    Math.abs(a.fireFill - b.fireFill) < 0.002 &&
    Math.abs(a.fedFill - b.fedFill) < 0.002 &&
    Math.abs(a.coldFill - b.coldFill) < 0.002 &&
    a.fireWords === b.fireWords &&
    a.fedWords === b.fedWords &&
    a.coldWords === b.coldWords &&
    a.warming === b.warming &&
    a.logs === b.logs &&
    a.axe === b.axe &&
    a.bow === b.bow &&
    a.quiver === b.quiver &&
    a.cooked === b.cooked &&
    a.raw === b.raw &&
    a.drawn === b.drawn &&
    a.busy === b.busy &&
    a.busyLeft === b.busyLeft &&
    a.dead === b.dead &&
    sameOffer(a.offer, b.offer) &&
    sameOffer(a.shot, b.shot) &&
    sameOffer(a.eatCooked, b.eatCooked) &&
    sameOffer(a.eatRaw, b.eatRaw)
  );
}

export class PrologueScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig: LightRig;
  private season = new SeasonVisuals();
  private smoke: Smoke;
  private fireLight: THREE.PointLight;
  private flame: THREE.Object3D | null = null;
  private flameInner: THREE.Object3D | null = null;

  /** Деревья и пни — по одному объекту на место; меняются местами при рубке. */
  private trees: (THREE.Object3D | null)[] = TREES.map(() => null);
  private stumps: (THREE.Object3D | null)[] = TREES.map(() => null);
  private axeInBlock: THREE.Object3D | null = null;
  private axeInHand: THREE.Object3D | null = null;
  private bowInHand: THREE.Object3D | null = null;
  private nock: THREE.Object3D | null = null;

  /** Олень: четыре меша, потому что он единственный, кто здесь движется сам. */
  private deer: THREE.Group | null = null;
  private deerHead: THREE.Object3D | null = null;
  private deerLegsF: THREE.Object3D | null = null;
  private deerLegsB: THREE.Object3D | null = null;
  private beast: Beast = { x: 0, z: 0, yaw: 0, homeX: 0, homeZ: 0, fleeUntil: 0, fleeYaw: 0, gait: 0 };
  private carcass: THREE.Object3D | null = null;
  /** Стрелы в траве — по одной на запись в сохранении. */
  private stuck: THREE.Object3D[] = [];
  private flight: Flight | null = null;
  /** Натянут ли лук. Время сцены: выход опускает его сам собой. */
  private drawn = false;
  /** Когда начали натягивать, время сцены. Только для картинки. */
  private drawAt = 0;

  private sticks = new Sticks();
  private keys = new Keys();
  private frame = 0;
  private last = 0;
  private stopped = false;

  /** Где стоит игрок и куда смотрит. Время сцены: в сохранение не идёт. */
  private px = START.x;
  private pz = START.z;
  private yaw = START.yaw;
  private pitch = -0.06;
  /** Фаза покачивания при ходьбе. */
  private bob = 0;

  /** Сколько ударов осталось до падения и по какому дереву бьём. */
  private chopsLeft = 0;
  private chopTree = -1;
  /**
   * Что делается прямо сейчас и когда начато — время сцены.
   *
   * Дел, которые длятся, ровно два: удар топором и снятие куска с туши. Оба
   * живут в кадрах и никуда не пишутся: брошенное на середине дерево при
   * следующем заходе стоит целым, а недорезанная туша — целой. В сохранении
   * лежит только то, что случилось, а не то, что начинали.
   */
  private work: { kind: 'chop' | 'butcher'; at: number } | null = null;

  private savedAt = 0;
  private viewedAt = 0;
  /** Что показано сейчас — по нему видно, изменилось ли что-нибудь. */
  private shown: PrologueView | null = null;

  /** Кому сказать, что надпись изменилась. */
  onView: ((v: PrologueView) => void) | null = null;

  /**
   * Кружок стика ходьбы. Сцена двигает его сама, минуя React: он ездит за
   * пальцем каждый кадр, а перерисовывать ради этого дерево компонентов
   * шестьдесят раз в секунду незачем.
   */
  stickEl: HTMLElement | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private save: PrologueSave,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    configureRenderer(this.renderer);
    configureSky(this.scene);
    /*
     * Туман. Прежние 16–34 съедали лес целиком: дальние стволы выцветали до
     * белого уже во втором ряду, и стена читалась не лесом, а дымкой с ёлками.
     * Теперь дымка начинается там, где кончается поляна, и добирает цвет к
     * самому краю земли — деревья за спиной у ближних остаются деревьями.
     */
    this.scene.fog = new THREE.Fog(PALETTE.fog, 22, 52);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
    this.camera.position.set(this.px, EYE, this.pz);

    this.rig = createLightRig(this.scene);
    fitShadow(this.rig, SHADOW_HALF);
    // Сезон общий на всю игру — материалы одни, — поэтому поляна ставит свою
    // весну мгновенно, а деревня вернёт свою тем же `jump` при пересборке.
    this.season.jump('spring');

    this.scene.add(gladeGround(), forest(), tent(), chopBlock());
    const fire = campfire();
    this.flame = fire.getObjectByName('flame') ?? null;
    this.flameInner = fire.getObjectByName('flameInner') ?? null;
    this.scene.add(fire);

    this.fireLight = new THREE.PointLight(PALETTE.fireLight, 0.9, FIRE_RANGE, 1.6);
    this.fireLight.position.set(0, 0.9, 0);
    this.scene.add(this.fireLight);

    this.smoke = new Smoke(SMOKE_LOOK);
    this.scene.add(this.smoke.points);

    // Солнце ставится один раз: час на поляне не идёт, а `applyDayNight` только
    // раскладывает лампы и цвета по этому часу — звать его каждый кадр значило
    // бы считать одно и то же шестьдесят раз в секунду.
    applyDayNight(this.rig, this.scene, SOLAR, this.season);

    // Камера состоит в графе сцены: иначе топор, висящий на ней, не обойдётся
    // обходом и не нарисуется вовсе.
    this.scene.add(this.camera);
    this.syncTrees();
    this.syncAxe();
    this.syncBow();
    this.syncArrows();
    this.syncBeast(true);

    this.resize();
    this.wire();
    this.last = performance.now();
    this.loop();
  }

  // ---------- Ввод ----------

  private wire(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Координата внутри холста: жесты считаются от него, а не от страницы. */
  private local(e: PointerEvent): { x: number; y: number; w: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  }

  private onDown = (e: PointerEvent): void => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* захват не обязателен */
    }
    const p = this.local(e);
    this.sticks.down(e.pointerId, p.x, p.y, performance.now(), p.w);
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.sticks.move(e.pointerId, p.x, p.y, performance.now());
  };

  private onUp = (e: PointerEvent): void => {
    const now = performance.now();
    const done = this.sticks.up(e.pointerId, now);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* захвата могло и не быть */
    }
    if (!done) return;
    const spot = this.aim();
    // Журнал касаний общий на все холсты игры: жалоба «на карте работает, а
    // здесь нет» разбирается только сравнением в одном списке. Пишем измеренное:
    // сдвиг картинки здесь не меряется вовсе, и это честное «не знаю», а не ноль.
    gestLog.add({
      where: 'предыстория',
      fingers: this.sticks.fingerCount + 1,
      ms: now - done.press.t,
      far: done.press.far,
      path: done.press.path,
      end: done.tap ? (spot ? 'тап' : 'мимо') : 'ведение',
      hit: done.tap ? (spot ? SPOT_WORDS[spot.kind] : null) : null,
      drift: null,
    });
    if (!done.tap) return;
    // Тот же призрачный щелчок, что и в деревне: следом за касанием придёт
    // синтезированный `click`, а над сценой стоят кнопки надстройки.
    swallowGhostClick();
    this.act();
  };

  private onCancel = (e: PointerEvent): void => {
    this.sticks.cancel(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (this.keys.down(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
      e.preventDefault();
      this.act();
      return;
    }
    // У лука своя клавиша по той же причине, по какой у него своя кнопка: тап
    // и выстрел — разные вещи, и делить одну кнопку им нельзя.
    if (e.code === KEY_BOW) {
      e.preventDefault();
      this.doBow();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => this.keys.up(e.code);

  /** Ушли с окна — отпускаем всё: иначе клавиша остаётся зажатой навсегда. */
  private onBlur = (): void => {
    this.keys.clear();
    this.sticks.clear();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      // Кадров в фоне не было, и первый после возвращения обязан быть коротким:
      // иначе `dt` в двое суток унесёт игрока через весь лес одним шагом.
      this.last = performance.now();
      return;
    }
    this.onBlur();
    this.persist(true);
  };

  // ---------- Действие ----------

  /** По чему сейчас работает тап. Досягаемость, а не прицел (см. `controls.ts`). */
  private aim(): Spot | null {
    const now = serverNow();
    return nearest(this.px, this.pz, reach(this.save, now), now);
  }

  /** Мёртвому не делают ничего: экран смерти стоит поверх всего, и это не запрет, а правда. */
  private alive(now: number): boolean {
    return death(this.save, now) === null;
  }

  /**
   * Сделать то, что предлагает поляна.
   *
   * Дел, которые длятся, два — удар топором и снятие куска с туши, — и оба
   * заводятся здесь одинаково: `work` с отметкой кадрового времени. Остальное
   * случается сразу.
   */
  private act(): void {
    const now = serverNow();
    if (!this.alive(now)) return;
    const spot = this.aim();
    const what = offer(this.save, spot, now);
    if (!what.can || !spot) return;
    if (what.deed === 'take-axe') {
      this.save.axe = true;
      this.syncAxe();
      return this.done();
    }
    if (what.deed === 'take-kit') {
      // Один свёрток: лук, стрелы и вяленое мясо. Разбирается один раз за
      // поляну и после смерти не возвращается — почему, написано в `save.ts`.
      this.save.kit = true;
      this.save.quiver += ARROWS_START;
      this.save.meat.cooked += KIT_MEAT;
      this.syncBow();
      return this.done();
    }
    if (what.deed === 'take-arrow') {
      // Стрела не размножается: считает это одна чистая операция на всю игру
      // (`hunt.pickArrow`), и она же проверена тестом.
      this.stow(pickArrow(this.save, spot.index));
      return this.done();
    }
    if (what.deed === 'feed') {
      const put = logsTaken(this.save.hearth, now, this.save.logs);
      if (put <= 0) return;
      this.save.hearth = feed(this.save.hearth, now, put);
      this.save.logs -= put;
      return this.done();
    }
    if (what.deed === 'roast') {
      // Огонь и греет, и кормит — и за второе платят первым: полполена на кусок.
      const n = roastCount(this.save, now);
      if (n <= 0) return;
      this.save.hearth = spend(this.save.hearth, now, n * ROAST_COST);
      this.save.meat.raw -= n;
      this.save.meat.cooked += n;
      return this.done();
    }
    if (this.work) return;
    if (what.deed === 'butcher') {
      this.work = { kind: 'butcher', at: performance.now() };
      this.refresh();
      return;
    }
    // Рубка. Замах идёт своим чередом, дерево падает на последнем ударе.
    if (this.chopTree !== spot.index) {
      this.chopTree = spot.index;
      this.chopsLeft = CHOPS_TO_FELL;
    }
    this.work = { kind: 'chop', at: performance.now() };
    this.refresh();
  }

  /** Сделано: сложить на диск и обновить надпись. Одна строка на все действия. */
  private done(): void {
    this.persist(true);
    this.refresh();
  }

  /** Дело доделано: удар состоялся или кусок срезан. */
  private landWork(kind: 'chop' | 'butcher'): void {
    if (kind === 'butcher') {
      const now = serverNow();
      const c = liveCarcass(this.save.hunt, now);
      if (!c) return this.done();
      c.taken += 1;
      this.save.meat.raw += 1;
      this.syncBeast(false);
      return this.done();
    }
    this.chopsLeft -= 1;
    if (this.chopsLeft > 0) {
      this.refresh();
      return;
    }
    const i = this.chopTree;
    this.chopTree = -1;
    if (i < 0) return;
    this.save.felled[i] = serverNow();
    this.save.logs += logsFromTree();
    this.syncTrees();
    this.done();
  }

  /**
   * Лук: натянуть или пустить.
   *
   * Своя дверь, отдельная от тапа, и это главное правило охоты: **тап не
   * целится, выстрел целится.** Смешай их — и лук станет второй кнопкой
   * действия, а зверь, до которого нельзя дотянуться, станет недостижим вовсе.
   */
  doBow(): void {
    const now = serverNow();
    if (!this.alive(now)) return;
    const what = bowOffer(this.save, this.drawn);
    if (!what.can) return;
    if (what.deed === 'draw') {
      this.drawn = true;
      this.drawAt = performance.now();
      this.refresh();
      return;
    }
    this.loose();
  }

  /**
   * Пустить стрелу.
   *
   * Направление — то же, куда смотрит камера, и другого способа целиться в игре
   * нет. Куда она воткнётся, знает правило (`hunt.arrowLanding`), а не сцена:
   * дальность и край поляны — это игра, а не картинка.
   */
  private loose(): void {
    if (this.save.quiver <= 0) return;
    this.drawn = false;
    this.stow(nockArrow(this.save));
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const land = arrowLanding(this.px, this.pz, dir, EYE);
    const flat = Math.hypot(dir.x, dir.z);
    // Сколько метров стрела пролетит: до земли или до предела — что раньше.
    const range = flat > 1e-4 ? Math.hypot(land.x - this.px, land.z - this.pz) / flat : 0.5;
    const obj = arrowModel();
    obj.position.set(this.px, EYE - 0.1, this.pz);
    obj.quaternion.copy(this.camera.quaternion);
    this.scene.add(obj);
    this.flight = {
      obj,
      x: this.px,
      y: EYE - 0.1,
      z: this.pz,
      dx: dir.x,
      dy: dir.y,
      dz: dir.z,
      flown: 0,
      range,
      land,
    };
    this.done();
  }

  /** Съесть кусок: жареный или сырой. Своя дверь — подходить тут не к чему. */
  eatMeal(raw: boolean): void {
    const now = serverNow();
    if (!this.alive(now)) return;
    if (!meal(this.save, hungerAt(this.save.body, now), raw).can) return;
    this.save.body = eat(this.save.body, this.save.hearth, now, raw);
    if (raw) this.save.meat.raw -= 1;
    else this.save.meat.cooked -= 1;
    this.done();
  }

  /**
   * Новое утро после смерти.
   *
   * Поляну и человека пересобирает чистое правило (`save.revive`), сцена только
   * догоняет: ставит игрока к палатке и переставляет то, что видно.
   */
  reviveNow(): void {
    // Стрела, застигнутая в полёте, кладётся на землю: `revive` собирает с
    // поляны все до одной, а летящая не лежит нигде и пропала бы навсегда.
    this.groundFlight();
    this.save = reviveSave(this.save, serverNow());
    this.px = START.x;
    this.pz = START.z;
    this.yaw = START.yaw;
    this.pitch = -0.06;
    this.drawn = false;
    this.work = null;
    this.chopTree = -1;
    this.dropFlight();
    this.syncTrees();
    this.syncAxe();
    this.syncBow();
    this.syncArrows();
    this.syncBeast(true);
    this.done();
  }

  // ---------- Сцена ----------

  /** Что стоит на местах деревьев: ствол, пень или ничего. */
  private syncTrees(): void {
    const now = serverNow();
    TREES.forEach((t, i) => {
      const up = standing(this.save.felled[i] ?? 0, now);
      if (up && !this.trees[i]) {
        this.trees[i] = choppable(i);
        this.scene.add(this.trees[i]!);
      }
      if (!up && this.trees[i]) {
        this.drop(this.trees[i]!);
        this.trees[i] = null;
      }
      if (!up && !this.stumps[i]) {
        this.stumps[i] = stump(t.x, t.z, i);
        this.scene.add(this.stumps[i]!);
      }
      if (up && this.stumps[i]) {
        this.drop(this.stumps[i]!);
        this.stumps[i] = null;
      }
    });
  }

  /** Где топор: в колоде или в руке. */
  private syncAxe(): void {
    if (this.save.axe) {
      if (this.axeInBlock) {
        this.drop(this.axeInBlock);
        this.axeInBlock = null;
      }
      if (!this.axeInHand) {
        const a = axeModel();
        /*
         * Топор висит на камере: он часть взгляда, а не мира, и ездит с ним без
         * единой строки в цикле кадров.
         *
         * Числа — от портрета, и подобраны замером, а не на глаз. Угол обзора у
         * камеры **вертикальный**, а экран телефона узкий: при 72° по вертикали
         * и стороне 375×812 по горизонтали остаётся всего 37°, то есть ±18.5° от
         * середины. Поэтому вещь в руке приходится и отодвигать (иначе она
         * заслоняет полкадра), и держать ближе к середине (иначе уезжает за
         * край): при x = 0.42 и z = −1 топор оказывался ровно за кромкой экрана
         * и был не виден вовсе.
         */
        a.scale.setScalar(0.62);
        a.castShadow = false;
        this.axeInHand = a;
        this.restAxe();
        this.camera.add(a);
      }
      return;
    }
    if (this.axeInHand) {
      this.camera.remove(this.axeInHand);
      disposeGeometries(this.axeInHand);
      this.axeInHand = null;
    }
    if (!this.axeInBlock) {
      const a = axeModel();
      // Всажен в колоду: лезвие прикушено верхом, рукоять торчит вверх и к
      // игроку. Высота подобрана так, чтобы обух было видно над срезом, — иначе
      // на колоде торчит одна палка, и первая же цель режима не читается.
      a.position.set(2.42, 0.92, 2.05);
      a.rotation.set(-1.25, 0.55, 0);
      this.axeInBlock = a;
      this.scene.add(a);
    }
  }

  /**
   * Лук в левой руке — и стрела на тетиве, пока он натянут.
   *
   * Висит на камере, как топор: обе вещи — часть взгляда, а не мира. Стрела на
   * тетиве — отдельный меш нарочно: её видно только с натянутым луком, и это
   * единственное, чем показ отличает «держит» от «целится».
   */
  private syncBow(): void {
    if (!this.save.kit) return;
    if (this.bowInHand) return;
    const b = bowModel();
    b.scale.setScalar(BOW_SCALE);
    const nock = arrowModel();
    nock.scale.setScalar(1 / BOW_SCALE);
    nock.rotation.x = Math.PI / 2;
    nock.visible = false;
    b.add(nock);
    this.nock = nock;
    this.bowInHand = b;
    this.camera.add(b);
  }

  /** Стрелы в траве: по одной на запись. Их немного, поэтому просто пересобираем. */
  private syncArrows(): void {
    for (const o of this.stuck) this.drop(o);
    this.stuck = [];
    for (let i = 0; i < this.save.arrows.length; i++) {
      const a = this.save.arrows[i];
      const o = arrowModel();
      // Воткнулась под углом и торчит оперением вверх: лежащую в траве стрелу
      // не видно вовсе, а найти её надо глазом, а не перебором поляны ногами.
      o.position.set(a.x, 0.3, a.z);
      o.rotation.set(-1.15, hash(i, 71) * Math.PI * 2, 0);
      this.scene.add(o);
      this.stuck.push(o);
    }
  }

  /**
   * Зверь и туша: что из них сейчас на поляне.
   *
   * `fresh` — ставить ли оленя заново на его место. Так при входе и после
   * смерти он оказывается там, где его назвало правило (`deerHome`), а при
   * снятии куска с туши — остаётся где ходил.
   */
  private syncBeast(fresh: boolean): void {
    const now = serverNow();
    const live = deerLive(this.save.hunt, now);
    if (live && !this.deer) {
      const d = deerModel();
      this.deerHead = d.getObjectByName('head') ?? null;
      this.deerLegsF = d.getObjectByName('legsFront') ?? null;
      this.deerLegsB = d.getObjectByName('legsBack') ?? null;
      this.deer = d;
      this.scene.add(d);
      fresh = true;
    }
    if (!live && this.deer) {
      this.drop(this.deer);
      this.deer = null;
      this.deerHead = null;
      this.deerLegsF = null;
      this.deerLegsB = null;
    }
    if (live && fresh) {
      const home = deerHome(this.save.hunt);
      this.beast = { x: home.x, z: home.z, yaw: 0, homeX: home.x, homeZ: home.z, fleeUntil: 0, fleeYaw: 0, gait: 0 };
    }
    const c = liveCarcass(this.save.hunt, now);
    if (c && !this.carcass) {
      const m = carcassModel();
      m.position.set(c.x, 0, c.z);
      m.rotation.y = hash(this.save.hunt.killedAt * 0.001, 83) * Math.PI * 2;
      this.carcass = m;
      this.scene.add(m);
    }
    if (!c && this.carcass) {
      this.drop(this.carcass);
      this.carcass = null;
    }
  }

  /**
   * Записать новое состояние стрел и переставить те, что в траве.
   *
   * Одна дверь на все три случая — выстрел, приземление, подбор, — потому что
   * обещание у них общее: стрел не становится ни больше, ни меньше. Считает это
   * `hunt.ts` чистыми операциями; сцене остаётся положить ответ на место.
   */
  private stow(next: { quiver: number; arrows: readonly Pt[] }): void {
    this.save.quiver = next.quiver;
    this.save.arrows = next.arrows as Pt[];
    this.syncArrows();
  }

  /**
   * Положить летящую стрелу на землю там, где она должна была воткнуться.
   *
   * Нужно на двух выходах, где полёт обрывается не своим чередом: уход из
   * режима и новое утро после смерти. Из колчана она уже вычтена, на земле её
   * ещё нет — не приземли её здесь, и стрела пропала бы навсегда.
   */
  private groundFlight(): void {
    if (!this.flight) return;
    this.stow(landArrow(this.save, this.flight.land));
    this.dropFlight();
  }

  /** Убрать летящую стрелу, ничего не записывая: она никуда не долетела. */
  private dropFlight(): void {
    if (!this.flight) return;
    this.drop(this.flight.obj);
    this.flight = null;
  }

  private drop(o: THREE.Object3D): void {
    o.removeFromParent();
    disposeGeometries(o);
  }

  // ---------- Кадр ----------

  private loop = (): void => {
    if (this.stopped) return;
    this.frame = requestAnimationFrame(this.loop);
    const t = performance.now();
    // Потолок шага: вкладка могла простоять в фоне, и без него первый кадр
    // после возвращения был бы прыжком через полполяны.
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;

    this.step(dt, t);
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number, t: number): void {
    const look = this.sticks.takeLook();
    this.yaw += look.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    const walk: Walk = mergeWalk(this.sticks.walk(), this.keys.walk());
    const speed = Math.hypot(walk.forward, walk.strafe);
    if (speed > 0) {
      // Экранное «вперёд» — туда, куда смотрит голова, но по земле: задранный
      // взгляд не должен уводить шаг в небо.
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = (-sin * walk.forward + cos * walk.strafe) * WALK_SPEED * dt;
      const dz = (-cos * walk.forward - sin * walk.strafe) * WALK_SPEED * dt;
      const p = slide(this.px + dx, this.pz + dz, blockers(this.save.felled, serverNow()));
      this.px = p.x;
      this.pz = p.z;
      this.bob += speed * dt * 9;
    }

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // Покачивание при ходьбе — мелкое: без него шаг не читается, с большим
    // укачивает. Стоит оно нисколько: два синуса на кадр.
    const sway = speed > 0 ? Math.sin(this.bob) * 0.035 : 0;
    this.camera.position.set(this.px, EYE + sway, this.pz);

    this.warmth();
    this.swing(t);
    this.aimBow(t);
    this.beastStep(dt, t);
    this.arrowStep(dt);
    this.fire(t, dt);
    this.stick();
    this.persist(false);
    // Кадровая пересборка надписи — единственная, которую можно проредить: всё
    // остальное зовёт `refresh` само, в ту же минуту, когда случилось.
    if (t - this.viewedAt >= VIEW_EVERY) {
      this.viewedAt = t;
      this.refresh();
    }
  }

  /**
   * Вошёл в круг у огня или вышел из него.
   *
   * ЗДЕСЬ ГРАНИЦА ВРЕМЕНИ ПРОХОДИТ ЧЕРЕЗ САМОЕ УЗКОЕ МЕСТО ВСЕЙ ПАЧКИ, и потому
   * сказано подробно. Холод — величина, которая переживает выход, и считать её в
   * кадре нельзя. Но растёт она по-разному в зависимости от того, где стоит
   * человек, а где он стоит — это кадр и ничто иное.
   *
   * Мирит их вот что: **положение важно не само по себе, а моментом, когда оно
   * меняет знак.** Пересечение круга — это событие, такое же, как подложенные
   * дрова: отрезок закрывается формулой, отметка переезжает на текущую минуту, и
   * дальше опять считает формула. Кадр здесь только замечает событие; величину
   * он не двигает ни на волос.
   *
   * Отсюда и `if`: без него отметка переписывалась бы шестьдесят раз в секунду.
   * Числа от этого не поехали бы — разбиение у `coldAt` точное, — но на диск
   * уходила бы запись за записью, и «величина, которая копится в кадре» стала бы
   * правдой на вид, а такой правды в этом файле быть не должно.
   */
  private warmth(): void {
    const warm = byFire(this.px, this.pz);
    if (warm === this.save.body.warm) return;
    this.save.body = setWarm(this.save.body, this.save.hearth, serverNow(), warm);
    this.persist(true);
  }

  /**
   * Показать, где сейчас стик ходьбы.
   *
   * Стик плавающий — появляется там, где лёг палец, а не стоит в углу: на
   * 375 px большой палец ложится куда дотянулся, и нарисованный заранее кружок
   * он промахивает. Значит, нарисовать его надо там же, где палец, и подвинуть
   * ободок туда, куда палец увели.
   */
  private stick(): void {
    const el = this.stickEl;
    if (!el) return;
    const s = this.sticks.stick;
    if (!s) {
      if (el.dataset.on === '1') {
        el.dataset.on = '0';
        el.style.opacity = '0';
      }
      return;
    }
    if (el.dataset.on !== '1') {
      el.dataset.on = '1';
      el.style.opacity = '1';
    }
    el.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    const knob = el.firstElementChild as HTMLElement | null;
    if (!knob) return;
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    // Ободок не убегает за край стика: дальше полного отклонения он всё равно
    // ничего не значит, а уехавший кружок читается как поломка.
    const k = len > STICK_FULL ? STICK_FULL / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  /** Топор в покое: у правого края взгляда, лезвием вниз. */
  private restAxe(): void {
    const a = this.axeInHand;
    if (!a) return;
    a.position.set(AXE_REST.x, AXE_REST.y, AXE_REST.z);
    a.rotation.set(AXE_REST.rx, AXE_REST.ry, AXE_REST.rz);
  }

  /**
   * Замах топора: подъём, удар, возврат. Целиком во времени сцены.
   *
   * Удар засчитывается **один раз** — по истечении замаха, а не по кадру, в
   * котором топор оказался внизу: кадры идут неровно, и «внизу» их бывает
   * несколько. Отсюда и порядок: сперва закрыть замах, потом звать `landChop`.
   */
  private swing(t: number): void {
    const w = this.work;
    if (!w) {
      this.restAxe();
      return;
    }
    const span = w.kind === 'chop' ? CHOP_MS : BUTCHER_MS;
    const k = (t - w.at) / span;
    if (k >= 1) {
      this.work = null;
      this.restAxe();
      this.landWork(w.kind);
      return;
    }
    const a = this.axeInHand;
    if (!a || w.kind !== 'chop') return;
    // Подъём, удар, возврат — три доли одного замаха.
    const up = Math.min(1, k / 0.35);
    const hit = Math.max(0, Math.min(1, (k - 0.35) / 0.25));
    const back = Math.max(0, (k - 0.6) / 0.4);
    a.rotation.set(AXE_REST.rx + up * 0.8 - hit * 2.4 + back * 1.6, AXE_REST.ry, AXE_REST.rz);
    a.position.set(AXE_REST.x, AXE_REST.y + up * 0.22 - hit * 0.42 + back * 0.2, AXE_REST.z);
  }

  /**
   * Лук в руке: опущен или поднят.
   *
   * Переход занимает четверть секунды, и это не украшение: мгновенно
   * появившийся посреди экрана лук игрок читает как сбой картинки, а не как
   * своё действие. Число никуда не пишется — время сцены целиком.
   */
  private aimBow(t: number): void {
    const b = this.bowInHand;
    if (!b) return;
    const k = this.drawn ? Math.min(1, (t - this.drawAt) / DRAW_MS) : 0;
    const at = (lo: number, hi: number): number => lo + (hi - lo) * k;
    b.position.set(at(BOW_LOW.x, BOW_DRAWN.x), at(BOW_LOW.y, BOW_DRAWN.y), at(BOW_LOW.z, BOW_DRAWN.z));
    b.rotation.set(at(BOW_LOW.rx, BOW_DRAWN.rx), at(BOW_LOW.ry, BOW_DRAWN.ry), at(BOW_LOW.rz, BOW_DRAWN.rz));
    if (this.nock) {
      this.nock.visible = this.drawn;
      // Стрела уходит назад по мере натяжения: тетива тянется к щеке.
      this.nock.position.set(0, 0, 0.1 + k * 0.34);
    }
  }

  /**
   * Олень.
   *
   * ВСЁ ЭТО — ВРЕМЯ СЦЕНЫ, И НИ ОДНО ЧИСЛО ОТСЮДА НЕ ПОПАДАЕТ В СОХРАНЕНИЕ.
   * Есть ли зверь на поляне и где он вышел — решает правило (`hunt.ts`); где он
   * стоит через двадцать секунд — решают кадры. Игрок, вернувшийся завтра,
   * застанет его не там, где оставил, и это правильно: зверь не стоит на паузе,
   * пока на него не смотрят.
   *
   * СЛУЧАЙНОСТИ ЗДЕСЬ НЕТ НИ ОДНОЙ, а предсказуемым олень всё равно не выходит,
   * и вот почему: пасётся он по плавной кривой из двух синусов разной частоты —
   * она не повторяется на глаз, — а срывается **от человека**. Куда он побежит,
   * зависит от того, с какой стороны подошли; значит, неопределённость даёт
   * игрок, а не бросок кости. Для охоты этого довольно: угадать нечего, потому
   * что зверь отвечает на твоё же движение.
   */
  private beastStep(dt: number, t: number): void {
    const d = this.deer;
    if (!d) return;
    const b = this.beast;
    const gap = Math.hypot(this.px - b.x, this.pz - b.z);
    const s = t / 1000;

    if (gap < DEER_FLEE && t > b.fleeUntil) {
      // Сорвался: бежит от человека и не разбирает дороги, пока не отдышится.
      b.fleeUntil = t + DEER_CALM_MS;
      b.fleeYaw = Math.atan2(b.x - this.px, b.z - this.pz);
    }
    const fleeing = t < b.fleeUntil;
    let speed = 0;
    if (fleeing) {
      let dx = Math.sin(b.fleeYaw);
      let dz = Math.cos(b.fleeYaw);
      // У края поляны бежит вдоль опушки, а не в стену: зверь, упёршийся в
      // невидимую границу, читается сломанным.
      const ahead = Math.hypot(b.x + dx * 2, b.z + dz * 2);
      if (ahead > GLADE_R - 1.4) {
        // Доворачивает на ходу — примерно полтора оборота в секунду вбок.
        b.fleeYaw += 2.7 * dt;
        dx = Math.sin(b.fleeYaw);
        dz = Math.cos(b.fleeYaw);
      }
      speed = DEER_RUN;
      b.x += dx * speed * dt;
      b.z += dz * speed * dt;
      b.yaw = Math.atan2(dx, dz);
    } else if (gap > DEER_ALERT) {
      // Пасётся: бродит вокруг своего места по кривой из двух синусов.
      const tx = b.homeX + Math.sin(s * 0.17) * 3.0;
      const tz = b.homeZ + Math.sin(s * 0.11 + 1.7) * 2.4;
      const dx = tx - b.x;
      const dz = tz - b.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.15) {
        speed = DEER_WALK;
        b.x += (dx / len) * speed * dt;
        b.z += (dz / len) * speed * dt;
        b.yaw = Math.atan2(dx, dz);
      }
    } else {
      // Заметил: стоит, подняв голову, и смотрит на человека.
      b.yaw = Math.atan2(this.px - b.x, this.pz - b.z);
    }
    if (!fleeing && b.fleeUntil > 0 && t >= b.fleeUntil) {
      // Отдышался — пасётся там, куда прибежал.
      b.homeX = b.x;
      b.homeZ = b.z;
      b.fleeUntil = 0;
    }
    const r = Math.hypot(b.x, b.z);
    if (r > GLADE_R - 1.0) {
      b.x = (b.x / r) * (GLADE_R - 1.0);
      b.z = (b.z / r) * (GLADE_R - 1.0);
    }

    b.gait += speed * dt * 3.4;
    d.position.set(b.x, 0, b.z);
    d.rotation.y = b.yaw;
    const swing = speed > 0 ? Math.sin(b.gait) * (fleeing ? 0.62 : 0.32) : 0;
    if (this.deerLegsF) this.deerLegsF.rotation.x = swing;
    if (this.deerLegsB) this.deerLegsB.rotation.x = -swing;
    // Голова: опущена в траву, пока пасётся, и вскинута, как только заметил.
    if (this.deerHead) {
      const want = gap > DEER_ALERT && !fleeing ? 0.82 : -0.05;
      this.deerHead.rotation.x += (want - this.deerHead.rotation.x) * Math.min(1, dt * 7);
    }
  }

  /**
   * Стрела в полёте.
   *
   * Попадание проверяется на отрезке одного кадра, а не по прямой целиком: зверь
   * движется, и «пролетела мимо, потому что он успел шагнуть» — законный промах,
   * а не потерянное попадание.
   */
  private arrowStep(dt: number): void {
    const f = this.flight;
    if (!f) return;
    const step = ARROW_SPEED * dt;
    f.flown += step;
    f.x += f.dx * step;
    f.y += f.dy * step;
    f.z += f.dz * step;
    f.obj.position.set(f.x, f.y, f.z);
    if (this.deer && arrowHits(f.x, f.y, f.z, this.beast)) return this.hitBeast();
    if (f.flown < f.range && f.y > 0.05) return;
    // Долетела: воткнулась в землю там, где кончился полёт.
    this.stow(landArrow(this.save, f.land));
    this.dropFlight();
    this.done();
  }

  /** Стрела нашла зверя. Один точный выстрел валит оленя, второго не нужно. */
  private hitBeast(): void {
    const now = serverNow();
    const at = { x: this.beast.x, z: this.beast.z };
    this.save.hunt = { killedAt: now, carcass: { x: at.x, z: at.z, taken: 0 } };
    // Стрела остаётся рядом с тушей: мясо и стрелу берут порознь, иначе
    // `nearest` выбирал бы между ними за игрока.
    this.stow(landArrow(this.save, arrowByCarcass(at, this.save.arrows.length)));
    this.dropFlight();
    this.syncBeast(false);
    this.done();
  }

  /**
   * Огонь.
   *
   * Высота пламени и яркость отсвета идут от того, **сколько дров сейчас** —
   * то есть от формулы, а не от накопленного в кадре числа. Дрожь при этом
   * своя, кадровая: она ничего не значит и никуда не пишется.
   */
  private fire(t: number, dt: number): void {
    const now = serverNow();
    const fill = hearthFill(this.save.hearth, now);
    const alive = fill > 0;
    const s = t / 1000;
    // Даже полный костёр не вырастает вдвое: пламя — свеча масштаба, а не полоса.
    const size = alive ? 0.55 + fill * 0.55 : 0;
    if (this.flame) {
      this.flame.visible = alive;
      const f = size * (1 + Math.sin(s * 11) * 0.09);
      this.flame.scale.set(f, size * (1 + Math.sin(s * 9) * 0.13), f);
      this.flame.rotation.y = s * 2;
    }
    if (this.flameInner) {
      this.flameInner.visible = alive;
      this.flameInner.scale.setScalar(size);
      this.flameInner.rotation.y = -s * 3;
    }
    this.fireLight.intensity = alive ? (0.45 + fill * 0.9) * (0.92 + Math.sin(s * 13) * 0.08) : 0;
    this.smoke.points.visible = alive;
    if (alive) this.smoke.update(dt, 0);
  }

  /** Раз в несколько секунд складываем пару чисел на диск. */
  private persist(force: boolean): void {
    const t = performance.now();
    if (!force && t - this.savedAt < SAVE_EVERY) return;
    this.savedAt = t;
    savePrologue(this.save);
  }

  /**
   * Что показывать надстройке прямо сейчас.
   *
   * Считается на месте и ничего не помнит — это и позволяет спросить её до
   * первого кадра. Спрашивать надо: **кадра может не быть вовсе.** В скрытом
   * вебвью `requestAnimationFrame` не вызывается ни разу, и надстройка,
   * ждущая первого кадра, показала бы игроку многоточие вместо костра. Та же
   * причина, по которой не ждёт кадра экран загрузки (`boot/paint.ts`).
   */
  snapshot(): PrologueView {
    const now = serverNow();
    const s = this.save;
    const hunger = hungerAt(s.body, now);
    const busy = this.work?.kind ?? '';
    return {
      fireFill: hearthFill(s.hearth, now),
      fireWords: burnWords(s.hearth, now),
      fedFill: fedFill(s.body, now),
      fedWords: hungerWords(s.body, now),
      coldFill: coldFill(s.body, s.hearth, now),
      coldWords: coldWords(s.body, s.hearth, now),
      warming: warming(s.body, s.hearth, now),
      logs: s.logs,
      axe: s.axe,
      bow: s.kit,
      quiver: s.quiver,
      cooked: s.meat.cooked,
      raw: s.meat.raw,
      offer: offer(s, this.aim(), now),
      shot: bowOffer(s, this.drawn),
      eatCooked: meal(s, hunger, false),
      eatRaw: meal(s, hunger, true),
      drawn: this.drawn,
      busy: busy === 'chop' ? 'Ещё ударов' : busy === 'butcher' ? 'Срезает' : '',
      busyLeft: busy === 'chop' && this.chopTree >= 0 ? this.chopsLeft : 0,
      dead: death(s, now),
    };
  }

  /**
   * Сказать надстройке, если что-то изменилось.
   *
   * Сравнение по значению нарочно: `onView` ведёт в React, и звать его каждый
   * кадр значило бы перерисовывать надстройку шестьдесят раз в секунду ради
   * строки, которая меняется раз в минуту.
   */
  private refresh(): void {
    const next = this.snapshot();
    if (this.shown && same(this.shown, next)) return;
    this.shown = next;
    this.onView?.(next);
  }

  /** Кнопка действия в надстройке — та же дверь, что и тап по сцене. */
  doAct(): void {
    this.act();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Где стоит игрок и куда смотрит — замеру.
   *
   * Стенд (`npm run prologue:report`) водит пальцем и обязан спрашивать
   * положение у самой сцены, а не считать его вторым способом: иначе он мерил
   * бы своё представление о ходьбе, а не ходьбу.
   */
  where(): { x: number; z: number; yaw: number } {
    return { x: this.px, z: this.pz, yaw: this.yaw };
  }

  /**
   * Где сейчас зверь — замеру.
   *
   * Стенд обязан спрашивать положение у самой сцены, а не считать его вторым
   * способом: положение оленя живёт во времени кадров, и второго источника у
   * него нет и быть не может. `null` — зверя на поляне нет.
   */
  deerAt(): { x: number; z: number } | null {
    return this.deer ? { x: this.beast.x, z: this.beast.z } : null;
  }

  /** Где лежит туша — замеру: к ней надо дойти, а лежит она там, где упал зверь. */
  carcassAt(): { x: number; z: number } | null {
    const c = liveCarcass(this.save.hunt, serverNow());
    return c ? { x: c.x, z: c.z } : null;
  }

  /** Сколько стрел лежит на поляне — замеру: их не должно становиться больше. */
  arrowCount(): number {
    return this.save.arrows.length;
  }

  /** Показания для замера: вызовы отрисовки и треугольники. */
  stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /**
   * Уборка. Порядок тот же, что у диорамы: снять слушатели, освободить
   * геометрию, отдать контекст — и всё это, пока канва ещё в разметке.
   */
  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    // Летящая стрела кладётся на землю до записи: из колчана она вычтена, и
    // уход из режима посреди выстрела не должен стоить игроку стрелы.
    this.groundFlight();
    this.persist(true);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    // Топор висит на камере, а она — в сцене: обход достанет и его. Дым — не
    // меш, `disposeGeometries` его не видит, поэтому он убирается руками.
    disposeGeometries(this.scene);
    this.smoke.points.geometry.dispose();
    (this.smoke.points.material as THREE.Material).dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
