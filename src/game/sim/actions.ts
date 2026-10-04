// Действия игрока. Каждое возвращает null при успехе или текст ошибки.
import type { GameState } from '../types';
import type { DecreeId, RationId, TaxId } from '../data/policy';
import { DECREE_BY_ID, RATION_BY_ID, TAX_BY_ID } from '../data/policy';
import { FEAST_DAYS } from '../constants';
import {
  buildingById,
  feastInfo,
  feastSeconds,
  isSite,
  upgradeCost,
  upgradeInfo,
} from '../derived';
import { BUILDING_BY_ID } from '../data/buildings';
import { log } from './log';
import { pay, refund } from './pay';
import { daysSpan } from '../span';

export { assignBonded, assignWorker, changeFreeJob, unassignBonded, unassignWorker } from './workers';
export { cancelForge, forgeCheck, startForge } from './smithy';
export { buyGoods, cancelCaravan, marketCheck, saleCheck, sellBonded } from './market';
export { releaseBonded } from './mutiny';
export { cancelRecruit, startRecruit } from './army';
export { dismissSoldiers } from './upkeep';
export { cancelSurvey, startSurvey, surveyInfo } from './survey';
export { engineInfo, setEngine } from './tower';
export { dailyReward, dailyStatus, finishDaily, startDaily } from './daily';

/** Улучшение — стройка: стоит ресурсов, занимает труд и идёт в общей очереди. */
export function startUpgrade(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const info = upgradeInfo(s, b);
  if (info.blocked) return info.blocked;
  pay(s, info.cost);
  b.work = 0;
  b.workRequired = info.work;
  log(s, `Стройка: ${BUILDING_BY_ID[b.type].name} до ур. ${info.level}.`);
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

// Ответ на событие живёт у двери, закрывающей событие: у неё два повода —
// ответ и молчание, — и второй не должен расходиться с первым (`sim/mail`).
export { resolveEvent } from './mail';

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
  log(s, `Пир для всего города за ${info.cost} золота. Мораль +${info.bonus} на ${daysSpan(FEAST_DAYS)}.`, 'good');
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
  log(s, `Указ: ${def.name.toLowerCase()}.`);
  return null;
}

/** Рацион племени. Тоже переключается когда угодно. */
export function setRation(s: GameState, id: RationId): string | null {
  const def = RATION_BY_ID[id];
  if (!def) return 'Такого пайка нет.';
  if (s.ration === id) return null;
  s.ration = id;
  log(s, `Паёк: ${def.name.toLowerCase()}.`);
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
