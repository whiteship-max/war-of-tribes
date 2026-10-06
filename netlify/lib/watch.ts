/**
 * Наблюдение за игроком (docs/admin.md): когда пришёл, сколько заходов и времени в игре, последняя опись партии,
 * журнал действий города, который видит сервер, и флаги подозрительного. Хранилище `tribe-watch`, ключ `tg-<id>`.
 *
 * **Сервер партию не разбирает.** Числа — из описи наблюдения (`WatchCard`), которую клиент кладёт рядом с партией.
 * Флаг — сравнение двух соседних описей по правилам игры: рост сверх выработки и обучения, промыслы сверх энергии,
 * добыча сверх потолка, время партии быстрее настоящего, часы устройства не те, записи чаще, чем игра пишет. Флаг —
 * подсказка админу с пояснением «что и насколько», а не приговор: партию он не трогает.
 *
 * Записывают сюда сохранение (заход, запись, отказ «слишком часто»), война (поход), отчёт об ошибке и команды админа
 * (указ, заморозка). Запись наблюдения — попутная: не легла — партия всё равно сохранена, а ответ игроку тот же.
 */
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { SAVE_HURRY_MS, SAVE_PUSH_MS, STOCK_KEYS, readWatch, type Counts, type WatchCard } from './contract.js';
import { DAY_LENGTH, gameDaysOfMs } from '../../src/game/pace.js';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_COST } from '../../src/game/data/minigames.js';
import { RESOURCE_META } from '../../src/game/constants.js';
import { rewrite } from './admin.js';
import { STORES, type Stores } from './kv.js';

/**
 * Перерыв дольше этого — новый заход: игра пишет раз в `SAVE_PUSH_MS`, и три пропущенные записи подряд значат, что
 * игрок ушёл. Время в игре — сумма промежутков между запросами внутри захода.
 */
export const SESSION_GAP_MS = 3 * SAVE_PUSH_MS;

/** Сколько строк журнала и флагов помнит запись игрока. */
export const JOURNAL_KEEP = 150;
export const FLAGS_KEEP = 50;

/** Час — окно отказов «слишком часто» и отчётов об ошибках. */
const HOUR = 3600_000;

/**
 * Отказов «слишком часто» за час, с которых это флаг. Игра пишет не чаще раза в `SAVE_HURRY_MS`, а сервер
 * отказывает чаще раза в 4 с; честный клиент упирается в отказ только перезапуском сразу после записи — изредка.
 */
export const OFTEN_PER_HOUR = 3;

/**
 * Во сколько раз рост может обогнать выработку и обучение, прежде чем это флаг. Выработка меняется между двумя
 * описями (мораль, сезон, достроенное здание), а опись видит её только на концах промежутка: двойной запас
 * покрывает это изменение, а правка сохранения обгоняет его на порядки.
 */
export const GROWTH_SLACK = 2;

/** Тот же флаг второй раз за этот срок не дописывается, а считается в прежний: запись идёт раз в минуту. */
const FLAG_QUIET = HOUR;

export type FlagKind = 'cheat' | 'haste' | 'clock' | 'cap' | 'time' | 'stock' | 'army' | 'games' | 'haul' | 'often' | 'rollback';

export const FLAG_WORD: Record<FlagKind, string> = {
  cheat: 'коды проверки',
  haste: 'скорость проверки',
  clock: 'часы устройства',
  cap: 'сверх склада',
  time: 'время партии',
  stock: 'рост склада',
  army: 'рост войска',
  games: 'частые промыслы',
  haul: 'добыча промыслов',
  often: 'частые записи',
  rollback: 'откат партии',
};

export interface WatchFlag {
  at: number;
  kind: FlagKind;
  text: string;
  /** Сколько раз повторился за `FLAG_QUIET`. */
  n: number;
}

export type EntryKind = 'visit' | 'save' | 'deed' | 'game' | 'war' | 'report' | 'grant' | 'freeze' | 'flag';

export interface WatchEntry {
  at: number;
  kind: EntryKind;
  text: string;
}

export interface WatchRecord {
  v: 1;
  /** Когда сервер впервые увидел игрока. */
  first: number;
  /** Последний запрос сохранения. */
  last: number;
  visits: number;
  /** Время в игре, мс. */
  played: number;
  /** Принятых записей партии. */
  writes: number;
  /** Имя пользователя Telegram — из подписи. */
  user: string;
  /** Вождь, мощь и игровой день — из описи партии (`SaveCard`). */
  name: string;
  power: number;
  day: number;
  /** Последняя опись наблюдения и когда она пришла. */
  card?: WatchCard;
  cardAt: number;
  /** Походов на игроков. */
  wars: number;
  /** Отказов «слишком часто» за последний час — их минуты. */
  fast: number[];
  /** Отчётов об ошибках за последний час — их минуты. */
  reports: number[];
  flags: WatchFlag[];
  journal: WatchEntry[];
}

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const s0 = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const times = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number').slice(-50) : []);

export const blankWatch = (): WatchRecord => ({
  v: 1,
  first: 0,
  last: 0,
  visits: 0,
  played: 0,
  writes: 0,
  user: '',
  name: '',
  power: 0,
  day: 0,
  cardAt: 0,
  wars: 0,
  fast: [],
  reports: [],
  flags: [],
  journal: [],
});

const FLAG_KINDS = Object.keys(FLAG_WORD) as FlagKind[];
const ENTRY_KINDS: readonly EntryKind[] = ['visit', 'save', 'deed', 'game', 'war', 'report', 'grant', 'freeze', 'flag'];

export function readWatchRecord(v: unknown): WatchRecord {
  const out = blankWatch();
  if (!v || typeof v !== 'object') return out;
  const r = v as Record<string, unknown>;
  out.first = n0(r.first);
  out.last = n0(r.last);
  out.visits = n0(r.visits);
  out.played = n0(r.played);
  out.writes = n0(r.writes);
  out.user = s0(r.user, 32);
  out.name = s0(r.name, 64);
  out.power = n0(r.power);
  out.day = n0(r.day);
  const card = readWatch(r.card);
  if (card) out.card = card;
  out.cardAt = n0(r.cardAt);
  out.wars = n0(r.wars);
  out.fast = times(r.fast);
  out.reports = times(r.reports);
  if (Array.isArray(r.flags)) {
    for (const f of r.flags as Record<string, unknown>[]) {
      if (f && FLAG_KINDS.includes(f.kind as FlagKind)) out.flags.push({ at: n0(f.at), kind: f.kind as FlagKind, text: s0(f.text, 400), n: Math.max(1, n0(f.n)) });
    }
    out.flags = out.flags.slice(-FLAGS_KEEP);
  }
  if (Array.isArray(r.journal)) {
    for (const e of r.journal as Record<string, unknown>[]) {
      if (e && ENTRY_KINDS.includes(e.kind as EntryKind)) out.journal.push({ at: n0(e.at), kind: e.kind as EntryKind, text: s0(e.text, 400) });
    }
    out.journal = out.journal.slice(-JOURNAL_KEEP);
  }
  return out;
}

// ------------------------------------------------ слова ---

/** Число с пробелами между разрядами: 12 345. */
export const big = (n: number): string => {
  const sign = n < 0 ? '−' : '';
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

/** Со знаком: +12 345 или −40. */
export const signed = (n: number): string => (n > 0 ? `+${big(n)}` : big(n));

/** Срок словами: «40 с», «12 мин», «3 ч 20 мин», «2 дн. 4 ч» (настоящее время). */
export function span(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} с`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} ч ${min % 60} мин` : `${h} ч`;
  return `${Math.floor(h / 24)} дн. ${h % 24} ч`;
}

/** Игровые дни словами: «0,3 игр. дн.». */
const gameDays = (d: number): string => `${(Math.round(d * 10) / 10).toString().replace('.', ',')} игр. дн.`;

/** Имя вида склада для админа — именем игры (`RESOURCE_META`); золота там нет — оно в казне. */
export const stockWord = (k: string): string => (RESOURCE_META as Record<string, { name: string } | undefined>)[k]?.name.toLowerCase() ?? 'золото';

const total = (c: Counts): number => Object.values(c).reduce((t, x) => t + x, 0);

const upper = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

// ------------------------------------------------ флаги ---

/** Флаги одной описи: то, что видно и без соседней. */
export function flagsOf(card: WatchCard, at: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  if (card.cheated) out.push({ kind: 'cheat', text: 'Партия помечена кодами проверки: ими пользовались хотя бы раз.' });
  if (card.lead > 0) out.push({ kind: 'haste', text: `Партию ускоряли скоростью проверки: её часы впереди настоящих на ${span(card.lead)}.` });
  // Сверх вместимости склада игра не кладёт ничего: ни выработка, ни добыча, ни возврат цены, ни указ (`sim/pay`).
  for (const k of STOCK_KEYS) {
    if (!(k in RESOURCE_META)) continue;
    const have = card.stock[k] ?? 0;
    if (card.cap > 0 && have > card.cap + 1) {
      out.push({ kind: 'cap', text: `${upper(stockWord(k))} ${big(have)} при вместимости склада ${big(card.cap)} — сверх склада игра не кладёт ничего (или склад потерял уровень).` });
    }
  }
  const skew = card.clock > 0 ? card.clock - at : 0;
  if (Math.abs(skew) > CLOCK_SKEW_SECONDS * 1000) {
    out.push({ kind: 'clock', text: `Часы устройства ${skew > 0 ? 'спешат' : 'отстают'} на ${span(Math.abs(skew))} (терпим до ${span(CLOCK_SKEW_SECONDS * 1000)}).` });
  }
  return out;
}

/**
 * Флаги промежутка между двумя описями: что выросло сильнее, чем позволяют правила игры за прошедшее время.
 *
 * Рост склада и войска сверяется, только если между описями не было ни одного разового дела (событие, бой, логово,
 * набег, покупка, ежедневка, промысел, указ админа), никто не ушёл и не вернулся из похода и не пришёл караван: дело
 * может разом принести добро, и тогда рост объяснён. Без дел склад растёт только выработкой, а войско — обучением в
 * казармах и конюшне.
 */
export function flagsBetween(a: WatchCard, aAt: number, b: WatchCard, bAt: number): { kind: FlagKind; text: string }[] {
  const out: { kind: FlagKind; text: string }[] = [];
  const realMs = Math.max(0, bAt - aAt);
  const leadMs = Math.max(0, b.lead - a.lead);
  // Сколько игровых дней могло пройти: настоящее время, опережение под скоростью проверки и допуск на часы.
  const canDays = gameDaysOfMs(realMs + leadMs + CLOCK_SKEW_SECONDS * 1000);
  const wentDays = (b.time - a.time) / DAY_LENGTH;
  if (wentDays > canDays) {
    out.push({ kind: 'time', text: `Время партии ушло на ${gameDays(wentDays)} за ${span(realMs)} настоящего — могло не больше ${gameDays(canDays)}.` });
  }
  if (b.deeds < a.deeds) {
    out.push({ kind: 'rollback', text: `Партия откатилась назад: разовых дел было ${big(a.deeds)}, стало ${big(b.deeds)} (другое устройство, восстановленная копия или правка сохранения).` });
  }
  const days = Math.max(0, Math.min(wentDays, canDays));
  const quiet = a.deeds === b.deeds && a.seen === b.seen && a.games === b.games && a.away === b.away && a.caravans === b.caravans;
  if (quiet) {
    for (const k of STOCK_KEYS) {
      const grew = (b.stock[k] ?? 0) - (a.stock[k] ?? 0);
      const could = Math.max(a.prod[k] ?? 0, b.prod[k] ?? 0) * days * GROWTH_SLACK + 1;
      if (grew > could) {
        out.push({ kind: 'stock', text: `${upper(stockWord(k))} ${signed(grew)} за ${span(realMs)} без разовых дел; выработка позволяла не больше ${big(could)}.` });
      }
    }
    const grew = total(b.troops) + b.wounded - (total(a.troops) + a.wounded);
    const could = Math.max(a.train, b.train) * days * GROWTH_SLACK + 1;
    if (grew > could) {
      out.push({ kind: 'army', text: `Войско ${signed(grew)} за ${span(realMs)} без разовых дел; казармы и конюшня выучили бы не больше ${big(could)}.` });
    }
  }
  const played = b.games - a.games;
  if (played > 0) {
    // Энергия: полный запас и приток за прошедшее время партии; игра стоит `MINIGAME_COST`.
    const can = Math.floor((ENERGY_MAX + ((realMs + leadMs) / ENERGY_REFILL) * ENERGY_MAX) / MINIGAME_COST);
    if (played > can) out.push({ kind: 'games', text: `Промыслов ${signed(played)} за ${span(realMs)}; энергии хватало не больше чем на ${big(can)}.` });
    const cap = Math.max(a.haulCap, b.haulCap);
    const got = b.haul - a.haul;
    if (got > cap * played + played) {
      out.push({ kind: 'haul', text: `Добыча промыслов ${signed(got)} за ${big(played)} игр; потолок — ${big(cap)} за игру.` });
    }
  }
  return out;
}

/** Положить флаги в запись: тот же вид за последний час не дописывается, а считается в прежний. */
export function addFlags(rec: WatchRecord, at: number, found: { kind: FlagKind; text: string }[]): WatchRecord {
  const flags = [...rec.flags];
  const journal = [...rec.journal];
  for (const f of found) {
    const prev = [...flags].reverse().find((x) => x.kind === f.kind);
    if (prev && at - prev.at < FLAG_QUIET) {
      flags[flags.indexOf(prev)] = { ...prev, at, text: f.text, n: prev.n + 1 };
      continue;
    }
    flags.push({ at, kind: f.kind, text: f.text, n: 1 });
    journal.push({ at, kind: 'flag', text: `Флаг «${FLAG_WORD[f.kind]}»: ${f.text}` });
  }
  return { ...rec, flags: flags.slice(-FLAGS_KEEP), journal: journal.slice(-JOURNAL_KEEP) };
}

// ------------------------------------------------ события ---

/** Запрос сохранения с подписью: заход, время в игре, имя пользователя. */
export function touched(rec: WatchRecord, at: number, user?: string): WatchRecord {
  const next = { ...rec, journal: [...rec.journal] };
  if (!next.first) next.first = at;
  const gap = rec.last ? at - rec.last : Infinity;
  if (gap > SESSION_GAP_MS) {
    next.visits += 1;
    next.journal.push({ at, kind: 'visit', text: rec.last ? `Заход (перерыв ${span(gap)}).` : 'Первый заход.' });
  } else if (gap > 0) {
    next.played += gap;
  }
  next.last = Math.max(rec.last, at);
  if (user) next.user = user;
  next.journal = next.journal.slice(-JOURNAL_KEEP);
  return next;
}

/** Строка журнала. */
export const noted = (rec: WatchRecord, at: number, kind: EntryKind, text: string): WatchRecord => ({
  ...rec,
  journal: [...rec.journal, { at, kind, text }].slice(-JOURNAL_KEEP),
});

/** Что прибавилось из разовых дел между двумя описями — строкой журнала, или пусто. */
function deedsText(a: WatchCard, b: WatchCard): string {
  const parts: string[] = [];
  const add = (word: string, d: number): void => {
    if (d > 0) parts.push(`${word} +${big(d)}`);
  };
  add('побед', b.won - a.won);
  add('поражений', b.lost - a.lost);
  add('логов сожжено', b.lairs - a.lairs);
  add('набегов', b.raids - a.raids);
  const other = b.deeds - a.deeds - (b.won - a.won) - (b.lost - a.lost) - (b.lairs - a.lairs) - (b.raids - a.raids) - (b.games - a.games) - (b.seen - a.seen);
  add('других дел', other);
  return parts.join(', ');
}

/**
 * Принятая запись партии: опись, флаги и журнал. Журнал не пишет строку на каждую запись — их сотни за вечер:
 * записи одного захода сводятся в одну строку, отдельно — разовые дела и промыслы.
 */
export function wrote(rec: WatchRecord, at: number, card: { name: string; power: number; day: number }, watch: WatchCard | undefined, rev: number): WatchRecord {
  let next: WatchRecord = { ...rec, writes: rec.writes + 1, name: card.name, power: card.power, day: card.day };
  if (watch) {
    const found = flagsOf(watch, at);
    const prev = rec.card;
    if (prev) {
      found.push(...flagsBetween(prev, rec.cardAt, watch, at));
      const deeds = deedsText(prev, watch);
      if (deeds) next = noted(next, at, 'deed', `Дела: ${deeds}.`);
      if (watch.games > prev.games) next = noted(next, at, 'game', `Промыслы: ${signed(watch.games - prev.games)}, добыча ${signed(watch.haul - prev.haul)}.`);
    }
    next = { ...next, card: watch, cardAt: at };
    // Флаги одной описи не повторяются в журнале каждую минуту: `addFlags` считает их в прежний.
    next = addFlags(next, at, found);
  }
  const last = next.journal[next.journal.length - 1];
  const line = `Записи партии: последняя №${rev}, игровой день ${card.day}.`;
  if (last && last.kind === 'save' && at - last.at <= SESSION_GAP_MS) {
    const journal = [...next.journal];
    journal[journal.length - 1] = { at, kind: 'save', text: line };
    return { ...next, journal };
  }
  return noted(next, at, 'save', line);
}

/** Отказ «слишком часто»: минута в окно часа; с `OFTEN_PER_HOUR` в окне — флаг. */
export function tooFast(rec: WatchRecord, at: number): WatchRecord {
  const fast = [...rec.fast.filter((t) => at - t < HOUR), at];
  const next = { ...rec, fast };
  if (fast.length < OFTEN_PER_HOUR) return next;
  return addFlags(next, at, [
    { kind: 'often', text: `Записи чаще, чем пишет игра: ${fast.length} отказов «слишком часто» за час; игра пишет не чаще раза в ${span(SAVE_HURRY_MS)}.` },
  ]);
}

/** Отчётов об ошибках за последний час. */
export const reportsInHour = (rec: WatchRecord, at: number): number => rec.reports.filter((t) => at - t < HOUR).length;

export const reported = (rec: WatchRecord, at: number, id: string, text: string): WatchRecord =>
  noted({ ...rec, reports: [...rec.reports.filter((t) => at - t < HOUR), at] }, at, 'report', `Отчёт об ошибке ${id}: ${text.slice(0, 80)}`);

/**
 * Поправить запись наблюдения игрока; `null` из `change` — не писать. Попутно: не легла или хранилище ответило
 * ошибкой — молчим, потому что наблюдение не имеет права уронить запрос игрока, ради которого он пришёл.
 */
export async function observe(stores: Stores, player: string, change: (cur: WatchRecord) => WatchRecord | null): Promise<void> {
  try {
    await rewrite(stores(STORES.watch, 'strong'), player, readWatchRecord, change);
  } catch {
    /* наблюдение попутное */
  }
}
