/**
 * Проход доставки: вся цепочка от метки индекса до сообщения в Telegram (docs/NOTIFY.md, разделы 3 и 12). Один и
 * тот же на Netlify (функция по расписанию `functions/deliver.mts`) и на своём сервере (`vps/schedule.ts`), и
 * включается одним флагом — `TRIBE_DELIVER=on` (`http.deliverOn`).
 *
 * Шагов два:
 *
 * 1. **ход войны между игроками** (`warTick`): бой назначен минутой прихода, а тика у войны нет — она разбирается
 *    при обращении любой из сторон. Если обе стороны не в игре, бой разбирает этот проход, и новости о нём
 *    (`war.newsOf`) ложатся в исходящие обеих сторон (`outbox.queueNews`) — так «бой был» доходит, пока все спят;
 * 2. **отправка**: метки созревших минут → запись исходящих → правила (`notify.choose`) → условная отметка «ушло»
 *    → адаптер (`telegram.ts`).
 *
 * Хранилище передаётся снаружи узкими дверями, а не импортируется: так проход проверяется тестом на памяти,
 * вместе с проигранной условной записью, — ровно тем, чего на живой выкладке не воспроизвести (`notify.test.ts`).
 *
 * Счётчики — единственный способ узнать, работает ли доставка, в системе без журналов. Пишутся они записью на
 * каждый проход, а не одним накопленным числом: копить значит читать и разбирать своё же хранилище. Отметка
 * прохода в имени записи и есть проверка расписания. Ключей игроков в счётчиках нет ни одного.
 */
import { choose, closeChannel, markDone, markSent, minuteOf, PLAYER_KEY, readNotify, type NotifyRecord, type Verdict } from './notify.js';
import { parseJson, warPace } from './http.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { advance, dueKeys, newsDiff, newsMap, readStoredSheet, readWars, setWarPace, WARS_KEY, type SheetAt } from './war.js';
import { queueNews } from './outbox.js';
import { noticeText } from './words.js';
import type { Telegram } from './telegram.js';

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
  /** Адаптер Telegram. Нет — проход считает «ушло бы», не отправляя (тесты, проба). */
  tg: Telegram | null;
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
  tg,
});

/** Итог прохода. Ни одного ключа игрока. */
export interface PassTally {
  at: number;
  tookMs: number;
  /** Сколько меток с минутой не позже нынешней разобрано. */
  marks: number;
  /** Пунктов, которым пора (`fireAt ≤ now`). */
  matured: number;
  /** Ушло: доставлено Telegram, или «ушло бы» без адаптера. */
  wouldSend: number;
  /** Telegram отказал (403): канал игрока закрыт. */
  closed: number;
  /** Не ушло и вернулось в очередь: Telegram просил подождать или не ответил. */
  retried: number;
  /** Отметка «ушло» стоит, а сообщение потеряно: прочие отказы Telegram. */
  lost: number;
  /** Новостей войны между игроками, положенных этим проходом в исходящие сторон (`war.newsOf`). */
  wars: number;
  /** Отметку «ушло» перебила чужая запись: не ушло и не уйдёт этим проходом. */
  lostRace: number;
  /** Не ушло — и почему. */
  dropped: Partial<Record<Exclude<Verdict, 'send' | 'early'>, number>>;
  /** Метки, за которыми не нашлось годного пункта: список уже заменён. */
  staleMarks: number;
  /** Проход упёрся в срок и не разобрал всё. */
  truncated: boolean;
}

/** Сколько проход имеет права идти. Срок функции по расписанию — 30 секунд. */
export const PASS_BUDGET_MS = 20_000;

/** Сколько дней лежат счётчики проходов. */
export const STATS_KEEP_DAYS = 14;

/**
 * Один проход. `clock` — часы для срока прохода; «сейчас» правил — `now`, одно на весь
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
    closed: 0,
    retried: 0,
    lost: 0,
    wars: 0,
    lostRace: 0,
    dropped: {},
    staleMarks: 0,
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

  for (const [player, marks] of byPlayer) {
    if (clock() - started > PASS_BUDGET_MS) {
      tally.truncated = true;
      break;
    }
    const done = await deliverOne(io, player, marks, now, tally);
    for (const minute of done) await io.due.delete(`${minute}/${player}`);
  }

  tally.tookMs = clock() - started;
  await writeTally(io.stats, tally);
  return tally;
}

/** Разобрать метки одного игрока. Возвращает минуты, метки которых можно снять. */
async function deliverOne(io: PassIo, player: string, marks: string[], now: number, tally: PassTally): Promise<string[]> {
  const found = await io.notify.getWithMetadata(player);
  const rec = readNotify(found ? parseJson(String(found.data)) : null);
  const choice = choose(rec, now);
  for (const minute of marks) {
    if (!choice.verdicts.some((v) => minuteOf(v.item.fireAt) === minute)) tally.staleMarks++;
  }
  // Считаются только пункты разбираемых меток: снятая метка своё уже отсчитала.
  for (const v of choice.verdicts) {
    if (v.verdict === 'early' || !marks.includes(minuteOf(v.item.fireAt))) continue;
    tally.matured++;
    if (v.verdict !== 'send') tally.dropped[v.verdict] = (tally.dropped[v.verdict] ?? 0) + 1;
  }

  let raced = false;
  if (choice.pick && found?.etag) {
    // Сперва отметка, потом отправка — и отметка условная. Два наложившихся прохода или
    // повтор вызова платформой не отправят дважды: второй проиграет запись. Обратная
    // сторона названа: упадёт процесс после отметки — сообщение потеряно, и это выбор.
    const marked = markSent(rec, choice.pick, now);
    const written = await io.notify.setJSON(player, marked, { onlyIfMatch: found.etag });
    if (!written.modified) {
      raced = true;
      tally.lostRace++;
    } else {
      const sent = io.tg ? await io.tg.send(Number(player.slice(3)), noticeText(choice.pick, rec.prefs.tz)) : 'ok';
      if (sent === 'ok') tally.wouldSend++;
      else if (sent === 'lost') tally.lost++;
      else {
        // Отказ канала закрывает его до нового разрешения; «подожди» снимает отметку, и годный пункт уйдёт
        // следующим проходом. Запись — поверх своей же отметки: перебил кто-то — его запись правдивее.
        const back: NotifyRecord =
          sent === 'closed' ? closeChannel(marked, now) : { ...marked, sent: withoutKey(marked.sent, choice.pick.key), lastAt: rec.lastAt, day: rec.day };
        await io.notify.setJSON(player, back, written.etag ? { onlyIfMatch: written.etag } : {});
        if (sent === 'closed') tally.closed++;
        else {
          tally.retried++;
          raced = true;
        }
      }
    }
  }
  return marks.filter((minute) => markDone(choice, minute, raced));
}

const withoutKey = (sent: Record<string, number>, key: string): Record<string, number> =>
  Object.fromEntries(Object.entries(sent).filter(([k]) => k !== key));

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
  for (const player of due) {
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
