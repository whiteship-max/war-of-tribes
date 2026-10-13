import { describe, expect, it } from 'vitest';
import { CLIENT_KINDS, DEFAULT_PREFS, NOTICE_KINDS, type NoticeItem, type WarSheet } from './contract.js';
import {
  DAY_CAP,
  PACE,
  PRESENCE_STALE,
  SEEN_GRACE,
  accept,
  choose,
  emptyNotify,
  markOf,
  news,
  readNotify,
  type NotifyRecord,
} from './notify.js';
import { deliverPass } from './deliver.js';
import type { Kv } from './kv.js';
import type { SendResult, Telegram } from './telegram.js';
import { clock, noticeText } from './words.js';
import { emptyWars, WARS_KEY, type WarFile } from './war.js';

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const MIN = 60_000;
const PLAYER = 'tg-4242';

const item = (over: Partial<NoticeItem> = {}): NoticeItem => ({
  key: 'siege-fall:m9:1700000000000',
  kind: 'siege-fall',
  fireAt: NOW - MIN,
  until: NOW + 10 * MIN,
  p: { from: 'Логово разбойников', fate: 'plunder', about: NOW - MIN },
  ...over,
});

/** Запись игрока, ушедшего за четверть часа до сейчас, с одним созревшим пунктом. */
const away = (over: Partial<NotifyRecord> = {}): NotifyRecord => ({
  ...emptyNotify(),
  gen: 3,
  presence: { away: NOW - 15 * MIN, beatAt: NOW - 15 * MIN },
  items: [item()],
  prefs: { ...DEFAULT_PREFS },
  ...over,
});

const verdict = (rec: NotifyRecord, now = NOW) => choose(rec, now).verdicts.map((v) => v.verdict);

describe('своя запись сервера перечитывается без потерь', () => {
  /**
   * Вести войны лежат в исходящих и перед отправкой читаются из хранилища (`readNotify` → `contract.readNotices`): слова из
   * перечитанной вести — те же, что из положенной (docs/siege_v2.md, 19.2). Прежде поля переговоров (`offer`, `answer`) при
   * чтении отбрасывались, и любая весть о переговорах уходила словами «предлагает дань».
   */
  it('переговоры, пакт, выручка, вылазка на машину — те же поля и слова после хранилища', () => {
    const war = (kind: NoticeItem['kind'], key: string, p: Partial<NoticeItem['p']>): NoticeItem => ({
      key: `${kind}:${key}`,
      kind,
      fireAt: NOW - MIN,
      until: NOW + 10 * MIN,
      p: { from: 'Бета', fate: 'plunder', about: NOW + 5 * MIN, ...p },
    });
    const items = [
      war('war-parley', 'w1:terms:1', { role: 'def', offer: 'terms', fate: 'captives' }),
      war('war-parley', 'w1:tribute:1', { role: 'atk', offer: 'tribute' }),
      war('war-parley', 'w1:terms:1:no', { role: 'atk', offer: 'terms', answer: 'no' }),
      war('war-parley', 'w1:tribute:paid', { role: 'def', offer: 'tribute', answer: 'yes' }),
      war('war-pact', 'c1:1', { pact: 'offer' }),
      war('war-pact', 'c1:1:made', { pact: 'made' }),
      war('war-relief', 'w1:go:c1:2', { role: 'def', relief: 'going', ally: 'Гамма' }),
      war('war-relief', 'w1.3', { relief: 'fight', won: true }),
      war('war-relief', 'w1:turned:4', { relief: 'turned' }),
      war('war-relief', 'w1:turned:5', { role: 'def', relief: 'turned', ally: 'Гамма' }),
      war('war-fight', 'w1.6', { role: 'def', site: 'sortie', by: 'def', won: true, machine: 'tower' }),
      war('war-fight', 'w1.7', { role: 'def', site: 'camp', by: 'def', won: false, ally: 'Гамма' }),
    ];
    const texts = new Set<string>();
    for (const it0 of items) {
      const { record } = news(emptyNotify(), [it0], [], PLAYER, NOW);
      const back = readNotify(JSON.parse(JSON.stringify(record)));
      expect(back.srv, it0.key).toEqual([it0]);
      expect(noticeText(back.srv[0], DEFAULT_PREFS.tz), it0.key).toBe(noticeText(it0, DEFAULT_PREFS.tz));
      texts.add(noticeText(it0, DEFAULT_PREFS.tz));
    }
    expect(texts.size, 'у каждой вести свои слова').toBe(items.length);
  });
});

describe('белый список видов', () => {
  /**
   * Решение владельца (05.10.2026): бот пишет о двух вещах — на город нападают и бой был. Шесть видов поимённо:
   * три о логове (мир на клиенте), три о войне между игроками и тайное нападение лазутчика соседа (сервер,
   * docs/spy_pvp.md). Вида «вернись в игру» быть не может.
   */
  it('двенадцать видов поимённо, вида «вернись в игру» быть не может', () => {
    // Фаза осады — пролом и мор (`siege-phase` у осады логова, `war-phase` у войны; docs/siege_v2.md, 8.3). Переговоры у стен
    // (`war-parley`, раздел 7) — только у войны: с логовом переговоры идут в игре, без вестей.
    // Пакт и выручка союзника (`war-pact`, `war-relief`, docs/siege_v2.md, 19.2) — слово владельца 13.10.2026.
    expect([...NOTICE_KINDS]).toEqual([
      'raid',
      'raid-fight',
      'siege-fall',
      'siege-phase',
      'war',
      'war-fight',
      'war-fall',
      'war-spy',
      'war-phase',
      'war-parley',
      'war-pact',
      'war-relief',
    ]);
    const put = accept(emptyNotify(), { computedAt: NOW, items: [item({ kind: 'come-back' as never, key: 'come-back:1' })] }, PLAYER, NOW);
    expect(put.fail).toEqual({ status: 400, error: 'bad-body' });
  });

  /** Войну знает только сервер: клиент, приславший «бой был» о войне, назвал бы исход, которого сервер не считал. */
  it('клиент не может прислать вид войны — отказ всему списку', () => {
    expect([...CLIENT_KINDS]).toEqual(['raid', 'raid-fight', 'siege-fall', 'siege-phase']);
    for (const kind of ['war', 'war-fight', 'war-fall', 'war-spy', 'war-phase', 'war-parley', 'war-pact', 'war-relief'] as const) {
      const fake = item({ kind, key: `${kind}:x`, p: { ...item().p, role: 'def', won: true } });
      expect(accept(emptyNotify(), { computedAt: NOW, items: [fake] }, PLAYER, NOW).fail, kind).toEqual({ status: 400, error: 'bad-body' });
    }
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

  it('игрок выключил уведомления — молчит; Telegram закрыл канал — молчит', () => {
    expect(verdict(away({ prefs: { ...away().prefs, on: false } }))).toEqual(['off']);
    expect(verdict(away({ chan: { state: 'closed', at: NOW - MIN } }))).toEqual(['closed']);
    expect(verdict(away({ chan: { state: 'open', at: NOW - MIN } }))).toEqual(['send']);
  });

  it('суточный потолок и темп: созрели два — уходит один, второй ждёт прохода', () => {
    const two = away({ items: [item(), item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW - 30_000 })] });
    const c = choose(two, NOW);
    expect(c.pick?.key).toBe(item().key);
    expect(c.verdicts.map((v) => v.verdict)).toEqual(['send', 'pace']);
    expect(verdict(away({ lastAt: NOW - PACE + 1 }))).toEqual(['pace']);
    expect(verdict(away({ day: { date: '2026-09-14', n: DAY_CAP } }))).toEqual(['cap']);
    expect(verdict(away({ day: { date: '2026-09-14', n: DAY_CAP - 1 } }))).toEqual(['send']);
    expect(verdict(away({ day: { date: '2026-09-13', n: DAY_CAP } }))).toEqual(['send']);
  });

  /** Тихих часов нет (решение владельца): о нападении и о бое — в любое время суток. */
  it('ночью в поясе игрока пункт уходит так же', () => {
    // 17:30 UTC — во Владивостоке (UTC+10) 03:30.
    const t = Date.UTC(2026, 8, 14, 17, 30);
    const night = away({ prefs: { on: true, tz: 'Asia/Vladivostok' }, items: [item({ fireAt: t - MIN, until: t + MIN })] });
    expect(choose(night, t).pick?.key).toBe(item().key);
  });

  it('сутки потолка — сутки игрока, а не UTC', () => {
    // 14:30 UTC — во Владивостоке уже 15 сентября: вчерашние не в счёт.
    const t = Date.UTC(2026, 8, 14, 14, 30);
    const rec = away({ prefs: { ...away().prefs, tz: 'Asia/Vladivostok' }, day: { date: '2026-09-14', n: DAY_CAP }, items: [item({ fireAt: t - MIN, until: t + MIN })] });
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

function world(rec: NotifyRecord, tg: Telegram | null = null) {
  const io = { notify: memoryKv(), due: memoryKv(), stats: memoryKv(), world: memoryKv(), saves: memoryKv(), tg };
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

describe('проход доставки: вся цепочка', () => {
  it('ушло бы один раз: отметка «ушло», метка снята, второй проход молчит', async () => {
    const io = world(away());
    const first = await deliverPass(io, NOW);
    expect(first).toMatchObject({ marks: 1, matured: 1, wouldSend: 1, lostRace: 0 });
    expect(stored(io).sent[item().key]).toBe(NOW);
    expect(io.due.data.size).toBe(0);
    const second = await deliverPass(io, NOW + 2 * MIN);
    expect(second).toMatchObject({ marks: 0, wouldSend: 0 });
    // Счётчик — запись на проход, и ключа игрока в нём нет.
    expect(io.stats.data.size).toBe(2);
    for (const { value } of io.stats.data.values()) expect(value).not.toContain('tg-');
  });

  it('игрок здесь — не уходит, и счётчик называет причину', async () => {
    const io = world(away({ presence: { away: null, beatAt: NOW - MIN } }));
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ wouldSend: 0, dropped: { present: 1 } });
    expect(stored(io).sent).toEqual({});
  });

  it('два наложившихся прохода не отправят дважды: второй проигрывает условную запись', async () => {
    const io = world(away());
    let release!: () => void;
    io.notify.hold = new Promise((r) => (release = r));
    const both = Promise.all([deliverPass(io, NOW), deliverPass(io, NOW)]);
    // Оба прочли запись с одним ETag, прежде чем кто-то написал.
    await new Promise((r) => setTimeout(r, 0));
    io.notify.hold = null;
    release();
    const [a, b] = await both;
    expect(a.wouldSend + b.wouldSend, 'ушло бы всего').toBe(1);
    expect(a.lostRace + b.lostRace, 'проигранных записей').toBe(1);
    // Проигравший метку не снимает, но следующий проход видит «ушло» и не отправляет.
    const third = await deliverPass(io, NOW + 2 * MIN);
    expect(third.wouldSend).toBe(0);
  });

  it('не уходит из прежнего списка: клиент заменил список между чтением и отметкой', async () => {
    const io = world(away());
    let release!: () => void;
    io.notify.hold = new Promise((r) => (release = r));
    const pass = deliverPass(io, NOW);
    await new Promise((r) => setTimeout(r, 0));
    io.notify.hold = null;
    // Игрок вернулся, осаду сняли: новый список без пункта, номер вырос.
    await clientPut(io, { computedAt: NOW, items: [], present: false }, NOW);
    release();
    const t = await pass;
    expect(t.wouldSend).toBe(0);
    expect(t.lostRace).toBe(1);
    expect(stored(io).gen).toBe(4);
    const next = await deliverPass(io, NOW + 2 * MIN);
    expect(next).toMatchObject({ wouldSend: 0, staleMarks: 1 });
    expect(io.due.data.size).toBe(0);
  });

  it('после until не уходит, метка снимается', async () => {
    const io = world(away());
    const t = await deliverPass(io, item().until);
    expect(t).toMatchObject({ wouldSend: 0, dropped: { expired: 1 } });
    expect(io.due.data.size).toBe(0);
  });

  it('метка чужого вида не открывает ничью запись', async () => {
    const io = world(away());
    await io.due.set(`${markOf(item(), '')}../tribe-saves`, '1');
    await io.due.set(`${markOf(item(), 'tg-')}x`, '1');
    const t = await deliverPass(io, NOW);
    expect(t.wouldSend).toBe(1);
    expect([...io.due.data.keys()]).toEqual([]);
  });

  it('рано — метка остаётся до своей минуты', async () => {
    const io = world(away({ items: [item({ fireAt: NOW + 20_000 })] }));
    // Минута метки уже наступила, а пункт созреет через двадцать секунд.
    const t = await deliverPass(io, NOW + 1);
    expect(t).toMatchObject({ marks: 1, matured: 0, wouldSend: 0 });
    expect(io.due.data.size).toBe(1);
    expect((await deliverPass(io, NOW + 30_000)).wouldSend).toBe(1);
  });
});

// ---------- Поручения сервера, адаптер Telegram и ход войны (05.10.2026) ----------

/** Подставной Telegram: что отправлено и чем ответить. Сети у тестов нет. */
function fakeTg(answer: SendResult = 'ok') {
  const sent: { chat: number; text: string }[] = [];
  const tg: Telegram & { sent: typeof sent; next: SendResult } = {
    sent,
    next: answer,
    async send(chat, text) {
      sent.push({ chat, text });
      return tg.next;
    },
    async answer() {
      return 'ok';
    },
    async button() {
      return 'ok';
    },
    async say() {
      return 'ok';
    },
    async file() {
      return 'ok';
    },
    async greet() {
      return 'ok';
    },
  };
  return tg;
}

const warItem = (over: Partial<NoticeItem> = {}): NoticeItem => ({
  key: 'war-fight:w1.1',
  kind: 'war-fight',
  fireAt: NOW - MIN,
  until: NOW + 60 * MIN,
  p: { from: 'Бета', fate: 'plunder', about: NOW - MIN, role: 'atk', site: 'wall', by: 'atk', won: true, taken: true },
  ...over,
});

describe('поручения сервера', () => {
  it('список клиента их не стирает; ключ не задваивается; отозванное снимается', () => {
    const first = news(away({ items: [] }), [warItem()], [], PLAYER, NOW);
    expect(first.marks).toEqual([markOf(warItem(), PLAYER)]);
    const again = news(first.record, [warItem()], [], PLAYER, NOW);
    expect(again.record.srv).toHaveLength(1);
    expect(again.marks).toEqual([markOf(warItem(), PLAYER)]);
    const replaced = accept(again.record, { computedAt: NOW, items: [] }, PLAYER, NOW).record;
    expect(replaced.srv.map((i) => i.key)).toEqual([warItem().key]);
    expect(choose(replaced, NOW).pick?.key).toBe(warItem().key);
    expect(news(replaced, [], [warItem().key], PLAYER, NOW).record.srv).toEqual([]);
    // Ушедшее второй раз не кладётся.
    expect(news({ ...replaced, srv: [], sent: { [warItem().key]: NOW } }, [warItem()], [], PLAYER, NOW).record.srv).toEqual([]);
  });

  it('запись версии 1 читается: присутствие и отправленное целы, прежний список пуст, рычаг включён', () => {
    const v1 = {
      v: 1,
      gen: 5,
      presence: { away: NOW - MIN, beatAt: NOW - MIN },
      items: [{ key: 'siege-bread:m1:1', kind: 'siege-bread', fireAt: NOW, until: NOW + MIN, p: { from: 'Логово', fate: 'plunder', about: NOW + MIN } }],
      sent: { 'raid:m1:1': NOW - MIN },
      prefs: { raid: false, siege: true, quiet: { on: true, from: 0, to: 60 }, perDay: 3, tz: 'Europe/Moscow' },
    };
    const r = readNotify(v1);
    expect(r).toMatchObject({ v: 2, gen: 5, presence: { away: NOW - MIN }, items: [], srv: [], sent: { 'raid:m1:1': NOW - MIN } });
    expect(r.prefs).toEqual({ on: true, tz: 'Europe/Moscow' });
    expect(r.chan.state).toBe('unknown');
  });

  it('разрешение писать — из подписи или со слов клиента после запроса — открывает закрытый канал', () => {
    const closed = away({ chan: { state: 'closed', at: NOW - MIN } });
    expect(accept(closed, { present: true }, PLAYER, NOW).record.chan.state).toBe('closed');
    expect(accept(closed, { present: true }, PLAYER, NOW, true).record.chan.state).toBe('open');
    expect(accept(closed, { canWrite: true }, PLAYER, NOW).record.chan.state).toBe('open');
  });
});

describe('проход доставки и Telegram', () => {
  it('доставлено: адресат — число из ключа метки, слова — по виду пункта', async () => {
    const tg = fakeTg('ok');
    const io = world(away(), tg);
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ wouldSend: 1, closed: 0, retried: 0 });
    expect(tg.sent).toEqual([{ chat: 4242, text: noticeText(item(), DEFAULT_PREFS.tz) }]);
    expect(tg.sent[0].text).toContain('Логово разбойников');
  });

  it('Telegram отказал (403): канал закрыт, следующие пункты не уходят', async () => {
    const tg = fakeTg('closed');
    const io = world(away({ items: [item(), item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW - 30_000 })] }), tg);
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ wouldSend: 0, closed: 1 });
    expect(stored(io).chan.state).toBe('closed');
    tg.next = 'ok';
    const next = await deliverPass(io, NOW + 2 * MIN);
    expect(next).toMatchObject({ wouldSend: 0, dropped: { closed: 1 } });
    expect(tg.sent).toHaveLength(1);
  });

  it('Telegram просит подождать: отметка «ушло» снята, метка стоит, следующий проход отправляет', async () => {
    const tg = fakeTg('retry');
    const io = world(away(), tg);
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ wouldSend: 0, retried: 1 });
    expect(stored(io).sent[item().key]).toBeUndefined();
    expect(io.due.data.size).toBe(1);
    tg.next = 'ok';
    expect((await deliverPass(io, NOW + 2 * MIN)).wouldSend).toBe(1);
    expect(tg.sent).toHaveLength(2);
  });
});

describe('проход доставки ведёт войну между игроками', () => {
  const A = 'tg-1001';
  const B = 'tg-1002';
  const sheet: WarSheet = {
    army: { spearman: 60, archer: 30, swordsman: 30 },
    home: { spearman: 40, archer: 20 },
    militia: 20,
    archers: 6,
    resolve: 0,
    pips: {},
    rest: 1,
    food: 2000,
    townPerHour: 20,
    perManPerHour: 1,
    stock: { food: 2000, wood: 800, stone: 300 },
    stash: 100,
    gold: 400,
    pop: 400,
    bonded: 20,
    levels: { walls: 3, farm: 4, smithy: 2 },
    power: 5000,
    locks: {},
    seen: [],
  };

  /**
   * Бой назначен минутой прихода, а тика у войны нет: если обе стороны не в игре, его разбирает проход. Обе стороны
   * получают «бой был» — по одному сообщению, своими словами (`won` у каждой своя), — а защитник ещё и «на город
   * идут», которое легло в исходящие, когда войско вышло.
   */
  it('бой в минуту прихода без игроков: итог обеим сторонам, ровно один раз', async () => {
    const { emptyRoster, upsert, castleIdOf } = await import('./roster.js');
    const { applyOrder, newsDiff, newsMap } = await import('./war.js');
    const { queueNews } = await import('./outbox.js');
    const T0 = NOW;
    let roster = emptyRoster();
    roster = upsert(roster, A, { name: 'Альфа', city: 'Альфа', power: 5000, pop: 400 }, T0);
    roster = upsert(roster, B, { name: 'Бета', city: 'Бета', power: 5000, pop: 400 }, T0);
    const tg = fakeTg('ok');
    const io = world(emptyNotify(), tg);
    io.notify.data.clear();
    io.due.data.clear();
    // Обе стороны ушли из игры до выхода войска.
    for (const p of [A, B]) await io.notify.setJSON(p, { ...emptyNotify(), presence: { away: T0 - 60 * MIN, beatAt: T0 - 60 * MIN } });
    for (const p of [A, B]) await io.saves.setJSON(p, { war: sheet, updatedAt: T0 });
    const file: WarFile = emptyWars();
    const before = newsMap(file);
    const order = { op: 'march' as const, target: castleIdOf(B), mode: 'storm' as const, fate: 'plunder' as const, army: { troops: { swordsman: 30, spearman: 30 }, resolve: 0, pips: {} } };
    const ctx = { roster, sheet: (k: string) => (k === A || k === B ? { sheet, at: T0 } : null) };
    expect(applyOrder(file, A, order, T0, ctx)).toBeNull();
    const w = file.wars[0];
    // Граница области: бой ещё не разобран, проход — после прихода.
    expect(w.phase).toBe('march');
    const AT = w.arriveAt + 1000;
    await io.world.setJSON(WARS_KEY, file);
    await queueNews(io, newsDiff(before, newsMap(file)), T0);

    const pass = await deliverPass(io, AT);
    expect(pass.wars).toBeGreaterThan(0);
    const after = JSON.parse(io.world.data.get(WARS_KEY)!.value) as WarFile;
    expect(after.wars[0].battles).toHaveLength(1);
    // Проход шлёт по одному в чат; оба созрели — нужны проходы до тишины.
    for (let i = 1; i <= 4; i++) await deliverPass(io, AT + i * 2 * MIN);
    const byChat = (id: number) => tg.sent.filter((m) => m.chat === id).map((m) => m.text);
    // Защитник: «идут на город» — устарело к проходу (до прихода), не уходит; «бой был» — уходит.
    expect(byChat(1002)).toHaveLength(1);
    expect(byChat(1001)).toHaveLength(1);
    const won = after.wars[0].battles[0].won;
    expect(byChat(1001)[0]).toBe(won ? 'Город «Бета» взят штурмом.' : 'Штурм «Бета» отбит. Отряд отходит домой.');
    expect(byChat(1002)[0]).toContain('Альфа');
    // Ещё проходы — тишина: итог один раз.
    for (let i = 5; i <= 6; i++) await deliverPass(io, AT + i * 2 * MIN);
    expect(tg.sent).toHaveLength(2);
  });
});

/**
 * Слова набега: срок один — приход (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11). Дома перевод дружины мгновенный,
 * и прежняя фраза «Дружину собрать успеешь до ЧЧ:ММ» (срок — приход минус потолок сбора) стала неправдой. Окно пункта —
 * до той же минуты, что названа в словах: годен до прихода, как «идёт на твой город» у войны.
 */
describe('слова сообщений: набег', () => {
  it('«идёт на твой город» называет приход и ничего о сборе; годен до той же минуты', () => {
    const arrive = NOW + 40 * MIN;
    const raid = item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW, until: arrive, p: { from: 'Волчья падь', fate: 'plunder', about: arrive } });
    const text = noticeText(raid, DEFAULT_PREFS.tz);
    expect(text).toBe(`Набег из «Волчья падь». Идут на твой город, у стен будут в ${clock(arrive, DEFAULT_PREFS.tz)}.`);
    expect(text, 'о сборе ни слова').not.toMatch(/сбор|успеешь/i);
    expect(raid.until, 'годен до названной минуты').toBe(raid.p.about);
  });
});
