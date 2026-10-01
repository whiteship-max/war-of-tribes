// Поток генерации слоёв текстур города: кадр не ждёт. Чистый счёт из `tex.ts`, ответ — один
// буфер всех слоёв, переданный без копии.
import { LAYERS, paintLayer } from './tex';

self.onmessage = (e: MessageEvent<{ size: number; seed: number }>): void => {
  const { size, seed } = e.data;
  const one = size * size * 4;
  const out = new Uint8Array(one * LAYERS.length);
  LAYERS.forEach((n, k) => out.set(paintLayer(n, size, seed), k * one));
  self.postMessage({ data: out }, { transfer: [out.buffer] });
};
