/**
 * Вести края (`/api/feed`, docs/feed.md): лента событий региона спросившего. Один обработчик на Netlify
 * (`functions/feed.mts`) и на своём сервере (`vps/`). Записи выводит `lib/feed.ts`.
 *
 * Тела у запроса нет: записи пишет не клиент. Единственная запись обработчика — память первых мест рейтинга
 * (`feed.nextLeaders`), с условием по ETag: двое, прочитавшие разом, не запишут смену дважды — второй проиграет
 * условную запись и увидит смену уже в памяти. Не пробились — лента отдаётся без новой смены, она ляжет следующим
 * чтением.
 *
 * Личность — только из подписи: по ней регион и отметка своего города. Ключи игроков наружу не уходят.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { WRITE_TRIES, allow, botToken, deny, json, parseJson, type Route } from '../http.js';
import type { FeedResponse } from '../contract.js';
import { FEED_KEY, feedOf, nextLeaders, readLeaders } from '../feed.js';
import { ROSTER_KEY, readRoster } from '../roster.js';
import { WARS_KEY, readWars } from '../war.js';
import { ratingNow } from '../rating.js';
import { STORES } from '../kv.js';

/** Запросов в минуту на игрока. Карта спрашивает при входе и раз в `FEED_PULL_MS`, пока открыта. */
const PER_MINUTE = 12;

export const feed: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (req.method !== 'GET') return deny(405, 'method');
  if (!allow(`feed:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  // Эпоха мира (docs/test_world.md): игра прошлой эпохи вестей нового мира не читает — она перезапускается.
  const gone = await eraGate(req, io);
  if (gone) return gone;

  const cool = io.stores(STORES.world, 'eventual');
  const hot = io.stores(STORES.world, 'strong');
  const rosterFound = await cool.getWithMetadata(ROSTER_KEY);
  const roster = readRoster(rosterFound ? parseJson(String(rosterFound.data)) : null);
  const warsFound = await cool.getWithMetadata(WARS_KEY);
  const wars = readWars(warsFound ? parseJson(String(warsFound.data)) : null);

  const ranked = await ratingNow(io.stores);
  let leaders = readLeaders(null);
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await hot.getWithMetadata(FEED_KEY);
    leaders = readLeaders(found ? parseJson(String(found.data)) : null);
    const next = nextLeaders(leaders, ranked, now);
    if (!next) break;
    const etag = found?.etag ?? null;
    const written = await hot.setJSON(FEED_KEY, next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
    if (written.modified) {
      leaders = next;
      break;
    }
  }

  const body: FeedResponse = { now, items: feedOf({ wars, roster, leaders }, key, now) };
  return json(body);
};
