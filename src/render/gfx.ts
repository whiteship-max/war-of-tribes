/**
 * Графика этого устройства — одна дверь: выбор игрока (пункт «Графика» в настройках,
 * `ui/parts/Settings.tsx`) и память сторожа плавности (`render/steady`).
 *
 * ЖИВЁТ В localStorage, А НЕ В СОХРАНЕНИИ — как звук (`sound/settings.ts`): это свойство
 * телефона, а не партии. Переустановка и другой телефон начинают с умолчания, партия
 * этого не видит, `SAVE_VERSION` от этого не зависит.
 *
 * ЗДЕСЬ НЕТ THREE. Выбор читают интерфейс (первая загрузка) и холст игры; сцену отсюда не
 * видно, и это нарочно: интерфейс говорит с записью, холст подписан на неё и пересобирает
 * сцену с новым видом (`ui/GameCanvas.tsx`) — сменить вид на живой сцене нельзя, нужен
 * новый холст (docs/handbook/scene.md).
 *
 * ПО УМОЛЧАНИЮ ИГРОК ВИДИТ ПРЕЖНИЙ ВИД (`now`), пока владелец не решит иначе
 * (docs/graphics_world.md, 9.6). Уровень — «авто»: по устройству (`quality.autoQuality`),
 * но не выше того, до чего сторож опустил его на этом устройстве за последнюю неделю.
 */
import type { Look } from './lighting';
import { QUALITIES, qualityOf, type Quality } from './quality';

/** Уровень, выбранный игроком: «авто» — по устройству. */
export type GfxQuality = 'auto' | Quality;

export interface Gfx {
  look: Look;
  quality: GfxQuality;
}

export const GFX_DEFAULT: Gfx = { look: 'now', quality: 'auto' };

/** Выбор игрока. Пишет его только пункт «Графика» (`setGfx`) — тест «рычаг один». */
export const GFX_KEY = 'tribe.gfx';

/**
 * Что сторож опустил на этом устройстве: уровень и когда. Свой ключ, а не выбор игрока:
 * игрок решает, а сторож только помнит, чего телефон не потянул.
 */
export const GFX_AUTO_KEY = 'tribe.gfx.auto';

/**
 * Сколько помнить опущенный уровень. Телефон, опустившийся однажды из-за жары или фоновой
 * задачи, через неделю проверяется заново — как ступень предыстории (`prologue/look.ts`).
 */
export const GFX_AUTO_KEEP_MS = 7 * 24 * 3_600_000;

export interface GfxStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** Тихое хранилище: приватное окно или запрет записи — не повод падать. */
const browserStorage: GfxStorage = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // приватное окно: выбор не переживёт перезагрузку, но этот заход работает
    }
  },
};

let storage = browserStorage;

/** Подменить хранилище — тестам. */
export function setGfxStorage(next: GfxStorage): void {
  storage = next;
  cache = null;
}

/** Выбор из записи. Чужое и битое — умолчание, поле за полем. */
export function gfxOf(raw: string | null): Gfx {
  try {
    const o = JSON.parse(raw ?? 'null') as { look?: unknown; quality?: unknown } | null;
    if (!o || typeof o !== 'object') return GFX_DEFAULT;
    const look: Look = o.look === 'next' ? 'next' : 'now';
    const q = typeof o.quality === 'string' ? o.quality : null;
    const quality: GfxQuality = q === 'auto' ? 'auto' : (qualityOf(q) ?? 'auto');
    return { look, quality };
  } catch {
    return GFX_DEFAULT;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeGfx(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Прочитанный выбор — тот же объект, пока запись та же: `useSyncExternalStore` сравнивает по ссылке. */
let cache: { raw: string | null; value: Gfx } | null = null;

export function gfx(): Gfx {
  const raw = storage.read(GFX_KEY);
  if (!cache || cache.raw !== raw) cache = { raw, value: gfxOf(raw) };
  return cache.value;
}

/** Записать выбор игрока — только пункт «Графика». */
export function setGfx(patch: Partial<Gfx>): void {
  storage.write(GFX_KEY, JSON.stringify({ ...gfx(), ...patch }));
  for (const listener of listeners) listener();
}

// ---------- Память сторожа ----------

/** Докуда сторож опустил уровень на этом устройстве, если запись цела и не старше недели. */
export function autoCapOf(raw: string | null, now: number): Quality | null {
  try {
    const o = JSON.parse(raw ?? 'null') as { quality?: unknown; at?: unknown } | null;
    if (!o || typeof o.at !== 'number' || now < o.at || now - o.at > GFX_AUTO_KEEP_MS) return null;
    return qualityOf(typeof o.quality === 'string' ? o.quality : null);
  } catch {
    return null;
  }
}

export const autoCap = (now: number): Quality | null => autoCapOf(storage.read(GFX_AUTO_KEY), now);

/** Запомнить, что сторож опустил уровень. */
export function rememberAutoCap(q: Quality, now: number): void {
  storage.write(GFX_AUTO_KEY, JSON.stringify({ quality: q, at: now }));
}

/** Дешевле из двух: уровень устройства не поднимается выше памяти сторожа. */
export const capQuality = (q: Quality, cap: Quality | null): Quality =>
  cap && QUALITIES.indexOf(cap) > QUALITIES.indexOf(q) ? cap : q;

// ---------- Что рисовать ----------

/** Вид и уровень для сцены; `asked` — уровень задан (адресом или игроком), сторож его не трогает. */
export interface SceneGfx {
  look: Look;
  /** `null` — по устройству. */
  quality: Quality | null;
  asked: boolean;
}

/**
 * Вид и уровень для сцены игры. Адрес (`?look=next&quality=low`) сильнее записи — так
 * владелец проверяет вид на телефоне, не трогая настроек; в запись адрес не пишется.
 */
export function sceneGfx(g: Gfx, search: string): SceneGfx {
  const p = new URLSearchParams(search);
  const urlLook = p.get('look');
  const look: Look = urlLook === 'next' || urlLook === 'now' ? urlLook : g.look;
  const urlQ = p.get('quality');
  const chosen: GfxQuality = urlQ === 'auto' ? 'auto' : (qualityOf(urlQ) ?? g.quality);
  const quality = chosen === 'auto' ? null : chosen;
  return { look, quality, asked: quality !== null };
}
