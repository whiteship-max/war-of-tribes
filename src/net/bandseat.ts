// Строка отряда бродяги в реестр (ПН-3) — половина описи реестра `net/snapshot` (там — строка замка, `claimOf`). Своим модулем (ПН-5,
// хвост а): нужна только Пути меча, а он докачивается тому, кому открыт (`game/roamlazy`).
import type { GameState, RoamState, TroopId } from '@/game/types';
import type { BandOrder } from '../../netlify/lib/contract';
import { readArms } from '@/heraldry/arms';
import { troopTotal } from '@/game/battle/kinds';
import { roamOn } from '@/game/roamflag';

/**
 * Что отряд бродяги сообщает реестру, вставая и отмечаясь (ПН-3): имя героя, знамя (герб профиля), престиж и бойцов строя. Не в
 * фазе бродяги — `null`, и реестр получает строку замка (`claimOf`). Престиж — слово клиента; люди — сверяет книга отряда сервера (ПН-6, `roambook`).
 */
export function bandSeatOf(s: GameState): Extract<BandOrder, { op: 'seat' }> | null {
  if (!roamOn() || s.phase !== 'roam' || !s.roam) return null;
  const arms = readArms(s.profile.arms) ? (s.profile.arms as string) : null;
  return { op: 'seat', name: s.roam.hero.name, ...(arms ? { arms } : {}), prestige: Math.floor(s.prestige), men: troopTotal(s.roam.band), troops: bandClaim(s.roam) };
}

/**
 * Люди отряда по видам для книги сервера (ПН-6): строй, раненые и люди на учениях (найм оплачен — книга знает их с приказа найма).
 * Сверх книги — флаг сервера, меньше — убыль.
 */
export function bandClaim(r: RoamState): Partial<Record<TroopId, number>> {
  const out: Partial<Record<TroopId, number>> = {};
  const add = (id: TroopId, n: number): void => {
    if (n > 0) out[id] = (out[id] ?? 0) + Math.floor(n);
  };
  for (const [id, n] of Object.entries(r.band) as [TroopId, number][]) add(id, n);
  for (const g of r.wounded) for (const [id, n] of Object.entries(g.troops) as [TroopId, number][]) add(id, n);
  for (const d of r.drill ?? []) add(d.kind, d.n);
  return out;
}
