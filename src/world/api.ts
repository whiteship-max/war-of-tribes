// Единственная точка доступа к миру. Экраны знают только этот интерфейс.
//
// Сейчас за ним стоит LocalWorld: мир генерируется и живёт на клиенте.
// Когда появится сервер, рядом встанет HttpWorld с теми же сигнатурами, и ни один
// компонент интерфейса переписывать не придётся. Поэтому все методы асинхронные,
// даже те, что сегодня отвечают мгновенно.
import type { TroopStack } from '@/game/battle/kinds';
import type {
  AttackOrder,
  AttackResult,
  DealId,
  DealView,
  FigureId,
  FigureView,
  IntelReading,
  MarchOrder,
  MarchView,
  PlayerProfile,
  Coord,
  Rect,
  RegionChunk,
  Report,
  SendResult,
  SettlementCard,
  SettlementId,
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

  /** Три фигуры игрока: где они, что при них, когда придут. */
  figures(): Promise<FigureView[]>;

  /** Вести фигуру в клетку. null — пошла, иначе текст ошибки. */
  moveFigure(id: FigureId, to: Coord): Promise<string | null>;

  /** Развернуть фигуру домой. Обратный путь считается по уже пройденному. */
  recallFigure(id: FigureId): Promise<string | null>;

  /**
   * Полководец забирает гарнизон себе или возвращает его. Работает только
   * вплотную к своему поселению: в поле состав войска не меняется.
   * `troops` пусто — вернуть всё домой.
   */
  setGarrison(troops: TroopStack | null): Promise<string | null>;

  /**
   * Полководец бьёт поселение, у которого стоит. Бой считается сразу: он уже
   * дошёл, и защитнику было отпущено всё время, пока фигура шла.
   */
  attack(order: AttackOrder): Promise<AttackResult>;

  /** Дипломат подписывает договор с племенем поселения, у которого стоит. */
  negotiate(deal: DealId): Promise<string | null>;

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
