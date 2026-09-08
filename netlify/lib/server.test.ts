import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Замки серверной части. Проверяются чтением исходников — по той же причине, по
 * которой так проверяется замок алмазов в игре: договор, за которым никто не
 * следит, держится ровно до следующей правки, написанной не задумываясь.
 *
 * Здесь три договора, и все три — про то, чего сервер делать НЕ должен.
 */
const ROOT = join(__dirname, '..');

const files = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.m?tsx?$/.test(name) && !/\.test\.m?tsx?$/.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, 'lib'));
  walk(join(ROOT, 'functions'));
  return out;
};

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('сервер ничего не начисляет', () => {
  /**
   * На этом шаге сервер хранит и раздаёт, а не судит. Алмазов у него нет ни в
   * каком виде: ни поля, ни имени, ни ключа — иначе правило «клиент не умеет
   * начислять себе алмазы» просто переехало бы на сервер, который их умеет, и
   * ослабло бы вдвое. Появится настоящая оплата — начисление будет писаться
   * заново и целиком, вместе с проверкой платежа.
   */
  it('слова «алмаз» в серверной части нет вовсе', () => {
    const guilty = files().filter((f) => /\bgems?\b|creditGems/i.test(strip(readFileSync(f, 'utf8'))));
    expect(guilty).toEqual([]);
  });

  it('и наград тоже нет: сервер не знает, что лежит в сохранении', () => {
    const guilty = files().filter((f) => /\breward|\bgold\b|\bresources\b/i.test(strip(readFileSync(f, 'utf8'))));
    expect(guilty).toEqual([]);
  });
});

describe('личность берётся только из подписи', () => {
  const save = readFileSync(join(ROOT, 'functions', 'save.mts'), 'utf8');
  const code = strip(save);

  it('запрос проверяется подписью до всего остального', () => {
    expect(code).toMatch(/readInitData\(/);
    expect(code).toMatch(/if \(!auth\.ok\) return deny\(401/);
  });

  /**
   * Ради чего замок и стоит: ключ хранилища собирается ровно один раз и ровно
   * из проверенной личности. Достаточно одной строки вида
   * `const key = body.userId` — и любой сможет читать чужие сохранения; по коду
   * такая правка выглядит невинно, поэтому её ловит правило, а не внимательность.
   */
  it('ключ хранилища собирается один раз и только из проверенного', () => {
    const assigns = [...code.matchAll(/\bkey\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(assigns).toEqual(['saveKeyOf(auth.user)']);
  });

  it('в хранилище ходят только по этому ключу', () => {
    const calls = [...code.matchAll(/store\(\)\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    expect([...new Set(calls)]).toEqual(['key']);
  });
});

describe('токен бота не утекает', () => {
  it('его читают в одном месте', () => {
    const guilty = files().filter(
      (f) => /TELEGRAM_BOT_TOKEN/.test(strip(readFileSync(f, 'utf8'))) && !f.endsWith(join('lib', 'http.ts')),
    );
    expect(guilty).toEqual([]);
  });

  /**
   * Записать в журнал что угодно из запроса — значит однажды записать туда и
   * токен, и подписанную строку запуска. Журналов у этих функций нет вовсе:
   * отлаживать их придётся кодами ответа, и это дешевле, чем секрет в логах
   * хостинга.
   */
  it('никто ничего не пишет в журнал', () => {
    const guilty = files().filter((f) => /\bconsole\s*\./.test(strip(readFileSync(f, 'utf8'))));
    expect(guilty).toEqual([]);
  });
});
