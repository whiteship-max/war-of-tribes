// Справка по населению из строки состояния. Тем же способом, что и окно сезона:
// не статья в правилах, а живые числа этой партии — какой множитель сейчас
// тормозит прирост и через сколько посёлок упрётся в крыши.
import { useGame } from '@/game/store';
import {
  DAY_LENGTH,
  GROWTH_FOOD_DAYS,
  GROWTH_ROOM,
  MORALE_GROWTH_FULL,
  MORALE_GROWTH_ZERO,
  POP_GROWTH_BASE,
  POP_GROWTH_PER_DAY,
} from '@/game/constants';
import {
  armySize,
  faithDef,
  faithTilt,
  foodConsumptionPerDay,
  housingCapacity,
  idleCount,
  population,
  rationOf,
  recruitsQueued,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { Factor } from '../parts/Factor';
import { waitSpan } from '../parts/wait';
import { asGame } from '@/game/pace';

/** Как множитель называется в строке-подсказке про узкое место. */
const FACTOR_NAME: Record<string, string> = {
  morale: 'мораль',
  housing: 'свободное жильё',
  food: 'запас еды',
};

/** Игровые секунды словами: «2 мин 30 с» настоящего времени (`parts/wait`). */
const span = (sec: number): string => (!Number.isFinite(sec) || sec <= 0 ? 'вот-вот' : waitSpan(asGame(sec)));

export function PopPanel() {
  const s = useGame((g) => g.s);
  const openTab = useGame((g) => g.openTab);
  const housing = housingCapacity(s);
  const room = Math.max(0, housing - s.pop);
  const growth = popGrowth(s);
  const ration = rationOf(s);
  const eat = foodConsumptionPerDay(s);
  const foodDays = s.resources.food / Math.max(1, eat);

  // Три множителя перемножаются, поэтому узкое место — самый маленький из них.
  // Пока все трое на полном ходу, тормозить нечему: метку не ставим вовсе,
  // иначе она врала бы про сотню процентов.
  const factors = [
    { id: 'morale', k: growth.morale },
    { id: 'housing', k: growth.housing },
    { id: 'food', k: growth.food },
  ];
  const low = Math.min(...factors.map((f) => f.k));
  const worst = new Set(low < 0.999 ? factors.filter((f) => f.k <= low + 1e-6).map((f) => f.id) : []);
  const bottleneck =
    worst.size === 0
      ? 'Ничто не мешает: все три множителя на полном ходу.'
      : `Рост тормозит: ${[...worst].map((id) => FACTOR_NAME[id]).join(', ')}. Прирост — произведение, поэтому подтянуть надо именно это.`;

  // Игровой день длится DAY_LENGTH секунд, поэтому «за день» и «в минуту» — одно
  // и то же только при шестидесяти. Считаем честно, а не полагаясь на совпадение.
  const perMinute = (growth.perDay * 60) / DAY_LENGTH;
  const fillSeconds = growth.perDay > 0 ? (room / growth.perDay) * DAY_LENGTH : Infinity;
  const base = POP_GROWTH_PER_DAY * (s.pop + POP_GROWTH_BASE);

  return (
    <div className="panel">
      <h2>
        👥 Население <small>{s.pop} чел. · жильё {housing}</small>
      </h2>
      <p className="season-hint">
        Поимённых жителей в племени нет: население — это число. Прирост за игровой день —
        произведение трёх множителей: свободное жильё, запас еды и мораль. Ноль в любом из
        них останавливает рост целиком.
      </p>

      <div className="mod total">
        <span className="ico">{growth.perDay >= 0 ? '📈' : '📉'}</span>
        <span className="name">Прирост сейчас</span>
        <span className={`val ${growth.perDay >= 0 ? 'pos' : 'neg'}`}>
          {growth.perDay >= 0 ? '+' : '−'}
          {Math.abs(perMinute).toFixed(2)} чел. в минуту
        </span>
      </div>
      <div className="mod">
        <span className="ico">⏳</span>
        <span className="name">{room > 0 ? 'До заполнения жилья' : 'Свободных мест нет'}</span>
        <span className={`val${growth.perDay > 0 && room > 0 ? '' : ' neg'}`}>
          {room <= 0
            ? 'посёлок полон'
            : growth.perDay > 0
              ? `${span(fillSeconds)} · ${room} мест`
              : 'не заполнится'}
        </span>
      </div>

      <h3>Три множителя</h3>
      <div className="note">{growth.blocked ?? bottleneck}</div>
      <Factor
        icon={growth.morale >= 0 ? '😊' : '😟'}
        name="Мораль"
        k={growth.morale}
        worst={worst.has('morale')}
        hint={growth.morale < 0 ? 'люди уходят' : `${Math.round(s.morale)} из 100`}
      />
      <Factor
        icon="🛏️"
        name="Свободное жильё"
        k={growth.housing}
        worst={worst.has('housing')}
        hint={`${room} мест, полный ход с ${GROWTH_ROOM}`}
      />
      <Factor
        icon="🍖"
        name="Запас еды"
        k={growth.food}
        worst={worst.has('food')}
        hint={`на ${foodDays.toFixed(1)} дн., полный ход с ${GROWTH_FOOD_DAYS}`}
      />
      {growth.faith > 1 && (
        <>
          <h3>И прибавка от веры</h3>
          <div className="note">
            Стоит отдельно от трёх множителей, потому что не режет, а добавляет: узким
            местом она быть не может. Умножается сверх всего остального.
          </div>
          <div className="mod total">
            <span className="ico">{faithDef(s)?.icon ?? '🙏'}</span>
            <span className="name">
              {faithDef(s)?.name ?? 'Вера'}
              <em className="sub">{faithTilt(s).boon}</em>
            </span>
            <span className="val pos">×{growth.faith.toFixed(2)}</span>
          </div>
        </>
      )}

      <h3>Порог морали</h3>
      <p className="season-hint">
        Ниже {MORALE_GROWTH_ZERO} морали племя разбегается независимо от крыш и закромов:
        людей держит не крыша, а вождь. Полный ход прирост набирает к {MORALE_GROWTH_FULL}.
      </p>
      <div className="morale-scale">
        <i className="zero" style={{ left: `${MORALE_GROWTH_ZERO}%` }}>
          <u>{MORALE_GROWTH_ZERO}</u>
        </i>
        <i className="full" style={{ left: `${MORALE_GROWTH_FULL}%` }}>
          <u>{MORALE_GROWTH_FULL}</u>
        </i>
        <b style={{ left: `${Math.max(0, Math.min(100, s.morale))}%` }}>
          <u>{Math.round(s.morale)}</u>
        </b>
      </div>
      <div className="mod">
        <span className="ico">{s.morale < MORALE_GROWTH_ZERO ? '😟' : '😊'}</span>
        <span className="name">Мораль племени</span>
        <span className={`val ${s.morale < MORALE_GROWTH_ZERO ? 'neg' : 'pos'}`}>
          {Math.round(s.morale)}
          {s.morale < MORALE_GROWTH_ZERO ? ` — ниже ${MORALE_GROWTH_ZERO}` : ''}
        </span>
      </div>
      <button className="btn ghost wide" onClick={() => openTab('morale')}>
        😊 Отчего мораль такая
      </button>

      <h3>Из чего складывается число</h3>
      <div className="mod">
        <span className="ico">🌱</span>
        <span className="name">Основа: доля от племени</span>
        <span className="val">
          {base.toFixed(2)} = {POP_GROWTH_PER_DAY} × ({s.pop} + {POP_GROWTH_BASE})
        </span>
      </div>
      <div className="mod">
        <span className="ico">{ration.icon}</span>
        <span className="name">Рацион: {ration.name.toLowerCase()}</span>
        <span className={`val ${ration.growth >= 1 ? 'pos' : 'neg'}`}>×{ration.growth}</span>
      </div>
      <div className="mod total">
        <span className="ico">📊</span>
        <span className="name">Итог за игровой день</span>
        <span className={`val ${growth.perDay >= 0 ? 'pos' : 'neg'}`}>
          {growth.perDay >= 0 ? '+' : '−'}
          {Math.abs(growth.perDay).toFixed(2)} чел.
        </span>
      </div>

      <h3>Кого считаем</h3>
      <div className="mod">
        <span className="ico">👥</span>
        <span className="name">Жители посёлка</span>
        <span className="val">{s.pop}</span>
      </div>
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">Из них свободные руки</span>
        <span className="val">{idleCount(s)}</span>
      </div>
      <div className="mod">
        <span className="ico">⚔️</span>
        <span className="name">Бойцы дружины</span>
        <span className="val">{armySize(s)}</span>
      </div>
      <div className="mod">
        <span className="ico">🎯</span>
        <span className="name">На учениях в казармах</span>
        <span className="val">{recruitsQueued(s)}</span>
      </div>
      <div className="mod total">
        <span className="ico">🏘️</span>
        <span className="name">Всего под рукой вождя</span>
        <span className="val">{population(s)}</span>
      </div>
      <div className="note">
        Бойцы и новобранцы жилья не просят — они живут в казармах, — но едят из общего котла
        и считаются при сборе налога.
      </div>
    </div>
  );
}
