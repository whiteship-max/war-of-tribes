// Алмазы в партии (docs/gems.md). Алмазов в партии больше нет: баланс, журнал и лавка живут на сервере
// (`netlify/lib/gems.ts`), начисляет он один (`creditGems`), а трата — приказ серверу (`net/gems.ts`). Сюда приходит
// только **дело**, за которое сервер уже списал алмазы: покупка лавки кладёт припас на склад, ускорение достраивает
// стройку. Ложится оно одной дверью — `applyGemDeeds` — ровно один раз, по номеру записи (`GameState.gemSeen`), как указ
// админа (`sim/admin.applyGrants`), и припас — тем же правилом склада (`sim/admin.layStock`).
//
// Что алмаз покупает. Время стройки и сто единиц припаса в лавке (решение владельца 09.10.2026). Ускорение не платит за
// стройку ресурсы второй раз и не платит их вместо игрока: ускоряется только начатая стройка, за которую припасы уже
// уплачены. Войско за алмазы не продаётся.
//
// Цены — общие с сервером (`game/gemrules.ts`): кнопка показывает ровно то, что сервер спишет.
import type { Building, GameState, ResourceId } from '../types';
import type { GemEntry } from '../../../netlify/lib/contract';
import { BUILDING_BY_ID } from '../data/buildings';
import { buildingById, buildingTitle, isSite, storageCap, underSiege } from '../derived';
import { RESOURCE_META, SIEGE_NO_TRADE } from '../constants';
import { SHOP_LOT, gemLine, rushPriceOfWork, rushSeconds } from '../gemrules';
import { layStock } from './admin';
import { log } from './log';

export {
  GEM_CONFIRM,
  GEM_REF_RATE,
  RUSH_FREE_SECONDS,
  SHOP_DAILY,
  SHOP_GOODS,
  SHOP_LOT,
  START_GEMS,
  gemsForWait,
  shopHours,
  shopPrice,
} from '../gemrules';

/** Номер последней применённой записи журнала алмазов. */
export const gemSeen = (s: GameState): number => (typeof s.gemSeen === 'number' && Number.isFinite(s.gemSeen) ? s.gemSeen : 0);

// ------------------------------------------------ ускорение ---

/** Остаток работы начатой стройки. Нетронутое здание не ускоряется: стройку сначала начинают и оплачивают. */
export const rushWork = (b: Building): number => (isSite(b) ? Math.max(0, b.workRequired - b.work) : 0);

/** Цена ускорения в алмазах; ноль — последние пять минут, ускоряется даром. */
export const rushPrice = (b: Building): number => rushPriceOfWork(rushWork(b));

/** Настоящие секунды нормативного ожидания, которые снимает ускорение. */
export const rushLeft = (b: Building): number => rushSeconds(rushWork(b));

/** Достроить стройку: уровень вверх, стройка снята — следующая в очереди становится первой сама. */
function finish(b: Building): void {
  b.level += 1;
  b.work = 0;
  b.workRequired = 0;
}

/**
 * Ускорить даром — последние пять минут ожидания. Приказа серверу нет и сеть не нужна: алмазы не тратятся. Дороже —
 * только приказом (`net/gems.orderRush`), и тогда стройку достраивает дело с сервера (`applyGemDeeds`).
 */
export function rushFree(s: GameState, buildingId: number): string | null {
  const b = buildingById(s, buildingId);
  if (!b) return 'Здание не найдено.';
  if (!isSite(b)) return 'Здесь ничего не строится.';
  if (rushPrice(b) > 0) return 'Даром ускоряются только последние пять минут.';
  finish(b);
  log(s, `${buildingTitle(s, b.type)}: ур. ${b.level}, ускорено даром.`, 'good');
  return null;
}

/**
 * Почему ускорить за алмазы нельзя прямо сейчас; `null` — можно. `balance` — баланс с сервера, `null` — сервера не
 * слышно (без сети траты алмазов нет); `offline` — причина словами, если сервера не слышно.
 */
export function rushBlocked(b: Building, balance: number | null, offline: string | null): string | null {
  if (!isSite(b)) return 'Здесь ничего не строится.';
  if (rushPrice(b) === 0) return null;
  if (offline !== null || balance === null) return offline ?? 'Нет связи: алмазы тратятся только при связи.';
  if (balance < rushPrice(b)) return 'Не хватает алмазов.';
  return null;
}

// ------------------------------------------------ лавка ---

/** Сколько места на складе под этот припас. */
export const shopRoom = (s: GameState, r: ResourceId): number => Math.max(0, Math.floor(storageCap(s) - (s.resources[r] ?? 0)));

/** Почему купить в лавке нельзя прямо сейчас; `null` — можно. Сто единиц сверх вместимости не покупаются. */
export function shopBlocked(s: GameState, r: ResourceId, price: number, balance: number | null, left: number, offline: string | null): string | null {
  // В осаде торговли нет (`SIEGE_NO_TRADE`): лавка — тот же обоз к городу, и купленное снимало бы голод осады.
  if (underSiege(s)) return SIEGE_NO_TRADE;
  if (shopRoom(s, r) < SHOP_LOT) return `Склад полон: ${SHOP_LOT} ${RESOURCE_META[r].name.toLowerCase()} не поместится.`;
  if (offline !== null || balance === null) return offline ?? 'Нет связи: алмазы тратятся только при связи.';
  if (left <= 0) return 'На сегодня покупки кончились.';
  if (balance < price) return 'Не хватает алмазов.';
  return null;
}

// ------------------------------------------------ дела с сервера ---

/**
 * Применить дела журнала алмазов старше `gemSeen` — по порядку номеров. Возвращает, сколько применено; ничего нового —
 * ноль, и партия не тронута. Дело ложится ровно один раз, сколько бы раз запись ни приехала (с ответом приказа, с
 * ответом сохранения, с другого устройства).
 *
 *  · лавка — припас на склад по правилу склада (`layStock`): сверх вместимости не ложится;
 *  · ускорение — достраивает стройку этого здания до названного уровня, если она ещё идёт; уже достроено (дело приехало
 *    позже, чем стройка кончилась сама) — ничего, и летопись говорит об этом.
 */
export function applyGemDeeds(s: GameState, deeds: readonly GemEntry[]): number {
  const fresh = deeds.filter((e) => e.n > gemSeen(s)).sort((a, b) => a.n - b.n);
  for (const e of fresh) {
    s.gemSeen = e.n;
    if (e.kind === 'buy' && e.res && (RESOURCE_META as Record<string, unknown>)[e.res]) {
      const moved = Math.round(layStock(s, e.res, e.amount ?? SHOP_LOT));
      log(s, `Пришёл обоз из лавки: ${RESOURCE_META[e.res].name.toLowerCase()} +${moved}${moved < (e.amount ?? SHOP_LOT) ? ', остальное склад не вместил' : ''}.`, 'good');
      continue;
    }
    if (e.kind === 'rush' && e.building && e.level) {
      const b = s.buildings.find((x) => x.type === e.building);
      const name = b ? buildingTitle(s, b.type) : (BUILDING_BY_ID as Record<string, { name: string } | undefined>)[e.building]?.name ?? e.building;
      if (b && isSite(b) && b.level + 1 === e.level) {
        finish(b);
        log(s, `${name}: ур. ${b.level}, ускорено за ${-e.delta} алмазов.`, 'good');
      } else {
        log(s, `${name}: ускорение не понадобилось — стройка до ур. ${e.level} уже не идёт.`, 'info');
      }
      continue;
    }
    log(s, `Алмазы: ${gemLine(e)}.`, 'info');
  }
  return fresh.length;
}
