// Цена своего труда и множитель выработки от уровня — ниже `derived.ts`. Их читает цена вида (`battle/price.ts`: паёк
// бойца в золоте своим трудом), а цену вида — мощь мира (`price.troopPower`), которую читает `derived`: будь они в
// `derived`, круг импортов замкнулся бы. Перенесено из `derived.ts` дословно (docs/remeasure.md, пункт 1); `derived`
// отдаёт их дальше тем же именем.
import type { ResourceId } from './types';
import { LEVEL_OUTPUT_STEP } from './constants';
import { JOBS } from './data/jobs';
import { GOOD_BY_ID, goodMaterials, type GoodDef } from './data/market';
import { TAXES, TAX_PER_POP } from './data/policy';

/** Множитель выработки рабочего от уровня здания: +`LEVEL_OUTPUT_STEP` за уровень. */
export const levelOutputMult = (level: number): number => 1 + LEVEL_OUTPUT_STEP * Math.max(0, level - 1);

/**
 * Во что единица товара обходится своим трудом, в золоте.
 *
 * Считается из собственных чисел игры: человек за день приносит казне
 * `bestTaxPerPop` золота, а тот же человек на своём месте в здании
 * `REFERENCE_LEVEL` уровня добывает `yield * levelOutputMult` единиц товара.
 * Отношение и есть «цена своего труда» — с ней сравнивается цена рынка,
 * и рынок обязан быть дороже (см. MIN_MARKUP и тест).
 *
 * Для снаряжения своим трудом считается стоимость материалов: работу кузнеца
 * рынок сверху и накидывает.
 */
const REFERENCE_LEVEL = 5;

const bestTaxPerPop = (): number => Math.max(...TAXES.map((t) => t.perPop)) * TAX_PER_POP;

/** Лучшая дневная добыча одного работника по этому ресурсу — эталон «сделать самому». */
function bestYieldPerWorker(r: ResourceId): number {
  let best = 0;
  for (const job of JOBS) {
    const y = job.yield[r] ?? 0;
    if (y > best) best = y;
  }
  return best * levelOutputMult(REFERENCE_LEVEL);
}

export function selfCost(def: GoodDef): number {
  // Людей своим трудом не производят: прирост племени бесплатен и медленен, и
  // сравнивать цену невольника с ним не с чем. Его цена меряется его же работой —
  // окупаемостью, и считает её `npm run order:report`, а держит тест.
  if (def.kind === 'bonded') return 0;
  if (def.resource) {
    const per = bestYieldPerWorker(def.resource);
    return per > 0 ? bestTaxPerPop() / per : 0;
  }
  let sum = 0;
  for (const [r, n] of Object.entries(goodMaterials(def))) {
    const g = GOOD_BY_ID[r];
    if (g && n) sum += g.price * n;
  }
  return sum;
}
