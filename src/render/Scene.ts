// 3D-сцена игры — общая оболочка. Своей картинки у неё нет: что рисовать, решает наследник — город
// (`render/city/scene.ts`, docs/city.md), единственный вид игры с 02.10.2026. Здесь то, что одно на любую
// картинку и выстрадано: потеря контекста и её лечение, возвращение из фона, сторож кадров и плавности, дверь
// кадра, общий судья пальца, панорама и щипок, значки внимания и кольцо выбора, одалживание холста ролику о
// бое. Получает состояние через sync(), анимирует сама.
import * as THREE from 'three';
import type { BuildingTypeId, GameState, Season } from '@/game/types';
import { dayFraction, seasonOf, solarPhase, type Attention } from '@/game/derived';
import { gameSeconds } from '@/game/pace';
import { SeasonVisuals } from './season';
import { configureRenderer, configureSky, createLightRig, type DayLight, type LightRig } from './lighting';
import { disposeGeometries } from './kit';
import { Gesture, Press, TAP_TARGET, WHEEL_STEP, swallowGhostClick } from '@/gestures';
import type { HitBox } from './pick';
import { FrameLoop, deviceRatio, pageHidden, pixelRatio } from './loop';
import { RESTORE_WAIT } from './context';
import { QUALITIES, QUALITY, VILLAGE_STEADY, autoQuality, qualityDpr, type Quality } from './quality';
import { autoCap, capQuality, deviceCaps, noteSceneLevel, rememberAutoCap } from './gfx';
import { Steady } from './steady';
import { serverNow } from '@/net/clock';
import { sceneLog, sizeNote, type Block, type Vitals } from '@/scenelog';
import { gestLog, type End } from '@/gestlog';

export interface BuildingView {
  /**
   * Опора постройки в сцене: к ней цепляется значок внимания, по её типу — касание и подсветка.
   * Модели у города свои и одни навсегда (docs/city.md, раздел 5): группа стоит на главном месте
   * постройки и своей геометрии не несёт.
   */
  group: THREE.Group;
  type: BuildingTypeId;
  marker: THREE.Sprite | null;
  markerKind: Attention | null;
  markerY: number;
}

const MARKER_GLYPH: Record<Attention, string> = { idle: '💤', order: '⚒️', slot: '👤', upgrade: '⬆️' };
const markerTextures = new Map<string, THREE.Texture>();

/**
 * Значок над крышей — малый значок листа на тёмной бляхе с кольцом цвета заботы (docs/ui_audit.md, «Новый интерфейс»:
 * значки над зданиями закрывали город). Прежний вид — эмодзи в янтарном кольце над любой заботой — удалён вместе с
 * прежним интерфейсом (docs/ui_audit.md, 16). Рисунки значков отдаёт интерфейс (`ui/GameCanvas`): сцена про лист
 * значков не знает.
 */
export interface MarkerArt {
  /** Разметка SVG значка листа по имени; `null` — значка нет (лист не приехал), стоит эмодзи. */
  svg(name: string): string | null;
}

let markerArt: MarkerArt | null = null;

/**
 * Над крышей — только беда, и у каждой свой значок листа и кольцо (решение владельца
 * 03.10.2026, docs/ui_audit.md, 12.8): никого нет на работе — красное, кузнецы без заказа — охра. «Можно улучшить»
 * и «есть свободное место» стояли над десятком крыш с первой минуты и закрывали город; построек без рабочих —
 * число на «Ратуше» внизу, а улучшения и места — в её списке (`ui/parts/TownBuild.tsx`). Чего здесь нет, над
 * крышей не стоит (`onRoof`).
 */
export const ROOF_NEW: Partial<Record<Attention, { icon: string; ring: string }>> = {
  idle: { icon: 'attn-idle', ring: '#d0644f' },
  order: { icon: 'job-smith', ring: '#d9a441' },
};

/** Стоит ли забота над крышей: только беда (`ROOF_NEW`). */
export const onRoof = (kind: Attention): boolean => ROOF_NEW[kind] !== undefined;

/** Отдать рисунки значков листа. Уже стоящие перерисовывает сцена (`TribeScene.restyleMarkers`). */
export function setMarkerArt(art: MarkerArt | null): void {
  markerArt = art;
  // Рисунки зависят от листа значков: приехал лист — бляхи рисуются заново.
  for (const tex of markerTextures.values()) tex.dispose();
  markerTextures.clear();
}

/** Разметка значка листа по имени — тем, кто пишет поверх холста разметкой (добыча города, `city/pops.ts`). */
export const markerSvg = (name: string): string | null => markerArt?.svg(name) ?? null;

/** Значок над крышей рисуется в канву (бляха, `plaque`). Только для заботы, что стоит над крышей (`onRoof`). */
function markerTexture(kind: Attention): THREE.Texture {
  let tex = markerTextures.get(kind);
  if (tex) return tex;
  // Зовут только после правила (`onRoof`): у заботы над крышей бляха есть всегда.
  const mark = ROOF_NEW[kind] as { icon: string; ring: string };
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  c.width = 64;
  c.height = 64;
  tex = new THREE.CanvasTexture(c);
  if (ctx) plaque(ctx, kind, mark, tex);
  tex.colorSpace = THREE.SRGBColorSpace;
  markerTextures.set(kind, tex);
  return tex;
}

/**
 * Бляха нового вида: тёмный круг, кольцо цвета заботы, в середине значок листа. Значок приезжает картинкой —
 * до неё стоит эмодзи, потом текстура перерисовывается сама.
 */
function plaque(ctx: CanvasRenderingContext2D, kind: Attention, mark: { icon: string; ring: string }, tex: THREE.Texture): void {
  const base = (): void => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(30, 22, 15, 0.9)';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mark.ring;
    ctx.lineWidth = 4;
    ctx.stroke();
  };
  base();
  ctx.font = '30px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(MARKER_GLYPH[kind], 32, 35);
  const svg = markerArt?.svg(mark.icon) ?? null;
  if (!svg || typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = (): void => {
    base();
    ctx.drawImage(img, 13, 13, 38, 38);
    tex.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Сколько ждём возвращения контекста WebGL, прежде чем пересобирать сцену. Срок один на все
 * холсты игры и записан у сторожа контекста (`render/context.ts`) вместе с обоснованием.
 */
export { RESTORE_WAIT };

/**
 * Живая сцена в приложении одна, а обучению нужна проекция здания в экранные
 * координаты — чтобы «дырка» в затемнении следовала за зданием при повороте камеры.
 */
let active: TribeScene | null = null;
export const activeScene = (): TribeScene | null => active;

/** Класс сцены игры: холст, плотность пикселей стенда и уровень качества. */
export type SceneClass = new (canvas: HTMLCanvasElement, pixelRatio?: number | null, opts?: SceneLook) => TribeScene;

/**
 * Сцена игры — город (docs/city.md): его класс едет своим куском и кладёт себя сюда, когда кусок приехал
 * (`main.tsx` везёт его до игры; не приехал — холст просит ещё раз, `ui/GameCanvas`). Другой сцены у игры
 * нет: оболочка своей картинки не рисует. Ключ — `game`, а не `city`: поле `.city` в исходниках — имя
 * поселения, и его читают только через очистку (`ui/cityname.test.ts`).
 */
export const SCENES: { game?: SceneClass } = {};

/** Уровень качества сцены. Игра передаёт выбор игрока (`gfx.sceneGfx`), стенд — адрес (`?quality=low`). */
export interface SceneLook {
  /**
   * `null` — по устройству (`quality.autoQuality`), но не выше того, до чего сторож
   * плавности опустил уровень на этом устройстве за неделю (`gfx.autoCap`); тогда же
   * сторож и следит. Заданный уровень (стенд, выбор игрока) сторож не трогает.
   */
  quality?: Quality | null;
}

/**
 * Имя видеокарты — единственное, что сцена спрашивает у браузера об устройстве сама (остальное — `gfx.deviceCaps`).
 * Под заглушкой GL (`tap:report`) имени нет, и это не ошибка: `null`.
 */
function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

export abstract class TribeScene {
  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera: THREE.PerspectiveCamera;
  protected rig: LightRig;
  /** Постройки партии: опора, значок и тип — по ним касание, подсветка и значки внимания. */
  protected buildings = new Map<number, BuildingView>();
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
  protected seasonVis = new SeasonVisuals();
  protected season: Season = 'spring';
  protected disposed = false;
  /** Канва и рендерер отданы ролику о бое: сцена молчит, пока их не вернут. */
  protected lent = false;
  protected selection: THREE.Mesh;
  protected selected: number | null = null;
  /**
   * Разбор жеста — общий с картой мира (`src/gestures.ts`). Он же и командует
   * камерой: пока `panning` говорит «нет», картинка не двигается ни на пиксель.
   * Жестов ровно два, и оба те же, что на карте: одним пальцем камера **водит**,
   * двумя — приближает. Поворота нет никакого (см. `city/camera.ts`).
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
   * Камера целиком: куда смотрит, под каким наклоном и с какого расстояния. Числа ставит
   * кадрирование наследника (`applyFraming`) в первом же `resize`; здесь — только их место.
   *
   * Держать их здесь, а не вычитывать обратно из позиции камеры, — то же
   * правило, что и везде: одно число живёт в одном месте. Позиция считается из
   * них (`place`), и обратного хода нет.
   */
  protected target = new THREE.Vector3();
  /** Наклон камеры: ставит кадрирование от аспекта, жест его не трогает. */
  protected polar = Math.PI / 4;
  /** Расстояние до цели — единственное, что меняет щипок. */
  protected dist = 1;
  /** Пол и потолок приближения — от кадрирования наследника. */
  protected zoom = { min: 1, max: 1 };
  /**
   * Шаг панорамы, который ещё движение пальца, а не вырождение у горизонта: у горизонта луч ложится
   * почти вдоль земли, и один пиксель даёт километры. Число — в единицах мира наследника.
   */
  protected abstract stepMax: number;
  /**
   * Автоповорот стенда: единственное место в игре, где камера вообще
   * поворачивается. Им меряют частоту кадров на телефоне (`?showcase=village&perf=8`),
   * и в жест он не превращается ничем — ни кнопкой, ни настройкой.
   */
  protected spinRate = 0;
  protected spinTurn = 0;
  /** После ручного движения камеру больше не переставляем. */
  protected userMoved = false;
  /** Уровень качества: выбор игрока, адрес стенда или устройство (`SceneLook.quality`). */
  readonly quality: Quality;
  /**
   * Уровень, чью плотность пикселей берёт буфер. Сначала — `quality`; сторож плавности,
   * опустив уровень, опускает плотность сразу (главная ручка цены кадра на телефоне), а
   * всё остальное — со следующего захода (`gfx.rememberAutoCap`).
   */
  protected dprLevel: Quality;
  /** Сторож плавности (`render/steady`) — только у уровня по устройству. */
  protected steady: Steady<Quality> | null = null;
  /** Что насчитал свет последнего кадра: доля дня и ночи. */
  protected light: DayLight = { daylight: 1, nightK: 0, dusk: 0 };
  /** Сцена встала и готова к снимку: стенд ждёт этого, прежде чем снимать. */
  abstract readonly ready: Promise<void>;
  /** Зовётся прямо перед render() — стенд меряет им время видеокарты на кадр. */
  beforeRender: (() => void) | null = null;

  /**
   * pixelRatio — принудительная плотность пикселей (стенд); по умолчанию — экрана,
   * в [1, 2]. Выше потолка двери кадра (`loop.DPR_CAP`) не бывает ни та, ни другая.
   */
  constructor(protected canvas: HTMLCanvasElement, protected pixelRatio: number | null = null, opts: SceneLook = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.quality = opts.quality ?? capQuality(autoQuality(deviceCaps(gpuName(this.renderer.getContext()))), autoCap(serverNow()));
    this.dprLevel = this.quality;
    // Карта, ролик и промысел берут уровень у города (`gfx.levelNow`): одна мерка на всю игру.
    noteSceneLevel(this.quality);
    if (!opts.quality) this.steady = new Steady(QUALITIES, this.quality, VILLAGE_STEADY);
    // На 3x-экранах третий пиксель не виден, а филлрейт растёт вдвое — отсюда потолок.
    this.renderer.setPixelRatio(this.dpr());
    configureRenderer(this.renderer);
    // Жёсткая тень на низком уровне: одна выборка карты вместо девяти (0 — BasicShadowMap;
    // числом, а не именем three: имя дописалось бы в первую загрузку).
    if (!QUALITY[this.quality].shadowSoft) this.renderer.shadowMap.type = 0;
    configureSky(this.scene);
    // Честный счёт вызовов: при autoReset счётчик сбрасывается после теневого
    // прохода, и stats() занижал бы бюджет вдвое. Сбрасываем сами перед кадром.
    this.renderer.info.autoReset = false;
    // Теневой проход через кадр: двигаются только фигурки, отставание тени на кадр не видно.
    this.renderer.shadowMap.autoUpdate = false;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);

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
     * держит щипок в пределах `zoom`. Класс убран целиком — держать его ради двух
     * строк значило бы оставить в камере рычаг, которого никто не дёргает.
     *
     * Панораму и наезд ведёт сцена от общего с картой разбора жеста
     * (`src/gestures.ts`), позицию камеры считает `place()`.
     */
    // Прокрутку страницы под холстом гасим сами: полагаться теперь не на кого.
    canvas.style.touchAction = 'none';

    // Карту теней своего размера ставит наследник: размер — его число уровня.
    this.rig = createLightRig(this.scene);

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

  /**
   * Мир встал целиком: его сборка больше не отнимает у кадра своих миллисекунд. До того сторож
   * плавности кадров не судит — сборка не цена уровня.
   */
  protected abstract settled(): boolean;

  /**
   * Сторож плавности: судит кадры, только когда мир уже стоит (`settled`: сборка отнимает
   * у кадра свои миллисекунды — это не цена уровня) и холст не одолжен ролику. Опустил —
   * плотность сразу, остальное — со следующего захода: уровень помнится неделю
   * (`gfx.rememberAutoCap`), и следующая сцена встаёт уже на нём.
   */
  protected watch(gap: number): void {
    if (!this.steady || !this.settled()) return;
    const next = this.steady.feed(gap);
    if (!next) return;
    this.dprLevel = next;
    this.needSize = true;
    rememberAutoCap(next, serverNow());
    noteSceneLevel(next);
  }

  protected dpr(): number {
    // Плотность своего уровня качества — не выше экрана (или той, что задал стенд вместо
    // экрана) и не выше потолка двери кадра.
    return pixelRatio(qualityDpr(this.dprLevel, this.pixelRatio ?? deviceRatio()));
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
   * Кадрирование от аспекта: поле зрения, наклон, пол и потолок приближения, стартовые цель и
   * расстояние. Числа — наследника (у города — `city/camera.cityFraming`).
   */
  protected abstract applyFraming(aspect: number): void;

  /**
   * Поставить камеру по своим числам: цель, наклон, расстояние и единственный
   * на игру азимут. Второго способа сдвинуть камеру в сцене нет — всё, что
   * двигает обзор, правит эти числа и зовёт `place`. Матрицы камеры обновляются здесь же,
   * а не ждут кадра: ими считают луч под палец и области попадания между кадрами.
   */
  protected abstract place(): void;

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
   *    рендера нет ни одной (мир города собирается заново на каждую сцену).
   *    Поэтому обход всего графа безопасен.
   * 2. **Материалы спрайтов.** Маркеры внимания создают `SpriteMaterial` на
   *    каждый маркер, а текстура под ним общая и кэшируется по виду тревоги.
   *    Материал — наш, его убираем; текстуру не трогаем, она переживёт сцену.
   *    Материалы и текстуры мира отдаёт наследник (ниже), а модульные (если
   *    появятся) трогать нельзя: следующая сцена возьмёт те же и получит мёртвые.
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
   *
   *    Картинка наследника (мир, материалы, текстуры, потоки сборки) отдаёт своё сама — до
   *    этого вызова (`CityScene.dispose`); здесь обходится то, что осталось в графе.
   */
  dispose(): void {
    this.disposed = true;
    if (active === this) active = null;
    this.beat.stop();
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
    this.scene.clear();

    // Ссылки на подсистемы рвутся, чтобы граф не держался за них через сцену.
    this.buildings.clear();

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
   * Привязка к миру: без неё панорама одним пальцем уводит в пустой лес. Цель возвращается на
   * поводок, а камера считается из неё заново — ракурс от этого не дёргается, потому что угол и
   * расстояние привязкой не трогаются. Зовётся там, где сцена двигает камеру (`shift`). Поводок —
   * наследника (у города — `city/camera.cityLeash`).
   */
  protected leash = (): void => {};

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
   * Здание под пальцем: id постройки или null. Цель выбирается на нажатии, а не на отпускании
   * (`onPointerDown`). Как судить — дело наследника: у города луч в коробки мест и раздутие мелких
   * до пальца (`city/pick.ts`), промах прощается до `TAP_FORGIVE`, тап в чистое поле — ничего.
   */
  protected abstract pickAt(clientX: number, clientY: number): number | null;

  protected toNdc(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((clientY - rect.top) / rect.height) * 2 - 1),
    };
  }

  /**
   * Область попадания здания на экране — не меньше пальца (`TAP_TARGET`). Источник тот же, что у
   * тапа: «дырка» подсветки обучения обязана стоять ровно там, куда попадёт палец.
   */
  protected abstract hitBoxOf(id: number): HitBox | null;

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

  /** Подсветка стены: у неё нет одного места, обучению нужен контур целиком. */
  protected abstract wallSpot(id: number): HitBox | null;

  /** Кольцо выбора у открытой постройки; null — снять. */
  abstract setSelected(id: number | null): void;

  // ---------- Синхронизация с состоянием ----------

  /**
   * Игрок вернулся и закрыл окно «С возвращением»: показать добычу отлучки — `gameSec` игровых секунд. Отклик есть у
   * города (`city/scene.ts`); у сцены без него — ничего.
   */
  welcome(_gameSec: number): void {}

  /**
   * Регион игрока (`world/theatre`, имя в коде): по нему погода над городом (docs/city.md, 15). Зовёт игра, когда мир
   * назвал клетку города; сцене без погоды — ничего.
   */
  setRegion(_region: string | null): void {}

  /**
   * Рисунки значков сменились (`setMarkerArt`): стоящие значки перерисовываются тем же видом заботы. Помнится забота,
   * а не значок: забота, которой над крышей не место (`onRoof`), значка не получает.
   */
  restyleMarkers(): void {
    for (const view of this.buildings.values()) {
      const kind = view.markerKind;
      view.markerKind = null;
      this.setMarker(view, kind);
    }
  }

  protected setMarker(view: BuildingView, kind: Attention | null): void {
    if (view.markerKind === kind) return;
    view.markerKind = kind;
    if (view.marker) {
      view.group.remove(view.marker);
      view.marker = null;
    }
    if (!kind || !onRoof(kind)) return;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: markerTexture(kind), depthTest: false, transparent: true, toneMapped: false }),
    );
    sprite.scale.setScalar(0.9);
    sprite.position.y = view.markerY;
    sprite.renderOrder = 6;
    view.group.add(sprite);
    view.marker = sprite;
  }

  /**
   * Состояние партии пришло. Время и сезон — общие на любую картинку; что из партии рисовать, —
   * дело наследника (`syncWorld`).
   */
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
    this.syncWorld(s);
  }

  /** Постройки, значки и всё, что картинка берёт из партии. */
  protected abstract syncWorld(s: GameState): void;

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
    // Считается кадр лупа, а не кадр картинки: одолженная ролику канва рисуется
    // им, и «кадры идут» тут значит именно то, что цепочка жива.
    this.drawn++;
    const now = performance.now();
    const gap = now - this.lastFrame;
    this.lastFrame = now;
    // Отложенный пересчёт — первым же кадром: холст мог вернуться из фона
    // нулевым, и тогда его размер надо взять при первой возможности.
    if (this.needSize || this.drawn % 60 === 0) this.checkSize();
    const dt = Math.min(0.1, this.clock.getDelta());
    // Канва отдана ролику о бое: он рисует в неё сам, сцене тут делать нечего.
    if (this.lent) return;
    this.watch(gap);
    const t = this.clock.elapsedTime;

    // Между пульсами время партии тянется само — настоящие секунды переводит в игровые
    // дверь времени. Прежде здесь стояли настоящие секунды как игровые: между пульсами
    // солнце бежало в тридцать раз быстрее и на каждом пульсе отскакивало назад.
    const gameNow = this.gameTime + gameSeconds((now - this.gameTimeAt) / 1000);
    // Сезон переливает палитру сам, а фаза солнца уже учитывает длинную зимнюю ночь.
    this.seasonVis.update(this.season, dt);
    this.applyDayNight(solarPhase(dayFraction(gameNow), this.season));
    this.animate(dt, t);
    // Кольцо выбора дышит — взгляд цепляется без лишних цветов.
    if (this.selection.visible) {
      (this.selection.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.25;
    }

    // Камера сама по себе не двигается: её ведёт палец. Крутится она ровно в
    // одном случае — под замером частоты кадров на стенде.
    if (this.spinRate !== 0) {
      this.spinTurn += this.spinRate * dt;
      this.place();
    }
    this.renderer.info.reset();
    // Теневой проход через кадр (на низком — раз в четыре, `QUALITY.shadowEvery`): двигаются только фигурки,
    // отставание тени на кадр не видно.
    this.renderer.shadowMap.needsUpdate = this.frameNo++ % QUALITY[this.quality].shadowEvery === 0;
    this.beforeRender?.();
    this.renderer.render(this.scene, this.camera);
    this.afterRender?.();
  }

  /** Анимация картинки за кадр: `dt` — шаг, `t` — часы сцены. Рисует оболочка. */
  protected abstract animate(dt: number, t: number): void;

  /** Свет за временем суток. solar: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь. */
  protected abstract applyDayNight(solar: number): void;

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

  /** Память текстур, байты: карта теней и текстуры мира. Счёт, а не догадка: размеры знает сама сцена. */
  abstract textureBytes(): number;

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
}
