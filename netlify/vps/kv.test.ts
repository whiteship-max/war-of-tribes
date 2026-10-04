import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORES, type Kv } from '../lib/kv.js';
import { blobsHome, sqliteHome, type Home } from './testkit.js';

/**
 * Дверь хранилища на двух домах — один набор утверждений. Главное из них — условная запись: на ней
 * держится ответ 409 вместо молча затёртой партии (`routes/save.ts`). Дом, который пишет поверх
 * устаревшего ETag, отличается от правильного только тем, что теряет партии, — поэтому каждое
 * утверждение здесь проверяется на обоих, а не на одном «эталонном».
 */
describe.each([
  ['SQLite', sqliteHome],
  ['Netlify Blobs', blobsHome],
] as const)('хранилище: %s', (_name, make) => {
  let home: Home;
  let kv: Kv;
  beforeAll(async () => {
    home = await make();
    kv = home.stores(STORES.saves);
  });
  afterAll(async () => home.close());

  it('нет ключа — null, а не исключение', async () => {
    expect(await kv.getWithMetadata('tg-404')).toBeNull();
  });

  it('«только в пустое место» пишет один раз', async () => {
    const first = await kv.setJSON('tg-1', { rev: 1 }, { onlyIfNew: true });
    expect(first.modified).toBe(true);
    expect(typeof first.etag).toBe('string');
    await home.settle();
    const got = await kv.getWithMetadata('tg-1');
    expect(got).toEqual({ data: '{"rev":1}', etag: first.etag });

    const second = await kv.setJSON('tg-1', { rev: 99 }, { onlyIfNew: true });
    expect(second.modified).toBe(false);
    expect((await kv.getWithMetadata('tg-1'))?.data).toBe('{"rev":1}');
  });

  it('«поверх ровно этой версии»: своя версия — пишет и меняет ETag, чужая — не пишет ничего', async () => {
    const base = await kv.setJSON('tg-2', { rev: 1 }, { onlyIfNew: true });
    await home.settle();
    const next = await kv.setJSON('tg-2', { rev: 2 }, { onlyIfMatch: base.etag });
    expect(next.modified).toBe(true);
    expect(next.etag).not.toBe(base.etag);
    await home.settle();

    // Второй писатель, прочитавший ту же базу, проигрывает — молча затереть нельзя.
    const stale = await kv.setJSON('tg-2', { rev: 3 }, { onlyIfMatch: base.etag });
    expect(stale.modified).toBe(false);
    expect(await kv.getWithMetadata('tg-2')).toEqual({ data: '{"rev":2}', etag: next.etag });
  });

  it('«поверх версии» в пустое место не пишет', async () => {
    const w = await kv.setJSON('tg-3', { rev: 1 }, { onlyIfMatch: '"no-such-etag"' });
    expect(w.modified).toBe(false);
    expect(await kv.getWithMetadata('tg-3')).toBeNull();
  });

  it('запись без условий ложится поверх любой', async () => {
    await kv.setJSON('tg-4', { a: 1 });
    await home.settle();
    await kv.set('tg-4', 'строка как есть');
    expect((await kv.getWithMetadata('tg-4'))?.data).toBe('строка как есть');
  });

  it('хранилища друг друга не видят', async () => {
    const other = home.stores(STORES.notify);
    await other.setJSON('tg-5', { notify: true });
    expect(await kv.getWithMetadata('tg-5')).toBeNull();
    expect((await other.getWithMetadata('tg-5'))?.data).toBe('{"notify":true}');
  });

  it('перечисление: приставка и папки — как у Blobs', async () => {
    const due = home.stores(STORES.due);
    for (const key of ['loose', '000100/tg-1', '000100/tg-2', '000101/tg-1']) await due.set(key, '1');
    const keys = (r: { blobs: { key: string }[] }): string[] => r.blobs.map((b) => b.key).sort();

    const flat = await due.list({});
    expect(keys(flat)).toEqual(['000100/tg-1', '000100/tg-2', '000101/tg-1', 'loose']);
    expect(flat.directories).toEqual([]);

    const top = await due.list({ directories: true });
    expect(keys(top)).toEqual(['loose']);
    expect([...top.directories].sort()).toEqual(['000100', '000101']);

    const one = await due.list({ prefix: '000100/' });
    expect(keys(one)).toEqual(['000100/tg-1', '000100/tg-2']);
  });

  it('удаление: было — нет; удалить отсутствующее — не ошибка', async () => {
    await kv.set('tg-6', 'x');
    await kv.delete('tg-6');
    expect(await kv.getWithMetadata('tg-6')).toBeNull();
    await expect(kv.delete('tg-6')).resolves.toBeUndefined();
  });
});
