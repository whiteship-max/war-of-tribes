// Контраст и кегль по всей игре (docs/polish.md, П-1): текст — не ниже 4,5 : 1 к своему фону, крупный текст и
// значки — не ниже 3 : 1 (WCAG 2.1, 1.4.3 и 1.4.11), самый мелкий текст — 12 px. Палитра своя и от темы Telegram не
// зависит: у светлой темы клиента тот же разбор, что у тёмной, — её цвета в игру не попадают вовсе.
//
// Тест читает CSS игры как текст и сам считает контраст: каждое правило, где задан цвет текста, — против фона того же
// правила (если он сплошной) или против панели, на которой стоит почти весь текст игры. Полупрозрачные панели и
// цвета сводятся к худшему случаю: панель — поверх белой сцены и поверх чёрной, у текста учтены его альфа и
// `opacity` правила.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_BG } from '@/telegram/webapp';
import { INK, TINCT } from '../../scripts/icons/kit';
import { ART } from '../../scripts/icons/set';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(SRC, '..');

type RGBA = [number, number, number, number];

// ---------- Цвет ----------

function parseColor(v: string, vars: Map<string, string>, depth = 0): RGBA | null {
  v = v.trim().replace(/\s*!important$/, '');
  if (depth > 8) return null;
  const varM = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v);
  if (varM) {
    const t = vars.get(varM[1]);
    if (t !== undefined) return parseColor(t, vars, depth + 1);
    return varM[2] ? parseColor(varM[2], vars, depth + 1) : null;
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [+rgb[1], +rgb[2], +rgb[3], a];
  }
  if (v === '#fff' || v === 'white') return [255, 255, 255, 1];
  if (v === 'black') return [0, 0, 0, 1];
  return null;
}

/** Цвет `top` поверх непрозрачного `under`. */
function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as RGBA;
}

function luminance(c: RGBA): number {
  const ch = c.slice(0, 3).map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Контраст двух непрозрачных цветов по WCAG. */
function ratio(a: RGBA, b: RGBA): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------- CSS ----------

interface Rule {
  file: string;
  selector: string;
  decls: Map<string, string>;
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Правила файла — плоско: содержимое `@media`, `@supports` и `@container` раскрыто, `@keyframes` и `@font-face` пропущены. */
function rulesOf(file: string, text: string): Rule[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const walk = (s: string): void => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) return;
      const head = s.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        j++;
      }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@media') || head.startsWith('@supports') || head.startsWith('@container')) walk(body);
      else if (!head.startsWith('@')) {
        const decls = new Map<string, string>();
        for (const d of body.split(';')) {
          const k = d.indexOf(':');
          if (k > 0) decls.set(d.slice(0, k).trim(), d.slice(k + 1).trim());
        }
        out.push({ file, selector: head.replace(/\s+/g, ' '), decls });
      }
      i = j;
    }
  };
  walk(src);
  return out;
}

const FILES = cssFiles(SRC).filter((f) => !f.includes(`${join('ui', 'fonts')}`));
const RULES = FILES.flatMap((f) => rulesOf(f.slice(ROOT.length + 1), readFileSync(f, 'utf8')));
const STYLES = readFileSync(join(SRC, 'ui', 'styles.css'), 'utf8');

/**
 * Токены палитры — из `:root` в `ui/styles.css`; токены, которые заводят свои корни (`.ui-new` — `--warn`,
 * `--panel-3`), добираются из остальных правил, не перебивая корневых.
 */
const VARS = new Map<string, string>();
for (const root of [true, false]) {
  for (const r of RULES) {
    const isRoot = r.selector === ':root' && r.file.endsWith(join('ui', 'styles.css'));
    if (isRoot !== root) continue;
    for (const [k, v] of r.decls) if (k.startsWith('--') && !VARS.has(k)) VARS.set(k, v);
  }
}

const tok = (name: string): RGBA => {
  const c = parseColor(name.startsWith('--') ? `var(${name})` : name, VARS);
  if (!c) throw new Error(`токен ${name} не цвет`);
  return c;
};

// Худшие подложки: панель поверх светлой сцены и поверх тёмной (под шторкой — диорама, днём и ночью).
const WHITE: RGBA = [255, 255, 255, 1];
const BLACK: RGBA = [0, 0, 0, 1];
const BG = tok('--bg');
const PANELS: RGBA[] = [over(tok('--panel'), WHITE), over(tok('--panel'), BLACK), over(tok('--panel'), BG)];
/** Вторая и третья панели лежат на первой. */
const PANELS_2: RGBA[] = PANELS.map((p) => over(tok('--panel-2'), p));
const PANELS_3: RGBA[] = PANELS.map((p) => over(tok('--panel-3'), p));

/** Худший контраст цвета текста `fg` (с альфой) на подложках. */
function worst(fg: RGBA, unders: RGBA[], opacity = 1): number {
  return Math.min(...unders.map((u) => ratio(over([fg[0], fg[1], fg[2], fg[3] * opacity], u), u)));
}

const TEXT = ['--text', '--muted', '--accent', '--good', '--bad', '--gem-ink'];

describe('палитра', () => {
  it('цвета текста читаются на всех поверхностях игры — не ниже 4,5 : 1', () => {
    const low: string[] = [];
    for (const t of TEXT) {
      for (const [name, unders] of [
        ['фон', [BG]],
        ['панель', PANELS],
        ['вторая панель', PANELS_2],
        ['третья панель', PANELS_3],
      ] as const) {
        // Третья панель — подложка одной кнопки («построить», `.nx-tip-maker.build`): на ней только основной текст.
        if (name === 'третья панель' && t !== '--text' && t !== '--muted') continue;
        const r = worst(tok(t), [...unders]);
        if (r < 4.5) low.push(`${t} на «${name}»: ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('надписи на цветных кнопках и метках — не ниже 4,5 : 1', () => {
    const pairs: [string, string][] = [
      ['--accent-text', '--accent'],
      ['--accent-text', '--accent-2-fill'],
      ['--accent-text', '--warn'],
      ['--gem-text', '--gem'],
      // Счётчик вкладок: тёмные цифры на красном (`.tab-count`).
      ['--accent-text', '--bad'],
      // Красная заливка под белым: «Точно?», срочная метка, срок тревоги.
      ['#ffffff', '--bad-fill'],
    ];
    const low = pairs
      .map(([fg, bg]) => [fg, bg, ratio(over(tok(fg), tok(bg)), tok(bg))] as const)
      .filter(([, , r]) => r < 4.5)
      .map(([fg, bg, r]) => `${fg} на ${bg}: ${r.toFixed(2)}`);
    expect(low).toEqual([]);
  });

  it('материалы набора (ЗН-2): подпись читается на каждой ступени вещества — не ниже 4,5 : 1', () => {
    const stops = (token: string): RGBA[] =>
      [...(VARS.get(token) ?? '').matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map((m) => parseColor(m[0], VARS)).filter((c): c is RGBA => c !== null);
    const pairs: [string, string, RGBA[]][] = [
      // Золото — под тёмную подпись главной кнопки, бирки и счётчика.
      ['--accent-text', '--m-gold', PANELS],
      // Червлень — под белую: «Точно?», срочный счётчик, срок тревоги.
      ['#ffffff', '--m-gules', PANELS],
      // Пергамент реплик покоев — чернила и пояснение.
      ['--m-parch-ink', '--m-parch', PANELS],
      ['--m-parch-muted', '--m-parch', PANELS],
      // Кожа кнопок и вкладок — основной и тихий текст; выбранная вкладка — основной.
      ['--text', '--m-leather', PANELS],
      ['--muted', '--m-leather', PANELS],
      ['--text', '--m-lit', PANELS],
      // Плашка — на ней стоят числа любого тона, самый тёмный из них — `--bad`.
      ['--text', '--m-plate', PANELS],
      ['--muted', '--m-plate', PANELS],
      ['--bad', '--m-plate', PANELS],
      ['--accent', '--m-plate', PANELS],
      ['--text', '--m-gules-dark', PANELS],
    ];
    const low: string[] = [];
    for (const [fg, mat, unders] of pairs) {
      const all = stops(mat);
      expect(all.length, mat).toBeGreaterThan(1);
      for (const b of all) {
        const r = worst(tok(fg), unders.map((u) => over(b, u)));
        if (r < 4.5) low.push(`${fg} на ${mat} (${b.join(',')}): ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('цвет фона один на CSS, экран загрузки и шапку Telegram', () => {
    expect(VARS.get('--bg')).toBe(GAME_BG);
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain(`<meta name="theme-color" content="${GAME_BG}" />`);
    expect(html).toMatch(new RegExp(`html\\s*\\{[^}]*background:\\s*${GAME_BG}`));
  });

  it('тема Telegram палитру не трогает: ни цвета из themeParams, ни светлой схемы', () => {
    const tg = readFileSync(join(SRC, 'telegram', 'webapp.ts'), 'utf8');
    // `themeParams` описан в типе клиента, но код его не читает.
    expect(tg.replace(/^\s*themeParams\?: TgThemeParams;$/m, '')).not.toMatch(/\.themeParams\b|themeParams\?\./);
    expect(tg).not.toMatch(/setProperty\(\s*'--(text|muted|panel|accent|bg|line)/);
    for (const r of RULES) expect(r.selector, r.file).not.toMatch(/data-theme=['"]?light|prefers-color-scheme/);
    expect(STYLES).toMatch(/color-scheme:\s*dark/);
  });
});

// ---------- Вся игра: каждое правило с цветом текста ----------

const px = (v: string | undefined): number | null => {
  const m = v ? /^([\d.]+)px$/.exec(v.trim()) : null;
  return m ? parseFloat(m[1]) : null;
};

/** Фон правила: сплошной — один цвет, градиент — все его цвета (текст обязан читаться на каждом); картинка — нет. */
function backOf(r: Rule): RGBA[] | null {
  const on = ON[r.selector];
  let v = on ? `var(${on.token})` : (r.decls.get('background-color') ?? r.decls.get('background'));
  // Материал набора (`kit/material.css`, ЗН-2) — токен-градиент: раскрыт, и текст обязан читаться на каждой его ступени.
  for (let i = 0; v && i < 4; i++) v = v.replace(/var\((--m-[\w-]+)\)/g, (m, k: string) => VARS.get(k) ?? m);
  if (!v || /url\(/.test(v)) return null;
  if (!/gradient/.test(v)) {
    const c = parseColor(v, VARS);
    return c ? [c] : null;
  }
  const stops = [...v.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|var\(--[\w-]+\)/gi)]
    .map((m) => parseColor(m[0], VARS))
    .filter((c): c is RGBA => c !== null);
  return stops.length > 0 ? stops : null;
}

/**
 * Где правило не про текст на панели: погасшее (WCAG такие исключает), прозрачный цвет (`transparent`, `inherit`,
 * `currentColor` — не цвет вовсе) и тень значка на холсте.
 */
const SKIP = /:disabled|\[disabled\]|\.is-off\b/;

/**
 * Правила, где фон правила — не фон текста. Каждое — с причиной; новое сюда — только так же.
 */
/**
 * Правила, чей текст лежит на материале родителя, а не на панели: строки пергаментной реплики покоев (ЗН-2). Каждое —
 * с материалом и причиной.
 */
const ON: Record<string, { token: string; why: string }> = {
  '.ch-label b': { token: '--m-parch', why: 'имя предмета на пергаменте подписи' },
  '.ch-label small': { token: '--m-parch', why: 'строка предмета на пергаменте подписи' },
  '.cr-text::first-letter': { token: '--m-parch', why: 'буквица вести державы на пергаменте её текста' },
};

const NOT_UNDER: Record<string, string> = {
  // Риска прицела — линия в 2 px, подпись стоит правее её (`text-indent`) на сцене промысла, с тенью.
  '.mg-pin': 'подпись рядом с риской, а не на ней',
};

describe('контраст по всей игре', () => {
  it('у каждого правила с цветом текста — не ниже 4,5 : 1, у крупного — 3 : 1', () => {
    const low: string[] = [];
    let checked = 0;
    for (const r of RULES) {
      const c = r.decls.get('color');
      if (!c || SKIP.test(r.selector)) continue;
      const fg = parseColor(c, VARS);
      if (!fg) continue;
      const own = r.selector in NOT_UNDER ? null : backOf(r);
      const unders = own ? own.flatMap((b) => PANELS.map((p) => over(b, p))) : PANELS;
      // `opacity: 0` — правило, которое проявляет анимация (`.city-pop span`): читается оно уже проявленным.
      const opacity = parseFloat(r.decls.get('opacity') ?? '1') || 1;
      const size = px(r.decls.get('font-size'));
      const weight = parseInt(r.decls.get('font-weight') ?? '400', 10);
      const large = size !== null && (size >= 24 || (size >= 18.66 && weight >= 700));
      const need = large ? 3 : 4.5;
      const got = worst(fg, unders, opacity);
      checked++;
      if (got < need) low.push(`${r.file}: ${r.selector} — ${got.toFixed(2)} < ${need}`);
    }
    expect(checked).toBeGreaterThan(300);
    expect(low).toEqual([]);
  });

  it('самый мелкий текст — 12 px', () => {
    const small: string[] = [];
    for (const r of RULES) {
      for (const k of ['font-size', 'font']) {
        const v = r.decls.get(k);
        const m = v && /(?:^|\s)([\d.]+)px/.exec(v);
        if (m && parseFloat(m[1]) < 12) small.push(`${r.file}: ${r.selector} — ${v}`);
      }
    }
    expect(small).toEqual([]);
  });
});

describe('значки', () => {
  it('у каждого значка набора есть цвет, видный на панели, не ниже 3 : 1, и контур чернилами — на светлом листе', () => {
    // Значок — рисунок в несколько тинктур; тёмные детали законны, но силуэт на тёмной панели держит хотя бы одна светлая,
    // а на светлом листе (`docs/icons/sheet-light.png`) — контур чернилами (docs/icons.md, ЗН-1).
    const LIGHT = parseColor('#f3ead6', VARS)!;
    const ink = parseColor(INK, VARS)!;
    expect(worst(ink, [LIGHT])).toBeGreaterThanOrEqual(3);
    const low: string[] = [];
    let seen = 0;
    for (const [name, make] of Object.entries(ART)) {
      const shapes = make();
      const colors = shapes.filter((sh) => sh.tint !== 'ink').map((sh) => parseColor(TINCT[sh.tint as keyof typeof TINCT], VARS)!);
      seen++;
      const best = Math.max(...colors.map((c) => worst(c, PANELS)));
      if (best < 3) low.push(`${name}: ${best.toFixed(2)}`);
      if (!shapes.some((sh) => sh.role === 'fill')) low.push(`${name}: нет обведённой фигуры — на светлом листе силуэта нет`);
    }
    expect(seen).toBeGreaterThan(180);
    expect(low).toEqual([]);
  });
});
