/**
 * Админка (docs/admin.md): кто админ, заморозка, указы и журнал админа — записи хранилища `tribe-admin`.
 *
 * Пишет сюда только команда бота от админа (`commands.ts`). Читают: сохранение (заморозка и указы для своего
 * ключа), война и проход доставки (заморозка — на замороженный город войско не ходит).
 *
 * **Указ — запись в журнале игрока, а не правка партии.** Сервер партию не разбирает и не переписывает: он кладёт
 * указ с номером, клиент применяет его одной дверью (`src/game/sim/admin.ts`) и помнит номер. Алмазов в указе нет:
 * виды берутся только из `STOCK_KEYS` и `TROOP_KEYS` договора.
 */
import { parseJson, WRITE_TRIES } from './http.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { GRANTS_KEEP, readGrant, type AdminGrant, type AdminNote } from './contract.js';

/**
 * Админы — `ADMIN_IDS` из окружения: идентификаторы Telegram через запятую или пробел. Пусто или кривое — админов
 * нет, и бот на команды молчит для всех. Список не кэшируется: владелец правит переменную, и она действует со
 * следующего обновления.
 */
export function adminIds(env: Record<string, string | undefined> = process.env): Set<number> {
  const out = new Set<number>();
  for (const part of (env.ADMIN_IDS ?? '').split(/[\s,;]+/)) {
    if (!/^[1-9]\d{0,15}$/.test(part)) continue;
    const n = Number(part);
    if (Number.isSafeInteger(n)) out.add(n);
  }
  return out;
}

export const isAdmin = (id: number, env: Record<string, string | undefined> = process.env): boolean => adminIds(env).has(id);

/** Ключ игрока — тот же вид, что у сохранения и исходящих. */
export const PLAYER = /^tg-[1-9]\d{0,19}$/;

// ------------------------------------------------ заморозка ---

/** Ключ записи заморозки: одна на всех, её читают сохранение, война и доставка. */
export const FROZEN_KEY = 'frozen';

export interface FrozenFile {
  v: 1;
  /** Замороженные: ключ игрока → когда, кто и почему. */
  keys: Record<string, { at: number; by: number; why: string }>;
}

export function readFrozen(v: unknown): FrozenFile {
  const out: FrozenFile = { v: 1, keys: {} };
  const keys = (v as { keys?: unknown } | null)?.keys;
  if (!keys || typeof keys !== 'object') return out;
  for (const [k, raw] of Object.entries(keys as Record<string, unknown>)) {
    if (!PLAYER.test(k) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    out.keys[k] = {
      at: typeof r.at === 'number' ? r.at : 0,
      by: typeof r.by === 'number' ? r.by : 0,
      why: typeof r.why === 'string' ? r.why.slice(0, 200) : '',
    };
  }
  return out;
}

/** Заморозка из хранилища админки. */
export async function frozenIn(kv: Kv): Promise<FrozenFile> {
  const found = await kv.getWithMetadata(FROZEN_KEY);
  return readFrozen(found ? parseJson(String(found.data)) : null);
}

/** Заморозка сейчас. Читается строго: только что замороженный не должен успеть записать партию. */
export const frozenNow = (stores: Stores): Promise<FrozenFile> => frozenIn(stores(STORES.admin, 'strong'));

export const isFrozen = (file: FrozenFile, player: string): boolean => player in file.keys;

/** Отказ войны замороженному — словами, как все отказы приказа. */
export const FROZEN_ORDER = 'Счёт заморожен. Приказы не принимаются.';

/** Отказ похода на замороженный город. Почему закрыт — нападающему знать незачем. */
export const FROZEN_TARGET = 'Этот город сейчас закрыт для войны.';

// ------------------------------------------------ указы ---

/** Указ на сервере: то, что видит клиент, плюс кто отдал. */
export interface StoredGrant extends AdminGrant {
  by: number;
}

export interface GrantsFile {
  v: 1;
  /** Последний выданный номер. Растёт и не уменьшается, даже когда старые указы обрезаны. */
  seq: number;
  list: StoredGrant[];
}

export const grantsKey = (player: string): string => `grants/${player}`;

export function readGrants(v: unknown): GrantsFile {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const list: StoredGrant[] = [];
  if (Array.isArray(r.list)) {
    for (const raw of r.list) {
      const g = readGrant(raw);
      if (!g) continue;
      const by = (raw as { by?: unknown }).by;
      list.push({ ...g, by: typeof by === 'number' ? by : 0 });
    }
  }
  list.sort((a, b) => a.n - b.n);
  const top = list.length ? list[list.length - 1].n : 0;
  const seq = typeof r.seq === 'number' && Number.isInteger(r.seq) ? Math.max(r.seq, top) : top;
  return { v: 1, seq, list: list.slice(-GRANTS_KEEP) };
}

/** Указы игрока. */
export async function grantsOf(stores: Stores, player: string): Promise<GrantsFile> {
  const found = await stores(STORES.admin, 'strong').getWithMetadata(grantsKey(player));
  return readGrants(found ? parseJson(String(found.data)) : null);
}

/** Записка для клиента: заморожен ли и какие указы младше номера, который партия уже применила. */
export const noteOf = (frozen: boolean, grants: GrantsFile, seen: number): AdminNote => ({
  frozen,
  grants: grants.list.filter((g) => g.n > seen).map(({ n, at, stock, troops }) => ({ n, at, stock, troops })),
});

// ------------------------------------------------ журнал админа ---

export const LOG_KEY = 'log';
/** Сколько последних действий админа лежит. */
export const LOG_KEEP = 500;

export interface AdminLogEntry {
  at: number;
  /** Кто: идентификатор админа. */
  by: number;
  /** Кому: ключ игрока; действие без игрока — пусто. */
  who: string;
  /** Что сделано, словами. */
  what: string;
}

export interface AdminLogFile {
  v: 1;
  list: AdminLogEntry[];
}

export function readAdminLog(v: unknown): AdminLogFile {
  const list = (v as { list?: unknown } | null)?.list;
  const out: AdminLogEntry[] = [];
  if (Array.isArray(list)) {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.at !== 'number' || typeof r.by !== 'number' || typeof r.what !== 'string') continue;
      out.push({ at: r.at, by: r.by, who: typeof r.who === 'string' ? r.who : '', what: r.what.slice(0, 500) });
    }
  }
  return { v: 1, list: out.slice(-LOG_KEEP) };
}

// ------------------------------------------------ запись поверх ETag ---

/**
 * Переписать запись поверх той версии, что прочли: `change` получает разобранное и возвращает новое (или `null` —
 * ничего не менять). Не пробились за `WRITE_TRIES` — `null`. Одна дверь записи для админки, наблюдения и отчётов.
 */
export async function rewrite<T>(kv: Kv, key: string, reader: (v: unknown) => T, change: (cur: T) => T | null): Promise<T | null> {
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const was = await kv.getWithMetadata(key);
    const next = change(reader(was ? parseJson(String(was.data)) : null));
    if (next === null) return null;
    const written = await kv.setJSON(key, next, was?.etag ? { onlyIfMatch: was.etag } : { onlyIfNew: true });
    if (written.modified) return next;
  }
  return null;
}

/** Дописать строку в журнал админа. Не легло — действие уже сделано, и молчать о нём хуже: ответ скажет. */
export async function logAdmin(stores: Stores, entry: AdminLogEntry): Promise<boolean> {
  const done = await rewrite(stores(STORES.admin, 'strong'), LOG_KEY, readAdminLog, (cur) => ({ v: 1 as const, list: [...cur.list, entry].slice(-LOG_KEEP) }));
  return done !== null;
}
