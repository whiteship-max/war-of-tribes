// Голос текстов нового вида (docs/ui_audit.md, 4.1–4.4): строки экранов этапа 2 без признаков канцелярского и машинного
// текста, без восклицаний и без слов, которые словарь убрал. Проверка грубая и нарочно такая: она ловит прямое слово,
// которое однажды напишут не думая, а не тонкость.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = join(__dirname, '..');

/** Файлы экранов этапа 2 — новый вид целиком своими строками. */
export const STAGE2 = ['next/CityNaming.tsx', 'next/cityNames.ts', 'realm/RealmTabs.tsx', 'next/WorldNew.tsx', 'next/MarchesNew.tsx'];

/** Строки игрока в исходнике: литералы и текст разметки с кириллицей; комментарии — мимо. */
export function playerStrings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</g)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (/[а-яё]/i.test(t)) out.push(t);
  }
  return out;
}

/** 4.3: слова и обороты, которых нет нигде; 4.4: слова, которые словарь заменил. */
export const BANNED = [
  /Вы можете|Ты можешь/,
  /^(Можно|Нужно)\b/,
  /Обратите внимание|Стоит отметить|^Важно|^Учти/,
  /позволя|даёт возможность/,
  /\bданн(ый|ая|ое|ые)\b|является|осуществ|в рамках|с целью|для того чтобы|таким образом|в свою очередь|при этом|а также|следует|необходимо/,
  /!/,
  /посёл|деревн|\bвождь\b|рацион/i,
];

describe('голос текстов этапа 2', () => {
  it('ни канцелярита, ни восклицаний, ни слов, которые словарь убрал', () => {
    let seen = 0;
    for (const f of STAGE2) {
      for (const t of playerStrings(readFileSync(join(UI, f), 'utf8'))) {
        seen++;
        for (const bad of BANNED) expect(t, `${f}: «${t}»`).not.toMatch(bad);
      }
    }
    // Область: строки нашлись — проверка не пустая.
    expect(seen).toBeGreaterThan(30);
  });

  it('щуп строк видит литерал, шаблон и текст разметки', () => {
    const got = playerStrings(`const a = 'Привет'; const b = \`Срок \${x}\`; <b>Город</b> // Комментарий`);
    expect(got).toEqual(['Привет', 'Срок ${x}', 'Город']);
  });
});
