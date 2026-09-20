// Справка о порядке из строки состояния и из строки тревоги. Все числа — из
// `orderBreakdown` и `mutinyForecast`, оттуда же, откуда их берёт симуляция:
// своей арифметики у панели нет, иначе она однажды покажет не то, что будет.
//
// Порядок устроен так, чтобы его цена стояла до того, как наступит, — как у
// голода под осадой. Поэтому сверху не только число, но и срок ропота, и чем
// кончится мятеж при нынешней страже, и рычаги, которыми это меняют.
import { useGame } from '@/game/store';
import {
  MUTINY_ANSWER,
  MUTINY_FUSE,
  MUTINY_SUPPRESS_MORALE,
  ORDER_UNREST,
  ORDER_WARN,
} from '@/game/constants';
import { ORDER_TEXT, clockText } from '@/game/data/order';
import {
  armySize,
  buildingOfType,
  homeArmy,
  mutinyForecast,
  orderBreakdown,
  orderState,
  unrestLeft,
} from '@/game/derived';
import { waitMinSec, waitShort } from '../parts/wait';
import { asGame } from '@/game/pace';

const fmt = (n: number): string => (n >= 10 ? String(Math.round(n)) : n.toFixed(1));

export function OrderPanel() {
  const s = useGame((g) => g.s);
  const openTab = useGame((g) => g.openTab);
  const openBuilding = useGame((g) => g.openBuilding);
  const openMap = useGame((g) => g.openMap);
  const o = orderBreakdown(s);
  const state = orderState(s);
  const f = mutinyForecast(s);
  const left = unrestLeft(s);
  const value = Math.round(o.value);
  const market = buildingOfType(s, 'market');
  const tavern = buildingOfType(s, 'tavern');
  const barracks = buildingOfType(s, 'barracks');
  const home = homeArmy(s);
  const all = armySize(s);

  return (
    <div className="panel">
      <h2>
        {ORDER_TEXT.icon} {ORDER_TEXT.name} <small>сейчас {value} из 100</small>
      </h2>
      {/* Две метки на шкале — пороги тревоги и ропота: видно, сколько до них. */}
      <div className={`progress order-bar ${state}`}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        <i className="mark" style={{ left: `${ORDER_WARN}%` }} />
        <i className="mark" style={{ left: `${ORDER_UNREST}%` }} />
      </div>
      <p className="season-hint">{ORDER_TEXT.state[state]}</p>

      {left !== null && (
        <div className="mod total order-clock">
          <span className="ico">{ORDER_TEXT.mutiny.icon}</span>
          <span className="name">
            До мятежа
            <em className="sub">срок идёт, пока ты в игре; порядок выше {ORDER_UNREST} — ропот стихает</em>
          </span>
          <span className="val neg">{clockText(left)}</span>
        </div>
      )}

      {o.bonded > 0 && (
        <>
          <h3>Если начнётся мятеж</h3>
          {/* Цена — до того, как наступит. Словами из одного места с тревогой и окном. */}
          <div className={`note${f.holds ? '' : ' bad'}`}>
            {ORDER_TEXT.price({ holds: f.holds, bonded: f.bonded, flee: f.flee, leave: f.leave })}
          </div>
          <div className="mod">
            <span className="ico">⚔️</span>
            <span className="name">
              Стража дома
              <em className="sub">
                мощь {Math.round(f.power)}: подавит до {f.crush} невольников, мораль −{MUTINY_SUPPRESS_MORALE}
              </em>
            </span>
            <span className="val">{f.guards}</span>
          </div>
          <div className="note">
            Мятеж поднимается, когда ропот идёт {waitMinSec(asGame(MUTINY_FUSE))}. Окно ждёт ответа {waitShort(asGame(MUTINY_ANSWER))} — отпустить
            невольников, раздать хлеб и золото или подавить силой; без ответа стража выходит сама. Пока игра закрыта,
            срок стоит.
          </div>
        </>
      )}

      <h3>
        Кто держит невольников <span className="muted">надзор {Math.floor(o.hold)}</span>
      </h3>
      <div className="mod-list">
        {o.lines.map((l) => (
          <div className="mod" key={l.id}>
            <span className="ico">{l.icon}</span>
            <span className="name">
              {l.name}
              <em className="sub">{l.hint}</em>
            </span>
            <span className="val pos">{fmt(l.value)}</span>
          </div>
        ))}
      </div>
      <div className="mod total">
        <span className="ico">{ORDER_TEXT.bondedIcon}</span>
        <span className="name">
          Невольников
          <em className="sub">порядок = 100 × надзор ÷ (надзор + невольники)</em>
        </span>
        <span className={`val${o.bonded > o.hold ? ' neg' : ''}`}>{o.bonded}</span>
      </div>
      <div className="note">
        Ниже {ORDER_WARN} — невольников больше, чем держит надзор, и об этом скажет строка тревоги. Ниже {ORDER_UNREST} —
        ропот и срок до мятежа.
      </div>

      <h3>Рычаги</h3>
      <button className="btn ghost wide" onClick={() => openTab('people')}>
        {ORDER_TEXT.bondedIcon} Отпустить часть — в «Племени»
      </button>
      {market && (
        <button className="btn ghost wide" onClick={() => openBuilding(market.id)}>
          🛒 Продать торговцам — на рынке
        </button>
      )}
      {home < all ? (
        <button className="btn ghost wide" onClick={openMap}>
          ⚔️ Вернуть дружину домой: дома {home} из {all}
        </button>
      ) : (
        <div className="note">Вся дружина дома: {all} бойцов держат невольников. Уведёшь в поле — держать станет некому.</div>
      )}
      {barracks && (
        <button className="btn ghost wide" onClick={() => openBuilding(barracks.id)}>
          🛡️ Нанять бойцов — в казармах
        </button>
      )}
      {tavern && (
        <button className="btn ghost wide" onClick={() => openBuilding(tavern.id)}>
          🍺 Пир: мораль, а с ней и спокойные горожане
        </button>
      )}

      <h3>Порядок и мораль</h3>
      <div className="note">{ORDER_TEXT.notMorale}</div>
    </div>
  );
}
