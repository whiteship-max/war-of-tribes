// Открыто ли окно «Сообщить об ошибке» (docs/admin.md). Отдельным крошечным модулем: кнопки стоят в настройках, в шапке
// меню державы и на плашке заморозки, а само окно едет своим куском (`lazy` в `App`) — игрок, ни разу его не открывший,
// за него не платит.
import { create } from 'zustand';

interface BugOpen {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useBugReport = create<BugOpen>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
