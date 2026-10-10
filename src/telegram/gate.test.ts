// Играть можно только в Telegram, а стенды и отчёты работают как раньше (`telegram/gate.ts`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localHost, telegramOnly, type Launch } from './gate';
import { BOT_URL } from '@/game/data/social';

const at = (host: string, more: Partial<Launch> = {}): Launch => ({ host, hash: '', initData: null, probe: false, ...more });

const SIGNED = 'query_id=AAE&user=%7B%22id%22%3A1%7D&auth_date=1&hash=ab';

describe('заслон: вне Telegram вместо игры — экран со ссылкой на бота', () => {
  it('боевой адрес и запасной Netlify без подписи — экран, а не игра', () => {
    for (const host of ['game.kingsvassals.com', 'celebrated-yeot-73e410.netlify.app', '169.58.98.192'])
      expect(telegramOnly(at(host)), host).toBe(true);
  });

  it('с подписью Telegram — игра, как сейчас (мобильный, Desktop, Telegram Web)', () => {
    expect(telegramOnly(at('game.kingsvassals.com', { initData: SIGNED }))).toBe(false);
  });

  it('скрипт Telegram не доехал, но строка запуска в адресе — игра', () => {
    expect(telegramOnly(at('game.kingsvassals.com', { hash: `#tgWebAppData=${encodeURIComponent(SIGNED)}&tgWebAppPlatform=ios` }))).toBe(
      false,
    );
    expect(telegramOnly(at('game.kingsvassals.com', { hash: '#tgWebAppPlatform=ios' })), 'без строки запуска — нет').toBe(true);
  });

  it('пустая подпись — не подпись', () => {
    expect(telegramOnly(at('game.kingsvassals.com', { initData: '' }))).toBe(true);
  });

  it('стенды и отчёты: своя машина и флаг замера — игра', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '::1', 'app.localhost', 'tribe.test', '192.168.1.5', '10.0.0.7', '172.20.1.1'])
      expect(telegramOnly(at(host)), host).toBe(false);
    expect(telegramOnly(at('game.kingsvassals.com', { probe: true })), '?probe=1 на выкладке').toBe(false);
  });

  it('публичный адрес похож на домашнюю сеть только по началу — это выкладка', () => {
    for (const host of ['172.32.0.1', '192.169.0.1', '11.0.0.1', 'localhost.example.com', 'test.kingsvassals.com'])
      expect(localHost(host), host).toBe(false);
  });

  it('отчёты открывают игру на 127.0.0.1 с ?probe=1 — адрес из scripts/lib/chrome.ts', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/lib/chrome.ts'), 'utf8');
    const page = src.match(/reportPage = [^`]*`([^`]+)`/)?.[1];
    expect(page, 'адрес страницы отчёта найден').toBeTruthy();
    const url = new URL(page!.replace(/\$\{[^}]+\}/g, '1'));
    expect(telegramOnly(at(url.hostname, { probe: url.searchParams.get('probe') === '1' }))).toBe(false);
  });

  it('кнопка ведёт на бота игры', () => {
    expect(BOT_URL).toBe('https://t.me/WarOfTribesTESTING_bot');
  });
});

describe('заслон стоит в main.tsx до игры, а стенды графики и ролика — раньше него', () => {
  const main = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
  const gate = main.indexOf('telegramOnly(');
  it('заслон спрашивается до запуска игры (`<App />`) и до initTelegram', () => {
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(main.indexOf('<App />'));
    expect(gate).toBeLessThan(main.indexOf('initTelegram();'));
  });
  it('?showcase и ?replay встают раньше заслона', () => {
    expect(main.indexOf("params.has('replay')")).toBeLessThan(gate);
    expect(main.indexOf("params.has('showcase')")).toBeLessThan(gate);
  });
});
