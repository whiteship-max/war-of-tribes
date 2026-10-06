// Места появления новых игроков для теста с игроками (docs/test_world.md): двенадцать клеток на Сицилии.
//
// Режим включает сервер настройкой `TRIBE_SPAWN=sicily` (`netlify/lib/http.spawnMode`); без неё расселение обычное
// (`settle.placeCastle`). Место выдаёт реестр замков (`netlify/lib/roster.upsert`) — свободное из этого списка, а когда
// свободных нет, — по обычным правилам, но в регионе острова (`SICILY_THEATRE`), чтобы новичок мог воевать с теми, кто
// уже на острове.
//
// Места — данные, а не расчёт на запросе: `SICILY` запечён и сверяется тестом с выводом `deriveSicily()` (`spawn.test.ts`),
// как регионы с `theatre/derive.ts`. Поправил вывод — пересобери список, иначе красный тест, а не другие места.
//
// Модуль читают и сервер, и игра, поэтому правило `land.ts` и `settle.ts` действует и здесь: ни одного `@/`-импорта, ни
// DOM — только земля, проекция атласа и регионы.
import { cellOf } from './atlas/project';
import { isDesertAt, isWaterAt, landShare, settleable, type Spot } from './land';
import { HOME_LAND_SHARE, WORLD_ORIGIN } from './data/tuning';
import { theatreAt } from './theatre/theatre';

/** Режимы появления. Один — Сицилия; нет режима — обычное расселение. */
export type SpawnMode = 'sicily';

/** Режим по значению настройки сервера. Всё, кроме `sicily`, — обычное расселение. */
export const spawnModeOf = (raw: string | undefined): SpawnMode | null => ((raw ?? '').trim().toLowerCase() === 'sicily' ? 'sicily' : null);

/** Сколько мест на острове (слово владельца). */
export const SICILY_COUNT = 12;

/** Сердце острова — Энна: от него остров размечается разливом по суше. */
export const SICILY_HEART = { lon: 14.28, lat: 37.57 } as const;

/** Регион острова — весь остров лежит в нём (`spawn.test.ts`). */
export const SICILY_THEATRE = 'italy';

/**
 * Ближняя граница между местами острова, клеток (8 × 6,1 км ≈ 49 км). Обычная — `SETTLE_GAP` (24): с ней на острове в
 * 664 клетки двенадцать замков не встают. Ослаблена только для этих мест; кто ставится по обычным правилам — держит
 * обычную. Ниже неё выведенные места не сходятся (тест).
 */
export const SICILY_GAP = 8;

/**
 * Круг доли суши у места, клеток. Обычная мерка расселения — круг `HOME_LAND_RADIUS` (10 клеток, 61 км): на острове
 * шириной 30 клеток её проходит только середина (379 клеток из 664), и двенадцать мест сбились бы в кучу. Узкий круг
 * отсекает то же, ради чего есть широкий, — кончик мыса, — и пускает остальное побережье. Доля та же — `HOME_LAND_SHARE`.
 */
export const SICILY_LAND_RADIUS = 4;

/**
 * Двенадцать мест на Сицилии, с запада на восток. Порядок — порядок выдачи: первый вошедший получает первое свободное.
 * Запечено из `deriveSicily()`; тест сверяет.
 */
export const SICILY: readonly Spot[] = [
  { x: 741, y: 1335 },
  { x: 749, y: 1329 },
  { x: 750, y: 1339 },
  { x: 758, y: 1332 },
  { x: 758, y: 1345 },
  { x: 766, y: 1336 },
  { x: 768, y: 1344 },
  { x: 770, y: 1352 },
  { x: 772, y: 1330 },
  { x: 775, y: 1338 },
  { x: 777, y: 1347 },
  { x: 780, y: 1331 },
];

/** Номер места (1..12), на котором стоит клетка, или 0 — не место острова. */
export const sicilySlot = (at: Spot): number => SICILY.findIndex((s) => s.x === at.x && s.y === at.y) + 1;

/** Годится ли клетка острова под место: та же пригодность, что у любого двора, и не кончик мыса. */
export const sicilyFit = (at: Spot): boolean =>
  settleable(at.x, at.y) && !isDesertAt(at.x, at.y) && landShare(at.x, at.y, SICILY_LAND_RADIUS) >= HOME_LAND_SHARE;

/** Клетка мира под точкой долготы и широты. */
const cellAt = (lon: number, lat: number): Spot => {
  const c = cellOf(lon, lat);
  return { x: Math.floor(c.col) + WORLD_ORIGIN.x, y: Math.floor(c.row) + WORLD_ORIGIN.y };
};

/**
 * Суша острова: разлив от сердца по четырём соседям. По диагонали остров касается Калабрии у Мессинского пролива
 * (клетки 783|1326 и 784|1327), и разлив по восьми соседям ушёл бы на материк; по четырём — нет (тест: все клетки
 * острова западнее пролива). Порядок — по строкам, слева направо.
 */
export function sicilyLand(): Spot[] {
  const start = cellAt(SICILY_HEART.lon, SICILY_HEART.lat);
  const seen = new Set<string>();
  const out: Spot[] = [];
  const stack: Spot[] = [start];
  while (stack.length > 0) {
    const p = stack.pop() as Spot;
    const key = `${p.x}|${p.y}`;
    if (seen.has(key) || isWaterAt(p.x, p.y)) continue;
    seen.add(key);
    out.push(p);
    // Потолок — страховка от ошибки разметки: Сицилия — сотни клеток, материк — сотни тысяч.
    if (out.length > 5000) throw new Error('Сицилия: разлив ушёл на материк.');
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

const d2 = (a: Spot, b: Spot): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Вывод мест: равномерно по острову и примерно на равном расстоянии друг от друга.
 *
 * 1. Центры — k-средних по всей суше острова (Ллойд, сто шагов): каждый центр — середина своей доли острова, и доли
 *    примерно равны. Начало — дальними точками от самой западной клетки, без случайности.
 * 2. Каждый центр садится на ближнюю годную клетку (`sicilyFit`), занятые не берутся.
 * 3. Шлифовка: место сдвигается не дальше чем на 2,5 клетки, если от этого растёт расстояние до ближнего соседа, — пока
 *    сдвигать нечего. Так ближние расстояния выравниваются (на запечённом — от 8,1 до 10 клеток).
 *
 * Сравнения — в квадратах целых расстояний, ничьи — первым по порядку: вывод один на любом движке.
 */
export function deriveSicily(): Spot[] {
  const land = sicilyLand();
  const fit = land.filter(sicilyFit);
  const k = SICILY_COUNT;

  const west = land.reduce((a, b) => (b.x < a.x || (b.x === a.x && b.y < a.y) ? b : a));
  const centers: { x: number; y: number }[] = [{ ...west }];
  while (centers.length < k) {
    let best = land[0];
    let bestD = -1;
    for (const p of land) {
      const d = Math.min(...centers.map((c) => d2(c, p)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    centers.push({ ...best });
  }
  for (let step = 0; step < 100; step++) {
    const sx = new Array<number>(k).fill(0);
    const sy = new Array<number>(k).fill(0);
    const n = new Array<number>(k).fill(0);
    for (const p of land) {
      let j = 0;
      let bestD = Infinity;
      centers.forEach((c, i) => {
        const d = d2(c, p);
        if (d < bestD) {
          bestD = d;
          j = i;
        }
      });
      sx[j] += p.x;
      sy[j] += p.y;
      n[j]++;
    }
    centers.forEach((c, i) => {
      if (n[i] > 0) {
        c.x = sx[i] / n[i];
        c.y = sy[i] / n[i];
      }
    });
  }

  const used = new Set<string>();
  const spots: Spot[] = centers.map((c) => {
    let best = fit[0];
    let bestD = Infinity;
    for (const p of fit) {
      if (used.has(`${p.x}|${p.y}`)) continue;
      const d = d2(c, p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    used.add(`${best.x}|${best.y}`);
    return { x: best.x, y: best.y };
  });

  const nearestTo = (p: Spot, i: number): number => Math.min(...spots.filter((_, j) => j !== i).map((q) => d2(p, q)));
  for (let round = 0; round < 100; round++) {
    let moved = false;
    spots.forEach((p, i) => {
      let best = p;
      let bestD = nearestTo(p, i);
      for (const c of fit) {
        if (d2(c, p) > 6.25) continue;
        const d = nearestTo(c, i);
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best !== p) {
        spots[i] = { x: best.x, y: best.y };
        moved = true;
      }
    });
    if (!moved) break;
  }
  return spots.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Регион острова — для правила «свободное место в том же регионе», когда места на острове кончились. */
export const inSicilyTheatre = (at: Spot): boolean => theatreAt(at.x, at.y)?.id === SICILY_THEATRE;
