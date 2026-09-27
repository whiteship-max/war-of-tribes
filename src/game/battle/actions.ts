// Действия игрока вокруг боя: оборона деревни и выбор между мгновенным итогом и
// просмотром. Сохранённых схем больше нет — они хранили план, приказы и раскладку
// удара, а у удара их нет (docs/battle_eu4.md, 14.5). Как и все действия, возвращают
// null при успехе или текст ошибки — стор покажет его тостом.
import type { GameState } from '../types';
import { cloneFormation, type Formation } from './formation';

/** Как деревня встречает набег. Заморозку проверяет панель: она знает про таймер. */
export function setDefenseFormation(s: GameState, f: Formation | null): string | null {
  s.defenseFormation = f ? cloneFormation(f) : null;
  return null;
}

/** Что игрок предпочитает после боя: сразу итог или журнал по фазам. Выбор запоминается. */
export function setBattleWatch(s: GameState, watch: boolean): string | null {
  s.battleWatch = watch;
  return null;
}
