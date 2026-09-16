// Действия игрока. Каждое возвращает null при успехе или текст ошибки.
import type { GameState } from '../types';
import type { DecreeId, RationId, TaxId } from '../data/policy';
import { DECREE_BY_ID, RATION_BY_ID, TAX_BY_ID } from '../data/policy';
import { FEAST_DAYS } from '../constants';
import type { UnitKind } from '@/battle';
import {
  buildingById,
  feastInfo,
  feastSeconds,
  heroInfo,
  isSite,
  upgradeCost,
  upgradeInfo,
} from '../derived';
import { BUILDING_BY_ID } from '../data/buildings';
import { EVENT_BY_ID, eventBlock, payEventCost } from '../data/events';
import { scheduleNextEvent } from './tick';
import { log } from './log';
import { pay, refund } from './pay';
import { personName } from './agents';

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
  // Цена списывается здесь, до `apply`, и отказ приходит отсюда же. Раньше
  // каждый вариант брал со склада сам, а «хватает ли» никто не спрашивал:
  // не хватило — молча платили тем, что было, и получали полную награду.
  // Теперь цена одна на показ, на запрет и на списание.
  const block = eventBlock(opt, s);
  if (block) return { error: block, result: null };
  payEventCost(opt, s);
  const result = opt.apply(s);
  s.activeEvent = null;
  s.stats.eventsResolved++;
  scheduleNextEvent(s);
  log(s, `${def.title}: ${result}`);
  return { error: null, result };
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
  log(s, `${personName(s, 'general')} встал во главе другого рода. Плата — ${info.retrainCost} золота.`);
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
