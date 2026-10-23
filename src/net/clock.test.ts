import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clockDrift, clockSynced, resetClock, serverNow, setServerTime } from './clock';

afterEach(resetClock);

describe('часы', () => {
  it('без сервера отдают время устройства и честно говорят, что не сверялись', () => {
    expect(clockSynced()).toBe(false);
    expect(clockDrift()).toBe(0);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
  });

  it('серверное «сейчас» становится поправкой, а не разовым значением', () => {
    const ahead = Date.now() + 3_600_000;
    setServerTime(ahead);
    expect(clockSynced()).toBe(true);
    expect(clockDrift()).toBeGreaterThan(3_500_000);
    // Поправка живёт: следующее «сейчас» тоже сдвинуто, а не вернулось к телефону.
    expect(serverNow() - Date.now()).toBeGreaterThan(3_500_000);
  });

  it('мусор поправку не трогает: сломанный ответ хуже отсутствующего', () => {
    setServerTime(Date.now() + 1000);
    const was = clockDrift();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) setServerTime(bad);
    expect(clockDrift()).toBe(was);
  });
});

/**
 * Договор, ради которого модуль вообще заведён отдельно: **часы устройства
 * игра спрашивает в одном месте.**
 *
 * По «сейчас» считается догон офлайна и календарный день ежедневки — то есть
 * ровно то, что переведённые часы телефона и ломают. Пока чтение было
 * разбросано по дюжине файлов, серверное время нельзя было завести иначе как
 * обойдя половину из них и забыв вторую. Проверяется чтением исходников, потому
 * что иначе договор держится на честном слове ровно до следующей правки: новый
 * `Date.now()` в симуляции ничем себя не выдаёт.
 *
 * Что именно запрещено: `Date.now()` и `new Date()` без доводов — оба читают
 * часы. `new Date(число)` при этом разрешён: он не читает часы, а показывает
 * уже известное время, и без него не написать ни одной даты на экране.
 */
describe('время берут в одну дверь', () => {
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const CLOCK_READS: [RegExp, string][] = [
    [/\bDate\s*\.\s*now\s*\(/, 'зовёт Date.now()'],
    [/\bnew\s+Date\s*\(\s*\)/, 'зовёт new Date()'],
  ];

  it('образцы ловят чтение часов и не ловят показ даты', () => {
    const caught = (line: string): boolean => CLOCK_READS.some(([re]) => re.test(strip(line)));
    for (const line of [
      'const t = Date.now();',
      'lastSaved: Date . now (),',
      'const today = new Date();',
    ]) {
      expect([line, caught(line)]).toEqual([line, true]);
    }
    for (const line of [
      "new Date(ms).toLocaleTimeString('ru-RU')",
      'const t = serverNow();',
      'const d = new Date(card.siege.since);',
    ]) {
      expect([line, caught(line)]).toEqual([line, false]);
    }
  });

  it('ни симуляция, ни мир, ни интерфейс, ни профиль, ни предыстория часов не читают', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        // Тесты меряют время сами и по-своему — это не игра.
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    for (const dir of ['game', 'world', 'ui', 'profile', 'battle', 'prologue', 'minigames']) walk(join(root, dir));
    expect(files.length).toBeGreaterThan(50);

    const guilty: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      for (const [re, why] of CLOCK_READS) if (re.test(src)) guilty.push(`${f}: ${why}`);
    }
    expect(guilty).toEqual([]);
  });
});

/**
 * У «сейчас» два читателя (`partyNow` против `serverNow`): партия — племя и мир — живёт часами партии,
 * игрок — настоящими. Под скоростью проверки они расходятся, и файл, оставшийся на настоящих часах,
 * молча отстал бы от остальной партии: мир на `serverNow` при быстром племени — та самая болезнь двух
 * часов, которую чинили пачки 5 и 6 (docs/time.md, разделы 18.6 и 19). Поэтому список законных читателей
 * настоящих часов в зонах партии записан поимённо, с причиной, и счётом обращений.
 */
describe('«сейчас» партии — одни часы на племя и мир', () => {
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^import[^;]*;/gm, ' ');
  const root = join(__dirname, '..');
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  };
  const count = (src: string, name: string): number => (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
  const rel = (f: string): string => f.slice(root.length + 1).split(sep).join('/');

  /** Кто в зонах партии читает настоящие часы, сколько раз и почему. */
  const PLAYER_CLOCK: Record<string, [number, string]> = {
    'ui/parts/daily/DailyPage.tsx': [2, 'ежедневка — календарный день UTC, один на всех игроков'],
    'world/store.ts': [2, 'срок куска карты — инструмент, цена пересчёта настоящая'],
    'ui/trades.ts': [1, 'энергия промыслов — сутки игрока, как ежедневка; скорость проверки её не ускоряет (docs/minigames.md, 1)'],
    'ui/parts/weather.ts': [2, 'погода — одна на всех игроков региона, как ежедневка: общие часы, а не партия (docs/city.md, 15)'],
    'ui/next/TreasuryBuy.tsx': [1, 'срок заказа оплаты — настоящие полчаса по часам сервера, их ставит сервер (docs/payments.md)'],
    'ui/next/Treasury.tsx': [1, 'лавка алмазов — сутки по часам сервера (полночь UTC), как ежедневка; счёт ведёт сервер (docs/gems.md)'],
    'ui/chambers/Chambers.tsx': [1, 'отлучка из покоев — часы игрока, без ускорения партии: советник встречает после 15 настоящих минут (ПК-1, docs/city_v3.md)'],
    'ui/realm/RealmNew.tsx': [1, 'ячейка «Задания» в строке очков (СБ-2б): ждёт ли задание дня — календарный день UTC, как у ежедневки'],
  };

  it('в племени, мире, интерфейсе и профиле настоящие часы читают только названные', () => {
    const files = ['game', 'world', 'ui', 'profile', 'battle'].flatMap((d) => walk(join(root, d)));
    const readers: Record<string, number> = {};
    for (const f of files) {
      const n = count(strip(readFileSync(f, 'utf8')), 'serverNow');
      if (n > 0) readers[rel(f)] = n;
    }
    expect(readers, 'кто живёт настоящими часами').toEqual(
      Object.fromEntries(Object.entries(PLAYER_CLOCK).map(([f, [n]]) => [f, n])),
    );
    // Точка внутри области: часы партии читают вход и запись партии, цикл стора и мир.
    const party = files.filter((f) => count(strip(readFileSync(f, 'utf8')), 'partyNow') > 0).map(rel);
    expect(party, 'кто живёт часами партии').toEqual(
      expect.arrayContaining(['game/save.ts', 'game/state.ts', 'game/store.ts', 'world/local/LocalWorld.ts', 'world/store.ts']),
    );
  });

  it('промыслы часов партии не читают: их время — секунды сцены и сутки игрока', () => {
    const files = walk(join(root, 'minigames'));
    expect(files.length, 'точка внутри области: файлы найдены').toBeGreaterThan(5);
    const linked = files.filter((f) => /\b(partyNow|leadNow|leadAt)\b/.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(linked).toEqual([]);
  });

  it('предыстория — своя игра: часов партии деревни она не читает', () => {
    const files = walk(join(root, 'prologue'));
    expect(files.length, 'точка внутри области: файлы найдены').toBeGreaterThan(10);
    const linked = files.filter((f) => /\b(partyNow|leadNow|leadAt)\b/.test(strip(readFileSync(f, 'utf8')))).map(rel);
    expect(linked).toEqual([]);
  });
});
