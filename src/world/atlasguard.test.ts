// Страж атласа: пересборка земли меняет класс клетки — и больше ничего.
//
// Условие владельца к классу «горы» (docs/battle_eu4.md, 14.19.1): цена хода, замки и дороги не
// сдвигаются, и держит это тест; после пересборки ни одна клетка не меняет цену хода. Поэтому
// отпечаток снят на атласе ДО пересборки и лежит здесь числами, а пересборка обязана оставить его
// тем же. Сдвинулся отпечаток — сдвинулся мир под ногами у всех игроков разом: замок, стоявший на
// суше, мог оказаться в новой округе, а поход — стать длиннее. Такую правку не «переснимают», а
// выносят владельцу.
//
// Что держит каждый отпечаток и почему его хватает:
// - **цена хода каждой клетки** (`cellCost`) — туда входят вода (7.6), русло, броды и мосты, хребет
//   и перевалы, пустыня и класс земли; из тех же признаков выводится пригодность под замок
//   (`settle.fitToSettle`: вода, русло, хребет, пустыня, доля суши и куски суши — всё по воде);
// - **дороги** (`roadNet`) — сегодня их нет вовсе (станов нет, `tribeCenters` пуст), а прокладка
//   их идёт по той же цене клетки без дорог, так что отпечаток цены держит и будущую колею;
// - **клетки замков** — цепочка расселения живых игроков тем же правилом, что у сервера
//   (`placeCastle` на детерминированных бросках `settleRandom`).
import { describe, expect, it } from 'vitest';
import { cellCost, roadNet, terrainAt } from './geography';
import { placeCastle, settleRandom, type Spot } from './settle';
import { TERRAIN_ORDER } from './data/terrain';
import { WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';

/** Отпечаток ряда целых: FNV-1a по четырём байтам каждого. */
function fingerprint(values: Iterable<number>): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> (8 * k)) & 255;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** Цена хода в сотых — целым: отпечаток не должен зависеть от записи дробей. */
const centi = (cost: number): number => Math.round(cost * 100);

function* everyCell(): Generator<Spot> {
  for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y++) {
    for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x++) yield { x, y };
  }
}

/** Снято на атласе до пересборки с классом «горы» (`ATLAS_HASH` 1206907126). */
const COST_HISTOGRAM: Record<number, number> = {
  80: 503, // мост
  100: 126753, // равнина
  105: 26887, // степь
  130: 96102, // лес и перевал
  150: 64767, // холмы
  240: 53082, // пустыня
  350: 574, // брод
  760: 260460, // вода
  800: 3120, // хребет
  1800: 7752, // русло без перехода
};
const COST_PRINT = 247122206;
/** Тракта сегодня нет ни клетки: станов нет, соединять нечего (`geography.tribeCenters`). */
const ROAD_CELLS = 0;
const ROAD_PRINT = 3809873841;
const CASTLES: Array<[number, number]> = [
  [1013, 1300], [1059, 1287], [1025, 1323], [1063, 1251], [977, 1279], [1010, 1257],
  [1117, 1239], [1113, 1273], [1036, 1264], [976, 1323], [1082, 1270], [1088, 1244],
  [1145, 1228], [1121, 1214], [1085, 1327], [1154, 1289], [1185, 1197], [1172, 1158],
  [1110, 1300], [949, 1306], [1140, 1183], [1158, 1120], [1119, 1336], [1142, 1328],
];

describe('страж атласа: пересборка меняет класс земли и больше ничего', () => {
  it('цена хода каждой клетки мира та же', () => {
    const histogram: Record<number, number> = {};
    const classes = new Set<string>();
    const costs: number[] = [];
    for (const c of everyCell()) {
      const cost = centi(cellCost(0, c.x, c.y));
      costs.push(cost);
      histogram[cost] = (histogram[cost] ?? 0) + 1;
      classes.add(terrainAt(0, c.x, c.y));
    }
    // Граница области: отпечаток снят со всей сетки, и в ней есть каждый класс земли — иначе
    // «цена не сдвинулась» проверялось бы на мире, где пересобираемого класса нет вовсе.
    expect(costs.length).toBe(WORLD_SIZE * WORLD_SIZE);
    for (const t of TERRAIN_ORDER) expect(classes.has(t), `класс ${t} на карте`).toBe(true);
    expect(histogram, 'сколько клеток у каждой цены хода').toEqual(COST_HISTOGRAM);
    expect(fingerprint(costs), 'отпечаток цены хода по клеткам').toBe(COST_PRINT);
  }, 60_000);

  it('дороги те же', () => {
    const net = roadNet(0);
    const cells = [...net.cells].sort((a, b) => a - b);
    const track = [...net.track].sort((a, b) => a - b);
    expect(cells.length, 'клеток тракта').toBe(ROAD_CELLS);
    expect(fingerprint([...cells, -1, ...track]), 'отпечаток тракта и колеи').toBe(ROAD_PRINT);
  });

  it('клетки замков те же: цепочка расселения тем же правилом, что у сервера', () => {
    const roster: Spot[] = [];
    for (let i = 0; i < 24; i++) roster.push(placeCastle(settleRandom(`страж атласа ${i}`), roster));
    expect(roster.map((s): [number, number] => [s.x, s.y])).toEqual(CASTLES);
  }, 60_000);
});
