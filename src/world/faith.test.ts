// Разметка вер: одна на всех и одна и та же при любом вопросе.
//
// Проверяется здесь не история — её проверить нечем, разметка наша (см.
// заголовок `faith.ts`), — а два обещания, на которых всё держится: карта у
// всех одна, и узнаваемые места дают ожидаемую веру.
import { describe, expect, it } from 'vitest';
import { FAITH_REGIONS, faithAt, faithAttitude, faithPressure, regionAt } from './faith';
import { FAITH_IDS } from '@/game/data/faiths';
import { cellOf, lonLatOf } from './atlas/project';
import { WORLD_ORIGIN } from './data/tuning';
import { isWaterAt } from './land';
import type { FaithId } from '@/game/types';

/** Настоящее место → клетка мира. Города в игре только мерка, как в world:report. */
function at(lon: number, lat: number): { x: number; y: number } {
  const c = cellOf(lon, lat);
  return { x: Math.round(c.col) + WORLD_ORIGIN.x, y: Math.round(c.row) + WORLD_ORIGIN.y };
}

/** Известные места и вера, которую наша разметка обязана дать. */
const PLACES: [string, number, number, FaithId][] = [
  ['Париж', 2.35, 48.85, 'catholic'],
  ['Лондон', -0.13, 51.51, 'catholic'],
  ['Дублин', -6.26, 53.35, 'catholic'],
  ['Рим', 12.5, 41.9, 'catholic'],
  ['Прага', 14.42, 50.08, 'catholic'],
  ['Краков', 19.94, 50.06, 'catholic'],
  ['Варшава', 21.01, 52.23, 'catholic'],
  ['Буда', 19.04, 47.5, 'catholic'],
  ['Стокгольм', 18.07, 59.33, 'catholic'],
  ['Трондхейм', 10.4, 63.43, 'catholic'],
  ['Лиссабон', -9.14, 38.72, 'catholic'],
  ['Сарагоса', -0.88, 41.65, 'catholic'],
  ['Палермо', 13.36, 38.12, 'catholic'],
  ['Отранто', 18.49, 40.15, 'catholic'],
  ['Никосия', 33.36, 35.17, 'catholic'],

  ['Новгород', 31.27, 58.52, 'orthodox'],
  ['Киев', 30.52, 50.45, 'orthodox'],
  ['Псков', 28.33, 57.82, 'orthodox'],
  ['Смоленск', 32.05, 54.78, 'orthodox'],
  ['Архангельск', 40.54, 64.54, 'orthodox'],
  ['Царьград', 28.98, 41.01, 'orthodox'],
  ['Белград', 20.46, 44.81, 'orthodox'],
  ['Афины', 23.73, 37.98, 'orthodox'],
  ['Влёра', 19.49, 40.47, 'orthodox'],
  ['Измир', 27.14, 38.42, 'orthodox'],
  ['Кандия', 25.14, 35.34, 'orthodox'],
  ['Тбилиси', 44.79, 41.72, 'orthodox'],

  ['Кордова', -4.78, 37.88, 'islam'],
  ['Севилья', -5.99, 37.39, 'islam'],
  ['Марракеш', -8.0, 31.63, 'islam'],
  ['Тунис', 10.18, 36.8, 'islam'],
  ['Триполи', 13.19, 32.89, 'islam'],
  ['Бенгази', 20.07, 32.12, 'islam'],
  ['Каир', 31.24, 30.04, 'islam'],
  ['Иерусалим', 35.21, 31.78, 'islam'],
  ['Дамаск', 36.29, 33.51, 'islam'],
  ['Антиохия', 36.16, 36.2, 'islam'],
  ['Конья', 32.49, 37.87, 'islam'],
  ['Эрзурум', 41.28, 39.9, 'islam'],

  ['Вильнюс', 25.28, 54.69, 'pagan'],
  ['Кёнигсберг', 20.51, 54.71, 'pagan'],
  ['Рига', 24.11, 56.95, 'pagan'],
  ['Таллин', 24.75, 59.44, 'pagan'],
  ['Хельсинки', 24.94, 60.17, 'pagan'],
  ['Тромсё', 18.96, 69.65, 'pagan'],
];

describe('вера клетки — свойство земли, а не партии', () => {
  it('это чистая функция координат: сида у неё нет и в подписи', () => {
    // Проверяется не поведение, а сам договор: появись у `faithAt` третий
    // аргумент, две партии на одной клетке разошлись бы верой, и заметил бы
    // это только тот, кто сравнил свою карту с чужой.
    expect(faithAt.length).toBe(2);
  });

  it('порядок чтения ничего не меняет: тысяча клеток вперёд и назад', () => {
    const cells: [number, number][] = [];
    for (let i = 0; i < 1000; i++) {
      cells.push([WORLD_ORIGIN.x + ((i * 37) % 800), WORLD_ORIGIN.y + ((i * 53) % 800)]);
    }
    const forward = cells.map(([x, y]) => faithAt(x, y));
    const backward = [...cells].reverse().map(([x, y]) => faithAt(x, y));
    expect(backward).toEqual([...forward].reverse());
    // И второй проход по тем же клеткам даёт то же самое — кэша, который
    // зависел бы от того, что спросили раньше, тут нет.
    expect(cells.map(([x, y]) => faithAt(x, y))).toEqual(forward);
  });

  it('каждая из четырёх вер где-то на суше есть', () => {
    const seen = new Set<FaithId>();
    for (let y = 0; y < 800; y += 7) {
      for (let x = 0; x < 800; x += 7) {
        const wx = x + WORLD_ORIGIN.x;
        const wy = y + WORLD_ORIGIN.y;
        if (isWaterAt(wx, wy)) continue;
        seen.add(faithAt(wx, wy));
      }
    }
    expect([...seen].sort()).toEqual([...FAITH_IDS].sort());
  });

  it.each(PLACES)('%s — %s', (_name, lon, lat, want) => {
    const c = at(lon, lat);
    expect(faithAt(c.x, c.y)).toBe(want);
  });

  it('у каждой области есть своя клетка: мёртвых строк в списке нет', () => {
    const used = new Set<string>();
    for (let y = 0; y < 800; y += 4) {
      for (let x = 0; x < 800; x += 4) {
        const { lon, lat } = lonLatOf(x, y);
        const id = regionAt(lon, lat);
        if (id) used.add(id);
      }
    }
    for (const r of FAITH_REGIONS) {
      expect(used.has(r.id), `область «${r.id}» не выигрывает ни одной клетки`).toBe(true);
    }
  });
});

describe('чужая вера вокруг', () => {
  it('своя земля кругом — ноль, чужая кругом — единица', () => {
    const paris = at(2.35, 48.85);
    expect(faithPressure(paris.x, paris.y, 20, 'catholic')).toBeLessThan(0.05);
    expect(faithPressure(paris.x, paris.y, 20, 'islam')).toBeGreaterThan(0.95);
  });

  it('на границе вер она между нулём и единицей', () => {
    // Мазовия у литовского порога: половина округи ещё латинская, половина уже
    // языческая. Точное число тут не проверяется — только то, что оно среднее.
    const border = at(22.0, 53.2);
    const p = faithPressure(border.x, border.y, 24, 'catholic');
    expect(p).toBeGreaterThan(0.1);
    expect(p).toBeLessThan(0.9);
  });

  it('море не давит: круг без земли даёт ноль', () => {
    const sea = { x: WORLD_ORIGIN.x + 20, y: WORLD_ORIGIN.y + 400 };
    expect(isWaterAt(sea.x, sea.y)).toBe(true);
    expect(faithPressure(sea.x, sea.y, 8, 'catholic')).toBe(0);
  });
});

describe('отношение по вере', () => {
  it('одна вера — ноль, и пара считается одинаково с обеих сторон', () => {
    // Симметрия — это и есть «ни одна вера не выставляется дурной»: чужой она
    // приходится ровно настолько же, насколько чужими приходятся ей.
    for (const a of FAITH_IDS) {
      expect(faithAttitude(a, a)).toBe(0);
      for (const b of FAITH_IDS) expect(faithAttitude(a, b)).toBe(faithAttitude(b, a));
    }
  });

  it('сдвиг только вниз или в ноль: вера не даёт друзей задаром', () => {
    for (const a of FAITH_IDS) for (const b of FAITH_IDS) expect(faithAttitude(a, b)).toBeLessThanOrEqual(0);
  });

  it('расстояние между верами, а не оценка их: язычество дальше от всех трёх поровну', () => {
    // Три веры Писания знают друг о друге и спорят об одном; язычеству спорить
    // не о чем ни с одной из них — и это одинаково с каждой стороны. Числа
    // здесь про расстояние, а не про то, кто прав.
    const gulf = FAITH_IDS.filter((f) => f !== 'pagan').map((f) => faithAttitude('pagan', f));
    expect(new Set(gulf).size).toBe(1);
    const rift = faithAttitude('catholic', 'orthodox');
    expect(faithAttitude('catholic', 'islam')).toBe(rift);
    expect(faithAttitude('orthodox', 'islam')).toBe(rift);
  });
});
