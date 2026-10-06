/**
 * Эпоха мира и чистый старт (docs/test_world.md).
 *
 * Эпоха — номер мира: `/wipeworld ДА` стирает сервер и поднимает его на единицу. Игра шлёт свою эпоху заголовком
 * (`contract.ERA_HEADER`) с каждым запросом партии, реестра, войны и уведомлений; у сервера другая — ответ 410, и не
 * записано ничего. Так старая партия с телефона не воскресает: её не примут ни запись, ни реестр, ни война, а игра,
 * узнав новую эпоху, свою старую не загружает (`src/net/era.ts`).
 *
 * Пока идёт стирание, эпоха стоит «закрытой» (`wiping`): все адреса отвечают 503 — стирание не перемешается с записью
 * того, кто уже успел начать новую партию. Стирание оборвалось (срок функции) — мир остаётся закрытым, пока админ не
 * повторит команду: повтор дотирает и открывает.
 */
import { WRITE_TRIES, deny, json, parseJson, type Io } from './http.js';
import { STORES, type Kv, type StoreName, type Stores } from './kv.js';
import { ERA_HEADER, readEra, type EraGoneResponse } from './contract.js';
import { LOG_KEY, FROZEN_KEY, logAdmin } from './admin.js';
import { ROSTER_KEY, readRoster } from './roster.js';
import type { RosterFile } from './contract.js';

/** Ключ эпохи в хранилище общего мира — рядом с реестром замков и войной. */
export const ERA_KEY = 'era';

export interface EraFile {
  v: 1;
  /** Номер эпохи. Записи нет — 0. */
  era: number;
  /** Идёт стирание: адреса закрыты. */
  wiping?: boolean;
  /** Когда эпоха началась (или стирание). */
  at: number;
}

export function readEraFile(v: unknown): EraFile {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<EraFile>;
  const era = Number.isSafeInteger(r.era) && (r.era as number) >= 0 ? (r.era as number) : 0;
  const at = Number.isFinite(r.at) ? Math.max(0, Math.floor(r.at as number)) : 0;
  return { v: 1, era, ...(r.wiping === true ? { wiping: true } : {}), at };
}

/** Эпоха сейчас — строгим чтением: после стирания каждый адрес обязан видеть новую сразу. */
export async function eraNow(stores: Stores): Promise<EraFile> {
  const found = await stores(STORES.world, 'strong').getWithMetadata(ERA_KEY);
  return readEraFile(found ? parseJson(String(found.data)) : null);
}

/**
 * Пропустить запрос или отказать. `null` — эпоха та же, обработчик идёт дальше. Отказ — 503 на время стирания и 410
 * с номером эпохи, если у игры другая: игра забывает старую партию и начинает новую.
 */
export async function eraGate(req: Request, io: Io): Promise<Response | null> {
  const cur = await eraNow(io.stores);
  if (cur.wiping) return deny(503, 'wiping', { 'retry-after': '15' });
  if (readEra(req.headers.get(ERA_HEADER)) === cur.era) return null;
  const body: EraGoneResponse = { error: 'era', era: cur.era, now: io.now };
  return json(body, 410);
}

/**
 * Что стирает чистый старт: партии, общий мир (реестр замков, война — всё, кроме самой эпохи), исходящие уведомления и
 * их индекс, счётчики доставки, наблюдение (журналы городов, опись, флаги), отчёты об ошибках и указы. Заморозка и журнал
 * админа остаются: заморожен человек, а не партия, и журнал админа хранит само стирание.
 */
export const WIPED: readonly StoreName[] = [STORES.saves, STORES.world, STORES.notify, STORES.due, STORES.stats, STORES.watch, STORES.reports];

/** В хранилище админки стираются указы — они относятся к партии. Остаются эти ключи. */
export const ADMIN_KEEP: readonly string[] = [FROZEN_KEY, LOG_KEY];

/** Сколько ключей стирается разом: хранилище по сети, по одному — минуты на сотне игроков. */
const BATCH = 24;

async function sweep(kv: Kv, keep: (key: string) => boolean): Promise<number> {
  const { blobs } = await kv.list({});
  const keys = blobs.map((b) => b.key).filter((k) => !keep(k));
  for (let i = 0; i < keys.length; i += BATCH) await Promise.all(keys.slice(i, i + BATCH).map((k) => kv.delete(k)));
  return keys.length;
}

/** Поставить эпоху: условной записью поверх прочитанной, как всё общее. Не пробились — `null`. */
async function setEra(kv: Kv, change: (cur: EraFile) => EraFile): Promise<EraFile | null> {
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const was = await kv.getWithMetadata(ERA_KEY);
    const next = change(readEraFile(was ? parseJson(String(was.data)) : null));
    const written = await kv.setJSON(ERA_KEY, next, was?.etag ? { onlyIfMatch: was.etag } : { onlyIfNew: true });
    if (written.modified) return next;
  }
  return null;
}

export interface Wiped {
  /** Новая эпоха. */
  era: number;
  /** Сколько ключей стёрто по хранилищам. */
  counts: Record<string, number>;
}

/**
 * Чистый старт. Порядок — закрыть, стереть, открыть новой эпохой: между первым и последним шагом ни одна запись не
 * проходит (503), и стирание не съест партию того, кто уже начал заново. Возвращает новую эпоху или отказ словами.
 */
export async function wipeWorld(stores: Stores, admin: number, now: number): Promise<Wiped | string> {
  const world = stores(STORES.world, 'strong');
  const closed = await setEra(world, (cur) => ({ v: 1, era: cur.era, wiping: true, at: now }));
  if (!closed) return 'Не удалось закрыть мир: кто-то пишет в него прямо сейчас. Повтори /wipeworld ДА.';
  const counts: Record<string, number> = {};
  for (const name of WIPED) counts[name] = await sweep(stores(name, 'strong'), (k) => name === STORES.world && k === ERA_KEY);
  counts[STORES.admin] = await sweep(stores(STORES.admin, 'strong'), (k) => ADMIN_KEEP.includes(k));
  const opened = await setEra(world, (cur) => ({ v: 1, era: cur.era + 1, at: now }));
  if (!opened) return 'Сервер стёрт, но открыть мир не удалось. Повтори /wipeworld ДА — повтор дотрёт и откроет.';
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  await logAdmin(stores, { at: now, by: admin, who: '', what: `Чистый старт: эпоха мира ${opened.era}, стёрто записей ${total}` });
  return { era: opened.era, counts };
}

/** Для `/spawns`: реестр замков и эпоха — только чтение. Команды в хранилище общего мира не ходят сами (`server.test.ts`). */
export async function spawnsNow(stores: Stores): Promise<{ roster: RosterFile; era: EraFile }> {
  const found = await stores(STORES.world, 'strong').getWithMetadata(ROSTER_KEY);
  return { roster: readRoster(found ? parseJson(String(found.data)) : null), era: await eraNow(stores) };
}
