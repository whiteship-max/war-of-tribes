// Атлас мира: настоящая земля вместо шума по сиду.
//
// Мир перестал быть личной картой, сгенерированной из зерна, и стал одним на
// всех: Европа, Магриб, Анатолия по данным Natural Earth. Здесь только чтение —
// откуда взята земля и что в ней выведено нами, записано в
// `assets-src/world/SOURCES.md`, а собирает атлас `npm run world:build`.
//
// Модуль синхронный нарочно. Мир строится синхронно (`new LocalWorld` в
// `world/store.ts`, шесть тестовых файлов и пять отчётов), а `terrainAt`
// спрашивают десятки тысяч раз на один расчёт пути. Асинхронная дверь здесь
// означала бы `await` в двух сотнях мест и ровно одну новую болезнь — мир,
// который успели спросить раньше, чем он приехал.
import { ATLAS_HASH, ATLAS_RLE, ATLAS_SIZE, ATLAS_TERRAIN } from './data';

/**
 * Биты атласа — свои, и с `FEATURE` из `geography.ts` они нарочно не сведены.
 * У признаков клетки семь бит и своя история (мост, брод, перевал, тракт), а
 * атлас везёт только то, что запечено из данных. Сведи их в один набор — и
 * следующий признак, добавленный в игре, потребовал бы пересборки атласа.
 */
export const ATLAS_RIVER = 8;
export const ATLAS_RIDGE = 16;
/** Маска класса: младшие три бита — индекс в `ATLAS_TERRAIN`. */
export const ATLAS_CLASS = 7;

/** Индекс воды в `ATLAS_TERRAIN`. За краем карты — открытое море. */
export const ATLAS_WATER = ATLAS_TERRAIN.indexOf('water');

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Прогоны: значение, длина одним байтом до 253, иначе 254 и два байта. */
function unpack(packed: Uint8Array, total: number): Uint8Array {
  const out = new Uint8Array(total);
  let read = 0;
  let write = 0;
  while (write < total && read < packed.length) {
    const value = packed[read++];
    let run = packed[read++];
    if (run === 254) {
      run = packed[read] | (packed[read + 1] << 8);
      read += 2;
    }
    const end = Math.min(total, write + run);
    out.fill(value, write, end);
    write = end;
  }
  if (write !== total) throw new Error(`Атлас мира: распаковалось ${write} клеток из ${total}.`);
  return out;
}

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Распакованная земля. Считается один раз при первом обращении, а не на импорте:
 * стенды и тесты, которым мир не нужен, не должны платить за него ни миллисекунды.
 */
let cells: Uint8Array | null = null;

function atlas(): Uint8Array {
  if (cells) return cells;
  const out = unpack(fromBase64(ATLAS_RLE), ATLAS_SIZE * ATLAS_SIZE);
  // Сверка — не перестраховка. Распаковавшийся не в ту сторону атлас дал бы не
  // сбой, а другой мир: другую сушу под теми же координатами. Молчать нельзя.
  const hash = fnv1a(out);
  if (hash !== ATLAS_HASH) {
    throw new Error(`Атлас мира не сошёлся: ${hash} вместо ${ATLAS_HASH}. Пересоберите npm run world:build.`);
  }
  cells = out;
  return cells;
}

/** Сторона квадрата в клетках. */
export const atlasSize = (): number => ATLAS_SIZE;

/**
 * Клетка атласа целиком: класс в младших трёх битах, река и хребет — битами.
 * За краем сетки — открытое море: мир кончается берегом, а не пустотой.
 */
export function atlasCell(col: number, row: number): number {
  if (col < 0 || row < 0 || col >= ATLAS_SIZE || row >= ATLAS_SIZE) return ATLAS_WATER;
  return atlas()[row * ATLAS_SIZE + col];
}

/** Индекс ландшафта в `TERRAIN_ORDER`. */
export const atlasTerrain = (col: number, row: number): number => atlasCell(col, row) & ATLAS_CLASS;
