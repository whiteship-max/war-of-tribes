import type { Army, Building, BuildingTypeId, GameState, LogEntry, Villager } from './types';
import { MAX_BUILDING_LEVEL, MAX_OFFLINE_SECONDS } from './constants';
import { BUILDING_BY_ID } from './data/buildings';
import { emptyArmy } from './data/troops';
import { emptyEquipment } from './data/equipment';
import { createInitialState, SAVE_VERSION } from './state';
import { catchUp } from './sim/tick';
import { finishTutorial } from './data/tutorial';
import { autoAssign, normalizeAssignments } from './sim/workers';
import { cloudGet, cloudSet } from '@/telegram/webapp';

const KEY = 'tribe.save.v1';

export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, lastSaved: Date.now() });
}

type SavedState = Partial<GameState> & { version?: number };

/**
 * Версия 1 не знала уровней зданий и рабочих мест: у здания было только work/workRequired,
 * а профессия жила сама по себе. Достроенные здания становятся первым уровнем,
 * жители — вольным сбором, а дальше autoAssign рассаживает их по слотам.
 */
function migrateV1(data: SavedState): SavedState {
  const buildings = (data.buildings ?? []).map((b: Building & { level?: number }): Building => {
    const done = b.level !== undefined ? b.level > 0 : b.work >= b.workRequired;
    return {
      id: b.id,
      type: b.type,
      slot: b.slot,
      level: done ? 1 : 0,
      work: done ? 0 : b.work,
      workRequired: done ? 0 : b.workRequired,
    };
  });
  const villagers = (data.villagers ?? []).map((v: Villager): Villager => ({ ...v, workplace: null }));
  return { ...data, version: 2, buildings, villagers };
}

/**
 * Версия 3: каждый тип здания строится ровно один раз. Несколько построек одного типа
 * сводятся в одну, а её уровень — сумма уровней: прежний суммарный эффект при этом не
 * теряется (три хижины первого уровня дают хижину третьего, и мест под крышей становится
 * больше, а не меньше). Игроку об этом пишем в летопись — прогресс не должен пропадать молча.
 */
function migrateV2(data: SavedState): SavedState {
  const groups = new Map<BuildingTypeId, Building[]>();
  for (const b of data.buildings ?? []) {
    const list = groups.get(b.type);
    if (list) list.push(b);
    else groups.set(b.type, [b]);
  }
  const buildings: Building[] = [];
  const log: LogEntry[] = [...(data.log ?? [])];
  for (const [type, list] of groups) {
    const def = BUILDING_BY_ID[type];
    if (!def) continue;
    if (list.length === 1) {
      buildings.push(list[0]);
      continue;
    }
    const level = Math.min(def.maxLevel ?? MAX_BUILDING_LEVEL, list.reduce((n, b) => n + b.level, 0));
    // Оставляем самую развитую постройку: за ней уже закреплено место на карте.
    const keep = [...list].sort((a, b) => b.level - a.level)[0];
    // Если ни одна не была достроена, сливаем и стройки — берём ту, что дальше продвинулась.
    const site = level === 0 ? list.reduce((a, b) => (b.work > a.work ? b : a)) : null;
    buildings.push({
      id: keep.id,
      type,
      slot: keep.slot,
      level,
      work: site ? site.work : 0,
      workRequired: site ? site.workRequired : 0,
    });
    log.push({
      at: data.time ?? 0,
      text: `${def.name}: ${list.length} постройки свели в одну, уровень ${level}.`,
      kind: 'info',
    });
  }
  return { ...data, version: 3, buildings, log };
}

/**
 * Версия 4: роль «воин» исчезла из списка профессий — армия стала счётчиком бойцов.
 * Каждый житель-воин становится дубинщиком: он и был бойцом без снаряжения.
 * Заодно здания переезжают на свои места по фиксированному плану посёлка —
 * место теперь выводится из типа здания, а не подбирается свободным слотом.
 */
function migrateV3(data: SavedState): SavedState {
  const army: Army = { ...emptyArmy(), ...(data.army ?? {}) };
  const villagers: Villager[] = [];
  let drafted = 0;
  for (const v of data.villagers ?? []) {
    // 'warrior' больше нет в JobId, но в старом сохранении он лежит строкой.
    if ((v.job as string) === 'warrior') {
      drafted++;
      continue;
    }
    villagers.push(v.talent && (v.talent as string) === 'warrior' ? { ...v, talent: null } : v);
  }
  army.clubman += drafted;
  const log: LogEntry[] = [...(data.log ?? [])];
  if (drafted > 0) {
    log.push({
      at: data.time ?? 0,
      text: `Воины ушли в казармы: ${drafted} ${drafted === 1 ? 'человек' : 'человека'} стали дубинщиками.`,
      kind: 'info',
    });
  }
  log.push({
    at: data.time ?? 0,
    text: 'Посёлок перестроили: у каждого здания теперь своё место в кольцах вокруг площади.',
    kind: 'info',
  });
  return { ...data, version: 4, villagers, army, log };
}

/** Подтягивает сохранение до текущего формата по шагам: 1 → 2 → 3 → 4. */
function migrate(data: SavedState): SavedState | null {
  let d = data;
  if (d.version === 1) d = migrateV1(d);
  if (d.version === 2) d = migrateV2(d);
  if (d.version === 3) d = migrateV3(d);
  return d.version === SAVE_VERSION ? d : null;
}

export function deserialize(json: string): GameState | null {
  try {
    const raw = JSON.parse(json) as SavedState;
    if (!raw || !Array.isArray(raw.villagers)) return null;
    const data = raw.version === SAVE_VERSION ? raw : migrate(raw);
    if (!data) return null;
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
      stats: { ...base.stats, ...(data.stats ?? {}) },
    } as GameState;
    // Обучение появилось позже формата: в старом сохранении его полей нет, а игрок
    // там уже освоился — начинать проводку первых шагов заново незачем.
    if (data.tutorialStep === undefined) finishTutorial(s);
    if (raw.version !== SAVE_VERSION) autoAssign(s);
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
  if (!state) return { state: createInitialState(), offlineSeconds: 0, fresh: true };

  const elapsed = Math.max(0, Math.floor((Date.now() - state.lastSaved) / 1000));
  const offline = Math.min(elapsed, MAX_OFFLINE_SECONDS);
  if (offline > 5) catchUp(state, offline, 2);
  return { state, offlineSeconds: offline, fresh: false };
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
