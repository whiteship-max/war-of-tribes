/**
 * Проход доставки: вся цепочка от метки индекса до сообщения в Telegram (docs/NOTIFY.md, разделы 3, 12 и 13). Один и
 * тот же на Netlify (функция по расписанию `functions/deliver.mts`) и на своём сервере (`vps/schedule.ts`), и
 * включается одним флагом — `TRIBE_DELIVER=on` (`http.deliverOn`).
 *
 * Шагов два:
 *
 * 1. **ход войны между игроками** (`warTick`): бой назначен минутой прихода, а тика у войны нет — она разбирается
 *    при обращении любой из сторон. Если обе стороны не в игре, бой разбирает этот проход, и новости о нём
 *    (`war.newsOf`) ложатся в исходящие обеих сторон (`outbox.queueNews`) — так «бой был» доходит, пока все спят;
 * 2. **отправка**: метки созревших минут → запись исходящих → правила (`notify.plan`: важность, склейка, тихий час)
 *    → письма взяты в очередь записи условно (`notify.claim`) → адаптер (`telegram.ts`) → итоги поверх свежей записи
 *    (`notify.settle`) → метка на минуту, когда на игрока надо посмотреть снова (окно склейки, конец тихого часа,
 *    повтор письма).
 *
 * **Очередь без потерь (ВС-1).** Письмо лежит в записи от минуты, когда проход его взял, до ответа Telegram, и метка
 * на конец его аренды ставится до отправки: упади процесс между ними — следующий проход найдёт письмо с истёкшей
 * арендой и отправит его. Обратная сторона названа: упадёт процесс после ответа Telegram, но до записи итога —
 * письмо уйдёт второй раз. Повтор выбран вместо потери.
 *
 * **Лимиты Telegram.** Между вызовами — не меньше `SEND_GAP_MS` (≈25 в секунду при потолке около 30), между двумя
 * сообщениями одному игроку — не меньше `CHAT_GAP_MS`; 429 с `retry_after` останавливает отправку прохода целиком,
 * взятые письма возвращаются в очередь, а просивший подождать — ждёт ровно столько.
 *
 * Хранилище передаётся снаружи узкими дверями, а не импортируется: так проход проверяется тестом на памяти,
 * вместе с проигранной условной записью, — ровно тем, чего на живой выкладке не воспроизвести (`notify.test.ts`).
 *
 * Счётчики — единственный способ узнать, работает ли доставка, в системе без журналов. Пишутся они записью на
 * каждый проход, а не одним накопленным числом: копить значит читать и разбирать своё же хранилище. Отметка
 * прохода в имени записи и есть проверка расписания. Ключей игроков в счётчиках нет ни одного.
 */
import { claim, expire, LEASE_MS, minuteOf, outWake, plan, PLAYER_KEY, readNotify, settle, type Letter, type NotifyRecord, type Outcome, type Verdict } from './notify.js';
import { parseJson, warPace, WRITE_TRIES } from './http.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { advance, dueKeys, newsDiff, newsMap, readStoredSheet, readWars, setWarPace, WARS_KEY, type SheetAt } from './war.js';
import { queueNews } from './outbox.js';
import { frozenIn, isFrozen } from './admin.js';
import { letterText } from './words.js';
import type { Sent, Telegram } from './telegram.js';

export interface PassIo {
  /** Записи исходящих по ключу игрока. */
  notify: Kv;
  /** Индекс по минутам: пустые метки `<минута>/<ключ игрока>`. */
  due: Kv;
  /** Счётчики проходов. */
  stats: Kv;
  /** Запись войн (рядом с реестром) — ход войны между игроками. */
  world: Kv;
  /** Партии — **только чтение**: слепок обороны защитника для боя войны (`war.readStoredSheet`). */
  saves: Kv;
  /** Админка — **только чтение**: замороженный город для войны закрыт (docs/admin.md). Нет — никто не заморожен. */
  admin?: Kv;
  /** Адаптер Telegram. Нет — проход считает «ушло бы», не отправляя (тесты, проба). */
  tg: Telegram | null;
  /** Пауза между вызовами Telegram. Нет — настоящий таймер; тесты ждут мгновенно. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Двери прохода из хранилищ дома: одни и те же на Netlify (`functions/deliver.mts`) и на своём сервере
 * (`vps/schedule.ts`). Какие хранилища трогает доставка, сказано здесь, а не в каждом доме.
 */
export const passIoOf = (stores: Stores, tg: Telegram | null): PassIo => ({
  notify: stores(STORES.notify),
  due: stores(STORES.due),
  stats: stores(STORES.stats),
  world: stores(STORES.world, 'strong'),
  saves: stores(STORES.saves, 'strong'),
  admin: stores(STORES.admin, 'strong'),
  tg,
});

/** Итог прохода. Ни одного ключа игрока. */
export interface PassTally {
  at: number;
  tookMs: number;
  /** Сколько меток с минутой не позже нынешней разобрано. */
  marks: number;
  /** Пунктов, которым пора (`fireAt ≤ now`) и которые ещё ждут решения. */
  matured: number;
  /** Новых сообщений ушло: доставлено Telegram, или «ушло бы» без адаптера. */
  wouldSend: number;
  /** Писем поправлено: весть легла в свежее письмо своего рода. */
  edited: number;
  /** Telegram отказал (403): канал игрока закрыт. */
  closed: number;
  /** Не ушло и вернулось в очередь: Telegram просил подождать или не ответил. */
  retried: number;
  /** Письмо потеряно: прочие отказы Telegram или все попытки кончились. */
  lost: number;
  /** Новостей войны между игроками, положенных этим проходом в исходящие сторон (`war.newsOf`). */
  wars: number;
  /** Письма взять не вышло: запись перебил другой (приём, вебхук, второй проход) — следующим проходом. */
  lostRace: number;
  /** Не ушло — и почему. */
  dropped: Partial<Record<Exclude<Verdict, 'send' | 'early'>, number>>;
  /** Метки, за которыми не нашлось ни годного пункта, ни письма в очереди: список уже заменён. */
  staleMarks: number;
  /** Telegram просил подождать всех (429): отправка прохода остановлена. */
  paused: boolean;
  /** Проход упёрся в срок и не разобрал всё. */
  truncated: boolean;
}

/** Сколько проход имеет права идти. Срок функции по расписанию — 30 секунд. */
export const PASS_BUDGET_MS = 20_000;

/** Между двумя вызовами Telegram в проходе. Потолок Telegram — около 30 сообщений в секунду на бота. */
export const SEND_GAP_MS = 40;

/** Между двумя сообщениями одному игроку в проходе. Telegram держит около одного в секунду на чат. */
export const CHAT_GAP_MS = 1_100;

/** Сколько дней лежат счётчики проходов. */
export const STATS_KEEP_DAYS = 14;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Темп отправки прохода: общий зазор, зазор по чату и стоп после 429. */
interface Gate {
  paused: boolean;
  before(chat: number): Promise<void>;
}

function gateOf(wait: (ms: number) => Promise<void>, clock: () => number): Gate {
  let last = Number.NEGATIVE_INFINITY;
  const chats = new Map<number, number>();
  return {
    paused: false,
    async before(chat) {
      const t = clock();
      const need = Math.max(0, last + SEND_GAP_MS - t, (chats.get(chat) ?? Number.NEGATIVE_INFINITY) + CHAT_GAP_MS - t);
      if (need > 0) await wait(need);
      last = Math.max(clock(), t + need);
      chats.set(chat, last);
    },
  };
}

/**
 * Один проход. `clock` — часы для срока прохода и пауз; «сейчас» правил — `now`, одно на весь
 * проход, чтобы два игрока одной минуты судились одними часами.
 */
export async function deliverPass(io: PassIo, now: number, clock: () => number = () => now): Promise<PassTally> {
  const started = clock();
  const tally: PassTally = {
    at: now,
    tookMs: 0,
    marks: 0,
    matured: 0,
    wouldSend: 0,
    edited: 0,
    closed: 0,
    retried: 0,
    lost: 0,
    wars: 0,
    lostRace: 0,
    dropped: {},
    staleMarks: 0,
    paused: false,
    truncated: false,
  };
  tally.wars = await warTick(io, now);
  const nowMinute = minuteOf(now);
  const minutes = (await io.due.list({ directories: true })).directories.filter((d) => d <= nowMinute).sort();

  // Метки собираются по игроку: у одного игрока их может быть несколько минут, а запись
  // исходящих читается один раз на проход.
  const byPlayer = new Map<string, string[]>();
  for (const minute of minutes) {
    if (clock() - started > PASS_BUDGET_MS) {
      tally.truncated = true;
      break;
    }
    const { blobs } = await io.due.list({ prefix: `${minute}/` });
    for (const blob of blobs) {
      tally.marks++;
      const player = blob.key.slice(minute.length + 1);
      // Ключ игрока — только из метки и только такого вида: иначе метка стала бы дверью к
      // чужой записи.
      if (!PLAYER_KEY.test(player)) {
        await io.due.delete(blob.key);
        continue;
      }
      byPlayer.set(player, [...(byPlayer.get(player) ?? []), minute]);
    }
  }

  const gate = gateOf(io.wait ?? sleep, clock);
  for (const [player, marks] of byPlayer) {
    if (clock() - started > PASS_BUDGET_MS) {
      tally.truncated = true;
      break;
    }
    const keep = await deliverOne(io, player, marks, now, tally, gate);
    for (const minute of marks) if (!keep.has(minute)) await io.due.delete(`${minute}/${player}`);
  }

  tally.paused = gate.paused;
  tally.tookMs = clock() - started;
  await writeTally(io.stats, tally);
  return tally;
}

/** Итог адаптера — в итог письма. */
const outcomeOf = (id: string, sent: Sent): Outcome =>
  sent.result === 'ok'
    ? { id, result: 'ok', ...(sent.msg !== undefined ? { msg: sent.msg } : {}) }
    : sent.result === 'retry'
      ? { id, result: 'retry', ...(sent.after !== undefined ? { after: sent.after } : {}) }
      : { id, result: sent.result };

/** Разобрать метки одного игрока. Возвращает минуты, метки которых надо оставить. */
async function deliverOne(io: PassIo, player: string, marks: string[], now: number, tally: PassTally, gate: Gate): Promise<Set<string>> {
  const found = await io.notify.getWithMetadata(player);
  const stored = readNotify(found ? parseJson(String(found.data)) : null);
  const { record: rec, lost } = expire(stored, now);
  tally.lost += lost;
  const p = plan(rec, now);
  if (p.verdicts.every((v) => v.verdict === 'expired' || v.verdict === 'sent' || v.verdict === 'early') && rec.out.length === 0) tally.staleMarks++;
  for (const v of p.verdicts) {
    if (v.verdict === 'early') continue;
    // Ушедшее и просроченное считаются один раз — проходом своей минуты, а не каждым, кто смотрит на игрока.
    if ((v.verdict === 'sent' || v.verdict === 'expired') && !marks.includes(minuteOf(v.item.fireAt))) continue;
    tally.matured++;
    if (v.verdict !== 'send') tally.dropped[v.verdict] = (tally.dropped[v.verdict] ?? 0) + 1;
  }

  // Telegram просил подождать всех — проход новых писем не берёт: метки остаются, письма — следующим проходом.
  if (gate.paused && (p.letters.length > 0 || rec.out.length > 0)) return new Set(marks);
  const { record: claimed, taken } = claim(rec, p.letters, now);
  let final: NotifyRecord = claimed;
  // Писать есть что: взятые письма или очередь, из которой что-то выбыло само (`expire`).
  if ((taken.length > 0 || rec !== stored) && found?.etag) {
    // Сперва письма в очередь, потом отправка — и запись условная. Два наложившихся прохода или повтор вызова
    // платформой не отправят дважды: второй проиграет запись.
    const written = await io.notify.setJSON(player, claimed, { onlyIfMatch: found.etag });
    if (!written.modified) {
      tally.lostRace++;
      return new Set(marks);
    }
    if (taken.length > 0) {
      // Метка на конец аренды — до отправки: упадёт процесс, не дождавшись Telegram, — следующий проход найдёт письмо.
      const lease = `${minuteOf(now + LEASE_MS)}/${player}`;
      await io.due.set(lease, '1');
      final = await settleWrite(io, player, await send(io, player, taken, rec, tally, gate), now, claimed);
      // Итог записан и очередь пуста — метка аренды больше не нужна.
      if (final.out.length === 0) await io.due.delete(lease);
    }
  }

  const next = [plan(final, now).wake, outWake(final, now)].filter((x): x is number => x !== null);
  // Пункт, которому ещё рано, а минута его метки уже наступила (созреет через секунды), держит свою метку.
  const keep = new Set(p.verdicts.filter((v) => v.verdict === 'early').map((v) => minuteOf(v.item.fireAt)).filter((m) => marks.includes(m)));
  if (next.length) {
    const minute = minuteOf(Math.max(now, Math.min(...next)));
    keep.add(minute);
    await io.due.set(`${minute}/${player}`, '1');
  }
  return keep;
}

/** Отправить взятые письма. Отказ канала обрывает остальные — им тот же отказ. */
async function send(io: PassIo, player: string, taken: Letter[], rec: NotifyRecord, tally: PassTally, gate: Gate): Promise<Outcome[]> {
  const chat = Number(player.slice(3));
  const out: Outcome[] = [];
  for (const l of taken) {
    if (gate.paused || out.some((o) => o.result === 'closed')) {
      out.push({ id: l.id, result: 'later' });
      continue;
    }
    let sent: Sent = { result: 'ok' };
    if (io.tg) {
      await gate.before(chat);
      const text = letterText(l, rec.prefs.tz);
      sent = l.mode === 'edit' && l.msg !== undefined ? await io.tg.edit(chat, l.msg, text) : await io.tg.letter(chat, text, l.silent);
    }
    const o = outcomeOf(l.id, sent);
    out.push(o);
    if (o.result === 'ok') {
      if (l.mode === 'edit') tally.edited++;
      else tally.wouldSend++;
    } else if (o.result === 'closed') tally.closed++;
    else if (o.result === 'lost') tally.lost++;
    else if (o.result === 'retry' || o.result === 'gone') tally.retried++;
    // 429 с `retry_after` — потолок бота, а не чата: дальше в этом проходе не пишем никому.
    if (o.result === 'retry' && o.after !== undefined) gate.paused = true;
  }
  return out;
}

/**
 * Итоги — поверх свежей записи: между отметкой и ответом Telegram её мог переписать приём клиента или вебхук.
 * Не записалось ни разу — письма остаются в очереди с арендой и уйдут снова, когда она кончится.
 */
async function settleWrite(io: PassIo, player: string, outcomes: Outcome[], now: number, fallback: NotifyRecord): Promise<NotifyRecord> {
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await io.notify.getWithMetadata(player);
    const rec = readNotify(found ? parseJson(String(found.data)) : null);
    if (!found?.etag) return fallback;
    const next = settle(rec, outcomes, now);
    const written = await io.notify.setJSON(player, next, { onlyIfMatch: found.etag });
    if (written.modified) return next;
  }
  return fallback;
}

/**
 * Ход войны между игроками к минуте `now`: тот же `war.advance`, что у обработчика `/api/war`, по тем же слепкам
 * обороны. Записывает ход условно; проиграл гонку — ход записал другой, и новости положил он. Возвращает, сколько
 * новостей положено.
 */
async function warTick(io: PassIo, now: number): Promise<number> {
  const found = await io.world.getWithMetadata(WARS_KEY);
  if (!found?.etag) return 0;
  const file = readWars(found ? parseJson(String(found.data)) : null);
  const due = dueKeys(file, now);
  if (due.length === 0) return 0;
  const before = newsMap(file);
  const sheets = new Map<string, SheetAt | null>();
  const frozen = io.admin ? await frozenIn(io.admin) : null;
  for (const player of due) {
    // Замороженного города для войны нет — тем же правилом, что у обработчика `/api/war`.
    if (frozen && isFrozen(frozen, player)) {
      sheets.set(player, null);
      continue;
    }
    const save = await io.saves.getWithMetadata(player);
    sheets.set(player, readStoredSheet(save ? parseJson(String(save.data)) : null));
  }
  setWarPace(warPace());
  if (!advance(file, now, sheets)) return 0;
  const written = await io.world.setJSON(WARS_KEY, file, { onlyIfMatch: found.etag });
  if (!written.modified) return 0;
  const diff = newsDiff(before, newsMap(file));
  await queueNews(io, diff, now);
  return [...diff.values()].reduce((n, d) => n + d.add.length, 0);
}

/** Счётчик прохода — своей записью, без чтения прежних. Старые дни снимаются. */
async function writeTally(stats: Kv, tally: PassTally): Promise<void> {
  const iso = new Date(tally.at).toISOString();
  const day = iso.slice(0, 10);
  const key = `${day}/${iso.slice(11, 23)}`;
  const put = await stats.setJSON(key, tally, { onlyIfNew: true });
  // Два прохода в одну миллисекунду — второй ложится рядом, а не поверх.
  if (!put.modified) await stats.setJSON(`${key}-2`, tally, { onlyIfNew: true });

  const oldest = new Date(tally.at - STATS_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const days = (await stats.list({ directories: true })).directories.filter((d) => d < oldest).sort();
  if (days.length === 0) return;
  const { blobs } = await stats.list({ prefix: `${days[0]}/` });
  for (const b of blobs.slice(0, 200)) await stats.delete(b.key);
}
