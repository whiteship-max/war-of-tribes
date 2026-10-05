/**
 * Война между игроками (`/api/war`): свои войны и приказы. Один обработчик на Netlify
 * (`functions/war.mts`) и на своём сервере (`vps/`). Правила — в `lib/war.ts`, разбор слов — здесь.
 *
 * Третья запись, которую сервер читает насквозь (после реестра и исходящих), и первая, где он
 * **считает**: бой между игроками, часы голода, участь взятого города (решение владельца, docs/pvp.md).
 * Судьёй читерства он от этого не стал — он только не даёт стороне назвать свой исход: в приказе поля
 * исхода нет, бой считается здесь, по слепкам обороны из записей партий обоих игроков.
 *
 * Личность — только из подписи, как везде. Чужая партия здесь **только читается** и только слепком
 * обороны (`readStoredSheet`): писать в хранилище партий этот обработчик не умеет — это тест.
 * Ключ защитника приходит не из тела запроса, а из реестра (по номеру замка) или из самой войны.
 *
 * Тика нет: всё назначенное к этой минуте разбирается здесь, при обращении любой из сторон (`advance`).
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { WRITE_TRIES, allow, botToken, deny, json, parseJson, readBody, warPace, type Route } from '../http.js';
import { readWarOrder, type WarOrder, type WarResponse } from '../contract.js';
import { castleIdOf, readRoster } from '../roster.js';
import { advance, applyOrder, dueKeys, pruneWars, readStoredSheet, readWars, setWarPace, warsOf, type SheetAt } from '../war.js';
import { STORES } from '../kv.js';

/** Все войны лежат одной записью рядом с реестром. */
const KEY = 'wars';
/** Реестр замков — та же запись, что держит `routes/castles.ts`; здесь он только читается. */
const ROSTER = 'roster';

/** Запросов в минуту на игрока. Игра читает раз в `WAR_PULL_MS` (`src/net/war.ts`), приказы — по нажатию. */
const PER_MINUTE = 60;

export const war: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(`war:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });

  let order: WarOrder | null = null;
  if (req.method === 'POST') {
    const text = await readBody(req);
    if (text === null) return deny(413, 'too-big');
    order = readWarOrder(parseJson<unknown>(text));
    if (!order) return deny(400, 'bad-body');
  } else if (req.method !== 'GET') {
    return deny(405, 'method');
  }

  const hot = io.stores(STORES.world, 'strong');
  const cool = io.stores(STORES.world, 'eventual');
  const saves = io.stores(STORES.saves, 'strong');
  const pace = warPace();
  setWarPace(pace);

  // Слепки обороны — из записей партий, по ключу из реестра или из самой войны. Только чтение.
  const sheets = new Map<string, SheetAt | null>();
  const load = async (player: string): Promise<void> => {
    if (sheets.has(player)) return;
    const found = await saves.getWithMetadata(player);
    sheets.set(player, readStoredSheet(found ? parseJson(String(found.data)) : null));
  };

  const rosterFound = order?.op === 'march' ? await cool.getWithMetadata(ROSTER) : null;
  const roster = readRoster(rosterFound ? parseJson(String(rosterFound.data)) : null);

  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await hot.getWithMetadata(KEY);
    const file = readWars(found ? parseJson(String(found.data)) : null);
    const etag = found?.etag ?? null;

    for (const player of dueKeys(file, now)) await load(player);
    let changed = advance(file, now, sheets);

    let error: string | null = null;
    if (order) {
      await load(key);
      const target = order.op === 'march' ? order.target : null;
      if (target) {
        const row = Object.keys(roster.rows).find((k) => castleIdOf(k) === target);
        if (row) await load(row);
      }
      if (order.op === 'storm') {
        const w = file.wars.find((x) => x.id === (order as { id: string }).id);
        if (w) await load(w.def);
      }
      error = applyOrder(file, key, order, now, { roster, sheet: (player) => sheets.get(player) ?? null });
      if (!error) changed = true;
    }
    const before = file.wars.length;
    pruneWars(file, now);
    if (file.wars.length !== before) changed = true;

    const body: WarResponse = { now, wars: warsOf(file, key), ...(pace !== 1 ? { pace } : {}), ...(error ? { error } : {}) };
    if (!changed) return json(body);
    const written = await hot.setJSON(KEY, file, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
    if (written.modified) return json(body);
  }

  // Не пробились за `WRITE_TRIES` попыток: запись общая, кто-то писал быстрее. Игра спросит ещё раз.
  return deny(429, 'slow-down', { 'retry-after': '3' });
};
