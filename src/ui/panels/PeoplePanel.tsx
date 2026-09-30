import { useState } from 'react';
import { useGame } from '@/game/store';
import { BONDED_OUTPUT } from '@/game/constants';
import { JOBS, JOB_BY_ID } from '@/game/data/jobs';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { ORDER_TEXT } from '@/game/data/order';
import {
  armyPower,
  armySize,
  bondedCount,
  bondedIdle,
  bondedIncoming,
  bondedTotal,
  buildingOfType,
  buildingSlots,
  buildingTitle,
  currentSite,
  defense,
  freeJobCount,
  housingCapacity,
  idleCount,
  jobCounts,
  orderValue,
  workerCount,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { armyRoster, trainees } from '@/game/sim/army';
import { troopPower } from '@/game/battle/price';
import { releaseBonded } from '@/game/sim/actions';
import { Factor } from '../parts/Factor';
import { Steps } from '../parts/Steps';
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
              <span className="count">{n} · мощь {Math.round(troopPower({ [def.id]: n }))}</span>
            </div>
            <div className="desc">{def.description}</div>
          </div>
        </button>
      ))}
    </>
  );
}

/**
 * Невольники: сколько их и куда направлены. Устроены они как жители — числом, а
 * не списком, — и на работы их ставят там же, где вольных: в панели двора, вторым
 * рядом шага. Здесь видно, где они стоят, и здесь же их отпускают: одно дело —
 * одно место.
 */
export function Bonded() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const openBuilding = useGame((g) => g.openBuilding);
  const openTab = useGame((g) => g.openTab);
  const [pick, setPick] = useState(10);
  const total = bondedTotal(s);
  const incoming = bondedIncoming(s);
  const market = buildingOfType(s, 'market');

  if (total <= 0 && incoming <= 0) {
    return (
      <>
        <h3>
          {ORDER_TEXT.bondedName} <span className="muted">нет</span>
        </h3>
        <div className="note">{ORDER_TEXT.about(BONDED_OUTPUT)}</div>
        <div className="note">{ORDER_TEXT.whereFrom}</div>
        {market && (
          <button className="btn ghost wide" onClick={() => openBuilding(market.id)}>
            🛒 Невольничий ряд — на рынке
          </button>
        )}
      </>
    );
  }

  const places = s.buildings.filter((b) => bondedCount(s, b.id) > 0);
  const idle = bondedIdle(s);
  const site = currentSite(s);
  const count = Math.max(1, Math.min(pick, total));

  return (
    <>
      <h3>
        {ORDER_TEXT.bondedName}{' '}
        <span className="muted">
          {total} · порядок {Math.round(orderValue(s))}
        </span>
      </h3>
      <div className="note">{ORDER_TEXT.about(BONDED_OUTPUT)}</div>
      {incoming > 0 && (
        <div className="mod">
          <span className="ico">🛒</span>
          <span className="name">Ведут торговцы</span>
          <span className="val">{incoming}</span>
        </div>
      )}
      {places.map((b) => {
        const job = BUILDING_BY_ID[b.type].job;
        return (
          <button className="card as-row" key={b.id} onClick={() => openBuilding(b.id)}>
            <div className="ico">
              <Icon name={`bld-${b.type}`} glyph={BUILDING_BY_ID[b.type].icon} />
            </div>
            <div className="body">
              <div className="title">
                {buildingTitle(s, b.type)}
                <span className="count">{bondedCount(s, b.id)}</span>
              </div>
              <div className="desc">
                {job ? JOB_BY_ID[job].name : ''}: вольных {workerCount(s, b.id)}, невольников{' '}
                {bondedCount(s, b.id)} из {buildingSlots(b)} мест
              </div>
            </div>
          </button>
        );
      })}
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">
          {site ? 'Без места — на стройке' : 'Без места — стройки нет, стоят без дела'}
          <em className="sub">на работы ставят в панели двора, вторым рядом под вольными</em>
        </span>
        <span className="val">{idle}</span>
      </div>

      {total > 0 && (
        <>
          <h3>
            Отпустить <span className="muted">из {total}</span>
          </h3>
          <div className="note">{ORDER_TEXT.releaseAbout}</div>
          <Steps
            value={count}
            max={total}
            spare={total - count}
            step={10}
            onChange={(d) => setPick(Math.max(1, Math.min(total, count + d)))}
          />
          <button className="btn wide" onClick={() => act((st) => releaseBonded(st, count))}>
            Отпустить {count}
          </button>
        </>
      )}
      <button className="btn ghost wide" onClick={() => openTab('order')}>
        {ORDER_TEXT.icon} Порядок: кто держит невольников и что будет при мятеже
      </button>
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

      <Bonded />

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
                {place ? `${buildingTitle(s, place.type)}: ${inside}` : 'без здания'}
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
