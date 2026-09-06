// Кузница. Игрок **заказывает**: десять мечей — кузница делает десять и встаёт.
//
// Раньше здесь стоял наряд: выбрал копьё — куют копья, пока не снимешь. Это
// звучало удобно, а работало так, что кузница либо ковала ненужное, либо молча
// упиралась в пустой склад посреди дела. Заказ лечит и то, и другое:
//
// 1. **Ресурсы списываются при постановке**, а не по одному предмету. Заказ,
//    вставший на пятом мече из-за кончившегося железа, — это потерянные часы, о
//    которых игрок узнаёт, вернувшись. Заплатив вперёд, он получает обещание.
// 2. **Очередь, а не один наряд**: остаток работы после последнего предмета
//    переходит следующему заказу — ровно как в казармах.
// 3. **Кузница встаёт, и это видно.** Заказы кончились — гаснет горн в сцене,
//    и над крышей появляется маркер внимания (`buildingAttention`). Не заметил —
//    потерял часы, поэтому молчаливого простоя быть не должно.
//
// Скорость по-прежнему берётся у кузнецов (`forgeRate`): заказ — это обещание
// сделать всё, а не обещание сделать быстро. Снял людей с горна — заказ стоит,
// и панель об этом пишет. Офлайн заказ доводит `catchUp`, поэтому вернувшийся
// через четыре часа застаёт готовое, а не первый меч.
import type { EquipmentId, ForgeOrder, GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { EQUIPMENT_BY_ID, type EquipmentDef } from '../data/equipment';
import { canAfford, forgeRate, storageCap } from '../derived';
import type { SeasonModifiers } from '../data/seasons';
import { log } from './log';
import { recordSpent } from '@/profile/stats';

/** Сколько ресурсов стоит партия предметов. */
export function forgeCost(item: EquipmentId, count: number): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  const def = EQUIPMENT_BY_ID[item];
  if (!def) return out;
  for (const r of RESOURCE_IDS) if (def.cost[r]) out[r] = (def.cost[r] as number) * count;
  return out;
}

export interface ForgeCheck {
  def: EquipmentDef;
  count: number;
  cost: Partial<Record<ResourceId, number>>;
  /** Работа кузнецов на всю партию. */
  work: number;
  /** Секунд на всю партию; null — кузница стоит. */
  eta: number | null;
  /** Почему нельзя; null — можно. */
  blocked: string | null;
}

/** Всё, что нужно знать до заказа: цена, время и причина отказа. */
export function forgeCheck(s: GameState, item: EquipmentId, count: number): ForgeCheck {
  const def = EQUIPMENT_BY_ID[item];
  const n = Math.max(1, Math.floor(count));
  const cost = forgeCost(item, n);
  const work = def.work * n;
  const rate = forgeRate(s);
  let blocked: string | null = null;
  if (!canAfford(s, cost)) blocked = 'Не хватает материалов на весь заказ.';
  return { def, count: n, cost, work, eta: rate > 0 ? Math.ceil(work / rate) : null, blocked };
}

/**
 * Ставит заказ в очередь кузницы. Плата снимается сразу — как за стройку и как
 * за набор в казармах: на складе её больше нет, зато заказ уже не встанет.
 */
export function startForge(s: GameState, item: EquipmentId, count = 1): string | null {
  if (!EQUIPMENT_BY_ID[item]) return 'Такого снаряжения нет.';
  const check = forgeCheck(s, item, count);
  if (check.blocked) return check.blocked;
  for (const r of RESOURCE_IDS) s.resources[r] -= check.cost[r] ?? 0;
  recordSpent(s, check.cost);
  const order: ForgeOrder = { id: s.nextId++, item, count: check.count, done: 0, work: 0 };
  s.forge.push(order);
  // В летопись заказ не пишется: игрок сам его поставил, очередь у него перед
  // глазами, материалы списаны. Летопись узнает о нём один раз — когда он готов.
  return null;
}

/**
 * Отменяет заказ. Нетронутое возвращается целиком, начатый предмет — наполовину:
 * та же цена отказа, что и у брошенного улучшения (`cancelUpgrade`). Полный
 * возврат сделал бы кузницу бесплатным складом заготовок — заказал всё, передумал,
 * ничего не потерял; нулевой возврат наказывал бы за исправление ошибки.
 * Половина одного предмета — цена того, что железо уже разрублено.
 */
export function cancelForge(s: GameState, orderId: number): string | null {
  const i = s.forge.findIndex((o) => o.id === orderId);
  if (i < 0) return 'Такого заказа нет.';
  const order = s.forge[i];
  const def = EQUIPMENT_BY_ID[order.item];
  const left = Math.max(0, order.count - order.done);
  // Начатый предмет — тот, над которым уже стучали молотом.
  const started = order.work > 0 && left > 0 ? 1 : 0;
  const whole = left - started;
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = def.cost[r];
    if (!n) continue;
    s.resources[r] = Math.min(cap, s.resources[r] + n * whole + Math.floor((n * started) / 2));
  }
  s.forge.splice(i, 1);
  log(s, `Кузница: заказ отменён — ${def.name.toLowerCase()}.`, 'info', `forge:cancel:${order.item}`);
  return null;
}

/**
 * Шаг кузницы: куётся только первый заказ в очереди. Остаток работы после
 * последнего предмета переходит следующему — очередь не теряет времени.
 *
 * Материалов здесь не спрашивают: за заказ уже заплачено. Это и есть смысл
 * платы вперёд — заказ не может встать посреди дела.
 */
export function forgeTick(s: GameState, dt: number, _mods: SeasonModifiers): void {
  const order = s.forge?.[0];
  if (!order) return;
  const def = EQUIPMENT_BY_ID[order.item];
  if (!def) {
    s.forge.shift();
    return;
  }
  const rate = forgeRate(s);
  if (rate <= 0) return;
  order.work += rate * dt;
  while (order.work >= def.work && order.done < order.count) {
    order.work -= def.work;
    order.done++;
    s.equipment[order.item] = (s.equipment[order.item] ?? 0) + 1;
  }
  if (order.done < order.count) return;
  const rest = order.work;
  s.forge.shift();
  if (s.forge[0]) s.forge[0].work += rest;
  // Одна строка на весь заказ, а не по строке на предмет. Десять мечей — это
  // одно событие в жизни племени, а не десять; летопись живёт месяц, и место в
  // ней тратится на то, чего игрок не видел сам.
  // Название и число, без склонения: «мечи, 10». Тем же складом, что и строка
  // казарм про набор, — и без второй копии русского числительного в симуляции.
  log(s, `Кузница: заказ готов — ${def.name.toLowerCase()}, ${order.count}.`, 'good', `forge:${order.item}`);
}
