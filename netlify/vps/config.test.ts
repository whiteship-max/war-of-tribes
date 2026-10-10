import { describe, expect, it } from 'vitest';
import { DEFAULTS, ENV, launchNotes, readConfig } from './config.js';

describe('настройки своего сервера', () => {
  it('пустое окружение — умолчания: SQLite в /data, копия в 03:30 UTC, 14 копий, доставка выключена', () => {
    const { config, problems } = readConfig({});
    expect(problems).toEqual([]);
    expect(config).toEqual({
      port: 8080,
      store: 'sqlite',
      dataDir: '/data',
      backupKeep: 14,
      backupAt: 210,
      deliver: false,
      netlify: null,
    });
    expect(config.backupKeep).toBe(DEFAULTS.backupKeep);
  });

  it('опечатка владельца — остановка с причиной, а не молчаливое умолчание', () => {
    const { problems } = readConfig({ TRIBE_STORE: 'sqlit', BACKUP_AT: '3.30', BACKUP_KEEP: 'две', TRIBE_DELIVER: 'yes', PORT: '99999' });
    expect(problems).toHaveLength(5);
    for (const name of ['TRIBE_STORE', 'BACKUP_AT', 'BACKUP_KEEP', 'TRIBE_DELIVER', 'PORT']) {
      expect(problems.some((p) => p.startsWith(name)), name).toBe(true);
    }
  });

  it('Blobs без сайта и токена Netlify — остановка', () => {
    expect(readConfig({ TRIBE_STORE: 'blobs' }).problems).toEqual([expect.stringMatching(/NETLIFY_SITE_ID/)]);
    const ok = readConfig({ TRIBE_STORE: 'blobs', NETLIFY_SITE_ID: 'site', NETLIFY_AUTH_TOKEN: 'tok' });
    expect(ok.problems).toEqual([]);
    expect(ok.config.netlify).toEqual({ siteID: 'site', token: 'tok' });
  });

  it('BACKUP_AT — минута суток', () => {
    expect(readConfig({ BACKUP_AT: '00:00' }).config.backupAt).toBe(0);
    expect(readConfig({ BACKUP_AT: '23:59' }).config.backupAt).toBe(1439);
    expect(readConfig({ BACKUP_AT: '24:00' }).problems).toHaveLength(1);
  });

  /** Токен бота читается в одном месте на оба дома — `lib/http.botToken`, а не здесь. */
  it('токена бота среди настроек нет', () => {
    expect(Object.values(ENV)).not.toContain('TELEGRAM_BOT_TOKEN');
  });
});

describe('строки запуска', () => {
  it('пустой секрет вебхука и пустые админы — предупреждение словами', () => {
    const quiet = launchNotes({ secret: false, admins: 0, spawn: 'sicily', pace: 60, pay: false, deliver: true });
    expect(quiet.filter((l) => l.startsWith('внимание:'))).toHaveLength(2);
    expect(quiet.join('\n')).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
    expect(quiet.join('\n')).toMatch(/ADMIN_IDS/);
    expect(quiet.at(-1)).toBe('режим: места sicily, темп войны ×60, админов 0, оплата выключена, доставка уведомлений включена');
    const ready = launchNotes({ secret: true, admins: 2, spawn: null, pace: 1, pay: true, deliver: false });
    expect(ready.some((l) => l.startsWith('внимание:'))).toBe(false);
  });
});
