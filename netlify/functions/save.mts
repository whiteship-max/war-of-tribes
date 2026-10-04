/**
 * Сохранение игрока (`/api/save`) на Netlify. Правила и разговор целиком — в общем обработчике
 * `lib/routes/save.ts`, одном на Netlify и на своём сервере (`vps/`); здесь только адрес и
 * хранилище платформы — Netlify Blobs, сайт и токен к которому подставляет сама платформа.
 */
import type { Config, Context } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { save } from '../lib/routes/save.js';

export const config: Config = {
  /**
   * Путь объявлен здесь, а не переписыванием в `netlify.toml`: у сайта стоит
   * общее правило «любой путь отдаёт index.html», и правило функции обязано
   * стоять раньше него. Объявленный путь платформа разбирает до переписываний,
   * поэтому порядок правил в двух файлах (`_redirects` и `netlify.toml`)
   * перестаёт иметь значение. Пишется он здесь литералом: платформа читает его
   * из исходника. Тот же путь у своего сервера — `lib/routes/index.ts`.
   */
  path: '/api/save',
};

export default (req: Request, _context: Context): Promise<Response> =>
  save(req, { stores: blobsStores(), now: Date.now(), ip: null });
