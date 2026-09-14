/**
 * Проход доставки: вся цепочка от метки индекса до отметки «ушло» — и ни одного
 * отправленного сообщения. Адаптеров в этой пачке нет (docs/NOTIFY.md, раздел 9, пачка 1):
 * вместо отправки проход пишет, что **ушло бы**.
 *
 * Хранилище передаётся снаружи тремя узкими дверями, а не импортируется: так проход
 * проверяется тестом на памяти, вместе с проигранной условной записью, — ровно тем, чего
 * на живой выкладке не воспроизвести (`notify.test.ts`).
 *
 * Счётчики — единственный способ узнать, работает ли доставка, в системе без журналов.
 * Пишутся они записью на каждый проход, а не одним накопленным числом: копить значит
 * читать и разбирать своё же хранилище, а разбирающих записей у сервера ровно две. Отметка
 * прохода в имени записи и есть проверка расписания: сколько записей за час и каков
 * разрыв между соседними, видно списком ключей в панели Netlify. Ключей игроков в
 * счётчиках нет ни одного.
 */
import { choose, markDone, markSent, minuteOf, PLAYER_KEY, readNotify, type Verdict } from './notify.js';
import { parseJson } from './http.js';

/** Узкая дверь в хранилище — ровно то, чем пользуется проход. */
export interface Kv {
  getWithMetadata(key: string, opts: { type: 'text' }): Promise<{ data: string; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  set(key: string, value: string): Promise<unknown>;
  list(opts: { prefix?: string; directories?: boolean }): Promise<{ blobs: { key: string }[]; directories: string[] }>;
  delete(key: string): Promise<void>;
}

export interface PassIo {
  /** Записи исходящих по ключу игрока. */
  notify: Kv;
  /** Индекс по минутам: пустые метки `<минута>/<ключ игрока>`. */
  due: Kv;
  /** Счётчики проходов. */
  stats: Kv;
}

/** Итог прохода. Ни одного ключа игрока. */
export interface PassTally {
  at: number;
  tookMs: number;
  /** Сколько меток с минутой не позже нынешней разобрано. */
  marks: number;
  /** Пунктов, которым пора (`fireAt ≤ now`). */
  matured: number;
  /** Ушло бы. */
  wouldSend: number;
  /** Из них — без звука, в тихие часы. */
  quiet: number;
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
    quiet: 0,
    lostRace: 0,
    dropped: {},
    staleMarks: 0,
    truncated: false,
  };
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
  const found = await io.notify.getWithMetadata(player, { type: 'text' });
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
    // сторона названа: упадёт отправка после отметки — сообщение потеряно, и это выбор.
    const written = await io.notify.setJSON(player, markSent(rec, choice.pick, now), { onlyIfMatch: found.etag });
    if (!written.modified) {
      raced = true;
      tally.lostRace++;
    } else {
      // Здесь в следующей пачке встанет адаптер. Сейчас адаптеров нет ни одного, и
      // отправка — это строка в счётчике.
      tally.wouldSend++;
      if (choice.quiet) tally.quiet++;
    }
  }
  return marks.filter((minute) => markDone(choice, minute, raced));
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
