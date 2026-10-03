/**
 * Выбор вида этого устройства: новый или прежний. Одна механика на три двери — интерфейс (`ui/uimode.ts`), карта
 * мира (`ui/map/look.ts`), ролик боя (`ui/battle/look.ts`): у трёх копий одной записи разошлось бы то, что у них и
 * должно быть общим, — приватное окно, битая запись, адрес.
 *
 * С 03.10.2026 ПО УМОЛЧАНИЮ — НОВОЕ ВО ВСЕХ ТРЁХ (решение владельца, docs/ui_audit.md, 12.8). Прежнее — запасное:
 * строка в настройках (`ui/parts/Settings.tsx`) или адрес `?<имя>=old`.
 *
 * ЖИВЁТ В localStorage, А НЕ В СОХРАНЕНИИ: это свойство телефона, а не партии. `SAVE_VERSION` от него не зависит,
 * сервер его не видит, другой телефон начинает с умолчания.
 *
 * Адрес не «сильнее записи», а пишет её: в Телеграме адрес игры не поправишь, и выбор, сделанный ссылкой на тестовый
 * сайт, обязан пережить перезагрузку так же, как выбор в настройках. Читает адрес одна дверь — `main.tsx` на запуске.
 *
 * Чужая и битая запись — умолчание, а не прежнее: прежнее выбирают только словом `old`, сказанным самим игроком
 * (или его адресом).
 */

export interface DeviceStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** Тихое хранилище: приватное окно или запрет записи — не повод падать. */
const browserStorage: DeviceStorage = {
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

export interface DeviceChoice<T extends string> {
  /** Выбор из записи: своё слово — оно, остальное — умолчание. */
  of(raw: string | null): T;
  /** Что просит адрес (`?<имя>=…`); чужое слово и пустое — ничего. */
  asked(search: string): T | null;
  /** Выбор сейчас. */
  get(): T;
  /** Записать выбор и разбудить подписчиков — только при смене. */
  set(value: T): void;
  /** Адрес на запуске: своё слово пишет выбор, остальное его не трогает. */
  boot(search: string): T;
  subscribe(fn: () => void): () => void;
  /** Подменить хранилище — тестам. */
  setStorage(next: DeviceStorage): void;
}

/**
 * Дверь одного выбора: ключ записи, имя в адресе, слова и умолчание. Слова — те, что пишутся в запись и в адрес;
 * подписи кнопок живут у двери вида, рядом со своим умолчанием.
 */
export function deviceChoice<T extends string>(key: string, param: string, words: readonly T[], fallback: T): DeviceChoice<T> {
  const known = (v: string | null): v is T => v !== null && (words as readonly string[]).includes(v);
  let storage = browserStorage;
  /** Выбор этого захода: запись может не пережить приватное окно, а заход обязан видеть своё. */
  let current: T | null = null;
  const listeners = new Set<() => void>();

  const of = (raw: string | null): T => (known(raw) ? raw : fallback);
  const get = (): T => {
    if (current === null) current = of(storage.read(key));
    return current;
  };
  const set = (value: T): void => {
    if (value === get()) return;
    current = value;
    storage.write(key, value);
    for (const fn of listeners) fn();
  };
  const asked = (search: string): T | null => {
    const v = new URLSearchParams(search).get(param);
    return known(v) ? v : null;
  };
  return {
    of,
    asked,
    get,
    set,
    boot(search) {
      const want = asked(search);
      if (want) set(want);
      return get();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setStorage(next) {
      storage = next;
      current = null;
    },
  };
}
