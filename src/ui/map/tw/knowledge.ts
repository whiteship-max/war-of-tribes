// Что игрок знает о клетке — для листа старой карты (docs/map_tw.md, разделы 13.5 и 13.6): клетка знакома, если
// она разведана **и** лежит в его регионе. Чужой регион — то же незнание: лист с чернильным берегом и рваной
// кромкой по границе, как край известного мира на старой карте. Снимок знания массивом — страница собирает его
// из кусков мира (`prebake.ts`) и отдаёт выпечке листа, в потоке и в странице одной функцией. Модуль чистый.
import type { Rect } from '@/world/types';

export interface Knowledge {
  rect: Rect;
  /** 1 — клетка знакома, построчно по `rect`. За прямоугольником — незнание. */
  known: Uint8Array;
}

/** Знание в мировой точке: билинейно между серединами клеток — кромка без ступенек сетки. */
export function knownAt(k: Knowledge): (wx: number, wy: number) => number {
  const { rect, known } = k;
  const cell = (x: number, y: number): number => {
    const i = x - rect.x;
    const j = y - rect.y;
    return i < 0 || j < 0 || i >= rect.w || j >= rect.h ? 0 : known[j * rect.w + i];
  };
  return (wx, wy) => {
    const fx = wx - 0.5;
    const fy = wy - 0.5;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const tx = fx - x;
    const ty = fy - y;
    const a = cell(x, y);
    const b = cell(x + 1, y);
    const c = cell(x, y + 1);
    const d = cell(x + 1, y + 1);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

/**
 * Запас подписи листа за край его области, в клетках: лист читает знание с рваным сдвигом до клетки и билинейно
 * ещё на клетку, а область листа — кусок с запасом `SHEET_PAD`.
 */
export const SIGN_PAD = 5;

/**
 * Подпись знания над прямоугольником с запасом: меняется только тогда, когда открылось новое (или сменился
 * регион). `open` — знакомо всё: листа над ним не нужно.
 */
export function signOf(k: Knowledge, r: Rect, pad = SIGN_PAD): { sign: number; open: boolean } {
  const { rect, known } = k;
  let h = 2166136261;
  let open = true;
  for (let y = r.y - pad; y < r.y + r.h + pad; y++) {
    for (let x = r.x - pad; x < r.x + r.w + pad; x++) {
      const i = x - rect.x;
      const j = y - rect.y;
      const v = i < 0 || j < 0 || i >= rect.w || j >= rect.h ? 0 : known[j * rect.w + i];
      if (!v) open = false;
      h = Math.imul(h ^ (v + 1), 16777619);
    }
  }
  return { sign: h >>> 0, open };
}
