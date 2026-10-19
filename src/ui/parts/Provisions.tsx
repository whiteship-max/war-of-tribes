// Склад перестаёт быть тупиком: тревоги голода и холода ведут сюда (`derived.alerts`,
// `goto: 'storage'`), а решения о еде у склада нет — паёк решает правитель в ратуше.
// Поэтому здесь два показа и одна дверь: на сколько хватит еды при нынешнем пайке,
// прогноз зимы и ссылка прямо в «Указы».
//
// Ни одного числа части не считают сами: срок еды — `parts/foodLeft`, зима —
// `winterForecast`, тот же, что в справке сезона и в окне перед зимой. `WinterForecast`
// показан в двух местах одним компонентом — на складе и в справке сезона.
import { useGame } from '@/game/store';
import { rationOf, seasonOf, winterForecast } from '@/game/derived';
import { foodLeft } from './foodLeft';
import { waitDays } from './wait';
import { goTo } from '@/ui/kit/nav';
import { WINDOW } from '@/ui/kit/sources';
import { Icon } from '@/ui/icons/Icon';
import { iconName } from '@/ui/icons/registry';

/**
 * «1 ч 42 мин»: срок без округления вверх — обещать лишнюю десятую дня нельзя. Паёк и зима считаются
 * игровыми днями, а ждёт игрок своими часами: на экране — настоящее время (docs/ui_audit.md, 4.5).
 */
const daysText = (d: number): string => waitDays(Math.floor(d * 10) / 10);

/** Сколько дней ещё проживём на том, что в амбаре, — и где это меняют. */
export function FoodLeft() {
  const s = useGame((g) => g.s);
  const left = foodLeft(s);
  const ration = rationOf(s);

  return (
    <>
      <h3>Паёк</h3>
      <div className="mod total">
        <span className="ico"><Icon name={iconName('ration', ration.id)} /></span>
        <span className="name">
          {left.days === null ? 'Еда не убывает' : 'Еды хватит на'}
          <em className="sub">{ration.name.toLowerCase()} паёк</em>
        </span>
        <span className={`val ${left.days === null ? 'pos' : left.days < 1 ? 'neg' : ''}`}>
          {left.days === null ? 'хватает' : daysText(left.days)}
        </span>
      </div>
      <button className="btn ghost wide" onClick={() => goTo(WINDOW.gold)}>
        Изменить паёк
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
          <span className="ico"><Icon name="res-food" /></span>
          <span className="name">Еда</span>
          <span className={`val ${forecast.food.ok ? 'pos' : 'neg'}`}>
            {daysText(forecast.food.days)} из {waitDays(forecast.winterDays)}
          </span>
        </div>
        <div className="mod">
          <span className="ico"><Icon name="res-wood" /></span>
          <span className="name">Дрова</span>
          <span className={`val ${forecast.wood.ok ? 'pos' : 'neg'}`}>
            {daysText(forecast.wood.days)} из {waitDays(forecast.winterDays)}
          </span>
        </div>
      </div>
    </>
  );
}
