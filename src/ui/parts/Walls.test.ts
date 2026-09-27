// Новые части пачки «здания получают дело» своей арифметики не держат: раздел «Оборона»
// у стены, срок еды и прогноз зимы на складе. Всё, что они
// показывают, уже считает игра своими функциями — и у нас дважды горело, когда показ
// считал рядом: план гасил кнопку, а приказ её принимал; карточка обещала прирост,
// которого потолок не давал.
//
// Граница у теста та же, что у окон осады (`world/works.test.ts`): число без функции
// игры в эти файлы не пройдёт — ни составная часть расчёта, ни его константа. Что
// сама функция даёт верное число, проверяют её тесты и замер (`foodLeft.test.ts`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Исходник без комментариев: в них имена функций называть можно и нужно. */
const code = (file: string): string =>
  readFileSync(path.join(process.cwd(), 'src/ui/parts', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('новые части читают готовые величины и не считают', () => {
  it('раздел «Оборона»: защиту, ополчение и стрелков берёт у игры, а не складывает сам', () => {
    const src = code('Walls.tsx');
    // Точки внутри области: часть действительно показывает все три числа и окно набега.
    expect(src, 'Walls.tsx показывает защиту').toMatch(/\bdefense\(s\)/);
    expect(src, 'Walls.tsx показывает ополчение').toMatch(/\bmilitiaMen\(s\)/);
    expect(src, 'Walls.tsx показывает стрелков').toMatch(/\bmilitiaArchers\(s\)/);
    expect(src, 'Walls.tsx читает окно набега общей дверью').toMatch(/\buseRaidWords\(\)/);
    expect(src, 'Walls.tsx: арифметика ополчения').not.toMatch(/\b(homeArmyPower|buildingStat|buildingOfType|toArmySetup|share)\(|BATTLE_MAN/);
    expect(src, 'Walls.tsx: окно посчитано само').not.toMatch(/\braidWindow\(|musterBy|musterWait|HANDOVER_|arriveAt\s*-/);
    // Строй у частокола раскладывает правило боя (поставка 2): где встанет ополчение, стена не называет.
    expect(src, 'Walls.tsx: своя таблица секторов').not.toMatch(/['"][A-F]['"]|SECTOR_NAME|militiaPlaces/);
  });

  it('склад: срок еды — из одной двери, прогноз зимы — `winterForecast`, и никаких составных частей расхода', () => {
    const parts = code('Provisions.tsx');
    expect(parts, 'Provisions.tsx берёт срок еды у foodLeft').toMatch(/\bfoodLeft\(s\)/);
    expect(parts, 'Provisions.tsx берёт зиму у winterForecast').toMatch(/\bwinterForecast\(s\)/);
    expect(parts, 'Provisions.tsx: составные части расхода').not.toMatch(
      /\b(foodConsumptionPerDay|townFoodPerDay|soldierFoodPerDay|productionPerDay|netPerDay|heatingWoodPerDay|seasonMods|winterMods)\(/,
    );
    expect(parts, 'Provisions.tsx: склад и паёк числами').not.toMatch(/resources\.|ration\.food|\)\.food\b(?!\.)|SEASON_DAYS|HEATING_/);

    const left = code('foodLeft.ts');
    expect(left, 'foodLeft.ts: баланс дня у игры').toMatch(/\bnetPerDay\(s\)/);
    expect(left, 'foodLeft.ts: свой расход вместо баланса игры').not.toMatch(
      /\b(foodConsumptionPerDay|townFoodPerDay|soldierFoodPerDay|productionPerDay|rationOf|seasonMods)\(|SOLDIER_FOOD|DAY_LENGTH/,
    );
  });
});
