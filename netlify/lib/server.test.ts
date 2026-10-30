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

describe('сервер ничего не начисляет, кроме одной двери алмазов', () => {
  /**
   * До 09.10.2026 алмазов у сервера не было вовсе, и замок требовал, чтобы слова «gems» в серверной части не было. Решение
   * владельца перенесло алмазы на сервер (docs/gems.md): баланс и журнал — книга `lib/gems.ts`, трата — приказом
   * `/api/gems`. Замок остался тем же по смыслу: **начисление одно** — `gems.creditGems`, и зовут её только стартовые
   * эпохи (`openLedger`). Приказ игрока только списывает, админ только читает (`/gems`), указ алмазов не знает.
   *
   * Сначала — где алмазы вообще названы. Новый файл, заговоривший об алмазах, обязан упереться сюда и объясниться.
   */
  it('алмазы знают ровно их книга, обработчик, договор и те, кто их только читает или стирает', () => {
    const named = files()
      .filter((f) => /\bgems?\b|creditGems/i.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    expect(named).toEqual([
      // адрес на Netlify — только имя пути и обработчика
      'functions/gems.mts',
      // `/gems <кто>` — только чтение (`peekGems`), тест ниже
      'lib/commands.ts',
      // типы и разбор записки, приказа и журнала
      'lib/contract.ts',
      // чистый старт стирает книги вместе с партиями
      'lib/era.ts',
      // книга: единственная дверь записи и начисления
      'lib/gems.ts',
      // имя хранилища
      'lib/kv.ts',
      // оплата наборов: находит перевод в сети и зовёт `settlePurchase` (docs/payments.md)
      'lib/pay.ts',
      // обработчик `/api/gems`
      'lib/routes/gems.ts',
      'lib/routes/index.ts',
      // обработчик `/api/pay` — заказы и проверка; начисляет только `lib/pay.ts`
      'lib/routes/pay.ts',
      // сохранение приносит записку и ускоренные уровни книге стройки
      'lib/routes/save.ts',
      // книга стройки читает ускоренные уровни (`paid`) — только номера и уровни записей, баланса не знает
      'lib/town.ts',
      // запись книг передаёт их книге стройки
      'lib/watch.ts',
    ]);
  });

  /** Любой оператор присваивания и запись ключом объекта — всё, чем баланс можно изменить. */
  const BALANCE_WRITE = /\bbalance\s*(?:(?:\*\*|\?\?|\|\||&&|[+\-*/%])?=(?!=)|\+\+|--|:(?!\s*number\b))/;
  /** Прибавка к балансу — в любом виде: `balance + n`, `n + x.balance`, `balance += n`. */
  const BALANCE_UP = /\bbalance\s*\+|\+\s*[\w$.]*\bbalance\b/;

  it('образцы замка ловят то, ради чего заведены, и не ловят честный код', () => {
    for (const line of [
      'ledger.balance += 500;',
      'return { ...ledger, balance: ledger.balance + 9999 };',
      'cur.balance = 1e6;',
      'next.balance++;',
      'const l = { balance: 120 };',
      'ledger.balance ||= 999;',
    ]) {
      expect([line, BALANCE_WRITE.test(line)]).toEqual([line, true]);
    }
    for (const line of ['if (ledger.balance < price) return x;', 'balance: number;', 'const b = ledger.balance;']) {
      expect([line, BALANCE_WRITE.test(line)]).toEqual([line, false]);
    }
    for (const line of ['balance: ledger.balance + grant.amount', 'x = 5 + cur.balance', 'balance += 1']) {
      expect([line, BALANCE_UP.test(line)]).toEqual([line, true]);
    }
    expect(BALANCE_UP.test('ledger.balance - price')).toBe(false);
  });

  /**
   * Баланс пишет только книга. Внутри неё — четыре места, и каждое названо: чтение из хранилища (не выше лежащего),
   * пустая книга (ноль), запись журнала (`entered` берёт посчитанное снаружи) и два её зовущих — начисление и трата.
   * Прибавка — только в `creditGems`. Мутация «трата прибавляет» или «приказ начисляет» валит этот тест.
   */
  it('баланс пишет только книга, а прибавляет только creditGems', () => {
    for (const f of files()) {
      if (rel(f) === 'lib/gems.ts') continue;
      let code = codeOnly(readFileSync(f, 'utf8'));
      // Договор разбирает записку из ответа: баланс переносится как есть, не выше присланного.
      if (rel(f) === 'lib/contract.ts') code = code.replace('balance: Math.max(0, Math.floor(bal)),', '');
      expect(code, rel(f)).not.toMatch(BALANCE_WRITE);
    }
    const code = codeOnly(readFileSync(join(ROOT, 'lib/gems.ts'), 'utf8'));
    const body = (name: string): string => {
      const at = code.search(new RegExp(`(?:function|const) ${name}\\b`));
      expect(at, name).toBeGreaterThanOrEqual(0);
      // До следующего объявления верхнего уровня.
      const next = code.slice(at + 1).search(/\n(?:export )?(?:async )?(?:function|const|interface|type) /);
      return code.slice(at, next < 0 ? undefined : at + 1 + next);
    };
    const credit = body('creditGems');
    expect(credit).toMatch(BALANCE_UP);
    expect(code.replace(credit, '')).not.toMatch(BALANCE_UP);
    // Трата отнимает, и только положительную цену, и только при достаточном балансе.
    const spend = body('spendGems');
    expect(spend).toMatch(/price <= 0/);
    expect(spend).toMatch(/balance < price/);
    expect(spend).toMatch(/ledger\.balance - price/);
    // Новая запись журнала — только через начисление и трату.
    expect([...code.matchAll(/\bentered\(/g)].length).toBe(3);
  });

  /**
   * С 09.10.2026 (docs/payments.md) зовущих два: стартовые и оплата набора (`settlePurchase`, источник `purchase`).
   * `settlePurchase` зовёт только проверка перевода `lib/pay.ts` — после того, как перевод найден в сети и занят.
   * С FIN-5 (аудит 25.10.2026) — третий: возврат ускорения, которое не понадобилось (`refundRushes`, источник `refund`), —
   * ровно списанное за это ускорение и только по книге стройки (`proof.own`); зовёт его только запись партии.
   */
  it('creditGems зовут только стартовые эпохи, оплата, найденная в сети, и возврат по книге стройки — ни приказ, ни админ', () => {
    const calls = files().flatMap((f) =>
      [...codeOnly(readFileSync(f, 'utf8')).matchAll(/(?<!function )\bcreditGems\(([^;]*)\);/g)].map((m) => `${rel(f)}: ${m[1].replace(/\s+/g, ' ')}`),
    );
    expect(calls).toEqual([
      "lib/gems.ts: blank(), { source: '', amount: START_GEMS, key: '', at }",
      "lib/gems.ts: cur, { source: '', amount: -e.delta, key: '', at, building: e.building, level: e.level }",
      "lib/gems.ts: cur, { ...grant, source: '' }",
    ]);
    // Возврат: только запись ускорения (вид, постройка, уровень, списание), только без прежнего возврата и только по книге
    // стройки — в этом порядке, до начисления. Зовёт его только запись партии (`settleRefunds`).
    const gemsCode = read('lib/gems.ts');
    const refund = gemsCode.slice(gemsCode.indexOf('export function refundRushes'), gemsCode.indexOf('export async function settleRefunds'));
    expect(refund).toMatch(/if \(!e \|\| e\.kind !== 'rush' \|\| !e\.building \|\| !e\.level \|\| e\.delta >= 0\) \{[\s\S]*?continue;[\s\S]*?if \(byKey\(cur, `refund:\$\{n\}`\)\) \{[\s\S]*?continue;[\s\S]*?if \(proof\.own\.includes\(n\)\) \{\n\s*const done = creditGems\(/);
    const refunders = files().flatMap((f) => [...codeOnly(readFileSync(f, 'utf8')).matchAll(/(?<!function )\b(?:settleRefunds|refundRushes)\(/g)].map(() => rel(f)));
    expect(refunders.sort()).toEqual(['lib/gems.ts', 'lib/routes/save.ts']);
    const purchases = files().flatMap((f) =>
      [...codeOnly(readFileSync(f, 'utf8')).matchAll(/(?<!function )\bsettlePurchase\(/g)].map(() => rel(f)),
    );
    expect(purchases).toEqual(['lib/pay.ts']);
    // И в `lib/pay.ts` — только после того, как заказ стал «оплачен» (перевод найден и занят).
    const pay = read('lib/pay.ts');
    // Между ними — вечный замок заказа (FIN-6, АУ-8): начисленный в прошлой эпохе второй раз не начисляется.
    expect(pay).toMatch(/for \(const o of cur\.filter\(\(x\) => x\.state === 'paid'\)\) \{\n[^]*?const lock = await creditLock\([^]*?const done = await settlePurchase\(/);
    expect(pay.match(/settlePurchase\(/g)?.length, 'начисление покупки — одно место').toBe(1);
    // Стартовые кладутся только в пустое место: открытие книги — только когда записи нет.
    const code = codeOnly(readFileSync(join(ROOT, 'lib/gems.ts'), 'utf8'));
    expect(code).toMatch(/const cur = stored \?\? openLedger\(at\);/);
    expect(code).toMatch(/if \(found && !stored\) return null;/);
    expect(code).toMatch(/onlyIfNew: true/);
  });

  it('админ алмазы только читает: /gems не открывает книгу и не пишет', () => {
    const code = read('lib/commands.ts');
    expect(code).not.toMatch(/settleGems|settlePurchase|creditGems|openLedger|applyGemOrder|checkOrders|createOrder|markSent|claimTx|STORES\.(?:gems|pay|paid)/);
    expect(code).toMatch(/peekGems\(/);
    expect(code).toMatch(/peekPayments\(/);
    // И хранилище алмазов называет только книга.
    const uses = files()
      .filter((f) => /STORES\.gems\b/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    expect(uses).toEqual(['lib/era.ts', 'lib/gems.ts']);
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
    // Четвёртый — книга запасов (docs/security.md, ЗЩ-2): склад и казну защитника она держит для войны «не меньше» и не
    // начисляет ничего — читает опись и отдаёт слепку обороны (`goods.goodsSheet`).
    // Пятый — книга рынка (РН-1, docs/city_v3.md, «Решения РН-1»): сверяет золото сделок с правилом привоза и не начисляет
    // ничего — только флаг. Шестой — допуск разовых дел (AC-1, docs/audit/AU-3.md): сколько дела могли положить на склад и в
    // казну по таблице наград игры, — сверка и флаг, начислять ему нечего. Седьмой — наблюдение (АУ-8, п. 8): добро без дела по
    // записи войн (`watch.windfallKnown` — дань и кража у соседа, принятые клиентом) — допуск к той же сверке, не начисление.
    // Восьмой и девятый — книга договоров отряда бродяги (ПН-7, docs/gdd/path_of_sword.md, 20; docs/trust-boundary.md, 5в) и её разбор:
    // плату сданного договора сервер сверяет с потолком таблицы наград дел и считает подтверждённое — кошеля отряда он не ведёт и
    // ничего в него не кладёт (плату кладёт клиент дверью `sim/contracts.settle`); сверх потолка — срезано в счёте и флаг.
    expect(guilty).toEqual(['lib/bandorder.ts', 'lib/commands.ts', 'lib/contract.ts', 'lib/deeds.ts', 'lib/goods.ts', 'lib/market.ts', 'lib/roambook.ts', 'lib/war.ts', 'lib/watch.ts']);
    for (const f of files()) expect(strip(readFileSync(f, 'utf8')), rel(f)).not.toMatch(/\breward/i);
  });
});

describe('личность берётся только из подписи', () => {
  /** Обработчики, которые знают игрока. Часы его не знают — подписи у них нет нарочно. */
  const SIGNED = ['lib/routes/save.ts', 'lib/routes/castles.ts', 'lib/routes/notify.ts', 'lib/routes/war.ts', 'lib/routes/report.ts', 'lib/routes/rating.ts'];

  it.each(SIGNED)('%s: подпись проверяется до первого похода в хранилище', (p) => {
    const code = read(p);
    expect(code).toMatch(/readInitData\(/);
    const check = code.search(/if \(!auth\.ok\) return deny\(401/);
    expect(check).toBeGreaterThan(0);
    // Хранилище — и вызовом `io.stores(`, и переданным дальше (`ratingNow(io.stores)`): всё после подписи.
    expect(code.search(/\bio\.stores\b/)).toBeGreaterThan(check);
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

  /**
   * Книга войска (docs/pvp.md, раздел 6): каждый слепок, который война кладёт в бой, идёт с книгой подтверждённого войска —
   * иначе `war.liveSheet` поверил бы заявленному. Слепок без книги здесь означал бы, что подправленный клиент снова
   * выставляет в бой войско, которого у него нет.
   */
  it('война: каждый слепок идёт в бой с книгами войска, стройки и запасов', () => {
    const code = read('lib/routes/war.ts');
    const sets = [...code.matchAll(/\bsheets\.set\(player,\s*([^;]*)\);/g)].map((m) => m[1].replace(/\s+/g, ' '));
    // Агенты (АГ-1) — книгой агентов сервера (`watch.agentsOf`): отметки, скрытность, диверсия и красноречие — подтверждённые.
    // Дух дружины (ДР-1) — потолком книги духа (`watch.spiritCeilOf`): жалованье по часам сервера.
    // Командиры флангов (ДР-3) — книгой командиров (`watch.commandOf`): тактика флангов в войну — числами сервера.
    // Черты армии (ДР-4) — книгой черт и полководцем книги агентов (`watch.scarsOfRec`): черты в войну выводит сервер сам.
    expect(sets).toEqual([
      'null',
      'null',
      '{ ...sheet, book: bookOf(rec, now), town: townOf(rec, now), ...(rec.goods ? { goods: rec.goods } : {}), ...marshalOf(rec, now), ...yieldCapOf(rec, now), ...agentsOf(rec), ...commandOf(rec), ...spiritCeilOf(rec, now), ...scarsOfRec(rec), }',
    ]);
    expect([...code.matchAll(/\bsheets\.set\(/g)].length).toBe(3);
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
    // Четыре похода (ВС-1, очередь без потерь): прочесть, взять письма условно, перечитать и записать итог отправки.
    expect(calls.length).toBe(4);
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
    // Чистый старт (`era.ts`, docs/test_world.md) стирает их целиком и больше ничего с ними не делает. Указ админа (ВС-1,
    // род «указы») кладёт весть дверью исходящих (`outbox.outboxOf` → `queueNews`): команды хранилищ не называют сами.
    expect(uses(/STORES\.(?:notify|due)\b/)).toEqual(['lib/deliver.ts', 'lib/era.ts', 'lib/outbox.ts', 'lib/routes/bot.ts', 'lib/routes/notify.ts', 'lib/routes/war.ts']);
    expect([...read('lib/commands.ts').matchAll(/\b(?:queueNews|outboxOf)\(/g)].length).toBe(2);
    expect(read('lib/commands.ts')).toMatch(/await queueNews\(outboxOf\(io\.stores\), new Map\(\[\[f\.key, \{ add: \[grantNotice\(grant\)\], drop: \[\] \}\]\]\), now\);/);
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
  /**
   * Второй адаптер — сеть TON (решение владельца 09.10.2026, docs/payments.md): сервер сам проверяет перевод USDT, и
   * запрос к API сети ходит только из `lib/ton.ts`. Адрес и слова Telegram по-прежнему только в `lib/telegram.ts`.
   */
  it('наружу ходят два адаптера: Telegram — только lib/telegram.ts, сеть TON — только lib/ton.ts', () => {
    const guilty = files()
      .filter((f) => /\bfetch\s*\(|api\.telegram\.org|sendMessage/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel);
    expect(guilty).toEqual(['lib/telegram.ts', 'lib/ton.ts']);
    const tg = files()
      .filter((f) => /api\.telegram\.org|sendMessage/.test(strip(readFileSync(f, 'utf8'))))
      .map(rel);
    expect(tg).toEqual(['lib/telegram.ts']);
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
      // оплата алмазов: вечный замок начисления заказа (FIN-6, АУ-8)
      'readCreditLock',
      // оплата алмазов (docs/payments.md): курсор просмотра кошелька (FIN-1)
      'readCursor',
      'readEraFile',
      'readFrozen',
      'readGrants',
      // вести края (docs/feed.md): память первых мест рейтинга — кто и когда вышел вперёд
      'readLeaders',
      'readLedger',
      'readNotify',
      // оплата алмазов: указатель «номер заказа → игрок» (FIN-1)
      'readOrderOwner',
      // оплата алмазов (docs/payments.md): заказы игрока и метка оплаченного перевода
      'readPaidMark',
      'readPayFile',
      // замеры с телефонов (docs/telemetry.md): сутки устройства замка
      'readPerfDay',
      // оплата алмазов: очередь возвратов — перевод, который не начислен (FIN-7)
      'readRefund',
      // обнуление партии одного игрока (30.10.2026, docs/admin.md): метка обнуления
      'readReset',
      'readRoster',
      'readStoredReport',
      'readStoredSheet',
      'readWars',
      'readWatchRecord',
      'reader',
    ]);
    expect(bare).toEqual(['lib/routes/save.ts']);
    // `partyreset.ts` кладёт в архив партию и наблюдение как есть, строкой, — не читая их (30.10.2026, docs/admin.md).
    expect(movers.sort()).toEqual(['lib/blobs.ts', 'lib/partyreset.ts', 'vps/import.ts', 'vps/sqlite.ts']);
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
    // `partyreset.ts` — обнуление партии одного игрока командой обслуживания сервера (30.10.2026): архив и метка обнуления.
    expect(uses).toEqual(['lib/admin.ts', 'lib/commands.ts', 'lib/deliver.ts', 'lib/era.ts', 'lib/partyreset.ts']);
    expect(read('lib/deliver.ts')).not.toMatch(/admin\??\.(?:setJSON|set|delete)\(/);
    // Чистый старт стирает в хранилище админки только указы: заморозка и журнал админа остаются (`era.ADMIN_KEEP`).
    expect([...read('lib/era.ts').matchAll(/STORES\.admin\b[^\n]*/g)].map((m) => m[0])).toEqual([
      "STORES.admin] = await sweep(stores(STORES.admin, 'strong'), (k) => ADMIN_KEEP.includes(k));",
    ]);
  });

  it('перезапись — только известными читателями', () => {
    const calls = files().flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/\brewrite\([^;]*?\b(read\w+)\b/g)].map((m) => m[1]));
    expect(calls.length).toBeGreaterThan(3);
    expect([...new Set(calls)].sort()).toEqual(['readAdminLog', 'readFrozen', 'readGrants', 'readReset', 'readWatchRecord']);
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
