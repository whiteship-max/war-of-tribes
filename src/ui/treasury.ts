// «Сокровищница» (docs/gems.md): открыто ли окно и какая вкладка. Своё маленькое хранилище, как у промыслов
// (`ui/trades.ts`): это вид, а не партия, в сохранение он не едет. Окно встаёт вместо шторки, державы и промыслов.
import { create } from 'zustand';
import type { GemShop } from '../../netlify/lib/contract';
import { useGame } from '@/game/store';
import { shopDay } from '@/game/gemrules';
import { refreshGems } from '@/net/gems';
import { useRealm } from './realm/open';
import { useTrades } from './trades';

export type TreasuryTab = 'buy' | 'shop' | 'history';

interface TreasuryStore {
  open: boolean;
  tab: TreasuryTab;
  show: (tab?: TreasuryTab) => void;
  hide: () => void;
  setTab: (tab: TreasuryTab) => void;
}

export const useTreasury = create<TreasuryStore>((set, get) => ({
  open: false,
  tab: 'shop',
  show: (tab) => {
    useGame.getState().closeSheet();
    useRealm.getState().hide();
    useTrades.getState().hide();
    set({ open: true, tab: tab ?? get().tab });
    // Баланс, лавка и журнал — свежие на минуту открытия.
    void refreshGems();
  },
  hide: () => set({ open: false }),
  setTab: (tab) => {
    set({ tab });
    if (tab === 'history') void refreshGems();
  },
}));

/** Сколько покупок лавки сделано сегодня: записка сервера о другом дне — ноль (лавка обновилась). */
export const shopUsed = (shop: GemShop | null, now: number): number => (shop && shop.day === shopDay(now) ? shop.used : 0);
