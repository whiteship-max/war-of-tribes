/**
 * Платежи Telegram в вебхуке бота (docs/security.md, ЗЩ-1): предоплатная проверка (`pre_checkout_query`) и пришедший
 * платёж (`message.successful_payment`).
 *
 * Алмазы начисляет только подтверждённая оплата, сверенная с тем, что сервер сам выставил: суммой, валютой и товаром, и
 * один раз. Решение владельца 09.10.2026 — алмазы продаются за USDT в сети TON (docs/payments.md: сервер сам находит
 * перевод в сети, сверяет сумму, жетон и номер заказа, хеш перевода занят вечно), **счетов Telegram сервер не выставляет**.
 * Значит, у любого платежа Telegram нет выставленного счёта, с которым его можно сверить, — и сверка отвечает отказом:
 *
 *  · предоплатная проверка — `ok: false` словами игроку: Telegram не спишет деньги, и `successful_payment` не придёт;
 *  · `successful_payment` (прийти может, только если кто-то другой ответил на проверку «да» — с токеном бота в чужих
 *    руках) — **ничего не начисляет**: ни книги алмазов, ни другого хранилища эта дверь не знает вовсе (замок
 *    `server.test.ts`). Плательщику — что платёж не засчитан, админам — строка «внимание:» с чеком, чтобы вернуть деньги
 *    вручную (`refundStarPayment` для звёзд).
 *
 * Подлинность обновления — секрет вебхука, его проверяет `routes/bot.ts` раньше, чем зовёт эту дверь. Чистая разборка и
 * ответы адаптером Telegram; хранилищ и часов здесь нет.
 */
import type { Telegram } from './telegram.js';
import { PAY_NOT_COUNTED, PAY_NOT_SOLD } from './words.js';

/** Платёж Telegram из обновления: предоплатная проверка или пришедший платёж. Что-то другое — `null`. */
export type TgPayment =
  | { kind: 'checkout'; id: string; from: number; currency: string; total: number; payload: string }
  | { kind: 'paid'; from: number; currency: string; total: number; payload: string; charge: string };

const userId = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const amount = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);

export function paymentOf(update: Record<string, unknown>): TgPayment | null {
  const q = update.pre_checkout_query as Record<string, unknown> | undefined;
  if (q && typeof q === 'object') {
    const from = userId((q.from as Record<string, unknown> | undefined)?.id);
    if (from === null || typeof q.id !== 'string' || !q.id) return null;
    return { kind: 'checkout', id: q.id.slice(0, 128), from, currency: text(q.currency, 8), total: amount(q.total_amount), payload: text(q.invoice_payload, 128) };
  }
  const msg = update.message as Record<string, unknown> | undefined;
  const sp = msg && typeof msg === 'object' ? (msg.successful_payment as Record<string, unknown> | undefined) : undefined;
  if (sp && typeof sp === 'object') {
    const from = userId((msg!.from as Record<string, unknown> | undefined)?.id);
    if (from === null) return null;
    return {
      kind: 'paid',
      from,
      currency: text(sp.currency, 8),
      total: amount(sp.total_amount),
      payload: text(sp.invoice_payload, 128),
      charge: text(sp.telegram_payment_charge_id, 128),
    };
  }
  return null;
}

/** Почему ни один платёж Telegram не сходится со счётом сервера — для строки админам. */
const NO_INVOICE = 'сервер не выставляет счетов Telegram — алмазы продаются только за USDT в сети TON';

/** Ответить на платёж Telegram: отказ проверке или «не засчитано» плательщику и «внимание:» админам. Ничего не начисляет. */
export async function refusePayment(p: TgPayment, api: Telegram, admins: Iterable<number>): Promise<void> {
  if (p.kind === 'checkout') {
    await api.checkout(p.id, false, PAY_NOT_SOLD);
    return;
  }
  await api.say(p.from, PAY_NOT_COUNTED);
  const line = `внимание: платёж Telegram от tg-${p.from} — ${p.total} ${p.currency || '?'}, чек ${p.charge || '—'}. Товар «${p.payload || '—'}». Не начислен: ${NO_INVOICE}. Вернуть — вручную.`;
  for (const admin of admins) await api.say(admin, line);
}
