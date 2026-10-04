// Промыслы: открыто ли окно и какая игра идёт (docs/minigames.md, раздел 3).
//
// Своё маленькое хранилище, а не поле общего стора игры — по той же причине, что у меню державы (`realm/open.ts`):
// это вид, а не партия, в сохранение он не едет, и заводить поле в ядре (`game/store.ts`) ради того, что открыто,
// значило бы делать вход в промыслы правкой ядра. Лежит в первой загрузке: по нему `App` разбирает город на время
// игры (контекст WebGL один) — сама игра едет своим куском.
import { create } from 'zustand';
import { useGame } from '@/game/store';
import { serverNow } from '@/net/clock';
import type { MinigameId } from '@/game/data/minigames';
import { useRealm } from './realm/open';

/**
 * «Сейчас» энергии — настоящие часы игрока, а не часы партии: энергия — сутки игрока, как ежедневка, и скорость
 * проверки её не ускоряет (docs/minigames.md, раздел 1). Единственное место интерфейса, где её часы читаются.
 */
export const energyNow = (): number => serverNow();

interface TradesStore {
  /** Открыто окно «Промыслы». */
  open: boolean;
  /** Какая игра идёт; null — никакая. */
  playing: MinigameId | null;
  show: () => void;
  hide: () => void;
  play: (id: MinigameId) => void;
  stop: () => void;
}

export const useTrades = create<TradesStore>((set) => ({
  open: false,
  playing: null,
  // Окно встаёт вместо шторки и державы, а не поверх: под ним не должно висеть невидимое.
  show: () => {
    useGame.getState().closeSheet();
    useRealm.getState().hide();
    set({ open: true });
  },
  hide: () => set({ open: false }),
  play: (id) => {
    useGame.getState().closeSheet();
    useRealm.getState().hide();
    set({ open: false, playing: id });
  },
  stop: () => set({ playing: null }),
}));
