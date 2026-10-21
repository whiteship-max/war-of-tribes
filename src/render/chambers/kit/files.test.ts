// Файлы людей набора персонажа (ЛЦ-2, ЛЦ-3, docs/characters.md): чужих моделей и текстур в репозитории нет, у каждого
// внешнего файла фигур — строка с лицензией, имён, различающихся только регистром, нет (на Windows и macOS они — один
// файл). Общие для супруги, гонца и тех, кто придёт следом.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('люди набора: файлы (ЛЦ-2, ЛЦ-3)', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

  it('чужих моделей и текстур в репозитории нет: ни .mdx, ни .mdl, ни .blp', () => {
    expect(files.filter((f) => /\.(mdx|mdl|blp)$/i.test(f))).toEqual([]);
  });

  it('у каждого внешнего файла фигуры — строка с лицензией в docs/characters.md', () => {
    const doc = readFileSync(`${ROOT}docs/characters.md`, 'utf8');
    const ours = files.filter((f) => /^(docs\/characters\/|assets-src\/characters\/|public\/assets\/characters\/)/.test(f));
    expect(ours.length, 'снимки задания лежат в docs/characters').toBeGreaterThan(0);
    for (const f of ours) {
      const name = f.split('/').pop()!;
      // Файл называют и другие разделы (круги качества); нужна строка, где рядом с именем — лицензия.
      const lines = doc.split('\n').filter((l) => l.includes(name) || l.includes(name.replace(/\d+(?=\.\w+$)/, '*')));
      expect(lines.length, `${f}: строки в docs/characters.md нет`).toBeGreaterThan(0);
      expect(lines.some((l) => /лицензи/i.test(l)), `${f}: ни в одной строке с ним нет лицензии`).toBe(true);
    }
  });

  it('нет имён файлов, различающихся только регистром', () => {
    const seen = new Map<string, string>();
    const clash: string[] = [];
    for (const f of files) {
      const k = f.toLowerCase();
      const was = seen.get(k);
      if (was && was !== f) clash.push(`${was} ↔ ${f}`);
      seen.set(k, f);
    }
    expect(clash).toEqual([]);
  });
});
