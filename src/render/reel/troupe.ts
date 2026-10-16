// Толпа ролика боя — общий язык бойцов, знамён и плана места (docs/gfx.md, «Общий модуль»). Чистый, без three.
//
// План места (поле — `tw/plan.ts`; осады строит ГФ-2 на том же языке) раскладывает отряды и фигуры плоскими массивами,
// а рисуют их общие части модуля: толпа (`crowd.ts`), знамёна (`banners.ts`). Им нужно не всё, что знает план, а только
// это: кто фигура (вид, рост, тон), чей отряд, где она в кадре и что делает. Здесь — ровно это, и второго описания
// фигуры у модуля нет: план и толпа говорят одними словами, и разойтись им негде.
import type { UnitKind } from '@/battle/types';

/** Что делает фигура: запечённые клипы (`bake.ts`). Порядок — номер клипа в текстуре. */
export type ClipId = 'idle' | 'march' | 'run' | 'guard' | 'strike' | 'shoot' | 'fall' | 'cheer';
export const CLIPS: readonly ClipId[] = ['idle', 'march', 'run', 'guard', 'strike', 'shoot', 'fall', 'cheer'];
export const CLIP_INDEX = Object.fromEntries(CLIPS.map((c, i) => [c, i])) as Record<ClipId, number>;

/** Кадр фигур: место, разворот, клип и время клипа — плоскими массивами, без мусора. */
export interface FigureFrame {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  clip: Uint8Array;
  time: Float32Array;
  /** Фигура видна: павшие лежат и видны; бежавшие за край поля гаснут. */
  shown: Uint8Array;
}

export function figureFrame(n: number): FigureFrame {
  return {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    clip: new Uint8Array(n),
    time: new Float32Array(n),
    shown: new Uint8Array(n),
  };
}

/** Отряд глазами общих частей: чей он, кто в нём лицом, где его фигуры и есть ли у него знамя. */
export interface TroupeUnit {
  id: number;
  ours: boolean;
  kind: UnitKind;
  /** Вид, которого в отряде больше всех: знак рода на знамени (ополчение — свой). */
  face: string;
  /** Первая фигура отряда в общих массивах и сколько их. */
  first: number;
  figures: number;
  ranks: number;
  /** Глубина строя, метры сцены. */
  depth: number;
  /** Когда побежал — секунда ролика; null — не бежал. */
  fleeAt: number | null;
  /** Знамя: у отряда, стяг — у полководца; у стаи — нет. */
  banner: 'unit' | 'standard' | null;
}

/** Фигуры плана — то, что нужно толпе и знамёнам. План места (`TwPlan`) — его надмножество. */
export interface Troupe {
  units: readonly TroupeUnit[];
  /** Отряд фигуры. */
  unitOf: Int32Array;
  /** Вид фигуры — номер в `faceIds`: метка вида и род, в котором он стоит. */
  faceOf: Int16Array;
  faceIds: readonly { id: string; kind: UnitKind }[];
  /** Место в строю относительно середины передней шеренги, в осях отряда (вперёд — +z). */
  lx: Float32Array;
  lz: Float32Array;
  scale: Float32Array;
  tone: Float32Array;
  /** Когда падает — секунда ролика; Infinity — доживает. */
  deathAt: Float32Array;
}

/**
 * Знаменосец отряда — фигура ближе всех к середине строя, во второй шеренге, если она есть. Одна дверь: знамя
 * (`banners.ts`) стоит над ним, а план уводит его своим путём последним — знамя уходит с отрядом, а не с одиночкой.
 */
export function bearerOf(t: Pick<Troupe, 'lx' | 'lz'>, u: TroupeUnit): number {
  const want = -Math.min(1, u.ranks - 1) * (u.depth / Math.max(1, u.ranks - 1));
  let best = u.first;
  let bestD = Infinity;
  for (let i = u.first; i < u.first + u.figures; i++) {
    const d = Math.abs(t.lx[i]) + Math.abs(t.lz[i] - want);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
