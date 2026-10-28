// Состояние экрана карты. Здесь и только здесь мир соединяется с интерфейсом:
// компоненты читают этот стор, а он ходит в worldApi(). Ни один экран не знает,
// что за интерфейсом сейчас стоит LocalWorld.
import type { CraftAct } from './siegecraft';
import type { MachineId } from './data/machines';
import type { Gait } from './data/gait';
import type { Aim } from './data/shelling';
import type { SiegeOrders } from './siegeroll';
import { create } from 'zustand';
import { partyNow, serverNow } from '@/net/clock';
import { castleCell, castles, rosterReady, startPulling, stopPulling } from '@/net/roster';
import { knownEra } from '@/net/era';
import { NOTIFY_ON, notifyDrafts } from '@/net/notify';
import { buildForecast } from '@/game/buildEta';
import { realMs } from '@/game/pace';
import { draftBuild, draftStab } from './notice';
import { stabOf } from '@/game/sim/stability';
import type { ProposalAct } from './proposals';
import { pacts, proposals, provideSheet, spies, spyLook, warBoot, warOrder, warPace, wars, warsKnown } from '@/net/war';
import { log } from '@/game/sim/log';
import { useGame } from '@/game/store';
import { haptic } from '@/telegram/webapp';
import { probe, revealWorld, takeBakes, takeCosts, takeGaps } from '@/debug';
import { hasWorldApi, setWorldApi, worldApi, type WorldApi } from './api';
import { LocalWorld, type LocalWorldOptions } from './local/LocalWorld';
import { NotifyingWorld } from './local/NotifyingWorld';
import { tribePulse } from './bridge';
import { inSight, type SightDisc } from './fog';
import { FIGURE_TOUCH } from './data/tuning';
import { homeSight } from './sight';
import { freshSeed } from '@/game/sim/random';
import { readArms } from '@/heraldry/arms';
import { cityName, NOTICE_LIMITS, type NoticeItem } from '../../netlify/lib/contract';
import { marchPosition } from './geo';
import {
  cachedChunk,
  chunkKeysIn,
  chunkRect,
  ageChunks,
  clearCache,
  clearPending,
  isPending,
  isStale,
  markPending,
  putChunk,
  settlementAt,
  terrainAt,
} from './cache';
import type {
  AssaultMode,
  AnchorId,
  DefendOrder,
  ParleyOrder,
  AttackOrder,
  CampView,
  Coord,
  DealId,
  DealView,
  Fate,
  RivalDeedId,
  RivalMenu,
  ErrandId,
  ErrandOption,
  ErrandOrder,
  ErrandTarget,
  FigureId,
  FigureView,
  InterceptPlan,
  StrikePlan,
  LetterView,
  RivalMail,
  MarchOrder,
  MarchView,
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

/**
 * Как часто мир опрашивается, настоящих мс. Достаточно редко, чтобы не мешать симуляции племени. Из него
 * выведены ступени скорости проверки (`pace.SPEEDS`): под скоростью пульс идёт теми же настоящими двумя
 * секундами, а часов партии между пульсами проходит в `speed` раз больше.
 */
export const PULSE_MS = 2000;

/** Мир, составляющий черновики уведомлений. Есть, только пока открыт замок `NOTIFY_ON`. */
let notifying: NotifyingWorld | null = null;

/**
 * Список черновиков с вестью о стройке партии (ВС-1): прогноз — `game/buildEta`, минута — серверными часами пульса.
 * Список полон — стройка молчит: весть о мире важнее, а лишний пункт стоил бы отказа всему списку.
 */
function withBuild(items: NoticeItem[], now: number): NoticeItem[] {
  if (items.length >= NOTICE_LIMITS.items) return items;
  const s = useGame.getState().s;
  const f = buildForecast(s);
  const item = draftBuild(f && { type: f.type, level: f.level, doneAt: now + realMs(f.sec), party: s.seed }, now);
  return item ? [...items, item] : items;
}

/**
 * Вести стабильности (docs/stability.md, 2.8): «мятеж близок» и «мятеж» по прогнозу полос партии (`stabForecast`), минута —
 * серверными часами пульса. Места в списке им — после мира и стройки: список полон — стабильность молчит.
 */
async function withStab(items: NoticeItem[], now: number): Promise<NoticeItem[]> {
  // Прогноз — словами раздела (`sim/stabview`): своим куском, первая загрузка за него не платит.
  const { stabForecast } = await import('@/game/sim/stabview');
  const s = useGame.getState().s;
  const episode = stabOf(s).revolts;
  const out = [...items];
  for (const f of stabForecast(s)) {
    for (const [kind, sec] of [
      ['stab-near', f.near],
      ['stab-revolt', f.revolt],
    ] as const) {
      if (sec === null || out.length >= NOTICE_LIMITS.items) continue;
      const item = draftStab({ group: f.group, kind, at: now + realMs(sec), episode }, now);
      if (item) out.push(item);
    }
  }
  return out;
}

/**
 * Завести мир. С открытым замком — тот, что умеет составлять черновики уведомлений; с
 * закрытым сборщик выбрасывает эту ветку вместе с классом (`world/local/NotifyingWorld.ts`).
 */
function openWorld(opts: LocalWorldOptions): LocalWorld {
  // Война между игроками (docs/pvp.md): мир получает свои войны и дверь приказа, как реестр замков, а
  // запись партии — слепок обороны от этого мира.
  const full: LocalWorldOptions = { ...opts, wars, warsKnown, warOrder, warPace, spies, spyLook, pacts, proposals };
  let world: LocalWorld;
  if (NOTIFY_ON) world = notifying = new NotifyingWorld(full);
  else world = new LocalWorld(full);
  provideSheet(() => world.warSheet());
  warBoot();
  return world;
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
    // Герб — так же: только из набора (`readArms`), чужая строка сырой в мир не входит.
    ...(readArms(c.arms) ? { arms: c.arms as string } : {}),
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
  /**
   * Отряд найден не под пальцем, а впереди него на дороге: клетка лежит на пути набега (`raidAcross`). Тогда меню говорит
   * вслух, что встать здесь мало — набег пройдёт мимо, — и даёт перехват (отзыв тестеров 18.10, docs/feedback.md).
   */
  across?: boolean;
  /** Где и когда встретимся, если приказать сейчас. null — цели нет. */
  plan: InterceptPlan | null;
  /**
   * Цель дела под пальцем (Р-4, docs/AGENTS.md, раздел 16): свой город, двор, город игрока или чужой отряд. null —
   * пустая земля: свободной ходьбы нет, и дел здесь нет.
   */
  goal: ErrandTarget | null;
  /** Дела агента при этой цели — числами мира (`WorldApi.errands`). null — ещё не посчитаны. */
  errands: ErrandOption[] | null;
  /**
   * Дело, выбранное до меню (ДР-6): кнопка похода карточки места или «На выручку» ведёт сразу в окно дела — состав, участь
   * и «Отправить». Нет поля — меню начинается со списка дел.
   */
  deed?: ErrandId;
  /** Участь, уже выбранная в карточке места, — первой в окне дела. */
  fate?: Fate;
}

/**
 * Кольцо значков над целью (К-2, docs/AGENTS.md, раздел 18): касание места без человека в руке. Дела четырёх человек у
 * этой цели — числами мира (`WorldApi.errands`): по ним кольцо гасит значок и объясняет почему (`ui/map/ring.ts`).
 */
export interface RingState {
  cell: Coord;
  goal: ErrandTarget;
  name: string;
  /** Чужой отряд под пальцем — цель «отряд в пути». */
  march: MarchView | null;
  /** Карточка места — для сведений «i»; у отряда её нет. */
  card: SettlementCard | null;
  /** Дела каждого человека у цели; null — ещё считаются. */
  deeds: Partial<Record<FigureId, ErrandOption[] | null>>;
  /** Открыты сведения «i» — короткая карточка вместо кольца. */
  info: boolean;
}

export interface WorldStore {
  ready: boolean;
  info: WorldInfo | null;
  marches: MarchView[];
  /** Фигуры. Приезжают пульсом вместе с походами — вторым списком. */
  figures: FigureView[];
  /** Договоры, действующие прямо сейчас. */
  deals: DealView[];
  /**
   * Кого игрок держит в руке. Выбранной фигурой ходят тапом по карте — это и
   * есть весь способ отдать ей приказ, отдельного экрана «куда идти» нет.
   */
  picked: FigureId | null;
  /**
   * За кем игрок следит: свой город или агент. Не то же самое, что фигура в руке: приказ движения можно отпустить, а
   * выбор остаётся. Камеру он больше не держит (поводка нет с ПН-00, docs/gdd/path_of_sword.md, 3.5.7): смена — один
   * перевод камеры к нему (`WorldMap`), дальше камера свободна. Живёт в сторе, а не в компоненте: от него зависит ряд
   * кнопок внизу слева и агент по умолчанию у меню клетки.
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
  /** Кольцо значков над целью (К-2). null — закрыто. */
  ring: RingState | null;
  /** Поднять кольцо над клеткой: цель — место или чужой отряд под пальцем; пустая земля кольца не даёт. */
  openRing: (cell: Coord) => Promise<void>;
  /** Сведения «i» вместо кольца и обратно. */
  ringInfo: (on: boolean) => void;
  closeRing: () => void;
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
  /**
   * Отправить агента делом (Р-4): к цели, дело в минуту прихода и домой сам. Возвращает текст ошибки или null. Это
   * единственный выход агента из дома: свободной ходьбы по клетке нет.
   */
  errand: (order: ErrandOrder) => Promise<string | null>;
  recallFigure: (id: FigureId) => Promise<string | null>;
  /** Режим марша полководца (ДР-2, `WorldApi.setGait`): дома — даром, в пути — стоянкой и энергией. Ошибка — текстом. */
  setGait: (gait: Gait) => Promise<string | null>;
  /**
   * Поставить лазутчика наблюдателем или снять. Пока он смотрит, он не
   * приказывает — и наоборот: смотреть или действовать и есть решение.
   */
  watch: (on: boolean) => Promise<string | null>;
  /**
   * Агент входит в свой город (`on`) или выходит. Вошедший пропадает с карты —
   * из руки и с камеры тоже: держать камеру на том, кого не рисуют, нечем.
   */
  shelter: (id: FigureId, on: boolean) => Promise<string | null>;
  /** Полководец бьёт по цели, у которой стоит. */
  attack: (order: AttackOrder) => Promise<string | null>;
  /**
   * Полководец садится в осаду под целью, у которой стоит, и объявляет участь. Пока
   * лагерь стоит, эта дружина занята, а приказ увести её снимает осаду — и панель
   * говорит об этом до приказа (`CAMP_LEAVE`), а не после. У своего лагеря — объявить
   * участь заново.
   */
  besiege: (fate?: Fate) => Promise<string | null>;
  /** Поход на город живого игрока (docs/pvp.md): штурм с ходу или осада; бой считает сервер. */
  warMarch: (target: SettlementId, mode: 'storm' | 'siege', fate: Fate) => Promise<string | null>;
  /** Дела лазутчика против города игрока (docs/spy_pvp.md): меню — с сервера, приказ — по его минуте. */
  spyMenu: (target: SettlementId) => Promise<RivalMenu>;
  spyRival: (target: SettlementId, deed: RivalDeedId, shownAt: number) => Promise<string | null>;
  /**
   * «Дойти и ударить» (`mode` 'storm', по умолчанию): по логову и по городу игрока одним приказом; бой — в минуту прихода.
   * «Дойти и осадить» (`'siege'`): лагерь в минуту прихода (docs/siege_v2.md, 1.3).
   */
  assault: (target: SettlementId, fate: Fate, mode?: AssaultMode) => Promise<string | null>;
  /** Снять свою осаду. */
  retreat: () => Promise<string | null>;
  /** Поделить древесину своего лагеря: доля фронту. */
  setWood: (share: number) => Promise<string | null>;
  /** Доля древесины лагеря осадным машинам (`world/machines`). */
  setMachineWood: (share: number) => Promise<string | null>;
  /** Заказать осадную машину в своём лагере. */
  orderMachine: (id: MachineId) => Promise<string | null>;
  /** Дело полководца в своём лагере: укрепить лагерь, обстрел города (`world/siegecraft`). */
  campCraft: (act: CraftAct) => Promise<string | null>;
  /** Наказы своему лагерю на отлучку (`world/siegeroll`, docs/siege_v2.md, 8.3). */
  setOrders: (orders: SiegeOrders) => Promise<string | null>;
  /** Перечитать окно осаждающего. */
  loadCamp: () => Promise<void>;
  /**
   * Вылазка из осаждённой деревни выбранным составом. Возвращает номер отчёта —
   * его сразу и открывают: у боя всегда есть что показать.
   */
  /** Ответ осаждённого (docs/siege_v2.md, раздел 5): починка, паёк, наказы, сдача. */
  defend: (order: DefendOrder) => Promise<string | null>;
  /** Переговоры у стен (docs/siege_v2.md, раздел 7): предложить или ответить. */
  parley: (order: ParleyOrder) => Promise<string | null>;
  /** Вылазка на машину лагеря. */
  burnMachine: (id: MachineId, troops: TroopStack) => Promise<{ error: string | null; reportId: string | null }>;
  /** Цель артиллерии своего лагеря (Р-5). */
  aimArtillery: (aim: Aim) => Promise<string | null>;
  /** Кольцо блокады своего лагеря (Р-5). */
  blockade: (on: boolean) => Promise<string | null>;
  /** Вылазка на пост кольца блокады (Р-5). */
  breakout: (troops: TroopStack) => Promise<{ error: string | null; reportId: string | null }>;
  /** Пакт с соседом-игроком: предложить/принять или разорвать. */
  pact: (castle: SettlementId, on: boolean) => Promise<string | null>;
  sortie: (troops: TroopStack) => Promise<{ error: string | null; reportId: string | null }>;
  negotiate: (deal: DealId) => Promise<string | null>;
  /** Открыть меню приказов агента по этой клетке; `pick` — дело, выбранное до меню (сразу окно дела, ДР-6). */
  openMenu: (agent: FigureId, cell: Coord, pick?: { deed: ErrandId; fate?: Fate }) => Promise<void>;
  /**
   * Открыть меню дел по чужому отряду — из списка походов или с карты: полководцу — перехват, разведчику — следить
   * за отрядом (Р-4).
   */
  openChase: (march: MarchView, agent?: FigureId) => Promise<void>;
  /**
   * План удара полководца по лагерю под `target`: кто пробьётся с тыла и, если зовут
   * гарнизон, со стороны города. Считает мир той же функцией, что и бой.
   */
  strikePlan: (target: SettlementId, garrison: boolean) => Promise<StrikePlan>;
  /** Полководец идёт бить лагерь под `target`. Текст ошибки или null. */
  strikeCamp: (target: SettlementId, garrison: boolean) => Promise<string | null>;
  closeMenu: () => void;
  /** Перечитать план перехвата: цель идёт, и точка встречи с ней уезжает. */
  loadPlan: (marchId: string) => Promise<void>;
  /** Перечитать дела агента при цели открытого меню: сроки и причины отказа живут пульсами. */
  loadErrands: () => Promise<void>;
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
  /** Соседи-игроки в «Вестях» (ДП-1): предложения и походы на нас. Перечитываются пульсом. */
  rivals: RivalMail;
  loadRivals: () => Promise<void>;
  /** Ответ на предложение соседа: принять, отклонить, отозвать. Возвращает текст ошибки или null. */
  answerProposal: (id: string, act: ProposalAct) => Promise<string | null>;
  loadReports: () => Promise<void>;
  markRead: () => Promise<void>;
  /** Новый мир с нуля — рядом с «начать заново» у племени. */
  resetWorld: () => Promise<void>;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Поколение мира: растёт, когда мир заменён (`swapWorld` — постройка при входе, «Начать заново»). Пульс, начатый у
 * прежнего мира, сверяет его по возвращении и не кладёт чужой ответ ни в партию, ни в стор (OPS-4).
 */
let generation = 0;

/** Подключить мир (или снять — `null`): единственная замена мира в сторе. */
export function swapWorld(api: WorldApi | null): void {
  generation++;
  setWorldApi(api);
}

/** Идущая постройка мира: второй вход ждёт её, а не строит второй мир (OPS-4). */
let booting: Promise<void> | null = null;
/** Идущий пульс и пульс, ждущий за ним: пульсы идут по одному, лишние сливаются в один (OPS-4). */
let pulsing: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Поправка часов мира к нашим. У локального мира она нулевая — он и живёт по
 * тем же часам (часы партии, `partyNow`), — у настоящего сервера мира будет своя.
 *
 * Поправок две и складываются они нарочно: `serverNow` правит часы устройства
 * по серверу хранения, а эта — часы мира по часам мира. Сводить их в одну
 * нельзя: обновляются они врозь, и общая начала бы дёргаться от каждого пульса.
 */
let clockOffset = 0;

/** Время мира прямо сейчас: таймеры походов идут между пульсами. */
export const worldNow = (): number => partyNow() + clockOffset;

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
  rivals: { proposals: [], marching: [] },
  openLetter: null,
  spotlight: null,
  letterBack: null,
  siege: null,
  camp: null,
  now: partyNow(),
  selected: null,
  card: null,
  cardTerrain: null,
  cardLoading: false,
  chunks: 0,
  menu: null,
  ring: null,

  boot: async () => {
    if (get().ready) return;
    if (booting) return booting;
    booting = (async () => {
      if (!hasWorldApi()) {
        // Клетку замка называет общий реестр, и знать её надо **до** постройки
        // мира: собранный не на том месте, он потом переписывался бы под ногами
        // у игрока. Ожидание тут ограничено само собой — у запроса свой срок, а
        // неудача возвращается значением, — и первого кадра игры оно не касается:
        // деревня к этому времени давно на экране.
        await rosterReady();
        const world = openWorld({ reveal: revealWorld(), home: castleCell() ?? undefined, castles: worldCastles, era: knownEra() });
        // Реестр назвал другую клетку, чем та, на которой партия шла без него.
        // Молча такое не делается: карта пропала, и игрок узнаёт об этом строкой.
        if (world.movedByRoster) {
          useGame.getState().world((s) => {
            log(s, 'Город встал на своё место на карте. Разведанное вокруг прежнего забыто.', 'bad');
          });
        }
        swapWorld(world);
      }
      const g = generation;
      const info = await worldApi().info();
      if (g !== generation) return;
      set({ info, ready: true });
      await get().pulse();
      set({ tribes: await worldApi().tribes(), deals: await worldApi().deals() });
      if (!timer) timer = setInterval(() => void get().pulse(), PULSE_MS);
    })().finally(() => {
      booting = null;
    });
    return booting;
  },

  pulse: () => {
    // Пульс уже идёт — этот встаёт за ним (действие игрока, ждущее пульса, увидит свой итог), и ждущий один на всех.
    if (pulsing) {
      queued ??= pulsing.then(() => {
        queued = null;
        return get().pulse();
      });
      return queued;
    }
    pulsing = pulseOnce().finally(() => {
      pulsing = null;
    });
    return pulsing;
  },


  ensureRegion: (rect) => {
    if (!hasWorldApi()) return;
    // Срок куска — часы игрока, а не партии: кэш — инструмент, и цена пересчёта куска настоящая. Под
    // скоростью проверки на часах партии кусок старел бы в `speed` раз быстрее и пересчитывался бы
    // на каждом кадре; перемены городов на карте и так гасят кусок пульсом (`ageChunks`).
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

  errand: async (order) => {
    const err = await worldApi().errand(order);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    await get().refreshCard();
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

  setGait: async (gait) => {
    const err = await worldApi().setGait(gait);
    if (err) {
      haptic('error');
      return err;
    }
    await get().pulse();
    // Карточка цели считает срок пути в нынешнем режиме — пересчитать её.
    await get().refreshCard();
    return null;
  },

  watch: async (on) => {
    const err = await worldApi().watch(on);
    if (err) {
      haptic('error');
      return err;
    }
    await get().pulse();
    // Дела лазутчика после этого другие: наблюдатель не работает.
    await get().loadErrands();
    return null;
  },

  shelter: async (id, on) => {
    const err = await worldApi().shelter(id, on);
    if (err) {
      haptic('error');
      return err;
    }
    if (on) {
      const g = get();
      set({ picked: g.picked === id ? null : g.picked, anchor: g.anchor === id ? 'home' : g.anchor });
    }
    await get().pulse();
    await get().loadErrands();
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

  warMarch: async (target, mode, fate) => {
    const err = await worldApi().warMarch(target, mode, fate);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  spyMenu: (target) => worldApi().spyMenu(target),

  spyRival: async (target, deed, shownAt) => {
    const err = await worldApi().spyRival(target, deed, shownAt);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    await get().pulse();
    await get().refreshCard();
    return null;
  },

  assault: async (target, fate, mode) => {
    const err = await worldApi().assault(target, fate, mode);
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

  setMachineWood: async (share) => {
    const err = await worldApi().setMachineWood(share);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().loadCamp();
    return null;
  },

  orderMachine: async (id) => {
    const err = await worldApi().orderMachine(id);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().loadCamp();
    return null;
  },

  campCraft: async (act) => {
    const err = await worldApi().campCraft(act);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().loadCamp();
    return null;
  },

  setOrders: async (orders) => {
    const err = await worldApi().setOrders(orders);
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

  defend: async (order) => {
    const err = await worldApi().defend(order);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    // Паёк и сдача меняют город сразу: панель и племя видят это в тот же миг, а не через пульс.
    await get().pulse();
    return null;
  },

  parley: async (order) => {
    const err = await worldApi().parley(order);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    // Принятая дань и сдача снимают лагерь сразу: панель и племя видят это в тот же миг.
    await get().pulse();
    return null;
  },

  burnMachine: async (id, troops) => {
    const res = await worldApi().burnMachine(id, troops);
    if (res.error) {
      haptic('error');
      return { error: res.error, reportId: null };
    }
    haptic('medium');
    await get().pulse();
    return { error: null, reportId: res.reportId };
  },

  aimArtillery: async (aim) => {
    const err = await worldApi().aimArtillery(aim);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().loadCamp();
    return null;
  },

  blockade: async (on) => {
    const err = await worldApi().blockade(on);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('medium');
    // Кольцо меняет город осаждённого и окно лагеря сразу.
    await get().loadCamp();
    await get().pulse();
    return null;
  },

  breakout: async (troops) => {
    const res = await worldApi().breakout(troops);
    if (res.error) {
      haptic('error');
      return { error: res.error, reportId: null };
    }
    haptic('medium');
    await get().pulse();
    return { error: null, reportId: res.reportId };
  },

  pact: async (castle, on) => {
    const err = await worldApi().pact(castle, on);
    if (err) {
      haptic('error');
      return err;
    }
    haptic('light');
    await get().refreshCard();
    return null;
  },

  sortie: async (troops) => {
    const res = await worldApi().sortie(troops);
    if (res.error) {
      haptic('error');
      return { error: res.error, reportId: null };
    }
    haptic('medium');
    useGame.getState().world((s) => {
      s.stats.raids = (s.stats.raids ?? 0) + 1;
    });
    // Сразу же: осада могла сняться этим самым боем, и панель обязана это
    // показать в тот же миг, а не через пульс (`PULSE_MS`).
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

  openMenu: async (agent, cell, pick) => {
    // Меню — единственный слой над картой: карточку клетки при этом закрываем,
    // иначе шторка легла бы поверх и меню оказалось бы под ней.
    useGame.getState().closeSheet();
    const view = settlementAt(cell.x, cell.y);
    const under = marchOn(get().marches, cell, worldNow());
    // Полководцу на дороге набега — тот же набег: встречать его выходят на путь, а не ловят пальцем движущийся отряд.
    const ahead = !under && !view && agent === 'general' ? raidAcross(get().marches, cell, worldNow(), get().info?.homeId) : null;
    const march = view ? null : (under ?? ahead);
    // Цель дела (Р-4): свой город, двор или замок соседа, чужой отряд. Пустая земля целью не бывает.
    const home = view && view.id === get().info?.homeId;
    const goal: ErrandTarget | null = home ? { kind: 'home' } : view ? { kind: 'place', id: view.id } : march ? { kind: 'march', id: march.id } : null;
    set({
      ring: null,
      menu: {
        agent,
        cell,
        target: view?.id ?? null,
        name: view?.name ?? (ahead ? `Путь набега · ${ahead.fromName}` : march ? `Отряд · ${march.fromName}` : 'Пустая земля'),
        card: null,
        march,
        ...(ahead ? { across: true } : {}),
        plan: null,
        goal,
        errands: null,
        ...(pick ? { deed: pick.deed, ...(pick.fate ? { fate: pick.fate } : {}) } : {}),
      },
    });
    // Точка встречи считается до подтверждения — она и есть половина решения.
    if (march) void get().loadPlan(march.id);
    void get().loadErrands();
    if (!view) return;
    const card = await worldApi().settlement(view.id);
    const menu = get().menu;
    if (!menu || menu.target !== view.id) return;
    set({ menu: { ...menu, card } });
  },

  openChase: async (march, agent = 'general') => {
    useGame.getState().closeSheet();
    const cell = marchPosition(march, worldNow());
    set({
      ring: null,
      menu: {
        agent,
        cell: { x: Math.round(cell.x), y: Math.round(cell.y) },
        target: null,
        name: `Отряд · ${march.fromName}`,
        card: null,
        march,
        plan: null,
        goal: { kind: 'march', id: march.id },
        errands: null,
      },
    });
    void get().loadErrands();
    await get().loadPlan(march.id);
  },

  loadPlan: async (marchId) => {
    const plan = await worldApi().interceptPlan(marchId);
    const menu = get().menu;
    if (!menu || menu.march?.id !== marchId) return;
    set({ menu: { ...menu, plan } });
  },

  loadErrands: async () => {
    const menu = get().menu;
    if (!menu?.goal) return;
    const errands = await worldApi().errands(menu.agent, menu.goal);
    const now = get().menu;
    if (!now || now.agent !== menu.agent || now.goal !== menu.goal) return;
    set({ menu: { ...now, errands } });
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

  closeMenu: () => set({ menu: null }),

  openRing: async (cell) => {
    const view = settlementAt(cell.x, cell.y);
    const march = view ? null : marchOn(get().marches, cell, worldNow());
    if (!view && !march) return set({ ring: null });
    const home = view && view.id === get().info?.homeId;
    const goal: ErrandTarget = home ? { kind: 'home' } : view ? { kind: 'place', id: view.id } : { kind: 'march', id: march!.id };
    const ring: RingState = { cell, goal, name: view?.name ?? `Отряд · ${march!.fromName}`, march, card: null, deeds: {}, info: false };
    set({ ring, menu: null });
    const same = (): boolean => get().ring?.cell === cell;
    const agents: FigureId[] = ['diplomat', 'general', 'scout', 'spy'];
    const [card, ...lists] = await Promise.all([
      view ? worldApi().settlement(view.id) : Promise.resolve(null),
      ...agents.map((a) => worldApi().errands(a, goal)),
    ]);
    if (!same()) return;
    set({ ring: { ...get().ring!, card, deeds: Object.fromEntries(agents.map((a, i) => [a, lists[i]])) } });
  },

  ringInfo: (on) => {
    const ring = get().ring;
    if (ring) set({ ring: { ...ring, info: on } });
  },

  closeRing: () => set({ ring: null }),

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
    // Переход мог и не состояться. Тогда и карточку закрывать не за чем: игрок
    // остался бы разом без карты и без письма.
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

  loadRivals: async () => {
    set({ rivals: await worldApi().rivals() });
  },

  answerProposal: async (id, act) => {
    const err = await worldApi().answerProposal(id, act);
    if (err) {
      haptic('error');
      await get().loadRivals();
      return err;
    }
    haptic('medium');
    // Пульс раньше перечитывания: строка летописи об итоге ложится на племя тем же заходом.
    await get().pulse();
    await get().loadRivals();
    if (get().selected && get().card) await get().refreshCard();
    return null;
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
    swapWorld(
      openWorld({
        seed: freshSeed(),
        reveal: revealWorld(),
        // Начать заново — это про свой мир, а не про общий: замок остаётся там,
        // где о нём знают соседи, и переезжать ему некуда.
        home: castleCell() ?? undefined,
        castles: worldCastles,
        era: knownEra(),
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
      rivals: { proposals: [], marching: [] },
      openLetter: null,
      spotlight: null,
      letterBack: null,
      camp: null,
      menu: null,
      ring: null,
          chunks: get().chunks + 1,
    });
    await get().boot();
  },
}));

/** Один пульс клиентского мира — по одному за раз (`WorldStore.pulse`, OPS-4). */
async function pulseOnce(): Promise<void> {
  if (!hasWorldApi()) return;
  // Пульс племени — одна дверь на игру и на автопилот отчётов (`bridge.tribePulse`): слепок,
  // последствия, ушедшие, осада и вера. Состояние правится на месте, по свежему объекту стора;
  // перерисовку сделает ближайший тик симуляции — лишний рендер на каждый пульс (`PULSE_MS`)
  // не нужен. Последствия — другое дело: их игрок должен увидеть сразу.
  const g = generation;
  const pulse = await tribePulse(
    worldApi(),
    // Мир заменён, пока ответ шёл, — последствия прежнего мира в партию не ложатся (OPS-4).
    { get: () => useGame.getState().s, apply: (change) => g === generation && change(useGame.getState().s) },
    { marches: useWorld.getState().marches, figures: useWorld.getState().figures },
  );
  if (g !== generation) return;
  if (pulse.effects.length > 0) {
    useGame.getState().world(() => {});
    // Последствие без строки — одно дело агента (разведчик дошёл до логова): это
    // не событие, и телефон вздрагивать из-за него не должен.
    if (pulse.effects.some((e) => e.text || e.fell || e.retired)) haptic('medium');
  }
  if (pulse.reports.length > 0) {
    useGame.getState().showToast(pulse.reports[0].title);
    // Список мог быть уже открыт: без этого свежий отчёт не появится, пока
    // игрок не закроет и не откроет панель заново.
    if (useWorld.getState().reports.length > 0) void useWorld.getState().loadReports();
  }

  // Осада началась или кончилась, город взят — поселения на карте выглядят иначе, и
  // держать куски до их срока значило бы показывать вчерашний город.
  const look = siegeLook(pulse);
  if (lastLook !== null && (look !== lastLook || pulse.reports.length > 0)) ageChunks();
  lastLook = look;

  clockOffset = pulse.now - partyNow();
  useWorld.setState({
    marches: pulse.marches,
    figures: pulse.figures,
    siege: pulse.siege,
    unread: pulse.unread,
    now: pulse.now,
  });
  // Черновики уведомлений — после пульса, из того, что он оставил в сохранении мира, и стройка партии (ВС-1).
  if (NOTIFY_ON) void notifying?.notices().then((d) => withStab(withBuild(d.items, pulse.now), pulse.now).then((items) => notifyDrafts(items, pulse.now)));
  // Стол писем перечитывается тем же пульсом: срок письма разбирает мир в
  // момент, когда на стол посмотрели, и смотреть на него надо регулярно —
  // иначе протухшее висело бы в столбике до следующего действия игрока.
  void useWorld.getState().loadLetters();
  void useWorld.getState().loadRivals();
  // Окно осаждающего живёт тем же пульсом, пока лагерь стоит; снят — окна нет.
  if (pulse.figures.some((f) => f.id === 'general' && f.besieging)) void useWorld.getState().loadCamp();
  else if (useWorld.getState().camp) useWorld.setState({ camp: null });
  if (useWorld.getState().selected && useWorld.getState().card) void useWorld.getState().refreshCard();
  // Открытое меню живёт теми же пульсами: в причинах отказа стоят отсчёты
  // («дипломат занят ещё 3:00»), и замерший на месте отсчёт читается как
  // сломанный экран, а не как запрет.
  // План перехвата тем более: цель идёт, и точка встречи уезжает вместе с ней.
  const chased = useWorld.getState().menu?.march;
  if (chased) void useWorld.getState().loadPlan(chased.id);
  if (useWorld.getState().menu) void useWorld.getState().loadErrands();
}

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
    __settlementAt?: typeof settlementAt;
    __mapPerf?: () => number[];
    __mapBakes?: () => number[];
    __mapGaps?: () => number[];
  };
  w.__world = useWorld;
  // Стенд снимков (ДР-2, `city:shots` с `MARCH=`): найти логово у дома без касания полотна.
  w.__settlementAt = settlementAt;
  w.__mapPerf = takeCosts;
  w.__mapBakes = takeBakes;
  w.__mapGaps = takeGaps;
}

/**
 * Где фигура прямо сейчас. Считается из времени, а не берётся из пульса: пульс
 * идёт раз в `PULSE_MS`, а фигура на карте должна ехать плавно.
 */
export function figurePosition(f: FigureView, now: number): Coord {
  if (f.phase !== 'moving') return f.to;
  const total = Math.max(1, f.arriveAt - f.departAt);
  const t = Math.min(1, Math.max(0, (now - f.departAt) / total));
  return { x: f.from.x + (f.to.x - f.from.x) * t, y: f.from.y + (f.to.y - f.from.y) * t };
}

/**
 * Куда перевести камеру, когда игрок выбрал, за кем следить: перевод один, дальше камера свободна (поводка нет с ПН-00,
 * docs/gdd/path_of_sword.md, 3.5.7). Выбывшая и укрывшаяся в городе фигура на карте не стоит — null, камера остаётся,
 * где была.
 */
export function followSpot(id: AnchorId, now: number): Coord | null {
  const g = useWorld.getState();
  if (id === 'home') return g.info?.home ?? null;
  const f = g.figures.find((x) => x.id === id);
  return f && f.place === 'map' ? figurePosition(f, now) : null;
}

/**
 * Живой обзор прямо сейчас — тем же правилом, что и в мире: круг у своей
 * деревни и стоящий наблюдателем лазутчик, больше никто (см. world/sight.ts).
 * Карта считает его у себя, а не спрашивает мир, ровно по одной причине: он
 * меняется каждый кадр, а пульс идёт раз в `PULSE_MS`, и дымка отставала бы
 * от лазутчика на два корпуса.
 *
 * Радиус наблюдения приходит готовым (`watchSight`): решает, кто наблюдает,
 * один модуль, и второй правды об этом между картой и миром быть не должно.
 */
export function sightDiscs(now: number): SightDisc[] {
  const g = useWorld.getState();
  const out: SightDisc[] = [];
  const home = g.info?.home;
  if (home) out.push({ x: home.x, y: home.y, r: homeSight(home) });
  for (const f of g.figures) {
    if (f.watchSight <= 0) continue;
    const at = figurePosition(f, now);
    out.push({ x: at.x, y: at.y, r: f.watchSight });
  }
  return out;
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
    // За закрытой картой чужие замки никому не нужны, а лишний запрос раз в `ROSTER_PULL_MS`
    // с каждого играющего — это уже нагрузка. Своя дверь и свой явный останов.
    stopPulling();
  }
  if (!prev.mapOpen && g.mapOpen) startPulling();
});

/** Клетка в чьём-то обзоре прямо сейчас. */
export const cellInSight = (discs: SightDisc[], x: number, y: number): boolean => inSight(discs, x + 0.5, y + 0.5);

/**
 * Фигура, стоящая на этой клетке (или вплотную к ней). Для карточки клетки и
 * тапа по карте. Укрывшейся в городе здесь нет: на карте её не видно, и взять
 * её в руку тапом по земле нельзя.
 */
export function figuresOn(x: number, y: number, now: number): FigureView[] {
  return useWorld.getState().figures.filter((f) => {
    if (f.place !== 'map') return false;
    const at = figurePosition(f, now);
    return Math.round(at.x) === x && Math.round(at.y) === y;
  });
}

/**
 * Чужой отряд, стоящий сейчас на этой клетке. Ищется по положению, выведенному
 * из времени, — так же, как он и рисуется на полотне.
 */
export function marchOn(marches: MarchView[], cell: Coord, now: number): MarchView | null {
  for (const m of marches) {
    // Чужой отряд в пути — туда или домой с добычей (ПЛ-1, MAP-9): идущего домой тоже перехватывают, и касание его находит.
    if (m.own || m.phase === 'stay') continue;
    const at = marchPosition(m, now);
    if (Math.round(at.x) === cell.x && Math.round(at.y) === cell.y) return m;
  }
  return null;
}

/** Насколько близко к дороге набега должна лечь клетка, чтобы считаться «на пути»: касание фигур (`FIGURE_TOUCH`). */
const PATH_NEAR = FIGURE_TOUCH;

/**
 * Набег на деревню, чья оставшаяся дорога проходит через эту клетку: от того места, где отряд сейчас, до ворот. Полководец,
 * поставленный сюда приказом «идти», боя не даст — отряды мира идут сквозь фигуры (отзыв тестеров 18.10, docs/feedback.md);
 * бой в поле даёт перехват. Ближайший по времени первым.
 */
export function raidAcross(marches: MarchView[], cell: Coord, now: number, homeId: SettlementId | undefined): MarchView | null {
  for (const m of marchesOnHome(marches, homeId)) {
    const a = marchPosition(m, now);
    const dx = m.to.x - a.x;
    const dy = m.to.y - a.y;
    const len2 = dx * dx + dy * dy;
    const k = len2 > 0 ? Math.max(0, Math.min(1, ((cell.x - a.x) * dx + (cell.y - a.y) * dy) / len2)) : 0;
    if (Math.hypot(a.x + dx * k - cell.x, a.y + dy * k - cell.y) <= PATH_NEAR) return m;
  }
  return null;
}

/** Свои походы — отдельно от чужих: их показывает список, их можно отозвать. */
export const ownMarches = (marches: MarchView[]): MarchView[] => marches.filter((m) => m.own);

/** Чужой отряд в пути на деревню: цель — дом. Пока мир не ответил, чей дом (`homeId` нет), на деревню не идёт никто. */
const onHome = (m: MarchView, homeId: SettlementId | undefined): boolean =>
  m.hostile && m.phase === 'out' && m.targetId === homeId;

/**
 * Чужие отряды, идущие на деревню игрока, ближайший по времени первым: строка «Набег» в тревогах и раздел «Оборона» у
 * стены (`parts/raidWords`). Зовут к обороне деревни — и только от тех, кто на неё идёт.
 *
 * «Чужой» (`hostile`) — ещё не «на нас»: так мир помечает всякий не свой отряд, и в живом обзоре у деревни идут и
 * походы логов друг на друга (`LocalWorld.scheduleWar`), и выручка на наш лагерь. Прежде фильтр стоял на одном
 * `hostile`, и строка «Набег» звала к обороне от чужой войны.
 */
export const marchesOnHome = (marches: MarchView[], homeId: SettlementId | undefined): MarchView[] =>
  marches.filter((m) => onHome(m, homeId)).sort((a, b) => a.arriveAt - b.arriveAt);

/**
 * Чужие отряды, идущие на все наши места — деревню и наш лагерь осады (`MarchView.onCamp`), ближайший первым: «Идут
 * на нас» в «Походах» (решение владельца). Выручка, идущая на лагерь, — угроза нашему войску, и из списка угроз она
 * пропадать не должна; к обороне деревни она не зовёт — это `marchesOnHome`.
 */
export const marchesOnUs = (marches: MarchView[], homeId: SettlementId | undefined): MarchView[] =>
  marches
    .filter((m) => onHome(m, homeId) || (m.hostile && m.phase === 'out' && m.onCamp === true))
    .sort((a, b) => a.arriveAt - b.arriveAt);

/**
 * Окно ответа на набег — до самого прихода отряда (решение владельца 06.10.2026, docs/NOTIFY.md, 12.11): дома перевод
 * дружины мгновенный, и переставить её, выйти на перехват или нанять можно, пока отряд не у стен. Тот же срок у
 * черновика уведомления (`world/notice`) и у войны между игроками на сервере (`war.newsOf`). Прежде окно кончалось
 * раньше — минутой, когда полный сбор дома ещё успевал (`musterBy`, поставка 2 боя, docs/battle_eu4.md, 14.27), а сбора
 * дома больше нет. От прихода до секунд здесь один шаг — и больше его не делает никто.
 */
export interface RaidWindow {
  march: MarchView;
  /** Секунд до прихода — столько и длится окно ответа. */
  seconds: number;
}

export function raidWindow(m: MarchView, now: number): RaidWindow {
  return { march: m, seconds: Math.max(0, (m.arriveAt - now) / 1000) };
}
