// Уровни качества карты нового вида (docs/map_tw.md, раздел 7). Пункт настроек тот же, что у города
// («Графика»: Авто / Низкая / Средняя / Высокая, `render/gfx.ts`); своего у карты нет.
//
// Холст тайла (`TILE_BAKE`, 64 px на клетку) на всех уровнях один: от него выведена память кэша
// (`grid.cacheFor`, `tileMemory`). Уровень меняет только то, сколько счёта уходит в выпечку.
//
// Модуль чистый — его читает и рабочий поток выпечки (`bake.worker.ts`); уровень устройства и настроек
// решает `quality.ts`.
import type { Quality } from '@/render/quality';

export interface TwSpec {
  /** Узлов решётки света на клетку. Свет считается по ней и растягивается на тайл сглаживанием. */
  nodes: number;
  /** Тень от гор на долину: проход от узла к солнцу по решётке. */
  castShadow: boolean;
  /** Куп на клетку сплошного леса (купа — до пяти крон одним спрайтом, `sprites.grove`). */
  groves: number;
  /** Рябь моря фактурой под маской воды. */
  ripples: boolean;
  /** Узлов решётки обзора на клетку (кусок карты, дальний масштаб). */
  overviewNodes: number;
  /**
   * Слой среднего масштаба (`tw/mid.ts`, 8 px на клетку): без него между обзором и тайлами — растянутый
   * кусок обзора. На низком уровне его нет: выпечка там дороже всего, а мыло среднего масштаба — терпимо.
   */
  mid: boolean;
}

export const TW_SPEC: Record<Quality, TwSpec> = {
  low: { nodes: 8, castShadow: false, groves: 5, ripples: false, overviewNodes: 3, mid: false },
  medium: { nodes: 12, castShadow: true, groves: 8, ripples: true, overviewNodes: 4, mid: true },
  high: { nodes: 16, castShadow: true, groves: 11, ripples: true, overviewNodes: 4, mid: true },
};
