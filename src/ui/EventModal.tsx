import { useGame } from '@/game/store';
import { EVENT_BY_ID, eventText, optionHint } from '@/game/data/events';
import { Icon } from '@/ui/icons/Icon';

export function EventModal() {
  const s = useGame((g) => g.s);
  const resolve = useGame((g) => g.resolve);
  const eventResult = useGame((g) => g.eventResult);
  const dismissResult = useGame((g) => g.dismissResult);

  if (eventResult) {
    return (
      <div className="modal-backdrop" onClick={dismissResult}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="m-ico">📖</div>
          <p>{eventResult}</p>
          <div className="options">
            <button className="btn" onClick={dismissResult}>
              Продолжить
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!s.activeEvent) return null;
  const def = EVENT_BY_ID[s.activeEvent.defId];
  if (!def) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="m-ico">
          <Icon name={`evt-${def.id}`} glyph={def.icon} />
        </div>
        <h2>{def.title}</h2>
        <p>{eventText(def, s)}</p>
        <div className="options">
          {def.options.map((o, i) => (
            <button key={i} className="opt" onClick={() => resolve(i)}>
              <span>{o.label}</span>
              {optionHint(o, s) && <small>{optionHint(o, s)}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
