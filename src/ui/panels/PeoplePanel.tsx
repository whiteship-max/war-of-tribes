import { useGame } from '@/game/store';
import { JOBS } from '@/game/data/jobs';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import {
  armyPower,
  armySize,
  buildingOfType,
  defense,
  freeJobCount,
  housingCapacity,
  idleCount,
  jobCounts,
  workerCount,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { armyRoster, trainees } from '@/game/sim/army';
import { Factor } from '../parts/Factor';
import { Icon } from '@/ui/icons/Icon';

/**
 * Дружина. Бойцы — не жители с профессией «воин»: их нанимают в казармах,
 * и в списке работ их нет. Поэтому здесь отдельная строка, а не роль.
 */
function Army() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const roster = armyRoster(s);
  const barracks = buildingOfType(s, 'barracks');
  if (roster.length === 0) {
    return (
      <div className="note">
        Бойцов нет. Их не назначают из жителей — их учат в казармах за снаряжение.
      </div>
    );
  }
  return (
    <>
      <h3>
        Дружина <span className="muted">мощь {Math.round(armyPower(s))} · бойцов {armySize(s)}</span>
      </h3>
      {roster.map(({ def, n }) => (
        <button
          className="card as-row"
          key={def.id}
          disabled={!barracks}
          onClick={() => barracks && openBuilding(barracks.id)}
        >
          <div className="ico">
            <Icon name={`bld-${def.id}`} glyph={def.icon} />
          </div>
          <div className="body">
            <div className="title">
              {def.name}
              <span className="count">{n} · мощь {def.power * n}</span>
            </div>
            <div className="desc">{def.description}</div>
          </div>
        </button>
      ))}
    </>
  );
}

/**
 * Племя числами. Поимённых жителей нет: население — это счёт, а роль человека —
 * следствие места работы. Поэтому здесь не список людей, а список профессий и
 * причина, по которой племя растёт или разбегается.
 */
export function PeoplePanel() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const idle = idleCount(s);
  const housing = housingCapacity(s);
  const counts = jobCounts(s);
  const growth = popGrowth(s);
  const training = trainees(s);
  const working = JOBS.filter((j) => j.id !== 'idle' && counts[j.id] > 0);

  return (
    <div className="panel">
      <h2>
        Племя <small>{s.pop} чел. · жильё {housing} · защита {defense(s).toFixed(0)}</small>
      </h2>
      <div className="note">
        Людей ставят на работу в панели здания — числом, а не поимённо. Свободные строят и
        отдыхают у костра.
      </div>

      <div className="mod total">
        <span className="ico"><Icon name="ui-hammer" glyph="🔨" /></span>
        <span className="name">Свободные руки</span>
        <span className="val">{idle}</span>
      </div>
      {training > 0 && (
        <div className="mod">
          <span className="ico">⚔️</span>
          <span className="name">На учениях в казармах</span>
          <span className="val">{training}</span>
        </div>
      )}

      <h3>
        Прирост{' '}
        <span className={`muted${growth.perDay < 0 ? ' neg' : ''}`}>
          {growth.perDay >= 0 ? '+' : '−'}
          {Math.abs(growth.perDay).toFixed(1)} чел. в день
        </span>
      </h3>
      <div className="note">
        {growth.blocked ??
          'Племя растёт: есть куда селить, чем кормить и за кем идти. Рацион и указы вождя двигают прирост так же, как выработку.'}
      </div>
      <Factor
        icon={growth.morale >= 0 ? '😊' : '😟'}
        name="Мораль"
        k={growth.morale}
        hint={growth.morale < 0 ? 'люди уходят' : `${Math.round(s.morale)} из 100`}
      />
      <Factor icon="🛏️" name="Свободное жильё" k={growth.housing} hint={`${Math.max(0, housing - s.pop)} мест`} />
      <Factor icon="🍖" name="Запас еды" k={growth.food} hint="на три дня — полный ход" />

      <Army />

      <h3>Кто чем занят</h3>
      {working.map((job) => {
        const place = s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job.id) ?? null;
        const inside = place ? workerCount(s, place.id) : 0;
        const wild = freeJobCount(s, job.id);
        return (
          <button
            className="card as-row"
            key={job.id}
            disabled={!place}
            onClick={() => place && openBuilding(place.id)}
          >
            <div className="ico">
              <Icon name={`job-${job.id}`} glyph={job.icon} />
            </div>
            <div className="body">
              <div className="title">
                {job.name}
                <span className="count">{counts[job.id]} чел.</span>
              </div>
              <div className="desc">
                {place ? `${BUILDING_BY_ID[place.type].name}: ${inside}` : 'без здания'}
                {wild > 0 && ` · вольный сбор: ${wild}`}
              </div>
            </div>
          </button>
        );
      })}
      {working.length === 0 && (
        <div className="note">Все руки свободны. Поставь людей в здания — панель у каждого своя.</div>
      )}
    </div>
  );
}
