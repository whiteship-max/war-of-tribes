// Режим марша полководца — одна дверь на мир, на сервер войны и на всё, что его показывает (ДР-2, docs/siege_v2.md, 25.1).
//
// РЕЖИМ — СВОЙСТВО ПОЛКОВОДЦА (`StoredFigure.gait`, у сервера — `WarRow.gait`), нет поля — «Обычный», как до ДР-2. Дома он
// меняется сразу и даром; в пути и в поле — стоянкой и ценой (`gaitHaltMs`, `ENERGY_PRICE.gait`); в лагере — никак.
//
// ЧТО РЕЖИМ ДАЁТ И ОТНИМАЕТ — только здесь: скорость (`gaitSpeed`, её множат все дороги полководца у мира и у сервера),
// вывоз добычи (`gaitHaul`, ДР-5),
// истощение налегке в пути и в поле (`lightShare`, `roadLosses`), может ли отряд встать лагерем (`siegeBlockOf`), лагерь
// с обозом без подвоза из дома (`siegeroll.wasteOf` читает `campFed`), темп энергии дороги (`gaitSpeed` — та же дорога, та
// же энергия). Своей арифметики у окна, у мира и у сервера нет.
//
// Модуль чистый: часов не читает, время приходит доводом. Без `@/`: его собирает и сервер.
import { GAIT_HAUL, GAIT_LIGHT_WASTE, GAIT_META, GAIT_SPEED, type Gait } from './data/gait';
import { wasteLosses } from './siegeroll';
import { travelTime } from './geo';
import { gameDaysOfMs, realMs } from '../game/pace';

export { GAITS, GAIT_HAUL, GAIT_META, GAIT_SPEED, GAIT_LIGHT_WASTE, TRAIN_SHARE, type Gait } from './data/gait';

/** Режим из записи: «налегке» или «с обозом», иначе — обычный (старый поход, мусор, нет поля). */
export const readGait = (v: unknown): Gait => (v === 'light' || v === 'train' ? v : 'normal');

/** Поле режима для записи: обычный — без поля (как до ДР-2). */
export const gaitField = (g: Gait | undefined): { gait?: 'light' | 'train' } => (g === 'light' || g === 'train' ? { gait: g } : {});

/** Множитель скорости полководца в режиме: им множат скорость в `geo.travelTime`, им же — темп энергии дороги. */
export const gaitSpeed = (g: Gait | undefined): number => GAIT_SPEED[readGait(g)];

/**
 * Множитель вывоза добычи в режиме (ДР-5): им множат поклажу отряда полководца (`stackCarry`) у мира (`LocalWorld.haul`) и
 * у сервера войны (`war.fateOfWar`), им же — строку «Вывоз» в окне выбора. Пленных не касается.
 */
export const gaitHaul = (g: Gait | undefined): number => GAIT_HAUL[readGait(g)];

/** Отказ лагеря налегке — одна строка на кнопку, приказ, минуту прихода и сервер (М7). */
export const LIGHT_NO_CAMP = 'Налегке лагерь не ставят: обоза нет. Смени режим марша на «Обычный» или «С обозом».';

/** Может ли отряд в этом режиме встать лагерем: null — может, иначе отказ. */
export const siegeBlockOf = (g: Gait | undefined): string | null => (readGait(g) === 'light' ? LIGHT_NO_CAMP : null);

/** Кормит ли лагерь обоз (М5): путь от дома и амбар дома лагерю с обозом не нужны. */
export const campFed = (g: Gait | undefined): boolean => readGait(g) === 'train';

/** Защищён ли отряд от голода дома (М5б): дух без строки голода, бойцы голодом не уходят. */
export const fedOnRoad = (g: Gait | undefined): boolean => readGait(g) === 'train';

/**
 * Доля отряда, ушедшая налегке за `ms` мира в пути и в поле (М4): выживает `(1 − r)^дни`, `r` — истощение голодного лагеря
 * за игровой день. Не налегке — ноль.
 */
export function lightShare(g: Gait | undefined, ms: number): number {
  if (readGait(g) !== 'light' || !(ms > 0)) return 0;
  return 1 - (1 - GAIT_LIGHT_WASTE) ** gameDaysOfMs(ms);
}

/**
 * Кто уходит налегке за отрезок `ms` от состава `troops` в начале отрезка: доля вида, дробь — бойцом с вероятностью дроби
 * по кости от сида отрезка (та же `siegeroll.wasteLosses`, что у лагеря). Кость вида от доли не зависит, поэтому уход по
 * отрезку не убывает со временем: списать его частями в любые минуты — то же, что разом в конце (`LocalWorld.wearGeneral`).
 */
export function roadLosses<T extends Partial<Record<string, number>>>(troops: T, g: Gait | undefined, ms: number, seed: string): T {
  const share = lightShare(g, ms);
  return share > 0 ? wasteLosses(troops, share, `road:${seed}`, 0) : ({} as T);
}

/**
 * Стоянка при смене режима в пути и в поле (М6), мс мира: самый короткий поход (`MARCH_MIN_SECONDS` той же `geo.travelTime`,
 * поэтому `TEST_TRAVEL_SPEED` делит и её). Обоз разгружают или собирают, отряд стоит.
 */
export const gaitHaltMs = (): number => Math.round(realMs(travelTime(0, 1, 1)));

/** Режим словами — для строк летописи и отказов. */
export const gaitName = (g: Gait | undefined): string => GAIT_META[readGait(g)].name;
