/**
 * Сцена промыслов: поляна предыстории от первого лица — в облегчённом виде для телефона (docs/minigames.md, 7).
 *
 * ВЗЯТО У ПРЕДЫСТОРИИ КАК ЕСТЬ, А НЕ НАПИСАНО ВТОРОЙ РАЗ: разбор пальца (`prologue/controls`), угол обзора и
 * скольжение по преградам (`prologue/glade`), стена леса и земля поляны (`prologue/models`), купол неба
 * (`prologue/dome`), формулы света (`prologue/look`), копии материалов с ветром и снегом (`prologue/surface`) и
 * конвейер кадра со ступенями (`prologue/post`). Своего — склейка: час один на игру, и свет раскладывается один раз.
 *
 * ЧЕГО ЗДЕСЬ НЕТ — ЭТО И ЕСТЬ ОБЛЕГЧЕНИЕ: круга суток, текстур, огня с точечной лампой, дыма и искр. Плотность
 * буфера — по ступени (`DPR_OF`), у пола (`base`) нет теней.
 *
 * ПОГОДА — ГОРОДА, НА ВХОДЕ (docs/polish.md, П-4): та же, что над городом в эту минуту (`weather.weatherNow`), и одна на
 * игру, как час. Тучи гасят солнце формулами поляны (`gloomOf`), дождь мочит, снегопад белит ветки, туман — в дымку
 * конвейера; дождь и снег — осадками города (`render/city/precip`), его же докачкой и только когда идут.
 *
 * ВРЕМЕНИ ДВА, КАК У ПРЕДЫСТОРИИ. Кадровое (`performance.now()`) — шаг, взгляд, качание. Игровое `t` — секунды с
 * «Начать»: кадр прибавляет к нему прошедшее (не больше 50 мс за кадр), и всё, что решает игра — раскладка, зрелость
 * ягоды, где бредёт коза, — чистая функция от зерна и `t` (`berries.ts`, `herd.ts`). Вкладка в фоне `t` не двигает.
 * В партию уходит один счёт — через `sim/minigames.harvest`, и делает это оболочка, а не сцена.
 *
 * КАДР — ТОЛЬКО ЧЕРЕЗ ДВЕРЬ `render/loop.ts`: потолок 60 кадров и плотности, остановка в скрытой странице. Цепочка одна.
 */
import * as THREE from 'three';
import { applyDayNight, configureRenderer, configureSky, createLightRig, fitShadow, keyHolding, type LightRig } from '@/render/lighting';
import { PALETTE } from '@/render/palette';
import { SeasonVisuals } from '@/render/season';
import { disposeGeometries } from '@/render/kit';
import { contextLost } from '@/render/context';
import { FrameLoop, deviceRatio, pixelRatio } from '@/render/loop';
import { Steady } from '@/render/steady';
import { lowerWaterLook } from '@/render/water/lod';
import { VILLAGE_STEADY } from '@/render/quality';
import { levelNow } from '@/render/gfx';
import { SHADOWS, miniTier } from './tier';
import { Press, swallowGhostClick } from '@/gestures';
import { gestLog } from '@/gestlog';
import { serverNow } from '@/net/clock';
import { haptic } from '@/telegram/webapp';
import type { Season } from '@/game/types';
import type { MinigameId } from '@/game/data/minigames';
import { Keys, PITCH_LIMIT, Sticks, mergeWalk, padKnob, typing, type Walk } from '@/prologue/controls';
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
import { nearestTarget, type Hour, type Tally, type Target } from './rules';
import { aimRate, slidOff, sticksWidth, turnRate, zoneAt, type Layout, type Zone } from './pad';
import { furnish } from './world';
import type { Shade } from '@/prologue/models';
import { windTo, type Weather } from '@/render/climate';
import type { CityPrecip } from '@/render/city/precip';
import type { Quality } from '@/render/quality';

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
  /** Подробность лепки по ступени, с которой сцена встаёт (`beasts.Detail`): зовётся один раз, до `build`. */
  dress?(tier: Tier): void;
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
  /** Палец лёг на кнопку действия (её половина экрана, `pad.ZONES`, или пробел): тянуть тетиву, замах, подсечка. */
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
  /** Пошла одна из последних секунд (`LAST_TICKS`): стукнуть. */
  tick?(): void;

  // Руки (docs/minigames.md, 18.1, `pad.ts`): палец движения с одной стороны, кнопка действия — с другой.

  /** Как разложены руки: обход (по умолчанию), лук, удочка. */
  readonly layout?: Layout;
  /** Что на кнопке действия у лука и удочки: подпись, можно ли сейчас, держат ли её и держат ли сейчас. */
  act?(): ActView;
  /** Подпись кнопки обхода, когда рядом нечего тронуть: «Собрать», «Взять охапку». */
  rest?(): string;
  /** Натянут ли лук: палец движения вверх-вниз — прицел, а не шаг. */
  aiming?(): boolean;
  /** Палец движения вбок, −1..1, каждый кадр: удочке — удилище против рывка. */
  pad?(strafe: number, t: number): void;
  /** Сколько удач подряд — ячейке серии; нет серии у игры — не зовётся. */
  streak?(): number;

  // «Рыбалка» (docs/minigames.md, 17): взгляд ведёт сама игра, у прицела — шкала.

  /** Взгляд, который ведёт игра: куда смотреть в этот кадр (за поплавком, за рыбой); `null` — ведёт игрок. */
  lead?(yaw: number, pitch: number, dt: number): { yaw: number; pitch: number } | null;
  /** Шкала у прицела: сила заброса или натяжение лески, 0..1, и в красной ли она. `null` — шкалы нет. */
  gauge?(): { mode: 'cast' | 'line'; k: number; warn: boolean } | null;
  /** Что делать сейчас — строка внизу, когда тапом трогать нечего. */
  cue?(): string;
}

export type Phase = 'brief' | 'play' | 'done';

/** Кнопка действия: подпись, можно ли сейчас, держат ли её (тетива, замах, катушка) и держат ли сейчас. */
export interface ActView {
  label: string;
  ready: boolean;
  hold: boolean;
  on: boolean;
}

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
  /** Что делать сейчас (`Play.cue`); нет — пусто. */
  cue: string;
  /** Кнопка действия. */
  act: ActView;
  /** Сколько удач подряд (`Play.streak`); нет серии — ноль. */
  streak: number;
  /** Брал ли игрок палец движения и кнопку — подписи-указатели первого входа гаснут по делу. */
  used: { pad: boolean; act: boolean };
}

/** Ступени промыслов — те же, что у поляны (`look.TIERS`): что умеет устройство, то и первая. */
export const MINI_LOOK_KEY = 'tribe.minigames.look';

/**
 * Плотность буфера по ступени: телефону — не выше полутора, полу — не выше 1,25. Цель — шестьдесят кадров, а не
 * тридцать, как у поляны: за неё платят точками, а не видом. Меньше единицы — мыло, а не экономия (`render/loop`).
 */
export const DPR_OF: Record<Tier, number> = { full: 2, lite: 1.5, base: 1.25 };


/** Снег на ветках зимой — сколько, 0..1: та же мера, что у поляны в зиму (`scene.WINTER_SNOW`). */
const WINTER_SNOW = 0.6;

/** Туман материалов у пола: та же дымка, что у поляны. */
const FOG_NEAR = 12;
const FOG_FAR = 50;

/** Сколько стоит отклик тапа на экране, мс сцены. */
const NOTE_MS = 1400;

/** Как часто пересобирать надпись, мс: секунды отсчёта и подпись прицела. */
const VIEW_EVERY = 100;

/** Сколько последних секунд стучит отсчёт. */
export const LAST_TICKS = 5;

/**
 * Свет часа промысла (docs/minigames.md, 18): доля круга солнца для рига. Утро — свой час каждой игры (`Play.solar`,
 * подобранный снимками); день — солнце высоко; вечер — низкое золото; ночь — глубокие сумерки под луной: темнее, но
 * оленя на сорока метрах и поплавок ещё видно. Сторона, откуда светит, — та же, что утром (`lighting.keyHolding`):
 * берег рыбалки повёрнут к солнцу, охотник стоит к нему спиной в любой час.
 */
export const HOUR_SOLAR: Record<Exclude<Hour, 'dawn'>, number> = { day: 0.21, dusk: 0.43, night: 0.52 };

/** Свет часа `hour` у игры с утренним часом `morning`. */
export const solarOf = (hour: Hour, morning: number): number => (hour === 'dawn' ? morning : HOUR_SOLAR[hour]);

/** Куда возвращается взгляд лучника, пока он идёт с опущенным луком: чуть ниже горизонта, рад. */
const BOW_REST_PITCH = -0.05;

/** Толчок взгляда на удачное действие, рад, и как быстро гаснет, с: рука дёрнула — голова чуть кивнула. */
const JOLT = 0.007;
const JOLT_S = 0.11;

/**
 * Ветер погоды города в траве и кронах: сила погоды 0..1 (`weather.wind`, средняя — 0.4) в размах качания материалов
 * поляны (`surface.u.wind`, у поляны — 0.6). Тот же множитель, что у звука ветра города (`ambience.mixOf`, `gust`):
 * средняя погода — прежние 0.6; штиль — едва колышет, буря — гнёт.
 */
export const windOf = (w: number): number => 0.6 * (0.45 + 1.375 * Math.max(0, Math.min(1, w)));

/** Погода, когда её не назвали: ясно, ветер средний. */
export const CALM: Weather = { cloud: 0, rain: 0, snow: 0, storm: 0, fog: 0, wind: 0.4, from: 270 };

/**
 * Хмурость неба промысла 0..1 — доля ненастья в свете, как у поляны (`prologue/sky.gloom`: дождь — 1, снег — 0.6):
 * тучи погоды города гасят солнце, дождь — до конца, снегопад — на ступень мягче. Сплошные тучи без дождя — 0.8.
 */
export const gloomOf = (w: Weather): number => Math.min(1, Math.max(0, 0.8 * w.cloud, 1.25 * w.rain, 0.75 * w.snow));

/**
 * Снег на ветках и земле, 0..1: зима, снег лежит у города (`climate.lyingSnow`) — мера поляны (`WINTER_SNOW`); идёт
 * снегопад — свежего больше. Не зима — снега нет: снегопад весной тает на лету.
 */
export const snowOf = (season: Season, cover: number, falling: number): number =>
  season === 'winter' ? Math.min(1, WINTER_SNOW * Math.max(0, Math.min(1, cover)) + 0.4 * Math.max(0, falling)) : 0;

/** Сырость материалов в дождь: та же мера, что у берега рыбалки до П-4. */
export const wetOf = (rain: number): number => Math.min(0.5, Math.max(0, rain) * 0.6);

/**
 * Какая доля дымки ненастья поляны (`look.mistAt`, у поляны в дождь — 0.06 на метр) ложится на промысел. Поляна —
 * двадцать шесть метров, а олень стоит до сорока (`hunt.FIELD_R`): полная дымка спрятала бы его вовсе. Треть с
 * небольшим — дождливый день туманнее ясного, а олень на сорока метрах виден больше чем на треть (`weather.test`):
 * добыча не меняется, правило задания.
 */
export const MIST_K = 0.35;

/** Осадки по ступени: та же мерка, что у города, — ступень промысла в уровень осадков (`precip.PRECIP_CAP`). */
export const PRECIP_OF: Record<Tier, Quality> = { full: 'high', lite: 'medium', base: 'low' };

/** Уровень воды по ступени (`render/water`): подробно — все октавы ряби, телефон — четыре и круги дождя, пол — две. */
export const WATER_OF: Record<Tier, number> = { full: 2, lite: 1, base: 0 };

/**
 * Коробка осадков у человека, м. Город берёт её от расстояния камеры — не меньше семидесяти метров, и смотрит на неё
 * снаружи, а промысел — изнутри: в кадр от первого лица попадает только та часть коробки, что перед глазами, и в
 * семидесяти метрах капли редели (снимки `EXTRA='&weather=rain'`). Сорок — капли у глаз и до двадцати метров, дальше
 * дождь — дымкой (`MIST_K`). Ближний слой — в восьми метрах перед глазами, как у города на ближней камере
 * (`PRECIP_DIST`).
 */
export const PRECIP_BOX = 40;
export const PRECIP_DIST = 78;

/**
 * Сплошное ненастье: с этой хмурости (`gloomOf`) солнце не даёт тени. Под тучей, из которой идёт дождь или снег, тени нет
 * при любой хмурости — серый день теней не даёт (как у поляны: в ненастье неба больше, чем солнца). Проход теней — второй
 * проход по всему, что отбрасывает тень, и его место занимают осадки (`budget.test`).
 */
export const OVERCAST = 0.7;

/** Тень солнца на ступени `tier` в погоду `w`. */
export const castsShadow = (tier: Tier, w: Weather): boolean => SHADOWS[tier] && w.rain <= 0.01 && w.snow <= 0.01 && gloomOf(w) < OVERCAST;

const DEG = Math.PI / 180;
const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const SKY_CLEAR = new THREE.Color(PALETTE.sky);
/** Небо ненастья — те же краски, что у поляны (`prologue/scene`): дождь серит его камнем, снег — дымом. */
const RAIN_TINT = new THREE.Color(PALETTE.stoneDark);
const SNOW_TINT = new THREE.Color(PALETTE.smoke);
const SNOW_WHITE = new THREE.Color(PALETTE.snowflake);
const TINT: [number, number, number] = [1, 1, 1];
const _bounce = new THREE.Color();
const _size = new THREE.Vector2();
const _dir = new THREE.Vector3();
const _center = new THREE.Vector3();

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
  /** Место замера кадров (docs/telemetry.md): промысел называет зовущий — сцена своего вида не знает. */
  measureAs(id: MinigameId): void {
    this.frameLoop.place = id;
  }
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
  /** Последняя показанная секунда отсчёта — стуку последних секунд. */
  private lastLeft = -1;
  /** Раскладка рук игры (`pad.ts`). */
  private layout: Layout;
  /** Палец на кнопке действия (половина `press`): один — рук две. Нажатие судит общий судья тапа. */
  private presser: Press | null = null;
  /** Палец увели с «Натянуть» (`pad.slidOff`): тетива уже ослаблена, и отпускание не стреляет. */
  private slid = false;
  /** Брал ли игрок палец движения и кнопку — подписи-указатели первого входа гаснут по делу. */
  private usedPad = false;
  private usedAct = false;
  /** Свет часа: доля круга солнца (`solarOf`). */
  private solar: number;
  /** Когда был толчок взгляда, мс кадра. */
  private joltAt = -1e9;

  /** Кому сказать, что надпись поменялась. */
  onView: ((v: StageView) => void) | null = null;
  /** Время вышло: игра кончилась. */
  onEnd: ((tally: Tally) => void) | null = null;
  /** Кружок пальца движения в своём углу (`.mg-pad`): палец ведёт его ручку, сцена — минуя React; второго кружка нет (Г-12). */
  private padEl: HTMLElement | null = null;
  /** Что уже записано в кружок: включён ли и где ручка. */
  private padAt = '';
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
  private gloom: number;
  private precip: CityPrecip | null = null;
  private disposed = false;
  private readonly windDir = new THREE.Vector2();

  constructor(
    private canvas: HTMLCanvasElement,
    private play: Play,
    private seconds: number,
    season: Season,
    /** Погода города на входе (`ui/parts/weather.weatherNow`); нет — ясно, ветер средний. */
    private weather: Weather = CALM,
    /** Час города (`rules.hourOf`): свет промысла. Нет — утро, свой час игры. */
    hour: Hour = 'dawn',
    /** Снег на земле у города, 0..1 (`weather.coverNow`): зимой на юге его может не быть вовсе. Нет — зима бела. */
    cover = season === 'winter' ? 1 : 0,
  ) {
    this.layout = play.layout ?? 'walk';
    this.solar = solarOf(hour, play.solar);
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
    // В дождь и туман край видимости придвигается — тем же счётом, что у города (`city/scene.weather`).
    const dim = Math.max(weather.rain, weather.snow);
    this.fog.near *= 1 - 0.25 * dim - 0.5 * weather.fog;
    this.fog.far *= 1 - 0.2 * dim - 0.35 * weather.fog;
    this.gloom = gloomOf(weather);
    // Куда сносит капли — та же сторона, что у города (`climate.windTo`).
    const to = windTo(weather.from);
    this.windDir.set(to.x, to.z);
    this.scene.fog = this.fog;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, play.far ?? 90);
    this.px = play.start.x;
    this.pz = play.start.z;
    this.yaw = play.start.yaw;
    this.rig = createLightRig(this.scene);
    const noonSun = this.rig.sun.intensity;
    const noonSky = this.rig.hemi.intensity * SKY_FILL * lum(_bounce.copy(this.rig.hemi.color).lerp(SKY_CLEAR, SKY_BLUE));
    fitShadow(this.rig, play.shadowHalf);
    // Край тени шире на полтора тексела: у телефонной ступени тень — PCF без мягкой полутени поляны, и тень куста в двух
    // шагах ложилась ступеньками по три сантиметра (снимок `b1`). Мягкая полутень `full` своего радиуса не читает.
    this.rig.sun.shadow.radius = 3.5;
    const tier = this.pickTier();
    this.post = new Post(this.renderer, tier);
    if (play.focus !== undefined) this.post.setFocus(play.focus);
    this.steady = new Steady<Tier>(TIERS, tier, VILLAGE_STEADY('high'));
    // Сезон города: цвета материалов — его; снег на ветках и земле — только зимой и тот, что лежит у города (`cover`),
    // снегопад его прибавляет; дождь мочит.
    this.seasonLook.jump(season);
    this.surfaces.u.snow.value = snowOf(season, cover, weather.snow);
    this.surfaces.u.wet.value = wetOf(weather.rain);
    this.surfaces.u.wind.value = windOf(weather.wind);

    // Лепка — по ступени входа: сторож потом опускает конвейер и плотность, а не перелепливает зверей посреди игры.
    play.dress?.(tier);
    furnish(this.scene, this.surfaces, play, this.camera, this.dome, season);
    this.scene.add(this.aim);
    this.applyLight(noonSun, noonSky);
    this.applyTier(tier);
    this.resize();
    this.wire();
    this.loop();
    this.frameLoop.restart();
    if (weather.rain > 0.01 || weather.snow > 0.01) this.loadPrecip(tier);
  }

  /**
   * Дождь и снег — осадки города (`render/city/precip`), его же куском (`LAZY_DOORS` «город: погода»): первая загрузка и
   * кусок промысла от них не растут, а ясный промысел их не тянет вовсе. Без поля высот и брызг: земля непрозрачна и
   * прячет каплю сама, в траве брызг не видно и в жизни, на воде у рыбалки — свои круги (`fishModels`, `wRain`). Не
   * пришёл кусок — промысел идёт без осадков: свет и сырость уже легли.
   */
  private loadPrecip(tier: Tier): void {
    import('@/render/city/precip')
      .then(({ CityPrecip }) => {
        if (this.disposed) return;
        const p = new CityPrecip(PRECIP_OF[tier], undefined, false);
        p.setLevel(PRECIP_OF[this.post.getTier()]);
        this.precip = p;
        this.scene.add(p.group);
      })
      .catch(() => undefined);
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
    this.presser = null;
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
    const now = performance.now();
    const zone: Zone = zoneAt(this.layout, p.x, p.w);
    if (zone === 'press') {
      // Кнопка действия — вся своя половина: тетиву, замах и катушку держат, подсечку жмут. Второй палец — мимо.
      if (this.presser) return;
      this.presser = new Press(e.pointerId, p.x, p.y, now);
      this.slid = false;
      if (this.phase === 'play') {
        this.usedAct = true;
        this.play.draw?.(this.t);
        this.refresh(true);
      }
      return;
    }
    // Палец движения ложится «в ходьбу», взгляд — «во взгляд»: ширина — то, чем `Sticks` делит экран (`pad.sticksWidth`).
    this.sticks.down(e.pointerId, p.x, p.y, now, sticksWidth(zone));
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const now = performance.now();
    if (this.presser?.id === e.pointerId) {
      this.presser.move(p.x, p.y, now);
      // Лук: палец увели с кнопки — тетива ослабевает без выстрела (отзыв тестеров 11.10). Удочку это не касается: её
      // замах и катушку держат, не глядя на кнопку.
      if (this.layout === 'bow' && !this.slid && slidOff(this.layout, this.presser.x, this.presser.y, p.x, p.y, p.w)) {
        this.slid = true;
        if (this.phase === 'play') this.play.loose?.(this.t, false);
        this.refresh(true);
      }
      return;
    }
    this.sticks.move(e.pointerId, p.x, p.y, now);
  };

  private onUp = (e: PointerEvent): void => {
    const now = performance.now();
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* захвата могло и не быть */
    }
    const pressed = this.presser?.id === e.pointerId ? this.presser : null;
    if (pressed) {
      this.presser = null;
      const label = this.actView().label;
      if (this.phase === 'play' && !this.slid) this.play.loose?.(this.t, true);
      this.slid = false;
      // Журналу — как судил бы тап: кнопку держат, и «долгое» здесь не потеря, а тетива.
      gestLog.add({
        where: 'промыслы',
        fingers: this.sticks.fingerCount + 1,
        ms: now - pressed.t,
        far: pressed.far,
        path: pressed.path,
        end: pressed.isTap(now) ? 'тап' : pressed.moved ? 'ведение' : 'долгое',
        hit: label || null,
        drift: null,
      });
      if (pressed.isTap(now)) swallowGhostClick();
      this.refresh(true);
      return;
    }
    const done = this.sticks.up(e.pointerId, now);
    if (!done) return;
    // Тап — кнопка обхода: она стоит в половине взгляда, и её судит тот же судья тапа. Палец движения не жмёт ничего.
    const button = done.half === 'look';
    const target = this.phase === 'play' && button ? this.target : null;
    gestLog.add({
      where: 'промыслы',
      fingers: this.sticks.fingerCount + 1,
      ms: now - done.press.t,
      far: done.press.far,
      path: done.press.path,
      end: done.tap && button ? (target ? 'тап' : 'мимо') : 'ведение',
      hit: done.tap && target ? target.verb : null,
      drift: null,
    });
    if (!done.tap || !button) return;
    swallowGhostClick();
    this.act();
  };

  private onCancel = (e: PointerEvent): void => {
    if (this.presser?.id === e.pointerId) {
      this.presser = null;
      if (this.phase === 'play') this.play.loose?.(this.t, false);
      return;
    }
    this.sticks.cancel(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e.target) || e.repeat) return;
    if (this.keys.down(e.code)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
      e.preventDefault();
      // У лука и удочки пробел — кнопка действия: держишь — тянешь, отпустил — выстрел (заброс, отдать леску).
      if (this.play.draw && e.code === 'Space') {
        if (this.phase === 'play') {
          this.usedAct = true;
          this.play.draw(this.t);
        }
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
    this.presser = null;
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
    this.usedAct = true;
    const said = this.play.tap(this.target, this.t);
    if (said) {
      this.note = said;
      this.noteUntil = performance.now() + NOTE_MS;
      // Отклик рукой — тот же, что у кнопок игры (`telegram/webapp.haptic`); вне Телеграма молчит. И голова кивнула.
      haptic('light');
      this.joltAt = performance.now();
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
    // В потерянный контекст кадр не рисуется (`render/context.contextLost`): событие о потере приходит позже самой потери.
    if (contextLost(this.renderer)) return;
    this.renderer.info.reset();
    this.post.render(this.scene, this.camera, this.light);
    this.watch(gap);
    this.meter(gap);
  };

  private step(dt: number, now: number): void {
    if (this.phase === 'play') {
      this.t += dt;
      if (this.t >= this.seconds) this.finish();
      const left = Math.ceil(this.seconds - this.t - 1e-6);
      if (left !== this.lastLeft) {
        this.lastLeft = left;
        if (this.phase === 'play' && left > 0 && left <= LAST_TICKS) this.play.tick?.();
      }
    }
    const live = this.phase === 'play';
    const look = this.sticks.takeLook();
    // Палец движения (`pad.ts`): вверх-вниз — шаг, а с натянутым луком — прицел; вбок — плавный поворот.
    const pad: Walk = live ? mergeWalk(this.sticks.walk(), this.keys.walk()) : { forward: 0, strafe: 0 };
    let walk: Walk = { forward: 0, strafe: 0 };
    if (live) {
      if (pad.forward !== 0 || pad.strafe !== 0) this.usedPad = true;
      const k = this.play.lookScale?.() ?? 1;
      const aiming = this.play.aiming?.() ?? false;
      this.yaw += (look.yaw + turnRate(pad.strafe) * dt) * k;
      let pitch = this.pitch + look.pitch * k;
      // Прицел — своей скоростью (`pad.AIM_RATE`, уже для натянутого лука); поворот натянутого — тише (`lookScale`).
      if (aiming) pitch += aimRate(pad.forward) * dt;
      else {
        walk = { forward: pad.forward, strafe: 0 };
        // Лучник с опущенным луком смотрит туда, куда идёт: взгляд сам сходит к горизонту.
        if (this.layout === 'bow' && pad.forward !== 0) pitch += (BOW_REST_PITCH - pitch) * (1 - Math.exp(-dt * 1.5));
      }
      this.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
      this.play.pad?.(pad.strafe, this.t);
      const lead = this.play.lead?.(this.yaw, this.pitch, dt);
      if (lead) {
        this.yaw = lead.yaw;
        this.pitch = THREE.MathUtils.clamp(lead.pitch, -PITCH_LIMIT, PITCH_LIMIT);
      }
    }
    const stride = this.play.stride?.() ?? 1;
    const speed = stride > 0 ? Math.hypot(walk.forward, walk.strafe) : 0;
    if (speed > 0) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const pace = WALK_SPEED * stride * dt;
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
    // Толчок взгляда на действие: короткий кивок вниз, гаснущий за доли секунды.
    const since = (now - this.joltAt) / 1000;
    const jolt = since < 0.6 ? JOLT * Math.sin(Math.min(1, since / 0.05) * Math.PI * 0.5) * Math.exp(-since / JOLT_S) : 0;
    this.camera.rotation.set(this.pitch - jolt, this.yaw, 0, 'YXZ');
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
    this.rain(now);
    this.stick();
    if (now - this.viewedAt >= VIEW_EVERY) {
      this.viewedAt = now;
      this.refresh(false);
    }
  }

  /** Осадки кадра: коробка — у человека, цвет капли — от дымки, сила и ветер — погоды входа. */
  private rain(now: number): void {
    const p = this.precip;
    if (!p) return;
    const w = this.weather;
    const day = this.light.zenith;
    _center.set(this.camera.position.x, 0, this.camera.position.z);
    p.update({
      t: now / 1000,
      rain: w.rain,
      snow: w.snow,
      windX: this.windDir.x,
      windZ: this.windDir.y,
      wind: w.wind,
      center: _center,
      dist: PRECIP_DIST,
      box: PRECIP_BOX,
      camera: this.camera,
      bufferHeight: this.renderer.domElement.height,
      light: Math.max(0.22, day),
      flash: 0,
      night: 0,
      sky: this.dome.haze,
      fogNear: this.fog.near,
      fogFar: this.fog.far,
    });
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
      cue: this.phase === 'play' ? (this.play.cue?.() ?? '') : '',
      act: this.actView(),
      streak: this.play.streak?.() ?? 0,
      used: { pad: this.usedPad, act: this.usedAct },
    };
    const a = v.act;
    const key = `${v.phase}|${v.left}|${v.tally.got}|${v.tally.total}|${v.tally.bonus ?? 0}|${v.verb}|${v.note}|${v.aside}|${v.cue}|${a.label}|${a.ready}|${a.on}|${v.streak}|${this.usedPad}|${this.usedAct}`;
    if (!force && key === this.shown) return;
    this.shown = key;
    this.onView?.(v);
  }

  /**
   * Кнопка действия: у лука и удочки — их подпись и состояние (`Play.act`); у обхода — что тронет тап рядом, а рядом
   * нечего — подпись покоя (`Play.rest`) и погасшая кнопка.
   */
  private actView(): ActView {
    const own = this.play.act?.();
    if (own) return own;
    const tg = this.phase === 'play' ? this.target : null;
    return { label: tg?.verb ?? this.play.rest?.() ?? '', ready: !!tg, hold: false, on: false };
  }

  /** Надпись сейчас — оболочке на первом кадре. */
  snapshot(): StageView {
    return {
      phase: this.phase,
      left: Math.ceil(this.seconds - this.t),
      tally: this.play.tally(),
      verb: '',
      note: '',
      aside: this.play.aside?.() ?? '',
      cue: '',
      act: this.actView(),
      streak: 0,
      used: { pad: false, act: false },
    };
  }

  /**
   * Прицел лука: натяжка — переменной `--draw`, метки дальности — сдвигом вниз от середины в точках экрана. Сдвиг —
   * тот же угол, что поправка дуги (`Play.pins`), через нынешний угол обзора: приблизил лук — метки разошлись.
   */
  private aimSync(): void {
    const el = this.aimEl;
    if (!el) return;
    if (this.play.gauge) {
      // Шкала удочки: сила заброса или натяжение лески — переменной `--k`, вид — `data-mode`, красная зона — `data-warn`.
      const g = this.play.gauge();
      const key = g ? `${g.mode}|${g.k.toFixed(2)}|${g.warn ? 1 : 0}` : '';
      if (key === this.aimShown) return;
      this.aimShown = key;
      el.dataset.mode = g?.mode ?? 'none';
      el.dataset.warn = g?.warn ? '1' : '0';
      el.style.setProperty('--k', (g?.k ?? 0).toFixed(2));
      return;
    }
    if (!this.play.drawn) return;
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

  /** Кружок пальца движения окна промысла (`.mg-pad`, его ручка — первый потомок); `null` — кружка на экране нет. */
  attachPad(el: HTMLElement | null): void {
    this.padEl = el;
    this.padAt = '';
  }

  /** Ручка кружка пальца движения — куда увели палец (`controls.padKnob`); кружок стоит в своём углу. */
  private stick(): void {
    const el = this.padEl;
    if (!el) return;
    const s = this.sticks.stick;
    const [dx, dy] = s ? padKnob(s) : [0, 0];
    const at = `${s ? 1 : 0} ${Math.round(dx)} ${Math.round(dy)}`;
    if (at === this.padAt) return;
    this.padAt = at;
    el.dataset.on = s ? '1' : '0';
    const knob = el.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
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
    // Не дороже уровня игры (`gfx.levelNow`): телефон, которому город поставил «Низкое», и на поляне — на полу.
    return miniTier(startTier({ hdr, coarse }, stored, asked), levelNow(window.location.search), !!asked && hdr);
  }

  /** Ступень: конвейер, туман материалов, тени, плотность буфера. Меняется редко — при входе и по сторожу. */
  private applyTier(tier: Tier): void {
    this.post.setTier(tier);
    this.precip?.setLevel(PRECIP_OF[tier]);
    lowerWaterLook(this.scene, WATER_OF[tier]);
    this.scene.fog = tier === 'base' ? this.fog : null;
    const shadows = castsShadow(tier, this.weather);
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
   * небо — доля рига цвета ясного зенита, снег отдаёт свет снизу, затвор привыкает к часу. Ненастье — поверх, как у
   * поляны: под тучами прямого солнца меньше, а доля неба возвращается к ригу — серый день теней не даёт. Без огня.
   */
  private applyLight(noonSun: number, noonSky: number): void {
    const solar = this.solar;
    // Час меняет высоту и цвет солнца, а не сторону: сторона — та, под которую поставлена игра (`Play.solar`).
    applyDayNight(this.rig, this.scene, solar, this.seasonLook, keyHolding(solar, this.play.solar));
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
    const g = this.gloom;
    sun.intensity *= 1 - 0.55 * g;
    this.rig.hemi.intensity *= 1 - 0.2 * g;
    const fillK = day * (1 - g);
    this.rig.hemi.intensity *= 1 - (1 - SKY_FILL) * fillK;
    this.rig.hemi.color.lerp(SKY_CLEAR, SKY_BLUE * fillK);
    const fall = sun.intensity * lum(sun.color) * Math.max(0, lamp.y) + this.rig.hemi.intensity * lum(this.rig.hemi.color);
    const bounce = (SNOW_BOUNCE * fall) / Math.max(0.05, this.rig.hemi.intensity);
    // Снег под ногами отдаёт свет только зимой: летом снизу светит трава рига.
    if (this.surfaces.u.snow.value > 0) this.rig.hemi.groundColor.lerp(_bounce.copy(SNOW_WHITE).multiplyScalar(bounce), day);
    this.dome.paint(tone, lamp, dark, g, this.weather.snow > this.weather.rain ? SNOW_TINT : RAIN_TINT);
    this.fog.color.copy(this.dome.haze);
    (this.scene.background as THREE.Color).copy(this.dome.horizon);
    const li = this.light;
    li.sunDir.copy(lamp);
    li.sun.copy(sun.color).multiplyScalar(sun.intensity * (day + 0.25 * dark));
    li.haze.copy(this.dome.haze).multiplyScalar(HAZE_GAIN * (0.35 + 0.65 * day));
    li.sunUp = Math.min(1, Math.max(0, (lamp.y + 0.02) / 0.12)) * day;
    li.air = airLit(Math.asin(Math.max(-1, Math.min(1, lamp.y))));
    li.zenith = day;
    mistAt(solar, MIST_K * Math.max(g, this.weather.fog), li.mist);
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
    this.disposed = true;
    this.frameLoop.stop();
    if (this.precip) {
      this.scene.remove(this.precip.group);
      this.precip.dispose();
      this.precip = null;
    }
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
