import { useGame } from '@/game/store';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { decreeOf, hasGold, rationOf, taxIncomePerDay, taxOf } from '@/game/derived';
import { setDecree, setRation, setTax } from '@/game/sim/actions';

/**
 * Внутренности Дома вождя: чем вождь правит.
 *
 * Указ и рацион переключаются в любой момент и действуют, пока выбраны, поэтому
 * последствия написаны прямо на кнопке — выбор делают, уже зная цену.
 */
export function ChiefHouse() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const decree = decreeOf(s);
  const ration = rationOf(s);
  const tax = taxOf(s);

  return (
    <>
      <h3>Указ вождя</h3>
      <div className="choice">
        {DECREES.map((d) => (
          <button
            key={d.id}
            className={`choice-opt${decree.id === d.id ? ' on' : ''}`}
            onClick={() => act((st) => setDecree(st, d.id))}
          >
            <span className="ico">{d.icon}</span>
            <b>{d.name}</b>
            <small>{d.effect}</small>
          </button>
        ))}
      </div>

      <h3>Рацион</h3>
      <div className="choice">
        {RATIONS.map((r) => (
          <button
            key={r.id}
            className={`choice-opt${ration.id === r.id ? ' on' : ''}`}
            onClick={() => act((st) => setRation(st, r.id))}
          >
            <span className="ico">{r.icon}</span>
            <b>{r.name}</b>
            <small>{r.effect}</small>
          </button>
        ))}
      </div>

      {/* Налог и казна появляются вместе с торгом: до него денег в игре нет. */}
      {hasGold(s) && (
        <>
          <h3>
            Казна <span className="muted">+{taxIncomePerDay(s).toFixed(1)} в день</span>
          </h3>
          <div className="mod total">
            <span className="ico">💰</span>
            <span className="name">Золото</span>
            <span className="val pos">{Math.floor(s.gold)}</span>
          </div>
          <div className="note">
            Сбор идёт с людей: чем больше народу в посёлке, тем полнее казна. Платит за это
            мораль, а низкая мораль режет всю выработку — высокий налог выгоден в короткую,
            а не как уклад.
          </div>

          <h3>Налог</h3>
          <div className="choice">
            {TAXES.map((t) => (
              <button
                key={t.id}
                className={`choice-opt${tax.id === t.id ? ' on' : ''}`}
                onClick={() => act((st) => setTax(st, t.id))}
              >
                <span className="ico">{t.icon}</span>
                <b>{t.name}</b>
                <small>{t.effect}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
