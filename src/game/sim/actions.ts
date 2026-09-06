// Действия игрока. Каждое возвращает null при успехе или текст ошибки.
import type { GameState, JobId, ResourceId, PatronId } from '../types';
import type { DecreeId, RationId, TaxId } from '../data/policy';
import { DECREE_BY_ID, RATION_BY_ID, TAX_BY_ID } from '../data/policy';
import { FEAST_DAYS, RESOURCE_IDS } from '../constants';
import type { UnitKind } from '@/battle';
import {
  buildingById,
  feastInfo,
  feastSeconds,
  heroInfo,
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
import { recordSpent } from '@/profile/stats';

export { assignWorker, changeFreeJob, unassignWorker } from './workers';
export { setForging } from './smithy';
export { buyGoods, cancelCaravan, marketCheck } from './market';
export { cancelRecruit, startRecruit } from './army';
export { dailyReward, dailyStatus, finishDaily, startDaily } from './daily';

function pay(s: GameState, cost: Partial<Record<ResourceId, number>>): void {
  for (const r of RESOURCE_IDS) s.resources[r] -= cost[r] ?? 0;
  recordSpent(s, cost);
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

/**
 * Покровитель племени. Развилка одноразовая и необратимая — одна из немногих в
 * игре: выбрать второй раз нельзя ни за какие деньги.
 */
export function choosePatron(s: GameState, patron: PatronId): string | null {
  if (s.patron) return 'Покровитель уже выбран.';
  s.patron = patron;
  const names: Record<PatronId, string> = { wolf: 'Волка', bear: 'Медведя', eagle: 'Орла' };
  log(s, `Племя приняло покровителя — ${names[patron]}.`, 'good');
  return null;
}

/**
 * Сменить роду войск, который ведёт герой. Плата — золото по числу ртов: развилка
 * не одноразовая (в отличие от покровителя), но и не бесплатная, иначе род
 * подбирался бы под каждый поход и выбор перестал бы что-то значить.
 */
export function setHeroKind(s: GameState, kind: UnitKind): string | null {
  if (s.hero.kind === kind) return null;
  const info = heroInfo(s);
  if (info.blocked) return info.blocked;
  s.gold -= info.retrainCost;
  s.hero.kind = kind;
  log(s, `${s.hero.name} встал во главе другого рода. Плата — ${info.retrainCost} золота.`);
  return null;
}

/**
 * Пир в трактире: золото в мораль. Единственный быстрый рычаг настроения —
 * всё остальное (указ, рацион, налог) двигает его медленно и надолго. Плата
 * снимается сразу и целиком, отмены нет: пир уже съеден.
 */
export function throwFeast(s: GameState): string | null {
  const info = feastInfo(s);
  if (info.blocked) return info.blocked;
  s.gold -= info.cost;
  s.feastUntil = s.time + feastSeconds();
  s.feastAt = s.time;
  log(s, `Трактир: пир на всё племя за ${info.cost} золота. Мораль +${info.bonus} на ${FEAST_DAYS} дн.`, 'good');
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
