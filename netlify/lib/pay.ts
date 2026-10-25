/**
 * Оплата наборов алмазов USDT в сети TON (docs/payments.md). Заказ на сервере → перевод USDT кошельком игрока с номером
 * заказа в комментарии → **сервер сам находит перевод в сети** (`lib/ton.ts`: кошелёк проекта, точная сумма, настоящий
 * USDT, комментарий, запись в мастерчейне) → начисление дверью книги `gems.settlePurchase` (внутри — `creditGems`,
 * источник `purchase`) **ровно один раз**.
 *
 * Три замка от второго начисления, каждый держит тест (`pay.test.ts`):
 *  1. Хеш транзакции занимается в хранилище `tribe-paid` условной записью в пустое место — **вечно**: тот же перевод не
 *     засчитается ни второму заказу, ни второму игроку, ни в следующей эпохе.
 *  2. Заказ переходит «оплачен → начислено» один раз; начисленный больше не проверяется.
 *  3. Книга алмазов помнит ключ покупки `pay:<номер>` без обрезки (`GemLedger.paid`).
 *
 * Просмотр сети — один на кошелёк проекта, курсором (FIN-1, аудит 25.10.2026): каждая проверка читает транзакции после
 * последней разобранной (`scan/…` в хранилище заказов) и раскладывает найденное по заказам **любого** игрока через указатель
 * «номер заказа → игрок» (`order/<номер>`). Прежде проверка игрока смотрела от своего старейшего искомого заказа и молча
 * обрывалась на пятистах транзакциях: неоплаченный заказ недельной давности или поток чужих транзакций прятал новые
 * платежи. Курсор не перешагивает транзакцию, ещё не записанную в мастерчейн.
 *
 * Клиенту здесь не верят ни в чём: он называет набор и адрес своего кошелька, а сумму, комментарий, получателя и
 * кошелёк жетона считает сервер; «я заплатил» (`sent`) только переводит заказ в «ждёт перевода» — начисляет только
 * перевод, найденный в сети. Админ начислить не может: `/payments` только читает (`peekPayments`).
 */
import { parseJson, WRITE_TRIES } from './http.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { PAY_ID, payComment, readPayOrder, type PayOrderView, type PayTx } from './contract.js';
import { settlePurchase } from './gems.js';
import {
  CHAIN,
  TRANSFER_GAS,
  friendly,
  incoming,
  jettonWallet,
  parseAddress,
  projectJettonWallet,
  readNotice,
  transferBody,
  unitsOf,
  type Fetch,
  type PayConfig,
  type TonTx,
} from './ton.js';
import { GEM_PACKS } from '../../src/game/data/gems.js';

/** Заказ в хранилище: то, что видит игрок, плюс сумма в единицах жетона и найденный перевод. */
export interface StoredOrder extends PayOrderView {
  /** Сумма в наименьших единицах жетона, строкой (bigint). */
  units: string;
  /** Хеш транзакции перевода, когда найден. */
  tx?: string;
  /** Номер записи журнала алмазов, когда начислено. */
  n?: number;
}

export interface PayFile {
  v: 1;
  orders: StoredOrder[];
}

/** Сколько ждём перевода после заказа. */
export const PAY_TTL_MS = 30 * 60_000;
/** Сколько ещё ищем перевод истёкшего заказа: деньги ушли — алмазы должны лечь. */
export const PAY_LATE_MS = 7 * 24 * 3600_000;
/** Сколько секунд кошелёк может подписать перевод. */
export const SIGN_S = 10 * 60;
/** Заказов, ждущих перевода, разом. */
export const OPEN_MAX = 3;
/** Сколько заказов игрока лежит. Открытые и оплаченные не вытесняются. */
export const KEEP = 20;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Новый номер заказа: десять знаков из 32 — 2⁵⁰ вариантов. */
export function newOrderId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string {
  return Array.from(bytes.slice(0, 10), (b) => ALPHABET[b & 31]).join('');
}

const n0 = (v: unknown): string | null => (typeof v === 'string' && /^\d{1,30}$/.test(v) ? v : null);

export function readPayFile(v: unknown): PayFile {
  const list = (v as { orders?: unknown } | null)?.orders;
  const orders: StoredOrder[] = [];
  if (Array.isArray(list)) {
    for (const raw of list) {
      const o = readPayOrder(raw);
      const r = raw as Record<string, unknown>;
      const units = n0(r?.units);
      if (!o || !units) continue;
      const s: StoredOrder = { ...o, units };
      if (typeof r.tx === 'string' && /^[0-9a-f]{64}$/.test(r.tx)) s.tx = r.tx;
      if (typeof r.n === 'number' && Number.isInteger(r.n) && r.n > 0) s.n = r.n;
      orders.push(s);
    }
  }
  return { v: 1, orders };
}

/** Заказ глазами игрока. */
export const viewOf = (o: StoredOrder): PayOrderView => {
  const { units, tx, n, ...view } = o;
  void units;
  void tx;
  void n;
  return view;
};

const open = (o: StoredOrder, now: number): boolean => (o.state === 'created' || o.state === 'waiting') && now <= o.until;
/** Перевод этого заказа ещё ищем в сети. */
const hunted = (o: StoredOrder, now: number): boolean =>
  (o.state === 'created' || o.state === 'waiting' || o.state === 'expired') && now - o.at <= PAY_LATE_MS;

/** Обрезка: открытые и оплаченные-неначисленные остаются, вытесняются старые закрытые. */
function trimmed(orders: StoredOrder[], now: number): StoredOrder[] {
  if (orders.length <= KEEP) return orders;
  const keep = new Set(orders.filter((o) => open(o, now) || o.state === 'paid' || (hunted(o, now) && o.state !== 'expired')).map((o) => o.id));
  const rest = orders.filter((o) => !keep.has(o.id));
  const drop = new Set(rest.slice(0, orders.length - KEEP).map((o) => o.id));
  return orders.filter((o) => !drop.has(o.id));
}

/**
 * Одна дверь записи заказов игрока: прочитать, изменить, записать условно поверх прочитанного; чужая запись между —
 * заново. `null` — хранилище не ответило.
 */
async function updatePay(stores: Stores, player: string, fn: (file: PayFile) => PayFile | null): Promise<PayFile | null> {
  const kv = stores(STORES.pay, 'strong');
  try {
    for (let tries = 0; tries < WRITE_TRIES; tries++) {
      const found = await kv.getWithMetadata(player);
      const cur = readPayFile(found ? parseJson(String(found.data)) : null);
      const next = fn(cur);
      if (!next) return cur;
      const w = await kv.setJSON(player, next, found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true });
      if (w.modified) return next;
    }
  } catch {
    /* хранилище не ответило */
  }
  return null;
}

/** Заказы игрока только чтением. */
export async function readOrders(stores: Stores, player: string): Promise<StoredOrder[]> {
  const found = await stores(STORES.pay, 'strong').getWithMetadata(player);
  return readPayFile(found ? parseJson(String(found.data)) : null).orders;
}

const netWord = (chain: string): string => (chain === CHAIN.mainnet ? 'основной' : chain === CHAIN.testnet ? 'тестовой' : 'другой');

/**
 * Новый заказ: набор, адрес кошелька игрока и его сеть. Сервер сам считает сумму в единицах жетона, комментарий и
 * кошелёк жетона игрока (словами мастера USDT) и собирает перевод для TON Connect. Отказ — словами.
 */
export async function createOrder(
  stores: Stores,
  cfg: PayConfig,
  fetcher: Fetch,
  player: string,
  req: { pack: string; wallet: string; chain: string },
  now: number,
  rand?: Uint8Array,
): Promise<{ order: StoredOrder; tx: PayTx } | string> {
  const pack = GEM_PACKS.find((p) => p.id === req.pack);
  if (!pack) return 'Такого набора нет.';
  if (req.chain !== CHAIN[cfg.net]) return `Кошелёк в ${netWord(req.chain)} сети TON, а оплата — в ${netWord(CHAIN[cfg.net])}. Переключи сеть в кошельке.`;
  const owner = parseAddress(req.wallet);
  if (!owner) return 'Адрес кошелька не разобран.';
  const have = await readOrders(stores, player).catch(() => null);
  if (!have) return 'Сокровищница не ответила. Попробуй ещё раз.';
  if (have.filter((o) => open(o, now)).length >= OPEN_MAX) return `Уже ${OPEN_MAX} заказа ждут перевода. Дождись их или пусть истекут.`;
  let theirs;
  try {
    theirs = await jettonWallet(cfg, fetcher, owner);
  } catch {
    return 'Сеть TON не ответила. Попробуй ещё раз.';
  }
  const id = newOrderId(rand);
  const units = unitsOf(pack.usdt, cfg.decimals);
  const order: StoredOrder = { id, pack: pack.id, gems: pack.amount, usdt: pack.usdt, at: now, until: now + PAY_TTL_MS, state: 'created', units: units.toString() };
  // Указатель «номер → игрок» — раньше, чем номер уйдёт в перевод: перевод, найденный чужой проверкой, ляжет этому заказу.
  if (!(await indexOrder(stores, id, player))) return 'Сокровищница не ответила. Попробуй ещё раз.';
  const body = transferBody({ units, to: cfg.wallet, back: owner, comment: payComment(id), queryId: BigInt(now) });
  const tx: PayTx = {
    validUntil: Math.floor(now / 1000) + SIGN_S,
    network: CHAIN[cfg.net],
    messages: [{ address: friendly(theirs, cfg.net), amount: TRANSFER_GAS.toString(), payload: body.toBoc().toString('base64') }],
  };
  const done = await updatePay(stores, player, (f) => ({ v: 1, orders: trimmed([...f.orders, order], now) }));
  if (!done) return 'Сокровищница не ответила. Попробуй ещё раз.';
  return { order, tx };
}

/** Кошелёк подписал: заказ «ждёт перевода». Ничего не начисляет — начисляет только перевод, найденный в сети. */
export async function markSent(stores: Stores, player: string, id: string): Promise<boolean> {
  const done = await updatePay(stores, player, (f) => {
    const o = f.orders.find((x) => x.id === id);
    if (!o || o.state !== 'created') return null;
    return { v: 1, orders: f.orders.map((x) => (x.id === id ? { ...x, state: 'waiting' as const } : x)) };
  });
  return done !== null;
}

/** Метка оплаченного перевода: чей заказ. */
export function readPaidMark(v: unknown): { player: string; order: string } | null {
  const r = v as { player?: unknown; order?: unknown } | null;
  return r && typeof r.player === 'string' && typeof r.order === 'string' ? { player: r.player, order: r.order } : null;
}

/** Занять перевод за заказом — в пустое место, вечно. `true` — перевод наш (занят сейчас или раньше этим же заказом). */
export async function claimTx(stores: Stores, hash: string, player: string, order: string, at: number): Promise<boolean | null> {
  const kv = stores(STORES.paid, 'strong');
  try {
    const w = await kv.setJSON(hash, { player, order, at }, { onlyIfNew: true });
    if (w.modified) return true;
    const found = await kv.getWithMetadata(hash);
    const was = readPaidMark(found ? parseJson(String(found.data)) : null);
    return was?.player === player && was?.order === order;
  } catch {
    return null;
  }
}

const usdtText = (units: bigint, decimals: number): string => {
  const d = 10n ** BigInt(decimals);
  const frac = (units % d).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${units / d}${frac ? `.${frac}` : ''}`;
};

// ------------------------------------------------ просмотр кошелька (FIN-1) ---

/** Где кончил просмотр кошелька проекта: после транзакции `lt` (её минута — `at`); пока транзакций не было — с `since`. */
export interface ScanCursor {
  v: 1;
  lt?: string;
  at: number;
  since: number;
}

/** Ключ курсора: сеть и кошелёк — курсор одного кошелька другому не годится. */
export const cursorKey = (cfg: PayConfig): string => `scan/${cfg.net}/${cfg.wallet.workChain}_${cfg.wallet.hash.toString('hex')}`;
/** Ключ указателя «номер заказа → игрок». */
export const orderKey = (id: string): string => `order/${id}`;
/** Файл заказов игрока — ключ `tg-<id>`; курсор и указатели лежат в том же хранилище под своими ключами. */
const isPlayerKey = (key: string): boolean => key.startsWith('tg-');

/**
 * Сколько ждём записи транзакции в мастерчейн, прежде чем курсор её перешагнёт. Блок шарда входит в мастерчейн за
 * секунды; транзакция, не записанная за час, — из блока, которого в сети нет: перевода не было, а курсор не должен
 * стоять на ней вечно.
 */
export const STUCK_MS = 3600_000;

export function readCursor(v: unknown): ScanCursor | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.since !== 'number' || !Number.isFinite(r.since)) return null;
  const lt = typeof r.lt === 'string' && /^\d{1,20}$/.test(r.lt) ? r.lt : undefined;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
  return { v: 1, ...(lt ? { lt } : {}), at, since: r.since };
}

/** Указатель заказа из хранилища: чей заказ; кривой или нет — `undefined`. */
export function readOrderOwner(v: unknown): string | undefined {
  const player = (v as { player?: unknown } | null)?.player;
  return typeof player === 'string' && isPlayerKey(player) ? player : undefined;
}

/** Указатель заказа: чей. Нет — `undefined`; хранилище не ответило — `null`. */
async function ownerOf(kv: Kv, id: string): Promise<string | undefined | null> {
  try {
    const found = await kv.getWithMetadata(orderKey(id));
    return readOrderOwner(found ? parseJson(String(found.data)) : null);
  } catch {
    return null;
  }
}

/** Завести указатель «номер → игрок» в пустое место. `true` — лежит этот (заведён сейчас или раньше тем же игроком). */
async function indexOrder(stores: Stores, id: string, player: string): Promise<boolean> {
  const kv = stores(STORES.pay, 'strong');
  try {
    const w = await kv.setJSON(orderKey(id), { player }, { onlyIfNew: true });
    if (w.modified) return true;
    return (await ownerOf(kv, id)) === player;
  } catch {
    return false;
  }
}

/** Первый просмотр кошелька: указатели всем лежащим заказам — заведённым до просмотра курсором. `false` — не все. */
async function indexAll(stores: Stores): Promise<boolean> {
  const kv = stores(STORES.pay, 'strong');
  try {
    const { blobs } = await kv.list({});
    for (const { key } of blobs) {
      if (!isPlayerKey(key)) continue;
      const found = await kv.getWithMetadata(key);
      for (const o of readPayFile(found ? parseJson(String(found.data)) : null).orders) {
        if (!(await indexOrder(stores, o.id, key))) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Сдвинуть курсор вперёд условной записью; чужой просмотр ушёл дальше — его курсор остаётся. */
async function moveCursor(kv: Kv, key: string, next: ScanCursor): Promise<void> {
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await kv.getWithMetadata(key);
    const cur = readCursor(found ? parseJson(String(found.data)) : null);
    if (cur?.lt && (!next.lt || BigInt(cur.lt) >= BigInt(next.lt))) return;
    const w = await kv.setJSON(key, next, found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true });
    if (w.modified) return;
  }
}

/**
 * Разобрать одну финальную транзакцию кошелька проекта. Засчитываем только уведомление `transfer_notification`, которое
 * прислал **кошелёк жетона проекта** (адрес — словами мастера USDT), с комментарием `TRIBE-<номер>`; заказ ищем
 * указателем у любого игрока. Сумма та и заказ ищется — перевод занимается вечно и заказ «оплачен»; сумма не та — причина
 * словами. `false` — хранилище не ответило: курсор встаёт перед этой транзакцией, следующая проверка разберёт её снова.
 */
async function settleTx(stores: Stores, cfg: PayConfig, ours: TonTx['source'], tx: TonTx, now: number): Promise<boolean> {
  if (!tx.source || !ours || !tx.source.equals(ours)) return true;
  const notice = readNotice(tx.body);
  const m = notice ? /^TRIBE-([A-Z0-9]{10})$/.exec(notice.comment.trim()) : null;
  if (!notice || !m || !PAY_ID.test(m[1])) return true;
  const id = m[1];
  const player = await ownerOf(stores(STORES.pay, 'strong'), id);
  if (player === null) return false;
  if (!player) return true;
  let orders: StoredOrder[];
  try {
    orders = await readOrders(stores, player);
  } catch {
    return false;
  }
  const o = orders.find((x) => x.id === id);
  if (!o || !hunted(o, now)) return true;
  if (notice.units !== BigInt(o.units)) {
    const note = `Пришло ${usdtText(notice.units, cfg.decimals)} USDT вместо ${o.usdt}, алмазы не начислены. Напиши мастерам игры.`;
    return (await noteOrder(stores, player, id, note)) !== null;
  }
  const mine = await claimTx(stores, tx.hash, player, id, now);
  if (mine === null) return false;
  if (mine === false) return (await noteOrder(stores, player, id, 'Этот перевод уже засчитан другому заказу.')) !== null;
  const done = await updatePay(stores, player, (f) => {
    const x = f.orders.find((y) => y.id === id);
    if (!x || x.state === 'paid' || x.state === 'credited') return null;
    return {
      v: 1,
      orders: f.orders.map((y): StoredOrder => {
        if (y.id !== id) return y;
        const { note, ...rest } = y;
        void note;
        return { ...rest, state: 'paid', tx: tx.hash };
      }),
    };
  });
  return done !== null;
}

/** Причина словами на неоплаченном заказе. `null` — хранилище не ответило. */
function noteOrder(stores: Stores, player: string, id: string, note: string): Promise<PayFile | null> {
  return updatePay(stores, player, (f) => {
    const x = f.orders.find((y) => y.id === id);
    if (!x || x.note === note || x.state === 'paid' || x.state === 'credited') return null;
    return { v: 1, orders: f.orders.map((y) => (y.id === id ? { ...y, note } : y)) };
  });
}

/**
 * Просмотр кошелька проекта от курсора: прочитать новые транзакции (не больше бюджета страниц, `ton.incoming`), разобрать
 * финальные по порядку (`settleTx`) и сдвинуть курсор до последней разобранной. Нефинальную свежую транзакцию курсор
 * не перешагивает — следующая проверка посмотрит её снова; зависшая дольше `STUCK_MS` пропускается. Первый просмотр
 * (курсора нет) заводит указатели лежащим заказам и начинает с минуты, раньше которой искомых заказов нет. Возвращает, дочитана ли история до конца. Сеть не ответила — исключение, курсор не тронут.
 */
export async function scanWallet(stores: Stores, cfg: PayConfig, fetcher: Fetch, now: number, pages?: number): Promise<boolean> {
  const kv = stores(STORES.pay, 'strong');
  const key = cursorKey(cfg);
  const found = await kv.getWithMetadata(key);
  let cur = readCursor(found ? parseJson(String(found.data)) : null);
  if (!cur) {
    if (!(await indexAll(stores))) return false;
    cur = { v: 1, at: 0, since: now - PAY_LATE_MS - 60_000 };
  }
  const ours = await projectJettonWallet(cfg, fetcher);
  const got = await incoming(cfg, fetcher, { ...(cur.lt ? { lt: cur.lt } : {}), since: cur.since }, pages);
  let whole = !got.truncated;
  let held = false;
  let next: ScanCursor = cur;
  for (const tx of got.txs) {
    if (!tx.final && now - tx.at < STUCK_MS) {
      // Ждём записи в мастерчейн: курсор встаёт перед ней, а финальные после неё разбираем уже сейчас — повторный
      // разбор следующей проверкой ничего не задвоит (перевод занят навсегда, «оплачен» ставится один раз).
      held = true;
      whole = false;
      continue;
    }
    if (tx.final && !(await settleTx(stores, cfg, ours, tx, now))) {
      whole = false;
      break;
    }
    if (!held) next = { v: 1, lt: tx.lt, at: tx.at, since: cur.since };
  }
  if (!found || next !== cur) await moveCursor(kv, key, next);
  return whole;
}

/**
 * Проверка заказов игрока: просмотреть кошелёк (найденное ложится заказам всех игроков), начислить оплаченное, отметить
 * истёкшие. Сеть не ответила — заказы как были, начисляем то, что уже «оплачено». Возвращает заказы и сколько алмазов
 * легло сейчас.
 */
export async function checkOrders(
  stores: Stores,
  cfg: PayConfig | null,
  fetcher: Fetch,
  player: string,
  now: number,
  chain = true,
): Promise<{ orders: StoredOrder[]; credited: number; lines: string[] } | null> {
  let orders: StoredOrder[];
  try {
    orders = await readOrders(stores, player);
  } catch {
    return null;
  }
  const lines: string[] = [];
  // 1. Сеть: что пришло — заказам всех игроков.
  if (cfg && chain && orders.some((o) => hunted(o, now))) {
    try {
      await scanWallet(stores, cfg, fetcher, now);
    } catch {
      /* сеть TON не ответила — проверим в следующий раз */
    }
  }
  // 2. Записать истёкшие (найденное просмотр уже записал).
  const after = await updatePay(stores, player, (f) => {
    let changed = false;
    const next = f.orders.map((o): StoredOrder => {
      if ((o.state === 'created' || o.state === 'waiting') && now > o.until) {
        changed = true;
        return { ...o, state: 'expired' };
      }
      return o;
    });
    return changed ? { v: 1, orders: next } : null;
  });
  if (!after) return { orders, credited: 0, lines };
  // 3. Начислить оплаченное — дверью книги алмазов, ключом заказа.
  let credited = 0;
  let cur = after.orders;
  for (const o of cur.filter((x) => x.state === 'paid')) {
    const done = await settlePurchase(stores, player, { amount: o.gems, key: `pay:${o.id}`, at: now });
    if (!done || done.error) continue;
    const n = done.entry?.n;
    const fresh = done.entry !== undefined && done.entry.at === now;
    const marked = await updatePay(stores, player, (f) => {
      const x = f.orders.find((y) => y.id === o.id);
      if (!x || x.state !== 'paid') return null;
      return { v: 1, orders: f.orders.map((y) => (y.id === o.id ? { ...y, state: 'credited' as const, ...(n ? { n } : {}) } : y)) };
    });
    if (marked) cur = marked.orders;
    if (fresh) {
      credited += o.gems;
      lines.push(`Покупка: +${o.gems} алмазов (${o.usdt} USDT, заказ ${o.id}).`);
    }
  }
  return { orders: cur, credited, lines };
}

/** Последние заказы всех игроков — команде админа `/payments`. Только чтение; курсор и указатели — не заказы. */
export async function peekPayments(stores: Stores, limit: number): Promise<{ player: string; order: StoredOrder }[]> {
  const kv = stores(STORES.pay, 'strong');
  const { blobs } = await kv.list({});
  const all: { player: string; order: StoredOrder }[] = [];
  for (const { key } of blobs) {
    if (!isPlayerKey(key)) continue;
    const found = await kv.getWithMetadata(key);
    for (const order of readPayFile(found ? parseJson(String(found.data)) : null).orders) all.push({ player: key, order });
  }
  return all.sort((a, b) => b.order.at - a.order.at).slice(0, limit);
}
