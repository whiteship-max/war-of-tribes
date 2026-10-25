import { describe, expect, it } from 'vitest';
import { readTxs } from './ton.js';

/**
 * Разбор транзакций toncenter v3 (docs/payments.md). Сеть здесь не нужна: проверяется, что из ответа индексатора
 * засчитывается, а что нет.
 */
const tx = (extra: Record<string, unknown>): Record<string, unknown> => ({
  hash: 'a'.repeat(64),
  lt: '1000',
  now: 1_700_000_000,
  in_msg: { source: null, message_content: { body: 'te6cc' } },
  ...extra,
});

describe('финальность: засчитывается только транзакция, записанная в мастерчейн (FIN-2)', () => {
  it('без номера блока мастерчейна, с null, нулём или не числом — не финальна; с номером — финальна', () => {
    const final = (extra: Record<string, unknown>): boolean | undefined => readTxs({ transactions: [tx(extra)] })[0]?.final;
    // Поля нет вовсе — индексатор не сказал, что блок в мастерчейне: прежде `undefined !== null` считалось финальным.
    expect(final({})).toBe(false);
    expect(final({ mc_block_seqno: null })).toBe(false);
    expect(final({ mc_block_seqno: 0 })).toBe(false);
    expect(final({ mc_block_seqno: '123' })).toBe(false);
    expect(final({ mc_block_seqno: -1 })).toBe(false);
    expect(final({ mc_block_seqno: 123 })).toBe(true);
  });
});
