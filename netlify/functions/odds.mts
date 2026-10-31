/**
 * Шанс окна вольного замка (`/api/odds`, ПН-Э2г) на Netlify. Счёт и разговор целиком — в общем обработчике `lib/routes/odds.ts`,
 * одном на Netlify и на своём сервере (`vps/`); здесь только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { odds } from '../lib/routes/odds.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/odds' };

export default (req: Request, _context: Context): Promise<Response> =>
  odds(req, { stores: blobsStores(), now: Date.now(), ip: null });
