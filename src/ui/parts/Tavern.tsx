import { useGame } from '@/game/store';
import { DAY_LENGTH, FEAST_DAYS } from '@/game/constants';
import { feastInfo } from '@/game/derived';
import { throwFeast } from '@/game/sim/actions';
import { waitDays } from './wait';
import { Icon } from '@/ui/icons/Icon';
import { tipAt } from '@/ui/next/tip';

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
        Пир <span className="muted"><Icon name="res-gold" /> {Math.floor(s.gold)}</span>
      </h3>
      <div
        className="mod"
        role="button"
        tabIndex={0}
        onClick={(e) =>
          tipAt(e.currentTarget, {
            title: 'Прибавка к морали',
            body: 'Отыгрывает просадку от налога, голода и тесноты. Выше полной шкалы мораль не поднимет.',
          })
        }
      >
        <span className="ico"><Icon name="mood-good" /></span>
        <span className="name">Прибавка к морали</span>
        <span className="val">
          +{info.bonus} на {waitDays(FEAST_DAYS)}
        </span>
      </div>
      <div
        className="mod"
        role="button"
        tabIndex={0}
        onClick={(e) => tipAt(e.currentTarget, { title: 'Цена пира', body: 'Растёт с числом жителей.' })}
      >
        <span className="ico"><Icon name="res-gold" /></span>
        <span className="name">Цена пира</span>
        <span className="val">{info.cost}</span>
      </div>
      {info.left > 0 && (
        <div className="mod">
          <span className="ico"><Icon name="bld-tavern" /></span>
          <span className="name">Пир идёт</span>
          <span className="val pos">ещё {waitDays(days(info.left))}</span>
        </div>
      )}
      {info.left <= 0 && info.cooldown > 0 && (
        <div className="mod">
          <span className="ico"><Icon name="ui-time" /></span>
          <span className="name">Бочки пусты</span>
          <span className="val">ещё {waitDays(days(info.cooldown))}</span>
        </div>
      )}
      <button
        className="btn wide"
        disabled={info.blocked !== null}
        onClick={() => act((st) => throwFeast(st))}
      >
        Задать пир
      </button>
      {info.blocked && <div className="hint">{info.blocked}</div>}
    </>
  );
}
