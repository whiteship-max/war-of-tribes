import { useGame } from '@/game/store';
import { realHoursMin } from '@/ui/parts/wait';
import { Leave } from '@/ui/parts/leave';
import { Icon } from '@/ui/icons/Icon';

/** Отлучка — настоящие секунды (`save.offlineSeconds`). */
const fmtDuration = realHoursMin;

export function OfflineModal() {
  const offline = useGame((g) => g.offlineSeconds);
  const dismiss = useGame((g) => g.dismissOffline);
  return (
    <Leave open={offline >= 60}>
      <div className="modal-backdrop" onClick={dismiss}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="m-ico"><Icon name="day-night" /></div>
          <h2>С возвращением</h2>
          <p>Тебя не было {fmtDuration(offline)}. Город жил своим умом.</p>
          <div className="options">
            <button className="btn" onClick={dismiss}>
              Посмотреть
            </button>
          </div>
        </div>
      </div>
    </Leave>
  );
}
