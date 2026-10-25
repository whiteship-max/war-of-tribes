/**
 * Книга алмазов (docs/gems.md): баланс, журнал всех операций и лавка игрока — на сервере. Решение владельца 09.10.2026:
 * алмазы больше не живут на устройстве; каждая трата — приказ серверу (`routes/gems.ts`), атомарно, с ключом повтора, и
 * каждая операция — запись в журнале.
 *
 * **Начисление — одна дверь, `creditGems`.** Зовут её ровно два источника: стартовые `START_GEMS` при первом входе игрока
 * в эпоху мира (`openLedger`) и подтверждённая сервером оплата набора (`settlePurchase`, зовёт его только проверка
 * перевода `lib/pay.ts`, docs/payments.md). Больше ниоткуда: админ алмазов не начисляет (`/gems` и `/payments` только
 * читают), приказ игрока только списывает (`spendGems`). Держит это замок `server.test.ts`.
 *
 * **Ключ повтора.** Приказ несёт `key`; запись с тем же ключом уже лежит — второй раз не списывается, отвечает прежняя
 * запись. Сеть оборвала ответ, игра спросила снова — алмазы ушли один раз.
 *
 * **Атомарность** — условной записью хранилища (`onlyIfMatch`/`onlyIfNew`, `kv.ts`): два приказа одновременно не
 * спишут из одного баланса дважды — второй перечитает и посчитает заново. Стартовые кладутся только в пустое место
 * (`onlyIfNew`) — один раз, сколько бы запросов ни пришло разом.
 *
 * Дело для партии (лавка кладёт припас, ускорение достраивает) сервер не исполняет — он партию не разбирает. Он отдаёт
 * запись клиенту с ответом приказа и с каждым ответом сохранения (`noteOf`), а партия применяет её одной дверью ровно
 * один раз, по номеру (`src/game/sim/gems.applyGemDeeds`, `GameState.gemSeen`), — как указы админа.
 *
 * Лежит в хранилище `tribe-gems`, ключ `tg-<id>`; чистый старт (`/wipeworld ДА`) стирает его, и в новой эпохе игрок снова
 * получает стартовые. Чистая логика здесь же, хранилище — двумя функциями внизу.
 */
import { parseJson, WRITE_TRIES } from './http.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { GEM_LIMITS, gemDeed, readCounts, readGemEntry, type Counts, type GemEntry, type GemKind, type GemNote, type GemOrder, type GemShop } from './contract.js';
import {
  SHOP_DAILY,
  SHOP_GOODS,
  SHOP_LOT,
  START_GEMS,
  fullWork,
  rushLevelOk,
  rushPriceOfWork,
  rushSeconds,
  shopDay,
  shopPrice,
} from '../../src/game/gemrules.js';

/** Запись журнала на сервере: то, что видит клиент, плюс ключ повтора. */
export interface StoredGem extends GemEntry {
  key: string;
}

export interface GemLedger {
  v: 1;
  /** Баланс. Меняют его только `creditGems` (+) и `spendGems` (−). */
  balance: number;
  /** Последний выданный номер: растёт и не уменьшается, даже когда старые записи обрезаны. */
  seq: number;
  list: StoredGem[];
  shop: GemShop;
  /**
   * Сколько настоящих миллисекунд нормативного ожидания снято ускорением, по типам построек, за всю эпоху. Книга войска
   * сдвигает на них потолок уровня казарм и конюшни (`book.levelAt`): ускоренная стройка не даёт ложного отказа.
   */
  rushed: Counts;
  /**
   * Ключи всех начисленных покупок (`pay:<номер заказа>`) — **без обрезки**: журнал держит последние `GEM_LIMITS.keep`
   * записей, и повтор по журналу через тысячу операций начислил бы второй раз (дыра docs/gems.md, 5.2). Номера самих
   * переводов в сети лежат отдельно и вечно — хранилище `tribe-paid` (`lib/pay.ts`).
   */
  paid: string[];
}

/** Повтор ускорения той же постройки до того же уровня в этот срок — второй приказ, а не новая стройка. */
export const RUSH_REPEAT_MS = 10 * 60_000;

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Книга из хранилища. Нет записи — `null`: её откроет `openLedger` со стартовыми. */
export function readLedger(v: unknown): GemLedger | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const list: StoredGem[] = [];
  if (Array.isArray(r.list)) {
    for (const raw of r.list) {
      const e = readGemEntry(raw);
      const key = (raw as { key?: unknown } | null)?.key;
      if (e && typeof key === 'string' && key.length <= GEM_LIMITS.key) list.push({ ...e, key });
    }
  }
  list.sort((a, b) => a.n - b.n);
  const top = list.length ? list[list.length - 1].n : 0;
  const shop = (r.shop && typeof r.shop === 'object' ? r.shop : {}) as Record<string, unknown>;
  return {
    v: 1,
    balance: Math.max(0, Math.floor(n0(r.balance))),
    seq: Math.max(top, Math.floor(n0(r.seq))),
    list: list.slice(-GEM_LIMITS.keep),
    shop: { day: Math.max(0, Math.floor(n0(shop.day))), used: Math.max(0, Math.floor(n0(shop.used))) },
    rushed: readCounts(r.rushed),
    paid: Array.isArray(r.paid) ? r.paid.filter((k): k is string => typeof k === 'string' && k.length <= GEM_LIMITS.key) : [],
  };
}

const blank = (): GemLedger => ({ v: 1, balance: 0, seq: 0, list: [], shop: { day: 0, used: 0 }, rushed: {}, paid: [] });

/** Дописать запись в журнал — с номером по порядку и обрезкой. */
function entered(ledger: GemLedger, entry: Omit<StoredGem, 'n'>, balance: number): { ledger: GemLedger; entry: StoredGem } {
  const e: StoredGem = { ...entry, n: ledger.seq + 1 };
  return { ledger: { ...ledger, balance, seq: e.n, list: [...ledger.list, e].slice(-GEM_LIMITS.keep) }, entry: e };
}

/** Запись с этим ключом повтора, если она уже лежит. */
export const byKey = (ledger: GemLedger, key: string): StoredGem | null => ledger.list.find((e) => e.key === key) ?? null;

// ------------------------------------------------ начисление: одна дверь ---

/** Источник начисления: стартовые эпохи или подтверждённая покупка набора. Третьего нет. */
export interface GemGrant {
  source: Extract<GemKind, 'start' | 'purchase'>;
  amount: number;
  /** Ключ: `start` у стартовых, номер платежа у покупки. По нему начисление не задваивается. */
  key: string;
  at: number;
}

/**
 * Единственное начисление алмазов в игре. Тот же ключ второй раз ничего не начисляет: по журналу, а у покупки ещё и по
 * вечному списку `paid` — запись журнала могла уйти обрезкой, тогда `entry` пуст. Зовут её открытие книги
 * (`openLedger`, стартовые) и оплата набора (`settlePurchase`).
 */
export function creditGems(ledger: GemLedger, grant: GemGrant): { ledger: GemLedger; entry: StoredGem | null } | string {
  if (grant.source !== 'start' && grant.source !== 'purchase') return 'Алмазы начисляют только стартовые и покупка.';
  if (!Number.isInteger(grant.amount) || grant.amount <= 0) return 'Пустое начисление.';
  const was = byKey(ledger, grant.key);
  if (was) return { ledger, entry: was };
  if (ledger.paid.includes(grant.key)) return { ledger, entry: null };
  const done = entered(ledger, { at: grant.at, delta: grant.amount, kind: grant.source, key: grant.key }, ledger.balance + grant.amount);
  return grant.source === 'purchase' ? { ledger: { ...done.ledger, paid: [...ledger.paid, grant.key] }, entry: done.entry } : done;
}

/** Книга нового игрока эпохи: пустая плюс стартовые — через ту же дверь начисления. */
export function openLedger(at: number): GemLedger {
  const done = creditGems(blank(), { source: 'start', amount: START_GEMS, key: 'start', at });
  return typeof done === 'string' ? blank() : done.ledger;
}

// ------------------------------------------------ трата ---

/** Списать `price` за дело. Не хватает — отказ словами, книга не тронута. */
function spendGems(ledger: GemLedger, price: number, entry: Omit<StoredGem, 'n' | 'delta'>): { ledger: GemLedger; entry: StoredGem } | string {
  if (!Number.isInteger(price) || price <= 0) return 'Пустая трата.';
  if (ledger.balance < price) return `Не хватает алмазов: нужно ${price}, есть ${ledger.balance}.`;
  return entered(ledger, { ...entry, delta: -price }, ledger.balance - price);
}

/** Лавка на сегодня: другие сутки — счёт с нуля. */
export const shopToday = (ledger: GemLedger, at: number): GemShop =>
  ledger.shop.day === shopDay(at) ? ledger.shop : { day: shopDay(at), used: 0 };

export interface OrderStep {
  /** Новая книга; `null` — не менялась. */
  ledger: GemLedger | null;
  entry?: StoredGem;
  error?: string;
  /**
   * Отказ невозможному: игра назвала остаток или цену, которых у честной партии не бывает. Строка — журналу города с
   * началом «внимание:» (docs/security.md); игроку уходит только `error`.
   */
  warn?: string;
}

/**
 * Приказ игрока по книге в минуту `at`. Повтор ключа — прежняя запись без списания. Отказ — словами, книга не тронута.
 *  · `buy` — сто единиц припаса лавки: не больше `SHOP_DAILY` покупок за сутки, цена `shopPrice`;
 *  · `rush` — ускорение стройки. Остаток работы сервер знает сам — по книге стройки (`town.rushFloor`, `left`): сколько
 *    работы наверняка осталось, раз посёлок не мог сделать больше. Цена — по большему из остатка, названного игрой, и
 *    этого (не больше полного труда уровня): подделка, назвавшая остаток меньше, платит за настоящий. `left === null` —
 *    такой стройки по книге быть не может (уровень уже подтверждён или не следующий). Не берёт больше цены, которую
 *    видел игрок; последние пять минут — даром и приказом не идут.
 */
export function applyGemOrder(ledger: GemLedger, order: GemOrder, at: number, left?: number | null): OrderStep {
  const was = byKey(ledger, order.key);
  if (was) return { ledger: null, entry: was };

  if (order.op === 'buy') {
    if (!SHOP_GOODS.includes(order.res)) return { ledger: null, error: 'Этого лавка не продаёт.' };
    const shop = shopToday(ledger, at);
    if (shop.used >= SHOP_DAILY) return { ledger: null, error: `На сегодня лавка закрыта: ${SHOP_DAILY} покупок из ${SHOP_DAILY}.` };
    const done = spendGems(ledger, shopPrice(order.res), { at, kind: 'buy', key: order.key, res: order.res, amount: SHOP_LOT });
    if (typeof done === 'string') return { ledger: null, error: done };
    return { ledger: { ...done.ledger, shop: { day: shop.day, used: shop.used + 1 } }, entry: done.entry };
  }

  if (!rushLevelOk(order.building, order.level) || left === null) return { ledger: null, error: 'Такой стройки нет.' };
  const full = fullWork(order.building, order.level);
  const work = Math.min(Math.max(order.work, left ?? 0), full);
  const price = rushPriceOfWork(work);
  if (price === 0) return { ledger: null, error: 'Последние пять минут стройка ускоряется даром.' };
  if (price > order.price) {
    // Цена со временем только падает: показанная раньше не меньше нынешней. Дороже показанной — значит, игра назвала
    // остаток меньше, чем оставляет книга стройки, или цену ниже своего остатка.
    const warn = `ускорение ${order.building} до ур. ${order.level}: игра назвала ${order.price} алм. за остаток ${Math.round(order.work)}, сервер считает ${price} алм. за ${Math.round(work)}. Отказ, алмазы не списаны.`;
    return { ledger: null, error: `Ускорение стоит ${price}, а не ${order.price}. Посмотри цену ещё раз.`, warn };
  }
  const twin = ledger.list.find((e) => e.kind === 'rush' && e.building === order.building && e.level === order.level && at - e.at < RUSH_REPEAT_MS);
  if (twin) return { ledger: null, error: 'Эта стройка уже ускорена.' };
  const done = spendGems(ledger, price, { at, kind: 'rush', key: order.key, building: order.building, level: order.level });
  if (typeof done === 'string') return { ledger: null, error: done };
  const rushed = { ...done.ledger.rushed, [order.building]: (done.ledger.rushed[order.building] ?? 0) + Math.round(rushSeconds(work) * 1000) };
  return { ledger: { ...done.ledger, rushed }, entry: done.entry };
}

/** Уровни, ускоренные за алмазы, — книге стройки (`town.buildStep`): сервер сам списал за них, работы они не требуют. */
export const rushesOf = (ledger: GemLedger | null): { n: number; building: string; level: number }[] =>
  (ledger?.list ?? []).flatMap((e) => (e.kind === 'rush' && e.building && e.level ? [{ n: e.n, building: e.building, level: e.level }] : []));

// ------------------------------------------------ что видит клиент ---

/** Запись глазами клиента — без ключа повтора. */
export const shown = (stored: StoredGem): GemEntry => {
  const { key, ...e } = stored;
  void key;
  return e;
};

/**
 * Записка для ответа: баланс, лавка сегодня и дела старше `seen`, которые партия ещё не применила, — **самые старые**,
 * не больше порции, и «ещё», если их больше (FIN-4). Прежде уходили последние пятьдесят: партия на шестьдесят дел позади
 * ставила номер на последнее и десять старших покупок теряла навсегда. `seen` нет — игра до FIN-4 номера не шлёт: ей
 * по-старому последние пятьдесят (она их отсеет своим номером сама).
 */
export function gemNoteOf(ledger: GemLedger, seen: number | undefined, at: number): GemNote {
  const fresh = ledger.list.filter((e) => e.n > (seen ?? 0) && gemDeed(e));
  const deeds = seen === undefined ? fresh.slice(-GEM_LIMITS.deeds) : fresh.slice(0, GEM_LIMITS.deeds);
  return {
    balance: ledger.balance,
    shop: shopToday(ledger, at),
    deeds: deeds.map(shown),
    ...(seen !== undefined && fresh.length > GEM_LIMITS.deeds ? { more: true as const } : {}),
  };
}

/** Журнал для окна «История» — последние записи без ключей повтора. */
export const listOf = (ledger: GemLedger): GemEntry[] => ledger.list.slice(-GEM_LIMITS.view).map(shown);

// ------------------------------------------------ хранилище ---

/**
 * Прочитать книгу игрока, открыв её со стартовыми, если её нет, и, если дан приказ, — исполнить его. Одна дверь записи
 * хранилища алмазов: условная запись поверх прочитанного, при чужой записи между — заново. `null` — хранилище не
 * ответило или не пробились за `WRITE_TRIES`: ничего не списано.
 */
export function settleGems(
  stores: Stores,
  player: string,
  at: number,
  order: GemOrder | null = null,
  left?: number | null,
): Promise<{ ledger: GemLedger; entry?: StoredGem; error?: string; warn?: string } | null> {
  return settle(stores, player, at, (cur) => (order ? applyGemOrder(cur, order, at, left) : { ledger: null }));
}

/**
 * Начислить оплаченный набор — вторая и последняя дверь, которая зовёт `creditGems` (источник `purchase`, ключ
 * `pay:<номер заказа>`). Зовёт её только проверка перевода (`lib/pay.ts`), когда сервер сам нашёл перевод в сети. Повтор
 * ничего не начисляет. `null` — хранилище не ответило: заказ остаётся «оплачен» и начислится следующей проверкой.
 */
export function settlePurchase(stores: Stores, player: string, grant: Omit<GemGrant, 'source'>): Promise<{ ledger: GemLedger; entry?: StoredGem; error?: string } | null> {
  return settle(stores, player, grant.at, (cur) => {
    const done = creditGems(cur, { ...grant, source: 'purchase' });
    if (typeof done === 'string') return { ledger: null, error: done };
    return { ledger: done.ledger === cur ? null : done.ledger, ...(done.entry ? { entry: done.entry } : {}) };
  });
}

/** Одна дверь записи хранилища алмазов: прочитать (открыть со стартовыми), сделать шаг, записать условно. */
async function settle(stores: Stores, player: string, at: number, act: (cur: GemLedger) => OrderStep): Promise<{ ledger: GemLedger; entry?: StoredGem; error?: string; warn?: string } | null> {
  const kv: Kv = stores(STORES.gems, 'strong');
  try {
    for (let tries = 0; tries < WRITE_TRIES; tries++) {
      const found = await kv.getWithMetadata(player);
      const stored = readLedger(found ? parseJson(String(found.data)) : null);
      // Запись есть, а не читается, — не открывать заново: вторые стартовые хуже, чем отказ.
      if (found && !stored) return null;
      const cur = stored ?? openLedger(at);
      const step = act(cur);
      const next = step.ledger ?? (stored ? null : cur);
      if (!next) return { ledger: cur, ...(step.entry ? { entry: step.entry } : {}), ...(step.error ? { error: step.error } : {}), ...(step.warn ? { warn: step.warn } : {}) };
      const written = await kv.setJSON(player, next, found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true });
      if (written.modified) return { ledger: next, ...(step.entry ? { entry: step.entry } : {}), ...(step.error ? { error: step.error } : {}), ...(step.warn ? { warn: step.warn } : {}) };
    }
  } catch {
    /* хранилище не ответило: ничего не списано */
  }
  return null;
}

/** Книга игрока только для чтения — команде админа (`/gems`). Нет записи — `null`; ничего не открывает и не пишет. */
export async function peekGems(stores: Stores, player: string): Promise<GemLedger | null> {
  const found = await stores(STORES.gems, 'strong').getWithMetadata(player);
  return readLedger(found ? parseJson(String(found.data)) : null);
}
