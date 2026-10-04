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
import { waitDays } from './wait';
import { count } from './plural';
import { tipAt } from '@/ui/next/tip';

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
        Дружина <span className="muted">{count(armySize(s), 'боец', 'бойца', 'бойцов')}</span>
      </h3>
      <div className="mod total">
        <span className="ico">⚔️</span>
        <span className="name">Мощь</span>
        <span className="val pos">{Math.round(armyPower(s))}</span>
      </div>
      <div className="mod">
        <span className="ico">🛡️</span>
        <span className="name">Оборона</span>
        <span className="val">{defense(s).toFixed(0)}</span>
      </div>
      {/* Что стена выводит в поле и кто идёт на деревню — у стены, в разделе «Оборона»,
          и оттуда же дверь к донесению о набеге. Второго экрана здесь нет — только дверь туда. */}
      {palisade && (
        <button className="btn ghost wide" onClick={() => openBuilding(palisade.id)}>
          <Icon name="bld-palisade" glyph="🛡️" /> Частокол
        </button>
      )}
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">Свободные руки</span>
        <span className={`val${free === 0 ? ' neg' : ''}`}>{free}</span>
      </div>

      <Upkeep />

      {/* Найм — часть здания: здесь пеших, конницу — в конюшне (`army.hiredAt`). */}
      <Recruit at="barracks" />

      {armySize(s) > 0 && (
        <>
          <h3>Роспуск</h3>
          <p className="note">Бойцы станут жителями, снаряжение вернётся на склад, плата за найм пропадёт.</p>
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
                  {def.name} <i className="talent">гарнизон {check.max} · −{Math.round(check.saves)} золота в день</i>
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
          Дружине в день
          {up.amnestyDays > 0 && <em className="sub">платить начнут через {waitDays(Math.ceil(up.amnestyDays))}</em>}
        </span>
        <span className={`val${up.masters === 0 && up.wages > up.income ? ' neg' : ''}`}>{Math.round(up.armyWages)}</span>
      </div>
      {up.masters > 0 && (
        <>
          <div className="mod">
            <span className="ico">🔨</span>
            <span className="name">Мастерам в день</span>
            <span className="val">{up.mastersWages.toFixed(1)}</span>
          </div>
          <div className="mod">
            <span className="ico">📜</span>
            <span className="name">Всего в день</span>
            <span className={`val${up.wages > up.income ? ' neg' : ''}`}>{up.wages.toFixed(1)}</span>
          </div>
        </>
      )}
      <div
        className="mod"
        role="button"
        tabIndex={0}
        onClick={(e) => tipAt(e.currentTarget, { title: 'Доход в день', body: 'Золото от налога и веры.' })}
      >
        <span className="ico"><Icon name="res-gold" glyph="💰" /></span>
        <span className="name">Доход в день</span>
        <span className="val">{Math.round(up.income)}</span>
      </div>
      {up.debt > 0 && (
        <div className="mod">
          <span className="ico">📜</span>
          <span className="name">Долг дружине</span>
          <span className="val neg">{Math.round(up.debt)}</span>
        </div>
      )}
      <div
        className="mod"
        role="button"
        tabIndex={0}
        onClick={(e) =>
          tipAt(e.currentTarget, {
            title: 'Терпение',
            body: 'Сколько дружина ждёт жалованья и еды, потом уходит, даже без тебя. Растёт с уровнем Статуи.',
          })
        }
      >
        <span className="ico">🗿</span>
        <span className="name">Терпение</span>
        <span className="val">{waitDays(up.graceDays)}</span>
      </div>
      {up.why ? (
        <p className="note bad">
          {UPKEEP_TEXT.whoDat(up.armyWages > 0 || up.masters === 0, up.masters > 0)} {UPKEEP_TEXT.why[up.why]}.{' '}
          {up.leavingPerDay > 0
            ? `Уходят около ${Math.max(1, Math.round(up.leavingPerDay))} в день.`
            : `Уход через ${waitDays(Math.max(1, Math.ceil(up.graceDays - up.lateDays)))}.`}{' '}
          {up.why === 'pay'
            ? 'Подними налог или распусти лишних.'
            : 'Дружина ест после жителей. Уход встанет, когда еды хватит всем.'}
        </p>
      ) : up.treasuryDays !== null ? (
        <p className="note">Жалованье больше дохода. Золота хватит на {waitDays(Math.max(1, Math.ceil(up.treasuryDays)))}.</p>
      ) : null}
    </>
  );
}
