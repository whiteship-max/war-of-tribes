// Регионы мира (docs/map_tw.md, раздел 13; ядро — 0.−2): разметка — вывод из атласа, регион — по клетке, мерка
// «своё ли это» одна на мир и карту.
import { describe, expect, it } from 'vitest';
import { cellOf } from '../atlas/project';
import { MAINLAND_MIN, WORLD_ORIGIN } from '../data/tuning';
import { isDesertAt, landmasses, settleable } from '../land';
import { THEATRE_HASH, THEATRE_IDS } from './data';
import { deriveTheatres } from './derive';
import { THEATRE_LIST } from './list';
import { fnv1a } from './pack';
import { beyondNote, homeTheatre, inHomeTheatre, inTheatre, theatreAt, theatreById, theatreIndexAt, theatres } from './theatre';

/** Клетка мира под долготой и широтой. */
function at(lon: number, lat: number): { x: number; y: number } {
  const p = cellOf(lon, lat);
  return { x: WORLD_ORIGIN.x + Math.floor(p.col), y: WORLD_ORIGIN.y + Math.floor(p.row) };
}

const regionOf = (lon: number, lat: number): string | null => {
  const c = at(lon, lat);
  return theatreAt(c.x, c.y)?.id ?? null;
};

describe('регионы: разметка', () => {
  it('запечённая разметка — ровно вывод из атласа по списку (детерминированно)', () => {
    // Разлив считается заново и сверяется с подписью данных: поправил список или цену и не пересобрал —
    // здесь красное, а не тихо другие регионы под теми же клетками.
    expect([...THEATRE_IDS]).toEqual(THEATRE_LIST.map((t) => t.id));
    expect(fnv1a(deriveTheatres())).toBe(THEATRE_HASH);
  });

  it('у каждого региона есть клетки и рамка их держит', () => {
    const all = theatres();
    expect(all.map((t) => t.id)).toEqual(THEATRE_LIST.map((t) => t.id));
    for (const t of all) {
      expect(t.cells, t.id).toBeGreaterThan(1000);
      // Углы рамки — клетки этого региона по обеим осям: рамка наименьшая.
      let left = false;
      let top = false;
      for (let y = t.box.y; y < t.box.y + t.box.h && !left; y++) left = theatreIndexAt(t.box.x, y) === t.index;
      for (let x = t.box.x; x < t.box.x + t.box.w && !top; x++) top = theatreIndexAt(x, t.box.y) === t.index;
      expect(left && top, t.id).toBe(true);
      expect(theatreIndexAt(t.box.x - 1, t.box.y + 5)).not.toBe(t.index);
    }
  });

  it('регион — по координатам: рубежи держат горы, проливы и море', () => {
    // Пары по обе стороны рубежа: точки внутри области, где правило вообще что-то решает, — у самой границы.
    const cases: [string, number, number, string | null][] = [
      ['Перпиньян', 2.9, 42.7, 'france'], // Пиренеи
      ['Памплона', -1.64, 42.8, 'iberia'],
      ['Инсбрук', 11.4, 47.26, 'germany'], // Альпы
      ['Тренто', 11.12, 46.07, 'italy'],
      ['Краков', 19.94, 50.06, 'poland'], // Карпаты
      ['Кошице', 21.26, 48.72, 'hungary'],
      ['Гибралтар', -5.35, 36.14, 'andalus'], // пролив
      ['Танжер', -5.8, 35.77, 'morocco'],
      ['Мессина', 15.55, 38.19, 'italy'], // остров без центра — к ближнему берегу
      ['Мальорка', 2.9, 39.6, 'iberia'],
      ['Копенгаген', 12.57, 55.68, 'denmark'],
      ['Лондон', -0.13, 51.5, 'britain'],
      ['Париж', 2.35, 48.86, 'france'],
      ['Мюнхен', 11.58, 48.14, 'germany'],
      ['Рим', 12.5, 41.9, 'italy'],
      ['Царьград', 28.97, 41.01, 'byzantium'],
      ['Киев', 30.52, 50.45, 'kiev'],
      ['Новгород', 31.27, 58.52, 'novgorod'],
      ['Тунис', 10.17, 36.8, 'ifriqiya'],
      ['Рейкьявик', -21.9, 64.15, null], // дальний остров — за краем света
      ['Бискайский залив', -8, 45.5, null], // открытое море
      ['Сахара', 5, 29, null], // песчаное море
    ];
    for (const [name, lon, lat, want] of cases) expect(regionOf(lon, lat), name).toBe(want);
  });

  it('регион игрока определён везде, где может встать город (материк, не пустыня)', () => {
    // Замок ставится только на материке и не в пустыне (`settle.fitToSettle`); у такой клетки регион обязан
    // быть — иначе карта игрока осталась бы без рамки.
    const masses = landmasses();
    const orphans: string[] = [];
    let checked = 0;
    for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + 800; y += 2) {
      for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + 800; x += 2) {
        if (!settleable(x, y) || isDesertAt(x, y)) continue;
        if (masses.sizeOf(masses.at(x, y)) < MAINLAND_MIN) continue;
        checked++;
        if (theatreIndexAt(x, y) === 0 && orphans.length < 5) orphans.push(`${x}|${y}`);
      }
    }
    expect(checked).toBeGreaterThan(50_000);
    expect(orphans).toEqual([]);
  });
});

describe('регионы: регион игрока — одна мерка на мир и карту', () => {
  it('своё внутри, чужое и ничьё снаружи; без региона — рамки нет', () => {
    const munich = at(11.58, 48.14);
    const innsbruck = at(11.4, 47.26); // та же Германия по эту сторону Альп
    const trento = at(11.12, 46.07); // Италия за Альпами
    const paris = at(2.35, 48.86);
    const sea = at(-8, 45.5);
    // Точки внутри области правила: дом в регионе, и рядом с рубежом — по обе стороны.
    expect(homeTheatre(munich)?.id).toBe('germany');
    expect(theatreIndexAt(trento.x, trento.y)).toBeGreaterThan(0);
    expect(inHomeTheatre(munich, innsbruck)).toBe(true);
    expect(inHomeTheatre(munich, trento)).toBe(false);
    expect(inHomeTheatre(munich, paris)).toBe(false);
    expect(inHomeTheatre(munich, sea)).toBe(false);
    // Мерка карты и мерка мира — одна функция: регион, найденный по дому, даёт тот же ответ.
    const de = theatreById('germany');
    for (const c of [munich, innsbruck, trento, paris, sea]) expect(inTheatre(de, c.x, c.y)).toBe(inHomeTheatre(munich, c));
    // Без региона (дом на ничьей земле — так бывает только у стенда) рамки нет.
    expect(inTheatre(null, trento.x, trento.y)).toBe(true);
    expect(inHomeTheatre(sea, trento)).toBe(true);
  });

  it('строка «за краем» называет регион игрока', () => {
    expect(beyondNote(at(11.58, 48.14))).toBe('Это уже не Германия: за край своей земли походы не ходят.');
    expect(beyondNote(null)).toBe('Это уже не твоя земля: за край своей земли походы не ходят.');
  });
});
