/**
 * Дверь окна: какой высоты игра и когда это пересчитать.
 *
 * Высота всего приложения — одна переменная `--app-h` (`.app` в `ui/styles.css`), и
 * пишет её только эта дверь. Под ней раскладываются шапка, нижняя панель, шторки и
 * обёртки всех холстов: холсты меряют свой элемент (ResizeObserver), а элемент — это
 * `--app-h`. Ошибись она — ошибутся все разом.
 *
 * ЖАЛОБА (04.10.2026, Android, Телеграм, экран карты): свернул аппку, развернул —
 * нижняя панель карты («К себе», «Походы», «Город»…) стоит вверху под шапкой
 * Телеграма, ниже тёмная пустота, карты нет; помогает только перезапуск.
 *
 * ПРИЧИНА. Высота бралась меньшим из двух чисел — окна и `viewportStableHeight`
 * Телеграма. Устоявшуюся высоту SDK Телеграма обновляет только по событию клиента с
 * `is_state_stable`, а своё слежение за окном снимает с первым же событием клиента
 * (telegram-web-app.js, `onViewportChanged`). Свёрнутая аппка — полоска высотой с
 * заголовок; клиент, назвавший её высоту устоявшейся, при разворачивании может
 * прислать только промежуточные высоты анимации или не прислать ничего. Тогда
 * `viewportStableHeight` навсегда остаётся высотой полоски, «меньшее из двух» берёт
 * её, и приложение сжимается в полоску: нижняя панель встаёт к верху, обёртка карты —
 * в ноль (полотно стоит причиной `covered`), а ниже виден только фон страницы.
 * Воспроизведено стендом (`npm run revive:report`, раздел «Свернули и развернули»):
 * настоящего сворачивания вебвью Телеграма из браузера не устроить, и что именно
 * присылает клиент на телефоне владельца, не измерено — поэтому закрыты все
 * последовательности событий, которые дают ту же картину.
 *
 * ПРАВИЛО (`appHeight`) — четыре строки, и порядок их — их важность:
 *
 *  1. **Правда о высоте — окно** (`innerHeight`). Вебвью и есть видимая область: его
 *     размер браузер держит сам, при повороте, клавиатуре и возвращении из фона.
 *  2. **Окно нулевое — держится прежняя высота.** Вебвью, вернувшийся из фона, отдаёт
 *     ноль на кадр-другой (docs/scene-revive.md, раздел 4); раскладка в ноль — та же
 *     поломка, что и в полоску.
 *  3. **Телеграм может окно только обрезать, и только свежим числом** — сказанным после
 *     последнего сворачивания или разворачивания, пока аппку видно. Сказанное до него —
 *     про другое окно.
 *  4. **И не больше чем на четверть** (`TG_CUT_MAX`). Столько отнимает шапка клиента;
 *     больше — только полоска свёрнутой аппки или лист, не развёрнутый до конца, а это
 *     не та высота, под которую раскладывают игру: аппка разворачивается сама
 *     (`expand` при запуске и при каждом возвращении).
 *
 * ПЕРЕСЧЁТ — НЕ С ОДНОЙ ПОПЫТКИ. После разворачивания вебвью доезжает до своего
 * размера не сразу, а события о размере то приходят, то нет. Поэтому дверь меряет
 * сразу и ещё несколько раз в первые полторы секунды (`SETTLE`) — чтение `innerHeight`
 * ничего не стоит, а записывается и рассылается только перемена.
 *
 * Кто узнаёт о перемене. Холсты, мерящие свой элемент, узнают сами (ResizeObserver);
 * подписка `onViewport` — для того, что элементом не меряется (плотность пикселей), а
 * `onReturn` — для того, что пережило фон и само о себе не скажет: работы потока выпечки
 * карты и испечённое ею.
 *
 * Модуль без React и three. Правила — класс `ViewportDoor` с внешним окружением
 * (`ViewportEnv`), как часы у `FrameLoop`: так «свернули — развернули» проверяется
 * тестом на настоящем коде (`viewport.test.ts`), а не его описанием. Лежит в корне
 * `src/`, как `gestures.ts` и `scenelog.ts`: пользуются им обёртка Телеграма, сцена,
 * карта и оболочка, и ничьим он быть не должен.
 */
import { sceneLog } from '@/scenelog';
import { awayNow, deviceRatio, watchAway } from '@/render/loop';

// ---------- Правило ----------

/**
 * На какую долю окна Телеграм вправе его обрезать. Четверть: шапка клиента с вырезом
 * — до сотни пикселей, это меньше пятой части даже у телефона, повёрнутого набок
 * (360 px). Полоска свёрнутой аппки отнимает почти всё окно — её число отсекается.
 */
export const TG_CUT_MAX = 0.25;

/**
 * Когда после возвращения мерить ещё раз, мс от возвращения. Вебвью доезжает до
 * размера за кадр-другой, поворот — за несколько сотен миллисекунд; полторы секунды
 * покрывают и то и другое с запасом. Чаще незачем: перемену каждой из попыток
 * подхватывает и событие `resize`, а попытки — на тот случай, когда его не будет.
 */
export const SETTLE: readonly number[] = [0, 60, 200, 500, 1000, 1500];

/** Что Телеграм сказал о высоте — с пометкой, свежее ли это. */
export interface TgSeen {
  /** Последняя высота, какой бы она ни была (`viewportHeight`). */
  height: number;
  /** Последняя устоявшаяся (`viewportStableHeight`). */
  stable: number;
  /** Сказано после последнего сворачивания или разворачивания, пока аппку видно. */
  fresh: boolean;
}

/**
 * Высота приложения, CSS-пиксели. `null` — мерить нечего, держать прежнюю.
 *
 * @param win высота окна (`innerHeight`);
 * @param tg  что сказал Телеграм; `null` — вне Телеграма.
 */
export function appHeight(win: number, tg: TgSeen | null): number | null {
  if (!(win > 0)) return null;
  const whole = Math.round(win);
  if (!tg || !tg.fresh) return whole;
  // Из двух чисел Телеграма берётся большее: устоявшееся отстаёт от анимации
  // разворачивания, и меньшее из них — всегда прошлое.
  const seen = Math.max(tg.height > 0 ? tg.height : 0, tg.stable > 0 ? tg.stable : 0);
  if (seen >= win || seen < win * (1 - TG_CUT_MAX)) return whole;
  return Math.round(seen);
}

// ---------- Дверь ----------

export interface Inset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Что дверь спрашивает у Телеграма. Обёртка (`telegram/webapp.ts`) отдаёт сам
 * `WebApp` — свой тип он покрывает целиком.
 */
export interface TgWindow {
  viewportHeight: number;
  viewportStableHeight: number;
  /** Bot API 8.0: вырезы устройства (чёлка, home indicator). */
  safeAreaInset?: Inset;
  /** Bot API 8.0: отступ от шапки мини-аппки внутри безопасной зоны. */
  contentSafeAreaInset?: Inset;
}

/** Окно, каким его раскладывает игра. */
export interface ViewSize {
  /** Ширина окна, CSS-пиксели. */
  w: number;
  /** Высота приложения (`--app-h`), CSS-пиксели. */
  h: number;
  /** Плотность экрана как есть — потолок ставит каждый буфер сам (`loop.pixelRatio`). */
  dpr: number;
}

/** Окружение двери. В игре — браузер (`browserEnv`), в тесте — подделка. */
export interface ViewportEnv {
  /** Окно как есть: ширина, высота, плотность. */
  window(): ViewSize;
  /** Телеграм; `null` — вне Телеграма. */
  tg(): TgWindow | null;
  /** Кадров не должно быть: страница скрыта или аппку свернули (дверь кадра). */
  away(): boolean;
  /** Записать высоту приложения. */
  writeHeight(h: number): void;
  /** Записать вырезы Телеграма. */
  writeInsets(top: number, bottom: number, left: number, right: number): void;
  /** Отложенный вызов; возвращает отмену. */
  later(ms: number, cb: () => void): () => void;
  /** Попросить клиент прислать вьюпорт заново и развернуть аппку. */
  ask(): void;
  /** Запись в журнал сцены. */
  note(text: string): void;
}

const px = (n: number | undefined): number => Math.max(0, Math.round(n ?? 0));

export class ViewportDoor {
  private size: ViewSize = { w: 0, h: 0, dpr: 0 };
  /** Телеграм говорил с последнего сворачивания или разворачивания. */
  private fresh = false;
  private settling: (() => void)[] = [];
  private subs = new Set<(size: ViewSize) => void>();
  private backs = new Set<() => void>();
  private insets = '';

  constructor(private env: ViewportEnv) {}

  /** Как разложено сейчас. До первого замера — нули. */
  get current(): ViewSize {
    return this.size;
  }

  /**
   * Подписаться на перемену. Зовётся после записи `--app-h`, то есть когда раскладка
   * уже новая. Возвращает отписку — подписка без отписки держала бы выгруженный холст.
   */
  subscribe(cb: (size: ViewSize) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /**
   * Перемерить сейчас. Пишет и рассылает только перемену: звать можно сколько
   * угодно раз, с любого события.
   */
  measure(why: string): void {
    const win = this.env.window();
    const app = this.env.tg();
    this.writeInsets(app);
    const tg: TgSeen | null = app ? { height: app.viewportHeight, stable: app.viewportStableHeight, fresh: this.fresh } : null;
    const h = appHeight(win.h, tg);
    if (h === null) {
      this.env.note(`${why}: окно ${win.w}×${win.h} — нулевое, держим ${this.size.h}`);
      return;
    }
    const next: ViewSize = { w: Math.round(win.w), h, dpr: win.dpr };
    const was = this.size;
    if (next.w === was.w && next.h === was.h && next.dpr === was.dpr) return;
    this.size = next;
    this.env.writeHeight(h);
    const said = tg ? `, телеграм ${Math.round(tg.height)}/${Math.round(tg.stable)}${tg.fresh ? '' : ' (прошлое)'}` : '';
    this.env.note(`${why}: ${next.w}×${h} @${next.dpr} (окно ${Math.round(win.h)}${said})`);
    for (const cb of [...this.subs]) cb(next);
  }

  /**
   * Подписаться на возвращение: аппку развернули или страница снова видна. Зовётся после
   * первого замера, то есть при уже новой раскладке. Это для того, что пережило фон и само
   * о себе не скажет, — испечённое, работы потока. Возвращает отписку.
   */
  subscribeBack(cb: () => void): () => void {
    this.backs.add(cb);
    return () => this.backs.delete(cb);
  }

  /** Телеграм прислал высоту. Свежей она считается, только если аппку видно. */
  told(why = 'телеграм'): void {
    if (!this.env.away()) this.fresh = true;
    this.measure(why);
  }

  /**
   * Аппку свернули или развернули, страница скрылась или вернулась. Всё, что
   * Телеграм говорил раньше, — про другое окно.
   */
  turned(away: boolean): void {
    this.fresh = false;
    if (away) {
      this.cancelSettle();
      return;
    }
    this.wake('развернули');
    for (const cb of [...this.backs]) cb();
  }

  /**
   * Вернулись: перемерить сразу и ещё несколько раз, пока вебвью доезжает до своего
   * размера (`SETTLE`), и попросить клиент сказать высоту заново.
   */
  wake(why: string): void {
    this.cancelSettle();
    this.env.ask();
    for (const ms of SETTLE) {
      if (ms === 0) this.measure(why);
      else this.settling.push(this.env.later(ms, () => this.measure(`${why} +${ms} мс`)));
    }
  }

  private cancelSettle(): void {
    for (const cancel of this.settling) cancel();
    this.settling = [];
  }

  /**
   * Вырезы Телеграма — в `--tg-*`; в CSS они складываются с `env()`, поэтому вне
   * Телеграма и у старых клиентов работает `safe-area-inset-*`.
   */
  private writeInsets(app: TgWindow | null): void {
    const safe = app?.safeAreaInset;
    const content = app?.contentSafeAreaInset;
    if (!safe && !content) return;
    const top = px((safe?.top ?? 0) + (content?.top ?? 0));
    const bottom = px((safe?.bottom ?? 0) + (content?.bottom ?? 0));
    const left = px((safe?.left ?? 0) + (content?.left ?? 0));
    const right = px((safe?.right ?? 0) + (content?.right ?? 0));
    const key = `${top},${bottom},${left},${right}`;
    if (key === this.insets) return;
    this.insets = key;
    this.env.writeInsets(top, bottom, left, right);
  }
}

// ---------- Дверь игры ----------

/** Телеграм, поставленный обёрткой; вне Телеграма — `null`. */
let tgApp: TgWindow | null = null;
/** Как попросить клиент о вьюпорте — даёт обёртка Телеграма, она знает его слова. */
let askTg: () => void = () => undefined;

const browserEnv = (): ViewportEnv => ({
  window: () => ({
    w: window.innerWidth || document.documentElement.clientWidth || 0,
    h: window.innerHeight || document.documentElement.clientHeight || 0,
    dpr: deviceRatio(),
  }),
  tg: () => tgApp,
  away: awayNow,
  writeHeight: (h) => document.documentElement.style.setProperty('--app-h', `${h}px`),
  writeInsets: (top, bottom, left, right) => {
    const root = document.documentElement.style;
    root.setProperty('--tg-top', `${top}px`);
    root.setProperty('--tg-bottom', `${bottom}px`);
    root.setProperty('--tg-left', `${left}px`);
    root.setProperty('--tg-right', `${right}px`);
  },
  later: (ms, cb) => {
    const id = window.setTimeout(cb, ms);
    return () => window.clearTimeout(id);
  },
  ask: () => askTg(),
  note: (text) => sceneLog.mark('app', text),
});

let door: ViewportDoor | null = null;

/** Дверь игры; заводится с первым вопросом и живёт до конца страницы. */
function theDoor(): ViewportDoor {
  if (door) return door;
  const d = new ViewportDoor(browserEnv());
  door = d;
  // Без окна (тесты в node, где кусок карты подписывается при загрузке) слушать нечего.
  if (typeof window === 'undefined') return d;
  const measure = (why: string) => () => d.measure(why);
  const wake = (why: string) => () => d.wake(why);
  window.addEventListener('resize', measure('окно'));
  // Поворот отдаёт размер не сразу — меряем с попытками.
  window.addEventListener('orientationchange', wake('поворот'));
  // Клавиатура и щипок меняют видимую область мимо `resize` у части клиентов.
  window.visualViewport?.addEventListener('resize', () => {
    d.measure('видимая область');
    settleScroll();
  });
  // Возвращения, которых дверь кадра не видит: страница из кэша, разморозка.
  window.addEventListener('pageshow', wake('pageshow'));
  document.addEventListener('resume', wake('resume'));
  // Скрылась или вернулась страница, свернули или развернули аппку, палец на экране
  // свёрнутой — всё это дверь кадра уже свела в одно «кадров нет / снова есть».
  watchAway((away) => d.turned(away));
  document.addEventListener('focusout', () => settleScroll());
  return d;
}

/**
 * Клавиатура закрылась, а страница осталась прокрученной (iOS прокручивает документ
 * к полю ввода даже при `overflow: hidden` и не всегда возвращает): `.app` стоит
 * `position: fixed`, и вся раскладка при этом съезжает. Возвращается в ноль, только
 * когда поля в фокусе нет — иначе это и есть прокрутка к полю.
 */
function settleScroll(): void {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return;
  const scrolled = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop;
  if (scrolled) window.scrollTo(0, 0);
}

/**
 * Завести дверь игры. Зовёт обёртка Телеграма при запуске, вне Телеграма — без него.
 *
 * @param app Телеграм — его высоты и вырезы; без него правда только окно;
 * @param ask как попросить клиент прислать вьюпорт заново и развернуть аппку.
 */
export function startViewport(app: TgWindow | null = null, ask: () => void = () => undefined): void {
  tgApp = app;
  askTg = ask;
  theDoor().measure('запуск');
}

/** Телеграм прислал высоту, вырезы или полноэкранность. */
export function tgViewportChanged(why: string): void {
  theDoor().told(why);
}

/** Перемерить сейчас — тому, кто сейчас будет мерить свой холст. */
export function measureViewport(why: string): void {
  theDoor().measure(why);
}

/** Вернулись — перемерить с попытками. */
export function wakeViewport(why: string): void {
  theDoor().wake(why);
}

/** Как разложено сейчас. */
export function viewSize(): ViewSize {
  return theDoor().current;
}

/** Подписаться на перемену окна; возвращает отписку. */
export function onViewport(cb: (size: ViewSize) => void): () => void {
  return theDoor().subscribe(cb);
}

/** Подписаться на возвращение (развернули, страница снова видна); возвращает отписку. */
export function onReturn(cb: () => void): () => void {
  return theDoor().subscribeBack(cb);
}
