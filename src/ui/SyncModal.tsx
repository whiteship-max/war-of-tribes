// Один разговор, которого нельзя не завести: игра открыта дважды.
//
// Сохранение одно на всё localStorage, и вкладка, которая о чужом ходе не знает,
// затирает его своим автосохранением. Молча — вот что здесь лечится: вкладки
// договариваются, кто ведёт партию, а та, что вести перестала, говорит об этом
// и больше не пишет.
//
// **Окна «две партии разошлись» здесь больше нет, и заводить его заново не
// надо.** Расхождение теперь разбирается без игрока: сервер — единственная
// правда, местная копия — его продолжение, а отвергнутая копия ложится рядом и
// достаётся в «Заданиях» → «Служебное» (`SpareSave`). Вопрос при входе — плохая
// первая минута, и обещание «ничего не потеряно» держится кнопкой возврата, а
// не выбором из двух карточек.
//
// Окно стоит последним в App нарочно: оно перекрывает прочие модалки. Собой оно
// ничего не закрывает — закрытое, оно просто уступает экран тому, что под ним.
import { useState } from 'react';
import { useSync } from '@/net/sync';

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
        <p>Продолжишь здесь, и в той вкладке партия остановится. Или закрой эту и играй там.</p>
        <div className="options">
          <button className="btn" onClick={takeOver}>
            Продолжить здесь
          </button>
          <button className="btn ghost" onClick={() => setHidden(true)}>
            Оставить там
          </button>
        </div>
        <small className="muted">Пока играешь в другой вкладке, эта не сохраняет.</small>
      </div>
    </div>
  );
}

export function SyncModal() {
  const state = useSync((g) => g.state);
  const why = useSync((g) => g.why);
  if (state === 'taken') return <Taken why={why} />;
  return null;
}
