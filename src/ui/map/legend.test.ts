// Легенда карты не обещает того, чего на карте не бывает.
//
// Случай, из которого тест вырос: легенда показывала «Тракт ×0.62 — дорога между станами
// племён», когда трактов в мире не было ни одного — станов не осталось вместе с поселениями
// ботов. Рядом с ним нашлись ещё строки того же рода: разорённый двор, владения племени,
// союзники и враги, сожжённый город. Механики целы и спят; легенда — нет, она говорит с
// игроком сейчас. Проверка поэтому двусторонняя: строки нет, пока нет того, о чём она, — и
// тест падает, когда оно появится, чтобы строку вернули, а не забыли.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roadNet } from '@/world/geography';

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const map = strip(readFileSync(join(__dirname, 'WorldMap.tsx'), 'utf8'));

describe('легенда карты', () => {
  it('трактов в мире нет — и строки «Тракт» в легенде нет', () => {
    // Точки внутри области: на нескольких сидах мира дорог действительно ноль.
    for (const seed of [7, 11, 42]) expect(roadNet(seed).cells.size, `сид ${seed}`).toBe(0);
    expect(map).not.toMatch(/name: 'Тракт'/);
    expect(map).not.toMatch(/COST_ROAD/);
  });

  it('разорённого двора, владений, союзников, врагов и сожжённого города легенда не обещает', () => {
    expect(map).not.toMatch(/sacked: true/);
    expect(map).not.toMatch(/Владения/);
    expect(map).toMatch(/SHOWN_RELATIONS = RELATION_ORDER\.filter\(\(r\) => r !== 'ally' && r !== 'enemy'\)/);
    expect(map).toMatch(/SHOWN_FATES = \(Object\.keys\(FELL_WORDS\) as Fate\[\]\)\.filter\(\(f\) => f !== 'burn'\)/);
    expect(map).not.toMatch(/RELATION_ORDER\.map/);
    expect(map).not.toMatch(/Object\.keys\(FELL_WORDS\) as Fate\[\]\)\.map/);
  });

  it('замок в легенде — город живого игрока, а не крепость с казной', () => {
    expect(map).not.toMatch(/с казной/);
  });
});
