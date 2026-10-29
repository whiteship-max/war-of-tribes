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
import type { Building, GameState } from '../types';
import { GEM_LIMITS, readGemNumbers, type GemEntry } from '../../../netlify/lib/contract';
import { BUILDING_BY_ID } from '../data/buildings';
import { buildingTitle, isSite } from '../derived';
import { RESOURCE_META } from '../constants';
import { SHOP_LOT, gemLine, rushPriceOfWork, rushSeconds } from '../gemrules';
import { layStock } from './admin';
import { log } from './log';
import { noteRulerDeed } from './dynasty';

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

/** Ускорения «не понадобилось», которые ждут решения сервера (FIN-5): номера, целые, без повторов. */
export const gemUnneeded = (s: GameState): number[] => readGemNumbers(s.gemUnneeded);

/** Сервер рассудил эти ускорения (вернул алмазы или отказал навсегда) — снять их из списка. Возвращает, сколько снято. */
export function settleUnneeded(s: GameState, settled: readonly number[]): number {
  const was = gemUnneeded(s);
  const left = was.filter((n) => !settled.includes(n));
  if (left.length === was.length && was.length === (s.gemUnneeded?.length ?? 0)) return 0;
  if (left.length) s.gemUnneeded = left;
  else delete s.gemUnneeded;
  return was.length - left.length;
}

// ------------------------------------------------ ускорение ---

/** Остаток работы начатой стройки. Нетронутое здание не ускоряется: стройку сначала начинают и оплачивают. */
export const rushWork = (b: Building): number => (isSite(b) ? Math.max(0, b.workRequired - b.work) : 0);

/** Цена ускорения в алмазах; ноль — последние пять минут, ускоряется даром. */
export const rushPrice = (b: Building): number => rushPriceOfWork(rushWork(b));

/** Настоящие секунды нормативного ожидания, которые снимает ускорение. */
export const rushLeft = (b: Building): number => rushSeconds(rushWork(b));

/** Достроить стройку: уровень вверх, стройка снята — следующая в очереди становится первой сама. Уровень — дело правителя (ПН-2). */
export function finish(s: GameState, b: Building): void {
  b.level += 1;
  b.work = 0;
  b.workRequired = 0;
  noteRulerDeed(s, 'built');
}

// ------------------------------------------------ дела с сервера ---

/**
 * Применить дела журнала алмазов старше `gemSeen` — по порядку номеров. Возвращает, сколько применено; ничего нового —
 * ноль, и партия не тронута. Дело ложится ровно один раз, сколько бы раз запись ни приехала (с ответом приказа, с
 * ответом сохранения, с другого устройства).
 *
 *  · лавка — припас на склад по правилу склада (`layStock`): сверх вместимости не ложится;
 *  · ускорение — достраивает стройку этого здания до названного уровня, если она ещё идёт; уже достроено (дело приехало
 *    позже, чем стройка кончилась сама) — партия не меняется, номер ложится в `gemUnneeded`: сервер вернёт списанное,
 *    если книга стройки подтвердит уровень работой посёлка (FIN-5), и летопись говорит об этом.
 */
export function applyGemDeeds(s: GameState, deeds: readonly GemEntry[]): number {
  const fresh = deeds.filter((e) => e.n > gemSeen(s)).sort((a, b) => a.n - b.n);
  let laid = 0;
  for (const e of fresh) {
    // Номер — сверкой в шаге, а не один раз до него: тот же номер дважды в одной порции ложится один раз.
    if (e.n <= gemSeen(s)) continue;
    laid++;
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
        finish(s, b);
        log(s, `${name}: ур. ${b.level}, ускорено за ${-e.delta} алмазов.`, 'good', undefined, 'build');
      } else {
        // Номер — серверу описью: он вернёт списанное, если книга стройки подтвердит уровень работой посёлка (FIN-5).
        s.gemUnneeded = [...gemUnneeded(s).filter((n) => n !== e.n), e.n].slice(-GEM_LIMITS.unneeded);
        log(s, `${name}: ускорение не понадобилось — стройка до ур. ${e.level} уже не идёт. ${-e.delta} алмазов вернутся, если сервер подтвердит, что она кончилась сама.`, 'info', undefined, 'build');
      }
      continue;
    }
    log(s, `Алмазы: ${gemLine(e)}.`, 'info');
  }
  return laid;
}
