/**
 * Отчёт об ошибке (`/api/report`) на Netlify. Правила целиком — в общем обработчике `lib/routes/report.ts`, одном на
 * Netlify и на своём сервере (`vps/`); здесь только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { report } from '../lib/routes/report.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/report' };

export default (req: Request, _context: Context): Promise<Response> =>
  report(req, { stores: blobsStores(), now: Date.now(), ip: null });
