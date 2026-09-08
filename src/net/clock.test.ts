import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

  it('ни симуляция, ни мир, ни интерфейс, ни профиль часов не читают', () => {
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
    for (const dir of ['game', 'world', 'ui', 'profile', 'battle']) walk(join(root, dir));
    expect(files.length).toBeGreaterThan(50);

    const guilty: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      for (const [re, why] of CLOCK_READS) if (re.test(src)) guilty.push(`${f}: ${why}`);
    }
    expect(guilty).toEqual([]);
  });
});
