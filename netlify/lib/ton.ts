/**
 * Сеть TON для оплаты алмазов (docs/payments.md): настройка из переменных окружения, сборка перевода USDT для кошелька
 * игрока и проверка, что перевод пришёл. Сервер не держит ни ключей кошелька, ни мнемоники — только **адрес** кошелька
 * проекта: он принимает переводы, а не отправляет их.
 *
 * Как устроен перевод жетона (TEP-74). У каждого владельца для каждого жетона — свой кошелёк жетона (jetton wallet),
 * его адрес выдаёт мастер жетона методом `get_wallet_address(владелец)`. Игрок шлёт сообщение `transfer` (0x0f8a7ea5)
 * **своему** кошельку жетона; тот отдаёт жетоны кошельку жетона проекта, а тот — уведомление `transfer_notification`
 * (0x7362d09c) самому кошельку проекта, с суммой, отправителем и `forward_payload`, где лежит комментарий (номер заказа).
 *
 * Почему проверяем уведомление, а не запись индексатора о переводе. Уведомление кошельку проекта шлёт только кошелёк
 * жетона проекта и только после того, как жетоны на нём лежат. Сверяем **отправителя уведомления** с адресом, который
 * назвал сам мастер USDT (`get_wallet_address(кошелёк проекта)`), — подделка жетона (свой мастер «USDT» или контракт,
 * называющий себя кошельком USDT) так не пройдёт: её кошелёк — другой адрес. Индексатору (toncenter) мы доверяем
 * только в том, что транзакция есть и записана в мастерчейн; кто кому что прислал — разбираем из тела сами.
 *
 * Подтверждения. У TON нет «N подтверждений»: блок, вошедший в мастерчейн, окончателен. toncenter v3 отдаёт транзакции
 * из записанных блоков; транзакцию без номера блока мастерчейна (`mc_block_seqno` нет, `null` или не число больше нуля)
 * не засчитываем.
 *
 * Сеть — `TON_NETWORK` (`testnet` по умолчанию, `mainnet` — основная). Переход — одной настройкой: адреса API и
 * мастер USDT основной сети по умолчанию свои; кошелёк проекта тот же по смыслу, его адрес задаёт владелец.
 */
import { Address, Cell, beginCell } from '@ton/core';

export type TonNet = 'testnet' | 'mainnet';

/** USD₮ в основной сети TON (Tether). В тестовой сети официального нет — мастер тестового жетона задаёт владелец. */
export const MAINNET_USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

/** API toncenter по сети: v3 — транзакции, v2 — вызов метода контракта. */
export const TONCENTER: Record<TonNet, string> = {
  testnet: 'https://testnet.toncenter.com',
  mainnet: 'https://toncenter.com',
};

/** Сеть в TON Connect: `-3` — тестовая, `-239` — основная. Кошелёк в другой сети перевод не подпишет. */
export const CHAIN: Record<TonNet, string> = { testnet: '-3', mainnet: '-239' };

/** Сколько TON приложить к переводу жетона на газ. Лишнее кошелёк жетона вернёт игроку (`response_destination`). */
export const TRANSFER_GAS = 50_000_000n;
/** TON с уведомлением: больше нуля — иначе уведомления с комментарием не будет вовсе. */
export const FORWARD_TON = 1n;

/** Опкоды TEP-74. */
export const OP_TRANSFER = 0x0f8a7ea5;
export const OP_NOTIFY = 0x7362d09c;

export interface PayConfig {
  net: TonNet;
  /** Кошелёк проекта — сюда приходят уведомления о переводах. */
  wallet: Address;
  /** Мастер жетона USDT. */
  master: Address;
  /** Знаков после запятой у жетона: USD₮ — 6. */
  decimals: number;
  /** Корень API toncenter без косой черты в конце. */
  api: string;
  /** Ключ API toncenter; пусто — без ключа (раз в секунду). */
  key: string;
}

/** Имена переменных оплаты. Других оплата не читает; свой сервер сверяет их с `.env.example` (`vps/config.ts`). */
export const PAY_ENV = {
  net: 'TON_NETWORK',
  wallet: 'TON_WALLET',
  master: 'TON_USDT_MASTER',
  decimals: 'TON_USDT_DECIMALS',
  key: 'TON_API_KEY',
  api: 'TON_API_URL',
} as const;

const addr = (s: string | undefined): Address | null => {
  try {
    return s && s.trim() ? Address.parse(s.trim()) : null;
  } catch {
    return null;
  }
};

/**
 * Настройка оплаты. Не настроена (нет кошелька, мастера, кривая сеть) — строка: почему, словами для админа и лога.
 * Оплата тогда выключена целиком: заказов не принимает, окно говорит «оплата не настроена».
 */
export function payConfig(env: Record<string, string | undefined> = process.env): PayConfig | string {
  const rawNet = (env[PAY_ENV.net] ?? '').trim() || 'testnet';
  if (rawNet !== 'testnet' && rawNet !== 'mainnet') return `${PAY_ENV.net}: testnet или mainnet, а не «${rawNet}».`;
  const net = rawNet as TonNet;
  const wallet = addr(env[PAY_ENV.wallet]);
  if (!wallet) return `${PAY_ENV.wallet}: адрес кошелька проекта не задан или не разобран.`;
  const master = addr(env[PAY_ENV.master] || (net === 'mainnet' ? MAINNET_USDT : ''));
  if (!master) return `${PAY_ENV.master}: адрес мастера жетона USDT не задан или не разобран.`;
  const d = (env[PAY_ENV.decimals] ?? '').trim();
  const decimals = d ? Number(d) : 6;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return `${PAY_ENV.decimals}: целое от 0 до 18.`;
  const api = ((env[PAY_ENV.api] ?? '').trim() || TONCENTER[net]).replace(/\/+$/, '');
  return { net, wallet, master, decimals, api, key: (env[PAY_ENV.key] ?? '').trim() };
}

/** Сумма в наименьших единицах жетона: 5 USDT при 6 знаках — 5 000 000. Только целые доллары наборов. */
export const unitsOf = (usdt: number, decimals: number): bigint => BigInt(usdt) * 10n ** BigInt(decimals);

/** Адрес для кошелька: дружелюбный, с меткой тестовой сети, где надо. */
export const friendly = (a: Address, net: TonNet, bounceable = true): string => a.toString({ bounceable, testOnly: net === 'testnet', urlSafe: true });

/** Разобрать адрес из любого вида (`0:…`, `EQ…`, `UQ…`, `kQ…`). Кривой — `null`. */
export const parseAddress = addr;

// ------------------------------------------------ перевод игрока ---

/**
 * Тело `transfer` для кошелька жетона игрока: сколько, кому (кошелёк проекта), куда вернуть лишний газ (игроку) и
 * комментарий — номер заказа — в `forward_payload` отдельной ячейкой (бит 1 + ссылка), как пишут кошельки.
 */
export function transferBody(o: { units: bigint; to: Address; back: Address; comment: string; queryId: bigint }): Cell {
  const note = beginCell().storeUint(0, 32).storeStringTail(o.comment).endCell();
  return beginCell()
    .storeUint(OP_TRANSFER, 32)
    .storeUint(o.queryId, 64)
    .storeCoins(o.units)
    .storeAddress(o.to)
    .storeAddress(o.back)
    .storeBit(0)
    .storeCoins(FORWARD_TON)
    .storeBit(1)
    .storeRef(note)
    .endCell();
}

/** Сообщение для `sendTransaction` TON Connect. */
export interface TonMessage {
  address: string;
  amount: string;
  payload: string;
}

// ------------------------------------------------ уведомление ---

export interface Notice {
  /** Сколько единиц жетона пришло. */
  units: bigint;
  /** Кто прислал (владелец кошелька жетона отправителя). */
  from: Address | null;
  /** Текстовый комментарий; нет или не текст — пустая строка. */
  comment: string;
}

/** Разобрать тело `transfer_notification`. Не уведомление или кривое — `null`. */
export function readNotice(bodyB64: string): Notice | null {
  try {
    const s = Cell.fromBase64(bodyB64).beginParse();
    if (s.loadUint(32) !== OP_NOTIFY) return null;
    s.loadUintBig(64);
    const units = s.loadCoins();
    const from = s.loadMaybeAddress();
    let comment = '';
    const p = s.remainingBits > 0 ? (s.loadBit() ? (s.remainingRefs > 0 ? s.loadRef().beginParse() : null) : s) : null;
    if (p && p.remainingBits >= 32 && p.loadUint(32) === 0) comment = p.loadStringTail();
    return { units, from, comment };
  } catch {
    return null;
  }
}

// ------------------------------------------------ toncenter ---

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Второй адаптер наружу после Telegram (`lib/telegram.ts`): запрос к API сети TON. Ходит в сеть только он — тест
 * «наружу ходят два адаптера» (`server.test.ts`).
 */
export const netFetch: Fetch = (url, init) => fetch(url, init);

/** Сколько ждём ответа API. */
const API_MS = 8000;

async function call(cfg: PayConfig, fetcher: Fetch, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.key) headers['x-api-key'] = cfg.key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await Promise.race([
    fetcher(`${cfg.api}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), API_MS)),
  ]);
  if (!res.ok) throw new Error(`toncenter ${res.status}`);
  return res.json();
}

/**
 * Кошелёк жетона владельца — словами самого мастера (`get_wallet_address`, toncenter v2 `runGetMethod`). Не ответил
 * или ответ кривой — исключение: без этого адреса ни перевод не собрать, ни уведомление не проверить.
 */
export async function jettonWallet(cfg: PayConfig, fetcher: Fetch, owner: Address): Promise<Address> {
  const arg = beginCell().storeAddress(owner).endCell().toBoc().toString('base64');
  const r = (await call(cfg, fetcher, '/api/v2/runGetMethod', {
    address: cfg.master.toString(),
    method: 'get_wallet_address',
    stack: [['tvm.Slice', arg]],
  })) as { ok?: boolean; result?: { exit_code?: number; stack?: unknown[] } };
  const item = r?.result?.stack?.[0] as [string, { bytes?: string }] | undefined;
  if (!r?.ok || r.result?.exit_code !== 0 || !item || typeof item[1]?.bytes !== 'string') throw new Error('get_wallet_address');
  const a = Cell.fromBase64(item[1].bytes).beginParse().loadAddress();
  return a;
}

/** Кошелёк жетона проекта — один на настройку: спрашиваем мастер один раз за жизнь процесса. */
const ours = new Map<string, Address>();
export async function projectJettonWallet(cfg: PayConfig, fetcher: Fetch): Promise<Address> {
  const k = `${cfg.net}|${cfg.master.toRawString()}|${cfg.wallet.toRawString()}`;
  const hit = ours.get(k);
  if (hit) return hit;
  const a = await jettonWallet(cfg, fetcher, cfg.wallet);
  ours.set(k, a);
  return a;
}

/** Входящая транзакция кошелька проекта, как её отдаёт toncenter v3, — только нужные поля. */
export interface TonTx {
  /** Хеш транзакции (hex, строчными) — ключ в хранилище оплаченных. */
  hash: string;
  /** Время транзакции, мс. */
  at: number;
  /** Записана в мастерчейн. */
  final: boolean;
  /** Отправитель входящего сообщения. */
  source: Address | null;
  /** Тело входящего сообщения (BOC base64). */
  body: string;
}

const hexOf = (h: string): string => (/^[0-9a-fA-F]{64}$/.test(h) ? h.toLowerCase() : Buffer.from(h, 'base64').toString('hex'));

/** Список транзакций из ответа toncenter v3, как есть. */
const rawTxs = (raw: unknown): unknown[] => {
  const list = (raw as { transactions?: unknown } | null)?.transactions;
  return Array.isArray(list) ? list : [];
};

/** Транзакции toncenter v3 из ответа: кривые пропускаем. */
export function readTxs(raw: unknown): TonTx[] {
  const list = rawTxs(raw);
  const out: TonTx[] = [];
  for (const t of list) {
    const r = t as Record<string, unknown>;
    const msg = r?.in_msg as Record<string, unknown> | null | undefined;
    const body = (msg?.message_content as Record<string, unknown> | undefined)?.body;
    if (typeof r?.hash !== 'string' || typeof r.now !== 'number' || typeof body !== 'string') continue;
    const hash = hexOf(r.hash);
    if (hash.length !== 64) continue;
    out.push({
      hash,
      at: r.now * 1000,
      // Финальна только с номером блока мастерчейна: поля нет, `null`, ноль или не число — блок не записан (FIN-2).
      final: typeof r.mc_block_seqno === 'number' && r.mc_block_seqno > 0,
      source: addr(typeof msg?.source === 'string' ? msg.source : undefined),
      body,
    });
  }
  return out;
}

/** Сколько транзакций берём за запрос и сколько страниц самое большее за одну проверку. */
const PAGE = 100;
const PAGES = 5;

/** Входящие транзакции кошелька проекта с минуты `since` (мс), старые первыми. */
export async function incoming(cfg: PayConfig, fetcher: Fetch, since: number): Promise<TonTx[]> {
  const out: TonTx[] = [];
  const start = Math.max(0, Math.floor(since / 1000));
  for (let page = 0; page < PAGES; page++) {
    const q = `account=${encodeURIComponent(cfg.wallet.toRawString())}&start_utime=${start}&limit=${PAGE}&offset=${page * PAGE}&sort=asc`;
    const raw = await call(cfg, fetcher, `/api/v3/transactions?${q}`);
    out.push(...readTxs(raw));
    if (rawTxs(raw).length < PAGE) break;
  }
  return out;
}
