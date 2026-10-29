// Чужие отряды на карте (ПН-4у, docs/gdd/path_of_sword.md, «Решения ПН-4у»): всё — за выключателем `roamOn()` (с 30.10.2026 — по игроку) и своим куском
// (карта лорда при выключенном пути — та же, что была), касание — словами о живом отряде и о следе.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bandWords } from './BandsLayer';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

/**
 * Строка `needle` стоит внутри блока `if (roamOn()) {` или разметки `{roamOn() && (` (ближайший охватывающий блок — по скобкам
 * вверх) или за выключателем на той же строке (`roamOn() ?`, `if (roamOn()) …`). Сколько таких строк — возвращает.
 */
function gated(src: string, needle: RegExp): number {
  const lines = src.split('\n');
  let n = 0;
  lines.forEach((line, i) => {
    if (!needle.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
    n++;
    // Развилка на той же строке: выражением `roamOn() ?` или оператором `if (roamOn()) …` без блока.
    if (/roamOn\(\) \?|\bif \(roamOn\(\)\) [^{]*$/.test(line)) return;
    // Вверх по скобкам: первая незакрытая `{` — начало охватывающего блока.
    let depth = 0;
    let opener = '';
    for (let j = i - 1; j >= 0 && !opener; j--) {
      const l = lines[j];
      for (let k = l.length - 1; k >= 0; k--) {
        if (l[k] === '}') depth++;
        else if (l[k] === '{') {
          if (depth === 0) {
            opener = l;
            break;
          }
          depth--;
        }
      }
    }
    expect(opener, `строка ${i + 1}: ${line.trim()}`).toMatch(/\bif \(roamOn\(\)\) \{|\{roamOn\(\) && \($/);
  });
  return n;
}

describe('видимость на карте — только за выключателем', () => {
  it('карта: слой чужих отрядов, рисование и касание — за выключателем', () => {
    const map = read('src/ui/map/WorldMap.tsx');
    expect(gated(map, /sightHook\(\)/)).toBe(2);
    // Кусок объявлен `lazy` без условия (качается только при первом рисовании), а рисуется — за выключателем.
    expect(gated(map, /<BandsLayer \/>/)).toBe(1);
  });

  it('мир подключает видимость за выключателем, реестр отдаёт ответ сервера туда же', () => {
    expect(gated(read('src/world/store.ts'), /import\('\.\/bandsight'\)/)).toBe(1);
    // Ответ сервера о видимости — половине реестра в куске пути (ПН-5, хвост а): реестр отдаёт его только куску, а кусок есть только
    // у того, кому путь открыт (`roamlazy.roamDoor` спрашивает `roamOn`).
    expect(read('src/net/roster.ts').match(/roamDoor\(\)\?\.keepRoster\(res\)/g)?.length).toBe(1);
    expect(read('src/net/bandroster.ts')).toMatch(/sightSink\?\.\(sight\)/);
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
