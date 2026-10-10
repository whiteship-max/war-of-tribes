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
 *
 * Заморозка (docs/admin.md): приказ замороженного не принимается, на замороженный город поход не уходит, а войско,
 * пришедшее к нему, поворачивает домой — слепка его обороны для войны нет, как у города, ушедшего из игры.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { WRITE_TRIES, allow, botToken, deny, inTurn, json, parseJson, readBody, spawnMode, warPace, type Route } from '../http.js';
import { cityOr, readWarOrder, type WarOrder, type WarResponse } from '../contract.js';
import { ROSTER_KEY, castleIdOf, readRoster } from '../roster.js';
import {
  advance,
  applyOrder,
  dueKeys,
  newsDiff,
  newsMap,
  pruneWars,
  readStoredSheet,
  readWars,
  setWarPace,
  spiesOf,
  spyMenuOf,
  warsOf,
  WARS_KEY,
  type SheetAt,
} from '../war.js';
import { queueNews } from '../outbox.js';
import { RIVAL_DEED_BY_ID } from '../../../src/world/data/spy.js';
import { STORES } from '../kv.js';
import { FROZEN_ORDER, FROZEN_TARGET, frozenNow, isFrozen } from '../admin.js';
import { addFlags, bookOf, noted, observe, readWatchRecord, townOf } from '../watch.js';

/** Все войны лежат одной записью рядом с реестром. */
const KEY = WARS_KEY;
/** Реестр замков — та же запись, что держит `routes/castles.ts`; здесь он только читается. */
const ROSTER = ROSTER_KEY;

/** Опросов в минуту на игрока. Игра читает раз в `WAR_PULL_MS` (`src/net/war.ts`). */
const PER_MINUTE = 60;
/**
 * Нажатий в минуту на игрока — приказов и меню лазутчика, своим ведром: опрос игры их не съедает. Приказ переписывает
 * общую запись войн, поэтому потолок есть, но выше того, что палец успевает через меню.
 */
const ORDERS_PER_MINUTE = 30;

export const war: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  // Опрос (`warPull`) и нажатия игрока — разные вёдра: в «час войны» приказ не ждёт, пока наполнится ведро опроса.
  const ask = req.method === 'GET' ? new URL(req.url, 'http://local').searchParams.get('spy') : null;
  const tap = req.method === 'POST' || !!ask;
  if (!allow(tap ? `warorder:${key}` : `war:${key}`, tap ? ORDERS_PER_MINUTE : PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  // Эпоха мира (docs/test_world.md): партия другой эпохи не пишется и не читается — после чистого старта она не воскресает.
  const gone = await eraGate(req, io);
  if (gone) return gone;

  let order: WarOrder | null = null;
  // Меню дел лазутчика против города (docs/spy_pvp.md): `GET /api/war?spy=<замок>` — шанс и гибель считает сервер.
  let spyAsk: string | null = null;
  if (req.method === 'POST') {
    const text = await readBody(req);
    if (text === null) return deny(413, 'too-big');
    order = readWarOrder(parseJson<unknown>(text));
    if (!order) return deny(400, 'bad-body');
  } else if (req.method !== 'GET') {
    return deny(405, 'method');
  } else {
    spyAsk = ask && ask.length <= 64 ? ask : null;
  }

  const hot = io.stores(STORES.world, 'strong');
  const cool = io.stores(STORES.world, 'eventual');
  const saves = io.stores(STORES.saves, 'strong');
  const watched = io.stores(STORES.watch, 'strong');
  const pace = warPace();
  setWarPace(pace);
  const frozen = await frozenNow(io.stores);

  // Слепки обороны — из записей партий, по ключу из реестра или из самой войны. Только чтение. Замороженного города
  // для войны нет: слепка нет, и пришедшее войско поворачивает (docs/admin.md).
  const sheets = new Map<string, SheetAt | null>();
  const load = async (player: string): Promise<void> => {
    if (sheets.has(player)) return;
    if (isFrozen(frozen, player)) {
      sheets.set(player, null);
      return;
    }
    const found = await saves.getWithMetadata(player);
    const sheet = readStoredSheet(found ? parseJson(String(found.data)) : null);
    if (!sheet) {
      sheets.set(player, null);
      return;
    }
    // Книги войска и стройки (docs/pvp.md, разделы 6 и 7): в бой идёт только подтверждённое. Записи наблюдения нет —
    // книги с этой минуты: войска, которое сервер не видел ни разу, он не подтверждает, а посёлок — новой партии.
    const seen = await watched.getWithMetadata(player);
    const rec = readWatchRecord(seen ? parseJson(String(seen.data)) : null);
    sheets.set(player, { ...sheet, book: bookOf(rec, now), town: townOf(rec, now) });
  };
  // Приказ сверх подтверждённого — флаг в описи наблюдения приказавшего (docs/admin.md, «Флаги»).
  const forged: { text: string | null; told: boolean } = { text: null, told: false };

  const byTarget = order?.op === 'march' || order?.op === 'spy' ? order.target : spyAsk;
  const rosterFound = byTarget ? await cool.getWithMetadata(ROSTER) : null;
  const roster = readRoster(rosterFound ? parseJson(String(rosterFound.data)) : null);

  // Чтение, ход и запись — по одному в экземпляре (`http.inTurn`): в давке приказ ждёт свою очередь, а не проигрывает
  // гонку условной записи четыре раза подряд.
  return inTurn(KEY, async () => {
    for (let tries = 0; tries < WRITE_TRIES; tries++) {
      const found = await hot.getWithMetadata(KEY);
      const file = readWars(found ? parseJson(String(found.data)) : null);
      const etag = found?.etag ?? null;
      // Новости для бота — разница записи до и после этого хода (`war.newsOf`): кладёт их тот, чья запись легла.
      const told = newsMap(file);

      for (const player of dueKeys(file, now)) await load(player);
      let changed = advance(file, now, sheets);

      let error: string | null = null;
      const targetKey = byTarget ? (Object.keys(roster.rows).find((k) => castleIdOf(k) === byTarget) ?? null) : null;
      if (order && isFrozen(frozen, key)) {
        error = FROZEN_ORDER;
      } else if (targetKey && isFrozen(frozen, targetKey)) {
        error = FROZEN_TARGET;
      } else if (order) {
        await load(key);
        if (targetKey) await load(targetKey);
        if (order.op === 'storm') {
          const w = file.wars.find((x) => x.id === (order as { id: string }).id);
          if (w) await load(w.def);
        }
        forged.text = null;
        error = applyOrder(file, key, order, now, {
          roster,
          sheet: (player) => sheets.get(player) ?? null,
          noShield: spawnMode() !== null,
          forged: (text) => {
            forged.text = text;
          },
        });
        if (!error) changed = true;
      }
      const before = file.wars.length;
      pruneWars(file, now);
      if (file.wars.length !== before) changed = true;

      let spyMenu: WarResponse['spyMenu'];
      if (spyAsk && !order) {
        if (isFrozen(frozen, key)) error = FROZEN_ORDER;
        else if (targetKey && isFrozen(frozen, targetKey)) error = FROZEN_TARGET;
        else {
          await load(key);
          if (targetKey) await load(targetKey);
          const menu = spyMenuOf(file, key, spyAsk, now, { roster, sheet: (player) => sheets.get(player) ?? null, noShield: spawnMode() !== null });
          if (typeof menu === 'string') error = menu;
          else spyMenu = menu;
        }
      }
      const spies = spiesOf(file, key);
      const body: WarResponse = {
        now,
        wars: warsOf(file, key),
        ...(spies.length ? { spies } : {}),
        ...(spyMenu ? { spyMenu } : {}),
        ...(pace !== 1 ? { pace } : {}),
        ...(error ? { error } : {}),
      };
      const flag = forged.text;
      if (flag && !forged.told) {
        forged.told = true;
        await observe(io.stores, key, (rec) => addFlags(rec, now, [{ kind: 'forged', text: flag }]));
      }
      if (!changed) return json(body);
      const written = await hot.setJSON(KEY, file, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
      if (written.modified) {
        await queueNews({ notify: io.stores(STORES.notify), due: io.stores(STORES.due) }, newsDiff(told, newsMap(file)), now);
        // Поход на игрока и дело лазутчика — в журнал города нападающего (наблюдение, docs/admin.md).
        if (order?.op === 'spy' && !error && targetKey) {
          const city = cityOr(roster.rows[targetKey]?.city);
          await observe(io.stores, key, (rec) => noted(rec, now, 'war', `Лазутчик к «${city}»: ${RIVAL_DEED_BY_ID[order.deed].name.toLowerCase()}.`));
        }
        if (order?.op === 'march' && !error && targetKey) {
          const city = cityOr(roster.rows[targetKey]?.city);
          await observe(io.stores, key, (rec) => noted({ ...rec, wars: rec.wars + 1 }, now, 'war', `Поход на «${city}» (${order.mode === 'storm' ? 'штурм' : 'осада'}).`));
        }
        return json(body);
      }
    }

    // Не пробились за `WRITE_TRIES` попыток: запись общая, кто-то писал быстрее. Игра спросит ещё раз.
    return deny(429, 'slow-down', { 'retry-after': '3' });
  });
};
