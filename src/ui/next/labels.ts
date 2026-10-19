// Рычаг «Подписи» — имена над всеми постройками города (ОР-1, docs/ui_v2.md, 5.9). С ЗН-3 (5.10) он — строкой в настройках
// профиля, а не кнопкой на экране. Сцене — доской (`render/sitetags.setLabelsOn`); помнится устройством (`localStorage`):
// это удобство зрителя, не партия. Модуль — в куске нового интерфейса, его тянет верх города (`Hud`): рычаг встаёт из памяти
// при входе в город, а первая загрузка его не несёт.
import { create } from 'zustand';
import { setLabelsOn } from '@/render/sitetags';

const LABELS_KEY = 'tribe.labels';

function readLabels(): boolean {
  try {
    return localStorage.getItem(LABELS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Рычаг «Подписи»: один на игру; сцене — доской. */
export const useLabels = create<{ on: boolean; toggle: () => void }>((set, get) => {
  const on = readLabels();
  setLabelsOn(on);
  return {
    on,
    toggle: () => {
      const next = !get().on;
      setLabelsOn(next);
      try {
        localStorage.setItem(LABELS_KEY, next ? '1' : '0');
      } catch {
        /* не запомнится — рычаг и так стоит до перезагрузки */
      }
      set({ on: next });
    },
  };
});
