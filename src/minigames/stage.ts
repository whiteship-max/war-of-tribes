/**
 * Сцена промыслов: поляна предыстории от первого лица — в облегчённом виде для телефона (docs/minigames.md, 7).
 *
 * ВЗЯТО У ПРЕДЫСТОРИИ КАК ЕСТЬ, А НЕ НАПИСАНО ВТОРОЙ РАЗ: разбор пальца (`prologue/controls`), угол обзора и
 * скольжение по преградам (`prologue/glade`), стена леса и земля поляны (`prologue/models`), купол неба
 * (`prologue/dome`), формулы света (`prologue/look`), копии материалов с ветром и снегом (`prologue/surface`) и
 * конвейер кадра со ступенями (`prologue/post`). Своего — склейка: час один на игру, и свет раскладывается один раз.
 *
 * ЧЕГО ЗДЕСЬ НЕТ — ЭТО И ЕСТЬ ОБЛЕГЧЕНИЕ: круга суток, погоды, текстур, огня с точечной лампой, дыма и искр. Плотность
 * буфера — по ступени (`DPR_OF`), у пола (`base`) нет теней.
 *
 * ВРЕМЕНИ ДВА, КАК У ПРЕДЫСТОРИИ. Кадровое (`performance.now()`) — шаг, взгляд, качание. Игровое `t` — секунды с
 * «Начать»: кадр прибавляет к нему прошедшее (не больше 50 мс за кадр), и всё, что решает игра — раскладка, зрелость
 * ягоды, где бредёт коза, — чистая функция от зерна и `t` (`berries.ts`, `herd.ts`). Вкладка в фоне `t` не двигает.
 * В партию уходит один счёт — через `sim/minigames.harvest`, и делает это оболочка, а не сцена.
 *
 * КАДР — ТОЛЬКО ЧЕРЕЗ ДВЕРЬ `render/loop.ts`: потолок 60 кадров и плотности, остановка в скрытой странице. Цепочка одна.
 */
import * as THREE from 'three';
import { applyDayNight, configureRenderer, configureSky, createLightRig, fitShadow, type LightRig } from '@/render/lighting';
import { PALETTE } from '@/render/palette';
import { SeasonVisuals } from '@/render/season';
import { disposeGeometries } from '@/render/kit';
import { FrameLoop, deviceRatio, pixelRatio } from '@/render/loop';
import { Steady } from '@/render/steady';
import { VILLAGE_STEADY } from '@/render/quality';
import { swallowGhostClick } from '@/gestures';
import { gestLog } from '@/gestlog';
import { serverNow } from '@/net/clock';
import { haptic } from '@/telegram/webapp';
import type { Season } from '@/game/types';
import { Keys, PITCH_LIMIT, STICK_FULL, Sticks, mergeWalk, typing, type Walk } from '@/prologue/controls';
import { EYE, WALK_SPEED, slide, viewFov, type Blocker } from '@/prologue/glade';
import {
  EXPOSE_BASE,
  HAZE_GAIN,
  MIE,
  SKY_BLUE,
  SKY_FILL,
  SKY_GAIN,
  SNOW_BOUNCE,
  SUN_GLARE,
  TIERS,
  airLit,
  exposure,
  mistAt,
  sceneLight,
  startTier,
  storeTier,
  storedTier,
  sunTransmit,
  tierOf,
  type Tier,
} from '@/prologue/look';
import { ACES, Post, type Light } from '@/prologue/post';
import { Dome, newTone, toneAt } from '@/prologue/dome';
import { Surfaces } from '@/prologue/surface';
import { aimRing } from './models';
import { nearestTarget, type Tally, type Target } from './rules';
import { furnish } from './world';
import type { Shade } from '@/prologue/models';

/** Что сцена спрашивает у игры. Одна сцена — две игры (`BerriesPlay`, `HerdPlay`). */
export interface Play {
  /** Час: доля круга солнца для рига (0 — рассвет, 0.25 — полдень). Один на игру. */
  readonly solar: number;
  /** Где стоит игрок на «Начать» и куда смотрит (рыскание, как у камеры: 0 — вдоль −Z). */
  readonly start: { x: number; z: number; yaw: number };
  /** Докуда от середины можно уйти. */
  readonly roam: number;
  /** Полуширина коробки теней, м: ровно то, что занято игрой, — тень тем чётче, чем коробка уже. */
  readonly shadowHalf: number;
  /** Положить своё в сцену: модели игры — копиями материалов поляны (`surfaces.adopt`), пятна тени — в `shade`. */
  build(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, camera: THREE.Camera): void;
  /** Преграды тела в секунду `t`. */
  blockers(t: number): Blocker[];
  /** Что можно тронуть в секунду `t`. */
  targets(t: number): Target[];
  /** Тап по цели. Вернёт отклик строкой — он всплывает над прицелом. */
  tap(target: Target, t: number): string;
  /** Кадр: двигать своё. `walking` — идёт ли сейчас человек (качать охапку в руках). */
  frame(t: number, dt: number, walking: number): void;
  /** Счёт. */
  tally(): Tally;
  dispose(): void;

  // Необязательное — у игр, которым мало «ходи и трогай» (лук «Охоты», docs/minigames.md, 13). Нет у игры — сцена
  // ведёт себя как прежде.

  /** Своя земля и лес вместо поляны предыстории. */
  land?(scene: THREE.Scene, surfaces: Surfaces, shade: Shade, season: Season): void;
  /** Туман материалов у пола (`base`), метры: поле шире поляны. */
  readonly fog?: { near: number; far: number };
  /** Дальняя плоскость камеры, метры. */
  readonly far?: number;
  /** С какой дали размывает глубина резкости (ступень `full`), метры: на поле целятся вдаль. */
  readonly focus?: number;
  /** «Начать» — из жеста: открыть звук. */
  begin?(): void;
  /** Палец лёг в половину взгляда (или пробел): тянуть тетиву. */
  draw?(t: number): void;
  /** Палец снят: `shoot` — отпустить в цель; `false` — жест отобран, тетиву ослабить без выстрела. */
  loose?(t: number, shoot: boolean): void;
  /** Во сколько раз тише взгляд: натянутый лук ведут бережно. */
  lookScale?(): number;
  /** Во сколько раз уже угол обзора: натянутый лук приближает. */
  zoom?(): number;
  /** Во сколько раз медленнее шаг. */
  stride?(): number;
  /** Насколько натянута тетива, 0..1 — прицелу. */
  drawn?(): number;
  /** Метки прицела: дальность и на сколько ниже середины, рад. */
  pins?(): readonly { d: number; angle: number }[];
  /** Вторая строка счёта: «Стрел 6». */
  aside?(): string;
  /** Отклик, случившийся сам (попал, мимо), — всплывает над прицелом. Забирается один раз. */
  say?(): string;
  /** Кончилась ли игра раньше времени. */
  over?(t: number): boolean;
}

export type Phase = 'brief' | 'play' | 'done';

/** Что показывает надстройка. Сцена присылает его, только когда что-то поменялось. */
export interface StageView {
  phase: Phase;
  /** Сколько секунд осталось, целых вверх. */
  left: number;
  tally: Tally;
  /** Что сделает тап сейчас — подпись у прицела; ничего рядом — пусто. */
  verb: string;
  /** Отклик последнего тапа и до какого кадра он стоит. */
  note: string;
  /** Вторая строка счёта (`Play.aside`); нет — пусто. */
  aside: string;
}

/** Ступени промыслов — те же, что у поляны (`look.TIERS`): что умеет устройство, то и первая. */
export const MINI_LOOK_KEY = 'tribe.minigames.look';

/**
 * Плотность буфера по ступени: телефону — не выше полутора, полу — не выше 1,25. Цель — шестьдесят кадров, а не
 * тридцать, как у поляны: за неё платят точками, а не видом. Меньше единицы — мыло, а не экономия (`render/loop`).
 */
export const DPR_OF: Record<Tier, number> = { full: 2, lite: 1.5, base: 1.25 };

/** Тень стены леса и всего, что стоит, — у ступеней с конвейером; у пола теней нет вовсе. */
const SHADOWS: Record<Tier, boolean> = { full: true, lite: true, base: false };

/** Снег на ветках зимой — сколько, 0..1: та же мера, что у поляны в зиму (`scene.WINTER_SNOW`). */
const WINTER_SNOW = 0.6;

/** Туман материалов у пола: та же дымка, что у поляны. */
const FOG_NEAR = 12;
const FOG_FAR = 50;

/** Сколько стоит отклик тапа на экране, мс сцены. */
const NOTE_MS = 1400;

/** Как часто пересобирать надпись, мс: секунды отсчёта и подпись прицела. */
const VIEW_EVERY = 100;

const DEG = Math.PI / 180;
const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const SKY_CLEAR = new THREE.Color(PALETTE.sky);
const SNOW_WHITE = new THREE.Color(PALETTE.snowflake);
const TINT: [number, number, number] = [1, 1, 1];
const _bounce = new THREE.Color();
const _size = new THREE.Vector2();
const _dir = new THREE.Vector3();

export class Stage {
  private renderer: THREE.WebGLRenderer;
  /** Рендерер — сторожу контекста (`render/context.ts`). */
  get gl(): THREE.WebGLRenderer {
    return this.renderer;
  }
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig: LightRig;
  private seasonLook = new SeasonVisuals();
  private dome = new Dome();
  private tone = newTone();
  private surfaces = new Surfaces();
  private post: Post;
  private steady: Steady<Tier>;
  private pinned = false;
  private fog = new THREE.Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);
  private light: Light = {
    sunDir: new THREE.Vector3(0, 1, 0),
    sun: new THREE.Color(),
    haze: new THREE.Color(),
    sunUp: 0,
    air: 1,
    mist: { density: 0, height: 1 },
    exposure: 1,
    mie: MIE,
    zenith: 0,
  };
  private aim = aimRing();
  private sticks = new Sticks();
  private keys = new Keys();
  private frameLoop = new FrameLoop<never>(
    () => this.loop(),
    () => void (this.last = performance.now()),
  );
  private last = performance.now();
  private px: number;
  private pz: number;
  private yaw: number;
  private pitch = -0.12;
  private bob = 0;
  private walkK = 0;
  private phase: Phase = 'brief';
  /** Секунды игры с «Начать». */
  private t = 0;
  private note = '';
  private noteUntil = 0;
  private viewedAt = 0;
  private shown = '';
  private target: Target | null = null;

  /** Кому сказать, что надпись поменялась. */
  onView: ((v: StageView) => void) | null = null;
  /** Время вышло: игра кончилась. */
  onEnd: ((tally: Tally) => void) | null = null;
  /** Кружок стика: двигает его сцена, минуя React, — как у поляны. */
  stickEl: HTMLElement | null = null;
  /** Замерник кадров (`?fps=1`): ступень, кадры в секунду, худший кадр. */
  meterEl: HTMLElement | null = null;
  /** Прицел лука: натяжка и метки дальности — двигает сцена, минуя React. */
  aimEl: HTMLElement | null = null;
  private aimShown = '';
  /** Угол обзора по форме экрана — от него считает приближение лука. */
  private baseFov = 72;
  /** Высота холста в точках экрана — с последнего `resize`: прицел не читает раскладку каждый кадр. */
  private viewH = 1;
  private meterN = 0;
  private meterMs = 0;
  private meterWorst = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private play: Play,
    private seconds: number,
    season: Season,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    configureRenderer(this.renderer);
    // Плёнка — та же, что у поляны (`post.ACES`): лес обязан выглядеть снятым, а не диорамой.
    this.renderer.toneMapping = ACES;
    this.renderer.info.autoReset = false;
    configureSky(this.scene);
    if (play.fog) {
      this.fog.near = play.fog.near;
      this.fog.far = play.fog.far;
    }
    this.scene.fog = this.fog;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, play.far ?? 90);
    this.px = play.start.x;
    this.pz = play.start.z;
    this.yaw = play.start.yaw;
    this.rig = createLightRig(this.scene);
    const noonSun = this.rig.sun.intensity;
    const noonSky = this.rig.hemi.intensity * SKY_FILL * lum(_bounce.copy(this.rig.hemi.color).lerp(SKY_CLEAR, SKY_BLUE));
    fitShadow(this.rig, play.shadowHalf);
    const tier = this.pickTier();
    this.post = new Post(this.renderer, tier);
    if (play.focus !== undefined) this.post.setFocus(play.focus);
    this.steady = new Steady<Tier>(TIERS, tier, VILLAGE_STEADY('high'));
    // Сезон города: цвета материалов — его, снег на ветках — только зимой.
    this.seasonLook.jump(season);
    this.surfaces.u.snow.value = season === 'winter' ? WINTER_SNOW : 0;

    furnish(this.scene, this.surfaces, play, this.camera, this.dome, season);
    this.scene.add(this.aim);
    this.applyLight(noonSun, noonSky);
    this.applyTier(tier);
    this.resize();
    this.wire();
    this.loop();
    this.frameLoop.restart();
  }

  // ---------- Ход игры ----------

  /** «Начать»: пошло время. */
  begin(): void {
    if (this.phase !== 'brief') return;
    this.phase = 'play';
    this.t = 0;
    this.play.begin?.();
    this.refresh(true);
  }

  getTier(): Tier {
    return this.post.getTier();
  }

  /** Что стоит кадр: вызовы и треугольники за прошлый кадр — замерам (`?probe=1`). */
  info(): { calls: number; triangles: number; tier: Tier } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, tier: this.post.getTier() };
  }

  /** Стенду: поставить секунду игры, не играя (снимок «середина игры» и «конец»). */
  seek(t: number): void {
    if (this.phase === 'done') return;
    this.phase = 'play';
    this.t = Math.min(t, this.seconds);
    if (this.t >= this.seconds) this.finish();
    else this.refresh(true);
  }

  /**
   * Кончить начатую игру сейчас — итогом по набранному. Зовёт оболочка, когда холст умер и не вернулся
   * (`render/context.ts`): доиграть нечем, а энергия уже списана на «Начать», и пустой итог отнял бы её даром.
   * Не начатая или кончившаяся игра так не кончается. Вернёт, кончилась ли.
   */
  abort(): boolean {
    if (this.phase !== 'play') return false;
    this.finish();
    return true;
  }

  /** Время вышло: игра кончена, итог — оболочке. Одна дверь на кадр и на перемотку стенда. */
  private finish(): void {
    this.t = this.seconds;
    this.phase = 'done';
    this.sticks.clear();
    this.keys.clear();
    this.refresh(true);
    this.onEnd?.(this.play.tally());
  }

  /** Стенду и замеру: где стоит человек и куда смотрит. */
  place(x: number, z: number, yaw: number, pitch = this.pitch): void {
    this.px = x;
    this.pz = z;
    this.yaw = yaw;
    this.pitch = pitch;
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
    const half = this.sticks.down(e.pointerId, p.x, p.y, performance.now(), p.w);
    // Палец во взгляде тянет тетиву: ведёт он её тем же пальцем, отпускает — снимая.
    if (half === 'look' && this.phase === 'play') this.play.draw?.(this.t);
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
    if (done.half === 'look' && this.phase === 'play') this.play.loose?.(this.t, true);
    const target = this.phase === 'play' ? this.target : null;
    gestLog.add({
      where: 'промыслы',
      fingers: this.sticks.fingerCount + 1,
      ms: now - done.press.t,
      far: done.press.far,
      path: done.press.path,
      end: done.tap ? (target ? 'тап' : 'мимо') : 'ведение',
      hit: done.tap && target ? target.verb : null,
      drift: null,
    });
    if (!done.tap) return;
    swallowGhostClick();
    this.act();
  };

  private onCancel = (e: PointerEvent): void => {
    if (this.sticks.cancel(e.pointerId) === 'look') this.play.loose?.(this.t, false);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e.target) || e.repeat) return;
    if (this.keys.down(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
      e.preventDefault();
      // С луком пробел — тетива: держишь — тянешь, отпустил — выстрел.
      if (this.play.draw && e.code === 'Space') {
        if (this.phase === 'play') this.play.draw(this.t);
        return;
      }
      this.act();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && this.phase === 'play') this.play.loose?.(this.t, true);
    this.keys.up(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.sticks.clear();
    if (this.phase === 'play') this.play.loose?.(this.t, false);
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      this.last = performance.now();
      return;
    }
    this.onBlur();
  };

  /** Тап — по ближайшему в досягаемости, а не по прицелу: так же, как на поляне. */
  private act(): void {
    if (this.phase !== 'play' || !this.target) return;
    const said = this.play.tap(this.target, this.t);
    if (said) {
      this.note = said;
      this.noteUntil = performance.now() + NOTE_MS;
      // Отклик рукой — тот же, что у кнопок игры (`telegram/webapp.haptic`); вне Телеграма молчит.
      haptic('light');
    }
    this.refresh(true);
  }

  // ---------- Кадр ----------

  private loop = (): void => {
    const now = performance.now();
    const gap = now - this.last;
    const dt = Math.min(0.05, gap / 1000);
    this.last = now;
    this.step(dt, now);
    this.renderer.info.reset();
    this.post.render(this.scene, this.camera, this.light);
    this.watch(gap);
    this.meter(gap);
  };

  private step(dt: number, now: number): void {
    if (this.phase === 'play') {
      this.t += dt;
      if (this.t >= this.seconds) this.finish();
    }
    const live = this.phase === 'play';
    const look = this.sticks.takeLook();
    if (live) {
      const k = this.play.lookScale?.() ?? 1;
      this.yaw += look.yaw * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch * k, -PITCH_LIMIT, PITCH_LIMIT);
    }
    const walk: Walk = live ? mergeWalk(this.sticks.walk(), this.keys.walk()) : { forward: 0, strafe: 0 };
    const speed = Math.hypot(walk.forward, walk.strafe);
    if (speed > 0) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const pace = WALK_SPEED * (this.play.stride?.() ?? 1) * dt;
      const dx = (-sin * walk.forward + cos * walk.strafe) * pace;
      const dz = (-cos * walk.forward - sin * walk.strafe) * pace;
      const p = slide(this.px + dx, this.pz + dz, this.play.blockers(this.t));
      const r = Math.hypot(p.x, p.z);
      const k = r > this.play.roam ? this.play.roam / r : 1;
      this.px = p.x * k;
      this.pz = p.z * k;
      this.bob += speed * dt * 9;
    }
    this.walkK += (Math.min(1, speed) - this.walkK) * Math.min(1, dt * 6);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.position.set(this.px, EYE + Math.sin(this.bob) * 0.025 * this.walkK, this.pz);
    this.surfaces.u.time.value = now / 1000;
    this.play.frame(this.t, dt, this.walkK);
    const said = this.play.say?.();
    if (said) {
      this.note = said;
      this.noteUntil = now + NOTE_MS;
      this.refresh(true);
    }
    if (live && this.play.over?.(this.t)) this.finish();
    const zoom = this.play.zoom?.() ?? 1;
    if (Math.abs(this.camera.fov - this.baseFov * zoom) > 1e-3) {
      this.camera.fov = this.baseFov * zoom;
      this.camera.updateProjectionMatrix();
    }
    this.aimSync();
    // Что тронет тап: ближайшее в досягаемости. Кольцо под ним — видно, к чему подошёл.
    this.target = live ? nearestTarget(this.px, this.pz, this.play.targets(this.t)) : null;
    const tg = this.target;
    this.aim.visible = !!tg;
    if (tg) {
      this.aim.position.set(tg.x, 0.03, tg.z);
      this.aim.scale.setScalar(tg.r + 0.25);
    }
    this.dome.follow(this.camera.position);
    this.stick();
    if (now - this.viewedAt >= VIEW_EVERY) {
      this.viewedAt = now;
      this.refresh(false);
    }
  }

  /** Собрать надпись и отдать её, если изменилась. */
  private refresh(force: boolean): void {
    const now = performance.now();
    if (now > this.noteUntil) this.note = '';
    const v: StageView = {
      phase: this.phase,
      left: Math.max(0, Math.ceil(this.seconds - this.t - 1e-6)),
      tally: this.play.tally(),
      verb: this.target?.verb ?? '',
      note: this.note,
      aside: this.play.aside?.() ?? '',
    };
    const key = `${v.phase}|${v.left}|${v.tally.got}|${v.tally.total}|${v.verb}|${v.note}|${v.aside}`;
    if (!force && key === this.shown) return;
    this.shown = key;
    this.onView?.(v);
  }

  /** Надпись сейчас — оболочке на первом кадре. */
  snapshot(): StageView {
    return { phase: this.phase, left: Math.ceil(this.seconds - this.t), tally: this.play.tally(), verb: '', note: '', aside: this.play.aside?.() ?? '' };
  }

  /**
   * Прицел лука: натяжка — переменной `--draw`, метки дальности — сдвигом вниз от середины в точках экрана. Сдвиг —
   * тот же угол, что поправка дуги (`Play.pins`), через нынешний угол обзора: приблизил лук — метки разошлись.
   */
  private aimSync(): void {
    const el = this.aimEl;
    if (!el || !this.play.drawn) return;
    const draw = this.play.drawn();
    const h = this.viewH;
    const half = Math.tan((this.camera.fov * DEG) / 2);
    const pins = this.play.pins?.() ?? [];
    const px = pins.map((p) => Math.round((Math.tan(p.angle) / half) * (h / 2)));
    const key = `${draw.toFixed(2)}|${px.join(',')}`;
    if (key === this.aimShown) return;
    this.aimShown = key;
    el.style.setProperty('--draw', draw.toFixed(2));
    // Метки — по одной на дальность, подписаны ею же: числа прицела — от правила, а не от разметки.
    let marks = el.querySelectorAll<HTMLElement>('.mg-pin');
    if (marks.length !== pins.length) {
      marks.forEach((b) => b.remove());
      for (const p of pins) {
        const b = document.createElement('b');
        b.className = 'mg-pin';
        b.textContent = String(p.d);
        el.append(b);
      }
      marks = el.querySelectorAll<HTMLElement>('.mg-pin');
    }
    marks.forEach((b, i) => {
      b.style.transform = `translateY(${px[i] ?? 0}px)`;
    });
  }

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
    const k = len > STICK_FULL ? STICK_FULL / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  private meter(ms: number): void {
    const el = this.meterEl;
    if (!el || ms > 250) return;
    this.meterN++;
    this.meterMs += ms;
    this.meterWorst = Math.max(this.meterWorst, ms);
    if (this.meterMs < 1000) return;
    const i = this.info();
    el.textContent = `${i.tier} · ${Math.round((this.meterN * 1000) / this.meterMs)} к/с · худший ${Math.round(this.meterWorst)} мс · ${i.calls} в. · ${i.triangles} тр.`;
    this.meterN = 0;
    this.meterMs = 0;
    this.meterWorst = 0;
  }

  /** Сторож плавности: не держит шестидесяти — ступень ниже, и устройство это помнит неделю. */
  private watch(ms: number): void {
    if (this.pinned) return;
    const next = this.steady.feed(ms);
    if (!next) return;
    this.applyTier(next);
    this.resize();
    try {
      localStorage.setItem(MINI_LOOK_KEY, storeTier(next, serverNow()));
    } catch {
      // Приватное окно без хранилища: в следующий раз сторож опустит ступень снова.
    }
  }

  private pickTier(): Tier {
    const ext = this.renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    let stored: Tier | null = null;
    try {
      stored = storedTier(localStorage.getItem(MINI_LOOK_KEY), serverNow());
    } catch {
      stored = null;
    }
    const asked = tierOf(new URLSearchParams(window.location.search).get('look'));
    this.pinned = !!asked && hdr;
    return startTier({ hdr, coarse }, stored, asked);
  }

  /** Ступень: конвейер, туман материалов, тени, плотность буфера. Меняется редко — при входе и по сторожу. */
  private applyTier(tier: Tier): void {
    this.post.setTier(tier);
    this.scene.fog = tier === 'base' ? this.fog : null;
    const shadows = SHADOWS[tier];
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      // Тени — определение шейдера: материалы собираются заново.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
      });
    }
    this.dome.setGain(SKY_GAIN, tier === 'base' ? 1 : SUN_GLARE);
  }

  /**
   * Свет одной минуты — раз на игру. Те же формулы, что у поляны (`scene.applySky`): солнце сквозь толщу воздуха,
   * небо — доля рига цвета ясного зенита, снег отдаёт свет снизу, затвор привыкает к часу. Без погоды и огня.
   */
  private applyLight(noonSun: number, noonSky: number): void {
    const solar = this.play.solar;
    applyDayNight(this.rig, this.scene, solar, this.seasonLook);
    const tone = toneAt(solar, this.tone);
    const elev = Math.sin(solar * Math.PI * 2);
    const k = Math.max(0, Math.min(1, -elev / 0.3));
    const dark = k * k * (3 - 2 * k);
    const day = 1 - dark;
    const sun = this.rig.sun;
    sun.color.lerp(tone.light, tone.lightK * dark);
    const lamp = _dir.copy(sun.position).normalize();
    const noon = (12 + 40 * this.seasonLook.sunArc) * DEG;
    sunTransmit(Math.max(0, Math.asin(Math.min(1, lamp.y))), noon, TINT);
    sun.color.setRGB(sun.color.r * (1 + (TINT[0] - 1) * day), sun.color.g * (1 + (TINT[1] - 1) * day), sun.color.b * (1 + (TINT[2] - 1) * day));
    this.rig.hemi.intensity *= 1 - (1 - SKY_FILL) * day;
    this.rig.hemi.color.lerp(SKY_CLEAR, SKY_BLUE * day);
    const fall = sun.intensity * lum(sun.color) * Math.max(0, lamp.y) + this.rig.hemi.intensity * lum(this.rig.hemi.color);
    const bounce = (SNOW_BOUNCE * fall) / Math.max(0.05, this.rig.hemi.intensity);
    // Снег под ногами отдаёт свет только зимой: летом снизу светит трава рига.
    if (this.surfaces.u.snow.value > 0) this.rig.hemi.groundColor.lerp(_bounce.copy(SNOW_WHITE).multiplyScalar(bounce), day);
    this.dome.paint(tone, lamp, dark, 0, SKY_CLEAR);
    this.fog.color.copy(this.dome.haze);
    (this.scene.background as THREE.Color).copy(this.dome.horizon);
    const li = this.light;
    li.sunDir.copy(lamp);
    li.sun.copy(sun.color).multiplyScalar(sun.intensity * (day + 0.25 * dark));
    li.haze.copy(this.dome.haze).multiplyScalar(HAZE_GAIN * (0.35 + 0.65 * day));
    li.sunUp = Math.min(1, Math.max(0, (lamp.y + 0.02) / 0.12)) * day;
    li.air = airLit(Math.asin(Math.max(-1, Math.min(1, lamp.y))));
    li.zenith = day;
    mistAt(solar, 0, li.mist);
    const seen = sceneLight(sun.intensity * lum(sun.color), lamp.y * day, this.rig.hemi.intensity * lum(this.rig.hemi.color), 0);
    const noonSeen = sceneLight(noonSun, Math.sin(noon), noonSky, 0);
    li.exposure = EXPOSE_BASE * exposure(seen, noonSeen);
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.viewH = h;
    this.renderer.setPixelRatio(pixelRatio(Math.max(1, Math.min(deviceRatio(), DPR_OF[this.post.getTier()]))));
    this.renderer.setSize(w, h, false);
    const buf = this.renderer.getDrawingBufferSize(_size);
    this.post.setSize(buf.x, buf.y);
    this.camera.aspect = w / h;
    this.baseFov = viewFov(w / h);
    this.camera.fov = this.baseFov * (this.play.zoom?.() ?? 1);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.frameLoop.stop();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.play.dispose();
    disposeGeometries(this.scene);
    (this.aim.material as THREE.Material).dispose();
    this.dome.dispose();
    this.surfaces.dispose();
    this.post.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
