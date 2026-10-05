/**
 * Вебхук бота (`/api/bot`) на Netlify: кнопки «Отключить уведомления» и «Включить» под сообщениями. Правила и
 * разговор целиком — в общем обработчике `lib/routes/bot.ts`, одном на Netlify и на своём сервере (`vps/`); здесь
 * только адрес и хранилище платформы.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { bot } from '../lib/routes/bot.js';

/** Путь объявляет функция — по той же причине, что и у сохранения (`save.mts`). */
export const config: Config = { path: '/api/bot' };

export default (req: Request, _context: Context): Promise<Response> =>
  bot(req, { stores: blobsStores(), now: Date.now(), ip: null });
