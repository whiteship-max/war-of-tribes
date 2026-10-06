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
// Алмазов здесь нет: виды указа — только `STOCK_KEYS` и `TROOP_KEYS` договора, и начисление алмазов остаётся одно —
// `creditGems` с распиской сервера (`gems.test.ts`).
import type { GameState, ResourceId, TroopId } from '../types';
import { RESOURCE_IDS, RESOURCE_META } from '../constants';
import { storageCap } from '../derived';
import { TROOP_BY_ID } from '../data/troops';
import { STOCK_KEYS, TROOP_KEYS, type AdminGrant } from '../../../netlify/lib/contract';
import { log } from './log';

/** Номер последнего применённого указа. */
export const adminSeen = (s: GameState): number => (typeof s.adminSeen === 'number' && Number.isFinite(s.adminSeen) ? s.adminSeen : 0);

/** Число со знаком для летописи: +500, −10. */
const signed = (n: number): string => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * Применить указы старше `adminSeen` — по порядку номеров. Возвращает, сколько применено. Ничего нового — ноль, и
 * партия не тронута.
 */
export function applyGrants(s: GameState, grants: readonly AdminGrant[]): number {
  const fresh = grants.filter((g) => g.n > adminSeen(s)).sort((a, b) => a.n - b.n);
  for (const g of fresh) {
    const cap = storageCap(s);
    const parts: string[] = [];
    for (const k of STOCK_KEYS) {
      const want = g.stock[k];
      if (!want) continue;
      if (k === 'gold') {
        const before = s.gold;
        s.gold = Math.max(0, before + want);
        if (s.gold !== before) parts.push(`золото ${signed(Math.round(s.gold - before))}`);
        continue;
      }
      const r = k as ResourceId;
      if (!RESOURCE_IDS.includes(r)) continue;
      const before = s.resources[r] ?? 0;
      // Прибавка — до вместимости и не отнимая того, что уже лежит сверх неё; убавка — до нуля.
      s.resources[r] = want > 0 ? Math.max(before, Math.min(cap, before + want)) : Math.max(0, before + want);
      const moved = Math.round(s.resources[r] - before);
      parts.push(`${RESOURCE_META[r].name.toLowerCase()} ${moved === 0 ? '0 (склад полон)' : signed(moved)}`);
    }
    for (const k of TROOP_KEYS) {
      const want = g.troops[k];
      if (!want) continue;
      const t = k as TroopId;
      if (!TROOP_BY_ID[t]) continue;
      const before = s.army[t] ?? 0;
      s.army[t] = Math.max(s.away?.[t] ?? 0, before + want);
      const moved = s.army[t] - before;
      if (moved !== 0) parts.push(`${TROOP_BY_ID[t].name.toLowerCase()} ${signed(moved)}`);
    }
    s.adminSeen = g.n;
    log(s, `Указ админа №${g.n}: ${parts.length ? parts.join(', ') : 'ничего не изменилось'}.`, 'info');
  }
  return fresh.length;
}
