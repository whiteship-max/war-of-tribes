import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { TROOPS } from '@/game/data/troops';
import {
  armyPower,
  armySize,
  buildingOfType,
  defense,
  idleCount,
  upkeepInfo,
} from '@/game/derived';
import { dismissCheck } from '@/game/sim/upkeep';
import { dismissSoldiers } from '@/game/sim/actions';
import { UPKEEP_TEXT } from '@/game/data/upkeep';
import { Icon } from '@/ui/icons/Icon';
import { Recruit } from './Recruit';
import { waitDays, waitDaysBoth } from './wait';

/**
 * Казармы: дружина, найм пеших (`Recruit`; конницу нанимают в конюшне) и
 * роспуск — всех видов, конных тоже: распускают войско, а не здание.
 *
 * Здесь же цена, которой держится войско: жалованье в день против того, что даёт
 * казна, долг и терпение, — и «распустить» для тех, кого казна не тянет. Своей
 * арифметики у панели нет: всё считает `derived.upkeepInfo`.
 */
export function Barracks() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const act = useGame((g) => g.act);
  const [release, setRelease] = useState<Partial<Record<TroopId, number>>>({});
  const palisade = buildingOfType(s, 'palisade');
  const free = idleCount(s);

  return (
    <>
      <h3>
        Дружина <span className="muted">бойцов: {armySize(s)}</span>
      </h3>
      <div className="mod total">
        <span className="ico">⚔️</span>
        <span className="name">Мощь армии</span>
        <span className="val pos">{Math.round(armyPower(s))}</span>
      </div>
      <div className="mod">
        <span className="ico">🛡️</span>
        <span className="name">Защита поселения</span>
        <span className="val">{defense(s).toFixed(0)}</span>
      </div>
      {/* Что стена выводит в поле и кто идёт на деревню — у стены, в разделе «Оборона»,
          и оттуда же дверь к донесению о набеге. Второго экрана здесь нет — только дверь туда. */}
      {palisade && (
        <button className="btn ghost wide" onClick={() => openBuilding(palisade.id)}>
          🛡️ Оборона — у частокола
        </button>
      )}
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">Свободных жителей</span>
        <span className={`val${free === 0 ? ' neg' : ''}`}>{free}</span>
      </div>

      <Upkeep />

      {/* Найм — часть здания: здесь пеших, конницу — в конюшне (`army.hiredAt`). */}
      <Recruit at="barracks" />

      {armySize(s) > 0 && (
        <>
          <h3>Распустить по домам</h3>
          <p className="note">
            Люди вернутся в посёлок, снаряжение — на склад. Припас найма и время учений не вернуть.
          </p>
          {TROOPS.filter((def) => (s.army[def.id] ?? 0) > 0).map((def) => {
            const n = Math.max(1, release[def.id] ?? 1);
            const check = dismissCheck(s, def.id, n);
            const set = (v: number): void =>
              setRelease((c) => ({ ...c, [def.id]: Math.max(1, Math.min(Math.max(1, check.max), v)) }));
            return (
              <div className="slot pick" key={def.id}>
                <span className="ico">
                  <Icon name={`troop-${def.id}`} glyph={def.icon} />
                </span>
                <span className="who">
                  {def.name} <i className="talent">дома {check.max} · −{Math.round(check.saves)} зол./д</i>
                </span>
                <div className="stepper">
                  <button disabled={n <= 1} onClick={() => set(n - 1)}>
                    −
                  </button>
                  <span className="n">{n}</span>
                  <button disabled={n >= check.max} onClick={() => set(n + 1)}>
                    +
                  </button>
                </div>
                <button
                  className="mini text"
                  disabled={check.blocked !== null}
                  onClick={() => act((st) => dismissSoldiers(st, def.id, n))}
                >
                  распустить
                </button>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

/**
 * Жалованье: цена, которой держится войско, — в день против того, что даёт
 * казна, долг и терпение. Один компонент на два показа: в казармах и во
 * вкладке «Армия» меню державы. Своей арифметики нет: всё считает
 * `derived.upkeepInfo`.
 */
export function Upkeep() {
  const s = useGame((g) => g.s);
  const up = upkeepInfo(s);
  return (
    <>
      <h3>Жалованье</h3>
      <div className="mod">
        <span className="ico">{UPKEEP_TEXT.icon}</span>
        <span className="name">
          Войску в день
          {up.amnestyDays > 0 && <em className="sub">платить начнут через {waitDays(Math.ceil(up.amnestyDays))}</em>}
        </span>
        <span className={`val${up.masters === 0 && up.wages > up.income ? ' neg' : ''}`}>{Math.round(up.armyWages)}</span>
      </div>
      {up.masters > 0 && (
        <>
          <div className="mod">
            <span className="ico">🔨</span>
            <span className="name">
              Наёмным мастерам в день
              <em className="sub">та же ведомость и та же казна — в Мастерской</em>
            </span>
            <span className="val">{up.mastersWages.toFixed(1)}</span>
          </div>
          <div className="mod">
            <span className="ico">📜</span>
            <span className="name">Всего в день</span>
            <span className={`val${up.wages > up.income ? ' neg' : ''}`}>{up.wages.toFixed(1)}</span>
          </div>
        </>
      )}
      <div className="mod">
        <span className="ico"><Icon name="res-gold" glyph="💰" /></span>
        <span className="name">Казна даёт в день — налог и вера</span>
        <span className="val">{Math.round(up.income)}</span>
      </div>
      {up.debt > 0 && (
        <div className="mod">
          <span className="ico">📜</span>
          <span className="name">Долг войску</span>
          <span className="val neg">{Math.round(up.debt)}</span>
        </div>
      )}
      <div className="mod">
        <span className="ico">🗿</span>
        <span className="name">Терпит неуплату и голод — Статуя</span>
        <span className="val">{waitDaysBoth(up.graceDays)}</span>
      </div>
      {up.why ? (
        <p className="note bad">
          {UPKEEP_TEXT.whoDat(up.armyWages > 0 || up.masters === 0, up.masters > 0)} {UPKEEP_TEXT.why[up.why]}.{' '}
          {up.leavingPerDay > 0
            ? `Уходят — около ${Math.max(1, Math.round(up.leavingPerDay))} в день, равной долей каждого вида.`
            : `Уходить начнут через ${waitDays(Math.max(1, Math.ceil(up.graceDays - up.lateDays)))}.`}{' '}
          {up.why === 'pay'
            ? 'Уход встанет, как только казна покроет жалованье: подними налог или распусти лишних.'
            : 'Войско ест последним: уход встанет, когда амбару хватит на всех.'}
        </p>
      ) : up.treasuryDays !== null ? (
        <p className="note">Жалованье больше дохода: казны хватит на {waitDays(Math.max(1, Math.ceil(up.treasuryDays)))}.</p>
      ) : (
        <p className="note">Нечем платить или нечем кормить — войско терпит, потом уходит: при тебе и без тебя одинаково.</p>
      )}
    </>
  );
}
