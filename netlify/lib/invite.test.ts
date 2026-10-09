import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORES } from './kv.js';
import { ROUTES } from './routes/index.js';
import { invitedBy, readWatchRecord } from './watch.js';
import { statsCsv } from './commands.js';
import { refCode } from '../../src/game/data/social.js';
import { TEST_TOKEN, sqliteHome, type Home } from '../vps/testkit.js';

/**
 * Кто кого привёл (docs/feed.md, раздел 3): метка пригласившего — из подписанного `start_param` ссылки приглашения, только
 * на первом заходе и только в статистику админа. Наград нет: поля награды нет нигде.
 */
const NOW = 1_800_000_000_000;

/** Подписанная строка запуска с параметром ссылки — тем же алгоритмом, что у Telegram. */
function signWith(id: number, start?: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(NOW / 1000) - 60),
    query_id: 'AAF',
    user: JSON.stringify({ id, first_name: 'Вождь' }),
    ...(start ? { start_param: start } : {}),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TEST_TOKEN).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

describe('код приглашения', () => {
  it('код игры читается обратно в ключ пригласившего; свой и чужой формат — не приглашение', () => {
    expect(invitedBy(refCode(123456789), 'tg-5')).toBe('tg-123456789');
    expect(invitedBy(refCode(5), 'tg-5')).toBeNull();
    for (const bad of [undefined, '', 'x123', 'r', 'r-1', 'rABC', `r${'z'.repeat(12)}`]) expect(invitedBy(bad, 'tg-5')).toBeNull();
  });
});

describe('метка пригласившего на сервере', () => {
  let home: Home;
  let saved: string | undefined;
  beforeEach(() => {
    home = sqliteHome();
    saved = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
    await home.close();
  });

  const visit = async (id: number, start?: string, at = NOW): Promise<number> => {
    const req = new Request('https://x/api/save', { headers: { 'x-telegram-init-data': signWith(id, start) } });
    return (await ROUTES['/api/save'](req, { stores: home.stores, now: at, ip: null })).status;
  };
  const watch = async (id: number) => readWatchRecord(JSON.parse(String((await home.stores(STORES.watch).getWithMetadata(`tg-${id}`))!.data)));

  it('первый заход по ссылке кладёт метку; следующий заход по другой ссылке её не меняет', async () => {
    expect(await visit(2, refCode(1))).toBe(200);
    expect((await watch(2)).ref).toBe('tg-1');
    await visit(2, refCode(3), NOW + 60_000);
    expect((await watch(2)).ref).toBe('tg-1');
  });

  it('старый игрок, пришедший по ссылке, приглашённым не становится', async () => {
    await visit(4);
    await visit(4, refCode(1), NOW + 60_000);
    expect((await watch(4)).ref).toBeUndefined();
  });

  it('метка видна админу столбцом «пригласил» в /stats', async () => {
    // Свой номер: сито частоты запросов помнит игрока между тестами.
    expect(await visit(6, refCode(1))).toBe(200);
    const csv = statsCsv([{ key: 'tg-6', rec: await watch(6) }], { v: 1, keys: {} });
    const [head, row] = csv.replace('﻿', '').trim().split('\r\n').map((l) => l.split(';'));
    expect(row[head.indexOf('пригласил')]).toBe('1');
  });
});
