import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Замки серверной части. Проверяются чтением исходников — по той же причине, по
 * которой так проверяется замок алмазов в игре: договор, за которым никто не
 * следит, держится ровно до следующей правки, написанной не задумываясь.
 *
 * Здесь три договора, и все три — про то, чего сервер делать НЕ должен. Серверная часть
 * живёт в двух домах — на Netlify и на своём сервере (`vps/`), — и замки действуют на оба:
 * логика у них одна (`lib/routes/`), а дом добавляет только хранилище и приём запросов.
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
  // Свой сервер — второй дом той же логики: замки те же.
  walk(join(ROOT, 'vps'));
  return out;
};

const rel = (f: string): string => f.slice(ROOT.length + 1).replace(/\\/g, '/');

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Код без строк: для замков, которым текст в кавычках (SQL, сообщения) — не код. */
const codeOnly = (src: string): string =>
  strip(src).replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");

const read = (p: string): string => strip(readFileSync(join(ROOT, p), 'utf8'));

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
  /** Обработчики, которые знают игрока. Часы его не знают — подписи у них нет нарочно. */
  const SIGNED = ['lib/routes/save.ts', 'lib/routes/castles.ts', 'lib/routes/notify.ts'];

  it.each(SIGNED)('%s: подпись проверяется до первого похода в хранилище', (p) => {
    const code = read(p);
    expect(code).toMatch(/readInitData\(/);
    const check = code.search(/if \(!auth\.ok\) return deny\(401/);
    expect(check).toBeGreaterThan(0);
    expect(code.indexOf('io.stores(')).toBeGreaterThan(check);
  });

  /**
   * Ради чего замок и стоит: ключ хранилища собирается ровно один раз и ровно
   * из проверенной личности. Достаточно одной строки вида
   * `const key = body.userId` — и любой сможет читать чужие сохранения; по коду
   * такая правка выглядит невинно, поэтому её ловит правило, а не внимательность.
   */
  it.each(SIGNED)('%s: ключ собирается один раз и только из проверенного', (p) => {
    const assigns = [...read(p).matchAll(/\bkey\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(assigns).toEqual(['saveKeyOf(auth.user)']);
  });

  it('сохранение: в хранилище ходят только по этому ключу', () => {
    const calls = [...read('lib/routes/save.ts').matchAll(/\bstore\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    expect([...new Set(calls)]).toEqual(['key']);
  });

  /** Реестр — одна общая запись; своя строка в ней трогается только через `upsert` по своему ключу. */
  it('реестр: запись одна, своя строка — только через upsert своего ключа', () => {
    const code = read('lib/routes/castles.ts');
    const calls = [...code.matchAll(/\b(?:hot|cool)\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    expect([...new Set(calls)]).toEqual(['KEY']);
    expect([...code.matchAll(/\bupsert\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['file, key, claim, now']);
  });

  /** Хранилище обработчик получает только из `io`: своего дома у него нет. */
  it('обработчики не открывают хранилищ сами и не называют их строкой', () => {
    for (const name of readdirSync(join(ROOT, 'lib', 'routes')).filter((n) => !/\.test\./.test(n))) {
      const code = read(`lib/routes/${name}`);
      expect(code, name).not.toMatch(/@netlify\/blobs|getStore|sqlite|tribe-/);
    }
  });
});

describe('исходящие: ключ только из подписи или из метки индекса', () => {
  const notify = read('lib/routes/notify.ts');
  const deliver = read('lib/deliver.ts');

  it('приём списка: ключ собирается один раз и только из проверенного', () => {
    const calls = [...notify.matchAll(/\bstore\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    expect([...new Set(calls)]).toEqual(['key']);
    // В индекс кладутся только метки, собранные из того же ключа (`markOf(item, player)`).
    expect([...new Set([...notify.matchAll(/\bdue\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]).toEqual(['mark']);
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

  /**
   * Имена хранилищ названы один раз (`lib/kv.STORES`), а хранилища исходящих открывают ровно
   * приём и проход доставки — по имени из того же списка.
   */
  it('хранилища исходящих трогают ровно приём и доставка', () => {
    const uses = (re: RegExp): string[] => files().filter((f) => re.test(strip(readFileSync(f, 'utf8')))).map(rel).sort();
    expect(uses(/tribe-notify/)).toEqual(['lib/kv.ts']);
    expect(uses(/STORES\.(?:notify|due)\b/)).toEqual(['lib/deliver.ts', 'lib/routes/notify.ts']);
    expect(uses(/STORES\.stats\b/)).toEqual(['lib/deliver.ts']);
  });

  /**
   * Доставка заморожена: 1 440 проходов в сутки не отправляли ничего. Функция лежит вне
   * `functions/` — платформа собирает только эту папку, — и расписания в выкладке нет ни у
   * кого. Снять одно `schedule` было бы хуже: функция без него и без `path` отвечает всякому
   * по `/.netlify/functions/<имя>`. Размораживают переносом файла обратно (шапка
   * `frozen/deliver.mts`) — и этот тест правится тем же коммитом. На своём сервере проход
   * так же выключен по умолчанию — это держит `vps/schedule.test.ts`.
   */
  it('доставка заморожена: в выкладке нет ни одной функции по расписанию', () => {
    const deployed = readdirSync(join(ROOT, 'functions')).filter((n) => /\.m?tsx?$/.test(n));
    expect(deployed.length).toBeGreaterThan(0);
    const scheduled = deployed.filter((n) => /\bschedule\s*:/.test(read(`functions/${n}`)));
    expect(scheduled).toEqual([]);
    expect(deployed).not.toContain('deliver.mts');
    // Сам проход цел и расписание при нём: разморозка — перенос файла, а не переписывание.
    expect(read('frozen/deliver.mts')).toMatch(/schedule: '\* \* \* \* \*'/);
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
   * сервер отдаёт обратно как есть (`parseJson` без читателя — в `routes/save.ts`, и только там:
   * конверт записи, номер и время, но не партия). Двери хранилища (Blobs, SQLite) и перенос
   * данных перекладывают значение, не читая его: `data: x.data` — и только в них. Всё остальное
   * обязано пройти через читателя записи — и читателей ровно два.
   */
  it('читателей хранимого ровно два: реестр и исходящие', () => {
    const readers = new Set<string>();
    const bare: string[] = [];
    const movers: string[] = [];
    for (const f of files()) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      const uses = [...code.matchAll(/\b\w+\.data\b/g)].length;
      const wrapped = [...code.matchAll(/(\w+)\(\s*\w+\s*\?\s*parseJson\(\s*String\(\s*\w+\.data\s*\)\s*\)\s*:\s*null\s*\)/g)];
      for (const m of wrapped) readers.add(m[1]);
      const seen = [...code.matchAll(/parseJson(?:<[^>]*>)?\(\s*String\(\s*\w+\.data\s*\)\s*\)/g)].length;
      if (seen - wrapped.length > 0) bare.push(rel(f));
      const passthrough = [...code.matchAll(/\b\w+:\s*(?:String\(\s*)?\w+\.data\b/g)].length;
      if (passthrough > 0) movers.push(rel(f));
      // Мимо этих форм хранимое не достаётся ни в одном файле.
      expect(uses, `${rel(f)}: хранимое достаётся мимо разбора`).toBe(seen + passthrough);
    }
    expect([...readers].sort()).toEqual(['readNotify', 'readRoster']);
    expect(bare).toEqual(['lib/routes/save.ts']);
    expect(movers.sort()).toEqual(['lib/blobs.ts', 'vps/import.ts', 'vps/sqlite.ts']);
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
   * токен, и подписанную строку запуска. Журналов у функций нет вовсе:
   * отлаживать их придётся кодами ответа, и это дешевле, чем секрет в логах
   * хостинга. Свой сервер говорит о том, что сделал сам (запуск, копии, перенос), —
   * одним модулем `vps/log.ts`, и модули на пути запроса его не знают.
   */
  it('никто ничего не пишет в журнал — кроме журнала своего сервера', () => {
    const guilty = files().filter((f) => /\bconsole\s*\./.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(guilty).toEqual(['vps/log.ts']);
  });

  it('путь запроса журнала не знает: ни обработчики, ни приём HTTP', () => {
    const onPath = files().map(rel).filter((f) => f.startsWith('lib/') || f === 'vps/listen.ts');
    expect(onPath.length).toBeGreaterThan(5);
    const guilty = onPath.filter((f) => /from '[^']*log\.js'/.test(read(f)));
    expect(guilty).toEqual([]);
  });
});
