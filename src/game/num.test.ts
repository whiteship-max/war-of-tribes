// Дробь в тексте игрока — запятой, и запись числа одна (docs/ui_audit.md, 4.5; решение владельца 14.4, вопрос 2).
// Область правила — строки игрока: `src/` без картинки (`render/`, поляна предыстории — значения стилей и шейдеров), без
// ключей памяти и стилей промысла и без журналов окон проверки, которые копируют в сообщение разработчику.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dec, num, signedWhole } from './num';
import { fameWord, moraleWord } from './data/eventKit';

const SRC = join(__dirname, '..');

/** Где `toFixed` законен: сама дверь и места без текста игрока. */
const OUTSIDE = [
  'game/num.ts',
  'render/',
  'prologue/',
  'minigames/stage.ts', // ключ памяти кадра и значение стиля
  'ui/battle/TwReplay.tsx', // ключ памяти подписи ролика
  'gestlog.ts', // журнал касаний для разработчика
  'scenelog.ts', // журнал сцены для разработчика
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const bare = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('ECO-7: ноль без знака', () => {
  it('дробь около нуля — «0», а не «-0»', () => {
    expect(num(-0.04)).toBe('0');
    expect(dec(-0.04)).toBe('0,0');
    expect(dec(-0.004, 2)).toBe('0,00');
    expect(num(-0.06)).toBe('-0,1');
  });

  it('целое со знаком: ноль — «0», знак — у округлённого числа', () => {
    expect(signedWhole(0)).toBe('0');
    expect(signedWhole(-0.3)).toBe('0');
    expect(signedWhole(0.4)).toBe('0');
    expect(signedWhole(4)).toBe('+4');
    expect(signedWhole(-2)).toBe('−2');
    expect(signedWhole(2.6)).toBe('+3');
    expect(moraleWord(0)).toBe('мораль 0');
    expect(fameWord(-4)).toBe('престиж −4');
  });
});

describe('дробь запятой — одной дверью', () => {
  it('запись: ровно знаков и без лишних нулей', () => {
    expect(dec(1.05, 2)).toBe('1,05');
    expect(dec(12, 1)).toBe('12,0');
    expect(dec(0.5)).toBe('0,5');
    expect(num(4.5)).toBe('4,5');
    expect(num(9)).toBe('9');
    expect(num(10, 1)).toBe('10');
    expect(num(0.25, 2)).toBe('0,25');
    expect(num(1.2, 3)).toBe('1,2');
  });

  it('строки игрока не зовут toFixed и не меняют точку на запятую сами', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (OUTSIDE.some((o) => rel === o || (o.endsWith('/') && rel.startsWith(o)))) continue;
      seen++;
      const code = bare(readFileSync(file, 'utf8'));
      if (/\.toFixed\(/.test(code) || /\.replace\('\.', ','\)/.test(code)) bad.push(rel);
    }
    // Область: файлов со строками игрока много — проверка не пустая.
    expect(seen).toBeGreaterThan(200);
    expect(bad, 'дробь мимо game/num').toEqual([]);
  });
});
