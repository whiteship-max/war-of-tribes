// Два разговора, которых нельзя не завести.
//
// Первый — расхождение: на сервере лежит партия, которая не продолжает эту.
// Так бывает честно (играли на телефоне, потом на компьютере), и выбрать за
// игрока нельзя ни «свежее побеждает», ни «сервер главнее»: любое правило
// однажды сотрёт вечер игры. Поэтому — две карточки и вопрос. Отвергнутая
// партия при этом не пропадает: она остаётся на устройстве, и об этом сказано
// прямо здесь, а вернуть её можно в «Заданиях», в «Служебном».
//
// Второй — вторая вкладка. Сохранение одно на всё localStorage, и вкладка,
// которая о чужом ходе не знает, затирает его своим автосохранением. Молча —
// вот что здесь лечится: вкладки договариваются, кто ведёт партию, а та, что
// вести перестала, говорит об этом и больше не пишет.
//
// Окно стоит последним в App нарочно: оно перекрывает прочие модалки, потому
// что до ответа игра не сохраняется никуда. Собой оно ничего не закрывает —
// закрытое, оно просто уступает экран тому, что под ним.
import { useState } from 'react';
import { useSync, type Divergence } from '@/net/sync';
import type { SaveCard } from '@/net/snapshot';

const big = (n: number): string => Math.round(n).toLocaleString('ru-RU');

const when = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'неизвестно когда';

/**
 * Партия одной карточкой. Показано ровно то, по чему игрок узнаёт свою игру:
 * день, население, мощь, дружина. Хешей и номеров записей здесь нет — по ним
 * не выбирают.
 */
function Card({ title, note, card }: { title: string; note: string; card: SaveCard }) {
  return (
    <div className="save-card">
      <h4>{title}</h4>
      <small>{note}</small>
      <div className="rows">
        <div>
          <b>{card.name}</b>
          <span>вождь</span>
        </div>
        <div>
          <b>День {big(card.day)}</b>
          <span>игровой день</span>
        </div>
        <div>
          <b>{big(card.pop)}</b>
          <span>племя</span>
        </div>
        <div>
          <b>{big(card.power)}</b>
          <span>мощь</span>
        </div>
        <div>
          <b>{big(card.army)}</b>
          <span>дружина</span>
        </div>
      </div>
    </div>
  );
}

function Conflict({ c }: { c: Divergence }) {
  const resolve = useSync((g) => g.resolve);
  const [busy, setBusy] = useState(false);
  const pick = (keep: 'here' | 'there'): void => {
    setBusy(true);
    void resolve(keep);
  };
  return (
    <div className="modal-backdrop">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">⚖️</div>
        <h2>Две партии разошлись</h2>
        <p>
          На сервере лежит партия, которая не продолжает эту. Так бывает, когда играли на другом
          устройстве. Выбери, какую оставить, — вторую мы не сотрём.
        </p>
        <div className="save-pair">
          <Card title="Здесь" note="партия на этом устройстве" card={c.here} />
          <Card
            title="На сервере"
            note={`${c.thereSame ? 'записана этим же устройством' : 'записана с другого устройства'}, ${when(c.thereAt)}`}
            card={c.there}
          />
        </div>
        <div className="options">
          <button className="btn" disabled={busy} onClick={() => pick('here')}>
            Оставить эту
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => pick('there')}>
            Взять с сервера
          </button>
        </div>
        <small className="muted">
          Отвергнутая партия останется на этом устройстве: «Задания» → «Служебное» → «Вернуть
          отклонённую партию». Взяв серверную, игра перезапустится.
        </small>
      </div>
    </div>
  );
}

function Taken({ why }: { why: string }) {
  const takeOver = useSync((g) => g.takeOver);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">🪟</div>
        <h2>Игра открыта дважды</h2>
        <p>{why}</p>
        <p>
          Продолжить можно здесь — тогда в той вкладке партия остановится. Или просто закрой эту
          вкладку и играй там.
        </p>
        <div className="options">
          <button className="btn" onClick={takeOver}>
            Продолжить здесь
          </button>
          <button className="btn ghost" onClick={() => setHidden(true)}>
            Оставить там
          </button>
        </div>
        <small className="muted">Пока ведёт другая вкладка, эта не сохраняет ничего.</small>
      </div>
    </div>
  );
}

export function SyncModal() {
  const state = useSync((g) => g.state);
  const why = useSync((g) => g.why);
  const conflict = useSync((g) => g.conflict);
  if (state === 'conflict' && conflict) return <Conflict c={conflict} />;
  if (state === 'taken') return <Taken why={why} />;
  return null;
}
