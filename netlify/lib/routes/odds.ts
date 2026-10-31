/**
 * Шанс окна вольного замка (`GET /api/odds?castle=free:x:y`, ПН-Э2г; docs/gdd/path_of_sword.md, 23.11; граница доверия — 6а). Один
 * обработчик на Netlify (`functions/odds.mts`) и на своём сервере. Счёт, кэш и нагрузка — `lib/oddsdesk.ts`, здесь — личность, сито и
 * разбор слов.
 *
 * Личность — только из подписи. Путь меча закрыт игроку (`roamflag.roamOpenFor`: до выпуска — не админу) — 403, ни слова о замке. От
 * клиента — только ключ замка; состав отряда, его клетка и престиж — реестр сервера. Записей обработчик не пишет: реестр и войны он
 * только читает.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { allow, botToken, deny, json, parseJson, type Route } from '../http.js';
import { readOddsCastle, type OddsResponse } from '../contract.js';
import { ROSTER_KEY, readRoster } from '../roster.js';
import { WARS_KEY, readWars } from '../war.js';
import { STORES } from '../kv.js';
import { isAdmin } from '../admin.js';
import { roamOpenFor } from '../../../src/game/roamflag.js';
import { ODDS_LIMITS, desk, oddsAsk } from '../oddsdesk.js';

export const odds: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');
  if (req.method !== 'GET') return deny(405, 'method');
  // Путь меча — по игроку: правило одно с клиентом и с реестром (`routes/castles`).
  if (!roamOpenFor(isAdmin(auth.user.id))) return deny(403, 'closed');
  const key = saveKeyOf(auth.user);
  if (!allow(`odds:${key}`, ODDS_LIMITS.perMinute, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  const gone = await eraGate(req, io);
  if (gone) return gone;
  const castle = readOddsCastle(new URL(req.url, 'http://local').searchParams.get('castle'));
  if (!castle) return deny(400, 'bad-castle');

  // Реестр и войны живут минутами: чтения хватает нестрогого, как у ответа реестра.
  const cool = io.stores(STORES.world, 'eventual');
  const [r, w] = await Promise.all([cool.getWithMetadata(ROSTER_KEY), cool.getWithMetadata(WARS_KEY)]);
  const roster = readRoster(r ? parseJson(String(r.data)) : null);
  const wars = readWars(w ? parseJson(String(w.data)) : null);
  const ask = oddsAsk(roster, wars, key, castle, now);
  if (typeof ask === 'string') return json({ now, error: ask } satisfies OddsResponse);
  const got = await desk.ask(key, ask, now);
  const body: OddsResponse =
    'rows' in got ? { now, rows: got.rows.map(({ text, ok }) => ({ text, ok })) } : 'wait' in got ? { now, wait: true } : { now, error: got.error };
  return json(body);
};
