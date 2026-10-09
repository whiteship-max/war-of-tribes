// Ролик TW из записи боя — одна дверь, как `castOfRecord` у прежнего ролика: состав в метки, место и час в землю и
// свет, итог — в план. Стенд и игра ходят через неё обе, иначе стенд доказывал бы не то, что показывает игра.
import { buildCast } from '@/battle/replay';
import type { BattleResult, Side } from '@/battle/types';
import { facesOfRecord } from '@/game/battle/cast';
import { groundOf, type BattlePlace } from '@/game/battle/ground';
import type { TroopStack } from '@/game/battle/kinds';
import type { Quality } from '../quality';
import { buildPlan, type TwPlan } from './plan';
import { siteKindOf } from './site';
import { barrageOf } from './barrage';

export function twPlanOfRecord(
  result: BattleResult,
  us: Side,
  troops: Record<Side, TroopStack>,
  quality: Quality,
  militia?: Record<Side, { men: number; archers: number }>,
  place?: BattlePlace,
  beasts?: Side,
  site?: string,
  breach?: readonly number[],
): TwPlan {
  const faces = facesOfRecord(result, troops, militia, beasts);
  const cast = buildCast(result, us, faces, groundOf(place, result.seed));
  const plan = buildPlan({ cast, result, faces, quality, site: siteKindOf(site) });
  // Обстрел перед штурмом — пролог поверх готового плана: бой от него не меняется ни в одном числе (`barrage.test.ts`).
  // `breach` — доля пробитой стены после каждого залпа (`siegecraft.breachOf`): мира ролик не читает, её даёт зовущий.
  plan.barrage = barrageOf(plan, breach);
  return plan;
}
