// Стабильность державы: числа и чистые формулы — одни на игру (`sim/stability`, `derived`) и на сервер
// (`netlify/lib/watch.ts`: книга стабильности, docs/stability.md, раздел 2.7). Две копии разошлись бы молча: сервер счёл бы
// подделкой честную покупку ступени или пропустил бы ступень из ничего. Без `@/`-импортов: модуль читает серверная часть.
//
// **Своих чисел здесь два, и оба выведены** (`DRAG`, `CALM` — `npm run stability:report`, неподвижной точкой по целям
// docs/stability.md, раздел 3). Остальное — из того, что игра уже сказала: полоса роста морали, просадка высокого налога,
// срок ропота невольников, потолок очков и прямая цены уровня технологии.
import { MORALE_GROWTH_FULL, MORALE_GROWTH_ZERO, MORALE_OUTPUT_SPAN, MUTINY_FUSE } from './constants';
import { DAY_LENGTH } from './pace';
import { TAX_BY_ID } from './data/policy';
import { MAX_RULER_SKILL, POINTS_CAP, POINTS_PER_SKILL_PER_DAY } from './data/realm';

/** Ступени: от «Смуты» до «Благоденствия». */
export const STAB_MIN = -3;
export const STAB_MAX = 3;

/**
 * Выше этой ступени стабильность сама не поднимается — только укреплением за очки (docs/stability.md, 2.1). «Лад» — то,
 * до чего доводит ровная жизнь; дальше — усилие правителя. Как в EU4: стабильность сама не растёт, её покупают; у нас
 * ровная жизнь вытягивает до первой ступени, иначе посёлок без единого очка жил бы вечно на нуле.
 */
export const STAB_SELF_MAX = 1;

/** Сдвиг, на котором ступень сменяется: проценты ступени. */
export const STAB_DRIFT = 100;

/**
 * Полоса морали, переводящая просадку морали в недовольство: причина, которая одна опускала бы мораль от полного прироста
 * (`MORALE_GROWTH_FULL`) до бегства жителей (`MORALE_GROWTH_ZERO`), — это недовольство целиком, 100 %. Нового числа нет.
 */
export const STAB_BAND = MORALE_GROWTH_FULL - MORALE_GROWTH_ZERO;

/** Сколько процентов недовольства даёт причина весом `morale` очков морали. */
export const discontentOf = (morale: number): number => (100 * morale) / STAB_BAND;

/**
 * Ступень стабильности — поправка морали на столько очков (не трогая саму мораль): ею ступень двигает выработку, порядок и
 * недовольство (docs/stability.md, 2.6). **Выведена из цели Ц3** — «мятеж на −3 редок, но реален»: при высоком налоге на
 * −3 податные доходят до мятежа, на −2 — нет. Границы цели — `(BAND − налог) / 3` (ровно 100 % на −3) и `(BAND − налог) / 2`
 * (ровно на −2); ступень — середина между ними, чтобы ни одна граница не держалась на равенстве: `5 (BAND − налог) / 12`.
 */
export const STAB_STEP = (5 * (STAB_BAND - TAX_BY_ID.high.moralePenalty)) / 12;

/** Множитель выработки на ступени — та же цена морали, что у `derived.moraleOutputMult`. */
export const stabOutputMult = (level: number): number => 1 + (MORALE_OUTPUT_SPAN * STAB_STEP * stabClamp(level)) / 100;

/** Ступень в пределах шкалы, целым. */
export const stabClamp = (level: number): number => Math.max(STAB_MIN, Math.min(STAB_MAX, Math.round(Number.isFinite(level) ? level : 0)));

/**
 * Цена подъёма на ступень `to` — очков **каждого** из трёх видов. Прямая до потолка тем же правилом, что уровень технологии
 * (`data/realm.levelPrice`): верхняя ступень стоит ровно потолок очков (дороже не накопить), нижняя — та, с которой
 * подниматься бесплатно. Вне шкалы — ноль: такой покупки нет.
 */
export function stabPrice(to: number): number {
  const l = Math.round(to);
  if (l <= STAB_MIN || l > STAB_MAX) return 0;
  return Math.round((POINTS_CAP * (l - STAB_MIN)) / (STAB_MAX - STAB_MIN));
}

/** Самая дешёвая ступень — по ней сервер меряет, сколько очков не может не уйти на купленные. */
export const STAB_PRICE_MIN = stabPrice(STAB_MIN + 1);

/**
 * Скорость полосы недовольства, % за игровой день: от нуля до ста — за срок ропота невольников (`MUTINY_FUSE`), вниз — вдвое
 * быстрее, тем же правилом «тает вдвое быстрее», что у ропота, голода и холода. Своего срока у недовольства нет.
 */
export const GROUP_RISE = (100 * DAY_LENGTH) / MUTINY_FUSE;
export const GROUP_FALL = 2 * GROUP_RISE;

/** Полоса выше этого и растёт — мятеж близок: тревога и весть в бот (docs/stability.md, 2.8). */
export const REVOLT_NEAR = 80;

/** Мятеж встаёт, когда полоса дошла до ста; допуск — чтобы цель ровно сто не держалась на последнем знаке дроби. */
export const REVOLT_AT = 100 - 1e-6;

/**
 * Тянет вниз: сколько процентов ступени за игровой день снимает группа, недовольная целиком (полоса 100 %). Осада у стен
 * тянет так же, как одна такая группа. **Выводит `npm run stability:report`** (цель Ц2: тяжёлый налог с голодом доводит до
 * −2 за 12 игр. дн.) неподвижной точкой; руками не правится.
 */
export const STAB_DRAG = 15.71;

/**
 * Тихие дни: сколько процентов ступени за игровой день прибавляет ровная жизнь. **Выводит `npm run stability:report`**
 * (цель Ц1: ровная игра поднимается из 0 в +1 за сутки отлучки, 48 игр. дн.) неподвижной точкой; руками не правится.
 */
export const STAB_CALM = 10.73;

/** Толчок сдвига от боя: его мораль — мерой одного дня причины того же веса (docs/stability.md, 2.2). */
export const battleShock = (morale: number): number => (STAB_DRAG * discontentOf(morale)) / 100;

// ---------- Сервер: потолки книги стабильности ----------

/**
 * Очков каждого вида, которые могли уйти на ступени за `days` игровых дней: всё, что было (потолок), и приток самого
 * сильного правителя, какой в игре бывает. Больше ушло — подделка.
 */
export const stabPointsCeil = (days: number): number => POINTS_CAP + MAX_RULER_SKILL * POINTS_PER_SKILL_PER_DAY * Math.max(0, days);

/**
 * На сколько ступеней стабильность может подняться сама за `days` игровых дней при `wins` выигранных боях: тихие дни без
 * единого недовольного, сдвиг Статуи Героя (`statue`, % ступени в день — `statuerules.statueCalm` лучшей, ДР-7) плюс толчки
 * побед, каждая — как бой с самой большой моралью победы (`moraleWin`). Выше `STAB_SELF_MAX` сама не поднимается — это правило
 * применяет вызывающий.
 */
export const stabSelfRiseCeil = (days: number, wins: number, moraleWin: number, statue = 0): number =>
  Math.floor(((STAB_CALM + Math.max(0, statue)) * Math.max(0, days) + Math.max(0, wins) * battleShock(Math.max(0, moraleWin))) / STAB_DRIFT) + 1;

/**
 * На сколько ступеней могли поднять вести державы, давшие вместе `rise` % ступени (СБ-2): их сдвиг копится и выше «Лада»,
 * поверх того, что уже набрано, — округление вверх.
 */
export const stabEventRiseCeil = (rise: number): number => Math.ceil(Math.max(0, rise) / STAB_DRIFT);
