import { describe, expect, it } from 'vitest';
import { CLIENT_KINDS, DEFAULT_PREFS, NOTICE_KINDS, type NoticeItem, type WarSheet } from './contract.js';
import {
  DAY_CAP,
  FRESH_MS,
  GLUE_MS,
  LEASE_MS,
  PACE,
  PRESENCE_STALE,
  SEEN_GRACE,
  URGENT_CAP,
  accept,
  applySwitch,
  emptyNotify,
  inQuiet,
  markOf,
  news,
  plan,
  quietEnd,
  readBotPrefs,
  readNotify,
  tierOf,
  topicOf,
  type NotifyRecord,
} from './notify.js';
import { deliverPass } from './deliver.js';
import type { Kv } from './kv.js';
import type { Sent, SendResult, Telegram } from './telegram.js';
import { clock, letterText, noticeText } from './words.js';
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

const verdict = (rec: NotifyRecord, now = NOW) => plan(rec, now).verdicts.map((v) => v.verdict);
/** Что уходит в этот проход: ключ первого пункта первого письма. */
const pick = (rec: NotifyRecord, now = NOW) => plan(rec, now).letters[0]?.keys[0];

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
  /**
   * Слово владельца 16.10.2026 (ВС-1): в настройках бота пять родов — бои, осады, стройка, указы, соседи. Родам «стройка» и
   * «указы» дали свои вести — `build` (клиент, прогнозом стройки партии) и `grant` (сервер, указ админа); без них их
   * переключатели ничего бы не переключали. Напоминаний «вернись в игру» по-прежнему нет.
   */
  it('четырнадцать видов поимённо, вида «вернись в игру» быть не может', () => {
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
      'build',
      'grant',
    ]);
    const put = accept(emptyNotify(), { computedAt: NOW, items: [item({ kind: 'come-back' as never, key: 'come-back:1' })] }, PLAYER, NOW);
    expect(put.fail).toEqual({ status: 400, error: 'bad-body' });
  });

  /** Войну знает только сервер: клиент, приславший «бой был» о войне, назвал бы исход, которого сервер не считал. */
  it('клиент не может прислать вид войны — отказ всему списку', () => {
    // Стройку клиент знает сам (ВС-1); указ отдаёт админ на сервере — его клиент прислать не может, как войну.
    expect([...CLIENT_KINDS]).toEqual(['raid', 'raid-fight', 'siege-fall', 'siege-phase', 'build']);
    for (const kind of ['war', 'war-fight', 'war-fall', 'war-spy', 'war-phase', 'war-parley', 'war-pact', 'war-relief', 'grant'] as const) {
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
    expect(pick(away())).toBe(item().key);
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

  it('суточный потолок: обычное — `DAY_CAP` писем, срочное — `URGENT_CAP`; сутки — игрока', () => {
    // 12:00 UTC — в Москве 15:00, тихий час не идёт. Сутки потолка — 14 сентября по Москве.
    const grant = item({ key: 'grant:1', kind: 'grant', fireAt: NOW - GLUE_MS, p: { from: 'указ', fate: 'plunder', about: NOW - GLUE_MS, n: 1, stock: { wood: 5 } } });
    const day = (n: number) => ({ date: '2026-09-14', n });
    expect(verdict(away({ items: [grant], day: day(DAY_CAP) }))).toEqual(['cap']);
    expect(verdict(away({ items: [grant], day: day(DAY_CAP - 1) }))).toEqual(['send']);
    expect(verdict(away({ items: [grant], day: { date: '2026-09-13', n: DAY_CAP } }))).toEqual(['send']);
    // Срочное потолком обычного не держится — только своим.
    expect(verdict(away({ day: day(DAY_CAP) }))).toEqual(['send']);
    expect(verdict(away({ day: day(URGENT_CAP - 1) }))).toEqual(['send']);
    expect(verdict(away({ day: day(URGENT_CAP) }))).toEqual(['cap']);
  });

  it('сутки потолка — сутки игрока, а не UTC', () => {
    // 14:30 UTC — во Владивостоке уже 15 сентября: вчерашние не в счёт.
    const t = Date.UTC(2026, 8, 14, 14, 30);
    const rec = away({ prefs: { ...away().prefs, tz: 'Asia/Vladivostok' }, day: { date: '2026-09-14', n: URGENT_CAP }, items: [item({ fireAt: t - MIN, until: t + MIN })] });
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

/** Подставной Telegram: что отправлено и чем ответить. Сети у тестов нет. Новое сообщение получает номер. */
function fakeTg(answer: SendResult | 'gone' = 'ok') {
  const sent: { chat: number; text: string; silent?: boolean; edit?: number }[] = [];
  let id = 100;
  const reply = (): Sent => (tg.next === 'ok' ? { result: 'ok', msg: ++id } : { result: tg.next, ...(tg.after !== undefined ? { after: tg.after } : {}) });
  const tg: Telegram & { sent: typeof sent; next: SendResult | 'gone'; after: number | undefined } = {
    sent,
    next: answer,
    after: undefined,
    async letter(chat, text, silent) {
      sent.push({ chat, text, silent });
      return reply();
    },
    async edit(chat, msg, text) {
      sent.push({ chat, text, edit: msg });
      return tg.next === 'ok' ? { result: 'ok' } : reply();
    },
    async answer() {
      return 'ok';
    },
    async button() {
      return 'ok';
    },
    async panel() {
      return 'ok';
    },
    async repanel() {
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
    checkout: async () => 'ok',
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
    // «Бой был» — обычная весть: уходит, когда закрылось окно склейки.
    expect(pick(replaced, warItem().fireAt + GLUE_MS)).toBe(warItem().key);
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
    expect(tg.sent).toEqual([{ chat: 4242, text: noticeText(item(), DEFAULT_PREFS.tz), silent: false }]);
    expect(tg.sent[0].text).toContain('Логово разбойников');
  });

  it('Telegram отказал (403): канал закрыт, следующие пункты не уходят', async () => {
    const tg = fakeTg('closed');
    const io = world(away({ items: [item(), item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW - 30_000 })] }), tg);
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ wouldSend: 0, closed: 1 });
    expect(stored(io).chan.state).toBe('closed');
    // Второе срочное письмо того же прохода в Telegram не пошло: очередь пуста, его весть снова ждёт разрешения.
    expect(stored(io).out).toEqual([]);
    expect(stored(io).sent['raid:m4:1']).toBeUndefined();
    tg.next = 'ok';
    const next = await deliverPass(io, NOW + 2 * MIN);
    expect(next).toMatchObject({ wouldSend: 0 });
    expect(tg.sent).toHaveLength(1);
    expect(verdict(stored(io), NOW + 2 * MIN)).toEqual(['sent', 'closed']);
  });

  it('Telegram просит подождать: письмо остаётся в очереди, метка стоит, следующий проход отправляет', async () => {
    const tg = fakeTg('retry');
    const io = world(away(), tg);
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ wouldSend: 0, retried: 1 });
    expect(stored(io).out).toHaveLength(1);
    expect(stored(io).out[0]).toMatchObject({ lease: 0, tries: 1, keys: [item().key] });
    expect(io.due.data.size).toBeGreaterThan(0);
    tg.next = 'ok';
    expect((await deliverPass(io, NOW + 2 * MIN)).wouldSend).toBe(1);
    expect(tg.sent).toHaveLength(2);
    expect(stored(io).out).toEqual([]);
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
    // «Бой был» — обычная весть: уходит, когда закроется окно склейки (`GLUE_MS`), — нужны проходы до тишины.
    for (let i = 1; i <= 4; i++) await deliverPass(io, AT + i * 2 * MIN);
    const byChat = (id: number) => tg.sent.filter((m) => m.chat === id).map((m) => m.text);
    // Защитник: «идут на город» — устарело к проходу (до прихода), не уходит; «бой был» — уходит.
    expect(byChat(1002)).toHaveLength(1);
    expect(byChat(1001)).toHaveLength(1);
    const won = after.wars[0].battles[0].won;
    expect(byChat(1001)[0]).toBe(won ? 'Взяли «Бета» штурмом. Что взяли, сказано в донесении.' : 'Штурм «Бета» не удался: стены устояли. Отряд отходит домой.');
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
    // ВС-1: что случилось, чем грозит, что сделать — минута одна, приход.
    expect(text).toBe(
      `Набег из «Волчья падь» идёт на твой город. Идут за добром со склада. У стен будут в ${clock(arrive, DEFAULT_PREFS.tz)}. Успей поставить людей на стены.`,
    );
    expect(text, 'о сборе ни слова').not.toMatch(/сбор|успеешь/i);
    expect(raid.until, 'годен до названной минуты').toBe(raid.p.about);
  });
});

// ---------- ВС-1: склейка, важность, тихий час, настройки, очередь (16.10.2026, docs/NOTIFY.md, раздел 13) ----------

/** Указ админа: обычная весть рода «указы». */
const grantItem = (n: number, at: number): NoticeItem => ({
  key: `grant:${n}`,
  kind: 'grant',
  fireAt: at,
  until: at + 12 * 60 * MIN,
  p: { from: 'указ', fate: 'plunder', about: at, n, stock: { wood: 100 * n } },
});

/** Бой у стены, отбитый защитником: обычная весть рода «бои». */
const fightItem = (id: string, at: number): NoticeItem => ({
  key: `war-fight:${id}`,
  kind: 'war-fight',
  fireAt: at,
  until: at + 12 * 60 * MIN,
  p: { from: 'Бета', fate: 'plunder', about: at, role: 'def', site: 'wall', by: 'atk', won: true },
});

/** Минута по Москве (UTC+3) 14 сентября; `day` — сдвиг в сутках. */
const msk = (h: number, m = 0, day = 0) => Date.UTC(2026, 8, 14 + day, h - 3, m);

describe('ВС-1: роды и важность', () => {
  it('срочное — набег, осада, сдача, предложение условий или пакта; мелочь — фаза, где сработал только наказ', () => {
    const w = (kind: NoticeItem['kind'], p: Partial<NoticeItem['p']>): NoticeItem => ({ ...warItem(), key: `${kind}:x`, kind, p: { from: 'Бета', fate: 'plunder', about: NOW, ...p } });
    const urgent = [
      item({ key: 'raid:x', kind: 'raid' }),
      w('war', { role: 'def', mode: 'storm' }),
      w('war', { role: 'def', mode: 'siege' }),
      item(),
      w('war-fall', { role: 'def' }),
      w('war-fight', { role: 'def', site: 'wall', won: false, taken: true }),
      w('war-phase', { role: 'def', phase: 'breach', k: 2 }),
      item({ key: 'siege-phase:x', kind: 'siege-phase', p: { ...item().p, phase: 'breach', k: 1 } }),
      w('war-parley', { role: 'def', offer: 'terms' }),
      w('war-parley', { role: 'atk', offer: 'tribute' }),
      w('war-pact', { pact: 'offer' }),
    ];
    for (const i of urgent) expect(tierOf(i), `${i.kind} ${JSON.stringify(i.p)}`).toBe('urgent');
    const normal = [
      item({ key: 'raid-fight:x', kind: 'raid-fight' }),
      w('war-fight', { role: 'def', site: 'wall', won: true }),
      w('war-fight', { role: 'atk', site: 'wall', won: true, taken: true }),
      w('war-fall', { role: 'atk' }),
      w('war-phase', { role: 'atk', phase: 'breach', k: 2 }),
      w('war-phase', { role: 'def', phase: 'plague', k: 2 }),
      w('war-parley', { role: 'atk', offer: 'terms', answer: 'no' }),
      w('war-pact', { pact: 'made' }),
      w('war-relief', { relief: 'going', role: 'def' }),
      w('war-spy', { role: 'def' }),
      grantItem(1, NOW),
    ];
    for (const i of normal) expect(tierOf(i), `${i.kind} ${JSON.stringify(i.p)}`).toBe('normal');
    expect(tierOf(w('war-phase', { role: 'atk', phase: 'calm', k: 3, order: 'volley' }))).toBe('minor');
    expect(tierOf(w('war-phase', { role: 'def', phase: 'short', k: 3, order: 'ration' }))).toBe('minor');
  });

  it('роды настроек: поход лагерем — осада, штурмом — бой; пакт и лазутчик — соседи', () => {
    expect(topicOf({ ...warItem(), kind: 'war', p: { ...warItem().p, mode: 'siege' } })).toBe('sieges');
    expect(topicOf({ ...warItem(), kind: 'war', p: { ...warItem().p, mode: 'storm' } })).toBe('fights');
    expect(topicOf(item())).toBe('sieges');
    expect(topicOf({ ...warItem(), kind: 'war-pact', p: { ...warItem().p, pact: 'offer' } })).toBe('neighbors');
    expect(topicOf({ ...warItem(), kind: 'war-spy' })).toBe('neighbors');
    expect(topicOf(grantItem(1, NOW))).toBe('grants');
  });

  it('мелочь не уходит вовсе: только в игре', () => {
    const minor: NoticeItem = { ...warItem(), key: 'war-phase:w1:3', kind: 'war-phase', p: { ...warItem().p, phase: 'calm', k: 3, order: 'volley' } };
    expect(verdict(away({ items: [], srv: [minor] }), NOW + GLUE_MS)).toEqual(['minor']);
  });
});

describe('ВС-1: склейка', () => {
  // 15:00 по Москве — тихий час не идёт; игрок ушёл в 14:45.
  it('похожие вести за окно — одним письмом со сводкой: «3 указа: …»', () => {
    const at = NOW - MIN;
    const rec = away({ items: [], srv: [grantItem(1, at), grantItem(2, at + 20_000), grantItem(3, at + 2 * MIN)] });
    // Окно самой ранней открыто: все ждут, проход вернётся, когда оно закроется.
    const early = plan(rec, at + GLUE_MS - 1);
    expect(early.letters).toEqual([]);
    expect(early.verdicts.map((v) => v.verdict)).toEqual(['glue', 'glue', 'glue']);
    expect(early.wake).toBe(at + GLUE_MS);
    const ready = plan(rec, at + GLUE_MS);
    expect(ready.letters).toHaveLength(1);
    expect(ready.letters[0]).toMatchObject({ mode: 'new', head: 'grants', urgent: false, n: 3, keys: ['grant:1', 'grant:2', 'grant:3'] });
    expect(letterText(ready.letters[0], '')).toBe(
      ['3 указа:', '— древесина +100', '— древесина +200', '— древесина +300', 'Всё ляжет в город, как зайдёшь в игру.'].join('\n'),
    );
  });

  it('новая весть того же рода правит свежее письмо, а не шлёт новое; несвежее — новое письмо', () => {
    const sentAt = NOW - 10 * MIN;
    const thread = { msg: 77, at: sentAt, n: 1, items: [fightItem('w1.1', sentAt - GLUE_MS)] };
    const later = fightItem('w1.2', NOW - GLUE_MS);
    const rec = away({ items: [], srv: [later], threads: { fights: thread }, sent: { 'war-fight:w1.1': sentAt } });
    // Граница области: письмо свежее, пока от его отправки не прошло `FRESH_MS`.
    expect(NOW - sentAt).toBeLessThan(FRESH_MS);
    const edit = plan(rec, NOW).letters;
    expect(edit).toHaveLength(1);
    expect(edit[0]).toMatchObject({ mode: 'edit', msg: 77, head: 'fights', n: 2, keys: ['war-fight:w1.2'] });
    expect(letterText(edit[0], '').split('\n')[0]).toBe('2 боя:');
    const stale = plan(away({ ...rec, threads: { fights: { ...thread, at: NOW - FRESH_MS } } }), NOW).letters;
    expect(stale[0]).toMatchObject({ mode: 'new', head: 'fights', n: 1 });
    // Свежее письмо другого рода не правится: указ — новым письмом.
    expect(plan(away({ ...rec, srv: [grantItem(1, NOW - GLUE_MS)] }), NOW).letters[0]).toMatchObject({ mode: 'new', head: 'grants' });
  });

  it('новое обычное письмо — не чаще `PACE` после прежнего; правка свежего — без паузы', () => {
    const rec = away({ items: [], srv: [grantItem(1, NOW - GLUE_MS)] });
    expect(verdict({ ...rec, lastAt: NOW - PACE + 1 })).toEqual(['pace']);
    expect(plan({ ...rec, lastAt: NOW - PACE + 1 }, NOW).wake).toBe(NOW + 1);
    expect(verdict({ ...rec, lastAt: NOW - PACE })).toEqual(['send']);
    const thread = { msg: 5, at: NOW - MIN, n: 1, items: [grantItem(0, NOW - 2 * MIN)] };
    expect(plan({ ...rec, lastAt: NOW - 1, threads: { grants: thread } }, NOW).letters[0]).toMatchObject({ mode: 'edit', msg: 5 });
  });

  it('разные роды, созревшие вместе, — одним письмом-сводкой', () => {
    const rec = away({ items: [], srv: [fightItem('w1.1', NOW - GLUE_MS), grantItem(1, NOW - GLUE_MS + MIN)] });
    const letters = plan(rec, NOW).letters;
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({ head: 'mix', n: 2 });
    expect(letterText(letters[0], '').split('\n')[0]).toBe('Пока тебя не было — 2 вести:');
  });

  it('проход: три указа — одно сообщение; четвёртый через десять минут — правка того же сообщения', async () => {
    const tg = fakeTg('ok');
    const at = NOW - MIN;
    const io = world(away({ items: [] }), tg);
    const { record, marks } = news(stored(io), [grantItem(1, at), grantItem(2, at), grantItem(3, at + MIN)], [], PLAYER, at);
    await io.notify.setJSON(PLAYER, record);
    for (const m of marks) await io.due.set(m, '1');
    // Проходы раз в минуту до закрытия окна: до него — ни одного сообщения.
    for (let t = at; t < at + GLUE_MS; t += MIN) expect((await deliverPass(io, t)).wouldSend).toBe(0);
    const done = await deliverPass(io, at + GLUE_MS);
    expect(done).toMatchObject({ wouldSend: 1, edited: 0 });
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0].text.startsWith('3 указа:')).toBe(true);
    const msg = stored(io).threads.grants?.msg;
    expect(msg).toBeGreaterThan(0);
    // Четвёртый указ — в то же сообщение, правкой.
    const t4 = at + GLUE_MS + 10 * MIN;
    const more = news(stored(io), [grantItem(4, t4)], [], PLAYER, t4);
    await io.notify.setJSON(PLAYER, more.record);
    for (const m of more.marks) await io.due.set(m, '1');
    for (let t = t4; t <= t4 + GLUE_MS; t += MIN) await deliverPass(io, t);
    expect(tg.sent).toHaveLength(2);
    expect(tg.sent[1]).toMatchObject({ edit: msg });
    expect(tg.sent[1].text.startsWith('4 указа:')).toBe(true);
    expect(stored(io).day.n, 'правка — не новое сообщение').toBe(1);
  });
});

describe('ВС-1: тихий час', () => {
  it('по умолчанию 23:00–08:00 по Москве, если игра пояса не прислала; границы — минута в минуту', () => {
    const q = emptyNotify().bot.quiet;
    expect(q).toEqual({ from: 23 * 60, to: 8 * 60 });
    expect(inQuiet(msk(22, 59), '', q)).toBe(false);
    expect(inQuiet(msk(23, 0), '', q)).toBe(true);
    expect(inQuiet(msk(7, 59, 1), '', q)).toBe(true);
    expect(inQuiet(msk(8, 0, 1), '', q)).toBe(false);
    expect(quietEnd(msk(2, 30, 1), '', q)).toBe(msk(8, 0, 1));
    // Пояс игрока двигает окно: 23:30 по Москве — во Владивостоке уже 06:30, тоже ночь; 15:00 по Москве там — 22:00.
    expect(inQuiet(msk(15, 0), 'Asia/Vladivostok', q)).toBe(false);
    expect(inQuiet(msk(16, 0), 'Asia/Vladivostok', q)).toBe(true);
    expect(inQuiet(msk(2, 0, 1), 'Europe/Moscow', null)).toBe(false);
  });

  it('ночью срочное приходит сразу и без звука, обычное ждёт утра и уходит утренней сводкой', () => {
    const night = msk(2, 0, 1);
    const rec = away({
      presence: { away: msk(22, 0), beatAt: msk(22, 0) },
      items: [item({ key: 'raid:m1:1', kind: 'raid', fireAt: night - MIN, until: night + 60 * MIN })],
      srv: [fightItem('w1.1', msk(23, 30)), grantItem(1, msk(1, 0, 1))],
    });
    const p = plan(rec, night);
    expect(p.letters).toHaveLength(1);
    expect(p.letters[0]).toMatchObject({ urgent: true, silent: true, keys: ['raid:m1:1'] });
    expect(p.verdicts.filter((v) => v.verdict === 'quiet')).toHaveLength(2);
    expect(p.wake).toBe(msk(8, 0, 1));
    // Утро: обе вести ночи — одним письмом.
    const morning = plan({ ...rec, items: [] }, msk(8, 0, 1)).letters;
    expect(morning).toHaveLength(1);
    expect(morning[0]).toMatchObject({ head: 'night', urgent: false, silent: false, n: 2 });
    expect(letterText(morning[0], '').split('\n')).toEqual([
      'За ночь — 2 вести:',
      `— ${noticeText(fightItem('w1.1', msk(23, 30)), '')}`,
      '— древесина +100',
      'Всё ляжет в город, как зайдёшь в игру.',
    ]);
  });

  it('без тихого часа ночью обычное идёт склейкой, как днём', () => {
    const night = msk(2, 0, 1);
    const rec = away({ presence: { away: msk(22, 0), beatAt: 0 }, items: [], srv: [grantItem(1, night - GLUE_MS)], bot: { mute: [], urgent: false, quiet: null } });
    expect(plan(rec, night).letters[0]).toMatchObject({ head: 'grants', silent: false });
  });
});

describe('ВС-1: настройки бота', () => {
  it('выключенный род молчит, «только срочное» глушит обычное; остальное идёт', () => {
    const rec = away({ items: [item()], srv: [grantItem(1, NOW - GLUE_MS), fightItem('w1.1', NOW - GLUE_MS)] });
    // Порядок — по минуте: указ и бой (окно склейки закрыто), потом падение города (срочное).
    expect(verdict({ ...rec, bot: { ...rec.bot, mute: ['grants'] } })).toEqual(['muted', 'send', 'send']);
    expect(verdict({ ...rec, bot: { ...rec.bot, mute: ['sieges'] } })).toEqual(['send', 'send', 'muted']);
    expect(verdict({ ...rec, bot: { ...rec.bot, urgent: true } })).toEqual(['filtered', 'filtered', 'send']);
  });

  it('кнопки: род туда и обратно, тихий час по кругу, рычаг; игра своими настройками их не затирает', () => {
    let rec = emptyNotify();
    rec = applySwitch(rec, { topic: 'build' }, NOW);
    expect(rec.bot.mute).toEqual(['build']);
    expect(applySwitch(rec, { topic: 'build' }, NOW).bot.mute).toEqual([]);
    const seen: unknown[] = [];
    let q = rec;
    for (let i = 0; i < 4; i++) {
      q = applySwitch(q, { quiet: true }, NOW);
      seen.push(q.bot.quiet);
    }
    expect(seen).toEqual([{ from: 22 * 60, to: 7 * 60 }, { from: 0, to: 9 * 60 }, null, { from: 23 * 60, to: 8 * 60 }]);
    expect(applySwitch(rec, { urgent: true }, NOW).bot.urgent).toBe(true);
    expect(applySwitch(rec, { on: false }, NOW).prefs.on).toBe(false);
    // Игра присылает свои настройки (рычаг и пояс) — настройки бота остаются.
    const put = accept(applySwitch(rec, { urgent: true }, NOW), { prefs: { on: true, tz: 'Asia/Vladivostok' } }, PLAYER, NOW).record;
    expect(put.bot).toEqual({ mute: ['build'], urgent: true, quiet: { from: 23 * 60, to: 8 * 60 } });
    expect(put.prefs.tz).toBe('Asia/Vladivostok');
    // И переживают хранилище.
    expect(readNotify(JSON.parse(JSON.stringify(put))).bot).toEqual(put.bot);
  });

  it('кривые настройки — умолчание, а не отказ', () => {
    expect(readBotPrefs('мусор')).toEqual(emptyNotify().bot);
    expect(readBotPrefs({ mute: ['fights', 'всё', 'fights'], urgent: 'да', quiet: { from: 60, to: 60 } })).toEqual({
      mute: ['fights'],
      urgent: false,
      quiet: { from: 23 * 60, to: 8 * 60 },
    });
    expect(readBotPrefs({ quiet: null }).quiet).toBeNull();
  });
});

describe('ВС-1: срочное не задерживается', () => {
  /**
   * Срочное уходит в тот проход, в котором созрело, что бы ни держало обычное: окно склейки, тихий час, темп нового
   * письма, суточный потолок обычного.
   */
  it('ни склейка, ни тихий час, ни темп, ни потолок обычного его не держат', () => {
    const raid = item({ key: 'raid:m1:1', kind: 'raid', fireAt: NOW, until: NOW + 30 * MIN });
    const waiting = grantItem(1, NOW - MIN);
    const cases: Partial<NotifyRecord>[] = [
      { srv: [waiting] },
      { lastAt: NOW - 1 },
      { day: { date: '2026-09-14', n: DAY_CAP } },
    ];
    for (const over of cases) {
      const p = plan(away({ items: [raid], ...over }), NOW);
      expect(p.letters.map((l) => l.keys), JSON.stringify(over)).toEqual([['raid:m1:1']]);
      expect(p.letters[0].urgent).toBe(true);
    }
    // Ночь — без звука, но сразу.
    const night = msk(3, 0, 1);
    const n = plan(away({ presence: { away: msk(22, 0), beatAt: 0 }, items: [{ ...raid, fireAt: night, until: night + 30 * MIN }] }), night);
    expect(n.letters[0]).toMatchObject({ urgent: true, silent: true });
    // Обычное с тем же временем — ждёт.
    expect(plan(away({ lastAt: NOW - 1, items: [], srv: [grantItem(1, NOW - GLUE_MS)] }), NOW).letters).toEqual([]);
  });

  it('проход: срочное уходит в минуту, когда созрело, обычное рядом — своим чередом', async () => {
    const tg = fakeTg('ok');
    const raid = item({ key: 'raid:m1:1', kind: 'raid', fireAt: NOW, until: NOW + 30 * MIN });
    const io = world(away({ items: [raid], srv: [grantItem(1, NOW)] }), tg);
    await io.due.set(markOf(grantItem(1, NOW), PLAYER), '1');
    const t = await deliverPass(io, NOW);
    expect(t.wouldSend).toBe(1);
    expect(tg.sent).toEqual([{ chat: 4242, text: noticeText(raid, ''), silent: false }]);
    for (let s = NOW + MIN; s <= NOW + GLUE_MS; s += MIN) await deliverPass(io, s);
    expect(tg.sent).toHaveLength(2);
    expect(tg.sent[1].text).toContain('Пришёл указ');
  });
});

describe('ВС-1: очередь отправки без потерь', () => {
  it('процесс упал после того, как взял письмо: аренда кончилась — следующий проход отправляет, ровно один раз', async () => {
    const tg = fakeTg('ok');
    const io = world(away(), tg);
    // «Упавший» проход: письмо взято в очередь и метка аренды стоит, а до Telegram дело не дошло.
    const { claim } = await import('./notify.js');
    const rec = stored(io);
    const taken = claim(rec, plan(rec, NOW).letters, NOW);
    await io.notify.setJSON(PLAYER, taken.record);
    io.due.data.clear();
    await io.due.set(`${String(Math.floor((NOW + LEASE_MS) / MIN)).padStart(9, '0')}/${PLAYER}`, '1');
    // Пока аренда идёт — письмо не трогают: его держит упавший проход.
    expect((await deliverPass(io, NOW + MIN)).wouldSend).toBe(0);
    expect(stored(io).out).toHaveLength(1);
    const t = await deliverPass(io, NOW + LEASE_MS);
    expect(t.wouldSend).toBe(1);
    expect(tg.sent).toHaveLength(1);
    expect(stored(io).out).toEqual([]);
    for (let s = NOW + LEASE_MS + MIN; s < NOW + LEASE_MS + 5 * MIN; s += MIN) await deliverPass(io, s);
    expect(tg.sent).toHaveLength(1);
  });

  it('429 с retry_after: проход перестаёт писать всем, письмо ждёт ровно столько, сколько просили', async () => {
    const tg = fakeTg('retry');
    tg.after = 90_000;
    const io = world(away(), tg);
    const other = 'tg-4343';
    await io.notify.setJSON(other, away());
    await io.due.set(markOf(item(), other), '1');
    const t = await deliverPass(io, NOW);
    expect(t).toMatchObject({ paused: true, retried: 1, wouldSend: 0 });
    // Telegram спросили один раз: второму игроку в этом проходе не писали вовсе.
    expect(tg.sent).toHaveLength(1);
    tg.next = 'ok';
    tg.after = undefined;
    const waitingFor = (key: string) => readNotify(JSON.parse(io.notify.data.get(key)!.value)).out;
    const first = waitingFor(tg.sent[0].chat === 4242 ? PLAYER : other)[0];
    expect(first).toMatchObject({ next: NOW + 90_000, tries: 1, lease: 0 });
    await deliverPass(io, NOW + MIN);
    // Второй игрок ушёл, первый — ещё ждёт.
    expect(tg.sent).toHaveLength(2);
    await deliverPass(io, NOW + 90_000);
    expect(tg.sent).toHaveLength(3);
    expect(waitingFor(PLAYER)).toEqual([]);
    expect(waitingFor(other)).toEqual([]);
  });

  it('правка не вышла (письма нет) — та же весть уходит новым сообщением, нить начинается заново', async () => {
    const tg = fakeTg('gone');
    const sentAt = NOW - 10 * MIN;
    const io = world(
      away({ items: [], srv: [fightItem('w1.2', NOW - GLUE_MS)], threads: { fights: { msg: 77, at: sentAt, n: 1, items: [fightItem('w1.1', sentAt)] } } }),
      tg,
    );
    await io.due.set(markOf(fightItem('w1.2', NOW - GLUE_MS), PLAYER), '1');
    await deliverPass(io, NOW);
    expect(tg.sent[0]).toMatchObject({ edit: 77 });
    expect(stored(io).threads.fights).toBeUndefined();
    tg.next = 'ok';
    await deliverPass(io, NOW + MIN);
    expect(tg.sent).toHaveLength(2);
    expect(tg.sent[1].edit).toBeUndefined();
    expect(tg.sent[1].text.startsWith('2 боя:')).toBe(true);
    expect(stored(io).threads.fights?.msg).toBeGreaterThan(100);
  });

  it('лимиты Telegram: между вызовами — зазор, между сообщениями одному игроку — секунда', async () => {
    const { CHAT_GAP_MS, SEND_GAP_MS } = await import('./deliver.js');
    const tg = fakeTg('ok');
    const two = [item(), item({ key: 'raid:m4:1', kind: 'raid', fireAt: NOW - 30_000 })];
    const io = world(away({ items: two }), tg);
    const other = 'tg-4343';
    await io.notify.setJSON(other, away());
    await io.due.set(markOf(item(), other), '1');
    const waits: number[] = [];
    let t = NOW;
    await deliverPass({ ...io, wait: async (ms) => void waits.push(ms) }, NOW, () => t);
    expect(tg.sent).toHaveLength(3);
    // Часы стоят: каждый следующий вызов ждёт свой зазор — тот же игрок секунду, другой — общий зазор.
    expect(waits).toHaveLength(2);
    expect(Math.max(...waits)).toBeGreaterThanOrEqual(CHAT_GAP_MS);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(SEND_GAP_MS);
    t = NOW;
  });
});

/**
 * Сутки типичной партии испытания (ВС-1, docs/NOTIFY.md, 13.7): сколько сообщений было и сколько стало. Число в документе
 * — отсюда (правило 12): `npx vitest run netlify/lib/notify.test.ts -t "сутки"`.
 *
 * Сутки — с 08:00 до 08:00 по Москве; игрок заходит трижды (08:40–08:55, 12:30–12:40, 20:00–20:30). Сосед осаждает
 * город лагерем с фазами раз в два часа (вылазка, удар и выручка лагерь не снимают), логово ночью шлёт набег, админ
 * выдаёт три указа подряд, три стройки кончаются, чужой лазутчик дважды поджигает склад, сосед зовёт в союз. «Было» —
 * прежнее правило: каждая весть прежних видов — своё сообщение, со звуком в любое время, не больше `DAY_CAP` в сутки
 * игрока. «Стало» — проход доставки этой ветки, раз в минуту.
 */
describe('сутки типичной партии: было и стало', () => {
  const d = (h: number, m = 0) => msk(h < 8 ? h + 24 : h, m, 0);
  const sessions: [number, number][] = [
    [d(8, 40), d(8, 55)],
    [d(12, 30), d(12, 40)],
    [d(20, 0), d(20, 30)],
  ];
  const w = (kind: NoticeItem['kind'], at: number, p: Partial<NoticeItem['p']>, until = at + 12 * 60 * MIN): NoticeItem => ({
    key: `${kind}:${at}`,
    kind,
    fireAt: at,
    until,
    p: { from: 'Бета', fate: 'plunder', about: at, ...p },
  });
  const day: NoticeItem[] = [
    w('war', d(9, 20), { role: 'def', mode: 'siege', about: d(10, 50) }, d(10, 50)),
    w('war-pact', d(9, 45), { pact: 'offer' }),
    w('war-spy', d(11, 15), { role: 'def', fate: 'burn' }),
    w('war-spy', d(11, 20), { role: 'def', fate: 'burn' }),
    grantItem(1, d(13, 5)),
    grantItem(2, d(13, 6)),
    grantItem(3, d(13, 7)),
    w('build', d(14, 0), { from: 'стройка', building: 'smithy', level: 4 }),
    w('war-phase', d(14, 50), { role: 'def', phase: 'breach', k: 2, breaches: 1 }),
    w('war-fight', d(15, 5), { role: 'def', site: 'sortie', by: 'def', won: false }),
    w('war-fight', d(15, 30), { role: 'def', site: 'camp', by: 'def', won: false }),
    w('war-phase', d(16, 50), { role: 'def', phase: 'plague', k: 3 }),
    w('war-parley', d(16, 55), { role: 'def', offer: 'terms', about: d(18, 50) }, d(18, 50)),
    w('war-relief', d(17, 10), { role: 'def', relief: 'going', ally: 'Гамма', about: d(17, 40) }, d(17, 40)),
    w('war-fight', d(17, 40), { role: 'def', site: 'camp', by: 'def', won: false, ally: 'Гамма' }),
    w('war-phase', d(18, 50), { role: 'def', phase: 'breach', k: 5, breaches: 2 }),
    w('war-phase', d(20, 50), { role: 'def', phase: 'short', k: 6, order: 'ration' }),
    w('war-phase', d(22, 50), { role: 'def', phase: 'breach', k: 7, breaches: 3 }),
    w('build', d(23, 30), { from: 'стройка', building: 'farm', level: 3 }),
    w('raid', d(2, 10), { from: 'Волчья падь', about: d(2, 50) }, d(2, 50)),
    w('raid-fight', d(2, 50), { from: 'Волчья падь' }),
    w('build', d(6, 30), { from: 'стройка', building: 'walls', level: 5 }),
  ];
  const awayAt = (t: number): number | null => {
    let last = msk(7, 0);
    for (const [a, b] of sessions) {
      if (t >= a && t < b) return null;
      if (t >= b) last = b;
    }
    return last;
  };

  it('сутки осады: было 14 сообщений и 2 срезал потолок, ночью со звуком 2; стало 14 и 2 правки, ночью со звуком ни одного', async () => {
    // Было: прежние виды, по сообщению на весть, ушедшему до вести; потолок `DAY_CAP` на сутки игрока.
    const OLD = new Set(['raid', 'raid-fight', 'siege-fall', 'siege-phase', 'war', 'war-fight', 'war-fall', 'war-spy', 'war-phase', 'war-parley', 'war-pact', 'war-relief']);
    const perDate = new Map<string, number>();
    let before = 0;
    let beforeNight = 0;
    let cut = 0;
    for (const i of day) {
      const away = awayAt(i.fireAt);
      if (!OLD.has(i.kind) || away === null || i.fireAt < away + SEEN_GRACE) continue;
      const date = new Date(i.fireAt + 3 * 3600_000).toISOString().slice(0, 10);
      if ((perDate.get(date) ?? 0) >= DAY_CAP) {
        cut++;
        continue;
      }
      perDate.set(date, (perDate.get(date) ?? 0) + 1);
      before++;
      if (inQuiet(i.fireAt, '', { from: 23 * 60, to: 8 * 60 })) beforeNight++;
    }

    // Стало: тот же день проходом доставки раз в минуту.
    const tg = fakeTg('ok');
    const io = world({ ...emptyNotify(), presence: { away: msk(7, 0), beatAt: msk(7, 0) } }, tg);
    const at: number[] = [];
    for (let t = d(8, 0); t <= d(8, 0) + 24 * 60 * MIN; t += MIN) {
      const away = awayAt(t);
      let rec = stored(io);
      if ((away === null) !== (rec.presence.away === null)) {
        rec = accept(rec, { present: away === null }, PLAYER, away === null ? t : away).record;
        await io.notify.setJSON(PLAYER, rec);
      }
      const fresh = day.filter((i) => i.fireAt <= t && i.fireAt > t - MIN);
      if (fresh.length) {
        const n = news(stored(io), fresh, [], PLAYER, t);
        await io.notify.setJSON(PLAYER, n.record);
        for (const m of n.marks) await io.due.set(m, '1');
      }
      await deliverPass(io, t);
      while (at.length < tg.sent.length) at.push(t);
    }
    const sent = tg.sent.map((m, i) => ({ ...m, at: at[i] }));
    const fresh = sent.filter((m) => m.edit === undefined);
    const edits = sent.filter((m) => m.edit !== undefined);
    const after = {
      fresh: fresh.length,
      edits: edits.length,
      urgent: fresh.filter((m) => day.some((i) => tierOf(i) === 'urgent' && m.text === noticeText(i, ''))).length,
      // Новые роды — стройка и указы: их прежде не было вовсе.
      newKinds: fresh.filter((m) => /^(\d+ указ|Пришёл указ|Достроили|Достроено)/.test(m.text)).length,
      silent: fresh.filter((m) => m.silent).length,
      loudNight: fresh.filter((m) => !m.silent && inQuiet(m.at, '', { from: 23 * 60, to: 8 * 60 })).length,
    };
    console.log(`СУТКИ: было ${before} (срезано потолком ${cut}, ночью со звуком ${beforeNight}); стало ${JSON.stringify(after)}`);
    for (const m of sent) console.log(`  ${clock(m.at, '')} ${m.edit ? 'правка' : m.silent ? 'тихо ' : 'новое '} | ${m.text.split('\n')[0]}`);
    expect({ before, cut, beforeNight }).toEqual({ before: 14, cut: 2, beforeNight: 2 });
    expect(after).toEqual({ fresh: 14, edits: 2, urgent: 7, newKinds: 2, silent: 1, loudNight: 0 });
  });
});
