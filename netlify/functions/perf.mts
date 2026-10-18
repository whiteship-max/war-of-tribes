/**
 * Замеры плавности с телефонов (`/api/perf`) на Netlify. Правила целиком — в общем обработчике `lib/routes/perf.ts`, одном
 * на Netlify и на своём сервере (`vps/`); здесь только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { perf } from '../lib/routes/perf.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/perf' };

export default (req: Request, _context: Context): Promise<Response> =>
  perf(req, { stores: blobsStores(), now: Date.now(), ip: null });
