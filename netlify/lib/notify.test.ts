import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, NOTICE_KINDS, type NoticeItem, type NotifyPrefs } from './contract.js';
import {
  PACE,
  PRESENCE_STALE,
  SEEN_GRACE,
  accept,
  choose,
  emptyNotify,
  inQuiet,
  markOf,
  readNotify,
  type NotifyRecord,
} from './notify.js';
import { deliverPass, type PassIo } from './deliver.js';
import type { Kv } from './kv.js';

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const MIN = 60_000;
const PLAYER = 'tg-4242';

const item = (over: Partial<NoticeItem> = {}): NoticeItem => ({
  key: 'siege-bread:m9:1700000000000',
  kind: 'siege-bread',
  fireAt: NOW - MIN,
  until: NOW + 10 * MIN,
  p: { from: 'Логово разбойников', fate: 'plunder', about: NOW + 10 * MIN, frontAt: NOW - 20 * MIN },
  ...over,
});

/** Запись игрока, ушедшего за четверть часа до сейчас, с одним созревшим пунктом. */
const away = (over: Partial<NotifyRecord> = {}): NotifyRecord => ({
  ...emptyNotify(),
  gen: 3,
  presence: { away: NOW - 15 * MIN, beatAt: NOW - 15 * MIN },
  items: [item()],
  prefs: { ...DEFAULT_PREFS, quiet: { on: false, from: 0, to: 0 } },
  ...over,
});

const verdict = (rec: NotifyRecord, now = NOW) => choose(rec, now).verdicts.map((v) => v.verdict);

describe('белый список видов', () => {
  it('три и только три, поимённо — вида «вернись в игру» быть не может', () => {
    expect([...NOTICE_KINDS]).toEqual(['raid', 'siege-works', 'siege-bread']);
    const put = accept(emptyNotify(), { computedAt: NOW, items: [item({ kind: 'come-back' as never, key: 'come-back:1' })] }, PLAYER, NOW);
    expect(put.fail).toEqual({ status: 400, error: 'bad-body' });
  });
});

describe('приём списка: форма, а не смысл', () => {
  const put = (items: unknown, over: Record<string, unknown> = {}, rec = emptyNotify()) =>
    accept(rec, { computedAt: NOW, items: items as NoticeItem[], ...over }, PLAYER, NOW);

  it('честный список принимается, номер растёт, метки по минуте fireAt', () => {
    const r = put([item(), item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW + 3 * MIN })]);
    expect(r.fail).toBeNull();
    expect(r.record.gen).toBe(1);
    expect(r.marks).toEqual([markOf(item(), PLAYER), markOf({ fireAt: NOW + 3 * MIN }, PLAYER)]);
  });

  it('больше восьми пунктов, fireAt дальше двенадцати часов, разметка в имени — отказ всему списку', () => {
    const many = Array.from({ length: 9 }, (_, i) => item({ key: `raid:m${i}:1`, kind: 'raid' }));
    expect(put(many).fail?.error).toBe('bad-body');
    expect(put([item({ fireAt: NOW + 12 * 60 * MIN + 1, until: NOW + 13 * 60 * MIN })]).fail?.error).toBe('bad-body');
    expect(put([item({ p: { ...item().p, from: '<a href=x>Логово</a>' } })]).fail?.error).toBe('bad-body');
    expect(put([item({ p: { ...item().p, from: 'и'.repeat(41) } })]).fail?.error).toBe('bad-body');
    expect(put([item({ fireAt: NOW + MIN, until: NOW + MIN })]).fail?.error).toBe('bad-body');
  });

  it('часы составления разошлись с нашими больше чем на две минуты — отказ', () => {
    expect(put([item()], { computedAt: NOW - 2 * MIN - 1 }).fail?.error).toBe('clock');
    expect(put([item()], { computedAt: undefined }).fail?.error).toBe('clock');
    expect(put([item()], { computedAt: NOW + 2 * MIN }).fail).toBeNull();
  });

  it('список чаще раза в пять секунд — отказ, но «ушёл» из того же запроса не теряется', () => {
    const first = put([item()]);
    const again = accept(first.record, { computedAt: NOW + 3000, items: [], present: false }, PLAYER, NOW + 3000);
    expect(again.fail).toEqual({ status: 429, error: 'slow-down' });
    expect(again.record.items).toEqual(first.record.items);
    expect(again.record.gen).toBe(first.record.gen);
    expect(again.record.presence.away).toBe(NOW + 3000);
  });

  it('время присутствия ставит сервер; повторное «ушёл» минуту ухода не двигает', () => {
    const gone = accept(emptyNotify(), { present: false }, PLAYER, NOW).record;
    expect(gone.presence).toEqual({ away: NOW, beatAt: NOW });
    expect(accept(gone, { present: false }, PLAYER, NOW + MIN).record.presence.away).toBe(NOW);
    expect(accept(gone, { present: true }, PLAYER, NOW + MIN).record.presence).toEqual({ away: null, beatAt: NOW + MIN });
  });

  it('запись переживает хранилище: разбор своей записи отдаёт то же', () => {
    const r = put([item()], { present: false, prefs: { ...DEFAULT_PREFS, tz: 'Europe/Moscow' } }).record;
    expect(readNotify(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(readNotify({ v: 2 })).toEqual(emptyNotify());
    expect(readNotify('мусор')).toEqual(emptyNotify());
  });
});

describe('правила отправки', () => {
  it('созревший пункт ушедшему игроку — уходит', () => {
    expect(choose(away(), NOW).pick?.key).toBe(item().key);
  });

  it('не уходит, пока игрок здесь', () => {
    expect(verdict(away({ presence: { away: null, beatAt: NOW - MIN } }))).toEqual(['present']);
  });

  it('отметка присутствия старше трёх минут — игрок ушёл в минуту последней отметки', () => {
    // Окно убили без события скрытия. Граница области: отметка ровно на пороге — ещё здесь.
    expect(verdict(away({ presence: { away: null, beatAt: NOW - PRESENCE_STALE } }))).toEqual(['present']);
    expect(verdict(away({ presence: { away: null, beatAt: NOW - PRESENCE_STALE - 1 } }))).toEqual(['send']);
  });

  it('не уходит, если fireAt раньше ухода плюс две минуты: игрок это видел', () => {
    const at = item().fireAt;
    expect(verdict(away({ presence: { away: at - SEEN_GRACE + 1, beatAt: 0 } }))).toEqual(['seen']);
    expect(verdict(away({ presence: { away: at - SEEN_GRACE, beatAt: 0 } }))).toEqual(['send']);
  });

  it('не уходит раньше fireAt и после until', () => {
    expect(verdict(away(), item().fireAt - 1)).toEqual(['early']);
    expect(verdict(away(), item().until)).toEqual(['expired']);
    expect(verdict(away(), item().until - 1)).toEqual(['send']);
  });

  it('не уходит второй раз по тому же ключу', () => {
    expect(verdict(away({ sent: { [item().key]: NOW - 30 * MIN } }))).toEqual(['sent']);
  });

  it('выключенный вид молчит', () => {
    expect(verdict(away({ prefs: { ...away().prefs, siege: false } }))).toEqual(['off']);
  });

  it('суточный потолок и темп: созрели два — уходит один, второй ждёт прохода', () => {
    const two = away({ items: [item(), item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW - 30_000 })] });
    const c = choose(two, NOW);
    expect(c.pick?.key).toBe(item().key);
    expect(c.verdicts.map((v) => v.verdict)).toEqual(['send', 'pace']);
    expect(verdict(away({ lastAt: NOW - PACE + 1 }))).toEqual(['pace']);
    expect(verdict(away({ day: { date: '2026-09-14', n: 6 } }))).toEqual(['cap']);
    expect(verdict(away({ day: { date: '2026-09-13', n: 6 } }))).toEqual(['send']);
  });

  it('тихие часы — в поясе игрока и через полночь', () => {
    const quiet = (tz: string): NotifyPrefs => ({ ...DEFAULT_PREFS, tz, quiet: { on: true, from: 23 * 60, to: 8 * 60 } });
    // 14:30 UTC — во Владивостоке (UTC+10) 00:30: тихо. В Лиссабоне 15:30: не тихо.
    const t = Date.UTC(2026, 8, 14, 14, 30);
    expect(inQuiet(quiet('Asia/Vladivostok'), t)).toBe(true);
    expect(inQuiet(quiet('Europe/Lisbon'), t)).toBe(false);
    // Край окна через полночь: 23:00 тихо, 07:59 тихо, 08:00 уже нет — во Владивостоке.
    expect(inQuiet(quiet('Asia/Vladivostok'), Date.UTC(2026, 8, 14, 13, 0))).toBe(true);
    expect(inQuiet(quiet('Asia/Vladivostok'), Date.UTC(2026, 8, 14, 21, 59))).toBe(true);
    expect(inQuiet(quiet('Asia/Vladivostok'), Date.UTC(2026, 8, 14, 22, 0))).toBe(false);
    expect(inQuiet(quiet('Asia/Vladivostok'), Date.UTC(2026, 8, 14, 12, 59))).toBe(false);
    // Непонятный пояс — UTC, а не исключение.
    expect(inQuiet(quiet('Марс/Олимп'), Date.UTC(2026, 8, 14, 23, 30))).toBe(true);
    // В тихие часы пункт уходит — без звука.
    const ripe = away({ prefs: quiet('Asia/Vladivostok'), items: [item({ fireAt: t - MIN, until: t + MIN })] });
    expect(choose(ripe, t).pick?.key).toBe(item().key);
    expect(choose(ripe, t).quiet).toBe(true);
  });

  it('сутки потолка — сутки игрока, а не UTC', () => {
    // 14:30 UTC — во Владивостоке уже 15 сентября: вчерашние шесть не в счёт.
    const t = Date.UTC(2026, 8, 14, 14, 30);
    const rec = away({ prefs: { ...away().prefs, tz: 'Asia/Vladivostok' }, day: { date: '2026-09-14', n: 6 }, items: [item({ fireAt: t - MIN, until: t + MIN })] });
    expect(verdict(rec, t)).toEqual(['send']);
  });
});

// ---------- Проход доставки на памяти ----------

/** Хранилище в памяти с настоящими ETag и условной записью. `hold` — пауза между чтением и записью. */
function memoryKv() {
  const data = new Map<string, { value: string; etag: string }>();
  let n = 0;
  const kv: Kv & { data: typeof data; hold: Promise<void> | null } = {
    data,
    hold: null,
    async getWithMetadata(key) {
      const v = data.get(key);
      const got = v ? { data: v.value, etag: v.etag } : null;
      if (kv.hold) await kv.hold;
      return got;
    },
    async setJSON(key, value, opts) {
      const had = data.get(key);
      if (opts?.onlyIfNew && had) return { modified: false };
      if (opts?.onlyIfMatch && had?.etag !== opts.onlyIfMatch) return { modified: false };
      data.set(key, { value: JSON.stringify(value), etag: `e${++n}` });
      return { modified: true };
    },
    async set(key, value) {
      data.set(key, { value, etag: `e${++n}` });
    },
    async list({ prefix = '', directories = false }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix));
      if (!directories) return { blobs: keys.map((key) => ({ key })), directories: [] };
      const blobs: { key: string }[] = [];
      const dirs = new Set<string>();
      for (const k of keys) {
        const rest = k.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) blobs.push({ key: k });
        else dirs.add(prefix + rest.slice(0, slash));
      }
      return { blobs, directories: [...dirs] };
    },
    async delete(key) {
      data.delete(key);
    },
  };
  return kv;
}

function world(rec: NotifyRecord) {
  const io = { notify: memoryKv(), due: memoryKv(), stats: memoryKv() };
  void io.notify.setJSON(PLAYER, rec);
  for (const it of rec.items) void io.due.set(markOf(it, PLAYER), '1');
  return io;
}

const stored = (io: ReturnType<typeof world>): NotifyRecord => readNotify(JSON.parse(io.notify.data.get(PLAYER)!.value));

/** Клиентский приём поверх записи в памяти — тем же `accept`, что у функции. */
async function clientPut(io: ReturnType<typeof world>, put: Parameters<typeof accept>[1], now: number): Promise<void> {
  const found = await io.notify.getWithMetadata(PLAYER);
  const { record, marks } = accept(readNotify(JSON.parse(found!.data)), put, PLAYER, now);
  const w = await io.notify.setJSON(PLAYER, record, { onlyIfMatch: found!.etag });
  expect(w.modified).toBe(true);
  for (const m of marks) await io.due.set(m, '1');
}

describe('проход доставки: вся цепочка, ни одного отправленного', () => {
  it('ушло бы один раз: отметка «ушло», метка снята, второй проход молчит', async () => {
    const io = world(away());
    const first = await deliverPass(io as PassIo, NOW);
    expect(first).toMatchObject({ marks: 1, matured: 1, wouldSend: 1, lostRace: 0 });
    expect(stored(io).sent[item().key]).toBe(NOW);
    expect(io.due.data.size).toBe(0);
    const second = await deliverPass(io as PassIo, NOW + 2 * MIN);
    expect(second).toMatchObject({ marks: 0, wouldSend: 0 });
    // Счётчик — запись на проход, и ключа игрока в нём нет.
    expect(io.stats.data.size).toBe(2);
    for (const { value } of io.stats.data.values()) expect(value).not.toContain('tg-');
  });

  it('игрок здесь — не уходит, и счётчик называет причину', async () => {
    const io = world(away({ presence: { away: null, beatAt: NOW - MIN } }));
    const t = await deliverPass(io as PassIo, NOW);
    expect(t).toMatchObject({ wouldSend: 0, dropped: { present: 1 } });
    expect(stored(io).sent).toEqual({});
  });

  it('два наложившихся прохода не отправят дважды: второй проигрывает условную запись', async () => {
    const io = world(away());
    let release!: () => void;
    io.notify.hold = new Promise((r) => (release = r));
    const both = Promise.all([deliverPass(io as PassIo, NOW), deliverPass(io as PassIo, NOW)]);
    // Оба прочли запись с одним ETag, прежде чем кто-то написал.
    await new Promise((r) => setTimeout(r, 0));
    io.notify.hold = null;
    release();
    const [a, b] = await both;
    expect(a.wouldSend + b.wouldSend, 'ушло бы всего').toBe(1);
    expect(a.lostRace + b.lostRace, 'проигранных записей').toBe(1);
    // Проигравший метку не снимает, но следующий проход видит «ушло» и не отправляет.
    const third = await deliverPass(io as PassIo, NOW + 2 * MIN);
    expect(third.wouldSend).toBe(0);
  });

  it('не уходит из прежнего списка: клиент заменил список между чтением и отметкой', async () => {
    const io = world(away());
    let release!: () => void;
    io.notify.hold = new Promise((r) => (release = r));
    const pass = deliverPass(io as PassIo, NOW);
    await new Promise((r) => setTimeout(r, 0));
    io.notify.hold = null;
    // Игрок вернулся, осаду сняли: новый список без пункта, номер вырос.
    await clientPut(io, { computedAt: NOW, items: [], present: false }, NOW);
    release();
    const t = await pass;
    expect(t.wouldSend).toBe(0);
    expect(t.lostRace).toBe(1);
    expect(stored(io).gen).toBe(4);
    const next = await deliverPass(io as PassIo, NOW + 2 * MIN);
    expect(next).toMatchObject({ wouldSend: 0, staleMarks: 1 });
    expect(io.due.data.size).toBe(0);
  });

  it('после until не уходит, метка снимается', async () => {
    const io = world(away());
    const t = await deliverPass(io as PassIo, item().until);
    expect(t).toMatchObject({ wouldSend: 0, dropped: { expired: 1 } });
    expect(io.due.data.size).toBe(0);
  });

  it('метка чужого вида не открывает ничью запись', async () => {
    const io = world(away());
    await io.due.set(`${markOf(item(), '')}../tribe-saves`, '1');
    await io.due.set(`${markOf(item(), 'tg-')}x`, '1');
    const t = await deliverPass(io as PassIo, NOW);
    expect(t.wouldSend).toBe(1);
    expect([...io.due.data.keys()]).toEqual([]);
  });

  it('рано — метка остаётся до своей минуты', async () => {
    const io = world(away({ items: [item({ fireAt: NOW + 20_000 })] }));
    // Минута метки уже наступила, а пункт созреет через двадцать секунд.
    const t = await deliverPass(io as PassIo, NOW + 1);
    expect(t).toMatchObject({ marks: 1, matured: 0, wouldSend: 0 });
    expect(io.due.data.size).toBe(1);
    expect((await deliverPass(io as PassIo, NOW + 30_000)).wouldSend).toBe(1);
  });
});
