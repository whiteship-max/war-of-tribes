import { create } from 'zustand';
import type { GameState } from './types';
import type { MachineId } from '@/world/data/machines';
import { createInitialState } from './state';
import { liveStep } from './sim/tick';
import { resolveEvent } from './sim/actions';
import { mailStep } from './sim/mail';
import { deviceNow, enterLead, partyNow } from '@/net/clock';
import { lead, livedSeconds } from './pace';
import { clearSave, loadGame, saveGame } from './save';
import {
  advanceTutorial,
  finishTutorial,
  restartTutorial,
  tapTutorial as tapTutorialStep,
  type TutorialUi,
} from './data/tutorial';
import { haptic, tgDisplayName, tgInitData, tgUser } from '@/telegram/webapp';
import { setTelegramIdentity } from '@/profile/stats';
import { bootPaint, bootStage } from '@/boot/stage';
import { mayWrite, provideGame, resetCarry, syncBoot } from '@/net/sync';
import { provideGrants } from '@/net/admin';
import { applyGrants } from './sim/admin';
import { provideGemDeeds, provideGemSeen, provideGemSettled } from '@/net/gems';
import { applyGemDeeds, gemSeen, settleUnneeded } from './sim/gems';
import { provideBand, provideBandSink, provideClaim, rosterBoot, rosterReseat } from '@/net/roster';
import { knownEra } from '@/net/era';
import { NOTIFY_ON, notifyBoot } from '@/net/notify';
import { bandSeatOf, claimOf } from '@/net/snapshot';
import { CHEATS_ON, CHEAT_NO, cheatOf } from '@/cheats';
import { applyCheat } from './sim/cheat';
import { roamOn } from './roamflag';
import { beginRoam, setMove } from './sim/roam';
import { warriorStart } from './roamorigin';
import { profileName } from '@/profile/identity';
import { readMove } from '@/world/roammove';

/**
 * Разделы, не привязанные к месту: всё остальное живёт в панелях зданий.
 * `season`, `pop`, `morale`, `order` и `army` — справочные экраны кнопок верхней
 * строки: в нижнюю навигацию они не попадают, открываются только оттуда (и
 * `order` — ещё из строки тревоги, которая про порядок). `buildings` — «Здания» низа (РТ-1): сетка всех построек,
 * улучшения и очередь стройки, прежде жившие в ратуше.
 */
export type Tab = 'people' | 'quests' | 'season' | 'pop' | 'morale' | 'order' | 'army' | 'buildings';

/**
 * Разделы ратуши (РТ-1): «Советники», «Агенты» (АГ-1) и «Сословия» (РТ-2). Живут в сторе, а не в самой панели: на раздел ведут
 * двери других окон (весть о пустом месте совета, покои), и вести им некуда, если раздел — местная память компонента, который
 * ещё не открыт. Стройка ушла из ратуши в «Здания» низа (`Tab` `buildings`); «Управление» ушло в державу ещё в UI-7.
 */
export type TownTab = 'council' | 'agents' | 'estates';

/**
 * Что показывает нижняя шторка: раздел, конкретное здание или клетка карты мира.
 * Клетка хранится координатами, а не идентификатором поселения: пустая клетка
 * тоже открывается карточкой, и шторка переживает исчезновение цели.
 */
export type SheetView =
  | { kind: 'tab'; tab: Tab }
  /** `touched` — карточку открыло касание здания в сцене города, а не дверь из окна: только тогда здание подаёт голос (ЗВ-1). */
  | { kind: 'building'; id: number; touched?: true }
  | { kind: 'world'; x: number; y: number }
  | { kind: 'marches' }
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
  | { kind: 'sortie'; machine?: MachineId; ring?: true }
  /** Отчёт о бое с журналом по фазам. */
  | { kind: 'report'; id: string };

/** Шаг цикла живой игры, настоящих мс. Из него выведена верхняя ступень скорости проверки (`pace.SPEEDS`). */
export const TICK_MS = 500;
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
  /** Какой раздел открыт в ратуше. */
  townTab: TownTab;
  toast: string | null;
  /** Открывает раздел; повторный вызов того же — закрывает. */
  openTab: (tab: Tab) => void;
  /**
   * Открывает панель здания. null — закрыть (тап по пустому месту). `via: 'scene'` — открыло касание здания в сцене города
   * (`GameCanvas`); двери из окон («Казармы» в «Дружине») зовут без него.
   */
  openBuilding: (id: number | null, via?: 'scene') => void;
  /**
   * Открывает ратушу на нужном разделе. Отдельно от `openBuilding`: к совету ведут и двери других окон (весть о пустом
   * месте), и им нужен раздел, а не только постройка. Повторный вызов на открытом том же разделе — закрывает.
   */
  openTownHall: (tab?: TownTab) => void;
  /** Переключает раздел ратуши. */
  setTownTab: (tab: TownTab) => void;
  /** Карта мира вместо сцены. */
  openMap: () => void;
  closeMap: () => void;
  /** Карточка клетки карты в нижней шторке. */
  openWorldTile: (x: number, y: number) => void;
  /** Список своих походов и отчётов. */
  openMarches: () => void;
  /** Открыть вылазку. Ведёт сюда одна кнопка — из окна осады. */
  /** Вылазка: на лагерь, на его машину (docs/siege_v2.md, раздел 5) или — `ring` — на пост кольца блокады (Р-5). */
  openSortie: (target?: MachineId | 'ring') => void;
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
  resolve: (optionIndex: number, id: string) => string | null;
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
  /**
   * Путь меча со стартового экрана (30.10.2026, только тем, кому путь открыт — `roamflag.roamOn`): новая партия бродягой — Воином
   * (`roamorigin`), место выхода назначает сервер (`net/roster.rosterReseat`). Зовётся только у партии без сохранения на устройстве
   * (`fresh`): прежней партии у игрока нет, отнимать нечего. Отказ — словами, вошёл — `null`.
   */
  beginRoamParty: () => string | null;
}

/**
 * Новая партия на месте прежней: эпоха устройства, без опережения часов, а номера дел алмазов и указов — от прежней (они за игроком,
 * а не за партией: сервер отдаёт их все, и новая партия с отметками с нуля положила бы покупки лавки и указы второй раз — docs/bughunt.md,
 * «Начать заново»). Одна на «Начать заново» и на вход в путь.
 */
function freshParty(was: Pick<GameState, 'gemSeen' | 'gemUnneeded' | 'adminSeen'>): GameState {
  // Новая партия начинается с правды: без опережения и на ×1 — раньше, чем её часы впервые прочтут.
  if (CHEATS_ON) enterLead(0);
  const s = createInitialState();
  s.era = knownEra();
  if (was.gemSeen !== undefined) s.gemSeen = was.gemSeen;
  if (was.gemUnneeded !== undefined) s.gemUnneeded = was.gemUnneeded;
  if (was.adminSeen !== undefined) s.adminSeen = was.adminSeen;
  return s;
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
  townTab: 'council',
  toast: null,

  openTab: (tab) => {
    const cur = get().sheet;
    set({ sheet: cur && cur.kind === 'tab' && cur.tab === tab ? null : { kind: 'tab', tab } });
    get().syncTutorial();
  },

  openBuilding: (id, via) => {
    if (id === null) {
      const cur = get().sheet;
      if (cur?.kind === 'building') set({ sheet: null });
      return;
    }
    haptic('light');
    set({ sheet: { kind: 'building', id, ...(via === 'scene' ? { touched: true as const } : {}) } });
    get().syncTutorial();
  },

  openTownHall: (tab = 'council') => {
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
      (cur.kind === 'world' || cur.kind === 'marches' || cur.kind === 'report' || cur.kind === 'camp');
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

  openSortie: (target) => {
    haptic('light');
    set({ sheet: target === 'ring' ? { kind: 'sortie', ring: true } : target ? { kind: 'sortie', machine: target } : { kind: 'sortie' } });
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
    const era = knownEra();
    const { state, offlineSeconds, legacy, fresh } = await loadGame({
      // Партия прошлой эпохи мира не загружается (docs/test_world.md): новая начинается в эпохе устройства.
      era,
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
    if (fresh) {
      state.era = era;
      // Партию обнулил админ (`net/sync.takeReset`): номера дел алмазов и указов новая партия берёт у обнулённой.
      Object.assign(state, resetCarry());
    }
    setTelegramIdentity(state, tgDisplayName(), tgUser()?.photo_url ?? null);
    set({ s: state, ready: true, offlineSeconds, legacyReset: legacy, fresh });
    // Старое сохранение к новой партии не подходит: его место сразу занимает новая.
    if (legacy) get().save();
    // Синхронизация начинается после того, как игра уже пошла, и ничего не
    // ждёт: сервер — место складывания прогресса, а не условие запуска. Ей
    // отдают доступ к состоянию, а не наоборот, — иначе импорты замкнулись бы
    // в кольцо.
    provideGame(() => get().s);
    // Указы админа приезжают с ответом сохранения и ложатся одной дверью, ровно один раз (docs/admin.md).
    provideGrants((grants) => {
      const st = get().s;
      if (applyGrants(st, grants) === 0) return;
      set({ s: { ...st } });
      get().save();
    });
    // Дела алмазов (лавка, ускорение) приезжают с ответом приказа и записи и ложатся одной дверью, ровно один раз
    // (docs/gems.md). На диск сразу: номер применённого не должен ждать автосохранения.
    provideGemDeeds((deeds) => {
      const st = get().s;
      if (applyGemDeeds(st, deeds) === 0) return;
      set({ s: { ...st } });
      get().save();
    });
    // Номер применённого — серверу с чтением и приказом: дела приедут самые старые первыми, порциями (FIN-4).
    provideGemSeen(() => gemSeen(get().s));
    // Ускорения «не понадобилось», рассуждённые сервером (FIN-5), — снять из списка партии.
    provideGemSettled((settled) => {
      const st = get().s;
      if (settleUnneeded(st, settled) === 0) return;
      set({ s: { ...st } });
      get().save();
    });
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
    // Бродяга (ПН-3) встаёт в реестр строкой отряда, а строку, которую вывел сервер, партия кладёт одной дверью хода. Двери отдаются
    // всегда: слово сервера об админе (`roamOn`) может прийти после запуска, а спрашивают выключатель они сами (`bandSeatOf`,
    // `roster.keep`).
    provideBand(() => bandSeatOf(get().s));
    provideBandSink((row) => {
      const st = get().s;
      const m = readMove(row);
      if (!m) return;
      setMove(st, m);
      set({ s: { ...st } });
    });
    void rosterBoot();
    if (loopStarted) return;
    loopStarted = true;
    // Прошедшее время меряется часами устройства без серверной поправки: поправка приезжает с
    // ответом сервера и сдвигает «сейчас» скачком, а скачок не должен стать ни догоном, ни простоем.
    let lastStep = deviceNow();
    let lastLead = CHEATS_ON ? lead(lastStep) : 0;
    setInterval(() => {
      const s = get().s;
      const at = deviceNow();
      const real = Math.max(0, (at - lastStep) / 1000);
      lastStep = at;
      // Порог отлучки меряется настоящим временем устройства, а шаг племени получает, сколько
      // прожила партия: под скоростью проверки — больше ровно на то, на сколько за шаг ушли вперёд
      // её часы (`game/pace`, «Скорость проверки»). Те же часы читает мир — одна дверь на обоих.
      let lived = real;
      if (CHEATS_ON) {
        const ahead = lead(at);
        lived = livedSeconds(real, lastLead, ahead);
        lastLead = ahead;
      }
      // Донесение, оставленное без ответа, разрешает не игрок, а почта настоящими
      // часами (`sim/mail`) — и мятеж тоже: срок у него тот же. Исход ложится в
      // летопись, как у письма мира, и партия пишется на диск сразу: исход без
      // игрока не должен теряться с вкладкой.
      liveStep(s, real, partyNow(), lived);
      const lapsed = mailStep(s, partyNow());
      advanceTutorial(s, tutorialUi(get()));
      set({ s: { ...s } });
      if (lapsed) get().save();
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

  resolve: (optionIndex, id) => {
    const s = get().s;
    const { error, result } = resolveEvent(s, optionIndex, id);
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
    // В Telegram — подпись есть, прогресс уходит на сервер — кодов `offTelegram` нет (`src/cheats.ts`).
    const found = cheatOf(code, 'village', tgInitData() !== null);
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
    const was = get().s;
    clearSave();
    set({ s: freshParty(was), sheet: null, offlineSeconds: 0 });
    get().save();
  },

  beginRoamParty: () => {
    if (!roamOn()) return 'Путь меча ещё не открыт.';
    if (!get().fresh) return 'Путь меча начинают с новой партии.';
    const was = get().s;
    const s = freshParty(was);
    // Имя и лицо из Telegram — те же, что у прежней партии; герой носит имя игрока.
    s.profile = { ...s.profile, ...was.profile };
    const why = beginRoam(s, warriorStart(s, profileName(s.profile)));
    if (why) return why;
    set({ s, sheet: null, offlineSeconds: 0 });
    get().save();
    rosterReseat();
    return null;
  },
}));
