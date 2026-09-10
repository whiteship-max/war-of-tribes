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
 * из `serverNow()` — горение костра (`fire.ts`) и зарастание пней
 * (`glade.standing`). Сцена их не накапливает и не тикает: каждый кадр она
 * просто **спрашивает** формулу, сколько сейчас дров. Поэтому кадр, пропущенный
 * в фоне, ничего не стоит, а двое суток без игры считаются тем же выражением,
 * что и две секунды.
 *
 * Правило, которое из этого следует и которое нельзя размывать: **ни одна
 * величина не должна двигаться и там, и там.** Захочется завтра, чтобы костёр
 * разгорался от подкладывания на глазах, — разгораться будет картинка (высота
 * пламени, яркость света), а число дров останется формулой от времени. Как
 * только число начнут копить в кадре, оно разойдётся с формулой у первого же
 * игрока, свернувшего аппку.
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
import { Keys, PITCH_LIMIT, STICK_FULL, Sticks, mergeWalk, type Walk } from './controls';
import {
  CHOPS_TO_FELL,
  CHOP_MS,
  EYE,
  START,
  TREES,
  WALK_SPEED,
  blockers,
  nearest,
  slide,
  standing,
  type Spot,
} from './glade';
import { hearthFill, burnWords, feed, logsTaken } from './fire';
import { offer, logsFromTree, type Offer } from './act';
import { axe as axeModel, campfire, choppable, chopBlock, forest, gladeGround, stump, tent } from './models';
import { savePrologue, type PrologueSave } from './save';

/** Что показывает надстройка над сценой. Пересобирается только когда меняется. */
export interface PrologueView {
  /** Полнота очага, 0..1. */
  fill: number;
  /** Сколько ещё гореть — словами. */
  words: string;
  logs: number;
  axe: boolean;
  /** Что предлагает то, рядом с чем стоим. */
  offer: Offer;
  /** Сколько ударов осталось до падения дерева, 0 — не рубим. */
  chops: number;
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

/** Как часто складываем на диск. Записывать каждый кадр незачем: пара чисел. */
const SAVE_EVERY = 4000;

/** Как то, до чего дотянулись, называется в журнале касаний. */
const SPOT_WORDS: Record<Spot['kind'], string> = { tree: 'дерево', fire: 'костёр', axe: 'топор' };

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
  /** Когда начался замах, время сцены. 0 — топор в покое. */
  private swingAt = 0;

  private savedAt = 0;
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
    return nearest(this.px, this.pz, this.save.felled, serverNow());
  }

  /**
   * Сделать то, что предлагает поляна.
   *
   * Рубка — единственное, что длится: удар за ударом, `CHOPS_TO_FELL` раз. Счёт
   * ударов живёт во времени сцены и никуда не пишется — брошенное на середине
   * дерево при следующем заходе стоит целым, и это правильно: в сохранении
   * лежит только то, что случилось, а не то, что начинали.
   */
  private act(): void {
    const now = serverNow();
    const spot = this.aim();
    const what = offer(this.save, spot, now);
    if (!what.can || !spot) return;
    if (what.deed === 'take-axe') {
      this.save.axe = true;
      this.syncAxe();
      this.persist(true);
      this.refresh();
      return;
    }
    if (what.deed === 'feed') {
      const put = logsTaken(this.save.hearth, now, this.save.logs);
      if (put <= 0) return;
      this.save.hearth = feed(this.save.hearth, now, put);
      this.save.logs -= put;
      this.persist(true);
      this.refresh();
      return;
    }
    // Рубка. Замах идёт своим чередом, дерево падает на последнем ударе.
    if (this.swingAt > 0) return;
    if (this.chopTree !== spot.index) {
      this.chopTree = spot.index;
      this.chopsLeft = CHOPS_TO_FELL;
    }
    this.swingAt = performance.now();
    this.refresh();
  }

  /** Удар состоялся: либо щепа, либо дерево валится. */
  private landChop(): void {
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
    this.persist(true);
    this.refresh();
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

    this.swing(t);
    this.fire(t, dt);
    this.stick();
    this.persist(false);
    this.refresh();
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
    if (this.swingAt <= 0) {
      this.restAxe();
      return;
    }
    const k = (t - this.swingAt) / CHOP_MS;
    if (k >= 1) {
      this.swingAt = 0;
      this.restAxe();
      this.landChop();
      return;
    }
    const a = this.axeInHand;
    if (!a) return;
    // Подъём, удар, возврат — три доли одного замаха.
    const up = Math.min(1, k / 0.35);
    const hit = Math.max(0, Math.min(1, (k - 0.35) / 0.25));
    const back = Math.max(0, (k - 0.6) / 0.4);
    a.rotation.set(AXE_REST.rx + up * 0.8 - hit * 2.4 + back * 1.6, AXE_REST.ry, AXE_REST.rz);
    a.position.set(AXE_REST.x, AXE_REST.y + up * 0.22 - hit * 0.42 + back * 0.2, AXE_REST.z);
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
    return {
      fill: hearthFill(this.save.hearth, now),
      words: burnWords(this.save.hearth, now),
      logs: this.save.logs,
      axe: this.save.axe,
      offer: offer(this.save, this.aim(), now),
      chops: this.chopTree >= 0 ? this.chopsLeft : 0,
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
    const was = this.shown;
    if (
      was &&
      Math.abs(was.fill - next.fill) < 0.002 &&
      was.words === next.words &&
      was.logs === next.logs &&
      was.axe === next.axe &&
      was.chops === next.chops &&
      was.offer.label === next.offer.label &&
      was.offer.can === next.offer.can &&
      was.offer.why === next.offer.why
    ) {
      return;
    }
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
