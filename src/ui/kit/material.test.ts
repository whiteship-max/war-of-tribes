// Материалы корпуса (ЗН-2, docs/icons.md, «ЗН-2»): кнопки, листы, вкладки, плашки, полосы, тревоги, реплики покоев и низ
// берут вещество токеном `--m-*` из одного файла (`kit/material.css`), а не своей заливкой. Тест читает CSS игры как текст:
// у каждого правила корпуса фон — токен материала; у кнопок нет плоских заливок прежнего вида; «закрыть» — медальон на всех
// окнах; вес материалов — в потолке. Контраст ступеней — `ui/palette.test.ts` («материалы набора»).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Правила файла плоско: селектор (каждый из списка через запятую) → тело. `@media` раскрыт, `@keyframes` пропущен. */
function rulesOf(text: string): [string, string][] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: [string, string][] = [];
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
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(body);
      else if (!head.startsWith('@')) for (const sel of head.split(',')) out.push([sel.replace(/\s+/g, ' ').trim(), body]);
      i = j;
    }
  };
  walk(src);
  return out;
}

// Прологу и промыслам — свой вид (сцена у костра и мини-игры), корпус их не касается.
const FILES = cssFiles(SRC).filter((f) => !/[\\/](prologue|minigames)[\\/]/.test(f));
const RULES = FILES.flatMap((f) => rulesOf(readFileSync(f, 'utf8')).map(([sel, body]) => ({ file: f.slice(SRC.length), sel, body })));
const bodyOf = (sel: string): string => RULES.filter((r) => r.sel === sel).map((r) => r.body).join(';');
const MATERIAL = readFileSync(join(SRC, 'ui', 'kit', 'material.css'), 'utf8');
/** Что уходит в сборку: без комментариев (их снимает сборщик). */
const SHIPPED = MATERIAL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

/** Корпус: селектор и вещество, которое его фон обязан взять (`var(--m-…)`). */
const CORPUS: [string, string][] = [
  // Кнопки: главная, обычная, опасная, погашенная — у набора и у прежних видов.
  ['.kit-btn', 'leather'],
  ['.kit-btn.main', 'gold'],
  ['.kit-btn.armed', 'gules'],
  ['.kit-btn:disabled', 'iron'],
  ['.btn', 'gold'],
  ['.btn.danger', 'gules'],
  ['.btn:disabled', 'iron'],
  ['.nx-go', 'gold'],
  ['.nx-go:disabled', 'iron'],
  ['.start-go', 'gold'],
  ['.nx-tip .nx-tip-maker', 'gold'],
  ['.nx-confirm', 'leather'],
  ['.nx-confirm.armed', 'gules'],
  ['.stepper button', 'leather'],
  ['.stepper button:disabled', 'iron'],
  ['.mini', 'leather'],
  ['.modal .opt', 'leather'],
  ['.ch-talk-opts button', 'leather'],
  // Вкладки: обычная — кожа, выбранная — освещённая кожа с золотой планкой.
  ['.kit-tabs button', 'leather'],
  ['.kit-tabs button.on', 'lit'],
  ['.tabs button', 'leather'],
  ['.tabs button.active', 'lit'],
  ['.nx-rtabs', 'groove'],
  ['.nx-rtabs button.on', 'lit'],
  // Окна и листы — морёный дуб.
  ['.sheet', 'wood'],
  ['.ui-new .sheet', 'wood'],
  ['.ui-new .nx-realm', 'wood'],
  ['.modal', 'wood'],
  ['.ch-talk', 'wood'],
  ['.kit-foot', 'wood'],
  // Плашки, таблицы, полосы, метки.
  ['.nx-res', 'plate'],
  ['.kit-trow.head', 'plate'],
  ['.card', 'plate'],
  ['.nx-fact', 'plate'],
  ['.nx-pcell', 'plate'],
  ['.kit-head-ico', 'plate'],
  ['.nx-bico', 'plate'],
  ['.kit-bar-track', 'groove'],
  ['.kit-bar-fill', 'fill'],
  ['.progress', 'groove'],
  ['.progress > div', 'fill'],
  ['.nx-bbar', 'groove'],
  ['.kit-badge', 'gold'],
  ['.nx-badge', 'gold'],
  ['.nx-badge.urgent', 'gules'],
  // Тревоги П-7 и реплики покоев.
  ['.nx-sign', 'plate'],
  ['.nx-sign.urgent', 'gules-dark'],
  ['.nx-alert.pill', 'plate'],
  ['.ch-coach', 'parch'],
  ['.ch-label', 'parch'],
  // Низ.
  ['.nx-nav', 'wood'],
  ['.nx-nav button.on::before', 'gold'],
];

describe('материалы корпуса (ЗН-2)', () => {
  it('каждый материал корпуса заведён в `kit/material.css`', () => {
    for (const m of new Set(CORPUS.map(([, m]) => m))) expect(MATERIAL, m).toMatch(new RegExp(`--m-${m}:`));
  });

  it('фон каждого правила корпуса — токен своего вещества, а не своя заливка', () => {
    const wrong: string[] = [];
    for (const [sel, m] of CORPUS) {
      const body = bodyOf(sel);
      if (!body) {
        wrong.push(`${sel}: правила нет`);
        continue;
      }
      const bg = [...body.matchAll(/(?:^|;)\s*background(?:-image)?\s*:\s*([^;]+)/g)].map((x) => x[1]).join(' | ');
      if (!new RegExp(`var\\(--m-${m}\\)`).test(bg)) wrong.push(`${sel}: «${bg.trim()}» — ждали var(--m-${m})`);
    }
    expect(wrong).toEqual([]);
  });

  it('у кнопок нет плоских заливок прежнего вида: ни янтаря, ни красного, ни второй панели', () => {
    const flat = /(?:^|;)\s*background\s*:\s*var\(--(accent|bad-fill|panel-2|panel)\)\s*(?:;|$)/;
    const wrong = RULES.filter((r) => /button|btn|\.opt\b|-go\b|\.mini\b/.test(r.sel) && flat.test(r.body)).map((r) => `${r.file}: ${r.sel}`);
    expect(wrong).toEqual([]);
  });

  it('«закрыть» — медальон в каждом окне: лист набора, постройка, шторка, держава, разговор в покоях', () => {
    for (const sel of ['.kit-close', '.nx-bclose', '.sheet-close', '.ch-talk-x', ".nx-realm .nx-ibtn[aria-label='Закрыть']"]) {
      expect(bodyOf(`${sel}::before`), sel).toMatch(/background:\s*var\(--m-leather\)/);
    }
  });

  it('вес: материалы — градиенты и одна строка зерна, по сети не больше 2 КБ', () => {
    expect(gzipSync(SHIPPED).length).toBeLessThan(2048);
    // Картинка в материалах одна — зерно дерева строкой SVG (внутри — ссылка фильтра на себя, `%23n`); внешних файлов нет.
    expect(SHIPPED.match(/url\(/g)?.length).toBe(2);
    expect(SHIPPED).not.toMatch(/url\((?!\s*['"]?(data:|%23))/);
  });
});
