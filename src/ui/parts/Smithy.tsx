import { useState } from 'react';
import type { Building, EquipmentId } from '@/game/types';
import { useGame } from '@/game/store';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { EQUIPMENT, EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { forgeInfo, workerCount } from '@/game/derived';
import { cancelForge, forgeCheck, startForge } from '@/game/sim/actions';

/**
 * Кузница: очередь заказов и ход работы.
 *
 * Заказ — это «сделай десять и встань», а не наряд «куй, пока не сниму».
 * Материалы спрашиваются вперёд и целиком: заказ, вставший на пятом мече из-за
 * пустого склада, — это потерянные часы, о которых игрок узнаёт, вернувшись.
 *
 * Простой показан отдельно и первым. Кузнецы у холодного горна — самое дорогое,
 * что может случиться в этом здании, и молчать об этом нельзя: не заметил —
 * потерял вечер. То же самое говорят маркер над крышей и погасший горн в сцене.
 */
export function Smithy({ b }: { b: Building }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const info = forgeInfo(s);
  const smiths = workerCount(s, b.id);
  const [counts, setCounts] = useState<Partial<Record<EquipmentId, number>>>({});

  const setCount = (id: EquipmentId, n: number): void =>
    setCounts((c) => ({ ...c, [id]: Math.max(1, Math.min(99, n)) }));

  return (
    <>
      <h3>
        Кузница <span className="muted">кузнецов: {smiths}</span>
      </h3>

      {info.idle && (
        <div className="note bad">
          ⚒️ Кузнецы стоят без заказа. Каждая минута такого простоя — минута,
          которой не будет у дружины: закажи, что нужно.
        </div>
      )}
      {!info.idle && smiths === 0 && (
        <div className="note">
          У горна никого. Поставь кузнецов выше — без них заказ не двинется.
        </div>
      )}

      {s.forge.length > 0 && (
        <>
          <h3>
            Очередь заказов <span className="muted">{s.forge.length}</span>
          </h3>
          {s.forge.map((o, i) => {
            const def = EQUIPMENT_BY_ID[o.item];
            const left = def.work * (o.count - o.done) - o.work;
            const eta = info.rate > 0 ? Math.ceil(Math.max(0, left) / info.rate) : null;
            const pct = Math.floor((o.work / Math.max(1, def.work)) * 100);
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
                  onClick={() => act((st) => cancelForge(st, o.id))}
                  aria-label="Отменить заказ"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div className="note">
            Отмена возвращает материалы нетронутых предметов целиком, начатого —
            наполовину: железо на нём уже разрублено.
          </div>
        </>
      )}

      <h3>Заказать</h3>
      {EQUIPMENT.map((e) => {
        const n = counts[e.id] ?? 1;
        const check = forgeCheck(s, e.id, n);
        const have = s.equipment[e.id] ?? 0;
        return (
          <div className="troop" key={e.id}>
            <div className="ico">{e.icon}</div>
            <div className="body">
              <div className="title">
                {e.name}
                <span className="count">на складе: {have}</span>
              </div>
              <div className="desc">{e.description}</div>
              <div className="cost">
                {RESOURCE_IDS.filter((r) => e.cost[r]).map((r) => (
                  <span key={r} className={s.resources[r] >= (check.cost[r] ?? 0) ? '' : 'no'}>
                    {RESOURCE_META[r].icon} {check.cost[r]}
                  </span>
                ))}
                <span>⏳ {check.eta !== null ? `${check.eta} с` : `${check.work}`}</span>
              </div>
            </div>
            <div className="troop-buy">
              <div className="stepper">
                <button disabled={n <= 1} onClick={() => setCount(e.id, n - 1)}>
                  −
                </button>
                <span className="n">{n}</span>
                <button onClick={() => setCount(e.id, n + 1)}>+</button>
              </div>
              <button
                className="btn"
                data-tut={`forge-${e.id}`}
                disabled={check.blocked !== null}
                onClick={() => act((st) => startForge(st, e.id, n))}
              >
                Заказать
              </button>
              <small className={check.blocked ? 'no' : ''}>
                {check.blocked ?? 'материалы спишутся сразу'}
              </small>
            </div>
          </div>
        );
      })}
    </>
  );
}
