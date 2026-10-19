// Листы значков набора ЗН-1 (docs/icons.md): одно место, где символы попадают в документ.
//
// Первый экран (верх, низ, тревоги, значки над крышами) — строкой кода (`FIRST_SHEET`): он стоит в документе к первому
// кадру и не ждёт сети. Остальные значки — листом `ICON_SHEET`, который игра тянет после первого кадра: окна построек,
// державы и карты открываются не сразу, а первая загрузка за них не платит.
//
// Пока лист в пути, значок ленивой части — пустое место своего размера (`Icon`): эмодзи на замену больше нет.
import { FIRST_SHEET, ICON_SHEET } from './generated';
import { drawnOf } from './alias';

/** Идентификатор символа в документе — по нарисованному имени (ссылка раскрывается). */
export const symbolOf = (name: string): string => `#i-${drawnOf(name)}`;

let lazyReady = false;
let started = false;
const listeners = new Set<() => void>();

/** Лист после первого кадра уже в документе. Первый экран в документе всегда. */
export const sheetReady = (): boolean => lazyReady;

/**
 * Символ значка как элемент документа — холсту карты (`ui/map/tw/glyph.ts`): тот же рисунок, что у `<use>`, без второй
 * загрузки. null — такого значка ещё нет в документе (ленивый лист не приехал) или нет вовсе.
 */
export function sheetSymbol(name: string): Element | null {
  // Заглушка документа в тестах холста карты — без поиска по id: рисунка нет, значок печётся без него.
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  return document.getElementById(`i-${drawnOf(name)}`);
}

export function onSheet(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Скрытый блок с символами. Размером, а не `display:none`: часть браузеров не разрешает `<use>` в невидимое поддерево. */
function host(svg: string): void {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  el.innerHTML = svg;
  document.body.prepend(el);
}

/** Первый экран — сразу, при первом импорте: без него верх и низ стояли бы пустыми. */
function placeFirst(): void {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || !document.body) return;
  if (document.getElementById('zn-first')) return;
  host(`<svg xmlns="http://www.w3.org/2000/svg" id="zn-first">${FIRST_SHEET}</svg>`);
}

/**
 * Тянет лист остальных значков и кладёт его в документ. Зовётся после первого кадра (`requestIdleCallback`, иначе
 * таймер): лист не спорит с кодом и шрифтом первой загрузки. Повторные вызовы ничего не делают.
 */
export function loadSheet(): void {
  if (started || typeof document === 'undefined' || !document.body || typeof fetch === 'undefined') return;
  started = true;
  void fetch(ICON_SHEET)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((text) => {
      host(text);
      lazyReady = true;
      for (const fn of listeners) fn();
    })
    .catch(() => {
      // Лист не приехал — ленивые значки останутся пустыми местами. Ронять из-за этого игру незачем; следующий вход
      // попробует снова.
      started = false;
    });
}

placeFirst();
if (typeof window !== 'undefined') {
  const later = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (later) later(loadSheet, { timeout: 1500 });
  else setTimeout(loadSheet, 300);
}
