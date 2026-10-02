// Отчёт о бое со зверями у ворот (стая волков, docs/battle_eu4.md, 14.28). Фигура волка в сцене боя есть всегда
// (docs/graphics_world.md, 11.4): сцена ролика одна — нынешняя (docs/city.md, «Город — единственный вид»), и стая идёт
// той же веткой, что люди, — с роликом; ролик одевает её волками, а подписи пишет словами о стае. Держит это чтение
// исходников: ветки записи без ролика нет, кнопка ролика и журнал стоят в единственной ветке записи боя.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(path.join(process.cwd(), 'src/ui/panels/ReportPanel.tsx'), 'utf8');
const replay = readFileSync(path.join(process.cwd(), 'src/ui/battle/BattleReplay.tsx'), 'utf8');

describe('отчёт о бое со зверями: ролик и журнал, как у всякого боя', () => {
  it('ветка записи боя одна — и у людей, и у стаи: в ней «Смотреть бой» и журнал', () => {
    const branch = src.indexOf('{rec && (');
    expect(branch, 'ветка записи боя есть').toBeGreaterThan(0);
    expect(src.indexOf('{rec && (', branch + 1), 'и она одна').toBe(-1);
    const watch = src.indexOf('▶️ Смотреть бой');
    expect(watch, 'кнопка ролика — в ней').toBeGreaterThan(branch);
    expect(src.slice(branch), 'журнал — в ней').toMatch(/<Journal rec=\{rec\} \/>/);
    // Прежней ветки «зверей без волка» (её открывал «Простой вид», где фигуры волка не было) нет.
    expect(src, 'ветки без ролика нет').not.toMatch(/rec && beasts|wolfDrawn|Ролика нет/);
  });

  it('ролик стаи: сторона зверей идёт в раскадровку, подписи — словами о стае', () => {
    expect(replay).toMatch(/castOfRecord\(rec\.result, rec\.us, rec\.troops, rec\.militia, rec\.place, rec\.beasts\)/);
    expect(replay).toMatch(/beastWords\(frame\.caption, rec\.beasts, us\)/);
    // Голой подписи журнала в ролике нет: иначе стая звалась бы «конницей».
    expect(replay).not.toMatch(/\{frame\.caption\}/);
  });
});
