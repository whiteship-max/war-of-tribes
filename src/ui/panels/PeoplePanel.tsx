import { useGame } from '@/game/store';
import { JOB_BY_ID } from '@/game/data/jobs';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { buildingById, buildingOfType, defense, freeVillagers, housingCapacity, armyPower, armySize } from '@/game/derived';
import { armyRoster } from '@/game/sim/army';

/**
 * Дружина. Бойцы — не жители с профессией «воин»: их нанимают в казармах,
 * и в списке племени их нет. Поэтому здесь отдельная строка, а не роль.
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
          <div className="ico">{def.icon}</div>
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

/** Склонение: 1 год, 2 года, 5 лет. */
function years(n: number): string {
  const t = n % 100;
  const o = n % 10;
  if (t >= 11 && t <= 14) return `${n} лет`;
  if (o === 1) return `${n} год`;
  if (o >= 2 && o <= 4) return `${n} года`;
  return `${n} лет`;
}

/**
 * Сквозной список племени: кто чем занят и где. Роль теперь следствие места работы,
 * поэтому назначают людей в панелях зданий, а не здесь.
 */
export function PeoplePanel() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const idle = freeVillagers(s).length;
  const housing = housingCapacity(s);
  const sorted = [...s.villagers].sort((a, b) => a.job.localeCompare(b.job) || a.id - b.id);

  return (
    <div className="panel">
      <h2>
        Племя <small>{s.villagers.length} чел. · жильё {housing} · защита {defense(s).toFixed(0)}</small>
      </h2>
      <div className="note">Людей ставят на работу в панели здания. Свободные строят и отдыхают у костра.</div>

      <div className="mod total">
        <span className="ico">🔨</span>
        <span className="name">Свободные</span>
        <span className="val">{idle}</span>
      </div>

      <Army />

      {sorted.map((v) => {
        const job = JOB_BY_ID[v.job];
        const place = v.workplace !== null ? buildingById(s, v.workplace) : null;
        const where = place
          ? BUILDING_BY_ID[place.type].name
          : v.job === 'idle'
            ? 'у костра'
            : 'вольный сбор';
        return (
          <button
            className="card as-row"
            key={v.id}
            disabled={!place}
            onClick={() => place && openBuilding(place.id)}
          >
            <div className="ico">{job.icon}</div>
            <div className="body">
              <div className="title">
                {v.name}
                <span className="count">
                  {years(Math.floor(v.age))} · {v.sex === 'f' ? 'ж' : 'м'}
                </span>
              </div>
              <div className="desc">
                {job.name} · {where}
                {v.talent && <span className="talent"> ★ {JOB_BY_ID[v.talent].name.toLowerCase()}</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
