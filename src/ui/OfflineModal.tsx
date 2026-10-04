import { useGame } from '@/game/store';
import { realHoursMin } from '@/ui/parts/wait';

/** Отлучка — настоящие секунды (`save.offlineSeconds`). */
const fmtDuration = realHoursMin;

export function OfflineModal() {
  const offline = useGame((g) => g.offlineSeconds);
  const dismiss = useGame((g) => g.dismissOffline);
  if (offline < 60) return null;
  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">🌙</div>
        <h2>С возвращением</h2>
        <p>Тебя не было {fmtDuration(offline)}. Город жил без тебя.</p>
        <div className="options">
          <button className="btn" onClick={dismiss}>
            Посмотреть
          </button>
        </div>
      </div>
    </div>
  );
}
