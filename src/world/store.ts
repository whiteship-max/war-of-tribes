// Состояние экрана карты. Здесь и только здесь мир соединяется с интерфейсом:
// компоненты читают этот стор, а он ходит в worldApi(). Ни один экран не знает,
// что за интерфейсом сейчас стоит LocalWorld.
import { create } from 'zustand';
import { serverNow } from '@/net/clock';
import { castleCell, castles, rosterReady, startPulling, stopPulling } from '@/net/roster';
import { NOTIFY_ON, notifyDrafts } from '@/net/notify';
import { log } from '@/game/sim/log';
import { useGame } from '@/game/store';
import { haptic } from '@/telegram/webapp';
import { probe, revealWorld, takeBakes, takeCosts, takeGaps } from '@/debug';
import { hasWorldApi, setWorldApi, worldApi } from './api';
import { LocalWorld, type LocalWorldOptions } from './local/LocalWorld';
import { NotifyingWorld } from './local/NotifyingWorld';
import { applyEffects, playerProfile, syncAway, syncSiege } from './bridge';
import { awayOf } from './muster';
import { syncFaith } from '@/game/sim/faith';
import { exploredReach, inSight, type Reach, type SightDisc } from './fog';
import { FIGURE_BY_ID } from './data/figures';
import { CAMERA_LEASH, DEFENSE_FREEZE, HOME_SIGHT, REACH_MAX } from './data/tuning';
import { heroReady } from '@/game/derived';
import { cityName } from '../../netlify/lib/contract';
import { marchPosition } from './geo';
import {
  cachedChunk,
  chunkKeysIn,
  chunkRect,
  ageChunks,
  clearCache,
  clearPending,
  isPending,
  exploredAt,
  isStale,
  markPending,
  putChunk,
  settlementAt,
  terrainAt,
} from './cache';
import type {
  AnchorId,
  AttackOrder,
  CampView,
  Coord,
  DealId,
  DealView,
  Fate,
  OrderActionId,
  FigureId,
  FigureView,
  InterceptPlan,
  StrikePlan,
  LetterView,
  MarchOrder,
  MarchView,
  OrderOption,
  OrderResult,
  PlayerCastle,
  Rect,
  Report,
  SettlementCard,
  SettlementId,
  SiegeView,
  Terrain,
  TribeInfo,
  WorldInfo,
  WorldPulse,
} from './types';
import type { TroopStack } from '@/game/battle/kinds';
import type { ArmySetup } from '@/battle';

/** Как часто мир опрашивается. Достаточно редко, чтобы не мешать симуляции племени. */
const PULSE_MS = 2000;

/** Мир, составляющий черновики уведомлений. Есть, только пока открыт замок `NOTIFY_ON`. */
let notifying: NotifyingWorld | null = null;

/**
 * Завести мир. С открытым замком — тот, что умеет составлять черновики уведомлений; с
 * закрытым сборщик выбрасывает эту ветку вместе с классом (`world/local/NotifyingWorld.ts`).
 */
function openWorld(opts: LocalWorldOptions): LocalWorld {
  if (NOTIFY_ON) return (notifying = new NotifyingWorld(opts));
  return new LocalWorld(opts);
}

/**
 * Замки живых игроков для мира. Перевод одной строки: реестр говорит про
 * замок, мир — про поселение, и знать друг о друге им положено ровно здесь.
 *
 * Мир про сеть по-прежнему не знает ничего: ему приносят готовые строки.
 */
const worldCastles = (): PlayerCastle[] =>
  castles().map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    name: c.name,
    // Строка реестра — чужие руки: имя города очищается ещё раз на входе в мир.
    ...(cityName(c.city) ? { city: cityName(c.city) as string } : {}),
    power: c.power,
    pop: c.pop,
    seenAt: c.seenAt,
  }));

/**
 * Подпись того, от чего зависят рогатки на карте: осада своего города и свой лагерь.
 * Сменилась — или пульс принёс новый отчёт (всякое взятие города его пишет), — куски
 * карты перезапрашиваются (`ageChunks`).
 */
let lastLook: string | null = null;
const siegeLook = (p: WorldPulse): string =>
  `${p.siege?.since ?? '-'}|${p.figures.some((f) => f.id === 'general' && f.besieging) ? 1 : 0}`;

/** Открытое меню приказов: агент, клетка и то, что мир знает про цель. */
export interface ActionMenuState {
  agent: FigureId;
  cell: Coord;
  /** Поселение под клеткой. null — пустая земля: приказывать некому и нечего. */
  target: SettlementId | null;
  name: string;
  card: SettlementCard | null;
  /**
   * Чужой отряд на этой клетке. Его можно догонять — и точка встречи считается
   * заранее, до подтверждения приказа.
   */
  march: MarchView | null;
  /** Где и когда встретимся, если приказать сейчас. null — цели нет. */
  plan: InterceptPlan | null;
}

export interface WorldStore {
  ready: boolean;
  info: WorldInfo | null;
  marches: MarchView[];
  /** Три фигуры. Приезжают пульсом вместе с походами — вторым списком. */
  figures: FigureView[];
  /** Договоры, действующие прямо сейчас. */
  deals: DealView[];
  /**
   * Кого игрок держит в руке. Выбранной фигурой ходят тапом по карте — это и
   * есть весь способ отдать ей приказ, отдельного экрана «куда идти» нет.
   */
  picked: FigureId | null;
  /**
   * На чём стоит камера. Не то же самое, что фигура в руке: приказ движения
   * можно отпустить, а камера всё равно должна остаться на том, за кем игрок
   * следит. Живёт в сторе, а не в компоненте, потому что от неё зависит и
   * поводок камеры, и ряд кнопок внизу слева.
   */
  anchor: AnchorId;
  reports: Report[];
  unread: number;
  tribes: TribeInfo[];
  /**
   * Письма, ждущие решения. Порядок — тот, в каком их разбирают: первым лежит
   * то, что раньше всего разрешится само. Считает и обрезает их мир, здесь они
   * только лежат.
   */
  letters: LetterView[];
  /** Какое письмо открыто. null — столбик свёрнут. */
  openLetter: string | null;
  /**
   * Клетка, на которую игрока привели лупой из письма: карта встаёт на неё и
   * отмечает пульсом, чтобы взгляд нашёл её сразу.
   *
   * Живёт в сторе, а не в полотне, по той же причине, что и якорь камеры:
   * ставят её из деревни, до того как карта вообще смонтирована.
   */
  spotlight: Coord | null;
  /**
   * Какое письмо вернуть открытым, когда игрок уйдёт с карты.
   *
   * Ушедший смотреть обязан вернуться к тому же письму: лупа не отвечает за
   * игрока, не считает письмо прочитанным и не трогает его срок — она только
   * закрывает карточку на время. Письмо всё это время лежит на столе у мира и
   * живёт своей жизнью; если срок вышел, пока игрок смотрел, вернуть будет
   * нечего — и тогда не возвращается ничего.
   */
  letterBack: string | null;
  /**
   * Осада деревни. Живёт здесь, а не в состоянии племени, по той же причине,
   * что и походы: считает её мир, а панель показывает мировые часы — они идут
   * между пульсами сами. В племя из неё едет только то, что нужно тику
   * (`bridge.syncSiege`).
   */
  siege: SiegeView | null;
  /**
   * Наш лагерь под чужим городом — окно осаждающего. Перечитывается тем же пульсом,
   * пока полководец держит осаду: часы голода и рогатки идут сами. null — лагеря нет.
   */
  camp: CampView | null;
  /** Время мира на последнем пульсе. */
  now: number;
  selected: Coord | null;
  card: SettlementCard | null;
  /** Ландшафт выбранной клетки — карточка пустой клетки живёт на нём одном. */
  cardTerrain: Terrain | null;
  cardLoading: boolean;
  /** Счётчик приехавших кусков карты: по нему перерисовывается полотно. */
  chunks: number;
  /**
   * Открытое меню приказов: какой агент, по какой цели. Живёт в сторе, а не в
   * полотне, потому что открывается из двух мест — тапом по карте и кнопкой в
   * карточке клетки, — а меню при этом одно.
   */
  menu: ActionMenuState | null;
  /** Строки меню: цена, время, шанс и причина отказа. Считает их мир. */
  orders: OrderOption[];
  boot: () => Promise<void>;
  pulse: () => Promise<void>;
  ensureRegion: (rect: Rect) => void;
  select: (c: Coord) => Promise<void>;
  refreshCard: () => Promise<void>;
  send: (order: MarchOrder) => Promise<string | null>;
  recall: (id: string) => Promise<void>;
  /** Взять фигуру в руку или отпустить. */
  pick: (id: FigureId | null) => void;
  /** Переставить камеру на своё поселение или на одну из фигур. */
  setAnchor: (id: AnchorId) => void;
  /** Вести выбранную фигуру в клетку. Возвращает текст ошибки или null. */
  moveFigure: (id: FigureId, to: Coord) => Promise<string | null>;
  recallFigure: (id: FigureId) => Promise<string | null>;
  /**
   * Поставить лазутчика наблюдателем или снять. Пока он смотрит, он не
   * приказывает — и наоборот: смотреть или действовать и есть решение.
   */
  watch: (on: boolean) => Promise<string | null>;
  /** Полководец забирает гарнизон или возвращает его домой. */
  setGarrison: (troops: TroopStack | null) => Promise<string | null>;
  /** Полководец бьёт по цели, у которой стоит. */
  attack: (order: AttackOrder) => Promise<string | null>;
  /**
   * Полководец садится в осаду под целью, у которой стоит, и объявляет участь. Пока
   * лагерь стоит, эта дружина занята, а приказ увести её снимает осаду — и панель
   * говорит об этом до приказа (`CAMP_LEAVE`), а не после. У своего лагеря — объявить
   * участь заново.
   */
  besiege: (fate?: Fate) => Promise<string | null>;
  /** Снять свою осаду. */
  retreat: () => Promise<string | null>;
  /** Поделить древесину своего лагеря: доля фронту. */
  setWood: (share: number) => Promise<string | null>;
  /** Перечитать окно осаждающего. */
  loadCamp: () => Promise<void>;
  /**
   * Вылазка из осаждённой деревни выбранным составом. Возвращает номер отчёта —
   * его сразу и открывают: у боя всегда есть что показать.
   */
  sortie: (troops: TroopStack, setup?: ArmySetup | null) => Promise<{ error: string | null; reportId: string | null }>;
  negotiate: (deal: DealId) => Promise<string | null>;
  /** Открыть меню приказов агента по этой клетке. */
  openMenu: (agent: FigureId, cell: Coord) => Promise<void>;
  /** Открыть меню перехвата по чужому отряду — из списка походов или с карты. */
  openChase: (march: MarchView) => Promise<void>;
  /** Вести полководца на перехват. Возвращает текст ошибки или null. */
  intercept: () => Promise<string | null>;
  /**
   * План удара полководца по лагерю под `target`: кто пробьётся с тыла и, если зовут
   * гарнизон, со стороны города. Считает мир той же функцией, что и бой.
   */
  strikePlan: (target: SettlementId, garrison: boolean) => Promise<StrikePlan>;
  /** Полководец идёт бить лагерь под `target`. Текст ошибки или null. */
  strikeCamp: (target: SettlementId, garrison: boolean) => Promise<string | null>;
  closeMenu: () => void;
  /** Перечитать строки меню: после приказа цена, шанс и причины уже другие. */
  refreshOrders: () => Promise<void>;
  /** Перечитать план перехвата: цель идёт, и точка встречи с ней уезжает. */
  loadPlan: (marchId: string) => Promise<void>;
  /** Отдать приказ дипломату по цели открытого меню. */
  order: (action: OrderActionId) => Promise<OrderResult>;
  /** Перечитать стол писем. Мир заодно разберёт сроки: считаем при чтении. */
  loadLetters: () => Promise<void>;
  /** Открыть письмо или закрыть открытое (null). */
  showLetter: (id: string | null) => void;
  /**
   * Показать на карте того, кто прислал письмо. Карточку письма закрывает, само
   * письмо не трогает — оно ждёт на столе и откроется снова, когда игрок уйдёт
   * с карты.
   */
  spotLetter: (id: string) => void;
  /**
   * Карта закрылась: пульс гаснет, отложенное письмо открывается обратно.
   * Зовётся не полотном, а подпиской на `mapOpen` (см. ниже): уборка эффекта
   * при размонтировании для этого не годится — в `StrictMode` она случается
   * сразу после монтирования, и метка гасла бы, не успев показаться.
   */
  leaveMap: () => void;
  /** Ответить на письмо. Возвращает текст ошибки или null. */
  answerLetter: (id: string, answer: 'yes' | 'no') => Promise<string | null>;
  loadReports: () => Promise<void>;
  markRead: () => Promise<void>;
  /** Новый мир с нуля — рядом с «начать заново» у племени. */
  resetWorld: () => Promise<void>;
}

let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Поправка часов мира к нашим. У локального мира она нулевая — он и живёт по
 * тем же часам (`serverNow`), — у настоящего сервера мира будет своя.
 *
 * Поправок две и складываются они нарочно: `serverNow` правит часы устройства
 * по серверу хранения, а эта — часы мира по часам мира. Сводить их в одну
 * нельзя: обновляются они врозь, и общая начала бы дёргаться от каждого пульса.
 */
let clockOffset = 0;

/** Время мира прямо сейчас: таймеры походов идут между пульсами. */
export const worldNow = (): number => serverNow() + clockOffset;

export const useWorld = create<WorldStore>((set, get) => ({
  ready: false,
  info: null,
  marches: [],
  figures: [],
  deals: [],
  picked: null,
  anchor: 'home',
  reports: [],
  unread: 0,
  tribes: [],
  letters: [],
  openLetter: null,
  spotlight: null,
  letterBack: null,
  siege: null,
  camp: null,
  now: serverNow(),
  selected: null,
  card: null,
  cardTerrain: null,
  cardLoading: false,
  chunks: 0,
  menu: null,
  orders: [],

  boot: async () => {
    if (get().ready) return;
    if (!hasWorldApi()) {
      // Клетку замка называет общий реестр, и знать её надо **до** постройки
      // мира: собранный не на том месте, он потом переписывался бы под ногами
      // у игрока. Ожидание тут ограничено само собой — у запроса свой срок, а
      // неудача возвращается значением, — и первого кадра игры оно не касается:
      // деревня к этому времени давно на экране.
      await rosterReady();
      const world = openWorld({ reveal: revealWorld(), home: castleCell() ?? undefined, castles: worldCastles });
      // Реестр назвал другую клетку, чем та, на которой партия шла без него.
      // Молча такое не делается: карта пропала, и игрок узнаёт об этом строкой.
      if (world.movedByRoster) {
        useGame.getState().world((s) => {
          log(s, 'Замок занял своё место на общей карте. Разведанное вокруг прежнего пришлось забыть.', 'bad');
        });
      }
      setWorldApi(world);
    }
    const info = await worldApi().info();
    set({ info, ready: true });
    await get().pulse();
    set({ tribes: await worldApi().tribes(), deals: await worldApi().deals() });
    if (!timer) timer = setInterval(() => void get().pulse(), PULSE_MS);
  },

  pulse: async () => {
    if (!hasWorldApi()) return;
    const game = useGame.getState();
    // Кто сейчас не дома, знает мир: походы и войско при полководце. Слепок
    // везёт всё войско, а гарнизон мир считает сам; списки с прошлого пульса
    // нужны здесь только расстановке обороны (`playerProfile`).
    const away = awayOf(get().marches, get().figures);
    const pulse = await worldApi().sync(playerProfile(game.s, away));

    // Последствия походов применяются раньше, чем пересчитываются ушедшие: в
    // момент прихода отряда герой ещё числится в походе, и по этому и понятно,
    // что павший — именно он (см. applyExpedition и syncAway).
    if (pulse.effects.length > 0) {
      useGame.getState().world((s) => applyEffects(s, pulse.effects));
      haptic('medium');
    }
    // Число ушедших выводится из походов: правим состояние на месте, перерисовку
    // сделает ближайший тик симуляции — лишний рендер каждые две секунды не нужен.
    syncAway(game.s, pulse.marches, pulse.figures);
    // Осада режет выработку в тике, поэтому она обязана доехать до состояния
    // племени, а не остаться картинкой на экране карты.
    syncSiege(game.s, pulse.siege, pulse.now);
    // Вера земли под замком и чужая вера вокруг. Первый ответ мира ставит веру
    // новой партии — до него храм честно говорит, что грамоты из округи ещё не
    // пришли, и подставлять католичество «пока не знаем» нельзя: деревня под
    // Вильнюсом сменила бы веру молча.
    syncFaith(game.s, pulse.faith.id, pulse.faith.pressure);
    if (pulse.reports.length > 0) {
      useGame.getState().showToast(pulse.reports[0].title);
      // Список мог быть уже открыт: без этого свежий отчёт не появится, пока
      // игрок не закроет и не откроет панель заново.
      if (get().reports.length > 0) void get().loadReports();
    }

    // Осада началась или кончилась, город взят — поселения на карте выглядят иначе, и
    // держать куски до их срока значило бы показывать вчерашний город.
    const look = siegeLook(pulse);
    if (lastLook !== null && (look !== lastLook || pulse.reports.length > 0)) ageChunks();
    lastLook = look;

    clockOffset = pulse.now - serverNow();
    set({
      marches: pulse.marches,
      figures: pulse.figures,
      siege: pulse.siege,
      unread: pulse.unread,
      now: pulse.now,
    });
    // Черновики уведомлений — после пульса, из того, что он оставил в сохранении мира.
    if (NOTIFY_ON) void notifying?.notices().then((d) => notifyDrafts(d.items, pulse.now));
    // Стол писем перечитывается тем же пульсом: срок письма разбирает мир в
    // момент, когда на стол посмотрели, и смотреть на него надо регулярно —
    // иначе протухшее висело бы в столбике до следующего действия игрока.
    void get().loadLetters();
    // Окно осаждающего живёт тем же пульсом, пока лагерь стоит; снят — окна нет.
    if (pulse.figures.some((f) => f.id === 'general' && f.besieging)) void get().loadCamp();
    else if (get().camp) set({ camp: null });
    if (get().selected && get().card) void get().refreshCard();
    // Открытое меню живёт теми же пульсами: в причинах отказа стоят отсчёты
    // («дипломат занят ещё 3:00»), и замерший на месте отсчёт читается как
    // сломанный экран, а не как запрет.
    if (get().menu?.target) void get().refreshOrders();
    // План перехвата тем более: цель идёт, и точка встречи уезжает вместе с ней.
    const chased = get().menu?.march;
    if (chased) void get().loadPlan(chased.id);
  },

  ensureRegion: (rect) => {
    if (!hasWorldApi()) return;
    const now = serverNow();
    for (const { key, cx, cy } of chunkKeysIn(rect)) {
      const have = cachedChunk(key);
      if ((have && !isStale(have, now)) || isPending(key)) continue;
      markPending(key);
      void worldApi()
        .region(chunkRect(cx, cy))
        .then((chunk) => {
          putChunk(key, chunk, serverNow());
          set({ chunks: get().chunks + 1 });
        })
        .finally(() => clearPending(key));
    }
  },

  select: async (c) => {
    const view = settlementAt(c.x, c.y);
    set({ selected: c, card: null, cardTerrain: terrainAt(c.x, c.y), cardLoading: view !== null });
    useGame.getState().openWorldTile(c.x, c.y);
    if (!view) return;
    const card = await worldApi().settlement(view.id);
    // Пока ходили за карточкой, игрок мог выбрать другую клетку.
    const sel = get().selected;
    if (!sel || sel.x !== c.x || sel.y !== c.y) return;
    set({ card, cardLoading: false });
  },

  refreshCard: async () => {
    const card = get().card;
    if (!card) return;
    const fresh = await worldApi().settlement(card.id);
    if (fresh && get().card?.id === card.id) set({ card: fresh });
  },

  send: async (order) => {
    const res = await worldApi().send(order);
    if (res.error) {
      haptic('error');
      return res.error;
    }
    haptic('medium');
    // Племя ведёт счёт своим походам: по нему закрываются задания про карту.
    useGame.getState().world((s) => {
      if (order.mission === 'scout') s.stats.scouted = (s.stats.scouted ?? 0) + 1;
      if (order.mission === 'raid') s.stats.raids = (s.stats.raids ?? 0) + 1;
      // Герой уходит с походом — с одним за раз. Людей, которых он приводит,
      // панель уже вложила в расстановку; здесь отмечается только он сам.
      // Только собранный игроком поход: в быстрой атаке расстановку выбирает
      // пресет по сиду, и вести герою там некого (см. BattlePanel).
      if (order.mission === 'raid' && order.setup && res.march && heroReady(s)) {
        s.hero.marchId = res.march.id;
      }
    });
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  recall: async (id) => {
    const err = await worldApi().recall(id);
    if (err) {
      useGame.getState().showToast(err);
      return;
    }
    haptic('light');
    await get().pulse();
  },

  pick: (id) => set({ picked: id }),

  setAnchor: (id) => set({ anchor: id, picked: id === 'home' ? null : get().picked }),

  moveFigure: async (id, to) => {
    const err = await worldApi().moveFigure(id, to);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().pulse();
    return null;
  },

  recallFigure: async (id) => {
    const err = await worldApi().recallFigure(id);
    if (err) {
      haptic('error');
      return err;
    }
    await get().pulse();
    return null;
  },

  watch: async (on) => {
    const err = await worldApi().watch(on);
    if (err) {
      haptic('error');
      return err;
    }
    await get().pulse();
    // Приказы лазутчика после этого другие: наблюдатель не работает.
    await get().refreshOrders();
    return null;
  },

  setGarrison: async (troops) => {
    const err = await worldApi().setGarrison(troops);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    // Сразу же: пока не прошёл пульс, деревня всё ещё считает эту дружину своей.
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  attack: async (order) => {
    const res = await worldApi().attack(order);
    if (res.error) {
      haptic('error');
      return res.error;
    }
    haptic('medium');
    useGame.getState().world((s) => {
      s.stats.raids = (s.stats.raids ?? 0) + 1;
    });
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  besiege: async (fate) => {
    const err = await worldApi().besiege(fate);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  retreat: async () => {
    const err = await worldApi().retreat();
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  setWood: async (share) => {
    const err = await worldApi().setWood(share);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().loadCamp();
    return null;
  },

  loadCamp: async () => {
    set({ camp: await worldApi().camp() });
  },

  sortie: async (troops, setup = null) => {
    const res = await worldApi().sortie(troops, setup);
    if (res.error) {
      haptic('error');
      return { error: res.error, reportId: null };
    }
    haptic('medium');
    useGame.getState().world((s) => {
      s.stats.raids = (s.stats.raids ?? 0) + 1;
    });
    // Сразу же: осада могла сняться этим самым боем, и панель обязана это
    // показать в тот же миг, а не через две секунды.
    await get().pulse();
    return { error: null, reportId: res.reportId };
  },

  negotiate: async (deal) => {
    const err = await worldApi().negotiate(deal);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    set({ deals: await worldApi().deals() });
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  openMenu: async (agent, cell) => {
    // Меню — единственный слой над картой: карточку клетки при этом закрываем,
    // иначе шторка легла бы поверх и меню оказалось бы под ней.
    useGame.getState().closeSheet();
    const view = settlementAt(cell.x, cell.y);
    const march = marchOn(get().marches, cell, worldNow());
    set({
      menu: {
        agent,
        cell,
        target: view?.id ?? null,
        name: view?.name ?? (march ? `Отряд от ${march.fromName}` : 'Пустая земля'),
        card: null,
        march,
        plan: null,
      },
      orders: [],
    });
    // Точка встречи считается до подтверждения — она и есть половина решения.
    if (march) void get().loadPlan(march.id);
    if (!view) return;
    const [card, orders] = await Promise.all([
      worldApi().settlement(view.id),
      worldApi().orders(agent, view.id),
    ]);
    const menu = get().menu;
    if (!menu || menu.target !== view.id) return;
    set({ menu: { ...menu, card }, orders });
  },

  openChase: async (march) => {
    useGame.getState().closeSheet();
    const cell = marchPosition(march, worldNow());
    set({
      menu: {
        agent: 'general',
        cell: { x: Math.round(cell.x), y: Math.round(cell.y) },
        target: null,
        name: `Отряд от ${march.fromName}`,
        card: null,
        march,
        plan: null,
      },
      orders: [],
    });
    await get().loadPlan(march.id);
  },

  loadPlan: async (marchId) => {
    const plan = await worldApi().interceptPlan(marchId);
    const menu = get().menu;
    if (!menu || menu.march?.id !== marchId) return;
    set({ menu: { ...menu, plan } });
  },

  intercept: async () => {
    const menu = get().menu;
    if (!menu?.march) return 'Догонять некого.';
    const err = await worldApi().intercept(menu.march.id);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    return null;
  },

  strikePlan: (target, garrison) => worldApi().strikePlan(target, garrison),

  strikeCamp: async (target, garrison) => {
    const err = await worldApi().strikeCamp(target, garrison);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  closeMenu: () => set({ menu: null, orders: [] }),

  refreshOrders: async () => {
    const menu = get().menu;
    if (!menu?.target) return;
    const [card, orders] = await Promise.all([
      worldApi().settlement(menu.target),
      worldApi().orders(menu.agent, menu.target),
    ]);
    const now = get().menu;
    if (!now || now.target !== menu.target) return;
    set({ menu: { ...now, card }, orders });
  },

  order: async (action) => {
    const menu = get().menu;
    if (!menu?.target) return { error: 'Цель не выбрана.', accepted: false, diplomacy: null, text: '' };
    const res = await worldApi().order(action, menu.target);
    haptic(res.error ? 'error' : res.accepted ? 'medium' : 'light');
    // Пульс раньше перечитывания: последствие приказа (плата, мораль) должно
    // лечь на племя до того, как меню покажет новые цены.
    await get().pulse();
    await get().refreshOrders();
    await get().refreshCard();
    return res;
  },

  loadLetters: async () => {
    const letters = await worldApi().letters();
    // Открытое письмо могло разрешиться само, пока игрок его читал: закрываем,
    // а не оставляем висеть карточкой, у которой кнопки уже ничего не делают.
    const open = get().openLetter;
    set({ letters, openLetter: open && letters.some((l) => l.id === open) ? open : null });
  },

  showLetter: (id) => set({ openLetter: id }),

  spotLetter: (id) => {
    const l = get().letters.find((x) => x.id === id);
    const cell = l?.from?.cell;
    // Места нет — показывать нечего, и кнопки в таком письме тоже нет.
    if (!cell) return;
    useGame.getState().openMap();
    // Переход мог и не состояться — карта не открывается поверх идущего
    // занавеса. Тогда и карточку закрывать не за чем: игрок остался бы разом
    // без карты и без письма.
    if (!useGame.getState().mapOpen) return;
    haptic('light');
    set({ spotlight: cell, letterBack: id, openLetter: null });
  },

  leaveMap: () => {
    const { letterBack, letters } = get();
    // Письмо могло разрешиться само, пока игрок смотрел карту: возвращать
    // карточку, у которой кнопки уже ничего не делают, нельзя.
    const back = letterBack && letters.some((l) => l.id === letterBack) ? letterBack : null;
    set({ spotlight: null, letterBack: null, openLetter: back });
  },

  answerLetter: async (id, answer) => {
    const err = await worldApi().answerLetter(id, answer);
    if (err) {
      haptic('error');
      useGame.getState().showToast(err);
      await get().loadLetters();
      return err;
    }
    haptic('medium');
    set({ openLetter: null });
    // Пульс раньше перечитывания: последствие письма (плата, мораль, люди)
    // должно лечь на племя до того, как столбик покажет новый список.
    await get().pulse();
    await get().loadLetters();
    await get().refreshCard();
    return null;
  },

  loadReports: async () => {
    set({ reports: await worldApi().reports() });
  },

  markRead: async () => {
    await worldApi().readReports();
    set({ unread: 0, reports: (await worldApi().reports()) });
  },

  resetWorld: async () => {
    clearCache();
    setWorldApi(
      openWorld({
        seed: Math.floor(Math.random() * 0x7fffffff),
        reveal: revealWorld(),
        // Начать заново — это про свой мир, а не про общий: замок остаётся там,
        // где о нём знают соседи, и переезжать ему некуда.
        home: castleCell() ?? undefined,
        castles: worldCastles,
      }),
    );
    set({
      ready: false,
      info: null,
      marches: [],
      figures: [],
      deals: [],
      picked: null,
      anchor: 'home',
      reports: [],
      unread: 0,
      tribes: [],
      selected: null,
      card: null,
      cardTerrain: null,
      letters: [],
      openLetter: null,
      spotlight: null,
      letterBack: null,
      camp: null,
      menu: null,
      orders: [],
      chunks: get().chunks + 1,
    });
    await get().boot();
  },
}));

/**
 * Стенд бюджета кадра: стор и накопленные времена кадров. Только по флагу
 * `?probe=1` — тем же, которым `App.tsx` отдаёт стенду стор племени.
 *
 * Отдаётся именно стор, а не список отрядов: стенду нужно **подложить** худший
 * случай, а взять его из мира негде — мир держит один чужой отряд на деревню и
 * один мимо неё, и толпы в нём не бывает по устройству. Замер от этого честнее:
 * рисование меряется на числе, которого игра не даёт, а не на том, что выпало.
 */
if (probe() && typeof window !== 'undefined') {
  const w = window as unknown as {
    __world?: typeof useWorld;
    __mapPerf?: () => number[];
    __mapBakes?: () => number[];
    __mapGaps?: () => number[];
  };
  w.__world = useWorld;
  w.__mapPerf = takeCosts;
  w.__mapBakes = takeBakes;
  w.__mapGaps = takeGaps;
}

/**
 * Где фигура прямо сейчас. Считается из времени, а не берётся из пульса: пульс
 * идёт раз в две секунды, а фигура на карте должна ехать плавно.
 */
export function figurePosition(f: FigureView, now: number): Coord {
  if (f.phase !== 'moving') return f.to;
  const total = Math.max(1, f.arriveAt - f.departAt);
  const t = Math.min(1, Math.max(0, (now - f.departAt) / total));
  return { x: f.from.x + (f.to.x - f.from.x) * t, y: f.from.y + (f.to.y - f.from.y) * t };
}

/**
 * Живой обзор прямо сейчас — тем же правилом, что и в мире: круг у своей
 * деревни и стоящий наблюдателем лазутчик, больше никто (см. world/sight.ts).
 * Карта считает его у себя, а не спрашивает мир, ровно по одной причине: он
 * меняется каждый кадр, а пульс идёт раз в две секунды, и дымка отставала бы
 * от лазутчика на два корпуса.
 *
 * Радиус наблюдения приходит готовым (`watchSight`): решает, кто наблюдает,
 * один модуль, и второй правды об этом между картой и миром быть не должно.
 */
export function sightDiscs(now: number): SightDisc[] {
  const g = useWorld.getState();
  const out: SightDisc[] = [];
  const home = g.info?.home;
  if (home) out.push({ x: home.x, y: home.y, r: HOME_SIGHT });
  for (const f of g.figures) {
    if (f.watchSight <= 0) continue;
    const at = figurePosition(f, now);
    out.push({ x: at.x, y: at.y, r: f.watchSight });
  }
  return out;
}

/** Где стоит камера, насколько её отпускают от этой точки и докуда разведано. */
export interface CameraAnchor {
  id: AnchorId;
  name: string;
  /** Середина клетки: камера меряется серединами, а не углами. */
  x: number;
  y: number;
  /** Радиус поводка: обзор якоря плюс запас, чтобы было куда указать. */
  r: number;
  /** Разведанное вокруг якоря — из него карта выводит потолок отдаления. */
  reach: Reach;
}

/**
 * Разведанное вокруг якоря. Меряется по кэшу кусков — по тому же туману, что
 * игрок и видит на полотне, а не по маске мира: карта не имеет к ней доступа,
 * да и показывать потолок надо ровно от нарисованной дымки.
 *
 * Считается не каждый кадр: якорь меряется целой клеткой (фигура переходит её
 * за секунды), а туман меняется только с приездом куска — его и считает `chunks`.
 */
let reachMemo: { key: string; reach: Reach } | null = null;

function reachAround(x: number, y: number, chunks: number): Reach {
  const key = `${x}|${y}|${chunks}`;
  if (reachMemo && reachMemo.key === key) return reachMemo.reach;
  const reach = exploredReach({ x, y }, exploredAt, REACH_MAX);
  reachMemo = { key, reach };
  return reach;
}

/**
 * Точка, к которой привязана камера. Выбывшая фигура якорем быть не может —
 * её на карте нет, — и камера в этом случае возвращается к деревне сама, а не
 * зависает над пустым полем.
 */
export function cameraAnchor(now: number): CameraAnchor | null {
  const g = useWorld.getState();
  const home = g.info?.home;
  const at = g.anchor === 'home' ? null : g.figures.find((x) => x.id === g.anchor);
  const live = at && at.phase !== 'down' ? at : null;
  const spot = live ? figurePosition(live, now) : home ? { x: home.x, y: home.y } : null;
  if (!spot) return null;
  const cell = { x: Math.floor(spot.x), y: Math.floor(spot.y) };
  return {
    id: live ? live.id : 'home',
    name: live ? live.name : 'Деревня',
    x: spot.x + 0.5,
    y: spot.y + 0.5,
    r: (live ? live.sight : HOME_SIGHT) + CAMERA_LEASH,
    reach: reachAround(cell.x, cell.y, g.chunks),
  };
}

/**
 * Мир слушает, закрылась ли карта.
 *
 * Дверь здесь одна и лежит она у мира, а не у игры: `mapOpen` живёт в сторе
 * племени, а письма — в этом, и знать друг о друге им положено ровно в одну
 * сторону. Момент закрытия важен: игрок, ушедший смотреть, кто ему написал,
 * обязан вернуться к тому же письму — иначе лупа наказывала бы за любопытство.
 */
useGame.subscribe((g, prev) => {
  if (prev.mapOpen && !g.mapOpen) {
    useWorld.getState().leaveMap();
    // За закрытой картой чужие замки никому не нужны, а лишний запрос в минуту
    // с каждого играющего — это уже нагрузка. Своя дверь и свой явный останов.
    stopPulling();
  }
  if (!prev.mapOpen && g.mapOpen) startPulling();
});

/** Клетка в чьём-то обзоре прямо сейчас. */
export const cellInSight = (discs: SightDisc[], x: number, y: number): boolean => inSight(discs, x + 0.5, y + 0.5);

/** Фигура, стоящая на этой клетке (или вплотную к ней). Для карточки клетки. */
export function figuresOn(x: number, y: number, now: number): FigureView[] {
  return useWorld.getState().figures.filter((f) => {
    if (f.phase === 'down') return false;
    const at = figurePosition(f, now);
    return Math.round(at.x) === x && Math.round(at.y) === y;
  });
}

/** Как называется фигура — карте и панелям, чтобы не тянуть конфиг по одной. */
export const figureName = (id: FigureId): string => FIGURE_BY_ID[id].name;

/**
 * Чужой отряд, стоящий сейчас на этой клетке. Ищется по положению, выведенному
 * из времени, — так же, как он и рисуется на полотне.
 */
export function marchOn(marches: MarchView[], cell: Coord, now: number): MarchView | null {
  for (const m of marches) {
    if (m.own || m.phase !== 'out') continue;
    const at = marchPosition(m, now);
    if (Math.round(at.x) === cell.x && Math.round(at.y) === cell.y) return m;
  }
  return null;
}

/** Свои походы — отдельно от чужих: их показывает список, их можно отозвать. */
export const ownMarches = (marches: MarchView[]): MarchView[] => marches.filter((m) => m.own);

/** Чужие отряды, идущие на деревню игрока. Ближайший по времени — первым. */
export const incomingMarches = (marches: MarchView[]): MarchView[] =>
  marches.filter((m) => m.hostile && m.phase === 'out').sort((a, b) => a.arriveAt - b.arriveAt);

/**
 * Заморозка обороны. Менять расстановку можно до отметки «минус пять минут» до
 * прихода чужой армии; после неё настройки заперты, и игроку это показывают, а
 * не игнорируют нажатия молча (раздел 8 документа).
 *
 * Считается здесь, чтобы у панели и у мира была одна формула: мир защёлкивает
 * ту же отметку у себя (`LocalWorld.lockDefense`).
 */
export interface DefenseLock {
  /** Ближайший чужой отряд или null. */
  march: MarchView | null;
  /** Секунд до прихода. */
  seconds: number;
  frozen: boolean;
}

export function defenseLock(marches: MarchView[], now: number): DefenseLock {
  const m = incomingMarches(marches)[0] ?? null;
  if (!m) return { march: null, seconds: 0, frozen: false };
  const left = m.arriveAt - now;
  return { march: m, seconds: Math.max(0, left / 1000), frozen: left <= DEFENSE_FREEZE };
}
