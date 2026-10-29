// Вести бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.4.1, 5.5): стол почты отряда — «Просятся в отряд» с вариантами, их подсказками и
// причинами погасшей кнопки. Стол тот же, что у лорда (`GameState.inbox`, `sim/mail`), ответ — той же дверью (`store.resolve`); окна
// «Вестей» лорда у бродяги нет (держава — после взятия замка), поэтому строки стола — здесь, своим куском карты бродяги.
import { useGame } from '@/game/store';
import { EVENT_BY_ID, eventBlock, eventText, optionHint } from '@/game/data/events';
import { eventId, eventLeft } from '@/game/sim/mail';
import { atSize } from '@/game/data/eventKit';
import { roamDoor } from '@/game/roamlazy';
import { partyNow } from '@/net/clock';
import { realSpan } from '@/game/span';
import { Icon } from '@/ui/icons/Icon';

export function RoamMail({ onClose }: { onClose: () => void }) {
  const s = useGame((g) => g.s);
  const resolve = useGame((g) => g.resolve);
  const now = partyNow();
  const items = s.inbox.filter((e) => EVENT_BY_ID[e.defId]);
  return (
    <div className="am-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel nx-bpanel nx-am">
        <div className="nx-bhead">
          <span className="nx-bico">
            <Icon name="ui-mail" />
          </span>
          <div className="nx-btitle">
            <b className="one-line">Вести</b>
            <span className="nx-blvl">{items.length > 0 ? `ждут ответа: ${items.length}` : 'стол пуст'}</span>
          </div>
          <button className="nx-bclose" onClick={onClose} aria-label="Закрыть">
            <Icon name="ui-close" />
          </button>
        </div>
        <div className="nx-am-body er-confirm">
          {items.length === 0 && <p className="nx-tnote">Новых вестей нет.</p>}
          {items.map((ev) => {
            const def = EVENT_BY_ID[ev.defId];
            const left = eventLeft(ev, now);
            return (
              <div key={eventId(ev)}>
                <p className="nx-tnote">
                  <b>{def.title}.</b> {eventText(def, s)}
                  {left !== null && (
                    <span className="muted">
                      {' '}
                      {def.waits ?? 'Ждёт ответа ещё'} {realSpan(Math.ceil(left))}.
                    </span>
                  )}
                </p>
                <div className="roam-legs">
                  {def.options.map((o, i) => {
                    const why = atSize(ev.size, () => eventBlock(o, s, ev.cost?.[i]));
                    return (
                      <button
                        key={o.label}
                        className="roam-leg"
                        disabled={why !== null}
                        onClick={() => {
                          resolve(i, eventId(ev));
                          void roamDoor()?.flushBook();
                        }}
                      >
                        <b>{o.label}</b>
                        <span />
                        <small className="muted">{why ?? optionHint(o, s) ?? ''}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="nx-am-foot">
          <button className="nx-go nx-go-ghost" onClick={onClose}>
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}
