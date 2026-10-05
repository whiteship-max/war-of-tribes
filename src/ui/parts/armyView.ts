// Что открыто в «Дружине»: список или окно раскладки (docs/retinue.md). Отдельно от шторки: в окно ведут и
// Статуя, и карточка своего замка (`MusterLink`), а шторка знает только вкладку.
import { create } from 'zustand';

export const useArmyView = create<{ muster: boolean; show: (muster: boolean) => void }>((set) => ({
  muster: false,
  show: (muster) => set({ muster }),
}));
