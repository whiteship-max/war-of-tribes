// Поток сборки города в ролике (`town.ts`, docs/polish.md, П-6): кадр ролика не ждёт ни домов, ни леса. Ответ — готовые
// массивы, переданные без копии.
import { townTransferables, townWorld, type TownInput } from './town';

self.onmessage = (e: MessageEvent<TownInput>): void => {
  const w = townWorld(e.data);
  self.postMessage(w, { transfer: townTransferables(w) });
};
