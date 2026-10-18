// Камера города и подписи построек (ОР-1, docs/ui_v2.md, 5.9) — общая доска сцены и интерфейса, как места ярлыков
// (`sitetags.ts`): интерфейс ставит рычаг «Подписи», сцена читает его каждый кадр и говорит, ушла ли камера с дома, — по
// этому интерфейс показывает кнопку «Домой». Модуль крошечный и без импортов нарочно: кнопки лежат в куске
// интерфейса, и тянуть за собой кусок города им нельзя.

/** Событие окна: камера ушла с дома или вернулась. */
export const CITY_CAM_EVENT = 'tribe-city-cam';

export interface CityCam {
  /** Камера не на стартовом кадре: ведена пальцем или полётом к постройке — есть куда возвращаться. */
  moved: boolean;
}

let cam: CityCam = { moved: false };
let labels = false;

/** Камера на эту минуту. */
export const cityCam = (): CityCam => cam;

/** Поставить положение камеры — только сцена (`city/scene.ts`). То же — ничего не трогается. */
export function setCityCam(next: CityCam): void {
  if (next.moved === cam.moved) return;
  cam = { ...next };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CITY_CAM_EVENT));
}

/** Рычаг «Подписи»: имена над всеми постройками. Сцена читает его каждый кадр. */
export const labelsOn = (): boolean => labels;

/** Поставить рычаг — только интерфейс (`ui/next/CityCam.tsx`). */
export function setLabelsOn(on: boolean): void {
  labels = on;
}
