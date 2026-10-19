// Герб места на карте (docs/polish.md, П-2): свой город — герб профиля, сосед-игрок — из реестра (`SettlementView.arms`),
// логово — свой по номеру (`heraldry/arms.lairArms`). Одна мерка на метку карты, карточку места и ролики.
import { BANDIT_ARMS, DEFAULT_ARMS, armsCode, armsOr, lairArms } from '@/heraldry/arms';
import { settlementAt } from '@/world/cache';
import type { MarchView, SettlementView } from '@/world/types';

/**
 * Строки гербов, уже выведенные: кадр карты спрашивает герб каждого места на каждом кадре, и разбор строки по набору
 * (`armsOr`) и вывод герба логова из номера (`lairArms`) шли заново шестьдесят раз в секунду (К-1, docs/telemetry.md).
 * Ответ зависит только от входной строки — её и помним.
 */
const codes = new Map<string, string>();

function code(key: string, make: () => string): string {
  let v = codes.get(key);
  if (v === undefined) {
    v = make();
    if (codes.size >= 512) codes.clear();
    codes.set(key, v);
  }
  return v;
}

/** Строка герба места; `own` — строка герба профиля (`ProfileState.arms`), читается через набор. */
export function placeArms(s: Pick<SettlementView, 'id' | 'mine' | 'relation' | 'arms'>, own: string | null | undefined): string {
  if (s.mine) return own == null ? code('d', () => armsCode(DEFAULT_ARMS)) : code(`o${own}`, () => armsCode(armsOr(own)));
  if (s.relation === 'barbarian') return s.id ? code(`l${s.id}`, () => armsCode(lairArms(s.id))) : code('b', () => armsCode(BANDIT_ARMS));
  return s.arms ? code(`o${s.arms}`, () => armsCode(armsOr(s.arms))) : code('d', () => armsCode(DEFAULT_ARMS));
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
