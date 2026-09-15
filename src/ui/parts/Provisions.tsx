// Склад перестаёт быть тупиком: тревоги голода и холода ведут сюда (`derived.alerts`,
// `goto: 'storage'`), а решения о еде у склада нет — паёк решает вождь в ратуше.
// Поэтому здесь два показа и одна дверь: на сколько хватит еды при нынешнем пайке,
// прогноз зимы и ссылка прямо в «Управление».
//
// Ни одного числа части не считают сами: срок еды — `parts/foodLeft`, зима —
// `winterForecast`, тот же, что в справке сезона и в окне перед зимой. `WinterForecast`
// показан в двух местах одним компонентом — на складе и в справке сезона.
import { useGame } from '@/game/store';
import { rationOf, seasonOf, winterForecast } from '@/game/derived';
import { foodLeft } from './foodLeft';

/** «3.4 дн.»: срок без округления вверх — обещать лишнюю десятую дня нельзя. */
const daysText = (d: number): string => `${Math.floor(d * 10) / 10} дн.`;

/** Сколько дней ещё проживём на том, что в амбаре, — и где это меняют. */
export function FoodLeft() {
  const s = useGame((g) => g.s);
  const openTownHall = useGame((g) => g.openTownHall);
  const left = foodLeft(s);
  const ration = rationOf(s);

  return (
    <>
      <h3>Паёк</h3>
      <div className="mod total">
        <span className="ico">{ration.icon}</span>
        <span className="name">
          {left.days === null ? 'Еда не убывает' : 'Еды хватит на'}
          <em className="sub">при пайке «{ration.name.toLowerCase()}»</em>
        </span>
        <span className={`val ${left.days === null ? 'pos' : left.days < 1 ? 'neg' : ''}`}>
          {left.days === null ? 'добывают не меньше, чем едят' : daysText(left.days)}
        </span>
      </div>
      <button className="btn ghost wide" onClick={() => openTownHall('manage')}>
        Паёк — изменить в ратуше
      </button>
    </>
  );
}

/** Хватит ли запасов на ближайшую зиму: тот же расчёт, что в справке сезона и в окне перед зимой. */
export function WinterForecast() {
  const s = useGame((g) => g.s);
  const forecast = winterForecast(s);

  return (
    <>
      <h3>{seasonOf(s.time) === 'winter' ? 'Хватит ли до весны' : 'Хватит ли на зиму'}</h3>
      <div className="mod-list">
        <div className="mod">
          <span className="ico">🍖</span>
          <span className="name">Еда</span>
          <span className={`val ${forecast.food.ok ? 'pos' : 'neg'}`}>
            {Math.floor(forecast.food.days * 10) / 10} из {forecast.winterDays} дн.
          </span>
        </div>
        <div className="mod">
          <span className="ico">🌲</span>
          <span className="name">Дрова</span>
          <span className={`val ${forecast.wood.ok ? 'pos' : 'neg'}`}>
            {Math.floor(forecast.wood.days * 10) / 10} из {forecast.winterDays} дн.
          </span>
        </div>
      </div>
    </>
  );
}
