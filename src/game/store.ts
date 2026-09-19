import { create } from 'zustand';
import type { GameState } from './types';
import { createInitialState } from './state';
import { tick } from './sim/tick';
import { resolveEvent } from './sim/actions';
import { mailStep } from './sim/mail';
import { serverNow } from '@/net/clock';
import { clearSave, loadGame, saveGame } from './save';
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
import { provideClaim, rosterBoot } from '@/net/roster';
import { NOTIFY_ON, notifyBoot } from '@/net/notify';
import { claimOf } from '@/net/snapshot';
import { CHEAT_NO, cheatOf } from '@/cheats';
import { applyCheat } from './sim/cheat';

/**
 * Разделы, не привязанные к месту: всё остальное живёт в панелях зданий.
 * `season`, `pop`, `morale`, `order` и `army` — справочные экраны кнопок верхней
 * строки: в нижнюю навигацию они не попадают, открываются только оттуда (и
 * `order` — ещё из строки тревоги, которая про порядок).
 */
export type Tab = 'people' | 'quests' | 'season' | 'pop' | 'morale' | 'order' | 'army';

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
   * Окно осады глазами обороняющегося: кто стоит, чем кончится, чем ответить. Входов
   * два — плашка осады в деревне и меню полководца у своего города на карте, — а окно
   * одно.
   */
  | { kind: 'siege' }
  /**
   * Окно осады глазами осаждающего: наш лагерь под чужим городом. Живёт на карте:
   * открывается по лагерю — из карточки города и меню полководца.
   */
  | { kind: 'camp' }
  /**
   * Вылазка из осаждённой деревни: кого выпускаем за ворота. Открывается из окна
   * осады и живёт в деревне, а не на карте, — из-под осады выходят там, где стоят.
   */
  | { kind: 'sortie' }
  /** Отчёт о бое с журналом по фазам. */
  | { kind: 'report'; id: string };

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
  /**
   * Сохранения на устройстве не было: партия началась только что.
   *
   * Здесь оно затем, что стартовому экрану надо выбрать единственную честную
   * кнопку — «Начать игру» или «Продолжить», — а знает об этом только `loadGame`,
   * и знает ровно один раз, на запуске. Отброшенное старое сохранение (`legacy`)
   * тоже даёт свежую партию: продолжать там нечего.
   */
  fresh: boolean;
  sheet: SheetView | null;
  /**
   * Открыта карта мира. Диорама при этом не просто стоит, а выгружена целиком:
   * держать в памяти обе сцены разом незачем (docs/loading.md, часть 2).
   */
  mapOpen: boolean;
  /** Какая вкладка открыта в ратуше. */
  townTab: TownTab;
  toast: string | null;
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
  /** Карточка клетки карты в нижней шторке. */
  openWorldTile: (x: number, y: number) => void;
  /** Список своих походов и отчётов. */
  openMarches: () => void;
  /** Подготовка похода на выбранную цель. */
  openBattle: (target: string) => void;
  /** Оборона деревни: расстановка, план, резерв, приказы. */
  openDefense: () => void;
  /** Открыть вылазку. Ведёт сюда одна кнопка — из окна осады. */
  openSortie: () => void;
  /** Окно осады своего города. */
  openSiege: () => void;
  /** Окно своего лагеря под чужим городом. */
  openCamp: () => void;
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
  /** Ответ на событие почты. Возвращает исход словами — его показывает само донесение. */
  resolve: (optionIndex: number) => string | null;
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
  /**
   * Набранный код (`src/cheats.ts`). Возвращает строку ответа — её показывает
   * сама панель, а не тост: игрок смотрит в поле, в которое только что печатал.
   *
   * Отдельно от `act`, и не для порядка: `act` — это действие игрока в игре, у
   * него тост на отказ и шаг обучения на успех. Код в игру не входит вовсе.
   */
  cheat: (code: string) => string;
  save: () => void;
  reset: () => void;
}

let loopStarted = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameStore>((set, get) => ({
  s: createInitialState(),
  ready: false,
  offlineSeconds: 0,
  legacyReset: false,
  fresh: true,
  sheet: null,
  mapOpen: false,
  townTab: 'build',
  toast: null,

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
    haptic('light');
    // Мгновенно, и в первый раз тоже: диорама никуда не девалась, а первая
    // выпечка земли укладывается в десятки миллисекунд (`npm run scene:report`).
    // Занавеса с артом на этот случай больше нет: при пороге показа в 240 мс он
    // не показывался практически никогда (docs/loading.md, раздел 3).
    set({ mapOpen: true, sheet: null });
    get().syncTutorial();
  },

  closeMap: () => {
    const cur = get().sheet;
    // Карточки карты живут только вместе с картой.
    const onMap =
      cur &&
      (cur.kind === 'world' || cur.kind === 'marches' || cur.kind === 'battle' || cur.kind === 'report' || cur.kind === 'camp');
    const keep = cur && !onMap ? cur : null;
    // Домой — мгновенно: диорама всё это время стояла на месте.
    set({ mapOpen: false, sheet: keep });
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

  openSiege: () => {
    haptic('light');
    set({ sheet: { kind: 'siege' } });
  },

  openCamp: () => {
    haptic('light');
    set({ sheet: { kind: 'camp' } });
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
    set({ s: state, ready: true, offlineSeconds, legacyReset: legacy, fresh });
    // Старое сохранение к новой партии не подходит: его место сразу занимает новая.
    if (legacy) get().save();
    // Синхронизация начинается после того, как игра уже пошла, и ничего не
    // ждёт: сервер — место складывания прогресса, а не условие запуска. Ей
    // отдают доступ к состоянию, а не наоборот, — иначе импорты замкнулись бы
    // в кольцо.
    provideGame(() => get().s);
    // Присутствие — первым сетевым вызовом, раньше партии и реестра: вернувшийся игрок не
    // должен ни секунды числиться ушедшим (docs/NOTIFY.md, раздел 4). Выключено — ни запроса.
    if (NOTIFY_ON) notifyBoot();
    // `fresh` — сохранения на диске не было. Тогда серверную партию берут без
    // вопроса; была своя — спрашивают, какую оставить.
    void syncBoot(!fresh);
    // Общий реестр замков — второй разговор с сервером и совсем отдельный от
    // первого: там партия, здесь одна строка о том, где стоит замок. Заводится
    // он тут же, потому что «первый вход» — это вход в игру, а не в карту:
    // соседей расселяют относительно тех, кто уже стоит, и игрок, не открывший
    // карту ни разу, всё равно на ней есть.
    provideClaim(() => claimOf(get().s));
    void rosterBoot();
    if (loopStarted) return;
    loopStarted = true;
    setInterval(() => {
      const s = get().s;
      // Донесение, оставленное без ответа, разрешает не игрок: мятеж — шаг
      // симуляции своим сроком, прочие события — почта настоящими часами
      // (`sim/mail`). Исход ложится в летопись, как у письма мира, и партия
      // пишется на диск сразу: исход без игрока не должен теряться с вкладкой.
      const settled = tick(s, TICK_MS / 1000);
      const lapsed = mailStep(s, serverNow());
      advanceTutorial(s, tutorialUi(get()));
      set({ s: { ...s } });
      if (settled || lapsed) get().save();
    }, TICK_MS);
    setInterval(() => get().save(), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') get().save();
    });
    // На выходе пишем через save.ts: ключ и формат сохранения знает только он.
    // Своя копия `setItem` с ключом строкой жила здесь и совпадала с ним по
    // случайности — до первой правки формата.
    window.addEventListener('beforeunload', () => {
      // Вкладка, у которой отняли ведение партии, на выходе не пишет ничего:
      // иначе она затёрла бы ту, которую игрок выбрал (см. net/sync).
      if (mayWrite()) get().save();
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
    set({ s: { ...s } });
    get().save();
    return result;
  },

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
    get().save();
  },

  replayTutorial: () => {
    const s = get().s;
    restartTutorial(s);
    set({ s: { ...s }, sheet: null });
    get().save();
  },

  cheat: (code) => {
    const found = cheatOf(code, 'village');
    if (!found) return CHEAT_NO;
    const s = get().s;
    const said = applyCheat(s, found.id);
    set({ s: { ...s } });
    // На диск сразу: метка партии не должна ждать автосохранения, иначе
    // закрытая через секунду вкладка оставит накрученную партию непомеченной.
    get().save();
    return said;
  },

  save: () => {
    // Ведение партии могла забрать другая вкладка. Тогда эта не пишет вовсе —
    // ни на диск, ни на сервер: молча затирать чужой ход нельзя, а игрок про
    // это уже предупреждён окном.
    if (!mayWrite()) return;
    saveGame(get().s);
  },

  reset: () => {
    clearSave();
    set({ s: createInitialState(), sheet: null, offlineSeconds: 0 });
    get().save();
  },
}));
