// Режим марша полководца — числа дизайна в одном месте (ДР-2, docs/siege_v2.md, 25.1). Считает всё одна дверь —
// `world/gait.ts`; мир на клиенте и сервер войны спрашивают её. Без `@/`: файл собирает сервер.
import { CAMP_WASTE, CAMP_WASTE_HUNGRY, SIEGE_PHASE } from './siegeroll';
import { FIGURE_BY_ID } from './figures';
import type { FigureId } from '../types';
import { gameDaysOfMs } from '../../game/pace';

/** Режим марша: налегке, обычный (как до ДР-2), с обозом. Нет поля — обычный. */
export type Gait = 'light' | 'normal' | 'train';

/** Порядок в окне: быстрый — слева, долгий — справа. */
export const GAITS: readonly Gait[] = ['light', 'normal', 'train'];

/**
 * Режим из записи: «налегке» или «с обозом», иначе — обычный (старый поход, мусор, нет поля). Одна дверь чтения на мир, сервер
 * войны и ход отряда бродяги (ПН-3: шаг отряда читает режим хода, а дверь режима `world/gait` в главный кусок не тянет).
 */
export const readGait = (v: unknown): Gait => (v === 'light' || v === 'train' ? v : 'normal');

/**
 * Множитель скорости полководца (М3). «С обозом» — вдвое ниже (задание). «Налегке» — форсированный марш EU4 (+50 %), и из
 * структуры мира: набег логова идёт скоростью воина, ровно скоростью полководца, и уходящий набег обычный полководец сзади не
 * догоняет — налегке догоняет (MAP-9).
 */
export const GAIT_SPEED: Readonly<Record<Gait, number>> = { light: 1.5, normal: 1, train: 0.5 };

/**
 * Скорость полководца в режиме марша, клеток в минуту по равнине (М3): одна мерка на мир и на сервер войны. Объявление рядом
 * с числом — здесь, в данных: в мире скорость читают только объявления и строка, которая тут же зовёт `geo.travelTime`
 * (замок `pace.test.ts`). Нет режима, мусор — обычный.
 */
export const generalSpeed = (g?: Gait): number => FIGURE_BY_ID.general.speed * GAIT_SPEED[g === 'light' || g === 'train' ? g : 'normal'];

/** Скорость фигуры: у полководца — в его режиме марша, у прочих — своя. */
export const figureSpeed = (id: FigureId, g?: Gait): number => (id === 'general' ? generalSpeed(g) : FIGURE_BY_ID[id].speed);

/**
 * Истощение налегке за игровой день в пути и в поле (М4): голодный лагерь на ходу — истощение лагеря при пустом амбаре дома
 * (`CAMP_WASTE × CAMP_WASTE_HUNGRY` за фазу), разложенное по дням фазы. Выводится из чисел лагеря, а не пишется рукой:
 * сдвинется вывод `CAMP_WASTE` — сдвинется и оно.
 */
export const GAIT_LIGHT_WASTE = (CAMP_WASTE * CAMP_WASTE_HUNGRY) / gameDaysOfMs(SIEGE_PHASE);

/**
 * Доля поклажи колонны, которую везёт её обоз (ДР-5): та же доля, что кормит лагерь, — пустой амбар дома удваивает истощение
 * лагеря (`CAMP_WASTE_HUNGRY`), значит половину нужды колонны везёт она сама на возах. Выводится, а не пишется рукой.
 */
export const TRAIN_SHARE = 1 / CAMP_WASTE_HUNGRY;

/**
 * Вывоз добычи по режиму марша (ДР-5, решение владельца: налегке ×0,5, с обозом ×1,25 — ориентиры), множитель поклажи
 * бойца (`units.warrior.carry`). Налегке обоза нет — везут только на себе: `1 − TRAIN_SHARE`. С обозом — второй обоз (М5:
 * «обоз — второй склад лагеря»; потому и вдвое медленнее), и его доля `TRAIN_SHARE` занята хлебом лагеря, а свободно —
 * остальное: `1 + TRAIN_SHARE × (1 − TRAIN_SHARE)`. При `CAMP_WASTE_HUNGRY` = 2 — ×0,5 и ×1,25 (`npm run march`).
 * Пленных это не касается: они идут сами.
 */
export const GAIT_HAUL: Readonly<Record<Gait, number>> = {
  light: 1 - TRAIN_SHARE,
  normal: 1,
  train: 1 + TRAIN_SHARE * (1 - TRAIN_SHARE),
};

/**
 * Слова режима: имя на кнопке и в летописи, коротко — в строке похода. Строка «что это» — у окон, своим куском
 * (`ui/parts/gaitWords.GAIT_ABOUT`): шагу мира и первой загрузке она не нужна.
 */
export const GAIT_META: Readonly<Record<Gait, { name: string; short: string }>> = {
  light: { name: 'Налегке', short: 'налегке' },
  normal: { name: 'Обычный', short: 'обычным маршем' },
  train: { name: 'С обозом', short: 'с обозом' },
};
