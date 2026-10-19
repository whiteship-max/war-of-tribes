// Свой шрифт без системных подмен (docs/polish.md, П-1): каждый знак, который пишет интерфейс, есть в своём шрифте —
// кроме эмодзи и значков-символов, которые рисует система. Сверка идёт по кодовым точкам, собранным из самих файлов
// шрифтов (`glyphs.ts`, `npm run fonts:build`), и по строкам исходников — как тест эмодзи (`ui/icons/emoji.test.ts`).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRELOAD, SANS, TITLE } from './glyphs';
import { CANVAS_SANS, CANVAS_TITLE } from './canvas';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const ROOT = join(SRC, '..');

const has = (set: ReadonlyArray<readonly [number, number]>, cp: number): boolean => set.some(([a, b]) => cp >= a && cp <= b);

/** Знаки, которые нарочно рисует система: значки-символы (✕ закрыть, ✓, ★, ▲) — не буквы и не цифры. */
const SYMBOL = (cp: number): boolean =>
  (cp >= 0x2190 && cp <= 0x2bff && !has(SANS, cp)) || // стрелки, геометрия, разное, дингбаты
  (cp >= 0x1f000) || // эмодзи
  cp === 0xfe0f || cp === 0x200d || // селектор вида и склейка эмодзи
  (cp >= 0x2100 && cp <= 0x214f && !has(SANS, cp)); // буквоподобные (ℹ)

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Строки кода без комментариев: текст игрока живёт в литералах и JSX, а не в пояснениях. */
function strings(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

describe('свой шрифт', () => {
  it('буквы и знаки текстов игры есть в основном шрифте — подмены нет', () => {
    // Атлас и списки — данные, а не текст; музыка называет фразы для себя (A′, A″), игроку они не пишутся. Пути — через
    // `/`: на Windows `join` даёт `\`, и пропуск папки `${s}/` не срабатывал.
    const skip = ['world/atlas/data.ts', 'ui/fonts/glyphs.ts', 'src/sound'];
    const missing = new Map<string, string>();
    for (const f of files(SRC)) {
      const path = f.replace(/\\/g, '/');
      if (skip.some((s) => path.endsWith(s) || path.includes(`${s}/`))) continue;
      for (const ch of strings(readFileSync(f, 'utf8'))) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x80 || has(SANS, cp) || SYMBOL(cp)) continue;
        // Греческие буквы и математика — в формулах кода (θ, π), игроку они не пишутся.
        if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x2200 && cp <= 0x22ff) || (cp >= 0x2070 && cp <= 0x209f)) continue;
        const key = `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${ch}`;
        if (!missing.has(key)) missing.set(key, f.slice(ROOT.length + 1));
      }
    }
    expect([...missing].map(([k, f]) => `${k} — ${f}`)).toEqual([]);
  });

  it('кириллица — целиком в обоих шрифтах, с ё', () => {
    for (let cp = 0x410; cp <= 0x44f; cp++) {
      expect(has(SANS, cp), String.fromCodePoint(cp)).toBe(true);
      expect(has(TITLE, cp), String.fromCodePoint(cp)).toBe(true);
    }
    for (const ch of 'ЁёІіЇїЄєҐґЎў«»—–…№') expect(has(SANS, ch.codePointAt(0)!), ch).toBe(true);
  });

  it('гарнитуры одни на CSS, экран загрузки и холст', () => {
    const css = readFileSync(join(SRC, 'ui', 'styles.css'), 'utf8');
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const faces = readFileSync(join(SRC, 'ui', 'fonts', 'fonts.css'), 'utf8');
    const family = (stack: string): string => /^'([^']+)'/.exec(stack)![1];
    expect(css).toMatch(new RegExp(`--font-sans:\\s*'${family(CANVAS_SANS)}'`));
    expect(css).toMatch(new RegExp(`--font-title:\\s*'${family(CANVAS_TITLE)}'`));
    expect(faces).toContain(`font-family: '${family(CANVAS_SANS)}'`);
    expect(faces).toContain(`font-family: '${family(CANVAS_TITLE)}'`);
    expect(html).toContain(`'${family(CANVAS_SANS)}'`);
    expect(html).toContain(`'${family(CANVAS_TITLE)}'`);
    // Кнопки и поля браузер набирает своим шрифтом, если не сказать иначе.
    expect(css).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{\s*font-family:\s*inherit;/);
    // Ни одной системной гарнитуры первой в стеке: `font-family`/`font` начинаются со своей или с переменной.
    const all = files(SRC).concat(cssFiles(SRC));
    const system: string[] = [];
    for (const f of all) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/font(?:-family)?:\s*(?:[\d.]+px(?:\/[\d.]+px)?\s+)?(?:[\d]{3}\s+)?((?:system-ui|-apple-system|Georgia|Arial|Roboto|'Segoe UI'|sans-serif|serif)[^;'`"]*)/g))
        system.push(`${f.slice(ROOT.length + 1)}: ${m[1]}`);
    }
    expect(system.filter((s) => !/monospace|Emoji/.test(s))).toEqual([]);
  });

  it('первая загрузка ждёт два файла ядра, и index.html зовёт ровно их', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const preload = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin \/>/g)].map((m) => m[1]);
    expect(preload).toEqual([...PRELOAD]);
    let bytes = 0;
    for (const p of PRELOAD) {
      const file = join(ROOT, 'public', p);
      expect(existsSync(file), p).toBe(true);
      bytes += statSync(file).size;
    }
    // Ядро — латиница, русская кириллица и знаки: два начертания вместе меньше 30 КБ (замер — docs/polish.md, П-1).
    expect(bytes).toBeLessThan(30_000);
  });

  it('у каждого начертания — файл ядра и файл редких знаков, и все они на месте', () => {
    const faces = readFileSync(join(SRC, 'ui', 'fonts', 'fonts.css'), 'utf8');
    const urls = [...faces.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(12);
    for (const u of urls) expect(existsSync(join(ROOT, 'public', u)), u).toBe(true);
    expect(faces.match(/font-display: swap;/g)?.length).toBe(urls.length);
    expect(faces.match(/unicode-range:/g)?.length).toBe(urls.length);
    // Лицензия едет рядом со шрифтами (OFL, пункт 2).
    for (const lic of ['OFL-GolosText.txt', 'OFL-AlegreyaSC.txt']) expect(existsSync(join(ROOT, 'public', 'fonts', lic)), lic).toBe(true);
  });
});

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css') && !p.endsWith(join('fonts', 'fonts.css'))) out.push(p);
  }
  return out;
}
