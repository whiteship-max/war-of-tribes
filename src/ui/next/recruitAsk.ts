// Какой вид позвали нанять из карточки вида (отзыв тестеров 11.10, docs/feedback.md): касание «Нанять» у копейщиков
// открывало казармы с выбранными дубинщиками — верхней строкой. Просьба живёт до первого открытия найма и забирается им
// (`RecruitNew`): найм, открытый потом из здания, выбирает вид прежним правилом (`firstTroop`).
import type { TroopId } from '@/game/types';

let asked: TroopId | null = null;

/** Позвать найм этого вида: следующее открытие найма выберет его. */
export const askRecruit = (troop: TroopId): void => {
  asked = troop;
};

/** Забрать просьбу: один раз, следующему открытию её уже нет. */
export function takeRecruitAsk(): TroopId | null {
  const t = asked;
  asked = null;
  return t;
}
