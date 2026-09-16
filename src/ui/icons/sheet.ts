// Лист значков: одна загрузка на игру и одно место, где решается «картинка или эмодзи».
//
// Почему лист, а не файл на каждый значок: значки стоят в строке состояния и в навигации,
// то есть на экране с первой секунды. Запрос на каждый значок с телефона — это секунды
// ожидания, и кэш не спасает на первом заходе. Почему не в бандле: тогда вес двумерного арта
// нельзя было бы померить отдельно от кода, а у него свой потолок (`ART_CAP_GZIP` в
// `scripts/build-icons.ts`, техзадание 3.3),
// и растёт он с каждой очередью.
//
// Пока лист не приехал, интерфейс рисует эмодзи — тот же путь, что и у значка, которого
// ещё не нарисовали. Отдельного «состояния загрузки» поэтому нет: незагруженный лист и
// незаказанный значок для интерфейса одно и то же.
import { DRAWN_ICONS, ICON_SHEET } from './generated';

const DRAWN = new Set(DRAWN_ICONS);

/** Нарисован ли такой значок вообще. Знать это можно сразу, лист для этого не нужен. */
export const isDrawn = (name: string): boolean => DRAWN.has(name);

/** Идентификатор символа внутри листа. */
export const symbolOf = (name: string): string => `#i-${name}`;

let ready = false;
let started = false;
const listeners = new Set<() => void>();

/** Лист уже в документе — значит, `<use>` покажет картинку, а не пустоту. */
export const sheetReady = (): boolean => ready;

export function onSheet(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Тянет лист и кладёт его в документ скрытым блоком. Зовётся сама при первом импорте:
 * чем раньше начнётся загрузка, тем вернее лист успеет к первому кадру интерфейса.
 * Повторные вызовы ничего не делают.
 */
export function loadSheet(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  void fetch(ICON_SHEET)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((text) => {
      const host = document.createElement('div');
      // Скрываем размером, а не display:none: часть браузеров не разрешает
      // ссылаться <use> на символ внутри невидимого поддерева.
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      host.innerHTML = text;
      document.body.prepend(host);
      ready = true;
      for (const fn of listeners) fn();
    })
    .catch(() => {
      // Лист не приехал — значки останутся эмодзи. Ронять из-за этого игру незачем.
    });
}

loadSheet();
