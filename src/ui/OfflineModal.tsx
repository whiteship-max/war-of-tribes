import { useGame } from '@/game/store';

const fmtDuration = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
};

export function OfflineModal() {
  const offline = useGame((g) => g.offlineSeconds);
  const dismiss = useGame((g) => g.dismissOffline);
  if (offline < 60) return null;
  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">🌙</div>
        <h2>С возвращением</h2>
        <p>Тебя не было {fmtDuration(offline)}. Племя продолжало работать, строить и учиться.</p>
        <div className="options">
          <button className="btn" onClick={dismiss}>
            Посмотреть, что изменилось
          </button>
        </div>
      </div>
    </div>
  );
}
