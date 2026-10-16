// Герб места на карте (docs/polish.md, П-2): свой город — герб профиля, сосед-игрок — из реестра (`SettlementView.arms`),
// логово — свой по номеру (`heraldry/arms.lairArms`). Одна мерка на метку карты, карточку места и ролики.
import { BANDIT_ARMS, DEFAULT_ARMS, armsCode, armsOr, lairArms } from '@/heraldry/arms';
import { settlementAt } from '@/world/cache';
import type { MarchView, SettlementView } from '@/world/types';

/** Строка герба места; `own` — строка герба профиля (`ProfileState.arms`), читается через набор. */
export function placeArms(s: Pick<SettlementView, 'id' | 'mine' | 'relation' | 'arms'>, own: string | null | undefined): string {
  if (s.mine) return armsCode(armsOr(own));
  if (s.relation === 'barbarian') return armsCode(s.id ? lairArms(s.id) : BANDIT_ARMS);
  return armsCode(s.arms ? armsOr(s.arms) : DEFAULT_ARMS);
}

/**
 * Герб на знамени похода: свой — герб профиля; чужой — герб места, откуда вышел (сосед-игрок из реестра, логово по
 * номеру); место не загружено — разбойники, если отряд враждебен, иначе прежняя башня.
 */
export function marchArms(m: Pick<MarchView, 'own' | 'hostile' | 'from'>, own: string | null | undefined): string {
  if (m.own) return armsCode(armsOr(own));
  const at = settlementAt(m.from.x, m.from.y);
  if (at) return placeArms(at, own);
  return armsCode(m.hostile ? BANDIT_ARMS : DEFAULT_ARMS);
}
