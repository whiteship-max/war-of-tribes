// Изменяемая часть локального мира: походы, разведданные, следы набегов, отношения.
// Всё, что нельзя вывести из сида, живёт здесь и сохраняется в localStorage.
import type {
  Coord,
  HomeEffect,
  Intel,
  Loot,
  MarchPhase,
  Mission,
  PlayerProfile,
  Report,
  SettlementId,
  TribeId,
  UnitStack,
} from '../types';

/** Версия 2 — новый старт партии: мир прежних сохранений отбрасывается вместе с ними. */
export const WORLD_SAVE_VERSION = 2;
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
  loot: Loot | null;
  /** Для поддержки: до какого момента отряд стоит в чужих стенах. */
  stayUntil?: number;
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
    return { ...base, ...data, v: WORLD_SAVE_VERSION };
  } catch {
    return null;
  }
}
