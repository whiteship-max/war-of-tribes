// Раскадровка ролика из записи боя. Отдельным модулем от `faces.ts` нарочно:
// меткам видов (`troopsOfKinds`) пользуется мир, то есть первая загрузка, а
// раскадровкой — только ролик, который едет своим куском по «Смотреть бой».
// Лежи эта дверь рядом с метками — сборщик положил бы в первую загрузку и её, и
// всю режиссуру за ней (`buildCast`): модуль в чанк попадает целиком.
import type { BattleResult, Side } from '@/battle';
import { buildCast, type Cast, type Face } from '@/battle/replay';
import type { TroopStack } from './kinds';
import { facesOf } from './faces';
import { groundOf, type BattlePlace } from './ground';

/**
 * Раскадровка ролика из записи боя: состав сторон превращается в метки, место и
 * час — в землю и свет, и дальше картинке хватает одной раскадровки. Единственная
 * дверь из записи боя в показ — чтобы «сервер прислал, клиент показал» осталось
 * одним вызовом.
 */
export function castOfRecord(
  result: BattleResult,
  us: Side,
  troops: Record<Side, TroopStack>,
  militia?: Record<Side, { men: number; archers: number }>,
  place?: BattlePlace,
): Cast {
  const side = (id: Side): Face[] =>
    facesOf({ troops: troops[id] ?? {}, militia: militia?.[id]?.men, militiaArchers: militia?.[id]?.archers });
  // Земля и свет — тем же ходом, что и состав: из записи боя чистой функцией.
  // Места нет (старая запись) — ровное поле в полдень, но со своим сидом.
  return buildCast(result, us, { attacker: side('attacker'), defender: side('defender') }, groundOf(place, result.seed));
}
