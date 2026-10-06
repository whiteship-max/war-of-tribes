// Включена ли музыка. Настройка живёт в localStorage, а не в сохранении партии,
// и это решение, а не лень: звук — настройка **устройства**, а не племени. На
// планшете в тишине и на телефоне в дороге игрок хочет разного, а сохранение
// уезжает на сервер и приехало бы на оба сразу.
//
// Отсюда же следует, что версию сохранения этот переключатель не поднимает.
//
// **Флажок один на всю музыку — и деревни, и боя.** Игрок слышит «музыку», а не
// две подсистемы, и два переключателя на одно ощущение были бы лишним выбором в
// первую минуту. Появятся звуки другого рода — щелчки, оповещения, — тогда и
// разделим, по надобности, а не заранее. Правит им ровно один компонент —
// `ui/parts/Settings.tsx`; показан он в двух местах (в профиле и на стартовом
// экране), но это один компонент и одно состояние, а не два похожих. Второго
// рычага быть не должно — два способа включить одно и то же расходятся ровно
// тогда, когда один из них правят.
const KEY = 'tribe.sound';

/**
 * **По умолчанию музыка выключена.** У нового игрока она не играет, пока он сам
 * её не включит: игру открывают где придётся — в транспорте, на работе, рядом со
 * спящим, — и заигравшая без спроса музыка это не подарок, а неожиданность,
 * которую гасят вместе со вкладкой.
 *
 * Раньше умолчанием было «включено», и довод был такой: переключатель виден
 * только внутри ролика о бое, а выключенный по умолчанию звук никто бы не нашёл.
 * Довод кончился вместе с тем переключателем — теперь музыка лежит в настройках,
 * в профиле, за шестерёнкой меню державы. Нашлась дверь — отпало и оправдание.
 */
const DEFAULT_ON = false;

/** Хранилище настройки. Подменяется в тестах — там localStorage нет. */
export interface SoundStorage {
  read(): string | null;
  write(value: string): void;
}

const browserStorage: SoundStorage = {
  read() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Приватное окно и запрет на хранилище — не повод молчать весь сеанс:
      // настройка просто не переживёт перезагрузку.
    }
  },
};

let storage = browserStorage;

/** Подменить хранилище. Только для тестов и стенда. */
export function setSoundStorage(next: SoundStorage): void {
  storage = next;
}

/**
 * Кому сказать, что настройка изменилась.
 *
 * Появилось это вместе со вторым местом показа: рычаг остался один, а показан
 * он теперь и в профиле, и на стартовом экране. Пока каждый показ держал своё
 * `useState`, «одно состояние» держалось на том, что два показа не бывают на
 * экране разом, — то есть на совпадении, а не на устройстве. Подписка делает
 * правду одну: пишет по-прежнему `setSoundOn`, а читают все от него.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

/** Подписаться на изменение настройки. Возвращает отписку. */
export function subscribeSound(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function soundOn(): boolean {
  const saved = storage.read();
  return saved === null ? DEFAULT_ON : saved === '1';
}

export function setSoundOn(on: boolean): void {
  storage.write(on ? '1' : '0');
  for (const listener of listeners) listener();
}

// ---------- Громкость: музыка и звуки ----------
//
// Две громкости, а не два рычага (docs/audio.md, решение 3). Рычаг по-прежнему один — `soundOn`: выключен — молчит всё и
// не открывается ничего. Громкость лишь делит то, что звучит, на два рода: **музыка** (музыка эпохи в городе и на карте,
// музыка боя) и **звуки** (фон города и карты, касания, тревога, звуки боя, промыслов и вой). Это то самое «появятся
// звуки другого рода — тогда и разделим», которое справочник оставил на потом (docs/handbook/music.md).

/** Род звука: на каждый — своя громкость. */
export type SoundKind = 'music' | 'fx';

/** Умолчания — негромко: фон и музыка под игру, а не вместо неё. */
export const SOUND_LEVEL_DEFAULT: Record<SoundKind, number> = { music: 0.6, fx: 0.8 };

const LEVEL_KEY: Record<SoundKind, string> = { music: 'tribe.sound.music', fx: 'tribe.sound.fx' };

/** Хранилище громкостей. Подменяется в тестах. */
export interface LevelStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

const browserLevels: LevelStorage = {
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
      // Как у рычага: не переживёт перезагрузку — и только.
    }
  },
};

let levels = browserLevels;

/** Подменить хранилище громкостей. Только для тестов. */
export function setLevelStorage(next: LevelStorage): void {
  levels = next;
}

/** Громкость рода, 0..1. Испорченная запись — умолчание, а не тишина. */
export function soundLevel(kind: SoundKind): number {
  const saved = levels.read(LEVEL_KEY[kind]);
  const v = saved === null ? NaN : Number(saved);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : SOUND_LEVEL_DEFAULT[kind];
}

/** Записать громкость рода. Пишет её тот же раздел настроек, что и рычаг. */
export function setSoundLevel(kind: SoundKind, value: number): void {
  const v = Math.min(1, Math.max(0, value));
  levels.write(LEVEL_KEY[kind], String(Math.round(v * 100) / 100));
  for (const listener of listeners) listener();
}
