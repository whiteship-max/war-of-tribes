/**
 * Дверь поворота: в какой ориентации стоит игра и что делать, если телефон держат боком.
 *
 * РЕШЕНИЕ ВЛАДЕЛЬЦА (04.10.2026): город, карта, держава и все меню — только вертикально; промыслы
 * («Ягоды», «Скот», «Охота») и ролик боя — в любой ориентации: в горизонтали они смотрятся хорошо.
 *
 * ЧЕМ ДЕРЖИТСЯ ВЕРТИКАЛЬ. Bot API 8.0 (17.11.2024) дал мини-аппке `lockOrientation()` и
 * `unlockOrientation()`. Закрепление по документации Телеграма — **текущей** ориентации («locks the Mini
 * App's orientation to its current mode»): позвать его, пока телефон лежит боком, значит закрепить
 * горизонталь. Поэтому правило (`TurnDoor.check`) — три строки:
 *
 *  1. **Кто-то просит свободы** (`freeTurn`: промысел, ролик боя) — закрепление снято, заставки нет.
 *  2. **Телефон стоит вертикально** — закрепить, если ещё не закреплено и клиент умеет.
 *  3. **Телефон лежит боком** — не закреплять (закрепилась бы горизонталь), а показать заставку
 *     «Поверни телефон»; повернули — строка 2 закрепит вертикаль.
 *
 * ЗАПАСНОЙ ПУТЬ. Клиент младше 8.0 (или вне Телеграма) закреплять не умеет: тогда пробуется
 * `screen.orientation.lock('portrait')` — вебвью и браузер без полного экрана его чаще отклоняют, — а
 * держит вертикаль заставка: раскладка под ней не ломается, её просто не видно. Заставка — только на
 * телефоне (палец и короткая сторона экрана меньше `PHONE_SHORT`): у компьютера окно шире высоты всегда,
 * а планшет боком раскладку держит.
 *
 * Модуль без React и three, как дверь окна (`viewport.ts`), и лежит рядом с ней: правило — класс с
 * внешним окружением (`TurnEnv`), проверяется тестом на настоящем коде с макетом Телеграма
 * (`orientation.test.ts`). О повороте дверь узнаёт от двери окна (`onViewport`, `onReturn`) и от
 * событий поворота экрана.
 */
import { sceneLog } from '@/scenelog';
import { onReturn, onViewport } from '@/viewport';

/** Короче этой стороны экрана (CSS-пиксели) — телефон: ему боком нужна заставка. Планшет — от 600. */
export const PHONE_SHORT = 600;

/** Что дверь спрашивает у Телеграма. Обёртка (`telegram/webapp.ts`) отдаёт сам `WebApp`. */
export interface TgTurn {
  platform?: string;
  isVersionAtLeast?(v: string): boolean;
  /** Bot API 8.0: закрепить текущую ориентацию. */
  lockOrientation?(): void;
  /** Bot API 8.0: снова следовать за поворотом телефона. */
  unlockOrientation?(): void;
}

/** Как закрепить и отпустить ориентацию. */
export interface Turner {
  lock(): void;
  unlock(): void;
}

/**
 * Закрепление Телеграмом — если клиент умеет (Bot API 8.0+). Вне клиента (`platform` «unknown») SDK
 * только пишет в консоль — просить некого. Младший клиент — `null`: держит заставка.
 */
export function tgTurner(app: TgTurn | null): Turner | null {
  if (!app || (app.platform ?? 'unknown') === 'unknown') return null;
  if (!app.lockOrientation || !app.unlockOrientation) return null;
  let fresh = false;
  try {
    fresh = Boolean(app.isVersionAtLeast?.('8.0'));
  } catch {
    fresh = false;
  }
  if (!fresh) return null;
  return {
    lock: () => {
      try {
        app.lockOrientation?.();
      } catch {
        /* клиент передумал — держит заставка */
      }
    },
    unlock: () => {
      try {
        app.unlockOrientation?.();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Окружение двери. В игре — браузер и Телеграм (`browserEnv`), в тесте — подделка. */
export interface TurnEnv {
  /** Экран сейчас лежит боком. */
  landscape(): boolean;
  /** Это телефон: палец и короткая сторона экрана меньше `PHONE_SHORT`. */
  phone(): boolean;
  /** Чем закреплять; `null` — нечем, держит заставка. */
  turner(): Turner | null;
  /** Показать или убрать заставку «Поверни телефон». */
  splash(show: boolean): void;
  /** Запись в журнал сцены. */
  note(text: string): void;
}

export class TurnDoor {
  /** Кто сейчас просит свободы поворота: номер просьбы → чья. */
  private holders = new Map<number, string>();
  private next = 1;
  private locked = false;
  private shown = false;

  constructor(private env: TurnEnv) {}

  /** Заставка сейчас на экране. */
  get splashShown(): boolean {
    return this.shown;
  }

  /** Вертикаль закреплена нами. */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Попросить свободы поворота — на время промысла или ролика. Возвращает отпуск: на выходе вертикаль
   * закрепляется снова (или встаёт заставка, если телефон в эту минуту боком). Отпуск второй раз — ничего.
   */
  free(why: string): () => void {
    const id = this.next++;
    this.holders.set(id, why);
    this.check(`свобода: ${why}`);
    return () => {
      if (!this.holders.delete(id)) return;
      this.check(`конец свободы: ${why}`);
    };
  }

  /** Привести закрепление и заставку в порядок. Звать можно сколько угодно раз — меняется только перемена. */
  check(why: string): void {
    if (this.holders.size > 0) {
      if (this.locked) {
        this.env.turner()?.unlock();
        this.locked = false;
        this.env.note(`${why}: поворот свободен`);
      }
      this.show(false, why);
      return;
    }
    const wide = this.env.landscape();
    if (!wide && !this.locked) {
      const t = this.env.turner();
      if (t) {
        t.lock();
        this.locked = true;
        this.env.note(`${why}: вертикаль закреплена`);
      }
    }
    this.show(wide && this.env.phone(), why);
  }

  private show(on: boolean, why: string): void {
    if (on === this.shown) return;
    this.shown = on;
    this.env.splash(on);
    this.env.note(`${why}: ${on ? 'заставка «Поверни телефон»' : 'заставка убрана'}`);
  }
}

// ---------- Дверь игры ----------

/**
 * Экран лежит боком — когда согласны двое: окно шире высоты И ориентация экрана (у старых iOS —
 * `window.orientation`). Одного окна мало: в вертикали клавиатура сжимает окно до почти квадрата. Одного
 * экрана тоже: его тип может отстать от окна (так делает эмуляция Chrome), а заставка поверх вертикальной
 * раскладки заперла бы игру — ошибаться можно только в сторону «заставки нет».
 */
function screenLandscape(): boolean {
  if (!(window.innerWidth > window.innerHeight)) return false;
  const type = screen.orientation?.type;
  if (type) return type.startsWith('landscape');
  const legacy = (window as { orientation?: number }).orientation;
  if (typeof legacy === 'number') return Math.abs(legacy) === 90;
  return true;
}

function isPhone(): boolean {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse && Math.min(screen.width, screen.height) < PHONE_SHORT;
}

/** Запасной путь: замок экрана браузера. Отказ — тихий: вертикаль держит заставка. */
type ScreenLock = ScreenOrientation & { lock?(o: string): Promise<void>; unlock?(): void };

function screenTurner(): Turner | null {
  const o = screen.orientation as ScreenLock | undefined;
  if (!o?.lock || !isPhone()) return null;
  return {
    lock: () => {
      try {
        o.lock?.('portrait').catch(() => undefined);
      } catch {
        /* ignore */
      }
    },
    unlock: () => {
      try {
        o.unlock?.();
      } catch {
        /* ignore */
      }
    },
  };
}

let splashEl: HTMLDivElement | null = null;

function splash(show: boolean): void {
  if (!splashEl) {
    if (!show) return;
    const el = document.createElement('div');
    el.className = 'turn-phone';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="turn-phone-card">' +
      '<div class="turn-phone-icon" aria-hidden="true">📱</div>' +
      '<b>Поверни телефон</b>' +
      '<span>Город, карта и держава — вертикально</span>' +
      '</div>';
    document.body.appendChild(el);
    splashEl = el;
  }
  splashEl.hidden = !show;
}

let door: TurnDoor | null = null;

/**
 * Завести дверь поворота. Зовёт обёртка Телеграма при запуске, сразу после двери окна; вне Телеграма —
 * без него.
 */
export function startOrientation(app: TgTurn | null = null): void {
  if (door || typeof window === 'undefined') return;
  const tgT = tgTurner(app);
  const d = new TurnDoor({
    landscape: screenLandscape,
    phone: isPhone,
    turner: () => tgT ?? screenTurner(),
    splash,
    note: (text) => sceneLog.mark('app', text),
  });
  door = d;
  const check = (why: string) => () => d.check(why);
  onViewport(() => d.check('окно'));
  onReturn(() => d.check('развернули'));
  window.addEventListener('orientationchange', check('поворот'));
  screen.orientation?.addEventListener?.('change', check('поворот экрана'));
  d.check('запуск');
}

/**
 * Свобода поворота на время промысла или ролика боя: закрепление снято, заставки нет. Возвращает отпуск —
 * звать на выходе. Двери ещё нет (тест, страница до запуска) — отпускать нечего.
 */
export function freeTurn(why: string): () => void {
  return door ? door.free(why) : () => undefined;
}
