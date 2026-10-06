// Подмена `sound/web.ts` для офлайн-отрисовки: звуки боя берут выход у стенда, а не у движка игры (контекста там нет).
export function openBus(volume: number): GainNode | null {
  const into = (globalThis as unknown as { __fxBus?: AudioNode }).__fxBus;
  if (!into) return null;
  const g = into.context.createGain();
  g.gain.value = volume;
  g.connect(into);
  return g;
}
