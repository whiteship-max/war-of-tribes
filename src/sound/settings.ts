// Включён ли звук. Настройка живёт в localStorage, а не в сохранении партии, и
// это решение, а не лень: звук — настройка **устройства**, а не племени. На
// планшете в тишине и на телефоне в дороге игрок хочет разного, а сохранение
// уезжает в CloudStorage и приехало бы на оба сразу.
//
// Отсюда же следует, что версию сохранения этот переключатель не поднимает.
const KEY = 'tribe.sound';

/**
 * По умолчанию звук включён. Ролик и так открывается только по нажатию
 * «Смотреть бой» — то есть игрок уже попросил зрелище, — а выключенный по
 * умолчанию звук никто бы не нашёл: переключатель виден только внутри ролика.
 */
const DEFAULT_ON = true;

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

export function soundOn(): boolean {
  const saved = storage.read();
  return saved === null ? DEFAULT_ON : saved === '1';
}

export function setSoundOn(on: boolean): void {
  storage.write(on ? '1' : '0');
}
