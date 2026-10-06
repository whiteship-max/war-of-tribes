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
import { waitDays, waitSpan } from '../parts/wait';
import { count } from '../parts/plural';
import { signed } from '../parts/signed';
import { Icon } from '@/ui/icons/Icon';
import { moodOf } from '@/ui/icons/registry';
import { asGame } from '@/game/pace';
import { dec } from '@/game/num';

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
      ? 'Все множители на полном ходу.'
      : `Рост тормозит: ${[...worst].map((id) => FACTOR_NAME[id]).join(', ')}.`;

  const fillSeconds = growth.perDay > 0 ? (room / growth.perDay) * DAY_LENGTH : Infinity;
  const base = POP_GROWTH_PER_DAY * (s.pop + POP_GROWTH_BASE);

  return (
    <div className="panel">
      <h2>
        Жители <small>{s.pop}/{housing}</small>
      </h2>
      <p className="season-hint">Прирост зависит от жилья, еды и морали. Ноль в любом из них останавливает рост.</p>

      <div className="mod total">
        <span className="ico">{growth.perDay >= 0 ? '📈' : '📉'}</span>
        <span className="name">Прирост сейчас</span>
        <span className={`val ${growth.perDay >= 0 ? 'pos' : 'neg'}`}>{signed(growth.perDay, 2)} в день</span>
      </div>
      <div className="mod">
        <span className="ico">⏳</span>
        <span className="name">{room > 0 ? 'До заполнения жилья' : 'Свободных мест нет'}</span>
        <span className={`val${growth.perDay > 0 && room > 0 ? '' : ' neg'}`}>
          {room <= 0
            ? 'город полон'
            : growth.perDay > 0
              ? `${span(fillSeconds)} · ${count(room, 'место', 'места', 'мест')}`
              : 'не заполнится'}
        </span>
      </div>

      <h3>Множители</h3>
      <div className="note">{growth.blocked ?? bottleneck}</div>
      <Factor
        icon={growth.morale >= 0 ? '😊' : '😟'}
        name="Мораль"
        k={growth.morale}
        worst={worst.has('morale')}
        hint={growth.morale < 0 ? 'жители уходят' : `${Math.round(s.morale)} из 100`}
      />
      <Factor
        icon="🛏️"
        name="Свободное жильё"
        k={growth.housing}
        worst={worst.has('housing')}
        hint={`${count(room, 'место', 'места', 'мест')}, полный ход с ${GROWTH_ROOM}`}
      />
      <Factor
        icon="🍖"
        name="Запас еды"
        k={growth.food}
        worst={worst.has('food')}
        hint={`на ${waitDays(foodDays)}, полный ход с ${waitDays(GROWTH_FOOD_DAYS)}`}
      />
      {growth.faith > 1 && (
        <>
          <h3>Прибавка от веры</h3>
          <div className="note">Вера только прибавляет к приросту, сверх всех множителей.</div>
          <div className="mod total">
            <span className="ico">{faithDef(s)?.icon ?? '🙏'}</span>
            <span className="name">
              {faithDef(s)?.name ?? 'Вера'}
              <em className="sub">{faithTilt(s).boon}</em>
            </span>
            <span className="val pos">×{dec(growth.faith, 2)}</span>
          </div>
        </>
      )}

      <h3>Порог морали</h3>
      <p className="season-hint">
        При морали ниже {MORALE_GROWTH_ZERO} жители уходят, даже если есть жильё и еда. Полный прирост с{' '}
        {MORALE_GROWTH_FULL}.
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
        <span className="name">Мораль города</span>
        <span className={`val ${s.morale < MORALE_GROWTH_ZERO ? 'neg' : 'pos'}`}>
          {Math.round(s.morale)}
          {s.morale < MORALE_GROWTH_ZERO ? ` — ниже ${MORALE_GROWTH_ZERO}` : ''}
        </span>
      </div>
      <button className="btn ghost wide" onClick={() => openTab('morale')}>
        <Icon name={moodOf(s.morale).name} glyph={moodOf(s.morale).glyph} /> Мораль
      </button>

      <h3>Расчёт прироста</h3>
      <div className="mod">
        <span className="ico">🌱</span>
        <span className="name">Основа</span>
        <span className="val">
          {dec(base, 2)} = {POP_GROWTH_PER_DAY} × ({s.pop} + {POP_GROWTH_BASE})
        </span>
      </div>
      <div className="mod">
        <span className="ico">{ration.icon}</span>
        <span className="name">Паёк: {ration.name.toLowerCase()}</span>
        <span className={`val ${ration.growth >= 1 ? 'pos' : 'neg'}`}>×{ration.growth}</span>
      </div>
      <div className="mod total">
        <span className="ico">📊</span>
        <span className="name">Итого в день</span>
        <span className={`val ${growth.perDay >= 0 ? 'pos' : 'neg'}`}>{signed(growth.perDay, 2)}</span>
      </div>

      <h3>Кого считаем</h3>
      <div className="mod">
        <span className="ico">👥</span>
        <span className="name">Жители</span>
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
        <span className="name">Новобранцы</span>
        <span className="val">{recruitsQueued(s)}</span>
      </div>
      <div className="mod total">
        <span className="ico">🏘️</span>
        <span className="name">Всего</span>
        <span className="val">{population(s)}</span>
      </div>
      <div className="note">Бойцы и новобранцы живут в казармах, но едят со всеми и входят в налог.</div>
    </div>
  );
}
