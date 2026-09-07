import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Мёртвых артов не бывает: собранное либо подключено, либо не собирается.
 *
 * Правило заведено после двух случаев за один заход. Первый: «племя у костра»
 * резалось занавесом и никуда не импортировалось — лежало готовым файлом, пока
 * его не нашли глазами. Второй: векторную заставку заменили артом, а исходник
 * остался в assets-src, где однажды вернулся бы по ошибке.
 *
 * Обе беды ловятся одной проверкой с двух концов:
 *
 *   1. каждый файл в `src/ui/art/` кто-то импортирует;
 *   2. каждый исходник в `assets-src/splash/` кто-то режет.
 *
 * Дальше `public/assets/` проверка не идёт нарочно: там на файлы ссылаются
 * собранным именем (`village-${n}.mp3`, `${id}_face.webp`), и поиск подстрокой
 * дал бы ложное «никто не ссылается» на живой файл. Такую проверку лучше не
 * иметь вовсе, чем иметь врущую.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ART = path.join(ROOT, 'src', 'ui', 'art');
const SPLASH_SRC = path.join(ROOT, 'assets-src', 'splash');

/** Все исходники проекта одной строкой: по ней и ищем упоминания. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, acc);
    else if (/\.(ts|tsx|mjs)$/.test(name)) acc.push(readFileSync(full, 'utf8'));
  }
  return acc;
}

const code = [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'scripts'))].join('\n');

describe('арты: собрано — значит подключено', () => {
  it('каждый файл в src/ui/art кто-то импортирует', () => {
    const dead = readdirSync(ART)
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => !code.includes(f));
    expect(dead, 'лежит в src/ui/art и никем не импортируется').toEqual([]);
  });

  it('каждый исходник заставок кто-то режет', () => {
    const build = readFileSync(path.join(ROOT, 'scripts', 'build-splash.mjs'), 'utf8');
    const dead = readdirSync(SPLASH_SRC)
      .filter((f) => /\.(png|jpg|jpeg|webp|svg)$/i.test(f))
      // Скрипт называет исходники по частям: `${p.name}-640.png`, `${BOOT.name}-full.png`.
      .filter((f) => {
        const stem = f.replace(/\.[a-z]+$/i, '');
        const [name, size] = stem.split('-');
        return !(build.includes(`'${name}'`) && build.includes(`-${size}.png`));
      });
    expect(dead, 'лежит в assets-src/splash и никем не режется').toEqual([]);
  });

  it('занавес в игре ровно один, и его файл на месте', () => {
    expect(readdirSync(ART).filter((f) => f.startsWith('curtain-'))).toEqual(['curtain-camp.webp']);
  });
});
