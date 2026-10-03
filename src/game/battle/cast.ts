// Раскадровка ролика из записи боя. Отдельным модулем от `faces.ts` нарочно:
// меткам видов (`troopsOfKinds`) пользуется мир, то есть первая загрузка, а
// раскадровкой — только ролик, который едет своим куском по «Смотреть бой».
// Лежи эта дверь рядом с метками — сборщик положил бы в первую загрузку и её, и
// всю режиссуру за ней (`buildCast`): модуль в чанк попадает целиком.
import { UNIT_KINDS, type BattleResult, type Side, type Stack } from '@/battle';
import { buildCast, type Cast, type Face } from '@/battle/replay';
import type { TroopStack } from './kinds';
import { BEAST, facesOf } from './faces';
import { groundOf, type BattlePlace } from './ground';

/**
 * Раскадровка ролика из записи боя: состав сторон превращается в метки, место и
 * час — в землю и свет, и дальше картинке хватает одной раскадровки. Единственная
 * дверь из записи боя в показ — чтобы «сервер прислал, клиент показал» осталось
 * одним вызовом.
 *
 * `beasts` — сторона зверей (`BattleRecord.beasts`): видов племени у стаи нет, и её бойцы получают метку зверя
 * (`BEAST`) по своим родам — иначе ядро назвало бы их родом, и ролик одел бы стаю всадниками.
 */
export function castOfRecord(
  result: BattleResult,
  us: Side,
  troops: Record<Side, TroopStack>,
  militia?: Record<Side, { men: number; archers: number }>,
  place?: BattlePlace,
  beasts?: Side,
): Cast {
  // Земля и свет — тем же ходом, что и состав: из записи боя чистой функцией.
  // Места нет (старая запись) — ровное поле в полдень, но со своим сидом.
  return buildCast(result, us, facesOfRecord(result, troops, militia, beasts), groundOf(place, result.seed));
}

/**
 * Метки сторон из записи боя — одна дверь для обоих роликов: прежнего (`castOfRecord`) и ролика в стиле Total War
 * (`render/tw`), которому нужны люди по видам, а не только фигуры раскадровки. Два способа сложить метки
 * разошлись бы ровно на стае и ополчении.
 */
export function facesOfRecord(
  result: BattleResult,
  troops: Record<Side, TroopStack>,
  militia?: Record<Side, { men: number; archers: number }>,
  beasts?: Side,
): Record<Side, Face[]> {
  const side = (id: Side): Face[] =>
    id === beasts
      ? beastFaces(result.sides[id].initial)
      : facesOf({ troops: troops[id] ?? {}, militia: militia?.[id]?.men, militiaArchers: militia?.[id]?.archers });
  return { attacker: side('attacker'), defender: side('defender') };
}

/** Стая по родам ядра: каждый род, что вышел, — метка зверя с тем же числом бойцов. */
function beastFaces(initial: Stack): Face[] {
  const out: Face[] = [];
  for (const kind of UNIT_KINDS) {
    const men = Math.max(0, Math.round(initial[kind] ?? 0));
    if (men > 0) out.push({ id: BEAST, kind, men });
  }
  return out;
}
