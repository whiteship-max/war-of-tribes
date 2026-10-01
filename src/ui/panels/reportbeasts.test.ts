// Отчёт о бое со зверями у ворот (стая волков, docs/battle_eu4.md, 14.28). Волк в сцене боя есть только в виде `next`
// (docs/graphics_world.md, 11.4), а он с 01.10.2026 — вид по умолчанию (раздел 12): там стая идёт веткой людей — с
// роликом, — и ролик одевает её волками, а подписи пишет словами о стае. В «Простом виде» из настроек фигуры волка нет:
// «Смотреть бой» у записи нет, а журнал есть. Держит это чтение исходников: кнопка ролика стоит только в ветке записи
// людей, журнал — в обеих, а ветка зверей открыта лишь тогда, когда сцена рисует прежний вид.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gfx, sceneGfx, setGfxStorage } from '@/render/gfx';

const src = readFileSync(path.join(process.cwd(), 'src/ui/panels/ReportPanel.tsx'), 'utf8');
const replay = readFileSync(path.join(process.cwd(), 'src/ui/battle/BattleReplay.tsx'), 'utf8');

afterEach(() => setGfxStorage({ read: () => null, write: () => undefined }));

describe('отчёт о бое со зверями: журнал есть, ролик — только с фигурой волка', () => {
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
  });

  it('ветка зверей — по полю записи боя и только без фигуры волка, а волк есть только в виде next', () => {
    expect(src, 'звери без волка — по полю записи и виду сцены').toMatch(/const beasts = rec\?\.beasts !== undefined && !wolfDrawn\(\);/);
    // Вид — тот же, что у сцены игры: адрес сильнее выбора в настройках.
    expect(src).toMatch(/const wolfDrawn = \(\): boolean => sceneGfx\(gfx\(\), window\.location\.search\)\.look === 'next';/);
  });

  it('по умолчанию у стаи — «Смотреть бой»: вид, который игра рисует без выбора, рисует волка', () => {
    // Ничего не выбрано и адрес пуст — так у игрока. `wolfDrawn` читает то же (утверждение выше).
    setGfxStorage({ read: () => null, write: () => undefined });
    expect(sceneGfx(gfx(), '').look).toBe('next');
  });

  it('ролик стаи: сторона зверей идёт в раскадровку, подписи — словами о стае', () => {
    expect(replay).toMatch(/castOfRecord\(rec\.result, rec\.us, rec\.troops, rec\.militia, rec\.place, rec\.beasts\)/);
    expect(replay).toMatch(/beastWords\(frame\.caption, rec\.beasts, us\)/);
    // Голой подписи журнала в ролике нет: иначе стая звалась бы «конницей».
    expect(replay).not.toMatch(/\{frame\.caption\}/);
  });
});
