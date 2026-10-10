/**
 * Оплата наборов алмазов (`/api/pay`) на Netlify. Правила целиком — в общем обработчике `lib/routes/pay.ts`, одном на
 * Netlify и на своём сервере (`vps/`); здесь только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { pay } from '../lib/routes/pay.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/pay' };

export default (req: Request, _context: Context): Promise<Response> =>
  pay(req, { stores: blobsStores(), now: Date.now(), ip: null });
