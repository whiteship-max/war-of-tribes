// Р-3: подписи построек включены у всех после обновления — и у сохранивших «выкл.» прежним ключом; выключатель помнится
// (docs/ui_v2.md, «Решения Р-3»).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

const fresh = () => import('./labels');

describe('подписи построек (Р-3)', () => {
  it('новый игрок — подписи включены', async () => {
    const { useLabels } = await fresh();
    expect(useLabels.getState().on).toBe(true);
  });

  it('прежний «выкл.» сбрасывается один раз: после обновления подписи включены, старый ключ стёрт', async () => {
    store.set('tribe.labels', '0');
    const { useLabels, OLD_LABELS_KEY } = await fresh();
    expect(useLabels.getState().on, 'включены, хотя прежде выключены').toBe(true);
    expect(store.has(OLD_LABELS_KEY), 'прежний ключ стёрт').toBe(false);
  });

  it('выключатель запоминается: выключил — после перезагрузки выключены, включил — включены', async () => {
    let m = await fresh();
    m.useLabels.getState().toggle();
    expect(m.useLabels.getState().on).toBe(false);
    expect(store.get(m.LABELS_KEY)).toBe('0');
    vi.resetModules();
    m = await fresh();
    expect(m.useLabels.getState().on, 'выключенный помнится, второго сброса нет').toBe(false);
    m.useLabels.getState().toggle();
    vi.resetModules();
    m = await fresh();
    expect(m.useLabels.getState().on).toBe(true);
  });
});
