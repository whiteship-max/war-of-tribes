import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import {
  armyPower,
  armySize,
  buildingOfType,
  defense,
  freeVillagers,
  recruitRate,
} from '@/game/derived';
import { recruitCheck } from '@/game/sim/army';
import { cancelRecruit, startRecruit } from '@/game/sim/actions';

/**
 * Казармы: список бойцов по образцу Tribal Wars — иконка, цена, время, поле
 * количества и кнопка найма. Цена всегда полная: ресурсы, снаряжение, живой
 * человек и время учений.
 *
 * Тупика без объяснения быть не должно: если не хватает снаряжения, здесь
 * написано, чего именно, и рядом стоит кнопка перехода в кузницу.
 */
export function Barracks() {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const act = useGame((g) => g.act);
  const [counts, setCounts] = useState<Partial<Record<TroopId, number>>>({});
  const smithy = buildingOfType(s, 'smithy');
  const rate = recruitRate(s);
  const free = freeVillagers(s).length;

  const setCount = (id: TroopId, n: number): void =>
    setCounts((c) => ({ ...c, [id]: Math.max(1, Math.min(99, n)) }));

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
      <div className="mod">
        <span className="ico">🔨</span>
        <span className="name">Свободных жителей</span>
        <span className={`val${free === 0 ? ' neg' : ''}`}>{free}</span>
      </div>

      {s.recruits.length > 0 && (
        <>
          <h3>Очередь найма</h3>
          {s.recruits.map((o, i) => {
            const def = TROOP_BY_ID[o.troop];
            const left = def.work * (o.count - o.done) - o.work;
            const eta = rate > 0 ? Math.ceil(Math.max(0, left) / rate) : null;
            const pct = Math.floor((o.work / def.work) * 100);
            return (
              <div className="card" key={o.id}>
                <div className="ico">{def.icon}</div>
                <div className="body">
                  <div className="title">
                    {def.name}
                    <span className="count">
                      {o.done}/{o.count} · {i === 0 ? (eta !== null ? `~${eta} с` : 'стоит') : 'ждёт'}
                    </span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${i === 0 ? pct : 0}%` }} />
                  </div>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => act((st) => cancelRecruit(st, o.id))}
                  aria-label="Отменить набор"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </>
      )}

      <h3>Нанять</h3>
      {TROOPS.map((def) => {
        const n = counts[def.id] ?? 1;
        const check = recruitCheck(s, def.id, n);
        const have = s.army[def.id] ?? 0;
        return (
          <div className="troop" key={def.id}>
            <div className="ico">{def.icon}</div>
            <div className="body">
              <div className="title">
                {def.name}
                <span className="count">
                  в дружине: {have} · мощь {def.power}
                </span>
              </div>
              <div className="desc">{def.description}</div>
              <div className="cost">
                {RESOURCE_IDS.filter((r) => def.cost[r]).map((r) => (
                  <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                    {RESOURCE_META[r].icon} {check.cost[r]}
                  </span>
                ))}
                {Object.entries(check.gear).map(([id, need]) => {
                  const short = check.missing.some((m) => m.id === id);
                  return (
                    <span key={id} className={short ? 'no' : ''}>
                      {EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID].icon} {need}
                    </span>
                  );
                })}
                <span className={free >= n ? '' : 'no'}>👤 {n}</span>
                <span>⏳ {check.eta !== null ? `${check.eta} с` : `${check.work}`}</span>
              </div>
            </div>
            <div className="troop-buy">
              <div className="stepper">
                <button disabled={n <= 1} onClick={() => setCount(def.id, n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button onClick={() => setCount(def.id, n + 1)}>+</button>
              </div>
              <button
                className="btn"
                disabled={check.blocked !== null}
                onClick={() => act((st) => startRecruit(st, def.id, n))}
              >
                Нанять
              </button>
              <small className={check.blocked ? 'no' : ''}>
                {check.blocked ?? `свободных останется ${check.freeAfter}`}
              </small>
              {check.missing.length > 0 && smithy && (
                <button className="btn ghost wide" onClick={() => openBuilding(smithy.id)}>
                  ⚒️ В кузницу — ковать {check.missing.map((m) => EQUIPMENT_BY_ID[m.id].one).join(', ')}
                </button>
              )}
              {check.missing.length > 0 && !smithy && (
                <div className="note bad">Снаряжение делают в кузнице — её ещё нет.</div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
