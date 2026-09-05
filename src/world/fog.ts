// Туман войны. Слоёв два, и путать их нельзя.
//
// Первый слой — **разведанная местность**: рельеф, лес, вода и сам факт того, что
// в клетке кто-то живёт. Он открывается навсегда, как только клетка попала в чей-то
// обзор, и обратно не затягивается. Это и есть содержимое этого файла.
//
// Второй слой — **живые данные**: численность, стадия, чьё оно, идут ли оттуда
// войска. Он виден только пока клетка в радиусе обзора, а за его пределами
// показывается последнее увиденное с отметкой давности. Он живёт не здесь, а в
// снимках поселений (`Sighting` в `local/state.ts`) и стареет тем же механизмом,
// что и разведданные.
//
// Хранится первый слой битовой маской по кускам мира: клетка — один бит, кусок —
// 32×32 бита, то есть 128 байт, в сохранении — 172 символа base64. Списка
// координат здесь нет и быть не может: на разведанной половине мира это были бы
// двадцать тысяч строк вида «541|822».
import type { Coord, Rect } from './types';
import { CHUNK, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';

/** Клеток в куске и сколько байт занимает его маска. */
export const FOG_CHUNK_CELLS = CHUNK * CHUNK;
export const FOG_CHUNK_BYTES = FOG_CHUNK_CELLS / 8;

/** Сохранённая маска: ключ куска — «cx:cy», значение — его биты в base64. */
export type FogData = Record<string, string>;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const out = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) out[B64.charCodeAt(i)] = i;
  return out;
})();

/**
 * base64 своими руками, а не `btoa`. Причина простая: маска ездит и в сохранение,
 * и в тесты, и когда-нибудь на сервер, а `btoa` есть не везде и работает через
 * строку из символов-байтов. Тут двадцать строк и ни одной зависимости.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let byte = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? B64_INDEX[code] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (byte < size) out[byte++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

const chunkKey = (cx: number, cy: number): string => `${cx}:${cy}`;

/** Сколько кусков по стороне мира. Последний может выходить за край — это нормально. */
export const FOG_CHUNKS = Math.ceil(WORLD_SIZE / CHUNK);

export const inWorldCell = (x: number, y: number): boolean =>
  x >= WORLD_ORIGIN.x &&
  y >= WORLD_ORIGIN.y &&
  x < WORLD_ORIGIN.x + WORLD_SIZE &&
  y < WORLD_ORIGIN.y + WORLD_SIZE;

/**
 * Разведанная местность. Открывается и не закрывается: `reveal` есть, «забыть»
 * нет и не должно появиться — иначе игрок, отведя разведчика, решит, что карта
 * сломалась.
 */
export class FogMap {
  private chunks = new Map<string, Uint8Array>();

  constructor(data?: FogData | null) {
    if (!data) return;
    for (const [key, text] of Object.entries(data)) {
      if (typeof text !== 'string' || text.length === 0) continue;
      this.chunks.set(key, fromBase64(text, FOG_CHUNK_BYTES));
    }
  }

  private bits(cx: number, cy: number, make: boolean): Uint8Array | null {
    const key = chunkKey(cx, cy);
    const have = this.chunks.get(key);
    if (have || !make) return have ?? null;
    const fresh = new Uint8Array(FOG_CHUNK_BYTES);
    this.chunks.set(key, fresh);
    return fresh;
  }

  /** Клетка открыта? За краем мира — нет: туда всё равно не пойти. */
  has(x: number, y: number): boolean {
    if (!inWorldCell(x, y)) return false;
    const lx = x - WORLD_ORIGIN.x;
    const ly = y - WORLD_ORIGIN.y;
    const bits = this.bits(Math.floor(lx / CHUNK), Math.floor(ly / CHUNK), false);
    if (!bits) return false;
    const i = (ly % CHUNK) * CHUNK + (lx % CHUNK);
    return (bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** Открывает клетку. Возвращает true, если она открылась впервые. */
  reveal(x: number, y: number): boolean {
    if (!inWorldCell(x, y)) return false;
    const lx = x - WORLD_ORIGIN.x;
    const ly = y - WORLD_ORIGIN.y;
    const bits = this.bits(Math.floor(lx / CHUNK), Math.floor(ly / CHUNK), true) as Uint8Array;
    const i = (ly % CHUNK) * CHUNK + (lx % CHUNK);
    const mask = 1 << (i & 7);
    if ((bits[i >> 3] & mask) !== 0) return false;
    bits[i >> 3] |= mask;
    return true;
  }

  /** Круг обзора вокруг точки. Возвращает, сколько клеток открылось впервые. */
  revealDisc(c: Coord, radius: number): number {
    const r = Math.max(0, radius);
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    const rr = r * r;
    let fresh = 0;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > rr) continue;
        if (this.reveal(cx + dx, cy + dy)) fresh++;
      }
    }
    return fresh;
  }

  /**
   * Полоса обзора вдоль пройденного пути. Нужна ровно для офлайна: фигура,
   * прошедшая полкарты, пока игрока не было, обязана оставить за собой такой же
   * открытый коридор, как если бы игрок смотрел на неё всё это время.
   */
  revealPath(from: Coord, to: Coord, radius: number): number {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    // Шаг в полклетки: реже — коридор пойдёт пунктиром на диагоналях.
    const steps = Math.min(4096, Math.max(1, Math.ceil(dist * 2)));
    let fresh = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      fresh += this.revealDisc({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, radius);
    }
    return fresh;
  }

  /** Сколько клеток открыто всего. */
  count(): number {
    let n = 0;
    for (const bits of this.chunks.values()) {
      for (const b of bits) {
        let v = b;
        while (v) {
          n += v & 1;
          v >>= 1;
        }
      }
    }
    return n;
  }

  /**
   * Маска области построчно: 1 — клетка открыта. Тем же порядком, что и
   * `RegionChunk.terrain`, — карта читает их вместе.
   */
  maskFor(rect: Rect): Uint8Array {
    const out = new Uint8Array(Math.max(0, rect.w) * Math.max(0, rect.h));
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        out[y * rect.w + x] = this.has(rect.x + x, rect.y + y) ? 1 : 0;
      }
    }
    return out;
  }

  /** Только непустые куски: на старте это один-два куска, а не вся сетка. */
  toJSON(): FogData {
    const out: FogData = {};
    for (const [key, bits] of this.chunks) {
      if (bits.some((b) => b !== 0)) out[key] = toBase64(bits);
    }
    return out;
  }
}

/** Во сколько байт сохранения обходится нынешняя маска. Для отчётов и тестов. */
export const fogSaveBytes = (data: FogData): number =>
  Object.entries(data).reduce((n, [key, text]) => n + key.length + text.length + 6, 2);

// ---------- Обзор прямо сейчас ----------

/** Круг обзора: своё поселение, фигура или отряд в пути. */
export interface SightDisc {
  x: number;
  y: number;
  r: number;
}

/** Клетка в чьём-то обзоре прямо сейчас? От этого зависят только живые данные. */
export function inSight(discs: SightDisc[], x: number, y: number): boolean {
  for (const d of discs) {
    const dx = x - d.x;
    const dy = y - d.y;
    if (dx * dx + dy * dy <= d.r * d.r) return true;
  }
  return false;
}
