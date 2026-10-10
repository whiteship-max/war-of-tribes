/**
 * Адреса сервера — один список на два дома. Netlify объявляет путь в каждой функции сам
 * (`export const config = { path }` — платформа читает его из исходника, и вынести его оттуда
 * нельзя); свой сервер берёт пути отсюда. Что пути двух домов одни и те же и ведут к одним и тем же
 * обработчикам, держит тест (`vps/routes.test.ts`): адрес, заведённый только в одном доме, клиент
 * заметил бы первым — как страницу игры вместо ответа.
 */
import type { Route } from '../http.js';
import { bot } from './bot.js';
import { castles } from './castles.js';
import { feed } from './feed.js';
import { gems } from './gems.js';
import { notify } from './notify.js';
import { pay } from './pay.js';
import { rating } from './rating.js';
import { report } from './report.js';
import { save } from './save.js';
import { time } from './time.js';
import { war } from './war.js';

export const ROUTES: Readonly<Record<string, Route>> = {
  '/api/save': save,
  '/api/castles': castles,
  '/api/notify': notify,
  '/api/time': time,
  '/api/war': war,
  '/api/bot': bot,
  '/api/report': report,
  '/api/rating': rating,
  '/api/gems': gems,
  '/api/pay': pay,
  '/api/feed': feed,
};
