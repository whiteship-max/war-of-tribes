// Правила отряда бродяги (ПН-1, docs/gdd/path_of_sword.md, 3.3; «Решения ПН-1») — числа и формулы без состояния партии: что
// отряд стоит за игровой день, сколько терпит, сколько везёт и сколько добирает с земли. Читают их двери ПН-1 (`sim/upkeep`,
// `sim/roam`, `sim/spirit`), прибор пути (`npm run roam:report`) и — с ПН-6 — книга отряда сервера (`roambook`): одни числа на всех.
//
// Своих чисел здесь нет ни одного. Жалованье и паёк — формулы города (`price.baseWage`, `build.soldierFoodPerDay`), терпение —
// лестница Статуи, фураж — поле сезона из таблицы сезонов (`SEASON_MODIFIERS`) и вольный сбор. Вместимость обоза — ноша бойца
// мира — считает шаг отряда (`sim/roam.cargoCap`): правила отряда читает и шаг города (`sim/upkeep`, `sim/spirit`), и мир,
// импортированный отсюда, приехал бы в первую загрузку. Ориентиры ГДД (телега +400, фураж лета 50 %, лагеря ×0.5 и ×0.8) сюда не
// идут, пока их не вывел прибор (ГДД, «Как читать числа»).
import type { RoamState, TroopId } from './types';
import { TROOP_IDS } from './data/troops';
import { baseWage, mouthsOf } from './battle/price';
import type { TroopStack } from './battle/kinds';
import { soldierFoodPerDay } from './build';
import { statAt } from './train';
import { DAY_LENGTH } from './pace';
import { WAGE_MIN_SHARE, type WageMode } from './spiritrules';
import { SEASONS, SEASON_MODIFIERS, type SeasonModifiers } from './data/seasons';
import { FREE_RANGE_MULT } from './constants';

/**
 * Жалованье бойца отряда за игровой день — формула 3.3.2 (`TAX_PER_POP × (WAGE_HEAD + WAGE_MAN × grade + WAGE_GEAR × вещей и
 * коней)`), то есть ставка вида города без доли веры и без содержания рыцарства: ни храма, ни сословий у бродяги нет.
 * Минимальное жалованье (ДР-1) — та же доля `WAGE_MIN_SHARE`, что у дружины.
 */
export const bandWage = (id: TroopId, mode: WageMode = 'full'): number => baseWage(id) * (mode === 'min' ? WAGE_MIN_SHARE : 1);

/** Жалованье отряда за игровой день: по видам, равной ставкой на голову. */
export const bandWagesPerDay = (band: TroopStack, mode: WageMode = 'full'): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, band[id] ?? 0) * bandWage(id, mode), 0);

/** Раненые отряда одним списком по видам — они едят тот же паёк (`derived.soldierMouths` у города). */
export function woundedOf(r: Pick<RoamState, 'wounded'>): TroopStack {
  const out: TroopStack = {};
  for (const g of r.wounded) for (const [id, n] of Object.entries(g.troops) as [TroopId, number][]) out[id] = (out[id] ?? 0) + n;
  return out;
}

/**
 * Паёк отряда за игровой день: паёк бойца города (`build.soldierFoodPerDay`, сезон — тот же множитель еды) на рты строя и
 * раненых, конный — за двоих (`mouthsOf`). Указа о пайке у бродяги нет — рацион обычный.
 */
export const bandRationPerDay = (r: Pick<RoamState, 'band' | 'wounded'>, seasonFood: number): number =>
  soldierFoodPerDay(seasonFood, 1) * (mouthsOf(r.band) + mouthsOf(woundedOf(r)));

/**
 * Терпение отряда без жалованья и еды, игровых дней (ГДД 3.3.2): две игр. дн. и по полдня за кружок Военного дела героя. Числа —
 * лестница Статуи Героя (`statue.loyalty`, `perLevel`): у города терпение дружины держит памятник, у отряда — герой, и кружок
 * героя стоит столько же, сколько уровень Статуи. Второй лестницы нет.
 */
export const bandPatienceDays = (war: number): number => statAt('statue', 'loyalty', 1 + Math.max(0, Math.floor(war)));

/**
 * Полоса терпения отряда, 0…100 (как `sim/stability.armyBar` у дружины города): сколько уже вытерпели долга или голода против
 * терпения героя. Её читает дух (строка «терпение»).
 */
export function bandBar(late: number, war: number): number {
  const l = Math.max(0, late);
  if (l <= 0) return 0;
  const grace = bandPatienceDays(war) * DAY_LENGTH;
  return grace > 0 ? Math.min(100, (100 * l) / grace) : 100;
}

/** Сколько добра в обозе всего. */
export const cargoLoad = (r: Pick<RoamState, 'cargo'>): number =>
  Object.values(r.cargo).reduce((n: number, v) => n + Math.max(0, v ?? 0), 0);

/**
 * Лучший сезон поля (Фермы) в таблице сезонов: им меряется фураж прочих. Функцией, а не числом при загрузке модуля: вычисление
 * на верхнем уровне сборщик не выбросил бы, и правила отряда приехали бы в первую загрузку.
 */
const fieldPeak = (): number => Math.max(...SEASONS.map((x) => SEASON_MODIFIERS[x].jobs.farmer ?? 1));

/**
 * Фураж сезона (ГДД 3.3.4) — доля пайка, которую земля даёт отряду. **Выводится, а не пишется рукой** («Решения ПН-1», Р4;
 * ориентир ГДД «лето 50, осень 60, весна 30, зима 0 %» в код не идёт): в лучший сезон поля земля кормит отряд вполсилы — как
 * вольный сбор без двора (`FREE_RANGE_MULT`), в прочие — долей поля сезона против лучшего. Поле — множитель Фермы в таблице
 * сезонов (`SEASON_MODIFIERS`, через `seasonMods`: мягкая первая зима и вести, что двигают поле, двигают и фураж); второй
 * таблицы нет. Зимой поле мертво — фуража нет. Печатает его `npm run roam:report`, раздел «Фураж по сезонам».
 */
export function fieldForage(mods: Pick<SeasonModifiers, 'jobs'>): number {
  const peak = fieldPeak();
  return peak > 0 ? (FREE_RANGE_MULT * Math.max(0, mods.jobs.farmer ?? 1)) / peak : 0;
}

/**
 * Какую долю пайка отряд добирает с земли (ГДД 3.3.4): в лагере и в пути обычным маршем — фураж сезона; налегке времени на
 * сбор нет, с обозом колонна везёт своё. Местность (лес +, поле −) и вид лагеря — с ПН-3 и ПН-4у, когда прибор выведет их числа.
 */
export function forageShare(mods: Pick<SeasonModifiers, 'jobs'>, r: Pick<RoamState, 'camp' | 'gait'>): number {
  const share = r.camp !== null || r.gait === 'normal' ? fieldForage(mods) : 0;
  return Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
}

/**
 * Какая доля отряда голодна сейчас (как `derived.foodShortfall` у города): обоз пуст — та часть пайка, которую не закрывает
 * фураж; хлеб в обозе есть — никто. «Пуст» — та же мерка, что у амбара: меньше половины единицы.
 */
export const bandHunger = (r: Pick<RoamState, 'cargo' | 'camp' | 'gait'>, mods: Pick<SeasonModifiers, 'jobs'>): number =>
  (r.cargo.food ?? 0) > 0.5 ? 0 : 1 - forageShare(mods, r);

/**
 * Какая доля отряда не оплачена (как `derived.unpaidShare` у города): доход у отряда — ноль (налога нет), и пока есть долг,
 * не оплачен весь отряд.
 */
export const bandUnpaid = (debt: number, due: number): number => (debt > 0 && due > 0 ? 1 : 0);
