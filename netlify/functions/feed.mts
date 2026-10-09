/**
 * Вести края (`/api/feed`) на Netlify. Правила целиком — в общем обработчике `lib/routes/feed.ts`, одном на Netlify и
 * на своём сервере (`vps/`); здесь только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { feed } from '../lib/routes/feed.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/feed' };

export default (req: Request, _context: Context): Promise<Response> =>
  feed(req, { stores: blobsStores(), now: Date.now(), ip: null });
