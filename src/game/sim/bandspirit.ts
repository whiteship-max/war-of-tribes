// Дух отряда бродяги (ПН-1, ГДД 3.3.3) — входы отряда двери духа `sim/spirit.spiritIn`. Своим модулем (ПН-5, хвост а): читает его
// только Путь меча, а он докачивается тому, кому открыт (`game/roamlazy`). Расчёт и строки — общие (`spiritrules`), память боёв и
// жалованье — той же двери (`gloryNow`, `payShare`).
import type { GameState } from '../types';
import type { SpiritIn } from '../spiritrules';
import { seasonMods } from '../derived';
import { rulerTraitNumbers } from '../rulernow';
import { bandBar, bandHunger, campSpirit } from '../roamrules';
import { gloryNow, payShare } from './spirit';

/**
 * Дух отряда бродяги (ПН-1, ГДД 3.3.3) — тот же расчёт, входы отряда. Державы, храма, сословий, Казарм и Статуи у бродяги нет —
 * их строк нет; отряд ведёт герой — дисциплина от его Военного дела, как от уровня полководца; терпение — полоса отряда
 * (`roamrules.bandBar`: долг или голод против терпения героя), голод — доля, которую не закрывают обоз и фураж
 * (`roamrules.bandHunger`); память боёв и жалованье — общие поля партии (`s.spirit`, `PayState.wage`).
 */
export function bandSpiritIn(s: GameState, r: NonNullable<GameState['roam']>): SpiritIn {
  return {
    stab: 0,
    patience: bandBar(s.pay?.late ?? 0, r.hero.war),
    unfed: bandHunger(r, seasonMods(s)),
    glory: gloryNow(s),
    rite: 0,
    marshal: 0,
    knights: 0,
    merchants: 0,
    general: r.hero.war,
    barracks: 0,
    statue: 0,
    pay: payShare(s),
    // Черты героя пути (ПН-2) — та же дверь, что у правителя.
    ruler: rulerTraitNumbers(s).drill,
    // Лагерь (ПН-3): открытый — костры, скрытый зимой — холод (`roamrules.campSpirit`).
    camp: campSpirit(r.camp, seasonMods(s)),
  };
}
