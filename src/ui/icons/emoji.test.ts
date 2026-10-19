// В игре нет ни одного эмодзи (ЗН-1, docs/icons.md): ни в окнах, ни в подсказках, ни в кнопках, ни в летописи, ни в вестях
// бота. Значок — только рисунок набора (`ui/icons/Icon.tsx`); текст бота — чистый текст. Исключение одно — то, что
// игрок напечатал сам (имя города, имя правителя): в исходниках его нет, и тест его не видит.
//
// Прежде правило было мягче — «эмодзи только из Emoji 12.0» (белый список `emoji12.ts`), и эмодзи стояли запасным
// рисунком, пока лист значков не приехал. С набором ЗН-1 запасного рисунка нет: ленивый значок — пустое место своего
// размера.
//
// Что считается эмодзи, решают свойства Unicode самого Node: `Extended_Pictographic` (туда входят и ещё не занятые места
// в блоках эмодзи — всё, что появится позже), `Emoji_Presentation`, буквы флагов и приставка VS16 (U+FE0F), которая
// делает эмодзи из обычного знака. К ним — знаки-значки, которые рисует система, а не наш шрифт (✕ ✓ ◆ ✦ ⌖ ⌘ ▢ ▫):
// значок рисуется набором, а не чужим шрифтом.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|mts|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Комментарии не рисуются: в них эмодзи можно назвать. Строки сохраняются, чтобы номер строки в ответе был настоящим.
 * Тесты не читаются тоже — там эмодзи бывает мусором на входе (имя города игрока), а на экран из кода не попадает.
 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Эмодзи и знаки-значки системы. */
const PICTO = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}️✓-✖✦✧◆▢▫▪⌖⌘➕-➗]/gu;

function emojiIn(text: string): { cp: number; line: number }[] {
  const out: { cp: number; line: number }[] = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(PICTO)) out.push({ cp: m[0].codePointAt(0)!, line: i + 1 });
  });
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');
const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase()}`;

/** Где тест ищет: код игры, сервер с ботом и экран загрузки. */
function scan(): { files: number; hits: string[] } {
  const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'netlify')), join(ROOT, 'index.html')];
  const hits: string[] = [];
  for (const file of files) {
    const code = strip(readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' ')));
    for (const { cp, line } of emojiIn(code)) hits.push(`${rel(file)}:${line} ${hex(cp)}`);
  }
  return { files: files.length, hits };
}

describe('эмодзи нет нигде', () => {
  it('образцы: эмодзи узнаётся с приставкой и без, знак-значок — тоже; кириллица, стрелки и знаки текста — нет', () => {
    const f = String.fromCodePoint;
    const seen = (s: string) => emojiIn(s).map((e) => e.cp);
    expect(seen(`мечи ${f(0x2694, 0xfe0f)}`)).toEqual([0x2694, 0xfe0f]);
    expect(seen(`монета ${f(0x1fa99)}`)).toEqual([0x1fa99]);
    expect(seen(`знамя ${f(0x1f1f7, 0x1f1fa)}`)).toEqual([0x1f1f7, 0x1f1fa]);
    // Незанятое место в блоке эмодзи — тоже эмодзи: то, что появится после Node, не пройдёт мимо.
    expect(seen(f(0x1faff))).toEqual([0x1faff]);
    expect(seen('закрыть ✕')).toEqual([0x2715]);
    expect(seen('Дружина: 10 · −1 +1 × ÷ «» → ← ›')).toEqual([]);
  });

  it('комментарий не рисуется и в счёт не идёт, а строки после него считаются верно', () => {
    const coin = String.fromCodePoint(0x1fa99);
    const text = strip(`/* ${coin}\n ${coin} */\n// ${coin}\nconst a = '${coin}'; // ${coin}\n`);
    expect(emojiIn(text)).toEqual([{ cp: 0x1fa99, line: 4 }]);
    expect(strip(`const url = 'https://t.me/x';`)).toContain('t.me/x');
  });

  it('по всему src, netlify и index.html: ни одного эмодзи и знака-значка в коде', () => {
    const { files, hits } = scan();
    // Область правила: обошли весь код игры и сервера, а не пустоту.
    expect(files, 'обошли src, netlify и index.html').toBeGreaterThan(400);
    expect(hits).toEqual([]);
  });
});
