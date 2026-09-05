import { useGame } from '@/game/store';
import { DAY_LENGTH, FEAST_DAYS } from '@/game/constants';
import { feastInfo } from '@/game/derived';
import { throwFeast } from '@/game/sim/actions';

/**
 * Трактир: единственный быстрый рычаг морали и второй выход у золота после
 * рынка. Всё, что здесь есть, — одна кнопка и три числа около неё: сколько
 * стоит, сколько даст и когда можно будет повторить. Последствие написано на
 * самой кнопке, как у указов в Доме вождя.
 */
export function Tavern() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = feastInfo(s);
  const days = (sec: number): number => Math.ceil(sec / DAY_LENGTH);

  return (
    <>
      <h3>
        Пир <span className="muted">казна: {Math.floor(s.gold)} 🪙</span>
      </h3>
      <div className="note">
        Столы выкатывают на площадь, бочки открывают, и {FEAST_DAYS} дня племя работает
        веселее. Прибавка ложится поверх всего остального — она отыгрывает просадку
        от налога, голода и тесноты, а не добавляется к полной шкале.
      </div>
      <div className="mod">
        <span className="ico">😊</span>
        <span className="name">Прибавка к морали</span>
        <span className="val">+{info.bonus}</span>
      </div>
      <div className="mod">
        <span className="ico">🪙</span>
        <span className="name">Цена пира (по числу ртов)</span>
        <span className="val">{info.cost}</span>
      </div>
      {info.left > 0 && (
        <div className="mod">
          <span className="ico">🍺</span>
          <span className="name">Пир идёт</span>
          <span className="val pos">ещё {days(info.left)} дн.</span>
        </div>
      )}
      {info.left <= 0 && info.cooldown > 0 && (
        <div className="mod">
          <span className="ico">⏳</span>
          <span className="name">Бочки пусты</span>
          <span className="val">ещё {days(info.cooldown)} дн.</span>
        </div>
      )}
      <button
        className="btn wide"
        disabled={info.blocked !== null}
        onClick={() => act((st) => throwFeast(st))}
      >
        Задать пир — {info.cost} 🪙, мораль +{info.bonus} на {FEAST_DAYS} дн.
      </button>
      {info.blocked && <div className="hint">{info.blocked}</div>}
    </>
  );
}
