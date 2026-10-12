// Единственная точка доступа к миру. Экраны знают только этот интерфейс.
//
// Сейчас за ним стоит LocalWorld: мир генерируется и живёт на клиенте.
// Когда появится сервер, рядом встанет HttpWorld с теми же сигнатурами, и ни один
// компонент интерфейса переписывать не придётся. Поэтому все методы асинхронные,
// даже те, что сегодня отвечают мгновенно.
import type { CraftAct } from './siegecraft';
import type { SiegeOrders } from './siegeroll';
import type { MachineId } from './data/machines';
import type { TroopStack } from '@/game/battle/kinds';
import type {
  AssaultMode,
  AttackOrder,
  AttackResult,
  CampView,
  DealId,
  DefendOrder,
  Fate,
  DealView,
  OrderActionId,
  FigureId,
  FigureView,
  IntelReading,
  InterceptPlan,
  LeadPlan,
  LetterAnswerId,
  LetterView,
  MarchOrder,
  MarchView,
  OrderOption,
  OrderResult,
  PlayerProfile,
  Coord,
  Rect,
  RegionChunk,
  Report,
  RivalDeedId,
  RivalMenu,
  SendResult,
  SettlementCard,
  SettlementId,
  StrikePlan,
  TribeInfo,
  WorldInfo,
  WorldPulse,
} from './types';

export interface WorldApi {
  /** Размер сетки, сид, где стоит деревня игрока. */
  info(): Promise<WorldInfo>;

  /** Клетки области: ландшафт и поселения в ней. Карта запрашивает кусками. */
  region(rect: Rect): Promise<RegionChunk>;

  /** Карточка поселения: владелец, стадия, расстояние, что известно о войске. */
  settlement(id: SettlementId): Promise<SettlementCard | null>;

  /** Разведданные по поселению с их возрастом. null — не разведано или устарело. */
  intel(id: SettlementId): Promise<IntelReading | null>;

  /** Отправка похода. Ошибку возвращает текстом, не бросает. */
  send(order: MarchOrder): Promise<SendResult>;

  /** Свои походы и всё чужое, что видно игроку. */
  marches(): Promise<MarchView[]>;

  /** Отзыв похода. null — отозван, иначе текст ошибки. */
  recall(marchId: string): Promise<string | null>;

  /** Фигуры игрока: где они, что при них, когда придут. */
  figures(): Promise<FigureView[]>;

  /**
   * Вести фигуру в клетку. null — пошла, иначе текст ошибки. `shownAt` — минута плана,
   * который игрок видел (`leadPlan.at`): риск разведчика замораживается ровно по нему.
   */
  moveFigure(id: FigureId, to: Coord, shownAt?: number): Promise<string | null>;

  /**
   * Что будет, если вести фигуру в клетку: сколько идти и чем рискует разведчик у
   * ворот — до приказа, той же функцией, что заморозит риск при отправке.
   */
  leadPlan(id: FigureId, to: Coord): Promise<LeadPlan>;

  /** Развернуть фигуру домой. Обратный путь считается по уже пройденному. */
  recallFigure(id: FigureId): Promise<string | null>;

  /**
   * Поставить лазутчика наблюдателем или снять с наблюдения. Живой обзор за
   * пределами круга у деревни даёт он один, и пока он смотрит — он не
   * выведывает войско и не поднимает бунт (см. world/sight.ts). Наблюдают стоя.
   */
  watch(on: boolean): Promise<string | null>;

  /**
   * Агент входит в свой город и укрывается (`on`) или выходит обратно. С карты
   * укрывшийся пропадает, а место у него прежнее: выходит он туда же, откуда
   * вошёл (см. world/shelter.ts). Входят стоя у своих ворот.
   */
  shelter(id: FigureId, on: boolean): Promise<string | null>;

  /**
   * Полководец забирает гарнизон себе или возвращает его. Работает только
   * вплотную к своему поселению: в поле состав войска не меняется.
   * `troops` пусто — вернуть всё домой.
   */
  setGarrison(troops: TroopStack | null): Promise<string | null>;

  /**
   * Полководец бьёт поселение, у которого стоит. Бой считается сразу: он уже
   * дошёл, и защитнику было отпущено всё время, пока фигура шла. Участь города
   * объявляется этим же приказом (`AttackOrder.fate`). Из своего лагеря под этим
   * городом удар — это штурм, и он снимает осаду до боя.
   */
  attack(order: AttackOrder): Promise<AttackResult>;

  /**
   * Полководец садится в осаду под поселением, у которого стоит, и объявляет участь
   * города. Осада ставится тем же окном и теми же часами голода, что и осада ИИ, —
   * реализация одна на обе стороны, и второй у неё быть не должно. У своего же лагеря
   * тот же приказ объявляет участь заново: окно, часы и проходы остаются.
   *
   * Пока лагерь стоит, эта армия занята: увести её можно, но это и есть снятие
   * осады, и сказано об этом должно быть до приказа.
   */
  besiege(fate?: Fate): Promise<string | null>;

  /**
   * Поход на город живого игрока (docs/pvp.md): полководец с дружиной выходит из своего замка, и бой
   * считает сервер в минуту прихода — штурм с ходу (`storm`) или осада лагерем (`siege`). Участь
   * объявляется этим же приказом. null — выступил, иначе причина.
   */
  warMarch(target: SettlementId, mode: 'storm' | 'siege', fate: Fate): Promise<string | null>;

  /**
   * Дела лазутчика против города живого игрока (docs/spy_pvp.md): шанс и гибель считает сервер, цену энергии — мир той
   * же дверью. Меню — `spyMenu`, приказ — `spyRival` с минутой меню: применяются ровно показанные числа. null — пошёл.
   */
  spyMenu(target: SettlementId): Promise<RivalMenu>;
  spyRival(target: SettlementId, deed: RivalDeedId, shownAt: number): Promise<string | null>;

  /**
   * «Дойти и ударить» (решение владельца 06.10.2026): полководец идёт к цели и бьёт в минуту прихода, не дожидаясь
   * игрока, — по логову и по городу игрока одним приказом (город игрока — поход со штурмом с ходу, `warMarch`). Стоит у
   * ворот — бьёт сразу. Что будет до приказа — `SettlementCard.assault`. null — выступил или ударил, иначе причина.
   */
  assault(target: SettlementId, fate: Fate, mode?: AssaultMode): Promise<string | null>;

  /** Снять свою осаду: полководец остаётся, где стоял. null — снята, иначе причина. */
  retreat(): Promise<string | null>;

  /**
   * Поделить древесину своего лагеря: какую долю фронту (одну из `works.WOOD_SHARES`).
   * Вложенное к этой минуте остаётся вложенным.
   */
  setWood(share: number): Promise<string | null>;

  /**
   * Какую долю древесины лагеря отдать осадным машинам (одну из `data/engines.MACHINE_SHARES`; docs/siege_v2.md, 4.3).
   * Вложенное к этой минуте остаётся вложенным — и в рогатках, и в машинах.
   */
  setMachineWood(share: number): Promise<string | null>;

  /** Заказать осадную машину в своём лагере (`world/machines.machineBlock`): строится из древесины машин, очередью. */
  orderMachine(id: MachineId): Promise<string | null>;

  /**
   * Дело полководца в своём лагере (`world/siegecraft`): укрепить лагерь или обстрелять город — за энергию, не больше
   * предела за осаду. Лагерь под логовом — правилом мира, под городом игрока — приказом серверу войны той же дверью.
   * null — сделано, иначе причина.
   */
  campCraft(act: CraftAct): Promise<string | null>;

  /**
   * Наказы своему лагерю на отлучку (docs/siege_v2.md, 8.3): залп каждую фазу, штурм при N проломах. Срабатывают в минуту
   * фазы той же дверью, что ручные приказы. Лагерь под городом игрока — приказом серверу войны. null — поставлены.
   */
  setOrders(orders: SiegeOrders): Promise<string | null>;

  /** Окно осаждающего: наш лагерь под чужим городом. null — лагеря нет. */
  camp(): Promise<CampView | null>;

  /**
   * Вылазка из осаждённой деревни: бой с лагерем тем составом, который выбрал
   * игрок. Не «всё или ничего» — состав приходит приказом.
   *
   * Победа снимает осаду. Поражение её не снимает, но лагерь тоже теряет людей:
   * вылазка без урона противнику была бы чистым минусом, и кнопку никто бы не
   * нажал. В обоих случаях часы голода пересчитываются от нового гарнизона —
   * ровно один раз, здесь, в самом событии.
   */
  sortie(troops: TroopStack): Promise<AttackResult>;

  /**
   * Ответ осаждённого (docs/siege_v2.md, раздел 5): починить пролом, урезать или вернуть паёк, поставить наказы, сдаться.
   * Под логовом — правилом мира, под лагерем игрока — приказом серверу войны той же дверью. null — сделано, иначе причина.
   */
  defend(order: DefendOrder): Promise<string | null>;

  /** Вылазка на машину лагеря (раздел 5): бой с её охраной, победа сжигает машину. Состав приходит приказом. */
  burnMachine(id: MachineId, troops: TroopStack): Promise<AttackResult>;

  /**
   * Пакт с соседом-игроком (раздел 5): `on` — предложить или принять, иначе разорвать, отозвать, отклонить. null — принято,
   * иначе причина.
   */
  pact(castle: SettlementId, on: boolean): Promise<string | null>;

  /** На выручку союзнику в осаде (раздел 5): полководец из поля бьёт лагерь с тыла в минуту прихода. */
  relief(castle: SettlementId): Promise<string | null>;

  /**
   * Где и когда полководец встретит чужой отряд, если приказать сейчас. Точка
   * и время считаются **до подтверждения** и одним уравнением — фоновой работы
   * за перехватом нет (см. world/pursuit.ts). Не догнать — приходит причина.
   */
  interceptPlan(marchId: string): Promise<InterceptPlan>;

  /** Вести полководца на перехват. null — пошёл, иначе текст ошибки. */
  intercept(marchId: string): Promise<string | null>;

  /**
   * Удар по лагерю под поселением `target` до приказа: сколько идти и кто
   * пробьётся к рогаткам в минуту прихода. `garrison` — зовут ли гарнизон из
   * своего города во фронт (только у лагеря под своим городом). Недоступно —
   * приходит причина.
   */
  strikePlan(target: SettlementId, garrison: boolean): Promise<StrikePlan>;

  /**
   * Полководец из поля идёт бить лагерь под `target`: дружина — в тыл, гарнизон,
   * если зовут, — во фронт, бой один, в минуту прихода. Полководец в городе такого
   * приказа не отдаёт: дома его дружина — гарнизон, и её путь за ворота — вылазка.
   * null — пошёл (или уже ударил, если стоял у лагеря), иначе текст ошибки.
   */
  strikeCamp(target: SettlementId, garrison: boolean): Promise<string | null>;

  /** Дипломат подписывает договор с племенем поселения, у которого стоит. */
  negotiate(deal: DealId): Promise<string | null>;

  /**
   * Меню приказов агента по цели: цена, время и шанс — до подтверждения.
   * Недоступное действие возвращается с причиной, а не выбрасывается из списка:
   * игрок обязан видеть, чего ему не хватает. У разведчика и полководца своих
   * приказов пока нет — им список пустой.
   */
  orders(agent: FigureId, target: SettlementId): Promise<OrderOption[]>;

  /**
   * Отдать приказ агенту. Кому какой приказ, знает `ORDER_AGENT`. Ответ —
   * чистая функция от условий дела и зерна: одно и то же предложение при
   * одинаковых условиях даёт один и тот же ответ, и место этой функции потом
   * займёт живой игрок.
   */
  order(action: OrderActionId, target: SettlementId, shownAt?: number): Promise<OrderResult>;

  /**
   * Письма, ждущие решения. Порядок — тот, в каком их разбирают: первым лежит
   * то, что раньше всего разрешится само. Протухшие сюда не попадают: они
   * разрешаются в тот момент, когда на стол посмотрели, а не тиком в стороне.
   */
  letters(): Promise<LetterView[]>;

  /**
   * Ответить на письмо. `lapse` отсюда не принимается: разрешение без игрока —
   * дело мира, а не кнопки, и второго пути к нему быть не должно.
   */
  answerLetter(id: string, answer: Exclude<LetterAnswerId, 'lapse'>): Promise<string | null>;

  /** Договоры, действующие прямо сейчас. */
  deals(): Promise<DealView[]>;

  /** Отчёты о походах и обороне, свежие сверху. */
  reports(): Promise<Report[]>;

  /** Пометить отчёты прочитанными. */
  readReports(): Promise<void>;

  /** Племена и их отношение к игроку. */
  tribes(): Promise<TribeInfo[]>;

  /**
   * Продвинуть мир и забрать изменения. Клиент зовёт по таймеру и передаёт слепок
   * своей деревни: локальный мир иначе не знает, чем игрок обороняется.
   * На сервере эти данные будут его собственными, а вызов останется опросом.
   */
  sync(profile: PlayerProfile): Promise<WorldPulse>;

  /** Сохранить состояние мира (локальная реализация — в localStorage). */
  persist(): Promise<void>;
}

let current: WorldApi | null = null;

export function setWorldApi(api: WorldApi | null): void {
  current = api;
}

export const hasWorldApi = (): boolean => current !== null;

/** Доступ к миру. Бросает, если мир ещё не подключён, — это ошибка порядка запуска. */
export function worldApi(): WorldApi {
  if (!current) throw new Error('Мир ещё не подключён: сначала setWorldApi().');
  return current;
}
