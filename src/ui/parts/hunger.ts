// Часы голода словами — одна строка на все места, где их видит игрок: окно обороняющегося,
// окно лагеря, плашка осады в деревне и карточка города на карте.
//
// Минуту голода считает мир одним чтением окна (`LocalWorld.hungerOf`) и отдаёт её всем
// четырём местам одним и тем же полем `starvesAt`; здесь от неё до строки остаётся ровно
// один шаг. Держит это тест по исходнику: `starvesAt` в интерфейсе в слова превращает
// только этот модуль, и места снова не разойдутся тем, что одно округлит иначе.
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import { breadSpan } from '@/world/siegefood';

/** Сколько осталось до голода, словами: «12 мин», «1 ч 05 мин», «0 с». */
export const hungerLeft = (starvesAt: number, now: number): string => realLeft(secondsLeft(starvesAt, now));

/**
 * Сколько хлеба хватит — прогноз склада (ОС-1, `SiegeView.dryAt`), словами двери хлеба (`siegefood.breadSpan`): «~6 ч 30 мин».
 * Нет минуты — склад не опустеет: «не кончится». Для сведения: голод решает шаг осады, а не эта минута.
 */
export const dryLeft = (dryAt: number | undefined, now: number): string => breadSpan(dryAt === undefined ? Infinity : secondsLeft(dryAt, now));
