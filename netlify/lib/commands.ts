/**
 * Команды админа в боте (docs/admin.md): найти игрока, посмотреть его, отдать указ (ресурс или бойцы, плюсом или
 * минусом), заморозить и разморозить, журнал админа, таблица по всем файлом CSV, флаги подозрительного, отчёты об
 * ошибках.
 *
 * **Только `ADMIN_IDS`.** Обновление приходит в вебхук бота с секретом (`routes/bot.ts` проверяет его раньше всего);
 * здесь, раньше любого похода в хранилище, проверяется, что написал админ и в личном чате с ботом. Всем остальным
 * бот молчит: ни ответа, ни отказа — подбирающему нечего узнать даже о том, что команды есть.
 *
 * Партии команды не трогают: сохранения игроков здесь только проверяются на существование (есть ли такой игрок), а
 * указ ложится записью в журнал игрока (`admin.grantsKey`) — применяет его клиент, один раз. Алмазов указ не знает:
 * виды — только `STOCK_KEYS` и `TROOP_KEYS` договора.
 */
import { allow, parseJson, type Io } from './http.js';
import { STORES } from './kv.js';
import { GRANT_MAX, STOCK_KEYS, TROOP_KEYS, cityName, cityOr, type StockKey, type TroopKey } from './contract.js';
import { FLAG_WORD, big, blankWatch, noted, observe, readWatchRecord, signed, span, stockWord, type WatchRecord } from './watch.js';
import {
  FROZEN_KEY,
  LOG_KEY,
  PLAYER,
  grantsKey,
  isAdmin,
  logAdmin,
  readAdminLog,
  readFrozen,
  readGrants,
  rewrite,
  type FrozenFile,
  type GrantsFile,
} from './admin.js';
import { REPORT_ID, reportAt } from './reports.js';
import { spawnsNow, wipeWorld } from './era.js';
import { publicRow, ratingNow } from './rating.js';
import { finalText } from './words.js';
import { spawnMode } from './http.js';
import { SICILY, SPAWNS, spawnSlot } from '../../src/world/spawn.js';
import type { Telegram } from './telegram.js';
import { TROOPS } from '../../src/game/data/troops.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { SHOP_DAILY, gemLine } from '../../src/game/gemrules.js';
import { peekGems, shopToday } from './gems.js';
import { peekPayments } from './pay.js';
import { payConfig } from './ton.js';

/** Команд в минуту от одного админа — больше живой человек не набирает. */
const PER_MINUTE = 30;

/** Идентификатор пользователя Telegram из обновления: только положительное целое. */
const userId = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

// ------------------------------------------------ слова ---

/** Время для админа — по Москве: владелец и игроки теста живут в ней (docs/admin.md). */
export function when(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms + 3 * 3600_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Имя бойца для админа — именем игры. */
const troopWord = (k: string): string => TROOPS.find((t) => t.id === k)?.name.toLowerCase() ?? k;

/** Кто это: город, ключ и имя пользователя. */
export function label(key: string, rec: WatchRecord): string {
  return `«${cityOr(rec.card?.city)}» ${key}${rec.user ? ` @${rec.user}` : ''}`;
}

export const HELP = [
  'Команды админа',
  '',
  '/find <кто> — найти игрока. Кто: номер Telegram, @имя или часть имени города.',
  '/player <кто> — всё об игроке: числа, флаги, журнал.',
  '/give <кто> <что> <число> … — прибавить ресурс или бойцов, с минусом — убавить.',
  '   Пример: /give 123456789 дерево 500 копейщики -10',
  '/freeze <кто> [причина] — заморозить: игру видит, ходить не может, походы игроков его не трогают.',
  '/unfreeze <кто> — разморозить.',
  '/frozen — кто заморожен.',
  '/gems <кто> — алмазы игрока: баланс, лавка за сегодня и журнал операций. Начислять алмазы команда не умеет.',
  '/payments — последние заказы алмазов за USDT и их статус. Только чтение.',
  '/log [сколько] — журнал админа.',
  '/stats — таблица по всем игрокам файлом CSV (Excel, Google Таблицы).',
  '/flags — подозрительные игроки.',
  '/reports — последние отчёты об ошибках.',
  '/report <номер> — отчёт целиком.',
  '/spawns — места появления (Сицилия, потом материк до Флоренции): кто какое занял.',
  '/wipeworld ДА — чистый старт: стереть все партии, замки, войну, журналы, отчёты и статистику; номер эпохи мира +1.',
  '/final — итоговый рейтинг: как его увидят игроки. /final ДА — разослать всем игрокам в бот.',
  '',
  'Что можно в /give: древесина (дерево), камень, еда, шкуры, уголь, медь, железо, золото; бойцы — дубинщики, копейщики, лучники, топорники, мечники, щитоносцы, всадники, латные (латные всадники), латники. Можно и латиницей: wood, spearman… Алмазы указом не меняются.',
  'Город с пробелом в имени — называй номером.',
].join('\n');

// ------------------------------------------------ словарь указа ---

type Kind = { stock: StockKey } | { troop: TroopKey };

/** Слова, которыми админ называет виды: имена игры, латинские ключи и несколько привычных синонимов. */
const VOCAB: { words: string[]; kind: Kind }[] = [
  ...STOCK_KEYS.map((k) => ({ words: [k, stockWord(k)], kind: { stock: k } as Kind })),
  ...TROOP_KEYS.map((k) => ({ words: [k, troopWord(k)], kind: { troop: k } as Kind })),
  { words: ['дерево', 'дрова', 'лес'], kind: { stock: 'wood' } },
  { words: ['камни'], kind: { stock: 'stone' } },
  { words: ['угля', 'угли'], kind: { stock: 'charcoal' } },
  { words: ['пища'], kind: { stock: 'food' } },
  { words: ['деньги', 'монеты'], kind: { stock: 'gold' } },
  { words: ['латные'], kind: { troop: 'knight' } },
];

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

/**
 * Вид по слову админа: точное совпадение — сразу; иначе самое длинное общее начало (не короче трёх букв), и только если
 * оно одно — «копейщиков» найдёт копейщиков, «лат» не найдёт ничего (латные или латники).
 */
export function kindOf(token: string): Kind | null {
  const t = norm(token);
  if (t.length < 3) return null;
  let best = 0;
  let found: Kind[] = [];
  for (const v of VOCAB) {
    for (const w of v.words.map(norm)) {
      if (w === t) return v.kind;
      let n = 0;
      while (n < w.length && n < t.length && w[n] === t[n]) n++;
      if (n < 3) continue;
      if (n > best) {
        best = n;
        found = [v.kind];
      } else if (n === best && !found.some((k) => JSON.stringify(k) === JSON.stringify(v.kind))) {
        found.push(v.kind);
      }
    }
  }
  return found.length === 1 ? found[0] : null;
}

/** Число указа: целое со знаком, не ноль, не больше `GRANT_MAX` по модулю. */
function amountOf(token: string): number | null {
  const m = /^([+\-−]?)(\d{1,8})$/.exec(token.replace(/\s/g, ''));
  if (!m) return null;
  const n = Number(m[2]) * (m[1] === '-' || m[1] === '−' ? -1 : 1);
  return n !== 0 && Math.abs(n) <= GRANT_MAX ? n : null;
}

/** Разбор `/give`: пары «что число» с конца строки, остаток спереди — кто. */
export function parseGive(args: string[]): { who: string; stock: Partial<Record<StockKey, number>>; troops: Partial<Record<TroopKey, number>> } | string {
  const stock: Partial<Record<StockKey, number>> = {};
  const troops: Partial<Record<TroopKey, number>> = {};
  let i = args.length;
  let pairs = 0;
  while (i >= 2) {
    const n = amountOf(args[i - 1]);
    if (n === null) break;
    const kind = kindOf(args[i - 2]);
    if (!kind) return `Не знаю, что такое «${args[i - 2]}». /help — список видов.`;
    if ('stock' in kind) stock[kind.stock] = (stock[kind.stock] ?? 0) + n;
    else troops[kind.troop] = (troops[kind.troop] ?? 0) + n;
    i -= 2;
    pairs++;
  }
  if (!pairs) return 'Нужно: /give <кто> <что> <число> … Например: /give 123456789 дерево 500 копейщики -10';
  const who = args.slice(0, i).join(' ');
  if (!who) return 'Кому? Первым словом — номер Telegram, @имя или имя города.';
  for (const k of STOCK_KEYS) if (stock[k] === 0) delete stock[k];
  for (const k of TROOP_KEYS) if (troops[k] === 0) delete troops[k];
  if (Object.keys(stock).length + Object.keys(troops).length === 0) return 'Всё сложилось в ноль — указ пустой.';
  return { who, stock, troops };
}

/** Указ словами: «древесина +500, копейщики −10». */
export const grantText = (stock: Partial<Record<StockKey, number>>, troops: Partial<Record<TroopKey, number>>): string =>
  [
    ...STOCK_KEYS.filter((k) => stock[k]).map((k) => `${stockWord(k)} ${signed(stock[k] as number)}`),
    ...TROOP_KEYS.filter((k) => troops[k]).map((k) => `${troopWord(k)} ${signed(troops[k] as number)}`),
  ].join(', ');

// ------------------------------------------------ игроки ---

interface Found {
  key: string;
  rec: WatchRecord;
}

/** Все, кого видело наблюдение. Читается пачками: игроков теста — десятки и сотни. */
export async function everyone(io: Io): Promise<Found[]> {
  const kv = io.stores(STORES.watch);
  const { blobs } = await kv.list({ prefix: 'tg-' });
  const keys = blobs.map((b) => b.key).filter((k) => PLAYER.test(k));
  const out: Found[] = [];
  for (let i = 0; i < keys.length; i += 16) {
    out.push(
      ...(await Promise.all(
        keys.slice(i, i + 16).map(async (key) => {
          const found = await kv.getWithMetadata(key);
          return { key, rec: readWatchRecord(found ? parseJson(String(found.data)) : null) };
        }),
      )),
    );
  }
  return out;
}

const plain = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').trim();

/** Поиск: номер Telegram — прямо; иначе имя пользователя точно, потом имя города точно, потом часть имени города или вождя. */
export async function lookup(io: Io, raw: string): Promise<Found[]> {
  const q = raw.trim();
  if (!q) return [];
  const direct = /^(?:tg-)?([1-9]\d{0,19})$/.exec(q);
  if (direct) {
    const key = `tg-${direct[1]}`;
    const found = await io.stores(STORES.watch, 'strong').getWithMetadata(key);
    const rec = readWatchRecord(found ? parseJson(String(found.data)) : null);
    if (found) return [{ key, rec }];
    // Партия есть, а наблюдения ещё нет (играл до админки): указ и заморозка всё равно годятся.
    const save = await io.stores(STORES.saves).getWithMetadata(key);
    return save ? [{ key, rec: blankWatch() }] : [];
  }
  const all = await everyone(io);
  const user = q.replace(/^@/, '').toLowerCase();
  const byUser = all.filter((f) => f.rec.user && f.rec.user.toLowerCase() === user);
  if (byUser.length) return byUser;
  const nq = plain(q);
  const exact = all.filter((f) => plain(cityName(f.rec.card?.city) ?? '') === nq);
  if (exact.length) return exact;
  return all.filter((f) => plain(cityName(f.rec.card?.city) ?? '').includes(nq) || (f.rec.name && plain(f.rec.name).includes(nq)));
}

/** Ровно один игрок — или ответ словами, почему нет. */
async function one(io: Io, who: string): Promise<Found | string> {
  const found = await lookup(io, who);
  if (!found.length) return `Не нашёл «${who}». /find покажет похожих.`;
  if (found.length > 1) return `Нашлось ${found.length}:\n${found.slice(0, 15).map((f) => `• ${label(f.key, f.rec)}`).join('\n')}\nУточни номером.`;
  return found[0];
}

// ------------------------------------------------ команды ---

type Reply = { text: string } | { file: { name: string; content: string; caption: string } };

const say = (text: string): Reply => ({ text });

async function readFrozenNow(io: Io): Promise<FrozenFile> {
  const found = await io.stores(STORES.admin, 'strong').getWithMetadata(FROZEN_KEY);
  return readFrozen(found ? parseJson(String(found.data)) : null);
}

async function readGrantsOf(io: Io, player: string): Promise<GrantsFile> {
  const found = await io.stores(STORES.admin, 'strong').getWithMetadata(grantsKey(player));
  return readGrants(found ? parseJson(String(found.data)) : null);
}

/** Строка журнала игрока о действии админа — попутно; не легла — действие от этого не отменяется. */
const journal = (io: Io, player: string, at: number, kind: 'grant' | 'freeze', text: string): Promise<void> =>
  observe(io.stores, player, (cur) => noted(cur, at, kind, text));

async function find(io: Io, q: string): Promise<Reply> {
  if (!q) return say('Кого искать? /find 123456789, /find @имя или /find часть имени города.');
  const found = await lookup(io, q);
  if (!found.length) return say(`Никого по «${q}».`);
  return say(
    `Нашлось ${found.length}:\n` +
      found
        .slice(0, 30)
        .map((f) => `• ${label(f.key, f.rec)} — ${f.rec.card ? `ратуша ${f.rec.card.level}, жителей ${big(f.rec.card.pop)}` : 'описи ещё нет'}, был ${when(f.rec.last)}`)
        .join('\n'),
  );
}

/** Имя постройки для админа — именем игры. */
const gemBuilding = (b: string): string => (BUILDING_BY_ID as Record<string, { name: string } | undefined>)[b]?.name ?? b;

/** Сколько строк журнала алмазов показывает `/gems`. */
export const GEMS_LINES = 25;

/**
 * `/gems <кто>` — алмазы игрока (docs/gems.md): баланс, лавка за сегодня, сколько ожидания снято ускорением и журнал.
 * Только чтение: книга не открывается и не пишется, и начислить отсюда нельзя ничего — начисление одно, `creditGems`.
 */
async function gemsOf(io: Io, q: string): Promise<Reply> {
  if (!q) return say('Кого? /gems 123456789');
  const f = await one(io, q);
  if (typeof f === 'string') return say(f);
  const ledger = await peekGems(io.stores, f.key);
  if (!ledger) return say(`${label(f.key, f.rec)}\nКниги алмазов нет: игрок не заходил в эту эпоху мира с новой версией игры.`);
  const shop = shopToday(ledger, io.now);
  const lines = [
    label(f.key, f.rec),
    `Алмазов: ${big(ledger.balance)} · операций ${ledger.seq}`,
    `Лавка сегодня: ${shop.used} из ${SHOP_DAILY}`,
  ];
  const rushed = Object.entries(ledger.rushed).filter(([, ms]) => ms > 0);
  if (rushed.length) lines.push(`Ускорено: ${rushed.map(([b, ms]) => `${gemBuilding(b)} ${span(ms)}`).join(', ')}`);
  lines.push('', ledger.list.length > GEMS_LINES ? `Журнал (последние ${GEMS_LINES}):` : 'Журнал:');
  for (const e of ledger.list.slice(-GEMS_LINES)) lines.push(`№${e.n} ${when(e.at)} ${gemLine(e)}`);
  return say(lines.join('\n'));
}

/** Сколько заказов показывает `/payments`. */
export const PAYMENTS_LINES = 20;

/** Статус заказа словами — для админа. */
export const PAY_WORD: Record<string, string> = {
  created: 'создан',
  waiting: 'ждёт перевода',
  paid: 'оплачен, начисляется',
  credited: 'начислено',
  expired: 'истёк',
};

/**
 * `/payments` — последние заказы алмазов за USDT (docs/payments.md): кто, набор, сумма, статус, причина. Только чтение
 * (`peekPayments`): начислить или поменять статус команда не может — начисляет только перевод, найденный в сети.
 */
async function payments(io: Io): Promise<Reply> {
  const cfg = payConfig();
  const head = typeof cfg === 'string' ? `Оплата выключена: ${cfg}` : `Оплата: сеть ${cfg.net}, кошелёк ${cfg.wallet.toString({ testOnly: cfg.net === 'testnet' })}`;
  const rows = await peekPayments(io.stores, PAYMENTS_LINES);
  if (!rows.length) return say(`${head}\nЗаказов нет.`);
  const lines = [head, '', `Последние ${rows.length}:`];
  for (const { player: who, order: o } of rows) {
    lines.push(`${when(o.at)} ${who} · ${o.id} · ${o.gems} за ${o.usdt} USDT · ${PAY_WORD[o.state] ?? o.state}${o.tx ? ` · tx ${o.tx.slice(0, 12)}…` : ''}${o.note ? ` · ${o.note}` : ''}`);
  }
  return say(lines.join('\n'));
}

async function player(io: Io, q: string): Promise<Reply> {
  if (!q) return say('Кого? /player 123456789');
  const f = await one(io, q);
  if (typeof f === 'string') return say(f);
  const { key, rec } = f;
  const frozen = await readFrozenNow(io);
  const grants = await readGrantsOf(io, key);
  const c = rec.card;
  const ice = frozen.keys[key];
  const lines = [
    label(key, rec),
    `Правитель: ${rec.name || '—'} · мощь ${big(rec.power)} · игровой день ${rec.day}`,
    `Пришёл ${when(rec.first)} · последний запрос ${when(rec.last)}`,
    `Заходов ${rec.visits} · в игре ${span(rec.played)} · записей партии ${rec.writes} · походов на игроков ${rec.wars}`,
  ];
  if (c) {
    const army = TROOP_KEYS.filter((k) => c.troops[k]).map((k) => `${troopWord(k)} ${big(c.troops[k])}`);
    lines.push(
      `Ратуша ${c.level} · жителей ${big(c.pop)} · войско ${big(Object.values(c.troops).reduce((t, x) => t + x, 0))}${army.length ? ` (${army.join(', ')})` : ''} · учатся ${c.queued} · раненых ${c.wounded}`,
      `Склад: ${STOCK_KEYS.map((k) => `${stockWord(k)} ${big(c.stock[k] ?? 0)}`).join(', ')} · вместимость ${big(c.cap)}`,
      `Бои: побед ${c.won}, поражений ${c.lost} · логов сожжено ${c.lairs} · набегов ${c.raids}`,
      `Промыслы: ${c.games} игр, добыча ${big(c.haul)}`,
      `Версия: ${c.build || '—'} · опись от ${when(rec.cardAt)}${c.cheated ? ' · коды проверки' : ''}${c.lead > 0 ? ` · ускорена на ${span(c.lead)}` : ''}`,
    );
  } else {
    lines.push('Описи партии ещё нет: игрок не сохранялся с новой версией игры.');
  }
  lines.push(ice ? `ЗАМОРОЖЕН с ${when(ice.at)}${ice.why ? ` — ${ice.why}` : ''}` : 'Не заморожен.');
  if (grants.seq) lines.push(`Указы: последний №${grants.seq}, партия применила №${c?.seen ?? 0}.`);
  if (rec.flags.length) {
    lines.push('', `Флаги (${rec.flags.length}):`);
    for (const fl of rec.flags.slice(-8)) lines.push(`• ${when(fl.at)} ${FLAG_WORD[fl.kind]}${fl.n > 1 ? ` ×${fl.n}` : ''}: ${fl.text}`);
  } else {
    lines.push('Флагов нет.');
  }
  if (rec.journal.length) {
    lines.push('', 'Журнал:');
    for (const e of rec.journal.slice(-15)) lines.push(`• ${when(e.at)} ${e.text}`);
  }
  return say(lines.join('\n'));
}

async function give(io: Io, args: string[], admin: number, now: number): Promise<Reply> {
  const parsed = parseGive(args);
  if (typeof parsed === 'string') return say(parsed);
  const f = await one(io, parsed.who);
  if (typeof f === 'string') return say(f);
  const done = await rewrite(io.stores(STORES.admin, 'strong'), grantsKey(f.key), readGrants, (cur) => {
    const n = cur.seq + 1;
    return { v: 1 as const, seq: n, list: [...cur.list, { n, at: now, by: admin, stock: parsed.stock, troops: parsed.troops }] };
  });
  if (!done) return say('Указ не записался: хранилище занято. Повтори.');
  const what = grantText(parsed.stock, parsed.troops);
  await logAdmin(io.stores, { at: now, by: admin, who: f.key, what: `Указ №${done.seq}: ${what}` });
  await journal(io, f.key, now, 'grant', `Указ админа №${done.seq}: ${what}.`);
  return say(
    `Указ №${done.seq} для ${label(f.key, f.rec)}: ${what}.\n` +
      'Ляжет в партию, когда игра в следующий раз поговорит с сервером (раз в минуту, пока игрок в игре). Убавка — не ниже нуля, прибавка на склад — сколько влезет.',
  );
}

async function freeze(io: Io, args: string[], admin: number, now: number, on: boolean): Promise<Reply> {
  if (!args.length) return say(on ? 'Кого? /freeze 123456789 причина' : 'Кого? /unfreeze 123456789');
  const f = await one(io, args[0]);
  if (typeof f === 'string') return say(f);
  const why = args.slice(1).join(' ').slice(0, 200);
  let was = false;
  const done = await rewrite(io.stores(STORES.admin, 'strong'), FROZEN_KEY, readFrozen, (cur) => {
    was = f.key in cur.keys;
    if (was === on) return null;
    const keys = { ...cur.keys };
    if (on) keys[f.key] = { at: now, by: admin, why };
    else delete keys[f.key];
    return { v: 1 as const, keys };
  });
  if (was === on) return say(on ? `${label(f.key, f.rec)} уже заморожен.` : `${label(f.key, f.rec)} не заморожен.`);
  if (!done) return say('Не записалось: хранилище занято. Повтори.');
  const what = on ? `Заморозка${why ? `: ${why}` : ''}` : 'Разморозка';
  await logAdmin(io.stores, { at: now, by: admin, who: f.key, what });
  await journal(io, f.key, now, 'freeze', `${what} (админ).`);
  return say(
    on
      ? `${label(f.key, f.rec)} заморожен. Игра покажет ему плашку, записи и приказы войны не примутся, походы на его город не уйдут, а идущие повернут.`
      : `${label(f.key, f.rec)} разморожен. Плашка уйдёт со следующей записью игры (раз в минуту).`,
  );
}

async function frozenList(io: Io): Promise<Reply> {
  const file = await readFrozenNow(io);
  const keys = Object.entries(file.keys);
  if (!keys.length) return say('Замороженных нет.');
  return say(`Заморожены (${keys.length}):\n${keys.map(([k, v]) => `• ${k} с ${when(v.at)}${v.why ? ` — ${v.why}` : ''}`).join('\n')}`);
}

async function adminLog(io: Io, arg: string): Promise<Reply> {
  const count = Math.max(1, Math.min(50, Number(arg) || 20));
  const found = await io.stores(STORES.admin, 'strong').getWithMetadata(LOG_KEY);
  const log = readAdminLog(found ? parseJson(String(found.data)) : null);
  if (!log.list.length) return say('Журнал админа пуст.');
  return say(`Журнал админа (последние ${Math.min(count, log.list.length)}):\n${log.list.slice(-count).map((e) => `• ${when(e.at)} ${e.by} → ${e.who || '—'}: ${e.what}`).join('\n')}`);
}

async function flags(io: Io): Promise<Reply> {
  const all = (await everyone(io)).filter((f) => f.rec.flags.length > 0);
  if (!all.length) return say('Подозрительных нет: флагов ни у кого.');
  const lastAt = (r: WatchRecord): number => r.flags[r.flags.length - 1].at;
  all.sort((a, b) => lastAt(b.rec) - lastAt(a.rec));
  const lines = [`Флаги у ${all.length}:`];
  for (const f of all.slice(0, 25)) {
    const kinds = [...new Set(f.rec.flags.map((x) => FLAG_WORD[x.kind]))].join(', ');
    const last = f.rec.flags[f.rec.flags.length - 1];
    lines.push(`• ${label(f.key, f.rec)} — ${f.rec.flags.length}: ${kinds}. Последний ${when(last.at)}: ${last.text}`);
  }
  if (all.length > 25) lines.push(`…и ещё ${all.length - 25}. Все — в /stats.`);
  return say(lines.join('\n'));
}

/**
 * Ячейка CSV: точка с запятой — разделитель русского Excel; кавычки удваиваются. Строка, которую Excel или Таблицы
 * прочтут формулой (начало `=`, `+`, `-`, `@`, табуляция, возврат каретки), получает спереди апостроф: имя города и
 * правителя пишет игрок, и город `=HYPERLINK(…)` в таблице админа стал бы живой ссылкой или запросом наружу со
 * столбцом чужих номеров Telegram (docs/bughunt.md, «Формула в /stats»). Числа не трогаются — минус у них свой.
 */
export const cell = (v: string | number): string => {
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Таблица по всем игрокам: строка на игрока, столбцы — ключевые числа и флаги. */
export function statsCsv(rows: Found[], frozen: FrozenFile): string {
  const head = [
    'id',
    'имя пользователя',
    'город',
    'правитель',
    'пришёл',
    'пригласил',
    'последний запрос',
    'заходов',
    'минут в игре',
    'записей',
    'игровой день',
    'ратуша',
    'жители',
    'мощь',
    'войско',
    ...TROOP_KEYS.map(troopWord),
    'учатся',
    'раненых',
    ...STOCK_KEYS.map(stockWord),
    'вместимость склада',
    'побед',
    'поражений',
    'логов сожжено',
    'набегов',
    'походов на игроков',
    'промыслов',
    'добыча промыслов',
    'коды проверки',
    'заморожен',
    'флагов',
    'виды флагов',
    'последний флаг',
    'версия игры',
  ];
  const out = [head.map(cell).join(';')];
  for (const { key, rec } of rows) {
    const c = rec.card;
    const line: (string | number)[] = [
      key.slice(3),
      rec.user,
      cityName(c?.city) ?? '',
      rec.name,
      when(rec.first),
      rec.ref ? rec.ref.slice(3) : '',
      when(rec.last),
      rec.visits,
      Math.round(rec.played / 60_000),
      rec.writes,
      rec.day,
      c?.level ?? '',
      c?.pop ?? '',
      rec.power,
      c ? Object.values(c.troops).reduce((t, x) => t + x, 0) : '',
      ...TROOP_KEYS.map((k) => (c ? (c.troops[k] ?? 0) : '')),
      c?.queued ?? '',
      c?.wounded ?? '',
      ...STOCK_KEYS.map((k) => (c ? (c.stock[k] ?? 0) : '')),
      c?.cap ?? '',
      c?.won ?? '',
      c?.lost ?? '',
      c?.lairs ?? '',
      c?.raids ?? '',
      rec.wars,
      c?.games ?? '',
      c?.haul ?? '',
      c?.cheated ? 'да' : '',
      key in frozen.keys ? 'да' : '',
      rec.flags.length,
      [...new Set(rec.flags.map((x) => FLAG_WORD[x.kind]))].join(', '),
      rec.flags.length ? rec.flags[rec.flags.length - 1].text : '',
      c?.build ?? '',
    ];
    out.push(line.map(cell).join(';'));
  }
  // BOM — чтобы Excel прочёл кириллицу как UTF-8; Google Таблицы его пропускают.
  return `\uFEFF${out.join('\r\n')}\r\n`;
}

async function stats(io: Io, now: number): Promise<Reply> {
  const rows = await everyone(io);
  rows.sort((a, b) => b.rec.last - a.rec.last);
  const frozen = await readFrozenNow(io);
  const day = when(now).replace(/[ .:]/g, '-');
  return {
    file: {
      name: `tribe-stats-${day}.csv`,
      content: statsCsv(rows, frozen),
      caption: `Игроков: ${rows.length}, по приглашению: ${rows.filter((r) => r.rec.ref).length}, с флагами: ${rows.filter((r) => r.rec.flags.length).length}, заморожено: ${Object.keys(frozen.keys).length}. Разделитель — точка с запятой.`,
    },
  };
}

async function reportsList(io: Io): Promise<Reply> {
  const kv = io.stores(STORES.reports);
  const { blobs } = await kv.list({});
  const ids = blobs
    .map((b) => b.key)
    .filter((k) => REPORT_ID.test(k))
    .sort()
    .reverse()
    .slice(0, 10);
  if (!ids.length) return say('Отчётов об ошибках нет.');
  const lines = ['Последние отчёты:'];
  for (const id of ids) {
    const r = await reportAt(kv, id);
    if (r) lines.push(`• ${when(r.at)} /report ${r.id} — «${cityOr(r.city)}» ${r.player}${r.user ? ` @${r.user}` : ''}: ${r.text.slice(0, 80)}`);
  }
  return say(lines.join('\n'));
}

async function reportOne(io: Io, id: string): Promise<Reply> {
  if (!REPORT_ID.test(id)) return say('Номер отчёта — как в сообщении: /report m1abc2de-1234');
  const r = await reportAt(io.stores(STORES.reports), id);
  if (!r) return say(`Отчёта ${id} нет.`);
  const c = r.ctx;
  return say(
    [
      `Отчёт ${r.id} · ${when(r.at)}`,
      `От: «${cityOr(r.city)}» ${r.player}${r.user ? ` @${r.user}` : ''}`,
      '',
      r.text,
      '',
      `Версия: ${c.build || '—'}`,
      `Устройство: ${c.device || '—'}`,
      `Экран: ${c.screen || '—'} · открыто: ${c.view || '—'}`,
      `Игровой день ${c.day} · часы устройства ${when(c.clock)} (сервер ${when(r.at)})`,
      ...(c.events.length ? ['', 'Последние события:', ...c.events.map((e) => `• ${e}`)] : []),
      ...(c.scene ? ['', 'Что было со сценой:', c.scene] : []),
    ].join('\n'),
  );
}

// ------------------------------------------------ тест с игроками (docs/test_world.md) ---

/** Места теста — остров, потом материк: кто какое занял, и кто встал вне мест (места кончились). */
async function spawns(io: Io): Promise<Reply> {
  const { roster, era } = await spawnsNow(io.stores);
  const rows = Object.entries(roster.rows);
  const who = ([key, row]: (typeof rows)[number]): string => `«${cityOr(row.city)}» ${key}${row.name ? ` (${row.name})` : ''}, был ${when(row.seenAt)}`;
  const lines = SPAWNS.map((s, i) => {
    const on = rows.find(([, r]) => r.x === s.x && r.y === s.y);
    return `${i + 1}. ${s.x}|${s.y} — ${on ? who(on) : 'свободно'}`;
  });
  const off = rows.filter(([, r]) => spawnSlot(r) === 0);
  return say(
    [
      `Места теста: Сицилия, потом материк от Калабрии до Флоренции (режим ${spawnMode() === 'sicily' ? 'TRIBE_SPAWN=sicily включён' : 'ВЫКЛЮЧЕН — новички встают по обычным правилам'}; эпоха мира ${era.era}${era.wiping ? ', идёт стирание' : ''}).`,
      `Занято ${SPAWNS.length - lines.filter((l) => l.endsWith('свободно')).length} из ${SPAWNS.length}.`,
      '',
      'Сицилия:',
      ...lines.slice(0, SICILY.length),
      '',
      'Материк, с юга на север:',
      ...lines.slice(SICILY.length),
      ...(off.length ? ['', `Вне мест (${off.length}):`, ...off.slice(0, 30).map((e) => `• ${e[1].x}|${e[1].y} — ${who(e)}`)] : []),
    ].join('\n'),
  );
}

/** Чистый старт — только со словом «ДА»: без него бот объясняет, что будет стёрто. */
async function wipe(io: Io, args: string[], admin: number, now: number): Promise<Reply> {
  if (args.length !== 1 || args[0] !== 'ДА') {
    return say(
      [
        'Чистый старт стирает на сервере: все партии, реестр замков, войну, уведомления, журналы городов, отчёты об ошибках, статистику и указы. Остаются заморозка и журнал админа.',
        'Номер эпохи мира поднимется на один: старая партия с телефона не загрузится и на сервер не уйдёт — у каждого начнётся новая.',
        'Подтвердить: /wipeworld ДА',
      ].join('\n'),
    );
  }
  const done = await wipeWorld(io.stores, admin, now);
  if (typeof done === 'string') return say(done);
  const total = Object.values(done.counts).reduce((a, b) => a + b, 0);
  return say(
    [
      `Мир начат заново: эпоха ${done.era}. Стёрто записей: ${total}.`,
      ...Object.entries(done.counts).map(([k, n]) => `• ${k}: ${n}`),
      'Игроки, открывшие игру, начнут новую партию с выдачей места. /spawns — кто где встал.',
    ].join('\n'),
  );
}

/** Сколько сообщений рассылки уходит разом: Telegram пускает около тридцати в секунду. */
const FINAL_BATCH = 10;

/**
 * Итоговый рейтинг (docs/rating.md). Без «ДА» — таблица, как её увидят игроки, и сколько их; со «ДА» — каждому игроку
 * рейтинга в бот, со своим местом. Рассылку назад не вернуть, поэтому подтверждение — как у чистого старта.
 */
async function final(io: Io, args: string[], admin: number, now: number, api: Telegram): Promise<Reply> {
  const ranked = await ratingNow(io.stores);
  if (!ranked.length) return say('В рейтинге никого: в реестре замков этой эпохи нет игроков.');
  const rows = ranked.map((r) => publicRow(r, ''));
  if (args.length !== 1 || args[0] !== 'ДА') {
    return say([finalText(rows, null), '', `Разослать ${ranked.length} игрокам: /final ДА`].join('\n'));
  }
  const tally = { ok: 0, closed: 0, failed: 0 };
  for (let i = 0; i < ranked.length; i += FINAL_BATCH) {
    await Promise.all(
      ranked.slice(i, i + FINAL_BATCH).map(async (r) => {
        const chat = Number(r.key.slice(3));
        const sent = await api.greet(chat, finalText(rows, publicRow(r, r.key)));
        if (sent === 'ok') tally.ok++;
        else if (sent === 'closed') tally.closed++;
        else tally.failed++;
      }),
    );
  }
  await logAdmin(io.stores, { at: now, by: admin, who: '', what: `Итоговый рейтинг разослан: ${tally.ok} из ${ranked.length}` });
  return say(
    [
      `Итоговый рейтинг разослан: дошло ${tally.ok} из ${ranked.length}.`,
      ...(tally.closed ? [`Бот заблокирован или не запущен: ${tally.closed}.`] : []),
      ...(tally.failed ? [`Не ушло (сеть или Telegram): ${tally.failed}. Повтор /final ДА пришлёт таблицу всем ещё раз.`] : []),
    ].join('\n'),
  );
}

/**
 * Обновление с сообщением. Возвращает `true`, если это было сообщение (ответили админу или промолчали чужому), и
 * `false`, если сообщения в обновлении нет — тогда его разбирает вебхук (кнопки, блокировка бота).
 */
export async function adminCommand(update: Record<string, unknown>, io: Io, tg: () => Telegram, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const msg = update.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object') return false;
  const chat = (msg.chat ?? {}) as Record<string, unknown>;
  const from = userId((msg.from as Record<string, unknown> | undefined)?.id);
  // Только админ и только в личном чате с ботом — раньше любого похода в хранилище. Остальным — тишина.
  if (from === null || chat.type !== 'private' || chat.id !== from || !isAdmin(from, env)) return true;
  const now = io.now;
  if (!allow(`admin:${from}`, PER_MINUTE, now)) return true;

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const [head = '', ...args] = text.split(/\s+/);
  const command = head.toLowerCase().replace(/@\w+$/, '');
  const rest = args.join(' ');
  let reply: Reply;
  switch (command) {
    case '/find':
      reply = await find(io, rest);
      break;
    case '/player':
      reply = await player(io, rest);
      break;
    case '/give':
      reply = await give(io, args, from, now);
      break;
    case '/freeze':
      reply = await freeze(io, args, from, now, true);
      break;
    case '/unfreeze':
      reply = await freeze(io, args, from, now, false);
      break;
    case '/frozen':
      reply = await frozenList(io);
      break;
    case '/gems':
      reply = await gemsOf(io, rest);
      break;
    case '/payments':
      reply = await payments(io);
      break;
    case '/log':
      reply = await adminLog(io, rest);
      break;
    case '/stats':
      reply = await stats(io, now);
      break;
    case '/flags':
      reply = await flags(io);
      break;
    case '/reports':
      reply = await reportsList(io);
      break;
    case '/report':
      reply = await reportOne(io, rest.trim());
      break;
    case '/spawns':
      reply = await spawns(io);
      break;
    case '/wipeworld':
      reply = await wipe(io, args, from, now);
      break;
    case '/final':
      reply = await final(io, args, from, now, tg());
      break;
    default:
      reply = say(HELP);
  }
  const api = tg();
  if ('text' in reply) await api.say(from, reply.text);
  else await api.file(from, reply.file.name, reply.file.content, reply.file.caption);
  return true;
}
