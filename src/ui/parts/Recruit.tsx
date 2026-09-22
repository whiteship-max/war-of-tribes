import { useState } from 'react';
import type { TroopId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { buildingOfType, idleCount, wageOf } from '@/game/derived';
import { hiredAt, isTraining, orderEta, recruitCheck } from '@/game/sim/army';
import { cancelRecruit, startRecruit } from '@/game/sim/actions';
import { troopBlock } from '@/game/sim/tech';
import { useRealm } from '@/ui/realm/open';
import { Icon } from '@/ui/icons/Icon';
import { waitShort } from './wait';

/**
 * Найм — очередь и список видов **одного здания**: пеших учат казармы, конницу — конюшня.
 * Где учат вид, решает одна дверь (`army.hiredAt`), и панель её только спрашивает: второго
 * списка «кто в конюшне» здесь нет, иначе новый конный вид остался бы в казармах.
 *
 * Список по образцу Tribal Wars — иконка, цена, время, поле количества и кнопка найма.
 * Цена всегда полная: ресурсы, снаряжение, живой человек и время учений. Тупика без
 * объяснения быть не должно: не хватает снаряжения — здесь написано, чего именно, и рядом
 * кнопка перехода в кузницу; не хватает стойл или уровня конюшни — это говорит `recruitCheck`.
 */
export function Recruit({ at }: { at: 'barracks' | 'stable' }) {
  const s = useGame((g) => g.s);
  const openBuilding = useGame((g) => g.openBuilding);
  const act = useGame((g) => g.act);
  const show = useRealm((r) => r.show);
  const [counts, setCounts] = useState<Partial<Record<TroopId, number>>>({});
  const smithy = buildingOfType(s, 'smithy');
  const free = idleCount(s);
  const here = TROOPS.filter((def) => hiredAt(def.id) === at);
  const queue = (s.recruits ?? []).filter((o) => hiredAt(o.troop) === at);

  const setCount = (id: TroopId, n: number): void =>
    setCounts((c) => ({ ...c, [id]: Math.max(1, Math.min(99, n)) }));

  return (
    <>
      {queue.length > 0 && (
        <>
          <h3>Очередь найма</h3>
          {queue.map((o) => {
            const def = TROOP_BY_ID[o.troop];
            const now = isTraining(s, o);
            // Срок — той же скоростью, какой идёт очередь: с видом бойца и его зданием.
            const eta = orderEta(s, o);
            const pct = Math.floor((o.work / def.work) * 100);
            return (
              <div className="card" key={o.id}>
                <div className="ico">
                  <Icon name={`troop-${def.id}`} glyph={def.icon} />
                </div>
                <div className="body">
                  <div className="title">
                    {def.name}
                    <span className="count">
                      {o.done}/{o.count} · {now ? (eta !== null ? `~${waitShort(eta)}` : 'стоит') : 'ждёт'}
                    </span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${now ? pct : 0}%` }} />
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
      {here.map((def) => {
        const n = counts[def.id] ?? 1;
        const check = recruitCheck(s, def.id, n);
        const have = s.army[def.id] ?? 0;
        // Вид, которого держава не изучила, показан закрытым, а не «дорогим»: причина —
        // та же строка, что гасит кнопку и стоит в самой ветви (`sim/tech`, одна дверь).
        const closed = troopBlock(s, def.id) !== null;
        return (
          <div className={`troop${closed ? ' locked' : ''}`} key={def.id}>
            <div className="ico">
              <Icon name={`troop-${def.id}`} glyph={def.icon} />
            </div>
            <div className="body">
              <div className="title">
                {def.name}
                <span className="count">
                  в дружине: {have} · мощь {def.power} · 💰 {wageOf(s, def.id).toFixed(2)}/д
                </span>
              </div>
              <div className="desc">{def.description}</div>
              <div className="cost">
                {RESOURCE_IDS.filter((r) => def.cost[r]).map((r) => (
                  <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                    <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} /> {check.cost[r]}
                  </span>
                ))}
                {Object.entries(check.gear).map(([id, need]) => {
                  const short = check.missing.some((m) => m.id === id);
                  return (
                    <span key={id} className={short ? 'no' : ''}>
                      <Icon name={`gear-${id}`} glyph={EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID].icon} /> {need}
                    </span>
                  );
                })}
                <span className={free >= n ? '' : 'no'}>👤 {n}</span>
                <span>⏳ {check.eta !== null ? waitShort(check.eta) : `${check.work}`}</span>
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
                data-tut={`recruit-${def.id}`}
                disabled={check.blocked !== null}
                onClick={() => act((st) => startRecruit(st, def.id, n))}
              >
                Нанять
              </button>
              <small className={check.blocked ? 'no' : ''}>
                {check.blocked ?? `свободных останется ${check.freeAfter}`}
              </small>
              {closed && (
                <button className="btn ghost wide" onClick={() => show('tech')}>
                  📚 В «Технологии» — изучить
                </button>
              )}
              {!closed && check.missing.length > 0 && smithy && (
                <button className="btn ghost wide" onClick={() => openBuilding(smithy.id)}>
                  ⚒️ В кузницу — ковать {check.missing.map((m) => EQUIPMENT_BY_ID[m.id].one).join(', ')}
                </button>
              )}
              {!closed && check.missing.length > 0 && !smithy && (
                <div className="note bad">Снаряжение делают в кузнице — её ещё нет.</div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
