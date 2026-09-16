// Эмодзи в исходниках — только из Emoji 12.0 и старше. Тест по всему `src`, как у
// `Math.random` (`game/sim/random.test.ts`).
//
// Эмодзи Emoji 13.0 и новее на части телефонов рисуется пустым квадратом. Дважды подряд
// это ловили глазами в браузере — монету, потом камень. Словами правило стояло в
// CLAUDE.md и не держало ничего.
//
// Проверка — белым списком кодовых точек, а не списком плохих: плохой символ, о котором
// не подумали, в список плохих не попадёт никогда. Сам список — `emoji12.ts`, собранный
// `npm run emoji:build` из таблицы Unicode; руками его не правят.
//
// Что считается эмодзи, решает не список, а свойства Unicode самого Node:
// `Extended_Pictographic` (сюда входят и ещё не занятые места в блоках эмодзи — то есть
// всё, что появится позже), `Emoji_Presentation` и буквы флагов. Нашёлся такой символ —
// он обязан быть в списке 12.0.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMOJI_RANGES, EMOJI_VERSION } from './emoji12';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Комментарии не рисуются: в них эмодзи можно назвать, в том числе запрещённое. Строки
 * сохраняются, чтобы номер строки в ответе был настоящим. Тесты не читаются тоже — там
 * эмодзи бывает мусором на входе, а на экран не попадает.
 */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Что тест считает эмодзи. */
const PICTO = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]/gu;

/**
 * Склейка ZWJ собирает из старых символов новый (есть такие и в 13.0), и по кодовым точкам
 * её не проверить. Сейчас склеек в игре нет ни одной; понадобится — список склеек 12.0
 * (`emoji-zwj-sequences.txt`) заводится тем же скриптом, а не исключением здесь.
 */
const ZWJ = '‍';

const allowed = (cp: number): boolean => cp < 0x80 || EMOJI_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** Все эмодзи в тексте: кодовая точка и номер строки. */
function emojiIn(text: string): { cp: number; line: number }[] {
  const out: { cp: number; line: number }[] = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(PICTO)) out.push({ cp: m[0].codePointAt(0)!, line: i + 1 });
  });
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');
const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase()}`;

/**
 * Долг, а не исключение: места, где символ новее 12.0 стоял до теста. Замена ждёт решения
 * владельца. Список сверяется **ровно** — новое место уронит тест, и починенное тоже,
 * пока его не вычеркнут отсюда. Дописывать сюда нельзя.
 */
const DEBT: readonly string[] = [
  'game/data/troops.ts:43 U+1FA83',
  'ui/SyncModal.tsx:27 U+1FA9F',
  'ui/map/ActionMenu.tsx:455 U+1FAE5',
  'ui/panels/BattlePanel.tsx:282 U+1FAB5',
  'ui/panels/ReportPanel.tsx:327 U+1FAA6',
  'ui/parts/Statue.tsx:95 U+1FA99',
  'ui/parts/Tavern.tsx:21 U+1FA99',
  'ui/parts/Tavern.tsx:34 U+1FA99',
  'ui/parts/Tavern.tsx:57 U+1FA99',
  'ui/parts/TroopCardView.tsx:190 U+1FAA8',
  'world/data/diplomacy.ts:101 U+1FAA8',
];

describe('эмодзи — только из Emoji 12.0 и старше', () => {
  it('список — таблица 12.0, и граница стоит там, где кончается 12.0', () => {
    expect(EMOJI_VERSION).toBe('12.0');
    // Пары по обе стороны границы внутри одного блока: последнее из 12.0 и первое из 13.0.
    expect(allowed(0x1fa82), 'парашют — 12.0').toBe(true);
    expect(allowed(0x1fa83), 'бумеранг — 13.0').toBe(false);
    expect(allowed(0x1fa95), 'банджо — 12.0').toBe(true);
    expect(allowed(0x1fa96), 'военный шлем — 13.0').toBe(false);
    expect(allowed(0x1fa93), 'топор — 12.0').toBe(true);
    expect(allowed(0x1fa99), 'монета — 13.0').toBe(false);
    expect(allowed(0x1faa8), 'камень — 13.0').toBe(false);
    expect(allowed(0x1fab5), 'полено — 13.0').toBe(false);
    expect(allowed(0x2694), 'скрещённые мечи — старый символ').toBe(true);
  });

  it('образцы: эмодзи узнаётся с приставкой и без, кириллица и знаки — нет', () => {
    const f = String.fromCodePoint;
    const seen = (s: string) => emojiIn(s).map((e) => e.cp);
    expect(seen(`мечи ${f(0x2694, 0xfe0f)}`)).toEqual([0x2694]);
    expect(seen(`монета ${f(0x1fa99)}`)).toEqual([0x1fa99]);
    expect(seen(`знамя ${f(0x1f1f7, 0x1f1fa)}`)).toEqual([0x1f1f7, 0x1f1fa]);
    // Незанятое место в блоке эмодзи — тоже эмодзи: то, что появится после Node, не пройдёт мимо.
    expect(seen(f(0x1faff))).toEqual([0x1faff]);
    expect(seen('Дружина: 10 · −1 +1 × ÷ «»')).toEqual([]);
  });

  it('комментарий не рисуется и в счёт не идёт, а строки после него считаются верно', () => {
    const coin = String.fromCodePoint(0x1fa99);
    const text = strip(`/* ${coin}\n ${coin} */\n// ${coin}\nconst a = '${coin}'; // ${coin}\n`);
    expect(emojiIn(text)).toEqual([{ cp: 0x1fa99, line: 4 }]);
    expect(strip(`const url = 'https://t.me/x';`)).toContain('t.me/x');
  });

  it('по всему src: каждое эмодзи в коде есть в списке 12.0, кроме записанного долга', () => {
    const hits: string[] = [];
    const zwj: string[] = [];
    let files = 0;
    let found = 0;
    for (const file of sources(ROOT)) {
      files++;
      const code = strip(readFileSync(file, 'utf8'));
      const path = rel(file);
      for (const { cp, line } of emojiIn(code)) {
        found++;
        if (!allowed(cp)) hits.push(`${path}:${line} ${hex(cp)}`);
      }
      code.split('\n').forEach((l, i) => {
        if (l.includes(ZWJ)) zwj.push(`${path}:${i + 1}`);
      });
    }
    // Область правила: обошли весь src и нашли в нём эмодзи, а не пустоту.
    expect(files, 'обошли весь src').toBeGreaterThan(300);
    expect(found, 'эмодзи в коде есть — правило спрашивалось').toBeGreaterThan(300);
    expect(zwj, 'склейки ZWJ списком кодовых точек не проверить').toEqual([]);
    expect(hits.sort()).toEqual([...DEBT].sort());
  });
});
