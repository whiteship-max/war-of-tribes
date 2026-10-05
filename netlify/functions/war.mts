/**
 * Война между игроками (`/api/war`) на Netlify. Правила и разговор целиком — в общем обработчике
 * `lib/routes/war.ts`, одном на Netlify и на своём сервере (`vps/`); здесь только адрес и хранилище
 * платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { war } from '../lib/routes/war.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/war' };

export default (req: Request, _context: Context): Promise<Response> =>
  war(req, { stores: blobsStores(), now: Date.now(), ip: null });
