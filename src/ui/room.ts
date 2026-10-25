// Окно «Склад заполнен» (решение владельца, docs/audit/OWNER-DECISIONS.md, п. 1): действие игрока, которое приносит больше
// добра, чем вмещает склад, сначала спрашивает — «из N единиц поместится только M, остальное пропадёт. Продолжить?».
// Окно встаёт, только если что-то правда не влезает (`sim/stockview`); «Отмена» — действия нет, ничего не потрачено.
//
// Вопрос один на экран: новый закрывает прежний отказом. Само окно — `ui/next/RoomModal` (кусок нового вида).
import { create } from 'zustand';
import { useGame } from '@/game/store';
import type { GameState } from '@/game/types';
import { overflowOfAct, type Overflow } from '@/game/sim/stockview';

interface RoomAsk {
  over: readonly Overflow[];
  answer: (ok: boolean) => void;
}

export const useRoom = create<{ ask: RoomAsk | null }>(() => ({ ask: null }));

/** Спросить игрока о том, что не влезет. Пусто — спрашивать не о чем, ответ «да» сразу. */
export function askRoom(over: readonly Overflow[]): Promise<boolean> {
  if (over.length === 0) return Promise.resolve(true);
  useRoom.getState().ask?.answer(false);
  return new Promise((done) => {
    const ask: RoomAsk = {
      over,
      answer: (ok) => {
        if (useRoom.getState().ask === ask) useRoom.setState({ ask: null });
        done(ok);
      },
    };
    useRoom.setState({ ask });
  });
}

/**
 * Действие партии с окном склада: что оно положит, видно сухим прогоном той же двери (`overflowOfAct`); не влезает —
 * сначала вопрос, и только «Да» делает дело (`store.act`).
 */
export function actRoom(fn: (s: GameState) => string | null): void {
  const over = overflowOfAct(useGame.getState().s, fn);
  if (over.length === 0) {
    useGame.getState().act(fn);
    return;
  }
  void askRoom(over).then((ok) => {
    if (ok) useGame.getState().act(fn);
  });
}
