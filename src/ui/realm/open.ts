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
import { currentStep } from '@/game/data/tutorial';
import type { GameState } from '@/game/types';
import { letterKey } from './unread';
import type { RealmTab } from './tabs';
import type { MailFilter } from './dispatch';
import type { ChronTopic } from './annals';

/**
 * Раздел меню или страница настроек (шестерёнка в шапке меню). `quests` — задания: в новом интерфейсе они
 * раздел державы, а не место нижней навигации (docs/ui_audit.md, 6.1).
 */
export type RealmView = RealmTab | 'settings' | 'quests';

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
  /** Вкладка «Вестей»: фильтр почты или летопись (ВС-2). Помнится, как раздел меню. */
  mailTab: MailTab;
  setMailTab: (tab: MailTab) => void;
  /** Донесение мира, открытое из летописи «Вестей» (`Report.id`). null — летопись. */
  report: string | null;
  /** Открыть «Вести» на летописи; с ключом — на донесении события (ВС-2); с родом — летопись этого рода (Г-10). */
  openChronicle: (report?: string | null, topic?: ChronTopic | null) => void;
  /** Род, на котором летопись открыли снаружи (доклад советника, Г-10). null — как оставили. */
  chronTopic: ChronTopic | null;
}

/** Вкладки «Вестей»: почта по источнику и летопись (ВС-2, docs/ui_v2.md, 5.8). */
export type MailTab = MailFilter | 'chron';

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
    // Весть — вкладкой почты: «Отложить» возвращает к списку вестей, а не в летопись, где игрока оставили (ВС-2).
    set((r) => ({ mail: key, report: null, mailTab: r.mailTab === 'chron' ? 'all' : r.mailTab }));
  },
  mailTab: 'all',
  setMailTab: (mailTab) => set({ mailTab, mail: null, report: null }),
  report: null,
  chronTopic: null,
  openChronicle: (report = null, topic = null) => {
    useRealm.getState().show('decisions');
    set({ mail: null, mailTab: 'chron', report, chronTopic: topic });
  },
}));

/**
 * Куда открыть державу касанием герба. Шаг обучения «Изучи копьё» ведёт к гербу подсветкой, и держава встаёт сразу
 * на технологиях: путь словами («герб → «Технологии» → военная ветвь») шагу больше не нужен (docs/ui_audit.md, 4.3, 11).
 * В новом виде «Вести» — свой экран из низа, и герб из них ведёт в разделы державы, а не обратно в вести. Иначе —
 * раздел, где меню закрыли (`undefined`).
 */
export function coatView(s: GameState, quiet: boolean, last: RealmView): RealmView | undefined {
  if (currentStep(s)?.id === 'tech') return 'tech';
  return quiet && last === 'decisions' ? 'government' : undefined;
}

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
