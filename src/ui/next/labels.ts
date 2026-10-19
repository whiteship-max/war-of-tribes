// Рычаг «Подписи» — имена построек города (ОР-1, docs/ui_v2.md, 5.9). С ЗН-3 (5.10) он — строкой в настройках профиля, а не
// кнопкой на экране; с ЗН-4 (5.11) включён — подписи проявляются все разом около середины приближения, выключен — их нет
// вовсе. По умолчанию включён: без рычага подписей не стало бы ни у кого, кто не нашёл строку. Сцене — доской (`render/sitetags.setLabelsOn`); помнится устройством (`localStorage`):
// это удобство зрителя, не партия. Модуль — в куске нового интерфейса, его тянет верх города (`Hud`): рычаг встаёт из памяти
// при входе в город, а первая загрузка его не несёт.
import { create } from 'zustand';
import { setLabelsOn } from '@/render/sitetags';

// Р-3 (docs/ui_v2.md, «Решения Р-3»): подписи включены у всех — и у тех, кто прежде выключил их ключом `tribe.labels`. Сброс
// разовый: ключ сменён, прежний не читается и стирается; выключенный после этого помнится новым ключом.
export const LABELS_KEY = 'tribe.labels.r3';
export const OLD_LABELS_KEY = 'tribe.labels';

function readLabels(): boolean {
  try {
    localStorage.removeItem(OLD_LABELS_KEY);
    return localStorage.getItem(LABELS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Рычаг «Подписи»: один на игру; сцене — доской. Помнится только выключенный (`'0'`), иначе — включён. */
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
