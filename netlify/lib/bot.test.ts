import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botWith } from './routes/bot.js';
import { readNotify } from './notify.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { telegram, type PanelButton, type Telegram } from './telegram.js';
import { APP_URL, appUrl } from './http.js';
import {
  BUTTON_OFF,
  BUTTON_ON,
  BUTTON_OPEN,
  BUTTON_SETUP,
  CALLBACK_MENU,
  CALLBACK_OFF,
  CALLBACK_ON,
  CALLBACK_PANEL_OFF,
  CALLBACK_PANEL_ON,
  CALLBACK_QUIET,
  CALLBACK_URGENT,
  SAVED,
  SWITCHED_OFF,
  SWITCHED_ON,
  callbackTopic,
} from './words.js';

/**
 * Вебхук бота (`/api/bot`) — дверь, где личность приходит не из подписи `initData`, а из обновления Telegram
 * (docs/NOTIFY.md, раздел 12). Тесты только там, где без них можно открыть чужое: без верного секрета не трогается
 * ничего, а нажатие кнопки переключает рычаг ровно того, кто нажал.
 */
const SECRET = 'test-secret_0123';
const NOW = 1_900_000_000_000;

function memoryStores() {
  const data = new Map<string, Map<string, { value: string; etag: string }>>();
  let n = 0;
  const kv = (name: string): Kv => {
    const m = data.get(name) ?? new Map();
    data.set(name, m);
    return {
      async getWithMetadata(key) {
        const v = m.get(key);
        return v ? { data: v.value, etag: v.etag } : null;
      },
      async setJSON(key, value, opts) {
        const had = m.get(key);
        if (opts?.onlyIfNew && had) return { modified: false };
        if (opts?.onlyIfMatch && had?.etag !== opts.onlyIfMatch) return { modified: false };
        const etag = `e${++n}`;
        m.set(key, { value: JSON.stringify(value), etag });
        return { modified: true, etag };
      },
      async set(key, value) {
        m.set(key, { value, etag: `e${++n}` });
      },
      async list() {
        return { blobs: [...m.keys()].map((key) => ({ key })), directories: [] };
      },
      async delete(key) {
        m.delete(key);
      },
    };
  };
  const stores: Stores = (name) => kv(name);
  return { stores, data };
}

function fakeTg() {
  const calls: string[] = [];
  const panels: { chat: number; text: string; rows: PanelButton[][]; message?: number }[] = [];
  const tg: Telegram = {
    async letter() {
      calls.push('letter');
      return { result: 'ok' };
    },
    async edit() {
      calls.push('edit');
      return { result: 'ok' };
    },
    async answer(_id, text) {
      calls.push(`answer:${text}`);
      return 'ok';
    },
    async button(chat, message) {
      calls.push(`button:${chat}:${message}`);
      return 'ok';
    },
    async panel(chat, text, rows) {
      calls.push(`panel:${chat}`);
      panels.push({ chat, text, rows });
      return 'ok';
    },
    async repanel(chat, message, text, rows) {
      calls.push(`repanel:${chat}:${message}`);
      panels.push({ chat, text, rows, message });
      return 'ok';
    },
    async say(chat, text) {
      calls.push(`say:${chat}:${text}`);
      return 'ok';
    },
    async file(chat, name) {
      calls.push(`file:${chat}:${name}`);
      return 'ok';
    },
    async greet(chat, text) {
      calls.push(`greet:${chat}:${text}`);
      return 'ok';
    },
    async checkout(id, ok, error) {
      calls.push(`checkout:${id}:${ok}:${error}`);
      return 'ok';
    },
  };
  return { tg, calls, panels };
}

const press = (from: number, data: string) => ({
  update_id: 1,
  callback_query: { id: 'cb1', from: { id: from }, data, message: { message_id: 55, chat: { id: from, type: 'private' } } },
});

async function hit(body: unknown, secret: string | null, s = memoryStores(), t = fakeTg()) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret;
  const req = new Request('https://x/api/bot', { method: 'POST', headers, body: JSON.stringify(body) });
  const res = await botWith(() => t.tg)(req, { stores: s.stores, now: NOW, ip: null });
  return { res, s, t, record: (player: string) => {
    const v = s.data.get(STORES.notify)?.get(player);
    return v ? readNotify(JSON.parse(v.value)) : null;
  } };
}

describe('вебхук бота', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('без секрета в окружении закрыт для всех; чужой или пустой заголовок — 401, хранилище не тронуто', async () => {
    for (const secret of [null, '', 'wrong', `${SECRET}x`]) {
      const r = await hit(press(77, CALLBACK_OFF), secret);
      expect(r.res.status, String(secret)).toBe(401);
      expect(r.s.data.size, String(secret)).toBe(0);
      expect(r.t.calls).toEqual([]);
    }
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const open = await hit(press(77, CALLBACK_OFF), '');
    expect(open.res.status).toBe(401);
    expect(open.s.data.size).toBe(0);
  });

  /**
   * Прежний рычаг под старыми сообщениями (до ВС-1) по-прежнему работает: выключает и включает вести нажавшего. Ряд под
   * сообщением после нажатия — нынешний: «Открыть игру» и «Настроить вести».
   */
  it('прежний «Отключить» под старой вестью выключает рычаг нажавшего; «Включить» — обратно', async () => {
    const off = await hit(press(77, CALLBACK_OFF), SECRET);
    expect(off.res.status).toBe(200);
    expect(off.record('tg-77')?.prefs.on).toBe(false);
    expect(off.t.calls).toEqual([`answer:${SWITCHED_OFF}`, 'button:77:55']);
    const on = await hit(press(77, CALLBACK_ON), SECRET, off.s);
    expect(on.record('tg-77')?.prefs.on).toBe(true);
    expect(on.record('tg-77')?.chan.state).toBe('open');
    expect(on.t.calls).toEqual([`answer:${SWITCHED_ON}`, 'button:77:55']);
    // Ничьей другой записи не появилось.
    expect([...(on.s.data.get(STORES.notify)?.keys() ?? [])]).toEqual(['tg-77']);
  });

  it('бот заблокирован — канал закрыт; снова «Старт» — открыт; группы не трогают ничего', async () => {
    const member = (status: string, type = 'private') => ({
      update_id: 2,
      my_chat_member: { chat: { id: 77, type }, from: { id: 77 }, new_chat_member: { status } },
    });
    const kicked = await hit(member('kicked'), SECRET);
    expect(kicked.record('tg-77')?.chan.state).toBe('closed');
    const back = await hit(member('member'), SECRET, kicked.s);
    expect(back.record('tg-77')?.chan.state).toBe('open');
    const group = await hit(member('kicked', 'group'), SECRET);
    expect(group.s.data.size).toBe(0);
  });

  it('чужие данные кнопки и кривой отправитель — 200 и тишина', async () => {
    for (const body of [press(77, 'notify:all'), press(-5, CALLBACK_OFF), press(1.5, CALLBACK_OFF), { message: { text: '/start' } }, 'мусор']) {
      const r = await hit(body, SECRET);
      expect(r.res.status).toBe(200);
      expect(r.s.data.size).toBe(0);
      expect(r.t.calls).toEqual([]);
    }
  });
});

describe('кнопки под сообщением: «Открыть игру» и рычаг (решение владельца 06.10.2026)', () => {
  /**
   * Кривая разметка кнопок — 400 от Telegram на каждое сообщение: всё ушло бы в «потеряно» молча. Поэтому держится форма
   * того, что уходит в Bot API, — на настоящем адаптере с подменённым `fetch`.
   */
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  });
  afterEach(() => {
    if (TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  });

  async function sent(run: (t: Telegram) => Promise<unknown>): Promise<{ method: string; body: Record<string, unknown> }> {
    const got: { method: string; body: Record<string, unknown> }[] = [];
    await run(
      telegram(async (url, init) => {
        got.push({ method: url.split('/').pop() as string, body: JSON.parse(init.body) as Record<string, unknown> });
        return { status: 200 };
      }),
    );
    expect(got).toHaveLength(1);
    return got[0];
  }

  it('весть — одним рядом: «Открыть игру» (web_app, HTTPS) и «Настроить вести»; правка и прежний рычаг ряд не теряют', async () => {
    const row = { inline_keyboard: [[{ text: BUTTON_OPEN, web_app: { url: appUrl() } }, { text: BUTTON_SETUP, callback_data: CALLBACK_MENU }]] };
    const msg = await sent((t) => t.letter(77, 'Набег идёт', false));
    expect(msg.method).toBe('sendMessage');
    expect(msg.body).toMatchObject({ chat_id: 77, text: 'Набег идёт', disable_notification: false, reply_markup: row });
    const hush = await sent((t) => t.letter(77, 'Набег идёт', true));
    expect(hush.body.disable_notification).toBe(true);
    const edit = await sent((t) => t.edit(77, 55, '2 боя:'));
    expect(edit.method).toBe('editMessageText');
    expect(edit.body).toMatchObject({ chat_id: 77, message_id: 55, text: '2 боя:', reply_markup: row });
    const legacy = await sent((t) => t.button(77, 55));
    expect(legacy.method).toBe('editMessageReplyMarkup');
    expect(legacy.body.reply_markup).toEqual(row);
  });

  /** Ответ Telegram читается: номер нового сообщения — для правки; `retry_after` — для очереди; «нечего менять» — не отказ. */
  it('ответ Telegram: номер сообщения, retry_after, отказ правки', async () => {
    const reply = (status: number, body: unknown) =>
      telegram(async () => ({ status, json: async () => body }));
    expect(await reply(200, { ok: true, result: { message_id: 901 } }).letter(77, 'x', false)).toEqual({ result: 'ok', msg: 901 });
    expect(await reply(429, { ok: false, parameters: { retry_after: 7 } }).letter(77, 'x', false)).toEqual({ result: 'retry', after: 7000 });
    expect(await reply(403, {}).letter(77, 'x', false)).toEqual({ result: 'closed' });
    expect(await reply(400, { description: 'Bad Request: message is not modified: specified new message content' }).edit(77, 5, 'x')).toEqual({ result: 'ok' });
    expect(await reply(400, { description: 'Bad Request: message to edit not found' }).edit(77, 5, 'x')).toEqual({ result: 'gone' });
    // Тело не читается — итог по коду, без номера.
    expect(await telegram(async () => ({ status: 200 })).letter(77, 'x', false)).toEqual({ result: 'ok' });
    expect(await telegram(async () => Promise.reject(new Error('сеть'))).letter(77, 'x', false)).toEqual({ result: 'retry' });
  });

  it('адрес игры — из TRIBE_APP_URL, только HTTPS; нет или кривой — боевой адрес', () => {
    expect(APP_URL).toMatch(/^https:\/\//);
    expect(appUrl({})).toBe(APP_URL);
    expect(appUrl({ TRIBE_APP_URL: 'https://game.example.ru' })).toBe('https://game.example.ru');
    expect(appUrl({ TRIBE_APP_URL: 'http://game.example.ru' })).toBe(APP_URL);
    expect(appUrl({ TRIBE_APP_URL: 'javascript:alert(1)' })).toBe(APP_URL);
    expect(appUrl({ TRIBE_APP_URL: '  ' })).toBe(APP_URL);
  });
});

describe('настройки вестей в боте: /notify (ВС-1)', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  const say = (from: number, text: string, chat = from, type = 'private') => ({ update_id: 3, message: { text, from: { id: from }, chat: { id: chat, type } } });
  const datas = (rows: PanelButton[][]) => rows.flat().map((b) => b.act);

  it('/notify — настройки тому, кто написал, и только в личном чате; ничего не пишется', async () => {
    const r = await hit(say(77, '/notify'), SECRET);
    expect(r.t.calls).toEqual(['panel:77']);
    expect(r.s.data.get(STORES.notify)?.size ?? 0).toBe(0);
    const panel = r.t.panels[0];
    expect(panel.text).toContain('Бот пишет о боях, осадах, стройке, указах и соседях.');
    expect(panel.text).toContain('Тихий час: 23:00–08:00 (Europe/Moscow)');
    expect(datas(panel.rows)).toEqual([
      callbackTopic('fights'),
      callbackTopic('sieges'),
      callbackTopic('build'),
      callbackTopic('grants'),
      callbackTopic('neighbors'),
      CALLBACK_QUIET,
      CALLBACK_URGENT,
      CALLBACK_PANEL_OFF,
    ]);
    // В группе и от чужого имени — тишина.
    for (const body of [say(77, '/notify', -100, 'group'), say(77, '/notify', 78)]) {
      const g = await hit(body, SECRET);
      expect(g.t.calls).toEqual([]);
      expect(g.s.data.size).toBe(0);
    }
  });

  it('«Настроить вести» под вестью — настройки новым сообщением', async () => {
    const r = await hit(press(77, CALLBACK_MENU), SECRET);
    expect(r.t.calls).toEqual(['answer:', 'panel:77']);
  });

  it('кнопки настроек меняют запись нажавшего и то же сообщение: род, тихий час, только срочное, рычаг', async () => {
    const a = await hit(press(77, callbackTopic('build')), SECRET);
    expect(a.record('tg-77')?.bot.mute).toEqual(['build']);
    expect(a.t.calls).toEqual([`answer:${SAVED}`, 'repanel:77:55']);
    expect(a.t.panels[0].text).toContain('Бот пишет о боях, осадах, указах и соседях.');
    expect(a.t.panels[0].rows[0][2].text).toBe('Стройка: нет');
    const b = await hit(press(77, CALLBACK_QUIET), SECRET, a.s);
    expect(b.record('tg-77')?.bot.quiet).toEqual({ from: 22 * 60, to: 7 * 60 });
    const c = await hit(press(77, CALLBACK_URGENT), SECRET, b.s);
    expect(c.record('tg-77')?.bot.urgent).toBe(true);
    expect(c.t.panels[0].text).toContain('Только срочное');
    const d = await hit(press(77, CALLBACK_PANEL_OFF), SECRET, c.s);
    expect(d.record('tg-77')?.prefs.on).toBe(false);
    expect(d.t.calls).toEqual([`answer:${SWITCHED_OFF}`, 'repanel:77:55']);
    expect(datas(d.t.panels[0].rows)).toContain(CALLBACK_PANEL_ON);
    expect(d.t.panels[0].rows.flat().map((x) => x.text)).toContain(BUTTON_ON);
    const e = await hit(press(77, CALLBACK_PANEL_ON), SECRET, d.s);
    expect(e.record('tg-77')?.prefs.on).toBe(true);
    expect(e.t.panels[0].rows.flat().map((x) => x.text)).toContain(BUTTON_OFF);
    // Настройки остались у нажавшего, и только у него.
    expect(e.record('tg-77')?.bot).toEqual({ mute: ['build'], urgent: true, quiet: { from: 22 * 60, to: 7 * 60 } });
    expect([...(e.s.data.get(STORES.notify)?.keys() ?? [])]).toEqual(['tg-77']);
  });

  it('чужие данные кнопки — 200 и тишина', async () => {
    for (const data of ['notify:t:all', 'notify:t:__proto__', 'notify:p:maybe', 'notify:quiet:3', 'constructor']) {
      const r = await hit(press(77, data), SECRET);
      expect(r.res.status, data).toBe(200);
      expect(r.s.data.size, data).toBe(0);
      expect(r.t.calls, data).toEqual([]);
    }
  });
});
