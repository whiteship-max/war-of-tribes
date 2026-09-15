import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Мёртвых артов не бывает: исходник либо режется, либо не лежит.
 *
 * Правило заведено после случая, когда векторную заставку заменили артом, а исходник
 * остался в assets-src, где однажды вернулся бы по ошибке. Второй его конец — «каждый
 * собранный арт в `src/ui/art/` кто-то импортирует» — ушёл вместе с последним таким
 * артом (занавесом перехода на карту): папки больше нет, и проверять там нечего. Заведут
 * собранный арт в `src/` снова — вместе с ним возвращается и та проверка.
 *
 * Дальше `public/assets/` проверка не идёт нарочно: там на файлы ссылаются собранным
 * именем (`village-${n}.mp3`, `${id}_face.webp`), и поиск подстрокой дал бы ложное
 * «никто не ссылается» на живой файл. Такую проверку лучше не иметь вовсе, чем иметь врущую.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLASH_SRC = path.join(ROOT, 'assets-src', 'splash');

describe('арты: исходник — значит режется', () => {
  it('каждый исходник заставок кто-то режет', () => {
    const build = readFileSync(path.join(ROOT, 'scripts', 'build-splash.mjs'), 'utf8');
    const art = readdirSync(SPLASH_SRC).filter((f) => /\.(png|jpg|jpeg|webp|svg)$/i.test(f));
    // Точки проверки внутри области: пустая папка дала бы зелёный даром.
    expect(art.length).toBeGreaterThan(0);
    const dead = art
      // Скрипт называет исходник по частям: `${BOOT.name}-full.jpg`. Расширение в счёт не
      // идёт: исходники приходят от художника тем форматом, каким нарисованы.
      .filter((f) => {
        const stem = f.replace(/\.[a-z]+$/i, '');
        const [name, size] = stem.split('-');
        return !(build.includes(`'${name}'`) && build.includes(`-${size}.`));
      });
    expect(dead, 'лежит в assets-src/splash и никем не режется').toEqual([]);
  });

  it('занавеса перехода на карту в игре нет — ни компонента, ни арта', () => {
    const src = path.join(ROOT, 'src');
    expect(readdirSync(path.join(src, 'ui')).filter((f) => /curtain/i.test(f) || f === 'art')).toEqual([]);
    expect(readFileSync(path.join(src, 'game', 'store.ts'), 'utf8')).not.toMatch(/\bcurtain/);
  });
});
