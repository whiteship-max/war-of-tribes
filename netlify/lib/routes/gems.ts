/**
 * Алмазы (`/api/gems`, docs/gems.md): свой баланс, лавка и журнал — чтением, трата — приказом. Один обработчик на Netlify
 * (`functions/gems.mts`) и на своём сервере (`vps/`). Правила — в `lib/gems.ts` и `src/game/gemrules.ts`.
 *
 * Личность — только из подписи, как везде: читать и тратить можно только свои алмазы. Начислить приказом нельзя ничего:
 * у приказа два вида — купить в лавке и ускорить стройку, — и оба только списывают. Стартовые кладёт сама книга при первом
 * входе в эпоху мира (`gems.openLedger`, дверь `creditGems`).
 *
 * Заморозка (docs/admin.md): замороженный видит свои алмазы, но приказы его не принимаются.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import { readGemOrder, type GemOrder, type GemsResponse } from '../contract.js';
import { FROZEN_ORDER, frozenNow, isFrozen } from '../admin.js';
import { gemNoteOf, listOf, settleGems, shown } from '../gems.js';
import { councilMult, noted, observe, readWatchRecord, townOf, warned } from '../watch.js';
import { rushFloor } from '../town.js';
import { STORES } from '../kv.js';
import { BUILDING_BY_ID } from '../../../src/game/data/buildings.js';
import type { BuildingTypeId } from '../../../src/game/types.js';
import { gemLine } from '../../../src/game/gemrules.js';

/** Запросов в минуту на игрока. Игра читает при открытии окна и приказывает по нажатию. */
const PER_MINUTE = 60;

export const gems: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(`gems:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  // Эпоха мира (docs/test_world.md): после чистого старта старая партия алмазов не тратит.
  const gone = await eraGate(req, io);
  if (gone) return gone;

  let order: GemOrder | null = null;
  if (req.method === 'POST') {
    const text = await readBody(req);
    if (text === null) return deny(413, 'too-big');
    order = readGemOrder(parseJson<unknown>(text));
    if (!order) return deny(400, 'bad-body');
  } else if (req.method !== 'GET') {
    return deny(405, 'method');
  }

  // Приказ замороженного — отказ словами; книгу он только читает.
  const frozen = order !== null && isFrozen(await frozenNow(io.stores), key);
  // Остаток стройки сервер считает сам — по книге стройки (docs/pvp.md, раздел 7; дыра docs/gems.md, 5.1 закрыта).
  const left = order?.op === 'rush' && !frozen ? await rushLeft(io, key, order.building, order.level, now) : undefined;
  const done = await settleGems(io.stores, key, now, frozen ? null : order, left);
  if (!done) return deny(503, 'busy', { 'retry-after': '3' });

  const error = frozen ? FROZEN_ORDER : done.error;
  // Партия применит дела сама, по номеру: все, что лежат, — лишние она отсеет.
  const body: GemsResponse = {
    now,
    ...gemNoteOf(done.ledger, 0, now),
    list: listOf(done.ledger),
    ...(done.entry ? { entry: shown(done.entry) } : {}),
    ...(error ? { error } : {}),
  };
  // Трата — в журнал города (наблюдение, docs/admin.md): админ видит её и в `/player`.
  if (order && done.entry && !error && done.entry.key === order.key && done.entry.at === now) {
    const line = gemLine(done.entry);
    await observe(io.stores, key, (rec) => noted(rec, now, 'deed', `Алмазы: ${line}.`));
  }
  // Невозможное — отказ и строка «внимание:» в журнале города (docs/security.md): цена ниже той, что оставляет книга стройки.
  const warn = done.warn;
  if (warn) await observe(io.stores, key, (rec) => warned(rec, now, warn));
  return json(body);
};

/**
 * Сколько работы стройки наверняка осталось по книге стройки игрока (`town.rushFloor`); `null` — такой стройки по книге
 * быть не может. Записи наблюдения нет — книга посёлка новой партии с первой встречи. Хранилище не ответило — `undefined`:
 * цена по остатку игры, как до книги (ускорение не падает из-за попутного чтения).
 */
async function rushLeft(io: Parameters<Route>[1], key: string, building: string, level: number, now: number): Promise<number | null | undefined> {
  if (!(building in BUILDING_BY_ID)) return null;
  try {
    const found = await io.stores(STORES.watch, 'strong').getWithMetadata(key);
    const rec = readWatchRecord(found ? parseJson(String(found.data)) : null);
    const card = rec.card;
    const town = townOf(rec, now);
    // Староста подтверждённого совета (РТ-1) ускоряет стройку — остаток по книге меньше той же долей.
    const steward = card ? councilMult(card, 'steward', town.levels.town_hall ?? 0) : 1;
    return rushFloor(town, card?.buildings ?? {}, card?.bonded ?? 0, building as BuildingTypeId, level, now, steward);
  } catch {
    return undefined;
  }
}
