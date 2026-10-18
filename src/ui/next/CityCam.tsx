// Кнопки камеры города (ОР-1, docs/ui_v2.md, 5.9; отзыв тестера: «сложновато ориентироваться в своём городе»): «Подписи» —
// имена над всеми постройками, «Домой» — плавно на стартовый кадр, пока камера ушла с него. Столбец слева под плашкой
// алмазов: там над городом лес, ни одной постройки (`.nx-gems`, `SPOTS=1 npm run tap:report`), и касание кнопки не спорит с
// касанием постройки. Пока город занят — шторкой, картой, державой, промыслами, — столбца нет: он вёл бы к городу под окном.
//
// Сцена и кнопки говорят через доску `render/sitetags` — рычаг подписей, просьба «Домой» и «ушла ли камера с дома». Рычаг
// помнится устройством (`localStorage`): это удобство зрителя, не партия.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { CITY_CAM_EVENT, askCam, cityCam, setLabelsOn } from '@/render/sitetags';
import { Icon } from '@/ui/icons/Icon';
import { useCityBusy } from './Hints';

const LABELS_KEY = 'tribe.labels';

function readLabels(): boolean {
  try {
    return localStorage.getItem(LABELS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Рычаг «Подписи»: один на игру; сцене — доской (`setLabelsOn`). */
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

/** Ушла ли камера с дома: сцена говорит доской, когда это меняется. */
function useMoved(): boolean {
  const [moved, setMoved] = useState(() => cityCam().moved);
  useEffect(() => {
    const on = (): void => setMoved(cityCam().moved);
    window.addEventListener(CITY_CAM_EVENT, on);
    on();
    return () => window.removeEventListener(CITY_CAM_EVENT, on);
  }, []);
  return moved;
}

export function CityCam() {
  const busy = useCityBusy();
  const on = useLabels((l) => l.on);
  const toggle = useLabels((l) => l.toggle);
  const moved = useMoved();
  if (busy) return null;
  return <CityCamView on={on} moved={moved} toggle={toggle} home={() => askCam({ kind: 'home' })} />;
}

/** Разметка столбца без хранилищ и сцены — её сверяет тест (`citycam.test.ts`). */
export function CityCamView({ on, moved, toggle, home }: { on: boolean; moved: boolean; toggle: () => void; home: () => void }) {
  return (
    <div className="nx-cam">
      <button type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label="Подписи" onClick={toggle}>
        <Icon name="ui-scroll" glyph="📜" />
        <small>Подписи</small>
      </button>
      {moved && (
        <button type="button" aria-label="Домой" onClick={home}>
          <Icon name="ui-home" glyph="🏠" />
          <small>Домой</small>
        </button>
      )}
    </div>
  );
}
