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
  // Замороженное не выкладывается, но замки на него действуют: вернётся оно тем же кодом.
  walk(join(ROOT, 'frozen'));
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

describe('исходящие: ключ только из подписи или из метки индекса', () => {
  const notify = strip(readFileSync(join(ROOT, 'functions', 'notify.mts'), 'utf8'));
  const deliver = strip(readFileSync(join(ROOT, 'lib', 'deliver.ts'), 'utf8'));

  it('приём списка: ключ собирается один раз и только из проверенного', () => {
    expect(notify).toMatch(/if \(!auth\.ok\) return deny\(401/);
    const assigns = [...notify.matchAll(/\bkey\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(assigns).toEqual(['saveKeyOf(auth.user)']);
    const calls = [...notify.matchAll(/store\(\)\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    expect([...new Set(calls)]).toEqual(['key']);
    // В индекс кладутся только метки, собранные из того же ключа (`markOf(item, player)`).
    expect([...new Set([...notify.matchAll(/due\(\)\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]).toEqual(['mark']);
    expect(notify).toMatch(/accept\(rec, put, key, now\)/);
  });

  /**
   * У прохода доставки подписи нет. Ключ записи исходящих в нём берётся ровно из одного
   * места — из имени метки — и проверяется видом `tg-<число>` до первого чтения. Строка
   * `io.notify.getWithMetadata(body.userId…)` выглядела бы невинно, поэтому её ловит правило.
   */
  it('проход доставки: ключ игрока только из метки, и в запись ходят только по нему', () => {
    const assigns = [...deliver.matchAll(/\bconst player\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(assigns).toEqual(['blob.key.slice(minute.length + 1)']);
    expect(deliver).toMatch(/if \(!PLAYER_KEY\.test\(player\)\)/);
    const calls = [...deliver.matchAll(/io\.notify\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBe(2);
    expect([...new Set(calls)]).toEqual(['player']);
  });

  it('хранилища исходящих трогают ровно приём и доставка', () => {
    const touching = files()
      .filter((f) => /tribe-notify/.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))
      .sort();
    expect(touching).toEqual(['frozen/deliver.mts', 'functions/notify.mts']);
  });

  /**
   * Доставка заморожена: 1 440 проходов в сутки не отправляли ничего. Функция лежит вне
   * `functions/` — платформа собирает только эту папку, — и расписания в выкладке нет ни у
   * кого. Снять одно `schedule` было бы хуже: функция без него и без `path` отвечает всякому
   * по `/.netlify/functions/<имя>`. Размораживают переносом файла обратно (шапка
   * `frozen/deliver.mts`) — и этот тест правится тем же коммитом.
   */
  it('доставка заморожена: в выкладке нет ни одной функции по расписанию', () => {
    const deployed = readdirSync(join(ROOT, 'functions')).filter((n) => /\.m?tsx?$/.test(n));
    expect(deployed.length).toBeGreaterThan(0);
    const scheduled = deployed.filter((n) => /\bschedule\s*:/.test(strip(readFileSync(join(ROOT, 'functions', n), 'utf8'))));
    expect(scheduled).toEqual([]);
    expect(deployed).not.toContain('deliver.mts');
    // Сам проход цел и расписание при нём: разморозка — перенос файла, а не переписывание.
    expect(strip(readFileSync(join(ROOT, 'frozen', 'deliver.mts'), 'utf8'))).toMatch(/schedule: '\* \* \* \* \*'/);
  });

  /**
   * Замок сервера на доставку: адаптеров в этой пачке нет ни одного. Ни исходящего
   * запроса, ни адреса Bot API — проход пишет «ушло бы», и больше ничего. Появится адаптер —
   * этот тест правится вместе с ним, а не обходится.
   */
  it('доставка ничего не отправляет: ни запроса наружу, ни адреса Telegram', () => {
    const guilty = files().filter((f) => /\bfetch\s*\(|api\.telegram\.org|sendMessage/.test(strip(readFileSync(f, 'utf8'))));
    expect(guilty).toEqual([]);
  });
});

describe('сервер разбирает ровно две записи', () => {
  /**
   * «Сервер хранит и раздаёт, а не судит» расширено вслух ровно один раз: кроме реестра
   * замков, сервер читает исходящие уведомления (docs/handbook/sync.md, «Личность игрока»). Третья
   * разбирающая запись обязана упереться сюда.
   *
   * Что считается разбором. Всё, что достаётся из хранилища, — `x.data`. Сохранение партии
   * сервер отдаёт обратно как есть (`parseJson` без читателя — в `save.mts`, и только там:
   * конверт записи, номер и время, но не партия). Всё остальное обязано пройти через
   * читателя записи — и читателей ровно два.
   */
  it('читателей хранимого ровно два: реестр и исходящие', () => {
    const readers = new Set<string>();
    const bare: string[] = [];
    for (const f of files()) {
      const code = strip(readFileSync(f, 'utf8'));
      const uses = [...code.matchAll(/\b\w+\.data\b/g)].length;
      const wrapped = [...code.matchAll(/(\w+)\(\s*\w+\s*\?\s*parseJson\(\s*String\(\s*\w+\.data\s*\)\s*\)\s*:\s*null\s*\)/g)];
      for (const m of wrapped) readers.add(m[1]);
      const plain = [...code.matchAll(/parseJson(?:<[^>]*>)?\(\s*String\(\s*\w+\.data\s*\)\s*\)/g)].length - wrapped.length;
      if (plain > 0) bare.push(f.slice(ROOT.length + 1).replace(/\\/g, '/'));
      // Мимо этих двух форм хранимое не достаётся ни в одном файле.
      const seen = [...code.matchAll(/parseJson(?:<[^>]*>)?\(\s*String\(\s*\w+\.data\s*\)\s*\)/g)].length;
      const passthrough = [...code.matchAll(/data:\s*String\(\s*found\.data\s*\)/g)].length;
      expect(uses, `${f}: хранимое достаётся мимо разбора`).toBe(seen + passthrough);
    }
    expect([...readers].sort()).toEqual(['readNotify', 'readRoster']);
    expect(bare).toEqual(['functions/save.mts']);
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
