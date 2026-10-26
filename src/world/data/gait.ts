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

/** Слова режима: имя на кнопке и строка «что это» для окна. */
export const GAIT_META: Readonly<Record<Gait, { name: string; short: string; about: string }>> = {
  light: {
    name: 'Налегке',
    short: 'налегке',
    about: 'Без обоза: быстрее, но отряд тает в пути и в поле. Лагерь не ставит — только удар с ходу или перехват.',
  },
  normal: {
    name: 'Обычный',
    short: 'обычным маршем',
    about: 'Как прежде: обычная скорость, в пути не тает, может осаждать.',
  },
  train: {
    name: 'С обозом',
    short: 'с обозом',
    about: 'Вдвое медленнее, но обоз кормит отряд в пути и в лагере: голод дома его не трогает, лагерь тает меньше.',
  },
};
