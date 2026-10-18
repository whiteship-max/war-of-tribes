// Покои правителя (docs/city_v3.md, Г-4): открыты ли. Своё маленькое хранилище, как у державы и промыслов: это вид, а не
// партия, в сохранение не едет, симуляции о нём знать незачем. Сами покои — своим куском (`ui/chambers/Chambers.tsx`),
// его тянет верх города (`next/Hud`), когда покои открыты; здесь — только рычаг, и он лёгкий.
import { create } from 'zustand';
import { useGame } from '@/game/store';
import { useRealm } from '@/ui/realm/open';
import { useTrades } from '@/ui/trades';
import { useTreasury } from '@/ui/treasury';
import { gestureAudio } from '@/sound/door';
import { probe } from '@/debug';

interface ChambersStore {
  open: boolean;
  /** Подняться в покои: окна города закрываются — вид меняется целиком. */
  show: () => void;
  /** Спуститься в город. */
  hide: () => void;
}

export const useChambers = create<ChambersStore>((set) => ({
  open: false,
  show: () => {
    const g = useGame.getState();
    g.closeSheet();
    if (g.mapOpen) g.closeMap();
    useRealm.getState().hide();
    useTrades.getState().hide();
    useTreasury.getState().hide();
    // Звук покоев (треск огня, ветер) встаёт на контексте, рождённом этим касанием: после докачки жеста уже нет.
    gestureAudio();
    set({ open: true });
  },
  hide: () => set({ open: false }),
}));

// Стенд снимков (`scripts/city-shots.ts`, `CHAMBERS=`) открывает покои тем же рычагом — только по флагу `?probe=1`.
if (probe()) (window as unknown as { __chambersOpen?: typeof useChambers }).__chambersOpen = useChambers;
