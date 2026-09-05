// Изменяемая часть локального мира: походы, разведданные, следы набегов, отношения.
// Всё, что нельзя вывести из сида, живёт здесь и сохраняется в localStorage.
import type { ArmySetup } from '@/battle';
import type { TroopStack } from '@/game/battle/kinds';
import type { FogData } from '../fog';
import type {
  Coord,
  DealId,
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
 * Версия 3 — туман войны и три фигуры на карте. Мир прежних сохранений
 * отбрасывается: разведанной местности в них нет, и вывести её задним числом
 * неоткуда — открыт был весь мир.
 */
export const WORLD_SAVE_VERSION = 3;
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
  hostility: Record<TribeId, number>;
  /** Момент, до которого враждебность уже спала. */
  hostilityAt: number;
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
    hostility: {},
    hostilityAt: now,
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

/** Читает сохранение мира. null — его нет или оно от другого формата. */
export function parseWorldSave(json: string | null): WorldSave | null {
  if (!json) return null;
  try {
    const data = JSON.parse(json) as Partial<WorldSave>;
    if (!data || data.v !== WORLD_SAVE_VERSION || typeof data.seed !== 'number') return null;
    if (!data.home || typeof data.home.x !== 'number') return null;
    const base = createWorldSave(data.seed, data.home, data.allyTribe ?? null, data.createdAt ?? Date.now());
    // Словари фигур мержатся отдельно: иначе новая фигура приедет как undefined —
    // ровно та же причина, по которой так мержатся счётчики в сохранении племени.
    const figures = { ...base.figures, ...(data.figures ?? {}) };
    return { ...base, ...data, figures, v: WORLD_SAVE_VERSION };
  } catch {
    return null;
  }
}
