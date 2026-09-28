// Мораль армии между боями словами (docs/battle_eu4.md, 14.31): одна строка на все места показа, числа — от мира
// (`RestView`), срок — модулем сроков. Держит это прогон строки и чтение исходников: доля морали не пересчитывается ни в
// одной панели, и каждое место показа говорит через `restLine`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { realLeft } from './wait';
import { REST_WHY, restLine, restPercent } from './restWords';

const NOW = 1_700_000_000_000;

describe('мораль между боями словами', () => {
  it('строка — доля полной вниз и срок до полной модулем сроков; у свежей армии строки нет', () => {
    const rest = { share: 0.437, fullAt: NOW + 25 * 60_000 };
    expect(restLine(rest, 'Дружина дралась', NOW)).toBe(`Дружина дралась недавно: мораль 43 % от полной, полная — через ${realLeft(25 * 60)}.`);
    expect(restPercent({ share: 0.996, fullAt: NOW }), 'почти полная — не полная').toBe(99);
    expect(restLine(undefined, 'Дружина дралась', NOW)).toBeNull();
    expect(REST_WHY).toMatch(/уходит с поля/);
  });

  it('каждое место показа говорит одной частью, и ни одна панель не считает долю сама', () => {
    const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const PLACES = [
      'src/ui/parts/AgentCard.tsx',
      'src/ui/map/ActionMenu.tsx',
      'src/ui/panels/SiegePanel.tsx',
      'src/ui/panels/SortiePanel.tsx',
      'src/ui/panels/CampPanel.tsx',
      'src/ui/panels/MarchesPanel.tsx',
      'src/ui/panels/ArmyPanel.tsx',
    ];
    for (const file of PLACES) expect(strip(readFileSync(path.resolve(file), 'utf8')), file).toMatch(/restLine\(/);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const rel = path.relative(process.cwd(), p).split(path.sep).join('/');
          if (rel === 'src/ui/parts/restWords.ts') continue;
          if (/[Rr]est\??\.share|\.fullAt\b/.test(strip(readFileSync(p, 'utf8')))) hits.push(rel);
        }
      }
    };
    walk(path.resolve('src/ui'));
    expect(hits, 'долю и срок морали панели не читают мимо части слов').toEqual([]);
  });
});
