import { create } from 'zustand';
import type { GameState } from './types';
import { createInitialState } from './state';
import { tick } from './sim/tick';
import { resolveEvent } from './sim/actions';
import { clearSave, loadGame, saveGame } from './save';
import {
  advanceTutorial,
  finishTutorial,
  restartTutorial,
  tapTutorial as tapTutorialStep,
  type TutorialUi,
} from './data/tutorial';
import { haptic } from '@/telegram/webapp';

/** Разделы, не привязанные к месту: всё остальное живёт в панелях зданий. */
export type Tab = 'people' | 'build' | 'quests' | 'season';

/**
 * Что показывает нижняя шторка: раздел, конкретное здание или клетка карты мира.
 * Клетка хранится координатами, а не идентификатором поселения: пустая клетка
 * тоже открывается карточкой, и шторка переживает исчезновение цели.
 */
export type SheetView =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'building'; id: number }
  | { kind: 'world'; x: number; y: number }
  | { kind: 'marches' };

const TICK_MS = 500;
const AUTOSAVE_MS = 15000;

/** Что открыто — обучение засчитывает шаги и по интерфейсу, не только по состоянию. */
const tutorialUi = (g: GameStore): TutorialUi => ({
  building: g.sheet?.kind === 'building' ? g.sheet.id : null,
  tab: g.sheet?.kind === 'tab' ? g.sheet.tab : null,
  mapOpen: g.mapOpen,
  worldTile: g.sheet?.kind === 'world',
});

export interface GameStore {
  s: GameState;
  ready: boolean;
  offlineSeconds: number;
  /** Найденное сохранение было старого формата и отброшено — игроку об этом говорят прямо. */
  legacyReset: boolean;
  sheet: SheetView | null;
  /** Открыта карта мира. Пока она открыта, 3D-сцена не рисуется (но и не выгружается). */
  mapOpen: boolean;
  toast: string | null;
  eventResult: string | null;
  /** Открывает раздел; повторный вызов того же — закрывает. */
  openTab: (tab: Tab) => void;
  /** Открывает панель здания. null — закрыть (тап по пустому месту). */
  openBuilding: (id: number | null) => void;
  /** Карта мира вместо сцены. */
  openMap: () => void;
  closeMap: () => void;
  /** Карточка клетки карты в нижней шторке. */
  openWorldTile: (x: number, y: number) => void;
  /** Список своих походов и отчётов. */
  openMarches: () => void;
  closeSheet: () => void;
  init: () => Promise<void>;
  /** Выполняет действие игрока; ошибку показывает тостом. */
  act: (fn: (s: GameState) => string | null) => boolean;
  /**
   * Правка состояния со стороны мира: последствия походов и учёт ушедших.
   * Отдельно от act — это не действие игрока, здесь нет ни тоста, ни отклика.
   */
  world: (fn: (s: GameState) => void) => void;
  resolve: (optionIndex: number) => void;
  dismissResult: () => void;
  dismissOffline: () => void;
  dismissLegacy: () => void;
  dismissWinterWarning: () => void;
  showToast: (text: string) => void;
  /** Досчитывает шаги обучения по факту: после действия игрока и на каждом тике. */
  syncTutorial: () => void;
  /** Тап по строке шага, который ничего не требует. */
  tapTutorial: () => void;
  skipTutorial: () => void;
  /** Отладка: пройти обучение заново. */
  replayTutorial: () => void;
  save: () => Promise<void>;
  reset: () => void;
}

let loopStarted = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameStore>((set, get) => ({
  s: createInitialState(),
  ready: false,
  offlineSeconds: 0,
  legacyReset: false,
  sheet: null,
  mapOpen: false,
  toast: null,
  eventResult: null,

  openTab: (tab) => {
    const cur = get().sheet;
    set({ sheet: cur && cur.kind === 'tab' && cur.tab === tab ? null : { kind: 'tab', tab } });
    get().syncTutorial();
  },

  openBuilding: (id) => {
    if (id === null) {
      const cur = get().sheet;
      if (cur?.kind === 'building') set({ sheet: null });
      return;
    }
    haptic('light');
    set({ sheet: { kind: 'building', id } });
    get().syncTutorial();
  },

  openMap: () => {
    haptic('light');
    set({ mapOpen: true, sheet: null });
    get().syncTutorial();
  },

  closeMap: () => {
    const cur = get().sheet;
    // Карточки карты живут только вместе с картой.
    const keep = cur && cur.kind !== 'world' && cur.kind !== 'marches' ? cur : null;
    set({ mapOpen: false, sheet: keep });
  },

  openWorldTile: (x, y) => {
    haptic('light');
    set({ sheet: { kind: 'world', x, y } });
    get().syncTutorial();
  },

  openMarches: () => set({ sheet: { kind: 'marches' } }),

  closeSheet: () => set({ sheet: null }),

  init: async () => {
    const { state, offlineSeconds, legacy } = await loadGame();
    set({ s: state, ready: true, offlineSeconds, legacyReset: legacy });
    // Старое сохранение к новой партии не подходит: его место сразу занимает новая.
    if (legacy) void get().save();
    if (loopStarted) return;
    loopStarted = true;
    setInterval(() => {
      const s = get().s;
      tick(s, TICK_MS / 1000);
      advanceTutorial(s, tutorialUi(get()));
      set({ s: { ...s } });
    }, TICK_MS);
    setInterval(() => void get().save(), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void get().save();
    });
    window.addEventListener('beforeunload', () => {
      try {
        localStorage.setItem('tribe.save.v1', JSON.stringify({ ...get().s, lastSaved: Date.now() }));
      } catch {
        /* ignore */
      }
    });
  },

  act: (fn) => {
    const s = get().s;
    const err = fn(s);
    if (err) {
      get().showToast(err);
      haptic('error');
      return false;
    }
    haptic('light');
    advanceTutorial(s, tutorialUi(get()));
    set({ s: { ...s } });
    return true;
  },

  world: (fn) => {
    const s = get().s;
    fn(s);
    set({ s: { ...s } });
  },

  resolve: (optionIndex) => {
    const s = get().s;
    const { error, result } = resolveEvent(s, optionIndex);
    if (error) get().showToast(error);
    haptic('medium');
    set({ s: { ...s }, eventResult: result });
    void get().save();
  },

  dismissResult: () => set({ eventResult: null }),
  dismissOffline: () => set({ offlineSeconds: 0 }),
  dismissLegacy: () => set({ legacyReset: false }),

  dismissWinterWarning: () => {
    const s = get().s;
    s.winterWarning = false;
    set({ s: { ...s } });
  },

  showToast: (text) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: text });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },

  syncTutorial: () => {
    const s = get().s;
    if (advanceTutorial(s, tutorialUi(get()))) set({ s: { ...s } });
  },

  tapTutorial: () => {
    const s = get().s;
    if (!tapTutorialStep(s, tutorialUi(get()))) return;
    haptic('light');
    set({ s: { ...s } });
  },

  skipTutorial: () => {
    const s = get().s;
    finishTutorial(s);
    set({ s: { ...s } });
    void get().save();
  },

  replayTutorial: () => {
    const s = get().s;
    restartTutorial(s);
    set({ s: { ...s }, sheet: null });
    void get().save();
  },

  save: async () => {
    await saveGame(get().s);
  },

  reset: () => {
    clearSave();
    set({ s: createInitialState(), sheet: null, eventResult: null, offlineSeconds: 0 });
    void get().save();
  },
}));
