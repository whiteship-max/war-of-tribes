import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botWith } from './routes/bot.js';
import { readNotify } from './notify.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { telegram, type Telegram } from './telegram.js';
import { APP_URL, appUrl } from './http.js';
import { BUTTON_OFF, BUTTON_ON, BUTTON_OPEN, CALLBACK_OFF, CALLBACK_ON, SWITCHED_OFF, SWITCHED_ON } from './words.js';

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
  const tg: Telegram = {
    async send() {
      calls.push('send');
      return 'ok';
    },
    async answer(_id, text) {
      calls.push(`answer:${text}`);
      return 'ok';
    },
    async button(chat, message, on) {
      calls.push(`button:${chat}:${message}:${on ? 'off-button' : 'on-button'}`);
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
  };
  return { tg, calls };
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

  it('«Отключить» выключает рычаг нажавшего и меняет кнопку на «Включить»; «Включить» — обратно', async () => {
    const off = await hit(press(77, CALLBACK_OFF), SECRET);
    expect(off.res.status).toBe(200);
    expect(off.record('tg-77')?.prefs.on).toBe(false);
    expect(off.t.calls).toEqual([`answer:${SWITCHED_OFF}`, 'button:77:55:on-button']);
    const on = await hit(press(77, CALLBACK_ON), SECRET, off.s);
    expect(on.record('tg-77')?.prefs.on).toBe(true);
    expect(on.record('tg-77')?.chan.state).toBe('open');
    expect(on.t.calls).toEqual([`answer:${SWITCHED_ON}`, 'button:77:55:off-button']);
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

  it('сообщение — одним рядом: «Открыть игру» (web_app, HTTPS) и «Отключить»; смена рычага ряд не теряет', async () => {
    const msg = await sent((t) => t.send(77, 'Набег идёт'));
    expect(msg.method).toBe('sendMessage');
    expect(msg.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: BUTTON_OPEN, web_app: { url: appUrl() } }, { text: BUTTON_OFF, callback_data: CALLBACK_OFF }]],
    });
    const off = await sent((t) => t.button(77, 55, false));
    expect(off.method).toBe('editMessageReplyMarkup');
    expect(off.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: BUTTON_OPEN, web_app: { url: appUrl() } }, { text: BUTTON_ON, callback_data: CALLBACK_ON }]],
    });
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
