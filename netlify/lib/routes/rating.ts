/**
 * Рейтинг игроков (`/api/rating`, docs/rating.md): все игроки мира, место и очки. Один обработчик на Netlify
 * (`functions/rating.mts`) и на своём сервере (`vps/`). Счёт — в `lib/rating.ts`.
 *
 * Только чтение: обработчик ничего не пишет и ничего не принимает. Очки считает сервер — мощь из описи наблюдения, победы
 * и взятые города из записи войн; тела у запроса нет, и прислать очки нечем.
 *
 * Личность — только из подписи: по ней отмечается своя строка. Ключи игроков наружу не уходят — только номера замков.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { allow, botToken, deny, json, type Route } from '../http.js';
import type { RatingResponse } from '../contract.js';
import { publicRow, ratingNow } from '../rating.js';

/** Запросов в минуту на игрока. Экран спрашивает при открытии и раз в `RATING_PULL_MS`, пока открыт. */
const PER_MINUTE = 12;

export const rating: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (req.method !== 'GET') return deny(405, 'method');
  if (!allow(`rating:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  // Эпоха мира (docs/test_world.md): игра прошлой эпохи рейтинга нового мира не читает — она перезапускается.
  const gone = await eraGate(req, io);
  if (gone) return gone;

  const rows = await ratingNow(io.stores);
  const body: RatingResponse = { now, rows: rows.map((r) => publicRow(r, key)) };
  return json(body);
};
