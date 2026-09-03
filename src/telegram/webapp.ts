// Тонкая обёртка над Telegram WebApp API. Работает и вне Telegram (в браузере).

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
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
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
  on('viewportChanged', applyViewport);
  on('safeAreaChanged', applyViewport);
  on('contentSafeAreaChanged', applyViewport);
  on('fullscreenChanged', applyViewport);
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
