import { describe, expect, it } from 'vitest';
import { Address } from '@ton/core';
import { PAGES, incoming, readTxs, type Fetch, type PayConfig } from './ton.js';

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

describe('входящие от курсора: история не обрывается молча (FIN-1)', () => {
  const W = Address.parse(`0:${'11'.repeat(32)}`);
  const cfg: PayConfig = { net: 'testnet', wallet: W, master: W, decimals: 6, api: 'http://x', key: '' };
  const all = Array.from({ length: 650 }, (_, i) => tx({ hash: i.toString(16).padStart(64, '0'), lt: String(5000 + i), now: 1_700_000_000 + i, mc_block_seqno: 1 }));
  /** Индексатор: от логического времени включительно или от минуты, страницами по offset; `broken` — страница, что не отвечает. */
  const net = (broken = -1): { f: Fetch; asked: number } => {
    const box = { asked: 0, f: null as unknown as Fetch };
    box.f = async (url) => {
      const q = new URL(url).searchParams;
      const page = Number(q.get('offset')) / Number(q.get('limit'));
      box.asked++;
      if (page === broken) return { ok: false, status: 429, json: async () => ({}) };
      const lt = q.get('start_lt');
      const from = lt !== null ? all.filter((t) => BigInt(t.lt as string) >= BigInt(lt)) : all.filter((t) => (t.now as number) >= Number(q.get('start_utime')));
      const list = from.slice(Number(q.get('offset')), Number(q.get('offset')) + Number(q.get('limit')));
      return { ok: true, status: 200, json: async () => ({ transactions: list }) };
    };
    return box;
  };

  it('650 транзакций — видна последняя (архив аудита: прежде пять страниц по сто и обрыв без знака)', async () => {
    const r = await incoming(cfg, net().f, { since: 0 });
    expect([r.txs.length, r.truncated, r.txs.at(-1)?.lt]).toEqual([650, false, '5649']);
  });

  it('бюджет страниц кончился — «не дочитано», и от курсора дочитывается остальное без повторов', async () => {
    const n = net();
    const first = await incoming(cfg, n.f, { since: 0 }, 2);
    expect([first.txs.length, first.truncated, n.asked]).toEqual([200, true, 2]);
    const rest = await incoming(cfg, n.f, { lt: first.txs.at(-1)!.lt, since: 0 });
    expect([rest.txs.length, rest.truncated, rest.txs[0].lt, rest.txs.at(-1)!.lt]).toEqual([450, false, '5200', '5649']);
    expect(PAGES).toBeGreaterThanOrEqual(20);
  });

  it('вторая страница не ответила — прочитанное отдаётся с «не дочитано»; первая — исключение', async () => {
    const r = await incoming(cfg, net(1).f, { since: 0 });
    expect([r.txs.length, r.truncated]).toEqual([100, true]);
    await expect(incoming(cfg, net(0).f, { since: 0 })).rejects.toThrow(/toncenter 429/);
  });

  it('транзакция без тела входящего сообщения — с пустым телом (курсор её проходит); без логического времени — кривая', () => {
    const [a] = readTxs({ transactions: [tx({ in_msg: null })] });
    expect([a.body, a.lt]).toEqual(['', '1000']);
    expect(readTxs({ transactions: [tx({ lt: undefined })] })).toEqual([]);
  });
});
