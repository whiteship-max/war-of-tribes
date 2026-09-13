// Кэш тайлов земли: что держать, что печь, что вытеснять.
//
// Отделён от выпечки нарочно. Выпечке нужен холст, а холста под vitest нет, —
// и пока правило вытеснения жило рядом с `drawImage`, проверить его было нечем.
// Так и прожила перепечка: кадр просил экран с запасом, кэш держал только экран,
// и в 46% положений камеры тайл запаса вытеснялся, а следующий кадр пёк его снова
// — по выпечке на кадр у неподвижной карты, и ни один тест этого не видел.
//
// Правило теперь одно, и выполнить его наполовину нельзя:
//
//   1. кадр помечает **весь** свой запрос, прежде чем что-то вытеснять;
//   2. вытесняется только непомеченное, старое первым;
//   3. запрос не бывает больше ёмкости — его обрезает `frameQueue`, а ёмкость
//      выводится из запроса (`cacheFor`); обе живут в `grid.ts`.
//
// Из первых двух следует: тайл, который кадр просит, из кэша не уходит, пока его
// просят. Значит у неподвижной камеры, раз испёкши свой запрос, кэш не печёт
// больше ничего — никогда, при любом совпадении экрана с сеткой. Из третьего —
// что вытеснять всегда есть что, и память не растёт сверх ёмкости.
import type { TileId } from './grid';

const key = (tx: number, ty: number): string => `${tx}:${ty}`;

interface Slot<T> {
  value: T;
  /** Кадр, в котором тайл последний раз просили. По нему и вытесняют. */
  usedFrame: number;
}

export class TileCache<T> {
  private slots = new Map<string, Slot<T>>();

  /** `release` отдаёт вытесненное: холст в пул или на свалку. */
  constructor(private readonly release: (value: T) => void) {}

  get size(): number {
    return this.slots.size;
  }

  /** Готовый тайл или null. Ничего не помечает: помечает запрос, а не показ. */
  get(tx: number, ty: number): T | null {
    return this.slots.get(key(tx, ty))?.value ?? null;
  }

  /**
   * Кадр целиком: пометить запрос, испечь недостающее в пределах бюджета,
   * вытеснить лишнее сверх ёмкости. Возвращает, сколько тайлов испечено.
   *
   * `bake` вернул null — кусков карты под тайлом ещё нет; такой отказ бюджета не
   * тратит и выпечкой не считается.
   */
  frame(
    want: TileId[],
    frame: number,
    capacity: number,
    budget: number,
    bake: (tx: number, ty: number) => T | null,
  ): number {
    // 1. Весь запрос — живой. Помечается до выпечки и до вытеснения: пометь его
    // только рисование, как было, — и запас оказался бы беззащитен.
    for (const { tx, ty } of want) {
      const slot = this.slots.get(key(tx, ty));
      if (slot) slot.usedFrame = frame;
    }
    let baked = 0;
    for (const { tx, ty } of want) {
      if (baked >= budget) break;
      if (this.slots.has(key(tx, ty))) continue;
      const value = bake(tx, ty);
      if (value === null) continue;
      this.slots.set(key(tx, ty), { value, usedFrame: frame });
      baked++;
    }
    this.evict(frame, capacity);
    return baked;
  }

  /** Вытеснить непомеченное в этом кадре, старое первым, пока не влезет в ёмкость. */
  private evict(frame: number, capacity: number): void {
    while (this.slots.size > capacity) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, slot] of this.slots) {
        if (slot.usedFrame === frame) continue;
        if (slot.usedFrame < oldest) {
          oldest = slot.usedFrame;
          oldestKey = k;
        }
      }
      // Вытеснять нечего — всё в кэше просит этот кадр. При запросе не больше
      // ёмкости так не бывает; бывает — лучше лишний тайл в памяти, чем выброшенный
      // и испечённый следующим кадром заново.
      if (!oldestKey) return;
      const gone = this.slots.get(oldestKey);
      this.slots.delete(oldestKey);
      if (gone) this.release(gone.value);
    }
  }

  /**
   * Отдать всё: новый мир или уход с карты. Отдаёт мимо `release` — в пул
   * уходящее с карты класть незачем, его выбрасывают целиком.
   */
  drop(dispose: (value: T) => void): void {
    for (const slot of this.slots.values()) dispose(slot.value);
    this.slots.clear();
  }
}
