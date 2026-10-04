/**
 * Реестр замков (`/api/castles`) на Netlify. Правила и разговор целиком — в общем обработчике
 * `lib/routes/castles.ts`, одном на Netlify и на своём сервере (`vps/`); здесь только адрес и
 * хранилище платформы — Netlify Blobs, сайт и токен к которому подставляет сама платформа.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { castles } from '../lib/routes/castles.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/castles' };

export default (req: Request, _context: Context): Promise<Response> =>
  castles(req, { stores: blobsStores(), now: Date.now(), ip: null });
