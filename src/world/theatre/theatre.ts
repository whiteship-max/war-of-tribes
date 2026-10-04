// Регионы мира (docs/map_tw.md, раздел 13): чей квадрат земли, рамка региона и регион игрока. В коде регион —
// «театр»: слово «регион» в мире уже занято куском карты (`WorldApi.region`, `RegionChunk`).
//
// Одна дверь на всех (docs/map_tw.md, 0.−2): мир ставит логова только в регионе игрока (`gen.ts`,
// `LocalWorld.spawnLair`) и не пускает походы за его край (`LocalWorld`), карта рисует и выбирает по нему же
// (`ui/map/tw/theatre/active.ts`, `ui/map/twslot.ts`). Мерка одна — `inTheatre`: второй мерки «своё ли это» нет, и
// игрок не увидит цель, в которую мир откажет идти, или отказ там, где карта звала.
//
// Разметка запечена (`data.ts`, собирает `npm run theatres:build` из `derive.ts`): на устройстве она только
// распаковывается — один раз, при первом вопросе, с проверкой подписи, как атлас. Регион игрока — по клетке его
// города; где стоят логова и чужие замки — по их клеткам. В сохранении региона нет: он выводится из дома.
import type { Coord, Rect } from '../types';
import { WORLD_ORIGIN, WORLD_SIZE } from '../data/tuning';
import { THEATRE_HASH, THEATRE_IDS, THEATRE_RLE, THEATRE_SIZE } from './data';
import { THEATRE_LIST } from './list';
import { fnv1a, unpack } from './pack';

export interface Theatre {
  /** Номер в данных, 1..N. 0 — ничья земля, и у неё записи нет. */
  index: number;
  id: string;
  name: string;
  /** Рамка: наименьший прямоугольник в клетках мира, в котором лежит весь регион. */
  box: Rect;
  /** Клеток региона: суша и своя вода. */
  cells: number;
}

let grid: Uint8Array | null = null;
let list: Theatre[] = [];

function load(): Uint8Array {
  if (grid) return grid;
  if (THEATRE_SIZE !== WORLD_SIZE) throw new Error(`Регионы собраны на мир ${THEATRE_SIZE}, а мир — ${WORLD_SIZE}. Пересоберите npm run theatres:build.`);
  if (THEATRE_IDS.length !== THEATRE_LIST.length || THEATRE_IDS.some((id, k) => THEATRE_LIST[k].id !== id)) {
    throw new Error('Регионы: список в list.ts разошёлся с данными. Пересоберите npm run theatres:build.');
  }
  const cells = unpack(THEATRE_RLE, THEATRE_SIZE * THEATRE_SIZE);
  const hash = fnv1a(cells);
  if (hash !== THEATRE_HASH) throw new Error(`Регионы не сошлись: ${hash} вместо ${THEATRE_HASH}. Пересоберите npm run theatres:build.`);
  const n = THEATRE_SIZE;
  const box = THEATRE_LIST.map(() => ({ x0: n, y0: n, x1: -1, y1: -1, cells: 0 }));
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i];
    if (!k) continue;
    const b = box[k - 1];
    const x = i % n;
    const y = (i / n) | 0;
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
    b.cells++;
  }
  list = THEATRE_LIST.map((def, k) => {
    const b = box[k];
    return {
      index: k + 1,
      id: def.id,
      name: def.name,
      box: { x: WORLD_ORIGIN.x + b.x0, y: WORLD_ORIGIN.y + b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 },
      cells: b.cells,
    };
  });
  grid = cells;
  return cells;
}

/** Номер региона клетки мира; 0 — ничья земля или за краем мира. */
export function theatreIndexAt(x: number, y: number): number {
  const g = load();
  const c = Math.floor(x) - WORLD_ORIGIN.x;
  const r = Math.floor(y) - WORLD_ORIGIN.y;
  if (c < 0 || r < 0 || c >= THEATRE_SIZE || r >= THEATRE_SIZE) return 0;
  return g[r * THEATRE_SIZE + c];
}

/** Регион клетки мира или null — ничья земля. */
export function theatreAt(x: number, y: number): Theatre | null {
  const k = theatreIndexAt(x, y);
  return k ? list[k - 1] : null;
}

export function theatres(): readonly Theatre[] {
  load();
  return list;
}

export function theatreById(id: string): Theatre | null {
  load();
  return list.find((t) => t.id === id) ?? null;
}

// ---------- Регион игрока ----------

/**
 * Клетка в регионе `t`? Региона нет (`null`) — да: рамки нет, и ничто не за краем. Так бывает только без дома
 * (мир не приехал, стенд, тест): у каждой клетки, где может встать город, регион есть (`theatre.test.ts`).
 * Единственная мерка «своё ли это» — для мира и для карты.
 */
export function inTheatre(t: Theatre | null, x: number, y: number): boolean {
  return t === null || theatreIndexAt(x, y) === t.index;
}

/** Регион игрока — по клетке его города. */
export const homeTheatre = (home: Coord): Theatre | null => theatreAt(home.x, home.y);

/** Клетка в регионе игрока, чей город стоит на `home`? Логова, цели походов и приказов — только там. */
export const inHomeTheatre = (home: Coord, at: Coord): boolean => inTheatre(homeTheatre(home), at.x, at.y);

/** Отказ миром и строка карты о клетке за краем региона — одни слова. */
export function beyondNote(home: Coord | null): string {
  const t = home ? homeTheatre(home) : null;
  return `Это уже не ${t?.name ?? 'твоя земля'}: за край своей земли походы не ходят.`;
}
