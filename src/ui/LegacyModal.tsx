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
        <h2>Игра изменилась</h2>
        <p>
          Племя теперь начинает в позднем средневековье: посёлок стоит целиком, эпох и
          исследований больше нет, а главное — карта, дружина и бой.
        </p>
        <p>
          А Дом вождя стал Ратушей: через неё теперь идёт вся стройка. В прежнем сохранении
          лежит постройка, которой в игре больше нет.
        </p>
        <p>Прежнее сохранение к новой партии не подходит, поэтому партия начата заново.</p>
        <div className="options">
          <button className="btn" onClick={dismiss}>
            Начать новую партию
          </button>
        </div>
      </div>
    </div>
  );
}
