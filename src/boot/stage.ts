/**
 * Единственная дверь из игры в экран загрузки.
 *
 * Сам экран живёт в `index.html` — целиком, вместе с кодом (почему именно так,
 * написано там же). Отсюда в него уходят только имена стадий: игра говорит, что
 * она сейчас делает, а как это нарисовать, знает экран.
 *
 * Модуля с копией правил здесь нет и быть не должно: пороги показа, присказки и
 * цвета темы живут в одном месте — в `index.html`, и тест `boot.test.ts` читает
 * именно тот файл.
 */
import { afterPaint } from './paint';

/**
 * Стадии в порядке настоящей работы:
 * - `code` — бандл ещё едет (ставит сам экран, до всякой игры);
 * - `save` — читаем сохранение с устройства;
 * - `offline` — досчитываем, что случилось в посёлке без игрока;
 * - `scene` — собираем трёхмерную диораму;
 * - `done` — всё.
 */
export type BootStage = 'code' | 'save' | 'offline' | 'scene' | 'done';

interface BootApi {
  stage(name: BootStage): void;
  done(): void;
  fail(why: string): void;
  visible(): boolean;
}

const api = (): BootApi | null => {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __boot?: BootApi }).__boot ?? null;
};

export const bootStage = (name: BootStage): void => api()?.stage(name);

export const bootDone = (): void => api()?.done();

export const bootFail = (why: string): void => api()?.fail(why);

/** Виден ли экран сейчас — по нему решают, нужен ли кадр перед долгой работой. */
export const bootVisible = (): boolean => api()?.visible() ?? false;

/**
 * Уступает браузеру кадр, чтобы подпись стадии успела нарисоваться.
 *
 * Та же функция, которой пользуется занавес перехода между посёлком и картой:
 * повод один — впереди долгая работа в главном потоке (см. `boot/paint.ts`).
 */
export const bootPaint = afterPaint;
