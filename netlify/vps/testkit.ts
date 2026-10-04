/**
 * Подставки для тестов сервера: два дома хранилища и честная подпись `initData`.
 *
 * Дом на Netlify Blobs поднимается **местным сервером Blobs** из самого пакета
 * (`@netlify/blobs/server` — им же пользуется `netlify dev`): тест говорит с ним настоящим
 * клиентом Blobs через ту же обёртку `lib/blobs.ts`, что и функции на Netlify. Дом на SQLite —
 * файл во временной папке, через `vps/sqlite.ts`. Набор тестов, прогнанный на обоих, и есть
 * проверка того, что двери у домов одинаковые.
 *
 * В сборку сервера этот файл не входит: его не импортирует `main.ts`.
 */
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';
import { blobsStores, type BlobsSite } from '../lib/blobs.js';
import type { Stores } from '../lib/kv.js';
import { openDb, sqliteStores } from './sqlite.js';

/** Токен бота в тестах. Не настоящий и настоящим быть не может. */
export const TEST_TOKEN = '123456:AA-test-token-not-a-real-one';

/** Подписанная строка запуска — тем же алгоритмом, каким её собирает Telegram (`initdata.test.ts`). */
export function signInit(id: number, authDate: number, token = TEST_TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAF',
    user: JSON.stringify({ id, first_name: 'Вождь' }),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

/** Настоящий `fetch` — до того, как тест подменит глобальный подставным (`functions.test.ts`). */
const realFetch = globalThis.fetch;

export const tempDir = (tag: string): string => mkdtempSync(join(tmpdir(), `tribe-${tag}-`));

export interface Home {
  name: 'sqlite' | 'blobs';
  stores: Stores;
  /**
   * Дать дому отметить запись. Местный сервер Blobs выводит ETag из времени файла с точностью до
   * миллисекунды: две записи одного ключа в одну миллисекунду получили бы один ETag, и проверка
   * «устаревший ETag отвергнут» прошла бы мимо. На настоящем Blobs и в SQLite такого нет.
   */
  settle(): Promise<void>;
  close(): Promise<void>;
}

export function sqliteHome(): Home {
  const dir = tempDir('sqlite');
  const db = openDb(join(dir, 'tribe.sqlite'));
  return {
    name: 'sqlite',
    stores: sqliteStores(db),
    settle: async () => {},
    close: async () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Местный сервер Blobs и адрес к нему — для дома и для подстановки контекста функциям Netlify.
 *
 * У местного сервера один пробел против настоящего Blobs: при чтении он не отдаёт ETag (запись
 * отдаёт, и условие `if-match` проверяет). Настоящий отдаёт — на этом держится сохранение на боевом
 * адресе. Пробел закрыт здесь, в подставном `fetch` клиента, тем же способом, каким сервер сам
 * выводит ETag при записи (`generateETag` по файлу ключа): иначе дом «Netlify Blobs» в тестах
 * отличался бы от настоящего ровно тем, что проверяется.
 */
export async function localBlobs(): Promise<{ site: BlobsSite; stop(): Promise<void> }> {
  const dir = tempDir('blobs');
  const token = 'local-blobs-token';
  const server = new BlobsServer({ directory: dir, token });
  const { port } = await server.start();
  const url = `http://127.0.0.1:${port}`;
  const inside = server as unknown as { getLocalPaths(u: URL): { dataPath?: string; key?: string } };
  const etagOf = (BlobsServer as unknown as { generateETag(path: string): Promise<string> }).generateETag.bind(BlobsServer);
  const withReadEtag: typeof fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || res.status !== 200 || res.headers.get('etag')) return res;
    const { dataPath, key } = inside.getLocalPaths(new URL(input instanceof Request ? input.url : String(input)));
    if (!dataPath || !key) return res; // перечисление, а не чтение ключа
    const headers = new Headers(res.headers);
    headers.set('etag', await etagOf(dataPath));
    return new Response(res.body, { status: res.status, headers });
  };
  return {
    site: { siteID: 'tribe-test-site', token, edgeURL: url, uncachedEdgeURL: url, fetch: withReadEtag },
    stop: async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function blobsHome(): Promise<Home> {
  const local = await localBlobs();
  return {
    name: 'blobs',
    stores: blobsStores(local.site),
    settle: () => new Promise((r) => setTimeout(r, 3)),
    close: local.stop,
  };
}
