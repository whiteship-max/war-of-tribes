/**
 * Подсказка нового интерфейса — одна дверь (docs/ui_audit.md, 3.7): открывается **касанием** по
 * информационному элементу — запасу, числу верхней строки, значку тревоги, — показывает имя, одну-две
 * строки и, если есть куда, ссылку дальше. Закрывается следующим касанием где угодно, и это касание
 * больше ничего не делает. Подсказка новичку (`Hints`, поле `free`) — иначе: касаний мимо плашки она не ловит.
 *
 * Долгого нажатия нет и не будет (решение владельца 01.10.2026): тап — до 700 мс (`gestures.TAP_MS`), и
 * удержание делило бы с ним ту же ось времени; в вебвью Telegram удержание ещё и зовёт системное меню и
 * лупу. Поэтому своих таймеров у подсказки нет: она открывается на обычный `click`, судья касаний холста
 * остаётся один — `src/gestures.ts`.
 *
 * У кнопки действия подсказки нет: она несёт значок и короткую подпись.
 *
 * Модуль без React-разметки: состояние и расчёт места. Рисует `TipLayer` (`TipLayer.tsx`). Файлу слоя нельзя зваться
 * `Tip.tsx`: на Windows регистр имён не различается, и `./Tip` находил этот модуль вместо слоя.
 */
import { create } from 'zustand';

/** Предел длины текста подсказки (3.11): длиннее — это уже панель, а не подсказка. */
export const TIP_MAX = 140;
/** Поле от края экрана и зазор от элемента. */
export const TIP_EDGE = 8;
export const TIP_GAP = 8;
/** Ширина плашки. */
export const TIP_W = 272;

export interface TipLink {
  label: string;
  go: () => void;
}

export interface TipContent {
  title: string;
  /**
   * Строка вкуса описания (docs/voice.md, 3) — курсивом над делом. В `TIP_MAX` не входит: её открывают нарочно,
   * касанием по значку постройки, и стоит она своей строкой.
   */
  lore?: string;
  /** Одна-две строки, не длиннее `TIP_MAX` вместе с именем. */
  body?: string;
  link?: TipLink;
  /**
   * Подсказка новичку (`Hints`): касаний мимо плашки не ловит — город и постройки под ней отвечают, как без неё;
   * закрывается касанием по самой плашке или крестиком, а пока город занят шторкой, картой, державой или промыслами —
   * прячется и ждёт (решение владельца 07.10.2026). Подсказку числа игрок открыл сам, и следующее касание где угодно
   * закрывает её, ничего больше не делая (3.7); подсказка новичку встаёт сама — и съесть касание, которым игрок целил в
   * постройку, не вправе.
   */
  free?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TipPlace {
  left: number;
  width: number;
  /** Под элементом — `top`; над ним — `bottom` от нижнего края экрана. */
  top: number | null;
  bottom: number | null;
  /** Где стрелка — от левого края плашки. */
  arrow: number;
  below: boolean;
}

/**
 * Где встать плашке. Элемент в верхней половине экрана — плашка под ним (верх, тревоги), в нижней — над
 * ним (низ, шторка). По ширине — в пределах экрана с полем, стрелка — на середину элемента.
 */
export function placeTip(anchor: Rect, view: { w: number; h: number }, width = TIP_W): TipPlace {
  const w = Math.min(width, view.w - 2 * TIP_EDGE);
  const cx = anchor.x + anchor.w / 2;
  const left = Math.min(Math.max(TIP_EDGE, cx - w / 2), view.w - TIP_EDGE - w);
  const below = anchor.y + anchor.h / 2 < view.h / 2;
  const arrow = Math.min(Math.max(14, cx - left), w - 14);
  return {
    left,
    width: w,
    top: below ? anchor.y + anchor.h + TIP_GAP : null,
    bottom: below ? null : view.h - anchor.y + TIP_GAP,
    arrow,
    below,
  };
}

interface TipState {
  open: (TipContent & { at: Rect }) | null;
  show: (at: Rect, content: TipContent) => void;
  hide: () => void;
}

export const useTip = create<TipState>((set) => ({
  open: null,
  show: (at, content) => set({ open: { ...content, at } }),
  hide: () => set({ open: null }),
}));

/** Прямоугольник элемента на экране. */
export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Открыть подсказку у элемента — обработчик `onClick` информационного элемента. */
export function tipAt(el: Element, content: TipContent): void {
  useTip.getState().show(rectOf(el), content);
}

/**
 * Окно, где игра ждёт ответа, стоит поверх всего — и верх нового интерфейса над его затемнением, чтобы
 * запасы были видны, пока решаешь, отдать ли их (строку состояния не закрывает ни одно окно). Ссылка подсказки в это время
 * открыла бы шторку под окном, поэтому её нет: подсказка только объясняет число.
 */
export const modalUp = (): boolean => typeof document !== 'undefined' && document.querySelector('.modal-backdrop') !== null;
