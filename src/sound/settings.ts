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
 * **По умолчанию звук включён — на время теста с игроками** (решение владельца 07.10.2026, docs/audio.md, решение 2).
 * Звучать он всё равно начинает только после первого касания игрока (так требуют браузеры и Telegram, `sound/city.ts`),
 * а громкости негромкие (`SOUND_LEVEL_DEFAULT`). Выключил — помнится.
 *
 * Прежде умолчанием было «выключено»: игру открывают где придётся, и заигравшая без спроса музыка — неожиданность. Это
 * правило справочника (docs/handbook/music.md) владелец снял на время теста: тестерам надо услышать, а не искать
 * переключатель. После теста — вернуть решением владельца, одним этим числом.
 */
export const DEFAULT_ON = true;

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

// ---------- Громкость: музыка, эффекты, окружение ----------
//
// Три громкости, а не три рычага (docs/audio.md, решение 3; docs/polish.md, П-3). Рычаг по-прежнему один — `soundOn`:
// выключен — молчит всё и не открывается ничего. Громкость лишь делит то, что звучит, на три рода: **музыка** (музыка
// эпохи в городе и на карте, музыка боя), **эффекты** (касания, стройка, тревога, звуки боя, промыслов и вой) и
// **окружение** (фон города, карты и поляны: ветер, гул, рынок, птицы, море, дождь и гром). Это то самое «появятся звуки
// другого рода — тогда и разделим», которое справочник оставил на потом (docs/handbook/music.md).

/** Род звука: на каждый — своя громкость. */
export type SoundKind = 'music' | 'fx' | 'amb';

export const SOUND_KINDS: readonly SoundKind[] = ['music', 'fx', 'amb'];

/**
 * Умолчания — положение полосы, а не сила: фон и музыка под игру, а не вместо неё (П-3: тише прежнего — на выходе
 * музыка −10.4 дБ против −4.4, эффекты −6.2 против −1.9; уровни родов меряет `npm run audio:samples`).
 */
export const SOUND_LEVEL_DEFAULT: Record<SoundKind, number> = { music: 0.55, fx: 0.7, amb: 0.6 };

/**
 * Сила звука по положению полосы — квадрат: ухо слышит громкость в децибелах, и прямая полоса отдавала бы всю тишину
 * последней десятой хода (половина хода — −12 дБ, десятая — −40 дБ).
 */
export const levelGain = (v: number): number => (v <= 0 ? 0 : Math.min(1, v) ** 2);

const LEVEL_KEY: Record<SoundKind, string> = { music: 'tribe.sound.music', fx: 'tribe.sound.fx', amb: 'tribe.sound.amb' };

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

const readLevel = (key: string): number => {
  const saved = levels.read(key);
  const v = saved === null ? NaN : Number(saved);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN;
};

/**
 * Положение полосы рода, 0..1. Испорченная запись — умолчание, а не тишина. Окружения прежде не было — фон шёл со
 * «звуками»: кто их убавил, у того и фон остаётся убавленным, пока он не тронет свою полосу.
 */
export function soundLevel(kind: SoundKind): number {
  const v = readLevel(LEVEL_KEY[kind]);
  if (Number.isFinite(v)) return v;
  if (kind === 'amb') {
    const was = readLevel(LEVEL_KEY.fx);
    if (Number.isFinite(was)) return was;
  }
  return SOUND_LEVEL_DEFAULT[kind];
}

/** Сила рода на выходе (`levelGain` от полосы). */
export const soundGain = (kind: SoundKind): number => levelGain(soundLevel(kind));

/** Силы родов при умолчаниях — офлайн-стенду (`npm run audio:samples`): он меряет то, что слышит новый игрок. */
export const DEFAULT_GAINS: Record<SoundKind, number> = {
  music: levelGain(SOUND_LEVEL_DEFAULT.music),
  fx: levelGain(SOUND_LEVEL_DEFAULT.fx),
  amb: levelGain(SOUND_LEVEL_DEFAULT.amb),
};

/** Записать громкость рода. Пишет её тот же раздел настроек, что и рычаг. */
export function setSoundLevel(kind: SoundKind, value: number): void {
  const v = Math.min(1, Math.max(0, value));
  levels.write(LEVEL_KEY[kind], String(Math.round(v * 100) / 100));
  for (const listener of listeners) listener();
}
