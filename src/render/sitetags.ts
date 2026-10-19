// Общая доска сцены и интерфейса — места ярлыков у лесов и камера города. Модуль крошечный и без импортов нарочно: интерфейс
// не тянет за собой кусок города, а сцена — интерфейс; и доска одна, а не по модулю на дело: каждый новый общий кусок ложится
// своим именем в список предзагрузки первой загрузки (ОР-1, docs/ui_v2.md, 5.9, решение 11).
//
// Места ярлыков (docs/gems.md, «Ускорение»): сцена города ставит места над стройками (`render/city/tags.ts`, кусок города),
// интерфейс кладёт в них кнопку «Ускорить» порталом (`ui/next/Rush.tsx`).

/** Где сейчас стоят места: тип постройки → элемент. Пишет только сцена. */
const hosts = new Map<string, HTMLElement>();

/** Событие окна: набор мест сменился (стройка началась или кончилась). */
export const SITE_TAGS_EVENT = 'tribe-site-tags';

/** Места ярлыков на эту минуту. */
export const siteTagHosts = (): ReadonlyMap<string, HTMLElement> => hosts;

/** Поставить набор мест — только сцена (`render/city/tags.ts`). */
export function setSiteTagHosts(next: ReadonlyMap<string, HTMLElement>): void {
  hosts.clear();
  for (const [k, v] of next) hosts.set(k, v);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SITE_TAGS_EVENT));
}

// ---------- Камера города (ОР-1, docs/ui_v2.md, 5.9) ----------
// Интерфейс ставит рычаг «Подписи» и просит камеру — «Показать в городе», «Домой»; сцена города берёт рычаг и просьбу каждый
// кадр и говорит, ушла ли камера с дома, — по этому интерфейс показывает кнопку «Домой». Просьба — здесь, а не методом общей
// оболочки сцены (`render/Scene.ts`): та в первой загрузке, и метод для одного города рос бы там.

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

/** Просьба к камере: показать постройку (тип постройки игры) или вернуться на стартовый кадр. */
export type CamAsk = { kind: 'show'; type: string } | { kind: 'home' };

let asked: CamAsk | null = null;

/** Попросить камеру — только интерфейс (`kit/nav.showInCity`, кнопка «Домой»). Новая просьба заменяет невзятую. */
export function askCam(a: CamAsk): void {
  asked = a;
}

/** Взять просьбу — только сцена (`city/scene.ts`), раз за кадр: взятая снимается. */
export function takeCamAsk(): CamAsk | null {
  const a = asked;
  asked = null;
  return a;
}
