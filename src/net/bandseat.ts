// Строка отряда бродяги в реестр (ПН-3) — половина описи реестра `net/snapshot` (там — строка замка, `claimOf`). Своим модулем (ПН-5,
// хвост а): нужна только Пути меча, а он докачивается тому, кому открыт (`game/roamlazy`).
import type { GameState } from '@/game/types';
import type { BandOrder } from '../../netlify/lib/contract';
import { readArms } from '@/heraldry/arms';
import { troopTotal } from '@/game/battle/kinds';
import { roamOn } from '@/game/roamflag';

/**
 * Что отряд бродяги сообщает реестру, вставая и отмечаясь (ПН-3): имя героя, знамя (герб профиля), престиж и бойцов строя. Не в
 * фазе бродяги — `null`, и реестр получает строку замка (`claimOf`). Престиж и люди — слово клиента до книги отряда (ПН-13).
 */
export function bandSeatOf(s: GameState): Extract<BandOrder, { op: 'seat' }> | null {
  if (!roamOn() || s.phase !== 'roam' || !s.roam) return null;
  const arms = readArms(s.profile.arms) ? (s.profile.arms as string) : null;
  return { op: 'seat', name: s.roam.hero.name, ...(arms ? { arms } : {}), prestige: Math.floor(s.prestige), men: troopTotal(s.roam.band) };
}
