// Чужие отряды на карте (ПН-4у, docs/gdd/path_of_sword.md, «Решения ПН-4у»): всё — за выключателем `ROAM_ON` и своим куском
// (карта лорда при выключенном пути — та же, что была), касание — словами о живом отряде и о следе.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bandWords } from './BandsLayer';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

/** Строка `needle` стоит внутри блока `if (ROAM_ON) {` или в выражении за `ROAM_ON` (не дальше трёх строк вверх). */
function gated(src: string, needle: RegExp): number {
  const lines = src.split('\n');
  let n = 0;
  lines.forEach((line, i) => {
    if (!needle.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
    n++;
    const near = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    expect(near, `строка ${i + 1}: ${line.trim()}`).toMatch(/\bif \(ROAM_ON\)|ROAM_ON \?/);
  });
  return n;
}

describe('видимость на карте — только за выключателем', () => {
  it('карта: слой чужих отрядов, рисование и касание — за ROAM_ON', () => {
    const map = read('src/ui/map/WorldMap.tsx');
    expect(gated(map, /sightHook\(\)/)).toBe(2);
    expect(gated(map, /import\('\.\/roam\/BandsLayer'\)/)).toBe(1);
  });

  it('мир подключает видимость за ROAM_ON, реестр отдаёт ответ сервера туда же', () => {
    expect(gated(read('src/world/store.ts'), /import\('\.\/bandsight'\)/)).toBe(1);
    expect(gated(read('src/net/roster.ts'), /keepSight\(res\)/)).toBe(1);
  });
});

describe('касание чужого отряда — словами', () => {
  const T = 1_900_000_000_000;
  const base = { id: 'c1', name: 'Ратко', prestige: 1, men: 14, at: { x: 1, y: 2 } };
  it('живой — где стоит или что идёт колонной; след — давность', () => {
    expect(bandWords({ ...base, camp: 'hidden', visible: true, seenAt: T, stale: false }, T)).toBe('Отряд героя Ратко · 14 чел. — стоит скрытым лагерем, виден сейчас.');
    expect(bandWords({ ...base, heading: { x: 1, y: 0 }, visible: true, seenAt: T, stale: false }, T)).toBe('Отряд героя Ратко · 14 чел. — идёт колонной, виден сейчас.');
    expect(bandWords({ ...base, visible: false, seenAt: T, stale: true }, T + 3 * 3_600_000)).toBe('След отряда героя Ратко · 14 чел. — видели 3 ч назад.');
  });
});
