// Путь меча докачкой (ПН-5, хвост а; docs/gdd/path_of_sword.md, 0.4; docs/handbook/bundle.md).
//
// С 30.10.2026 выключатель пути — правило по игроку (`roamflag.roamOn`: админам открыт, игрокам закрыт), а слово «админ» приходит
// от сервера на ходу. Сборщик больше не может выбросить ветки пути по константе, и шаг, чтение, обоз, дух и указ отряда легли в
// первую загрузку всем (+5.7 КБ). Поэтому код пути живёт своим куском (`game/roamdoor`), а главный кусок знает только этот реестр:
//   — `roamDoor()` — кусок, если путь открыт этому игроку и кусок уже докачан; иначе `null`, и ветки пути спят;
//   — `loadRoamDoor()` — докачать кусок; качает его только тот, кому путь открыт: слово сервера об админе (`net/admin`), чтение
//     партии бродяги (`save.readyToRead`), вход в путь со стартового экрана (`store.beginRoamParty`).
// Партия в фазе бродяги бывает только у того, у кого кусок уже есть: читает её из сохранения только кусок (`mergeRoam`), а входит в
// путь только он же (`beginRoam`). Своих правил у реестра нет — двери прежние, они лишь переехали в кусок (`sim/roam`, `sim/cargo`,
// `sim/bandspirit`, `sim/bandgrant`, `net/bandseat`).
import type { AdminGrant, BandOrder, BandRow, RosterResponse } from '../../netlify/lib/contract';
import type { GameState, ResourceId, RoamState } from './types';
import type { SpiritIn } from './spiritrules';
import type { RoamMove } from '../world/roammove';
import { roamOn } from './roamflag';

/**
 * Двери пути, которые зовёт главный кусок, — их отдаёт кусок `game/roamdoor` при загрузке. Тип — здесь, а не выводом из куска:
 * реестр собирает и сборка сервера (через двери склада и духа), а кусок тянет сетевые модули игры, которых у сервера нет.
 */
export interface RoamDoor {
  /**
   * Шаг отряда кусками (`sim/roam.roamFor`; зовут `sim/tick.liveStep`, `absence`); `now` — настоящая минута конца окна (постой и учения
   * у города, ПН-6).
   */
  roamFor(s: GameState, dt: number, step: number, now?: number): void;
  /** Вести отряда на сетке почты за окно `from`…`now` (ПН-6: «Просятся в отряд», `sim/bandasks.bandMailArrive`). */
  roamMail(s: GameState, from: number, now: number): void;
  /** Фаза и отряд из сохранения (`sim/roam.mergeRoam`; зовёт `save.deserialize`). */
  mergeRoam(saved: unknown): Pick<GameState, 'phase' | 'roam'>;
  /** Запись хода одной дверью (`sim/roam.setMove`) и её разбор (`world/roammove.readMove`) — строка, которую вывел сервер. */
  setMove(s: GameState, m: RoamMove): string | null;
  readMove(v: unknown): RoamMove | null;
  /** Новая партия `s` бродягой — Воином (`sim/roam.beginRoam`; зовёт `store.beginRoamParty`). */
  startRoam(s: GameState, was: GameState): string | null;
  /** Обоз — ключ `cargo` двери склада (`sim/cargo.addCargo`; зовёт `sim/stock.addStock`). */
  addCargo(s: GameState, r: ResourceId, n: number, cap: number): number;
  /** Дух отряда — входы отряда двери духа (`sim/bandspirit`; зовёт `sim/spirit.spiritIn`). */
  bandSpiritIn(s: GameState, r: RoamState): SpiritIn;
  /** Указ админа отряду (`sim/bandgrant`; зовёт `sim/admin.applyGrants`). */
  toBand(s: GameState, band: RoamState, g: AdminGrant): string[];
  /** Строка отряда в реестр (`net/bandseat`; провайдер стора для `net/roster`). */
  bandSeatOf(s: GameState): Extract<BandOrder, { op: 'seat' }> | null;
  /** Ответ реестра: строка отряда и видимость (`net/bandroster`; зовёт `net/roster.keep`), встал ли отряд. */
  keepRoster(res: RosterResponse): void;
  bandRow(): BandRow | null;
  /** Очередь приказов книги отряда серверу (ПН-6, `net/bandbook`) — зовёт реестр перед отметкой отряда. */
  flushBook(): Promise<void>;
  /** Лечение отряда за алмазы (ПН-6, `sim/bandwounds.healBand`; зовёт `sim/gems.applyGemDeeds`): сколько встало. */
  healBand(s: GameState, until: number): number;
}

let door: RoamDoor | null = null;
let loading: Promise<RoamDoor> | null = null;

/** Кусок пути отдал свои двери — зовёт сам кусок при загрузке (и тест, который его импортирует). */
export const provideRoamDoor = (d: RoamDoor): void => {
  door = d;
};

/** Двери пути, если путь открыт этому игроку и кусок уже здесь; иначе `null`. */
export const roamDoor = (): RoamDoor | null => (roamOn() ? door : null);

/**
 * Куда кусок пути отдаёт строку отряда, которую вывел сервер (`net/bandroster`): партия кладёт её одной дверью хода. Сток отдаёт стор
 * (`store.init`) — кусок стора не знает, иначе тянул бы его в сборку сервера.
 */
let rowSink: ((row: BandRow) => void) | null = null;
export const provideBandSink = (fn: (row: BandRow) => void): void => {
  rowSink = fn;
};
export const bandSink = (): ((row: BandRow) => void) | null => rowSink;

/**
 * Чем докачать кусок: `() => import('./roamdoor')` отдаёт игра на запуске (`net/admin`) — сам реестр куска не импортирует, иначе
 * сборка сервера пошла бы за ним в сетевые модули игры.
 */
let loader: (() => Promise<{ ROAM_DOOR: RoamDoor }>) | null = null;
export const provideRoamLoader = (fn: () => Promise<{ ROAM_DOOR: RoamDoor }>): void => {
  loader = fn;
};

/** Докачать кусок пути — только тому, кому путь открыт. Повтор — тот же. */
export function loadRoamDoor(): Promise<RoamDoor | null> {
  if (!roamOn()) return Promise.resolve(null);
  if (door) return Promise.resolve(door);
  if (!loader) return Promise.resolve(null);
  return (loading ??= loader().then((m) => m.ROAM_DOOR));
}
