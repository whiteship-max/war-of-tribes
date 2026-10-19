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

// ---------- Камера города (ОР-1, ЗН-3; docs/ui_v2.md, 5.9 и 5.10) ----------
// Интерфейс ставит рычаг «Подписи» (строка настроек профиля) и просит камеру показать постройку («Показать в городе»);
// сцена города берёт рычаг и просьбу каждый кадр. Просьба — здесь, а не методом общей оболочки сцены (`render/Scene.ts`):
// та в первой загрузке, и метод для одного города рос бы там. Рычаг помнится устройством (`localStorage`): это удобство
// зрителя, а не партия.

const LABELS_KEY = 'tribe.labels';

function readLabels(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LABELS_KEY) === '1';
  } catch {
    return false;
  }
}

let labels = readLabels();
const labelSubs = new Set<() => void>();

/** Рычаг «Подписи»: имена над всеми постройками. Сцена читает его каждый кадр. */
export const labelsOn = (): boolean => labels;

/** Подписаться на рычаг (`useSyncExternalStore` строки настроек). */
export function subscribeLabels(cb: () => void): () => void {
  labelSubs.add(cb);
  return () => labelSubs.delete(cb);
}

/** Поставить рычаг — только интерфейс (строка «Подписи», `ui/parts/Settings.tsx`); запоминается устройством. */
export function setLabelsOn(on: boolean): void {
  labels = on;
  try {
    localStorage.setItem(LABELS_KEY, on ? '1' : '0');
  } catch {
    /* не запомнится — рычаг и так стоит до перезагрузки */
  }
  for (const cb of labelSubs) cb();
}

/** Просьба к камере: показать постройку (тип постройки игры). */
export type CamAsk = { kind: 'show'; type: string };

let asked: CamAsk | null = null;

/** Попросить камеру — только интерфейс (`next/show.showInCity`). Новая просьба заменяет невзятую. */
export function askCam(a: CamAsk): void {
  asked = a;
}

/** Взять просьбу — только сцена (`city/scene.ts`), раз за кадр: взятая снимается. */
export function takeCamAsk(): CamAsk | null {
  const a = asked;
  asked = null;
  return a;
}
