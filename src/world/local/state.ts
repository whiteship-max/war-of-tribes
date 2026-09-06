// Изменяемая часть локального мира: походы, разведданные, следы набегов, отношения.
// Всё, что нельзя вывести из сида, живёт здесь и сохраняется в localStorage.
import type { ArmySetup } from '@/battle';
import type { TroopStack } from '@/game/battle/kinds';
import { troopsOfKinds } from '@/game/battle/faces';
import type { FogData } from '../fog';
import type {
  Coord,
  DealId,
  DiploRecord,
  FigureId,
  FigurePhase,
  HomeEffect,
  Intel,
  Relation,
  Stage,
  Loot,
  MarchPhase,
  Mission,
  PlayerProfile,
  Report,
  SettlementId,
  TribeId,
  UnitStack,
} from '../types';

/**
 * Версия 5 — отношения с поселениями: число, состояние (нейтралитет, пакт,
 * война) и характер владельца. Племенная враждебность с самозатуханием при этом
 * исчезла как отдельная величина: она стала производной от отношений, и двух
 * правд об одном не осталось (см. docs/MAP_ACTIONS.md).
 *
 * Четвёрка была про географию: реки, переправы, хребты с перевалами и тракты
 * между станами. Станы племён тогда переехали в `geography.tribeCenters`, то
 * есть при том же сиде поселения встали иначе, — и всё, что старше, по-прежнему
 * приводить не к чему.
 *
 * **Сохранение мира теперь приводится, а не выбрасывается.** Порядок тот же,
 * что у сохранения племени: цепочка ступеней начинается с `MIN_WORLD_SAVE_VERSION`,
 * всё, что старше, читается как «мира нет», и мир генерируется заново.
 */
export const WORLD_SAVE_VERSION = 5;
/** Младше этой версии сохранение мира не приводится: там другой ландшафт. */
export const MIN_WORLD_SAVE_VERSION = 4;
export const WORLD_KEY = 'tribe.world.v1';

export interface StoredMarch {
  id: string;
  /** Сид похода: по нему считается бой, поэтому исход воспроизводим. */
  seed: number;
  mission: Mission;
  units: UnitStack;
  /** Отряд игрока или чужой. */
  own: boolean;
  fromId: SettlementId;
  targetId: SettlementId;
  from: Coord;
  to: Coord;
  fromName: string;
  toName: string;
  departAt: number;
  arriveAt: number;
  phase: MarchPhase;
  /** Ударная мощь на момент выхода. */
  power: number;
  /** Кто именно идёт: без состава бой не знает, чем бить. Пусто у чужих отрядов. */
  troops?: TroopStack;
  /** Расстановка отряда. null — быстрая атака, пресет по сиду похода. */
  setup?: ArmySetup | null;
  loot: Loot | null;
  /** Для поддержки: до какого момента отряд стоит в чужих стенах. */
  stayUntil?: number;
}

/**
 * Фигура в сохранении. Положение не хранится: оно выводится из `from`, `to` и
 * пары времён — поэтому фигура, шедшая, пока игрока не было, оказывается там же,
 * где оказалась бы при непрерывной игре, и догону нечего доигрывать.
 */
export interface StoredFigure {
  phase: FigurePhase;
  from: Coord;
  to: Coord;
  departAt: number;
  arriveAt: number;
  /** До какого момента павшая фигура вне игры. 0 — она в строю. */
  downUntil: number;
  /**
   * До какого момента фигура занята прошлым приказом. 0 — свободна. Приказы
   * конкурируют за её время: агент каждого вида один, и в этом смысл.
   */
  busyUntil?: number;
  /** Войско при полководце. У остальных двоих пусто и появляться не должно. */
  troops?: TroopStack;
}

/**
 * Что игрок в последний раз видел в поселении. Это и есть второй слой тумана:
 * живые данные, снятые в момент, когда клетка была в обзоре. Дальше они не
 * обновляются, а стареют — и показываются с отметкой давности.
 */
export interface Sighting {
  at: number;
  stage: Stage;
  relation: Relation;
  owner: string | null;
  tribeId: TribeId | null;
  pop: number;
  castle: boolean;
}

/** Подписанный договор: до какого момента он в силе и когда платил в последний раз. */
export interface Pact {
  until: number;
  paidAt: number;
}

export interface WorldSave {
  v: number;
  seed: number;
  createdAt: number;
  home: Coord;
  /** Номер следующего похода — из него получается его сид. */
  nextMarch: number;
  marches: StoredMarch[];
  reports: Report[];
  intel: Record<SettlementId, Intel>;
  /** Разбитый гарнизон: доля потерь и когда это было. Со временем отстраивается. */
  damage: Record<SettlementId, { loss: number; at: number }>;
  /** Когда поселение обчистили в последний раз. */
  looted: Record<SettlementId, number>;
  /**
   * Отношения с чужими поселениями: число, состояние и сроки. Племенной
   * враждебности отдельным полем больше нет — она считается отсюда
   * (`LocalWorld.hostilityOf`), иначе об одном и том же было бы две правды.
   */
  diplomacy: Record<SettlementId, DiploRecord>;
  /**
   * Племенная враждебность из сохранения версии 4. Живёт полтора шага: ступень
   * 4 → 5 кладёт её сюда, а разворачивает в отношения поселений `LocalWorld` —
   * только он знает, какие дворы у какого племени. После разворота поле
   * гасится. Другого такого поля заводить не надо.
   */
  legacyHostility?: Record<TribeId, number>;
  allyTribe: TribeId | null;
  nextAiAt: number;
  /** Не доставленные племени последствия. */
  effects: HomeEffect[];
  /** Последний слепок деревни игрока: им обороняется дом, пока игрока нет. */
  profile: PlayerProfile | null;
  /** Когда игрок последний раз выходил на связь. */
  seenAt: number;
  /**
   * Оборона, запертая за пять минут до прихода чужой армии (раздел 8 документа).
   * Latch, а не флаг: слепок деревни приходит каждый пульс, и без него защитник
   * менял бы расстановку до самого удара.
   */
  frozenDefense: { marchId: string; setup: ArmySetup | null } | null;
  /**
   * Разведанная местность битовой маской по кускам (см. fog.ts). Открытое не
   * закрывается никогда, поэтому маска только растёт.
   */
  fog: FogData;
  /** До какого момента туман уже раскрыт: от него считается след фигур за офлайн. */
  fogAt: number;
  /** Живые данные о поселениях на момент последнего взгляда. */
  sightings: Record<SettlementId, Sighting>;
  /** Три фигуры. Их ровно три, и других не бывает. */
  figures: Record<FigureId, StoredFigure>;
  /** Договоры по племенам. */
  pacts: Record<TribeId, Partial<Record<DealId, Pact>>>;
}

export interface WorldStorage {
  read(): string | null;
  write(json: string): void;
}

/** Хранилище по умолчанию. В тестах и на сервере подменяется. */
export const browserStorage: WorldStorage = {
  read() {
    try {
      return localStorage.getItem(WORLD_KEY);
    } catch {
      return null;
    }
  },
  write(json) {
    try {
      localStorage.setItem(WORLD_KEY, json);
    } catch {
      /* localStorage может быть недоступен */
    }
  },
};

export function createWorldSave(seed: number, home: Coord, allyTribe: TribeId | null, now: number): WorldSave {
  return {
    v: WORLD_SAVE_VERSION,
    seed,
    createdAt: now,
    home,
    nextMarch: 1,
    marches: [],
    reports: [],
    intel: {},
    damage: {},
    looted: {},
    diplomacy: {},
    allyTribe,
    nextAiAt: now + 10 * 60_000,
    effects: [],
    profile: null,
    seenAt: now,
    frozenDefense: null,
    fog: {},
    fogAt: now,
    sightings: {},
    figures: {
      scout: homeFigure(home, now),
      diplomat: homeFigure(home, now),
      general: homeFigure(home, now),
    },
    pacts: {},
  };
}

/** Фигура, стоящая дома. Все три начинают партию именно так. */
export function homeFigure(home: Coord, now: number): StoredFigure {
  return {
    phase: 'home',
    from: { ...home },
    to: { ...home },
    departAt: now,
    arriveAt: now,
    downUntil: 0,
  };
}

/**
 * Записи боя, сделанные до того, как в них появился состав по видам бойцов.
 * Версию формата это не поднимает: отчёт и без состава открывается целиком, а
 * поднять её значило бы выбросить мир — чужая версия читается как «мира нет».
 *
 * Что можно восстановить, восстанавливается: роды боя в итоге записаны, и из них
 * тем же правилом выводятся виды. Ступени снаряжения в записи нет и взять её
 * неоткуда, поэтому старый бой показывается самым простым снаряжением — это
 * честнее, чем выдумать латников там, где могли стоять дубинщики.
 */
function fillTroops(reports: Report[]): Report[] {
  let changed = false;
  const out = reports.map((r) => {
    const b = r.battle;
    if (!b || b.troops) return r;
    changed = true;
    return {
      ...r,
      battle: {
        ...b,
        troops: {
          attacker: troopsOfKinds(b.result.sides.attacker.initial),
          defender: troopsOfKinds(b.result.sides.defender.initial),
        },
      },
    };
  });
  return changed ? out : reports;
}

/**
 * Ступени приведения сохранения мира. Каждая правит объект на месте и поднимает
 * его версию на одну: так же, как это сделано у сохранения племени.
 *
 * 4 → 5: племенная враждебность уезжает в `legacyHostility`. Развернуть её в
 * отношения поселений здесь нельзя — тут нет мира и неизвестно, какие дворы у
 * какого племени, — поэтому её разворачивает `LocalWorld` при подключении.
 */
function migrateWorldSave(data: Partial<WorldSave> & { hostility?: Record<TribeId, number> }): void {
  if ((data.v ?? 0) < 5) {
    const old = data.hostility;
    if (old && Object.keys(old).length > 0) data.legacyHostility = old;
    delete data.hostility;
    data.diplomacy = data.diplomacy ?? {};
    data.v = 5;
  }
}

/**
 * Читает сохранение мира. null — его нет, оно испорчено или оно младше
 * `MIN_WORLD_SAVE_VERSION`: тогда мир генерируется заново.
 */
export function parseWorldSave(json: string | null): WorldSave | null {
  if (!json) return null;
  try {
    const data = JSON.parse(json) as Partial<WorldSave>;
    if (!data || typeof data.v !== 'number' || typeof data.seed !== 'number') return null;
    if (data.v < MIN_WORLD_SAVE_VERSION || data.v > WORLD_SAVE_VERSION) return null;
    if (!data.home || typeof data.home.x !== 'number') return null;
    migrateWorldSave(data);
    const base = createWorldSave(data.seed, data.home, data.allyTribe ?? null, data.createdAt ?? Date.now());
    // Словари фигур мержатся отдельно: иначе новая фигура приедет как undefined —
    // ровно та же причина, по которой так мержатся счётчики в сохранении племени.
    const figures = { ...base.figures, ...(data.figures ?? {}) };
    const reports = fillTroops(data.reports ?? base.reports);
    return { ...base, ...data, figures, reports, v: WORLD_SAVE_VERSION };
  } catch {
    return null;
  }
}
