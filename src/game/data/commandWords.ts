// Текст вести о пустом месте командира фланга (ДР-5): кто ушёл и почему и где выбрать нового. Едет куском «Вестей» (`ui/realm/
// dispatch`), как текст вестей державы (`data/crownWords`): шагу партии он не нужен. Вид, заголовок и ответ — `sim/command`.
import type { Flank, GameState } from '../types';
import { commandOf, commandVacancyFlank } from '../sim/command';

const FLANK_WORD: Record<Flank, string> = { left: 'Левый', right: 'Правый' };

/** Текст вести о пустом месте по её виду; не весть командиров — `null`. */
export function commandText(defId: string, s: GameState): string | null {
  const f = commandVacancyFlank(defId);
  if (!f) return null;
  const left = commandOf(s).left?.[f];
  const gone = left ? `${left.name} ${left.why === 'fell' ? 'пал в бою' : 'ушёл на покой'}. ` : '';
  return `${gone}${FLANK_WORD[f]} фланг ведёт сам полководец. Кандидаты ждут в «Дружине» — меню «Командующие».`;
}
