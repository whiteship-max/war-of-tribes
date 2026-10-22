/**
 * Какие здания ушли в объединённые дворы (ЗД-1, docs/city_v3.md, «Решения ЗД-1») — таблица и чтение прежнего типа. Это всё,
 * что о переходе нужно игре в первом куске: старое донесение, весть или выстрел из записи мира называют прежнюю постройку,
 * и её имя — имя двора. Само правило перехода (уровни, стройка, рабочие) — в `game/yardmerge.ts`: партия младше 24-й
 * подгружает его своей докачкой (`save.loadFold`), сервер — как есть. Чистый модуль без `@/`: его читает и сервер.
 */
import type { BuildingTypeId } from './types';
import { BUILDING_BY_ID } from './data/buildings';

/** Ушедшее здание → двор, в который оно вошло. */
export const MERGED_INTO: Readonly<Record<string, BuildingTypeId>> = { pen: 'farm', gathering: 'hunter_hut', quarry: 'mine' };

/** Своё поле таблицы, а не прототипа: тип постройки из записи — чужая строка, и «toString» таблицей не является. */
export const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** Тип постройки, каким его знает игра сейчас: ушедший — его двор, нынешний — он сам, чужой — null. */
export const keptType = (type: string): BuildingTypeId | null =>
  own(MERGED_INTO, type) ?? (own(BUILDING_BY_ID, type) ? (type as BuildingTypeId) : null);

/** Есть ли среди типов ушедшие — значит, запись ещё до перехода. */
export const hasGone = (types: Iterable<string>): boolean => {
  for (const t of types) if (own(MERGED_INTO, t)) return true;
  return false;
};
