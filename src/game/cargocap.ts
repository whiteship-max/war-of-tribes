// Вместимость обоза отряда бродяги (ГДД 3.3.5; ПН-1) — своим маленьким модулем: её читают шаг отряда (`sim/roam`) и рынок с ключом
// вольного города (`sim/market`, ПН-6), а рынок лорда — свой кусок, и тянуть в него шаг отряда незачем.
import type { RoamState } from './types';
import { troopTotal } from './battle/kinds';
import { GAIT_HAUL } from '@/world/data/gait';
import { UNIT_BY_ID } from '@/world/data/units';
import { wayGait } from '@/world/roammove';

/**
 * Вместимость обоза: ноша бойца мира (`units.warrior.carry` — та же, что у обоза полководца) на голову строя, режимом марша хода
 * (`GAIT_HAUL` — та же поклажа, что у `gait.gaitHaul`: налегке меньше, с обозом больше; режим — поле хода `way.gait`, решение ПН-3).
 * Раненых несут — они не везут. Золото не весит. Телеги — с происхождениями (ПН-17), когда прибор выведет их вместимость.
 */
export const cargoCap = (r: Pick<RoamState, 'band' | 'way'>): number => troopTotal(r.band) * UNIT_BY_ID.warrior.carry * GAIT_HAUL[wayGait(r.way)];
