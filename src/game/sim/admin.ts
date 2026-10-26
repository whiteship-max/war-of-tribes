// Указ админа (docs/admin.md) — единственная дверь, через которую он ложится в партию.
//
// Указ лежит на сервере записью в журнале игрока: номер по порядку, склад и золото, бойцы — плюсом или минусом. Сервер
// партию не трогает: он отдаёт указы с ответом сохранения, а применяет их клиент здесь. Партия помнит номер последнего
// применённого (`GameState.adminSeen`) и берёт только старшие, по порядку, — так указ ложится ровно один раз, сколько
// бы раз он ни приехал и с какого бы устройства партию ни продолжили.
//
// Правила склада — игровые: прибавка ложится не сверх вместимости (как возврат цены, `sim/pay.refund`), убавка — не
// ниже нуля; бойцов не меньше, чем их сейчас в походе (`s.away`). Летопись говорит, что легло на самом деле.
//
// Алмазов здесь нет: виды указа — только `STOCK_KEYS` и `TROOP_KEYS` договора, а алмазы живут на сервере, и начисление
// у них одно — `netlify/lib/gems.creditGems` (docs/gems.md).
import type { GameState, ResourceId, TroopId } from '../types';
import { RESOURCE_IDS, RESOURCE_META } from '../constants';
import { addStock } from './stock';
import { TROOP_BY_ID } from '../data/troops';
import { STOCK_KEYS, TROOP_KEYS, type AdminGrant } from '../../../netlify/lib/contract';
import { log } from './log';
import { signedWhole } from '../num';

/** Номер последнего применённого указа. */
export const adminSeen = (s: GameState): number => (typeof s.adminSeen === 'number' && Number.isFinite(s.adminSeen) ? s.adminSeen : 0);

/**
 * Положить припас на склад по правилу склада — одна дверь на указ админа и на лавку алмазов (`sim/gems.applyGemDeeds`):
 * прибавка ложится до вместимости, убавка — до нуля (`sim/stock.addStock`). Возвращает, сколько легло на самом деле
 * (со знаком). Сверх вместимости не кладёт и указ: склад не бывает выше неё (решение владельца, OWNER-DECISIONS, п. 1).
 */
export const layStock = (s: GameState, r: ResourceId, want: number): number => addStock(s, r, want);

/**
 * Применить указы старше `adminSeen` — по порядку номеров. Возвращает, сколько применено. Ничего нового — ноль, и
 * партия не тронута.
 */
export function applyGrants(s: GameState, grants: readonly AdminGrant[]): number {
  const fresh = grants.filter((g) => g.n > adminSeen(s)).sort((a, b) => a.n - b.n);
  for (const g of fresh) {
    const parts: string[] = [];
    for (const k of STOCK_KEYS) {
      const want = g.stock[k];
      if (!want) continue;
      if (k === 'gold') {
        const before = s.gold;
        s.gold = Math.max(0, before + want);
        if (s.gold !== before) parts.push(`золото ${signedWhole(Math.round(s.gold - before))}`);
        continue;
      }
      const r = k as ResourceId;
      if (!RESOURCE_IDS.includes(r)) continue;
      const moved = Math.round(layStock(s, r, want));
      parts.push(`${RESOURCE_META[r].name.toLowerCase()} ${moved === 0 ? '0 (склад полон)' : signedWhole(moved)}`);
    }
    for (const k of TROOP_KEYS) {
      const want = g.troops[k];
      if (!want) continue;
      const t = k as TroopId;
      if (!TROOP_BY_ID[t]) continue;
      const before = s.army[t] ?? 0;
      s.army[t] = Math.max(s.away?.[t] ?? 0, before + want);
      const moved = s.army[t] - before;
      if (moved !== 0) parts.push(`${TROOP_BY_ID[t].name.toLowerCase()} ${signedWhole(moved)}`);
    }
    s.adminSeen = g.n;
    log(s, `Указ админа №${g.n}: ${parts.length ? parts.join(', ') : 'ничего не изменилось'}.`, 'info');
  }
  return fresh.length;
}
