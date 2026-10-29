// Указ админа отряду бродяги (30.10.2026, docs/admin.md) — половина двери указа `sim/admin.applyGrants`. Своим модулем (ПН-5, хвост а):
// указ отряду бывает только на Пути меча, а он докачивается тому, кому открыт (`game/roamlazy`). Номер указа и строку летописи
// ведёт сама дверь указа.
import type { GameState, ResourceId, RoamState, TroopId } from '../types';
import { RESOURCE_IDS, RESOURCE_META } from '../constants';
import { TROOP_BY_ID } from '../data/troops';
import { STOCK_KEYS, TROOP_KEYS, type AdminGrant } from '../../../netlify/lib/contract';
import { signedWhole } from '../num';
import { addStock } from './stock';
import { cargoCap } from './roam';

/** Указ отряду бродяги: золото в кошель, припасы в обоз до вместимости, бойцы в отряд. Возвращает, что легло, словами. */
export function toBand(s: GameState, band: RoamState, g: AdminGrant): string[] {
  const parts: string[] = [];
  for (const k of STOCK_KEYS) {
    const want = g.stock[k];
    if (!want) continue;
    if (k === 'gold') {
      const before = band.purse;
      band.purse = Math.max(0, before + want);
      if (band.purse !== before) parts.push(`кошель ${signedWhole(Math.round(band.purse - before))}`);
      continue;
    }
    const r = k as ResourceId;
    if (!RESOURCE_IDS.includes(r)) continue;
    // Вместимость — до прибавки бойцов этого же указа: обоз считает ношу тех, кто уже в строю.
    const moved = Math.round(addStock(s, r, want, cargoCap(band), 'cargo'));
    parts.push(`${RESOURCE_META[r].name.toLowerCase()} в обоз ${moved === 0 ? '0 (обоз полон)' : signedWhole(moved)}`);
  }
  for (const k of TROOP_KEYS) {
    const want = g.troops[k];
    if (!want) continue;
    const t = k as TroopId;
    if (!TROOP_BY_ID[t]) continue;
    const before = band.band[t] ?? 0;
    const after = Math.max(0, before + want);
    if (after > 0) band.band[t] = after;
    else delete band.band[t];
    if (after !== before) parts.push(`${TROOP_BY_ID[t].name.toLowerCase()} ${signedWhole(after - before)}`);
  }
  return parts;
}
