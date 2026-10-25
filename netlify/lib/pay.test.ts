import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Address, Cell, beginCell } from '@ton/core';
import { pay, useFetch } from './routes/pay.js';
import { gems } from './routes/gems.js';
import { botWith } from './routes/bot.js';
import { STORES, type Kv, type Stores } from './kv.js';
import type { Telegram } from './telegram.js';
import { FROZEN_KEY } from './admin.js';
import { WIPED } from './era.js';
import { creditGems, openLedger, readLedger, type GemLedger } from './gems.js';
import { PAY_LATE_MS, PAY_TTL_MS, STUCK_MS, cursorKey, newOrderId, orderKey, peekPayments, readCursor } from './pay.js';
import { CHAIN, FORWARD_TON, MAINNET_USDT, OP_NOTIFY, OP_TRANSFER, PAGES, PAY_ENV, payConfig, readNotice, type Fetch, type PayConfig } from './ton.js';
import { payComment, type GemsResponse, type PayResponse } from './contract.js';
import { START_GEMS } from '../../src/game/gemrules.js';
import { GEM_PACKS } from '../../src/game/data/gems.js';

/**
 * Оплата наборов USDT в сети TON (docs/payments.md). Сеть подменена: мастер жетона и индексатор — в памяти теста, и каждая
 * подделка, ради которой проверка устроена так, а не проще, — свой тест: чужой жетон, чужая сумма, чужой комментарий,
 * незаписанная транзакция, повтор перевода, гонка двух проверок, «я заплатил» без перевода, админ.
 */
const TOKEN = '123456:AA-test-token-not-a-real-one';
const SECRET = 'test-secret_0123';
const ADMIN = 4343;
const NOW = 1_900_000_000_000;

const hashOf = (s: string): Buffer => createHash('sha256').update(s).digest();
const PROJECT = new Address(0, hashOf('project'));
const MASTER = new Address(0, hashOf('usdt-master'));
const FAKE_MASTER = new Address(0, hashOf('fake-master'));
const PLAYER_WALLET = new Address(0, hashOf('player-wallet'));
/** Кошелёк жетона: как его назвал бы мастер — чистая функция от мастера и владельца. */
const walletOf = (master: Address, owner: Address): Address => new Address(0, hashOf(`${master.toRawString()}|${owner.toRawString()}`));
const OUR_JETTON = walletOf(MASTER, PROJECT);

function memoryStores() {
  const data = new Map<string, Map<string, { value: string; etag: string }>>();
  let n = 0;
  const kv = (name: string): Kv => {
    const m = data.get(name) ?? new Map();
    data.set(name, m);
    return {
      async getWithMetadata(key) {
        const v = m.get(key);
        await Promise.resolve();
        return v ? { data: v.value, etag: v.etag } : null;
      },
      async setJSON(key, value, opts) {
        await Promise.resolve();
        const had = m.get(key);
        if (opts?.onlyIfNew && had) return { modified: false };
        if (opts?.onlyIfMatch && had?.etag !== opts.onlyIfMatch) return { modified: false };
        const etag = `e${++n}`;
        m.set(key, { value: JSON.stringify(value), etag });
        return { modified: true, etag };
      },
      async set(key, value) {
        m.set(key, { value, etag: `e${++n}` });
      },
      async list(opts) {
        return { blobs: [...m.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), directories: [] };
      },
      async delete(key) {
        m.delete(key);
      },
    };
  };
  const stores: Stores = (name) => kv(name);
  const ledger = (p: number): GemLedger | null => {
    const v = data.get(STORES.gems)?.get(`tg-${p}`);
    return v ? readLedger(JSON.parse(v.value)) : null;
  };
  return { stores, data, ledger };
}

/** Сеть TON в памяти: мастер отвечает `get_wallet_address`, индексатор — транзакциями кошелька проекта. */
function fakeChain() {
  const txs: Record<string, unknown>[] = [];
  let calls = 0;
  let pages = 0;
  let down = false;
  let seq = 0;
  const fetcher: Fetch = async (url, init) => {
    calls++;
    if (down) return { ok: false, status: 502, json: async () => ({}) };
    if (url.endsWith('/api/v2/runGetMethod')) {
      const body = JSON.parse(init?.body ?? '{}') as { address: string; stack: [string, string][] };
      const owner = Cell.fromBase64(body.stack[0][1]).beginParse().loadAddress();
      const master = Address.parse(body.address);
      const cell = beginCell().storeAddress(walletOf(master, owner)).endCell();
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { exit_code: 0, stack: [['cell', { bytes: cell.toBoc().toString('base64') }]] } }) };
    }
    if (url.includes('/api/v3/transactions?')) {
      const q = new URL(url).searchParams;
      expect(Address.parse(q.get('account')!).equals(PROJECT)).toBe(true);
      expect(q.get('sort')).toBe('asc');
      // Как toncenter v3: от логического времени (включительно) или от минуты, по порядку логического времени.
      const lt = q.get('start_lt');
      const start = Number(q.get('start_utime') ?? 0);
      const from = lt !== null ? txs.filter((t) => BigInt(t.lt as string) >= BigInt(lt)) : txs.filter((t) => (t.now as number) >= start);
      const list = from.slice(Number(q.get('offset')), Number(q.get('offset')) + Number(q.get('limit')));
      pages++;
      return { ok: true, status: 200, json: async () => ({ transactions: list, address_book: {} }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  /** Уведомление кошельку проекта: от кого (кошелёк жетона), сколько, с каким комментарием. */
  const notify = (o: { units: bigint; comment: string; source?: Address; at?: number; final?: boolean; hash?: string; ref?: boolean }): string => {
    const note = beginCell().storeUint(0, 32).storeStringTail(o.comment).endCell();
    const b = beginCell().storeUint(OP_NOTIFY, 32).storeUint(7, 64).storeCoins(o.units).storeAddress(PLAYER_WALLET);
    const body = (o.ref === false ? b.storeBit(0).storeUint(0, 32).storeStringTail(o.comment) : b.storeBit(1).storeRef(note)).endCell();
    const hash = o.hash ?? hashOf(`tx${++seq}`).toString('base64');
    txs.push({
      hash,
      lt: String(1_000_000 + txs.length),
      now: Math.floor((o.at ?? NOW) / 1000),
      mc_block_seqno: o.final === false ? null : 100 + seq,
      in_msg: { source: (o.source ?? OUR_JETTON).toRawString().toUpperCase(), message_content: { body: body.toBoc().toString('base64') } },
    });
    return hash;
  };
  /** Чужие транзакции кошелька проекта — поток, за которым прежде терялись платежи: TON без уведомления жетона. */
  const noise = (n: number, at = NOW): void => {
    const body = beginCell().storeUint(0, 32).storeStringTail('спам').endCell().toBoc().toString('base64');
    for (let i = 0; i < n; i++) {
      txs.push({
        hash: hashOf(`noise${++seq}`).toString('base64'),
        lt: String(1_000_000 + txs.length),
        now: Math.floor(at / 1000),
        mc_block_seqno: 100 + seq,
        in_msg: { source: PLAYER_WALLET.toRawString(), message_content: { body } },
      });
    }
  };
  return {
    fetcher,
    txs,
    notify,
    noise,
    get calls() {
      return calls;
    },
    get pages() {
      return pages;
    },
    set down(v: boolean) {
      down = v;
    },
  };
}

function signInit(id: number, now = NOW): string {
  const fields: Record<string, string> = { auth_date: String(Math.floor(now / 1000) - 60), user: JSON.stringify({ id, username: `p${id}` }) };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

async function call(s: ReturnType<typeof memoryStores>, p: number, body?: unknown, now = NOW): Promise<PayResponse> {
  const req = new Request('https://x/api/pay', {
    method: body ? 'POST' : 'GET',
    headers: { 'x-telegram-init-data': signInit(p, now), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const res = await pay(req, { stores: s.stores, now, ip: null });
  expect(res.status).toBe(200);
  return (await res.json()) as PayResponse;
}

const order = (s: ReturnType<typeof memoryStores>, p: number, pack = 'pouch', now = NOW, chain = CHAIN.testnet) =>
  call(s, p, { op: 'order', pack, wallet: PLAYER_WALLET.toString({ testOnly: true }), chain }, now);

const balance = async (s: ReturnType<typeof memoryStores>, p: number): Promise<number> => {
  const req = new Request('https://x/api/gems', { headers: { 'x-telegram-init-data': signInit(p) } });
  return ((await (await gems(req, { stores: s.stores, now: NOW, ip: null })).json()) as GemsResponse).balance;
};

const POUCH = GEM_PACKS.find((p) => p.id === 'pouch')!;
const units = (usdt: number): bigint => BigInt(usdt) * 1_000_000n;

let next = 51_000;
const player = (): number => ++next;
let chain: ReturnType<typeof fakeChain>;

const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_IDS', ...Object.values(PAY_ENV)];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of Object.values(PAY_ENV)) delete process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_IDS = String(ADMIN);
  process.env.TON_NETWORK = 'testnet';
  process.env.TON_WALLET = PROJECT.toString({ testOnly: true });
  process.env.TON_USDT_MASTER = MASTER.toString({ testOnly: true });
  chain = fakeChain();
  useFetch(chain.fetcher);
});
afterEach(() => {
  useFetch(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('настройка: сеть одной переменной, ключей кошелька нет', () => {
  it('тестовая сеть по умолчанию; основная — своим API и официальным USD₮ без правки кода', () => {
    const t = payConfig({ TON_WALLET: PROJECT.toString(), TON_USDT_MASTER: MASTER.toString() });
    expect(typeof t !== 'string' && [t.net, t.api, t.decimals]).toEqual(['testnet', 'https://testnet.toncenter.com', 6]);
    const m = payConfig({ TON_NETWORK: 'mainnet', TON_WALLET: PROJECT.toString() });
    expect(typeof m !== 'string' && [m.net, m.api, m.master.equals(Address.parse(MAINNET_USDT))]).toEqual(['mainnet', 'https://toncenter.com', true]);
    // В тестовой сети мастера по умолчанию нет — официального USD₮ там не существует.
    expect(payConfig({ TON_WALLET: PROJECT.toString() })).toMatch(/TON_USDT_MASTER/);
    expect(payConfig({})).toMatch(/TON_WALLET/);
    expect(payConfig({ TON_NETWORK: 'main', TON_WALLET: PROJECT.toString() })).toMatch(/testnet или mainnet/);
  });

  it('не настроена — заказов нет, окно знает это', async () => {
    delete process.env.TON_WALLET;
    const s = memoryStores();
    const p = player();
    expect((await call(s, p)).on).toBe(false);
    const r = await order(s, p);
    expect([r.on, r.error, r.tx]).toEqual([false, 'Оплата ещё не открыта.', undefined]);
  });
});

describe('заказ: сумму, получателя и комментарий считает сервер', () => {
  it('перевод для кошелька: кошелёк жетона игрока словами мастера, точная сумма, номер заказа в комментарии', async () => {
    const s = memoryStores();
    const p = player();
    const r = await order(s, p);
    expect(r.order?.state).toBe('created');
    expect([r.order?.gems, r.order?.usdt, r.tx?.network]).toEqual([POUCH.amount, POUCH.usdt, CHAIN.testnet]);
    expect(r.tx!.validUntil).toBe(Math.floor(NOW / 1000) + 600);
    const msg = r.tx!.messages[0];
    expect(Address.parse(msg.address).equals(walletOf(MASTER, PLAYER_WALLET))).toBe(true);
    expect(Address.parseFriendly(msg.address).isTestOnly).toBe(true);
    const sl = Cell.fromBase64(msg.payload).beginParse();
    expect(sl.loadUint(32)).toBe(OP_TRANSFER);
    sl.loadUintBig(64);
    expect(sl.loadCoins()).toBe(units(POUCH.usdt));
    expect(sl.loadAddress().equals(PROJECT)).toBe(true);
    expect(sl.loadAddress().equals(PLAYER_WALLET)).toBe(true);
    expect(sl.loadBit()).toBe(false);
    expect(sl.loadCoins()).toBe(FORWARD_TON);
    expect(sl.loadBit()).toBe(true);
    const note = sl.loadRef().beginParse();
    expect([note.loadUint(32), note.loadStringTail()]).toEqual([0, payComment(r.order!.id)]);
  });

  it('отказы словами: чужая сеть кошелька, нет набора, кривой адрес, больше трёх открытых, заморожен', async () => {
    const s = memoryStores();
    const p = player();
    expect((await order(s, p, 'pouch', NOW, CHAIN.mainnet)).error).toMatch(/основной сети TON, а оплата — в тестовой/);
    expect((await order(s, p, 'crate')).error).toBe('Такого набора нет.');
    expect((await call(s, p, { op: 'order', pack: 'pouch', wallet: 'не адрес', chain: CHAIN.testnet })).error).toBe('Адрес кошелька не разобран.');
    // Сито заказов — шесть в минуту на игрока; открытые считаем у другого.
    const o = player();
    for (let i = 0; i < 3; i++) expect((await order(s, o, 'handful', NOW + i)).order?.state).toBe('created');
    expect((await order(s, o, 'handful', NOW + 3)).error).toMatch(/Уже 3 заказа ждут перевода/);
    // Истекли — можно снова.
    expect((await order(s, o, 'handful', NOW + PAY_TTL_MS + 10)).order?.state).toBe('created');
    const q = player();
    await s.stores(STORES.admin).setJSON(FROZEN_KEY, { v: 1, keys: { [`tg-${q}`]: { at: NOW, by: ADMIN, why: 'тест' } } });
    expect((await order(s, q)).error).toMatch(/замороже/i);
  });

  it('номер заказа — десять знаков без похожих, разные на разные байты', () => {
    expect(newOrderId(new Uint8Array(10))).toBe('AAAAAAAAAA');
    expect(newOrderId(Uint8Array.from([31, 30, 0, 1, 2, 3, 4, 5, 6, 7]))).toBe('98ABCDEFGH');
    const seen = new Set(Array.from({ length: 200 }, () => newOrderId()));
    expect(seen.size).toBe(200);
  });
});

describe('проверка перевода: начисляет только настоящий USDT, ровно один раз', () => {
  it('заказ → подписал → перевод в сети → начислено через creditGems, в «Истории» — покупка', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    expect((await call(s, p, { op: 'sent', id: o!.id })).orders.at(-1)?.state).toBe('waiting');
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    const r = await call(s, p);
    expect([r.orders.at(-1)?.state, r.credited]).toEqual(['credited', POUCH.amount]);
    expect(await balance(s, p)).toBe(START_GEMS + POUCH.amount);
    const l = s.ledger(p)!;
    expect(l.list.filter((e) => e.kind === 'purchase').map((e) => [e.delta, e.key])).toEqual([[POUCH.amount, `pay:${o!.id}`]]);
    expect(l.paid).toEqual([`pay:${o!.id}`]);
    // Ещё десять проверок — ни одного второго начисления.
    for (let i = 1; i <= 10; i++) expect((await call(s, p, undefined, NOW + i * 1000)).credited).toBeUndefined();
    expect(await balance(s, p)).toBe(START_GEMS + POUCH.amount);
  });

  it('«я заплатил» без перевода не начисляет ничего', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    await call(s, p, { op: 'sent', id: o!.id });
    const r = await call(s, p);
    expect([r.orders.at(-1)?.state, r.credited]).toEqual(['waiting', undefined]);
    expect(await balance(s, p)).toBe(START_GEMS);
  });

  it('подделка жетона: тот же комментарий и сумма, но уведомление не от кошелька USDT проекта — не начислено', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    // Свой мастер «USDT» — у него свой кошелёк жетона проекта.
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id), source: walletOf(FAKE_MASTER, PROJECT) });
    // Контракт, назвавшийся кошельком жетона, — любой другой адрес.
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id), source: PLAYER_WALLET });
    const r = await call(s, p);
    expect([r.orders.at(-1)?.state, r.credited]).toEqual(['created', undefined]);
    expect(s.data.get(STORES.paid)?.size ?? 0).toBe(0);
  });

  it('сумма не та — не начислено, причина словами; комментарий чужой — не наш перевод', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.notify({ units: units(POUCH.usdt) - 1n, comment: payComment(o!.id) });
    chain.notify({ units: units(POUCH.usdt), comment: `${payComment(o!.id)}X` });
    chain.notify({ units: units(POUCH.usdt), comment: payComment('ABCDEFGHJK') });
    const r = await call(s, p);
    expect(r.orders.at(-1)?.state).toBe('created');
    expect(r.orders.at(-1)?.note).toBe('Пришло 4.999999 USDT вместо 5, алмазы не начислены. Напиши мастерам игры.');
    expect(await balance(s, p)).toBe(START_GEMS);
    // Верный перевод после неверного — начислен, причина ушла.
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id), at: NOW + 5000 });
    const r2 = await call(s, p, undefined, NOW + 6000);
    expect([r2.orders.at(-1)?.state, r2.orders.at(-1)?.note, r2.credited]).toEqual(['credited', undefined, POUCH.amount]);
  });

  it('комментарий прямо в теле, без ссылки, — тоже читается', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p, 'handful');
    chain.notify({ units: units(1), comment: payComment(o!.id), ref: false });
    expect((await call(s, p)).credited).toBe(100);
  });

  it('транзакция не записана в мастерчейн — ждём; записана — начислено', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    const h = chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id), final: false });
    expect((await call(s, p)).credited).toBeUndefined();
    chain.txs.find((t) => t.hash === h)!.mc_block_seqno = 999;
    expect((await call(s, p, undefined, NOW + 6000)).credited).toBe(POUCH.amount);
  });

  it('повторно присланный перевод не начисляется: хеш занят навсегда, и чистый старт его не стирает', async () => {
    const s = memoryStores();
    const p = player();
    const a = (await order(s, p)).order!;
    const hash = chain.notify({ units: units(POUCH.usdt), comment: payComment(a.id) });
    expect((await call(s, p)).credited).toBe(POUCH.amount);
    // Тот же перевод (тот же хеш) показан под другим заказом — другой игрок или второй заказ того же.
    const q = player();
    const b = (await order(s, q)).order!;
    chain.notify({ units: units(POUCH.usdt), comment: payComment(b.id), hash });
    const r = await call(s, q);
    expect([r.orders.at(-1)?.state, r.orders.at(-1)?.note, r.credited]).toEqual(['created', 'Этот перевод уже засчитан другому заказу.', undefined]);
    expect(await balance(s, q)).toBe(START_GEMS);
    // Хранилище оплаченных — вне чистого старта и отдельно от журнала алмазов.
    expect(WIPED).not.toContain(STORES.paid);
    expect(STORES.paid).not.toBe(STORES.gems);
    const hex = Buffer.from(hash, 'base64').toString('hex');
    expect(JSON.parse(s.data.get(STORES.paid)!.get(hex)!.value)).toEqual({ player: `tg-${p}`, order: a.id, at: NOW });
  });

  it('ключ покупки в книге не обрезается: запись журнала ушла — повтор всё равно не начисляет', () => {
    let l: GemLedger = openLedger(NOW);
    const first = creditGems(l, { source: 'purchase', amount: 550, key: 'pay:AAAAAAAAAA', at: NOW });
    if (typeof first === 'string') throw new Error(first);
    l = { ...first.ledger, list: [] };
    const again = creditGems(l, { source: 'purchase', amount: 550, key: 'pay:AAAAAAAAAA', at: NOW + 1 });
    expect(typeof again !== 'string' && [again.ledger.balance, again.entry]).toEqual([START_GEMS + 550, null]);
    // И из хранилища ключи читаются.
    expect(readLedger(JSON.parse(JSON.stringify(first.ledger)))!.paid).toEqual(['pay:AAAAAAAAAA']);
  });

  it('пять проверок разом — одно начисление', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    const all = await Promise.all(Array.from({ length: 5 }, (_, i) => call(s, p, undefined, NOW + i)));
    expect(all.reduce((t, r) => t + (r.credited ?? 0), 0)).toBe(POUCH.amount);
    expect(s.ledger(p)!.list.filter((e) => e.kind === 'purchase')).toHaveLength(1);
    expect(await balance(s, p)).toBe(START_GEMS + POUCH.amount);
  });

  it('истёк — статус «истёк»; поздний перевод в неделю ещё начисляется, позже — нет', async () => {
    const s = memoryStores();
    const p = player();
    const a = (await order(s, p, 'handful')).order!;
    expect((await call(s, p, undefined, NOW + PAY_TTL_MS + 1)).orders.at(-1)?.state).toBe('expired');
    chain.notify({ units: units(1), comment: payComment(a.id), at: NOW + PAY_TTL_MS + 60_000 });
    const r = await call(s, p, undefined, NOW + PAY_TTL_MS + 120_000);
    expect([r.orders.at(-1)?.state, r.credited]).toEqual(['credited', 100]);

    const q = player();
    const b = (await order(s, q, 'handful')).order!;
    chain.notify({ units: units(1), comment: payComment(b.id), at: NOW + PAY_LATE_MS + 60_000 });
    const late = await call(s, q, undefined, NOW + PAY_LATE_MS + 120_000);
    expect([late.orders.at(-1)?.state, late.credited]).toEqual(['expired', undefined]);
  });

  it('сеть TON молчит — ничего не падает и не начисляется; ответила — начислено', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    chain.down = true;
    expect((await call(s, p)).orders.at(-1)?.state).toBe('created');
    chain.down = false;
    expect((await call(s, p, undefined, NOW + 6000)).credited).toBe(POUCH.amount);
  });

  it('замороженному оплаченное начисляется: деньги ушли — алмазы ложатся', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    await s.stores(STORES.admin).setJSON(FROZEN_KEY, { v: 1, keys: { [`tg-${p}`]: { at: NOW, by: ADMIN, why: 'тест' } } });
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    expect((await call(s, p)).credited).toBe(POUCH.amount);
  });

  it('readNotice: не уведомление — null, пустой комментарий — пусто', () => {
    expect(readNotice(beginCell().storeUint(OP_TRANSFER, 32).endCell().toBoc().toString('base64'))).toBeNull();
    expect(readNotice('не boc')).toBeNull();
    const bare = beginCell().storeUint(OP_NOTIFY, 32).storeUint(0, 64).storeCoins(5n).storeAddress(PLAYER_WALLET).storeBit(0).endCell();
    expect(readNotice(bare.toBoc().toString('base64'))).toMatchObject({ units: 5n, comment: '' });
  });
});

describe('просмотр кошелька курсором: поток транзакций и старые заказы не прячут платёж (FIN-1)', () => {
  it('тысяча чужих транзакций после заказа — платёж всё равно найден одной проверкой', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.noise(1000);
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    // Прежде — пять страниц по сто от минуты заказа: тысяча первая транзакция не была видна.
    expect((await call(s, p)).credited).toBe(POUCH.amount);
  });

  it('неоплаченный заказ недельной давности не прячет новый платёж (окно прежде шло от него)', async () => {
    const s = memoryStores();
    const p = player();
    await order(s, p, 'handful');
    chain.noise(650, NOW + 3600_000);
    const later = NOW + 2 * 3600_000;
    const b = (await order(s, p, 'pouch', later)).order!;
    chain.notify({ units: units(POUCH.usdt), comment: payComment(b.id), at: later + 1000 });
    expect((await call(s, p, undefined, later + 2000)).credited).toBe(POUCH.amount);
  });

  it('поток длиннее бюджета страниц — платёж задерживается до следующей проверки, а не теряется', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.noise(PAGES * 100 + 500);
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    const first = await call(s, p);
    expect(first.credited).toBeUndefined();
    expect(chain.pages).toBe(PAGES);
    // Следующая проверка читает от курсора, а не с начала: страниц — сколько осталось дочитать.
    const second = await call(s, p, undefined, NOW + 6000);
    expect(second.credited).toBe(POUCH.amount);
    expect(chain.pages).toBe(PAGES + 6);
  });

  it('перевод чужого заказа, прочитанный моей проверкой, ложится его заказу: курсор его не теряет', async () => {
    const s = memoryStores();
    const a = player();
    const b = player();
    await order(s, a);
    const ob = (await order(s, b, 'handful')).order!;
    chain.notify({ units: units(1), comment: payComment(ob.id) });
    // Проверяет игрок А: перевод Б найден его просмотром и записан Б «оплачен».
    expect((await call(s, a)).credited).toBeUndefined();
    const filed = JSON.parse(s.data.get(STORES.pay)!.get(`tg-${b}`)!.value) as { orders: { id: string; state: string }[] };
    expect(filed.orders.find((x) => x.id === ob.id)?.state).toBe('paid');
    // Б заходит, когда курсор уже ушёл дальше, — начислено ему, ровно раз.
    expect((await call(s, b, undefined, NOW + 6000)).credited).toBe(100);
    expect((await call(s, b, undefined, NOW + 12_000)).credited).toBeUndefined();
    expect(await balance(s, b)).toBe(START_GEMS + 100);
  });

  it('курсор не перешагивает нефинальную транзакцию: финальная после неё разобрана, нефинальная — когда запишется', async () => {
    const s = memoryStores();
    const a = player();
    const b = player();
    const oa = (await order(s, a)).order!;
    const ob = (await order(s, b, 'handful')).order!;
    const ha = chain.notify({ units: units(POUCH.usdt), comment: payComment(oa.id), final: false });
    chain.notify({ units: units(1), comment: payComment(ob.id) });
    expect((await call(s, b)).credited).toBe(100);
    const cfg = payConfig() as PayConfig;
    const cursor = () => readCursor(JSON.parse(s.data.get(STORES.pay)!.get(cursorKey(cfg))!.value));
    const ltA = chain.txs.find((t) => t.hash === ha)!.lt as string;
    expect(BigInt(cursor()!.lt ?? '0')).toBeLessThan(BigInt(ltA));
    expect((await call(s, a, undefined, NOW + 6000)).credited).toBeUndefined();
    chain.txs.find((t) => t.hash === ha)!.mc_block_seqno = 999;
    expect((await call(s, a, undefined, NOW + 12_000)).credited).toBe(POUCH.amount);
    expect(BigInt(cursor()!.lt!)).toBeGreaterThan(BigInt(ltA));
  });

  it('транзакция, не записанная в мастерчейн за час, курсор не держит: за ней платёж найден', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.notify({ units: units(POUCH.usdt), comment: 'не наше', final: false, at: NOW - STUCK_MS - 1000 });
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    expect((await call(s, p)).credited).toBe(POUCH.amount);
    const cfg = payConfig() as PayConfig;
    const cur = readCursor(JSON.parse(s.data.get(STORES.pay)!.get(cursorKey(cfg))!.value))!;
    expect(cur.lt).toBe(chain.txs.at(-1)!.lt);
  });

  it('заказ, заведённый до курсора (без указателя), находится: первый просмотр заводит указатели лежащим заказам', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    const pay = s.data.get(STORES.pay)!;
    pay.delete(orderKey(o!.id));
    for (const k of [...pay.keys()]) if (k.startsWith('scan/')) pay.delete(k);
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    expect((await call(s, p)).credited).toBe(POUCH.amount);
    expect(JSON.parse(pay.get(orderKey(o!.id))!.value)).toEqual({ player: `tg-${p}` });
  });

  it('админ видит только заказы: курсор и указатели в списке не появляются', async () => {
    const s = memoryStores();
    const p = player();
    const { order: o } = await order(s, p);
    chain.notify({ units: units(POUCH.usdt), comment: payComment(o!.id) });
    await call(s, p);
    expect([...s.data.get(STORES.pay)!.keys()].some((k) => k.startsWith('scan/'))).toBe(true);
    const rows = await peekPayments(s.stores, 20);
    expect(rows.map((r) => r.player)).toEqual([`tg-${p}`]);
  });
});

describe('админ: /payments только читает', () => {
  async function command(s: ReturnType<typeof memoryStores>, text: string): Promise<string> {
    const said: string[] = [];
    const tg: Telegram = {
      letter: async () => ({ result: 'ok' }),
      edit: async () => ({ result: 'ok' }),
      panel: async () => 'ok',
      repanel: async () => 'ok',
      answer: async () => 'ok',
      button: async () => 'ok',
      async say(_c, t) {
        said.push(t);
        return 'ok';
      },
      file: async () => 'ok',
      greet: async () => 'ok',
      checkout: async () => 'ok',
    };
    const req = new Request('https://x/api/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify({ update_id: 1, message: { message_id: 9, from: { id: ADMIN }, chat: { id: ADMIN, type: 'private' }, text } }),
    });
    expect((await botWith(() => tg)(req, { stores: s.stores, now: NOW, ip: null })).status).toBe(200);
    return said.at(-1) ?? '';
  }

  it('последние заказы и статусы; ни баланс, ни заказы командой не меняются', async () => {
    const s = memoryStores();
    const p = player();
    const a = (await order(s, p)).order!;
    const b = (await order(s, p, 'handful', NOW + 1)).order!;
    chain.notify({ units: units(POUCH.usdt), comment: payComment(a.id) });
    await call(s, p, undefined, NOW + 2);
    const before = JSON.stringify([...s.data.get(STORES.pay)!.entries(), ...s.data.get(STORES.gems)!.entries()]);
    const text = await command(s, '/payments');
    expect(text).toMatch(/Оплата: сеть testnet/);
    expect(text).toContain(`tg-${p} · ${a.id} · ${POUCH.amount} за ${POUCH.usdt} USDT · начислено`);
    expect(text).toContain(`tg-${p} · ${b.id} · 100 за 1 USDT · создан`);
    expect(JSON.stringify([...s.data.get(STORES.pay)!.entries(), ...s.data.get(STORES.gems)!.entries()])).toBe(before);
  });
});
