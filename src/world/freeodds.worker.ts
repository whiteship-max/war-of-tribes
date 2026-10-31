// Поток окна вольного замка (ПН-Э2б, docs/gdd/path_of_sword.md, 23.9): строки «Что нужно, чтобы взять» — репетициями сервером войны
// (`world/freeodds.freeNeeds`), секундами и вне кадра. Память репетиций живёт в потоке: окно, открытое снова при том же отряде, — сразу.
import { freeNeeds, type FreeNeedIn } from './freeodds';

self.onmessage = (e: MessageEvent<{ n: number; input: FreeNeedIn }>): void => {
  const { n, input } = e.data;
  try {
    self.postMessage({ n, rows: freeNeeds(input) });
  } catch (err) {
    self.postMessage({ n, error: String(err) });
  }
};
