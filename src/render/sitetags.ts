// Места ярлыков у лесов (docs/gems.md, «Ускорение») — общая доска сцены и интерфейса. Сцена города ставит места над
// стройками (`render/city/tags.ts`, кусок города), интерфейс кладёт в них кнопку «Ускорить» порталом (`ui/next/Rush.tsx`).
// Модуль крошечный и без импортов нарочно: интерфейс лежит в первой загрузке, и тянуть за собой кусок города ему нельзя.

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
