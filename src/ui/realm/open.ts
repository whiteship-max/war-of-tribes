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
import { useWorld } from '@/world/store';
import { letterKey } from './unread';
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
  /** Открытое донесение в «Решениях» (ключ почты). null — виден список. */
  mail: string | null;
  /** Открыть «Решения» на донесении; null — на списке. */
  openMail: (key: string | null) => void;
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
  mail: null,
  openMail: (key) => {
    useRealm.getState().show('decisions');
    set({ mail: key });
  },
}));

/**
 * Донесение о набеге этого отряда — экран решения о набеге: расстановки обороны больше нет (поставка 2 боя,
 * docs/battle_eu4.md, 14.27), а донесение несёт оба ответа — перехват на карте и сбор дружины в Статуе. Лежит оно в
 * почте ровно пока набег виден (`LocalWorld.syncRaidLetter`); нет его — «Решения» открываются списком.
 */
export function openRaid(marchId: string): void {
  const l = useWorld.getState().letters.find((x) => x.kind === 'raid' && x.marchId === marchId);
  useRealm.getState().openMail(l ? letterKey(l.id) : null);
}

// Лупа письма уводит на карту и, когда с карты уходят, возвращает письмо на
// стол (`world/store.leaveMap` → `openLetter`). Стол писем теперь — почта
// державы, поэтому вернувшееся письмо открывается здесь, в «Решениях», а поле
// мира сразу гасится: второго места, где письмо лежит открытым, нет.
useWorld.subscribe((w, prev) => {
  if (!w.openLetter || w.openLetter === prev.openLetter) return;
  const id = w.openLetter;
  useWorld.getState().showLetter(null);
  useRealm.getState().openMail(letterKey(id));
});
