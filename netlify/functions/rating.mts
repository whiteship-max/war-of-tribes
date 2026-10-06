/**
 * Рейтинг игроков (`/api/rating`) на Netlify. Правила целиком — в общем обработчике `lib/routes/rating.ts`, одном на
 * Netlify и на своём сервере (`vps/`); здесь только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { rating } from '../lib/routes/rating.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/rating' };

export default (req: Request, _context: Context): Promise<Response> =>
  rating(req, { stores: blobsStores(), now: Date.now(), ip: null });
