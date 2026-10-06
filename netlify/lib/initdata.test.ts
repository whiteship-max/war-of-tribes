import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_SECONDS,
  INIT_DATA_TTL_SECONDS,
  readInitData,
  saveKeyOf,
} from './initdata.js';

const TOKEN = '123456:AA-test-token-not-a-real-one';
const OTHER = '654321:BB-another-bot';

/**
 * Собирает настоящую подписанную строку — тем же алгоритмом, каким её собирает
 * Telegram. Тест на подделанных данных ничего не доказывал бы: он обязан сперва
 * показать, что честная строка проходит, и только потом — что порченая нет.
 */
function sign(fields: Record<string, string>, token: string, opts: { skip?: string[] } = {}): string {
  const skip = new Set(opts.skip ?? []);
  const check = Object.entries(fields)
    .filter(([k]) => !skip.has(k))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

const NOW = 1_800_000_000;
const user = (id: number): string => JSON.stringify({ id, first_name: 'Вождь' });

const fields = (over: Record<string, string> = {}): Record<string, string> => ({
  auth_date: String(NOW - 60),
  query_id: 'AAF',
  user: user(777),
  ...over,
});

describe('личность игрока берётся только из подписи', () => {
  it('честная строка проходит и отдаёт того, кого подписали', () => {
    const r = readInitData(sign(fields(), TOKEN), TOKEN, NOW);
    expect(r).toEqual({ ok: true, user: { id: 777, authDate: NOW - 60 } });
  });

  it('имя пользователя — из той же подписи и только похожее на имя Telegram (админка, docs/admin.md)', () => {
    const named = (username: unknown): Record<string, string> => fields({ user: JSON.stringify({ id: 777, username }) });
    expect(readInitData(sign(named('ivan_99'), TOKEN), TOKEN, NOW)).toEqual({ ok: true, user: { id: 777, authDate: NOW - 60, username: 'ivan_99' } });
    for (const bad of ['iv', 'с кириллицей', 'a'.repeat(33), 5, '<b>evil</b>']) {
      expect(readInitData(sign(named(bad), TOKEN), TOKEN, NOW)).toEqual({ ok: true, user: { id: 777, authDate: NOW - 60 } });
    }
  });

  it('чужой токен не подходит: подпись — это и есть весь замок', () => {
    expect(readInitData(sign(fields(), OTHER), TOKEN, NOW)).toEqual({ ok: false, why: 'bad-hash' });
  });

  /**
   * Ради чего всё и заведено: назвать себя чужим номером нельзя. Поле `user`
   * входит в строку проверки, поэтому подмена ломает подпись — а не проверяется
   * отдельно.
   */
  it('подменённый идентификатор ломает подпись', () => {
    const honest = sign(fields(), TOKEN);
    const forged = honest.replace(encodeURIComponent(user(777)), encodeURIComponent(user(1)));
    expect(forged).not.toBe(honest);
    expect(readInitData(forged, TOKEN, NOW)).toEqual({ ok: false, why: 'bad-hash' });
  });

  it('любая правка любого поля ломает подпись', () => {
    const tweaks: Record<string, string>[] = [{ query_id: 'BBB' }, { auth_date: String(NOW) }];
    for (const over of tweaks) {
      const honest = new URLSearchParams(sign(fields(), TOKEN));
      const hash = honest.get('hash')!;
      const bad = new URLSearchParams(fields(over));
      bad.set('hash', hash);
      expect(readInitData(bad.toString(), TOKEN, NOW).ok).toBe(false);
    }
  });

  it('дописанное поле тоже ломает подпись: строку проверки собирают из всего', () => {
    const bad = `${sign(fields(), TOKEN)}&receipt=free-gems`;
    expect(readInitData(bad, TOKEN, NOW)).toEqual({ ok: false, why: 'bad-hash' });
  });

  it('без строки запуска — отказ, а не гость', () => {
    expect(readInitData(null, TOKEN, NOW)).toEqual({ ok: false, why: 'missing' });
    expect(readInitData('', TOKEN, NOW)).toEqual({ ok: false, why: 'missing' });
  });

  /**
   * Пустой токен в окружении — это не «проверка отключена», а «проверять
   * нечем». Пускать в этом случае нельзя ни на чтение, ни на запись: иначе
   * забытая переменная на хостинге открывала бы чужие сохранения всем.
   */
  it('без токена бота не пускают вовсе', () => {
    expect(readInitData(sign(fields(), TOKEN), '', NOW)).toEqual({ ok: false, why: 'no-token' });
  });

  it('мусор вместо строки — отказ, а не исключение', () => {
    for (const raw of ['%%%', 'hash=zz', 'hash=' + 'a'.repeat(64), 'a=1&b=2']) {
      expect(readInitData(raw, TOKEN, NOW).ok).toBe(false);
    }
  });

  it('без разбираемого user личности нет', () => {
    expect(readInitData(sign(fields({ user: 'не json' }), TOKEN), TOKEN, NOW)).toEqual({ ok: false, why: 'malformed' });
    expect(readInitData(sign(fields({ user: '{"id":"777"}' }), TOKEN), TOKEN, NOW)).toEqual({ ok: false, why: 'malformed' });
    const noUser = sign({ auth_date: String(NOW - 60) }, TOKEN);
    expect(readInitData(noUser, TOKEN, NOW)).toEqual({ ok: false, why: 'malformed' });
  });
});

describe('свежесть строки запуска', () => {
  it('вчерашняя ещё годится, позавчерашняя нет', () => {
    const fresh = sign(fields({ auth_date: String(NOW - INIT_DATA_TTL_SECONDS + 60) }), TOKEN);
    expect(readInitData(fresh, TOKEN, NOW).ok).toBe(true);
    const old = sign(fields({ auth_date: String(NOW - INIT_DATA_TTL_SECONDS - 1) }), TOKEN);
    expect(readInitData(old, TOKEN, NOW)).toEqual({ ok: false, why: 'stale' });
  });

  it('часы вперёд на минуты прощаются, на час — нет', () => {
    const near = sign(fields({ auth_date: String(NOW + CLOCK_SKEW_SECONDS - 1) }), TOKEN);
    expect(readInitData(near, TOKEN, NOW).ok).toBe(true);
    const far = sign(fields({ auth_date: String(NOW + 3600) }), TOKEN);
    expect(readInitData(far, TOKEN, NOW)).toEqual({ ok: false, why: 'future' });
  });
});

describe('поле signature', () => {
  /**
   * Часть клиентов присылает рядом с `hash` ещё и `signature` — подпись Ed25519
   * для тех, у кого токена бота нет. Входит ли она в строку проверки, у разных
   * версий вышло по-разному, поэтому принимаются оба разбора. Оба — полный HMAC
   * тем же секретом, и подделать любой из них нельзя: это видно по третьему
   * случаю ниже.
   */
  const withSig = fields({ signature: 'AbCd_ed25519' });

  it('строка, подписанная вместе с signature, проходит', () => {
    expect(readInitData(sign(withSig, TOKEN), TOKEN, NOW).ok).toBe(true);
  });

  it('строка, подписанная без signature, тоже проходит', () => {
    expect(readInitData(sign(withSig, TOKEN, { skip: ['signature'] }), TOKEN, NOW).ok).toBe(true);
  });

  it('но подпись чужим токеном не проходит ни так, ни так', () => {
    expect(readInitData(sign(withSig, OTHER), TOKEN, NOW).ok).toBe(false);
    expect(readInitData(sign(withSig, OTHER, { skip: ['signature'] }), TOKEN, NOW).ok).toBe(false);
  });
});

describe('ключ хранилища', () => {
  it('собирается из числа, а не из строки: подставить путь нечем', () => {
    expect(saveKeyOf({ id: 777, authDate: NOW })).toBe('tg-777');
    expect(saveKeyOf({ id: 777, authDate: NOW })).toMatch(/^tg-\d+$/);
  });
});
