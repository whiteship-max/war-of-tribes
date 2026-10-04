import { useGame } from '@/game/store';

/**
 * Старое сохранение к новой партии не подходит: раньше племя шло от костра через
 * эпохи и технологии, теперь стартует в позднем средневековье с готовым посёлком.
 * Такое сохранение отбрасывается, но не молча — игроку об этом говорят прямо.
 */
export function LegacyModal() {
  const legacy = useGame((g) => g.legacyReset);
  const dismiss = useGame((g) => g.dismissLegacy);
  if (!legacy) return null;
  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">🏰</div>
        <h2>Новая партия</h2>
        <p>Прежнее сохранение не подходит к нынешней игре. Партия начата заново.</p>
        <div className="options">
          <button className="btn" onClick={dismiss}>
            Начать
          </button>
        </div>
      </div>
    </div>
  );
}
