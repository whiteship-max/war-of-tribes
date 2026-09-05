// Ландшафт клетки: как он выглядит на карте и насколько замедляет отряд.
import type { Terrain } from '../types';

/** Порядок важен: по нему ландшафт едет в RegionChunk.terrain числом. */
export const TERRAIN_ORDER: Terrain[] = ['plain', 'forest', 'hills', 'water'];

export interface TerrainDef {
  id: Terrain;
  name: string;
  /**
   * Во сколько раз медленнее равнины идёт отряд. У воды число нарочно тяжёлое:
   * плыть можно, но невыгодно — иначе мосты и броды ничего не стоили бы.
   * Признаки местности поверх ландшафта (река, хребет, дорога) считает
   * `world/geography.ts`, и они этот множитель перебивают.
   */
  cost: number;
  /** Заливка клетки на карте. */
  color: string;
  /** Оттенок для крапа на близком масштабе. */
  detail: string;
}

export const TERRAIN_META: Record<Terrain, TerrainDef> = {
  plain: { id: 'plain', name: 'Равнина', cost: 1, color: '#5f6b3c', detail: '#6f7c46' },
  forest: { id: 'forest', name: 'Лес', cost: 1.3, color: '#3c5330', detail: '#4a6339' },
  hills: { id: 'hills', name: 'Холмы', cost: 1.5, color: '#6b5a41', detail: '#7d6a4d' },
  water: { id: 'water', name: 'Вода', cost: 3.8, color: '#2b4761', detail: '#33536f' },
};

export const terrainCost = (t: Terrain): number => TERRAIN_META[t].cost;
