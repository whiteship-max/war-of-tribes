// Открыто ли меню державы и на каком разделе.
//
// Своё маленькое хранилище, а не поле общего стора игры: меню — вид, а не
// партия, в сохранение оно не едет и симуляции знать о нём незачем. Общий стор
// лежит в ядре (`game/store.ts`), и заводить там поле ради того, какая вкладка
// открыта, значило бы делать переезд интерфейса правкой ядра.
//
// Раздел помнится и после закрытия: вернувшийся в меню попадает туда, где был.
import { create } from 'zustand';
import { useGame } from '@/game/store';
import type { RealmTab } from './tabs';

/** Раздел меню или страница настроек (шестерёнка в шапке меню). */
export type RealmView = RealmTab | 'settings';

interface RealmStore {
  open: boolean;
  view: RealmView;
  /** Открыть меню; без довода — на том разделе, где его закрыли. */
  show: (view?: RealmView) => void;
  hide: () => void;
  go: (view: RealmView) => void;
}

export const useRealm = create<RealmStore>((set) => ({
  open: false,
  view: 'government',
  // Меню встаёт вместо шторки, а не поверх неё: открытая под ним панель здания
  // осталась бы висеть невидимой и всплыла бы при закрытии меню.
  show: (view) => {
    useGame.getState().closeSheet();
    set((r) => ({ open: true, view: view ?? r.view }));
  },
  hide: () => set({ open: false }),
  go: (view) => set({ view }),
}));
