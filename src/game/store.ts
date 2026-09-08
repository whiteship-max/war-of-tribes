import { create } from 'zustand';
import type { GameState } from './types';
import { createInitialState } from './state';
import { tick } from './sim/tick';
import { resolveEvent } from './sim/actions';
import { clearSave, loadGame, saveGame, saveLocalNow } from './save';
import {
  advanceTutorial,
  finishTutorial,
  restartTutorial,
  tapTutorial as tapTutorialStep,
  type TutorialUi,
} from './data/tutorial';
import { haptic, tgDisplayName, tgUser } from '@/telegram/webapp';
import { setTelegramIdentity } from '@/profile/stats';
import { bootPaint, bootStage } from '@/boot/stage';
import { mayWrite, provideGame, syncBoot } from '@/net/sync';

/**
 * Разделы, не привязанные к месту: всё остальное живёт в панелях зданий.
 * `season`, `pop`, `morale` и `army` — справочные экраны кнопок верхней строки:
 * в нижнюю навигацию они не попадают, открываются только оттуда.
 */
export type Tab = 'people' | 'quests' | 'season' | 'pop' | 'morale' | 'army' | 'profile';

/**
 * Вкладки ратуши. Живут в сторе, а не в самой панели: на «Управление» ведут
 * ссылки из справки о морали, и вести им некуда, если вкладка — местная память
 * компонента, который ещё не открыт.
 */
export type TownTab = 'build' | 'manage' | 'gems';

/**
 * Что показывает нижняя шторка: раздел, конкретное здание или клетка карты мира.
 * Клетка хранится координатами, а не идентификатором поселения: пустая клетка
 * тоже открывается карточкой, и шторка переживает исчезновение цели.
 */
export type SheetView =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'building'; id: number }
  | { kind: 'world'; x: number; y: number }
  | { kind: 'marches' }
  /** Подготовка похода на цель: состав, расстановка, план, приказы, резерв. */
  | { kind: 'battle'; target: string }
  /** Оборона своей деревни — та же панель без цели и дороги. */
  | { kind: 'defense' }
  /**
   * Вылазка из осаждённой деревни: кого выпускаем за ворота. Открывается только
   * из панели осады и живёт в деревне, а не на карте, — из-под осады выходят
   * там, где стоят.
   */
  | { kind: 'sortie' }
  /** Отчёт о бое с журналом по фазам. */
  | { kind: 'report'; id: string };

const TICK_MS = 500;
const AUTOSAVE_MS = 15000;

/**
 * Занавес перехода — арт поверх всего, пока экран не готов.
 *
 * Висит он ровно в одном месте: **первый вход на карту за сессию**. Там и правда
 * есть чего ждать — печётся земля, туман и владения, и это единственный переход,
 * который заметно дольше остальных. Все прочие мгновенные, и занавес на них был
 * бы не объяснением, а морганием.
 *
 * Возврат домой занавеса не знает вовсе: диорама никуда не девалась.
 */
/**
 * Вид занавеса. Назван по случаю, а не по картинке: раньше он звался `march`
 * по арту «дружина за воротами», арт сменился на костёр, и имя стало врать.
 * Случай же остался один — первый вход на карту.
 */
export type Curtain = 'map';

/**
 * Предел, после которого занавес снимается сам.
 *
 * Не механизм, а страховка. Поднимает занавес тот, кто нарисовал первый кадр
 * новой сцены, — и это правильно: время сборки не константа, а свойство
 * телефона. Но занавес перехватывает нажатия, и если кадр по какой-то причине
 * не придёт, игрок останется заперт под картинкой навсегда. Шесть секунд —
 * заведомо больше самой долгой сборки (медиана возврата домой ≈ 0.33 с,
 * `npm run scene:report`), так что в обычной игре этот таймер не срабатывает
 * никогда, а в необычной рвётся занавес, а не партия.
 */
const CURTAIN_MAX_MS = 6000;

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
  /**
   * Открыта карта мира. Диорама при этом не просто стоит, а выгружена целиком:
   * держать в памяти обе сцены разом незачем (docs/loading.md, часть 2).
   */
  mapOpen: boolean;
  /** Арт перехода поверх всего, пока одна сцена умирает, а другая собирается. */
  curtain: Curtain | null;
  /** Какая вкладка открыта в ратуше. */
  townTab: TownTab;
  toast: string | null;
  eventResult: string | null;
  /** Открывает раздел; повторный вызов того же — закрывает. */
  openTab: (tab: Tab) => void;
  /** Открывает панель здания. null — закрыть (тап по пустому месту). */
  openBuilding: (id: number | null) => void;
  /**
   * Открывает ратушу на нужной вкладке. Отдельно от `openBuilding`, потому что
   * ратуша — единственное здание, к которому ведут не только тап по крыше:
   * через неё идёт вся стройка посёлка.
   */
  openTownHall: (tab?: TownTab) => void;
  /** Переключает вкладку ратуши. */
  setTownTab: (tab: TownTab) => void;
  /** Карта мира вместо сцены. */
  openMap: () => void;
  closeMap: () => void;
  /**
   * Занавес поднят: новая сцена нарисовала первый кадр. Зовут те, кто этот кадр
   * и нарисовал, — `GameCanvas` и `WorldMap`. Своего таймера у занавеса нет
   * нарочно: время сборки сцены не константа, а свойство телефона.
   */
  curtainUp: () => void;
  /** Карточка клетки карты в нижней шторке. */
  openWorldTile: (x: number, y: number) => void;
  /** Список своих походов и отчётов. */
  openMarches: () => void;
  /** Подготовка похода на выбранную цель. */
  openBattle: (target: string) => void;
  /** Оборона деревни: расстановка, план, резерв, приказы. */
  openDefense: () => void;
  /** Открыть вылазку. Ведёт сюда одна кнопка — из панели осады. */
  openSortie: () => void;
  /** Отчёт о бое. */
  openReport: (id: string) => void;
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
/** Номер перехода: страховка снимает только свой занавес, а не следующий. */
let curtainNo = 0;
/** Карту в этой сессии уже открывали: второй раз печь землю не надо, и ждать нечего. */
let mapSeen = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameStore>((set, get) => ({
  s: createInitialState(),
  ready: false,
  offlineSeconds: 0,
  legacyReset: false,
  sheet: null,
  mapOpen: false,
  curtain: null,
  townTab: 'build',
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

  openTownHall: (tab = 'build') => {
    const hall = get().s.buildings.find((b) => b.type === 'town_hall');
    if (!hall) return;
    haptic('light');
    const cur = get().sheet;
    const open = cur?.kind === 'building' && cur.id === hall.id && get().townTab === tab;
    set({ townTab: tab, sheet: open ? null : { kind: 'building', id: hall.id } });
    get().syncTutorial();
  },

  setTownTab: (tab) => set({ townTab: tab }),

  openMap: () => {
    if (get().curtain) return;
    haptic('light');
    if (mapSeen) {
      // Второй и всякий следующий раз — мгновенно: земля уже испечена, диорама
      // никуда не девалась, ждать нечего.
      set({ mapOpen: true, sheet: null });
      get().syncTutorial();
      return;
    }
    mapSeen = true;
    // Занавес заводится сразу, а показывается — только если переход затянулся
    // (порог держит сам `SceneCurtain`). Раньше срока он не «спрятан на всякий
    // случай»: пока он в разметке, браузер тянет арт, и к моменту показа тот уже
    // на месте. Иначе на медленном телефоне — а это и есть единственный случай,
    // когда занавес вообще нужен, — игрок увидел бы подпись на пустом чёрном.
    const no = ++curtainNo;
    setTimeout(() => {
      if (curtainNo === no) get().curtainUp();
    }, CURTAIN_MAX_MS);
    set({ mapOpen: true, sheet: null, curtain: 'map' });
    get().syncTutorial();
  },

  closeMap: () => {
    const cur = get().sheet;
    // Карточки карты живут только вместе с картой.
    const onMap = cur && (cur.kind === 'world' || cur.kind === 'marches' || cur.kind === 'battle' || cur.kind === 'report');
    const keep = cur && !onMap ? cur : null;
    // Домой — мгновенно и без занавеса: диорама всё это время стояла на месте.
    set({ mapOpen: false, sheet: keep, curtain: null });
    curtainNo++;
  },

  curtainUp: () => {
    if (!get().curtain) return;
    // Страховке больше нечего снимать: следующий переход заведёт свой номер.
    curtainNo++;
    set({ curtain: null });
  },

  openWorldTile: (x, y) => {
    haptic('light');
    set({ sheet: { kind: 'world', x, y } });
    get().syncTutorial();
  },

  openMarches: () => set({ sheet: { kind: 'marches' } }),

  openBattle: (target) => {
    haptic('light');
    set({ sheet: { kind: 'battle', target } });
  },

  openDefense: () => {
    haptic('light');
    set({ sheet: { kind: 'defense' } });
  },

  openSortie: () => {
    haptic('light');
    set({ sheet: { kind: 'sortie' } });
  },

  openReport: (id) => set({ sheet: { kind: 'report', id } }),

  closeSheet: () => set({ sheet: null }),

  init: async () => {
    bootStage('save');
    const { state, offlineSeconds, legacy, fresh } = await loadGame({
      // Подсчёт офлайна — не техническая пауза, а «пока тебя не было»: игрок
      // должен видеть, за что он ждёт. Кадр перед счётом обязателен — счёт
      // синхронный и до конца работы браузеру рисовать будет нечем.
      onOffline: async () => {
        bootStage('offline');
        await bootPaint();
      },
    });
    // Имя и лицо из Telegram кладёт сюда оболочка: симуляция про Telegram не
    // знает, а визитке нужны готовые значения. Свой выбор игрока это не трогает —
    // он лежит рядом и приоритетнее (см. profile/identity).
    setTelegramIdentity(state, tgDisplayName(), tgUser()?.photo_url ?? null);
    set({ s: state, ready: true, offlineSeconds, legacyReset: legacy });
    // Старое сохранение к новой партии не подходит: его место сразу занимает новая.
    if (legacy) void get().save();
    // Синхронизация начинается после того, как игра уже пошла, и ничего не
    // ждёт: сервер — место складывания прогресса, а не условие запуска. Ей
    // отдают доступ к состоянию, а не наоборот, — иначе импорты замкнулись бы
    // в кольцо.
    provideGame(() => get().s);
    // `fresh` — сохранения на диске не было. Тогда серверную партию берут без
    // вопроса; была своя — спрашивают, какую оставить.
    void syncBoot(!fresh);
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
    // На выходе пишем синхронно и через save.ts: ключ и формат сохранения знает
    // только он. Своя копия `setItem` с ключом строкой жила здесь и совпадала с
    // ним по случайности — до первой правки формата.
    window.addEventListener('beforeunload', () => {
      // Вкладка, у которой отняли ведение партии, на выходе не пишет ничего:
      // иначе она затёрла бы ту, которую игрок выбрал (см. net/sync).
      if (mayWrite()) saveLocalNow(get().s);
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
    // Ведение партии могла забрать другая вкладка. Тогда эта не пишет вовсе —
    // ни на диск, ни на сервер: молча затирать чужой ход нельзя, а игрок про
    // это уже предупреждён окном.
    if (!mayWrite()) return;
    await saveGame(get().s);
  },

  reset: () => {
    // Новая партия — новый мир: первый вход на карту снова стоит времени, и
    // занавес снова уместен.
    mapSeen = false;
    clearSave();
    set({ s: createInitialState(), sheet: null, eventResult: null, offlineSeconds: 0 });
    void get().save();
  },
}));
