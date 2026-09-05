import type { GameState } from './types';
import { MAX_OFFLINE_SECONDS } from './constants';
import { emptyArmy } from './data/troops';
import { BUILDINGS } from './data/buildings';
import { emptyEquipment } from './data/equipment';
import { createInitialState, SAVE_VERSION } from './state';
import { catchUp } from './sim/tick';
import { normalizeAssignments } from './sim/workers';
import { trimLog } from './sim/log';
import { cloudGet, cloudSet } from '@/telegram/webapp';

const KEY = 'tribe.save.v1';

export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, lastSaved: Date.now() });
}

type SavedState = Partial<GameState> & { version?: number };

/**
 * Читает сохранение текущего формата. Сохранения младших версий не приводятся:
 * в шестой версии население стало числом, и списка поимённых жителей из старой
 * партии девать некуда — возвращаем null, а loadGame говорит игроку, что партия
 * началась заново.
 */
export function deserialize(json: string): GameState | null {
  try {
    const data = JSON.parse(json) as SavedState;
    if (!data || typeof data.pop !== 'number' || data.version !== SAVE_VERSION) return null;
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
      // Назначения — словари счётчиков: их мержить нельзя, иначе исчезнувшее
      // здание оставило бы за собой рабочих. Берём как есть, а порядок наведёт
      // normalizeAssignments ниже.
      workers: { ...(data.workers ?? {}) },
      freeJobs: { ...(data.freeJobs ?? {}) },
      market: { day: 0, bought: {}, ...(data.market ?? {}) },
      caravans: data.caravans ?? [],
      battlePlans: data.battlePlans ?? [],
      stats: { ...base.stats, ...(data.stats ?? {}) },
    } as GameState;
    // Здание, добавленное в BUILDINGS после того, как сохранение записали,
    // должно появиться в посёлке само — так же, как оно появляется в новой партии
    // (CLAUDE.md, «Правила»). Иначе игрок с сохранением остался бы без него
    // навсегда: `buildings` берётся из сохранения как есть, мержить его нельзя —
    // мерж вернул бы и здания, которых в игре больше нет.
    for (const def of BUILDINGS) {
      if (s.buildings.some((b) => b.type === def.id)) continue;
      s.buildings.push({ id: s.nextId++, type: def.id, level: 1, work: 0, workRequired: 0 });
    }
    normalizeAssignments(s);
    // Летопись старого сохранения могла копиться по прежнему правилу «последние
    // 80 записей» и растянуться на полгода игрового времени. Приводим её к тому
    // же месяцу, что и у новой партии, прямо на загрузке.
    trimLog(s);
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
