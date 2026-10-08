// Скорость обучения войска от уровня здания — одна формула на казармы и конюшню игры (`derived.recruitRate`) и на книгу
// войска сервера (`netlify/lib/book.ts`, docs/pvp.md, раздел 6): сервер подтверждает новобранцев не быстрее, чем их
// выучило бы здание этого уровня. Две формулы разошлись бы молча — сервер резал бы честное войско или пропускал
// поддельное, — поэтому вторую не заводить. Без `@/`-импортов: модуль читает серверная часть.
import type { BuildingTypeId } from './types';
import { RECRUIT_WORK } from './constants';
import { levelOutputMult } from './selfcost';
import { BUILDING_BY_ID, type BuildingStats } from './data/buildings';

/**
 * Пассивный эффект здания этого типа на этом уровне: база + прибавка за каждый уровень сверх того, с которого эффект
 * вообще появляется (`since`). `derived.buildingStat` — то же для стоящего здания.
 */
export function statAt(type: BuildingTypeId, key: keyof BuildingStats, level: number): number {
  const def = BUILDING_BY_ID[type];
  const base = def[key] ?? 0;
  if (base === 0) return 0;
  const from = def.since?.[key] ?? 1;
  if (level < from) return 0;
  return base + (def.perLevel?.[key] ?? 0) * (level - from);
}

/**
 * Работа обучения в игровую секунду у здания уровня `level`: казармы — для пеших, конюшня — для конных, с прибавкой
 * конюшни (`train`, процентами). Уровень 0 — здания нет, учить некому.
 */
export function trainRateAt(mounted: boolean, level: number): number {
  if (level <= 0) return 0;
  const base = RECRUIT_WORK * level * levelOutputMult(level);
  return mounted ? base * (1 + statAt('stable', 'train', level) / 100) : base;
}
