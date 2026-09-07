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

/**
 * Стадии в порядке настоящей работы:
 * - `code` — бандл ещё едет (ставит сам экран, до всякой игры);
 * - `save` — читаем сохранение из localStorage и CloudStorage;
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
 * Сколько ждём кадра, прежде чем идти дальше без него.
 *
 * В свёрнутой вкладке и в скрытом вебвью `requestAnimationFrame` не вызывается
 * вовсе — не «редко», а никогда, пока страницу не покажут. Без этого срока
 * экран загрузки висел бы у свернувшего игру ровно до возвращения, а сторожевой
 * таймер успел бы объявить исправную игру сломанной. Проверено: в скрытой
 * панели браузера игра так и осталась под экраном загрузки.
 */
const PAINT_WAIT_MS = 250;

/**
 * Уступает браузеру кадр, чтобы подпись стадии успела нарисоваться.
 *
 * Два кадра, а не один: первый только вычисляет стиль после правки DOM, рисует
 * второй. Без этого «считаем, что было без тебя» встало бы в очередь за самим
 * подсчётом и появилось бы ровно тогда, когда он уже кончился.
 *
 * Кадр — вежливость, а не условие: ждём его наперегонки с таймером и в любом
 * случае идём дальше.
 */
export function bootPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    setTimeout(finish, PAINT_WAIT_MS);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}
