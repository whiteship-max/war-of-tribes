// Какой вид позвали нанять из карточки вида (отзыв тестеров 11.10, docs/feedback.md): касание «Нанять» у копейщиков
// открывало казармы с выбранными дубинщиками — верхней строкой. Просьба живёт до первого открытия найма (`RecruitNew`):
// найм читает её при выборе вида и снимает, встав на экран, — найм, открытый потом из здания, выбирает вид прежним
// правилом (`firstTroop`). Читать и снимать — двумя шагами: начальное значение React зовёт в разработке дважды.
import type { TroopId } from '@/game/types';

let asked: TroopId | null = null;

/** Позвать найм этого вида: следующее открытие найма выберет его. */
export const askRecruit = (troop: TroopId): void => {
  asked = troop;
};

/** Какой вид позвали; просьба остаётся до `dropRecruitAsk`. */
export const recruitAsked = (): TroopId | null => asked;

/** Снять просьбу: найм её прочитал. */
export const dropRecruitAsk = (): void => {
  asked = null;
};
