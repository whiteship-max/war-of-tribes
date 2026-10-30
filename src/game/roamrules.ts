// Правила отряда бродяги (ПН-1, docs/gdd/path_of_sword.md, 3.3; «Решения ПН-1») — числа и формулы без состояния партии: что
// отряд стоит за игровой день, сколько терпит, сколько везёт и сколько добирает с земли. Читают их двери ПН-1 (`sim/upkeep`,
// `sim/roam`, `sim/spirit`), прибор пути (`npm run roam:report`) и — с ПН-6 — книга отряда сервера (`roambook`): одни числа на всех.
//
// Своих чисел здесь нет ни одного. Жалованье и паёк — формулы города (`price.baseWage`, `build.soldierFoodPerDay`), терпение —
// лестница Статуи, фураж — поле сезона из таблицы сезонов (`SEASON_MODIFIERS`) и вольный сбор. Вместимость обоза — ноша бойца
// мира — считает шаг отряда (`sim/roam.cargoCap`). Место и погоду лагеря (ПН-12л) правила берут готовыми — дверью
// `world/campsite` (`OpenSky`): с ПН-5 правила отряда едут куском пути, и мир отсюда в первую загрузку не попадает (сторож сборки).
// Ориентиры ГДД (телега +400, фураж лета 50 %, лагеря ×0.5 и ×0.8) сюда не идут, пока их не вывел прибор (ГДД, «Как читать числа»).
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
import { roamStub } from './roamstubs';
import { wayGait, type CampKind, type RoamCampRec } from '@/world/roammove';
import { fireShare, placeForage, weatherForage, type Site } from '@/world/campsite';
import type { Weather } from '@/world/weather';

/** Место и погода стоящего отряда под открытым небом (ПН-12л, `world/campsite`): их читают фураж и дух лагеря. */
export interface OpenSky {
  site: Pick<Site, 'terrain' | 'shore'>;
  sky: Pick<Weather, 'rain'>;
}

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
 * Фураж лагеря вида `k` — доля полного (ГДД 3.5.3, ПН-3): открытый лагерь собирает, как ходят обычным маршем, — полный фураж
 * сезона; скрытый (без огня) и в руинах — меньше, на сколько — заглушки `forageHidden`, `forageRuin` (`game/roamstubs`, ПН-5).
 */
export const campForage = (k: CampKind): number => (k === 'hidden' ? roamStub('forageHidden') : k === 'ruin' ? roamStub('forageRuin') : 1);

/**
 * Какую долю пайка отряд добирает с земли (ГДД 3.3.4): в лагере — фураж сезона долей вида лагеря (`campForage`); в пути и в
 * поле без лагеря обычным маршем — фураж сезона; налегке времени на сбор нет, с обозом колонна везёт своё. Режим — поле хода
 * (`way.gait`, ПН-3). Стоящий под открытым небом (`open`, ПН-12л) берёт с земли по месту — лес и берег больше, голое поле меньше
 * (`campsite.placeForage`), — и в дождь меньше (`weatherForage`); идущая колонна — по средней земле: дорога идёт по разной.
 */
export function forageShare(mods: Pick<SeasonModifiers, 'jobs'>, r: Pick<RoamState, 'camp' | 'way'>, open?: OpenSky | null): number {
  const base = r.camp ? fieldForage(mods) * campForage(r.camp.kind) : wayGait(r.way) === 'normal' ? fieldForage(mods) : 0;
  const share = open ? base * placeForage(open.site) * weatherForage(open.sky) : base;
  return Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
}

/** Самая лютая стужа в таблице сезонов — дрова под открытым небом (`heating`); функцией, а не числом при загрузке модуля. */
const heatPeak = (): number => Math.max(...SEASONS.map((x) => SEASON_MODIFIERS[x].heating));

/**
 * Дух лагеря, очков морали (ГДД 3.5.3, 3.3.3; ПН-3) — строка «Лагерь» в духе отряда (`sim/spirit`): открытый (костры, шатры) —
 * плюс, сколько — заглушка `campMorale`; дождь заливает костры той долей, какой льёт (`campsite.fireShare`, ПН-12л); скрытый, без
 * огня, — «холодный лагерь»: минус заглушки `coldCamp` долей стужи сезона — сколько дров жжёт житель под открытым небом против самой
 * лютой зимы (`SEASON_MODIFIERS.heating`, через `seasonMods`: мягкая первая зима смягчает и его). Летом топить не нужно — и холода
 * нет; условия по сезону в коде нет. В руинах огонь в укрытии — ни плюса, ни минуса. Нет лагеря — ноль.
 */
export function campSpirit(c: Pick<RoamCampRec, 'kind'> | null, mods: Pick<SeasonModifiers, 'heating'>, sky?: Pick<Weather, 'rain'> | null): number {
  if (!c) return 0;
  if (c.kind === 'open') return roamStub('campMorale') * (sky ? fireShare(sky) : 1);
  if (c.kind !== 'hidden') return 0;
  const peak = heatPeak();
  return peak > 0 ? (-roamStub('coldCamp') * Math.max(0, mods.heating)) / peak : 0;
}

/**
 * Какая доля отряда голодна сейчас (как `derived.foodShortfall` у города): обоз пуст — та часть пайка, которую не закрывает
 * фураж; хлеб в обозе есть — никто. «Пуст» — та же мерка, что у амбара: меньше половины единицы.
 */
export const bandHunger = (r: Pick<RoamState, 'cargo' | 'camp' | 'way'>, mods: Pick<SeasonModifiers, 'jobs'>, open?: OpenSky | null): number =>
  (r.cargo.food ?? 0) > 0.5 ? 0 : 1 - forageShare(mods, r, open);

/**
 * Какая доля отряда не оплачена (как `derived.unpaidShare` у города): доход у отряда — ноль (налога нет), и пока есть долг,
 * не оплачен весь отряд.
 */
export const bandUnpaid = (debt: number, due: number): number => (debt > 0 && due > 0 ? 1 : 0);
