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

  /**
   * Наград у сервера нет. Склад и казну он знает ровно в одном деле — войне между игроками (решение владельца
   * 05.10.2026, docs/pvp.md): взятый город теряет, победитель увозит, и что увёз — взято из того, что потерял
   * (тест «добыча переходит, а не начисляется», `war.test.ts`). Слова склада и казны живут только в договоре
   * (слепок обороны) и в правилах войны; больше нигде.
   */
  it('и наград тоже нет: склад и казну знает только война, и только чтобы перенести', () => {
    const guilty = files()
      .filter((f) => /\breward|\bgold\b|\bresources\b/i.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    // Третий — команды админа (решение владельца 06.10.2026, docs/admin.md): указ правит склад и казну, но не начисляет —
    // он ложится записью в журнал игрока, и применяет его клиент одной дверью (`sim/admin`). Алмазов в указе нет (тест выше).
    expect(guilty).toEqual(['lib/commands.ts', 'lib/contract.ts', 'lib/war.ts']);
    for (const f of files()) expect(strip(readFileSync(f, 'utf8')), rel(f)).not.toMatch(/\breward/i);
  });
});

describe('личность берётся только из подписи', () => {
  /** Обработчики, которые знают игрока. Часы его не знают — подписи у них нет нарочно. */
  const SIGNED = ['lib/routes/save.ts', 'lib/routes/castles.ts', 'lib/routes/notify.ts', 'lib/routes/war.ts', 'lib/routes/report.ts'];

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
    expect([...code.matchAll(/\bupsert\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['file, key, claim, now, mode']);
  });

  /**
   * Война читает чужие партии — слепок обороны защитника, — и только читает. Ключ чужой партии берётся из
   * реестра (по номеру замка) или из самой войны, а не из тела запроса; писать в хранилище партий обработчик
   * войны не умеет вовсе. Строка `saves.setJSON(...)` здесь означала бы, что один игрок пишет в партию другого.
   */
  it('война: хранилище партий только читается', () => {
    const code = read('lib/routes/war.ts');
    const calls = [...code.matchAll(/\bsaves\s*\.\s*(\w+)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect([...new Set(calls)]).toEqual(['getWithMetadata']);
    expect(code).not.toMatch(/\bsaves\b[^;]*\.(?:setJSON|set|delete)\(/);
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
    // Разрешение писать — из той же подписи (`allows_write_to_pm`), а не из тела запроса.
    expect(notify).toMatch(/accept\(rec, put, key, now, auth\.user\.allowsWrite === true\)/);
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
    expect(calls.length).toBe(3);
    expect([...new Set(calls)]).toEqual(['player']);
  });

  /**
   * Новости войны кладёт сервер сам (`outbox.queueNews`): ключ игрока — из записи войны, куда он попал из подписи
   * нападающего и из реестра, и проверяется тем же видом, что ключ метки, до первого чтения.
   */
  it('новости войны: ключ игрока проверяется видом до первого похода в запись', () => {
    const outbox = read('lib/outbox.ts');
    const check = outbox.search(/if \(!PLAYER_KEY\.test\(player\)/);
    expect(check).toBeGreaterThan(0);
    expect(outbox.indexOf('io.notify.')).toBeGreaterThan(check);
    const calls = [...outbox.matchAll(/io\.notify\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect([...new Set(calls)]).toEqual(['player']);
  });

  /**
   * Вебхук бота знает игрока не из подписи `initData`, а из обновления Telegram (docs/handbook/sync.md, расширено
   * вслух 05.10.2026). Подлинность обновления — секрет вебхука: он проверяется раньше любого похода в хранилище, ключ
   * собирается один раз — из `from.id` обновления, — и трогает вебхук только исходящие (рычаг и канал).
   */
  it('вебхук бота: секрет до хранилища, ключ — из обновления, трогает только исходящие', () => {
    const bot = read('lib/routes/bot.ts');
    const check = bot.search(/if \(!secretOk\(req\.headers\.get\('x-telegram-bot-api-secret-token'\)\)\) return deny\(401/);
    expect(check).toBeGreaterThan(0);
    expect(bot.indexOf('io.stores(')).toBeGreaterThan(check);
    expect([...bot.matchAll(/\bconst player\s*=\s*([^;]+);/g)].map((m) => m[1].trim())).toEqual(['`tg-${found.id}`']);
    expect([...new Set([...bot.matchAll(/\bstore\s*\.\s*\w+\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]).toEqual(['player']);
    expect([...bot.matchAll(/io\.stores\((STORES\.\w+)/g)].map((m) => m[1])).toEqual(['STORES.notify']);
  });

  /**
   * Имена хранилищ названы один раз (`lib/kv.STORES`), а хранилища исходящих открывают ровно
   * приём и проход доставки — по имени из того же списка.
   */
  it('хранилища исходящих трогают ровно приём, доставка, война (новости) и вебхук бота (рычаг)', () => {
    const uses = (re: RegExp): string[] => files().filter((f) => re.test(strip(readFileSync(f, 'utf8')))).map(rel).sort();
    expect(uses(/tribe-notify/)).toEqual(['lib/kv.ts']);
    // Чистый старт (`era.ts`, docs/test_world.md) стирает их целиком и больше ничего с ними не делает.
    expect(uses(/STORES\.(?:notify|due)\b/)).toEqual(['lib/deliver.ts', 'lib/era.ts', 'lib/routes/bot.ts', 'lib/routes/notify.ts', 'lib/routes/war.ts']);
    expect(uses(/STORES\.stats\b/)).toEqual(['lib/deliver.ts', 'lib/era.ts']);
    expect(read('lib/era.ts')).not.toMatch(/STORES\.(?:notify|due|stats)\)/);
  });

  /**
   * Доставка — одна функция по расписанию, и включает её флаг `TRIBE_DELIVER=on` (`http.deliverOn`), а не перенос
   * файла: без флага функция выходит, ничего не прочитав. Была заморожена 16.09.2026 (docs/SUBTRACT.md) — переносом
   * в `frozen/`; разморожена 05.10.2026 вместе с адаптером (docs/NOTIFY.md, раздел 12). На своём сервере проход
   * включает тот же флаг — это держит `vps/schedule.test.ts` и `vps/config.test.ts`.
   */
  it('доставка: одна функция по расписанию, и без флага она выходит, ничего не прочитав', () => {
    const deployed = readdirSync(join(ROOT, 'functions')).filter((n) => /\.m?tsx?$/.test(n));
    const scheduled = deployed.filter((n) => /\bschedule\s*:/.test(read(`functions/${n}`)));
    expect(scheduled).toEqual(['deliver.mts']);
    const code = read('functions/deliver.mts');
    expect(code).toMatch(/schedule: '\* \* \* \* \*'/);
    expect(code).not.toMatch(/\bpath\s*:/);
    expect(code).toMatch(/if \(deliverOn\(\)\) await deliverPass\(/);
    expect([...code.matchAll(/\bdeliverPass\(/g)].length).toBe(1);
  });

  /**
   * Наружу ходит один адаптер — `lib/telegram.ts`: ни обработчики, ни проход доставки, ни свой сервер не зовут
   * `fetch` и не знают адреса Bot API. Новый адресат снаружи — правкой адаптера и этого теста.
   */
  it('наружу ходит один адаптер: запрос и адрес Telegram — только в lib/telegram.ts', () => {
    const guilty = files()
      .filter((f) => /\bfetch\s*\(|api\.telegram\.org|sendMessage/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel);
    expect(guilty).toEqual(['lib/telegram.ts']);
  });
});

describe('сервер разбирает ровно названные записи и слепок обороны', () => {
  /**
   * «Сервер хранит и раздаёт, а не судит» расширено вслух дважды: кроме реестра замков, сервер читает
   * исходящие уведомления (docs/handbook/sync.md, «Личность игрока»), а с войной между игроками (решение
   * владельца 05.10.2026, docs/pvp.md) — запись войн и слепок обороны из записи партии (`WarSheet`, не саму
   * партию). Следующая разбирающая запись обязана упереться сюда.
   *
   * Расширено вслух в третий раз — админкой (решение владельца 06.10.2026, docs/admin.md): заморозка, указы и журнал
   * админа (`admin.ts`), наблюдение за игроком (`watch.ts`) и отчёты об ошибках (`reports.ts`). Партию по-прежнему не
   * разбирает никто: числа для наблюдения клиент кладёт рядом описью (`WatchCard`). `reader` — читатель, переданный
   * общей двери перезаписи (`admin.rewrite`); кто его передаёт, держит тест «перезапись — только известными читателями».
   *
   * Что считается разбором. Всё, что достаётся из хранилища, — `x.data`. Сохранение партии
   * сервер отдаёт обратно как есть (`parseJson` без читателя — в `routes/save.ts`, и только там:
   * конверт записи, номер и время, но не партия). Двери хранилища (Blobs, SQLite) и перенос
   * данных перекладывают значение, не читая его: `data: x.data` — и только в них. Всё остальное
   * обязано пройти через читателя записи — и читателей ровно два.
   */
  it('читатели хранимого: реестр, исходящие, войны, слепок обороны и записи админки', () => {
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
    expect([...readers].sort()).toEqual([
      'readAdminLog',
      'readEraFile',
      'readFrozen',
      'readGrants',
      'readNotify',
      'readRoster',
      'readStoredReport',
      'readStoredSheet',
      'readWars',
      'readWatchRecord',
      'reader',
    ]);
    expect(bare).toEqual(['lib/routes/save.ts']);
    expect(movers.sort()).toEqual(['lib/blobs.ts', 'vps/import.ts', 'vps/sqlite.ts']);
  });
});

describe('админка: только ADMIN_IDS, партии не пишет, алмазов не знает (docs/admin.md)', () => {
  /**
   * Команда админа приходит в вебхук бота с секретом; что написал админ, проверяется раньше любого похода в хранилище.
   * Строка, переставленная ниже первого `io.stores(`, открыла бы журнал игроков любому, кто знает имя бота.
   */
  it('команды: проверка админа до первого похода в хранилище', () => {
    const code = read('lib/commands.ts');
    const body = code.slice(code.indexOf('export async function adminCommand('));
    const check = body.search(/if \(from === null \|\| chat\.type !== 'private' \|\| chat\.id !== from \|\| !isAdmin\(from, env\)\) return true;/);
    expect(check).toBeGreaterThan(0);
    // Все помощники, ходящие в хранилище, зовутся только из `adminCommand` после проверки.
    expect(body.slice(0, check)).not.toMatch(/io\.stores\(|await /);
    expect([...code.matchAll(/export async function adminCommand\(/g)].length).toBe(1);
  });

  it('команды: партии только читаются (есть ли такой игрок), и ни одна команда не пишет в чужие хранилища', () => {
    const code = read('lib/commands.ts');
    expect(code).not.toMatch(/STORES\.saves\)\s*\.\s*(?:setJSON|set|delete)\(/);
    expect([...code.matchAll(/STORES\.saves\)\.(\w+)\(/g)].map((m) => m[1])).toEqual(['getWithMetadata']);
    expect(code).not.toMatch(/STORES\.(?:notify|due|world)\b/);
  });

  /** Записи админки пишут только админка и команды; сохранение, война и доставка заморозку и указы только читают. */
  it('хранилище админки пишут только admin.ts и commands.ts', () => {
    const uses = files()
      .filter((f) => /STORES\.admin\b/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    expect(uses).toEqual(['lib/admin.ts', 'lib/commands.ts', 'lib/deliver.ts', 'lib/era.ts']);
    expect(read('lib/deliver.ts')).not.toMatch(/admin\??\.(?:setJSON|set|delete)\(/);
    // Чистый старт стирает в хранилище админки только указы: заморозка и журнал админа остаются (`era.ADMIN_KEEP`).
    expect([...read('lib/era.ts').matchAll(/STORES\.admin\b[^\n]*/g)].map((m) => m[0])).toEqual([
      "STORES.admin] = await sweep(stores(STORES.admin, 'strong'), (k) => ADMIN_KEEP.includes(k));",
    ]);
  });

  it('перезапись — только известными читателями', () => {
    const calls = files().flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/\brewrite\([^;]*?\b(read\w+)\b/g)].map((m) => m[1]));
    expect(calls.length).toBeGreaterThan(3);
    expect([...new Set(calls)].sort()).toEqual(['readAdminLog', 'readFrozen', 'readGrants', 'readWatchRecord']);
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
