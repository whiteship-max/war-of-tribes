/**
 * Исходящие уведомления (`/api/notify`) на Netlify. Правила и разговор целиком — в общем обработчике
 * `lib/routes/notify.ts`, одном на Netlify и на своём сервере (`vps/`); здесь только адрес и
 * хранилище платформы — Netlify Blobs, сайт и токен к которому подставляет сама платформа.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { notify } from '../lib/routes/notify.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/notify' };

export default (req: Request, _context: Context): Promise<Response> =>
  notify(req, { stores: blobsStores(), now: Date.now(), ip: null });
