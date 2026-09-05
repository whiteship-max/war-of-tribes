// Действия игрока. Каждое возвращает null при успехе или текст ошибки.
import type { GameState, JobId, ResourceId, TotemId } from '../types';
import type { DecreeId, RationId, TaxId } from '../data/policy';
import { DECREE_BY_ID, RATION_BY_ID, TAX_BY_ID } from '../data/policy';
import { RESOURCE_IDS } from '../constants';
import {
  buildingById,
  isSite,
  storageCap,
  upgradeCost,
  upgradeInfo,
} from '../derived';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENT_BY_ID } from '../data/events';
import { JOB_BY_ID } from '../data/jobs';
import { scheduleNextEvent } from './tick';
import { log } from './log';

export { assignWorker, changeFreeJob, unassignWorker } from './workers';
export { setForging } from './smithy';
export { buyGoods, cancelCaravan, marketCheck } from './market';
export { cancelRecruit, startRecruit } from './army';

function pay(s: GameState, cost: Partial<Record<ResourceId, number>>): void {
  for (const r of RESOURCE_IDS) s.resources[r] -= cost[r] ?? 0;
}

/** Возвращает долю потраченного на улучшение обратно на склад. */
function refund(s: GameState, cost: Partial<Record<ResourceId, number>>, k: number): void {
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = cost[r];
    if (n) s.resources[r] = Math.min(cap, s.resources[r] + Math.floor(n * k));
  }
}

/** Улучшение — стройка: стоит ресурсов, занимает труд и идёт в общей очереди. */
export function startUpgrade(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const info = upgradeInfo(s, b);
  if (info.blocked) return info.blocked;
  pay(s, info.cost);
  b.work = 0;
  b.workRequired = info.work;
  log(s, `Начато улучшение: ${BUILDING_BY_ID[b.type].name} до ${info.level} уровня.`);
  return null;
}

/** Отменяет улучшение. Начатую работу возвращают наполовину, нетронутую — целиком. */
export function cancelUpgrade(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  if (!isSite(b)) return 'Здесь ничего не строят.';
  const def = BUILDING_BY_ID[b.type];
  refund(s, upgradeCost(def, b.level + 1), b.work === 0 ? 1 : 0.5);
  b.work = 0;
  b.workRequired = 0;
  log(s, `Улучшение отменено: ${def.name}.`);
  return null;
}

export function resolveEvent(s: GameState, optionIndex: number): { error: string | null; result: string | null } {
  if (!s.activeEvent) return { error: 'Нет активного события.', result: null };
  const def = EVENT_BY_ID[s.activeEvent.defId];
  const opt = def?.options[optionIndex];
  if (!opt) return { error: 'Неверный выбор.', result: null };
  const result = opt.apply(s);
  s.activeEvent = null;
  s.stats.eventsResolved++;
  scheduleNextEvent(s);
  log(s, `${def.title}: ${result}`);
  return { error: null, result };
}

export function chooseTotem(s: GameState, totem: TotemId): string | null {
  if (s.totem) return 'Тотем уже выбран.';
  s.totem = totem;
  const names: Record<TotemId, string> = { wolf: 'Волка', bear: 'Медведя', eagle: 'Орла' };
  log(s, `Племя приняло тотем ${names[totem]}.`, 'good');
  return null;
}

/**
 * Указ вождя. Переключается в любой момент и действует, пока выбран:
 * ни срока, ни платы за смену — цена написана прямо на кнопке.
 */
export function setDecree(s: GameState, id: DecreeId): string | null {
  const def = DECREE_BY_ID[id];
  if (!def) return 'Такого указа нет.';
  if (s.decree === id) return null;
  s.decree = id;
  log(s, `Указ вождя: ${def.name.toLowerCase()}.`);
  return null;
}

/** Рацион племени. Тоже переключается когда угодно. */
export function setRation(s: GameState, id: RationId): string | null {
  const def = RATION_BY_ID[id];
  if (!def) return 'Такого рациона нет.';
  if (s.ration === id) return null;
  s.ration = id;
  log(s, `Рацион: ${def.name.toLowerCase()}.`);
  return null;
}

/**
 * Уровень налога. Третий переключатель ратуши и единственный источник золота
 * в мирной жизни.
 */
export function setTax(s: GameState, id: TaxId): string | null {
  const def = TAX_BY_ID[id];
  if (!def) return 'Такого налога нет.';
  if (s.tax === id) return null;
  s.tax = id;
  log(s, `Налог: ${def.name.toLowerCase()}.`);
  return null;
}

export const jobName = (job: JobId): string => JOB_BY_ID[job].name;
