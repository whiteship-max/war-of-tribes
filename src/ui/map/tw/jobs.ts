// Работы заранее печёмого региона (docs/map_tw.md, раздел 13.4): кусок обзора, тайл среднего слоя, тайл
// ближнего масштаба и лист старой карты. Работа — то, что печётся одним холстом; шаги её — выпечка `bake.ts` и
// `parchment.ts`. Одна и та же работа идёт в рабочем потоке (подряд) и в странице без потока (по кадрам стоя) —
// этот модуль у них общий и потому чистый: ни мира, ни документа.
import type { Rect } from '@/world/types';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { TILE_PX } from '../const';
import { type Steps, chunkSteps, midSteps, tileSteps } from './bake';
import { type Canvas, makeCanvas } from './canvas';
import { type Knowledge, knownAt } from './knowledge';
import { land } from './land';
import { SHEET_PAD, SHEET_PX, parchmentSteps } from './parchment';

export type JobKind = 'chunk' | 'mid' | 'near' | 'sheet';

/**
 * Работа: что печь (`kind`, `x`, `y` — индекс куска или тайла) и под какой вид (`gen` — поколение вида: сменился
 * уровень или сезон — испечённое прежним поколением устарело). `sign` — подпись знания, под которую печётся лист.
 */
export interface Job {
  kind: JobKind;
  x: number;
  y: number;
  gen: number;
  sign?: number;
}

export const jobKey = (j: { kind: JobKind; x: number; y: number }): string => `${j.kind}:${j.x}:${j.y}`;

/** Прямоугольник куска карты мира по индексу — та же сетка, что у кэша мира (`world/cache.chunkRect`). */
export const chunkCells = (cx: number, cy: number): Rect => ({ x: WORLD_ORIGIN.x + cx * CHUNK, y: WORLD_ORIGIN.y + cy * CHUNK, w: CHUNK, h: CHUNK });

/** Область листа куска: кусок с запасом под берег и кромку. Кадр рисует лист без запаса. */
export const sheetArea = (cx: number, cy: number): Rect => {
  const r = chunkCells(cx, cy);
  return { x: r.x - SHEET_PAD, y: r.y - SHEET_PAD, w: r.w + SHEET_PAD * 2, h: r.h + SHEET_PAD * 2 };
};

let knowledge: Knowledge | null = null;

/** Знание под листами: страница пересобирает его, когда открылось новое, и отдаёт и потоку. */
export function setKnowledge(k: Knowledge | null): void {
  knowledge = k;
}

/** Шаги работы; итог — холст или null (земли или знания под работой нет). */
export function* jobSteps(job: Job, seed: number): Steps<Canvas | null> {
  switch (job.kind) {
    case 'chunk':
      return yield* chunkSteps(seed, chunkCells(job.x, job.y));
    case 'mid':
      return yield* midSteps(seed, job.x, job.y);
    case 'near':
      return yield* tileSteps(seed, job.x, job.y, () => makeCanvas(TILE_PX, TILE_PX));
    case 'sheet': {
      if (!knowledge) return null;
      const L = land();
      return yield* parchmentSteps(seed, sheetArea(job.x, job.y), (x, y) => L.sample(x, y), knownAt(knowledge), SHEET_PX);
    }
  }
}
