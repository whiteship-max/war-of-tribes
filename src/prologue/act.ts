/**
 * Что сделает действие и почему оно сейчас нельзя.
 *
 * Чистый модуль, отдельный от сцены нарочно: правило «что произойдёт по тапу»
 * и его объяснение словами — это не три.js, а игра, и проверять его надо
 * тестом, а не пальцем на телефоне.
 *
 * ПРАВИЛО ОДНО, И ОНО ТО ЖЕ, ЧТО У ВСЕЙ ИГРЫ: **кнопка, которая не сработает,
 * гаснет и говорит причину.** В деревне так устроены стройка, ковка, наём и
 * письма (`ui/parts/Cost.tsx`); здесь платить нечем, кроме дров в руках, но
 * правило от этого не меняется — проваливающихся нажатий не бывает, и «ничего
 * не произошло» игрок читать не должен.
 */
import { HEARTH_CAP, fuelAt } from './fire';
import { TREE_LOGS, type Spot } from './glade';
import type { PrologueSave } from './save';

/** Что именно делает действие. `null` — делать нечего. */
export type Deed = 'take-axe' | 'chop' | 'feed' | null;

export interface Offer {
  deed: Deed;
  /** Слово на кнопке и в подсказке. */
  label: string;
  /** Сработает ли. */
  can: boolean;
  /** Почему нельзя — пусто, если можно. */
  why: string;
}

const NOTHING: Offer = { deed: null, label: 'Осмотрись', can: false, why: 'Подойди ближе' };

/**
 * Что предлагает игроку то, рядом с чем он стоит.
 *
 * `spot` выбирает поляна по досягаемости (`glade.nearest`), а не палец: тап
 * здесь не целится (почему — в `controls.ts`).
 */
export function offer(s: PrologueSave, spot: Spot | null, now: number): Offer {
  if (!spot) return NOTHING;
  if (spot.kind === 'axe') {
    if (s.axe) return { deed: null, label: 'Топор у тебя', can: false, why: 'Топор уже в руках' };
    return { deed: 'take-axe', label: 'Взять топор', can: true, why: '' };
  }
  if (spot.kind === 'tree') {
    if (!s.axe) return { deed: 'chop', label: 'Рубить', can: false, why: 'Нужен топор' };
    return { deed: 'chop', label: 'Рубить', can: true, why: '' };
  }
  // Костёр.
  if (s.logs <= 0) return { deed: 'feed', label: 'Подложить дров', can: false, why: 'Дров нет' };
  if (fuelAt(s.hearth, now) >= HEARTH_CAP - 0.001)
    return { deed: 'feed', label: 'Подложить дров', can: false, why: 'Костёр и так полон' };
  return { deed: 'feed', label: 'Подложить дров', can: true, why: '' };
}

/** Сколько полен даёт сваленное дерево — в одном месте с ценой действия. */
export const logsFromTree = (): number => TREE_LOGS;
