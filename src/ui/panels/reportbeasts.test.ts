// Отчёт о бое со зверями у ворот (стая волков, docs/battle_eu4.md, 14.28): «Смотреть бой» у него нет, пока в сцене боя
// нет фигуры волка (слово владельца; долг графики — docs/PROMISES_DEBT.md), а журнал есть. Ролик рисует бойцов по видам
// племени, и стаю он показал бы всадниками. Держит это чтение исходника: кнопка ролика стоит только в ветке записи
// людей, журнал — в обеих.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(path.join(process.cwd(), 'src/ui/panels/ReportPanel.tsx'), 'utf8');

describe('отчёт о бое со зверями: журнал есть, ролика нет', () => {
  it('«Смотреть бой» стоит только в ветке записи людей', () => {
    const people = src.indexOf('{rec && !beasts && (');
    const animals = src.indexOf('{rec && beasts && (');
    expect(people, 'ветка записи людей есть').toBeGreaterThan(0);
    expect(animals, 'ветка записи зверей есть').toBeGreaterThan(0);
    const watch = src.indexOf('▶️ Смотреть бой');
    expect(watch, 'кнопка ролика найдена').toBeGreaterThan(0);
    expect(watch, 'кнопка ролика — в ветке людей').toBeGreaterThan(people);
    const beastBranch = src.slice(animals, people > animals ? people : undefined);
    expect(beastBranch, 'у зверей ролика нет').not.toMatch(/Смотреть бой|Replay|battleMusic/);
    expect(beastBranch, 'у зверей журнал есть').toMatch(/<Journal rec=\{rec\} \/>/);
    expect(src, 'звери — по полю записи боя').toMatch(/const beasts = rec\?\.beasts !== undefined;/);
  });
});
