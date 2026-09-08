import { useGame } from '@/game/store';
import { EVENT_BY_ID, eventBlock, eventCost, eventText, optionHint } from '@/game/data/events';
import { Cost } from '@/ui/parts/Cost';
import { Icon } from '@/ui/icons/Icon';

/**
 * Окно события. Отложить его нельзя — событие и есть решение, — поэтому оно
 * обязано отвечать на свой вопрос само.
 *
 * Отсюда цена значками и с запасом («нужно 20, из 12») под каждым вариантом,
 * который просит добро: пока её не было, окно закрывало собой и склад, и всю
 * игру, а «отдать припасы» приходилось нажимать наугад. Тот же `Cost` стоит у
 * стройки и у ковки — второй формы для одного и того же вопроса заводить
 * нельзя.
 *
 * Не хватает — кнопка гаснет и говорит, чего именно, а не проваливается при
 * нажатии. Тупика из этого не бывает: у каждого события есть вариант, который
 * ничего не стоит, и это держит тест.
 */
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
          {def.options.map((o, i) => {
            const block = eventBlock(o, s);
            const hint = optionHint(o, s);
            const cost = eventCost(o, s);
            const priced = Object.values(cost).some((n) => (n ?? 0) > 0);
            return (
              <button
                key={i}
                // Вариант с ценой раскладывается столбиком — как у письма: на
                // 360 px подпись и цена в одну строку не помещаются никогда.
                className={`opt${priced ? ' priced' : ''}`}
                disabled={block !== null}
                onClick={() => resolve(i)}
              >
                <span>{o.label}</span>
                {(block ?? hint) && <small>{block ?? hint}</small>}
                {priced && <Cost cost={cost} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
