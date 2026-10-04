import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blobsStores } from '../lib/blobs.js';
import { ALL_STORES, STORES, type Stores } from '../lib/kv.js';
import { ROUTES } from '../lib/routes/index.js';
import type { DatabaseSync } from './driver.js';
import { importBlobs } from './import.js';
import { countRows, openDb, sqliteStores } from './sqlite.js';
import { TEST_TOKEN, localBlobs, signInit, tempDir } from './testkit.js';

/**
 * Перенос Netlify Blobs → SQLite на местном сервере Blobs. Главное утверждение — не «строки на
 * месте», а «игрок не заметил переезда»: клиент, записавший партию на Netlify, пишет следующую
 * на свой сервер поверх того же ETag и получает 200, а не 409 с «чужой» партией.
 */
const NOW = 1_800_000_000_000;
let stop: () => Promise<void>;
let netlify: Stores;
let dir: string;

const fresh = (): DatabaseSync => openDb(join(tempDir('import-db'), 'tribe.sqlite'));

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  const local = await localBlobs();
  stop = local.stop;
  netlify = blobsStores(local.site);
  dir = tempDir('import');
  // Партия игрока легла на Netlify тем же обработчиком, что и в бою.
  const rec = { v: 1, rev: 0, updatedAt: 0, device: 'd', game: '{"pop":30}', world: null, card: {} };
  const res = await ROUTES['/api/save'](
    new Request('http://t/api/save', {
      method: 'PUT',
      headers: { 'x-telegram-init-data': signInit(7001, NOW / 1000 - 60) },
      body: JSON.stringify({ baseEtag: null, record: rec }),
    }),
    { stores: netlify, now: NOW, ip: null },
  );
  expect(res.status).toBe(200);
  await netlify(STORES.world).setJSON('roster', { v: 1, epoch: 0, rows: {} });
  await netlify(STORES.notify).setJSON('tg-7001', { v: 1 });
  await netlify(STORES.due).set('000000123/tg-7001', '1');
  await netlify(STORES.stats).setJSON('2026-10-04/03:30:00.000', { at: NOW });
});

afterAll(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('перенос Netlify Blobs → SQLite', () => {
  it('переносит все хранилища — строка в строку и ETag в ETag', async () => {
    const db = fresh();
    const tally = await importBlobs(netlify, db, { replace: false, dryRun: false, now: NOW });
    expect(tally.total).toBe(5);
    expect(tally.noEtag).toBe(0);
    expect(tally.missing).toBe(0);
    expect(Object.keys(tally.stores).sort()).toEqual([...ALL_STORES].sort());
    const local = sqliteStores(db);
    for (const store of ALL_STORES) {
      const { blobs } = await netlify(store).list({});
      for (const { key } of blobs) {
        expect(await local(store).getWithMetadata(key), `${store}/${key}`).toEqual(await netlify(store).getWithMetadata(key));
      }
    }
    db.close();
  });

  it('игрок переезда не замечает: следующая запись поверх ETag с Netlify ложится, а не 409', async () => {
    const db = fresh();
    await importBlobs(netlify, db, { replace: false, dryRun: false, now: NOW });
    const auth = { 'x-telegram-init-data': signInit(7001, NOW / 1000) };
    // Что клиент помнит: ETag своей последней записи — на Netlify.
    const onNetlify = (await (await ROUTES['/api/save'](new Request('http://t/api/save', { headers: auth }), { stores: netlify, now: NOW, ip: null })).json()) as { etag: string };
    const rec = { v: 1, rev: 1, updatedAt: 0, device: 'd', game: '{"pop":31}', world: null, card: {} };
    const res = await ROUTES['/api/save'](
      new Request('http://t/api/save', { method: 'PUT', headers: auth, body: JSON.stringify({ baseEtag: onNetlify.etag, record: rec }) }),
      { stores: sqliteStores(db), now: NOW + 60_000, ip: null },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rev: number }).rev).toBe(2);
    db.close();
  });

  it('пробный прогон считает и ничего не пишет', async () => {
    const db = fresh();
    const tally = await importBlobs(netlify, db, { replace: false, dryRun: true, now: NOW });
    expect(tally.total).toBe(5);
    expect(countRows(db)).toBe(0);
    db.close();
  });

  it('непустая база без --replace — отказ; с --replace — прежнее снято, перенесённое на месте', async () => {
    const db = fresh();
    await sqliteStores(db)(STORES.saves).setJSON('tg-9999', { stale: true });
    await expect(importBlobs(netlify, db, { replace: false, dryRun: false, now: NOW })).rejects.toThrow(/--replace/);
    expect(countRows(db)).toBe(1);
    await importBlobs(netlify, db, { replace: true, dryRun: false, now: NOW });
    expect(countRows(db)).toBe(5);
    expect(await sqliteStores(db)(STORES.saves).getWithMetadata('tg-9999')).toBeNull();
    db.close();
  });
});
