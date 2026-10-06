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
 * сцену с новым уровнем (`ui/GameCanvas.tsx`) — сменить уровень на живой сцене нельзя,
 * нужен новый холст (docs/handbook/scene.md).
 *
 * ВИД У ИГРЫ ОДИН — ГОРОД (решение владельца 02.10.2026, docs/city.md, «Город — единственный
 * вид»): прежний посёлок («Простой вид») и вид `next` убраны вместе с кодом, выбирать нечего.
 * Выбор — только уровень: «Авто» — по устройству (`quality.autoQuality`, телефон — не выше
 * среднего), но не выше того, до чего сторож опустил его на этом устройстве за последнюю
 * неделю; низкий — для слабых устройств вместо прежнего «Простого вида». Запись прошлых
 * сборок несёт поле вида: кто выбрал прежний вид (`look: 'now'`), получает город на «Авто»,
 * у остальных уровень остаётся их выбором (`gfxOf`).
 */
import { QUALITIES, autoQuality, qualityOf, tgClassOf, type DeviceCaps, type Quality } from './quality';

/** Уровень, выбранный игроком: «авто» — по устройству. */
export type GfxQuality = 'auto' | Quality;

export interface Gfx {
  quality: GfxQuality;
}

export const GFX_DEFAULT: Gfx = { quality: 'auto' };

/** Уровни в пункте «Графика» — порядок кнопок и их слова. */
export const GFX_QUALITIES: readonly (readonly [GfxQuality, string])[] = [
  ['auto', 'Авто'],
  ['low', 'Низкая'],
  ['medium', 'Средняя'],
  ['high', 'Высокая'],
];

/**
 * Ключ того, что рисует сцена при этом выборе и адресе: сменился — сцену пересобирают
 * (`ui/GameCanvas`). Вид один, ключ — уровень.
 */
export function gfxKey(g: Gfx, search: string): string {
  return sceneGfx(g, search).quality ?? 'auto';
}

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

/**
 * Выбор из записи. Чужое и битое — умолчание, поле за полем. Поле вида у записей прошлых
 * сборок — не выбор, а след: вида больше нет. Запись прежнего вида (`look: 'now'` — его писал
 * только выключатель «Простой вид», а при нём строка уровня была спрятана) — это слабое
 * устройство или проблема с прежней графикой, и решение владельца для неё — город на «Авто»:
 * уровень по устройству и сторож. У записи нового вида уровень — выбор игрока, он остаётся.
 */
export function gfxOf(raw: string | null): Gfx {
  try {
    const o = JSON.parse(raw ?? 'null') as { look?: unknown; quality?: unknown } | null;
    if (!o || typeof o !== 'object') return GFX_DEFAULT;
    if (o.look === 'now') return GFX_DEFAULT;
    const q = typeof o.quality === 'string' ? o.quality : null;
    return { quality: q === 'auto' ? 'auto' : (qualityOf(q) ?? 'auto') };
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

/** Уровень для сцены; `asked` — уровень задан (адресом или игроком), сторож его не трогает. */
export interface SceneGfx {
  /** `null` — по устройству. */
  quality: Quality | null;
  asked: boolean;
}

/**
 * Уровень для сцены игры. Адрес (`?quality=low`) сильнее записи — так владелец проверяет
 * уровень на телефоне, не трогая настроек; в запись адрес не пишется. Адрес вида
 * (`?look=…` прошлых сборок) не читается: вид один — город.
 */
export function sceneGfx(g: Gfx, search: string): SceneGfx {
  const urlQ = new URLSearchParams(search).get('quality');
  const chosen: GfxQuality = urlQ === 'auto' ? 'auto' : (qualityOf(urlQ) ?? g.quality);
  const quality = chosen === 'auto' ? null : chosen;
  return { quality, asked: quality !== null };
}

// ---------- Уровень для всех сцен игры ----------

/**
 * Что умеет устройство — единственное чтение браузера: указатель, память, ядра и класс Телеграма. Имя видеокарты
 * приносит тот, у кого есть контекст WebGL (сцена игры, `Scene.ts`); у 2D-карты его нет, и она его не спрашивает.
 */
export function deviceCaps(gpu: string | null = null): DeviceCaps {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as { deviceMemory?: number; hardwareConcurrency?: number; userAgent?: string };
  return {
    coarse: typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    gpu,
    tg: tgClassOf(nav.userAgent),
  };
}

/** Уровень, на котором сейчас стоит сцена игры (город): её «Авто» с именем видеокарты, опущенный сторожем, или выбор. */
let sceneLevel: Quality | null = null;

/** Сцена игры называет свой уровень: при сборке и когда сторож его опустил (`Scene.ts`). */
export function noteSceneLevel(q: Quality | null): void {
  sceneLevel = q;
}

/**
 * Уровень для сцен поверх города — карты, ролика боя, промысла (решение ночи 4, docs/perf.md): одна мерка на всю игру,
 * чтобы слабый телефон не получал «Низкое» в городе и «Среднее» на карте. Адрес (`?quality=`) сильнее выбора игрока,
 * выбор — сильнее устройства. «Авто» — уровень, на котором стоит город: он знает видеокарту и уже опущен сторожем,
 * если телефон не потянул; города ещё нет — устройство без видеокарты, не выше памяти сторожа за неделю.
 */
export function levelNow(search: string, now: number): Quality {
  const g = sceneGfx(gfx(), search);
  if (g.quality) return g.quality;
  return sceneLevel ?? capQuality(autoQuality(deviceCaps()), autoCap(now));
}
