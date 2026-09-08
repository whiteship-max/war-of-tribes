/**
 * Кто пишет: устройство и вкладка.
 *
 * Две разные вещи, и путать их нельзя.
 *
 * **Устройство** — этот браузер на этом телефоне. Признак постоянный, живёт в
 * localStorage рядом с сохранением и переживает перезагрузку. Он нужен, чтобы в
 * окне расхождения можно было сказать «эта партия с другого устройства», а не
 * показывать две одинаковые карточки без подписи.
 *
 * **Вкладка** — этот запуск игры. Признак новый на каждый заход и нигде не
 * хранится. Он нужен для второй болезни: две открытые вкладки пишут в одно
 * localStorage, и последний пишущий побеждает молча. Молча — вот что здесь
 * лечится: вкладки договариваются о том, кто из них ведёт партию, и та, что
 * ведущей быть перестала, останавливает запись и говорит об этом игроку.
 *
 * Настоящей блокировки между вкладками здесь нет и быть не может: localStorage
 * не умеет атомарной проверки-и-записи. Договорённость держится на отметке
 * времени — ведущая вкладка подновляет её, и просроченная считается брошенной.
 * Этого хватает ровно на то, ради чего заведено: заметить вторую вкладку и
 * спросить игрока. На злоумышленника это не рассчитано, и рассчитывать не надо.
 */
import { serverNow } from './clock';

const DEVICE_KEY = 'tribe.device.v1';
const LEASE_KEY = 'tribe.tab.v1';

/** Как часто ведущая вкладка подновляет отметку. */
export const LEASE_BEAT_MS = 3000;
/** Насколько старая отметка считается брошенной: вкладку закрыли или усыпили. */
export const LEASE_STALE_MS = 12000;

const rnd = (): string => Math.random().toString(36).slice(2, 10);

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage может быть недоступен — тогда договориться не о чем */
  }
};

let deviceId: string | null = null;

/** Постоянный признак этого браузера. Заводится при первом обращении. */
export function device(): string {
  if (deviceId) return deviceId;
  const stored = read(DEVICE_KEY);
  deviceId = stored && stored.length <= 64 ? stored : `d-${rnd()}${rnd()}`;
  if (stored !== deviceId) write(DEVICE_KEY, deviceId);
  return deviceId;
}

/** Признак этого запуска игры. Живёт только в памяти вкладки. */
export const tab = `t-${rnd()}`;

interface Lease {
  tab: string;
  at: number;
}

const lease = (): Lease | null => {
  const raw = read(LEASE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Lease>;
    return typeof v.tab === 'string' && typeof v.at === 'number' ? { tab: v.tab, at: v.at } : null;
  } catch {
    return null;
  }
};

/** Кто ведёт партию: мы, другая живая вкладка или никто. */
export type LeaseHolder = 'mine' | 'other' | 'free';

export function leaseHolder(): LeaseHolder {
  const l = lease();
  if (!l) return 'free';
  if (l.tab === tab) return 'mine';
  return serverNow() - l.at > LEASE_STALE_MS ? 'free' : 'other';
}

/** Объявить ведущей эту вкладку и подновить отметку. */
export function claimLease(): void {
  write(LEASE_KEY, JSON.stringify({ tab, at: serverNow() } satisfies Lease));
}

/**
 * Подновить отметку, если ведём мы. Если ведёт не мы — не трогаем: перехват
 * ведения делается только по решению игрока, а не сам собой.
 */
export function beatLease(): boolean {
  if (leaseHolder() === 'other') return false;
  claimLease();
  return true;
}

/** Отпустить ведение: вкладку закрывают. */
export function dropLease(): void {
  if (leaseHolder() !== 'mine') return;
  try {
    localStorage.removeItem(LEASE_KEY);
  } catch {
    /* ignore */
  }
}
