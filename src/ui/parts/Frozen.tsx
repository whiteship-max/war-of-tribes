// Плашка «Аккаунт заморожен» (docs/admin.md). Замороженный видит игру, но ничего не может сделать: сервер не
// принимает его записей и приказов войны, а здесь прозрачный слой поверх игры забирает касания. Тон спокойный — это
// не наказание на весь экран, а сообщение; кнопка ведёт в «Сообщить об ошибке», если игрок считает это ошибкой.
//
// Снимается сама: игра продолжает стучаться с записью раз в минуту, и после разморозки первая принятая запись приносит
// `frozen: false` (`net/admin.takeNote`).
import { useAdmin } from '@/net/admin';
import { useBugReport } from './bugOpen';

export function Frozen() {
  const frozen = useAdmin((a) => a.frozen);
  const report = useBugReport((b) => b.show);
  if (!frozen) return null;
  return (
    // Слой забирает касания самим собой: сцена и интерфейс слушают свои элементы, а под слоем до них палец не дойдёт.
    <div className="frozen-veil">
      <div className="frozen-plate" role="status">
        <b>Аккаунт заморожен</b>
        <span>Игру видно, но ходить сейчас нельзя: ходы и записи не принимаются. Думаешь, это ошибка — напиши.</span>
        <button className="btn ghost" onClick={report}>
          Написать
        </button>
      </div>
    </div>
  );
}
