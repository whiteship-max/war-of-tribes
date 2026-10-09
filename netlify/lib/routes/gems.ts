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
import { noted, observe } from '../watch.js';
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
  const done = await settleGems(io.stores, key, now, frozen ? null : order);
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
  return json(body);
};
