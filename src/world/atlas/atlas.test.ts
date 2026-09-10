import { describe, expect, it } from 'vitest';
import { ATLAS_KM, ATLAS_SIZE, ATLAS_TERRAIN } from './data';
import { ATLAS_CLASS, ATLAS_RIDGE, ATLAS_RIVER, atlasCell, atlasSize, atlasTerrain } from './atlas';
import { KM_PER_CELL, cellOf, kmAt, lonLatOf } from './project';
import { TERRAIN_ORDER } from '../data/terrain';
import { FEATURE } from '../geography';
import { WORLD_SIZE } from '../data/tuning';

/** Настоящие места: по ним и видно, что запеклась именно Европа. */
const PLACES = {
  Лондон: [-0.12, 51.51],
  Париж: [2.35, 48.86],
  Рим: [12.5, 41.9],
  Лиссабон: [-9.14, 38.72],
  Киев: [30.52, 50.45],
  Царьград: [28.98, 41.01],
  Осло: [10.75, 59.91],
  Кордова: [-4.78, 37.89],
  Марракеш: [-7.98, 31.63],
  Вена: [16.37, 48.21],
} as const;

describe('атлас мира', () => {
  it('порядок классов в атласе — тот же, что у игры', () => {
    // Атлас везёт индекс, а не имя. Разойдись эти два списка — лес молча стал бы
    // холмами по всей карте, и заметил бы это только глаз.
    expect([...ATLAS_TERRAIN]).toEqual(TERRAIN_ORDER);
  });

  it('сетка атласа — это и есть сетка мира', () => {
    expect(atlasSize()).toBe(WORLD_SIZE);
    expect(ATLAS_SIZE).toBe(WORLD_SIZE);
  });

  it('биты атласа не наезжают на класс, а признаки клетки живут отдельно', () => {
    // Класс — три младших бита, значит видов местности бывает не больше восьми.
    expect(TERRAIN_ORDER.length).toBeLessThanOrEqual(ATLAS_CLASS + 1);
    expect(ATLAS_RIVER & ATLAS_CLASS).toBe(0);
    expect(ATLAS_RIDGE & ATLAS_CLASS).toBe(0);
    expect(ATLAS_RIVER & ATLAS_RIDGE).toBe(0);
    // А вот с `FEATURE` их сводить нельзя, и тест держит это врозь нарочно:
    // у признаков клетки свои семь бит, и добавить восьмой там можно, не
    // пересобирая атлас.
    expect(FEATURE.river).not.toBe(ATLAS_RIVER);
  });

  it('распаковывается целиком и сходится по хешу', () => {
    // Хеш сверяет сам модуль и падает при расхождении — здесь важно, что он
    // вообще доходит до конца и что клетки не пустые.
    const tally = new Map<number, number>();
    for (let row = 0; row < ATLAS_SIZE; row += 3) {
      for (let col = 0; col < ATLAS_SIZE; col += 3) {
        const t = atlasTerrain(col, row);
        tally.set(t, (tally.get(t) ?? 0) + 1);
      }
    }
    // Все шесть видов местности на карте есть, и ни один не занимает почти всё.
    for (const name of TERRAIN_ORDER) {
      const share = (tally.get(TERRAIN_ORDER.indexOf(name)) ?? 0) / (tally.size ? [...tally.values()].reduce((a, b) => a + b, 0) : 1);
      expect(share, `${name} на карте`).toBeGreaterThan(0.01);
      expect(share, `${name} на карте`).toBeLessThan(0.6);
    }
  });

  it('за краем сетки — открытое море', () => {
    expect(atlasTerrain(-1, 10)).toBe(TERRAIN_ORDER.indexOf('water'));
    expect(atlasTerrain(10, -1)).toBe(TERRAIN_ORDER.indexOf('water'));
    expect(atlasTerrain(ATLAS_SIZE, 10)).toBe(TERRAIN_ORDER.indexOf('water'));
    expect(atlasTerrain(10, ATLAS_SIZE)).toBe(TERRAIN_ORDER.indexOf('water'));
  });

  it('города стоят на суше, а море остаётся морем', () => {
    const water = TERRAIN_ORDER.indexOf('water');
    for (const [name, [lon, lat]] of Object.entries(PLACES)) {
      const c = cellOf(lon, lat);
      expect(c.col, `${name} в рамке`).toBeGreaterThan(0);
      expect(c.col, `${name} в рамке`).toBeLessThan(ATLAS_SIZE);
      // Портовый город на клетке в шесть километров попадает в устье, и это не
      // ошибка карты: Лиссабон стоит на Тежу, а Тежу в этом масштабе — вода.
      // Требуем суши рядом, а не ровно под точкой.
      let land = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (atlasTerrain(Math.round(c.col) + dx, Math.round(c.row) + dy) !== water) land = true;
        }
      }
      expect(land, `${name} на суше`).toBe(true);
    }
    // Середина Средиземного моря и середина Бискайского залива — вода.
    for (const [lon, lat] of [
      [17, 35],
      [-5, 45.5],
      [4, 55.5],
    ]) {
      const c = cellOf(lon, lat);
      expect(atlasTerrain(Math.round(c.col), Math.round(c.row)), `${lon}|${lat} — море`).toBe(water);
    }
  });

  it('горы стоят там, где горы: у Альп есть хребет, у Парижа нет', () => {
    const alps = cellOf(10.5, 46.5);
    const paris = cellOf(2.35, 48.86);
    const near = (c: { col: number; row: number }, bit: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (atlasCell(Math.round(c.col) + dx, Math.round(c.row) + dy) & bit) return true;
        }
      }
      return false;
    };
    expect(near(alps, ATLAS_RIDGE, 4)).toBe(true);
    expect(near(paris, ATLAS_RIDGE, 4)).toBe(false);
    expect(atlasTerrain(Math.round(alps.col), Math.round(alps.row))).toBe(TERRAIN_ORDER.indexOf('hills'));
  });

  it('реки текут по суше и попадают в настоящие русла', () => {
    const water = TERRAIN_ORDER.indexOf('water');
    let rivers = 0;
    for (let row = 0; row < ATLAS_SIZE; row += 2) {
      for (let col = 0; col < ATLAS_SIZE; col += 2) {
        const cell = atlasCell(col, row);
        if (!(cell & ATLAS_RIVER)) continue;
        rivers++;
        expect(cell & ATLAS_CLASS, `русло в ${col}|${row}`).not.toBe(water);
      }
    }
    expect(rivers).toBeGreaterThan(500);
    // Дунай у Вены и Сена у Парижа — обе в двух клетках от города.
    const near = (lon: number, lat: number): boolean => {
      const c = cellOf(lon, lat);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (atlasCell(Math.round(c.col) + dx, Math.round(c.row) + dy) & ATLAS_RIVER) return true;
        }
      }
      return false;
    };
    expect(near(16.37, 48.21), 'Дунай у Вены').toBe(true);
    expect(near(2.35, 48.86), 'Сена у Парижа').toBe(true);
  });

  it('проекция обратима и масштаб честен', () => {
    for (const [lon, lat] of Object.values(PLACES)) {
      const c = cellOf(lon, lat);
      const back = lonLatOf(c.col - 0.5, c.row - 0.5);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.lat).toBeCloseTo(lat, 6);
    }
    // Обещание конической проекции: клетка почти везде значит одно и то же.
    // Меркатор на той же рамке дал бы полуторную разницу между Магрибом и Лапландией.
    for (const lat of [30, 40, 50, 60, 66]) {
      expect(kmAt(lat)).toBeGreaterThan(KM_PER_CELL * 0.9);
      expect(kmAt(lat)).toBeLessThan(KM_PER_CELL * 1.06);
    }
    expect(KM_PER_CELL).toBeCloseTo(ATLAS_KM, 4);
  });
});
