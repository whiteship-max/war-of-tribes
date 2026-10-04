/**
 * Серверные часы (`/api/time`) на Netlify. Правила и разговор целиком — в общем обработчике
 * `lib/routes/time.ts`, одном на Netlify и на своём сервере (`vps/`); здесь только адрес и
 * адрес клиента для сита частоты. Хранилище часам не нужно, но дверь у всех обработчиков одна.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { time } from '../lib/routes/time.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/time' };

export default (req: Request, context: Context): Promise<Response> =>
  time(req, { stores: blobsStores(), now: Date.now(), ip: context.ip ?? null });
