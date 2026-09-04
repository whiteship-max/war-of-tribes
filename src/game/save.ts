import type { GameState } from './types';
import { MAX_OFFLINE_SECONDS } from './constants';
import { emptyArmy } from './data/troops';
import { emptyEquipment } from './data/equipment';
import { createInitialState, SAVE_VERSION } from './state';
import { catchUp } from './sim/tick';
import { normalizeAssignments } from './sim/workers';
import { cloudGet, cloudSet } from '@/telegram/webapp';

const KEY = 'tribe.save.v1';

export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, lastSaved: Date.now() });
}

type SavedState = Partial<GameState> & { version?: number };

/**
 * Читает сохранение текущего формата. Сохранения младших версий не приводятся:
 * в них партия шла от костра через эпохи и технологии, и к новому старту в
 * позднем средневековье её не перевести честно — возвращаем null, а loadGame
 * говорит игроку, что партия началась заново.
 */
export function deserialize(json: string): GameState | null {
  try {
    const data = JSON.parse(json) as SavedState;
    if (!data || !Array.isArray(data.villagers) || data.version !== SAVE_VERSION) return null;
    const base = createInitialState();
    // Простое слияние: новые поля из createInitialState, остальное из сохранения.
    const s = {
      ...base,
      ...data,
      version: SAVE_VERSION,
      resources: { ...base.resources, ...(data.resources ?? {}) },
      // Снаряжение и армия — такие же словари счётчиков: новый вид бойца или
      // предмета не должен приезжать из сохранения как undefined.
      equipment: { ...emptyEquipment(), ...(data.equipment ?? {}) },
      army: { ...emptyArmy(), ...(data.army ?? {}) },
      recruits: data.recruits ?? [],
      market: { day: 0, bought: {}, ...(data.market ?? {}) },
      caravans: data.caravans ?? [],
      battlePlans: data.battlePlans ?? [],
      stats: { ...base.stats, ...(data.stats ?? {}) },
    } as GameState;
    normalizeAssignments(s);
    return s;
  } catch {
    return null;
  }
}

export async function saveGame(s: GameState): Promise<void> {
  const json = serialize(s);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* localStorage может быть недоступен */
  }
  await cloudSet(KEY, json);
}

export interface LoadResult {
  state: GameState;
  offlineSeconds: number;
  fresh: boolean;
  /** Сохранение было, но старого формата: его отбросили и начали новую партию. */
  legacy: boolean;
}

export async function loadGame(): Promise<LoadResult> {
  let json: string | null = null;
  try {
    json = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const cloud = await cloudGet(KEY);
  // Берём более свежее сохранение.
  const pickNewer = (a: string | null, b: string | null): string | null => {
    if (!a) return b;
    if (!b) return a;
    const ta = deserialize(a)?.lastSaved ?? 0;
    const tb = deserialize(b)?.lastSaved ?? 0;
    return tb > ta ? b : a;
  };
  const chosen = pickNewer(json, cloud);
  const state = chosen ? deserialize(chosen) : null;
  if (!state) {
    // Что-то лежало, но прочитать это нельзя — старый формат. Молча стирать
    // прогресс нельзя: игроку об этом скажет отдельное окно.
    const legacy = Boolean(json || cloud);
    if (legacy) clearSave();
    return { state: createInitialState(), offlineSeconds: 0, fresh: true, legacy };
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - state.lastSaved) / 1000));
  const offline = Math.min(elapsed, MAX_OFFLINE_SECONDS);
  if (offline > 5) catchUp(state, offline, 2);
  return { state, offlineSeconds: offline, fresh: false, legacy: false };
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
