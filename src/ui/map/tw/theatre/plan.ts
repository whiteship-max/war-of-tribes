// Что печётся заранее для региона (docs/map_tw.md, раздел 13): куски обзора и тайлы среднего слоя — на весь
// регион с каймой, листы старой карты — на всё, куда пускают камеру. И сколько это стоит памяти: размер
// региона выбран так, чтобы заранее испечённое влезало в `PREBAKE_BUDGET` (тест `theatre.test.ts`).
//
// Земля под каймой печётся затем, что край листа рваный: в двух-трёх клетках за границей региона сквозь
// лист видна земля, и под ним не должно быть пустоты.
import type { Rect } from '@/world/types';
import { ATLAS_CLASS, ATLAS_WATER, atlasCell } from '@/world/atlas/atlas';
import { CHUNK, WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { MID_BLEED, MID_CELLS, MID_PX, OVERVIEW_BLEED, OVERVIEW_PX } from '../bake';
import { SHEET_PAD, SHEET_PX } from '../parchment';
import { reachOf } from './camera';
import { type Theatre, theatreIndexAt } from './theatre';

/** Кайма вокруг региона, где печётся земля: рваный край листа заходит за границу на две-три клетки. */
export const THEATRE_FRINGE = 3;

/**
 * Потолок заранее испечённого региона на среднем и высоком уровне — обзор, средний слой и листы, байт; тест
 * держит каждый регион под ним. Вместе с кэшем ближнего масштаба (`grid.tileMemory`, 25 МБ на телефоне) — до
 * полусотни МБ на землю: «десятки», а не сотни.
 */
export const PREBAKE_BUDGET = 28 * 1024 * 1024;

export interface TheatrePlan {
  /** Куда пускают камеру: рамка с краем, обрезанная по миру. */
  reach: Rect;
  /** Куски обзора (индексы кусков мира): регион с каймой. */
  chunks: { cx: number; cy: number }[];
  /** Тайлы среднего слоя: регион с каймой, где в тайле с запасом есть суша (открытое море — заливкой обзора). */
  mids: { tx: number; ty: number }[];
  /** Куски, над которыми может лечь лист: всё, куда пускают камеру. */
  sheets: { cx: number; cy: number }[];
  /** Клетка — у видимого с каймой (своё и открытое море): здесь земля нужна, дальше её целиком закрывает лист. */
  fringe(x: number, y: number): boolean;
}

/** Байт на картинку слоя: у холста 2D подложка ровно ширина × высота × 4. */
export const CHUNK_BYTES = (CHUNK * OVERVIEW_PX + OVERVIEW_BLEED * 2) ** 2 * 4;
export const MID_BYTES = (MID_CELLS * MID_PX + MID_BLEED * 2) ** 2 * 4;
export const SHEET_BYTES = ((CHUNK + SHEET_PAD * 2) * SHEET_PX) ** 2 * 4;

const clipToWorld = (r: Rect): Rect => {
  const x0 = Math.max(WORLD_ORIGIN.x, r.x);
  const y0 = Math.max(WORLD_ORIGIN.y, r.y);
  const x1 = Math.min(WORLD_ORIGIN.x + WORLD_SIZE, r.x + r.w);
  const y1 = Math.min(WORLD_ORIGIN.y + WORLD_SIZE, r.y + r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
};

const water = (x: number, y: number): boolean => (atlasCell(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y) & ATLAS_CLASS) === ATLAS_WATER;

/**
 * Видит ли игрок региона `t` землю клетки (docs/map_tw.md, раздел 13.5): своя клетка — да; открытое море (ничья
 * вода) — да: море есть море, и между своими берегами не встаёт лист; чужой край с его прибрежной водой, песчаное
 * море и дальние острова — нет, там лист старой карты.
 */
export function visibleTo(t: Theatre, x: number, y: number): boolean {
  const k = theatreIndexAt(x, y);
  return k === t.index || (k === 0 && water(x, y));
}

const plans = new Map<number, TheatrePlan>();

export function theatrePlan(t: Theatre): TheatrePlan {
  const have = plans.get(t.index);
  if (have) return have;
  const reach = clipToWorld(reachOf(t.box));
  // Регион с каймой: клетка, у которой видимая клетка не дальше каймы (квадратом). Видимо своё и открытое море
  // (`visibleTo`): чужой край, его прибрежная вода и песчаное море — под листом.
  const F = THEATRE_FRINGE;
  const { x: rx, y: ry, w: rw, h: rh } = reach;
  const own = new Uint8Array(rw * rh);
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) own[j * rw + i] = visibleTo(t, rx + i, ry + j) ? 1 : 0;
  const rows = new Uint8Array(rw * rh);
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      let v = 0;
      for (let d = -F; d <= F && !v; d++) {
        const ii = i + d;
        if (ii >= 0 && ii < rw && own[j * rw + ii]) v = 1;
      }
      rows[j * rw + i] = v;
    }
  }
  const fringe = new Uint8Array(rw * rh);
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      let v = 0;
      for (let d = -F; d <= F && !v; d++) {
        const jj = j + d;
        if (jj >= 0 && jj < rh && rows[jj * rw + i]) v = 1;
      }
      fringe[j * rw + i] = v;
    }
  }
  const anyIn = (x0: number, y0: number, w: number, h: number): boolean => {
    const i0 = Math.max(0, x0 - rx);
    const j0 = Math.max(0, y0 - ry);
    const i1 = Math.min(rw, x0 + w - rx);
    const j1 = Math.min(rh, y0 + h - ry);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (fringe[j * rw + i]) return true;
    return false;
  };
  const landNear = (x0: number, y0: number, w: number, h: number, pad: number): boolean => {
    for (let y = y0 - pad; y < y0 + h + pad; y++) for (let x = x0 - pad; x < x0 + w + pad; x++) if (!water(x, y)) return true;
    return false;
  };

  const chunks: TheatrePlan['chunks'] = [];
  const sheets: TheatrePlan['sheets'] = [];
  const cx0 = Math.floor((rx - WORLD_ORIGIN.x) / CHUNK);
  const cy0 = Math.floor((ry - WORLD_ORIGIN.y) / CHUNK);
  const cx1 = Math.floor((rx + rw - 1 - WORLD_ORIGIN.x) / CHUNK);
  const cy1 = Math.floor((ry + rh - 1 - WORLD_ORIGIN.y) / CHUNK);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      sheets.push({ cx, cy });
      if (anyIn(WORLD_ORIGIN.x + cx * CHUNK, WORLD_ORIGIN.y + cy * CHUNK, CHUNK, CHUNK)) chunks.push({ cx, cy });
    }
  }
  const mids: TheatrePlan['mids'] = [];
  const tx0 = Math.floor((rx - WORLD_ORIGIN.x) / MID_CELLS);
  const ty0 = Math.floor((ry - WORLD_ORIGIN.y) / MID_CELLS);
  const tx1 = Math.floor((rx + rw - 1 - WORLD_ORIGIN.x) / MID_CELLS);
  const ty1 = Math.floor((ry + rh - 1 - WORLD_ORIGIN.y) / MID_CELLS);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const x = WORLD_ORIGIN.x + tx * MID_CELLS;
      const y = WORLD_ORIGIN.y + ty * MID_CELLS;
      if (anyIn(x, y, MID_CELLS, MID_CELLS) && landNear(x, y, MID_CELLS, MID_CELLS, 2)) mids.push({ tx, ty });
    }
  }
  const fringeAt = (x: number, y: number): boolean => {
    const i = x - rx;
    const j = y - ry;
    return i >= 0 && j >= 0 && i < rw && j < rh && fringe[j * rw + i] === 1;
  };
  const plan = { reach, chunks, mids, sheets, fringe: fringeAt };
  plans.set(t.index, plan);
  return plan;
}

/** Память заранее испечённого региона по слоям, байт: обзор, средний слой (если он есть на уровне) и листы. */
export function planBytes(plan: TheatrePlan, mid: boolean): { overview: number; mid: number; sheets: number } {
  return {
    overview: plan.chunks.length * CHUNK_BYTES,
    mid: mid ? plan.mids.length * MID_BYTES : 0,
    sheets: plan.sheets.length * SHEET_BYTES,
  };
}
