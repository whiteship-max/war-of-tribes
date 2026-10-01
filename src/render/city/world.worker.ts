// Поток сборки мира города (`world.ts`): кадр игры не ждёт ни плана, ни карты покрытий. Ответ —
// готовые массивы, переданные без копии.
import { buildWorld, transferables } from './world';
import type { Quality } from '../quality';

self.onmessage = (e: MessageEvent<{ quality: Quality }>): void => {
  const w = buildWorld(e.data.quality);
  self.postMessage(w, { transfer: transferables(w) });
};
