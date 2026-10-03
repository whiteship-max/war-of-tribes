// Рабочий поток выпечки региона (docs/map_tw.md, раздел 13.4). Страница отдаёт ему снимок земли региона, знание
// под листами и вид выпечки, потом — работы по одной; он печёт каждую подряд в `OffscreenCanvas` и возвращает
// картинку без копии (`transferToImageBitmap`). Кадр страницы не ждёт ничего: в нём только копирование.
//
// Первым словом поток говорит, умеет ли он рисовать: без `OffscreenCanvas` (Safari до 16.4) страница печёт сама —
// теми же шагами, по кадрам и только стоя (`prebake.ts`, запасной путь).
import { type TwLook, drain, setTwLook } from './bake';
import { type FeatureBits, type LandGrid, gridLand } from './landgrid';
import { setLand } from './land';
import { type Job, jobSteps, setKnowledge } from './jobs';
import type { Knowledge } from './knowledge';

export type ToWorker =
  | { type: 'land'; seed: number; grid: LandGrid; bits: FeatureBits; look: TwLook }
  | { type: 'look'; look: TwLook }
  | { type: 'knowledge'; k: Knowledge }
  | { type: 'job'; job: Job };

export type FromWorker =
  | { type: 'ready'; canvas: boolean }
  | { type: 'done'; job: Job; pic: ImageBitmap | null; ms: number }
  | { type: 'fail'; job: Job; error: string };

function post(m: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(m, { transfer });
}

const canvas = ((): boolean => {
  try {
    return typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
})();

let seed = 0;

self.onmessage = (e: MessageEvent<ToWorker>): void => {
  const m = e.data;
  switch (m.type) {
    case 'land':
      seed = m.seed;
      setLand(gridLand(m.grid, m.bits));
      setTwLook(m.look);
      return;
    case 'look':
      setTwLook(m.look);
      return;
    case 'knowledge':
      setKnowledge(m.k);
      return;
    case 'job': {
      const t0 = performance.now();
      try {
        const out = drain(jobSteps(m.job, seed));
        const pic = out ? (out as OffscreenCanvas).transferToImageBitmap() : null;
        post({ type: 'done', job: m.job, pic, ms: performance.now() - t0 }, pic ? [pic] : []);
      } catch (err) {
        post({ type: 'fail', job: m.job, error: String(err) });
      }
    }
  }
};

post({ type: 'ready', canvas });
