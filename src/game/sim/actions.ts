// Действия игрока. Каждое возвращает null при успехе или текст ошибки.
import type { GameState } from '../types';
import type { DecreeId, RationId, TaxId } from '../data/policy';
import { DECREE_BY_ID, RATION_BY_ID, TAX_BY_ID } from '../data/policy';
import { FEAST_DAYS } from '../constants';
import {
  buildQueue,
  buildingById,
  decreeBlock,
  feastInfo,
  feastSeconds,
  isSite,
  upgradeCost,
  upgradeInfo,
} from '../derived';
import { BUILDING_BY_ID } from '../data/buildings';
import { cancelShare } from '../labour';
import { log } from './log';
import { outlay, pay, refund } from './pay';
import { daysSpan } from '../span';

export { assignBonded, assignWorker, changeFreeJob, unassignBonded, unassignWorker } from './workers';
export { cancelForge, forgeCheck, startForge } from './smithy';
export { buyGoods, marketCheck, saleCheck, sellGoods } from './market';
export { releaseBonded } from './mutiny';
export { cancelRecruit, startRecruit } from './army';
export { dismissSoldiers } from './upkeep';
export { cancelSurvey, startSurvey, surveyInfo } from './survey';
export { engineInfo, setEngine } from './tower';
export { dailyReward, dailyStatus, finishDaily, startDaily } from './daily';

/**
 * Улучшение — стройка: стоит ресурсов, занимает труд и встаёт в хвост очереди стройки (СТ-1). Цена списывается сразу:
 * очередь — оплаченные заказы, и отмена нетронутого возвращает её целиком (`cancelUpgrade`).
 */
export function startUpgrade(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  const info = upgradeInfo(s, b);
  if (info.blocked) return info.blocked;
  pay(s, info.cost);
  b.work = 0;
  b.workRequired = info.work;
  s.buildQueue = buildQueue(s).map((x) => x.id);
  const place = s.buildQueue.indexOf(b.id) + 1;
  log(s, `Заложили стройку: ${BUILDING_BY_ID[b.type].name.toLowerCase()}, до ур. ${info.level}${place > 1 ? `, в очереди ${place}-й` : ''}.`, 'info', undefined, 'build');
  return null;
}

/**
 * Отменяет улучшение и снимает его с очереди. Начатое (строящееся, на нём есть работа) возвращает половину цены,
 * нетронутое — целиком (`labour.cancelShare`). Возврат не разовое дело описи: сервер выводит положенное сам из очереди
 * описи (`netlify/lib/watch.ts`, docs/ui_v2.md, «Решения СТ-1»), и лишний возврат там — флаг.
 */
export function cancelUpgrade(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  if (!isSite(b)) return 'Здесь ничего не строят.';
  const def = BUILDING_BY_ID[b.type];
  refund(s, upgradeCost(def, b.level + 1), cancelShare(b.work > 0), false);
  b.work = 0;
  b.workRequired = 0;
  s.buildQueue = buildQueue(s).map((x) => x.id);
  log(s, `Стройку остановили: ${def.name.toLowerCase()}.`, 'info', undefined, 'build');
  return null;
}

/**
 * Почему улучшение нельзя сдвинуть в очереди на `dir` (−1 — выше, +1 — ниже); `null` — можно. Первое место меняется,
 * только пока строящееся не начато: начатую работу на другую постройку не перенести, а бросить её — это отмена.
 */
export function moveBlock(s: GameState, buildingId: number, dir: -1 | 1): string | null {
  const q = buildQueue(s);
  const i = q.findIndex((b) => b.id === buildingId);
  if (i < 0) return 'Этого нет в очереди.';
  const j = i + dir;
  if (j < 0) return 'Уже первое.';
  if (j >= q.length) return 'Уже последнее.';
  if ((i === 0 || j === 0) && q[0].work > 0) return 'Строящееся уже начато.';
  return null;
}

/** Сдвинуть улучшение в очереди стройки на одно место: выше (−1) или ниже (+1). */
export function moveUpgrade(s: GameState, buildingId: number, dir: -1 | 1): string | null {
  const why = moveBlock(s, buildingId, dir);
  if (why) return why;
  const ids = buildQueue(s).map((b) => b.id);
  const i = ids.indexOf(buildingId);
  [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
  s.buildQueue = ids;
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
  outlay(s);
  s.feastUntil = s.time + feastSeconds();
  s.feastAt = s.time;
  log(s, `Правитель созвал город на пир, ушло ${info.cost} золота. Мораль +${info.bonus} на ${daysSpan(FEAST_DAYS)}.`, 'good', undefined, 'decree');
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
  // Указ сословия — пока сословие верно (РТ-2): мерка одна с кнопкой «Указов».
  const why = decreeBlock(s, id);
  if (why) return why;
  s.decree = id;
  log(s, `Объявлен указ «${def.name}».`, 'info', undefined, 'decree');
  return null;
}

/** Рацион племени. Тоже переключается когда угодно. */
export function setRation(s: GameState, id: RationId): string | null {
  const def = RATION_BY_ID[id];
  if (!def) return 'Такого пайка нет.';
  if (s.ration === id) return null;
  s.ration = id;
  log(s, `Паёк сменили: «${def.name}».`, 'info', undefined, 'decree');
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
  log(s, `Налог сменили: «${def.name}».`, 'info', undefined, 'decree');
  return null;
}
