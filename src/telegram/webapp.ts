// Тонкая обёртка над Telegram WebApp API. Работает и вне Telegram (в браузере).

import { sceneLog } from '@/scenelog';

interface TgCloudStorage {
  setItem(key: string, value: string, cb?: (err: Error | null, ok?: boolean) => void): void;
  getItem(key: string, cb: (err: Error | null, value?: string) => void): void;
}

interface TgHaptic {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
}

export interface TgInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Палитра клиента (Bot API 6.0+). Значения — hex вида #rrggbb. */
export interface TgThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  header_bg_color?: string;
}

/**
 * Данные запуска. Подписью они не проверены, поэтому ни одно игровое решение —
 * награда, прогресс, начисление — на них висеть не может. Годятся только на
 * показ: собрать ссылку приглашения и узнать, кто пригласил.
 */
export interface TgInitDataUnsafe {
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    /**
     * Аватарка клиента. Приходит не всегда: её нет у закрытых профилей и на
     * старых клиентах — тогда лицо берётся из набора игры.
     */
    photo_url?: string;
  };
  /** Параметр из ссылки вида t.me/<бот>/<аппка>?startapp=<код>. */
  start_param?: string;
}

export interface TelegramWebApp {
  ready(): void;
  expand(): void;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  colorScheme: 'light' | 'dark';
  themeParams?: TgThemeParams;
  /** Bot API 8.0: вырезы устройства (чёлка, home indicator). */
  safeAreaInset?: TgInset;
  /** Bot API 8.0: отступ от шапки мини-аппки внутри безопасной зоны. */
  contentSafeAreaInset?: TgInset;
  /**
   * Строка запуска как есть — подписанная Telegram. Проверить её может только
   * тот, у кого есть токен бота, то есть сервер; клиент её не разбирает и
   * ничему в ней не верит, он её только передаёт.
   */
  initData?: string;
  initDataUnsafe?: TgInitDataUnsafe;
  /** Версия Bot API клиента и платформа — для отчёта об ошибке, не для ветвлений. */
  version?: string;
  platform?: string;
  /** Bot API 6.0: открыть внешнюю ссылку. Для t.me не годится — уведёт в браузер. */
  openLink?(url: string, options?: { try_instant_view?: boolean }): void;
  /** Bot API 6.0: открыть ссылку t.me внутри клиента, не выходя из аппки. */
  openTelegramLink?(url: string): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  CloudStorage?: TgCloudStorage;
  isVersionAtLeast?(v: string): boolean;
  HapticFeedback?: TgHaptic;
  onEvent?(event: string, cb: () => void): void;
  offEvent?(event: string, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

export const inTelegram = (): boolean => Boolean(tg()?.initDataUnsafe?.user);

/**
 * Чем игрок играет — одной строкой для отчёта об ошибке. Ветвлений по ней нет и
 * быть не должно: клиент называет себя как хочет, а игра обязана работать всюду.
 */
export function tgAbout(): string {
  const app = tg();
  if (!app) return 'вне Telegram';
  return `${app.platform ?? '?'} ${app.version ?? '?'}`;
}

// ---------- Вьюпорт ----------

const root = (): CSSStyleDeclaration => document.documentElement.style;

/**
 * Высота сцены берётся из viewportStableHeight (без учёта клавиатуры и «резинки»),
 * отступы — из safeAreaInset + contentSafeAreaInset. В CSS они складываются с env(),
 * поэтому вне Telegram и на старых клиентах работает фолбэк на safe-area-inset-*.
 */
export function applyViewport(): void {
  const app = tg();
  const stable = app?.viewportStableHeight ?? 0;
  const inner = window.innerHeight || 0;
  // Берём меньшее: в Telegram viewportStableHeight отрезает шапку, а вне клиента
  // SDK отдаёт устаревшее значение, которое не следит за resize.
  const candidates = [stable, inner].filter((v) => v > 0);
  // Во время resize клиент может отдать ноль — тогда оставляем прежнее значение.
  if (candidates.length) root().setProperty('--app-h', `${Math.round(Math.min(...candidates))}px`);

  const safe = app?.safeAreaInset;
  const content = app?.contentSafeAreaInset;
  if (!safe && !content) return;
  const px = (n: number | undefined): string => `${Math.max(0, Math.round(n ?? 0))}px`;
  root().setProperty('--tg-top', px((safe?.top ?? 0) + (content?.top ?? 0)));
  root().setProperty('--tg-bottom', px((safe?.bottom ?? 0) + (content?.bottom ?? 0)));
  root().setProperty('--tg-left', px((safe?.left ?? 0) + (content?.left ?? 0)));
  root().setProperty('--tg-right', px((safe?.right ?? 0) + (content?.right ?? 0)));
}

// ---------- Тема ----------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function toRgb(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = (hex: string, a: number): string | null => {
  const c = toRgb(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})` : null;
};

/** Смешивает цвет с другим: 0 — только a, 1 — только b. */
function mix(a: string, b: string, t: number): string | null {
  const ca = toRgb(a);
  const cb = toRgb(b);
  if (!ca || !cb) return null;
  const v = ca.map((x, i) => Math.round(x + (cb[i] - x) * t));
  return `rgb(${v[0]}, ${v[1]}, ${v[2]})`;
}

const setVar = (name: string, value: string | null): void => {
  if (value) root().setProperty(name, value);
};

/** Подтягивает цвета интерфейса из themeParams клиента поверх дефолтной палитры. */
export function applyTheme(): void {
  const app = tg();
  const t = app?.themeParams;
  if (!t) return;

  const bg = t.bg_color && HEX.test(t.bg_color) ? t.bg_color : null;
  const text = t.text_color && HEX.test(t.text_color) ? t.text_color : null;
  const hint = t.hint_color && HEX.test(t.hint_color) ? t.hint_color : null;
  const button = t.button_color && HEX.test(t.button_color) ? t.button_color : null;
  const buttonText = t.button_text_color && HEX.test(t.button_text_color) ? t.button_text_color : null;
  const secondary =
    (t.secondary_bg_color && HEX.test(t.secondary_bg_color) && t.secondary_bg_color) ||
    (t.section_bg_color && HEX.test(t.section_bg_color) && t.section_bg_color) ||
    bg;

  setVar('--bg', bg);
  setVar('--text', text);
  setVar('--muted', hint);
  setVar('--accent', button);
  setVar('--accent-text', buttonText);
  if (secondary) {
    // Панели полупрозрачные — под ними видно 3D-сцену.
    setVar('--panel', rgba(secondary, 0.92));
    if (text) setVar('--panel-2', mix(secondary, text, 0.09));
  }
  if (text) setVar('--line', rgba(text, 0.16));

  const scheme = app?.colorScheme === 'light' ? 'light' : 'dark';
  root().setProperty('color-scheme', scheme);
  document.documentElement.dataset.theme = scheme;

  if (bg) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    try {
      app?.setBackgroundColor?.(bg);
      app?.setHeaderColor?.(bg);
    } catch {
      // Старые клиенты принимают только ключевые слова.
      try {
        app?.setHeaderColor?.('bg_color');
      } catch {
        /* ignore */
      }
    }
  }
}

export function initTelegram(): void {
  applyViewport();
  window.addEventListener('resize', applyViewport);
  window.addEventListener('orientationchange', applyViewport);

  const app = tg();
  if (!app) return;
  try {
    app.ready();
    app.expand();
    // Без этого вертикальный свайп по сцене сворачивает мини-аппку вместо вращения камеры.
    app.disableVerticalSwipes?.();
  } catch {
    // Старые клиенты могут не поддерживать часть методов.
  }
  applyTheme();
  applyViewport();

  const on = (event: string, cb: () => void): void => {
    try {
      app.onEvent?.(event, cb);
    } catch {
      /* ignore */
    }
  };
  on('viewportChanged', () => {
    applyViewport();
    sceneLog.mark('tg', `вьюпорт ${Math.round(app.viewportHeight)}/${Math.round(app.viewportStableHeight)}`);
  });
  on('safeAreaChanged', applyViewport);
  on('contentSafeAreaChanged', applyViewport);
  on('fullscreenChanged', applyViewport);
  // Bot API 8.0: клиент говорит, что аппку свернули и что развернули обратно.
  // Это ровно тот случай, из-за которого заведён журнал: у старых клиентов
  // события нет, и тогда о сворачивании расскажет только visibilitychange.
  on('deactivated', () => sceneLog.mark('tg', 'свернули'));
  on('activated', () => {
    sceneLog.mark('tg', 'развернули');
    applyViewport();
  });
  on('themeChanged', () => {
    applyTheme();
    applyViewport();
  });
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'error' = 'light'): void {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'success' || kind === 'error') h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  } catch {
    /* ignore */
  }
}

// ---------- Ссылки и «поделиться» ----------

/**
 * Внешняя ссылка (ютуб, сайт). Клиент открывает её своим браузером и возвращает
 * игрока обратно в аппку; вне Telegram — обычная вкладка.
 *
 * Звать только из обработчика нажатия: `window.open` без жеста пользователя
 * браузер блокирует, и никакого сообщения об этом не будет.
 */
export function openExternal(url: string): void {
  const app = tg();
  try {
    if (app?.openLink) {
      app.openLink(url);
      return;
    }
  } catch {
    /* старый клиент — уходим в фолбэк */
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* ignore */
  }
}

/**
 * Ссылка t.me — группа, чат, «поделиться». Отдельно от внешней нарочно:
 * `openLink` на t.me уводит игрока во внешний браузер, откуда в мини-аппку он
 * уже не вернётся. Домен решает, какую из двух звать.
 */
export function openTelegram(url: string): void {
  const app = tg();
  try {
    if (app?.openTelegramLink) {
      app.openTelegramLink(url);
      return;
    }
  } catch {
    /* ignore */
  }
  openExternal(url);
}

/**
 * Кто запустил аппку. Подписью эти данные не проверены, поэтому годятся только
 * на показ — имя и лицо в профиле. Ни одно игровое решение на них не висит.
 */
export const tgUser = (): NonNullable<TgInitDataUnsafe['user']> | null =>
  tg()?.initDataUnsafe?.user ?? null;

/** Имя игрока из Telegram: имя и фамилия, если она есть. */
export function tgDisplayName(): string | null {
  const u = tgUser();
  if (!u) return null;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
}

/**
 * Подписанная строка запуска — то единственное, чем игрок доказывает серверу,
 * кто он. Отдаётся как есть и только тому, кто её отправит: разбирать её здесь
 * незачем, а верить разобранному — нельзя.
 *
 * Пусто — играют вне Telegram. Тогда серверного сохранения нет вовсе, и
 * подставлять что-нибудь вместо подписи нельзя (сравни с `tgUserId`).
 */
export function tgInitData(): string | null {
  const raw = tg()?.initData;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Идентификатор игрока. Есть только внутри Telegram; выдумывать замену нельзя. */
export function tgUserId(): number | null {
  const id = tg()?.initDataUnsafe?.user?.id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

/** Код из ссылки, по которой запустили аппку. Пусто — запустили обычным путём. */
export const startParam = (): string | null => tg()?.initDataUnsafe?.start_param ?? null;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Чем кончилась попытка поделиться — от этого зависит, что сказать игроку. */
export type ShareResult = 'telegram' | 'system' | 'clipboard' | 'none';

/**
 * Поделиться ссылкой. Четыре ступени, и порядок менять нельзя: и `navigator.share`,
 * и `window.open` требуют жеста пользователя, а жест теряется на первом же `await`.
 * Поэтому в теле до первого ожидания стоят ровно те ступени, которым жест нужен.
 */
export async function shareLink(url: string, text: string): Promise<ShareResult> {
  const app = tg();
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  try {
    if (app?.openTelegramLink) {
      app.openTelegramLink(share);
      return 'telegram';
    }
  } catch {
    /* ignore */
  }
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return 'system';
    }
  } catch {
    // Игрок закрыл системное окно — это не ошибка, но и не отправка.
    return 'none';
  }
  if (await copyText(url)) return 'clipboard';
  try {
    window.open(share, '_blank', 'noopener,noreferrer');
    return 'telegram';
  } catch {
    return 'none';
  }
}

const CHUNK = 4000; // лимит значения CloudStorage — 4096 символов

const cloud = (): TgCloudStorage | undefined => {
  const app = tg();
  if (!app?.CloudStorage || !app.isVersionAtLeast?.('6.9')) return undefined;
  return app.CloudStorage;
};

export async function cloudSet(key: string, value: string): Promise<boolean> {
  const cs = cloud();
  if (!cs) return false;
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
  const setOne = (k: string, v: string) =>
    new Promise<boolean>((resolve) => {
      try {
        cs.setItem(k, v, (err, ok) => resolve(!err && Boolean(ok)));
      } catch {
        resolve(false);
      }
    });
  const results = await Promise.all([
    setOne(`${key}:n`, String(parts.length)),
    ...parts.map((p, i) => setOne(`${key}:${i}`, p)),
  ]);
  return results.every(Boolean);
}

export async function cloudGet(key: string): Promise<string | null> {
  const cs = cloud();
  if (!cs) return null;
  const getOne = (k: string) =>
    new Promise<string | null>((resolve) => {
      try {
        cs.getItem(k, (err, v) => resolve(err || !v ? null : v));
      } catch {
        resolve(null);
      }
    });
  const n = Number(await getOne(`${key}:n`));
  if (!n) return null;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => getOne(`${key}:${i}`)));
  if (parts.some((p) => p === null)) return null;
  return parts.join('');
}
