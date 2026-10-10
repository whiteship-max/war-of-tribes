/**
 * Оплата наборов алмазов (`/api/pay`, docs/payments.md). Один обработчик на Netlify (`functions/pay.mts`) и на своём
 * сервере (`vps/`). Правила — `lib/pay.ts` (заказы, проверка, начисление), сеть — `lib/ton.ts`.
 *
 *  · `GET` — заказы игрока; заодно проверка сети для тех, что ждут перевода, и начисление найденного;
 *  · `POST {op:'order', pack, wallet, chain}` — новый заказ и перевод для подписи кошельком;
 *  · `POST {op:'sent', id}` — кошелёк подписал: заказ «ждёт перевода». Ничего не начисляет.
 *
 * Личность — только из подписи, эпоха — `eraGate`. Замороженный новых заказов не делает, но оплаченное ему начисляется:
 * деньги ушли — алмазы ложатся. Оплата не настроена (нет `TON_WALLET` и мастера) — `on: false`, заказов нет.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import { readPayRequest, type PayRequest, type PayResponse } from '../contract.js';
import { FROZEN_ORDER, frozenNow, isFrozen } from '../admin.js';
import { checkOrders, createOrder, markSent, viewOf } from '../pay.js';
import { netFetch, payConfig, type Fetch } from '../ton.js';
import { noted, observe } from '../watch.js';

/** Запросов в минуту на игрока: окно спрашивает раз в пять секунд, пока заказ ждёт перевода. */
const PER_MINUTE = 30;
/** Проверок сети в минуту на игрока — toncenter без ключа отвечает раз в секунду на всех. */
const CHAIN_PER_MINUTE = 12;
/** Заказов в минуту на игрока. */
const ORDERS_PER_MINUTE = 6;

/** Как ходить в сеть. Тесты подменяют. */
let fetcher: Fetch = netFetch;
export const useFetch = (f: Fetch | null): void => {
  fetcher = f ?? netFetch;
};

export const pay: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');
  const key = saveKeyOf(auth.user);
  if (!allow(`pay:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  const gone = await eraGate(req, io);
  if (gone) return gone;

  let ask: PayRequest | null = null;
  if (req.method === 'POST') {
    const text = await readBody(req);
    if (text === null) return deny(413, 'too-big');
    ask = readPayRequest(parseJson<unknown>(text));
    if (!ask) return deny(400, 'bad-body');
  } else if (req.method !== 'GET') {
    return deny(405, 'method');
  }

  const cfg = payConfig();
  const on = typeof cfg !== 'string';
  const conf = on ? cfg : null;
  const base = (): Pick<PayResponse, 'now' | 'on' | 'net'> => ({ now, on, ...(conf ? { net: conf.net } : {}) });

  if (ask?.op === 'order') {
    if (!conf) return json({ ...base(), orders: [], error: 'Оплата ещё не открыта.' } satisfies PayResponse);
    if (isFrozen(await frozenNow(io.stores), key)) return json({ ...base(), orders: [], error: FROZEN_ORDER } satisfies PayResponse);
    if (!allow(`payorder:${key}`, ORDERS_PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '10' });
    const made = await createOrder(io.stores, conf, fetcher, key, ask, now);
    if (typeof made === 'string') return json({ ...base(), orders: [], error: made } satisfies PayResponse);
    await observe(io.stores, key, (rec) => noted(rec, now, 'deed', `Заказ алмазов ${made.order.id}: ${made.order.gems} за ${made.order.usdt} USDT.`));
    const listed = await checkOrders(io.stores, conf, fetcher, key, now, false);
    return json({ ...base(), orders: (listed?.orders ?? [made.order]).map(viewOf), order: viewOf(made.order), tx: made.tx } satisfies PayResponse);
  }

  if (ask?.op === 'sent') await markSent(io.stores, key, ask.id);

  const checked = await checkOrders(io.stores, conf, fetcher, key, now, allow(`paychain:${key}`, CHAIN_PER_MINUTE, now));
  if (!checked) return deny(503, 'busy', { 'retry-after': '3' });
  for (const line of checked.lines) await observe(io.stores, key, (rec) => noted(rec, now, 'deed', line));
  return json({ ...base(), orders: checked.orders.map(viewOf), ...(checked.credited ? { credited: checked.credited } : {}) } satisfies PayResponse);
};
