/**
 * Хранилище на Netlify Blobs — дверь `kv.ts` поверх `getStore`.
 *
 * На Netlify сайт и токен подставляет платформа, и `blobsStores()` зовут без доводов. Снаружи —
 * на своём сервере с `TRIBE_STORE=blobs` и в переносе данных (`vps/import.ts`) — их называют
 * явно: номер сайта и личный токен Netlify.
 *
 * Обёртка почти пустая, и это её главное свойство: всё, что она делает, — сужает Blobs до двери
 * и приводит условие записи к тому виду, который Blobs принимает (`onlyIfMatch` и `onlyIfNew`
 * вместе он не берёт).
 */
import { getStore } from '@netlify/blobs';
import type { Conditions, Kv, Stores } from './kv.js';

/** Где лежат блобы, если не на Netlify. Адреса и `fetch` — только для тестов на местном сервере Blobs. */
export interface BlobsSite {
  siteID: string;
  token: string;
  apiURL?: string;
  edgeURL?: string;
  uncachedEdgeURL?: string;
  fetch?: typeof globalThis.fetch;
}

const conditions = (opts?: Conditions): { onlyIfMatch: string } | { onlyIfNew: true } | Record<string, never> =>
  opts?.onlyIfMatch ? { onlyIfMatch: opts.onlyIfMatch } : opts?.onlyIfNew ? { onlyIfNew: true } : {};

export const blobsStores =
  (site?: BlobsSite): Stores =>
  (name, consistency = 'strong') => {
    const s = getStore({ name, consistency, ...site });
    const kv: Kv = {
      getWithMetadata: async (key) => {
        const found = await s.getWithMetadata(key, { type: 'text' });
        return found ? { data: String(found.data), etag: found.etag } : null;
      },
      // Пустое условие на ETag — не сходится (OPS-3): Blobs без условия писал бы поверх лежащего.
      setJSON: (key, value, opts) =>
        opts && 'onlyIfMatch' in opts && !opts.onlyIfMatch ? Promise.resolve({ modified: false }) : s.setJSON(key, value, conditions(opts)),
      set: (key, value) => s.set(key, value),
      list: async (opts) => {
        const { blobs, directories } = await s.list(opts);
        return { blobs: blobs.map((b) => ({ key: b.key })), directories };
      },
      delete: (key) => s.delete(key),
    };
    return kv;
  };
