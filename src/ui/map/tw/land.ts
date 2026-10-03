// Земля под выпечкой нового вида (docs/map_tw.md, раздел 13.4): откуда выпечка берёт класс клетки, реки и
// дворы. Выпечка одна, а земля у неё бывает двух видов: кэш мира (`landcache.ts` — стенд) и снимок региона
// массивами (`landgrid.ts` — рабочий поток и запасной путь в странице). Выпечка спрашивает только здесь и не
// знает, откуда ответ: модуль чистый и едет в поток.
import type { Rect, Terrain } from '@/world/types';

export interface LandSource {
  /** Класс клетки; null — данных нет (за краем снимка или мира: там море). */
  sample(x: number, y: number): Terrain | null;
  river(x: number, y: number): boolean;
  ridge(x: number, y: number): boolean;
  /** Тракт или колея. */
  road(x: number, y: number): boolean;
  ford(x: number, y: number): boolean;
  bridge(x: number, y: number): boolean;
  /** Клетки поселений в прямоугольнике: под двором — суша и без деревьев. */
  homes(rect: Rect): { x: number; y: number }[];
  /** Есть ли данные на весь прямоугольник (его часть в мире): печь по неполным — шов на границе знания. */
  ready(rect: Rect): boolean;
}

let current: LandSource | null = null;

export function setLand(source: LandSource | null): void {
  current = source;
}

export function land(): LandSource {
  if (!current) throw new Error('Карта: земли под выпечкой нет (`setLand`).');
  return current;
}
