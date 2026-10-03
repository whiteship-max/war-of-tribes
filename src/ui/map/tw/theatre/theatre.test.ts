// Регионы карты (docs/map_tw.md, раздел 13): разметка — вывод из атласа, регион — по клетке, камера — в
// рамке, заранее испечённое — под потолком памяти.
import { describe, expect, it } from 'vitest';
import { cellOf } from '@/world/atlas/project';
import { MAINLAND_MIN, WORLD_ORIGIN } from '@/world/data/tuning';
import { isDesertAt, landmasses, settleable } from '@/world/land';
import { SCALE_MAX, SCALE_MIN } from '../../const';
import { type Camera, type Viewport, viewRect } from '../../grid';
import { THEATRE_HASH, THEATRE_IDS } from './data';
import { deriveTheatres } from './derive';
import { THEATRE_LIST } from './list';
import { fnv1a } from './pack';
import { PREBAKE_BUDGET, planBytes, theatrePlan } from './plan';
import { THEATRE_EDGE, holdInTheatre, reachOf } from './camera';
import { activeTheatre, setActiveTheatre, theatreAt, theatreById, theatreIndexAt, theatres, withinActive } from './theatre';

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

  it('заранее испечённое любого региона влезает в потолок памяти', () => {
    for (const t of theatres()) {
      const b = planBytes(theatrePlan(t), true);
      expect(b.overview + b.mid + b.sheets, t.id).toBeLessThanOrEqual(PREBAKE_BUDGET);
      // План не пуст: регион печётся, а не только числится.
      expect(theatrePlan(t).chunks.length, t.id).toBeGreaterThan(0);
      expect(theatrePlan(t).mids.length, t.id).toBeGreaterThan(0);
    }
  });

  it('регион игрока: пока его нет, рамки нет; есть — своё внутри, чужое снаружи', () => {
    expect(activeTheatre()).toBe(null);
    const paris = at(2.35, 48.86);
    expect(withinActive(paris.x, paris.y)).toBe(true);
    const de = theatreById('germany');
    expect(de).not.toBe(null);
    setActiveTheatre(de);
    try {
      const munich = at(11.58, 48.14);
      expect(withinActive(munich.x, munich.y)).toBe(true);
      expect(withinActive(paris.x, paris.y)).toBe(false);
      const sea = at(-8, 45.5);
      expect(withinActive(sea.x, sea.y)).toBe(false);
    } finally {
      setActiveTheatre(null);
    }
  });
});

describe('регионы: камера в рамке', () => {
  /** Сеяный генератор: тест повторяется буква в букву. */
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const VIEWS: Viewport[] = [
    { w: 375, h: 812 },
    { w: 812, h: 375 },
    { w: 768, h: 1024 },
    { w: 1400, h: 900 },
  ];

  it('кадр не выходит за рамку региона с краем ни на каком масштабе и ни в каком положении', () => {
    const rnd = rng(20261003);
    let moved = 0;
    for (const t of theatres()) {
      const reach = reachOf(t.box);
      for (const vp of VIEWS) {
        for (let k = 0; k < 40; k++) {
          // Камеры и внутри рамки, и далеко за ней: правило решает именно там, где камера уходит.
          const cam: Camera = {
            cx: t.box.x - 150 + rnd() * (t.box.w + 300),
            cy: t.box.y - 150 + rnd() * (t.box.h + 300),
            scale: SCALE_MIN + rnd() * (SCALE_MAX - SCALE_MIN),
          };
          const held = holdInTheatre(cam, vp, t.box);
          if (held.cx !== cam.cx || held.cy !== cam.cy || held.scale !== cam.scale) moved++;
          const r = viewRect(held, vp);
          const eps = 1e-6;
          expect(r.x, `${t.id} ${vp.w}×${vp.h}`).toBeGreaterThanOrEqual(reach.x - eps);
          expect(r.y, `${t.id} ${vp.w}×${vp.h}`).toBeGreaterThanOrEqual(reach.y - eps);
          expect(r.x + r.w, `${t.id} ${vp.w}×${vp.h}`).toBeLessThanOrEqual(reach.x + reach.w + eps);
          expect(r.y + r.h, `${t.id} ${vp.w}×${vp.h}`).toBeLessThanOrEqual(reach.y + reach.h + eps);
          expect(held.scale).toBeLessThanOrEqual(SCALE_MAX);
          // Рамка держит, а не дёргает: второй раз камера уже не сдвигается.
          expect(holdInTheatre(held, vp, t.box)).toEqual(held);
        }
      }
    }
    // Правило не холостое: значительная часть камер была за рамкой и сдвинута.
    expect(moved).toBeGreaterThan(theatres().length * VIEWS.length * 10);
  });

  it('камеру внутри рамки рамка не трогает: панорама внутри региона идёт за пальцем один к одному', () => {
    const de = theatreById('germany')!;
    const vp: Viewport = { w: 375, h: 812 };
    const cam: Camera = { cx: de.box.x + de.box.w / 2, cy: de.box.y + de.box.h / 2, scale: 44 };
    expect(holdInTheatre(cam, vp, de.box)).toEqual(cam);
    // Край — на `THEATRE_EDGE` клеток за рамкой, не больше и не меньше.
    const far = holdInTheatre({ ...cam, cx: de.box.x - 1000 }, vp, de.box);
    expect(viewRect(far, vp).x).toBeCloseTo(de.box.x - THEATRE_EDGE, 9);
  });
});
